'use strict';
// SiteSaakshi front end: plain JavaScript, no build step.

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE = { admin: 'Admin', se: 'S.E.', xen: 'XEN (अधिशासी अभियंता)', aen: 'AEN (सहायक अभियंता)', jen: 'JEN (कनिष्ठ अभियंता)', contractor: 'ठेकेदार' };
const ROLE_SHORT = { admin: 'Admin', se: 'SE', xen: 'XEN', aen: 'AEN', jen: 'JEN', contractor: 'ठेकेदार' };
const REQ_TYPE = { measurement: 'नाप (MB में माप)', bill: 'बिल', inspection: 'निरीक्षण / जाँच', decision: 'निर्णय / ड्रॉइंग', other: 'अन्य' };
const BILL_STAGE = { submitted: 'बिल जमा', mb_recorded: 'MB दर्ज (JEN)', checked_aen: 'जाँचा (AEN)', passed_xen: 'पास (XEN)', paid: 'भुगतान हुआ' };
const STATUS = { open: ['खुला', 'warn'], reopened: ['दोबारा खुला', 'bad'], done: ['विभाग ने पूरा बताया', 'ok'], closed: ['बंद', ''] };
const FLAG = { outside_fence: 'साइट से बाहर', low_accuracy: 'GPS कमज़ोर', photo_reused: 'पुरानी फ़ोटो', no_photo: 'फ़ोटो नहीं', clock_mismatch: 'फ़ोन का समय गलत', from_gallery: 'गैलरी से फ़ोटो' };

let me = null, settings = null, today = '', tab = '';

// ---------- api ----------
async function api(path, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && path !== '/api/login') { me = null; renderLogin(); throw new Error(data.error || 'लॉगिन करें'); }
  if (!r.ok) throw new Error(data.error || 'गड़बड़ी हुई');
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), err ? 6000 : 3500);
}
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const fmtDay = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('hi-IN', { weekday: 'short', day: '2-digit', month: 'short' }) : '';
const rupees = (n) => n == null ? '' : '₹ ' + Number(n).toLocaleString('en-IN');
const photo = (hash) => hash ? `<img class="thumb" src="/photo/${esc(hash)}" alt="फ़ोटो" data-zoom="/photo/${esc(hash)}" loading="lazy">` : '';
const mapLink = (lat, lng, label = 'नक्शा') => lat != null ? `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">${label}</a>` : '';

function dialog(html, onMount) {
  const d = $('#dlg'); $('#dlgBody').innerHTML = html; d.showModal(); if (onMount) onMount($('#dlgBody')); return d;
}
document.addEventListener('click', (e) => {
  const z = e.target.closest('[data-zoom]');
  if (z) dialog(`<img src="${esc(z.dataset.zoom)}" style="width:100%;border-radius:10px"><p><button onclick="dlg.close()">बंद करें</button></p>`);
});

// ---------- GPS and camera ----------
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('इस फ़ोन/ब्राउज़र में GPS उपलब्ध नहीं'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? 'लोकेशन की अनुमति दें (ब्राउज़र सेटिंग में)' : 'GPS लोकेशन नहीं मिली, खुले में जाकर फिर कोशिश करें')),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
  });
}
function stampAndCompress(source, w, h, lines) {
  const scale = Math.min(1, 1280 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d'); g.drawImage(source, 0, 0, c.width, c.height);
  const fs = Math.max(14, Math.round(c.width / 40));
  g.font = `600 ${fs}px system-ui, sans-serif`;
  const pad = fs * 0.5, boxH = lines.length * fs * 1.35 + pad * 2;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, c.height - boxH, c.width, boxH);
  g.fillStyle = '#fff'; lines.forEach((t, i) => g.fillText(t, pad, c.height - boxH + pad + fs * (i + 1) * 1.25));
  return c.toDataURL('image/jpeg', 0.72);
}
// Opens the live camera (not the gallery). Resolves to {dataUrl, fromGallery}.
function takePhoto(title, stampLines) {
  return new Promise((resolve, reject) => {
    let stream = null;
    const stop = () => stream && stream.getTracks().forEach((t) => t.stop());
    const d = dialog(`<h3>${esc(title)}</h3><div class="cam"><video id="camv" playsinline autoplay muted></video></div>
      <p class="small muted" id="camMsg">कैमरा खुल रहा है…</p>
      <div class="row"><button class="primary" id="camShot" disabled>📷 फ़ोटो लें</button><button id="camFlip">कैमरा बदलें</button><button id="camCancel">रद्द</button></div>
      <input type="file" id="camFile" accept="image/*" capture="user" hidden>`);
    let facing = 'user';
    const start = async () => {
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
        $('#camv').srcObject = stream; $('#camShot').disabled = false; $('#camMsg').textContent = 'चेहरा और पीछे साइट दिखे, ऐसी फ़ोटो लें।';
      } catch {
        $('#camMsg').textContent = 'लाइव कैमरा नहीं खुला। फ़ोन का कैमरा इस्तेमाल करें (यह हाज़िरी पर "गैलरी से" दर्ज होगा)।';
        $('#camShot').disabled = false; $('#camShot').onclick = () => $('#camFile').click();
      }
    };
    $('#camFlip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; start(); };
    $('#camCancel').onclick = () => { stop(); d.close(); reject(new Error('फ़ोटो रद्द की गई')); };
    $('#camShot').onclick = () => {
      const v = $('#camv');
      const url = stampAndCompress(v, v.videoWidth, v.videoHeight, stampLines());
      stop(); d.close(); resolve({ dataUrl: url, fromGallery: false });
    };
    $('#camFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => { const url = stampAndCompress(img, img.naturalWidth, img.naturalHeight, stampLines()); URL.revokeObjectURL(img.src); stop(); d.close(); resolve({ dataUrl: url, fromGallery: true }); };
      img.src = URL.createObjectURL(f);
    };
    d.addEventListener('close', stop, { once: true });
    start();
  });
}
function pickPhoto() { // optional site photo for DPR / requests (gallery allowed)
  return new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = () => {
      const f = i.files[0]; if (!f) return resolve(null);
      const img = new Image();
      img.onload = () => { resolve(stampAndCompress(img, img.naturalWidth, img.naturalHeight, [me.name + ' · ' + new Date().toLocaleString('hi-IN')])); URL.revokeObjectURL(img.src); };
      img.src = URL.createObjectURL(f);
    };
    i.click();
  });
}

