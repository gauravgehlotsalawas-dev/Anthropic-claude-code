// Site diary: one folder per construction site with daily entries (labour, work done, materials,
// machinery, hindrances), a GPS camera, a photo gallery, DPR / WPR / MPR reports and site documents.
import { idb, uid, num, round, esc } from "./store.js";
import { saveFile, allFiles, putFile, delFile, readExif, getPosition, reverseGeocode, fmtLatLon, fmtDateTime, stampPhoto, thumbOf, makeZip, safeName } from "./files.js";
import { docsPanel, SITE_FOLDERS } from "./docs.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let ctx = null;
const state = { sites: [], diary: new Map(), siteId: null, tab: "today", date: today(), photoSel: new Set(), filter: { from: "", to: "", q: "" }, report: null, docs: null };

const LABOUR = ["Mason", "Beldar / Labour", "Carpenter", "Bar bender", "Helper", "Plumber", "Electrician", "Painter", "Operator", "Supervisor"];
const UNITS = ["cum", "sqm", "rmt", "m", "kg", "MT", "nos", "bags", "trips", "ltr", "LS"];
const WEATHER = ["Clear", "Sunny / hot", "Cloudy", "Rain", "Heavy rain", "Cold / fog", "Dust storm"];

function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const isoDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (day, n) => { const d = new Date(day + "T12:00"); d.setDate(d.getDate() + n); return isoDay(d); };
const fd = (day) => (day ? day.split("-").reverse().join(".") : "");
const longDay = (day) => new Date(day + "T12:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const q3 = (v) => (Math.round(num(v) * 1000) / 1000).toString();

export const site = () => state.sites.find((s) => s.id === state.siteId) || null;
export const siteList = () => state.sites;
export const currentSiteId = () => state.siteId;

export async function initSites(c) {
  ctx = c;
  state.sites = (await idb.all("sites")).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const d of await idb.all("diary")) state.diary.set(d.id, d);
  const kv = await idb.get("kv", "currentSite");
  state.siteId = kv?.value && state.sites.some((s) => s.id === kv.value) ? kv.value : state.sites[0]?.id || null;
  const root = $("#sitesRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
}

export function switchSite(id) {
  state.siteId = id; state.photoSel.clear(); state.report = null;
  idb.put("kv", { id: "currentSite", value: id });
  renderSites();
}

export function newSiteDialog() {
  ctx.modal(`<h2>New site</h2><p class="muted small">Each site keeps its own daily diary, photos, reports and documents.</p>${siteForm({})}
    <button class="primary mt" id="nsSave">Create site</button>`, (m) => {
    $("#nsSave", m).onclick = async () => {
      const s = { id: uid("site"), createdAt: Date.now(), updatedAt: Date.now(), folders: [...SITE_FOLDERS], ...readSiteForm(m) };
      if (!s.name) { ctx.toast("Give the site a name."); return; }
      state.sites.unshift(s); await idb.put("sites", s);
      ctx.closeModal(); switchSite(s.id); ctx.refreshHeader();
    };
  });
}
const SITE_FIELDS = [["name", "Name of work / site *"], ["workOrderNo", "Work order No."], ["woDate", "Work order date", "date"], ["client", "Department / client"],
  ["location", "Location"], ["amount", "Work order amount (₹)", "number"], ["startDate", "Start date", "date"], ["endDate", "Stipulated completion", "date"],
  ["engineer", "Site engineer / supervisor"], ["jen", "JEN"], ["aen", "AEN"], ["xen", "XEN"]];
const siteForm = (s) => `<div class="form-grid">${SITE_FIELDS.map(([k, l, t]) => k === "name"
  ? `<label class="field" style="grid-column:1/-1">${l}<textarea data-sf="name" rows="2">${esc(s.name || "")}</textarea></label>`
  : `<label class="field">${l}<input data-sf="${k}" type="${t || "text"}" value="${esc(s[k] ?? "")}"></label>`).join("")}</div>`;
const readSiteForm = (el) => Object.fromEntries($$("[data-sf]", el).map((i) => [i.dataset.sf, i.type === "number" ? num(i.value) : i.value.trim()]));
const saveSite = (s) => { s.updatedAt = Date.now(); return idb.put("sites", s); };

// ---------------------------------------------------------------------------
// Diary data
// ---------------------------------------------------------------------------

const dKey = (siteId, day) => `${siteId}|${day}`;
function entry(day, create = false) {
  const k = dKey(state.siteId, day);
  let d = state.diary.get(k);
  if (!d && create) { d = { id: k, siteId: state.siteId, date: day, weather: "", hours: "", labour: [], work: [], materials: [], machinery: [], hindrance: "", remarks: "", visitors: "" }; state.diary.set(k, d); }
  return d;
}
let saveT = null;
function saveEntry(d) { clearTimeout(saveT); saveT = setTimeout(() => idb.put("diary", d), 300); }
const entriesOf = (siteId, from, to) => [...state.diary.values()].filter((d) => d.siteId === siteId && (!from || d.date >= from) && (!to || d.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
async function photosOf(siteId, from, to) {
  return (await allFiles()).filter((f) => f.owner === siteId && f.kind === "photo" && (!from || isoDay(f.date) >= from) && (!to || isoDay(f.date) <= to)).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export async function renderSites() {
  const root = $("#sitesRoot"); if (!root) return;
  const s = site();
  if (!s) {
    root.innerHTML = `<div class="card empty-state"><h2>Site diary</h2><p>Make a folder for each construction site. Every day, enter labour, work done and materials, and take photos with the GPS camera: they go straight into that site's daily progress report (DPR). Weekly and monthly reports (WPR, MPR), the photo gallery with 4-photo print sheets, and the site's documents are kept in the same place.</p>
      <button class="primary" data-act="newSite">＋ Create your first site</button></div>`;
    return;
  }
  const tabs = [["today", "Daily entry"], ["photos", "📷 Camera & photos"], ["reports", "Reports (DPR / WPR / MPR)"], ["docs", "Documents"], ["details", "Site details"]];
  root.innerHTML = `<div class="site-head"><div><h2>${esc(s.name)}</h2><p class="muted small">${[s.workOrderNo && `W.O. ${esc(s.workOrderNo)}${s.woDate ? ` dt. ${fd(s.woDate)}` : ""}`, esc(s.client || ""), esc(s.location || "")].filter(Boolean).join(" · ")}</p></div>
      <button class="primary cam-btn" data-act="camera">📷 GPS camera</button></div>
    <nav class="subnav">${tabs.map(([k, l]) => `<button data-stab="${k}" class="${state.tab === k ? "active" : ""}">${l}</button>`).join("")}</nav><div id="siteBody"></div>`;
  const body = $("#siteBody", root);
  if (state.tab === "today") body.innerHTML = await todayView();
  if (state.tab === "photos") body.innerHTML = await photosView();
  if (state.tab === "reports") body.innerHTML = reportsView();
  if (state.tab === "details") body.innerHTML = `<div class="card"><h2>Site details</h2>${siteForm(s)}<div class="row gap mt"><button class="primary" data-act="saveSite">Save</button><button class="ghost danger-text" data-act="delSite">Delete this site</button></div></div>`;
  if (state.tab === "docs") await rerenderDocs(body);
}
async function rerenderDocs(body) {
  // docsPanel binds to the element it was made with; make a fresh one per render of this tab.
  state.docs = docsPanel(body, { owner: site().id, title: `Documents · ${site().name.slice(0, 60)}`, folders: () => site()?.folders || SITE_FOLDERS,
    saveFolders: (list) => { const x = site(); x.folders = list; saveSite(x); }, targets: () => [{ id: "company", name: "Company profile" }, ...state.sites.map((x) => ({ id: x.id, name: x.name.slice(0, 60) }))], ctx });
  await state.docs();
}

const rowTable = (key, cols, rows, addLabel, quick = "") => `<div class="table-wrap"><table class="data diary-tab" data-list="${key}"><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join("")}<th></th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr data-i="${i}">${cols.map(([k, , t, list]) => `<td><input data-k="${k}" ${t === "number" ? 'type="number" step="any" class="num w90"' : ""} ${list ? `list="${list}"` : ""} value="${esc(r[k] ?? "")}"></td>`).join("")}<td><button class="icon danger-text" data-delrow>×</button></td></tr>`).join("")}</tbody></table></div>
  <div class="row gap wrap"><button class="ghost small" data-addrow="${key}">＋ ${addLabel}</button>${quick}</div>`;

async function todayView() {
  const day = state.date, d = entry(day) || { labour: [], work: [], materials: [], machinery: [] };
  const photos = await photosOf(state.siteId, day, day);
  const prevWork = [...new Set([...state.diary.values()].filter((x) => x.siteId === state.siteId).flatMap((x) => x.work.map((w) => w.desc)).filter(Boolean))];
  const labourTotal = d.labour.reduce((a, l) => a + num(l.count), 0);
  return `<div class="card"><div class="row between wrap"><div class="row gap"><button class="ghost" data-day="-1">‹</button><input type="date" id="diaryDate" value="${day}"><button class="ghost" data-day="1">›</button>
      <b>${longDay(day)}</b>${day === today() ? `<span class="badge">Today</span>` : ""}</div>
      <div class="row gap"><button class="ghost" data-act="copyPrev" title="Copy labour and machinery from the last entry">Copy last day's labour</button><button class="primary" data-act="printDpr">Print DPR</button></div></div>
    <div class="form-grid compact mt"><label class="field">Weather<select data-f="weather"><option value=""></option>${WEATHER.map((w) => `<option ${d.weather === w ? "selected" : ""}>${w}</option>`).join("")}</select></label>
      <label class="field">Working hours<input data-f="hours" value="${esc(d.hours || "")}" placeholder="9:00 am – 6:00 pm"></label></div></div>
    <datalist id="dlLabour">${LABOUR.map((x) => `<option>${x}</option>`).join("")}</datalist><datalist id="dlUnit">${UNITS.map((x) => `<option>${x}</option>`).join("")}</datalist><datalist id="dlWork">${prevWork.map((x) => `<option>${esc(x)}</option>`).join("")}</datalist>
    <div class="grid-2">
      <div class="card"><h3>Labour on site <span class="muted">(${labourTotal})</span></h3>${rowTable("labour", [["type", "Category", "", "dlLabour"], ["count", "Nos", "number"], ["agency", "Contractor / agency"]], d.labour, "Labour",
        LABOUR.slice(0, 5).map((x) => `<button class="chip" data-quick="${x}">${x}</button>`).join(""))}</div>
      <div class="card"><h3>Machinery / equipment</h3>${rowTable("machinery", [["name", "Machine"], ["count", "Nos", "number"], ["hours", "Hours", "number"]], d.machinery, "Machine")}</div>
    </div>
    <div class="card"><h3>Work done today</h3>${rowTable("work", [["desc", "Item of work", "", "dlWork"], ["loc", "Location / chainage"], ["qty", "Qty", "number"], ["unit", "Unit", "", "dlUnit"]], d.work, "Work item")}</div>
    <div class="card"><h3>Materials received</h3>${rowTable("materials", [["name", "Material"], ["qty", "Qty", "number"], ["unit", "Unit", "", "dlUnit"], ["supplier", "Supplier"], ["challan", "Challan No."]], d.materials, "Material")}</div>
    <div class="grid-3">
      <label class="field card">Hindrances / problems<textarea data-f="hindrance" rows="3">${esc(d.hindrance || "")}</textarea></label>
      <label class="field card">Instructions / visitors<textarea data-f="visitors" rows="3">${esc(d.visitors || "")}</textarea></label>
      <label class="field card">Remarks<textarea data-f="remarks" rows="3">${esc(d.remarks || "")}</textarea></label></div>
    <div class="card"><div class="row between"><h3>Photos of this day (${photos.length})</h3><button class="ghost" data-act="camera">📷 Take photo</button></div>
      ${photos.length ? `<div class="thumbs">${photos.map((p) => `<figure data-pid="${p.id}"><img src="${p.thumb}" alt="" data-view><figcaption>${esc(p.caption || "")}<small>${fmtDateTime(p.date).slice(11, 19)}</small></figcaption></figure>`).join("")}</div>` : `<p class="muted">Photos taken today with the GPS camera appear here and in the DPR.</p>`}</div>`;
}

async function photosView() {
  const f = state.filter;
  const all = await photosOf(state.siteId, f.from, f.to);
  const list = f.q ? all.filter((p) => (p.caption || "").toLowerCase().includes(f.q.toLowerCase())) : all;
  const byDay = new Map();
  for (const p of [...list].reverse()) { const k = isoDay(p.date); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p); }
  const sel = state.photoSel; const st = stampSettings();
  return `<div class="card"><h2>GPS camera</h2>${cameraControls(st)}</div>
    <div class="card"><div class="row between wrap"><h2>Gallery (${all.length})</h2>
      <div class="row gap wrap"><input type="date" data-pf="from" value="${f.from}" title="From"><input type="date" data-pf="to" value="${f.to}" title="To"><input type="search" data-pf="q" value="${esc(f.q)}" placeholder="Search captions"></div></div>
      <div class="row gap wrap mt"><span class="muted small">${sel.size ? `${sel.size} selected` : "Tick photos to print, download or move them (nothing ticked = all shown)"}</span>
        <button class="primary" data-act="printPhotos">Print photo sheets (4 per page)</button><button class="ghost" data-act="zipPhotos">Download (ZIP)</button>
        <button class="ghost" data-act="selAll">${sel.size ? "Clear selection" : "Select all shown"}</button>
        <button class="ghost" data-act="movePhotos" ${sel.size ? "" : "disabled"}>Move to site…</button><button class="ghost danger-text" data-act="delPhotos" ${sel.size ? "" : "disabled"}>Delete</button></div>
      ${byDay.size ? [...byDay].map(([day, ps]) => `<h3 class="mt">${longDay(day)} <span class="muted">(${ps.length})</span></h3><div class="gallery">${ps.map((p) => `<div class="gph ${sel.has(p.id) ? "sel" : ""}" data-pid="${p.id}">
          <label class="gph-check"><input type="checkbox" data-psel ${sel.has(p.id) ? "checked" : ""}></label><img src="${p.thumb}" alt="" data-view>
          <input data-cap value="${esc(p.caption || "")}" placeholder="What is this photo about?"><small class="muted">${fmtDateTime(p.date)}${p.gps ? " · 📍" : ""}</small></div>`).join("")}</div>`).join("")
        : `<p class="muted mt">No photos yet.</p>`}</div>`;
}

// ---------------------------------------------------------------------------
// GPS camera
// ---------------------------------------------------------------------------

function stampSettings() { try { return { loc: true, addr: true, time: true, site: true, ...JSON.parse(localStorage.getItem("site.stamp") || "{}") }; } catch { return { loc: true, addr: true, time: true, site: true }; } }
const cameraControls = (st) => `<div class="cam">
  <label class="field">Save to site<select id="camSite">${state.sites.map((s) => `<option value="${s.id}" ${s.id === state.siteId ? "selected" : ""}>${esc(s.name.slice(0, 70))}</option>`).join("")}</select></label>
  <label class="field">What is this photo about? (printed on the photo and in reports)<input id="camCap" placeholder="e.g. PCC in drain Ch. 120–150 m"></label>
  <fieldset class="stamp-opts"><legend>Stamp on the photo</legend>
    <label><input type="checkbox" data-st="loc" ${st.loc ? "checked" : ""}> GPS location (lat / long)</label>
    <label><input type="checkbox" data-st="addr" ${st.addr ? "checked" : ""}> Address (needs internet)</label>
    <label><input type="checkbox" data-st="time" ${st.time ? "checked" : ""}> Date &amp; time</label>
    <label><input type="checkbox" data-st="site" ${st.site ? "checked" : ""}> Site name &amp; W.O. No.</label>
    <small class="muted">Untick everything for a plain photo.</small></fieldset>
  <div class="row gap wrap"><label class="primary btn-file big">📷 Take photo<input type="file" accept="image/*" capture="environment" id="camShot" hidden></label>
    <label class="ghost btn-file">🖼 Choose from gallery<input type="file" accept="image/*" multiple id="camPick" hidden></label><span class="status" id="camStatus"></span></div></div>`;

function cameraDialog() {
  ctx.modal(`<h2>📷 GPS camera</h2>${cameraControls(stampSettings())}`, () => {});
}

async function takePhotos(files, fromCamera, scope) {
  const st = stampSettings();
  const siteId = $("#camSite", scope)?.value || state.siteId;
  const s = state.sites.find((x) => x.id === siteId);
  const caption = $("#camCap", scope)?.value.trim() || "";
  const status = (t) => { const el = $("#camStatus", scope); if (el) el.textContent = t; };
  let here = null;
  if (st.loc && fromCamera) { status("Getting GPS location…"); here = await getPosition(); if (!here) ctx.toast("Location not available: allow location for this site in the browser settings. The photo is saved without it.", 6000); }
  let n = 0;
  for (const file of files) {
    status(`Saving photo ${++n} of ${files.length}…`);
    const ex = await readExif(file);
    const date = fromCamera ? new Date().toISOString() : ex.date || new Date(file.lastModified || Date.now()).toISOString();
    const gps = st.loc ? (fromCamera ? here : ex.gps || null) : null;
    const addr = st.addr && gps ? await reverseGeocode(gps.lat, gps.lon) : "";
    const lines = [st.site && s ? `${s.name.slice(0, 90)}${s.workOrderNo ? ` · W.O. ${s.workOrderNo}` : ""}` : "", caption, addr, gps ? fmtLatLon(gps) : "", st.time ? fmtDateTime(date) : ""];
    const blob = await stampPhoto(file, lines);
    await saveFile(new File([blob], `photo_${isoDay(date)}_${n}.jpg`, { type: "image/jpeg" }), { owner: siteId, kind: "photo", date, caption, gps: gps ? { ...gps, address: addr } : null, thumb: await thumbOf(blob) });
  }
  status("");
  ctx.toast(`${files.length} photo(s) saved to ${s?.name.slice(0, 40) || "the site"}${isoDay(new Date().toISOString()) === today() ? " (in today's DPR)" : ""}.`);
  if (scope !== $("#sitesRoot")) ctx.closeModal();
  if (siteId !== state.siteId) switchSite(siteId); else renderSites();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function onClick(e) {
  const t = e.target;
  const act = t.closest("[data-act]")?.dataset.act;
  if (t.closest("[data-stab]")) { state.tab = t.closest("[data-stab]").dataset.stab; state.report = null; return renderSites(); }
  if (act === "newSite") return newSiteDialog();
  if (act === "camera") { cameraDialog(); return; }
  if (t.closest("[data-day]")) { state.date = addDays(state.date, +t.closest("[data-day]").dataset.day); return renderSites(); }
  if (act === "saveSite") { Object.assign(site(), readSiteForm($("#sitesRoot"))); await saveSite(site()); ctx.toast("Saved."); ctx.refreshHeader(); return renderSites(); }
  if (act === "delSite") {
    const s = site(); if (!confirm(`Delete the site "${s.name}" with its diary, photos and documents?`)) return;
    for (const f of (await allFiles()).filter((x) => x.owner === s.id)) await delFile(f.id);
    for (const d of entriesOf(s.id)) { state.diary.delete(d.id); await idb.del("diary", d.id); }
    await idb.del("sites", s.id); state.sites = state.sites.filter((x) => x !== s);
    switchSite(state.sites[0]?.id || null); ctx.refreshHeader(); return;
  }
  if (t.closest("[data-addrow]")) { const d = entry(state.date, true); d[t.closest("[data-addrow]").dataset.addrow].push({}); saveEntry(d); return renderSites(); }
  if (t.closest("[data-quick]")) { const d = entry(state.date, true); d.labour.push({ type: t.closest("[data-quick]").dataset.quick, count: "" }); saveEntry(d); return renderSites(); }
  if (t.matches("[data-delrow]")) { const d = entry(state.date, true); d[t.closest("[data-list]").dataset.list].splice(+t.closest("tr").dataset.i, 1); saveEntry(d); return renderSites(); }
  if (act === "copyPrev") {
    const prev = entriesOf(state.siteId, "", addDays(state.date, -1)).filter((x) => x.labour.length).at(-1);
    if (!prev) { ctx.toast("No earlier day with labour entered."); return; }
    const d = entry(state.date, true); d.labour = structuredClone(prev.labour); d.machinery = structuredClone(prev.machinery || []); saveEntry(d); ctx.toast(`Copied from ${fd(prev.date)}.`); return renderSites();
  }
  if (act === "printDpr") return printReport("DPR", state.date, state.date);
  if (t.matches("[data-view]")) { const f = (await allFiles()).find((x) => x.id === t.closest("[data-pid]").dataset.pid); if (f) viewPhoto(f); return; }
  if (act === "selAll") { if (state.photoSel.size) state.photoSel.clear(); else (await shownPhotos()).forEach((p) => state.photoSel.add(p.id)); return renderSites(); }
  if (act === "printPhotos") { const ps = await chosenPhotos(); if (!ps.length) { ctx.toast("No photos to print."); return; } return printNow(photoSheets(ps, site())); }
  if (act === "zipPhotos") { const ps = await chosenPhotos(); ctx.download(await makeZip(ps.map((p, i) => ({ name: `${isoDay(p.date)}_${String(i + 1).padStart(3, "0")}${p.caption ? "_" + safeName(p.caption).slice(0, 40) : ""}.jpg`, data: p.blob }))), `${safeName(site().name).slice(0, 40)}_photos.zip`); return; }
  if (act === "delPhotos") { if (!confirm(`Delete ${state.photoSel.size} photo(s)?`)) return; for (const id of state.photoSel) await delFile(id); state.photoSel.clear(); return renderSites(); }
  if (act === "movePhotos") {
    ctx.modal(`<h2>Move ${state.photoSel.size} photo(s) to</h2><select id="mvSite">${state.sites.map((s) => `<option value="${s.id}">${esc(s.name.slice(0, 80))}</option>`).join("")}</select><button class="primary mt" id="mvGo">Move</button>`, (m) => {
      $("#mvGo", m).onclick = async () => { const to = $("#mvSite", m).value; for (const f of await chosenPhotos()) { f.owner = to; await putFile(f); } state.photoSel.clear(); ctx.closeModal(); renderSites(); };
    });
    return;
  }
  if (act === "makeReport") {
    const kind = $("#rpKind").value, from = $("#rpFrom").value, to = $("#rpTo").value;
    if (!from || !to || from > to) { ctx.toast("Choose a valid period."); return; }
    return printReport(kind, from, to, $("#rpPhotos").value);
  }
  if (act === "excelReport") { const from = $("#rpFrom").value, to = $("#rpTo").value; return reportExcel($("#rpKind").value, from, to); }
}

function onChange(e) {
  const t = e.target;
  if (t.id === "diaryDate") { state.date = t.value || today(); return renderSites(); }
  if (t.id === "camShot" || t.id === "camPick") { const files = [...t.files]; t.value = ""; if (files.length) takePhotos(files, t.id === "camShot", $("#sitesRoot")); return; }
  if (t.matches("[data-st]")) { const st = stampSettings(); st[t.dataset.st] = t.checked; localStorage.setItem("site.stamp", JSON.stringify(st)); return; }
  if (t.matches("[data-psel]")) { const id = t.closest("[data-pid]").dataset.pid; t.checked ? state.photoSel.add(id) : state.photoSel.delete(id); return renderSites(); }
  if (t.matches("[data-cap]")) { allFiles().then((fs) => { const f = fs.find((x) => x.id === t.closest("[data-pid]").dataset.pid); if (f) { f.caption = t.value.trim(); putFile(f); } }); return; }
  if (t.matches("[data-pf]")) { state.filter[t.dataset.pf] = t.value; return renderSites(); }
  if (t.id === "rpKind") { const [a, b] = defaultPeriod(t.value); $("#rpFrom").value = a; $("#rpTo").value = b; }
  if (t.matches("[data-f]")) { const d = entry(state.date, true); d[t.dataset.f] = t.value; saveEntry(d); }
}
function onInput(e) {
  const t = e.target;
  if (t.matches("[data-list] input[data-k]")) {
    const d = entry(state.date, true); const list = d[t.closest("[data-list]").dataset.list]; const i = +t.closest("tr").dataset.i;
    list[i][t.dataset.k] = t.type === "number" ? t.value : t.value; saveEntry(d);
  }
  if (t.matches("textarea[data-f], input[data-f]")) { const d = entry(state.date, true); d[t.dataset.f] = t.value; saveEntry(d); }
}

async function shownPhotos() { const f = state.filter; const all = await photosOf(state.siteId, f.from, f.to); return f.q ? all.filter((p) => (p.caption || "").toLowerCase().includes(f.q.toLowerCase())) : all; }
async function chosenPhotos() { const shown = await shownPhotos(); return state.photoSel.size ? (await allFiles()).filter((f) => state.photoSel.has(f.id)).sort((a, b) => a.date.localeCompare(b.date)) : shown; }

// The camera inputs also live inside the modal.
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t.closest("#modalBody")) return;
  if (t.id === "camShot" || t.id === "camPick") { const files = [...t.files]; t.value = ""; if (files.length) takePhotos(files, t.id === "camShot", $("#modalBody")); }
  if (t.matches("[data-st]")) { const st = stampSettings(); st[t.dataset.st] = t.checked; localStorage.setItem("site.stamp", JSON.stringify(st)); }
});

function viewPhoto(f) {
  const url = URL.createObjectURL(f.blob);
  ctx.modal(`<h2>${esc(f.caption || "Photo")}</h2><img src="${url}" style="max-width:100%;border-radius:8px">
    <p class="small muted">${fmtDateTime(f.date)}${f.gps ? ` · ${fmtLatLon(f.gps)}${f.gps.address ? ` · ${esc(f.gps.address)}` : ""} · <a href="https://www.google.com/maps?q=${f.gps.lat},${f.gps.lon}" target="_blank" rel="noopener">Open in map</a>` : ""}</p>
    <a class="ghost btn" href="${url}" download="${esc(f.name)}">Download</a>`);
}

// ---------------------------------------------------------------------------
// Reports: DPR (a day), WPR (a week), MPR (a month) or any period
// ---------------------------------------------------------------------------

function defaultPeriod(kind) {
  const t = today();
  if (kind === "DPR") return [t, t];
  if (kind === "WPR") { const d = new Date(t + "T12:00"); const back = (d.getDay() + 6) % 7; const mon = addDays(t, -back); return [mon, addDays(mon, 6)]; }
  if (kind === "MPR") { const d = new Date(t + "T12:00"); const a = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return [a, isoDay(e)]; }
  return [addDays(t, -30), t];
}
function reportsView() {
  const [a, b] = defaultPeriod("WPR");
  const days = entriesOf(state.siteId).length;
  return `<div class="card"><h2>Progress reports</h2><p class="muted small">Made from the daily entries and photos of this site (${days} day${days === 1 ? "" : "s"} entered). Work done is shown for the period and cumulative up to its last day.</p>
    <div class="form-grid compact"><label class="field">Report<select id="rpKind"><option value="DPR">DPR · daily</option><option value="WPR" selected>WPR · weekly</option><option value="MPR">MPR · monthly</option><option value="PR">Any period</option></select></label>
      <label class="field">From<input type="date" id="rpFrom" value="${a}"></label><label class="field">To<input type="date" id="rpTo" value="${b}"></label>
      <label class="field">Photos<select id="rpPhotos"><option value="8">Up to 8 photos</option><option value="4">Up to 4 photos</option><option value="all">All photos of the period</option><option value="0">No photos</option></select></label></div>
    <div class="row gap mt"><button class="primary" data-act="makeReport">Print / save PDF</button><button class="ghost" data-act="excelReport">Excel</button></div></div>`;
}

const TITLES = { DPR: "DAILY PROGRESS REPORT", WPR: "WEEKLY PROGRESS REPORT", MPR: "MONTHLY PROGRESS REPORT", PR: "PROGRESS REPORT" };

function aggregate(siteId, from, to) {
  const E = entriesOf(siteId, from, to);
  const sum = (list, keyf, valf) => { const m = new Map(); for (const x of list) { const k = keyf(x); if (!k) continue; m.set(k, round((m.get(k) || 0) + num(valf(x)), 3)); } return m; };
  const labour = sum(E.flatMap((d) => d.labour), (l) => (l.type || "").trim(), (l) => l.count);
  const work = sum(E.flatMap((d) => d.work), (w) => `${(w.desc || "").trim()}|${(w.unit || "").trim()}`, (w) => w.qty);
  const upto = sum(entriesOf(siteId, "", to).flatMap((d) => d.work), (w) => `${(w.desc || "").trim()}|${(w.unit || "").trim()}`, (w) => w.qty);
  const materials = sum(E.flatMap((d) => d.materials), (m) => `${(m.name || "").trim()}|${(m.unit || "").trim()}`, (m) => m.qty);
  const machinery = sum(E.flatMap((d) => d.machinery || []), (m) => (m.name || "").trim(), (m) => m.hours);
  return { E, labour, work, upto, materials, machinery };
}

async function printReport(kind, from, to, photoOpt = "8") {
  const s = site(); const co = ctx.company() || {};
  const A = aggregate(s.id, from, to);
  const one = from === to, d = one ? A.E[0] : null;
  let photos = photoOpt === "0" ? [] : await photosOf(s.id, from, to);
  if (photoOpt !== "all" && photoOpt !== "0") photos = pickSpread(photos, +photoOpt || 8);
  const tbl = (head, rows, empty = "Nil") => rows.length ? `<table class="r-tab"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i && typeof c === "number" ? "r" : ""}">${typeof c === "number" ? q3(c) : c}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<p>${empty}</p>`;
  const labourRows = one ? (d?.labour || []).filter((l) => l.type || num(l.count)).map((l) => [esc(l.type || ""), num(l.count), esc(l.agency || "")]) : [...A.labour].map(([k, v]) => [esc(k), v, round(v / Math.max(1, A.E.length), 1)]);
  const workRows = [...A.work].map(([k, v]) => { const [desc, unit] = k.split("|"); const locs = one ? (d.work.filter((w) => (w.desc || "").trim() === desc).map((w) => w.loc).filter(Boolean).join(", ")) : ""; return [esc(desc) + (locs ? `<br><small>${esc(locs)}</small>` : ""), esc(unit), v, A.upto.get(k) || v]; });
  const matRows = one ? (d?.materials || []).filter((m) => m.name).map((m) => [esc(m.name), num(m.qty), esc(m.unit || ""), esc(m.supplier || ""), esc(m.challan || "")]) : [...A.materials].map(([k, v]) => { const [n, u] = k.split("|"); return [esc(n), v, esc(u)]; });
  const machRows = one ? (d?.machinery || []).filter((m) => m.name).map((m) => [esc(m.name), num(m.count), num(m.hours)]) : [...A.machinery].map(([k, v]) => [esc(k), v]);
  const notes = A.E.filter((x) => x.hindrance || x.remarks || x.visitors);
  const head = `<div class="r-co">${esc((co.name || "").toUpperCase())}${co.address ? `<small>${esc(co.address)}</small>` : ""}</div>
    <div class="r-title">${TITLES[kind] || TITLES.PR}</div>
    <table class="r-meta"><tr><td>Name of work</td><td>: ${esc(s.name)}</td></tr>
      ${s.workOrderNo ? `<tr><td>Work order No.</td><td>: ${esc(s.workOrderNo)}${s.woDate ? ` dated ${fd(s.woDate)}` : ""}</td></tr>` : ""}
      ${s.client ? `<tr><td>Department / client</td><td>: ${esc(s.client)}</td></tr>` : ""}${s.location ? `<tr><td>Location</td><td>: ${esc(s.location)}</td></tr>` : ""}
      <tr><td>${one ? "Date" : "Period"}</td><td>: ${one ? `${fd(from)} (${new Date(from + "T12:00").toLocaleDateString("en-IN", { weekday: "long" })})` : `${fd(from)} to ${fd(to)} (${A.E.length} working day${A.E.length === 1 ? "" : "s"} entered)`}</td></tr>
      ${one && d ? `<tr><td>Weather / hours</td><td>: ${esc(d.weather || "-")}${d.hours ? ` · ${esc(d.hours)}` : ""}</td></tr>` : ""}</table>`;
  const daily = !one && A.E.length ? `<h4>Day-wise summary</h4>${tbl(["Date", "Labour", "Main work done"], A.E.map((x) => [fd(x.date), x.labour.reduce((a, l) => a + num(l.count), 0), esc(x.work.filter((w) => w.desc).map((w) => `${w.desc}${num(w.qty) ? ` ${q3(w.qty)} ${w.unit || ""}` : ""}`).join("; ") || "-")]))}` : "";
  const html = `<section class="p-page r-page">${head}
    <h4>1. Labour ${one ? "on site" : "(man-days)"}</h4>${tbl(one ? ["Category", "Nos", "Contractor / agency"] : ["Category", "Man-days", "Average per day"], labourRows)}
    ${labourRows.length ? `<p class="r-tot">Total: ${q3(labourRows.reduce((a, r) => a + num(r[1]), 0))}</p>` : ""}
    <h4>2. Work done</h4>${tbl(["Item of work", "Unit", one ? "Today" : "This period", "Up to date"], workRows)}
    <h4>3. Materials received</h4>${tbl(one ? ["Material", "Qty", "Unit", "Supplier", "Challan"] : ["Material", "Qty", "Unit"], matRows)}
    <h4>4. Machinery / equipment</h4>${tbl(one ? ["Machine", "Nos", "Hours"] : ["Machine", "Hours"], machRows)}
    <h4>5. Hindrances, instructions and remarks</h4>${notes.length ? notes.map((x) => `<p>${one ? "" : `<b>${fd(x.date)}:</b> `}${[x.hindrance && `Hindrance: ${esc(x.hindrance)}`, x.visitors && `Instructions / visitors: ${esc(x.visitors)}`, x.remarks && `Remarks: ${esc(x.remarks)}`].filter(Boolean).join(" · ")}</p>`).join("") : "<p>Nil</p>"}
    ${daily}
    ${photos.length ? `<p class="r-note">Site photographs: ${photos.length} (attached sheets).</p>` : ""}
    <div class="r-signs"><div>Site Engineer / Supervisor<br>${esc(s.engineer || "")}</div><div>Contractor<br>${esc(co.name || "")}</div><div>Checked by (JEN / AEN)</div></div></section>`;
  printNow(html + (photos.length ? photoSheets(photos, s) : ""));
}
function pickSpread(list, n) { if (list.length <= n) return list; const out = []; for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)]); return out; }

