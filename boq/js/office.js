// Office: company profile, company documents, purchase bills / expenses (accounts) and backup.
import { idb, uid, num, round, esc, money } from "./store.js";
import { saveFile, allFiles, putFile, delFile, thumbOf, makeZip, safeName, extOf, storageInfo, mb, askPersist } from "./files.js";
import { docsPanel, COMPANY_FOLDERS, saveScan, openFile } from "./docs.js";
import { readDocument, isoDate } from "./docread.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let ctx = null;
const state = { tab: "accounts", company: {}, expenses: [], f: { period: "month", from: "", to: "", owner: "", cat: "", q: "" } };

export const CATEGORIES = ["Cement", "Steel", "Sand / aggregate", "Bricks / blocks", "Ready-mix concrete", "Labour payment", "Subcontractor payment", "Diesel / fuel", "Machinery hire",
  "Transport", "Electrical", "Plumbing / sanitary", "Hardware / tools", "Paint", "Tiles / stone", "Shuttering", "Site expenses", "Office / admin", "Other"];
const PAY = ["Cash", "UPI", "Bank transfer", "Cheque", "Credit (unpaid)"];
const COMPANY_FIELDS = [["name", "Company / firm name"], ["proprietor", "Proprietor / partner"], ["address", "Address"], ["phone", "Phone"], ["email", "Email"],
  ["gstin", "GSTIN"], ["pan", "PAN"], ["regNo", "Contractor registration No. & class"], ["bank", "Bank, A/c No. & IFSC"]];

export const company = () => state.company;

