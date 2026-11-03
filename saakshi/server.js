'use strict';
// SiteSaakshi: site attendance and accountability for public works.
// Zero dependencies. Needs Node.js 22.5 or later (uses the built-in node:sqlite).
//   node server.js            start (first run creates an admin and prints its PIN)
//   node server.js --demo     start with demo users, a demo work and sample records
// Env: PORT (default 8080), DATA_DIR (default ./data), ADMIN_MOBILE, ADMIN_PIN

process.removeAllListeners('warning');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEMO = process.argv.includes('--demo');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const ROLES = ['admin', 'hq', 'se', 'xen', 'aen', 'jen', 'contractor'];
const OFFICER_ROLES = ['xen', 'aen', 'jen'];
const OVERSIGHT = ['admin', 'hq', 'se']; // hq = tender inviting authority / head office (Jaipur, Delhi…)
const SELF_SIGNUP_ROLES = ['contractor', 'jen', 'aen', 'xen'];
const REQUEST_TYPES = ['measurement', 'bill', 'inspection', 'decision', 'other'];
const BILL_STAGES = ['submitted', 'mb_recorded', 'checked_aen', 'passed_xen', 'paid'];
const DEFAULT_SETTINGS = {
  visits_per_week: { jen: 6, aen: 3, xen: 2 },
  sla_days: { measurement: 7, bill: 15, inspection: 3, decision: 7, other: 7 },
  max_gps_accuracy_m: 100,
  min_visit_minutes: 0,
  escalate_after_days: 7,
  milestone_percent: 10,        // every 10% of the work order value…
  milestone_max_amount: 0,      // …or every this many rupees, whichever comes first (0 = off)
  jen_verify_hours: 24,         // JEN must measure at site within this time of a milestone
  aen_approve_hours: 48,        // AEN must approve within this time of the JEN measurement
  overclaim_tolerance_percent: 5,
  progress_gap_days: 2,         // contractor red flag after this many days without a work update
  weekly_verification: true,    // claimed work unmeasured for a week → a measurement falls due
  wo_issue_days: 10,            // work order must be issued within this many days of the award
  start_within_days: 10,        // contractor must start within this many days of the work order
  hindrance_response_days: 7,   // officer must accept or object to a hindrance; silence = accepted
  hindrance_decision_days: 15,  // S.E./HQ must decide an objected hindrance
  bill_pass_days: 7,            // XEN passes a running bill (quantities are already verified)
  payment_days: 15,             // payment after the bill is passed / approved
  final_approval_days: 15,      // top authority verifies the completed work and approves the final payment
  escalate_measure_aen_hours: 24,  // JEN this late → the AEN may and must measure
  escalate_measure_xen_hours: 72,  // → the XEN
  escalate_approve_xen_hours: 24,  // AEN this late in approving → the XEN may approve
  instruction_response_days: 3,    // a written-down instruction/promise not denied in this time stands confirmed
  explanation_days: 3,             // reply time for an explanation asked by S.E./HQ/XEN
  public_board: true,           // public portal: every work, its updates, contractors and officers
  public_names: true,           // names of officers and contractor firms on the public portal (never mobile numbers)
  public_photos: true,          // site photos from contractors' work updates (never attendance selfies)
};

// ---------- database ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'saakshi.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, mobile TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL, office TEXT DEFAULT '', pin_hash TEXT NOT NULL,
  active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, wo_no TEXT DEFAULT '', office TEXT DEFAULT '',
  contractor_id INTEGER, jen_id INTEGER, aen_id INTEGER, xen_id INTEGER,
  lat REAL NOT NULL, lng REAL NOT NULL, radius_m REAL NOT NULL DEFAULT 200,
  start_date TEXT DEFAULT '', end_date TEXT DEFAULT '', status TEXT DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL,
  day TEXT NOT NULL, server_ts TEXT NOT NULL, client_ts TEXT, lat REAL, lng REAL, accuracy REAL,
  distance_m REAL, in_fence INTEGER, photo TEXT, note TEXT DEFAULT '', flags TEXT DEFAULT '',
  out_ts TEXT, out_lat REAL, out_lng REAL, out_distance_m REAL,
  contractor_status TEXT DEFAULT 'pending', contractor_note TEXT DEFAULT '', contractor_ts TEXT);
CREATE TABLE IF NOT EXISTS dprs (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, user_id INTEGER NOT NULL, day TEXT NOT NULL,
  server_ts TEXT NOT NULL, work_done TEXT NOT NULL, labour TEXT DEFAULT '', materials TEXT DEFAULT '',
  machinery TEXT DEFAULT '', hindrance TEXT DEFAULT '', instructions TEXT DEFAULT '', photo TEXT,
  lat REAL, lng REAL, accuracy REAL, distance_m REAL, in_fence INTEGER,
  contractor_status TEXT DEFAULT 'pending', contractor_note TEXT DEFAULT '', contractor_ts TEXT,
  UNIQUE(work_id, day));
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, raised_by INTEGER NOT NULL, type TEXT NOT NULL,
  title TEXT NOT NULL, details TEXT DEFAULT '', amount REAL, sla_days INTEGER NOT NULL,
  created_ts TEXT NOT NULL, due_day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  stage TEXT DEFAULT '', done_ts TEXT, closed_ts TEXT);
CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL, user_id INTEGER NOT NULL, ts TEXT NOT NULL,
  action TEXT NOT NULL, note TEXT DEFAULT '', photo TEXT);
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY, raised_by INTEGER NOT NULL, work_id INTEGER, against_user_id INTEGER,
  text TEXT NOT NULL, ts TEXT NOT NULL, status TEXT DEFAULT 'open', response TEXT DEFAULT '',
  responded_by INTEGER, responded_ts TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL, detail TEXT);
