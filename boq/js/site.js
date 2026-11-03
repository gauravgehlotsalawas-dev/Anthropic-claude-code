// Site diary: one folder per construction site with daily entries (labour, work done, materials,
// machinery, hindrances), a GPS camera, a photo gallery, DPR / WPR / MPR reports and site documents.
import { idb, uid, num, round, esc } from "./store.js";
import { saveFile, allFiles, putFile, delFile, readExif, getPosition, reverseGeocode, fmtLatLon, fmtDateTime, stampPhoto, thumbOf, makeZip, safeName, blobToDataUrl } from "./files.js";
import { docsPanel, SITE_FOLDERS } from "./docs.js";
import { readDocument, parseWorkOrder } from "./docread.js";
import { extractBoq } from "./bills.js";
import { estimateMaterials, MATS, matOf } from "./materials.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let ctx = null;
const state = { sites: [], diary: new Map(), siteId: null, tab: "today", date: today(), photoSel: new Set(), filter: { from: "", to: "", q: "" }, report: null, docs: null };

const LABOUR = ["Mason", "Beldar / Labour", "Carpenter", "Bar bender", "Helper", "Plumber", "Electrician", "Painter", "Operator", "Supervisor"];
const UNITS = ["cum", "sqm", "rmt", "m", "kg", "MT", "nos", "bags", "trips", "ltr", "LS"];
const MAT_NAMES = ["Cement (bags)", "Sand / bajri", "Aggregate / gitti 20 mm", "Aggregate / gitti 40 mm", "Steel TMT", "Bricks", "Water (tanker)", "Diesel"];
const MACHINES = ["JCB", "Tractor trolley", "Dumper / tipper", "Concrete mixer", "Vibrator", "Water tanker", "Roller", "Hydra / crane", "Transit mixer", "Generator"];
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
  root.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-acpick], [data-acprev]"); if (b) { e.preventDefault(); pickAc(b); } });
  root.addEventListener("focusin", (e) => { if (e.target.matches("[data-ac]")) showAc(e.target); });
  root.addEventListener("focusout", (e) => { if (e.target.matches("[data-ac]")) setTimeout(() => { if (!document.activeElement?.matches?.("[data-ac]")) hideAc(); }, 250); });
}

export function switchSite(id) {
  state.siteId = id; state.photoSel.clear(); state.report = null;
  idb.put("kv", { id: "currentSite", value: id });
  renderSites();
}