// ---------- shell ----------
function renderLogin() {
  $('#tabs').hidden = true; $('#who').innerHTML = '';
  $('#main').innerHTML = `<div class="card login"><h2>लॉगिन</h2>
    <label>मोबाइल नंबर</label><input id="lm" inputmode="numeric" maxlength="10" autocomplete="username">
    <label>PIN</label><input id="lp" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password">
    <p><button class="primary big" id="lb">लॉगिन करें</button></p>
    <p class="small muted">खाता विभाग (Admin / S.E. कार्यालय) बनाता है। PIN भूल गए तो Admin से नया PIN लें।</p></div>`;
  const go = () => busy($('#lb'), async () => { await api('/api/login', { mobile: $('#lm').value.trim(), pin: $('#lp').value }); await boot(); });
  $('#lb').onclick = go; $('#lp').onkeydown = (e) => e.key === 'Enter' && go();
}
function tabsFor(role) {
  const t = [['dash', 'डैशबोर्ड'], ['works', 'काम']];
  if (['jen', 'aen', 'xen'].includes(role)) t.unshift(['attend', 'हाज़िरी लगाएँ']);
  t.push(['visits', role === 'contractor' ? 'हाज़िरी पुष्टि' : 'हाज़िरी रिकॉर्ड']);
  t.push(['dpr', role === 'jen' ? 'आज की DPR' : 'DPR']);
  t.push(['requests', role === 'contractor' ? 'नाप / बिल अनुरोध' : 'अनुरोध']);
  if (['contractor', 'se', 'admin'].includes(role)) t.push(['complaints', 'शिकायत']);
  if (['se', 'admin'].includes(role)) t.push(['admin', 'प्रबंधन']);
  t.push(['account', 'मेरा खाता']);
  return t;
}
function renderShell() {
  $('#who').innerHTML = `${esc(me.name)}<br><span style="opacity:.8">${esc(ROLE[me.role])}</span>`;
  const nav = $('#tabs'); nav.hidden = false;
  const tabs = tabsFor(me.role);
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  nav.innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
  nav.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; location.hash = tab; renderShell(); } };
  show();
}
async function show() {
  const main = $('#main');
  main.innerHTML = '<p class="muted center">लोड हो रहा है…</p>';
  try { await VIEWS[tab](main); } catch (e) { main.innerHTML = `<p class="pill bad">${esc(e.message)}</p>`; }
}
async function boot() {
  try {
    const r = await api('/api/me'); me = r.user; settings = r.settings; today = r.today;
    tab = location.hash.slice(1) || ''; renderShell();
  } catch { renderLogin(); }
}

// ---------- views ----------
const VIEWS = {};