CREATE TABLE IF NOT EXISTS otps (mobile TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER DEFAULT 0, sent_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_items (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, code TEXT DEFAULT '', description TEXT NOT NULL,
  unit TEXT DEFAULT '', qty REAL NOT NULL DEFAULT 0, rate REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, user_id INTEGER NOT NULL, day TEXT NOT NULL, server_ts TEXT NOT NULL,
  lat REAL, lng REAL, accuracy REAL, distance_m REAL, in_fence INTEGER, note TEXT DEFAULT '', photos TEXT DEFAULT '[]',
  amount REAL NOT NULL DEFAULT 0, flags TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS progress_lines (id INTEGER PRIMARY KEY, progress_id INTEGER NOT NULL, item_id INTEGER NOT NULL, qty REAL NOT NULL);
CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, milestone_no INTEGER NOT NULL, claimed_amount REAL NOT NULL,
  created_ts TEXT NOT NULL, jen_due_ts TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_jen', rounds INTEGER DEFAULT 1,
  jen_id INTEGER, jen_ts TEXT, jen_lat REAL, jen_lng REAL, jen_accuracy REAL, jen_distance_m REAL, jen_photo TEXT, jen_note TEXT DEFAULT '',
  measured_amount REAL, jen_late_hours REAL,
  aen_due_ts TEXT, aen_id INTEGER, aen_ts TEXT, aen_note TEXT DEFAULT '', aen_lat REAL, aen_lng REAL, aen_late_hours REAL,
  contractor_status TEXT DEFAULT 'pending', contractor_note TEXT DEFAULT '', contractor_ts TEXT);
CREATE TABLE IF NOT EXISTS verification_lines (id INTEGER PRIMARY KEY, verification_id INTEGER NOT NULL, item_id INTEGER NOT NULL, claimed_qty REAL NOT NULL, measured_qty REAL);
CREATE TABLE IF NOT EXISTS work_flags (id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, user_id INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL, note TEXT DEFAULT '', status TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS hindrances (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, raised_by INTEGER NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
  responsible_role TEXT NOT NULL, from_day TEXT NOT NULL, to_day TEXT, created_ts TEXT NOT NULL, response_due_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', responded_by INTEGER, responded_ts TEXT, response_note TEXT DEFAULT '',
  decided_by INTEGER, decided_ts TEXT, decision_note TEXT DEFAULT '', photo TEXT);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, bill_no INTEGER NOT NULL, is_final INTEGER NOT NULL DEFAULT 0, verification_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL, created_ts TEXT NOT NULL, gross_upto REAL NOT NULL, prev_upto REAL NOT NULL, tp_percent REAL DEFAULT 0, net_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted', passed_by INTEGER, passed_ts TEXT, hq_by INTEGER, hq_ts TEXT, hq_note TEXT DEFAULT '',
  paid_by INTEGER, paid_ts TEXT, paid_ref TEXT DEFAULT '', note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS bill_lines (id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL, item_id INTEGER NOT NULL, upto_qty REAL NOT NULL, prev_qty REAL NOT NULL, rate REAL NOT NULL);
CREATE TABLE IF NOT EXISTS instructions (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, raised_by INTEGER NOT NULL, raised_role TEXT NOT NULL, to_role TEXT NOT NULL, kind TEXT NOT NULL,
  text TEXT NOT NULL, said_on TEXT NOT NULL, created_ts TEXT NOT NULL, respond_due_day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  responded_by INTEGER, responded_ts TEXT, response_note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS explanations (
  id INTEGER PRIMARY KEY, work_id INTEGER NOT NULL, asked_by INTEGER NOT NULL, asked_to INTEGER NOT NULL, flag_text TEXT DEFAULT '', question TEXT NOT NULL,
  created_ts TEXT NOT NULL, due_day TEXT NOT NULL, reply TEXT, replied_ts TEXT);
CREATE TABLE IF NOT EXISTS daily_reports (day TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS visits_work_day ON visits(work_id, day);
CREATE INDEX IF NOT EXISTS visits_photo ON visits(photo);
`);
// columns added after the first release
for (const [table, col, def] of [['users', 'verified', 'INTEGER DEFAULT 0'], ['works', 'wo_amount', 'REAL'], ['works', 'tia', "TEXT DEFAULT ''"], ['works', 'created_by', 'INTEGER'],
  ['works', 'award_date', 'TEXT'], ['works', 'wo_date', 'TEXT'], ['works', 'duration_days', 'INTEGER'], ['works', 'tp_percent', 'REAL DEFAULT 0'], ['works', 'completed_ts', 'TEXT'], ['works', 'department', "TEXT DEFAULT ''"],
  ['users', 'department', "TEXT DEFAULT ''"], ['users', 'reg_no', "TEXT DEFAULT ''"], ['users', 'gstin', "TEXT DEFAULT ''"], ['verifications', 'kind', "TEXT DEFAULT 'milestone'"]]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
// Records of attendance, DPRs and request history are append-only: no API updates the facts
// (time, place, photo) once saved, and nothing is ever deleted.

const q = (sql) => db.prepare(sql);
const nowIso = () => new Date().toISOString();
// All "days" are Indian Standard Time calendar days.
const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = (day) => { const d = new Date(day + 'T00:00:00Z'); return addDays(day, -((d.getUTCDay() + 6) % 7)); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400e3);

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function getSettings() {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const row of q('SELECT key, value FROM settings').all()) s[row.key] = JSON.parse(row.value);
  return s;
}
function audit(userId, action, detail) {
  q('INSERT INTO audit (ts, user_id, action, detail) VALUES (?,?,?,?)').run(nowIso(), userId ?? null, action, JSON.stringify(detail ?? {}));
}

// ---------- PINs and sessions ----------
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
const failedLogins = new Map(); // mobile -> {count, until}

function createUser({ name, mobile, role, office = '', pin, verified = 1 }) {
  if (!name || !/^\d{10}$/.test(String(mobile))) throw httpErr(400, 'नाम और 10 अंकों का मोबाइल नंबर ज़रूरी है');
  if (!ROLES.includes(role)) throw httpErr(400, 'गलत भूमिका (role)');
  if (pin !== null && !/^\d{4,8}$/.test(String(pin))) throw httpErr(400, 'PIN 4 से 8 अंकों का हो');
  if (q('SELECT id FROM users WHERE mobile = ?').get(String(mobile))) throw httpErr(409, 'यह मोबाइल नंबर पहले से दर्ज है');
  // pin null: account made for someone else (officer named on a project); they set a PIN by OTP
  const r = q('INSERT INTO users (name, mobile, role, office, pin_hash, created_at, verified) VALUES (?,?,?,?,?,?,?)')
    .run(String(name).trim().slice(0, 120), String(mobile), role, office, pin === null ? '' : hashPin(pin), nowIso(), verified ? 1 : 0);
  return Number(r.lastInsertRowid);
}

// ---------- photos ----------
function savePhoto(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
  if (!m) throw httpErr(400, 'फ़ोटो का फ़ॉर्मेट सही नहीं है');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 2000) throw httpErr(400, 'फ़ोटो खाली या बहुत छोटी है');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const file = path.join(PHOTO_DIR, hash + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]));
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return hash;
}
function photoPath(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  for (const ext of ['jpg', 'png', 'webp']) { const f = path.join(PHOTO_DIR, `${hash}.${ext}`); if (fs.existsSync(f)) return f; }
  return null;
}

// ---------- access ----------
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
function worksFor(user) {
  if (OVERSIGHT.includes(user.role)) return q('SELECT * FROM works ORDER BY status, name').all();
  const col = { contractor: 'contractor_id', jen: 'jen_id', aen: 'aen_id', xen: 'xen_id' }[user.role];
  return q(`SELECT * FROM works WHERE ${col} = ? ORDER BY status, name`).all(user.id);
}
function canSeeWork(user, work) {
  if (!work) return false;
  if (OVERSIGHT.includes(user.role)) return true;
  return [work.contractor_id, work.jen_id, work.aen_id, work.xen_id].includes(user.id);
}
function workOr404(user, id) {
  const w = q('SELECT * FROM works WHERE id = ?').get(Number(id));
  if (!canSeeWork(user, w)) throw httpErr(404, 'काम नहीं मिला');
  return w;
}
const userNames = () => Object.fromEntries(q('SELECT id, name FROM users').all().map((u) => [u.id, u.name]));
function publicUser(u) { return u && { id: u.id, name: u.name, mobile: u.mobile, role: u.role, office: u.office, active: u.active, verified: u.verified, has_pin: !!u.pin_hash, department: u.department || '', reg_no: u.reg_no || '', gstin: u.gstin || '' }; }

// ---------- attendance rules ----------
// A visit counts when it was inside the site fence, the GPS was accurate enough, the photo was not
// reused from an earlier visit, the contractor has not disputed it, and (if a minimum time on site is
// set) the officer checked out inside the fence after that many minutes. At most one counts per day.
function visitCounts(v, s) {
  if (!v.in_fence || v.contractor_status === 'disputed') return false;
  const flags = v.flags ? v.flags.split(',') : [];
  if (flags.includes('photo_reused') || flags.includes('low_accuracy') || flags.includes('no_photo')) return false;
  if (s.min_visit_minutes > 0) {
    if (!v.out_ts || v.out_distance_m == null) return false;
    const work = q('SELECT radius_m FROM works WHERE id = ?').get(v.work_id);
    if (v.out_distance_m > work.radius_m) return false;
    if ((new Date(v.out_ts) - new Date(v.server_ts)) / 60000 < s.min_visit_minutes) return false;
  }
  return true;
}

function compliance(works, week, s) {
  const today = istDay();
  const end = addDays(week, 6);
  const names = userNames();
  const rows = [];
  // visits are owed only while the work is running: after the work order and before completion
  for (const w of works.filter((x) => x.status === 'active' && !(x.award_date && !x.wo_date) && !(x.completed_ts && istDay(new Date(x.completed_ts)) < week))) {
    const visits = q('SELECT * FROM visits WHERE work_id = ? AND day BETWEEN ? AND ?').all(w.id, week, end);
    for (const role of OFFICER_ROLES) {
      const uid = w[role + '_id'];
      if (!uid) continue;
      const mine = visits.filter((v) => v.user_id === uid);
      const countedDays = new Set(mine.filter((v) => visitCounts(v, s)).map((v) => v.day));
      const lastOk = q("SELECT day FROM visits WHERE work_id = ? AND user_id = ? AND in_fence = 1 AND contractor_status != 'disputed' ORDER BY day DESC LIMIT 1").get(w.id, uid);
      const required = s.visits_per_week[role] || 0;
      const daysLeft = week > today ? 7 : Math.max(0, daysBetween(today, end) + 1);
      const done = countedDays.size;
      rows.push({
        work_id: w.id, work: w.name, role, user_id: uid, officer: names[uid] || '?',
        required, done, recorded: mine.length,
        outside_fence: mine.filter((v) => !v.in_fence).length,
        disputed: mine.filter((v) => v.contractor_status === 'disputed').length,
        last_visit: lastOk ? lastOk.day : null,
        days_since: lastOk ? daysBetween(lastOk.day, today) : null,
        status: done >= required ? 'ok' : (done + daysLeft >= required && end >= today ? 'due' : 'short'),
      });
    }
  }
  return rows;
}

function missingDprs(works, week) {
  const today = istDay();
  const out = [];
  for (const w of works.filter((x) => x.status === 'active' && x.jen_id)) {
    const have = new Set(q('SELECT day FROM dprs WHERE work_id = ? AND day BETWEEN ? AND ?').all(w.id, week, addDays(week, 6)).map((r) => r.day));
    const missing = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(week, i);
      if (d >= today) break; // today is not missing yet
      if (w.start_date && d < w.start_date) continue;
      if (new Date(d + 'T00:00:00Z').getUTCDay() === 0) continue; // Sundays are not counted
      if (!have.has(d)) missing.push(d);
    }
    if (missing.length) out.push({ work_id: w.id, work: w.name, jen_id: w.jen_id, missing });
  }
  return out;
}

function decorateRequest(r, s) {
  const today = istDay();
  const open = r.status === 'open' || r.status === 'reopened';
  const overdueDays = open ? daysBetween(r.due_day, today) : 0;
  return {
    ...r,
    overdue_days: Math.max(0, overdueDays),
    escalated_to: open && overdueDays > s.escalate_after_days ? 'se' : open && overdueDays > 0 ? 'xen' : null,
  };
}

// ---------- work progress, milestones and verification ----------
const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600e3;
const addHours = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3).toISOString();
const items = (workId) => q('SELECT * FROM work_items WHERE work_id = ? ORDER BY id').all(workId);
const boqTotal = (workId) => items(workId).reduce((t, i) => t + i.qty * i.rate, 0);
function claimedQty(workId) {
  const m = {};
  for (const r of q('SELECT pl.item_id, SUM(pl.qty) AS qty FROM progress_lines pl JOIN progress p ON p.id = pl.progress_id WHERE p.work_id = ? GROUP BY pl.item_id').all(workId)) m[r.item_id] = r.qty;
  return m;
}
function claimedAmount(workId) {
  const c = claimedQty(workId);
  return items(workId).reduce((t, i) => t + (c[i.id] || 0) * i.rate, 0);
}
// The step at which a JEN measurement + AEN approval becomes mandatory.
function milestoneStep(w, s) {
  const base = w.wo_amount || boqTotal(w.id);
  let step = base * (s.milestone_percent / 100);
  if (s.milestone_max_amount > 0) step = step > 0 ? Math.min(step, s.milestone_max_amount) : s.milestone_max_amount;
  return step > 0 ? step : null;
}
function maybeCreateVerification(w, before, after, s) {
  const step = milestoneStep(w, s);
  if (!step) return null;
  const k0 = Math.floor(before / step + 1e-9), k1 = Math.floor(after / step + 1e-9);
  if (k1 <= k0) return null;
  const ts = nowIso();
  const id = Number(q(`INSERT INTO verifications (work_id, milestone_no, claimed_amount, created_ts, jen_due_ts, jen_id) VALUES (?,?,?,?,?,?)`)
    .run(w.id, k1, Math.round(after), ts, addHours(ts, s.jen_verify_hours), w.jen_id).lastInsertRowid);
  const c = claimedQty(w.id);
  for (const it of items(w.id)) if (c[it.id]) q('INSERT INTO verification_lines (verification_id, item_id, claimed_qty) VALUES (?,?,?)').run(id, it.id, c[it.id]);
  const jen = w.jen_id && q('SELECT mobile FROM users WHERE id = ?').get(w.jen_id);
  if (jen) sendSms(jen.mobile, `SiteSaakshi: "${w.name}" का ${k1 * s.milestone_percent}% माइलस्टोन। ${s.jen_verify_hours} घंटे में साइट पर जाकर नाप लें।`);
  return id;
}
function decorateVerification(v, s) {
  const now = nowIso();
  const out = { ...v, lines: q('SELECT vl.*, i.description, i.unit, i.rate, i.code FROM verification_lines vl JOIN work_items i ON i.id = vl.item_id WHERE vl.verification_id = ? ORDER BY i.id').all(v.id) };
  if (v.status === 'pending_jen') out.overdue_hours = Math.max(0, Math.round(hoursBetween(v.jen_due_ts, now)));
  else if (v.status === 'pending_aen') out.overdue_hours = Math.max(0, Math.round(hoursBetween(v.aen_due_ts, now)));
  else out.overdue_hours = 0;
  out.overclaim = v.measured_amount != null && v.measured_amount < v.claimed_amount * (1 - s.overclaim_tolerance_percent / 100);
  return out;
}

// Red flags are computed, never typed in: they can only clear when the work is actually done.
// They go both ways: against officers who do not verify, and against contractors who over-claim or go silent.
function redFlags(works, s) {
  const names = userNames();
  const now = nowIso(), today = istDay();
  const flags = [];
  const add = (w, f) => flags.push({ work_id: w.id, work: w.name, tia: w.tia || '', ...f, against_name: names[f.against_id] || '' });
  for (const w of works.filter((x) => x.status === 'active')) {
    for (const v of q("SELECT * FROM verifications WHERE work_id = ? AND status IN ('pending_jen','pending_aen')").all(w.id)) {
      const pct = v.kind === 'milestone' || !v.kind ? `${v.milestone_no * s.milestone_percent}% माइलस्टोन` : { weekly: 'साप्ताहिक नाप', on_demand: 'ठेकेदार द्वारा माँगा नाप', final: 'काम पूरा: अंतिम नाप' }[v.kind];
      if (v.status === 'pending_jen' && now > v.jen_due_ts) {
        const late = hoursBetween(v.jen_due_ts, now);
        const up = late >= s.escalate_measure_xen_hours ? 'xen' : late >= s.escalate_measure_aen_hours ? 'aen' : null;
        add(w, { type: 'jen_not_verified', severity: 'high', against_role: 'jen', against_id: w.jen_id, since: v.jen_due_ts, hours: Math.round(late), ref: v.id,
          text: `ठेकेदार ने ₹${Math.round(v.claimed_amount).toLocaleString('en-IN')} का काम (${pct}) अपलोड किया; JEN ने ${s.jen_verify_hours} घंटे में साइट पर नाप नहीं लिया${up ? `। अब ज़िम्मेदारी ${up === 'xen' ? 'AEN और XEN' : 'AEN'} की भी` : ''}` });
        if (up) add(w, { type: 'measure_escalated', severity: 'high', against_role: up, against_id: w[up + '_id'], since: addHours(v.jen_due_ts, up === 'xen' ? s.escalate_measure_xen_hours : s.escalate_measure_aen_hours), ref: v.id,
          text: `JEN नहीं आया; अब ${up.toUpperCase()} को साइट पर जाकर नाप लेना है (ठेकेदार का दावा ₹${Math.round(v.claimed_amount).toLocaleString('en-IN')})` });
      }
      if (v.status === 'pending_aen' && now > v.aen_due_ts) add(w, { type: 'aen_not_approved', severity: 'high', against_role: 'aen', against_id: w.aen_id, since: v.aen_due_ts, hours: Math.round(hoursBetween(v.aen_due_ts, now)), ref: v.id,
        text: `JEN का नाप (${pct}) ${s.aen_approve_hours} घंटे से AEN के अनुमोदन के बिना पड़ा है` });
    }
    const lastV = q("SELECT * FROM verifications WHERE work_id = ? AND measured_amount IS NOT NULL ORDER BY id DESC LIMIT 1").get(w.id);
    if (lastV && lastV.measured_amount < lastV.claimed_amount * (1 - s.overclaim_tolerance_percent / 100)) add(w, { type: 'contractor_overclaim', severity: 'medium', against_role: 'contractor', against_id: w.contractor_id, since: lastV.jen_ts, ref: lastV.id,
      text: `ठेकेदार का दावा ₹${Math.round(lastV.claimed_amount).toLocaleString('en-IN')}, JEN का साइट नाप ₹${Math.round(lastV.measured_amount).toLocaleString('en-IN')} (${Math.round(100 - lastV.measured_amount / lastV.claimed_amount * 100)}% कम)` });
    if (w.contractor_id && items(w.id).length && !w.completed_ts && !(w.award_date && !w.wo_date)) {
      const last = q('SELECT day FROM progress WHERE work_id = ? ORDER BY day DESC LIMIT 1').get(w.id);
      const from = last ? last.day : (w.start_date || istDay(new Date(w.created_at)));
      const gap = daysBetween(from, today);
      if (gap > s.progress_gap_days) add(w, { type: 'contractor_no_update', severity: 'low', against_role: 'contractor', against_id: w.contractor_id, since: from, days: gap,
        text: `ठेकेदार ने ${gap} दिन से रोज़ का काम/फ़ोटो अपलोड नहीं किया` });
    }
    for (const r of q("SELECT * FROM requests WHERE work_id = ? AND status IN ('open','reopened')").all(w.id)) {
      const late = daysBetween(r.due_day, today);
      if (late > 0) add(w, { type: 'request_overdue', severity: late > s.escalate_after_days ? 'high' : 'medium', against_role: r.type === 'bill' ? 'xen' : 'jen', against_id: r.type === 'bill' ? w.xen_id : w.jen_id, since: r.due_day, days: late, ref: r.id,
        text: `${r.type === 'bill' ? 'बिल' : r.type === 'measurement' ? 'नाप' : 'अनुरोध'} "${r.title}" ${late} दिन से समय-सीमा पार` });
    }
    for (const f of q("SELECT * FROM work_flags WHERE work_id = ? AND status = 'open'").all(w.id)) add(w, { type: f.kind, severity: 'medium', against_role: '', against_id: null, since: f.ts, ref: f.id,
      text: `${names[f.user_id]}: ${f.kind === 'assignment_disputed' ? 'यह काम मुझे सौंपा नहीं गया / जानकारी गलत है' : 'आपत्ति'}: ${f.note}` });
    // ---- contract timeline, hindrances and bills ----
    const t = timeline(w, s);
    if (w.award_date && !w.wo_date && t.wo_late_days > 0) add(w, { type: 'wo_not_issued', severity: 'high', against_role: 'xen', against_id: w.xen_id, since: t.wo_due_date, days: t.wo_late_days,
      text: `काम ${w.award_date} को अवार्ड हुआ; ${s.wo_issue_days} दिन में वर्क ऑर्डर जारी होना था, ${t.wo_late_days} दिन से नहीं हुआ` });
    if (w.wo_date && !t.actual_start && t.start_late_days > 0) add(w, { type: 'contractor_not_started', severity: 'medium', against_role: 'contractor', against_id: w.contractor_id, since: t.official_start, days: t.start_late_days,
      text: `वर्क ऑर्डर ${w.wo_date} को मिला; ${t.start_late_days} दिन से काम शुरू नहीं हुआ` });
    for (const h of t.hindrances.filter((x) => x.state === 'disputed' && x.decision_due_day < today)) add(w, { type: 'hindrance_undecided', severity: 'medium', against_role: 'se', against_id: null, since: h.decision_due_day, ref: h.id,
      text: `बाधा "${h.category_label}" पर अधिकारी ने आपत्ति की; S.E./मुख्यालय ने ${s.hindrance_decision_days} दिन में निर्णय नहीं दिया (तब तक समय-वृद्धि ठेकेदार को मिलती रहेगी)` });
    const deptDays = Object.entries(t.department_days_by_role).filter(([, d]) => d > 0);
    if (deptDays.length) add(w, { type: 'department_delay', severity: 'medium', against_role: deptDays.sort((a, b) => b[1] - a[1])[0][0], against_id: w[deptDays[0][0] + '_id'] || null, since: t.stipulated_end || '', days: t.extension_days,
      text: `विभाग के कारण ${t.extension_days} दिन की बाधा (${deptDays.map(([r, d]) => `${r.toUpperCase()} ${d} दिन`).join(', ')}): इतनी समय-वृद्धि ठेकेदार को, ज़िम्मेदारी अधिकारियों की` });
    if (t.contractor_delay_days > 0) add(w, { type: 'contractor_delay', severity: 'medium', against_role: 'contractor', against_id: w.contractor_id, since: t.revised_end, days: t.contractor_delay_days,
      text: `संशोधित तिथि ${t.revised_end} (समय-वृद्धि ${t.extension_days} दिन सहित) के बाद ${t.contractor_delay_days} दिन देरी${t.penalty_applicable ? '' : ' (बाधा पर निर्णय बाकी, अभी पेनल्टी नहीं)'}` });
    for (const b of q("SELECT * FROM bills WHERE work_id = ? AND status IN ('submitted','passed','hq_approved')").all(w.id)) {
      const d = billDue(b, s);
      if (d && today > d.due) add(w, { type: b.is_final && b.status === 'submitted' ? 'final_not_approved' : 'bill_delayed', severity: 'high', against_role: d.by, against_id: d.by === 'xen' ? w.xen_id : null, since: d.due, days: daysBetween(d.due, today), ref: b.id,
        text: `${b.is_final ? 'अंतिम बिल' : `${b.bill_no}वाँ रनिंग बिल`} (₹${Math.round(b.net_amount).toLocaleString('en-IN')}): ${d.what} ${daysBetween(d.due, today)} दिन से बाकी` });
    }
    for (const e of q('SELECT * FROM explanations WHERE work_id = ? AND reply IS NULL AND due_day < ?').all(w.id, today)) {
      const u = q('SELECT role FROM users WHERE id = ?').get(e.asked_to);
      add(w, { type: 'explanation_overdue', severity: 'high', against_role: u?.role || '', against_id: e.asked_to, since: e.due_day, days: daysBetween(e.due_day, today), ref: e.id,
        text: `${names[e.asked_by]} ने स्पष्टीकरण माँगा ("${e.question.slice(0, 80)}"); ${daysBetween(e.due_day, today)} दिन से जवाब नहीं` });
    }
    for (const i of q("SELECT * FROM instructions WHERE work_id = ? AND status = 'denied'").all(w.id)) add(w, { type: 'instruction_disputed', severity: 'medium', against_role: '', against_id: null, since: i.responded_ts, ref: i.id,
      text: `निर्देश/वादे पर विवाद: ${names[i.raised_by]} का कहना "${i.text.slice(0, 80)}"; ${names[i.responded_by]} ने खंडन किया: "${i.response_note.slice(0, 80)}". S.E./मुख्यालय देखें` });
    for (const role of OFFICER_ROLES) {
      const u = w[role + '_id'] && q('SELECT verified, pin_hash FROM users WHERE id = ?').get(w[role + '_id']);
      if (u && !u.pin_hash) add(w, { type: 'officer_not_joined', severity: 'low', against_role: role, against_id: w[role + '_id'], since: w.created_at, text: `${role.toUpperCase()} ने अभी तक ऐप में लॉगिन नहीं किया` });
    }
  }
  for (const f of flags) f.age_days = f.since ? Math.max(0, daysBetween(String(f.since).slice(0, 10), today)) : 0;
  const rank = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.since).localeCompare(String(b.since)));
}

// ---------- contract timeline: award → work order → start → stipulated end → extension → completion ----------
// Delay is split by who caused it. The department's delays (late work order, hindrances the officers accepted or
// did not answer, decisions/inspections they did not give in time) extend the time and can never be a penalty
// on the contractor. Only delay beyond the revised date, with no pending hindrance, is the contractor's.
const HINDRANCE_CATEGORIES = {
  site_not_handed: { label: 'साइट / ज़मीन नहीं सौंपी', role: 'xen' },
  work_not_shown: { label: 'अधिकारी ने काम / ले-आउट नहीं बताया', role: 'jen' },
  drawing_decision: { label: 'ड्रॉइंग / डिज़ाइन / निर्णय नहीं दिया', role: 'xen' },
  estimate_wrong: { label: 'एस्टीमेट / BOQ गलत, मात्रा बदली', role: 'aen' },
  utility_shifting: { label: 'बिजली खंभे, पाइपलाइन, अतिक्रमण नहीं हटे', role: 'xen' },
  payment_delay: { label: 'बिल का भुगतान अटका', role: 'xen' },
  department_material: { label: 'विभाग की सामग्री नहीं मिली', role: 'xen' },
  other_department: { label: 'विभाग का अन्य कारण', role: 'xen' },
};
function mergedDays(intervals) { // [{from, to}] inclusive days; overlaps counted once
  const iv = intervals.filter((i) => i.from && i.to && i.to >= i.from).sort((a, b) => a.from.localeCompare(b.from));
  let total = 0, curFrom = null, curTo = null;
  for (const i of iv) {
    if (curTo && i.from <= addDays(curTo, 1)) { if (i.to > curTo) curTo = i.to; continue; }
    if (curFrom) total += daysBetween(curFrom, curTo) + 1;
    curFrom = i.from; curTo = i.to;
  }
  if (curFrom) total += daysBetween(curFrom, curTo) + 1;
  return total;
}
// hindrance status as it stands today: an officer who does not answer in time is taken to have accepted it
function hindranceState(h, s, today = istDay()) {
  if (h.status === 'pending' && today > h.response_due_day) return 'deemed';
  return h.status;
}
function hindrances(w, s) {
  const today = istDay();
  const end = w.completed_ts ? istDay(new Date(w.completed_ts)) : today;
  const names = userNames();
  const list = q('SELECT * FROM hindrances WHERE work_id = ? ORDER BY from_day').all(w.id).map((h) => {
    const state = hindranceState(h, s, today);
    return { ...h, state, counts: ['accepted', 'deemed', 'disputed', 'pending'].includes(state), // disputed counts until S.E./HQ reject it
      to_effective: h.to_day || end, days: daysBetween(h.from_day, h.to_day || end) + 1,
      category_label: HINDRANCE_CATEGORIES[h.category]?.label || h.category, raised_by_name: names[h.raised_by], responder: names[h.responded_by] || '', decider: names[h.decided_by] || '',
      decision_due_day: h.status === 'disputed' ? addDays(istDay(new Date(h.responded_ts)), s.hindrance_decision_days) : null };
  });
  // the department's own lateness in measuring and approving: those days hold up the work and the bill
  for (const v of q('SELECT * FROM verifications WHERE work_id = ?').all(w.id)) {
    const jenDue = istDay(new Date(v.jen_due_ts)), jenDone = v.jen_ts ? istDay(new Date(v.jen_ts)) : (v.status === 'pending_jen' ? end : null);
    if (jenDone && jenDone > jenDue) list.push({ id: 'V' + v.id, auto: true, category: 'measurement_late', category_label: `(स्वचालित) नाप #${v.id} समय पर नहीं लिया`, description: '', responsible_role: 'jen',
      from_day: addDays(jenDue, 1), to_effective: jenDone, days: daysBetween(jenDue, jenDone), state: 'auto', counts: true });
    if (v.aen_due_ts) {
      const aenDue = istDay(new Date(v.aen_due_ts)), aenDone = v.aen_ts ? istDay(new Date(v.aen_ts)) : (v.status === 'pending_aen' ? end : null);
      if (aenDone && aenDone > aenDue) list.push({ id: 'A' + v.id, auto: true, category: 'approval_late', category_label: `(स्वचालित) नाप #${v.id} का अनुमोदन समय पर नहीं`, description: '', responsible_role: 'aen',
        from_day: addDays(aenDue, 1), to_effective: aenDone, days: daysBetween(aenDue, aenDone), state: 'auto', counts: true });
    }
  }
  // automatic hindrances from the system's own record: decisions and inspections the officers did not give in time
  for (const r of q("SELECT * FROM requests WHERE work_id = ? AND type IN ('decision','inspection')").all(w.id)) {
    const doneDay = r.done_ts ? istDay(new Date(r.done_ts)) : null;
    const to = doneDay || end;
    if (to > r.due_day) list.push({ id: 'R' + r.id, auto: true, category: r.type === 'decision' ? 'drawing_decision' : 'work_not_shown', category_label: `(स्वचालित) अनुरोध #${r.id} "${r.title}" समय पर पूरा नहीं`,
      description: '', responsible_role: r.type === 'decision' ? 'xen' : 'jen', from_day: addDays(r.due_day, 1), to_effective: to, days: daysBetween(r.due_day, to), state: 'auto', counts: true });
  }
  return list;
}
function timeline(w, s) {
  const today = istDay();
  const t = { award_date: w.award_date || null, wo_date: w.wo_date || null, duration_days: w.duration_days || null };
  if (w.award_date) {
    t.wo_due_date = addDays(w.award_date, s.wo_issue_days);
    const woDay = w.wo_date || today;
    t.wo_late_days = Math.max(0, daysBetween(t.wo_due_date, woDay));
  }
  if (w.wo_date) {
    t.official_start = w.start_date || addDays(w.wo_date, s.start_within_days);
    const first = q('SELECT MIN(day) AS d FROM progress WHERE work_id = ?').get(w.id).d;
    t.actual_start = first || null;
    t.start_late_days = Math.max(0, daysBetween(t.official_start, first || today));
    t.stipulated_end = w.end_date || (w.duration_days ? addDays(t.official_start, w.duration_days - 1) : null);
  } else if (w.end_date) t.stipulated_end = w.end_date;
  const hs = hindrances(w, s);
  t.hindrances = hs;
  t.extension_days = mergedDays(hs.filter((h) => h.counts).map((h) => ({ from: h.from_day, to: h.to_effective })));
  const byRole = {};
  for (const h of hs.filter((x) => x.counts)) byRole[h.responsible_role] = (byRole[h.responsible_role] || 0) + h.days;
  t.department_days_by_role = byRole;
  t.completed_day = w.completed_ts ? istDay(new Date(w.completed_ts)) : null;
  if (t.stipulated_end) {
    t.revised_end = addDays(t.stipulated_end, t.extension_days);
    const upto = t.completed_day || today;
    t.delay_days = Math.max(0, daysBetween(t.stipulated_end, upto));
    t.contractor_delay_days = Math.max(0, daysBetween(t.revised_end, upto));
    t.department_delay_days = t.delay_days - t.contractor_delay_days;
    t.penalty_applicable = t.contractor_delay_days > 0 && !hs.some((h) => h.state === 'pending' || h.state === 'disputed');
  }
  return t;
}