// Documents chosen while making (or editing) a site, read to fill the form and then saved in its folders.
const OTHER_FOLDERS = ["Agreement", "Test reports", "STP", "Drawings", "Letters", "Challans", "MB & bills", "Others"];
const listNames = (names) => (names?.length ? names.map((n) => `📄 ${esc(n)}`).join("<br>") : "No file");
const docPicker = (ex = null) => `<div class="card upload-card ns-docs"><h3>${ex ? "Documents of this site" : `Start from documents <span class="muted small">(optional)</span>`}</h3>
  ${ex ? `<p class="muted small">Already saved files are listed. Add more here (they are read again to fill empty fields), or open them in <b>Documents</b>.</p>` : `<p class="muted small">Add the work order and the BOQ (PDF, Excel, Word or photos). The name of work, W.O. No. and date, department, amount, dates, contractor and engineers are read from them (OCR on this device), and the BOQ items become the list of work items for the daily entry. Check the form below before saving. All files are saved in the site's document folders.</p>`}
  <div class="ns-grid">
    <div><b>Work order</b><label class="ghost btn-file">⇪ Choose<input type="file" multiple data-ns="wo" hidden></label><small data-nsl="wo" class="muted">${listNames(ex?.wo)}</small></div>
    <div><b>BOQ</b><label class="ghost btn-file">⇪ Choose<input type="file" multiple data-ns="boq" hidden></label><small data-nsl="boq" class="muted">${listNames(ex?.boq)}</small></div>
    <div><b>Agreement &amp; other documents</b><span class="row gap"><select data-nsfolder>${OTHER_FOLDERS.map((f) => `<option>${f}</option>`).join("")}</select><label class="ghost btn-file">⇪ Choose<input type="file" multiple data-ns="other" hidden></label></span><small data-nsl="other" class="muted">${listNames(ex?.other)}</small></div>
  </div><p class="status" data-nsstatus></p></div>`;

/** Wires the document picker inside el; returns what was read and the files to save. */
function bindDocPicker(el) {
  // Listen on the picker card itself: the modal body is reused, so listeners on it would pile up.
  const card = $(".ns-docs", el);
  const got = { files: [], boqItems: null, terms: null };
  const status = (t, cls = "") => { const x = $("[data-nsstatus]", el); if (x) { x.textContent = t; x.className = "status " + cls; } };
  const setField = (k, v, src = "wo") => {
    if (v == null || v === "" || v === 0) return;
    const i = $(`[data-sf="${k}"]`, el); if (!i) return;
    if (i.value.trim() && !i.classList.contains("auto")) return; // never overwrite what the user typed
    if (src === "wo" && i.dataset.src === "boq") return; // the BOQ's typed name of work beats an OCR reading of the work order
    i.value = v; i.classList.add("auto"); i.dataset.src = src;
  };
  card.addEventListener("change", async (e) => {
    const t = e.target; if (!t.matches("[data-ns]")) return;
    const kind = t.dataset.ns, files = [...t.files]; t.value = ""; if (!files.length) return;
    const folder = kind === "wo" ? "Work order" : kind === "boq" ? "BOQ" : $("[data-nsfolder]", el).value;
    files.forEach((f) => got.files.push({ file: f, folder, kind }));
    const lab = $(`[data-nsl="${kind}"]`, el); lab.innerHTML = (lab.dataset.had ??= lab.textContent === "No file" ? "" : lab.innerHTML + "<br>") + got.files.filter((x) => x.kind === kind).map((x) => `📎 ${esc(x.file.name)} <span class="badge">new</span>`).join("<br>");
    try {
      if (kind === "wo") {
        status("Reading the work order… (photos and scans take a little longer)");
        const doc = await readDocument(files, (m) => status(m));
        const w = parseWorkOrder(doc.lines);
        setField("name", w.workName); setField("workOrderNo", w.workOrderNo); setField("woDate", w.woDate); setField("client", w.office); setField("amount", w.amount);
        setField("startDate", w.commence); setField("endDate", w.stipulated); setField("contractor", w.contractor); setField("jen", w.jen); setField("aen", w.aen); setField("xen", w.xen);
        if (w.terms?.length) got.terms = w.terms;
        const n = $$("[data-sf].auto", el).length;
        status(n ? `Work order read: ${n} field(s) filled (shown in green). Please check them.` : "The work order will be saved, but no details could be read from it. Fill the form by hand.", n ? "ok" : "err");
      } else if (kind === "boq") {
        status("Reading the BOQ…");
        const { items, header } = await extractBoq(files, (m) => status(m));
        setField("name", header.work, "boq"); setField("client", header.authority, "boq");
        if (items.length) got.boqItems = items.map((i) => ({ sno: i.sno, description: i.description, unit: i.unit, qty: num(i.quantity), rate: num(i.rate), schedule: i.schedule }));
        status(items.length ? `BOQ read: ${items.length} items${header.work ? " and the name of work" : ""}.` : "The BOQ will be saved, but no items could be read from it.", items.length ? "ok" : "err");
      } else status(`${files.length} document(s) will be saved in ${folder}.`, "ok");
    } catch (err) { console.error(err); status("Could not read: " + err.message, "err"); }
  });
  $$("[data-sf]", el).forEach((i) => i.addEventListener("input", () => i.classList.remove("auto")));
  return got;
}
async function saveSiteDocs(siteId, got) {
  for (const { file, folder } of got.files) await saveFile(file, { owner: siteId, kind: "doc", folder, name: file.name, thumb: file.type.startsWith("image/") ? await thumbOf(file).catch(() => "") : "" });
}

export function newSiteDialog() {
  ctx.modal(`<h2>New site</h2><p class="muted small">Each site keeps its own daily diary, photos, reports and documents.</p>${docPicker()}${siteForm({})}
    <button class="primary mt" id="nsSave">Create site</button>`, (m) => {
    const got = bindDocPicker(m);
    $("#nsSave", m).onclick = async () => {
      const s = { id: uid("site"), createdAt: Date.now(), updatedAt: Date.now(), folders: [...SITE_FOLDERS], ...readSiteForm(m) };
      if (!s.name) { ctx.toast("Give the site a name (or add the work order / BOQ to read it)."); return; }
      if (got.boqItems) s.boqItems = got.boqItems;
      if (got.terms) s.terms = got.terms;
      $("#nsSave", m).disabled = true;
      state.sites.unshift(s); await idb.put("sites", s);
      await saveSiteDocs(s.id, got);
      ctx.closeModal(); switchSite(s.id); ctx.refreshHeader();
      ctx.toast(`Site created${got.files.length ? ` with ${got.files.length} document(s)` : ""}${s.boqItems ? ` and ${s.boqItems.length} BOQ items. The STP application for minerals is ready in Site details` : ""}.`, 6000);
    };
  });
}
const SITE_FIELDS = [["name", "Name of work / site *"], ["workOrderNo", "Work order No."], ["woDate", "Work order date", "date"], ["client", "Department / client"],
  ["location", "Location"], ["amount", "Work order amount (₹)", "number"], ["startDate", "Start date", "date"], ["endDate", "Stipulated completion", "date"],
  ["contractor", "Contractor / firm"], ["engineer", "Site engineer / supervisor"], ["jen", "JEN"], ["aen", "AEN"], ["xen", "XEN"]];
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
  if (!d && create) { d = { id: k, siteId: state.siteId, date: day, weather: "", hours: "", labour: [], work: [], materials: [], machinery: [], consumed: [], hindrance: "", remarks: "", visitors: "" }; state.diary.set(k, d); }
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
  if (state.tab === "details") {
    const docs = (await allFiles()).filter((f) => f.owner === s.id && f.kind === "doc");
    const names = (pred) => docs.filter(pred).map((f) => `${f.name}${["Work order", "BOQ"].includes(f.folder) ? "" : ` (${f.folder})`}`);
    body.innerHTML = `${docPicker({ wo: names((f) => f.folder === "Work order"), boq: names((f) => f.folder === "BOQ"), other: names((f) => !["Work order", "BOQ"].includes(f.folder)) })}<div class="card"><h2>Site details</h2>${siteForm(s)}<div class="row gap mt"><button class="primary" data-act="saveSite">Save</button><button class="ghost danger-text" data-act="delSite">Delete this site</button></div></div>
      ${s.boqItems?.length ? `<div class="card"><h2>BOQ items (${s.boqItems.length})</h2><p class="muted small">Offered as work items in the daily entry.</p><div class="table-wrap tall"><table class="data small"><thead><tr><th>Sch.</th><th>No.</th><th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Rate</th></tr></thead>
        <tbody>${s.boqItems.map((i) => `<tr><td>${esc(i.schedule || "")}</td><td>${esc(i.sno || "")}</td><td>${esc(i.description)}</td><td>${esc(i.unit || "")}</td><td class="num">${q3(i.qty)}</td><td class="num">${i.rate ? round(i.rate, 2) : ""}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
    const ms = materialStatus(s, today());
    if (ms.rows.length || s.boqItems?.length) body.insertAdjacentHTML("beforeend", `<div class="card"><h2>Materials for this work</h2>
      <p class="muted small">Required quantities are worked out from the BOQ items (mix, grade, thickness and unit in each item) with common site thumb rules: an approximate guide, not the department's analysis of rates. Received and consumed come from the daily entries.</p>
      ${ms.rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Material</th><th>Unit</th><th class="num">Required (BOQ, approx.)</th><th class="num">Received</th><th class="num">Consumed</th><th class="num">Balance at site</th><th class="num">Still to come</th></tr></thead>
        <tbody>${matTable(ms).map((r) => `<tr>${r.map((c, i) => `<td class="${i > 1 ? "num" : ""}">${typeof c === "number" ? c.toLocaleString("en-IN") : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">No cement, sand, aggregate, steel or brick items could be recognised in the BOQ.</p>`}
      ${ms.est.rows.length ? `<details class="mt"><summary>How it was worked out (${ms.est.rows.length} items${ms.est.skipped ? `; ${ms.est.skipped} items such as earthwork need no such material` : ""})</summary><div class="table-wrap"><table class="data small"><thead><tr><th>No.</th><th>Item</th><th class="num">Qty</th><th>Basis</th><th class="num">Cement bags</th><th class="num">Sand cum</th><th class="num">Agg. cum</th><th class="num">Steel kg</th><th class="num">Bricks</th><th class="num">Stone cum</th></tr></thead>
        <tbody>${ms.est.rows.map((r) => `<tr><td>${esc(r.sno || "")}</td><td>${esc(r.description.slice(0, 110))}</td><td class="num">${q3(r.qty)} ${esc(r.unit || "")}</td><td class="small">${esc(r.basis)}</td>${["cement", "sand", "agg", "steel", "bricks", "stone"].map((k) => `<td class="num">${r[k] ? round(r[k], ["sand", "agg", "stone"].includes(k) ? 2 : 0) : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>` : ""}</div>`);
    body.insertAdjacentHTML("beforeend", await stpCard(s));
    state.detailsGot = bindDocPicker(body);
  }
  if (state.tab === "docs") await rerenderDocs(body);
}
async function rerenderDocs(body) {
  // docsPanel binds to the element it was made with; make a fresh one per render of this tab.
  state.docs = docsPanel(body, { owner: site().id, title: `Documents · ${site().name.slice(0, 60)}`, folders: () => [...new Set([...(site()?.folders || []), ...SITE_FOLDERS])],
    saveFolders: (list) => { const x = site(); x.folders = list; saveSite(x); }, targets: () => [{ id: "company", name: "Company profile" }, ...state.sites.map((x) => ({ id: x.id, name: x.name.slice(0, 60) }))], ctx });
  await state.docs();
}

// Amounts worked out in the diary tables.
const timeDiff = (a, b) => { if (!a || !b) return null; const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number); let m = h2 * 60 + m2 - (h1 * 60 + m1); if (m < 0) m += 1440; return round(m / 60, 2); };
const CALC = {
  labour: (r) => round(num(r.count) * num(r.rate), 2),
  machinery: (r) => { const n = num(r.count) || 1; return round(r.basis === "hour" ? num(r.hours) * num(r.rate) * n : num(r.rate) * n, 2); },
};
const inr = (v) => (num(v) ? "₹" + num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "");
const listTotal = (key, rows) => round((rows || []).reduce((a, r) => a + CALC[key](r), 0), 2);

/** cols: [key, label, type, datalist] with type "" | "number" | "time" | "sel:value=Label|…" | "calc" */
const rowTable = (key, cols, rows, addLabel, quick = "") => `<div class="table-wrap"><table class="data diary-tab" data-list="${key}"><thead><tr>${cols.map((c) => `<th>${c[1]}</th>`).join("")}<th></th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr data-i="${i}">${cols.map(([k, , t = "", list]) => {
    if (t === "calc") return `<td class="num calc" data-calc>${inr(CALC[key](r))}</td>`;
    if (t.startsWith("sel:")) return `<td><select data-k="${k}">${t.slice(4).split("|").map((o) => { const [v, l] = o.split("="); return `<option value="${v}" ${(r[k] || t.slice(4).split("|")[0].split("=")[0]) === v ? "selected" : ""}>${l || v}</option>`; }).join("")}</select></td>`;
    return `<td><input data-k="${k}" ${t === "number" ? 'type="number" step="any" class="num w90"' : t === "time" ? 'type="time" class="w100"' : ""} ${list ? `list="${list}"` : ""} value="${esc(r[k] ?? "")}"></td>`;
  }).join("")}<td><button class="icon danger-text" data-delrow>×</button></td></tr>`).join("")}</tbody></table></div>
  <div class="row gap wrap"><button class="ghost small" data-addrow="${key}">＋ ${addLabel}</button>${quick}</div>`;

// ---------------------------------------------------------------------------
// Work done: pick BOQ items as you type
// ---------------------------------------------------------------------------

const boqKey = (i) => String(i.sno ?? "");
const findBoq = (r) => (site().boqItems || []).find((i) => (r.boq != null && r.boq !== "" ? boqKey(i) === String(r.boq) : i.description === r.desc));
/** Quantity of a BOQ item entered in the diary up to a day (all days when no day is given). */
function doneUpTo(item, day = "") {
  return round(entriesOf(state.siteId, "", day).flatMap((d) => d.work).filter((w) => (w.boq != null && w.boq !== "" ? String(w.boq) === boqKey(item) : w.desc === item.description)).reduce((a, w) => a + num(w.qty), 0), 3);
}
function workInfo(r) {
  const it = findBoq(r); if (!it) return "";
  const done = doneUpTo(it, state.date), bal = round(num(it.qty) - done, 3);
  return `<b>BOQ ${esc(boqKey(it))}</b> · ${esc(it.unit || "")}${num(it.qty) ? ` · tender ${q3(it.qty)} · done to date ${q3(done)} · <span class="${bal < 0 ? "danger-text" : ""}">balance ${q3(bal)}</span>` : ""}${num(it.rate) ? ` · ₹${round(it.rate, 2)}` : ""}`;
}
const workTable = (rows) => `<div class="table-wrap ac-wrap"><table class="data diary-tab" data-list="work"><thead><tr><th>Item of work</th><th>Location / chainage</th><th>Qty</th><th>Unit</th><th></th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr data-i="${i}"><td class="ac-cell"><input data-k="desc" data-ac autocomplete="off" value="${esc(r.desc ?? "")}" placeholder="Type item name or BOQ No."><div class="ac-info small muted">${workInfo(r)}</div></td>
    <td><input data-k="loc" value="${esc(r.loc ?? "")}"></td><td><input data-k="qty" type="number" step="any" class="num w90" value="${esc(r.qty ?? "")}"></td>
    <td><input data-k="unit" list="dlUnit" class="w70" value="${esc(r.unit ?? "")}"></td><td><button class="icon danger-text" data-delrow>×</button></td></tr>`).join("")}</tbody></table></div>
  <div class="row gap wrap"><button class="ghost small" data-addrow="work">＋ Work item</button></div>`;

function acMatches(q) {
  const items = site().boqItems || [];
  const prev = [...new Set([...state.diary.values()].filter((x) => x.siteId === state.siteId).flatMap((x) => x.work).filter((w) => w.desc && !findBoq(w)).map((w) => w.desc))];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (txt) => words.every((w) => txt.includes(w));
  const out = [];
  if (!words.length) items.slice(0, 8).forEach((it, k) => out.push({ k, it }));
  else {
    items.forEach((it, k) => { const no = boqKey(it).toLowerCase(); const txt = `${no} ${it.description.toLowerCase()}`; if (no === q.trim().toLowerCase() || hit(txt)) out.push({ k, it, exact: no === q.trim().toLowerCase() }); });
    out.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0));
    prev.filter((p) => p.trim().toLowerCase() !== q.trim().toLowerCase() && p.length > q.trim().length + 3 && hit(p.toLowerCase())).slice(0, 3).forEach((p) => out.push({ prev: p }));
  }
  return out.slice(0, 10);
}
function showAc(input) {
  hideAc();
  const list = acMatches(input.value); if (!list.length) return;
  const box = document.createElement("div"); box.className = "ac-list"; box.id = "acList";
  box.innerHTML = list.map((m) => m.it ? `<button type="button" data-acpick="${m.k}"><span class="ac-no">BOQ ${esc(boqKey(m.it))}</span> ${esc(m.it.description.length > 170 ? m.it.description.slice(0, 170) + "…" : m.it.description)}<small> · ${esc(m.it.unit || "")}${num(m.it.qty) ? ` · tender ${q3(m.it.qty)}` : ""}</small></button>`
    : `<button type="button" data-acprev="${esc(m.prev)}"><span class="ac-no">Used before</span> ${esc(m.prev.slice(0, 170))}</button>`).join("");
  input.closest(".ac-cell").appendChild(box);
}
function hideAc() { $("#acList")?.remove(); }
function pickAc(btn) {
  const tr = btn.closest("tr"), d = entry(state.date, true), r = d.work[+tr.dataset.i];
  if (btn.dataset.acpick != null) { const it = site().boqItems[+btn.dataset.acpick]; r.desc = it.description; r.unit = it.unit || r.unit || ""; r.boq = boqKey(it); }
  else { r.desc = btn.dataset.acprev; delete r.boq; }
  saveEntry(d); hideAc(); renderSites().then(() => $(`[data-list="work"] tr[data-i="${tr.dataset.i}"] [data-k="qty"]`)?.focus());
}

async function todayView() {
  const day = state.date, d = entry(day) || { labour: [], work: [], materials: [], machinery: [], consumed: [] };
  const photos = await photosOf(state.siteId, day, day);
  const boqWork = (site().boqItems || []).map((i) => i.description.replace(/\s+/g, " ").slice(0, 120));
  const prevWork = [...new Set([...[...state.diary.values()].filter((x) => x.siteId === state.siteId).flatMap((x) => x.work.map((w) => w.desc)).filter(Boolean), ...boqWork])];
  const labourTotal = d.labour.reduce((a, l) => a + num(l.count), 0);
  return `<div class="card"><div class="row between wrap"><div class="row gap"><button class="ghost" data-day="-1">‹</button><input type="date" id="diaryDate" value="${day}"><button class="ghost" data-day="1">›</button>
      <b>${longDay(day)}</b>${day === today() ? `<span class="badge">Today</span>` : ""}</div>
      <div class="row gap"><button class="ghost" data-act="copyPrev" title="Copy labour and machinery from the last entry">Copy last day's labour</button><button class="primary" data-act="printDpr">Print DPR</button></div></div>
    <div class="form-grid compact mt"><label class="field">Weather<select data-f="weather"><option value=""></option>${WEATHER.map((w) => `<option ${d.weather === w ? "selected" : ""}>${w}</option>`).join("")}</select></label>
      <label class="field">Working hours<input data-f="hours" value="${esc(d.hours || "")}" placeholder="9:00 am – 6:00 pm"></label></div></div>
    <datalist id="dlLabour">${LABOUR.map((x) => `<option>${x}</option>`).join("")}</datalist><datalist id="dlUnit">${UNITS.map((x) => `<option>${x}</option>`).join("")}</datalist><datalist id="dlWork">${prevWork.map((x) => `<option>${esc(x)}</option>`).join("")}</datalist>
    <div class="grid-2">
      <div class="card"><h3>Labour on site <span class="muted" data-tot="labour">(${labourTotal} · ${inr(listTotal("labour", d.labour)) || "₹0"})</span></h3>
        <p class="muted small">One line per group, e.g. 4 labour at ₹700 and 6 at ₹900 from the chowk.</p>${rowTable("labour", [["type", "Category", "", "dlLabour"], ["count", "Nos", "number"], ["rate", "Rate / day ₹", "number"], ["agency", "From (chowk / contractor)"], ["amt", "Amount", "calc"]], d.labour, "Labour",
        LABOUR.slice(0, 5).map((x) => `<button class="chip" data-quick="${x}">${x}</button>`).join(""))}</div>
      <div class="card"><h3>Machinery / equipment <span class="muted" data-tot="machinery">(${inr(listTotal("machinery", d.machinery)) || "₹0"})</span></h3>
        <p class="muted small">Rent per hour (start and end time give the hours), per day or per trip.</p>${rowTable("machinery", [["name", "Machine", "", "dlMach"], ["count", "Nos / trips", "number"], ["basis", "Rent per", "sel:hour=Hour|day=Day|trip=Trip"], ["rate", "Rate ₹", "number"], ["start", "Start", "time"], ["end", "End", "time"], ["hours", "Hours", "number"], ["amt", "Amount", "calc"]], d.machinery, "Machine")}</div>
    </div>
    <div class="card"><h3>Work done today</h3>${site().boqItems?.length ? `<p class="muted small">Type a few words or the BOQ No. and pick the item: its full description, unit and BOQ No. are filled in.</p>` : ""}${workTable(d.work)}</div>
    <datalist id="dlMat">${MAT_NAMES.map((x) => `<option>${x}</option>`).join("")}</datalist><datalist id="dlMach">${MACHINES.map((x) => `<option>${x}</option>`).join("")}</datalist>
    <div class="card"><h3>Materials received</h3>${rowTable("materials", [["name", "Material", "", "dlMat"], ["qty", "Qty", "number"], ["unit", "Unit", "", "dlUnit"], ["supplier", "Supplier"], ["challan", "Challan No."]], d.materials, "Material")}</div>
    <div class="card"><h3>Materials consumed today</h3>${rowTable("consumed", [["name", "Material", "", "dlMat"], ["qty", "Qty", "number"], ["unit", "Unit", "", "dlUnit"], ["usedFor", "Used for (item / location)", "", "dlWork"]], d.consumed || [], "Material used")}</div>
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
  <fieldset class="stamp-opts"><legend>Stamp on the photo (default; can be changed when printing or downloading)</legend>
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
  if (fromCamera) { status("Getting GPS location…"); here = await getPosition(); if (!here && st.loc) ctx.toast("Location not available: allow location for this site in the browser settings. The photo is saved without it.", 6000); }
  let n = 0;
  for (const file of files) {
    status(`Saving photo ${++n} of ${files.length}…`);
    const ex = await readExif(file);
    const date = fromCamera ? new Date().toISOString() : ex.date || new Date(file.lastModified || Date.now()).toISOString();
    const gps = fromCamera ? here : ex.gps || null;
    const addr = gps ? await reverseGeocode(gps.lat, gps.lon) : "";
    // The photo is kept clean with its details; the stamp is drawn when it is printed or downloaded, as chosen then.
    const blob = await stampPhoto(file, [], 2400);
    await saveFile(new File([blob], `photo_${isoDay(date)}_${n}.jpg`, { type: "image/jpeg" }), { owner: siteId, kind: "photo", date, caption, gps: gps ? { ...gps, address: addr } : null, thumb: await thumbOf(blob), extra: { stamped: false } });
  }
  status("");
  ctx.toast(`${files.length} photo(s) saved to ${s?.name.slice(0, 40) || "the site"}${isoDay(new Date().toISOString()) === today() ? " (in today's DPR)" : ""}.`);
  if (scope !== $("#sitesRoot")) ctx.closeModal();
  if (siteId !== state.siteId) switchSite(siteId); else renderSites();
}

// ---------------------------------------------------------------------------
// Mining permit (STP, option 'C'): the contractor's application, filled from the work order and
// BOQ, and a record of the permit received with its conditions. The permit itself is issued by
// the Mining Engineer; this tool only prepares the application and keeps track.
// ---------------------------------------------------------------------------

const DENSITY = { sand: 1.6, agg: 1.5, stone: 1.6 }; // tonnes per cum, approximate
const MINERAL_NAMES = { sand: "बजरी / Sand", agg: "गिट्टी / Aggregate", stone: "चिनाई पत्थर / Masonry stone" };
function stpData(s) {
  const st = (s.stp ||= {});
  if (!st.minerals) {
    const est = s.boqItems?.length ? estimateMaterials(s.boqItems).totals : {};
    st.minerals = ["sand", "agg", "stone"].filter((k) => num(est[k])).map((k) => ({ name: MINERAL_NAMES[k], cum: round(est[k], 2), t: round(est[k] * DENSITY[k], 2), source: "" }));
  }
  return st;
}
async function stpCard(s) {
  const st = stpData(s);
  const royaltyFiles = (await allFiles()).filter((f) => f.owner === s.id && f.kind === "doc" && /royalty|rawanna|ravanna|रवन्ना|STP/i.test(f.folder)).length;
  const F = (k, l, t = "text", ph = "") => `<label class="field">${l}<input data-stp="${k}" type="${t}" value="${esc(st[k] ?? "")}" placeholder="${ph}"></label>`;
  return `<div class="card"><h2>Mining permit (STP) · Vikalp 'C'</h2>
    <p class="muted small">The application to the Mining Engineer for a short-term permit for the minor minerals used in this work, filled from the work order and the BOQ (quantities approximate: check them). Print, sign and submit it with a copy of the work order. The permit itself is issued by the mining office: keep it and the royalty / rawanna receipts in the <b>STP</b> folder.</p>
    <div class="form-grid compact">${F("district", "Mining office (district)", "text", "Jodhpur")}${F("appDate", "Application date", "date")}</div>
    <div class="table-wrap mt"><table class="data diary-tab" data-stplist><thead><tr><th>Mineral</th><th>Qty (cum)</th><th>Qty (tonnes)</th><th>Source / lease (optional)</th><th></th></tr></thead>
      <tbody>${st.minerals.map((m, i) => `<tr data-i="${i}"><td><input data-mk="name" value="${esc(m.name)}"></td><td><input data-mk="cum" type="number" step="any" class="num w90" value="${m.cum ?? ""}"></td><td><input data-mk="t" type="number" step="any" class="num w90" value="${m.t ?? ""}"></td><td><input data-mk="source" value="${esc(m.source || "")}"></td><td><button class="icon danger-text" data-act="stpDel">×</button></td></tr>`).join("")}</tbody></table></div>
    <div class="row gap wrap"><button class="ghost small" data-act="stpAdd">＋ Mineral</button><button class="ghost small" data-act="stpReset" title="Work the quantities out again from the BOQ">↻ From BOQ</button><button class="primary" data-act="stpPrint">Print application (Hindi)</button></div>
    <h3 class="mt">Permit received</h3>
    <div class="form-grid compact">${F("permitNo", "Permit / letter No.", "text", "खअ/जोध/एसटीपी/2026/610")}${F("permitDate", "Date", "date")}${F("refNo", "Application ref. No.")}${F("royalty", "Royalty paid ₹", "number")}</div>
    <div class="checks mt">
      <label class="check"><input type="checkbox" data-stpc="rawanna" ${st.rawanna ? "checked" : ""}> Rawanna / royalty receipts for every load kept (firm name and work written on them) · ${royaltyFiles} file(s) in the STP folder</label>
      <label class="check"><input type="checkbox" data-stpc="assessed" ${st.assessed ? "checked" : ""}> Royalty assessment done at the mining office</label>
      <label class="check"><input type="checkbox" data-stpc="noDues" ${st.noDues ? "checked" : ""}> <b>No-dues certificate (ना बकाया प्रमाण पत्र) obtained</b>: needed before the final bill is paid</label>
    </div>${!st.noDues && st.permitNo ? `<p class="status err">Reminder: get the royalty no-dues certificate before the final bill.</p>` : ""}</div>`;
}
function stpChange(t) {
  const s = site(), st = stpData(s);
  if (t.matches("[data-stp]")) st[t.dataset.stp] = t.type === "number" ? num(t.value) : t.value;
  else if (t.matches("[data-mk]")) {
    const m = st.minerals[+t.closest("tr").dataset.i]; const k = t.dataset.mk;
    m[k] = ["cum", "t"].includes(k) ? num(t.value) : t.value;
    if (k === "cum") { const key = Object.keys(MINERAL_NAMES).find((x) => MINERAL_NAMES[x] === m.name); if (key) { m.t = round(m.cum * DENSITY[key], 2); const ti = $('[data-mk="t"]', t.closest("tr")); if (ti) ti.value = m.t; } }
  } else if (t.matches("[data-stpc]")) st[t.dataset.stpc] = t.checked;
  else return false;
  saveSite(s); return true;
}
function stpPrintHtml(s) {
  const st = stpData(s), co = ctx.company() || {};
  const firm = s.contractor || co.name || "";
  const hd = (d) => (d ? fd(d) : "....................");
  return `<section class="p-page stp-letter">
    <p>सेवा में,<br>&nbsp;&nbsp;&nbsp;&nbsp;खनि अभियन्ता,<br>&nbsp;&nbsp;&nbsp;&nbsp;खान एवं भू विज्ञान विभाग,<br>&nbsp;&nbsp;&nbsp;&nbsp;${esc(st.district || "....................")}</p>
    <p class="stp-sub"><b>विषय:-</b> विकल्प 'सी' के तहत अल्पावधि अनुज्ञापत्र (STP) जारी करने बाबत।</p>
    <p class="stp-sub"><b>सन्दर्भ:-</b> ${esc(s.client || "")} का वर्क आर्डर क्रमांक ${esc(s.workOrderNo || "....................")} दिनांक ${hd(s.woDate)}</p>
    <p class="stp-sub"><b>कार्य का नाम:-</b> ${esc(s.name)}</p>
    <p>महोदय,</p>
    <p class="stp-body">उपरोक्त विषयान्तर्गत निवेदन है कि हमारी फर्म <b>${esc(firm)}</b> को ${esc(s.client || "")} द्वारा उपरोक्त कार्य हेतु वर्क आर्डर${num(s.amount) ? ` (राशि ₹ ${num(s.amount).toLocaleString("en-IN")})` : ""} जारी किया गया है।${s.startDate || s.endDate ? ` कार्य की अवधि दिनांक ${hd(s.startDate)} से ${hd(s.endDate)} तक है।` : ""}</p>
    <p class="stp-body">उक्त कार्य में निम्नलिखित अप्रधान खनिजों का उपयोग होना अनुमानित है। अतः राजस्थान अप्रधान खनिज रियायत नियमावली 2017 के अन्तर्गत विकल्प 'सी' के तहत अल्पावधि अनुज्ञापत्र जारी करने की कृपा करें:-</p>
    <table class="r-tab stp-tab"><thead><tr><th>क्र.सं.</th><th>खनिज</th><th>अनुमानित मात्रा (घन मीटर)</th><th>अनुमानित मात्रा (टन)</th><th>स्रोत</th></tr></thead>
      <tbody>${st.minerals.filter((m) => m.name).map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m.name)}</td><td class="r">${m.cum ? q3(m.cum) : ""}</td><td class="r">${m.t ? q3(m.t) : ""}</td><td>${esc(m.source || "")}</td></tr>`).join("")}</tbody></table>
    <p class="stp-body">हम अनुज्ञापत्र की सभी शर्तों का पालन करेंगे। खनिज केवल वैध रवन्ना / रॉयल्टी रसीद पर ही प्राप्त करेंगे, जिन पर फर्म का नाम एवं कार्य विवरण अंकित होगा, तथा अंतिम रनिंग बिल के भुगतान से पूर्व खनिज प्राप्ति सम्बन्धी रिकॉर्ड प्रस्तुत कर अधिशुल्क निर्धारण करवा लेंगे।</p>
    <p><b>संलग्न:-</b><br>1. वर्क आर्डर की प्रति<br>2. बी.ओ.क्यू. / स्वीकृत दरों की प्रति<br>3. फर्म का पंजीयन / जी.एस.टी. प्रमाण पत्र<br>4. पहचान पत्र</p>
    <div class="stp-sign"><div>दिनांक: ${hd(st.appDate)}<br>स्थान: ${esc(st.district || "")}</div>
      <div>भवदीय,<br><br><br>(हस्ताक्षर)<br><b>${esc(firm)}</b>${co.address ? `<br>${esc(co.address)}` : ""}${co.phone ? `<br>फोन: ${esc(co.phone)}` : ""}${co.gstin ? `<br>GSTIN: ${esc(co.gstin)}` : ""}</div></div></section>`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function onClick(e) {
  const t = e.target;
  const act = t.closest("[data-act]")?.dataset.act;
  if (t.closest("[data-stab]")) { state.tab = t.closest("[data-stab]").dataset.stab; state.report = null; return renderSites(); }
  if (act === "newSite") return newSiteDialog();
  if (act === "stpPrint") { const s = site(); stpData(s); await saveSite(s); return printNow(stpPrintHtml(s)); }
  if (act === "stpAdd") { stpData(site()).minerals.push({ name: "", cum: "", t: "", source: "" }); await saveSite(site()); return renderSites(); }
  if (act === "stpDel") { stpData(site()).minerals.splice(+t.closest("tr").dataset.i, 1); await saveSite(site()); return renderSites(); }
  if (act === "stpReset") { delete stpData(site()).minerals; stpData(site()); await saveSite(site()); return renderSites(); }
  if (act === "camera") { cameraDialog(); return; }
  if (t.closest("[data-day]")) { state.date = addDays(state.date, +t.closest("[data-day]").dataset.day); return renderSites(); }
  if (act === "saveSite") {
    const s = site(), got = state.detailsGot || { files: [] };
    Object.assign(s, readSiteForm($("#sitesRoot")));
    if (got.boqItems) s.boqItems = got.boqItems;
    if (got.terms) s.terms = got.terms;
    await saveSite(s); await saveSiteDocs(s.id, got); state.detailsGot = null;
    ctx.toast(`Saved${got.files.length ? ` with ${got.files.length} document(s)` : ""}.`); ctx.refreshHeader(); return renderSites();
  }
  if (act === "delSite") {
    const s = site(); if (!confirm(`Delete the site "${s.name}" with its diary, photos and documents?`)) return;
    for (const f of (await allFiles()).filter((x) => x.owner === s.id)) await delFile(f.id);
    for (const d of entriesOf(s.id)) { state.diary.delete(d.id); await idb.del("diary", d.id); }
    await idb.del("sites", s.id); state.sites = state.sites.filter((x) => x !== s);
    switchSite(state.sites[0]?.id || null); ctx.refreshHeader(); return;
  }
  if (t.closest("[data-addrow]")) { const d = entry(state.date, true); const k = t.closest("[data-addrow]").dataset.addrow; (d[k] ||= []).push(k === "machinery" ? { basis: "hour" } : {}); saveEntry(d); return renderSites(); }
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
  if (act === "printPhotos" || act === "zipPhotos") { const ps = await chosenPhotos(); if (!ps.length) { ctx.toast("No photos."); return; } return photoExportDialog(ps, act === "printPhotos" ? "print" : "zip"); }
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
  if (stpChange(t)) { if (t.matches("[data-stpc]")) renderSites(); return; }
  if (t.id === "diaryDate") { state.date = t.value || today(); return renderSites(); }
  if (t.id === "camShot" || t.id === "camPick") { const files = [...t.files]; t.value = ""; if (files.length) takePhotos(files, t.id === "camShot", $("#sitesRoot")); return; }
  if (t.matches("[data-st]")) { const st = stampSettings(); st[t.dataset.st] = t.checked; localStorage.setItem("site.stamp", JSON.stringify(st)); return; }
  if (t.matches("[data-psel]")) { const id = t.closest("[data-pid]").dataset.pid; t.checked ? state.photoSel.add(id) : state.photoSel.delete(id); return renderSites(); }
  if (t.matches("[data-cap]")) { allFiles().then((fs) => { const f = fs.find((x) => x.id === t.closest("[data-pid]").dataset.pid); if (f) { f.caption = t.value.trim(); putFile(f); } }); return; }
  if (t.matches("[data-pf]")) { state.filter[t.dataset.pf] = t.value; return renderSites(); }
  if (t.id === "rpKind") { const [a, b] = defaultPeriod(t.value); $("#rpFrom").value = a; $("#rpTo").value = b; }
  if (t.matches("[data-f]")) { const d = entry(state.date, true); d[t.dataset.f] = t.value; saveEntry(d); }
  if (t.matches("[data-list] select[data-k]")) { const d = entry(state.date, true); const r = d[t.closest("[data-list]").dataset.list][+t.closest("tr").dataset.i]; r[t.dataset.k] = t.value; updateRow(t, r); saveEntry(d); }
}
/** Hours from start/end, the row amount and the card total, updated while typing. */
function updateRow(t, r) {
  const key = t.closest("[data-list]").dataset.list, tr = t.closest("tr");
  if (key === "work") { const info = $(".ac-info", tr); if (info) info.innerHTML = workInfo(r); return; }
  if (key === "machinery" && (t.dataset.k === "start" || t.dataset.k === "end")) { const h = timeDiff(r.start, r.end); if (h != null) { r.hours = h; const hi = $('[data-k="hours"]', tr); if (hi) hi.value = h; } }
  if (!CALC[key]) return;
  const c = $("[data-calc]", tr); if (c) c.textContent = inr(CALC[key](r));
  const d = entry(state.date, true), tot = $(`[data-tot="${key}"]`);
  if (tot) tot.textContent = key === "labour" ? `(${d.labour.reduce((a, l) => a + num(l.count), 0)} · ${inr(listTotal("labour", d.labour)) || "₹0"})` : `(${inr(listTotal(key, d[key])) || "₹0"})`;
}
function onInput(e) {
  const t = e.target;
  if (t.matches("[data-list] input[data-k]")) {
    const d = entry(state.date, true); const list = d[t.closest("[data-list]").dataset.list]; const i = +t.closest("tr").dataset.i;
    list[i][t.dataset.k] = t.value; updateRow(t, list[i]); saveEntry(d);
    if (t.matches("[data-ac]")) { if (findBoq(list[i])?.description !== t.value) delete list[i].boq; showAc(t); }
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

async function viewPhoto(f) {
  const url = URL.createObjectURL(await stamped(f, site(), exportSettings()));
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
  const labourAmt = sum(E.flatMap((d) => d.labour), (l) => (l.type || "").trim(), (l) => CALC.labour(l));
  const work = sum(E.flatMap((d) => d.work), (w) => `${(w.desc || "").trim()}|${(w.unit || "").trim()}`, (w) => w.qty);
  const upto = sum(entriesOf(siteId, "", to).flatMap((d) => d.work), (w) => `${(w.desc || "").trim()}|${(w.unit || "").trim()}`, (w) => w.qty);
  const materials = sum(E.flatMap((d) => d.materials), (m) => `${(m.name || "").trim()}|${(m.unit || "").trim()}`, (m) => m.qty);
  const consumed = sum(E.flatMap((d) => d.consumed || []), (m) => `${(m.name || "").trim()}|${(m.unit || "").trim()}`, (m) => m.qty);
  const machHours = sum(E.flatMap((d) => d.machinery || []), (m) => (m.name || "").trim(), (m) => (m.basis === "hour" || !m.basis ? m.hours : 0));
  const machAmt = sum(E.flatMap((d) => d.machinery || []), (m) => (m.name || "").trim(), (m) => CALC.machinery(m));
  return { E, labour, labourAmt, work, upto, materials, consumed, machHours, machAmt };
}

/** Quantity in the unit used for the estimate (bags of cement, cum of sand and aggregate, kg of steel, nos of bricks). */
function inMatUnit(key, qty, unit) {
  const u = String(unit || "").toLowerCase().replace(/[\s.]/g, ""), q = num(qty);
  if (key === "cement") return /mt|ton/.test(u) ? q * 20 : /kg/.test(u) ? q / 50 : q;
  if (key === "steel") return /mt|ton/.test(u) ? q * 1000 : /qtl|quintal/.test(u) ? q * 100 : q;
  if (key === "sand" || key === "agg") return /cft|cuft/.test(u) ? q / 35.315 : /mt|ton/.test(u) ? q / 1.6 : q;
  if (key === "bricks") return /thousand|1000/.test(u) ? q * 1000 : q;
  return q;
}
/** Estimated (from the BOQ), received, consumed and balance for each main material, up to a date. */
function materialStatus(s, upto = "") {
  const est = s.boqItems?.length ? estimateMaterials(s.boqItems) : { totals: {}, rows: [], skipped: 0 };
  const E = entriesOf(s.id, "", upto);
  const tally = (list) => { const t = {}; for (const m of list) { const k = matOf(m.name); if (k) t[k] = round((t[k] || 0) + inMatUnit(k, m.qty, m.unit), 3); } return t; };
  const rec = tally(E.flatMap((d) => d.materials || [])), con = tally(E.flatMap((d) => d.consumed || []));
  const rows = MATS.map((m) => ({ ...m, est: num(est.totals[m.key]), rec: num(rec[m.key]), con: num(con[m.key]) })).filter((r) => r.est || r.rec || r.con);
  return { rows, est };
}
const matTable = (st, html = true) => st.rows.map((r) => [r.label, r.unit, r.est ? round(r.est, r.unit === "cum" ? 2 : 0) : "-", round(r.rec, 2), round(r.con, 2), round(r.rec - r.con, 2), r.est ? round(Math.max(0, r.est - r.rec), r.unit === "cum" ? 2 : 0) : "-"]);

async function printReport(kind, from, to, photoOpt = "8") {
  const s = site(); const co = ctx.company() || {};
  const A = aggregate(s.id, from, to);
  const one = from === to, d = one ? A.E[0] : null;
  let photos = photoOpt === "0" ? [] : await photosOf(s.id, from, to);
  if (photoOpt !== "all" && photoOpt !== "0") photos = pickSpread(photos, +photoOpt || 8);
  const cell = (c) => (typeof c === "number" ? q3(c) : c);
  const tbl = (head, rows, empty = "Nil") => rows.length ? `<table class="r-tab"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i && (typeof c === "number" || /^₹/.test(c)) ? "r" : ""}">${cell(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<p>${empty}</p>`;
  const labourRows = one ? (d?.labour || []).filter((l) => l.type || num(l.count)).map((l) => [esc(l.type || ""), num(l.count), num(l.rate) ? inr(l.rate) : "", esc(l.agency || ""), inr(CALC.labour(l))])
    : [...A.labour].map(([k, v]) => [esc(k), v, round(v / Math.max(1, A.E.length), 1), inr(A.labourAmt.get(k))]);
  const labourCost = one ? listTotal("labour", d?.labour) : round([...A.labourAmt.values()].reduce((a, v) => a + v, 0), 2);
  const boqOf = (desc) => (s.boqItems || []).find((i) => i.description.trim() === desc);
  const workRows = [...A.work].map(([k, v]) => { const [desc, unit] = k.split("|"); const locs = one ? (d.work.filter((w) => (w.desc || "").trim() === desc).map((w) => w.loc).filter(Boolean).join(", ")) : ""; const b = boqOf(desc); const up = A.upto.get(k) || v;
    return [b ? esc(boqKey(b)) : "", esc(desc) + (locs ? `<br><small>${esc(locs)}</small>` : ""), esc(unit), v, up, b && num(b.qty) ? num(b.qty) : "", b && num(b.qty) ? round(num(b.qty) - up, 3) : ""]; });
  const matRows = one ? (d?.materials || []).filter((m) => m.name).map((m) => [esc(m.name), num(m.qty), esc(m.unit || ""), esc(m.supplier || ""), esc(m.challan || "")]) : [...A.materials].map(([k, v]) => { const [n, u] = k.split("|"); return [esc(n), v, esc(u)]; });
  const conRows = one ? (d?.consumed || []).filter((m) => m.name).map((m) => [esc(m.name), num(m.qty), esc(m.unit || ""), esc(m.usedFor || "")]) : [...A.consumed].map(([k, v]) => { const [n, u] = k.split("|"); return [esc(n), v, esc(u)]; });
  const machRows = one ? (d?.machinery || []).filter((m) => m.name).map((m) => [esc(m.name), num(m.count) || 1, `${inr(m.rate)} / ${m.basis || "hour"}`, m.start && m.end ? `${m.start}–${m.end}` : "", num(m.hours) || "", inr(CALC.machinery(m))])
    : [...A.machAmt].map(([k, v]) => [esc(k), A.machHours.get(k) || "", inr(v)]);
  const machCost = one ? listTotal("machinery", d?.machinery) : round([...A.machAmt.values()].reduce((a, v) => a + v, 0), 2);
  const ms = materialStatus(s, to);
  const notes = A.E.filter((x) => x.hindrance || x.remarks || x.visitors);
  const head = `<div class="r-co">${esc((co.name || "").toUpperCase())}${co.address ? `<small>${esc(co.address)}</small>` : ""}</div>
    <div class="r-title">${TITLES[kind] || TITLES.PR}</div>
    <table class="r-meta"><tr><td>Name of work</td><td>: ${esc(s.name)}</td></tr>
      ${s.workOrderNo ? `<tr><td>Work order No.</td><td>: ${esc(s.workOrderNo)}${s.woDate ? ` dated ${fd(s.woDate)}` : ""}</td></tr>` : ""}
      ${s.client ? `<tr><td>Department / client</td><td>: ${esc(s.client)}</td></tr>` : ""}${s.location ? `<tr><td>Location</td><td>: ${esc(s.location)}</td></tr>` : ""}
      <tr><td>${one ? "Date" : "Period"}</td><td>: ${one ? `${fd(from)} (${new Date(from + "T12:00").toLocaleDateString("en-IN", { weekday: "long" })})` : `${fd(from)} to ${fd(to)} (${A.E.length} working day${A.E.length === 1 ? "" : "s"} entered)`}</td></tr>
      ${one && d ? `<tr><td>Weather / hours</td><td>: ${esc(d.weather || "-")}${d.hours ? ` · ${esc(d.hours)}` : ""}</td></tr>` : ""}</table>`;
  const daily = !one && A.E.length ? `<h4>Day-wise summary</h4>${tbl(["Date", "Labour", "Labour ₹", "Machinery ₹", "Main work done"], A.E.map((x) => [fd(x.date), x.labour.reduce((a, l) => a + num(l.count), 0), inr(listTotal("labour", x.labour)), inr(listTotal("machinery", x.machinery)), esc(x.work.filter((w) => w.desc).map((w) => `${w.desc}${num(w.qty) ? ` ${q3(w.qty)} ${w.unit || ""}` : ""}`).join("; ") || "-")]))}` : "";
  const html = `<section class="p-page r-page">${head}
    <h4>1. Labour ${one ? "on site" : "(man-days)"}</h4>${tbl(one ? ["Category", "Nos", "Rate / day", "From", "Amount"] : ["Category", "Man-days", "Average per day", "Amount"], labourRows)}
    ${labourRows.length ? `<p class="r-tot">Total: ${q3(labourRows.reduce((a, r) => a + num(r[1]), 0))} ${one ? "nos" : "man-days"}${labourCost ? ` · ${inr(labourCost)}` : ""}</p>` : ""}
    <h4>2. Work done</h4>${tbl(["BOQ No.", "Item of work", "Unit", one ? "Today" : "This period", "Up to date", "Tender qty", "Balance"], workRows)}
    <h4>3. Materials received</h4>${tbl(one ? ["Material", "Qty", "Unit", "Supplier", "Challan"] : ["Material", "Qty", "Unit"], matRows)}
    <h4>4. Materials consumed</h4>${tbl(one ? ["Material", "Qty", "Unit", "Used for"] : ["Material", "Qty", "Unit"], conRows)}
    <h4>5. Machinery / equipment</h4>${tbl(one ? ["Machine", "Nos", "Rent", "Time", "Hours", "Amount"] : ["Machine", "Hours", "Amount"], machRows)}
    ${machCost ? `<p class="r-tot">Machinery: ${inr(machCost)}</p>` : ""}
    ${ms.rows.length ? `<h4>6. Material account up to ${fd(to)}</h4>${tbl(["Material", "Unit", "Required as per BOQ (approx.)", "Received", "Consumed", "Balance at site", "Still to come"], matTable(ms))}` : ""}
    <h4>${ms.rows.length ? 7 : 6}. Hindrances, instructions and remarks</h4>${notes.length ? notes.map((x) => `<p>${one ? "" : `<b>${fd(x.date)}:</b> `}${[x.hindrance && `Hindrance: ${esc(x.hindrance)}`, x.visitors && `Instructions / visitors: ${esc(x.visitors)}`, x.remarks && `Remarks: ${esc(x.remarks)}`].filter(Boolean).join(" · ")}</p>`).join("") : "<p>Nil</p>"}
    ${daily}
    ${photos.length ? `<p class="r-note">Site photographs: ${photos.length} (attached sheets).</p>` : ""}
    <div class="r-signs"><div>Site Engineer / Supervisor<br>${esc(s.engineer || "")}</div><div>Contractor<br>${esc(co.name || "")}</div><div>Checked by (JEN / AEN)</div></div></section>`;
  printNow(html + (photos.length ? await photoSheets(photos, s, exportSettings()) : ""));
}
function pickSpread(list, n) { if (list.length <= n) return list; const out = []; for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)]); return out; }

