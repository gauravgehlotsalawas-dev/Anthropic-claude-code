// Contractor's bills from the measurement book: running/final bill (P.W.A. Form 27G style),
// extra item slip, deviation statement and site photo sheets.
import { uid, round, num, money, qtyFmt, esc, itemQty, amountInWords } from "./store.js";
import { readNicBoq } from "./nicboq.js";
import { pdfjsLib } from "./bsr-import.js";
import { buildDemoProject } from "./demo.js";
import { readDocument, parseWorkOrder, parseBoqLines, parseBoqRows } from "./docread.js";

/** Dates print as on the department's papers: 29.08.2025. */
const fd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v).split("-").reverse().join(".") : esc(v || ""));

let ctx; // { project, saveProject, toast, modal, closeModal, searchItems, rateOf, download }
const $ = (s, el = document) => el.querySelector(s);
const view = { tab: "bill", billId: "", xsel: new Set() };
const sched = (it) => it.schedule || (it.bsrId ? "G" : "H");
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const m2 = (v) => money(v, false);

export function initBills(c) {
  ctx = c;
  const root = $("#billsRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", (e) => {
    if (e.target.id !== "billFilter") return;
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll(".bill-table tr[data-line]").forEach((tr) => {
      const main = root.querySelector(`.bill-table tr[data-text][data-line="${tr.dataset.line}"]`);
      tr.style.display = !q || main?.dataset.text.includes(q) ? "" : "none";
    });
  });
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
    const refs = bill.mbRefs?.[l.id]?.filter((x) => num(x.qty));
    const plist = refs?.length ? refs.map((x) => ({ qty: x.qty, rate: x.rate })) : bill.parts?.[l.id];
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

/** Bill number: set by the user on a bill (e.g. the 3rd bill entered as the base), otherwise one more than the previous bill. */
function billNo(p, b) {
  if (num(b.number) > 0) return Math.round(num(b.number));
  const i = p.bills.indexOf(b);
  return i > 0 ? billNo(p, p.bills[i - 1]) + 1 : 1;
}
const billTitle = (p, b) => (b.kind === "final" ? "Final Bill" : `${ord(billNo(p, b))} Running Bill`);
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
    <p class="muted small"><b>Bills are kept separate from the estimates and e-tender BOQs</b> (tabs 1–5): choose or start a work with the selector at the top while this tab is open. Upload the work order and the BOQ as PDF, Excel, Word or photos (several photos for several pages). Scans and photos are read on this computer with OCR, no internet service. You check every value before it is used.</p>
    <div class="row gap wrap"><button class="primary" data-act="loadWO">Upload work order</button><button class="primary" data-act="loadBOQ">Upload BOQ</button><button class="ghost" data-act="demo" title="A complete fictional work with two running bills, extra items and photos">Load demo (Gaurav Nagar Nigam)</button><span class="status" id="docStatus"></span></div></div>
    <div class="card"><h2>Contract details</h2>
    <p class="muted small">From the work order / agreement. Used on the bill, extra item slip, deviation statement and photo sheets.</p>
    <div class="form-grid">
      <label class="field" style="grid-column:1/-1">Name of work<textarea data-pname rows="2">${esc(p.name)}</textarea></label>
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
    <p class="mt"><button class="ghost danger-text" data-act="delWork">Delete this work and its bills</button></p>
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
        ${p.bills.length ? "" : `<button class="ghost" data-act="baseBill" title="For the 2nd, 4th or final bill: enter the last bill already submitted, so this tool continues from it">Enter last submitted bill</button>`}
        ${bill && bill.kind !== "final" ? `<button class="ghost" data-act="finalBill">Make this the final bill</button>` : ""}${bill && bill.kind === "final" ? `<button class="ghost" data-act="runningBill">Make it a running bill again</button>` : ""}
        ${bill ? `<button class="ghost danger-text" data-act="delBill">Delete bill</button>` : ""}</div>
      ${bill ? `<div class="row gap wrap"><button class="primary" data-print="all" title="Bill with memorandum and terms, extra item slip, deviation and photos">Print complete bill file</button><button class="ghost" data-print="bill">Print bill</button><button class="ghost" data-print="mb" title="Abstract of cost as written in the measurement book">MB abstract</button><button class="ghost" data-print="slip">Extra item slip</button><button class="ghost" data-print="deviation">Deviation</button><button class="ghost" data-act="excel">Excel</button></div>` : ""}
    </div></div>`;
  if (!bill) return head + `<div class="card"><p><b>First bill of this work?</b> Press <b>New running bill</b> and enter the up-to-date quantities from the measurement book.</p>
    <p><b>Making the 2nd, 4th or final bill?</b> Press <b>Enter last submitted bill</b>, choose its number (for example 3) and type its up-to-date quantities and rates from the bill. Then press <b>New running bill</b> (or make it the final bill): “since previous bill”, “deduct previous bill” and the deviation continue exactly from it.</p></div>`;
  const k = computeBill(p, bill);
  const cv = contractValue(p);
  const extraPct = cv ? (k.extraNet / cv) * 100 : 0;
  const meta = (key, label, type = "text") => `<label class="field small">${label}<input data-b="${key}" type="${type}" value="${esc(bill[key] ?? "")}"></label>`;
  const row = (r, i) => {
    const pct = r.tqty ? (r.qty / r.tqty) * 100 : null;
    return `<tr data-line="${r.id}" class="${r.extra ? "extra-row" : ""}" data-text="${esc((r.desc + " " + r.no).toLowerCase())}"><td><input data-mbs class="w70" value="${esc(bill.mbs?.[r.id] ?? "")}" placeholder="${i + 1}"></td><td>${esc(r.no)}</td>
      <td class="desc"><div class="clamp">${esc(r.desc)}</div>${r.extra ? `<button class="link small danger-text" data-act="delExtraLine" title="Delete this extra item from the work and all its bills">🗑 Delete extra item</button>` : ""}</td><td>${esc(r.unit)}</td>
      <td class="num">${r.extra ? "—" : qtyFmt(r.tqty)}</td><td class="num muted">${qtyFmt(r.prevQty)}</td>
      <td class="num">${r.parts ? `<b>${qtyFmt(r.qty)}</b>${bill.mbRefs?.[r.id]?.length ? `<div class="small muted">from M.B.</div>` : ""}` : `<input data-q class="w120 num" value="${esc(bill.qty[r.id] ?? "")}" placeholder="0" title="Up-to-date quantity. For parts at different rates use “Part rate” or type e.g. 237.74@384.5 + 409.5@159">`}<div><button class="link small" data-act="mbRefs" title="Quantities from measurement book pages (e.g. 10/02 → 237.74)">MB refs${bill.mbRefs?.[r.id]?.length ? ` (${bill.mbRefs[r.id].length})` : ""}</button> · <button class="link small" data-act="addPart" title="Split this item into quantities paid at different rates">＋ part rate</button></div>${bill.mbRefs?.[r.id]?.length ? `<div class="small muted">MB: ${bill.mbRefs[r.id].map((x) => esc(x.page || "?")).join(", ")}</div>` : ""}</td>
      <td class="num">${qtyFmt(round(r.qty - r.prevQty, 3))}</td>
      <td class="num"><input data-rate type="number" step="any" class="w100 num" value="${r.rate || ""}" placeholder="rate" title="Agreement rate (for H-Schedule items: the contractor's quoted rate)"></td>
      <td class="num"><input data-pr type="number" step="any" class="w90 num" value="${bill.partRate?.[r.id] ?? ""}" placeholder="full" title="Part rate for a running bill (leave blank for the full rate)"></td>
      <td class="num">${m2(r.amt)}</td><td class="num">${m2(r.since)}</td>
      <td class="num">${pct == null ? `<span class="badge">extra</span>` : `<span class="${pct > 100 ? "warn" : ""}">${pct.toFixed(0)}%</span>`}</td></tr>
      ${r.parts && !bill.mbRefs?.[r.id]?.length ? r.parts.map((x, k) => `<tr class="part-row" data-line="${r.id}" data-pi="${k}"><td></td><td></td><td colspan="4" class="small">↳ ${k === 0 ? "Quantity" : "Further quantity"} ${x.part ? `<span class="badge warn-badge">part rate</span>` : `<span class="badge">full rate</span>`}</td>
        <td class="num"><input data-pq type="number" step="any" class="w100 num" value="${x.qty || ""}" placeholder="qty"></td><td></td>
        <td class="num"><input data-prr type="number" step="any" class="w100 num" value="${bill.parts[r.id][k].rate ?? ""}" placeholder="${m2(r.rate)}" title="Rate allowed for this quantity (blank = full rate)"></td><td></td>
        <td class="num">${m2(x.amt)}</td><td class="num small muted">${x.part ? `full ${m2(x.full)}` : ""}</td><td><button class="icon danger-text" data-act="delPart" title="Remove this part">×</button></td></tr>`).join("") : ""}
      ${r.withheld > 0.004 ? `<tr class="part-row" data-line="${r.id}"><td></td><td></td><td colspan="8" class="small">At full rate ${m2(r.fullAmt)} · allowed ${m2(r.amt)} · <b class="warn">withheld ${m2(r.withheld)}</b></td><td colspan="3"></td></tr>` : ""}`;
  };
  let i = 0;
  const gRows = k.rows.filter((r) => r.s === "G"), hRows = k.rows.filter((r) => r.s === "H");
  return head + `<div class="card"><h2>${billTitle(p, bill)}</h2>
    ${bill.base ? `<p class="check-line warn">This is the last bill already submitted, entered so the next bill continues from it. Type its up-to-date quantities and rates exactly as in that bill.</p>` : ""}
    <div class="form-grid compact"><label class="field small">Bill No.<input data-b="number" type="number" min="1" value="${billNo(p, bill)}" ${bill.kind === "final" ? "disabled" : ""}></label>${meta("date", "Bill date", "date")}${meta("measured", "Date of measurement")}${meta("mbNo", "M.B. No.")}${meta("mbPages", "M.B. pages")}${meta("jen", "Measured by (JEN)")}${meta("aen", "Checked by (AEN)")}</div>
    <div class="row gap mt"><input type="search" id="billFilter" placeholder="Find an item (e.g. plaster, RCC, silt)" style="max-width:340px"><span class="muted small">MB S.No: the item's serial number in the measurement book / bill; the bill prints in this order.</span></div>
    <div class="table-wrap tall"><table class="data small bill-table"><thead><tr><th>MB S.No</th><th>BOQ No.</th><th>Item</th><th>Unit</th><th class="num">Tender qty</th><th class="num">Prev. qty</th><th class="num">Qty up-to-date (M.B.)</th><th class="num">This bill</th><th class="num">Rate</th><th class="num">Part rate</th><th class="num">Amount up-to-date</th><th class="num">Since previous</th><th class="num">Done</th></tr></thead>
      <tbody><tr class="grp"><td colspan="13"><b>G-Schedule</b> <button class="link small" data-act="addExtra">＋ Extra item</button></td></tr>
      ${gRows.map((r) => row(r, i++)).join("")}
      ${hRows.length ? `<tr class="grp"><td colspan="13"><b>H-Schedule</b></td></tr>${hRows.map((r) => row(r, i++)).join("")}` : ""}</tbody></table></div>
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

/** Removes extra items and every quantity entered against them in the bills. */
function deleteExtras(p, ids) {
  p.extras = p.extras.filter((x) => !ids.includes(x.id));
  for (const b of p.bills) for (const key of ["qty", "parts", "partRate", "mbRefs", "mbs"]) if (b[key]) for (const id of ids) delete b[key][id];
  ids.forEach((id) => view.xsel?.delete(id));
}

function extraView(p, c) {
  const bill = currentBill(p);
  const k = bill ? computeBill(p, bill) : null;
  return `<div class="card"><div class="row between"><h2>Extra items (not in the BOQ)</h2><button class="primary" data-act="addExtra">＋ Extra item</button></div>
    <p class="muted small">Items executed that are not in the tender BOQ. They are billed in the G-Schedule with the tender premium, and their total may not exceed ${num(c.extraLimitPct)}% of the contract value without sanction.</p>
    ${p.extras.length ? `<div class="row gap wrap mb"><label class="check"><input type="checkbox" data-xall ${view.xsel?.size && view.xsel.size === p.extras.length ? "checked" : ""}> Select all</label>
      <button class="ghost danger-text" data-act="delExtraSel" ${view.xsel?.size ? "" : "disabled"}>🗑 Delete selected${view.xsel?.size ? ` (${view.xsel.size})` : ""}</button></div>` : ""}
    <div class="table-wrap"><table class="data"><thead><tr><th></th><th>#</th><th>Description</th><th>Unit</th><th class="num">Rate</th><th class="num">Qty (latest bill)</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${p.extras.map((x, i) => { const r = k?.rows.find((r) => r.id === x.id); return `<tr data-x="${x.id}" class="${view.xsel?.has(x.id) ? "sel-row" : ""}"><td><input type="checkbox" data-xsel ${view.xsel?.has(x.id) ? "checked" : ""}></td><td>${i + 1}</td><td><textarea data-xf="description" rows="2">${esc(x.description)}</textarea></td><td><input data-xf="unit" class="w70" value="${esc(x.unit)}"></td><td><input data-xf="rate" type="number" step="any" class="w100 num" value="${x.rate}"></td><td class="num">${qtyFmt(r?.qty || 0)}</td><td class="num">${m2(r?.amt || 0)}</td><td><button class="ghost small danger-text" data-act="delExtra">🗑 Delete</button></td></tr>`; }).join("") || `<tr><td colspan="8" class="muted pad">No extra items.</td></tr>`}
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
  const d = deviationRows(p), c = contract(p);
  const pct = d.grand.tamt ? (d.grand.amt / d.grand.tamt) * 100 : 0;
  return `<div class="card"><div class="row between wrap"><h2>Deviation statement</h2><div class="row gap"><label class="small muted">Print<select data-c="devOrient" class="ml"><option value="landscape" ${(c.devOrient || "landscape") === "landscape" ? "selected" : ""}>Landscape</option><option value="portrait" ${c.devOrient === "portrait" ? "selected" : ""}>Portrait</option></select></label><button class="ghost" data-print="deviation">Print</button><button class="ghost" data-act="excel">Excel</button></div></div>
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
    const b = { id: uid("bl"), kind: "running", date: new Date().toISOString().slice(0, 10), mbs: { ...(prev?.mbs || {}) }, qty: { ...(prev?.qty || {}) }, partRate: { ...(prev?.partRate || {}) }, parts: structuredClone(prev?.parts || {}), mbRefs: structuredClone(prev?.mbRefs || {}), mbNo: prev?.mbNo || "", jen: prev?.jen || c.jen || "", aen: prev?.aen || c.aen || "" };
    p.bills.push(b); view.billId = b.id; view.tab = "bill";
  }
  if (act === "finalBill" && bill) {
    if (!confirm("Make this the final bill? Everything stays as entered (part rates, previous bill, deductions); only the title becomes “Final Bill”.")) return;
    bill.kind = "final";
  }
  if (act === "runningBill" && bill) bill.kind = "running";
  if (act === "delBill" && bill) {
    if (!confirm(`Delete ${billTitle(p, bill)}?`)) return;
    p.bills.splice(p.bills.indexOf(bill), 1); view.billId = p.bills.at(-1)?.id || "";
  }
  if (act === "mbRefs" && bill) { mbRefsDialog(p, bill, e.target.closest("[data-line]").dataset.line); return; }
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
  if (act === "baseBill") {
    const n = Math.round(num(prompt("Number of the last bill already submitted (e.g. 3 for the 3rd running bill):", "1")));
    if (!(n > 0)) return;
    const b = { id: uid("bl"), kind: "running", number: n, base: true, date: "", qty: {}, partRate: {}, parts: {}, mbs: {}, jen: c.jen || "", aen: c.aen || "" };
    p.bills.push(b); view.billId = b.id;
  }
  if (act === "delWork") { ctx.deleteWork(); return; }
  if (act === "demo") { const d = buildDemoProject(); view.tab = "bill"; view.billId = d.bills.at(-1).id; ctx.addProject(d); return; }
  if (act === "loadBOQ") { pickFiles(".xls,.xlsx,.ods,.csv,.pdf,.docx,image/*", loadBoq); return; }
  if (act === "loadWO") { pickFiles(".pdf,.xls,.xlsx,.docx,.txt,image/*", loadWorkOrder); return; }
  if (act === "addExtra") { addExtraDialog(p); return; }
  if (act === "delExtra" || act === "delExtraLine" || act === "delExtraSel") {
    const ids = act === "delExtraSel" ? [...(view.xsel || [])] : [e.target.closest(act === "delExtra" ? "[data-x]" : "[data-line]").dataset[act === "delExtra" ? "x" : "line"]];
    if (!ids.length) return;
    const names = p.extras.filter((x) => ids.includes(x.id)).map((x) => `• ${x.description.slice(0, 70)}`).join("\n");
    const billed = p.bills.some((b) => ids.some((id) => num(b.qty?.[id]) || b.parts?.[id]?.length || b.mbRefs?.[id]?.length));
    if (!confirm(`Delete ${ids.length} extra item${ids.length > 1 ? "s" : ""}?\n${names}${billed ? "\n\nIts quantities are removed from every bill of this work too." : ""}`)) return;
    deleteExtras(p, ids);
    ctx.toast(`${ids.length} extra item${ids.length > 1 ? "s" : ""} deleted.`);
  }
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
  if (el.matches("[data-xsel]")) { const id = el.closest("[data-x]").dataset.x; el.checked ? view.xsel.add(id) : view.xsel.delete(id); renderBills(); return; }
  if (el.matches("[data-xall]")) { view.xsel = new Set(el.checked ? p.extras.map((x) => x.id) : []); renderBills(); return; }
  if (el.id === "billSel") { view.billId = el.value; renderBills(); return; }
  if (el.id === "photoFile") { addPhotos([...el.files]); el.value = ""; return; }
  if (el.matches("[data-pname]")) { p.name = el.value.trim() || p.name; ctx.saveProject(); return; }
  if (el.dataset.c) c[el.dataset.c] = el.type === "number" ? num(el.value) : el.value;
  else if (el.dataset.b) currentBill(p)[el.dataset.b] = el.dataset.b === "number" ? Math.round(num(el.value)) : el.value;
  else if (el.matches("[data-mbs]")) { const b = currentBill(p); (b.mbs ||= {})[el.closest("[data-line]").dataset.line] = el.value.trim(); ctx.saveProject(); return; }
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
  fitPages($("#printArea"));
  window.print();
}