// ---------- verification on demand / weekly, and bills from verified quantities ----------
function createVerification(w, kind, s) {
  if (q("SELECT 1 FROM verifications WHERE work_id = ? AND status IN ('pending_jen','pending_aen')").get(w.id)) return null;
  const claimed = claimedAmount(w.id);
  const step = milestoneStep(w, s);
  const ts = nowIso();
  const id = Number(q(`INSERT INTO verifications (work_id, milestone_no, claimed_amount, created_ts, jen_due_ts, jen_id, kind) VALUES (?,?,?,?,?,?,?)`)
    .run(w.id, step ? Math.floor(claimed / step + 1e-9) : 0, Math.round(claimed), ts, addHours(ts, s.jen_verify_hours), w.jen_id, kind).lastInsertRowid);
  const c = claimedQty(w.id);
  for (const it of items(w.id)) if (c[it.id] || kind === 'final') q('INSERT INTO verification_lines (verification_id, item_id, claimed_qty) VALUES (?,?,?)').run(id, it.id, c[it.id] || 0);
  const jen = w.jen_id && q('SELECT mobile FROM users WHERE id = ?').get(w.jen_id);
  if (jen) sendSms(jen.mobile, `SiteSaakshi: "${w.name}" का ${kind === 'final' ? 'अंतिम (काम पूरा)' : kind === 'weekly' ? 'साप्ताहिक' : 'ठेकेदार द्वारा माँगा'} नाप। ${s.jen_verify_hours} घंटे में साइट पर जाकर नाप लें।`);
  return id;
}
// weekly: if the contractor has claimed work that no one has measured for a week, a measurement falls due
function weeklyVerifications() {
  const s = getSettings();
  if (!s.weekly_verification) return;
  for (const w of q("SELECT * FROM works WHERE status = 'active' AND completed_ts IS NULL").all()) {
    const last = q('SELECT MAX(created_ts) AS t FROM verifications WHERE work_id = ?').get(w.id).t;
    const lastMeasured = q("SELECT claimed_amount FROM verifications WHERE work_id = ? ORDER BY id DESC LIMIT 1").get(w.id);
    const claimed = claimedAmount(w.id);
    if (claimed <= (lastMeasured?.claimed_amount || 0) + 1) continue;
    const since = last || q('SELECT MIN(server_ts) AS t FROM progress WHERE work_id = ?').get(w.id).t;
    if (since && hoursBetween(since, nowIso()) >= 7 * 24) createVerification(w, 'weekly', s);
  }
}
function latestApproved(workId) {
  const v = q("SELECT * FROM verifications WHERE work_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1").get(workId);
  if (!v) return null;
  return { v, qty: Object.fromEntries(q('SELECT item_id, measured_qty FROM verification_lines WHERE verification_id = ?').all(v.id).map((l) => [l.item_id, l.measured_qty || 0])) };
}
function billDetail(b) {
  const lines = q('SELECT bl.*, i.description, i.unit, i.code, i.qty AS boq_qty FROM bill_lines bl JOIN work_items i ON i.id = bl.item_id WHERE bl.bill_id = ? ORDER BY i.id').all(b.id)
    .map((l) => ({ ...l, since_qty: l.upto_qty - l.prev_qty, upto_amount: l.upto_qty * l.rate, since_amount: (l.upto_qty - l.prev_qty) * l.rate }));
  return { ...b, lines };
}
function billDue(b, s) {
  if (b.status === 'submitted' && !b.is_final) return { by: 'xen', due: addDays(istDay(new Date(b.created_ts)), s.bill_pass_days), what: 'बिल पास करना' };
  if (b.status === 'submitted' && b.is_final) return { by: 'hq', due: addDays(istDay(new Date(b.created_ts)), s.final_approval_days), what: 'अंतिम बिल का सत्यापन और भुगतान-अनुमोदन' };
  if (b.status === 'passed' || b.status === 'hq_approved') return { by: 'xen', due: addDays(istDay(new Date(b.passed_ts || b.hq_ts)), s.payment_days), what: 'भुगतान' };
  return null;
}

// SMS: set SMS_WEBHOOK_URL to any gateway that accepts POST {to, message}. Otherwise messages go to the server log.
function sendSms(to, message) {
  if (process.env.SMS_WEBHOOK_URL) {
    fetch(process.env.SMS_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, message }) }).catch((e) => console.error('SMS failed', e.message));
  } else if (!process.env.QUIET) console.log(`[SMS to ${to}] ${message}`);
}

// ---------- HTTP helpers ----------
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return reject(httpErr(415, 'JSON भेजें'));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 12e6) { reject(httpErr(413, 'डेटा बहुत बड़ा है')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(httpErr(400, 'गलत JSON')); } });
    req.on('error', reject);
  });
}
function cookieToken(req) {
  const m = /(?:^|;\s*)ss_token=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function currentUser(req) {
  const t = cookieToken(req);
  if (!t) return null;
  const u = q('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(t);
  return u && u.active ? u : null;
}
const need = (user, roles) => { if (!roles.includes(user.role)) throw httpErr(403, 'यह काम आपकी भूमिका के लिए नहीं है'); };
const num = (x) => (x === '' || x == null || !Number.isFinite(Number(x)) ? null : Number(x));
const str = (x, max = 4000) => String(x ?? '').trim().slice(0, max);

function csv(rows, cols) {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts });

route('POST', '/api/login', async (req, res) => {
  const { mobile, pin } = await readJson(req);
  const key = String(mobile);
  const f = failedLogins.get(key);
  if (f && f.until > Date.now()) throw httpErr(429, 'बहुत बार गलत PIN। 15 मिनट बाद कोशिश करें');
  const u = q('SELECT * FROM users WHERE mobile = ?').get(key);
  if (u && u.active && !u.pin_hash) throw httpErr(401, 'पहली बार है: "OTP से लॉगिन" चुनें और अपना PIN बनाएँ');
  if (!u || !u.active || !checkPin(pin, u.pin_hash)) {
    const c = (f?.count || 0) + 1;
    failedLogins.set(key, { count: c, until: c >= 5 ? Date.now() + 15 * 60e3 : 0 });
    throw httpErr(401, 'मोबाइल नंबर या PIN गलत है');
  }
  failedLogins.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, u.id, nowIso());
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': `ss_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
}, { public: true });

route('POST', '/api/logout', async (req, res) => {
  q('DELETE FROM sessions WHERE token = ?').run(cookieToken(req));
  send(res, 200, { ok: true }, { 'Set-Cookie': 'ss_token=; Path=/; Max-Age=0' });
});

route('GET', '/api/me', async (req, res, { user }) => {
  send(res, 200, { user: publicUser(user), settings: getSettings(), today: istDay(), server_time: nowIso() });
});