function reportExcel(kind, from, to) {
  const X = window.XLSX, s = site(), A = aggregate(s.id, from, to);
  const wb = X.utils.book_new();
  const head = [[TITLES[kind] || TITLES.PR], [`Name of work: ${s.name}`], [`Work order: ${s.workOrderNo || ""} ${s.woDate ? fd(s.woDate) : ""}`], [`Period: ${fd(from)} to ${fd(to)}`], []];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Item of work", "Unit", "This period", "Up to date"], ...[...A.work].map(([k, v]) => { const [d, u] = k.split("|"); return [d, u, v, A.upto.get(k) || v]; })]), "Work done");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Category", "Man-days", "Amount"], ...[...A.labour].map(([k, v]) => [k, v, A.labourAmt.get(k) || 0])]), "Labour");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Machine", "Hours", "Amount"], ...[...A.machAmt].map(([k, v]) => [k, A.machHours.get(k) || 0, v])]), "Machinery");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Material", "Unit", "Received", ""], ...[...A.materials].map(([k, v]) => { const [n, u] = k.split("|"); return [n, u, v]; }), [], ["Material", "Unit", "Consumed"], ...[...A.consumed].map(([k, v]) => { const [n, u] = k.split("|"); return [n, u, v]; })]), "Materials");
  const ms = materialStatus(s, to);
  if (ms.rows.length) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Material", "Unit", "Required as per BOQ (approx.)", "Received", "Consumed", "Balance at site", "Still to come"], ...matTable(ms)]), "Material account");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Date", "Weather", "Labour", "Labour ₹", "Machinery ₹", "Work done", "Received", "Consumed", "Hindrance", "Remarks"],
    ...A.E.map((d) => [fd(d.date), d.weather, d.labour.reduce((a, l) => a + num(l.count), 0), listTotal("labour", d.labour), listTotal("machinery", d.machinery), d.work.map((w) => `${w.desc} ${w.qty || ""} ${w.unit || ""}`).join("; "), d.materials.map((m) => `${m.name} ${m.qty || ""} ${m.unit || ""}`).join("; "), (d.consumed || []).map((m) => `${m.name} ${m.qty || ""} ${m.unit || ""}`).join("; "), d.hindrance, d.remarks])]), "Daily");
  X.writeFile(wb, `${kind}_${safeName(s.name).slice(0, 40)}_${from}_${to}.xlsx`);
}

