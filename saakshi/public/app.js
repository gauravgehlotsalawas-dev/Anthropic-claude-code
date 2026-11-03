'use strict';
// SiteSaakshi front end: plain JavaScript, no build step.

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE = { admin: 'Admin', hq: 'मुख्यालय / निविदा प्राधिकारी (TIA)', se: 'S.E.', xen: 'XEN (अधिशासी अभियंता)', aen: 'AEN (सहायक अभियंता)', jen: 'JEN (कनिष्ठ अभियंता)', contractor: 'ठेकेदार' };
const ROLE_SHORT = { admin: 'Admin', hq: 'HQ', se: 'SE', xen: 'XEN', aen: 'AEN', jen: 'JEN', contractor: 'ठेकेदार' };
const REQ_TYPE = { measurement: 'नाप (MB में माप)', bill: 'बिल', inspection: 'निरीक्षण / जाँच', decision: 'निर्णय / ड्रॉइंग', other: 'अन्य' };
const BILL_STAGE = { submitted: 'बिल जमा', mb_recorded: 'MB दर्ज (JEN)', checked_aen: 'जाँचा (AEN)', passed_xen: 'पास (XEN)', paid: 'भुगतान हुआ' };
const STATUS = { open: ['खुला', 'warn'], reopened: ['दोबारा खुला', 'bad'], done: ['विभाग ने पूरा बताया', 'ok'], closed: ['बंद', ''] };
const FLAG_TYPE = { jen_not_verified: 'JEN ने नाप नहीं लिया', aen_not_approved: 'AEN ने अनुमोदन नहीं किया', contractor_overclaim: 'ठेकेदार का ज़्यादा दावा', contractor_no_update: 'ठेकेदार ने अपडेट नहीं डाला',
  request_overdue: 'अनुरोध समय-सीमा पार', wo_not_issued: 'वर्क ऑर्डर जारी नहीं', contractor_not_started: 'काम शुरू नहीं', hindrance_undecided: 'बाधा पर निर्णय बाकी',
  department_delay: 'विभाग के कारण देरी', contractor_delay: 'ठेकेदार की देरी', bill_delayed: 'बिल/भुगतान में देरी', final_not_approved: 'अंतिम बिल: मुख्यालय का अनुमोदन बाकी', assignment_disputed: 'काम सौंपने पर आपत्ति', officer_not_joined: 'अधिकारी ने लॉगिन नहीं किया' };