export async function initOffice(c) {
  ctx = c;
  state.company = (await idb.get("kv", "company"))?.value || {};
  state.expenses = await idb.all("expenses");
  const root = $("#officeRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
}

export async function renderOffice() {
  const root = $("#officeRoot"); if (!root) return;
  const tabs = [["accounts", "Purchase bills & accounts"], ["docs", "Company documents"], ["profile", "Company profile"], ["backup", "Backup & storage"]];
  root.innerHTML = `<nav class="subnav">${tabs.map(([k, l]) => `<button data-otab="${k}" class="${state.tab === k ? "active" : ""}">${l}</button>`).join("")}</nav><div id="officeBody"></div>`;
  const body = $("#officeBody", root);
  if (state.tab === "profile") body.innerHTML = profileView();
  if (state.tab === "accounts") body.innerHTML = accountsView();
  if (state.tab === "backup") body.innerHTML = await backupView();
  if (state.tab === "docs") {
    const render = docsPanel(body, { owner: "company", title: `Company documents${state.company.name ? " · " + state.company.name : ""}`,
      folders: () => state.company.folders || COMPANY_FOLDERS, saveFolders: (list) => { state.company.folders = list; saveCompany(); },
      targets: () => [{ id: "company", name: "Company profile" }, ...ctx.sites().map((s) => ({ id: s.id, name: s.name.slice(0, 60) }))], ctx });
    await render();
  }
}

const saveCompany = () => idb.put("kv", { id: "company", value: state.company });
const profileView = () => `<div class="card"><h2>Company profile</h2><p class="muted small">Printed on the top of DPR / WPR / MPR and used in the accounts export.</p>
  <div class="form-grid">${COMPANY_FIELDS.map(([k, l]) => `<label class="field">${l}<input data-co="${k}" value="${esc(state.company[k] || "")}"></label>`).join("")}</div></div>`;

// ---------------------------------------------------------------------------
// Accounts: purchase bills and expenses
// ---------------------------------------------------------------------------

function period() {
  const f = state.f, d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  if (f.period === "month") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
  if (f.period === "lastmonth") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (f.period === "fy") { const fy = m >= 3 ? y : y - 1; return [`${fy}-04-01`, `${fy + 1}-03-31`]; }
  if (f.period === "lastfy") { const fy = (m >= 3 ? y : y - 1) - 1; return [`${fy}-04-01`, `${fy + 1}-03-31`]; }
  if (f.period === "custom") return [f.from, f.to];
  return ["", ""];
}
const ownerName = (id) => (id === "company" || !id ? "Company / office" : ctx.sites().find((s) => s.id === id)?.name || "(deleted site)");
function filtered() {
  const [a, b] = period(), f = state.f;
  return state.expenses.filter((x) => (!a || x.date >= a) && (!b || x.date <= b) && (!f.owner || x.owner === f.owner) && (!f.cat || x.category === f.cat)
    && (!f.q || `${x.vendor} ${x.billNo} ${x.note} ${x.gstin}`.toLowerCase().includes(f.q.toLowerCase()))).sort((p, q) => q.date.localeCompare(p.date));
}
const fd = (d) => (d ? d.split("-").reverse().join(".") : "");

function accountsView() {
  const list = filtered(), f = state.f, [a, b] = period();
  const tot = (k) => round(list.reduce((s, x) => s + num(x[k]), 0), 2);
  const byCat = new Map(); list.forEach((x) => byCat.set(x.category || "Other", round((byCat.get(x.category || "Other") || 0) + num(x.total), 2)));
  const unpaid = round(list.filter((x) => x.pay === "Credit (unpaid)").reduce((s, x) => s + num(x.total), 0), 2);
  const sites = ctx.sites();
  return `<div class="card upload-card"><h2>Add a purchase bill</h2><p class="muted small">Photo, scan or PDF of the bill. The date, bill No., GSTIN and amount are read from it (OCR, on this device); check them and choose the site.</p>
      <div class="row gap wrap"><label class="primary btn-file">📷 Photo of bill<input type="file" accept="image/*" capture="environment" data-billcam hidden></label>
      <label class="ghost btn-file">⇪ Upload bill (PDF / image)<input type="file" accept="image/*,application/pdf" multiple data-billup hidden></label>
      <button class="ghost" data-act="manual">＋ Enter without a bill copy</button><span class="status" id="billStatus"></span></div></div>
    <div class="card"><div class="row between wrap"><h2>Purchase bills & expenses</h2><div class="row gap"><button class="primary" data-act="excel">Excel for CA</button><button class="ghost" data-act="zip" title="Excel plus a copy of every bill">Excel + bill copies (ZIP)</button></div></div>
      <div class="row gap wrap mt"><select data-ff="period">${[["month", "This month"], ["lastmonth", "Last month"], ["fy", "This financial year"], ["lastfy", "Last financial year"], ["all", "All"], ["custom", "Custom…"]].map(([k, l]) => `<option value="${k}" ${f.period === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${f.period === "custom" ? `<input type="date" data-ff="from" value="${f.from}"><input type="date" data-ff="to" value="${f.to}">` : ""}
        <select data-ff="owner"><option value="">All sites & office</option><option value="company" ${f.owner === "company" ? "selected" : ""}>Company / office</option>${sites.map((s) => `<option value="${s.id}" ${f.owner === s.id ? "selected" : ""}>${esc(s.name.slice(0, 50))}</option>`).join("")}</select>
        <select data-ff="cat"><option value="">All categories</option>${CATEGORIES.map((c) => `<option ${f.cat === c ? "selected" : ""}>${c}</option>`).join("")}</select>
        <input type="search" data-ff="q" value="${esc(f.q)}" placeholder="Vendor, bill No., GSTIN"></div>
      <div class="kpis mt"><div class="kpi"><small>Bills</small><b>${list.length}</b></div><div class="kpi"><small>Taxable</small><b>${money(tot("taxable"))}</b></div><div class="kpi"><small>GST</small><b>${money(tot("gst"))}</b></div>
        <div class="kpi accent"><small>Total ${a ? `${fd(a)}–${fd(b)}` : ""}</small><b>${money(tot("total"))}</b></div>${unpaid ? `<div class="kpi"><small>Unpaid (credit)</small><b>${money(unpaid)}</b></div>` : ""}</div>
      ${byCat.size ? `<div class="chips mt">${[...byCat].sort((p, q) => q[1] - p[1]).map(([c, v]) => `<span class="chip">${esc(c)}: ${money(v)}</span>`).join("")}</div>` : ""}
      <div class="table-wrap mt"><table class="data"><thead><tr><th>Date</th><th>Vendor</th><th>Bill No.</th><th>Category</th><th>Site</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th>Paid by</th><th></th></tr></thead>
        <tbody>${list.map((x) => `<tr data-id="${x.id}"><td>${fd(x.date)}</td><td>${esc(x.vendor || "")}${x.gstin ? `<br><small class="muted">${esc(x.gstin)}</small>` : ""}</td><td>${esc(x.billNo || "")}</td><td>${esc(x.category || "")}</td>
          <td class="small">${esc(ownerName(x.owner).slice(0, 40))}</td><td class="num">${money(x.taxable, false)}</td><td class="num">${money(x.gst, false)}</td><td class="num"><b>${money(x.total, false)}</b></td><td class="small">${esc(x.pay || "")}</td>
          <td class="nowrap">${x.fileId ? `<button class="icon" data-act="viewBill" title="Bill copy">📎</button>` : ""}<button class="icon" data-act="editBill" title="Edit">✎</button></td></tr>`).join("") || `<tr><td colspan="10" class="muted">No bills in this period.</td></tr>`}</tbody></table></div></div>`;
}

/** Read the useful fields from the text of a bill. */
function parseBill(lines) {
  const text = lines.join("\n"), out = {};
  const g = text.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/); if (g) out.gstin = g[0];
  const no = text.match(/(?:invoice|bill|inv)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{0,20})/i); if (no) out.billNo = no[1];
  const dm = text.match(/(?:date|dated|dt)\.?\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i) || text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\b/);
  if (dm) { const iso = isoDate(dm[1]); if (iso) out.date = iso; }
  const amounts = (re) => lines.filter((l) => re.test(l)).flatMap((l) => (l.match(/\d[\d,]*\.\d{1,2}|\d[\d,]{2,}/g) || []).map((v) => num(v.replace(/,/g, ""))));
  const totals = amounts(/grand\s*total|net\s*(amount|payable)|total\s*amount|amount\s*payable|^\s*total\b/i);
  if (totals.length) out.total = Math.max(...totals);
  const gst = ["cgst", "sgst", "igst"].map((k) => { const v = amounts(new RegExp(`\\b${k}\\b`, "i")).filter((x) => x < (out.total || Infinity) && x > 0); return v.length ? Math.max(...v.filter((x) => x !== 9 && x !== 18 && x !== 6 && x !== 14 && x !== 2.5)) || 0 : 0; });
  const gsum = round(gst.filter((x) => Number.isFinite(x)).reduce((a, x) => a + x, 0), 2);
  if (gsum && out.total) { out.gst = gsum; out.taxable = round(out.total - gsum, 2); }
  const vendor = lines.map((l) => l.trim()).find((l) => l.length > 3 && /[A-Za-z]{3}/.test(l) && !/tax\s*invoice|invoice|bill|gstin|original|duplicate|cash\s*memo/i.test(l));
  if (vendor) out.vendor = vendor.replace(/\s{2,}/g, " ").slice(0, 80);
  const low = text.toLowerCase();
  const guess = [["Cement", /cement|opc|ppc/], ["Steel", /\btmt\b|steel|saria|sariya|\bbar\b/], ["Sand / aggregate", /sand|grit|aggregate|gitti|bajri|rodi/], ["Bricks / blocks", /brick|block|eent|int\b/],
    ["Diesel / fuel", /diesel|petrol|fuel|hsd/], ["Electrical", /wire|cable|mcb|switch|electric/], ["Plumbing / sanitary", /pipe|cpvc|upvc|fitting|sanitary/], ["Paint", /paint|primer|putty|distemper/], ["Hardware / tools", /hardware|tool|nail|binding wire/]];
  const c = guess.find(([, re]) => re.test(low)); if (c) out.category = c[0];
  return out;
}

async function addBillFiles(files, fromCamera) {
  const status = (t) => { const el = $("#billStatus"); if (el) el.textContent = t; };
  for (const [i, file] of files.entries()) {
    status(`Reading bill ${i + 1} of ${files.length}… (photos take a little longer)`);
    let fields = {};
    try { const doc = await readDocument([file], (t) => status(t)); fields = parseBill(doc.lines); } catch (e) { console.warn(e); }
    status("");
    const rec = await saveFile(file, { owner: "company", kind: "bill", folder: "Purchase bills", name: file.name || `bill_${Date.now()}.jpg`, thumb: file.type.startsWith("image/") ? await thumbOf(file).catch(() => "") : "" });
    await editDialog({ id: uid("ex"), date: fields.date || new Date().toISOString().slice(0, 10), owner: ctx.currentSite() || "company", pay: "Cash", ...fields, fileId: rec.id, isNew: true }, rec);
  }
}

function editDialog(x, fileRec = null) {
  return new Promise((done) => {
    const sites = ctx.sites();
    const F = (k, l, t = "text", attrs = "") => `<label class="field">${l}<input data-x="${k}" type="${t}" ${t === "number" ? 'step="0.01"' : ""} value="${esc(x[k] ?? "")}" ${attrs}></label>`;
    ctx.modal(`<h2>${x.isNew ? "New purchase bill" : "Edit bill"}</h2>${fileRec?.thumb ? `<img src="${fileRec.thumb}" class="bill-prev">` : ""}
      <div class="form-grid">${F("date", "Bill date", "date")}${F("vendor", "Vendor / supplier")}${F("gstin", "Vendor GSTIN")}${F("billNo", "Bill / invoice No.")}
        <label class="field">Category<select data-x="category">${CATEGORIES.map((c) => `<option ${x.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label class="field">Site<select data-x="owner"><option value="company">Company / office</option>${sites.map((s) => `<option value="${s.id}" ${x.owner === s.id ? "selected" : ""}>${esc(s.name.slice(0, 60))}</option>`).join("")}</select></label>
        ${F("taxable", "Taxable amount", "number")}${F("gst", "GST amount", "number")}${F("total", "Total amount *", "number")}
        <label class="field">Paid by<select data-x="pay">${PAY.map((p) => `<option ${x.pay === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>${F("note", "Note (material, qty…)")}</div>
      <p class="muted small" id="exHint"></p>
      <div class="row gap mt"><button class="primary" id="exSave">Save</button>${x.isNew ? "" : `<button class="ghost danger-text" id="exDel">Delete</button>`}</div>`, (m) => {
      const val = (k) => $(`[data-x="${k}"]`, m).value;
      m.oninput = (e) => {
        if (["taxable", "gst"].includes(e.target.dataset.x) && (num(val("taxable")) || num(val("gst")))) $(`[data-x="total"]`, m).value = round(num(val("taxable")) + num(val("gst")), 2);
      };
      $("#exSave", m).onclick = async () => {
        const rec = { ...x }; delete rec.isNew;
        for (const i of $$("[data-x]", m)) rec[i.dataset.x] = i.type === "number" ? round(num(i.value), 2) : i.value.trim();
        if (!rec.total) { $("#exHint", m).textContent = "Enter the total amount."; return; }
        if (!rec.taxable && !rec.gst) rec.taxable = rec.total;
        const i = state.expenses.findIndex((y) => y.id === rec.id); if (i >= 0) state.expenses[i] = rec; else state.expenses.push(rec);
        await idb.put("expenses", rec);
        if (fileRec) { fileRec.owner = rec.owner; fileRec.name = `${rec.date}_${safeName(rec.vendor || "bill").slice(0, 30)}_${rec.total}.${extOf(fileRec.type, fileRec.name)}`; await putFile(fileRec); }
        ctx.closeModal(); ctx.toast("Bill saved."); renderOffice(); done(rec);
      };
      const del = $("#exDel", m);
      if (del) del.onclick = async () => {
        if (!confirm("Delete this bill?")) return;
        state.expenses = state.expenses.filter((y) => y.id !== x.id); await idb.del("expenses", x.id); if (x.fileId) await delFile(x.fileId);
        ctx.closeModal(); renderOffice(); done(null);
      };
    });
    // A bill copy whose dialog is closed without saving is removed again.
    const closer = $(".modal-close"); const prev = closer.onclick;
    closer.addEventListener("click", async () => { if (x.isNew && fileRec && !state.expenses.some((y) => y.id === x.id)) await delFile(fileRec.id); done(null); }, { once: true });
    void prev;
  });
}

function accountsBook(list) {
  const X = window.XLSX, wb = X.utils.book_new(), [a, b] = period(), co = state.company;
  const head = [[co.name || "Purchase register"], [co.gstin ? `GSTIN: ${co.gstin}` : ""], [`Period: ${a ? `${fd(a)} to ${fd(b)}` : "All"}`], []];
  const rows = [...list].sort((p, q) => p.date.localeCompare(q.date)).map((x, i) => [i + 1, fd(x.date), x.vendor || "", x.gstin || "", x.billNo || "", x.category || "", ownerName(x.owner), num(x.taxable), num(x.gst), num(x.total), x.pay || "", x.note || "", x.fileId ? `bills/${fileNameFor(x)}` : ""]);
  const ws = X.utils.aoa_to_sheet([...head, ["S.No", "Date", "Vendor", "GSTIN", "Bill No.", "Category", "Site", "Taxable", "GST", "Total", "Paid by", "Note", "Bill copy"], ...rows,
    ["", "", "TOTAL", "", "", "", "", ...["taxable", "gst", "total"].map((k) => round(list.reduce((s, x) => s + num(x[k]), 0), 2))]]);
  ws["!cols"] = [5, 11, 28, 17, 12, 16, 30, 12, 10, 12, 12, 24, 30].map((w) => ({ wch: w }));
  X.utils.book_append_sheet(wb, ws, "Purchase register");
  const group = (keyf) => { const m = new Map(); list.forEach((x) => { const k = keyf(x); const r = m.get(k) || [0, 0, 0, 0]; r[0]++; r[1] += num(x.taxable); r[2] += num(x.gst); r[3] += num(x.total); m.set(k, r); }); return [...m].map(([k, r]) => [k, r[0], round(r[1], 2), round(r[2], 2), round(r[3], 2)]); };
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Category", "Bills", "Taxable", "GST", "Total"], ...group((x) => x.category || "Other")]), "By category");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Site", "Bills", "Taxable", "GST", "Total"], ...group((x) => ownerName(x.owner))]), "By site");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...head, ["Vendor", "Bills", "Taxable", "GST", "Total"], ...group((x) => `${x.vendor || "-"}${x.gstin ? ` (${x.gstin})` : ""}`)]), "By vendor");
  return wb;
}
const fileNameFor = (x) => `${x.date}_${safeName(x.vendor || "bill").slice(0, 30)}_${x.billNo ? safeName(x.billNo) + "_" : ""}${x.total}`;

// ---------------------------------------------------------------------------
// Backup and restore: everything in one ZIP
// ---------------------------------------------------------------------------

async function backupView() {
  const s = await storageInfo();
  const files = await allFiles();
  const n = (k) => files.filter((f) => f.kind === k).length;
  return `<div class="card"><h2>Backup & storage</h2>
    <p>Everything is kept in this browser on this device: ${ctx.sites().length} site(s), ${n("photo")} photos, ${n("doc")} documents, ${n("bill")} bill copies, ${state.expenses.length} account entries${s ? `, using ${mb(s.used)}${s.quota ? ` of about ${mb(s.quota)} available` : ""}` : ""}.
      ${s?.persisted ? "The browser has agreed to keep this data." : "The browser may clear this data if the device runs short of space, or after weeks without use (Safari)."}</p>
    <p><b>Take a backup every week</b> and keep it on Google Drive, email or a pen drive. To move to a new phone or computer, restore the backup there.</p>
    <div class="row gap wrap"><button class="primary" data-act="backup">Download full backup (ZIP)</button><label class="ghost btn-file">Restore from backup…<input type="file" accept=".zip" data-restore hidden></label></div>
    <p class="muted small mt">The backup holds sites, daily entries, photos, documents, accounts, the company profile, bill works, estimates and rate books.</p></div>`;
}

async function backup() {
  ctx.toast("Preparing backup…", 8000);
  const files = await allFiles();
  const data = { app: "ratebook-boq", kind: "full-backup", version: 2, at: new Date().toISOString(), company: state.company,
    sites: await idb.all("sites"), diary: await idb.all("diary"), expenses: await idb.all("expenses"), projects: await idb.all("projects"), bsrs: await idb.all("bsrs"),
    files: files.map(({ blob, ...meta }) => ({ ...meta, path: `files/${meta.id}.${extOf(meta.type, meta.name)}` })) };
  const zip = await makeZip([{ name: "backup.json", data: JSON.stringify(data) }, ...files.map((f) => ({ name: `files/${f.id}.${extOf(f.type, f.name)}`, data: f.blob }))]);
  ctx.download(zip, `RateBook_backup_${new Date().toISOString().slice(0, 10)}.zip`);
}

async function restore(file) {
  if (!confirm("Restore this backup? Items in the backup are added to (or replace the same items in) this device's data.")) return;
  try {
    const { unzipSync, strFromU8 } = await import("../vendor/libs.mjs");
    const z = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const data = JSON.parse(strFromU8(z["backup.json"]));
    if (data.kind !== "full-backup") throw new Error("This is not a RateBook full backup.");
    for (const [store, list] of [["sites", data.sites], ["diary", data.diary], ["expenses", data.expenses], ["projects", data.projects], ["bsrs", data.bsrs]]) for (const x of list || []) await idb.put(store, x);
    for (const meta of data.files || []) { const bytes = z[meta.path]; if (!bytes) continue; const { path, ...rest } = meta; await idb.put("files", { ...rest, blob: new Blob([bytes], { type: meta.type }) }); }
    if (data.company) await idb.put("kv", { id: "company", value: data.company });
    askPersist();
    ctx.toast("Backup restored. Reloading…"); setTimeout(() => location.reload(), 900);
  } catch (e) { ctx.toast("Could not restore: " + e.message, 7000); }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function onClick(e) {
  const t = e.target, act = t.closest("[data-act]")?.dataset.act;
  if (t.closest("[data-otab]")) { state.tab = t.closest("[data-otab]").dataset.otab; return renderOffice(); }
  const id = t.closest("[data-id]")?.dataset.id;
  if (act === "manual") return editDialog({ id: uid("ex"), date: new Date().toISOString().slice(0, 10), owner: ctx.currentSite() || "company", pay: "Cash", isNew: true });
  if (act === "editBill") { const x = state.expenses.find((y) => y.id === id); const f = x?.fileId ? (await allFiles()).find((y) => y.id === x.fileId) : null; return editDialog(x, f); }
  if (act === "viewBill") { const x = state.expenses.find((y) => y.id === id); const f = (await allFiles()).find((y) => y.id === x.fileId); if (f) openFile(f, ctx); return; }
  if (act === "excel") { const list = filtered(); if (!list.length) { ctx.toast("No bills in this period."); return; } window.XLSX.writeFile(accountsBook(list), `Purchase_register_${period()[0] || "all"}.xlsx`); }
  if (act === "zip") {
    const list = filtered(); if (!list.length) { ctx.toast("No bills in this period."); return; }
    const wb = accountsBook(list); const bytes = window.XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const all = await allFiles();
    const copies = list.filter((x) => x.fileId).map((x) => { const f = all.find((y) => y.id === x.fileId); return f && { name: `bills/${fileNameFor(x)}.${extOf(f.type, f.name)}`, data: f.blob }; }).filter(Boolean);
    ctx.download(await makeZip([{ name: "Purchase_register.xlsx", data: new Uint8Array(bytes) }, ...copies]), `Accounts_${period()[0] || "all"}_to_${period()[1] || ""}.zip`);
  }
  if (act === "backup") return backup();
}
async function onChange(e) {
  const t = e.target;
  if (t.matches("[data-co]")) { state.company[t.dataset.co] = t.value.trim(); await saveCompany(); return; }
  if (t.matches("[data-ff]")) { state.f[t.dataset.ff] = t.value; return renderOffice(); }
  if (t.matches("[data-billcam], [data-billup]")) { const files = [...t.files]; t.value = ""; if (files.length) addBillFiles(files, t.matches("[data-billcam]")); return; }
  if (t.matches("[data-restore]")) { const f = t.files[0]; t.value = ""; if (f) restore(f); }
}

export { saveScan };
