'use strict';
// End-to-end API test. Starts the server on a temporary database with demo data.
//   node test.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saakshi-test-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--demo'], { env: { ...process.env, PORT, DATA_DIR: dir, QUIET: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });

// a real-looking JPEG payload (random bytes are fine: the server only checks type, size and hash)
const fakePhoto = () => 'data:image/jpeg;base64,' + require('node:crypto').randomBytes(4000).toString('base64');

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
}
async function login(mobile) { const c = client(); const r = await c('POST', '/api/login', { mobile, pin: '1234' }); assert.equal(r.status, 200, 'login ' + mobile); return c; }

async function main() {
  await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('running') && res()));
  const anon = client();
  assert.equal((await anon('GET', '/api/works')).status, 401);
  assert.equal((await anon('POST', '/api/login', { mobile: '9000000004', pin: '0000' })).status, 401);

  const jen = await login('9000000004');
  const aen = await login('9000000003');
  const xen = await login('9000000002');
  const con = await login('9000000005');
  const se = await login('9000000001');
  const admin = await login('9000000000');
  const hq = await login('9000000006');

  const works = (await jen('GET', '/api/works')).data;
  assert.equal(works.length, 2);
  const w = works.find((x) => x.name.startsWith('C.C. road'));

  // inside the fence with a live photo: counts
  let r = await jen('POST', '/api/visits', { work_id: w.id, lat: w.lat + 0.0005, lng: w.lng, accuracy: 15, photo: fakePhoto(), client_ts: new Date().toISOString() });
  assert.equal(r.status, 201); assert.equal(r.data.in_fence, true); assert.equal(r.data.counts, true);
  const visitId = r.data.id;

  // from the office, 5 km away: recorded, flagged, not counted
  r = await aen('POST', '/api/visits', { work_id: w.id, lat: w.lat + 0.045, lng: w.lng, accuracy: 10, photo: fakePhoto() });
  assert.equal(r.status, 201); assert.equal(r.data.in_fence, false); assert.equal(r.data.counts, false);
  assert.ok(r.data.flags.includes('outside_fence'));

  // the same photo used again: flagged as reused
  const p = fakePhoto();
  await xen('POST', '/api/visits', { work_id: w.id, lat: w.lat, lng: w.lng, accuracy: 10, photo: p });
  r = await xen('POST', '/api/visits', { work_id: w.id, lat: w.lat, lng: w.lng, accuracy: 10, photo: p });
  assert.ok(r.data.flags.includes('photo_reused')); assert.equal(r.data.counts, false);

  // bad GPS accuracy: not counted
  r = await xen('POST', '/api/visits', { work_id: w.id, lat: w.lat, lng: w.lng, accuracy: 900, photo: fakePhoto() });
  assert.ok(r.data.flags.includes('low_accuracy'));

  // a contractor cannot mark attendance, and an officer cannot for a work they are not on
  assert.equal((await con('POST', '/api/visits', { work_id: w.id, lat: w.lat, lng: w.lng, accuracy: 5, photo: fakePhoto() })).status, 403);

  // contractor disputes the JEN visit: it stops counting
  assert.equal((await con('POST', `/api/visits/${visitId}/respond`, { status: 'disputed' })).status, 400, 'reason needed');
  assert.equal((await con('POST', `/api/visits/${visitId}/respond`, { status: 'disputed', note: 'site par nahi aaye' })).status, 200);
  const vis = (await se('GET', '/api/visits')).data.find((v) => v.id === visitId);
  assert.equal(vis.counts, false);
  assert.equal((await con('POST', `/api/visits/${visitId}/respond`, { status: 'confirmed' })).status, 400, 'answer is final');

  // checkout
  r = await xen('POST', '/api/visits', { work_id: w.id, lat: w.lat, lng: w.lng, accuracy: 10, photo: fakePhoto() });
  assert.equal((await xen('POST', `/api/visits/${r.data.id}/checkout`, { lat: w.lat, lng: w.lng })).status, 200);
  assert.equal((await xen('POST', `/api/visits/${r.data.id}/checkout`, { lat: w.lat, lng: w.lng })).status, 400);

  // DPR: only the JEN, once a day, for today
  assert.equal((await aen('POST', '/api/dprs', { work_id: w.id, work_done: 'x' })).status, 403);
  r = await jen('POST', '/api/dprs', { work_id: w.id, work_done: 'CC laid 20 m', labour: '10', lat: w.lat, lng: w.lng, accuracy: 10 });
  assert.equal(r.status, 201); assert.equal(r.data.distance_m, 0);
  assert.equal((await jen('POST', '/api/dprs', { work_id: w.id, work_done: 'again' })).status, 409);
  const dpr = (await con('GET', '/api/dprs')).data[0];
  assert.equal((await con('POST', `/api/dprs/${dpr.id}/respond`, { status: 'agreed' })).status, 200);

  // measurement request: officer marks done with MB reference, contractor reopens, then closes
  r = await con('POST', '/api/requests', { work_id: w.id, type: 'measurement', title: 'Measure drain', details: 'ch 0-100' });
  assert.equal(r.status, 201);
  const rid = r.data.id;
  assert.equal((await jen('POST', `/api/requests/${rid}/action`, { action: 'done' })).status, 400, 'note needed');
  assert.equal((await jen('POST', `/api/requests/${rid}/action`, { action: 'done', note: 'MB 245 p 12' })).status, 200);
  assert.equal((await con('POST', `/api/requests/${rid}/action`, { action: 'reopen', note: 'only half measured' })).status, 200);
  assert.equal((await jen('POST', `/api/requests/${rid}/action`, { action: 'done', note: 'MB 245 p 13-14' })).status, 200);
  assert.equal((await con('POST', `/api/requests/${rid}/action`, { action: 'close' })).status, 200);
  const detail = (await con('GET', `/api/requests/${rid}`)).data;
  assert.deepEqual(detail.events.map((e) => e.action), ['raised', 'done', 'reopen', 'done', 'close']);

  // bill stages move forward only
  r = await con('POST', '/api/requests', { work_id: w.id, type: 'bill', title: '3rd RA bill', amount: 500000 });
  const bid = r.data.id;
  assert.equal((await jen('POST', `/api/requests/${bid}/action`, { action: 'stage', stage: 'mb_recorded' })).status, 200);
  assert.equal((await jen('POST', `/api/requests/${bid}/action`, { action: 'stage', stage: 'submitted' })).status, 400);

  // the overdue demo requests show up and are escalated
  const dash = (await se('GET', '/api/dashboard')).data;
  assert.ok(dash.requests.overdue.length >= 2, 'overdue requests');
  assert.ok(dash.requests.overdue.some((x) => x.escalated_to === 'se'));
  assert.ok(dash.compliance.some((c) => c.role === 'jen'));
  const lastWeek = (await se('GET', '/api/dashboard?week=' + new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10))).data;
  const xenRow = lastWeek.compliance.find((c) => c.role === 'xen');
  assert.equal(xenRow.status, 'short', 'XEN from the office does not count');

  // complaints: visible to SE, hidden from officers
  assert.equal((await con('POST', '/api/complaints', { work_id: w.id, text: 'Bill ke liye paise maange' })).status, 201);
  assert.equal((await xen('GET', '/api/complaints')).status, 403);
  assert.equal((await se('GET', '/api/complaints')).data.length, 1);

  // admin only: settings; SE cannot create an admin
  assert.equal((await se('PUT', '/api/settings', { min_visit_minutes: 30 })).status, 403);
  assert.equal((await admin('PUT', '/api/settings', { min_visit_minutes: 30 })).status, 200);
  assert.equal((await se('POST', '/api/users', { name: 'x', mobile: '9111111111', role: 'admin', pin: '1234' })).status, 403);

  // the fence move is in the audit log with the old position
  await admin('PUT', '/api/works/' + w.id, { lat: w.lat + 1 });
  const log = (await admin('GET', '/api/audit')).data;
  assert.equal(JSON.parse(log.find((a) => a.action === 'work_updated').detail).before.lat, w.lat);

  // CSV and photos need a login
  assert.ok(String((await se('GET', '/api/dashboard?format=csv')).data).includes('officer'));
  const photoHash = (await se('GET', '/api/visits')).data.find((v) => v.photo).photo;
  assert.equal((await se('GET', '/photo/' + photoHash)).status, 200);
  assert.equal((await anon('GET', '/photo/' + photoHash)).status, 401);
  assert.equal((await anon('GET', '/../server.js')).status, 404);

  // ---- self sign-up by OTP, project creation with officers assigned on the spot ----
  const newCon = client();
  r = await newCon('POST', '/api/otp/send', { mobile: '9800000001' });
  assert.equal(r.status, 200); assert.equal(r.data.existing, null); assert.ok(r.data.dev_otp);
  assert.equal((await newCon('POST', '/api/otp/verify', { mobile: '9800000001', code: '000000', pin: '4321', name: 'Ram', role: 'contractor' })).status, 400);
  r = await newCon('POST', '/api/otp/verify', { mobile: '9800000001', code: r.data.dev_otp, pin: '4321', name: 'M/s Ram Builders', role: 'contractor' });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'contractor');
  assert.equal((await newCon('POST', '/api/otp/verify', { mobile: '9800000002', code: '1', pin: '4321', name: 'x', role: 'admin' })).status, 400);

  const site = { lat: 26.9, lng: 75.8 };
  // JEN mobile already belongs to the AEN: refused
  assert.equal((await newCon('POST', '/api/projects', { name: 'P', award_date: '2026-01-01', wo_amount: 1000000, ...site, radius_m: 200, jen: { name: 'x', mobile: '9000000003' }, aen: { name: 'y', mobile: '9800000011' }, items: [{ description: 'a', unit: 'cum', qty: 10, rate: 100 }] })).status, 400);
  r = await newCon('POST', '/api/projects', {
    name: 'Village road Kotputli', wo_no: 'WO/77', wo_date: new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10), duration_days: 60, wo_amount: 1000000, tia: 'CE PWD Jaipur', ...site, radius_m: 200,
    jen: { name: 'New JEN', mobile: '9800000010' }, aen: { name: 'AEN Sanganer', mobile: '9000000003' },
    items: [{ code: '1', description: 'Earthwork', unit: 'cum', qty: 1000, rate: 200 }, { code: '2', description: 'CC M-20', unit: 'cum', qty: 320, rate: 2500 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const pid = r.data.id;
  assert.deepEqual(r.data.new_accounts.map((a) => a.role), ['jen'], 'only the new JEN is created; the existing AEN is reused');
  assert.ok((await aen('GET', '/api/works')).data.some((x) => x.id === pid), 'existing AEN is assigned at once');
  // the new JEN cannot log in with a PIN yet, only by OTP
  const nj = client();
  assert.equal((await nj('POST', '/api/login', { mobile: '9800000010', pin: '1234' })).status, 401);
  r = await nj('POST', '/api/otp/send', { mobile: '9800000010' });
  assert.equal(r.data.existing.role, 'jen');
  assert.equal((await nj('POST', '/api/otp/verify', { mobile: '9800000010', code: r.data.dev_otp, pin: '5555' })).status, 200);
  assert.ok((await nj('GET', '/api/works')).data.some((x) => x.id === pid));
  assert.ok((await admin('GET', '/api/flags')).data.every((f) => f.type !== 'officer_not_joined' || f.work_id !== pid || f.against_role !== 'jen'));

  // ---- contractor's daily updates; crossing 10% makes a verification with a 24 h deadline ----
  const its = (await newCon('GET', '/api/works/' + pid)).data.items;
  const up = (lines, extra = {}) => newCon('POST', '/api/progress', { work_id: pid, lines, photos: [fakePhoto()], lat: site.lat, lng: site.lng, accuracy: 8, ...extra });
  assert.equal((await newCon('POST', '/api/progress', { work_id: pid, lines: [{ item_id: its[0].id, qty: 5 }], photos: [], ...site, accuracy: 8 })).status, 400, 'photo required');
  r = await up([{ item_id: its[0].id, qty: 200 }]); // ₹40,000
  assert.equal(r.status, 201); assert.equal(r.data.verification_id, null);
  r = await up([{ item_id: its[1].id, qty: 30 }]); // +₹75,000 = ₹1,15,000 → crosses 10%
  assert.ok(r.data.verification_id); assert.equal(r.data.jen_due_hours, 24);
  const vid = r.data.verification_id;
  r = await up([{ item_id: its[0].id, qty: 1 }], { lat: site.lat + 0.1 });
  assert.ok(r.data.flags.includes('outside_fence'));
  assert.equal((await nj('POST', '/api/progress', { work_id: pid, lines: [{ item_id: its[0].id, qty: 1 }], photos: [fakePhoto()], ...site })).status, 403);

  // ---- JEN must measure at the site; AEN approves ----
  const lines = [{ item_id: its[0].id, measured_qty: 200 }, { item_id: its[1].id, measured_qty: 20 }];
  assert.equal((await nj('POST', `/api/verifications/${vid}/measure`, { lines, photo: fakePhoto(), lat: site.lat + 0.05, lng: site.lng, accuracy: 8 })).status, 400, 'not from the office');
  assert.equal((await nj('POST', `/api/verifications/${vid}/measure`, { lines: lines.slice(0, 1), photo: fakePhoto(), ...site, accuracy: 8 })).status, 400, 'every claimed item');
  assert.equal((await aen('POST', `/api/verifications/${vid}/approve`, { decision: 'approved' })).status, 400, 'JEN first');
  r = await nj('POST', `/api/verifications/${vid}/measure`, { lines, photo: fakePhoto(), ...site, accuracy: 8, note: 'MB 12 p 4' });
  assert.equal(r.status, 200); assert.equal(r.data.status, 'pending_aen');
  assert.equal(r.data.measured_amount, 200 * 200 + 20 * 2500);
  assert.equal(r.data.overclaim, true, '₹90,000 measured against ₹1,15,000 claimed');
  let flags = (await hq('GET', '/api/flags')).data;
  assert.ok(flags.some((f) => f.work_id === pid && f.type === 'contractor_overclaim'), 'HQ sees the contractor over-claim');
  assert.equal((await aen('POST', `/api/verifications/${vid}/approve`, { decision: 'returned' })).status, 400, 'reason needed');
  assert.equal((await aen('POST', `/api/verifications/${vid}/approve`, { decision: 'returned', note: 'CC re-measure' })).status, 200);
  assert.equal((await nj('POST', `/api/verifications/${vid}/measure`, { lines: [{ item_id: its[0].id, measured_qty: 200 }, { item_id: its[1].id, measured_qty: 30 }], photo: fakePhoto(), ...site, accuracy: 8 })).status, 200);
  assert.equal((await aen('POST', `/api/verifications/${vid}/approve`, { decision: 'approved', note: 'ok' })).status, 200);
  assert.equal((await newCon('POST', `/api/verifications/${vid}/respond`, { status: 'agreed' })).status, 200);
  const pw = (await newCon('GET', '/api/works/' + pid)).data;
  assert.equal(pw.approved_amount, 115000); assert.equal(pw.verifications[0].rounds, 2);
  assert.ok(!pw.flags.some((f) => f.type === 'contractor_overclaim'), 'flag clears once the measurement matches');

  // ---- bills from verified quantities, whenever the contractor wants ----
  r = await newCon('POST', '/api/bills', { work_id: pid });
  assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.net_amount, 115000); assert.equal(r.data.bill_no, 1);
  const bill1 = r.data.id;
  assert.equal((await newCon('POST', '/api/bills', { work_id: pid })).status, 400, 'no new verified work since the last bill');
  assert.equal((await newCon('POST', '/api/bills', { work_id: pid, final: true })).status, 400, 'final needs completion');
  assert.equal((await nj('POST', `/api/bills/${bill1}/action`, { action: 'pass' })).status, 400, 'JEN cannot pass a bill');
  assert.equal((await se('POST', `/api/bills/${bill1}/action`, { action: 'pass' })).status, 200);
  assert.equal((await se('POST', `/api/bills/${bill1}/action`, { action: 'paid' })).status, 400, 'payment reference needed');
  assert.equal((await se('POST', `/api/bills/${bill1}/action`, { action: 'paid', ref: 'UTR123' })).status, 200);
  // more work, a measurement on demand, the second bill only for the new part
  await up([{ item_id: its[0].id, qty: 50 }]);
  r = await newCon('POST', `/api/works/${pid}/request-verification`, {});
  assert.equal(r.status, 201);
  assert.equal((await newCon('POST', `/api/works/${pid}/request-verification`, {})).status, 400, 'one at a time');
  await nj('POST', `/api/verifications/${r.data.id}/measure`, { lines: [{ item_id: its[0].id, measured_qty: 251 }, { item_id: its[1].id, measured_qty: 30 }], photo: fakePhoto(), ...site, accuracy: 8 });
  await aen('POST', `/api/verifications/${r.data.id}/approve`, { decision: 'approved' });
  r = await newCon('POST', '/api/bills', { work_id: pid });
  assert.equal(r.data.bill_no, 2); assert.equal(r.data.net_amount, 51 * 200);

  // ---- completion: final measurement, final bill, approval by the top authority ----
  r = await newCon('POST', `/api/works/${pid}/complete`, {});
  assert.equal(r.status, 200); const fv = r.data.verification_id;
  assert.equal((await newCon('POST', '/api/bills', { work_id: pid, final: true })).status, 400, 'final measurement not yet approved');
  await nj('POST', `/api/verifications/${fv}/measure`, { lines: [{ item_id: its[0].id, measured_qty: 251 }, { item_id: its[1].id, measured_qty: 31 }], photo: fakePhoto(), ...site, accuracy: 8 });
  await aen('POST', `/api/verifications/${fv}/approve`, { decision: 'approved' });
  r = await newCon('POST', '/api/bills', { work_id: pid, final: true });
  assert.equal(r.status, 201); assert.equal(r.data.net_amount, 2500);
  const fbill = r.data.id;
  assert.equal((await se('POST', `/api/bills/${fbill}/action`, { action: 'pass' })).status, 400, 'final goes to the top authority');
  assert.equal((await hq('POST', `/api/bills/${fbill}/action`, { action: 'hq_approve', note: 'verified' })).status, 200);
  assert.equal((await hq('POST', `/api/bills/${fbill}/action`, { action: 'paid', ref: 'UTR999' })).status, 200);
  assert.equal((await newCon('POST', '/api/bills', { work_id: pid })).status, 400, 'no bill after the final');

  // ---- hindrance: officer objects, the top authority decides, the extension follows ----
  const fromDay = new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10);
  r = await newCon('POST', '/api/hindrances', { work_id: pid, category: 'work_not_shown', description: 'JEN ne layout nahi diya', from_day: fromDay });
  assert.equal(r.status, 201);
  const hid = r.data.id;
  assert.equal((await nj('POST', `/api/hindrances/${hid}/respond`, { decision: 'disputed' })).status, 400, 'reason needed');
  assert.equal((await nj('POST', `/api/hindrances/${hid}/respond`, { decision: 'disputed', note: 'layout diya tha, register dekhein' })).status, 200);
  let tl = (await newCon('GET', '/api/works/' + pid)).data.timeline;
  assert.ok(tl.extension_days >= 6, 'a disputed hindrance keeps counting until decided');
  assert.equal(tl.penalty_applicable ?? false, false);
  assert.equal((await nj('POST', `/api/hindrances/${hid}/decide`, { decision: 'rejected', note: 'x' })).status, 403);
  assert.equal((await hq('POST', `/api/hindrances/${hid}/decide`, { decision: 'rejected', note: 'register me layout entry hai' })).status, 200);
  tl = (await newCon('GET', '/api/works/' + pid)).data.timeline;
  assert.equal(tl.extension_days, 0, 'rejected: no extension');

  // demo work: the XEN never answered the hindrance → deemed accepted → extension, no penalty
  const demo = (await con('GET', '/api/works/' + w.id)).data.timeline;
  assert.equal(demo.extension_days, 13); assert.equal(demo.contractor_delay_days, 0); assert.equal(demo.wo_late_days, 2);
  assert.ok(demo.hindrances.some((h) => h.state === 'deemed'));

  // ---- award without a work order: red flag on the XEN until it is issued ----
  const award = new Date(Date.now() - 15 * 86400e3).toISOString().slice(0, 10);
  r = await newCon('POST', '/api/projects', { name: 'Awarded only', award_date: award, duration_days: 30, wo_amount: 100000, ...site, radius_m: 200,
    jen: { mobile: '9800000010' }, aen: { mobile: '9000000003' }, xen: { mobile: '9000000002' }, items: [{ description: 'x', unit: 'no', qty: 10, rate: 10000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const aw = r.data.id;
  assert.ok((await hq('GET', '/api/flags')).data.some((f) => f.work_id === aw && f.type === 'wo_not_issued' && f.against_role === 'xen'));
  assert.equal((await newCon('POST', `/api/works/${aw}/issue-wo`, { wo_no: 'X' })).status, 403);
  assert.equal((await xen('POST', `/api/works/${aw}/issue-wo`, { wo_no: 'WO/99' })).status, 200);
  const flagsAfter = (await hq('GET', '/api/flags')).data;
  assert.ok(!flagsAfter.some((f) => f.work_id === aw && f.type === 'wo_not_issued'));
  assert.equal((await xen('GET', '/api/works/' + aw)).data.timeline.wo_late_days, 5);

  // ---- the department's list imported in one go ----
  r = await se('POST', '/api/users/import', { text: 'Suresh JEN, 9700000001, jen, PWD, EMP1\nBad line\nRam, 9000000004, jen, PWD\nM/s Shiv, 9700000002, contractor, PWD, AA/123' });
  assert.equal(r.data.added, 2); assert.equal(r.data.skipped.length, 2);

  // ---- the demo work has a 10% milestone the JEN never measured: red flag up to HQ ----
  flags = (await hq('GET', '/api/flags')).data;
  assert.ok(flags.some((f) => f.type === 'jen_not_verified' && f.severity === 'high' && f.tia));
  assert.ok((await con('GET', '/api/flags')).data.some((f) => f.type === 'jen_not_verified'), 'contractor sees it too');
  assert.ok(!(await newCon('GET', '/api/flags')).data.some((f) => f.work_id !== pid), 'others only see their own works');

  // officer objects to being assigned
  assert.equal((await nj('POST', `/api/works/${pid}/dispute`, { note: 'Yeh mera kshetra nahi' })).status, 201);
  assert.ok((await hq('GET', '/api/flags')).data.some((f) => f.type === 'assignment_disputed'));

  // ---- public portal: works and stats for citizens, with no person's name or mobile ----
  r = await anon('GET', '/api/public/overview');
  assert.equal(r.status, 200); assert.equal(r.data.enabled, true);
  assert.ok(r.data.works.length >= 3); assert.ok(r.data.stats.bills_paid >= 1);
  assert.ok(r.data.works.some((x) => x.contractor === 'M/s Demo Constructions' && x.jen === 'JEN Sanganer'), 'names are public');
  // the whole public surface: names yes; mobile numbers, selfies, complaints never
  const pubWork = (await anon('GET', '/api/public/works/' + pid)).data;
  assert.equal(pubWork.people.contractor.name, 'M/s Ram Builders');
  assert.ok(pubWork.updates.some((e) => e.kind === 'measured') && pubWork.updates.some((e) => e.kind === 'paid') && pubWork.updates.some((e) => e.kind === 'progress' && e.photos.length));
  const people = [(await anon('GET', '/api/public/people?kind=officers')).data, (await anon('GET', '/api/public/people?kind=contractors')).data];
  assert.ok(people[0].some((p) => p.name === 'JEN Sanganer' && p.red_flags > 0));
  assert.ok(people[1].some((p) => p.name === 'M/s Ram Builders' && p.measurements >= 3 && p.completed === 1));
  const updates = (await anon('GET', '/api/public/updates')).data;
  assert.ok(updates.length > 5);
  const pub = JSON.stringify([r.data, pubWork, people, updates, (await anon('GET', '/api/public/works/' + w.id)).data]);
  for (const leak of ['9000000004', '9800000001', '9800000010', '9000000005', '"mobile"', 'pin_hash', 'Bill ke liye paise maange', photoHash]) assert.ok(!pub.includes(leak), 'public data leaks ' + leak);
  // site photos from work updates are public; attendance selfies are not
  const sitePhoto = pubWork.updates.find((e) => e.photos?.length).photos[0];
  assert.equal((await anon('GET', '/api/public/photo/' + sitePhoto)).status, 200);
  assert.equal((await anon('GET', '/api/public/photo/' + photoHash)).status, 404);
  assert.ok(r.data.works.find((x) => x.name === 'Awarded only').wo_date);
  await admin('PUT', '/api/settings', { public_board: false });
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal((await anon('GET', '/api/public/overview')).data.enabled, false);
  assert.equal((await anon('GET', '/api/public/works/' + pid)).status, 404);
  const home = await anon('GET', '/');
  assert.equal(home.status, 200);

  console.log('All tests passed');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
