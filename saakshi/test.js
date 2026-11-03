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
const srv = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--demo'], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'inherit'] });

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

  const works = (await jen('GET', '/api/works')).data;
  assert.equal(works.length, 1);
  const w = works[0];

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

  console.log('All tests passed');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
