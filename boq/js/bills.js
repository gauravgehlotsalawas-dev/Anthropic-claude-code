// Contractor's bills from the measurement book: running/final bill (P.W.A. Form 27G style),
// extra item slip, deviation statement and site photo sheets.
import { uid, round, num, money, qtyFmt, esc, itemQty, amountInWords } from "./store.js";
import { readNicBoq } from "./nicboq.js";
import { prepareDrawing } from "./blueprint.js";
import { extractWorkOrder, extractBoqDocument, extractBill, hasKey } from "./ai.js";

let ctx; // { project, saveProject, toast, modal, closeModal, searchItems, rateOf, download }
const $ = (s, el = document) => el.querySelector(s);
const view = { tab: "bill", billId: "" };
const sched = (it) => it.schedule || (it.bsrId ? "G" : "H");
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const m2 = (v) => money(v, false);

export function initBills(c) {
  ctx = c;
  const root = $("#billsRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("dragover", (e) => { if (e.target.closest("#photoDrop")) { e.preventDefault(); e.target.closest("#photoDrop").classList.add("over"); } });
  root.addEventListener("drop", (e) => { const d = e.target.closest("#photoDrop"); if (d) { e.preventDefault(); d.classList.remove("over"); addPhotos([...e.dataTransfer.files]); } });
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function contract(p) {
  p.contract ||= { contractor: "", workOrderNo: "", woDate: "", agreementNo: "", tpPct: 0, tpDir: "below", extraLimitPct: 5,
    commence: "", stipulated: "", completed: "", office: p.client || "" };
  p.extras ||= [];
  p.bills ||= [];
  p.photos ||= [];
  return p.contract;
}

/** Bill lines in order: G-Schedule tender items, G extra items, H-Schedule items. */
function lines(p) {
  const all = p.sections.flatMap((s) => s.items);
  let g = 0, h = 0;
  const out = [];
  all.filter((it) => sched(it) === "G").forEach((it) => out.push({ id: it.id, s: "G", no: it.sno ?? ++g, desc: it.description, unit: it.unit, tqty: round(itemQty(it), 3), rate: num(it.rate) }));
  p.extras.forEach((x) => out.push({ id: x.id, s: "G", extra: true, no: "Ex", desc: x.description, unit: x.unit, tqty: 0, rate: num(x.rate) }));
  all.filter((it) => sched(it) === "H").forEach((it) => out.push({ id: it.id, s: "H", no: it.sno ?? ++h, desc: it.description, unit: it.unit, tqty: round(itemQty(it), 3), rate: num(it.rate) }));
  return out;
}

const tpFactor = (c) => (c.tpDir === "par" ? 0 : (c.tpDir === "above" ? 1 : -1) * num(c.tpPct) / 100);
const tpLabel = (c) => (c.tpDir === "par" ? "T.P. at par" : `${c.tpDir === "above" ? "Add" : "Less"} T.P. ${num(c.tpPct)}% ${c.tpDir === "above" ? "Above" : "Below"}`);

/** Value of the contract (work order): G tender total after T.P. plus H tender total. */
function contractValue(p) {
  const c = contract(p), L = lines(p).filter((l) => !l.extra);
  const g = L.filter((l) => l.s === "G").reduce((a, l) => a + round(l.tqty * l.rate, 2), 0);
  const h = L.filter((l) => l.s === "H").reduce((a, l) => a + round(l.tqty * l.rate, 2), 0);
  return round(g + round(g * tpFactor(c), 2) + h, 2);
}

/** M.B. entry: a number, or parts at different rates such as "237.74@384.5 + 409.5@159" (a part without @ uses the item rate). */
function parseEntry(v, rate) {
  if (v == null || v === "") return { qty: 0, amt: 0 };
  const s = String(v);
  if (!s.includes("@")) { const q = num(s); return { qty: q, amt: round(q * rate, 2) }; }
  let qty = 0, amt = 0;
  for (const part of s.split("+")) {
    const [q, r] = part.split("@");
    const qq = num(q), rr = r == null || !r.trim() ? rate : num(r);
    qty += qq; amt += round(qq * rr, 2);
  }
  return { qty: round(qty, 3), amt: round(amt, 2), mixed: true };
}

/** Compute a bill: per-line up-to-date and since-previous figures plus the abstract. */
function computeBill(p, bill) {
  const c = contract(p);
  const idx = p.bills.indexOf(bill);
  const prev = idx > 0 ? p.bills[idx - 1] : null;
  const prevCalc = prev ? computeBill(p, prev) : null;
  const rows = lines(p).map((l) => {
    const base = bill.partRate?.[l.id] != null && bill.partRate[l.id] !== "" ? num(bill.partRate[l.id]) : l.rate;
    const plist = bill.parts?.[l.id];
    let e, parts = null;
    if (plist?.length) {
      parts = plist.map((x) => { const rate = x.rate === "" || x.rate == null ? l.rate : num(x.rate); const q = num(x.qty); return { qty: q, rate, part: rate !== l.rate, amt: round(q * rate, 2), full: round(q * l.rate, 2) }; });
      e = { qty: round(parts.reduce((a, x) => a + x.qty, 0), 3), amt: round(parts.reduce((a, x) => a + x.amt, 0), 2), mixed: true };
    } else e = parseEntry(bill.qty[l.id], base);
    const qty = e.qty, amt = e.amt;
    const applied = e.mixed && qty ? round(amt / qty, 2) : base;
    const fullAmt = round(qty * l.rate, 2), withheld = round(fullAmt - amt, 2);
    const pr = prevCalc?.rows.find((r) => r.id === l.id);
    return { ...l, qty, applied, part: applied !== l.rate, amt, parts, fullAmt, withheld, prevQty: pr?.qty || 0, since: round(amt - (pr?.amt || 0), 2) };
  });
  const gRows = rows.filter((r) => r.s === "G"), hRows = rows.filter((r) => r.s === "H");
  const gTotal = round(gRows.reduce((a, r) => a + r.amt, 0), 2);
  const tp = round(gTotal * tpFactor(c), 2);
  const gNet = round(gTotal + tp, 2);
  const hTotal = round(hRows.reduce((a, r) => a + r.amt, 0), 2);
  const total = round(gNet + hTotal, 2);
  const prevTotal = prevCalc?.total || 0;
  const net = round(total - prevTotal, 2);
  const extraGross = round(rows.filter((r) => r.extra).reduce((a, r) => a + r.amt, 0), 2);
  const extraNet = round(extraGross + extraGross * tpFactor(c), 2);
  return { rows, gRows, hRows, gTotal, tp, gNet, hTotal, total, prevTotal, net, say: Math.round(net), extraGross, extraNet };
}

const billTitle = (p, b) => (b.kind === "final" ? "Final Bill" : `${ord(p.bills.filter((x) => x.kind !== "final").indexOf(b) + 1)} Running Bill`);
const currentBill = (p) => p.bills.find((b) => b.id === view.billId) || p.bills.at(-1) || null;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderBills() {
  const root = $("#billsRoot"); if (!root || !ctx) return;
  const p = ctx.project(); if (!p) return;
  const c = contract(p);
  const nItems = p.sections.reduce((a, s) => a + s.items.length, 0);
  const tabs = [["contract", "Contract"], ["bill", "Bill (MB entry)"], ["extra", `Extra items (${p.extras.length})`], ["deviation", "Deviation"], ["photos", `Photos (${p.photos.length})`]];
  let body = "";
  if (!nItems && view.tab !== "contract") view.tab = "contract";
  if (view.tab === "contract") body = contractView(p, c);
  else if (view.tab === "bill") body = billView(p, c);
  else if (view.tab === "extra") body = extraView(p, c);
  else if (view.tab === "deviation") body = deviationView(p, c);
  else body = photosView(p, c);
  root.innerHTML = `<div class="subnav">${tabs.map(([k, t]) => `<button class="${view.tab === k ? "active" : ""}" data-btab="${k}">${t}</button>`).join("")}</div>${body}`;
}

function contractView(p, c) {
  const f = (k, label, type = "text", ph = "") => `<label class="field">${label}<input data-c="${k}" type="${type}" value="${esc(c[k] ?? "")}" placeholder="${ph}"></label>`;
  return `<div class="card upload-card"><h2>Start from the documents</h2>
    <p class="muted small">Upload the work order and the BOQ. The details are filled in for you; check them below. Reading a scanned work order or a PDF BOQ uses your AI key from Settings; a GePNIC BOQ .xls is read directly.</p>
    <div class="row gap wrap"><button class="primary" data-act="loadWO">Upload work order (PDF / photo)</button><button class="primary" data-act="loadBOQ">Upload BOQ (.xls / PDF)</button><span class="status" id="docStatus"></span></div></div>
    <div class="card"><h2>Contract details</h2>
    <p class="muted small">From the work order / agreement. Used on the bill, extra item slip, deviation statement and photo sheets.</p>
    <div class="form-grid">
      ${f("contractor", "Name of contractor", "text", "M/s ...")}
      ${f("workOrderNo", "Work order / agreement No.", "text", "26-27/3260047")}
      ${f("woDate", "Work order date", "date")}
      ${f("office", "Office", "text", "Municipal Corporation, Jodhpur")}
      ${f("commence", "Date of written order to commence", "date")}
      ${f("stipulated", "Stipulated date of completion", "date")}
      ${f("completed", "Actual date of completion (blank = W.I.P.)", "date")}
      <label class="field">Tender premium (T.P.)<span class="row gap"><input data-c="tpPct" type="number" step="0.01" class="w90" value="${num(c.tpPct)}">%
        <select data-c="tpDir"><option value="below" ${c.tpDir === "below" ? "selected" : ""}>Below (less)</option><option value="above" ${c.tpDir === "above" ? "selected" : ""}>Above (excess)</option><option value="par" ${c.tpDir === "par" ? "selected" : ""}>At par</option></select></span></label>
      ${f("jen", "Junior Engineer (JEN)")}${f("aen", "Assistant Engineer (AEN)")}${f("xen", "Executive Engineer (XEN)")}
      <label class="field">Extra items limit (% of contract value)<input data-c="extraLimitPct" type="number" step="0.1" value="${num(c.extraLimitPct)}"></label>
    </div>
    <label class="field mt">Terms and conditions of the work order (printed with the bill, one per line)<textarea data-terms rows="5">${esc((c.terms || []).join("\n"))}</textarea></label>
    <div class="kpis mt">
      <div class="kpi"><small>Contract value (after T.P.)</small><b>${money(contractValue(p))}</b></div>
      <div class="kpi"><small>Example: rate ₹100 becomes</small><b>${money(100 * (1 + tpFactor(c)))}</b></div>
    </div></div>`;
}

function billView(p, c) {
  const bill = currentBill(p);
  const head = `<div class="card"><div class="row between wrap gap">
      <div class="row gap wrap"><select id="billSel">${p.bills.map((b) => `<option value="${b.id}" ${b === bill ? "selected" : ""}>${billTitle(p, b)}${b.date ? ` · ${b.date}` : ""}</option>`).join("")}${p.bills.length ? "" : `<option>No bills yet</option>`}</select>
        <button class="primary" data-act="newBill">＋ New running bill</button>
        <button class="ghost" data-act="loadPrevBill" title="Upload bills already submitted (PDF or photos), oldest first, so later bills and the deviation are exact">⇪ Upload previous bill</button>
        ${bill && bill.kind !== "final" ? `<button class="ghost" data-act="finalBill">Make this the final bill</button>` : ""}
        ${bill ? `<button class="ghost danger-text" data-act="delBill">Delete bill</button>` : ""}</div>
      ${bill ? `<div class="row gap wrap"><button class="primary" data-print="all" title="Bill with memorandum and terms, extra item slip, deviation and photos">Print complete bill file</button><button class="ghost" data-print="bill">Print bill</button><button class="ghost" data-print="slip">Extra item slip</button><button class="ghost" data-print="deviation">Deviation</button><button class="ghost" data-act="excel">Excel</button></div>` : ""}
    </div></div>`;
  if (!bill) return head + `<div class="card"><p><b>First bill of this work?</b> Press <b>New running bill</b> and enter the up-to-date quantities from the measurement book.</p>
    <p><b>Making the 2nd, 4th or final bill?</b> First upload every earlier bill with <b>Upload previous bill</b> (oldest first). Their quantities become the starting point, so “since previous bill”, the deviation and the next bill’s draft are exact.</p><span class="status" id="docStatus"></span></div>`;
  const k = computeBill(p, bill);
  const cv = contractValue(p);
  const extraPct = cv ? (k.extraNet / cv) * 100 : 0;
  const meta = (key, label, type = "text") => `<label class="field small">${label}<input data-b="${key}" type="${type}" value="${esc(bill[key] ?? "")}"></label>`;
  const row = (r, i) => {
    const pct = r.tqty ? (r.qty / r.tqty) * 100 : null;
    return `<tr data-line="${r.id}" class="${r.extra ? "extra-row" : ""}"><td>${i + 1}/${esc(r.no)}</td>
      <td class="desc"><div class="clamp">${esc(r.desc)}</div></td><td>${esc(r.unit)}</td>
      <td class="num">${r.extra ? "—" : qtyFmt(r.tqty)}</td><td class="num muted">${qtyFmt(r.prevQty)}</td>
      <td class="num">${r.parts ? `<b>${qtyFmt(r.qty)}</b>` : `<input data-q class="w120 num" value="${esc(bill.qty[r.id] ?? "")}" placeholder="0" title="Up-to-date quantity. For parts at different rates use “Part rate” or type e.g. 237.74@384.5 + 409.5@159">`}<div><button class="link small" data-act="addPart" title="Split this item into quantities paid at different rates">＋ part rate</button></div></td>
      <td class="num">${qtyFmt(round(r.qty - r.prevQty, 3))}</td>
      <td class="num"><input data-rate type="number" step="any" class="w100 num" value="${r.rate || ""}" placeholder="rate" title="Agreement rate (for H-Schedule items: the contractor's quoted rate)"></td>
      <td class="num"><input data-pr type="number" step="any" class="w90 num" value="${bill.partRate?.[r.id] ?? ""}" placeholder="full" title="Part rate for a running bill (leave blank for the full rate)"></td>
      <td class="num">${m2(r.amt)}</td><td class="num">${m2(r.since)}</td>
      <td class="num">${pct == null ? `<span class="badge">extra</span>` : `<span class="${pct > 100 ? "warn" : ""}">${pct.toFixed(0)}%</span>`}</td></tr>
      ${r.parts ? r.parts.map((x, k) => `<tr class="part-row" data-line="${r.id}" data-pi="${k}"><td></td><td colspan="4" class="small">↳ ${k === 0 ? "Quantity" : "Further quantity"} ${x.part ? `<span class="badge warn-badge">part rate</span>` : `<span class="badge">full rate</span>`}</td>
        <td class="num"><input data-pq type="number" step="any" class="w100 num" value="${x.qty || ""}" placeholder="qty"></td><td></td>
        <td class="num"><input data-prr type="number" step="any" class="w100 num" value="${bill.parts[r.id][k].rate ?? ""}" placeholder="${m2(r.rate)}" title="Rate allowed for this quantity (blank = full rate)"></td><td></td>
        <td class="num">${m2(x.amt)}</td><td class="num small muted">${x.part ? `full ${m2(x.full)}` : ""}</td><td><button class="icon danger-text" data-act="delPart" title="Remove this part">×</button></td></tr>`).join("") : ""}
      ${r.withheld > 0.004 ? `<tr class="part-row"><td></td><td colspan="8" class="small">At full rate ${m2(r.fullAmt)} · allowed ${m2(r.amt)} · <b class="warn">withheld ${m2(r.withheld)}</b></td><td colspan="3"></td></tr>` : ""}`;
  };
  let i = 0;
  const gRows = k.rows.filter((r) => r.s === "G"), hRows = k.rows.filter((r) => r.s === "H");
  return head + `<div class="card"><h2>${billTitle(p, bill)}</h2>
    ${bill.imported ? `<p class="small muted">Read from an uploaded bill${bill.importedTotal ? ` (bill total ${money(bill.importedTotal)})` : ""}. Check the quantities against the bill.</p>` : ""}<span class="status" id="docStatus"></span>
    <div class="form-grid compact">${meta("date", "Bill date", "date")}${meta("measured", "Date of measurement")}${meta("mbNo", "M.B. No.")}${meta("mbPages", "M.B. pages")}${meta("jen", "Measured by (JEN)")}${meta("aen", "Checked by (AEN)")}</div>
    <div class="table-wrap tall"><table class="data small bill-table"><thead><tr><th>S.No</th><th>Item</th><th>Unit</th><th class="num">Tender qty</th><th class="num">Prev. qty</th><th class="num">Qty up-to-date (M.B.)</th><th class="num">This bill</th><th class="num">Rate</th><th class="num">Part rate</th><th class="num">Amount up-to-date</th><th class="num">Since previous</th><th class="num">Done</th></tr></thead>
      <tbody><tr class="grp"><td colspan="12"><b>G-Schedule</b> <button class="link small" data-act="addExtra">＋ Extra item</button></td></tr>
      ${gRows.map((r) => row(r, i++)).join("")}
      ${hRows.length ? `<tr class="grp"><td colspan="12"><b>H-Schedule</b></td></tr>${hRows.map((r) => row(r, i++)).join("")}` : ""}</tbody></table></div>
    <div class="grid-2 mt"><table class="data abstract"><tbody>
      <tr><td>Total G-Schedule (gross)</td><td class="num">${money(k.gTotal)}</td></tr>
      <tr><td>${esc(tpLabel(c))}</td><td class="num">${money(k.tp)}</td></tr>
      <tr class="sub"><td>Total G-Schedule</td><td class="num">${money(k.gNet)}</td></tr>
      <tr><td>H-Schedule</td><td class="num">${money(k.hTotal)}</td></tr>
      <tr class="sub"><td>Total value of work done to date</td><td class="num">${money(k.total)}</td></tr>
      <tr><td>Deduct value shown in previous bill</td><td class="num">${money(k.prevTotal)}</td></tr>
      <tr class="grand"><td>Net value of this bill (SAY ${money(k.say)})</td><td class="num">${money(k.net)}</td></tr></tbody></table>
      <div><div class="check-line ${extraPct > num(c.extraLimitPct) ? "err" : "ok"}">Extra items: ${money(k.extraNet)} = ${extraPct.toFixed(2)}% of contract value ${money(cv)} (limit ${num(c.extraLimitPct)}%)${extraPct > num(c.extraLimitPct) ? " — over the limit, needs sanction" : ""}</div>
      <p class="small muted">${esc(amountInWords(k.say))}</p></div></div></div>`;
}

function extraView(p, c) {
  const bill = currentBill(p);
  const k = bill ? computeBill(p, bill) : null;
  return `<div class="card"><div class="row between"><h2>Extra items (not in the BOQ)</h2><button class="primary" data-act="addExtra">＋ Extra item</button></div>
    <p class="muted small">Items executed that are not in the tender BOQ. They are billed in the G-Schedule with the tender premium, and their total may not exceed ${num(c.extraLimitPct)}% of the contract value without sanction.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Description</th><th>Unit</th><th class="num">Rate</th><th class="num">Qty (latest bill)</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${p.extras.map((x, i) => { const r = k?.rows.find((r) => r.id === x.id); return `<tr data-x="${x.id}"><td>${i + 1}</td><td><textarea data-xf="description" rows="2">${esc(x.description)}</textarea></td><td><input data-xf="unit" class="w70" value="${esc(x.unit)}"></td><td><input data-xf="rate" type="number" step="any" class="w100 num" value="${x.rate}"></td><td class="num">${qtyFmt(r?.qty || 0)}</td><td class="num">${m2(r?.amt || 0)}</td><td><button class="icon danger-text" data-act="delExtra">🗑</button></td></tr>`; }).join("") || `<tr><td colspan="7" class="muted pad">No extra items.</td></tr>`}
    </tbody></table></div>${bill ? `<button class="ghost mt" data-print="slip">Print extra item slip</button>` : ""}</div>`;
}

function deviationRows(p) {
  const c = contract(p);
  const bill = currentBill(p);
  const k = bill ? computeBill(p, bill) : { rows: lines(p).map((l) => ({ ...l, qty: 0, applied: l.rate, amt: 0 })) };
  const rows = k.rows.map((r) => {
    const tamt = round(r.tqty * r.rate, 2);
    const d = r.amt - tamt;
    return { ...r, tamt, excess: !r.extra && d > 0 ? round(d, 2) : 0, extraAmt: r.extra ? r.amt : 0, saving: !r.extra && d < 0 ? round(-d, 2) : 0 };
  });
  const sum = (arr, f) => round(arr.reduce((a, r) => a + r[f], 0), 2);
  const tf = tpFactor(c);
  const G = rows.filter((r) => r.s === "G"), H = rows.filter((r) => r.s === "H");
  const cols = ["tamt", "amt", "excess", "extraAmt", "saving"];
  const gT = Object.fromEntries(cols.map((f) => [f, sum(G, f)]));
  const gTp = Object.fromEntries(cols.map((f) => [f, round(gT[f] * tf, 2)]));
  const gNet = Object.fromEntries(cols.map((f) => [f, round(gT[f] + gTp[f], 2)]));
  const hT = Object.fromEntries(cols.map((f) => [f, sum(H, f)]));
  const grand = Object.fromEntries(cols.map((f) => [f, round(gNet[f] + hT[f], 2)]));
  return { G, H, gT, gTp, gNet, grand, c };
}

function deviationView(p) {
  const d = deviationRows(p);
  const pct = d.grand.tamt ? (d.grand.amt / d.grand.tamt) * 100 : 0;
  return `<div class="card"><div class="row between wrap"><h2>Deviation statement</h2><div class="row gap"><button class="ghost" data-print="deviation">Print</button><button class="ghost" data-act="excel">Excel</button></div></div>
    <p class="muted small">Tender (G/H Schedule) against executed quantities of the latest bill. Executed value is ${pct.toFixed(1)}% of the tender value.</p>
    ${devTable(d, "data small")}</div>`;
}

function devTable(d, cls) {
  const r6 = (r, i) => `<tr><td>${i + 1}</td><td class="desc">${esc(r.desc.slice(0, 160))}${r.desc.length > 160 ? "…" : ""}</td><td class="num">${r.extra ? "0.000" : qtyFmt(r.tqty)}</td><td>${esc(r.unit)}</td><td class="num">${m2(r.rate)}</td><td class="num">${m2(r.tamt)}</td><td class="num">${qtyFmt(r.qty)}</td><td>${esc(r.unit)}</td><td class="num">${m2(r.applied)}</td><td class="num">${m2(r.amt)}</td><td class="num">${r.excess ? m2(r.excess) : ""}</td><td class="num">${r.extraAmt ? m2(r.extraAmt) : ""}</td><td class="num">${r.saving ? m2(r.saving) : ""}</td><td></td></tr>`;
  const tot = (label, o) => `<tr class="sub"><td></td><td><b>${label}</b></td><td colspan="3"></td><td class="num">${m2(o.tamt)}</td><td colspan="3"></td><td class="num">${m2(o.amt)}</td><td class="num">${m2(o.excess)}</td><td class="num">${m2(o.extraAmt)}</td><td class="num">${m2(o.saving)}</td><td></td></tr>`;
  return `<div class="table-wrap"><table class="${cls} dev"><thead><tr><th rowspan="2">S.No</th><th rowspan="2">Particular</th><th colspan="4">As per "G" Schedule</th><th colspan="4">As per Actual Executed of work</th><th colspan="3">Amount</th><th rowspan="2">Remarks</th></tr>
    <tr><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th><th>Excess</th><th>Extra</th><th>Saving</th></tr></thead><tbody>
    ${d.G.map(r6).join("")}${tot("Total", d.gT)}${tot(esc(tpLabel(d.c)), d.gTp)}${tot("G. Total", d.gNet)}
    ${d.H.length ? `<tr class="grp"><td></td><td colspan="13"><b>H-Schedule</b></td></tr>${d.H.map(r6).join("")}` : ""}${tot("Grand Total", d.grand)}</tbody></table></div>`;
}

function photosView(p, c) {
  return `<div class="card"><div class="row between wrap"><h2>Site photographs</h2>${p.photos.length ? `<button class="primary" data-print="photos">Print photo sheets (${Math.ceil(p.photos.length / 4)} page${p.photos.length > 4 ? "s" : ""})</button>` : ""}</div>
    <p class="muted small">Four photos per A4 page, with the name of work and work order number on top and signature spaces for JEN, AEN and XEN at the bottom.</p>
    <label class="drop" id="photoDrop"><input type="file" id="photoFile" accept="image/*" multiple><span class="drop-icon">📷</span><span><strong>Drop photos here</strong> or click to choose</span><small>JPG / PNG from phone or camera</small></label>
    <div class="photo-grid">${p.photos.map((ph, i) => `<div class="photo" data-ph="${ph.id}"><img src="${ph.src}" alt=""><input data-cap value="${esc(ph.caption || "")}" placeholder="Caption (optional)">
      <div class="row gap"><button class="icon" data-act="phUp" title="Move earlier">←</button><button class="icon" data-act="phDown" title="Move later">→</button><span class="muted small">${i + 1}</span><button class="icon danger-text" data-act="phDel" title="Remove">🗑</button></div></div>`).join("")}</div></div>`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function onClick(e) {
  const p = ctx.project(); const c = contract(p);
  const t = e.target.closest("[data-btab]")?.dataset.btab;
  if (t) { view.tab = t; renderBills(); return; }
  const pr = e.target.closest("[data-print]")?.dataset.print;
  if (pr) { printView(pr); return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  const bill = currentBill(p);
  if (act === "newBill") {
    if (p.bills.some((b) => b.kind === "final")) { ctx.toast("The final bill has already been made."); return; }
    const prev = p.bills.at(-1);
    const b = { id: uid("bl"), kind: "running", date: new Date().toISOString().slice(0, 10), qty: { ...(prev?.qty || {}) }, partRate: { ...(prev?.partRate || {}) }, parts: structuredClone(prev?.parts || {}), mbNo: prev?.mbNo || "", jen: prev?.jen || c.jen || "", aen: prev?.aen || c.aen || "" };
    p.bills.push(b); view.billId = b.id; view.tab = "bill";
  }
  if (act === "finalBill" && bill) {
    if (!confirm("Make this the final bill? Part rates will be cleared so every item is paid at the full rate.")) return;
    bill.kind = "final"; bill.partRate = {};
  }
  if (act === "delBill" && bill) {
    if (!confirm(`Delete ${billTitle(p, bill)}?`)) return;
    p.bills.splice(p.bills.indexOf(bill), 1); view.billId = p.bills.at(-1)?.id || "";
  }
  if (act === "addPart" && bill) {
    const id = e.target.closest("[data-line]").dataset.line;
    bill.parts ||= {};
    if (!bill.parts[id]?.length) {
      const cur = computeBill(p, bill).rows.find((r) => r.id === id);
      bill.parts[id] = [{ qty: cur?.qty || 0, rate: bill.partRate?.[id] ?? "" }, { qty: 0, rate: "" }];
      delete bill.qty[id]; if (bill.partRate) delete bill.partRate[id];
    } else bill.parts[id].push({ qty: 0, rate: "" });
  }
  if (act === "delPart" && bill) {
    const tr = e.target.closest("[data-pi]"); const id = tr.dataset.line; const list = bill.parts[id];
    list.splice(+tr.dataset.pi, 1);
    if (list.length <= 1) { const x = list[0]; delete bill.parts[id]; if (x) { bill.qty[id] = num(x.qty); if (x.rate !== "" && x.rate != null) (bill.partRate ||= {})[id] = num(x.rate); } }
  }
  if (act === "loadPrevBill") { pickFiles(".pdf,image/*", importPreviousBills); return; }
  if (act === "loadWO") { pickFiles(".pdf,image/*", loadWorkOrder); return; }
  if (act === "loadBOQ") { pickFiles(".xls,.pdf,image/*", loadBoq); return; }
  if (act === "addExtra") { addExtraDialog(p); return; }
  if (act === "delExtra") { const id = e.target.closest("[data-x]").dataset.x; if (!confirm("Remove this extra item?")) return; p.extras = p.extras.filter((x) => x.id !== id); }
  if (act === "excel") { exportExcel(p); return; }
  if (act.startsWith("ph")) {
    const id = e.target.closest("[data-ph]").dataset.ph; const i = p.photos.findIndex((x) => x.id === id);
    if (act === "phDel") p.photos.splice(i, 1);
    if (act === "phUp" && i > 0) [p.photos[i - 1], p.photos[i]] = [p.photos[i], p.photos[i - 1]];
    if (act === "phDown" && i < p.photos.length - 1) [p.photos[i + 1], p.photos[i]] = [p.photos[i], p.photos[i + 1]];
  }
  ctx.saveProject(); renderBills();
}

function onChange(e) {
  const p = ctx.project(); const c = contract(p); const el = e.target;
  if (el.id === "billSel") { view.billId = el.value; renderBills(); return; }
  if (el.id === "photoFile") { addPhotos([...el.files]); el.value = ""; return; }
  if (el.dataset.c) c[el.dataset.c] = el.type === "number" ? num(el.value) : el.value;
  else if (el.dataset.b) currentBill(p)[el.dataset.b] = el.value;
  else if (el.matches("[data-q], [data-pr]")) {
    const bill = currentBill(p); const id = el.closest("[data-line]").dataset.line;
    if (el.matches("[data-q]")) bill.qty[id] = el.value.includes("@") ? el.value.trim() : el.value === "" ? 0 : num(el.value);
    else { bill.partRate ||= {}; if (el.value === "") delete bill.partRate[id]; else bill.partRate[id] = num(el.value); }
  } else if (el.matches("[data-pq], [data-prr]")) {
    const tr = el.closest("[data-pi]"); const x = currentBill(p).parts[tr.dataset.line][+tr.dataset.pi];
    if (el.matches("[data-pq]")) x.qty = num(el.value); else x.rate = el.value === "" ? "" : num(el.value);
  } else if (el.matches("[data-terms]")) {
    c.terms = el.value.split("\n").map((t) => t.trim()).filter(Boolean);
  } else if (el.matches("[data-rate]")) {
    const id = el.closest("[data-line]").dataset.line;
    const x = p.extras.find((x) => x.id === id) || p.sections.flatMap((s) => s.items).find((it) => it.id === id);
    if (x) x.rate = num(el.value);
  } else if (el.dataset.xf) {
    const x = p.extras.find((x) => x.id === el.closest("[data-x]").dataset.x);
    x[el.dataset.xf] = el.dataset.xf === "rate" ? num(el.value) : el.value;
  } else if (el.matches("[data-cap]")) {
    p.photos.find((x) => x.id === el.closest("[data-ph]").dataset.ph).caption = el.value; ctx.saveProject(); return;
  } else return;
  ctx.saveProject(); renderBills();
}

function addExtraDialog(p) {
  ctx.modal(`<h2>Add an extra item</h2><p class="muted small">Pick it from your rate books, or type the item with its rate.</p>
    <input type="search" id="exQ" placeholder="Search rate books (e.g. kerb stone, geo membrane)">
    <div class="table-wrap mt" style="max-height:30vh"><table class="data small" id="exT"><tbody></tbody></table></div>
    <div class="form-grid compact mt"><label class="field wide">Description<textarea id="exD" rows="3"></textarea></label>
      <label class="field">Unit<input id="exU"></label><label class="field">Rate<input id="exR" type="number" step="any"></label></div>
    <button class="primary" id="exAdd">Add extra item</button>`, (m) => {
    const fill = () => { $("#exT tbody", m).innerHTML = ctx.searchItems($("#exQ", m).value).slice(0, 60).map((it) => `<tr><td>${esc(it.code)}</td><td>${esc(it.description.slice(0, 140))}</td><td>${esc(it.unit)}</td><td class="num">${m2(ctx.rateOf(it))}</td><td><button class="small" data-id="${it.id}">Use</button></td></tr>`).join(""); };
    $("#exQ", m).oninput = fill;
    $("#exT", m).onclick = (e) => {
      const it = ctx.searchItems("").find((x) => x.id === e.target.dataset.id) || ctx.findItem(e.target.dataset.id); if (!it) return;
      $("#exD", m).value = it.description; $("#exU", m).value = it.unit; $("#exR", m).value = ctx.rateOf(it);
    };
    $("#exAdd", m).onclick = () => {
      const d = $("#exD", m).value.trim(); if (!d) { ctx.toast("Enter a description."); return; }
      p.extras.push({ id: uid("x"), description: d, unit: $("#exU", m).value.trim(), rate: num($("#exR", m).value) });
      ctx.closeModal(); ctx.saveProject(); renderBills();
    };
  });
}

async function addPhotos(files) {
  const p = ctx.project(); contract(p);
  for (const f of files.filter((f) => f.type.startsWith("image/"))) {
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      p.photos.push({ id: uid("ph"), src: cv.toDataURL("image/jpeg", 0.82), caption: "" });
    } catch { ctx.toast(`${f.name}: could not read this image.`); }
  }
  ctx.saveProject(); renderBills();
}

// ---------------------------------------------------------------------------
// Print (A4) and Excel
// ---------------------------------------------------------------------------

function headerBlock(p, c, title) {
  return `<header class="p-head"><div class="p-org">${esc(c.office || p.client || "")}</div><h1>${esc(title)}</h1>
    <table class="p-meta"><tr><td><b>Name of work:</b> ${esc(p.name)}</td></tr>
    <tr><td><b>Work order / agreement No.:</b> ${esc(c.workOrderNo)} ${c.woDate ? `dated ${esc(c.woDate)}` : ""}</td></tr>
    <tr><td><b>Name of contractor:</b> ${esc(c.contractor)}</td></tr></table></header>`;
}
const signs = (list = ["Junior Engineer", "Assistant Engineer", "Executive Engineer"], office = "") => `<div class="p-sign">${list.map((s) => `<div>${s.toUpperCase()}${office ? `,<br>${esc(office.toUpperCase())}` : ""}</div>`).join("")}</div>`;
const fieldsTable = (rows) => `<table class="p-fields2">${rows.map(([k, v]) => `<tr><td>${k}</td><td>:</td><td>${v}</td></tr>`).join("")}</table>`;

function printView(kind) {
  const p = ctx.project(); const c = contract(p); const bill = currentBill(p);
  let html = "";
  if (kind === "all") {
    if (!bill) { ctx.toast("Make a bill first."); return; }
    html = ["bill", "slip", "deviation", "photos"].map((k) => (k === "slip" && !p.extras.length) || (k === "photos" && !p.photos.length) ? "" : printHtml(p, c, bill, k)).join("");
  } else html = printHtml(p, c, bill, kind);
  if (!html) { ctx.toast("Make a bill first."); return; }
  $("#printArea").innerHTML = html;
  window.print();
}

function printHtml(p, c, bill, kind) {
  let html = "";
  if (kind === "bill" && bill) {
    const k = computeBill(p, bill);
    const idx = p.bills.indexOf(bill);
    const prevBill = idx > 0 ? p.bills[idx - 1] : null;
    const pk = prevBill ? computeBill(p, prevBill) : { gTotal: 0, tp: 0, gNet: 0, hTotal: 0 };
    const rateCell = (r) => {
      if (r.parts) return m2(r.rate);
      const raw = String(bill.qty[r.id] ?? "");
      if (raw.includes("@")) return raw.split("+").map((x, _, all) => { const [q, rr] = x.split("@"); const rate = rr ? num(rr) : r.rate; return all.length === 1 ? `${m2(rate)}${rate !== r.rate ? `<br><small>(${m2(r.rate)})</small>` : ""}` : `${qtyFmt(num(q))} @ ${m2(rate)}`; }).join("<br>");
      return r.part ? `${m2(r.applied)}<br><small>(${m2(r.rate)})</small>` : m2(r.rate);
    };
    const partLines = (r) => r.parts ? `<div class="p-parts">${r.parts.map((x) => `${qtyFmt(x.qty)} ${esc(r.unit)} @ ${m2(x.rate)}${x.part ? ` <i>(part rate; at full rate ${m2(r.rate)} = ${m2(x.full)})</i>` : ""} = ${m2(x.amt)}`).join("<br>")}${r.withheld > 0.004 ? `<br><b>Withheld: ${m2(r.withheld)}</b>` : ""}</div>` : r.withheld > 0.004 ? `<div class="p-parts"><i>At full rate ${m2(r.fullAmt)}; withheld ${m2(r.withheld)}</i></div>` : "";
    let i = 0;
    const row = (r) => `<tr><td>${esc(r.unit)}</td><td class="n">${qtyFmt(round(r.qty - r.prevQty, 3))}</td><td class="n">${qtyFmt(r.qty)}</td><td class="p-desc">${++i}/${esc(r.no)} ${esc(r.desc)}${partLines(r)}</td><td class="n">${rateCell(r)}</td><td class="n">${m2(r.amt)}</td><td class="n">${m2(r.since)}</td><td></td></tr>`;
    const tot = (l, a, b = a, cls = "p-tot") => `<tr class="${cls}"><td colspan="5">${l}</td><td class="n">${m2(a)}</td><td class="n">${b === "" ? "" : m2(b)}</td><td></td></tr>`;
    const used = (r) => r.qty || r.prevQty;
    const words = amountInWords(k.say);
    // I - Account, split into A4 pages with "Carried Over" / "B/F" like the department's bills.
    const colgroup = `<colgroup><col style="width:6%"><col style="width:8%"><col style="width:8%"><col style="width:41%"><col style="width:11%"><col style="width:10%"><col style="width:10%"><col style="width:6%"></colgroup>`;
    const thead = `<thead><tr><th rowspan="2">Unit</th><th rowspan="2">Quantity executed (or supplied) since last certificate</th><th rowspan="2">Quantity executed (or supplied) up-to-date as per Measurement Book</th><th rowspan="2">Item of work or supplies (grouped under "sub-heads" and "sub-work" of estimate)</th><th rowspan="2">Rate in Rs.</th><th colspan="2">AMOUNT</th><th rowspan="2">Remarks</th></tr>
      <tr><th>% up-to-date</th><th>Since previous bill Total for each sub-head</th></tr><tr class="p-colno"><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th></tr></thead>`;
    const seq = [];
    const add = (html, lines, a6 = 0, a7 = 0) => seq.push({ html, lines, a6, a7 });
    const est = (r) => Math.max(2, Math.ceil((r.desc.length + 8) / 44)) + (r.parts ? r.parts.length + 1 : 0) + (!r.parts && r.withheld > 0.004 ? 1 : 0);
    add(`<tr class="p-sec"><td colspan="8">G-Schedule</td></tr>`, 1);
    k.gRows.filter(used).forEach((r) => add(row(r), est(r), r.amt, r.since));
    add(tot("TOTAL", k.gTotal, round(k.gTotal - pk.gTotal, 2)), 1);
    add(tot(esc(tpLabel(c)), k.tp, round(k.tp - pk.tp, 2)), 1);
    add(tot("TOTAL G-SCHEDULE", k.gNet, round(k.gNet - pk.gNet, 2)), 1);
    if (k.hRows.some(used)) {
      add(`<tr class="p-sec"><td colspan="8">H-Schedule</td></tr>`, 1);
      k.hRows.filter(used).forEach((r) => add(row(r), est(r), r.amt, r.since));
      add(tot("TOTAL H-SCHEDULE", k.hTotal, round(k.hTotal - pk.hTotal, 2)), 1);
    }
    add(tot("Total value of work done or supplies made to date", k.total, round(k.total - k.prevTotal, 2), "p-grand"), 2);
    add(tot("Deduct value of work or supplies shown in previous bill", k.prevTotal, ""), 2);
    add(tot("Net value of work or supplies since previous bill", k.net, ""), 2);
    add(tot("SAY", k.say, "", "p-grand"), 1);
    const certHtml = `<p class="p-words">Net value in words: ${esc(words)}</p>
      <p class="p-foot">* The full name of the work as given in the estimate should be entered here.<br>If the outlay on the work is recorded by sub-heads, the total for each sub-head should be shown in column 6 and against this total there should be an entry in column 7 also. In no other case should any entries be made in column 7.</p>
      <div class="p-keep"><h3 class="c">II - Certificate and signature</h3>
      <p>(1) The measurements were made by ${esc(bill.jen || c.jen || "....................")} on ${esc(bill.measured || "..............")} and are recorded at page ${esc(bill.mbPages || "......")} of Measurement Book No. ${esc(bill.mbNo || "..........")}, and were checked by ${esc(bill.aen || c.aen || "....................")} on ..............</p>
      <p>(2) The connected measurements have been closed against this bill.</p>
      <p>Certificate: 1. The work is satisfactory and as per specifications and the G-Schedule. 2. Nothing is outstanding against the contractor regarding this bill.</p>
      <div class="p-sign4"><div>Dated signature of officer preparing the bill<br><b>${esc(c.jen || "")}</b><br>Junior Engineer</div><div><br><b>${esc(c.aen || "")}</b><br>Assistant Engineer</div><div><br><b>${esc(c.xen || "")}</b><br>Executive Engineer</div><div>Dated left-hand thumb impression or dated signature of contractor<br><b>${esc(c.contractor)}</b></div></div></div>`;
    const pages = [[]]; const carry = [];
    let usedLines = 0, cap = 17, run6 = 0, run7 = 0;
    for (const it of seq) {
      if (usedLines + it.lines > cap && pages.at(-1).length) { carry.push([run6, run7]); pages.push([]); usedLines = 0; cap = 34; }
      pages.at(-1).push(it); usedLines += it.lines; run6 += it.a6; run7 += it.a7;
    }
    const cf = (label, [x, y]) => `<tr class="p-tot"><td colspan="5" class="${label === "B/F" ? "n" : ""}">${label}</td><td class="n">${m2(x)}</td><td class="n">${m2(y)}</td><td></td></tr>`;
    const accountPages = pages.map((pg, pi) => `${pi ? `<section class="p-page p-27g">` : ""}${pi ? "" : `<h3 class="c">A - ACCOUNT OF WORK OR SUPPLIES</h3>`}
      <table class="p-table p-bill">${colgroup}${thead}<tbody>${pi ? cf("B/F", carry[pi - 1]) : ""}${pg.map((x) => x.html).join("")}${pi < pages.length - 1 ? cf("Carried Over........................", carry[pi]) : ""}</tbody></table>
      ${pi < pages.length - 1 ? `<div class="p-pageno c">${pi + 1}</div></section>` : `${certHtml}<div class="p-pageno c">${pi + 1}</div>`}`).join("");
    html = `<section class="p-page p-27g">
      <div class="p-form-no">P.W.A. FORM No. 27G<br>Sec. Chap. XIV, Paras 440, 444 &amp; 445</div>
      <p class="p-note">Final payment must invariably be made on forms printed on yellow paper, which should not be used for intermediate payments.</p>
      <h1>${esc(billTitle(p, bill))}</h1>
      <p class="p-note c">(For contractors and suppliers only, for payment for work or supplies actually measured)</p>
      <table class="p-fields">
        <tr><td>Cash Book Voucher No.</td><td>: ${esc(bill.voucher || "")}</td><td>Dated : ${esc(bill.date || "")}</td></tr>
        <tr><td>Name of contractor or supplier</td><td colspan="2">: ${esc(c.contractor)}</td></tr>
        <tr><td>*Name of work</td><td colspan="2">: ${esc(p.name)}</td></tr>
        <tr><td>Serial No. of this bill</td><td colspan="2">: ${esc(billTitle(p, bill))}</td></tr>
        <tr><td>No. and date of the last bill for this work</td><td colspan="2">: ${prevBill ? `${esc(billTitle(p, prevBill))}${prevBill.date ? `, ${esc(prevBill.date)}` : ""}` : "—"}</td></tr>
        <tr><td>Reference to work order or agreement</td><td colspan="2">: ${esc(c.workOrderNo)}${c.woDate ? ` dated ${esc(c.woDate)}` : ""}</td></tr>
        <tr><td>Date of written order to commence work</td><td colspan="2">: ${esc(c.commence)}</td></tr>
        <tr><td>Stipulated date of completion of work</td><td colspan="2">: ${esc(c.stipulated)}</td></tr>
        <tr><td>Date of actual completion of work</td><td colspan="2">: ${esc(c.completed || "W.I.P.")}</td></tr>
        <tr><td>Date of measurements</td><td colspan="2">: ${esc(bill.measured || "")}</td></tr></table>
      ${accountPages}</section>
      <section class="p-page p-27g"><h3 class="c">III - Memorandum of payment</h3>
      <table class="p-table p-memo"><tbody>
        <tr><td>1. Total value of work done, as per account I, column 6</td><td class="n">${m2(k.total)}</td></tr>
        <tr><td>2. Deduct amount withheld: (a) from previous bills, as per last running account bill<br>&nbsp;&nbsp;&nbsp;&nbsp;(b) from this bill</td><td class="n"><br></td></tr>
        <tr><td>3. Balance, i.e. up-to-date payments (items 1 − 2)</td><td class="n">${m2(k.total)}</td></tr>
        <tr><td>4. Total amount of payments already made, as per last running account bill No. ${prevBill ? esc(billTitle(p, prevBill)) : "—"}</td><td class="n">${m2(k.prevTotal)}</td></tr>
        <tr><td>5. Payments now to be made, as detailed below:<br>&nbsp;&nbsp;(a) by recovery of amounts creditable to this work<br>&nbsp;&nbsp;(b) by recovery of amounts creditable to other works or heads of account<br>&nbsp;&nbsp;(c) by cheque<br>&nbsp;&nbsp;(d) by cash</td><td class="n">${m2(k.net)}</td></tr>
        <tr class="p-grand"><td>Total of 2(b) and 5 (a to d)</td><td class="n">${m2(k.net)}</td></tr></tbody></table>
      <p>Pay Rs. ${m2(k.say)} (${esc(words)}) by cheque / cash.</p>
      <div class="p-sign"><div>Dated initials of disbursing officer</div><div>Full signature of contractor</div></div>
      <p>Received Rs. ................ (in words ........................................................) in final / part payment of the demand for this work or supplies made. Dated the ................</p>
      <div class="p-sign"><div>Witness of identification and payment</div><div>Left-hand thumb impression or signature of contractor</div></div>
      <p>Paid by me vide cheque No. ................ dated ................ or cash book entry dated ................</p>
      <div class="p-sign"><div></div><div>Cashier — dated initials of the person actually making the payment</div></div>
      <p class="p-foot">The figures should be tested to see that they agree with the total of items 4 and 5. Here specify the net amount payable vide item 5 (c) and (d). The payee's acknowledgement should be for the gross amount paid as item 5 (a to d). Payment should be attested by some known person when the payee's acknowledgement is given by a mark, seal or thumb impression. This space is reserved for any remarks which the disbursing officer or the divisional officer may wish to record in respect of the execution of the work, check of measurements or the state of the contractor's account.</p>
      ${(c.terms || []).length ? `<h3>Terms and conditions of the work order</h3><ol class="p-terms">${c.terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}</section>`;
  } else if (kind === "slip" && bill) {
    const k = computeBill(p, bill);
    const ex = k.rows.filter((r) => r.extra);
    html = `<section class="p-page p-slip"><div class="c"><b>OFFICE OF THE ${esc((c.office || p.client || "").toUpperCase())}</b><h1>EXTRA ITEM SLIP</h1></div>
      ${fieldsTable([["Name of Work", esc(p.name)], ["Contract Document No.", `${esc(c.workOrderNo)}${c.woDate ? ` Dated ${esc(c.woDate)}` : ""}`], ["Name of Contractor", esc(c.contractor)]])}
      <table class="p-table"><colgroup><col style="width:7%"><col style="width:45%"><col style="width:14%"><col style="width:11%"><col style="width:13%"><col style="width:10%"></colgroup>
      <thead><tr><th>S.No.</th><th>Details</th><th>Quantity</th><th>Rate</th><th>Amount</th><th>Remarks</th></tr></thead><tbody>
      ${ex.map((r, i) => `<tr><td class="c">${i + 1}</td><td class="p-desc">${esc(r.desc)}</td><td class="n">${qtyFmt(r.qty)} ${esc(r.unit)}</td><td class="n">${m2(r.applied)}</td><td class="n">${m2(r.amt)}</td><td></td></tr>`).join("")}
      <tr class="p-tot"><td></td><td class="n" colspan="3">Total :</td><td class="n">${m2(k.extraGross)}</td><td></td></tr>
      <tr class="p-tot"><td></td><td class="n" colspan="3">${esc(tpLabel(c))}</td><td class="n">${m2(Math.abs(k.extraNet - k.extraGross))}</td><td></td></tr>
      <tr class="p-grand"><td></td><td class="n" colspan="3">G/Total :</td><td class="n">${m2(k.extraNet)}</td><td></td></tr></tbody></table>
      ${signs(["Junior Engineer", "Assistant Engineer", "Executive Engineer"], c.office || p.client)}</section>`;
  } else if (kind === "deviation") {
    const d = deviationRows(p);
    html = `<section class="p-page p-landscape p-dev"><h1 class="c">DEVIATION STATEMENT</h1>
      ${fieldsTable([["Name of Work", esc(p.name)], ["Name of Agency", esc(c.contractor)], ["Agreement No.", `${esc(c.workOrderNo)}${c.woDate ? ` Dated ${esc(c.woDate)}` : ""}`]])}
      ${devTable(d, "p-table")}${signs(["Junior Engineer", "Assistant Engineer", "Executive Engineer"], c.office || p.client)}</section>`;
  } else if (kind === "photos") {
    const pages = [];
    for (let i = 0; i < p.photos.length; i += 4) pages.push(p.photos.slice(i, i + 4));
    html = pages.map((ph, pi) => `<section class="p-page p-photos p-landscape"><header class="p-head"><div class="p-org">${esc(c.office || p.client || "")}</div>
        <div><b>Name of work:</b> ${esc(p.name)}</div><div><b>Work order No.:</b> ${esc(c.workOrderNo)} ${c.woDate ? `dated ${esc(c.woDate)}` : ""}${bill ? ` · ${esc(billTitle(p, bill))}` : ""}</div></header>
      <div class="p-photo-grid">${ph.map((x) => `<figure><img src="${x.src}" alt="">${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ""}</figure>`).join("")}</div>
      ${signs(["JEN", "AEN", "XEN"])}<div class="p-pageno">Page ${pi + 1} of ${pages.length}</div></section>`).join("");
  }
  return html;
}

function exportExcel(p) {
  const X = window.XLSX; const c = contract(p); const bill = currentBill(p);
  if (!bill) { ctx.toast("Make a bill first."); return; }
  const k = computeBill(p, bill);
  const wb = X.utils.book_new();
  const billAoa = [[c.office || p.client || ""], [billTitle(p, bill)], [`Name of work: ${p.name}`], [`Work order: ${c.workOrderNo} ${c.woDate || ""}`], [`Contractor: ${c.contractor}`], [],
    ["S.No", "Item", "Unit", "Tender qty", "Qty since last", "Qty up-to-date", "Rate", "Applied rate", "Amount up-to-date", "Since previous"],
    ...k.rows.map((r, i) => [`${i + 1}/${r.no}`, r.desc, r.unit, r.extra ? 0 : r.tqty, round(r.qty - r.prevQty, 3), r.qty, r.rate, r.applied, r.amt, r.since]),
    [], ["", "Total G-Schedule (gross)", "", "", "", "", "", "", k.gTotal], ["", tpLabel(c), "", "", "", "", "", "", k.tp], ["", "Total G-Schedule", "", "", "", "", "", "", k.gNet],
    ["", "H-Schedule", "", "", "", "", "", "", k.hTotal], ["", "Total value of work done to date", "", "", "", "", "", "", k.total],
    ["", "Deduct previous bill", "", "", "", "", "", "", k.prevTotal], ["", "Net value of this bill", "", "", "", "", "", "", k.net], ["", "SAY", "", "", "", "", "", "", k.say]];
  const ws1 = X.utils.aoa_to_sheet(billAoa); ws1["!cols"] = [{ wch: 8 }, { wch: 70 }, { wch: 7 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 14 }];
  X.utils.book_append_sheet(wb, ws1, "Bill");
  const d = deviationRows(p);
  const dr = (r, i) => [i + 1, r.desc, r.extra ? 0 : r.tqty, r.unit, r.rate, r.tamt, r.qty, r.unit, r.applied, r.amt, r.excess || "", r.extraAmt || "", r.saving || ""];
  const dt = (l, o) => ["", l, "", "", "", o.tamt, "", "", "", o.amt, o.excess, o.extraAmt, o.saving];
  const devAoa = [["DEVIATION STATEMENT"], [`Name of work: ${p.name}`], [`Agreement: ${c.workOrderNo} ${c.woDate || ""}`], [],
    ["S.No", "Particular", "G qty", "Unit", "G rate", "G amount", "Exec qty", "Unit", "Exec rate", "Exec amount", "Excess", "Extra", "Saving"],
    ...d.G.map(dr), dt("Total", d.gT), dt(tpLabel(c), d.gTp), dt("G. Total", d.gNet), ["", "H-Schedule"], ...d.H.map(dr), dt("Grand Total", d.grand)];
  const ws2 = X.utils.aoa_to_sheet(devAoa); ws2["!cols"] = [{ wch: 6 }, { wch: 60 }, ...Array(11).fill({ wch: 12 })];
  X.utils.book_append_sheet(wb, ws2, "Deviation");
  const ex = k.rows.filter((r) => r.extra);
  const ws3 = X.utils.aoa_to_sheet([["EXTRA ITEM SLIP"], [`Name of work: ${p.name}`], [], ["S.No", "Details", "Quantity", "Unit", "Rate", "Amount"], ...ex.map((r, i) => [i + 1, r.desc, r.qty, r.unit, r.applied, r.amt]), ["", "Total", "", "", "", k.extraGross], ["", tpLabel(c), "", "", "", round(k.extraNet - k.extraGross, 2)], ["", "G/Total", "", "", "", k.extraNet]]);
  ws3["!cols"] = [{ wch: 6 }, { wch: 70 }, { wch: 10 }, { wch: 7 }, { wch: 10 }, { wch: 14 }];
  X.utils.book_append_sheet(wb, ws3, "Extra items");
  X.writeFile(wb, `${billTitle(p, bill).replace(/\s+/g, "_")}_${(c.workOrderNo || p.name).replace(/[^\w-]+/g, "_").slice(0, 40)}.xlsx`);
}

// ---------------------------------------------------------------------------
// Work order and BOQ upload
// ---------------------------------------------------------------------------

function pickFiles(accept, fn) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = accept; inp.multiple = true;
  inp.onchange = () => fn([...inp.files]);
  inp.click();
}
const docStatus = (t, cls = "") => { const s = $("#docStatus"); if (s) { s.textContent = t; s.className = "status " + cls; } };

async function aiParts(files) {
  const parts = [];
  for (const f of files) parts.push(...(await prepareDrawing(f)).parts);
  return parts;
}

async function loadWorkOrder(files) {
  if (!files.length) return;
  if (!hasKey()) { ctx.toast("Reading a work order needs a Claude or OpenAI key (Settings)."); return; }
  const p = ctx.project(); const c = contract(p);
  try {
    docStatus("Reading the work order…");
    const w = await extractWorkOrder(await aiParts(files), { onText: (n) => docStatus(`Reading the work order… ${Math.round(n / 100) / 10}k`) });
    const set = (k, v) => { if (v != null && v !== "" && v !== 0) c[k] = v; };
    set("office", w.office); set("contractor", w.contractor); set("workOrderNo", w.work_order_no || w.agreement_no); set("woDate", w.work_order_date);
    set("commence", w.commence_date); set("stipulated", w.completion_date);
    set("jen", w.engineers.jen); set("aen", w.engineers.aen); set("xen", w.engineers.xen);
    if (w.tender_premium_direction !== "unknown") { c.tpDir = w.tender_premium_direction; c.tpPct = num(w.tender_premium_percent); }
    if (w.terms?.length) c.terms = w.terms;
    if (w.work_name) p.name = w.work_name;
    if (w.office && !p.client) p.client = w.office;
    if (w.nit_no && !p.reference) p.reference = w.nit_no;
    c.woAmount = num(w.contract_amount);
    ctx.saveProject(); renderBills();
    docStatus(`Work order read${c.woAmount ? `: contract amount ${money(c.woAmount)}` : ""}. Check the details below.`, "ok");
  } catch (e) { console.error(e); docStatus(e.message, "err"); }
}

async function loadBoq(files) {
  if (!files.length) return;
  const p = ctx.project();
  const hasItems = p.sections.some((s) => s.items.length);
  if (hasItems && !confirm("Replace the BOQ items of this project with the uploaded BOQ? (Bills already made refer to the old items.)")) return;
  try {
    const items = [];
    for (const f of files) {
      if (/\.xls$/i.test(f.name)) {
        const buf = await f.arrayBuffer();
        const first = readNicBoq(buf);
        for (const n of first.sheetNames) {
          const info = readNicBoq(buf, n);
          const sched = info.boqType === "Percentage" ? "G" : "H";
          info.items.filter((i) => !i.heading).forEach((i) => items.push({ schedule: sched, sno: i.sno, description: i.description, quantity: i.qty || 0, unit: i.unit, rate: i.rate || 0 }));
        }
      } else {
        if (!hasKey()) { ctx.toast("Reading a PDF BOQ needs a Claude or OpenAI key (Settings), or upload the .xls."); return; }
        docStatus(`Reading ${f.name}…`);
        items.push(...(await extractBoqDocument(await aiParts([f]), { onText: (n) => docStatus(`Reading the BOQ… ${Math.round(n / 100) / 10}k`) })));
      }
    }
    if (!items.length) { docStatus("No items found in the BOQ.", "err"); return; }
    const mk = (sched) => ({ id: uid("s"), name: `${sched}-Schedule`, items: items.filter((i) => i.schedule === sched).map((i) => ({
      id: uid("b"), bsrId: "", code: "", description: i.description, unit: i.unit, qty: num(i.quantity), rate: num(i.rate), measurements: [], schedule: sched, sno: i.sno,
    })) });
    p.sections = [mk("G"), mk("H")].filter((s) => s.items.length);
    p.bills = []; view.billId = "";
    ctx.saveProject(); renderBills();
    docStatus(`BOQ loaded: ${items.filter((i) => i.schedule === "G").length} G-Schedule and ${items.filter((i) => i.schedule === "H").length} H-Schedule items.`, "ok");
  } catch (e) { console.error(e); docStatus(e.message, "err"); }
}

// ---------------------------------------------------------------------------
// Previous bills (already submitted) so that later bills and the deviation are exact
// ---------------------------------------------------------------------------

const normNo = (v) => String(v ?? "").trim().replace(/\.0+$/, "").replace(/^0+(\d)/, "$1");

async function importPreviousBills(files) {
  if (!files.length) return;
  if (!hasKey()) { ctx.toast("Reading a bill needs a Claude or OpenAI key (Settings). You can also enter the old bill by hand with “New running bill”."); return; }
  const p = ctx.project(); contract(p);
  try {
    docStatus("Reading the bill…");
    const x = await extractBill(await aiParts(files), { onText: (n) => docStatus(`Reading the bill… ${Math.round(n / 100) / 10}k`) });
    const L = lines(p);
    const bill = { id: uid("bl"), kind: x.is_final ? "final" : "running", date: x.bill_date || "", qty: {}, partRate: {}, parts: {}, imported: true, importedTotal: num(x.total_up_to_date) };
    const groups = new Map(); const missing = [];
    for (const it of x.items) {
      let line;
      if (it.is_extra) {
        const key = it.description.toLowerCase().replace(/\s+/g, " ").slice(0, 30);
        let ex = p.extras.find((e) => e.description.toLowerCase().replace(/\s+/g, " ").startsWith(key.slice(0, 20)));
        if (!ex) { ex = { id: uid("x"), description: it.description, unit: it.unit, rate: num(it.full_rate) || num(it.paid_rate) }; p.extras.push(ex); }
        line = { id: ex.id, rate: ex.rate };
      } else {
        const same = L.filter((l) => !l.extra && l.s === it.schedule);
        const full = num(it.full_rate) || num(it.paid_rate);
        line = same.find((l) => normNo(l.no) === normNo(it.boq_no));
        // Bill numbering does not always follow the BOQ: fall back to the item with the same agreement rate.
        if (full && (!line || (line.rate && Math.abs(line.rate - full) > 0.5))) {
          const byRate = same.filter((l) => Math.abs(l.rate - full) <= 0.5);
          const pick = byRate.length === 1 ? byRate[0] : byRate.find((l) => normNo(l.no).startsWith(normNo(it.boq_no) + "."));
          if (pick) line = pick;
          else if (line && line.rate) line = null;
        }
        // "1" in the bill may be "1.01" in the BOQ, and a schedule with a single item needs no number at all.
        if (!line) line = same.filter((l) => normNo(l.no).startsWith(normNo(it.boq_no) + ".")).length === 1 ? same.find((l) => normNo(l.no).startsWith(normNo(it.boq_no) + ".")) : same.length === 1 ? same[0] : null;
      }
      if (!line) { missing.push(`${it.schedule}-${it.boq_no || "?"} ${it.description.slice(0, 40)}`); continue; }
      if (!groups.has(line.id)) groups.set(line.id, { line, parts: [] });
      groups.get(line.id).parts.push(it);
    }
    for (const { line, parts } of groups.values()) {
      // H-Schedule items in an item-rate BOQ often have no rate in the BOQ: take the agreement rate from the bill.
      if (!line.rate && parts[0].full_rate) {
        const item = p.sections.flatMap((s) => s.items).find((i) => i.id === line.id); if (item) item.rate = num(parts[0].full_rate);
        line.rate = num(parts[0].full_rate);
      }
      if (parts.length === 1) {
        bill.qty[line.id] = num(parts[0].qty_up_to_date);
        if (num(parts[0].paid_rate) && Math.abs(num(parts[0].paid_rate) - line.rate) > 0.004) bill.partRate[line.id] = num(parts[0].paid_rate);
      } else bill.parts[line.id] = parts.map((q) => ({ qty: num(q.qty_up_to_date), rate: Math.abs(num(q.paid_rate) - line.rate) > 0.004 ? num(q.paid_rate) : "" }));
    }
    const n = Math.max(1, Math.round(num(x.bill_number)) || p.bills.length + 1);
    const at = Math.min(p.bills.filter((b) => b.kind !== "final").length, n - 1);
    p.bills.splice(at, 0, bill);
    view.billId = bill.id; view.tab = "bill";
    ctx.saveProject(); renderBills();
    const got = computeBill(p, bill).total;
    const diff = round(got - bill.importedTotal, 2);
    const msg = `${billTitle(p, bill)} read: ${groups.size} items.${missing.length ? ` Not matched to the BOQ: ${missing.join("; ")}.` : ""} ${bill.importedTotal ? (Math.abs(diff) < 1 ? `Total matches the bill (${money(got)}).` : `Total here ${money(got)} vs bill ${money(bill.importedTotal)} (difference ${money(diff)}) — please check.`) : ""}`;
    docStatus(msg, Math.abs(diff) < 1 && !missing.length ? "ok" : "err");
    ctx.toast(msg, 9000);
  } catch (e) { console.error(e); docStatus(e.message, "err"); }
}