/** A portrait page that would run past one A4 sheet is scaled down to fit, so no page spills a few lines onto a new sheet. */
function fitPages(area) {
  const MM = 96 / 25.4, LIMIT = 256 * MM;
  const m = document.createElement("div"); m.className = "f-measure"; m.innerHTML = area.innerHTML; document.body.appendChild(m);
  const live = [...area.children], test = [...m.children];
  test.forEach((sec, i) => {
    if (!sec.matches(".p-page") || sec.matches(".p-rot, .d-dev, .p-landscape")) return;
    const h = sec.getBoundingClientRect().height;
    if (h > LIMIT) live[i].style.zoom = (LIMIT / h).toFixed(3);
  });
  m.remove();
}

function printHtml(p, c, bill, kind) {
  let html = "";
  if (kind === "bill" && bill) {
    html = form27g(p, c, bill);
  } else if (kind === "mb" && bill) {
    html = mbAbstract(p, c, bill);
  } else if (kind === "slip" && bill) {
    html = extraSlip(p, c, bill);
  } else if (kind === "deviation") {
    html = deviationSheet(p, c);
  } else if (kind === "photos") {
    const pages = [];
    for (let i = 0; i < p.photos.length; i += 4) pages.push(p.photos.slice(i, i + 4));
    html = pages.map((ph, pi) => `<section class="p-page p-photos p-rot"><div class="p-rot-in"><header class="p-head"><div class="p-org">${esc(c.office || p.client || "")}</div>
        <div><b>Name of work:</b> ${esc(p.name)}</div><div><b>Work order No.:</b> ${esc(c.workOrderNo)} ${c.woDate ? `dated ${esc(c.woDate)}` : ""}${bill ? ` · ${esc(billTitle(p, bill))}` : ""}</div></header>
      <div class="p-photo-grid">${ph.map((x) => `<figure><img src="${x.src}" alt="">${x.caption ? `<figcaption>${esc(x.caption)}</figcaption>` : ""}</figure>`).join("")}</div>
      ${signs(["JEN", "AEN", "XEN"])}<div class="p-pageno">Page ${pi + 1} of ${pages.length}</div></div></section>`).join("");
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

/** Items and header (name of work, department, NIT No.) from BOQ files: NIC .xls, typed or scanned PDF, Excel, Word or photos. */
export async function extractBoq(files, status = () => {}) {
  const items = [], header = {};
  const addHeader = (h) => { for (const [k, v] of Object.entries(h || {})) { const t = String(v || "").replace(/\s+/g, " ").replace(/\s*serial number\s*:?\s*$/i, "").trim(); if (t && !header[k]) header[k] = t; } };
  const nicXls = files.filter((f) => /\.xls$/i.test(f.name));
  for (const f of nicXls) {
    try {
      const buf = await f.arrayBuffer(); const first = readNicBoq(buf);
      const strip = (t) => String(t || "").replace(/^[^:]*:\s*/, "").trim();
      addHeader({ work: strip(first.work), authority: strip(first.authority), contract: strip(first.contract) });
      for (const n of first.sheetNames) {
        const info = readNicBoq(buf, n); const sched = info.boqType === "Percentage" ? "G" : "H";
        info.items.filter((i) => !i.heading).forEach((i) => items.push({ schedule: sched, sno: String(i.sno), description: i.description, quantity: i.qty || 0, unit: i.unit, rate: i.rate || 0 }));
      }
    } catch { items.push(...parseBoqRows((await readDocument([f])).rows)); }
  }
  const rest = files.filter((f) => !nicXls.includes(f));
  if (rest.length) {
    const pdfs = rest.filter((f) => /\.pdf$/i.test(f.name));
    for (const f of pdfs) { status(`Reading ${f.name}…`); const got = await parseNicPdf(f); addHeader(got.header); if (got.length) { items.push(...got); rest.splice(rest.indexOf(f), 1); } }
    if (rest.length) {
      const doc = await readDocument(rest, status);
      addHeader(boqHeader(doc.lines));
      items.push(...(doc.rows.length ? parseBoqRows(doc.rows) : []), ...parseBoqLines(doc.lines));
    }
  }
  status("");
  return { items, header };
}

async function loadBoq(files) {
  if (!files.length) return;
  try {
    const { items, header } = await extractBoq(files, (t) => docStatus(t));
    if (!items.length) { docStatus("No BOQ items could be found. Check that the photo is straight and readable, or type the items.", "err"); return; }
    docStatus("");
    reviewBoq(items, header);
  } catch (e) { console.error(e); docStatus(e.message, "err"); }
}

/** Let the user correct the items read from the BOQ before they are used. */
function reviewBoq(items, header = {}) {
  const p = ctx.project();
  const rows = () => items.map((it, i) => `<tr data-i="${i}"><td><select data-k="schedule"><option ${it.schedule === "G" ? "selected" : ""}>G</option><option ${it.schedule === "H" ? "selected" : ""}>H</option></select></td>
    <td><input data-k="sno" class="w70" value="${esc(it.sno)}"></td><td><textarea data-k="description" rows="2">${esc(it.description)}</textarea></td>
    <td><input data-k="quantity" type="number" step="any" class="w90 num ${num(it.quantity) ? "" : "need"}" value="${it.quantity}"></td><td><input data-k="unit" class="w70 ${String(it.unit).trim() ? "" : "need"}" value="${esc(it.unit)}" placeholder="unit"></td>
    <td><input data-k="rate" type="number" step="any" class="w90 num ${num(it.rate) || it.schedule === "H" ? "" : "need"}" value="${it.rate}"></td><td><button class="icon danger-text" data-del>×</button></td></tr>`).join("");
  const total = () => items.filter((i) => i.schedule === "G").reduce((a, i) => a + round(num(i.quantity) * num(i.rate), 2), 0);
  ctx.modal(`<h2>Check the BOQ items</h2><p class="muted small">${items.length} items read (${items.filter((i) => i.schedule === "G").length} G-Schedule, ${items.filter((i) => i.schedule === "H").length} H-Schedule). Correct anything read wrongly (empty or doubtful cells are highlighted), delete stray lines, then load. <span id="rvTot"></span></p>
    <div class="table-wrap tall"><table class="data small"><thead><tr><th>Sch.</th><th>S.No</th><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th></th></tr></thead><tbody id="rvBody">${rows()}</tbody></table></div>
    <div class="row gap mt"><button class="ghost" id="rvAdd">＋ Add a line</button><button class="primary" id="rvLoad">Load these items</button></div>`, (m) => {
    const tot = () => { $("#rvTot", m).textContent = `G-Schedule total: ${money(total())}`; };
    tot();
    $("#rvBody", m).onchange = (e) => { const tr = e.target.closest("tr"); const k = e.target.dataset.k; if (!k) return; items[+tr.dataset.i][k] = ["quantity", "rate"].includes(k) ? num(e.target.value) : e.target.value; tot(); };
    $("#rvBody", m).onclick = (e) => { if (!e.target.matches("[data-del]")) return; items.splice(+e.target.closest("tr").dataset.i, 1); $("#rvBody", m).innerHTML = rows(); tot(); };
    $("#rvAdd", m).onclick = () => { items.push({ schedule: "G", sno: String(items.length + 1), description: "", quantity: 0, unit: "", rate: 0 }); $("#rvBody", m).innerHTML = rows(); };
    $("#rvLoad", m).onclick = () => {
      const keep = items.filter((i) => String(i.description).trim());
      if (p.sections.some((s) => s.items.length) && !confirm("Replace the BOQ items of this project? Bills already made refer to the old items.")) return;
      const mk = (sched) => ({ id: uid("s"), name: `${sched}-Schedule`, items: keep.filter((i) => i.schedule === sched).map((i) => ({
        id: uid("b"), bsrId: "", code: "", description: i.description, unit: i.unit, qty: num(i.quantity), rate: num(i.rate), measurements: [], schedule: sched, sno: i.sno,
      })) });
      p.sections = [mk("G"), mk("H")].filter((s) => s.items.length);
      p.bills = []; view.billId = "";
      // Name of work, department and NIT No. from the BOQ fill the project, unless already typed in.
      const generic = !p.name || /^(untitled project|my first estimate|imported boq|new project|new work( \(bills\))?)$/i.test(p.name.trim());
      if (header.work && generic) p.name = header.work;
      if (header.authority && !p.client) p.client = header.authority;
      if (header.contract && !p.reference) p.reference = header.contract;
      const cc = contract(p); if (header.authority && !cc.office) cc.office = header.authority;
      applyHRates(p);
      ctx.closeModal(); ctx.saveProject(); renderBills();
      docStatus(`BOQ loaded: ${keep.filter((i) => i.schedule === "G").length} G-Schedule and ${keep.filter((i) => i.schedule === "H").length} H-Schedule items.${checkAmount(p)}`, "ok");
    };
  });
}

/** H-Schedule rates from the work order fill H items that have no rate. */
function applyHRates(p) {
  const c = contract(p); const hr = c.hRates || [];
  const H = p.sections.flatMap((s) => s.items).filter((it) => sched(it) === "H");
  hr.forEach((r, k) => {
    const it = H.find((x) => String(x.sno).replace(/\.0*1$/, "") === String(r.item)) || H[k];
    if (it && !num(it.rate)) it.rate = r.rate;
  });
}
const checkAmount = (p) => {
  const c = contract(p); if (!num(c.woAmount)) return "";
  const v = contractValue(p), d = round(v - num(c.woAmount), 2);
  return Math.abs(d) <= Math.max(1, num(c.woAmount) * 0.0005) ? ` Contract value ${money(v)} matches the work order.` : ` Contract value here ${money(v)}, work order ${money(c.woAmount)} (difference ${money(d)}) — check T.P. and rates.`;
};

async function loadWorkOrder(files) {
  if (!files.length) return;
  try {
    const doc = await readDocument(files, (t) => docStatus(t));
    docStatus("");
    reviewWorkOrder(parseWorkOrder(doc.lines), doc.lines);
  } catch (e) { console.error(e); docStatus(e.message, "err"); }
}

function reviewWorkOrder(w, lines) {
  const p = ctx.project(); const c = contract(p);
  const F = [["contractor", "Name of contractor"], ["workOrderNo", "Work order / agreement No."], ["woDate", "Work order date", "date"], ["office", "Office / department"],
    ["workName", "Name of work"], ["amount", "Work order amount", "number"], ["tpPct", "Tender premium %", "number"], ["commence", "Date of commencement", "date"],
    ["stipulated", "Stipulated date of completion", "date"], ["jen", "JEN"], ["aen", "AEN"], ["xen", "XEN"]];
  ctx.modal(`<h2>Check the work order details</h2><p class="muted small">Read from the document. Correct any value, untick what should not be used, then apply.</p>
    <div class="form-grid">${F.map(([k, l, t]) => `<label class="field"><span><input type="checkbox" data-use="${k}" ${w[k] ? "checked" : ""}> ${l}</span>${k === "workName" ? `<textarea data-w="${k}" rows="3">${esc(w[k] || "")}</textarea>` : `<input data-w="${k}" type="${t || "text"}" value="${esc(w[k] ?? "")}">`}</label>`).join("")}
      <label class="field"><span><input type="checkbox" data-use="tpDir" ${w.tpDir ? "checked" : ""}> T.P. below / above</span><select data-w="tpDir">${["below", "above", "par"].map((d) => `<option ${w.tpDir === d ? "selected" : ""}>${d}</option>`).join("")}</select></label></div>
    ${w.hRates?.length ? `<p class="small"><label class="check"><input type="checkbox" data-use="hRates" checked> H-Schedule rates found: ${w.hRates.map((r) => `item ${esc(r.item)} – ${money(r.rate)}${r.unit ? "/" + esc(r.unit) : ""}`).join(", ")}</label></p>` : ""}
    ${w.terms?.length ? `<p class="small"><label class="check"><input type="checkbox" data-use="terms" checked> ${w.terms.length} terms found</label></p>` : ""}
    <details><summary class="small">Text read from the document</summary><pre class="mono small" style="white-space:pre-wrap;max-height:30vh;overflow:auto">${esc(lines.join("\n"))}</pre></details>
    <button class="primary mt" id="woApply">Apply to this project</button>`, (m) => {
    $("#woApply", m).onclick = () => {
      const use = (k) => $(`[data-use="${k}"]`, m)?.checked;
      const val = (k) => $(`[data-w="${k}"]`, m)?.value ?? "";
      for (const k of ["contractor", "workOrderNo", "woDate", "office", "commence", "stipulated", "jen", "aen", "xen"]) if (use(k)) c[k] = val(k);
      if (use("tpPct")) c.tpPct = num(val("tpPct"));
      if (use("tpDir")) c.tpDir = val("tpDir");
      if (use("amount")) c.woAmount = num(val("amount"));
      if (use("workName") && val("workName").trim()) p.name = val("workName").trim();
      if (use("office") && !p.client) p.client = val("office");
      if (use("hRates")) { c.hRates = w.hRates; applyHRates(p); }
      if (use("terms")) c.terms = w.terms;
      ctx.closeModal(); ctx.saveProject(); renderBills();
      docStatus(`Work order details applied.${checkAmount(p)}`, "ok");
    };
  });
}


/**
 * Items from a GePNIC BOQ printed to PDF (text, not scanned), without AI.
 * Columns are found from the row of column numbers ("1 2 4 5 6 53 55") under the header.
 */
async function parseNicPdf(file) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let cols = null, sched = "G";
  const items = [];
  let cur = null, done = false;
  const pre = [];
  for (let pg = 1; pg <= doc.numPages && !done; pg++) {
    const tc = await (await doc.getPage(pg)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      const t = it.str.trim(); if (!t) continue;
      const y = it.transform[5], x = it.transform[4];
      let r = rows.find((r) => Math.abs(r.y - y) < 3);
      if (!r) rows.push((r = { y, cells: [] }));
      r.cells.push({ x, t });
    }
    rows.sort((a, b) => b.y - a.y).forEach((r) => r.cells.sort((a, b) => a.x - b.x));
    for (const r of rows) {
      const line = r.cells.map((c) => c.t).join(" ");
      if (/Item Rate BoQ/i.test(line)) sched = "H";
      if (/Percentage BoQ/i.test(line)) sched = "G";
      const nums = r.cells.map((c) => c.t);
      if (!cols && nums.length >= 5 && nums[0] === "1" && nums[1] === "2" && nums.includes("4") && nums.includes("5")) {
        const at = (n) => r.cells.find((c) => c.t === n)?.x;
        const c1 = at("1"), c2 = at("2"), c4 = at("4"), c5 = at("5"), c6 = at("6") ?? at("13") ?? c5 + 60;
        cols = { sl: (c1 + c2) / 2, desc: (c2 + c4) / 2, qty: (c4 + c5) / 2, unit: (c5 + c6) / 2, rate: c6 + (c6 - c5) / 2 + 10, slLeft: c1 };
        continue;
      }
      if (!cols) { pre.push(line); continue; }
      if (/^Total in Figures/i.test(line)) { if (cur) items.push(cur); cur = null; done = true; break; }
      const sl = r.cells.find((c) => c.x < cols.slLeft + 25 && /^\d+(\.\d+)*$/.test(c.t));
      const descCells = r.cells.filter((c) => c !== sl && c.x < cols.desc);
      const qtyCell = r.cells.find((c) => c.x >= cols.desc && c.x < cols.qty);
      const unitCell = r.cells.find((c) => c.x >= cols.qty && c.x < cols.unit);
      const rateCell = r.cells.find((c) => c.x >= cols.unit && c.x < cols.rate);
      if (sl) {
        if (cur) items.push(cur);
        const qm = (qtyCell?.t || "").match(/^([\d.,]+)\s*(.*)$/);
        cur = { schedule: sched, sno: sl.t, description: descCells.map((c) => c.t).join(" "), quantity: qm ? num(qm[1]) : 0, unit: (qm?.[2] || unitCell?.t || "").trim(), rate: num(rateCell?.t) };
      } else if (cur && descCells.length) cur.description += " " + descCells.map((c) => c.t).join(" ");
    }
  }
  if (cur) items.push(cur);
  const out = items.map((i) => ({ ...i, description: i.description.replace(/\s+/g, " ").trim() }));
  out.header = boqHeader(pre);
  return out;
}

/** Name of work, tender inviting authority and contract / NIT No. from the lines above a BOQ. */
function boqHeader(lines) {
  const h = {};
  const after = (l) => l.replace(/^[^:]*?(?::-|:|–|-)\s*/, "").trim();
  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const l = String(lines[i] || "").replace(/\s+/g, " ").trim();
    if (!h.work && /name\s+of\s+(the\s+)?work|कार्य\s*का\s*नाम/i.test(l)) {
      let w = after(l);
      if (w.length < 4 && lines[i + 1]) w = String(lines[i + 1]).trim();
      h.work = w;
    } else if (!h.authority && /tender\s+inviting\s+authority|^office\s+of\b|department\s*:/i.test(l)) h.authority = /office\s+of/i.test(l) && !/:/.test(l) ? l : after(l);
    else if (!h.contract && /contract\s*no|n\.?\s*i\.?\s*t\.?\s*no|nit\s*no|tender\s*(id|no)/i.test(l)) h.contract = after(l) || l;
  }
  for (const k of Object.keys(h)) if (!h[k] || h[k].length < 3) delete h[k];
  return h;
}