route('POST', '/api/me/pin', async (req, res, { user }) => {
  const { old_pin, new_pin } = await readJson(req);
  if (!checkPin(old_pin, user.pin_hash)) throw httpErr(400, 'पुराना PIN गलत है');
  if (!/^\d{4,8}$/.test(String(new_pin))) throw httpErr(400, 'PIN 4 से 8 अंकों का हो');
  q('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(new_pin), user.id);
  audit(user.id, 'pin_changed', {});
  send(res, 200, { ok: true });
});

// users
route('GET', '/api/users', async (req, res, { user }) => {
  if (OVERSIGHT.includes(user.role)) return send(res, 200, q('SELECT * FROM users ORDER BY role, name').all().map(publicUser));
  // others only see names and roles of people on their own works
  const ids = new Set();
  for (const w of worksFor(user)) for (const k of ['contractor_id', 'jen_id', 'aen_id', 'xen_id']) if (w[k]) ids.add(w[k]);
  send(res, 200, [...ids].map((id) => q('SELECT id, name, role, office FROM users WHERE id = ?').get(id)).filter(Boolean));
});
route('POST', '/api/users', async (req, res, { user }) => {
  need(user, OVERSIGHT);
  const b = await readJson(req);
  if (b.role === 'admin' && user.role !== 'admin') throw httpErr(403, 'केवल admin नया admin बना सकता है');
  const id = createUser(b);
  audit(user.id, 'user_created', { id, role: b.role, mobile: b.mobile });
  send(res, 201, { id });
});
route('PUT', '/api/users/:id', async (req, res, { user, params }) => {
  need(user, OVERSIGHT);
  const b = await readJson(req);
  const u = q('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!u) throw httpErr(404, 'उपयोगकर्ता नहीं मिला');
  if ((u.role === 'admin' || b.role === 'admin') && user.role !== 'admin') throw httpErr(403, 'केवल admin');
  if (b.role && !ROLES.includes(b.role)) throw httpErr(400, 'गलत भूमिका');
  q('UPDATE users SET name = ?, role = ?, office = ?, active = ? WHERE id = ?')
    .run(str(b.name ?? u.name, 120), b.role ?? u.role, str(b.office ?? u.office, 200), b.active === undefined ? u.active : b.active ? 1 : 0, u.id);
  if (b.pin) {
    if (!/^\d{4,8}$/.test(String(b.pin))) throw httpErr(400, 'PIN 4 से 8 अंकों का हो');
    q('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(b.pin), u.id);
    q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  if (b.active === false) q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  if (b.verified !== undefined) q('UPDATE users SET verified = ? WHERE id = ?').run(b.verified ? 1 : 0, u.id);
  audit(user.id, 'user_updated', { id: u.id, changes: { ...b, pin: b.pin ? '(reset)' : undefined } });
  send(res, 200, { ok: true });
});

// works
route('GET', '/api/works', async (req, res, { user }) => {
  const names = userNames();
  const today = istDay();
  send(res, 200, worksFor(user).map((w) => {
    const last = {};
    for (const role of OFFICER_ROLES) {
      const v = w[role + '_id'] && q("SELECT day FROM visits WHERE work_id = ? AND user_id = ? AND in_fence = 1 AND contractor_status != 'disputed' ORDER BY day DESC LIMIT 1").get(w.id, w[role + '_id']);
      last[role] = v ? { day: v.day, days_ago: daysBetween(v.day, today) } : null;
    }
    return {
      ...w,
      contractor: names[w.contractor_id] || '', jen: names[w.jen_id] || '', aen: names[w.aen_id] || '', xen: names[w.xen_id] || '',
      last_visit: last,
      open_requests: q("SELECT COUNT(*) AS n FROM requests WHERE work_id = ? AND status IN ('open','reopened')").get(w.id).n,
      dpr_today: !!q('SELECT 1 FROM dprs WHERE work_id = ? AND day = ?').get(w.id, today),
      claimed_amount: claimedAmount(w.id), boq_total: boqTotal(w.id), items_count: items(w.id).length,
      timeline: (({ hindrances: _h, ...t }) => t)(timeline(w, getSettings())),
      progress_today: !!q('SELECT 1 FROM progress WHERE work_id = ? AND day = ?').get(w.id, today),
      pending_verification: q("SELECT status FROM verifications WHERE work_id = ? AND status IN ('pending_jen','pending_aen') ORDER BY id LIMIT 1").get(w.id)?.status || null,
    };
  }));
});
function workFields(b, old = {}) {
  const f = {
    name: str(b.name ?? old.name, 300), wo_no: str(b.wo_no ?? old.wo_no, 100), office: str(b.office ?? old.office, 200),
    contractor_id: num(b.contractor_id !== undefined ? b.contractor_id : old.contractor_id),
    jen_id: num(b.jen_id !== undefined ? b.jen_id : old.jen_id), aen_id: num(b.aen_id !== undefined ? b.aen_id : old.aen_id), xen_id: num(b.xen_id !== undefined ? b.xen_id : old.xen_id),
    lat: num(b.lat ?? old.lat), lng: num(b.lng ?? old.lng), radius_m: num(b.radius_m ?? old.radius_m) ?? 200,
    start_date: str(b.start_date ?? old.start_date, 10), end_date: str(b.end_date ?? old.end_date, 10), status: b.status ?? old.status ?? 'active',
  };
  if (!f.name) throw httpErr(400, 'काम का नाम ज़रूरी है');
  if (f.lat == null || f.lng == null || Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180) throw httpErr(400, 'साइट का सही GPS (lat, lng) ज़रूरी है');
  if (f.radius_m < 20 || f.radius_m > 5000) throw httpErr(400, 'घेरा (radius) 20 से 5000 मीटर के बीच हो');
  const roleOf = { contractor_id: 'contractor', jen_id: 'jen', aen_id: 'aen', xen_id: 'xen' };
  for (const [k, role] of Object.entries(roleOf)) {
    if (f[k] == null) continue;
    const u = q('SELECT role FROM users WHERE id = ?').get(f[k]);
    if (!u || u.role !== role) throw httpErr(400, `${role.toUpperCase()} के लिए सही व्यक्ति चुनें`);
  }
  return f;
}
route('POST', '/api/works', async (req, res, { user }) => {
  need(user, OVERSIGHT);
  const f = workFields(await readJson(req));
  const r = q(`INSERT INTO works (name, wo_no, office, contractor_id, jen_id, aen_id, xen_id, lat, lng, radius_m, start_date, end_date, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.name, f.wo_no, f.office, f.contractor_id, f.jen_id, f.aen_id, f.xen_id, f.lat, f.lng, f.radius_m, f.start_date, f.end_date, f.status, nowIso());
  audit(user.id, 'work_created', { id: Number(r.lastInsertRowid), ...f });
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('PUT', '/api/works/:id', async (req, res, { user, params }) => {
  need(user, OVERSIGHT);
  const old = q('SELECT * FROM works WHERE id = ?').get(Number(params.id));
  if (!old) throw httpErr(404, 'काम नहीं मिला');
  const body = await readJson(req);
  const f = workFields(body, old);
  for (const k of ['award_date', 'wo_date', 'duration_days', 'tp_percent', 'department']) if (body[k] !== undefined) q(`UPDATE works SET ${k} = ? WHERE id = ?`).run(k === 'duration_days' || k === 'tp_percent' ? num(body[k]) : str(body[k], 200) || null, old.id);
  if (body.wo_amount !== undefined || body.tia !== undefined) q('UPDATE works SET wo_amount = ?, tia = ? WHERE id = ?').run(body.wo_amount !== undefined ? num(body.wo_amount) : old.wo_amount, body.tia !== undefined ? str(body.tia, 200) : old.tia, old.id);
  q(`UPDATE works SET name=?, wo_no=?, office=?, contractor_id=?, jen_id=?, aen_id=?, xen_id=?, lat=?, lng=?, radius_m=?, start_date=?, end_date=?, status=? WHERE id=?`)
    .run(f.name, f.wo_no, f.office, f.contractor_id, f.jen_id, f.aen_id, f.xen_id, f.lat, f.lng, f.radius_m, f.start_date, f.end_date, f.status, old.id);
  // the old fence is kept in the audit log so a moved fence can always be seen
  audit(user.id, 'work_updated', { id: old.id, before: old, after: f });
  send(res, 200, { ok: true });
});

// visits (हाज़िरी)
route('POST', '/api/visits', async (req, res, { user }) => {
  need(user, OFFICER_ROLES);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  if (w[user.role + '_id'] !== user.id) throw httpErr(403, 'आप इस काम पर नियुक्त नहीं हैं');
  if (w.status !== 'active') throw httpErr(400, 'यह काम बंद है');
  const lat = num(b.lat), lng = num(b.lng), acc = num(b.accuracy);
  if (lat == null || lng == null) throw httpErr(400, 'GPS लोकेशन नहीं मिली। फ़ोन की लोकेशन चालू करें');
  const s = getSettings();
  const flags = [];
  const photo = savePhoto(b.photo);
  if (!photo) flags.push('no_photo');
  else if (q('SELECT 1 FROM visits WHERE photo = ? LIMIT 1').get(photo)) flags.push('photo_reused');
  if (acc == null || acc > s.max_gps_accuracy_m) flags.push('low_accuracy');
  if (b.client_ts && Math.abs(new Date(b.client_ts) - Date.now()) > 10 * 60e3) flags.push('clock_mismatch');
  if (b.from_gallery) flags.push('from_gallery');
  const distance = haversine(lat, lng, w.lat, w.lng);
  const inFence = distance <= w.radius_m ? 1 : 0;
  if (!inFence) flags.push('outside_fence');
  const r = q(`INSERT INTO visits (work_id, user_id, role, day, server_ts, client_ts, lat, lng, accuracy, distance_m, in_fence, photo, note, flags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(w.id, user.id, user.role, istDay(), nowIso(), str(b.client_ts, 40), lat, lng, acc, Math.round(distance), inFence, photo, str(b.note, 1000), flags.join(','));
  const id = Number(r.lastInsertRowid);
  send(res, 201, { id, distance_m: Math.round(distance), in_fence: !!inFence, flags, counts: visitCounts(q('SELECT * FROM visits WHERE id = ?').get(id), s) });
});
route('POST', '/api/visits/:id/checkout', async (req, res, { user, params }) => {
  const v = q('SELECT * FROM visits WHERE id = ?').get(Number(params.id));
  if (!v || v.user_id !== user.id) throw httpErr(404, 'हाज़िरी नहीं मिली');
  if (v.out_ts) throw httpErr(400, 'वापसी पहले ही दर्ज है');
  if (v.day !== istDay()) throw httpErr(400, 'वापसी उसी दिन दर्ज होती है');
  const b = await readJson(req);
  const lat = num(b.lat), lng = num(b.lng);
  if (lat == null || lng == null) throw httpErr(400, 'GPS लोकेशन नहीं मिली');
  const w = q('SELECT * FROM works WHERE id = ?').get(v.work_id);
  const d = Math.round(haversine(lat, lng, w.lat, w.lng));
  q('UPDATE visits SET out_ts = ?, out_lat = ?, out_lng = ?, out_distance_m = ? WHERE id = ?').run(nowIso(), lat, lng, d, v.id);
  send(res, 200, { out_distance_m: d, minutes: Math.round((Date.now() - new Date(v.server_ts)) / 60000) });
});
route('GET', '/api/visits', async (req, res, { user, query }) => {
  const s = getSettings();
  const names = userNames();
  const ids = query.work_id ? [workOr404(user, query.work_id).id] : worksFor(user).map((w) => w.id);
  if (!ids.length) return send(res, 200, []);
  const from = query.from || addDays(istDay(), -30), to = query.to || istDay();
  const rows = q(`SELECT v.*, w.name AS work FROM visits v JOIN works w ON w.id = v.work_id
    WHERE v.work_id IN (${ids.map(() => '?').join(',')}) AND v.day BETWEEN ? AND ? ORDER BY v.server_ts DESC LIMIT 1000`).all(...ids, from, to);
  const out = rows.map((v) => ({ ...v, officer: names[v.user_id], counts: visitCounts(v, s) }));
  if (query.format === 'csv') {
    return send(res, 200, csv(out, ['id', 'day', 'server_ts', 'work', 'officer', 'role', 'lat', 'lng', 'accuracy', 'distance_m', 'in_fence', 'flags', 'out_ts', 'out_distance_m', 'contractor_status', 'contractor_note', 'counts', 'note']),
      { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="visits.csv"' });
  }
  send(res, 200, out);
});
route('POST', '/api/visits/:id/respond', async (req, res, { user, params }) => {
  need(user, ['contractor']);
  const v = q('SELECT * FROM visits WHERE id = ?').get(Number(params.id));
  const w = v && q('SELECT * FROM works WHERE id = ?').get(v.work_id);
  if (!w || w.contractor_id !== user.id) throw httpErr(404, 'हाज़िरी नहीं मिली');
  if (v.contractor_status !== 'pending') throw httpErr(400, 'इस पर जवाब पहले दिया जा चुका है');
  const b = await readJson(req);
  if (!['confirmed', 'disputed'].includes(b.status)) throw httpErr(400, 'गलत जवाब');
  if (b.status === 'disputed' && !str(b.note)) throw httpErr(400, 'आपत्ति का कारण लिखें');
  q('UPDATE visits SET contractor_status = ?, contractor_note = ?, contractor_ts = ? WHERE id = ?').run(b.status, str(b.note, 1000), nowIso(), v.id);
  audit(user.id, 'visit_' + b.status, { visit: v.id });
  send(res, 200, { ok: true });
});

// DPR (daily progress report by the JEN)
route('POST', '/api/dprs', async (req, res, { user }) => {
  need(user, ['jen']);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  if (w.jen_id !== user.id) throw httpErr(403, 'आप इस काम के JEN नहीं हैं');
  const day = istDay(); // a DPR is always for today: no back-dating
  if (q('SELECT 1 FROM dprs WHERE work_id = ? AND day = ?').get(w.id, day)) throw httpErr(409, 'आज की DPR पहले ही जमा है');
  if (!str(b.work_done)) throw httpErr(400, 'आज क्या काम हुआ, यह लिखें');
  const lat = num(b.lat), lng = num(b.lng);
  const d = lat != null && lng != null ? Math.round(haversine(lat, lng, w.lat, w.lng)) : null;
  const r = q(`INSERT INTO dprs (work_id, user_id, day, server_ts, work_done, labour, materials, machinery, hindrance, instructions, photo, lat, lng, accuracy, distance_m, in_fence)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(w.id, user.id, day, nowIso(), str(b.work_done), str(b.labour), str(b.materials), str(b.machinery), str(b.hindrance), str(b.instructions),
    savePhoto(b.photo), lat, lng, num(b.accuracy), d, d == null ? null : d <= w.radius_m ? 1 : 0);
  send(res, 201, { id: Number(r.lastInsertRowid), distance_m: d });
});
route('GET', '/api/dprs', async (req, res, { user, query }) => {
  const names = userNames();
  const ids = query.work_id ? [workOr404(user, query.work_id).id] : worksFor(user).map((w) => w.id);
  if (!ids.length) return send(res, 200, []);
  const rows = q(`SELECT d.*, w.name AS work FROM dprs d JOIN works w ON w.id = d.work_id WHERE d.work_id IN (${ids.map(() => '?').join(',')}) AND d.day BETWEEN ? AND ? ORDER BY d.day DESC, d.id DESC LIMIT 500`)
    .all(...ids, query.from || addDays(istDay(), -60), query.to || istDay());
  const out = rows.map((r) => ({ ...r, jen: names[r.user_id] }));
  if (query.format === 'csv') {
    return send(res, 200, csv(out, ['day', 'work', 'jen', 'server_ts', 'work_done', 'labour', 'materials', 'machinery', 'hindrance', 'instructions', 'distance_m', 'in_fence', 'contractor_status', 'contractor_note']),
      { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="dpr.csv"' });
  }
  send(res, 200, out);
});
route('POST', '/api/dprs/:id/respond', async (req, res, { user, params }) => {
  need(user, ['contractor']);
  const d = q('SELECT * FROM dprs WHERE id = ?').get(Number(params.id));
  const w = d && q('SELECT * FROM works WHERE id = ?').get(d.work_id);
  if (!w || w.contractor_id !== user.id) throw httpErr(404, 'DPR नहीं मिली');
  if (d.contractor_status !== 'pending') throw httpErr(400, 'इस पर जवाब पहले दिया जा चुका है');
  const b = await readJson(req);
  if (!['agreed', 'disagreed'].includes(b.status)) throw httpErr(400, 'गलत जवाब');
  if (b.status === 'disagreed' && !str(b.note)) throw httpErr(400, 'असहमति का कारण लिखें');
  q('UPDATE dprs SET contractor_status = ?, contractor_note = ?, contractor_ts = ? WHERE id = ?').run(b.status, str(b.note, 2000), nowIso(), d.id);
  send(res, 200, { ok: true });
});

// requests: measurement (नाप), bill, inspection, decision… with a deadline and a full history
route('POST', '/api/requests', async (req, res, { user }) => {
  need(user, ['contractor']);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  if (!REQUEST_TYPES.includes(b.type)) throw httpErr(400, 'गलत प्रकार');
  if (!str(b.title)) throw httpErr(400, 'विषय लिखें');
  const s = getSettings();
  const sla = s.sla_days[b.type] || 7;
  const created = nowIso();
  const r = q(`INSERT INTO requests (work_id, raised_by, type, title, details, amount, sla_days, created_ts, due_day, status, stage)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(w.id, user.id, b.type, str(b.title, 300), str(b.details), num(b.amount), sla, created, addDays(istDay(), sla), 'open', b.type === 'bill' ? 'submitted' : '');
  const id = Number(r.lastInsertRowid);
  q('INSERT INTO request_events (request_id, user_id, ts, action, note, photo) VALUES (?,?,?,?,?,?)').run(id, user.id, created, 'raised', str(b.details), savePhoto(b.photo));
  send(res, 201, { id });
});
function visibleRequests(user, query) {
  const ids = query.work_id ? [workOr404(user, query.work_id).id] : worksFor(user).map((w) => w.id);
  if (!ids.length) return [];
  const s = getSettings();
  const names = userNames();
  return q(`SELECT r.*, w.name AS work FROM requests r JOIN works w ON w.id = r.work_id WHERE r.work_id IN (${ids.map(() => '?').join(',')}) ORDER BY r.created_ts DESC LIMIT 1000`)
    .all(...ids).map((r) => ({ ...decorateRequest(r, s), raised_by_name: names[r.raised_by] }));
}
route('GET', '/api/requests', async (req, res, { user, query }) => {
  let rows = visibleRequests(user, query);
  if (query.status === 'open') rows = rows.filter((r) => r.status === 'open' || r.status === 'reopened');
  if (query.format === 'csv') {
    return send(res, 200, csv(rows, ['id', 'work', 'type', 'title', 'amount', 'raised_by_name', 'created_ts', 'due_day', 'status', 'stage', 'overdue_days', 'done_ts', 'closed_ts']),
      { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="requests.csv"' });
  }
  send(res, 200, rows);
});
route('GET', '/api/requests/:id', async (req, res, { user, params }) => {
  const r = q('SELECT * FROM requests WHERE id = ?').get(Number(params.id));
  if (!r) throw httpErr(404, 'नहीं मिला');
  const w = workOr404(user, r.work_id);
  const names = userNames();
  const events = q('SELECT * FROM request_events WHERE request_id = ? ORDER BY ts').all(r.id).map((e) => ({ ...e, by: names[e.user_id] }));
  send(res, 200, { ...decorateRequest(r, getSettings()), work: w.name, events });
});
route('POST', '/api/requests/:id/action', async (req, res, { user, params }) => {
  const r = q('SELECT * FROM requests WHERE id = ?').get(Number(params.id));
  if (!r) throw httpErr(404, 'नहीं मिला');
  const w = workOr404(user, r.work_id);
  const b = await readJson(req);
  const note = str(b.note);
  const isOfficer = [...OFFICER_ROLES, ...OVERSIGHT].includes(user.role);
  const isOwner = user.role === 'contractor' && w.contractor_id === user.id;
  const open = r.status === 'open' || r.status === 'reopened';
  const ts = nowIso();
  switch (b.action) {
    case 'comment':
      if (!note) throw httpErr(400, 'टिप्पणी लिखें');
      break;
    case 'stage': {
      if (!isOfficer || r.type !== 'bill' || !open) throw httpErr(400, 'यह कदम अभी संभव नहीं');
      const i = BILL_STAGES.indexOf(b.stage);
      if (i <= BILL_STAGES.indexOf(r.stage)) throw httpErr(400, 'बिल का अगला चरण चुनें');
      q('UPDATE requests SET stage = ? WHERE id = ?').run(b.stage, r.id);
      if (b.stage === 'paid') q("UPDATE requests SET status = 'done', done_ts = ? WHERE id = ?").run(ts, r.id);
      break;
    }
    case 'done':
      if (!isOfficer || !open) throw httpErr(400, 'यह कदम अभी संभव नहीं');
      if (!note) throw httpErr(400, 'क्या किया गया, लिखें (जैसे MB नं. और पेज)');
      q("UPDATE requests SET status = 'done', done_ts = ? WHERE id = ?").run(ts, r.id);
      break;
    case 'close':
      if (!isOwner || r.status !== 'done') throw httpErr(400, 'पहले विभाग "पूरा" दर्ज करे');
      q("UPDATE requests SET status = 'closed', closed_ts = ? WHERE id = ?").run(ts, r.id);
      break;
    case 'reopen':
      if (!isOwner || r.status !== 'done') throw httpErr(400, 'यह कदम अभी संभव नहीं');
      if (!note) throw httpErr(400, 'दोबारा खोलने का कारण लिखें');
      // reopening keeps the original deadline: the clock is not reset
      q("UPDATE requests SET status = 'reopened', done_ts = NULL WHERE id = ?").run(r.id);
      break;
    default:
      throw httpErr(400, 'गलत कार्रवाई');
  }
  q('INSERT INTO request_events (request_id, user_id, ts, action, note, photo) VALUES (?,?,?,?,?,?)')
    .run(r.id, user.id, ts, b.action === 'stage' ? 'stage:' + b.stage : b.action, note, savePhoto(b.photo));
  send(res, 200, { ok: true });
});

// complaints go only to the SE / admin, never to the officers of the work
route('POST', '/api/complaints', async (req, res, { user }) => {
  need(user, ['contractor']);
  const b = await readJson(req);
  if (b.work_id) workOr404(user, b.work_id);
  if (!str(b.text)) throw httpErr(400, 'शिकायत लिखें');
  const r = q('INSERT INTO complaints (raised_by, work_id, against_user_id, text, ts) VALUES (?,?,?,?,?)')
    .run(user.id, num(b.work_id), num(b.against_user_id), str(b.text, 5000), nowIso());
  send(res, 201, { id: Number(r.lastInsertRowid) });
});
route('GET', '/api/complaints', async (req, res, { user }) => {
  const names = userNames();
  let rows;
  if (OVERSIGHT.includes(user.role)) rows = q('SELECT * FROM complaints ORDER BY ts DESC').all();
  else if (user.role === 'contractor') rows = q('SELECT * FROM complaints WHERE raised_by = ? ORDER BY ts DESC').all(user.id);
  else throw httpErr(403, 'अनुमति नहीं');
  send(res, 200, rows.map((c) => ({ ...c, raised_by_name: names[c.raised_by], against: names[c.against_user_id] || '', responder: names[c.responded_by] || '',
    work: c.work_id ? q('SELECT name FROM works WHERE id = ?').get(c.work_id)?.name : '' })));
});
route('POST', '/api/complaints/:id/respond', async (req, res, { user, params }) => {
  need(user, OVERSIGHT);
  const b = await readJson(req);
  if (!str(b.response)) throw httpErr(400, 'जवाब लिखें');
  q('UPDATE complaints SET response = ?, status = ?, responded_by = ?, responded_ts = ? WHERE id = ?')
    .run(str(b.response, 5000), b.status === 'closed' ? 'closed' : 'in_progress', user.id, nowIso(), Number(params.id));
  send(res, 200, { ok: true });
});

// dashboard
route('GET', '/api/dashboard', async (req, res, { user, query }) => {
  const s = getSettings();
  const week = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(query.week || '') ? query.week : istDay());
  const works = worksFor(user);
  const comp = compliance(works, week, s);
  const reqs = visibleRequests(user, {});
  const open = reqs.filter((r) => r.status === 'open' || r.status === 'reopened');
  const pendingConfirm = user.role === 'contractor'
    ? q(`SELECT COUNT(*) AS n FROM visits v JOIN works w ON w.id = v.work_id WHERE w.contractor_id = ? AND v.contractor_status = 'pending'`).get(user.id).n : 0;
  const out = {
    week, week_end: addDays(week, 6), today: istDay(), compliance: comp,
    missing_dprs: missingDprs(works, week),
    requests: { open: open.length, overdue: open.filter((r) => r.overdue_days > 0), done_awaiting_close: reqs.filter((r) => r.status === 'done').length },
    pending_visit_confirmations: pendingConfirm,
    red_flags: redFlags(works, s),
    pending_verifications: q(`SELECT COUNT(*) AS n FROM verifications WHERE status IN ('pending_jen','pending_aen') AND work_id IN (${works.map((w) => w.id).join(',') || 0})`).get().n,
    open_complaints: OVERSIGHT.includes(user.role) ? q("SELECT COUNT(*) AS n FROM complaints WHERE status != 'closed'").get().n : null,
  };
  if (query.format === 'csv') {
    return send(res, 200, csv(comp, ['work', 'role', 'officer', 'required', 'done', 'recorded', 'outside_fence', 'disputed', 'last_visit', 'days_since', 'status']),
      { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="attendance-${week}.csv"` });
  }
  send(res, 200, out);
});

// ---- OTP: self sign-up and first login for officers that a project named ----
route('POST', '/api/otp/send', async (req, res) => {
  const { mobile } = await readJson(req);
  if (!/^\d{10}$/.test(String(mobile))) throw httpErr(400, '10 अंकों का मोबाइल नंबर लिखें');
  const prev = q('SELECT sent_at FROM otps WHERE mobile = ?').get(String(mobile));
  if (prev && Date.now() - prev.sent_at < 60e3) throw httpErr(429, '1 मिनट बाद दोबारा OTP माँगें');
  const code = String(crypto.randomInt(100000, 999999));
  q('INSERT INTO otps (mobile, code_hash, expires, tries, sent_at) VALUES (?,?,?,0,?) ON CONFLICT(mobile) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, tries = 0, sent_at = excluded.sent_at')
    .run(String(mobile), hashPin(code), Date.now() + 10 * 60e3, Date.now());
  sendSms(String(mobile), `SiteSaakshi OTP: ${code} (10 मिनट तक मान्य)`);
  const u = q('SELECT name, role FROM users WHERE mobile = ?').get(String(mobile));
  // without an SMS gateway (demo / testing) the code is shown on screen
  send(res, 200, { existing: u ? { name: u.name, role: u.role } : null, dev_otp: !process.env.SMS_WEBHOOK_URL && (DEMO || process.env.DEV_SHOW_OTP) ? code : undefined });
}, { public: true });
route('POST', '/api/otp/verify', async (req, res) => {
  const b = await readJson(req);
  const mobile = String(b.mobile);
  const o = q('SELECT * FROM otps WHERE mobile = ?').get(mobile);
  if (!o || o.expires < Date.now() || o.tries >= 5) throw httpErr(400, 'OTP की समय-सीमा ख़त्म, नया OTP माँगें');
  if (!checkPin(String(b.code), o.code_hash)) { q('UPDATE otps SET tries = tries + 1 WHERE mobile = ?').run(mobile); throw httpErr(400, 'OTP गलत है'); }
  if (!/^\d{4,8}$/.test(String(b.pin))) throw httpErr(400, 'नया PIN 4 से 8 अंकों का हो');
  let u = q('SELECT * FROM users WHERE mobile = ?').get(mobile);
  if (!u) {
    if (!SELF_SIGNUP_ROLES.includes(b.role)) throw httpErr(400, 'अपनी भूमिका चुनें');
    if (!str(b.name)) throw httpErr(400, 'अपना नाम लिखें');
    const id = createUser({ name: str(b.name, 120), mobile, role: b.role, office: str(b.office, 200), pin: b.pin, verified: 0 });
    q('UPDATE users SET department = ?, reg_no = ?, gstin = ? WHERE id = ?').run(str(b.department, 200), str(b.reg_no, 60), str(b.gstin, 20).toUpperCase(), id);
    audit(id, 'self_signup', { role: b.role });
    u = q('SELECT * FROM users WHERE id = ?').get(id);
  } else {
    if (!u.active) throw httpErr(403, 'यह खाता बंद है');
    q('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(b.pin), u.id);
    if (str(b.name) && !u.verified) q('UPDATE users SET name = ? WHERE id = ?').run(str(b.name, 120), u.id);
    if (str(b.office)) q('UPDATE users SET office = ? WHERE id = ?').run(str(b.office, 200), u.id);
    audit(u.id, u.pin_hash ? 'pin_reset_otp' : 'first_login', {});
  }
  q('DELETE FROM otps WHERE mobile = ?').run(mobile);
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, u.id, nowIso());
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  send(res, 200, { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(u.id)) }, { 'Set-Cookie': `ss_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
}, { public: true });

// ---- a project created by the contractor or an officer; the other people are assigned on the spot ----
function findOrCreatePerson(p, role, creator) {
  if (!p || !p.mobile) return null;
  const mobile = String(p.mobile).trim();
  if (!/^\d{10}$/.test(mobile)) throw httpErr(400, `${role.toUpperCase()} का 10 अंकों का मोबाइल नंबर लिखें`);
  const u = q('SELECT * FROM users WHERE mobile = ?').get(mobile);
  if (u) {
    if (u.role !== role) throw httpErr(400, `${mobile} पहले से ${u.role.toUpperCase()} के रूप में दर्ज है, ${role.toUpperCase()} नहीं`);
    return { id: u.id, created: false };
  }
  if (!str(p.name)) throw httpErr(400, `${role.toUpperCase()} का नाम लिखें`);
  const id = createUser({ name: str(p.name, 120), mobile, role, office: str(p.office, 200), pin: null, verified: 0 });
  audit(creator.id, 'user_created_by_project', { id, role, mobile });
  return { id, created: true };
}
function parseItems(list) {
  const out = [];
  for (const it of list || []) {
    const description = str(it.description, 1000), qty = num(it.qty), rate = num(it.rate);
    if (!description && qty == null && rate == null) continue;
    if (!description || qty == null || qty <= 0 || rate == null || rate < 0) throw httpErr(400, `BOQ आइटम "${description || '?'}": विवरण, मात्रा और दर सही भरें`);
    out.push({ code: str(it.code, 30), description, unit: str(it.unit, 20), qty, rate });
  }
  return out;
}
route('POST', '/api/projects', async (req, res, { user }) => {
  need(user, [...SELF_SIGNUP_ROLES, ...OVERSIGHT]);
  const b = await readJson(req);
  const list = parseItems(b.items);
  if (!list.length) throw httpErr(400, 'कम से कम एक BOQ आइटम (काम, मात्रा, दर) डालें');
  const woAmount = num(b.wo_amount);
  if (woAmount != null && woAmount <= 0) throw httpErr(400, 'वर्क ऑर्डर राशि सही लिखें');
  const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : null);
  const awardDate = day(b.award_date), woDate = day(b.wo_date);
  if (!awardDate && !woDate) throw httpErr(400, 'अवार्ड (LoA) की तारीख़ या वर्क ऑर्डर की तारीख़ लिखें');
  if ((awardDate && awardDate > istDay()) || (woDate && woDate > istDay())) throw httpErr(400, 'भविष्य की तारीख़ नहीं');
  if (woDate && !str(b.wo_no)) throw httpErr(400, 'वर्क ऑर्डर नंबर लिखें');
  const duration = num(b.duration_days);
  if (duration != null && (duration < 1 || duration > 3650)) throw httpErr(400, 'कार्य अवधि (दिन) सही लिखें');
  const people = { contractor: null, jen: null, aen: null, xen: null };
  const created = [];
  db.exec('BEGIN');
  try {
    for (const role of Object.keys(people)) {
      if (user.role === role) { people[role] = user.id; continue; }
      const r = findOrCreatePerson(b[role], role, user);
      if (r) { people[role] = r.id; if (r.created) created.push({ role, mobile: b[role].mobile, name: b[role].name }); }
    }
    if (!people.contractor) throw httpErr(400, 'ठेकेदार का नाम और मोबाइल ज़रूरी है');
    if (!people.jen || !people.aen) throw httpErr(400, 'JEN और AEN दोनों का नाम और मोबाइल ज़रूरी है: हर 10% पर उनका नाप और अनुमोदन अनिवार्य है');
    const f = workFields({ ...b, contractor_id: people.contractor, jen_id: people.jen, aen_id: people.aen, xen_id: people.xen, status: 'active' });
    const id = Number(q(`INSERT INTO works (name, wo_no, office, contractor_id, jen_id, aen_id, xen_id, lat, lng, radius_m, start_date, end_date, status, created_at, wo_amount, tia, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.name, f.wo_no, f.office, f.contractor_id, f.jen_id, f.aen_id, f.xen_id, f.lat, f.lng, f.radius_m, f.start_date, f.end_date, 'active', nowIso(), woAmount, str(b.tia, 200), user.id).lastInsertRowid);
    q('UPDATE works SET award_date = ?, wo_date = ?, duration_days = ?, tp_percent = ?, department = ? WHERE id = ?').run(awardDate, woDate, duration, num(b.tp_percent) || 0, str(b.department, 200), id);
    for (const it of list) q('INSERT INTO work_items (work_id, code, description, unit, qty, rate) VALUES (?,?,?,?,?,?)').run(id, it.code, it.description, it.unit, it.qty, it.rate);
    audit(user.id, 'project_created', { id, ...f, wo_amount: woAmount, items: list.length });
    db.exec('COMMIT');
    for (const role of ['contractor', 'jen', 'aen', 'xen']) {
      const u = people[role] && people[role] !== user.id && q('SELECT mobile FROM users WHERE id = ?').get(people[role]);
      if (u) sendSms(u.mobile, `SiteSaakshi: आपको "${f.name}" (${f.wo_no}) पर ${role.toUpperCase()} के रूप में जोड़ा गया है। ऐप खोलें और "OTP से लॉगिन" करें।`);
    }
    send(res, 201, { id, new_accounts: created });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});
route('GET', '/api/works/:id', async (req, res, { user, params }) => {
  const w = workOr404(user, params.id);
  const s = getSettings();
  const names = userNames();
  const c = claimedQty(w.id);
  const lastMeasured = q("SELECT id FROM verifications WHERE work_id = ? AND measured_amount IS NOT NULL ORDER BY id DESC LIMIT 1").get(w.id);
  const measured = {};
  if (lastMeasured) for (const l of q('SELECT item_id, measured_qty FROM verification_lines WHERE verification_id = ?').all(lastMeasured.id)) measured[l.item_id] = l.measured_qty;
  const its = items(w.id).map((i) => ({ ...i, amount: i.qty * i.rate, claimed_qty: c[i.id] || 0, measured_qty: measured[i.id] ?? null }));
  const claimed = its.reduce((t, i) => t + i.claimed_qty * i.rate, 0);
  const approved = q("SELECT measured_amount FROM verifications WHERE work_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1").get(w.id);
  send(res, 200, {
    ...w, contractor: names[w.contractor_id] || '', jen: names[w.jen_id] || '', aen: names[w.aen_id] || '', xen: names[w.xen_id] || '',
    items: its, boq_total: its.reduce((t, i) => t + i.amount, 0), claimed_amount: claimed,
    approved_amount: approved ? approved.measured_amount : 0, milestone_step: milestoneStep(w, s),
    verifications: q('SELECT * FROM verifications WHERE work_id = ? ORDER BY id DESC').all(w.id).map((v) => decorateVerification(v, s)),
    flags: redFlags([w], s),
    timeline: timeline(w, s),
    bills: q('SELECT * FROM bills WHERE work_id = ? ORDER BY bill_no').all(w.id),
    can_bill: (() => { const la = latestApproved(w.id); const pb = q('SELECT verification_id, is_final FROM bills WHERE work_id = ? ORDER BY bill_no DESC LIMIT 1').get(w.id);
      return { running: !!la && !pb?.is_final && pb?.verification_id !== la.v.id, final: !!la && !pb?.is_final && !!w.completed_ts && la.v.kind === 'final' }; })(),
  });
});
route('POST', '/api/works/:id/dispute', async (req, res, { user, params }) => {
  const w = workOr404(user, params.id);
  const b = await readJson(req);
  if (!str(b.note)) throw httpErr(400, 'कारण लिखें');
  q('INSERT INTO work_flags (work_id, user_id, ts, kind, note) VALUES (?,?,?,?,?)').run(w.id, user.id, nowIso(), 'assignment_disputed', str(b.note, 2000));
  send(res, 201, { ok: true });
});
route('POST', '/api/work-flags/:id/resolve', async (req, res, { user, params }) => {
  need(user, OVERSIGHT);
  const b = await readJson(req);
  q("UPDATE work_flags SET status = 'resolved' WHERE id = ?").run(Number(params.id));
  audit(user.id, 'work_flag_resolved', { id: Number(params.id), note: str(b.note) });
  send(res, 200, { ok: true });
});

// ---- contractor's daily work update: quantities + geotagged photos ----
route('POST', '/api/progress', async (req, res, { user }) => {
  need(user, ['contractor']);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  if (w.contractor_id !== user.id) throw httpErr(403, 'यह आपका काम नहीं है');
  if (w.status !== 'active') throw httpErr(400, 'यह काम बंद है');
  const its = Object.fromEntries(items(w.id).map((i) => [i.id, i]));
  const lines = (b.lines || []).map((l) => ({ item_id: Number(l.item_id), qty: num(l.qty) })).filter((l) => l.qty);
  if (!lines.length) throw httpErr(400, 'आज किए काम की मात्रा भरें');
  for (const l of lines) { if (!its[l.item_id]) throw httpErr(400, 'गलत BOQ आइटम'); if (l.qty < 0) throw httpErr(400, 'मात्रा शून्य से कम नहीं हो सकती'); }
  const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 6).map(savePhoto).filter(Boolean);
  if (!photos.length) throw httpErr(400, 'काम की कम से कम एक फ़ोटो (साइट पर ली गई) ज़रूरी है');
  const lat = num(b.lat), lng = num(b.lng);
  if (lat == null || lng == null) throw httpErr(400, 'GPS लोकेशन नहीं मिली। फ़ोन की लोकेशन चालू करें');
  const d = Math.round(haversine(lat, lng, w.lat, w.lng));
  const s = getSettings();
  const flags = [];
  if (d > w.radius_m) flags.push('outside_fence');
  if ((num(b.accuracy) ?? 999) > s.max_gps_accuracy_m) flags.push('low_accuracy');
  if (b.from_gallery) flags.push('from_gallery');
  for (const p of photos) if (q("SELECT 1 FROM progress WHERE photos LIKE ? LIMIT 1").get('%' + p + '%')) { flags.push('photo_reused'); break; }
  const before = claimedAmount(w.id);
  const c = claimedQty(w.id);
  for (const l of lines) if ((c[l.item_id] || 0) + l.qty > its[l.item_id].qty * 1.0001) { flags.push('exceeds_boq'); break; }
  const amount = lines.reduce((t, l) => t + l.qty * its[l.item_id].rate, 0);
  db.exec('BEGIN');
  try {
    const pid = Number(q(`INSERT INTO progress (work_id, user_id, day, server_ts, lat, lng, accuracy, distance_m, in_fence, note, photos, amount, flags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(w.id, user.id, istDay(), nowIso(), lat, lng, num(b.accuracy), d, d <= w.radius_m ? 1 : 0, str(b.note, 2000), JSON.stringify(photos), amount, flags.join(',')).lastInsertRowid);
    for (const l of lines) q('INSERT INTO progress_lines (progress_id, item_id, qty) VALUES (?,?,?)').run(pid, l.item_id, l.qty);
    const after = before + amount;
    const vid = maybeCreateVerification(w, before, after, s);
    db.exec('COMMIT');
    send(res, 201, { id: pid, amount, claimed_total: after, flags, verification_id: vid, jen_due_hours: vid ? s.jen_verify_hours : undefined });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});
route('GET', '/api/progress', async (req, res, { user, query }) => {
  const names = userNames();
  const ids = query.work_id ? [workOr404(user, query.work_id).id] : worksFor(user).map((w) => w.id);
  if (!ids.length) return send(res, 200, []);
  const rows = q(`SELECT p.*, w.name AS work FROM progress p JOIN works w ON w.id = p.work_id WHERE p.work_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.server_ts DESC LIMIT 300`).all(...ids);
  send(res, 200, rows.map((p) => ({ ...p, photos: JSON.parse(p.photos), by: names[p.user_id],
    lines: q('SELECT pl.qty, i.description, i.unit, i.rate, i.code FROM progress_lines pl JOIN work_items i ON i.id = pl.item_id WHERE pl.progress_id = ?').all(p.id) })));
});

// ---- milestone verification: JEN measures at site, AEN approves, contractor agrees or objects ----
route('GET', '/api/verifications', async (req, res, { user, query }) => {
  const s = getSettings();
  const names = userNames();
  const ids = query.work_id ? [workOr404(user, query.work_id).id] : worksFor(user).map((w) => w.id);
  if (!ids.length) return send(res, 200, []);
  const rows = q(`SELECT v.*, w.name AS work, w.jen_id AS w_jen, w.aen_id AS w_aen FROM verifications v JOIN works w ON w.id = v.work_id WHERE v.work_id IN (${ids.map(() => '?').join(',')}) ORDER BY v.id DESC LIMIT 300`).all(...ids);
  send(res, 200, rows.map((v) => ({ ...decorateVerification(v, s), jen_name: names[v.jen_id || v.w_jen], aen_name: names[v.aen_id || v.w_aen], percent: v.milestone_no * s.milestone_percent })));
});
const verOr404 = (user, id) => {
  const v = q('SELECT * FROM verifications WHERE id = ?').get(Number(id));
  if (!v) throw httpErr(404, 'सत्यापन नहीं मिला');
  return { v, w: workOr404(user, v.work_id) };
};
route('POST', '/api/verifications/:id/measure', async (req, res, { user, params }) => {
  need(user, OFFICER_ROLES);
  const { v, w } = verOr404(user, params.id);
  if (v.status !== 'pending_jen') throw httpErr(400, 'यह नाप पहले ही दर्ज है');
  const s = getSettings();
  if (!measurerAllowed(user, w, v, s)) throw httpErr(403, user.role === 'jen' ? 'आप इस काम के JEN नहीं हैं' : `JEN की समय-सीमा के ${user.role === 'aen' ? s.escalate_measure_aen_hours : s.escalate_measure_xen_hours} घंटे बाद ही ${user.role.toUpperCase()} नाप ले सकता है`);
  const b = await readJson(req);
  const lat = num(b.lat), lng = num(b.lng), acc = num(b.accuracy);
  if (lat == null || lng == null) throw httpErr(400, 'GPS लोकेशन नहीं मिली');
  const d = Math.round(haversine(lat, lng, w.lat, w.lng));
  // the measurement has to be taken at the site, at the time: not from the office
  if (d > w.radius_m) throw httpErr(400, `आप साइट से ${d} मी. दूर हैं। नाप साइट पर (${w.radius_m} मी. के अंदर) ही दर्ज होगा`);
  if (acc == null || acc > s.max_gps_accuracy_m) throw httpErr(400, `GPS कमज़ोर है (±${acc ?? '?'} मी.)। खुले में जाकर दोबारा कोशिश करें`);
  const photo = savePhoto(b.photo);
  if (!photo) throw httpErr(400, 'नाप के समय की लाइव फ़ोटो ज़रूरी है');
  const its = Object.fromEntries(items(w.id).map((i) => [i.id, i]));
  const measured = {};
  for (const l of b.lines || []) { const qn = num(l.measured_qty); if (its[Number(l.item_id)] && qn != null && qn >= 0) measured[Number(l.item_id)] = qn; }
  const existing = Object.fromEntries(q('SELECT item_id, id FROM verification_lines WHERE verification_id = ?').all(v.id).map((l) => [l.item_id, l.id]));
  for (const id of Object.keys(existing)) if (measured[id] == null) throw httpErr(400, `"${its[id].description.slice(0, 40)}" का नाप भरें`);
  const now = nowIso();
  db.exec('BEGIN');
  try {
    for (const [itemId, qty] of Object.entries(measured)) {
      if (existing[itemId]) q('UPDATE verification_lines SET measured_qty = ? WHERE id = ?').run(qty, existing[itemId]);
      else q('INSERT INTO verification_lines (verification_id, item_id, claimed_qty, measured_qty) VALUES (?,?,0,?)').run(v.id, Number(itemId), qty);
    }
    const amt = Object.entries(measured).reduce((t, [id, qn]) => t + qn * its[id].rate, 0);
    const late = Math.max(0, hoursBetween(v.jen_due_ts, now));
    q(`UPDATE verifications SET status = 'pending_aen', jen_id = ?, jen_ts = ?, jen_lat = ?, jen_lng = ?, jen_accuracy = ?, jen_distance_m = ?, jen_photo = ?, jen_note = ?,
      measured_amount = ?, jen_late_hours = ?, aen_due_ts = ?, contractor_status = 'pending', contractor_note = '', contractor_ts = NULL WHERE id = ?`)
      .run(user.id, now, lat, lng, acc, d, photo, str(b.note, 2000), Math.round(amt), Math.round(late * 10) / 10, addHours(now, s.aen_approve_hours), v.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const aen = w.aen_id && q('SELECT mobile FROM users WHERE id = ?').get(w.aen_id);
  if (aen) sendSms(aen.mobile, `SiteSaakshi: "${w.name}" पर JEN ने नाप दर्ज किया। ${s.aen_approve_hours} घंटे में अनुमोदन करें।`);
  send(res, 200, decorateVerification(q('SELECT * FROM verifications WHERE id = ?').get(v.id), s));
});
route('POST', '/api/verifications/:id/approve', async (req, res, { user, params }) => {
  need(user, ['aen', 'xen']);
  const { v, w } = verOr404(user, params.id);
  if (v.status !== 'pending_aen') throw httpErr(400, 'अभी अनुमोदन के लिए नहीं है');
  if (!approverAllowed(user, w, v, getSettings())) throw httpErr(403, user.role === 'aen' ? 'आप इस नाप का अनुमोदन नहीं कर सकते (अपना नाप ख़ुद अनुमोदित नहीं होता)' : 'XEN अनुमोदन तब करता है जब नाप AEN ने लिया हो या AEN की समय-सीमा निकल गई हो');
  const b = await readJson(req);
  if (!['approved', 'returned'].includes(b.decision)) throw httpErr(400, 'अनुमोदन या वापसी चुनें');
  if (b.decision === 'returned' && !str(b.note)) throw httpErr(400, 'वापस भेजने का कारण लिखें');
  const s = getSettings();
  const now = nowIso();
  const late = Math.max(0, hoursBetween(v.aen_due_ts, now));
  if (b.decision === 'approved') {
    q(`UPDATE verifications SET status = 'approved', aen_id = ?, aen_ts = ?, aen_note = ?, aen_lat = ?, aen_lng = ?, aen_late_hours = ? WHERE id = ?`)
      .run(user.id, now, str(b.note, 2000), num(b.lat), num(b.lng), Math.round(late * 10) / 10, v.id);
  } else {
    // sent back to the JEN for re-measurement: a fresh 24 hours, and the round is counted
    q(`UPDATE verifications SET status = 'pending_jen', aen_note = ?, jen_due_ts = ?, rounds = rounds + 1, aen_due_ts = NULL WHERE id = ?`)
      .run(str(b.note, 2000), addHours(now, s.jen_verify_hours), v.id);
  }
  audit(user.id, 'verification_' + b.decision, { id: v.id, note: str(b.note) });
  send(res, 200, { ok: true });
});
route('POST', '/api/verifications/:id/respond', async (req, res, { user, params }) => {
  need(user, ['contractor']);
  const { v, w } = verOr404(user, params.id);
  if (w.contractor_id !== user.id) throw httpErr(403, 'यह आपका काम नहीं है');
  if (v.measured_amount == null) throw httpErr(400, 'अभी JEN का नाप नहीं हुआ');
  if (v.contractor_status !== 'pending') throw httpErr(400, 'जवाब पहले दिया जा चुका है');
  const b = await readJson(req);
  if (!['agreed', 'disagreed'].includes(b.status)) throw httpErr(400, 'गलत जवाब');
  if (b.status === 'disagreed' && !str(b.note)) throw httpErr(400, 'असहमति का कारण लिखें');
  q('UPDATE verifications SET contractor_status = ?, contractor_note = ?, contractor_ts = ? WHERE id = ?').run(b.status, str(b.note, 2000), nowIso(), v.id);
  send(res, 200, { ok: true });
});
route('GET', '/api/flags', async (req, res, { user, query }) => {
  const flags = redFlags(worksFor(user), getSettings());
  if (query.format === 'csv') return send(res, 200, csv(flags, ['severity', 'work', 'tia', 'type', 'against_role', 'against_name', 'since', 'hours', 'days', 'text']),
    { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="red-flags.csv"' });
  send(res, 200, flags);
});

// ---- work order issue, completion, on-demand measurement ----
route('POST', '/api/works/:id/issue-wo', async (req, res, { user, params }) => {
  const w = workOr404(user, params.id);
  if (!(OVERSIGHT.includes(user.role) || (['xen', 'aen'].includes(user.role) && w[user.role + '_id'] === user.id))) throw httpErr(403, 'वर्क ऑर्डर XEN / S.E. जारी करते हैं');
  if (w.wo_date) throw httpErr(400, 'वर्क ऑर्डर पहले से जारी है');
  const b = await readJson(req);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.wo_date || '') ? b.wo_date : istDay();
  if (day > istDay()) throw httpErr(400, 'भविष्य की तारीख़ नहीं');
  if (w.award_date && day < w.award_date) throw httpErr(400, 'वर्क ऑर्डर अवार्ड से पहले का नहीं हो सकता');
  if (!str(b.wo_no)) throw httpErr(400, 'वर्क ऑर्डर नंबर लिखें');
  q('UPDATE works SET wo_no = ?, wo_date = ? WHERE id = ?').run(str(b.wo_no, 100), day, w.id);
  audit(user.id, 'wo_issued', { work: w.id, wo_no: b.wo_no, wo_date: day });
  const c = w.contractor_id && q('SELECT mobile FROM users WHERE id = ?').get(w.contractor_id);
  if (c) sendSms(c.mobile, `SiteSaakshi: "${w.name}" का वर्क ऑर्डर ${b.wo_no} जारी। ${getSettings().start_within_days} दिन में काम शुरू करें।`);
  send(res, 200, { ok: true });
});
route('POST', '/api/works/:id/request-verification', async (req, res, { user, params }) => {
  need(user, ['contractor']);
  const w = workOr404(user, params.id);
  if (w.contractor_id !== user.id) throw httpErr(403, 'यह आपका काम नहीं है');
  const last = q('SELECT claimed_amount FROM verifications WHERE work_id = ? ORDER BY id DESC LIMIT 1').get(w.id);
  if (claimedAmount(w.id) <= (last?.claimed_amount || 0) + 1) throw httpErr(400, 'पिछले नाप के बाद कोई नया काम अपलोड नहीं हुआ');
  const id = createVerification(w, 'on_demand', getSettings());
  if (!id) throw httpErr(400, 'एक नाप पहले से बाकी है; वही पूरा होगा');
  send(res, 201, { id });
});
route('POST', '/api/works/:id/complete', async (req, res, { user, params }) => {
  need(user, ['contractor']);
  const w = workOr404(user, params.id);
  if (w.contractor_id !== user.id) throw httpErr(403, 'यह आपका काम नहीं है');
  if (w.completed_ts) throw httpErr(400, 'काम पहले ही पूरा घोषित है');
  const s = getSettings();
  const ts = nowIso();
  q('UPDATE works SET completed_ts = ? WHERE id = ?').run(ts, w.id);
  // a pending measurement becomes the final one (it keeps its deadline); otherwise a new final measurement starts
  const pend = q("SELECT * FROM verifications WHERE work_id = ? AND status IN ('pending_jen','pending_aen') ORDER BY id DESC LIMIT 1").get(w.id);
  let vid;
  if (pend) {
    vid = pend.id;
    q("UPDATE verifications SET kind = 'final' WHERE id = ?").run(vid);
    const have = new Set(q('SELECT item_id FROM verification_lines WHERE verification_id = ?').all(vid).map((l) => l.item_id));
    const c = claimedQty(w.id);
    for (const it of items(w.id)) if (!have.has(it.id)) q('INSERT INTO verification_lines (verification_id, item_id, claimed_qty) VALUES (?,?,?)').run(vid, it.id, c[it.id] || 0);
  } else vid = createVerification(w, 'final', s);
  audit(user.id, 'work_completed', { work: w.id });
  send(res, 200, { verification_id: vid });
});

// ---- hindrances (बाधा) → automatic extension of time ----
route('GET', '/api/hindrances', async (req, res, { user, query }) => {
  const s = getSettings();
  const ws = query.work_id ? [workOr404(user, query.work_id)] : worksFor(user);
  const out = [];
  for (const w of ws) for (const h of timeline(w, s).hindrances) out.push({ ...h, work: w.name, work_id: w.id });
  send(res, 200, out.sort((a, b) => String(b.from_day).localeCompare(String(a.from_day))));
});
route('POST', '/api/hindrances', async (req, res, { user }) => {
  need(user, ['contractor']);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  if (w.contractor_id !== user.id) throw httpErr(403, 'यह आपका काम नहीं है');
  const cat = HINDRANCE_CATEGORIES[b.category];
  if (!cat) throw httpErr(400, 'बाधा का प्रकार चुनें');
  if (!str(b.description)) throw httpErr(400, 'बाधा का पूरा विवरण लिखें');
  const today = istDay();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(b.from_day || '') ? b.from_day : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(b.to_day || '') ? b.to_day : null;
  if (from > today || (to && (to < from || to > today))) throw httpErr(400, 'तारीख़ें सही भरें');
  const role = OFFICER_ROLES.includes(b.responsible_role) ? b.responsible_role : cat.role;
  const s = getSettings();
  const id = Number(q(`INSERT INTO hindrances (work_id, raised_by, category, description, responsible_role, from_day, to_day, created_ts, response_due_day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(w.id, user.id, b.category, str(b.description, 3000), role, from, to, nowIso(), addDays(today, s.hindrance_response_days), savePhoto(b.photo)).lastInsertRowid);
  const o = w[role + '_id'] && q('SELECT mobile FROM users WHERE id = ?').get(w[role + '_id']);
  if (o) sendSms(o.mobile, `SiteSaakshi: "${w.name}" पर ठेकेदार ने बाधा दर्ज की: ${cat.label}। ${s.hindrance_response_days} दिन में जवाब न देने पर इसे स्वीकार माना जाएगा।`);
  send(res, 201, { id });
});
const hinOr404 = (user, id) => {
  const h = q('SELECT * FROM hindrances WHERE id = ?').get(Number(id));
  if (!h) throw httpErr(404, 'बाधा नहीं मिली');
  return { h, w: workOr404(user, h.work_id) };
};
route('POST', '/api/hindrances/:id/close', async (req, res, { user, params }) => {
  const { h, w } = hinOr404(user, params.id);
  if (user.role !== 'contractor' || w.contractor_id !== user.id) throw httpErr(403, 'बाधा का अंत ठेकेदार दर्ज करता है');
  if (h.to_day) throw httpErr(400, 'पहले ही बंद है');
  const b = await readJson(req);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(b.to_day || '') ? b.to_day : istDay();
  if (to < h.from_day || to > istDay()) throw httpErr(400, 'तारीख़ सही भरें');
  q('UPDATE hindrances SET to_day = ? WHERE id = ?').run(to, h.id);
  send(res, 200, { ok: true });
});
route('POST', '/api/hindrances/:id/respond', async (req, res, { user, params }) => {
  need(user, OFFICER_ROLES);
  const { h, w } = hinOr404(user, params.id);
  if (w[user.role + '_id'] !== user.id) throw httpErr(403, 'आप इस काम पर नियुक्त नहीं हैं');
  const b = await readJson(req);
  const state = hindranceState(h, getSettings());
  if (h.status !== 'pending') throw httpErr(400, 'जवाब पहले दिया जा चुका है');
  if (b.decision === 'disputed') {
    if (state === 'deemed') throw httpErr(400, 'जवाब की समय-सीमा निकल चुकी है; बाधा स्वीकार मानी गई');
    if (!str(b.note)) throw httpErr(400, 'आपत्ति का कारण और सबूत लिखें');
  } else if (b.decision !== 'accepted') throw httpErr(400, 'स्वीकार या आपत्ति चुनें');
  q('UPDATE hindrances SET status = ?, responded_by = ?, responded_ts = ?, response_note = ? WHERE id = ?').run(b.decision, user.id, nowIso(), str(b.note, 2000), h.id);
  audit(user.id, 'hindrance_' + b.decision, { id: h.id });
  send(res, 200, { ok: true });
});
route('POST', '/api/hindrances/:id/decide', async (req, res, { user, params }) => {
  need(user, OVERSIGHT);
  const { h } = hinOr404(user, params.id);
  if (h.status !== 'disputed') throw httpErr(400, 'केवल आपत्ति वाली बाधा पर निर्णय होता है');
  const b = await readJson(req);
  if (!['accepted', 'rejected'].includes(b.decision)) throw httpErr(400, 'निर्णय चुनें');
  if (!str(b.note)) throw httpErr(400, 'निर्णय का कारण लिखें');
  q('UPDATE hindrances SET status = ?, decided_by = ?, decided_ts = ?, decision_note = ? WHERE id = ?').run(b.decision, user.id, nowIso(), str(b.note, 2000), h.id);
  audit(user.id, 'hindrance_decided_' + b.decision, { id: h.id, note: str(b.note) });
  send(res, 200, { ok: true });
});

// ---- bills: the contractor makes a running or final bill whenever he wants, from verified quantities ----
route('POST', '/api/bills', async (req, res, { user }) => {
  need(user, ['contractor']);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  if (w.contractor_id !== user.id) throw httpErr(403, 'यह आपका काम नहीं है');
  const la = latestApproved(w.id);
  if (!la) throw httpErr(400, 'अभी कोई JEN + AEN से सत्यापित नाप नहीं है। "नाप माँगें" दबाएँ');
  const prev = q('SELECT * FROM bills WHERE work_id = ? ORDER BY bill_no DESC LIMIT 1').get(w.id);
  if (prev?.is_final) throw httpErr(400, 'अंतिम बिल बन चुका है');
  const final = !!b.final;
  if (final && (!w.completed_ts || la.v.kind !== 'final')) throw httpErr(400, 'अंतिम बिल के लिए पहले "काम पूरा" घोषित करें और अंतिम नाप का JEN + AEN सत्यापन होने दें');
  if (prev && prev.verification_id === la.v.id && !final) throw httpErr(400, 'पिछले बिल के बाद नया सत्यापित नाप नहीं है। "नाप माँगें" दबाएँ');
  const prevQty = prev ? Object.fromEntries(q('SELECT item_id, upto_qty FROM bill_lines WHERE bill_id = ?').all(prev.id).map((l) => [l.item_id, l.upto_qty])) : {};
  const its = items(w.id);
  const gross = its.reduce((t, i) => t + (la.qty[i.id] || 0) * i.rate, 0);
  const prevGross = prev ? prev.gross_upto : 0;
  const tp = w.tp_percent || 0;
  const net = Math.round((gross - prevGross) * (1 + tp / 100));
  db.exec('BEGIN');
  try {
    const id = Number(q(`INSERT INTO bills (work_id, bill_no, is_final, verification_id, created_by, created_ts, gross_upto, prev_upto, tp_percent, net_amount, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(w.id, (prev?.bill_no || 0) + 1, final ? 1 : 0, la.v.id, user.id, nowIso(), Math.round(gross), Math.round(prevGross), tp, net, str(b.note, 1000)).lastInsertRowid);
    for (const i of its) if (la.qty[i.id] || prevQty[i.id]) q('INSERT INTO bill_lines (bill_id, item_id, upto_qty, prev_qty, rate) VALUES (?,?,?,?,?)').run(id, i.id, la.qty[i.id] || 0, prevQty[i.id] || 0, i.rate);
    db.exec('COMMIT');
    const s = getSettings();
    const x = q('SELECT mobile FROM users WHERE id = ?').get(w.xen_id || 0);
    if (x) sendSms(x.mobile, `SiteSaakshi: "${w.name}" का ${final ? 'अंतिम' : (prev?.bill_no || 0) + 1 + 'वाँ'} बिल ₹${net.toLocaleString('en-IN')} जमा। ${final ? `मुख्यालय ${s.final_approval_days}` : `XEN ${s.bill_pass_days}`} दिन में।`);
    send(res, 201, { id, net_amount: net, bill_no: (prev?.bill_no || 0) + 1 });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});
route('GET', '/api/bills', async (req, res, { user, query }) => {
  const s = getSettings();
  const names = userNames();
  const ws = query.work_id ? [workOr404(user, query.work_id)] : worksFor(user);
  const out = [];
  for (const w of ws) for (const b of q('SELECT * FROM bills WHERE work_id = ? ORDER BY bill_no DESC').all(w.id)) {
    const d = billDue(b, s);
    out.push({ ...billDetail(b), work: w.name, wo_no: w.wo_no, contractor: names[w.contractor_id], passed_name: names[b.passed_by] || '', hq_name: names[b.hq_by] || '', paid_name: names[b.paid_by] || '',
      due: d, overdue_days: d ? Math.max(0, daysBetween(d.due, istDay())) : 0 });
  }
  send(res, 200, out.sort((a, b) => b.created_ts.localeCompare(a.created_ts)));
});
route('POST', '/api/bills/:id/action', async (req, res, { user, params }) => {
  const bill = q('SELECT * FROM bills WHERE id = ?').get(Number(params.id));
  if (!bill) throw httpErr(404, 'बिल नहीं मिला');
  const w = workOr404(user, bill.work_id);
  const b = await readJson(req);
  const ts = nowIso();
  const isXen = (user.role === 'xen' && w.xen_id === user.id) || ['se', 'admin'].includes(user.role);
  if (b.action === 'pass') {
    if (!isXen || bill.is_final || bill.status !== 'submitted') throw httpErr(400, 'यह कदम अभी संभव नहीं');
    q("UPDATE bills SET status = 'passed', passed_by = ?, passed_ts = ? WHERE id = ?").run(user.id, ts, bill.id);
  } else if (b.action === 'hq_approve') {
    if (!['hq', 'admin'].includes(user.role) || !bill.is_final || bill.status !== 'submitted') throw httpErr(400, 'अंतिम बिल का अनुमोदन मुख्यालय / निविदा प्राधिकारी करता है');
    q("UPDATE bills SET status = 'hq_approved', hq_by = ?, hq_ts = ?, hq_note = ? WHERE id = ?").run(user.id, ts, str(b.note, 2000), bill.id);
  } else if (b.action === 'paid') {
    if (!(isXen || user.role === 'hq') || !['passed', 'hq_approved'].includes(bill.status)) throw httpErr(400, 'पहले बिल पास / अनुमोदित हो');
    if (!str(b.ref)) throw httpErr(400, 'भुगतान का संदर्भ (UTR / चेक नं.) लिखें');
    q("UPDATE bills SET status = 'paid', paid_by = ?, paid_ts = ?, paid_ref = ? WHERE id = ?").run(user.id, ts, str(b.ref, 100), bill.id);
    const c = q('SELECT mobile FROM users WHERE id = ?').get(w.contractor_id);
    if (c) sendSms(c.mobile, `SiteSaakshi: "${w.name}" के बिल ₹${Math.round(bill.net_amount).toLocaleString('en-IN')} का भुगतान दर्ज। संदर्भ ${str(b.ref, 100)}`);
  } else throw httpErr(400, 'गलत कार्रवाई');
  audit(user.id, 'bill_' + b.action, { bill: bill.id, note: str(b.note), ref: str(b.ref) });
  send(res, 200, { ok: true });
});

// ---- the department's list of engineers and registered contractors, imported in one go ----
route('POST', '/api/users/import', async (req, res, { user }) => {
  need(user, OVERSIGHT);
  const { text } = await readJson(req);
  let added = 0; const skipped = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const c = line.split(/\t|,/).map((x) => x.trim());
    if (c.length < 3 || !/^\d{10}$/.test(c[1])) { if (line.trim()) skipped.push(line.slice(0, 60) + ' (गलत पंक्ति)'); continue; }
    const role = c[2].toLowerCase();
    if (!['contractor', 'jen', 'aen', 'xen', 'se'].includes(role)) { skipped.push(line.slice(0, 60) + ' (गलत पद)'); continue; }
    if (q('SELECT 1 FROM users WHERE mobile = ?').get(c[1])) { skipped.push(c[1] + ' (पहले से है)'); continue; }
    const id = createUser({ name: c[0], mobile: c[1], role, office: c[3] || '', pin: null, verified: 1 });
    q('UPDATE users SET department = ?, reg_no = ? WHERE id = ?').run(c[3] || '', c[4] || '', id);
    added++;
  }
  audit(user.id, 'users_imported', { added, skipped: skipped.length });
  send(res, 200, { added, skipped });
});

// ---- public portal: open to every citizen, no names or mobile numbers of any person ----
let publicCache = { at: 0, data: null };
route('GET', '/api/public/overview', async (req, res) => {
  const s = getSettings();
  if (!s.public_board) return send(res, 200, { enabled: false, settings: publicSettings(s) });
  if (Date.now() - publicCache.at > 60e3) {
    const all = q('SELECT * FROM works ORDER BY id DESC').all();
    const names = userNames();
    const flags = redFlags(all, s);
    const flagCount = {};
    for (const f of flags) if (f.severity !== 'low') flagCount[f.work_id] = (flagCount[f.work_id] || 0) + 1;
    const works = all.map((w) => {
      const base = w.wo_amount || boqTotal(w.id);
      const la = q("SELECT measured_amount FROM verifications WHERE work_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1").get(w.id);
      const t = timeline(w, s);
      const paid = q("SELECT COALESCE(SUM(net_amount),0) AS a FROM bills WHERE work_id = ? AND status = 'paid'").get(w.id).a;
      return {
        id: w.id, name: w.name, department: w.department || '', office: w.office || '', tia: w.tia || '', wo_no: w.wo_no || '', wo_amount: base ? Math.round(base) : null,
        lat: w.lat, lng: w.lng,
        contractor: s.public_names ? names[w.contractor_id] || '' : '', jen: s.public_names ? names[w.jen_id] || '' : '', aen: s.public_names ? names[w.aen_id] || '' : '', xen: s.public_names ? names[w.xen_id] || '' : '',
        last_update: q('SELECT MAX(server_ts) AS t FROM progress WHERE work_id = ?').get(w.id).t,
        stage: w.status === 'closed' ? 'closed' : w.completed_ts ? 'completed' : !w.wo_date && w.award_date ? 'awarded' : 'in_progress',
        claimed_pct: base ? Math.min(100, Math.round(claimedAmount(w.id) / base * 1000) / 10) : 0,
        verified_pct: base && la ? Math.min(100, Math.round(la.measured_amount / base * 1000) / 10) : 0,
        paid_amount: Math.round(paid),
        award_date: t.award_date, wo_date: t.wo_date, stipulated_end: t.stipulated_end || null, revised_end: t.revised_end || null, extension_days: t.extension_days,
        department_delay_days: t.department_delay_days || 0, contractor_delay_days: t.contractor_delay_days || 0, wo_late_days: t.wo_late_days || 0,
        red_flags: flagCount[w.id] || 0,
      };
    });
    const byRole = {};
    for (const f of flags) if (f.severity !== 'low' && f.against_role) byRole[f.against_role] = (byRole[f.against_role] || 0) + 1;
    const measured = q("SELECT created_ts, jen_ts FROM verifications WHERE jen_ts IS NOT NULL").all();
    const bills = q("SELECT * FROM bills WHERE status = 'paid'").all();
    const onTime = bills.filter((b) => { const end = b.is_final ? addDays(istDay(new Date(b.created_ts)), s.final_approval_days + s.payment_days) : addDays(istDay(new Date(b.created_ts)), s.bill_pass_days + s.payment_days); return istDay(new Date(b.paid_ts)) <= end; }).length;
    publicCache = { at: Date.now(), data: {
      enabled: true,
      stats: {
        works_total: all.length, works_active: works.filter((w) => w.stage === 'in_progress').length, works_completed: works.filter((w) => w.stage === 'completed' || w.stage === 'closed').length,
        wo_value_total: works.reduce((t, w) => t + (w.wo_amount || 0), 0), paid_total: works.reduce((t, w) => t + w.paid_amount, 0),
        engineers: q("SELECT COUNT(*) AS n FROM users WHERE role IN ('jen','aen','xen','se') AND active = 1").get().n,
        contractors: q("SELECT COUNT(*) AS n FROM users WHERE role = 'contractor' AND active = 1").get().n,
        verifications_done: measured.length,
        avg_measure_hours: measured.length ? Math.round(measured.reduce((t, v) => t + hoursBetween(v.created_ts, v.jen_ts), 0) / measured.length) : null,
        bills_paid: bills.length, bills_paid_on_time_pct: bills.length ? Math.round(onTime / bills.length * 100) : null,
        red_flags_by_role: byRole,
        departments: [...new Set(works.map((w) => w.department).filter(Boolean))].sort(),
      },
      works,
    } };
  }
  send(res, 200, { ...publicCache.data, settings: publicSettings(s) });
}, { public: true });
function publicSettings(s) {
  const keys = ['visits_per_week', 'milestone_percent', 'milestone_max_amount', 'jen_verify_hours', 'aen_approve_hours', 'wo_issue_days', 'start_within_days', 'hindrance_response_days', 'hindrance_decision_days', 'bill_pass_days', 'payment_days', 'final_approval_days', 'sla_days'];
  return Object.fromEntries(keys.map((k) => [k, s[k]]));
}

// ---- public transparency: every work, contractor and officer, with updates ----
// Public: names, posts, offices, firm registration, progress, site photos, measurements, bills, hindrances, delays.
// Never public: mobile numbers, PINs/OTPs, attendance selfies and their GPS, complaints.
const pubCache = new Map();
function cached(key, fn) {
  const c = pubCache.get(key);
  if (c && Date.now() - c.at < 60e3) return c.data;
  const data = fn();
  pubCache.set(key, { at: Date.now(), data });
  return data;
}
function publicPerson(id, s) {
  if (!id) return null;
  const u = q('SELECT id, name, role, office, department, reg_no, gstin, verified, pin_hash FROM users WHERE id = ?').get(id);
  if (!u) return null;
  return { id: u.id, name: s.public_names ? u.name : ROLE_LABEL_PUBLIC[u.role], role: u.role, office: u.office || '', department: u.department || '',
    reg_no: u.role === 'contractor' && s.public_names ? u.reg_no || '' : '', gstin: u.role === 'contractor' && s.public_names ? u.gstin || '' : '', verified: !!u.verified, joined: !!u.pin_hash };
}
const ROLE_LABEL_PUBLIC = { contractor: 'ठेकेदार', jen: 'JEN', aen: 'AEN', xen: 'XEN', se: 'S.E.', hq: 'मुख्यालय', admin: 'Admin' };
function workEvents(w, s, limit = 200) {
  const names = userNames();
  const nm = (id) => (s.public_names ? names[id] || '' : '');
  const ev = [];
  const add = (ts, kind, text, extra = {}) => ts && ev.push({ ts, kind, text, work_id: w.id, work: w.name, ...extra });
  if (w.award_date) add(w.award_date + 'T00:00:00+05:30', 'award', 'काम अवार्ड हुआ (LoA)');
  if (w.wo_date) add(w.wo_date + 'T00:00:01+05:30', 'wo', `वर्क ऑर्डर ${w.wo_no || ''} जारी`);
  for (const p of q('SELECT * FROM progress WHERE work_id = ? ORDER BY id DESC LIMIT 100').all(w.id)) {
    const lines = q('SELECT pl.qty, i.description, i.unit FROM progress_lines pl JOIN work_items i ON i.id = pl.item_id WHERE pl.progress_id = ?').all(p.id);
    add(p.server_ts, 'progress', `ठेकेदार का अपडेट: ${lines.map((l) => `${l.description} ${l.qty} ${l.unit}`).join(', ')} (₹${Math.round(p.amount).toLocaleString('en-IN')})${p.in_fence ? '' : ' · साइट के बाहर से'}`,
      { photos: s.public_photos ? JSON.parse(p.photos) : [], by: nm(p.user_id), role: 'contractor' });
  }
  for (const v of q('SELECT * FROM verifications WHERE work_id = ? ORDER BY id DESC LIMIT 50').all(w.id)) {
    const label = { weekly: 'साप्ताहिक नाप', on_demand: 'ठेकेदार द्वारा माँगा नाप', final: 'अंतिम नाप (काम पूरा)' }[v.kind] || `${v.milestone_no * s.milestone_percent}% माइलस्टोन का नाप`;
    add(v.created_ts, 'verification_due', `${label} देय: JEN को ${s.jen_verify_hours} घंटे में साइट पर नाप लेना है (दावा ₹${Math.round(v.claimed_amount).toLocaleString('en-IN')})`);
    const mRole = v.jen_id ? q('SELECT role FROM users WHERE id = ?').get(v.jen_id)?.role || 'jen' : 'jen';
    if (v.jen_ts) add(v.jen_ts, 'measured', `${mRole.toUpperCase()} ने साइट पर नाप लिया: ₹${Math.round(v.measured_amount).toLocaleString('en-IN')}${v.jen_late_hours ? ` (${v.jen_late_hours} घंटे देर से)` : ' (समय पर)'}`, { by: nm(v.jen_id), role: mRole });
    if (v.aen_ts) add(v.aen_ts, 'approved', `AEN ने नाप अनुमोदित किया${v.aen_late_hours ? ` (${v.aen_late_hours} घंटे देर से)` : ' (समय पर)'}`, { by: nm(v.aen_id), role: 'aen' });
  }
  for (const b of q('SELECT * FROM bills WHERE work_id = ?').all(w.id)) {
    const t = b.is_final ? 'अंतिम बिल' : `${b.bill_no}वाँ रनिंग बिल`;
    add(b.created_ts, 'bill', `${t} ₹${Math.round(b.net_amount).toLocaleString('en-IN')} जमा`, { by: nm(b.created_by), role: 'contractor' });
    if (b.passed_ts) add(b.passed_ts, 'bill_passed', `${t} XEN ने पास किया`, { by: nm(b.passed_by), role: 'xen' });
    if (b.hq_ts) add(b.hq_ts, 'bill_hq', `${t}: मुख्यालय ने काम सत्यापित कर भुगतान अनुमोदित किया`, { by: nm(b.hq_by), role: 'hq' });
    if (b.paid_ts) add(b.paid_ts, 'paid', `${t} का भुगतान हुआ ₹${Math.round(b.net_amount).toLocaleString('en-IN')}`);
  }
  for (const h of q('SELECT * FROM hindrances WHERE work_id = ?').all(w.id)) {
    add(h.created_ts, 'hindrance', `बाधा दर्ज: ${HINDRANCE_CATEGORIES[h.category]?.label || h.category} (ज़िम्मेदार ${h.responsible_role.toUpperCase()}), ${h.from_day} से`, { role: 'contractor' });
    if (h.responded_ts) add(h.responded_ts, 'hindrance_reply', `बाधा पर ${h.responsible_role.toUpperCase()} ने ${h.status === 'accepted' ? 'स्वीकार किया' : 'आपत्ति की'}`, { by: nm(h.responded_by) });
    if (h.decided_ts) add(h.decided_ts, 'hindrance_decided', `बाधा पर निर्णय: ${h.status === 'accepted' ? 'स्वीकार (समय-वृद्धि)' : 'अस्वीकार'}`, { by: nm(h.decided_by) });
  }
  for (const v of q("SELECT * FROM visits WHERE work_id = ? AND in_fence = 1 AND contractor_status != 'disputed' ORDER BY id DESC LIMIT 60").all(w.id))
    add(v.server_ts, 'visit', `${v.role.toUpperCase()} ने साइट विज़िट की${v.contractor_status === 'confirmed' ? ' (ठेकेदार ने पुष्टि की)' : ''}`, { by: nm(v.user_id), role: v.role });
  for (const d of q('SELECT * FROM dprs WHERE work_id = ? ORDER BY id DESC LIMIT 60').all(w.id))
    add(d.server_ts, 'dpr', `JEN की DPR: ${d.work_done}${d.hindrance ? ` · रुकावट: ${d.hindrance}` : ''}`, { by: nm(d.user_id), role: 'jen' });
  if (w.completed_ts) add(w.completed_ts, 'completed', 'ठेकेदार ने काम पूरा घोषित किया');
  return ev.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
}
function personPerformance(u, s) {
  const today = istDay();
  const col = u.role + '_id';
  const works = ['jen', 'aen', 'xen'].includes(u.role) ? q(`SELECT * FROM works WHERE ${col} = ?`).all(u.id) : u.role === 'contractor' ? q('SELECT * FROM works WHERE contractor_id = ?').all(u.id) : [];
  const active = works.filter((w) => w.status === 'active' && !w.completed_ts);
  const out = { works_total: works.length, works_active: active.length, works_value: Math.round(works.reduce((t, w) => t + (w.wo_amount || boqTotal(w.id)), 0)), works: works.map((w) => ({ id: w.id, name: w.name })) };
  const flags = redFlags(works, s).filter((f) => f.against_id === u.id && f.severity !== 'low');
  out.red_flags = flags.length;
  out.red_flag_texts = flags.slice(0, 5).map((f) => ({ work: f.work, text: f.text }));
  if (['jen', 'aen', 'xen'].includes(u.role)) {
    // last 4 complete weeks: counted visit-days against the rule
    let req = 0, done = 0;
    const thisWeek = weekStart(today);
    for (let k = 1; k <= 4; k++) {
      const wk = addDays(thisWeek, -7 * k);
      for (const r of compliance(active.length ? active : [], wk, s).filter((c) => c.user_id === u.id)) { req += r.required; done += Math.min(r.done, r.required); }
    }
    out.visits_4w = { required: req, done, pct: req ? Math.round(done / req * 100) : null };
  }
  if (u.role === 'jen') {
    const m = q('SELECT created_ts, jen_ts, jen_late_hours FROM verifications WHERE jen_id = ? AND jen_ts IS NOT NULL').all(u.id);
    out.measurements = { count: m.length, late: m.filter((x) => x.jen_late_hours > 0).length, avg_hours: m.length ? Math.round(m.reduce((t, x) => t + hoursBetween(x.created_ts, x.jen_ts), 0) / m.length) : null };
    out.dpr_count = q('SELECT COUNT(*) AS n FROM dprs WHERE user_id = ?').get(u.id).n;
  }
  if (u.role === 'aen') {
    const a = q('SELECT aen_late_hours FROM verifications WHERE aen_id = ? AND aen_ts IS NOT NULL').all(u.id);
    out.approvals = { count: a.length, late: a.filter((x) => x.aen_late_hours > 0).length };
  }
  if (u.role === 'xen') out.bills_passed = q('SELECT COUNT(*) AS n FROM bills WHERE passed_by = ?').get(u.id).n;
  if (u.role === 'contractor') {
    const v = q(`SELECT claimed_amount, measured_amount FROM verifications WHERE work_id IN (${works.map((w) => w.id).join(',') || 0}) AND measured_amount IS NOT NULL`).all();
    out.overclaims = v.filter((x) => x.measured_amount < x.claimed_amount * (1 - s.overclaim_tolerance_percent / 100)).length;
    out.measurements = v.length;
    out.completed = works.filter((w) => w.completed_ts).length;
    out.contractor_delay_days = works.reduce((t, w) => t + (timeline(w, s).contractor_delay_days || 0), 0);
    out.department_delay_days = works.reduce((t, w) => t + (timeline(w, s).extension_days || 0), 0);
  }
  return out;
}
const publicGuard = (s) => { if (!s.public_board) throw httpErr(404, 'जनता बोर्ड बंद है'); };
route('GET', '/api/public/works/:id', async (req, res, { params }) => {
  const s = getSettings(); publicGuard(s);
  const w = q('SELECT * FROM works WHERE id = ?').get(Number(params.id));
  if (!w) throw httpErr(404, 'काम नहीं मिला');
  send(res, 200, cached('w' + w.id, () => {
    const c = claimedQty(w.id);
    const la = latestApproved(w.id);
    const t = timeline(w, s);
    const base = w.wo_amount || boqTotal(w.id);
    const thisWeek = weekStart(istDay());
    return {
      id: w.id, name: w.name, department: w.department || '', office: w.office || '', tia: w.tia || '', wo_no: w.wo_no || '', wo_amount: base ? Math.round(base) : null, tp_percent: w.tp_percent || 0,
      lat: w.lat, lng: w.lng, status: w.status, completed: !!w.completed_ts,
      people: { contractor: publicPerson(w.contractor_id, s), jen: publicPerson(w.jen_id, s), aen: publicPerson(w.aen_id, s), xen: publicPerson(w.xen_id, s) },
      items: items(w.id).map((i) => ({ code: i.code, description: i.description, unit: i.unit, qty: i.qty, rate: i.rate, claimed_qty: c[i.id] || 0, verified_qty: la ? la.qty[i.id] || 0 : 0 })),
      claimed_amount: Math.round(claimedAmount(w.id)), verified_amount: la ? Math.round(la.v.measured_amount) : 0,
      paid_amount: Math.round(q("SELECT COALESCE(SUM(net_amount),0) AS a FROM bills WHERE work_id = ? AND status = 'paid'").get(w.id).a),
      timeline: { ...t, hindrances: t.hindrances.map((h) => ({ category: h.category_label, responsible_role: h.responsible_role, from_day: h.from_day, to_day: h.to_day || null, days: h.days, state: h.state })) },
      visits_this_week: compliance([w], thisWeek, s).map((r) => ({ role: r.role, officer: s.public_names ? r.officer : r.role.toUpperCase(), required: r.required, done: r.done, last_visit: r.last_visit })),
      red_flags: redFlags([w], s).filter((f) => f.severity !== 'low').map((f) => ({ type: f.type, severity: f.severity, against_role: f.against_role, against_name: s.public_names ? f.against_name : '', text: f.text, since: f.since })),
      updates: workEvents(w, s, 150),
    };
  }));
}, { public: true });
route('GET', '/api/public/updates', async (req, res) => {
  const s = getSettings(); publicGuard(s);
  send(res, 200, cached('updates', () => q('SELECT * FROM works').all().flatMap((w) => workEvents(w, s, 30)).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 60)));
}, { public: true });
route('GET', '/api/public/people', async (req, res, { query }) => {
  const s = getSettings(); publicGuard(s);
  const kind = query.kind === 'contractors' ? 'contractors' : 'officers';
  send(res, 200, cached('people-' + kind, () => {
    const roles = kind === 'contractors' ? ['contractor'] : ['xen', 'aen', 'jen', 'se'];
    return q(`SELECT * FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')}) ORDER BY role, name`).all(...roles)
      .map((u) => ({ ...publicPerson(u.id, s), ...personPerformance(u, s) }))
      .filter((p) => kind === 'contractors' || p.works_total > 0 || p.role === 'se');
  }));
}, { public: true });
// only site photos from contractors' work updates are public; attendance selfies never are
route('GET', '/api/public/photo/:hash', async (req, res, { params }) => {
  const s = getSettings(); publicGuard(s);
  if (!s.public_photos || !/^[a-f0-9]{64}$/.test(params.hash) || !q('SELECT 1 FROM progress WHERE photos LIKE ? LIMIT 1').get('%' + params.hash + '%')) throw httpErr(404, 'फ़ोटो नहीं मिली');
  const f = photoPath(params.hash);
  if (!f) throw httpErr(404, 'फ़ोटो नहीं मिली');
  send(res, 200, fs.readFileSync(f), { 'Content-Type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[f.split('.').pop()], 'Cache-Control': 'public, max-age=86400' });
}, { public: true });

// ---- RSS: anyone (newspapers, citizens, the department) can follow updates in a feed reader, no sign-up ----
const xmlEsc = (t) => String(t ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function rss(req, title, link, events) {
  const base = `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')}://${req.headers.host}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${xmlEsc(title)}</title><link>${xmlEsc(base + link)}</link><description>${xmlEsc(title)}</description><language>hi</language>
${events.map((e, i) => `<item><title>${xmlEsc(e.work + ': ' + e.text.slice(0, 120))}</title><link>${xmlEsc(`${base}/#work/${e.work_id}`)}</link><guid isPermaLink="false">${xmlEsc(`${e.work_id}-${e.kind}-${e.ts}-${i}`)}</guid><pubDate>${new Date(e.ts).toUTCString()}</pubDate><description>${xmlEsc(e.text + (e.by ? ` (${e.by})` : ''))}</description></item>`).join('\n')}
</channel></rss>`;
}
route('GET', '/feed.xml', async (req, res) => {
  const s = getSettings(); publicGuard(s);
  const events = cached('updates', () => q('SELECT * FROM works').all().flatMap((w) => workEvents(w, s, 30)).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 60));
  send(res, 200, rss(req, 'साइट साक्षी: सभी कामों के अपडेट', '/#updates', events), { 'Content-Type': 'application/rss+xml; charset=utf-8' });
}, { public: true });
route('GET', '/feed/work/:id', async (req, res, { params }) => {
  const s = getSettings(); publicGuard(s);
  const w = q('SELECT * FROM works WHERE id = ?').get(Number(String(params.id).replace(/\.xml$/, '')));
  if (!w) throw httpErr(404, 'काम नहीं मिला');
  send(res, 200, rss(req, `साइट साक्षी: ${w.name}`, `/#work/${w.id}`, workEvents(w, s, 60)), { 'Content-Type': 'application/rss+xml; charset=utf-8' });
}, { public: true });

// ---- measurement duty moves up when the JEN does not come: AEN after a day, XEN after three ----
function measurerAllowed(user, w, v, s) {
  if (user.role === 'jen') return w.jen_id === user.id;
  const late = hoursBetween(v.jen_due_ts, nowIso());
  if (user.role === 'aen') return w.aen_id === user.id && late >= s.escalate_measure_aen_hours;
  if (user.role === 'xen') return w.xen_id === user.id && late >= s.escalate_measure_xen_hours;
  return false;
}
// nobody approves their own measurement; the XEN steps in when the AEN measured or is late
function approverAllowed(user, w, v, s) {
  if (v.jen_id === user.id) return false;
  if (user.role === 'aen') return w.aen_id === user.id;
  if (user.role === 'xen') return w.xen_id === user.id && (v.jen_id === w.aen_id || hoursBetween(v.aen_due_ts, nowIso()) >= s.escalate_approve_xen_hours);
  return false;
}

// ---- instruction register: verbal instructions and promises, written down; silence = confirmed ----
route('GET', '/api/instructions', async (req, res, { user, query }) => {
  const s = getSettings();
  const names = userNames();
  const ws = query.work_id ? [workOr404(user, query.work_id)] : worksFor(user);
  const out = [];
  for (const w of ws) for (const i of q('SELECT * FROM instructions WHERE work_id = ? ORDER BY id DESC').all(w.id))
    out.push({ ...i, work: w.name, by: names[i.raised_by], to_name: names[w[i.to_role + '_id']] || '', responder: names[i.responded_by] || '', state: i.status === 'pending' && istDay() > i.respond_due_day ? 'deemed' : i.status });
  send(res, 200, out);
});
route('POST', '/api/instructions', async (req, res, { user }) => {
  need(user, ['contractor', ...OFFICER_ROLES]);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  if (w[user.role + '_id'] !== user.id) throw httpErr(403, 'आप इस काम पर नहीं हैं');
  if (!str(b.text)) throw httpErr(400, 'निर्देश / वादा पूरा लिखें: किसने, कब, क्या कहा');
  const to = user.role === 'contractor' ? (OFFICER_ROLES.includes(b.to_role) ? b.to_role : 'jen') : 'contractor';
  if (!w[to + '_id']) throw httpErr(400, 'उस पद पर कोई नियुक्त नहीं');
  const s = getSettings();
  const said = /^\d{4}-\d{2}-\d{2}$/.test(b.said_on || '') && b.said_on <= istDay() ? b.said_on : istDay();
  const id = Number(q(`INSERT INTO instructions (work_id, raised_by, raised_role, to_role, kind, text, said_on, created_ts, respond_due_day) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(w.id, user.id, user.role, to, b.kind === 'promise' ? 'promise' : 'instruction', str(b.text, 3000), said, nowIso(), addDays(istDay(), s.instruction_response_days)).lastInsertRowid);
  const u = q('SELECT mobile FROM users WHERE id = ?').get(w[to + '_id']);
  if (u) sendSms(u.mobile, `SiteSaakshi: "${w.name}" पर निर्देश रजिस्टर में आपके नाम एक प्रविष्टि। ${s.instruction_response_days} दिन में पुष्टि या खंडन करें, वरना पुष्टि मानी जाएगी।`);
  send(res, 201, { id });
});
route('POST', '/api/instructions/:id/respond', async (req, res, { user, params }) => {
  const i = q('SELECT * FROM instructions WHERE id = ?').get(Number(params.id));
  if (!i) throw httpErr(404, 'नहीं मिला');
  const w = workOr404(user, i.work_id);
  if (w[i.to_role + '_id'] !== user.id) throw httpErr(403, 'यह आपके जवाब के लिए नहीं है');
  if (i.status !== 'pending') throw httpErr(400, 'जवाब पहले दिया जा चुका है');
  if (istDay() > i.respond_due_day) throw httpErr(400, 'जवाब की समय-सीमा निकल चुकी है; पुष्टि मानी गई');
  const b = await readJson(req);
  if (!['confirmed', 'denied'].includes(b.status)) throw httpErr(400, 'पुष्टि या खंडन चुनें');
  if (b.status === 'denied' && !str(b.note)) throw httpErr(400, 'खंडन का कारण लिखें');
  q('UPDATE instructions SET status = ?, responded_by = ?, responded_ts = ?, response_note = ? WHERE id = ?').run(b.status, user.id, nowIso(), str(b.note, 2000), i.id);
  send(res, 200, { ok: true });
});

// ---- explanation: S.E. / HQ / XEN ask the person behind a red flag; no reply in time is itself a flag ----
route('POST', '/api/explanations', async (req, res, { user }) => {
  need(user, [...OVERSIGHT, 'xen']);
  const b = await readJson(req);
  const w = workOr404(user, b.work_id);
  const to = num(b.asked_to);
  const allowed = [w.contractor_id, w.jen_id, w.aen_id, w.xen_id].filter((x) => x && x !== user.id);
  if (!allowed.includes(to)) throw httpErr(400, 'इस काम से जुड़ा व्यक्ति चुनें');
  if (!str(b.question)) throw httpErr(400, 'प्रश्न लिखें');
  const s = getSettings();
  const id = Number(q('INSERT INTO explanations (work_id, asked_by, asked_to, flag_text, question, created_ts, due_day) VALUES (?,?,?,?,?,?,?)')
    .run(w.id, user.id, to, str(b.flag_text, 1000), str(b.question, 2000), nowIso(), addDays(istDay(), s.explanation_days)).lastInsertRowid);
  const u = q('SELECT mobile FROM users WHERE id = ?').get(to);
  if (u) sendSms(u.mobile, `SiteSaakshi: "${w.name}" पर ${user.name} ने स्पष्टीकरण माँगा है। ${s.explanation_days} दिन में पोर्टल पर जवाब दें।`);
  audit(user.id, 'explanation_asked', { id, to });
  send(res, 201, { id });
});
route('GET', '/api/explanations', async (req, res, { user }) => {
  const names = userNames();
  const rows = OVERSIGHT.includes(user.role) ? q('SELECT * FROM explanations ORDER BY id DESC LIMIT 500').all()
    : q('SELECT * FROM explanations WHERE asked_to = ? OR asked_by = ? ORDER BY id DESC').all(user.id, user.id);
  send(res, 200, rows.map((e) => ({ ...e, work: q('SELECT name FROM works WHERE id = ?').get(e.work_id)?.name, by: names[e.asked_by], to: names[e.asked_to],
    overdue: !e.reply && istDay() > e.due_day })));
});
route('POST', '/api/explanations/:id/reply', async (req, res, { user, params }) => {
  const e = q('SELECT * FROM explanations WHERE id = ?').get(Number(params.id));
  if (!e || e.asked_to !== user.id) throw httpErr(404, 'नहीं मिला');
  if (e.reply) throw httpErr(400, 'जवाब दिया जा चुका है');
  const b = await readJson(req);
  if (!str(b.reply)) throw httpErr(400, 'जवाब लिखें');
  q('UPDATE explanations SET reply = ?, replied_ts = ? WHERE id = ?').run(str(b.reply, 5000), nowIso(), e.id);
  send(res, 200, { ok: true });
});

// ---- daily report: every morning to the S.E. and the top authority, and on the portal ----
function dailyReport(works, s) {
  const today = istDay(), yday = addDays(today, -1);
  const flags = redFlags(works, s);
  const byRole = {}, bySev = { high: 0, medium: 0, low: 0 };
  for (const f of flags) { bySev[f.severity]++; if (f.against_role) byRole[f.against_role] = (byRole[f.against_role] || 0) + 1; }
  const ids = works.map((w) => w.id).join(',') || '0';
  const count = (sql) => q(sql.replace('$IDS', ids)).get(yday).n;
  return {
    day: today, works_total: works.length, works_running: works.filter((w) => w.status === 'active' && !w.completed_ts && w.wo_date).length,
    flags_total: flags.length, flags_by_severity: bySev, flags_by_role: byRole,
    flags_old: flags.filter((f) => f.severity !== 'low' && f.since && daysBetween(String(f.since).slice(0, 10), today) >= 7).length,
    flags: flags.filter((f) => f.severity !== 'low').slice(0, 40),
    yesterday: {
      progress: count("SELECT COUNT(*) AS n FROM progress WHERE work_id IN ($IDS) AND day = ?"),
      visits: count("SELECT COUNT(*) AS n FROM visits WHERE work_id IN ($IDS) AND day = ? AND in_fence = 1"),
      dprs: count("SELECT COUNT(*) AS n FROM dprs WHERE work_id IN ($IDS) AND day = ?"),
      measured: count("SELECT COUNT(*) AS n FROM verifications WHERE work_id IN ($IDS) AND substr(jen_ts,1,10) = ?"),
      bills: count("SELECT COUNT(*) AS n FROM bills WHERE work_id IN ($IDS) AND substr(created_ts,1,10) = ?"),
      paid: count("SELECT COUNT(*) AS n FROM bills WHERE work_id IN ($IDS) AND substr(paid_ts,1,10) = ?"),
    },
    explanations_pending: q(`SELECT COUNT(*) AS n FROM explanations WHERE work_id IN (${ids}) AND reply IS NULL`).get().n,
  };
}
route('GET', '/api/daily-report', async (req, res, { user, query }) => {
  need(user, [...OVERSIGHT, 'xen', 'aen']);
  if (query.day && query.day !== istDay()) {
    need(user, OVERSIGHT);
    const r = q('SELECT json FROM daily_reports WHERE day = ?').get(query.day);
    if (!r) throw httpErr(404, 'उस दिन की रिपोर्ट नहीं');
    return send(res, 200, JSON.parse(r.json));
  }
  send(res, 200, { ...dailyReport(worksFor(user), getSettings()), past_days: OVERSIGHT.includes(user.role) ? q('SELECT day FROM daily_reports ORDER BY day DESC LIMIT 60').all().map((r) => r.day) : [] });
});
function dailyTick() {
  const nowIst = new Date(Date.now() + 5.5 * 3600e3);
  if (nowIst.getUTCHours() < 9) return;
  const day = istDay();
  if (q('SELECT 1 FROM daily_reports WHERE day = ?').get(day)) return;
  const s = getSettings();
  const r = dailyReport(q('SELECT * FROM works').all(), s);
  q('INSERT INTO daily_reports (day, json) VALUES (?, ?)').run(day, JSON.stringify(r));
  const msg = `SiteSaakshi ${day}: ${r.works_running} काम चालू। 🚩 ${r.flags_total} झंडे (गंभीर ${r.flags_by_severity.high}, 7+ दिन पुराने ${r.flags_old})। ` +
    Object.entries(r.flags_by_role).map(([k, n]) => `${k.toUpperCase()} ${n}`).join(', ') + `। कल: ${r.yesterday.visits} विज़िट, ${r.yesterday.measured} नाप, ${r.yesterday.paid} भुगतान।`;
  for (const u of q("SELECT mobile FROM users WHERE role IN ('hq','se') AND active = 1").all()) sendSms(u.mobile, msg);
}

route('GET', '/api/settings', async (req, res) => send(res, 200, getSettings()));
route('PUT', '/api/settings', async (req, res, { user }) => {
  need(user, ['admin']);
  const b = await readJson(req);
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (b[k] === undefined) continue;
    q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(b[k]));
  }
  audit(user.id, 'settings_changed', b);
  send(res, 200, getSettings());
});
route('GET', '/api/audit', async (req, res, { user }) => {
  need(user, OVERSIGHT);
  const names = userNames();
  send(res, 200, q('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all().map((a) => ({ ...a, by: names[a.user_id] || '' })));
});

route('GET', '/photo/:hash', async (req, res, { params }) => {
  const f = photoPath(params.hash);
  if (!f) throw httpErr(404, 'फ़ोटो नहीं मिली');
  const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[f.split('.').pop()];
  send(res, 200, fs.readFileSync(f), { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' });
});

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/photo/') && !url.pathname.startsWith('/feed')) {
      if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url.pathname);
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const user = currentUser(req);
      if (!r.opts.public && !user) throw httpErr(401, 'कृपया लॉगिन करें');
      return await r.handler(req, res, { user, params: m.groups || {}, query: Object.fromEntries(url.searchParams) });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'सर्वर में गड़बड़ी' });
  }
});

// ---------- first run / demo ----------
function firstRun() {
  if (q('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  if (DEMO) return seedDemo();
  const mobile = process.env.ADMIN_MOBILE || '9999999999';
  const pin = process.env.ADMIN_PIN || String(crypto.randomInt(100000, 999999));
  createUser({ name: 'Administrator', mobile, role: 'admin', pin });
  console.log(`\nAdmin created. Mobile: ${mobile}  PIN: ${pin}  (change the PIN after logging in)\n`);
}
function seedDemo() {
  const ids = {};
  for (const [role, mobile, name, office] of [
    ['admin', '9000000000', 'Admin (System)', 'Head office'],
    ['se', '9000000001', 'S.E. Circle Jaipur', 'Circle Jaipur'],
    ['xen', '9000000002', 'XEN Division-II', 'Division-II'],
    ['aen', '9000000003', 'AEN Sub-division Sanganer', 'Sub-division Sanganer'],
    ['jen', '9000000004', 'JEN Sanganer', 'Sub-division Sanganer'],
    ['contractor', '9000000005', 'M/s Demo Constructions', ''],
    ['hq', '9000000006', 'Chief Engineer HQ (TIA)', 'PWD HQ Jaipur'],
  ]) ids[role] = createUser({ name, mobile, role, office, pin: '1234' });
  const lat = 26.8241, lng = 75.8025;
  const wid = Number(q(`INSERT INTO works (name, wo_no, office, contractor_id, jen_id, aen_id, xen_id, lat, lng, radius_m, start_date, end_date, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('C.C. road and drain, Ward 12 (demo)', 'WO/2026/145', 'Division-II', ids.contractor, ids.jen, ids.aen, ids.xen, lat, lng, 250, addDays(istDay(), -40), addDays(istDay(), 80), 'active', nowIso()).lastInsertRowid);
  // a couple of weeks of history: the JEN visits most days, the AEN rarely, the XEN once (from his office)
  const today = istDay();
  for (let i = 13; i >= 1; i--) {
    const day = addDays(today, -i);
    const ts = new Date(day + 'T05:30:00Z').toISOString();
    const add = (role, dLat, flags, status = 'confirmed') => q(`INSERT INTO visits (work_id, user_id, role, day, server_ts, client_ts, lat, lng, accuracy, distance_m, in_fence, photo, flags, contractor_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(wid, ids[role], role, day, ts, ts, lat + dLat, lng, 12, Math.round(haversine(lat + dLat, lng, lat, lng)), Math.abs(dLat) < 0.002 ? 1 : 0, null, flags, status);
    if (i % 3 !== 0) add('jen', 0.0004, '');
    if (i === 9) add('aen', 0.0006, '');
    if (i === 4) add('xen', 0.05, 'outside_fence', 'disputed');
    if (i % 2 === 0) q(`INSERT INTO dprs (work_id, user_id, day, server_ts, work_done, labour, materials, contractor_status) VALUES (?,?,?,?,?,?,?,?)`)
      .run(wid, ids.jen, day, ts, 'CC M-20 laid, chainage ' + (i * 20) + ' to ' + (i * 20 + 20) + ' m', '12 labour, 1 mason', 'Cement 40 bags', 'agreed');
  }
  // work order of ₹10 lakh with BOQ; the contractor has uploaded daily work, crossing 10% two days ago
  q("UPDATE works SET wo_amount = 1000000, tia = 'Chief Engineer, PWD Jaipur', created_by = ? WHERE id = ?").run(ids.contractor, wid);
  const it = [['1.01', 'Earthwork in excavation for drain', 'cum', 400, 210], ['4.12', 'CC M-20 in road, 150 mm thick', 'cum', 300, 2500], ['5.03', 'RCC drain M-25 including steel', 'rm', 250, 600]]
    .map(([code, d, u, qty, rate]) => Number(q('INSERT INTO work_items (work_id, code, description, unit, qty, rate) VALUES (?,?,?,?,?,?)').run(wid, code, d, u, qty, rate).lastInsertRowid));
  let claimed = 0;
  const s0 = getSettings();
  for (const [daysAgo, item, qty] of [[6, 0, 120], [5, 0, 110], [4, 1, 12], [3, 1, 14], [2, 1, 16], [1, 2, 20]]) {
    const ts = new Date(Date.now() - daysAgo * 86400e3 - 3 * 3600e3).toISOString();
    const rate = [210, 2500, 600][item];
    const pid = Number(q(`INSERT INTO progress (work_id, user_id, day, server_ts, lat, lng, accuracy, distance_m, in_fence, note, photos, amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(wid, ids.contractor, istDay(new Date(ts)), ts, lat + 0.0003, lng, 9, 33, 1, '', '[]', qty * rate).lastInsertRowid);
    q('INSERT INTO progress_lines (progress_id, item_id, qty) VALUES (?,?,?)').run(pid, it[item], qty);
    const before = claimed; claimed += qty * rate;
    const w0 = q('SELECT * FROM works WHERE id = ?').get(wid);
    const vid = maybeCreateVerification(w0, before, claimed, s0);
    if (vid) q('UPDATE verifications SET created_ts = ?, jen_due_ts = ? WHERE id = ?').run(ts, addHours(ts, s0.jen_verify_hours), vid);
  }
  // contract timeline: awarded 52 days ago, work order 12 days later (2 days late), 28 days to complete.
  // The drawing for the drain was not given for 13 days; the XEN never answered the hindrance, so it is deemed accepted.
  q("UPDATE works SET award_date = ?, wo_date = ?, duration_days = 28, start_date = '', end_date = '', department = 'PWD' WHERE id = ?").run(addDays(today, -52), addDays(today, -40), wid);
  q(`INSERT INTO hindrances (work_id, raised_by, category, description, responsible_role, from_day, to_day, created_ts, response_due_day) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(wid, ids.contractor, 'drawing_decision', 'Drain ki RCC drawing aur level nahi diye; kaam ruka raha', 'xen', addDays(today, -20), addDays(today, -8), new Date(Date.now() - 19 * 86400e3).toISOString(), addDays(today, -12));
  // a second work: awarded 14 days ago, the work order still not issued
  const w2 = Number(q(`INSERT INTO works (name, wo_no, office, contractor_id, jen_id, aen_id, xen_id, lat, lng, radius_m, status, created_at, wo_amount, tia, award_date, duration_days, department)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('School boundary wall, Bagru (demo)', '', 'Division-II', ids.contractor, ids.jen, ids.aen, ids.xen, 26.81, 75.54, 150, 'active', nowIso(), 640000, 'Chief Engineer, PWD Jaipur', addDays(today, -14), 60, 'PWD').lastInsertRowid);
  q('INSERT INTO work_items (work_id, code, description, unit, qty, rate) VALUES (?,?,?,?,?,?)').run(w2, '3.02', 'Stone masonry in CM 1:6', 'cum', 160, 4000);
  q("UPDATE visits SET contractor_note = 'XEN site par nahi aaye; office se haziri lagai' WHERE contractor_status = 'disputed'").run();
  const mk = (type, title, daysAgo, sla) => {
    const created = new Date(Date.now() - daysAgo * 86400e3).toISOString();
    const id = Number(q(`INSERT INTO requests (work_id, raised_by, type, title, details, amount, sla_days, created_ts, due_day, status, stage) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(wid, ids.contractor, type, title, '', type === 'bill' ? 1840000 : null, sla, created, addDays(istDay(new Date(created)), sla), 'open', type === 'bill' ? 'submitted' : '').lastInsertRowid);
    q('INSERT INTO request_events (request_id, user_id, ts, action, note) VALUES (?,?,?,?,?)').run(id, ids.contractor, created, 'raised', '');
  };
  mk('measurement', 'Drain RCC work chainage 0-180 m: please record measurement in MB', 12, 7);
  mk('bill', '2nd running bill', 25, 15);
  mk('inspection', 'Sub-grade ready, inspection needed before CC', 1, 3);
  console.log('\nDemo data created. Every demo user has PIN 1234:');
  console.log('  admin 9000000000 · HQ/TIA 9000000006 · SE 9000000001 · XEN 9000000002 · AEN 9000000003 · JEN 9000000004 · contractor 9000000005\n');
}

firstRun();
weeklyVerifications();
dailyTick();
setInterval(() => { weeklyVerifications(); dailyTick(); }, 10 * 60e3).unref();
server.listen(PORT, () => console.log(`SiteSaakshi running at http://localhost:${PORT}`));
module.exports = { server, haversine, weekStart };
