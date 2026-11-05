// Resources: the people, materials, machinery and vendors behind every site.
// Workforce register with daily attendance (P / ½ / A, overtime) that fills the diary's labour and
// gives the muster roll and wage sheet; inventory per site from the diary; equipment register with
// usage and rent payable; vendor directory with purchases and unpaid credit from the accounts.
import { idb, uid, num, round, esc, money } from "./store.js";
import { diaryEntry, diaryEntries, putDiary, saveSiteRecord, setKnownMachines } from "./site.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let ctx = null;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const monthStart = () => today().slice(0, 8) + "01";
const fd = (d) => (d ? d.split("-").reverse().join(".") : "");
const inr = (v) => `₹${(Math.round(num(v) * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const state = { tab: "workforce", siteId: "", date: today(), from: monthStart(), to: today(), workers: [], equipment: [], vendors: [] };
const TRADES = ["Mason", "Beldar / Labour", "Carpenter", "Bar bender", "Helper", "Plumber", "Electrician", "Painter", "Operator", "Driver", "Supervisor", "Watchman"];

export async function initResources(c) {
  ctx = c;
  state.workers = (await idb.get("kv", "workers"))?.value || [];
  state.equipment = (await idb.get("kv", "equipment"))?.value || [];
  state.vendors = (await idb.get("kv", "vendors"))?.value || [];
  setKnownMachines(state.equipment.map((e) => e.name));
  const root = $("#resourcesRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
}
const save = (key) => { idb.put("kv", { id: key, value: state[key] }); if (key === "equipment") setKnownMachines(state.equipment.map((e) => e.name)); };
const sites = () => ctx.sites();
const siteName = (id) => sites().find((s) => s.id === id)?.name || "";
function curSite() { if (!sites().some((s) => s.id === state.siteId)) state.siteId = ctx.currentSite() || sites()[0]?.id || ""; return state.siteId; }

export async function renderResources() {
  const root = $("#resourcesRoot"); if (!root) return;
  const tabs = [["workforce", "👷 Workforce & attendance"], ["inventory", "📦 Materials & inventory"], ["equipment", "🚜 Machinery & equipment"], ["vendors", "🏪 Vendors & suppliers"]];
  curSite();
  const siteSel = `<label class="field">Site<select data-rsite>${sites().map((s) => `<option value="${s.id}" ${s.id === state.siteId ? "selected" : ""}>${esc(s.name.slice(0, 70))}</option>`).join("")}</select></label>`;
  let body = "";
  if (!sites().length && state.tab !== "vendors" && state.tab !== "equipment") body = `<div class="card empty-state"><h2>No site yet</h2><p>Create a site in the Site diary first: attendance, inventory and machinery are kept per site.</p><button class="primary" data-rgo="sites">Go to Site diary</button></div>`;
  else if (state.tab === "workforce") body = workforceView(siteSel);
  else if (state.tab === "inventory") body = inventoryView(siteSel);
  else if (state.tab === "equipment") body = equipmentView();
  else body = await vendorsView();
  root.innerHTML = `<div class="site-hero res-hero"><div class="hero-main"><div class="hero-kicker">Resources</div><h2>People · Materials · Machinery · Vendors</h2>
      <div class="hero-stats">${heroStats()}</div></div></div>
    <nav class="subnav">${tabs.map(([k, l]) => `<button data-rtab="${k}" class="${state.tab === k ? "active" : ""}">${l}</button>`).join("")}</nav>${body}`;
}
function heroStats() {
  const s = [["👷", `${state.workers.filter((w) => w.active !== false).length}`, "workers"], ["🚜", `${state.equipment.length}`, "machines"], ["🏪", `${state.vendors.length}`, "vendors"]];
  if (state.siteId) { const d = diaryEntry(state.siteId, today()); const p = Object.values(d?.attendance || {}).filter((a) => a.s === "P" || a.s === "H").length; s.unshift(["✅", `${p} present`, "today at this site"]); }
  return s.map(([i, a, b]) => `<div class="hs"><span class="hs-i">${i}</span><div><b>${a}</b><small>${b}</small></div></div>`).join("");
}

// ---------------------------------------------------------------------------
// Workforce & attendance
// ---------------------------------------------------------------------------

const MARK = { P: ["P", "Present", 1], H: ["½", "Half day", 0.5], A: ["A", "Absent", 0] };
function workforceView(siteSel) {
  const d = diaryEntry(state.siteId, state.date) || { attendance: {} };
  const att = d.attendance || {};
  const list = state.workers.filter((w) => w.active !== false && (!w.sites?.length || w.sites.includes(state.siteId)));
  const counts = { P: 0, H: 0, A: 0 }; list.forEach((w) => { const s = att[w.id]?.s; if (s) counts[s]++; });
  const wages = round(list.reduce((a, w) => a + num(w.wage) * (MARK[att[w.id]?.s]?.[2] || 0) + otPay(w, att[w.id]), 0), 2);
  return `<div class="card"><div class="form-grid compact">${siteSel}<label class="field">Date<input type="date" data-rdate value="${state.date}"></label></div>
      <div class="row between wrap mt"><h3><span class="hico">✅</span>Attendance · ${fd(state.date)}</h3>
        <div class="row gap wrap"><span class="badge">P ${counts.P}</span><span class="badge">½ ${counts.H}</span><span class="badge warn-badge">A ${counts.A}</span><b>${inr(wages)}</b>
        <button class="ghost small" data-ract="allP">All present</button><button class="primary small" data-ract="toDiary" title="Write the attendance as labour groups (trade × count × wage) in this day's diary">→ Diary labour</button></div></div>
      ${list.length ? `<div class="att-list">${list.map((w) => { const a = att[w.id] || {}; return `<div class="att ${a.s ? "m-" + a.s : ""}" data-w="${w.id}"><div><b>${esc(w.name)}</b><small>${esc(w.trade || "")} · ${inr(w.wage)}/day${w.contractor ? ` · ${esc(w.contractor)}` : ""}</small></div>
          <div class="att-btns">${Object.entries(MARK).map(([k, [l, t]]) => `<button class="att-b ${a.s === k ? "on" : ""}" data-mark="${k}" title="${t}">${l}</button>`).join("")}<input type="number" step="0.5" min="0" class="w60 num" data-ot value="${a.ot ?? ""}" placeholder="OT h" title="Overtime hours"></div></div>`; }).join("")}</div>`
        : `<p class="muted">No workers for this site yet. Add them below.</p>`}</div>
    <div class="card"><div class="row between wrap"><h3><span class="hico">📋</span>Muster roll &amp; wage sheet</h3>
      <div class="row gap wrap"><input type="date" data-rfrom value="${state.from}"><input type="date" data-rto value="${state.to}"><button class="ghost" data-ract="wageExcel">Excel</button><button class="primary" data-ract="wagePrint">Print muster roll</button></div></div>
      ${wageTable()}</div>
    <div class="card"><div class="row between wrap"><h3><span class="hico">👥</span>Workers (${state.workers.length})</h3><button class="primary" data-ract="addWorker">＋ Add worker</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Trade</th><th class="num">Wage / day</th><th class="num">OT / hour</th><th>Contractor / chowk</th><th>Phone</th><th>Sites</th><th></th></tr></thead>
      <tbody>${state.workers.map((w) => `<tr data-w="${w.id}" class="${w.active === false ? "muted" : ""}"><td><b>${esc(w.name)}</b>${w.active === false ? " (left)" : ""}</td><td>${esc(w.trade || "")}</td><td class="num">${inr(w.wage)}</td><td class="num">${w.otRate ? inr(w.otRate) : "-"}</td><td>${esc(w.contractor || "")}</td><td>${esc(w.phone || "")}</td><td class="small">${w.sites?.length ? w.sites.map((id) => esc(siteName(id).slice(0, 24))).join(", ") : "All sites"}</td>
        <td class="nowrap"><button class="icon" data-ract="editWorker">✎</button><button class="icon" data-ract="advance" title="Advance paid">₹</button></td></tr>`).join("") || `<tr><td colspan="8" class="muted">No workers yet.</td></tr>`}</tbody></table></div></div>`;
}
const otPay = (w, a) => num(a?.ot) * (num(w.otRate) || num(w.wage) / 8);
function wageRows() {
  const days = diaryEntries(state.siteId, state.from, state.to);
  return state.workers.map((w) => {
    let dd = 0, ot = 0; const marks = {};
    for (const d of days) { const a = d.attendance?.[w.id]; if (!a?.s) continue; marks[d.date] = a.s; dd += MARK[a.s][2]; ot += num(a.ot); }
    const adv = (w.advances || []).filter((x) => x.date >= state.from && x.date <= state.to && (!x.siteId || x.siteId === state.siteId)).reduce((a, x) => a + num(x.amount), 0);
    const gross = round(dd * num(w.wage) + ot * (num(w.otRate) || num(w.wage) / 8), 2);
    return { w, dd, ot, gross, adv, net: round(gross - adv, 2), marks };
  }).filter((r) => r.dd || r.ot || r.adv);
}
function wageTable() {
  const rows = wageRows();
  if (!rows.length) return `<p class="muted">No attendance in this period.</p>`;
  const t = (k) => round(rows.reduce((a, r) => a + r[k], 0), 2);
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Worker</th><th>Trade</th><th class="num">Days</th><th class="num">OT h</th><th class="num">Wage</th><th class="num">Gross</th><th class="num">Advance</th><th class="num">Net payable</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.w.name)}</td><td>${esc(r.w.trade || "")}</td><td class="num">${r.dd}</td><td class="num">${r.ot || ""}</td><td class="num">${inr(r.w.wage)}</td><td class="num">${inr(r.gross)}</td><td class="num">${r.adv ? inr(r.adv) : ""}</td><td class="num"><b>${inr(r.net)}</b></td></tr>`).join("")}
    <tr class="grp"><td colspan="2"><b>Total</b></td><td class="num"><b>${t("dd")}</b></td><td class="num">${t("ot") || ""}</td><td></td><td class="num"><b>${inr(t("gross"))}</b></td><td class="num">${inr(t("adv"))}</td><td class="num"><b>${inr(t("net"))}</b></td></tr></tbody></table></div>`;
}
function workerDialog(w = {}) {
  const F = (k, l, type = "text", ph = "") => `<label class="field">${l}<input data-wf="${k}" type="${type}" value="${esc(w[k] ?? "")}" placeholder="${ph}" ${type === "number" ? 'step="any"' : ""}></label>`;
  ctx.modal(`<h2>${w.id ? "Edit worker" : "Add worker"}</h2><div class="form-grid">${F("name", "Name *")}
    <label class="field">Trade<input data-wf="trade" list="dlTrades" value="${esc(w.trade || "")}"><datalist id="dlTrades">${TRADES.map((t) => `<option>${t}</option>`).join("")}</datalist></label>
    ${F("wage", "Wage per day ₹", "number")}${F("otRate", "Overtime per hour ₹ (blank = wage ÷ 8)", "number")}${F("contractor", "Contractor / chowk / agency")}${F("phone", "Phone", "tel")}${F("idNo", "Aadhaar / ID (optional)")}
    <label class="field" style="grid-column:1/-1">Works at<span class="chips">${sites().map((s) => `<label class="chip"><input type="checkbox" data-wsite value="${s.id}" ${w.sites?.includes(s.id) ? "checked" : ""}> ${esc(s.name.slice(0, 40))}</label>`).join("")}</span><small class="muted">None ticked = all sites</small></label>
    ${w.id ? `<label class="check"><input type="checkbox" data-wleft ${w.active === false ? "checked" : ""}> Has left (keep the record)</label>` : ""}</div>
    <button class="primary mt" id="wSave">Save</button>`, (m) => {
    $("#wSave", m).onclick = () => {
      const rec = { ...w, id: w.id || uid("wk"), advances: w.advances || [] };
      $$("[data-wf]", m).forEach((i) => { rec[i.dataset.wf] = i.type === "number" ? num(i.value) : i.value.trim(); });
      rec.sites = $$("[data-wsite]:checked", m).map((i) => i.value);
      rec.active = !$("[data-wleft]", m)?.checked;
      if (!rec.name) { ctx.toast("Enter the name."); return; }
      const i = state.workers.findIndex((x) => x.id === rec.id); if (i >= 0) state.workers[i] = rec; else state.workers.push(rec);
      save("workers"); ctx.closeModal(); renderResources();
    };
  });
}
function advanceDialog(w) {
  ctx.modal(`<h2>Advance to ${esc(w.name)}</h2><div class="form-grid compact"><label class="field">Date<input type="date" id="aDate" value="${today()}"></label><label class="field">Amount ₹<input type="number" step="any" id="aAmt"></label><label class="field">Note<input id="aNote"></label></div>
    <button class="primary mt" id="aSave">Save</button>
    ${(w.advances || []).length ? `<h3 class="mt">Earlier advances</h3><ul>${w.advances.slice(-10).reverse().map((a) => `<li>${fd(a.date)}: ${inr(a.amount)} ${esc(a.note || "")}</li>`).join("")}</ul>` : ""}`, (m) => {
    $("#aSave", m).onclick = () => { const amt = num($("#aAmt", m).value); if (!amt) return; (w.advances ||= []).push({ date: $("#aDate", m).value, amount: amt, note: $("#aNote", m).value.trim(), siteId: state.siteId }); save("workers"); ctx.closeModal(); renderResources(); };
  });
}
/** Attendance → the diary's labour groups (trade, count, wage), so the DPR and costs follow. */
function attendanceToDiary() {
  const d = diaryEntry(state.siteId, state.date, true);
  const groups = new Map();
  for (const w of state.workers) {
    const a = d.attendance?.[w.id]; if (!a?.s || a.s === "A") continue;
    const k = `${w.trade || "Labour"}|${num(w.wage)}|${w.contractor || ""}`;
    const g = groups.get(k) || { type: w.trade || "Labour", count: 0, rate: num(w.wage), agency: w.contractor || "", fromAttendance: true };
    g.count += MARK[a.s][2]; groups.set(k, g);
  }
  d.labour = [...(d.labour || []).filter((l) => !l.fromAttendance), ...groups.values()];
  putDiary(d);
  ctx.toast(`Diary labour for ${fd(state.date)}: ${[...groups.values()].reduce((a, g) => a + g.count, 0)} from attendance.`);
}
function musterHtml() {
  const s = sites().find((x) => x.id === state.siteId) || {}, co = ctx.company() || {};
  const days = []; for (let t = new Date(state.from + "T12:00"); t <= new Date(state.to + "T12:00"); t.setDate(t.getDate() + 1)) days.push(t.toISOString().slice(0, 10));
  const rows = wageRows();
  return `<section class="p-page r-page muster"><div class="r-co">${esc((co.name || "").toUpperCase())}</div><div class="r-title">MUSTER ROLL &amp; WAGE SHEET</div>
    <table class="r-meta"><tr><td>Name of work</td><td>: ${esc(s.name || "")}</td></tr>${s.workOrderNo ? `<tr><td>Work order No.</td><td>: ${esc(s.workOrderNo)}</td></tr>` : ""}<tr><td>Period</td><td>: ${fd(state.from)} to ${fd(state.to)}</td></tr></table>
    <table class="r-tab mtab"><thead><tr><th>S.No</th><th>Name</th><th>Trade</th>${days.map((d) => `<th>${d.slice(8)}</th>`).join("")}<th>Days</th><th>OT</th><th>Rate</th><th>Gross</th><th>Adv.</th><th>Net</th><th>Signature</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.w.name)}</td><td>${esc(r.w.trade || "")}</td>${days.map((d) => `<td class="c">${r.marks[d] ? MARK[r.marks[d]][0] : ""}</td>`).join("")}<td class="r">${r.dd}</td><td class="r">${r.ot || ""}</td><td class="r">${num(r.w.wage)}</td><td class="r">${round(r.gross, 2)}</td><td class="r">${r.adv || ""}</td><td class="r"><b>${round(r.net, 2)}</b></td><td></td></tr>`).join("")}</tbody></table>
    <p class="r-tot">Total payable: ${inr(rows.reduce((a, r) => a + r.net, 0))}</p>
    <div class="r-signs"><div>Prepared by</div><div>Site Engineer</div><div>Contractor</div></div></section>`;
}