VIEWS.dash = async (main, week) => {
  const d = await api('/api/dashboard' + (week ? '?week=' + week : ''));
  const c = d.compliance;
  const short = c.filter((r) => r.status === 'short').length;
  const statusPill = (r) => r.status === 'ok' ? '<span class="pill ok">पूरा</span>' : r.status === 'due' ? '<span class="pill warn">बाकी</span>' : '<span class="pill bad">कम</span>';
  main.innerHTML = `
    <div class="spread"><h2>सप्ताह ${fmtDay(d.week)} – ${fmtDay(d.week_end)}</h2>
      <div class="row"><button id="prevW">← पिछला</button><button id="nextW">अगला →</button><a class="btn" href="/api/dashboard?format=csv&week=${d.week}">Excel (CSV)</a></div></div>
    ${d.pending_visit_confirmations ? `<div class="notice">आपके कामों पर <b>${d.pending_visit_confirmations}</b> हाज़िरियाँ आपकी पुष्टि का इंतज़ार कर रही हैं। <a href="#visits" data-go="visits">देखें</a></div>` : ''}
    <div class="stats">
      <div class="stat"><b>${c.filter((r) => r.status === 'ok').length}/${c.length}</b><span>अधिकारी-काम जिनकी हाज़िरी पूरी</span></div>
      <div class="stat"><b style="color:var(--bad)">${short}</b><span>हाज़िरी कम (अब पूरी नहीं हो सकती)</span></div>
      <div class="stat"><b>${d.missing_dprs.reduce((n, m) => n + m.missing.length, 0)}</b><span>DPR नहीं डाली गई (दिन)</span></div>
      <div class="stat"><b style="color:var(--bad)">${d.requests.overdue.length}</b><span>नाप/बिल अनुरोध समय-सीमा पार</span></div>
      ${d.open_complaints != null ? `<div class="stat"><b>${d.open_complaints}</b><span>खुली शिकायतें</span></div>` : ''}
    </div>
    <div class="card"><h3>साइट हाज़िरी: नियम ${Object.entries(settings.visits_per_week).map(([k, v]) => `${ROLE_SHORT[k]} ${v}/सप्ताह`).join(' · ')}</h3>
      <div class="table-wrap"><table><thead><tr><th>काम</th><th>अधिकारी</th><th>गिनी गई / ज़रूरी</th><th>साइट से बाहर</th><th>आपत्ति</th><th>आख़िरी असली विज़िट</th><th></th></tr></thead><tbody>
      ${c.map((r) => `<tr class="${r.status === 'short' ? 'bad' : r.status === 'due' ? 'warn' : ''}"><td>${esc(r.work)}</td><td>${esc(r.officer)} <span class="muted small">${ROLE_SHORT[r.role]}</span></td>
        <td><b>${r.done}</b> / ${r.required}</td><td>${r.outside_fence || ''}</td><td>${r.disputed || ''}</td>
        <td>${r.last_visit ? `${fmtDay(r.last_visit)} <span class="muted small">(${r.days_since} दिन पहले)</span>` : '<span class="pill bad">कभी नहीं</span>'}</td><td>${statusPill(r)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">कोई सक्रिय काम नहीं</td></tr>'}
      </tbody></table></div>
      <p class="small muted">गिनती में वही विज़िट आती है जो साइट के घेरे के अंदर, सही GPS और नई लाइव फ़ोटो के साथ हो, और जिस पर ठेकेदार ने आपत्ति न की हो। एक दिन में एक ही गिनी जाती है।</p></div>
    ${d.missing_dprs.length ? `<div class="card"><h3>DPR नहीं डाली गई</h3>${d.missing_dprs.map((m) => `<p><b>${esc(m.work)}</b>: ${m.missing.map(fmtDay).join(', ')}</p>`).join('')}</div>` : ''}
    <div class="card"><h3>समय-सीमा पार अनुरोध</h3>${d.requests.overdue.length ? reqTable(d.requests.overdue) : '<p class="muted">कोई नहीं 👍</p>'}</div>`;
  $('#prevW').onclick = () => VIEWS.dash(main, shiftDay(d.week, -7));
  $('#nextW').onclick = () => VIEWS.dash(main, shiftDay(d.week, 7));
  wireReqLinks(main);
  main.querySelectorAll('[data-go]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); tab = a.dataset.go; renderShell(); }));
};
const shiftDay = (day, n) => { const x = new Date(day + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

VIEWS.works = async (main) => {
  const works = await api('/api/works');
  const lv = (x) => x ? `${fmtDay(x.day)} <span class="${x.days_ago > 7 ? 'pill bad' : 'muted small'}">${x.days_ago} दिन</span>` : '<span class="pill bad">कभी नहीं</span>';
  main.innerHTML = `<h2>काम (${works.length})</h2><div class="grid">${works.map((w) => `<div class="card">
    <div class="spread"><h3>${esc(w.name)}</h3>${w.status === 'active' ? '' : '<span class="pill">बंद</span>'}</div>
    <p class="small muted">W.O. ${esc(w.wo_no)} · ${esc(w.office)} · घेरा ${w.radius_m} मी. · ${mapLink(w.lat, w.lng, 'साइट नक्शे पर')}</p>
    <p class="small">ठेकेदार: ${esc(w.contractor)}</p>
    <table><tr><th>पद</th><th>नाम</th><th>आख़िरी विज़िट</th></tr>
    ${['jen', 'aen', 'xen'].map((r) => `<tr><td>${ROLE_SHORT[r]}</td><td>${esc(w[r]) || '<span class="muted">—</span>'}</td><td>${w[r] ? lv(w.last_visit[r]) : ''}</td></tr>`).join('')}</table>
    <p class="small">आज की DPR: ${w.dpr_today ? '<span class="pill ok">जमा</span>' : '<span class="pill warn">नहीं</span>'} · खुले अनुरोध: ${w.open_requests}</p></div>`).join('') || '<p class="muted">आपको अभी कोई काम नहीं सौंपा गया है।</p>'}</div>`;
};

VIEWS.attend = async (main) => {
  const works = (await api('/api/works')).filter((w) => w.status === 'active');
  const visits = await api('/api/visits?from=' + today);
  const mine = visits.filter((v) => v.user_id === me.id);
  main.innerHTML = `<h2>साइट पर हाज़िरी</h2>
    <div class="notice">हाज़िरी तभी गिनी जाएगी जब आप साइट के घेरे के अंदर हों, GPS सही हो और लाइव फ़ोटो ली जाए। समय सर्वर का दर्ज होता है, फ़ोन का नहीं। दर्ज हाज़िरी बदली या मिटाई नहीं जा सकती।</div>
    <div class="card"><label>काम चुनें</label><select id="aw">${works.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
      <label>टिप्पणी (वैकल्पिक)</label><input id="an" placeholder="जैसे: CC की मोटाई जाँची">
      <p><button class="primary big" id="ab" ${works.length ? '' : 'disabled'}>📍 हाज़िरी लगाएँ</button></p><div id="ar"></div></div>
    <div class="card"><h3>आज की मेरी हाज़िरी</h3>${mine.length ? mine.map((v) => `<div class="spread" style="margin-bottom:8px">
      <div>${photo(v.photo)} <b>${esc(v.work)}</b><br><span class="small">${fmtTime(v.server_ts)} · ${v.distance_m} मी. दूर · ${v.counts ? '<span class="pill ok">गिनी गई</span>' : '<span class="pill bad">नहीं गिनी गई</span>'} ${flagPills(v.flags)}
      ${v.out_ts ? ` · वापसी ${fmtTime(v.out_ts)} (${v.out_distance_m} मी.)` : ''}</span></div>
      ${v.out_ts ? '' : `<button data-out="${v.id}">वापसी दर्ज करें</button>`}</div>`).join('') : '<p class="muted">आज कोई हाज़िरी नहीं।</p>'}
      ${settings.min_visit_minutes > 0 ? `<p class="small muted">नियम: साइट पर कम से कम ${settings.min_visit_minutes} मिनट रुककर घेरे के अंदर से "वापसी" दर्ज करें, तभी हाज़िरी गिनी जाएगी।</p>` : ''}</div>`;
  $('#ab').onclick = () => busy($('#ab'), async () => {
    const work = works.find((w) => String(w.id) === $('#aw').value);
    $('#ar').innerHTML = '<p class="muted">GPS ले रहे हैं…</p>';
    const pos = await getPosition();
    $('#ar').innerHTML = `<p class="small muted">GPS मिला (±${pos.accuracy} मी.)।</p>`;
    const shot = await takePhoto('हाज़िरी फ़ोटो: ' + work.name, () => [`${me.name} (${ROLE_SHORT[me.role]})`, work.name.slice(0, 60), `${new Date().toLocaleString('hi-IN')} · ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} ±${pos.accuracy}m`]);
    const r = await api('/api/visits', { work_id: work.id, ...pos, client_ts: new Date().toISOString(), photo: shot.dataUrl, from_gallery: shot.fromGallery, note: $('#an').value });
    toast(r.counts ? 'हाज़िरी दर्ज हुई ✓' : 'दर्ज हुई, पर गिनी नहीं जाएगी: ' + r.flags.map((f) => FLAG[f] || f).join(', '), !r.counts);
    show();
  });
  main.querySelectorAll('[data-out]').forEach((b) => (b.onclick = () => busy(b, async () => {
    const pos = await getPosition();
    const r = await api(`/api/visits/${b.dataset.out}/checkout`, pos);
    toast(`वापसी दर्ज: ${r.minutes} मिनट साइट पर, ${r.out_distance_m} मी. दूर से`);
    show();
  })));
};
const flagPills = (flags) => (flags ? flags.split(',') : []).filter((f) => f !== 'outside_fence').map((f) => `<span class="pill warn">${esc(FLAG[f] || f)}</span>`).join(' ');

VIEWS.visits = async (main, filter) => {
  const works = await api('/api/works');
  const f = filter || { work_id: '', from: shiftDay(today, -30), to: today };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const visits = await api('/api/visits?' + qs);
  const isC = me.role === 'contractor';
  main.innerHTML = `<h2>${isC ? 'अधिकारियों की हाज़िरी: पुष्टि करें' : 'हाज़िरी रिकॉर्ड'}</h2>
    ${isC ? '<div class="notice">आप साइट पर मौजूद थे या आपके आदमी थे: अगर अधिकारी सच में आए तो "हाँ, आए थे" दबाएँ। अगर नहीं आए या फ़र्ज़ी हाज़िरी है तो "आपत्ति" दबाकर कारण लिखें। आपत्ति वाली हाज़िरी गिनी नहीं जाती और ऊपर के अधिकारी को दिखती है।</div>' : ''}
    <div class="card row"><select id="vw" style="max-width:300px"><option value="">सभी काम</option>${works.map((w) => `<option value="${w.id}" ${String(w.id) === String(f.work_id) ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <input type="date" id="vf" value="${f.from}" style="max-width:170px"><input type="date" id="vt" value="${f.to}" style="max-width:170px">
      <button id="vgo">दिखाएँ</button><a class="btn" href="/api/visits?format=csv&${qs}">Excel (CSV)</a></div>
    <div class="list">${visits.map((v) => `<div class="card" style="${v.counts ? '' : 'box-shadow: inset 3px 0 var(--bad)'}">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap">${photo(v.photo)}<div style="flex:1;min-width:0">
        <div class="spread"><b>${esc(v.officer)} <span class="small muted">${ROLE_SHORT[v.role]}</span></b><span class="small muted">${fmtTime(v.server_ts)}</span></div>
        <div class="small muted">${esc(v.work)}</div>
        <div class="small">${v.distance_m} मी. दूर · ±${v.accuracy ?? '?'} मी. · ${mapLink(v.lat, v.lng)}${v.out_ts ? ` · वापसी ${fmtTime(v.out_ts)}` : ''}</div>
        <div style="margin-top:4px">${v.counts ? '<span class="pill ok">गिनी गई</span>' : '<span class="pill bad">नहीं गिनी</span>'} ${v.in_fence ? '' : '<span class="pill bad">साइट से बाहर</span>'} ${flagPills(v.flags)}</div>
        ${v.note ? `<div class="small">${esc(v.note)}</div>` : ''}</div></div>
      <div style="margin-top:8px">ठेकेदार: ${v.contractor_status === 'pending' ? (isC ? `<button data-ok="${v.id}">हाँ, आए थे</button> <button class="danger" data-no="${v.id}">आपत्ति</button>` : '<span class="muted small">पुष्टि बाकी</span>')
        : v.contractor_status === 'confirmed' ? '<span class="pill ok">पुष्टि</span>' : `<span class="pill bad">आपत्ति</span> <span class="small">${esc(v.contractor_note)}</span>`}</div></div>`).join('') || '<p class="muted">कोई हाज़िरी नहीं</p>'}</div>`;
  $('#vgo').onclick = () => VIEWS.visits(main, { work_id: $('#vw').value, from: $('#vf').value, to: $('#vt').value });
  main.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => busy(b, async () => { await api(`/api/visits/${b.dataset.ok}/respond`, { status: 'confirmed' }); VIEWS.visits(main, f); })));
  main.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => {
    dialog(`<h3>आपत्ति दर्ज करें</h3><label>कारण</label><textarea id="dn" placeholder="जैसे: अधिकारी साइट पर नहीं आए, फ़ोटो साइट की नहीं है"></textarea>
      <div class="row" style="margin-top:10px"><button class="primary" id="ds">दर्ज करें</button><button onclick="dlg.close()">रद्द</button></div>`, () => {
      $('#ds').onclick = () => busy($('#ds'), async () => { await api(`/api/visits/${b.dataset.no}/respond`, { status: 'disputed', note: $('#dn').value }); $('#dlg').close(); VIEWS.visits(main, f); });
    });
  }));
};