// ---------------------------------------------------------------------------
// Photo stamps, chosen when printing or exporting
// ---------------------------------------------------------------------------

const EXPORT_OPTS = [["site", "Work name & W.O. No."], ["caption", "What the photo is about"], ["loc", "GPS location (lat / long)"], ["addr", "Address"], ["time", "Date & time"]];
function exportSettings() { const st = stampSettings(); try { return { site: st.site, caption: true, loc: st.loc, addr: st.addr, time: st.time, under: true, ...JSON.parse(localStorage.getItem("site.export") || "{}") }; } catch { return { ...st, caption: true, under: true }; } }
/** The photo with the chosen stamp burned in (photos taken before this option already carry their stamp). */
async function stamped(p, s, o, max = 1800) {
  if (p.stamped !== false) return p.blob;
  const lines = [o.site && s ? `${s.name.slice(0, 90)}${s.workOrderNo ? ` · W.O. ${s.workOrderNo}` : ""}` : "", o.caption ? p.caption : "", o.addr ? p.gps?.address : "", o.loc && p.gps ? fmtLatLon(p.gps) : "", o.time ? fmtDateTime(p.date) : ""];
  return stampPhoto(p.blob, lines, max);
}
function photoExportDialog(photos, mode) {
  const o = exportSettings();
  ctx.modal(`<h2>${mode === "print" ? "Print photo sheets" : "Download photos"} (${photos.length})</h2>
    <fieldset class="stamp-opts"><legend>GPS stamp on the photo</legend>${EXPORT_OPTS.map(([k, l]) => `<label><input type="checkbox" data-eo="${k}" ${o[k] ? "checked" : ""}> ${l}</label>`).join("")}
      <small class="muted">Untick everything for plain photos.</small></fieldset>
    ${mode === "print" ? `<label class="check mt"><input type="checkbox" data-eo="under" ${o.under ? "checked" : ""}> Caption and date under each photo</label>` : ""}
    <p class="muted small">Photos taken before this option was added keep the stamp they were taken with.</p>
    <button class="primary mt" id="eoGo">${mode === "print" ? "Print" : "Download ZIP"}</button>`, (m) => {
    $("#eoGo", m).onclick = async () => {
      const opt = Object.fromEntries($$("[data-eo]", m).map((i) => [i.dataset.eo, i.checked]));
      localStorage.setItem("site.export", JSON.stringify({ ...o, ...opt }));
      const s = site(); $("#eoGo", m).disabled = true; $("#eoGo", m).textContent = "Preparing…";
      if (mode === "print") { const html = await photoSheets(photos, s, { ...o, ...opt }); ctx.closeModal(); printNow(html); }
      else {
        const files = [];
        for (const [i, p] of photos.entries()) files.push({ name: `${isoDay(p.date)}_${String(i + 1).padStart(3, "0")}${p.caption ? "_" + safeName(p.caption).slice(0, 40) : ""}.jpg`, data: await stamped(p, s, { ...o, ...opt }, 2400) });
        ctx.download(await makeZip(files), `${safeName(s.name).slice(0, 40)}_photos.zip`); ctx.closeModal();
      }
    };
  });
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** Four photos to a sheet, laid out landscape (turned on the portrait A4 page so every browser prints it the same). */
export async function photoSheets(photos, s, o = exportSettings()) {
  const pages = []; for (let i = 0; i < photos.length; i += 4) pages.push(photos.slice(i, i + 4));
  // Data URLs, not blob: links: Safari on iPad sometimes prints blob: images as broken.
  const urls = []; for (const p of photos) urls.push(await blobToDataUrl(await stamped(p, s, o, 1400)));
  let k = 0;
  return pages.map((ph, pi) => `<section class="p-page p-photos p-rot"><div class="p-rot-in"><header class="p-head">${s.client ? `<div class="p-org">${esc(s.client)}</div>` : ""}
      <div><b>Name of work:</b> ${esc(s.name)}</div><div><b>Work order No.:</b> ${esc(s.workOrderNo || "")} ${s.woDate ? `dated ${fd(s.woDate)}` : ""}</div></header>
    <div class="p-photo-grid">${ph.map((x) => `<figure><img src="${urls[k++]}" alt="">${o.under ? `<figcaption>${esc(x.caption || "")}${x.caption ? " · " : ""}${fmtDateTime(x.date).slice(0, 19)}</figcaption>` : ""}</figure>`).join("")}</div>
    <div class="p-sign"><div>JEN</div><div>AEN</div><div>XEN</div></div><div class="p-pageno">Page ${pi + 1} of ${pages.length}</div></div></section>`).join("");
}
function printNow(html) {
  const area = $("#printArea"); area.innerHTML = html;
  const imgs = $$("img", area).filter((i) => !i.complete);
  Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))).then(() => window.print());
}