// ---------------------------------------------------------------------------
// Materials & inventory (from the diary: received − consumed)
// ---------------------------------------------------------------------------

function stock(siteId) {
  const m = new Map();
  for (const d of diaryEntries(siteId)) {
    for (const x of d.materials || []) { if (!x.name) continue; const k = x.name.trim().toLowerCase(); const r = m.get(k) || { name: x.name.trim(), unit: x.unit || "", rec: 0, con: 0, last: "" }; r.rec += num(x.qty); r.last = d.date; r.unit ||= x.unit || ""; m.set(k, r); }
    for (const x of d.consumed || []) { if (!x.name) continue; const k = x.name.trim().toLowerCase(); const r = m.get(k) || { name: x.name.trim(), unit: x.unit || "", rec: 0, con: 0, last: "" }; r.con += num(x.qty); r.unit ||= x.unit || ""; m.set(k, r); }
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function inventoryView(siteSel) {
  const s = sites().find((x) => x.id === state.siteId), min = s?.minStock || {};
  const list = stock(state.siteId);
  const low = list.filter((r) => num(min[r.name.toLowerCase()]) && r.rec - r.con <= num(min[r.name.toLowerCase()]));
  return `<div class="card"><div class="form-grid compact">${siteSel}</div>
    ${low.length ? `<p class="status err mt">⚠ Low stock: ${low.map((r) => `${esc(r.name)} (${round(r.rec - r.con, 2)} ${esc(r.unit)})`).join(", ")}</p>` : ""}
    <div class="table-wrap mt"><table class="data"><thead><tr><th>Material</th><th>Unit</th><th class="num">Received</th><th class="num">Consumed</th><th class="num">Balance at site</th><th class="num">Alert below</th><th>Last received</th></tr></thead>
      <tbody>${list.map((r) => { const bal = round(r.rec - r.con, 3), mn = min[r.name.toLowerCase()] ?? ""; return `<tr class="${num(mn) && bal <= num(mn) ? "low-row" : ""}"><td><b>${esc(r.name)}</b></td><td>${esc(r.unit)}</td><td class="num">${round(r.rec, 3)}</td><td class="num">${round(r.con, 3)}</td><td class="num"><b class="${bal < 0 ? "danger-text" : ""}">${bal}</b></td>
        <td class="num"><input type="number" step="any" class="w80 num" data-min="${esc(r.name.toLowerCase())}" value="${mn}"></td><td>${fd(r.last)}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">No materials received or consumed in this site's diary yet.</td></tr>`}</tbody></table></div>
    <p class="muted small mt">Worked out from the Site diary: <b>Materials received</b> minus <b>Materials consumed</b>. Use the same material name in both. Set "Alert below" to be warned when the balance runs low.</p></div>`;
}

// ---------------------------------------------------------------------------
// Machinery & equipment
// ---------------------------------------------------------------------------

function usage(from, to) {
  const out = new Map();
  for (const s of sites()) for (const d of diaryEntries(s.id, from, to)) for (const m of d.machinery || []) {
    if (!m.name) continue;
    const k = m.name.trim().toLowerCase();
    const r = out.get(k) || { label: m.name.trim(), hours: 0, days: 0, trips: 0, amount: 0, sites: new Set() };
    const n = num(m.count) || 1, basis = m.basis || "hour";
    const h = num(m.hours) || 0;
    if (basis === "hour") r.hours += h * n; else if (basis === "day") r.days += n; else r.trips += n;
    r.amount += basis === "hour" ? h * num(m.rate) * n : num(m.rate) * n;
    r.sites.add(s.name); out.set(k, r);
  }
  return out;
}
function equipmentView() {
  const u = usage(state.from, state.to);
  const byOwner = new Map();
  for (const e of state.equipment) { const x = u.get(e.name.trim().toLowerCase()); if (!x || e.ownership === "own") continue; const k = e.ownerName || "Unknown owner"; byOwner.set(k, (byOwner.get(k) || 0) + x.amount); }
  const unreg = [...u.entries()].filter(([k]) => !state.equipment.some((e) => e.name.trim().toLowerCase() === k));
  return `<div class="card"><div class="row between wrap"><h3><span class="hico">🚜</span>Equipment register (${state.equipment.length})</h3><button class="primary" data-ract="addEquip">＋ Add machine</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Machine</th><th>Reg. No.</th><th>Own / rented</th><th>Owner</th><th>Phone</th><th class="num">Rate</th><th></th></tr></thead>
      <tbody>${state.equipment.map((e) => `<tr data-e="${e.id}"><td><b>${esc(e.name)}</b><br><small class="muted">${esc(e.type || "")}</small></td><td>${esc(e.regNo || "")}</td><td>${e.ownership === "own" ? `<span class="badge">Own</span>` : `<span class="badge warn-badge">Rented</span>`}</td><td>${esc(e.ownerName || "")}</td><td>${esc(e.phone || "")}</td><td class="num">${e.rate ? `${inr(e.rate)} / ${esc(e.basis || "hour")}` : ""}</td><td><button class="icon" data-ract="editEquip">✎</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">No machines yet. Registered names appear in the diary's machine list.</td></tr>`}</tbody></table></div></div>
    <div class="card"><div class="row between wrap"><h3><span class="hico">⏱</span>Usage &amp; rent (from the diary)</h3><div class="row gap"><input type="date" data-rfrom value="${state.from}"><input type="date" data-rto value="${state.to}"></div></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Machine</th><th class="num">Hours</th><th class="num">Days</th><th class="num">Trips</th><th class="num">Rent / cost</th><th>Sites</th></tr></thead>
      <tbody>${[...u.entries()].map(([k, x]) => `<tr><td><b>${esc(state.equipment.find((e) => e.name.trim().toLowerCase() === k)?.name || x.label)}</b>${unreg.some(([kk]) => kk === k) ? ` <button class="link small" data-ract="regFromUse" data-name="${esc(x.label)}">register</button>` : ""}</td><td class="num">${round(x.hours, 2) || ""}</td><td class="num">${x.days || ""}</td><td class="num">${x.trips || ""}</td><td class="num"><b>${inr(x.amount)}</b></td><td class="small">${esc([...x.sites].join(", ").slice(0, 80))}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No machinery in the diary for this period.</td></tr>`}</tbody></table></div>
      ${byOwner.size ? `<h3 class="mt">Rent payable to owners</h3><div class="chips">${[...byOwner].map(([o, v]) => `<span class="chip">${esc(o)}: <b>${inr(v)}</b></span>`).join("")}</div>` : ""}</div>`;
}
function equipDialog(e = {}) {
  const F = (k, l, type = "text") => `<label class="field">${l}<input data-ef="${k}" type="${type}" value="${esc(e[k] ?? "")}" ${type === "number" ? 'step="any"' : ""}></label>`;
  ctx.modal(`<h2>${e.id ? "Edit machine" : "Add machine"}</h2><div class="form-grid">${F("name", "Name as written in the diary *")}${F("type", "Type / model")}${F("regNo", "Registration No.")}
    <label class="field">Own or rented<select data-ef="ownership"><option value="rented" ${e.ownership !== "own" ? "selected" : ""}>Rented</option><option value="own" ${e.ownership === "own" ? "selected" : ""}>Own</option></select></label>
    ${F("ownerName", "Owner / rental agency")}${F("phone", "Phone", "tel")}${F("rate", "Rate ₹", "number")}
    <label class="field">Per<select data-ef="basis">${["hour", "day", "trip", "month"].map((b) => `<option ${e.basis === b ? "selected" : ""}>${b}</option>`).join("")}</select></label></div>
    <div class="row gap mt"><button class="primary" id="eSave">Save</button>${e.id ? `<button class="ghost danger-text" id="eDel">Delete</button>` : ""}</div>`, (m) => {
    $("#eSave", m).onclick = () => {
      const rec = { ...e, id: e.id || uid("eq") };
      $$("[data-ef]", m).forEach((i) => { rec[i.dataset.ef] = i.type === "number" ? num(i.value) : i.value.trim(); });
      if (!rec.name) { ctx.toast("Enter the name."); return; }
      const i = state.equipment.findIndex((x) => x.id === rec.id); if (i >= 0) state.equipment[i] = rec; else state.equipment.push(rec);
      save("equipment"); ctx.closeModal(); renderResources();
    };
    const del = $("#eDel", m); if (del) del.onclick = () => { if (!confirm("Delete this machine from the register?")) return; state.equipment = state.equipment.filter((x) => x.id !== e.id); save("equipment"); ctx.closeModal(); renderResources(); };
  });
}

// ---------------------------------------------------------------------------
// Vendors & suppliers (purchases from Office → purchase bills)
// ---------------------------------------------------------------------------

async function vendorsView() {
  const ex = await idb.all("expenses");
  const key = (x) => (x.gstin || x.vendor || "").trim().toLowerCase();
  const stats = new Map();
  for (const x of ex) { const k = key(x); if (!k) continue; const r = stats.get(k) || { bills: 0, total: 0, unpaid: 0, last: "", name: x.vendor, gstin: x.gstin, cats: new Set() }; r.bills++; r.total += num(x.total); if (x.pay === "Credit (unpaid)") r.unpaid += num(x.total); if ((x.date || "") > r.last) r.last = x.date; if (x.category) r.cats.add(x.category); stats.set(k, r); }
  const vkey = (v) => (v.gstin || v.name || "").trim().toLowerCase();
  const fromBills = [...stats.entries()].filter(([k]) => !state.vendors.some((v) => vkey(v) === k || v.name.trim().toLowerCase() === k));
  return `<div class="card"><div class="row between wrap"><h3><span class="hico">🏪</span>Vendors &amp; suppliers (${state.vendors.length})</h3>
      <div class="row gap">${fromBills.length ? `<button class="ghost" data-ract="importVendors">＋ ${fromBills.length} from purchase bills</button>` : ""}<button class="primary" data-ract="addVendor">＋ Add vendor</button></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Vendor</th><th>Supplies</th><th>Phone</th><th class="num">Bills</th><th class="num">Purchased</th><th class="num">Unpaid (credit)</th><th>Last bill</th><th></th></tr></thead>
    <tbody>${state.vendors.map((v) => { const s = stats.get(vkey(v)) || stats.get(v.name.trim().toLowerCase()) || { bills: 0, total: 0, unpaid: 0, last: "", cats: new Set() }; return `<tr data-v="${v.id}"><td><b>${esc(v.name)}</b>${v.gstin ? `<br><small class="muted">${esc(v.gstin)}</small>` : ""}</td><td class="small">${esc(v.supplies || [...s.cats].join(", "))}</td><td>${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : ""}</td><td class="num">${s.bills}</td><td class="num">${inr(s.total)}</td><td class="num ${s.unpaid ? "danger-text" : ""}">${s.unpaid ? inr(s.unpaid) : ""}</td><td>${fd(s.last)}</td><td><button class="icon" data-ract="editVendor">✎</button></td></tr>`; }).join("") || `<tr><td colspan="8" class="muted">No vendors yet.</td></tr>`}</tbody></table></div>
    <p class="muted small mt">Purchases and unpaid credit come from <b>Office → Purchase bills</b> (matched by GSTIN, else by name).</p></div>`;
}
function vendorDialog(v = {}) {
  const F = (k, l, type = "text") => `<label class="field">${l}<input data-vf="${k}" type="${type}" value="${esc(v[k] ?? "")}"></label>`;
  ctx.modal(`<h2>${v.id ? "Edit vendor" : "Add vendor"}</h2><div class="form-grid">${F("name", "Name *")}${F("gstin", "GSTIN")}${F("phone", "Phone", "tel")}${F("supplies", "Supplies (cement, steel, sand…)")}${F("address", "Address")}${F("bank", "Bank / UPI")}</div>
    <div class="row gap mt"><button class="primary" id="vSave">Save</button>${v.id ? `<button class="ghost danger-text" id="vDel">Delete</button>` : ""}</div>`, (m) => {
    $("#vSave", m).onclick = () => {
      const rec = { ...v, id: v.id || uid("vd") };
      $$("[data-vf]", m).forEach((i) => { rec[i.dataset.vf] = i.value.trim(); });
      if (!rec.name) { ctx.toast("Enter the name."); return; }
      const i = state.vendors.findIndex((x) => x.id === rec.id); if (i >= 0) state.vendors[i] = rec; else state.vendors.push(rec);
      save("vendors"); ctx.closeModal(); renderResources();
    };
    const del = $("#vDel", m); if (del) del.onclick = () => { if (!confirm("Delete this vendor?")) return; state.vendors = state.vendors.filter((x) => x.id !== v.id); save("vendors"); ctx.closeModal(); renderResources(); };
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function onClick(e) {
  const t = e.target;
  const tab = t.closest("[data-rtab]"); if (tab) { state.tab = tab.dataset.rtab; return renderResources(); }
  const go = t.closest("[data-rgo]"); if (go) return ctx.showTab(go.dataset.rgo);
  const mark = t.closest("[data-mark]");
  if (mark) {
    const d = diaryEntry(state.siteId, state.date, true); d.attendance ||= {};
    const id = t.closest("[data-w]").dataset.w; const a = d.attendance[id] || {};
    a.s = a.s === mark.dataset.mark ? undefined : mark.dataset.mark; d.attendance[id] = a;
    await putDiary(d); return renderResources();
  }
  const act = t.closest("[data-ract]")?.dataset.ract;
  const wid = t.closest("[data-w]")?.dataset.w, w = state.workers.find((x) => x.id === wid);
  if (act === "addWorker") workerDialog();
  if (act === "editWorker" && w) workerDialog(w);
  if (act === "advance" && w) advanceDialog(w);
  if (act === "allP") {
    const d = diaryEntry(state.siteId, state.date, true); d.attendance ||= {};
    state.workers.filter((x) => x.active !== false && (!x.sites?.length || x.sites.includes(state.siteId))).forEach((x) => { d.attendance[x.id] = { ...(d.attendance[x.id] || {}), s: "P" }; });
    await putDiary(d); renderResources();
  }
  if (act === "toDiary") attendanceToDiary();
  if (act === "wagePrint") { $("#printArea").innerHTML = musterHtml(); window.print(); }
  if (act === "wageExcel") {
    const X = window.XLSX, rows = wageRows();
    const ws = X.utils.aoa_to_sheet([["Muster roll & wage sheet"], [`Site: ${siteName(state.siteId)}`], [`Period: ${fd(state.from)} to ${fd(state.to)}`], [], ["Name", "Trade", "Contractor", "Days", "OT hours", "Wage/day", "Gross", "Advance", "Net payable"],
      ...rows.map((r) => [r.w.name, r.w.trade, r.w.contractor, r.dd, r.ot, num(r.w.wage), r.gross, r.adv, r.net])]);
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, "Wages"); X.writeFile(wb, `Wages_${state.from}_${state.to}.xlsx`);
  }
  if (act === "addEquip") equipDialog();
  if (act === "editEquip") equipDialog(state.equipment.find((x) => x.id === t.closest("[data-e]").dataset.e));
  if (act === "regFromUse") equipDialog({ name: t.dataset.name.replace(/\b\w/g, (c) => c.toUpperCase()), ownership: "rented", basis: "hour" });
  if (act === "addVendor") vendorDialog();
  if (act === "editVendor") vendorDialog(state.vendors.find((x) => x.id === t.closest("[data-v]").dataset.v));
  if (act === "importVendors") {
    const ex = await idb.all("expenses"); const seen = new Set(state.vendors.map((v) => (v.gstin || v.name).trim().toLowerCase()));
    for (const x of ex) { const k = (x.gstin || x.vendor || "").trim().toLowerCase(); if (!k || seen.has(k) || !x.vendor) continue; seen.add(k); state.vendors.push({ id: uid("vd"), name: x.vendor, gstin: x.gstin || "", supplies: x.category || "" }); }
    save("vendors"); renderResources();
  }
}
async function onChange(e) {
  const t = e.target;
  if (t.matches("[data-rsite]")) { state.siteId = t.value; return renderResources(); }
  if (t.matches("[data-rdate]")) { state.date = t.value || today(); return renderResources(); }
  if (t.matches("[data-rfrom]")) { state.from = t.value; return renderResources(); }
  if (t.matches("[data-rto]")) { state.to = t.value; return renderResources(); }
  if (t.matches("[data-ot]")) {
    const d = diaryEntry(state.siteId, state.date, true); d.attendance ||= {};
    const id = t.closest("[data-w]").dataset.w; d.attendance[id] = { ...(d.attendance[id] || {}), ot: t.value === "" ? undefined : num(t.value) };
    await putDiary(d); return renderResources();
  }
  if (t.matches("[data-min]")) {
    const s = sites().find((x) => x.id === state.siteId); if (!s) return;
    (s.minStock ||= {})[t.dataset.min] = t.value === "" ? undefined : num(t.value);
    await saveSiteRecord(s); return renderResources();
  }
}