// ---------------------------------------------------------------------------
// P.W.A. Form 27G, laid out like the department's printed bills
// ---------------------------------------------------------------------------

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const romanOrd = (n) => (ROMAN[n] || String(n)) + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
const formTitle = (p, b) => (b.kind === "final" ? "Final Bill" : `${romanOrd(billNo(p, b))} Running Bill`);
const n2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const q3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

function form27g(p, c, bill) {
  const k = computeBill(p, bill);
  const idx = p.bills.indexOf(bill);
  const prevBill = idx > 0 ? p.bills[idx - 1] : null;
  const pk = prevBill ? computeBill(p, prevBill) : { gTotal: 0, tp: 0, gNet: 0, hTotal: 0, total: 0 };
  const mbs = bill.mbs || {};
  const mbKey = (r) => (mbs[r.id] !== undefined && mbs[r.id] !== "" ? num(mbs[r.id]) : 1e9);
  const byMb = (arr) => arr.map((r, i) => [r, i]).sort((a, b) => mbKey(a[0]) - mbKey(b[0]) || a[1] - b[1]).map((x) => x[0]);
  const used = (r) => r.qty || r.prevQty;
  let serial = 0;

  // One item: unit, quantities, rate and amounts sit at the foot of the description, as in the printed bills.
  const itemRow = (r) => {
    const boqNo = r.extra ? "Ex" : r.s === "H" ? esc(String(r.no).replace(/\.0*1$/, "")) : esc(r.no);
    const no = `${mbs[r.id] ? esc(mbs[r.id]) : ++serial}/${boqNo}`;
    const raw = String(bill.qty[r.id] ?? "");
    let parts = r.parts ? r.parts.map((x) => ({ qty: x.qty, rate: x.rate, amt: x.amt }))
      : raw.includes("@") ? raw.split("+").map((x) => { const [q, rr] = x.split("@"); const rate = rr && rr.trim() ? num(rr) : r.rate; return { qty: num(q), rate, amt: round(num(q) * rate, 2) }; })
      : [{ qty: r.qty, rate: r.applied, amt: r.amt }];
    const prevShare = r.prevQty; // since-last quantity shown on the first line
    const showFull = parts.some((x) => Math.abs(x.rate - r.rate) > 0.004);
    const sinceAmt = r.since;
    const units = parts.map(() => esc(r.unit)).join("<br>");
    const qSince = parts.map((x, i) => (parts.length === 1 ? q3(round(r.qty - prevShare, 3)) : q3(x.qty))).join("<br>");
    const qUpto = parts.map((x) => q3(x.qty)).join("<br>");
    const rates = parts.map((x) => n2(x.rate)).join("<br>") + (showFull ? `<div class="f-full">${n2(r.rate)}</div>` : "");
    const amts = parts.map((x) => n2(x.amt)).join("<br>");
    const since = parts.length > 1 && !r.prevQty ? amts : n2(sinceAmt);
    return { lines: Math.max(2, Math.ceil((r.desc.length + 8) / 52)) + parts.length - 1, a6: r.amt, a7: sinceAmt,
      html: `<tr class="f-item"><td class="b">${units}</td><td class="b r">${qSince}</td><td class="b r">${qUpto}</td>
        <td class="f-desc"><span class="f-no">${no}</span><span class="f-text">${esc(r.desc)}</span></td>
        <td class="b r">${rates}</td><td class="b r">${amts}</td><td class="b r">${since}</td><td></td></tr>` };
  };
  const box = (label, a, b, cls = "") => ({ lines: 2, html: `<tr class="f-tot ${cls}"><td></td><td></td><td></td><td class="f-lbl">${label}</td><td></td><td class="r f-box">${n2(a)}</td><td class="r f-box">${b === "" ? "" : n2(b)}</td><td></td></tr>` });
  const text = (h, lines = 1) => ({ lines, html: `<tr><td></td><td></td><td></td><td class="f-desc">${h}</td><td></td><td></td><td></td><td></td></tr>` });

  const seq = [];
  byMb(k.gRows.filter(used)).forEach((r) => seq.push(itemRow(r)));
  // TOTAL … GRAND TOTAL stay together on one page, as in the printed bills.
  seq.push({ kind: "totals", html: [text("&nbsp;"), box("TOTAL", k.gTotal, round(k.gTotal - pk.gTotal, 2)), box(esc(tpLabel(c)), k.tp, round(k.tp - pk.tp, 2)),
    box("TOTAL G-SCHEDULE", k.gNet, round(k.gNet - pk.gNet, 2)), box("GRAND TOTAL -", k.gNet, round(k.gNet - pk.gNet, 2), "f-grand")].map((x) => x.html).join("") });
  if (k.hRows.some(used)) {
    seq.push(text("<b>H-Schedule</b>"));
    serial = 0; // H-Schedule items are numbered afresh (1/1, 2/2 …)
    byMb(k.hRows.filter(used)).forEach((r) => seq.push({ ...itemRow(r), a6: 0, a7: 0 }));
  }
  seq.push({ kind: "cert", ...text(`<div class="f-cert"><u><b>Certificate :-</b></u><br>1. Work is satisfactory and as per specifications and G-Schedule.<br>2. Nothing outstanding against contractor regarding this bill.</div>`, 4) });

  const thead = `<thead><tr><th rowspan="2" class="f-unit">Unit</th><th rowspan="2" class="f-rot"><div>Quantity executed (or supplied) since last certificate</div></th><th rowspan="2" class="f-rot"><div>Quantity executed (or supplied up-to-date as per Measurement Book)</div></th>
    <th rowspan="2">Item of work Supplies (grouped under "sub-heads" and "sub-work" of estimate)</th><th rowspan="2">Rate in Rs.</th><th colspan="2">AMOUNT</th><th rowspan="2" class="f-rot f-rem"><div>Remarks</div></th></tr>
    <tr><th>% up-to-date</th><th>Since previous bill Total for each sub-head</th></tr>
    <tr class="f-colno"><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td><td>8</td></tr></thead>`;
  const cols = `<colgroup><col style="width:6%"><col style="width:8%"><col style="width:8%"><col style="width:41%"><col style="width:9%"><col style="width:12%"><col style="width:12%"><col style="width:4%"></colgroup>`;
  const tail = `<tr class="f-sum"><td colspan="5">Total value of work done or supplies made to date.........</td><td class="r"><b>${n2(k.total)}</b></td><td class="r"><b>${n2(round(k.total - k.prevTotal, 2))}</b></td><td></td></tr>
    <tr class="f-sum"><td colspan="5">Deduct value of work of supplies shown in previous bill</td><td class="r">${k.prevTotal ? n2(k.prevTotal) : ""}</td><td></td><td></td></tr>
    <tr class="f-sum"><td colspan="5">Net value of work or supplies since previous bill figures in words.</td><td class="r"><b>${n2(k.net)}</b></td><td></td><td></td></tr>
    <tr class="f-sum"><td colspan="5" class="r">SAY</td><td class="r"><b>${n2(k.say)}</b></td><td></td><td></td></tr>`;
  const head = `<div class="f-formno">P.W.A. FORM No. 27G<br>Sec. Chap. XIV. Paras 440, 444 &amp; 445</div>
    <div class="f-note">Final Payment must invariably be made on forms Printed on yellow paper which should not be used to intermediated Payment</div>
    <div class="f-title">${esc(formTitle(p, bill))}</div>
    <div class="f-sub">(For contractors &amp; Suppliers only for Payment for works or suppliers actually measured)</div>
    <table class="f-head"><tr><td><b>Cash Book Voucher No. :</b> ${esc(bill.voucher || "")}</td><td class="r"><b>Dated :</b> ${fd(bill.date)}<span class="f-blank"></span></td></tr>
      <tr><td colspan="2">Name of Contractor or supplier : <b>${esc((c.contractor || "").toUpperCase())}</b></td></tr>
      <tr><td colspan="2">*Name of Work :- ${esc(p.name)}</td></tr></table>
    <table class="f-fields">
      <tr><td>Serial No. of this Bill</td><td>: ${esc(formTitle(p, bill))}</td></tr>
      <tr><td>No. &amp; date of his last Bill for this work</td><td>: ${prevBill ? `${esc(formTitle(p, prevBill))}${prevBill.date ? ` dt. ${fd(prevBill.date)}` : ""}` : ""}</td></tr>
      <tr><td>Reference to work Order of Agreement</td><td>: ${esc(c.workOrderNo)}${c.woDate ? ` date ${fd(c.woDate)}` : ""}</td></tr>
      <tr><td>Date of written order to commence work</td><td>: ${fd(c.commence)}</td></tr>
      <tr><td>Stipulated date of completion of work</td><td>: ${fd(c.stipulated)}</td></tr>
      <tr><td>Date of actual completion of work</td><td>: ${c.completed ? fd(c.completed) : "W.I.P."}</td></tr>
      <tr><td>Date of measurements</td><td>: ${fd(bill.measured)}</td></tr></table>
    <div class="f-acc">A-ACCOUNT OF WORK OR SUPPLIES</div>`;
  // Measure the real printed height of every part, then fill each A4 page as far as it goes.
  const MM = 96 / 25.4, PAGE = 258 * MM; // a little under the 269 mm A4 print area, so every browser (Safari too) keeps each page on one sheet
  const m = document.createElement("div");
  m.className = "f27 f-measure";
  const bfRow = `<tr class="f-bf m-bf"><td></td><td></td><td></td><td class="r"><b>B/F</b></td><td></td><td class="r">0.00</td><td class="r">0.00</td><td></td></tr>`;
  const coRow = `<tr class="f-co m-co"><td></td><td></td><td></td><td class="c"><b><u>Carried Over..............................</u></b></td><td></td><td class="r">0</td><td class="r">0</td><td></td></tr>`;
  m.innerHTML = `<div class="m-head">${head}</div><table class="f-table">${cols}${thead}<tbody>${bfRow}
    ${seq.map((x, i) => x.html.replace(/<tr/g, `<tr data-mi="${i}"`)).join("")}${coRow}${tail.replace(/<tr/g, '<tr data-tail="1"')}</tbody></table>
    <div class="m-foot f-foot">The full Name of the work as given in the estimate should be entered here.<br>If the outlay on the work is recorded by sub-headed should be shown in col. 6 and against this total there should</div>
    <div class="m-note f-note">be an entry in column 7 also. In no other case should any entries be made in column 7.</div><div class="m-cert">${certificateBlock(c, bill)}</div><div class="f-pg m-pg">1</div>`;
  document.body.appendChild(m);
  const h = (sel) => m.querySelector(sel)?.getBoundingClientRect().height || 0;
  const H = { head: h(".m-head"), thead: h("thead"), bf: h(".m-bf"), co: h(".m-co"), foot: h(".m-foot"), note: h(".m-note"), cert: h(".m-cert"), pg: h(".m-pg") + 8 };
  H.tail = [...m.querySelectorAll("[data-tail]")].reduce((a, r) => a + r.getBoundingClientRect().height, 0);
  seq.forEach((x, i) => { x.h = [...m.querySelectorAll(`[data-mi="${i}"]`)].reduce((a, r) => a + r.getBoundingClientRect().height, 0) || 14; });
  m.remove();
  // Room for rows on a page: "mid" pages end with Carried Over, the last page with the totals and certificate.
  const roomMid = (first) => PAGE - (first ? H.head + H.foot : H.note + H.bf) - H.thead - H.co - H.pg;
  const roomLast = (first) => PAGE - (first ? H.head : H.note + H.bf) - H.thead - H.tail - H.cert - H.pg;
  const pages = [[]], carry = [];
  let s6 = 0, s7 = 0, i = 0;
  while (i < seq.length) {
    const first = pages.length === 1;
    const rest = seq.slice(i).reduce((a, y) => a + y.h, 0);
    if (rest <= roomLast(first)) { pages.at(-1).push(...seq.slice(i)); break; }
    let used = 0;
    while (i < seq.length && (used + seq[i].h <= roomMid(first) || !pages.at(-1).length)) {
      pages.at(-1).push(seq[i]); used += seq[i].h; s6 += seq[i].a6 || 0; s7 += seq[i].a7 || 0; i++;
    }
    if (i < seq.length) { carry.push([s6, s7]); pages.push([]); }
  }
  const filler = (px, diagonal) => px > 2 ? `<tr class="f-fill"><td style="height:${px.toFixed(1)}px"></td><td></td><td></td><td></td><td></td>${diagonal ? `<td colspan="2" class="f-diag"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="8" y1="0" x2="92" y2="100" stroke="#000" stroke-width="0.6" vector-effect="non-scaling-stroke"/></svg></td>` : "<td></td><td></td>"}<td></td></tr>` : "";
  const out = pages.map((pg, pi) => {
    const last = pi === pages.length - 1;
    if (last) {
      const spare = Math.max(0, roomLast(pages.length === 1) - pg.reduce((a, y) => a + y.h, 0) - 4);
      const ti = pg.findIndex((x) => x.kind === "totals"), ci = pg.findIndex((x) => x.kind === "cert");
      pg = pg.map((x, i) => ({ ...x, html: (i === ti && ti > 0 ? filler(spare * 0.3, false) : "") + (i === ci ? filler(spare * (ti > 0 ? 0.7 : 1), true) : "") + x.html }));
    }
    const bf = pi ? `<tr class="f-bf"><td></td><td></td><td></td><td class="r"><b>B/F</b></td><td></td><td class="r">${n2(carry[pi - 1][0])}</td><td class="r">${n2(carry[pi - 1][1])}</td><td></td></tr>` : "";
    const midFill = !last ? filler(Math.max(0, roomMid(pi === 0) - pg.reduce((a, y) => a + y.h, 0) - 4), false) : "";
    const co = !last ? midFill + `<tr class="f-co"><td></td><td></td><td></td><td class="c"><b><u>Carried Over..............................</u></b></td><td></td><td class="r"><b>${n2(carry[pi][0])}</b></td><td class="r"><b>${n2(carry[pi][1])}</b></td><td></td></tr>` : "";
    return `<section class="p-page f27">${pi ? (pi === 1 ? `<div class="f-note">be an entry in column 7 also. In no other case should any entries be made in column 7.</div>` : "") : head}
      <table class="f-table">${cols}${thead}<tbody>${bf}${pg.map((x) => x.html).join("")}${co}${last ? tail : ""}</tbody></table>
      ${pi === 0 && !last ? `<div class="f-foot">The full Name of the work as given in the estimate should be entered here.<br>If the outlay on the work is recorded by sub-headed should be shown in col. 6 and against this total there should</div>` : ""}
      ${last ? certificateBlock(c, bill) : ""}<div class="f-pg">${pi + 1}</div></section>`;
  }).join("");
  return out + memorandum(p, c, bill, k, prevBill, pages.length + 1);
}