function reportExcel(kind, from, to) {
  const X = window.XLSX, s = site(), A = aggregate(s.id, from, to);
  const wb = X.utils.book_new();
  const head = [[TITLES[kind] || TITLES.PR], [`Name of work: ${s.name}`], [`Work order: ${s.workOrderNo || ""} ${s.woDate ? fd(s.woDate) : ""}`], [`Period: ${fd(from)} to ${fd(to)}`], []];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Item of work", "Unit", "This period", "Up to date"], ...[...A.work].map(([k, v]) => { const [d, u] = k.split("|"); return [d, u, v, A.upto.get(k) || v]; })]), "Work done");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Category", "Man-days"], ...[...A.labour]]), "Labour");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Material", "Unit", "Qty"], ...[...A.materials].map(([k, v]) => { const [n, u] = k.split("|"); return [n, u, v]; })]), "Materials");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Date", "Weather", "Labour", "Work done", "Materials", "Hindrance", "Remarks"],
    ...A.E.map((d) => [fd(d.date), d.weather, d.labour.reduce((a, l) => a + num(l.count), 0), d.work.map((w) => `${w.desc} ${w.qty || ""} ${w.unit || ""}`).join("; "), d.materials.map((m) => `${m.name} ${m.qty || ""} ${m.unit || ""}`).join("; "), d.hindrance, d.remarks])]), "Daily");
  X.writeFile(wb, `${kind}_${safeName(s.name).slice(0, 40)}_${from}_${to}.xlsx`);
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** Four photos to a sheet, laid out landscape (turned on the portrait A4 page so every browser prints it the same). */
export function photoSheets(photos, s) {
  const pages = []; for (let i = 0; i < photos.length; i += 4) pages.push(photos.slice(i, i + 4));
  const urls = photos.map((p) => URL.createObjectURL(p.blob)); setTimeout(() => urls.forEach(URL.revokeObjectURL), 300000);
  let k = 0;
  return pages.map((ph, pi) => `<section class="p-page p-photos p-rot"><div class="p-rot-in"><header class="p-head">${s.client ? `<div class="p-org">${esc(s.client)}</div>` : ""}
      <div><b>Name of work:</b> ${esc(s.name)}</div><div><b>Work order No.:</b> ${esc(s.workOrderNo || "")} ${s.woDate ? `dated ${fd(s.woDate)}` : ""}</div></header>
    <div class="p-photo-grid">${ph.map((x) => `<figure><img src="${urls[k++]}" alt=""><figcaption>${esc(x.caption || "")}${x.caption ? " · " : ""}${fmtDateTime(x.date).slice(0, 19)}</figcaption></figure>`).join("")}</div>
    <div class="p-sign"><div>JEN</div><div>AEN</div><div>XEN</div></div><div class="p-pageno">Page ${pi + 1} of ${pages.length}</div></div></section>`).join("");
}
function printNow(html) {
  const area = $("#printArea"); area.innerHTML = html;
  const imgs = $$("img", area).filter((i) => !i.complete);
  Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))).then(() => window.print());
}