VIEWS.dpr = async (main) => {
  const works = await api('/api/works');
  const dprs = await api('/api/dprs');
  const isJ = me.role === 'jen', isC = me.role === 'contractor';
  const pendingWorks = isJ ? works.filter((w) => w.status === 'active' && w.jen_id === me.id && !w.dpr_today) : [];
  main.innerHTML = `<h2>DPR (दैनिक प्रगति रिपोर्ट)</h2>
    ${isJ ? (pendingWorks.length ? `<div class="card"><h3>आज (${fmtDay(today)}) की DPR</h3>
      <p class="small muted">DPR सिर्फ़ आज की तारीख़ की बनती है, पिछली तारीख़ में नहीं। जमा होने के बाद बदली नहीं जा सकती।</p>
      <label>काम</label><select id="dw">${pendingWorks.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
      <label>आज हुआ काम (मात्रा, चैनेज सहित) *</label><textarea id="d1"></textarea>
      <label>श्रमिक</label><input id="d2" placeholder="जैसे: 12 बेलदार, 2 मिस्त्री">
      <label>सामग्री</label><input id="d3" placeholder="जैसे: सीमेंट 40 बैग, गिट्टी 2 ट्रॉली">
      <label>मशीनरी</label><input id="d4" placeholder="जैसे: JCB 4 घंटे, मिक्सर">
      <label>रुकावट (hindrance)</label><input id="d5" placeholder="जैसे: ड्रॉइंग का इंतज़ार, बिजली का खंभा">
      <label>ठेकेदार को दिए निर्देश</label><input id="d6">
      <div class="row" style="margin-top:10px"><button id="dp">📷 साइट फ़ोटो जोड़ें</button><span id="dpi" class="small muted"></span></div>
      <p><button class="primary big" id="ds">DPR जमा करें</button></p></div>` : '<div class="card"><span class="pill ok">आज की सभी DPR जमा हैं</span></div>') : ''}
    ${isC ? '<div class="notice">JEN की DPR पढ़ें। अगर काम, मात्रा या रुकावट गलत लिखी है तो "असहमत" दबाकर सही बात लिखें। यह रिकॉर्ड बाद में बिल और समय-वृद्धि (extension) में सबूत बनता है।</div>' : ''}
    <div class="spread"><h3>पिछली DPR</h3><a class="btn" href="/api/dprs?format=csv">Excel (CSV)</a></div>
    <div class="list">${dprs.map((d) => `<div class="card"><div class="spread"><b>${fmtDay(d.day)} · ${esc(d.work)}</b><span class="small muted">${esc(d.jen)} · ${fmtTime(d.server_ts)}
      ${d.distance_m != null ? ` · ${d.in_fence ? 'साइट से' : `<span class="pill warn">साइट से ${d.distance_m} मी. दूर</span>`}` : ''}</span></div>
      <p>${esc(d.work_done)}</p>
      <p class="small">${d.labour ? `श्रमिक: ${esc(d.labour)} · ` : ''}${d.materials ? `सामग्री: ${esc(d.materials)} · ` : ''}${d.machinery ? `मशीनरी: ${esc(d.machinery)}` : ''}</p>
      ${d.hindrance ? `<p class="small"><b>रुकावट:</b> ${esc(d.hindrance)}</p>` : ''}${d.instructions ? `<p class="small"><b>निर्देश:</b> ${esc(d.instructions)}</p>` : ''}
      ${photo(d.photo)}
      <p class="small">ठेकेदार: ${d.contractor_status === 'pending' ? (isC ? `<button data-agree="${d.id}">सहमत</button> <button class="danger" data-dis="${d.id}">असहमत</button>` : '<span class="muted">बाकी</span>')
        : d.contractor_status === 'agreed' ? '<span class="pill ok">सहमत</span>' : `<span class="pill bad">असहमत</span> ${esc(d.contractor_note)}`}</p></div>`).join('') || '<p class="muted">कोई DPR नहीं।</p>'}</div>`;
  if (isJ && pendingWorks.length) {
    let pic = null;
    $('#dp').onclick = async () => { pic = await pickPhoto(); $('#dpi').textContent = pic ? 'फ़ोटो जुड़ी ✓' : ''; };
    $('#ds').onclick = () => busy($('#ds'), async () => {
      let pos = {}; try { pos = await getPosition(); } catch { /* DPR is accepted without GPS; distance is then blank */ }
      await api('/api/dprs', { work_id: Number($('#dw').value), work_done: $('#d1').value, labour: $('#d2').value, materials: $('#d3').value, machinery: $('#d4').value, hindrance: $('#d5').value, instructions: $('#d6').value, photo: pic, ...pos });
      toast('DPR जमा हुई ✓'); show();
    });
  }
  main.querySelectorAll('[data-agree]').forEach((b) => (b.onclick = () => busy(b, async () => { await api(`/api/dprs/${b.dataset.agree}/respond`, { status: 'agreed' }); show(); })));
  main.querySelectorAll('[data-dis]').forEach((b) => (b.onclick = () => dialog(`<h3>DPR से असहमति</h3><label>सही स्थिति लिखें</label><textarea id="xn"></textarea>
    <div class="row" style="margin-top:10px"><button class="primary" id="xs">दर्ज करें</button><button onclick="dlg.close()">रद्द</button></div>`, () => {
    $('#xs').onclick = () => busy($('#xs'), async () => { await api(`/api/dprs/${b.dataset.dis}/respond`, { status: 'disagreed', note: $('#xn').value }); $('#dlg').close(); show(); });
  })));
};

function reqTable(rows) {
  return `<div class="table-wrap"><table><thead><tr><th>#</th><th>काम</th><th>प्रकार</th><th>विषय</th><th>दिया</th><th>अंतिम तिथि</th><th>स्थिति</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="${r.overdue_days ? 'bad' : ''}"><td><a href="#" data-req="${r.id}">${r.id}</a></td><td>${esc(r.work)}</td><td>${REQ_TYPE[r.type]}</td>
      <td><a href="#" data-req="${r.id}">${esc(r.title)}</a>${r.amount ? `<br><span class="small">${rupees(r.amount)}</span>` : ''}${r.type === 'bill' ? `<br><span class="small muted">${BILL_STAGE[r.stage] || ''}</span>` : ''}</td>
      <td>${fmtTime(r.created_ts)}</td><td>${fmtDay(r.due_day)}${r.overdue_days ? `<br><span class="pill bad">${r.overdue_days} दिन देर</span>` : ''}${r.escalated_to ? `<br><span class="small">→ ${ROLE_SHORT[r.escalated_to]} को</span>` : ''}</td>
      <td><span class="pill ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></td></tr>`).join('') || '<tr><td colspan="7" class="muted">कोई अनुरोध नहीं</td></tr>'}</tbody></table></div>`;
}
function wireReqLinks(el) { el.querySelectorAll('[data-req]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openRequest(a.dataset.req); })); }

VIEWS.requests = async (main) => {
  const works = await api('/api/works');
  const rows = await api('/api/requests');
  const isC = me.role === 'contractor';
  main.innerHTML = `<h2>${isC ? 'नाप / बिल / निरीक्षण के लिए अनुरोध' : 'ठेकेदारों के अनुरोध'}</h2>
    ${isC ? `<div class="card"><h3>नया अनुरोध</h3>
      <div class="notice">हर अनुरोध की एक समय-सीमा है: ${Object.entries(settings.sla_days).map(([k, v]) => `${REQ_TYPE[k]} ${v} दिन`).join(' · ')}। समय पार होने पर यह अपने-आप XEN और फिर S.E. के डैशबोर्ड पर लाल दिखता है।</div>
      <label>काम</label><select id="rw">${works.filter((w) => w.status === 'active').map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
      <label>प्रकार</label><select id="rt">${Object.entries(REQ_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label>विषय *</label><input id="rs" placeholder="जैसे: नाली चैनेज 0-180 मी. का नाप MB में दर्ज करें">
      <label>विवरण</label><textarea id="rd"></textarea>
      <label>राशि (बिल हो तो)</label><input id="ra" inputmode="decimal">
      <div class="row" style="margin-top:10px"><button id="rp">📷 फ़ोटो/पत्र जोड़ें</button><span id="rpi" class="small muted"></span></div>
      <p><button class="primary big" id="rb">अनुरोध भेजें</button></p></div>` : ''}
    <div class="spread"><h3>सभी अनुरोध</h3><a class="btn" href="/api/requests?format=csv">Excel (CSV)</a></div>
    <div class="card">${reqTable(rows)}</div>`;
  wireReqLinks(main);
  if (isC) {
    let pic = null;
    $('#rp').onclick = async () => { pic = await pickPhoto(); $('#rpi').textContent = pic ? 'फ़ोटो जुड़ी ✓' : ''; };
    $('#rb').onclick = () => busy($('#rb'), async () => {
      await api('/api/requests', { work_id: Number($('#rw').value), type: $('#rt').value, title: $('#rs').value, details: $('#rd').value, amount: $('#ra').value, photo: pic });
      toast('अनुरोध भेजा गया ✓'); show();
    });
  }
};

async function openRequest(id) {
  const r = await api('/api/requests/' + id);
  const isC = me.role === 'contractor';
  const isOfficer = !isC;
  const open = r.status === 'open' || r.status === 'reopened';
  const nextStages = r.type === 'bill' ? Object.keys(BILL_STAGE).slice(Object.keys(BILL_STAGE).indexOf(r.stage) + 1) : [];
  dialog(`<h3>#${r.id} ${esc(r.title)}</h3>
    <p class="small muted">${esc(r.work)} · ${REQ_TYPE[r.type]} · अंतिम तिथि ${fmtDay(r.due_day)} ${r.overdue_days ? `<span class="pill bad">${r.overdue_days} दिन देर</span>` : ''} · <span class="pill ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></p>
    ${r.type === 'bill' ? `<p class="small">बिल की स्थिति: ${Object.entries(BILL_STAGE).map(([k, v]) => `<span class="pill ${k === r.stage ? 'ok' : ''}">${v}</span>`).join(' → ')}</p>` : ''}
    <div class="timeline">${r.events.map((e) => `<div><b>${esc(e.by)}</b> <span class="small muted">${fmtTime(e.ts)} · ${esc(actionLabel(e.action))}</span><br>${esc(e.note)} ${photo(e.photo)}</div>`).join('')}</div>
    <label>टिप्पणी</label><textarea id="qn" placeholder="${isOfficer ? 'जैसे: MB नं. 245, पेज 12–14 पर नाप दर्ज' : ''}"></textarea>
    <div class="row" style="margin-top:10px">
      <button id="qc">टिप्पणी जोड़ें</button>
      ${isOfficer && open && r.type !== 'bill' ? '<button class="primary" id="qd">काम पूरा हुआ</button>' : ''}
      ${isOfficer && open && nextStages.length ? `<select id="qsg" style="max-width:200px">${nextStages.map((s) => `<option value="${s}">${BILL_STAGE[s]}</option>`).join('')}</select><button class="primary" id="qsb">चरण आगे बढ़ाएँ</button>` : ''}
      ${isC && r.status === 'done' ? '<button class="primary" id="qcl">हाँ, हो गया: बंद करें</button><button class="danger" id="qro">नहीं हुआ: दोबारा खोलें</button>' : ''}
      <button onclick="dlg.close()">बंद</button></div>`, () => {
    const act = (btn, body) => busy(btn, async () => { await api(`/api/requests/${r.id}/action`, { note: $('#qn').value, ...body }); $('#dlg').close(); toast('दर्ज हुआ ✓'); show(); });
    $('#qc').onclick = () => act($('#qc'), { action: 'comment' });
    if ($('#qd')) $('#qd').onclick = () => act($('#qd'), { action: 'done' });
    if ($('#qsb')) $('#qsb').onclick = () => act($('#qsb'), { action: 'stage', stage: $('#qsg').value });
    if ($('#qcl')) $('#qcl').onclick = () => act($('#qcl'), { action: 'close' });
    if ($('#qro')) $('#qro').onclick = () => act($('#qro'), { action: 'reopen' });
  });
}
const actionLabel = (a) => ({ raised: 'अनुरोध दिया', comment: 'टिप्पणी', done: 'पूरा बताया', close: 'ठेकेदार ने बंद किया', reopen: 'दोबारा खोला' }[a] || (a.startsWith('stage:') ? 'चरण: ' + (BILL_STAGE[a.slice(6)] || a) : a));

VIEWS.complaints = async (main) => {
  const rows = await api('/api/complaints');
  const isC = me.role === 'contractor';
  let works = [], users = [];
  if (isC) { works = await api('/api/works'); users = (await api('/api/users')).filter((u) => ['jen', 'aen', 'xen'].includes(u.role)); }
  main.innerHTML = `<h2>शिकायत</h2>
    ${isC ? `<div class="card"><div class="notice">शिकायत सिर्फ़ S.E. / विभाग प्रमुख (Admin) को दिखती है, जिस अधिकारी के बारे में है उसे नहीं। तथ्य लिखें: तारीख़, क्या कहा या माँगा गया, कौन मौजूद था।</div>
      <label>काम</label><select id="cw"><option value="">—</option>${works.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
      <label>किस अधिकारी के बारे में</label><select id="cu"><option value="">—</option>${users.map((u) => `<option value="${u.id}">${esc(u.name)} (${ROLE_SHORT[u.role]})</option>`).join('')}</select>
      <label>शिकायत *</label><textarea id="ct" style="min-height:120px"></textarea>
      <p><button class="primary big" id="cb">शिकायत दर्ज करें</button></p></div>` : ''}
    <div class="list">${rows.map((c) => `<div class="card"><div class="spread"><b>#${c.id} ${esc(c.work || '')}</b><span class="small muted">${fmtTime(c.ts)}</span></div>
      <p class="small">${esc(c.raised_by_name)}${c.against ? ` → <b>${esc(c.against)}</b>` : ''} · <span class="pill ${c.status === 'closed' ? '' : 'warn'}">${c.status === 'open' ? 'खुली' : c.status === 'closed' ? 'बंद' : 'कार्रवाई जारी'}</span></p>
      <p>${esc(c.text)}</p>${c.response ? `<p class="small"><b>जवाब (${esc(c.responder)}, ${fmtTime(c.responded_ts)}):</b> ${esc(c.response)}</p>` : ''}
      ${!isC ? `<div class="row"><input data-resp="${c.id}" placeholder="जवाब / की गई कार्रवाई"><button data-send="${c.id}">भेजें</button><button data-close="${c.id}">भेजें और बंद करें</button></div>` : ''}</div>`).join('') || '<p class="muted">कोई शिकायत नहीं।</p>'}</div>`;
  if (isC) $('#cb').onclick = () => busy($('#cb'), async () => { await api('/api/complaints', { work_id: $('#cw').value || null, against_user_id: $('#cu').value || null, text: $('#ct').value }); toast('शिकायत दर्ज हुई ✓'); show(); });
  const respond = (b, close) => busy(b, async () => { const id = b.dataset.send || b.dataset.close; await api(`/api/complaints/${id}/respond`, { response: $(`[data-resp="${id}"]`).value, status: close ? 'closed' : 'in_progress' }); show(); });
  main.querySelectorAll('[data-send]').forEach((b) => (b.onclick = () => respond(b, false)));
  main.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => respond(b, true)));
};

VIEWS.admin = async (main) => {
  const [users, works] = await Promise.all([api('/api/users'), api('/api/works')]);
  const opts = (role, sel) => `<option value="">—</option>` + users.filter((u) => u.role === role && u.active).map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  main.innerHTML = `<h2>प्रबंधन</h2>
    <div class="card"><div class="spread"><h3>काम और साइट का घेरा (geo-fence)</h3><button class="primary" id="nw">＋ नया काम</button></div>
      <div class="table-wrap"><table><thead><tr><th>काम</th><th>JEN / AEN / XEN</th><th>ठेकेदार</th><th>साइट</th><th></th></tr></thead><tbody>
      ${works.map((w) => `<tr><td>${esc(w.name)}<br><span class="small muted">${esc(w.wo_no)} · ${w.status === 'active' ? 'चालू' : 'बंद'}</span></td><td class="small">${esc(w.jen)}<br>${esc(w.aen)}<br>${esc(w.xen)}</td><td>${esc(w.contractor)}</td>
        <td class="small">${mapLink(w.lat, w.lng, `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`)}<br>घेरा ${w.radius_m} मी.</td><td><button data-ew="${w.id}">बदलें</button></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">घेरे की जगह बदलने का हर बदलाव (पहले और बाद का GPS) ऑडिट लॉग में हमेशा के लिए दर्ज रहता है।</p></div>
    <div class="card"><div class="spread"><h3>उपयोगकर्ता (${users.length})</h3><button class="primary" id="nu">＋ नया उपयोगकर्ता</button></div>
      <div class="table-wrap"><table><thead><tr><th>नाम</th><th>मोबाइल</th><th>पद</th><th>कार्यालय</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr class="${u.active ? '' : 'warn'}"><td>${esc(u.name)}${u.active ? '' : ' <span class="pill">निष्क्रिय</span>'}</td><td>${esc(u.mobile)}</td><td>${ROLE_SHORT[u.role]}</td><td>${esc(u.office)}</td><td><button data-eu="${u.id}">बदलें</button></td></tr>`).join('')}</tbody></table></div></div>
    ${me.role === 'admin' ? `<div class="card"><h3>नियम</h3><div class="grid">
      <div><label>JEN विज़िट / सप्ताह</label><input id="sj" type="number" min="0" max="7" value="${settings.visits_per_week.jen}"></div>
      <div><label>AEN विज़िट / सप्ताह</label><input id="sa" type="number" min="0" max="7" value="${settings.visits_per_week.aen}"></div>
      <div><label>XEN विज़िट / सप्ताह</label><input id="sx" type="number" min="0" max="7" value="${settings.visits_per_week.xen}"></div>
      ${Object.keys(REQ_TYPE).map((k) => `<div><label>${REQ_TYPE[k]}: समय-सीमा (दिन)</label><input id="sl_${k}" type="number" min="1" value="${settings.sla_days[k]}"></div>`).join('')}
      <div><label>GPS सटीकता की सीमा (मीटर)</label><input id="sg" type="number" min="10" value="${settings.max_gps_accuracy_m}"></div>
      <div><label>साइट पर न्यूनतम समय (मिनट, 0 = नियम नहीं)</label><input id="sm" type="number" min="0" value="${settings.min_visit_minutes}"></div>
      <div><label>S.E. को escalate (देरी के दिन)</label><input id="se" type="number" min="1" value="${settings.escalate_after_days}"></div>
      </div><p><button class="primary" id="ss">नियम सहेजें</button></p></div>` : ''}
    <div class="card"><h3>ऑडिट लॉग</h3><div id="audit" class="small muted">…</div></div>`;
  $('#nw').onclick = () => workForm(null, opts);
  main.querySelectorAll('[data-ew]').forEach((b) => (b.onclick = () => workForm(works.find((w) => String(w.id) === b.dataset.ew), opts)));
  $('#nu').onclick = () => userForm(null);
  main.querySelectorAll('[data-eu]').forEach((b) => (b.onclick = () => userForm(users.find((u) => String(u.id) === b.dataset.eu))));
  if ($('#ss')) $('#ss').onclick = () => busy($('#ss'), async () => {
    const n = (id) => Number($(id).value);
    settings = await api('/api/settings', {
      visits_per_week: { jen: n('#sj'), aen: n('#sa'), xen: n('#sx') },
      sla_days: Object.fromEntries(Object.keys(REQ_TYPE).map((k) => [k, n('#sl_' + k)])),
      max_gps_accuracy_m: n('#sg'), min_visit_minutes: n('#sm'), escalate_after_days: n('#se'),
    }, 'PUT');
    toast('नियम सहेजे गए ✓');
  });
  const log = await api('/api/audit');
  $('#audit').innerHTML = log.slice(0, 50).map((a) => `<div>${fmtTime(a.ts)} · ${esc(a.by)} · ${esc(a.action)}</div>`).join('') || 'कुछ नहीं';
};
function workForm(w, opts) {
  dialog(`<h3>${w ? 'काम बदलें' : 'नया काम'}</h3>
    <label>काम का नाम *</label><input id="fn" value="${esc(w?.name)}">
    <label>W.O. / अनुबंध नं.</label><input id="fo" value="${esc(w?.wo_no)}">
    <label>कार्यालय</label><input id="ff" value="${esc(w?.office)}">
    <label>ठेकेदार</label><select id="fc">${opts('contractor', w?.contractor_id)}</select>
    <label>JEN</label><select id="fj">${opts('jen', w?.jen_id)}</select>
    <label>AEN</label><select id="fa">${opts('aen', w?.aen_id)}</select>
    <label>XEN</label><select id="fx">${opts('xen', w?.xen_id)}</select>
    <label>साइट का GPS (latitude, longitude) *</label>
    <div class="row"><input id="flat" style="flex:1" value="${w?.lat ?? ''}" placeholder="26.82410"><input id="flng" style="flex:1" value="${w?.lng ?? ''}" placeholder="75.80250"><button id="fhere">📍 यहीं</button></div>
    <p class="small muted">"यहीं" तभी दबाएँ जब आप सच में साइट पर खड़े हों। या Google Maps में साइट पर देर तक दबाकर निर्देशांक कॉपी करें।</p>
    <label>घेरा (मीटर) *</label><input id="fr" type="number" value="${w?.radius_m ?? 200}">
    <div class="row"><div style="flex:1"><label>शुरू</label><input id="fs" type="date" value="${esc(w?.start_date)}"></div><div style="flex:1"><label>पूर्ण होने की तिथि</label><input id="fe" type="date" value="${esc(w?.end_date)}"></div></div>
    <label>स्थिति</label><select id="fst"><option value="active">चालू</option><option value="closed" ${w?.status === 'closed' ? 'selected' : ''}>बंद</option></select>
    <div class="row" style="margin-top:12px"><button class="primary" id="fsave">सहेजें</button><button onclick="dlg.close()">रद्द</button></div>`, () => {
    $('#fhere').onclick = () => busy($('#fhere'), async () => { const p = await getPosition(); $('#flat').value = p.lat.toFixed(6); $('#flng').value = p.lng.toFixed(6); toast(`GPS ±${p.accuracy} मी.`); });
    $('#fsave').onclick = () => busy($('#fsave'), async () => {
      const body = { name: $('#fn').value, wo_no: $('#fo').value, office: $('#ff').value, contractor_id: $('#fc').value || null, jen_id: $('#fj').value || null, aen_id: $('#fa').value || null, xen_id: $('#fx').value || null,
        lat: $('#flat').value, lng: $('#flng').value, radius_m: $('#fr').value, start_date: $('#fs').value, end_date: $('#fe').value, status: $('#fst').value };
      if (w) await api('/api/works/' + w.id, body, 'PUT'); else await api('/api/works', body);
      $('#dlg').close(); toast('सहेजा गया ✓'); show();
    });
  });
}
function userForm(u) {
  const roles = me.role === 'admin' ? Object.keys(ROLE) : Object.keys(ROLE).filter((r) => r !== 'admin');
  dialog(`<h3>${u ? 'उपयोगकर्ता बदलें' : 'नया उपयोगकर्ता'}</h3>
    <label>नाम *</label><input id="un" value="${esc(u?.name)}">
    <label>मोबाइल *</label><input id="um" value="${esc(u?.mobile)}" ${u ? 'disabled' : ''} inputmode="numeric" maxlength="10">
    <label>पद</label><select id="ur">${roles.map((r) => `<option value="${r}" ${u?.role === r ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select>
    <label>कार्यालय</label><input id="uo" value="${esc(u?.office)}">
    <label>${u ? 'नया PIN (खाली छोड़ें तो वही रहेगा)' : 'PIN (4–8 अंक) *'}</label><input id="up" inputmode="numeric" maxlength="8">
    ${u ? `<label><input type="checkbox" id="ua" ${u.active ? 'checked' : ''} style="width:auto"> सक्रिय</label>` : ''}
    <div class="row" style="margin-top:12px"><button class="primary" id="usave">सहेजें</button><button onclick="dlg.close()">रद्द</button></div>`, () => {
    $('#usave').onclick = () => busy($('#usave'), async () => {
      if (u) await api('/api/users/' + u.id, { name: $('#un').value, role: $('#ur').value, office: $('#uo').value, pin: $('#up').value || undefined, active: $('#ua').checked }, 'PUT');
      else await api('/api/users', { name: $('#un').value, mobile: $('#um').value, role: $('#ur').value, office: $('#uo').value, pin: $('#up').value });
      $('#dlg').close(); toast('सहेजा गया ✓'); show();
    });
  });
}

VIEWS.account = async (main) => {
  main.innerHTML = `<div class="card" style="max-width:420px"><h2>मेरा खाता</h2><p>${esc(me.name)}<br><span class="muted">${esc(ROLE[me.role])} · ${esc(me.mobile)}</span></p>
    <label>पुराना PIN</label><input id="p1" type="password" inputmode="numeric" maxlength="8">
    <label>नया PIN</label><input id="p2" type="password" inputmode="numeric" maxlength="8">
    <p class="row"><button class="primary" id="pc">PIN बदलें</button><button id="lo">लॉगआउट</button></p></div>`;
  $('#pc').onclick = () => busy($('#pc'), async () => { await api('/api/me/pin', { old_pin: $('#p1').value, new_pin: $('#p2').value }); toast('PIN बदल गया ✓'); });
  $('#lo').onclick = async () => { await api('/api/logout', {}); me = null; renderLogin(); };
};

window.dlg = $('#dlg');
boot();