function certificateBlock(c, bill) {
  const line = (v, w = 160) => `<span class="f-line" style="min-width:${w}px">${esc(v || "")}</span>`;
  return `<div class="f-cert2"><div class="f-acc">II-CERTIFICATE AND SIGNATURE</div>
    <p>(1) The measurements were made by ${line((bill.jen || c.jen || "") + " JEN", 170)} on ${line(fd(bill.measured), 170)} and</p>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;as recorded at Page ${line(bill.mbPages, 90)} of Measurements Book No ${line(bill.mbNo, 170)} and were checked by</p>
    <p>&nbsp;&nbsp;&nbsp;&nbsp;(Names) ${line(`Sh. ${bill.aen || c.aen || ""}&nbsp;&nbsp;&nbsp;&nbsp; AEN`.replace(/&nbsp;/g, " "), 200)} on ${line("", 120)}.</p>
    <p>(2) The connected measurement have been closed of against bill.</p>
    <div class="f-signs"><div><p>Dated Signature of Office Preparing the bill.</p><p class="f-gap">Dated Left-Hand Thumb Impression or</p><p class="c">Dated Signature of</p></div>
      <div class="f-rank"><p>Rank.......................................</p><p>Sub-division..............................</p><p>Division...................................</p></div></div></div>`;
}

