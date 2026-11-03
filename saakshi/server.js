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

const ROLES = ['admin', 'se', 'xen', 'aen', 'jen', 'contractor'];
const OFFICER_ROLES = ['xen', 'aen', 'jen'];
const OVERSIGHT = ['admin', 'se'];
const REQUEST_TYPES = ['measurement', 'bill', 'inspection', 'decision', 'other'];
const BILL_STAGES = ['submitted', 'mb_recorded', 'checked_aen', 'passed_xen', 'paid'];
const DEFAULT_SETTINGS = {
  visits_per_week: { jen: 6, aen: 3, xen: 2 },
  sla_days: { measurement: 7, bill: 15, inspection: 3, decision: 7, other: 7 },
  max_gps_accuracy_m: 100,
  min_visit_minutes: 0,
  escalate_after_days: 7,
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
CREATE INDEX IF NOT EXISTS visits_work_day ON visits(work_id, day);
CREATE INDEX IF NOT EXISTS visits_photo ON visits(photo);
`);
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
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
const failedLogins = new Map(); // mobile -> {count, until}

function createUser({ name, mobile, role, office = '', pin }) {
  if (!name || !/^\d{10}$/.test(String(mobile))) throw httpErr(400, 'नाम और 10 अंकों का मोबाइल नंबर ज़रूरी है');
  if (!ROLES.includes(role)) throw httpErr(400, 'गलत भूमिका (role)');
  if (!/^\d{4,8}$/.test(String(pin))) throw httpErr(400, 'PIN 4 से 8 अंकों का हो');
  if (q('SELECT id FROM users WHERE mobile = ?').get(String(mobile))) throw httpErr(409, 'यह मोबाइल नंबर पहले से दर्ज है');
  const r = q('INSERT INTO users (name, mobile, role, office, pin_hash, created_at) VALUES (?,?,?,?,?,?)')
    .run(name.trim(), String(mobile), role, office, hashPin(pin), nowIso());
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
function publicUser(u) { return u && { id: u.id, name: u.name, mobile: u.mobile, role: u.role, office: u.office, active: u.active }; }

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
  for (const w of works.filter((x) => x.status === 'active')) {
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

// ---------- HTTP helpers ----------
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
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
  const f = workFields(await readJson(req), old);
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
    open_complaints: OVERSIGHT.includes(user.role) ? q("SELECT COUNT(*) AS n FROM complaints WHERE status != 'closed'").get().n : null,
  };
  if (query.format === 'csv') {
    return send(res, 200, csv(comp, ['work', 'role', 'officer', 'required', 'done', 'recorded', 'outside_fence', 'disputed', 'last_visit', 'days_since', 'status']),
      { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="attendance-${week}.csv"` });
  }
  send(res, 200, out);
});

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
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/photo/')) {
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
  console.log('  admin 9000000000 · SE 9000000001 · XEN 9000000002 · AEN 9000000003 · JEN 9000000004 · contractor 9000000005\n');
}

firstRun();
server.listen(PORT, () => console.log(`SiteSaakshi running at http://localhost:${PORT}`));
module.exports = { server, haversine, weekStart };