const VSTATUS = { pending_jen: ['JEN का साइट-नाप बाकी', 'warn'], pending_aen: ['AEN का अनुमोदन बाकी', 'warn'], approved: ['JEN + AEN से सत्यापित', 'ok'] };
const FLAG = { exceeds_boq: 'BOQ मात्रा से ज़्यादा',  outside_fence: 'साइट से बाहर', low_accuracy: 'GPS कमज़ोर', photo_reused: 'पुरानी फ़ोटो', no_photo: 'फ़ोटो नहीं', clock_mismatch: 'फ़ोन का समय गलत', from_gallery: 'गैलरी से फ़ोटो' };

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
function takePhoto(title, stampLines, initialFacing = 'user') {
  return new Promise((resolve, reject) => {
    let stream = null;
    const stop = () => stream && stream.getTracks().forEach((t) => t.stop());
    const d = dialog(`<h3>${esc(title)}</h3><div class="cam"><video id="camv" playsinline autoplay muted></video></div>
      <p class="small muted" id="camMsg">कैमरा खुल रहा है…</p>
      <div class="row"><button class="primary" id="camShot" disabled>📷 फ़ोटो लें</button><button id="camFlip">कैमरा बदलें</button><button id="camCancel">रद्द</button></div>
      <input type="file" id="camFile" accept="image/*" capture="user" hidden>`);
    let facing = initialFacing;
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
    <p class="center"><button id="lotp">नया खाता / पहली बार / PIN भूल गए: OTP से लॉगिन</button></p>
    <p class="small muted">हर विभाग के इंजीनियर और सरकारी टेंडर में पंजीकृत हर ठेकेदार यहाँ अपना खाता बनाता है। अगर किसी प्रोजेक्ट में आपका नाम और मोबाइल डाला गया है, तो आपका खाता पहले से बना है: बस OTP से लॉगिन करें।</p></div>`;
  $('#lotp').onclick = renderOtp;
  const go = () => busy($('#lb'), async () => { await api('/api/login', { mobile: $('#lm').value.trim(), pin: $('#lp').value }); await boot(); });
  $('#lb').onclick = go; $('#lp').onkeydown = (e) => e.key === 'Enter' && go();
}
function renderOtp() {
  $('#main').innerHTML = `<div class="card login"><h2>OTP से लॉगिन / नया खाता</h2>
    <label>मोबाइल नंबर</label><div class="row"><input id="om" inputmode="numeric" maxlength="10" style="flex:1"><button id="os">OTP भेजें</button></div>
    <div id="ostep" hidden>
      <p id="oinfo" class="small"></p>
      <label>OTP</label><input id="oc" inputmode="numeric" maxlength="6">
      <div id="onew" hidden>
        <label>आपका नाम</label><input id="on">
        <label>आप कौन हैं?</label><select id="or"><option value="contractor">ठेकेदार / फ़र्म</option><option value="jen">JEN (कनिष्ठ अभियंता)</option><option value="aen">AEN (सहायक अभियंता)</option><option value="xen">XEN (अधिशासी अभियंता)</option></select>
        <label>विभाग (PWD, जल संसाधन, PHED, RUIDP…)</label><input id="odp">
        <label>कार्यालय / फ़र्म का पता</label><input id="oo">
        <label>ठेकेदार: पंजीकरण / एनलिस्टमेंट नं. · अधिकारी: कर्मचारी ID</label><input id="org">
        <label>GSTIN (ठेकेदार)</label><input id="ogst" maxlength="15">
      </div>
      <label>नया PIN बनाएँ (4–8 अंक)</label><input id="op" type="password" inputmode="numeric" maxlength="8">
      <p><button class="primary big" id="ov">आगे बढ़ें</button></p></div>
    <p><button id="oback">← PIN से लॉगिन</button></p></div>`;
  $('#oback').onclick = renderLogin;
  $('#os').onclick = () => busy($('#os'), async () => {
    const r = await api('/api/otp/send', { mobile: $('#om').value.trim() });
    $('#ostep').hidden = false; $('#onew').hidden = !!r.existing;
    $('#oinfo').innerHTML = (r.existing ? `खाता मिला: <b>${esc(r.existing.name)}</b> (${esc(ROLE[r.existing.role])})।` : 'नया खाता बनेगा।') + ' SMS पर आया OTP डालें।'
      + (r.dev_otp ? ` <span class="pill warn">डेमो OTP: ${esc(r.dev_otp)}</span>` : '');
  });
  $('#ov').onclick = () => busy($('#ov'), async () => {
    await api('/api/otp/verify', { mobile: $('#om').value.trim(), code: $('#oc').value.trim(), pin: $('#op').value, name: $('#on').value, role: $('#or').value, office: $('#oo').value, department: $('#odp').value, reg_no: $('#org').value, gstin: $('#ogst').value });
    await boot();
  });
}
function tabsFor(role) {
  const t = [['dash', 'डैशबोर्ड'], ['flags', '🚩 लाल झंडे'], ['works', 'काम / प्रोजेक्ट'], ['verify', '10% सत्यापन']];
  if (role === 'contractor') t.unshift(['today', 'आज का काम']);
  if (['jen', 'aen', 'xen'].includes(role)) t.unshift(['attend', 'हाज़िरी लगाएँ']);
  if (role !== 'hq') t.push(['newproject', '＋ नया प्रोजेक्ट']);
  t.push(['visits', role === 'contractor' ? 'हाज़िरी पुष्टि' : 'हाज़िरी रिकॉर्ड']);
  t.push(['bills', 'बिल']);
  t.push(['hindrances', 'बाधा / समय-वृद्धि']);
  t.push(['dpr', role === 'jen' ? 'आज की DPR' : 'DPR']);
  t.push(['requests', role === 'contractor' ? 'नाप / बिल अनुरोध' : 'अनुरोध']);
  if (['contractor', 'se', 'admin', 'hq'].includes(role)) t.push(['complaints', 'शिकायत']);
  if (['se', 'admin', 'hq'].includes(role)) t.push(['admin', 'प्रबंधन']);
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
    ${d.red_flags.length ? `<div class="card" style="border-color:var(--bad)"><div class="spread"><h3 style="color:var(--bad)">🚩 ${d.red_flags.length} लाल झंडे</h3><a href="#flags" data-go="flags">सब देखें</a></div>
      ${d.red_flags.slice(0, 4).map((f) => `<p class="small"><span class="pill ${f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : ''}">${esc(FLAG_TYPE[f.type] || f.type)}</span> <b>${esc(f.work)}</b>: ${esc(f.text)}</p>`).join('')}</div>` : ''}
    <div class="stats">
      <div class="stat"><b>${d.pending_verifications}</b><span>10% सत्यापन बाकी (JEN/AEN)</span></div>
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
    <p class="small">आज की DPR: ${w.dpr_today ? '<span class="pill ok">जमा</span>' : '<span class="pill warn">नहीं</span>'} · ठेकेदार का आज का अपडेट: ${w.progress_today ? '<span class="pill ok">जमा</span>' : '<span class="pill warn">नहीं</span>'} · खुले अनुरोध: ${w.open_requests}</p>
    ${w.items_count ? `<p class="small">दावा ${rupees(Math.round(w.claimed_amount))} / ${rupees(w.wo_amount || Math.round(w.boq_total))}${w.pending_verification ? ` · <span class="pill warn">${VSTATUS[w.pending_verification][0]}</span>` : ''}</p>` : ''}
    ${w.timeline.award_date && !w.timeline.wo_date ? `<p class="small"><span class="pill ${w.timeline.wo_late_days ? 'bad' : 'warn'}">वर्क ऑर्डर बाकी${w.timeline.wo_late_days ? `: ${w.timeline.wo_late_days} दिन देर` : ''}</span></p>` : ''}
    ${w.timeline.revised_end ? `<p class="small">पूर्णता तिथि ${fmtDay(w.timeline.revised_end)}${w.timeline.extension_days ? ` (समय-वृद्धि ${w.timeline.extension_days} दिन)` : ''}${w.timeline.contractor_delay_days ? ` <span class="pill bad">ठेकेदार ${w.timeline.contractor_delay_days} दिन देर</span>` : ''}</p>` : ''}
    <button data-wopen="${w.id}">विवरण</button></div>`).join('') || '<p class="muted">आपको अभी कोई काम नहीं सौंपा गया है।</p>'}</div>`;
  main.querySelectorAll('[data-wopen]').forEach((b) => (b.onclick = () => openWork(b.dataset.wopen)));
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
      <label>प्रकार</label><select id="rt">${Object.entries(REQ_TYPE).filter(([k]) => k !== 'bill').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
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
      ${users.map((u) => `<tr class="${u.active ? '' : 'warn'}"><td>${esc(u.name)}${u.active ? '' : ' <span class="pill">निष्क्रिय</span>'}${u.verified ? '' : ' <span class="pill warn">पहचान बाकी</span>'}${u.has_pin ? '' : ' <span class="pill">लॉगिन नहीं किया</span>'}</td><td>${esc(u.mobile)}</td><td>${ROLE_SHORT[u.role]}</td><td>${esc(u.department)} ${esc(u.office)}${u.reg_no ? `<br><span class="small muted">${esc(u.reg_no)}</span>` : ''}</td><td><button data-eu="${u.id}">बदलें</button></td></tr>`).join('')}</tbody></table></div></div>
    ${me.role === 'admin' ? `<div class="card"><h3>नियम</h3><div class="grid">
      <div><label>JEN विज़िट / सप्ताह</label><input id="sj" type="number" min="0" max="7" value="${settings.visits_per_week.jen}"></div>
      <div><label>AEN विज़िट / सप्ताह</label><input id="sa" type="number" min="0" max="7" value="${settings.visits_per_week.aen}"></div>
      <div><label>XEN विज़िट / सप्ताह</label><input id="sx" type="number" min="0" max="7" value="${settings.visits_per_week.xen}"></div>
      ${Object.keys(REQ_TYPE).map((k) => `<div><label>${REQ_TYPE[k]}: समय-सीमा (दिन)</label><input id="sl_${k}" type="number" min="1" value="${settings.sla_days[k]}"></div>`).join('')}
      <div><label>GPS सटीकता की सीमा (मीटर)</label><input id="sg" type="number" min="10" value="${settings.max_gps_accuracy_m}"></div>
      <div><label>साइट पर न्यूनतम समय (मिनट, 0 = नियम नहीं)</label><input id="sm" type="number" min="0" value="${settings.min_visit_minutes}"></div>
      <div><label>S.E. को escalate (देरी के दिन)</label><input id="se" type="number" min="1" value="${settings.escalate_after_days}"></div>
      <div><label>माइलस्टोन: वर्क ऑर्डर का हर … %</label><input id="smp" type="number" min="1" max="100" value="${settings.milestone_percent}"></div>
      <div><label>या हर … ₹ (0 = नहीं)</label><input id="sma" type="number" min="0" value="${settings.milestone_max_amount}"></div>
      <div><label>JEN साइट-नाप की सीमा (घंटे)</label><input id="sjh" type="number" min="1" value="${settings.jen_verify_hours}"></div>
      <div><label>AEN अनुमोदन की सीमा (घंटे)</label><input id="sah" type="number" min="1" value="${settings.aen_approve_hours}"></div>
      <div><label>ठेकेदार के दावे में छूट (%)</label><input id="sot" type="number" min="0" value="${settings.overclaim_tolerance_percent}"></div>
      <div><label>ठेकेदार अपडेट न डाले तो झंडा (दिन)</label><input id="spg" type="number" min="1" value="${settings.progress_gap_days}"></div>
      <div><label>अवार्ड के बाद वर्क ऑर्डर (दिन)</label><input id="swo" type="number" min="1" value="${settings.wo_issue_days}"></div>
      <div><label>वर्क ऑर्डर के बाद काम शुरू (दिन)</label><input id="sst" type="number" min="1" value="${settings.start_within_days}"></div>
      <div><label>बाधा पर अधिकारी का जवाब (दिन)</label><input id="shr" type="number" min="1" value="${settings.hindrance_response_days}"></div>
      <div><label>बाधा-आपत्ति पर S.E./HQ निर्णय (दिन)</label><input id="shd" type="number" min="1" value="${settings.hindrance_decision_days}"></div>
      <div><label>रनिंग बिल पास (दिन)</label><input id="sbp" type="number" min="1" value="${settings.bill_pass_days}"></div>
      <div><label>भुगतान (दिन)</label><input id="spd" type="number" min="1" value="${settings.payment_days}"></div>
      <div><label>काम पूरा: मुख्यालय का सत्यापन व भुगतान-अनुमोदन (दिन)</label><input id="sfa" type="number" min="1" value="${settings.final_approval_days}"></div>
      <div><label><input type="checkbox" id="swv" ${settings.weekly_verification ? 'checked' : ''} style="width:auto"> हर हफ़्ते नाप अनिवार्य (बिना नाप का काम हो तो)</label></div>
      </div><p><button class="primary" id="ss">नियम सहेजें</button></p></div>` : ''}
    <div class="card"><h3>विभाग की सूची से इंजीनियर / पंजीकृत ठेकेदार जोड़ें</h3>
      <p class="small muted">हर पंक्ति: <b>नाम, मोबाइल, पद (jen/aen/xen/se/contractor), विभाग, पंजीकरण नं. / कर्मचारी ID</b>। Excel से सीधे पेस्ट करें। ये खाते "पहचान जाँची गई" माने जाएँगे और लोग OTP से लॉगिन करेंगे।</p>
      <textarea id="imp" placeholder="Ramesh Kumar, 9876543210, jen, PWD, EMP1234"></textarea><p><button id="impb">जोड़ें</button> <span id="impr" class="small"></span></p></div>
    <div class="card"><h3>ऑडिट लॉग</h3><div id="audit" class="small muted">…</div></div>`;
  $('#nw').onclick = () => workForm(null, opts);
  $('#impb').onclick = () => busy($('#impb'), async () => { const r = await api('/api/users/import', { text: $('#imp').value }); $('#impr').textContent = `${r.added} जोड़े` + (r.skipped.length ? `; छोड़े: ${r.skipped.join('; ')}` : ''); });
  main.querySelectorAll('[data-ew]').forEach((b) => (b.onclick = () => workForm(works.find((w) => String(w.id) === b.dataset.ew), opts)));
  $('#nu').onclick = () => userForm(null);
  main.querySelectorAll('[data-eu]').forEach((b) => (b.onclick = () => userForm(users.find((u) => String(u.id) === b.dataset.eu))));
  if ($('#ss')) $('#ss').onclick = () => busy($('#ss'), async () => {
    const n = (id) => Number($(id).value);
    settings = await api('/api/settings', {
      visits_per_week: { jen: n('#sj'), aen: n('#sa'), xen: n('#sx') },
      sla_days: Object.fromEntries(Object.keys(REQ_TYPE).map((k) => [k, n('#sl_' + k)])),
      max_gps_accuracy_m: n('#sg'), min_visit_minutes: n('#sm'), escalate_after_days: n('#se'),
      milestone_percent: n('#smp'), milestone_max_amount: n('#sma'), jen_verify_hours: n('#sjh'), aen_approve_hours: n('#sah'), overclaim_tolerance_percent: n('#sot'), progress_gap_days: n('#spg'),
      wo_issue_days: n('#swo'), start_within_days: n('#sst'), hindrance_response_days: n('#shr'), hindrance_decision_days: n('#shd'), bill_pass_days: n('#sbp'), payment_days: n('#spd'), final_approval_days: n('#sfa'), weekly_verification: $('#swv').checked,
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
    ${u ? `<label><input type="checkbox" id="ua" ${u.active ? 'checked' : ''} style="width:auto"> सक्रिय</label>
      <label><input type="checkbox" id="uv" ${u.verified ? 'checked' : ''} style="width:auto"> पहचान जाँची गई (विभाग के रिकॉर्ड से)</label>` : ''}
    <div class="row" style="margin-top:12px"><button class="primary" id="usave">सहेजें</button><button onclick="dlg.close()">रद्द</button></div>`, () => {
    $('#usave').onclick = () => busy($('#usave'), async () => {
      if (u) await api('/api/users/' + u.id, { name: $('#un').value, role: $('#ur').value, office: $('#uo').value, pin: $('#up').value || undefined, active: $('#ua').checked, verified: $('#uv').checked }, 'PUT');
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

// ---------- red flags (shown up to the tender inviting authority) ----------
VIEWS.flags = async (main) => {
  const flags = await api('/api/flags');
  const by = {};
  for (const f of flags) (by[f.against_role || 'other'] ||= []).push(f);
  main.innerHTML = `<div class="spread"><h2>🚩 लाल झंडे (${flags.length})</h2><a class="btn" href="/api/flags?format=csv">Excel (CSV)</a></div>
    <div class="notice">ये झंडे अपने-आप बनते हैं और तभी हटते हैं जब काम सच में हो जाए। कोई इन्हें हाथ से मिटा नहीं सकता। ये उस काम के JEN, AEN, XEN, ठेकेदार, S.E. और <b>निविदा आमंत्रण प्राधिकारी / मुख्यालय</b>, सबको एक जैसे दिखते हैं। झंडे दोनों तरफ़ लगते हैं: अधिकारी सत्यापन न करें तो उन पर, और ठेकेदार ज़्यादा दावा करे या अपडेट न डाले तो उस पर।</div>
    <div class="stats">${['jen', 'aen', 'xen', 'contractor'].map((r) => `<div class="stat"><b style="color:${(by[r] || []).length ? 'var(--bad)' : 'inherit'}">${(by[r] || []).length}</b><span>${ROLE_SHORT[r]} पर</span></div>`).join('')}</div>
    <div class="list">${flags.map((f) => `<div class="card" style="box-shadow: inset 4px 0 ${f.severity === 'high' ? 'var(--bad)' : f.severity === 'medium' ? 'var(--warn)' : 'var(--line)'}">
      <div class="spread"><span><span class="pill ${f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : ''}">${esc(FLAG_TYPE[f.type] || f.type)}</span>
        ${f.against_name ? ` <b>${esc(f.against_name)}</b> <span class="small muted">${ROLE_SHORT[f.against_role] || ''}</span>` : ''}</span>
        <span class="small muted">${f.hours != null ? `${f.hours} घंटे देर` : f.days != null ? `${f.days} दिन` : ''}</span></div>
      <p style="margin:6px 0">${esc(f.text)}</p>
      <p class="small muted">${esc(f.work)}${f.tia ? ` · निविदा प्राधिकारी: ${esc(f.tia)}` : ''}</p>
      ${f.type === 'assignment_disputed' && ['se', 'admin', 'hq'].includes(me.role) ? `<button data-res="${f.ref}">सुलझ गया</button>` : ''}</div>`).join('') || '<div class="card"><span class="pill ok">कोई लाल झंडा नहीं 👍</span></div>'}</div>`;
  main.querySelectorAll('[data-res]').forEach((b) => (b.onclick = () => busy(b, async () => { await api(`/api/work-flags/${b.dataset.res}/resolve`, { note: '' }); show(); })));
};

// ---------- contractor: today's work with quantities and site photos ----------
VIEWS.today = async (main) => {
  const works = (await api('/api/works')).filter((w) => w.status === 'active' && w.contractor_id === me.id && w.items_count);
  if (!works.length) { main.innerHTML = '<div class="card"><p>पहले अपना प्रोजेक्ट (वर्क ऑर्डर और BOQ) डालें।</p><button class="primary" data-go="newproject">＋ नया प्रोजेक्ट</button></div>'; main.querySelector('[data-go]').onclick = () => { tab = 'newproject'; renderShell(); }; return; }
  const sel = VIEWS.today.work || works[0].id;
  const w = await api('/api/works/' + sel);
  const pct = (x) => w.wo_amount || w.boq_total ? Math.round((x / (w.wo_amount || w.boq_total)) * 1000) / 10 : 0;
  const nextMilestone = w.milestone_step ? Math.ceil((w.claimed_amount + 1) / w.milestone_step) * w.milestone_step : null;
  main.innerHTML = `<h2>आज का काम अपडेट करें</h2>
    <div class="card"><label>काम</label><select id="tw">${works.map((x) => `<option value="${x.id}" ${x.id === w.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <p class="small">अब तक का दावा: <b>${rupees(Math.round(w.claimed_amount))}</b> (${pct(w.claimed_amount)}%) · सत्यापित: ${rupees(Math.round(w.approved_amount))}
      ${nextMilestone ? ` · अगला ${settings.milestone_percent}% माइलस्टोन ${rupees(Math.round(nextMilestone))} पर: तब JEN को ${settings.jen_verify_hours} घंटे में साइट पर नाप लेना अनिवार्य होगा` : ''}</p></div>
    <div class="card"><h3>आज कितना काम हुआ (मात्रा)</h3>
      <div class="table-wrap"><table><thead><tr><th>आइटम</th><th>BOQ</th><th>अब तक</th><th>आज</th></tr></thead><tbody>
      ${w.items.map((i) => `<tr><td>${i.code ? `<span class="muted small">${esc(i.code)}</span> ` : ''}${esc(i.description)}<br><span class="small muted">@ ${rupees(i.rate)}/${esc(i.unit)}</span></td><td>${i.qty} ${esc(i.unit)}</td><td>${Math.round(i.claimed_qty * 100) / 100}</td>
        <td><input data-item="${i.id}" data-rate="${i.rate}" inputmode="decimal" style="width:90px" placeholder="0"></td></tr>`).join('')}</tbody></table></div>
      <p>आज की राशि: <b id="tamt">₹ 0</b></p>
      <label>टिप्पणी (चैनेज, जगह)</label><input id="tn" placeholder="जैसे: चैनेज 120 से 160 मी., बाएँ तरफ़">
      <div class="row" style="margin-top:10px"><button id="tph">📷 साइट पर फ़ोटो लें</button><span id="tpi" class="small muted">0 फ़ोटो (कम से कम 1 ज़रूरी)</span></div>
      <div id="tthumbs" class="row" style="margin-top:6px"></div>
      <p><button class="primary big" id="tsub">अपडेट जमा करें</button></p>
      <p class="small muted">फ़ोटो के साथ GPS और सर्वर का समय दर्ज होता है। साइट के बाहर से या गैलरी की फ़ोटो से डाला अपडेट लाल निशान के साथ दिखेगा। ज़्यादा दावा करने पर JEN के नाप से फ़र्क़ पकड़ा जाएगा और आप पर झंडा लगेगा।</p></div>
    <h3>पिछले अपडेट</h3><div id="tprev" class="list"></div>`;
  $('#tw').onchange = () => { VIEWS.today.work = Number($('#tw').value); show(); };
  const photos = []; let fromGallery = false;
  const recalc = () => { $('#tamt').textContent = rupees(Math.round([...main.querySelectorAll('[data-item]')].reduce((t, i) => t + (Number(i.value) || 0) * Number(i.dataset.rate), 0))); };
  main.querySelectorAll('[data-item]').forEach((i) => (i.oninput = recalc));
  $('#tph').onclick = async () => {
    try {
      const pos = await getPosition();
      const shot = await takePhoto('काम की फ़ोटो', () => [w.name.slice(0, 60), `${me.name} · ${new Date().toLocaleString('hi-IN')}`, `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} ±${pos.accuracy}m`], 'environment');
      photos.push(shot.dataUrl); fromGallery ||= shot.fromGallery;
      $('#tpi').textContent = photos.length + ' फ़ोटो'; $('#tthumbs').innerHTML = photos.map((u) => `<img class="thumb" src="${u}">`).join('');
    } catch (e) { toast(e.message, true); }
  };
  $('#tsub').onclick = () => busy($('#tsub'), async () => {
    const lines = [...main.querySelectorAll('[data-item]')].filter((i) => Number(i.value)).map((i) => ({ item_id: Number(i.dataset.item), qty: Number(i.value) }));
    const pos = await getPosition();
    const r = await api('/api/progress', { work_id: w.id, lines, note: $('#tn').value, photos, from_gallery: fromGallery, ...pos });
    toast(r.verification_id ? `जमा हुआ ✓ माइलस्टोन पूरा: JEN को ${r.jen_due_hours} घंटे में साइट पर नाप लेना होगा` : 'अपडेट जमा हुआ ✓' + (r.flags.length ? ' (' + r.flags.map((f) => FLAG[f] || f).join(', ') + ')' : ''), r.flags.length > 0);
    show();
  });
  const prev = await api('/api/progress?work_id=' + w.id);
  $('#tprev').innerHTML = progressCards(prev.slice(0, 20));
};
const progressCards = (rows) => rows.map((p) => `<div class="card"><div class="spread"><b>${fmtTime(p.server_ts)}</b><span>${rupees(Math.round(p.amount))}</span></div>
  ${p.lines.map((l) => `<div class="small">${esc(l.description)}: <b>${l.qty} ${esc(l.unit)}</b></div>`).join('')}
  ${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ''}
  <div class="small">${p.in_fence ? `<span class="pill ok">साइट से (${p.distance_m} मी.)</span>` : `<span class="pill bad">साइट से ${p.distance_m} मी. दूर</span>`} ${flagPills(p.flags)}</div>
  <div class="row" style="margin-top:6px">${p.photos.map(photo).join('')}</div></div>`).join('') || '<p class="muted">अभी कोई अपडेट नहीं।</p>';

// ---------- 10% milestone verification ----------
VIEWS.verify = async (main) => {
  const vs = await api('/api/verifications');
  main.innerHTML = `<h2>${settings.milestone_percent}% माइलस्टोन सत्यापन</h2>
    <div class="notice">ठेकेदार का दावा हर ${settings.milestone_percent}%${settings.milestone_max_amount ? ` (या ${rupees(settings.milestone_max_amount)})` : ''} पार करते ही: <b>JEN ${settings.jen_verify_hours} घंटे में साइट पर</b> (GPS घेरे के अंदर, लाइव फ़ोटो के साथ) नाप दर्ज करेगा, फिर <b>AEN ${settings.aen_approve_hours} घंटे में</b> अनुमोदन करेगा। देर होते ही लाल झंडा लगता है और मुख्यालय तक दिखता है।</div>
    <div class="list">${vs.map((v) => `<div class="card" style="box-shadow: inset 4px 0 ${v.overdue_hours ? 'var(--bad)' : v.status === 'approved' ? 'var(--ok)' : 'var(--warn)'}">
      <div class="spread"><b>${esc(v.work)}: ${vkind(v)}</b><span class="pill ${VSTATUS[v.status][1]}">${VSTATUS[v.status][0]}</span></div>
      <p class="small">ठेकेदार का दावा <b>${rupees(v.claimed_amount)}</b> · ${fmtTime(v.created_ts)}
        ${v.measured_amount != null ? ` · JEN का नाप <b>${rupees(v.measured_amount)}</b>${v.overclaim ? ' <span class="pill bad">दावा ज़्यादा</span>' : ''}` : ''}
        ${v.rounds > 1 ? ` · <span class="pill warn">${v.rounds - 1} बार वापस भेजा</span>` : ''}</p>
      <p class="small">${v.status === 'pending_jen' ? `JEN (${esc(v.jen_name)}) अंतिम समय: ${fmtTime(v.jen_due_ts)}` : v.status === 'pending_aen' ? `AEN (${esc(v.aen_name)}) अंतिम समय: ${fmtTime(v.aen_due_ts)}` : `AEN ने ${fmtTime(v.aen_ts)} को अनुमोदन किया`}
        ${v.overdue_hours ? ` <span class="pill bad">🚩 ${v.overdue_hours} घंटे देर</span>` : ''}
        ${v.jen_ts ? `<br>JEN ने नाप ${fmtTime(v.jen_ts)} को साइट से ${v.jen_distance_m} मी. पर लिया${v.jen_late_hours ? ` <span class="pill bad">${v.jen_late_hours} घंटे देर से</span>` : ''}` : ''}
        ${v.aen_late_hours ? ` <span class="pill bad">AEN ${v.aen_late_hours} घंटे देर से</span>` : ''}</p>
      ${v.aen_note ? `<p class="small"><b>AEN:</b> ${esc(v.aen_note)}</p>` : ''}${v.jen_note ? `<p class="small"><b>JEN:</b> ${esc(v.jen_note)}</p>` : ''}
      ${v.contractor_status !== 'pending' && v.measured_amount != null ? `<p class="small">ठेकेदार: <span class="pill ${v.contractor_status === 'agreed' ? 'ok' : 'bad'}">${v.contractor_status === 'agreed' ? 'नाप से सहमत' : 'नाप से असहमत'}</span> ${esc(v.contractor_note)}</p>` : ''}
      ${photo(v.jen_photo)}
      <div class="row" style="margin-top:8px"><button data-vopen="${v.id}">विवरण</button>
        ${me.role === 'jen' && v.status === 'pending_jen' ? `<button class="primary" data-vmeasure="${v.id}">📏 साइट पर नाप दर्ज करें</button>` : ''}
        ${me.role === 'aen' && v.status === 'pending_aen' ? `<button class="primary" data-vapprove="${v.id}">✍️ अनुमोदन / वापस</button>` : ''}
        ${me.role === 'contractor' && v.measured_amount != null && v.contractor_status === 'pending' ? `<button data-vagree="${v.id}">नाप से सहमत</button><button class="danger" data-vdis="${v.id}">असहमत</button>` : ''}</div></div>`).join('') || '<p class="muted">अभी कोई माइलस्टोन नहीं।</p>'}</div>`;
  const find = (id) => vs.find((v) => String(v.id) === String(id));
  main.querySelectorAll('[data-vopen]').forEach((b) => (b.onclick = () => verifyDialog(find(b.dataset.vopen), 'view')));
  main.querySelectorAll('[data-vmeasure]').forEach((b) => (b.onclick = () => verifyDialog(find(b.dataset.vmeasure), 'measure')));
  main.querySelectorAll('[data-vapprove]').forEach((b) => (b.onclick = () => verifyDialog(find(b.dataset.vapprove), 'approve')));
  main.querySelectorAll('[data-vagree]').forEach((b) => (b.onclick = () => busy(b, async () => { await api(`/api/verifications/${b.dataset.vagree}/respond`, { status: 'agreed' }); show(); })));
  main.querySelectorAll('[data-vdis]').forEach((b) => (b.onclick = () => dialog(`<h3>नाप से असहमति</h3><label>कारण / सही मात्रा</label><textarea id="vn"></textarea>
    <div class="row" style="margin-top:10px"><button class="primary" id="vs">दर्ज करें</button><button onclick="dlg.close()">रद्द</button></div>`, () => {
    $('#vs').onclick = () => busy($('#vs'), async () => { await api(`/api/verifications/${b.dataset.vdis}/respond`, { status: 'disagreed', note: $('#vn').value }); $('#dlg').close(); show(); });
  })));
};
const vkind = (v) => ({ weekly: 'साप्ताहिक नाप', on_demand: 'ठेकेदार द्वारा माँगा नाप', final: '✅ काम पूरा: अंतिम नाप' }[v.kind] || `${v.percent}% माइलस्टोन`);
async function verifyDialog(v, mode) {
  let lines = v.lines;
  if (mode === 'measure') { // offer every BOQ item, so items the contractor did not claim can be measured too
    const w = await api('/api/works/' + v.work_id);
    lines = w.items.map((i) => ({ ...(v.lines.find((l) => l.item_id === i.id) || { claimed_qty: 0, measured_qty: null }), item_id: i.id, description: i.description, unit: i.unit, rate: i.rate, code: i.code }));
  }
  dialog(`<h3>${esc(v.work)}: ${vkind(v)}</h3>
    <div class="table-wrap"><table><thead><tr><th>आइटम</th><th>ठेकेदार का दावा (अब तक)</th><th>JEN का साइट नाप (अब तक)</th></tr></thead><tbody>
    ${lines.map((l) => `<tr><td>${esc(l.description)}<br><span class="small muted">@ ${rupees(l.rate)}/${esc(l.unit)}</span></td><td>${Math.round(l.claimed_qty * 100) / 100} ${esc(l.unit)}</td>
      <td>${mode === 'measure' ? `<input data-mq="${l.item_id}" inputmode="decimal" style="width:100px" value="${l.claimed_qty ? '' : '0'}" placeholder="नाप">` : l.measured_qty != null ? `<b>${l.measured_qty}</b> ${esc(l.unit)}${l.measured_qty < l.claimed_qty ? ' <span class="pill bad">कम</span>' : ''}` : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    ${mode === 'measure' ? `<div class="notice">नाप सिर्फ़ साइट के घेरे के अंदर से दर्ज होगा। हर आइटम का <b>अब तक का कुल</b> नाप भरें (MB की तरह)। एक लाइव फ़ोटो ली जाएगी।</div>
      <label>टिप्पणी / MB संदर्भ</label><input id="mnote" placeholder="जैसे: MB 245 पेज 15–17">
      <p><button class="primary big" id="msave">📍 नाप दर्ज करें</button></p>` : ''}
    ${mode === 'approve' ? `<div class="notice">आपका अनुमोदन आपके हस्ताक्षर के बराबर दर्ज होगा (नाम, समय, लोकेशन)।</div>
      <label>टिप्पणी (वापस भेजने पर ज़रूरी)</label><textarea id="anote"></textarea>
      <div class="row" style="margin-top:10px"><button class="primary" id="aok">✍️ अनुमोदन करें</button><button class="danger" id="aret">दोबारा नाप के लिए वापस</button></div>` : ''}
    <p><button onclick="dlg.close()">बंद करें</button></p>`, () => {
    if (mode === 'measure') $('#msave').onclick = () => busy($('#msave'), async () => {
      const ml = [...document.querySelectorAll('[data-mq]')].map((i) => ({ item_id: Number(i.dataset.mq), measured_qty: i.value === '' ? null : Number(i.value) }));
      if (ml.some((l) => l.measured_qty == null && v.lines.some((x) => x.item_id === l.item_id))) throw new Error('दावे वाले हर आइटम का नाप भरें');
      const pos = await getPosition();
      const shot = await takePhoto('नाप की फ़ोटो', () => [`${me.name} (JEN) · नाप`, v.work.slice(0, 60), `${new Date().toLocaleString('hi-IN')} · ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`], 'environment');
      await api(`/api/verifications/${v.id}/measure`, { lines: ml.filter((l) => l.measured_qty != null), note: $('#mnote')?.value || '', photo: shot.dataUrl, ...pos });
      $('#dlg').close(); toast('नाप दर्ज हुआ ✓ अब AEN का अनुमोदन'); show();
    });
    if (mode === 'approve') {
      const go = (btn, decision) => busy(btn, async () => {
        let pos = {}; try { pos = await getPosition(); } catch { /* location is recorded when available */ }
        await api(`/api/verifications/${v.id}/approve`, { decision, note: $('#anote').value, ...pos });
        $('#dlg').close(); toast(decision === 'approved' ? 'अनुमोदन दर्ज ✓' : 'JEN को वापस भेजा'); show();
      });
      $('#aok').onclick = () => go($('#aok'), 'approved');
      $('#aret').onclick = () => go($('#aret'), 'returned');
    }
  });
}

// ---------- new project: the creator fills in the others; their accounts are created and assigned at once ----------
VIEWS.newproject = async (main) => {
  const person = (role, label, required) => me.role === role ? `<p class="small">${label}: <b>आप (${esc(me.name)})</b></p>` : `<div class="row"><div style="flex:1;min-width:150px"><label>${label} का नाम${required ? ' *' : ''}</label><input id="p_${role}_name"></div>
    <div style="flex:1;min-width:150px"><label>${label} का मोबाइल${required ? ' *' : ''}</label><input id="p_${role}_mobile" inputmode="numeric" maxlength="10"></div></div>`;
  main.innerHTML = `<h2>नया प्रोजेक्ट / वर्क ऑर्डर</h2>
    <div class="notice">जिन लोगों के मोबाइल नंबर आप डालेंगे, उनका खाता तुरंत बनेगा और वे इस काम पर <b>हाथों-हाथ नियुक्त</b> हो जाएँगे। उन्हें SMS जाएगा और वे "OTP से लॉगिन" करके काम देख सकेंगे। गलत नाम डालने पर वह अधिकारी आपत्ति दर्ज कर सकता है, जो S.E. और मुख्यालय को दिखेगी।</div>
    <div class="card"><h3>1. वर्क ऑर्डर</h3>
      <label>काम का नाम *</label><input id="p_name">
      <div class="row"><div style="flex:1;min-width:150px"><label>W.O. / अनुबंध नं.</label><input id="p_wo"></div><div style="flex:1;min-width:150px"><label>वर्क ऑर्डर राशि (₹) *</label><input id="p_amt" inputmode="decimal"></div></div>
      <div class="row"><div style="flex:1;min-width:150px"><label>विभाग / कार्यालय</label><input id="p_office" placeholder="जैसे: PWD Division-II Jaipur"></div><div style="flex:1;min-width:150px"><label>निविदा आमंत्रण प्राधिकारी (TIA)</label><input id="p_tia" placeholder="जैसे: Chief Engineer PWD Jaipur"></div></div>
      <div class="row"><div style="flex:1;min-width:150px"><label>अवार्ड / LoA की तिथि *</label><input id="p_award" type="date"></div><div style="flex:1;min-width:150px"><label>वर्क ऑर्डर की तिथि (जारी न हुआ हो तो खाली)</label><input id="p_wodate" type="date"></div></div>
      <div class="row"><div style="flex:1;min-width:150px"><label>कार्य अवधि (दिन) *</label><input id="p_dur" type="number" min="1" placeholder="जैसे 60"></div><div style="flex:1;min-width:150px"><label>T.P. % (कम हो तो माइनस, जैसे -8.5)</label><input id="p_tp" inputmode="decimal"></div></div>
      <label>विभाग</label><input id="p_dept" placeholder="PWD / जल संसाधन / PHED…">
      <p class="small muted">वर्क ऑर्डर अवार्ड के ${settings.wo_issue_days} दिन में न आए तो XEN पर लाल झंडा लगेगा। वर्क ऑर्डर के ${settings.start_within_days} दिन में काम शुरू करना ठेकेदार की ज़िम्मेदारी है।</p></div>
    <div class="card"><h3>2. लोग</h3>${person('contractor', 'ठेकेदार', true)}${person('jen', 'JEN', true)}${person('aen', 'AEN', true)}${person('xen', 'XEN', false)}</div>
    <div class="card"><h3>3. साइट की जगह</h3>
      <div class="row"><input id="p_lat" placeholder="latitude" style="flex:1"><input id="p_lng" placeholder="longitude" style="flex:1"><button id="p_here">📍 मैं साइट पर हूँ</button></div>
      <label>घेरा (मीटर): लंबी सड़क हो तो बड़ा रखें</label><input id="p_radius" type="number" value="300"></div>
    <div class="card"><h3>4. BOQ आइटम</h3>
      <p class="small muted">Excel से सीधे पेस्ट कर सकते हैं: कॉलम क्रम <b>कोड, विवरण, इकाई, मात्रा, दर</b>।</p>
      <textarea id="p_paste" placeholder="Excel से पेस्ट करें…" style="min-height:50px"></textarea>
      <div class="table-wrap"><table><thead><tr><th>कोड</th><th>विवरण</th><th>इकाई</th><th>मात्रा</th><th>दर ₹</th></tr></thead><tbody id="p_items"></tbody></table></div>
      <p><button id="p_add">＋ आइटम</button> <span class="small">BOQ कुल: <b id="p_total">₹ 0</b></span></p></div>
    <p><button class="primary big" id="p_save">प्रोजेक्ट बनाएँ</button></p>`;
  const row = (it = {}) => { const tr = document.createElement('tr'); tr.innerHTML = `<td><input value="${esc(it.code)}" style="width:70px"></td><td><input value="${esc(it.description)}" style="min-width:200px"></td><td><input value="${esc(it.unit)}" style="width:60px"></td><td><input value="${esc(it.qty)}" inputmode="decimal" style="width:80px"></td><td><input value="${esc(it.rate)}" inputmode="decimal" style="width:90px"></td>`; $('#p_items').append(tr); tr.oninput = total; };
  const readItems = () => [...$('#p_items').children].map((tr) => { const v = [...tr.querySelectorAll('input')].map((i) => i.value.trim()); return { code: v[0], description: v[1], unit: v[2], qty: v[3].replace(/,/g, ''), rate: v[4].replace(/,/g, '') }; }).filter((i) => i.description || i.qty || i.rate);
  const total = () => { $('#p_total').textContent = rupees(Math.round(readItems().reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0))); };
  for (let i = 0; i < 3; i++) row();
  $('#p_add').onclick = () => row();
  $('#p_paste').oninput = () => {
    const rows = $('#p_paste').value.split(/\r?\n/).map((l) => l.split('\t')).filter((c) => c.length >= 4);
    if (!rows.length) return;
    $('#p_items').innerHTML = '';
    for (const c of rows) { const [code, description, unit, qty, rate] = c.length >= 5 ? c : ['', ...c]; if (Number(String(qty).replace(/,/g, ''))) row({ code, description, unit, qty, rate }); }
    $('#p_paste').value = ''; total(); toast(`${$('#p_items').children.length} आइटम जोड़े`);
  };
  $('#p_here').onclick = () => busy($('#p_here'), async () => { const p = await getPosition(); $('#p_lat').value = p.lat.toFixed(6); $('#p_lng').value = p.lng.toFixed(6); toast(`GPS ±${p.accuracy} मी.`); });
  $('#p_save').onclick = () => busy($('#p_save'), async () => {
    const who = (r) => me.role === r ? undefined : ($(`#p_${r}_mobile`).value.trim() ? { name: $(`#p_${r}_name`).value, mobile: $(`#p_${r}_mobile`).value.trim() } : undefined);
    const r = await api('/api/projects', { name: $('#p_name').value, wo_no: $('#p_wo').value, wo_amount: $('#p_amt').value.replace(/,/g, ''), office: $('#p_office').value, tia: $('#p_tia').value,
      award_date: $('#p_award').value, wo_date: $('#p_wodate').value, duration_days: $('#p_dur').value, tp_percent: $('#p_tp').value, department: $('#p_dept').value, lat: $('#p_lat').value, lng: $('#p_lng').value, radius_m: $('#p_radius').value,
      contractor: who('contractor'), jen: who('jen'), aen: who('aen'), xen: who('xen'), items: readItems() });
    dialog(`<h3>प्रोजेक्ट बन गया ✓</h3>${r.new_accounts.length ? `<p>इनके खाते बनाकर नियुक्त कर दिए गए हैं:</p>${r.new_accounts.map((a) => `<p>${ROLE_SHORT[a.role]}: <b>${esc(a.name)}</b> (${esc(a.mobile)})</p>`).join('')}<p class="small muted">इन्हें बताएँ: ऐप खोलें → "OTP से लॉगिन"।</p>` : '<p>सभी लोग पहले से ऐप में थे और नियुक्त हो गए हैं।</p>'}
      <p><button class="primary" onclick="dlg.close()">ठीक है</button></p>`);
    tab = 'works'; renderShell();
  });
};

// ---------- project detail ----------
async function openWork(id) {
  const w = await api('/api/works/' + id);
  const base = w.wo_amount || w.boq_total;
  const pct = (x) => base ? Math.round((x / base) * 1000) / 10 : 0;
  const bar = (x, color) => `<div style="height:8px;background:var(--line);border-radius:4px;overflow:hidden"><div style="width:${Math.min(100, pct(x))}%;height:100%;background:${color}"></div></div>`;
  dialog(`<h3>${esc(w.name)}</h3><p class="small muted">${esc(w.wo_no)} · ${esc(w.office)}${w.tia ? ' · TIA: ' + esc(w.tia) : ''} · वर्क ऑर्डर ${rupees(w.wo_amount)}</p>
    <p class="small">ठेकेदार का दावा ${rupees(Math.round(w.claimed_amount))} (${pct(w.claimed_amount)}%)</p>${bar(w.claimed_amount, 'var(--warn)')}
    <p class="small">JEN + AEN से सत्यापित ${rupees(Math.round(w.approved_amount))} (${pct(w.approved_amount)}%)</p>${bar(w.approved_amount, 'var(--ok)')}
    ${w.flags.length ? `<p>${w.flags.map((f) => `<span class="pill ${f.severity === 'high' ? 'bad' : 'warn'}">🚩 ${esc(FLAG_TYPE[f.type] || f.type)}</span>`).join(' ')}</p>` : ''}
    <div class="table-wrap"><table><thead><tr><th>आइटम</th><th>BOQ</th><th>दावा</th><th>नाप</th></tr></thead><tbody>
    ${w.items.map((i) => `<tr><td>${esc(i.description)}<br><span class="small muted">${rupees(i.rate)}/${esc(i.unit)}</span></td><td>${i.qty}</td><td>${Math.round(i.claimed_qty * 100) / 100}</td><td>${i.measured_qty ?? '—'}</td></tr>`).join('')}</tbody></table></div>
    <p class="small">JEN: ${esc(w.jen)} · AEN: ${esc(w.aen)} · XEN: ${esc(w.xen) || '—'} · ठेकेदार: ${esc(w.contractor)}</p>
    <h3 style="margin-top:12px">समय-रेखा</h3>${timelineHtml(w.timeline)}
    ${!w.wo_date && ['xen', 'aen', 'se', 'admin', 'hq'].includes(me.role) ? `<div class="row" style="margin:8px 0"><input id="wono" placeholder="वर्क ऑर्डर नं." style="flex:1"><input id="wodt" type="date" value="${today}" style="flex:1"><button class="primary" id="woiss">वर्क ऑर्डर जारी करें</button></div>` : ''}
    <div class="row">${me.role !== 'hq' ? '<button class="danger" id="wdisp">⚠ आपत्ति: यह काम/जानकारी गलत है</button>' : ''}<button onclick="dlg.close()">बंद करें</button></div>`, () => {
    if ($('#woiss')) $('#woiss').onclick = () => busy($('#woiss'), async () => { await api(`/api/works/${w.id}/issue-wo`, { wo_no: $('#wono').value, wo_date: $('#wodt').value }); $('#dlg').close(); toast('वर्क ऑर्डर जारी ✓'); show(); });
    if ($('#wdisp')) $('#wdisp').onclick = () => {
      const note = prompt('आपत्ति का कारण (यह S.E. और मुख्यालय को दिखेगी):');
      if (note) busy($('#wdisp'), async () => { await api(`/api/works/${w.id}/dispute`, { note }); $('#dlg').close(); toast('आपत्ति दर्ज हुई'); });
    };
  });
}

// ---------- contract timeline block (used in the project detail) ----------
const HCAT = { site_not_handed: 'साइट / ज़मीन नहीं सौंपी', work_not_shown: 'अधिकारी ने काम / ले-आउट नहीं बताया', drawing_decision: 'ड्रॉइंग / डिज़ाइन / निर्णय नहीं दिया', estimate_wrong: 'एस्टीमेट / BOQ गलत, मात्रा बदली',
  utility_shifting: 'बिजली खंभे, पाइपलाइन, अतिक्रमण नहीं हटे', payment_delay: 'बिल का भुगतान अटका', department_material: 'विभाग की सामग्री नहीं मिली', other_department: 'विभाग का अन्य कारण' };
const HCAT_ROLE = { site_not_handed: 'xen', work_not_shown: 'jen', drawing_decision: 'xen', estimate_wrong: 'aen', utility_shifting: 'xen', payment_delay: 'xen', department_material: 'xen', other_department: 'xen' };
const HSTATE = { pending: ['अधिकारी का जवाब बाकी', 'warn'], deemed: ['जवाब नहीं आया: स्वीकार माना', 'ok'], accepted: ['स्वीकार', 'ok'], disputed: ['आपत्ति: S.E./HQ निर्णय बाकी', 'warn'], rejected: ['S.E./HQ ने अस्वीकार की', 'bad'], auto: ['स्वचालित (रिकॉर्ड से)', 'ok'] };
function timelineHtml(t) {
  const row = (k, v, cls = '') => v == null || v === '' ? '' : `<tr><td class="muted">${k}</td><td class="${cls}">${v}</td></tr>`;
  return `<div class="table-wrap"><table>
    ${row('अवार्ड (LoA)', t.award_date && fmtDay(t.award_date))}
    ${row('वर्क ऑर्डर', t.wo_date ? fmtDay(t.wo_date) + (t.wo_late_days ? ` <span class="pill bad">विभाग ${t.wo_late_days} दिन देर से</span>` : ' <span class="pill ok">समय पर</span>') : t.award_date ? `<span class="pill bad">जारी नहीं (${fmtDay(t.wo_due_date)} तक होना था)</span>` : '')}
    ${row('काम शुरू करने की तिथि', t.official_start && fmtDay(t.official_start) + (t.actual_start ? ` · असल शुरुआत ${fmtDay(t.actual_start)}` : ''))}
    ${row('अनुबंध के अनुसार पूरा', t.stipulated_end && fmtDay(t.stipulated_end) + (t.duration_days ? ` (${t.duration_days} दिन)` : ''))}
    ${row('विभाग के कारण समय-वृद्धि', t.extension_days ? `<b>${t.extension_days} दिन</b> (${Object.entries(t.department_days_by_role).map(([r, d]) => `${ROLE_SHORT[r]} ${d}`).join(', ')})` : '0')}
    ${row('संशोधित पूर्णता तिथि', t.revised_end && `<b>${fmtDay(t.revised_end)}</b>`)}
    ${row('पूरा हुआ', t.completed_day && fmtDay(t.completed_day))}
    ${t.stipulated_end ? row('देरी', t.delay_days ? `${t.delay_days} दिन: विभाग ${t.department_delay_days}, ठेकेदार ${t.contractor_delay_days}` : 'नहीं') : ''}
    ${t.stipulated_end ? row('ठेकेदार पर पेनल्टी', t.contractor_delay_days === 0 ? '<span class="pill ok">नहीं</span>' : t.penalty_applicable ? `<span class="pill bad">${t.contractor_delay_days} दिन की देरी पर लागू</span>` : '<span class="pill warn">बाधा पर निर्णय बाकी: अभी नहीं</span>') : ''}
  </table></div>`;
}

// ---------- hindrances (बाधा) and extension of time ----------
VIEWS.hindrances = async (main) => {
  const [list, works] = await Promise.all([api('/api/hindrances'), api('/api/works')]);
  const isC = me.role === 'contractor';
  main.innerHTML = `<h2>बाधा और समय-वृद्धि</h2>
    <div class="notice">काम विभाग के कारण रुका (साइट नहीं सौंपी, काम या ड्रॉइंग नहीं बताई, एस्टीमेट गलत निकला) तो ठेकेदार यहाँ उसी दिन दर्ज करे। ज़िम्मेदार अधिकारी को <b>${settings.hindrance_response_days} दिन</b> में स्वीकार या आपत्ति करनी है। <b>जवाब न दे तो बाधा स्वीकार मानी जाती है।</b> आपत्ति पर S.E./मुख्यालय ${settings.hindrance_decision_days} दिन में निर्णय देते हैं, और तब तक समय-वृद्धि ठेकेदार को मिलती रहती है। बाधा के दिन अपने-आप समय-वृद्धि बनते हैं: <b>उतने दिन की देरी पर ठेकेदार पर कोई पेनल्टी नहीं</b>, और ज़िम्मेदारी अधिकारी की दर्ज होती है।</div>
    ${isC ? `<div class="card"><h3>नई बाधा दर्ज करें</h3>
      <label>काम</label><select id="hw">${works.filter((w) => w.contractor_id === me.id && w.status === 'active').map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select>
      <label>बाधा का प्रकार</label><select id="hc">${Object.entries(HCAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label>ज़िम्मेदार अधिकारी</label><select id="hr">${['jen', 'aen', 'xen'].map((r) => `<option value="${r}">${ROLE[r]}</option>`).join('')}</select>
      <label>पूरा विवरण * (क्या माँगा, कब माँगा, किससे बात हुई)</label><textarea id="hd"></textarea>
      <div class="row"><div style="flex:1"><label>बाधा कब से</label><input id="hf" type="date" value="${today}"></div><div style="flex:1"><label>कब तक (अभी जारी हो तो खाली)</label><input id="ht" type="date"></div></div>
      <div class="row" style="margin-top:10px"><button id="hp">📷 फ़ोटो / पत्र</button><span id="hpi" class="small muted"></span></div>
      <p><button class="primary big" id="hs">बाधा दर्ज करें</button></p></div>` : ''}
    <div class="list">${list.map((h) => `<div class="card"><div class="spread"><b>${esc(h.category_label)}</b><span class="pill ${HSTATE[h.state][1]}">${HSTATE[h.state][0]}</span></div>
      <p class="small muted">${esc(h.work)} · ज़िम्मेदार: ${ROLE_SHORT[h.responsible_role]} · ${fmtDay(h.from_day)} – ${h.to_day ? fmtDay(h.to_day) : (h.auto ? fmtDay(h.to_effective) : 'जारी')} · <b>${h.days} दिन</b></p>
      ${h.description ? `<p>${esc(h.description)}</p>` : ''}${photo(h.photo)}
      ${h.response_note ? `<p class="small"><b>${esc(h.responder)}:</b> ${esc(h.response_note)}</p>` : ''}
      ${h.decision_note ? `<p class="small"><b>निर्णय (${esc(h.decider)}):</b> ${esc(h.decision_note)}</p>` : ''}
      ${h.state === 'pending' ? `<p class="small">अधिकारी के जवाब की अंतिम तिथि: ${fmtDay(h.response_due_day)}</p>` : ''}
      <div class="row">
        ${isC && !h.auto && !h.to_day ? `<button data-hclose="${h.id}">बाधा ख़त्म हुई (आज)</button>` : ''}
        ${['jen', 'aen', 'xen'].includes(me.role) && h.state === 'pending' ? `<button class="primary" data-hacc="${h.id}">स्वीकार</button><button class="danger" data-hdis="${h.id}">आपत्ति</button>` : ''}
        ${['se', 'hq', 'admin'].includes(me.role) && h.state === 'disputed' ? `<button class="primary" data-hdec="${h.id}" data-d="accepted">बाधा सही: समय-वृद्धि दें</button><button class="danger" data-hdec="${h.id}" data-d="rejected">अस्वीकार</button>` : ''}
      </div></div>`).join('') || '<p class="muted">कोई बाधा दर्ज नहीं।</p>'}</div>`;
  if (isC && $('#hs')) {
    let pic = null;
    $('#hc').onchange = () => { $('#hr').value = HCAT_ROLE[$('#hc').value]; };
    $('#hc').onchange();
    $('#hp').onclick = async () => { pic = await pickPhoto(); $('#hpi').textContent = pic ? 'जुड़ी ✓' : ''; };
    $('#hs').onclick = () => busy($('#hs'), async () => {
      await api('/api/hindrances', { work_id: Number($('#hw').value), category: $('#hc').value, responsible_role: $('#hr').value, description: $('#hd').value, from_day: $('#hf').value, to_day: $('#ht').value || null, photo: pic });
      toast('बाधा दर्ज हुई ✓ अधिकारी को सूचना गई'); show();
    });
  }
  main.querySelectorAll('[data-hclose]').forEach((b) => (b.onclick = () => busy(b, async () => { await api(`/api/hindrances/${b.dataset.hclose}/close`, {}); show(); })));
  main.querySelectorAll('[data-hacc]').forEach((b) => (b.onclick = () => busy(b, async () => { await api(`/api/hindrances/${b.dataset.hacc}/respond`, { decision: 'accepted' }); show(); })));
  const noteDialog = (title, cb) => dialog(`<h3>${title}</h3><label>कारण *</label><textarea id="xnote"></textarea><div class="row" style="margin-top:10px"><button class="primary" id="xok">दर्ज करें</button><button onclick="dlg.close()">रद्द</button></div>`,
    () => { $('#xok').onclick = () => busy($('#xok'), async () => { await cb($('#xnote').value); $('#dlg').close(); show(); }); });
  main.querySelectorAll('[data-hdis]').forEach((b) => (b.onclick = () => noteDialog('बाधा पर आपत्ति (सबूत सहित)', (note) => api(`/api/hindrances/${b.dataset.hdis}/respond`, { decision: 'disputed', note }))));
  main.querySelectorAll('[data-hdec]').forEach((b) => (b.onclick = () => noteDialog(b.dataset.d === 'accepted' ? 'बाधा स्वीकार' : 'बाधा अस्वीकार', (note) => api(`/api/hindrances/${b.dataset.hdec}/decide`, { decision: b.dataset.d, note }))));
};

// ---------- bills: running / final whenever the contractor wants, from verified quantities ----------
const BSTATUS = { submitted: ['जमा', 'warn'], passed: ['XEN ने पास किया', 'ok'], hq_approved: ['मुख्यालय ने अनुमोदन किया', 'ok'], paid: ['भुगतान हुआ', 'ok'] };
const ordinal = (n) => ({ 1: 'पहला', 2: 'दूसरा', 3: 'तीसरा', 4: 'चौथा' }[n] || `${n}वाँ`);
VIEWS.bills = async (main) => {
  const [bills, works] = await Promise.all([api('/api/bills'), api('/api/works')]);
  const isC = me.role === 'contractor';
  let mine = [];
  if (isC) mine = await Promise.all(works.filter((w) => w.contractor_id === me.id && w.items_count).map((w) => api('/api/works/' + w.id)));
  main.innerHTML = `<h2>बिल</h2>
    <div class="notice">बिल सिर्फ़ <b>JEN + AEN से सत्यापित नाप</b> से बनता है, इसलिए दोबारा नाप या जाँच की ज़रूरत नहीं। ठेकेदार जब चाहे रनिंग बिल (पहला, दूसरा, तीसरा…) बना सकता है, और काम पूरा होने पर अंतिम बिल। रनिंग बिल XEN <b>${settings.bill_pass_days} दिन</b> में पास करेगा। अंतिम बिल <b>मुख्यालय / निविदा प्राधिकारी ${settings.final_approval_days} दिन</b> में सत्यापित और अनुमोदित करेगा। भुगतान उसके ${settings.payment_days} दिन में होगा। देर होते ही लाल झंडा लगता है।</div>
    ${isC ? mine.map((w) => `<div class="card"><div class="spread"><h3>${esc(w.name)}</h3><span class="small">सत्यापित ${rupees(Math.round(w.approved_amount))} · बिल हुए ${w.bills.length}</span></div>
      <div class="row">
        ${w.can_bill.running ? `<button class="primary" data-mkbill="${w.id}">＋ ${ordinal(w.bills.length + 1)} रनिंग बिल बनाएँ</button>` : ''}
        ${w.can_bill.final ? `<button class="primary" data-mkfinal="${w.id}">＋ अंतिम बिल बनाएँ</button>` : ''}
        ${!w.can_bill.running && !w.can_bill.final && !w.bills.some((b) => b.is_final) ? `<span class="small muted">नया सत्यापित नाप नहीं है।</span> <button data-askv="${w.id}">📏 नाप माँगें (JEN ${settings.jen_verify_hours} घंटे में)</button>` : ''}
        ${!w.completed_ts ? `<button data-done="${w.id}">✅ काम पूरा घोषित करें</button>` : '<span class="pill ok">काम पूरा घोषित</span>'}
      </div></div>`).join('') : ''}
    <div class="list">${bills.map((b) => `<div class="card" style="box-shadow: inset 4px 0 ${b.overdue_days ? 'var(--bad)' : b.status === 'paid' ? 'var(--ok)' : 'var(--warn)'}">
      <div class="spread"><b>${b.is_final ? 'अंतिम बिल' : ordinal(b.bill_no) + ' रनिंग बिल'}: ${esc(b.work)}</b><span class="pill ${BSTATUS[b.status][1]}">${BSTATUS[b.status][0]}</span></div>
      <p class="small">इस बिल की राशि <b>${rupees(b.net_amount)}</b> · अब तक कुल ${rupees(b.gross_upto)}${b.tp_percent ? ` (T.P. ${b.tp_percent > 0 ? '+' : ''}${b.tp_percent}%)` : ''} · जमा ${fmtTime(b.created_ts)}</p>
      ${b.due ? `<p class="small">${ROLE_SHORT[b.due.by]}: ${b.due.what}, अंतिम तिथि ${fmtDay(b.due.due)} ${b.overdue_days ? `<span class="pill bad">🚩 ${b.overdue_days} दिन देर</span>` : ''}</p>` : ''}
      <p class="small muted">${b.passed_name ? `पास: ${esc(b.passed_name)} ${fmtTime(b.passed_ts)} · ` : ''}${b.hq_name ? `अनुमोदन: ${esc(b.hq_name)} ${fmtTime(b.hq_ts)} · ` : ''}${b.paid_ts ? `भुगतान ${fmtTime(b.paid_ts)} (${esc(b.paid_ref)})` : ''}</p>
      <div class="row"><button data-print="${b.id}">🖨 बिल देखें / प्रिंट</button>
        ${b.status === 'submitted' && !b.is_final && (me.role === 'xen' || ['se', 'admin'].includes(me.role)) ? `<button class="primary" data-bact="${b.id}" data-a="pass">✍️ बिल पास करें</button>` : ''}
        ${b.status === 'submitted' && b.is_final && ['hq', 'admin'].includes(me.role) ? `<button class="primary" data-bact="${b.id}" data-a="hq_approve">✍️ काम सत्यापित: भुगतान अनुमोदित</button>` : ''}
        ${['passed', 'hq_approved'].includes(b.status) && ['xen', 'se', 'admin', 'hq'].includes(me.role) ? `<button data-bact="${b.id}" data-a="paid">₹ भुगतान दर्ज करें</button>` : ''}</div></div>`).join('') || '<p class="muted">अभी कोई बिल नहीं।</p>'}</div>`;
  main.querySelectorAll('[data-mkbill],[data-mkfinal]').forEach((b) => (b.onclick = () => busy(b, async () => {
    const final = !!b.dataset.mkfinal;
    if (final && !confirm('अंतिम बिल के बाद इस काम का कोई और बिल नहीं बनेगा। आगे बढ़ें?')) return;
    const r = await api('/api/bills', { work_id: Number(b.dataset.mkbill || b.dataset.mkfinal), final });
    toast(`${final ? 'अंतिम' : ordinal(r.bill_no)} बिल ${rupees(r.net_amount)} जमा ✓`); show();
  })));
  main.querySelectorAll('[data-askv]').forEach((b) => (b.onclick = () => busy(b, async () => { await api(`/api/works/${b.dataset.askv}/request-verification`, {}); toast(`नाप माँगा गया: JEN को ${settings.jen_verify_hours} घंटे में साइट पर आना होगा`); show(); })));
  main.querySelectorAll('[data-done]').forEach((b) => (b.onclick = () => busy(b, async () => {
    if (!confirm('काम पूरा घोषित करें? JEN अंतिम नाप लेगा, AEN अनुमोदन करेगा, फिर आप अंतिम बिल बना सकेंगे।')) return;
    await api(`/api/works/${b.dataset.done}/complete`, {}); toast('काम पूरा घोषित ✓ अंतिम नाप के लिए JEN को सूचना गई'); show();
  })));
  main.querySelectorAll('[data-bact]').forEach((b) => (b.onclick = () => busy(b, async () => {
    let ref = '', note = '';
    if (b.dataset.a === 'paid') { ref = prompt('भुगतान का संदर्भ (UTR / चेक नं.):'); if (!ref) return; }
    if (b.dataset.a === 'hq_approve') { note = prompt('टिप्पणी (वैकल्पिक):') || ''; }
    await api(`/api/bills/${b.dataset.bact}/action`, { action: b.dataset.a, ref, note }); toast('दर्ज हुआ ✓'); show();
  })));
  main.querySelectorAll('[data-print]').forEach((b) => (b.onclick = () => printBill(bills.find((x) => String(x.id) === b.dataset.print))));
};
function printBill(b) {
  const n = (x) => Number(x).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const since = b.gross_upto - b.prev_upto;
  const html = `<!doctype html><html lang="hi"><head><meta charset="utf-8"><title>${b.is_final ? 'Final' : 'RA'} Bill ${b.bill_no}</title>
    <style>body{font:13px system-ui,sans-serif;margin:24px;color:#000}table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:4px 6px;text-align:right}th:nth-child(2),td:nth-child(2){text-align:left}h2,h3{margin:4px 0}.sig{display:flex;justify-content:space-between;margin-top:60px}</style></head><body>
    <h2>${b.is_final ? 'अंतिम बिल (Final Bill)' : `${ordinal(b.bill_no)} रनिंग बिल (${b.bill_no} R.A. Bill)`}</h2>
    <h3>${esc(b.work)}</h3><p>W.O. ${esc(b.wo_no)} · ठेकेदार: ${esc(b.contractor)} · बिल तिथि ${fmtTime(b.created_ts)} · मात्राएँ JEN + AEN सत्यापन #${b.verification_id} से</p>
    <table><thead><tr><th>#</th><th>आइटम</th><th>इकाई</th><th>दर</th><th>अब तक मात्रा</th><th>पिछले बिल तक</th><th>इस बिल में</th><th>अब तक राशि</th><th>इस बिल की राशि</th></tr></thead><tbody>
    ${b.lines.map((l, i) => `<tr><td>${esc(l.code) || i + 1}</td><td>${esc(l.description)}</td><td>${esc(l.unit)}</td><td>${n(l.rate)}</td><td>${n(l.upto_qty)}</td><td>${n(l.prev_qty)}</td><td>${n(l.since_qty)}</td><td>${n(l.upto_amount)}</td><td>${n(l.since_amount)}</td></tr>`).join('')}
    <tr><th colspan="7">कुल</th><th>${n(b.gross_upto)}</th><th>${n(since)}</th></tr>
    ${b.tp_percent ? `<tr><th colspan="8">T.P. ${b.tp_percent}%</th><th>${n(Math.round(since * b.tp_percent / 100))}</th></tr>` : ''}
    <tr><th colspan="8">इस बिल की देय राशि</th><th>₹ ${n(b.net_amount)}</th></tr></tbody></table>
    <div class="sig"><span>ठेकेदार</span><span>JEN</span><span>AEN</span><span>XEN</span>${b.is_final ? '<span>निविदा प्राधिकारी</span>' : ''}</div>
    <script>print()<\/script></body></html>`;
  const win = window.open('', '_blank'); win.document.write(html); win.document.close();
}

window.dlg = $('#dlg');
boot();