function memorandum(p, c, bill, k, prevBill, pageNo) {
  // Printed blank, as in the department's bills: the accounts office fills it in.
  return `<section class="p-page f27 f-memo2">
    <table class="m-tab"><colgroup><col style="width:30%"><col style="width:31%"><col style="width:13%"><col style="width:13%"><col style="width:3%"><col style="width:10%"></colgroup>
      <tr><td colspan="5" class="c m-title">III-MEMORANDUM OF PAYMENT</td><td class="m-rs c">Rs.</td></tr>
      <tr><td colspan="5">1. Total value of work done as per account 1 Cols 6 or 7.</td><td class="m-rs"></td></tr>
      <tr><td colspan="2">2. Deduct amount with held..............</td><td colspan="2" class="c">Rs.</td><td></td><td class="m-rs"></td></tr>
      <tr><td class="m-left m-abs">FIGURES FOR WORK<br>ABSTRACT</td><td class="m-mid m-top">(a) From previous bills, as<br>&nbsp;&nbsp;&nbsp;per last running account<br>&nbsp;&nbsp;&nbsp;bill &nbsp;&nbsp;...... &nbsp;&nbsp;&nbsp;.......<br>(b) From this bill .....</td><td class="m-box"></td><td class="m-box"></td><td></td><td class="m-rs"></td></tr>
      <tr><td class="m-left"></td><td class="m-mid" colspan="3">3. Balance "up-to-date payment items (1__)<br>4. Total amount of payments already made as per last<br>&nbsp;&nbsp;&nbsp;running account Bill No. &nbsp;&nbsp;&nbsp;&nbsp;Vr.No. &nbsp;&nbsp;&nbsp;&nbsp;Dt.<div class="r" style="margin-right:12%">Rs.</div></td><td></td><td class="m-rs"></td></tr>
      <tr><td class="m-left"></td><td class="m-mid m-bot">(a) By recovery of amount<br>&nbsp;&nbsp;&nbsp;creditable this work.<br>(b) By rcovery of amount<br>&nbsp;&nbsp;&nbsp;creditable to other work<br>&nbsp;&nbsp;&nbsp;or heads of account.....<br>(c) By cheque ... .... ....<br>(d) By cash &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ....</td><td class="m-box m-box2"></td><td class="m-box m-box2"></td><td></td><td class="m-rs"></td></tr>
      <tr class="m-totrow"><td></td><td class="m-mid">Total of 2(b), 5, (a to d)<br>[in figures</td><td colspan="2">] in words</td><td></td><td class="m-rs"></td></tr></table>
    <div class="m-pay">Pay Rs.</div>
    <div class="f-r"><span class="f-over">Cheque<br>Cash</span></div>
    <div class="f-r m-line">Dated initials of Disbursing Officer</div>
    <div class="f-row3 m-line"><span>Received Rs.</span><span>[In figures</span><span>] in words</span><span>Amount in Vernacular</span></div>
    <p>demand for this work of supplies made</p><p style="margin-left:15mm">Dated the.............................</p>
    <p class="c">Left hand-thumb impression of</p>
    <div class="f-row2 m-line"><span>Witness of Identification and Payment</span><span>Full Signature of Contractor</span></div>
    <p>Paid by me vide Cheque No.................... Dated the ............... or cash book entry dated........................</p>
    <div class="f-r" style="margin-top:12mm"><b>CASHIER</b></div><div class="c m-line" style="margin-left:30%">Dated initials of person actually making payment</div>
    <div class="f-small m-line">The figures should be tested to see that it agrees with the total of items 4 and 5.<br>Here specify the net amount payable vide item 5 [0] and &nbsp;[d]<br>The payee's acknowledgement should before the gross amount paid as item (I.e. to d).<br>Payment should be attested by some known person when the payee's acknowledgement is given Not required in the cast of bill of suppliers.</div>
    <div class="f-small c">This space is reserved for any remarks which the Disbursing Officer of the Division Officer may]<br>wish to record in respect of the work check of measurements of the contractor's account.</div>
    ${(c.terms || []).length ? `<div class="f-acc">TERMS AND CONDITIONS OF THE WORK ORDER</div><ol class="p-terms">${c.terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}
    <div class="f-pg">${pageNo}</div></section>`;
}

// ---------------------------------------------------------------------------
// Extra item slip and deviation statement in the department's printed layout
// ---------------------------------------------------------------------------

const officeLine = (c, p) => (c.office || p.client || "").toUpperCase();
const signRow = (c, p) => {
  const o = officeLine(c, p).replace(/^(THE\s+)?/, "");
  return `<div class="d-signs">${["JUNIOR ENGINEER", "ASSISTANT ENGINEER", "EXECUTIVE ENGINEER"].map((t) => `<div>${t},<br>${esc(o)}</div>`).join("")}</div>`;
};

function extraSlip(p, c, bill) {
  const k = computeBill(p, bill);
  const ex = k.rows.filter((r) => r.extra);
  const tpAmt = round(k.extraNet - k.extraGross, 2);
  return `<section class="p-page f27 d-slip">
    <div class="d-office">OFFICE OF THE ${esc(officeLine(c, p))}</div>
    <div class="d-title">EXTRA ITEM SLIP</div>
    <table class="d-fields"><tr><td>Name of Work</td><td>:</td><td class="d-work">${esc(p.name)}</td></tr>
      <tr><td>Contract Document No.</td><td>:</td><td>${esc(c.workOrderNo)}${c.woDate ? ` Dated ${fd(c.woDate)}` : ""}</td></tr>
      <tr><td>Name of Contractor</td><td>:</td><td><b>${esc(c.contractor)}</b></td></tr></table>
    <table class="d-grid"><colgroup><col style="width:7%"><col style="width:43%"><col style="width:10%"><col style="width:8%"><col style="width:10%"><col style="width:12%"><col style="width:10%"></colgroup>
      <thead><tr><th>S.No.</th><th>Details</th><th colspan="2">Quantity</th><th>Rate</th><th>Amount</th><th>Remarks</th></tr></thead><tbody>
      ${ex.map((r, i) => `<tr><td class="c bot">${i + 1}</td><td class="j">${esc(r.desc)}</td><td class="c mid"><b>${n2(r.qty)}</b></td><td class="c mid"><b>${esc(r.unit)}</b></td><td class="c mid"><b>${n2(r.applied)}</b></td><td class="r bot">${n2(r.amt)}</td><td></td></tr>`).join("")}
      <tr><td></td><td>Total :</td><td></td><td></td><td></td><td class="r">${n2(k.extraGross)}</td><td></td></tr>
      <tr><td></td><td><b>${esc(tpLabel(c))}</b></td><td></td><td></td><td></td><td class="r">${n2(Math.abs(tpAmt))}</td><td></td></tr>
      <tr><td></td><td><b>G/Total :</b></td><td></td><td></td><td></td><td class="r"><b>${n2(k.extraNet)}</b></td><td></td></tr></tbody></table>
    ${signRow(c, p)}</section>`;
}

function deviationSheet(p, c) {
  const d = deviationRows(p);
  const v = (x) => (x ? n2(x) : "");
  const row = (r, i) => `<tr><td class="c">${i + 1}</td><td class="j">${esc(r.desc)}</td><td class="r">${q3(r.extra ? 0 : r.tqty)}</td><td class="c">${esc(r.unit)}</td><td class="r">${q3(r.rate)}</td><td class="r">${n2(r.tamt)}</td>
    <td class="r">${q3(r.qty)}</td><td class="c">${esc(r.unit)}</td><td class="r">${q3(r.applied)}</td><td class="r">${n2(r.amt)}</td><td class="r">${v(r.excess)}</td><td class="r">${v(r.extraAmt)}</td><td class="r">${v(r.saving)}</td><td></td></tr>`;
  const tot = (label, o, bold) => `<tr class="${bold ? "d-b" : ""}"><td></td><td class="r">${label}</td><td></td><td></td><td></td><td class="r">${n2(o.tamt)}</td><td></td><td></td><td></td><td class="r">${n2(o.amt)}</td><td class="r">${n2(o.excess)}</td><td class="r">${n2(o.extraAmt)}</td><td class="r">${n2(o.saving)}</td><td></td></tr>`;
  const head = `<div class="d-title">DEVIATION STATEMENT</div>
    <table class="d-fields"><tr><td>Name of Work :</td><td></td><td class="d-work">${esc(p.name)}</td></tr>
      <tr><td>Name of Agency</td><td></td><td>${esc(c.contractor)}</td></tr>
      <tr><td>Aggrement No.</td><td></td><td>${esc(c.workOrderNo)}${c.woDate ? ` Dated ${fd(c.woDate)}` : ""}</td></tr></table>`;
  const colgroup = `<colgroup><col style="width:3%"><col style="width:23%"><col style="width:6%"><col style="width:4%"><col style="width:6.5%"><col style="width:8%"><col style="width:6%"><col style="width:4%"><col style="width:6.5%"><col style="width:8%"><col style="width:6.5%"><col style="width:6.5%"><col style="width:7.5%"><col style="width:4.5%"></colgroup>`;
  const thead = `<thead><tr><th rowspan="2">S.<br>No.</th><th rowspan="2">Particular</th><th colspan="4">As per "G" Schedule</th><th colspan="4">As per Actual Executed of work</th><th colspan="3">Amount</th><th rowspan="2">Remarks</th></tr>
      <tr><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th><th>Excess</th><th>Extra</th><th>Saving</th></tr></thead>`;
  const rows = [...d.G.map(row), tot("Total", d.gT, true) + tot(esc(tpLabel(d.c).replace(/^Less T\.P\. ([\d.]+)% Below$/, "Less: $1% as per T.P.")), d.gTp) + tot("G. Total", d.gNet, true),
    ...(d.H.length ? [`<tr class="d-b"><td></td><td>H-Schedule</td><td colspan="12"></td></tr>`, ...d.H.map((r, i) => row(r, i)), tot("Total", d.grand, true)] : [])];
  const signs = `<div class="d-signs d-signs3">${["Junior Engineer", "Assistant Engineer", "Executive Engineer,"].map((t) => `<div>${t}<br>${esc((c.office || p.client || "").replace(/^.*?(Corporation|Nigam)/i, "Nagar Nigam"))}</div>`).join("")}</div>`;
  const table = (body) => `<table class="d-grid">${colgroup}${thead}<tbody>${body}</tbody></table>`;
  if ((c.devOrient || "landscape") === "portrait") return `<section class="p-page f27 d-dev">${head}${table(rows.join(""))}${signs}</section>`;
  // Landscape on every browser: each page is laid out landscape and turned on the portrait A4 sheet
  // (Safari / iPad ignore landscape page settings). Rows are measured so that each sheet is filled.
  const MM = 96 / 25.4, PAGE = 166 * MM;
  const m = document.createElement("div");
  m.className = "f27 d-dev f-measure"; m.style.width = "242mm";
  m.innerHTML = `<div class="m-h">${head}</div><table class="d-grid">${colgroup}${thead}<tbody>${rows.map((r, i) => r.replace(/<tr/g, `<tr data-ri="${i}"`)).join("")}</tbody></table><div class="m-s">${signs}</div>`;
  document.body.appendChild(m);
  const hgt = (el) => el?.getBoundingClientRect().height || 0;
  const H = { head: hgt(m.querySelector(".m-h")), thead: hgt(m.querySelector("thead")), signs: hgt(m.querySelector(".m-s")) };
  const rh = rows.map((_, i) => [...m.querySelectorAll(`[data-ri="${i}"]`)].reduce((a, el) => a + hgt(el), 0) || 14);
  m.remove();
  const pages = [[]]; let used = H.head + H.thead;
  rows.forEach((r, i) => {
    if (used + rh[i] > PAGE && pages.at(-1).length) { pages.push([]); used = H.thead; }
    pages.at(-1).push(r); used += rh[i];
  });
  if (used + H.signs > PAGE) pages.push([]);
  return pages.map((pg, pi) => `<section class="p-page p-rot d-rot"><div class="p-rot-in f27 d-dev">${pi ? "" : head}${pg.length ? table(pg.join("")) : ""}${pi === pages.length - 1 ? signs : ""}
    <div class="d-pg">Page ${pi + 1} of ${pages.length}</div></div></section>`).join("");
}

// ---------------------------------------------------------------------------
// Measurement book references: quantity of an item built up from M.B. pages
// ---------------------------------------------------------------------------

function mbRefsDialog(p, bill, id) {
  const line = lines(p).find((l) => l.id === id); if (!line) return;
  bill.mbRefs ||= {};
  const refs = (bill.mbRefs[id] ||= []).map((x) => ({ ...x }));
  if (!refs.length) {
    const cur = computeBill(p, bill).rows.find((r) => r.id === id);
    refs.push({ page: "", qty: cur?.qty || "", rate: "" });
  }
  const body = () => refs.map((x, i) => `<tr data-i="${i}"><td><input data-k="page" class="w120" value="${esc(x.page ?? "")}" placeholder="e.g. 10/02"></td>
    <td><input data-k="qty" type="number" step="any" class="w120 num" value="${x.qty ?? ""}"></td>
    <td><input data-k="rate" type="number" step="any" class="w100 num" value="${x.rate ?? ""}" placeholder="${m2(line.rate)}"></td>
    <td class="num">${m2(round(num(x.qty) * (x.rate === "" || x.rate == null ? line.rate : num(x.rate)), 2))}</td><td><button class="icon danger-text" data-del>×</button></td></tr>`).join("");
  const total = () => `Total → <b>${qtyFmt(round(refs.reduce((a, x) => a + num(x.qty), 0), 3))} ${esc(line.unit)}</b> = <b>${m2(round(refs.reduce((a, x) => a + round(num(x.qty) * (x.rate === "" || x.rate == null ? line.rate : num(x.rate)), 2), 0), 2))}</b>`;
  ctx.modal(`<h2>M.B. references</h2><p class="small">${esc(line.no)} · ${esc(line.desc.slice(0, 160))}</p>
    <p class="muted small">One line per measurement book page: "Qty B/F this M.B. page no. …". The total becomes the up-to-date quantity. Give a rate only where the engineer allowed a part rate (blank = full rate ${m2(line.rate)}).</p>
    <table class="data"><thead><tr><th>M.B. page no.</th><th>Quantity (${esc(line.unit)})</th><th>Rate</th><th class="num">Amount</th><th></th></tr></thead><tbody id="mbBody">${body()}</tbody></table>
    <p id="mbTot" class="mt">${total()}</p>
    <div class="row gap"><button class="ghost" id="mbAdd">＋ M.B. page</button><button class="primary" id="mbSave">Save</button><button class="ghost danger-text" id="mbClear">Remove references</button></div>`, (m) => {
    $("#mbBody", m).oninput = (e) => { const tr = e.target.closest("tr"); const k = e.target.dataset.k; refs[+tr.dataset.i][k] = k === "page" ? e.target.value : e.target.value === "" ? "" : num(e.target.value); $("#mbTot", m).innerHTML = total(); };
    $("#mbBody", m).onclick = (e) => { if (!e.target.matches("[data-del]")) return; refs.splice(+e.target.closest("tr").dataset.i, 1); $("#mbBody", m).innerHTML = body(); $("#mbTot", m).innerHTML = total(); };
    $("#mbAdd", m).onclick = () => { refs.push({ page: "", qty: "", rate: "" }); $("#mbBody", m).innerHTML = body(); $("#mbBody tr:last-child [data-k=page]", m)?.focus(); };
    $("#mbSave", m).onclick = () => {
      const keep = refs.filter((x) => num(x.qty));
      if (keep.length) { bill.mbRefs[id] = keep; delete bill.qty[id]; if (bill.parts) delete bill.parts[id]; if (bill.partRate) delete bill.partRate[id]; }
      else delete bill.mbRefs[id];
      ctx.closeModal(); ctx.saveProject(); renderBills();
    };
    $("#mbClear", m).onclick = () => {
      const q = round(refs.reduce((a, x) => a + num(x.qty), 0), 3);
      delete bill.mbRefs[id]; bill.qty[id] = q;
      ctx.closeModal(); ctx.saveProject(); renderBills();
    };
  });
}

/** "Abstract of cost" as written at the end of the measurement book. */
function mbAbstract(p, c, bill) {
  const k = computeBill(p, bill);
  const mbs = bill.mbs || {};
  const key = (r) => (mbs[r.id] !== undefined && mbs[r.id] !== "" ? num(mbs[r.id]) : 1e9);
  const order = (arr) => arr.filter((r) => r.qty).map((r, i) => [r, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map((x) => x[0]);
  let n = 0;
  const item = (r) => {
    const refs = bill.mbRefs?.[r.id]?.filter((x) => num(x.qty)) || [];
    const no = mbs[r.id] || ++n;
    const short = r.desc.length > 140 ? r.desc.slice(0, 140).replace(/\s+\S*$/, "") + " -do-" : r.desc;
    const qtyLines = refs.length ? refs.map((x) => `<tr><td></td><td>Qty B/F this M.B. page no. ${esc(x.page || "....")}</td><td class="r">${q3(num(x.qty))} ${esc(r.unit)}</td><td></td></tr>`).join("") +
      (refs.length > 1 ? `<tr><td></td><td class="r">Total</td><td class="r f-u">${q3(r.qty)} ${esc(r.unit)}</td><td></td></tr>` : "")
      : `<tr><td></td><td>Qty as per M.B.</td><td class="r">${q3(r.qty)} ${esc(r.unit)}</td><td></td></tr>`;
    const groups = r.parts || [{ qty: r.qty, rate: r.applied, amt: r.amt }];
    const rateLines = groups.map((g) => `<tr><td></td><td class="r">${q3(g.qty)} ${esc(r.unit)} @ ${n2(g.rate)}${Math.abs(g.rate - r.rate) > 0.004 ? ` / ${n2(r.rate)}` : ""} per ${esc(r.unit)}</td><td></td><td class="r">${n2(g.amt ?? round(g.qty * g.rate, 2))}</td></tr>`).join("");
    return `<tr class="mb-item"><td class="c"><span class="mb-no">${esc(no)}</span>${r.extra ? "<br><small>Extra</small>" : ""}</td><td colspan="3"><u>${esc(short)}</u></td></tr>${qtyLines}${rateLines}`;
  };
  const G = order(k.gRows), H = order(k.hRows);
  return `<section class="p-page f27 mb-abs"><div class="d-title">ABSTRACT OF COST (AS PER M.B.)</div>
    <table class="d-fields"><tr><td>Name of Work</td><td>:</td><td>${esc(p.name)}</td></tr><tr><td>Agency</td><td>:</td><td>${esc(c.contractor)}</td></tr>
      <tr><td>Ref. W.O. &amp; Date</td><td>:</td><td>${esc(c.workOrderNo)}${c.woDate ? ` dt. ${fd(c.woDate)}` : ""}</td></tr><tr><td>Bill</td><td>:</td><td>${esc(formTitle(p, bill))}${bill.mbNo ? ` · M.B. No. ${esc(bill.mbNo)}` : ""}${bill.mbPages ? `, pages ${esc(bill.mbPages)}` : ""}</td></tr></table>
    <table class="mb-tab"><colgroup><col style="width:7%"><col style="width:55%"><col style="width:18%"><col style="width:20%"></colgroup><tbody>
      ${G.map(item).join("")}
      <tr class="mb-tot"><td></td><td class="r">Total</td><td></td><td class="r">${n2(k.gTotal)}</td></tr>
      <tr><td></td><td class="r">${esc(tpLabel(c))}</td><td></td><td class="r">${n2(k.tp)}</td></tr>
      <tr class="mb-tot"><td></td><td class="r">Total (A) G-Schedule</td><td></td><td class="r">${n2(k.gNet)}</td></tr>
      ${H.length ? `<tr><td></td><td><b><u>H-Schedule item</u></b></td><td></td><td></td></tr>${H.map(item).join("")}<tr class="mb-tot"><td></td><td class="r">Total (B) H-Schedule</td><td></td><td class="r">${n2(k.hTotal)}</td></tr>` : ""}
      <tr class="mb-tot"><td></td><td class="r">Total Amt. G-Schedule + H-Schedule (A+B)</td><td></td><td class="r">${n2(k.total)}</td></tr>
      ${k.prevTotal ? `<tr><td></td><td class="r">Less previous bill</td><td></td><td class="r">${n2(k.prevTotal)}</td></tr><tr class="mb-tot"><td></td><td class="r">Net Amt.</td><td></td><td class="r">${n2(k.net)}</td></tr>` : `<tr class="mb-tot"><td></td><td class="r">Net Amt.</td><td></td><td class="r">${n2(k.net)}</td></tr>`}
    </tbody></table>
    <div class="d-signs d-signs3"><div>Junior Engineer</div><div>Assistant Engineer</div><div>Executive Engineer</div></div></section>`;
}
