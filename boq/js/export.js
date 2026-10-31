// Excel (with live formulas), printable HTML/PDF and CSV output.
import { computeAbstract, itemQty, itemAmount, measurementQty, money, qtyFmt, amountInWords, esc, round } from "./store.js";

const XLSX = window.XLSX;
const NUMFMT = "#,##0.00";
const QTYFMT = "#,##0.000";

const fileSafe = (s) => String(s || "estimate").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "estimate";

function headerRows(project, title) {
  const f = project.format;
  const rows = [];
  if (f.orgName) rows.push([f.orgName]);
  rows.push([title]);
  rows.push([`Name of work: ${project.name}`]);
  const meta = [project.client && `Client: ${project.client}`, project.location && `Location: ${project.location}`].filter(Boolean).join("    ");
  if (meta) rows.push([meta]);
  const meta2 = [project.reference && `Ref: ${project.reference}`, project.date && `Date: ${project.date}`, project.preparedBy && `Prepared by: ${project.preparedBy}`].filter(Boolean).join("    ");
  if (meta2) rows.push([meta2]);
  rows.push([]);
  return rows;
}

const cell = (v, z) => (z ? { t: "n", v: v || 0, z } : v);
const fcell = (f, v, z = NUMFMT) => ({ t: "n", f, v: v || 0, z });

/** BOQ sheet. Returns { ws, sectionTotalRefs: [cellRef], worksRef } */
function boqSheet(project, priced, rateBookName) {
  const f = project.format;
  const cols = ["S.No."];
  if (f.showCode) cols.push("Item code");
  cols.push("Description of item", "Unit", "Quantity");
  if (priced) cols.push("Rate", "Amount");
  else cols.push("Rate (figures)", "Rate (words)", "Amount");
  if (f.showRateBook) cols.push("Rate book");
  if (f.showRemarks) cols.push("Remarks");
  const idx = (name) => cols.indexOf(name);
  const L = (i) => XLSX.utils.encode_col(i);

  const aoa = headerRows(project, priced ? f.title || "Bill of Quantities" : "Bill of Quantities (for tender)");
  const headRow = aoa.length;
  aoa.push(cols);
  const sectionTotalRefs = [];
  let sNo = 0;
  project.sections.forEach((s, si) => {
    if (!s.items.length) return;
    const head = new Array(cols.length).fill("");
    head[0] = String.fromCharCode(65 + (si % 26));
    head[idx("Description of item")] = s.name.toUpperCase();
    aoa.push(head);
    const first = aoa.length + 1;
    for (const it of s.items) {
      sNo++;
      const r = aoa.length + 1;
      const row = new Array(cols.length).fill("");
      row[0] = sNo;
      if (f.showCode) row[idx("Item code")] = it.code || "";
      row[idx("Description of item")] = it.description;
      row[idx("Unit")] = it.unit;
      row[idx("Quantity")] = cell(round(itemQty(it), 3), QTYFMT);
      const qL = L(idx("Quantity"));
      if (priced) {
        row[idx("Rate")] = cell(Number(it.rate) || 0, NUMFMT);
        row[idx("Amount")] = fcell(`${qL}${r}*${L(idx("Rate"))}${r}`, itemAmount(it));
      } else {
        row[idx("Amount")] = fcell(`IF(${L(idx("Rate (figures)"))}${r}="","",${qL}${r}*${L(idx("Rate (figures)"))}${r})`, 0);
      }
      if (f.showRateBook) row[idx("Rate book")] = rateBookName(it);
      if (f.showRemarks) row[idx("Remarks")] = it.remarks || "";
      aoa.push(row);
    }
    const last = aoa.length;
    const tot = new Array(cols.length).fill("");
    tot[idx("Description of item")] = `Total of ${s.name}`;
    const aL = L(idx("Amount"));
    tot[idx("Amount")] = fcell(`SUM(${aL}${first}:${aL}${last})`, priced ? s.items.reduce((a, it) => a + itemAmount(it), 0) : 0);
    aoa.push(tot);
    sectionTotalRefs.push({ name: s.name, ref: `${aL}${aoa.length}` });
    aoa.push([]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const widths = { "S.No.": 6, "Item code": 12, "Description of item": 70, Unit: 8, Quantity: 12, Rate: 13, Amount: 16, "Rate (figures)": 14, "Rate (words)": 28, "Rate book": 18, Remarks: 24 };
  ws["!cols"] = cols.map((c) => ({ wch: widths[c] || 12 }));
  ws["!merges"] = aoa.slice(0, headRow).map((_, r) => ({ s: { r, c: 0 }, e: { r, c: cols.length - 1 } }));
  ws["!autofilter"] = { ref: `A${headRow + 1}:${L(cols.length - 1)}${headRow + 1}` };
  return { ws, sectionTotalRefs };
}

function measurementSheet(project) {
  const aoa = headerRows(project, "Measurement Sheet");
  aoa.push(["Item", "Description / location", "Nos", "Length", "Breadth", "Depth / Height", "Quantity", "Unit"]);
  let sNo = 0;
  for (const s of project.sections) {
    if (!s.items.length) continue;
    aoa.push(["", s.name.toUpperCase()]);
    for (const it of s.items) {
      sNo++;
      aoa.push([sNo, `${it.code ? it.code + " — " : ""}${it.description}`, "", "", "", "", "", it.unit]);
      const ms = it.measurements && it.measurements.length ? it.measurements : [{ label: "As per drawing", nos: itemQty(it), l: "", b: "", d: "" }];
      const first = aoa.length + 1;
      for (const m of ms) {
        const r = aoa.length + 1;
        const v = (x) => (x === "" || x == null ? "" : cell(Number(x), "0.000"));
        aoa.push(["", "   " + (m.label || ""), v(m.nos), v(m.l), v(m.b), v(m.d), fcell(`IF(COUNT(C${r}:F${r})=0,0,PRODUCT(C${r}:F${r}))`, measurementQty(m), QTYFMT), ""]);
      }
      const last = aoa.length;
      aoa.push(["", "   Total", "", "", "", "", fcell(`SUM(G${first}:G${last})`, itemQty(it), QTYFMT), it.unit]);
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 70 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 8 }];
  return ws;
}

function abstractSheet(project, links) {
  const ab = computeAbstract(project);
  const aoa = headerRows(project, "Abstract of Cost");
  aoa.push(["S.No.", "Description", "Amount"]);
  const first = aoa.length + 1;
  ab.sections.filter((s) => s.count).forEach((s, i) => {
    const link = links?.find((l) => l.name === s.name);
    aoa.push([i + 1, s.name, link ? fcell(`'${link.sheet}'!${link.ref}`, s.total) : cell(s.total, NUMFMT)]);
  });
  const last = aoa.length;
  aoa.push(["", "Total cost of works (A)", fcell(`SUM(C${first}:C${last})`, ab.works)]);
  const worksRow = aoa.length;
  const chargeRows = [];
  for (const c of ab.charges) {
    if (!Number(c.percent)) continue;
    const baseRef = c.on === "running" ? `(${[`C${worksRow}`, ...chargeRows.map((r) => `C${r}`)].join("+")})` : `C${worksRow}`;
    aoa.push(["", `Add ${c.label} @ ${c.percent}% on ${c.on === "running" ? "running total" : "(A)"}`, fcell(`${baseRef}*${Number(c.percent)}/100`, c.amount)]);
    chargeRows.push(aoa.length);
  }
  // Grand total = works + every charge row.
  const grandF = [`C${worksRow}`, ...chargeRows.map((r) => `C${r}`)].join("+");
  aoa.push(["", "GRAND TOTAL", fcell(grandF, ab.grand)]);
  if (project.format.amountInWords) aoa.push(["", `(${amountInWords(ab.grand)})`]);
  if (project.format.footer) { aoa.push([]); aoa.push(["", project.format.footer]); }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 70 }, { wch: 18 }];
  return ws;
}

export function exportXlsx(project, format, rateBookName) {
  const wb = XLSX.utils.book_new();
  const want = (k) => format === "full" || format === k;
  let links = null;
  if (want("abstract") && format === "full") links = [];
  if (want("priced")) {
    const { ws, sectionTotalRefs } = boqSheet(project, true, rateBookName);
    if (links) links.push(...sectionTotalRefs.map((x) => ({ ...x, sheet: "BOQ" })));
    XLSX.utils.book_append_sheet(wb, ws, "BOQ");
  }
  if (want("abstract")) XLSX.utils.book_append_sheet(wb, abstractSheet(project, links), "Abstract");
  if (want("measurement")) XLSX.utils.book_append_sheet(wb, measurementSheet(project), "Measurement");
  if (want("tender")) XLSX.utils.book_append_sheet(wb, boqSheet(project, false, rateBookName).ws, "Tender BOQ");
  if (format === "full") {
    // Put the abstract first, as estimates are usually read.
    wb.SheetNames = ["Abstract", ...wb.SheetNames.filter((n) => n !== "Abstract")];
  }
  XLSX.writeFile(wb, `${fileSafe(project.name)}_${format}.xlsx`, { compression: true });
}

export function exportCsv(project) {
  const rows = [["Section", "S.No", "Code", "Description", "Unit", "Quantity", "Rate", "Amount"]];
  let n = 0;
  for (const s of project.sections) for (const it of s.items) rows.push([s.name, ++n, it.code, it.description, it.unit, round(itemQty(it), 3), it.rate, itemAmount(it)]);
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  download(new Blob(["﻿" + csv], { type: "text/csv" }), `${fileSafe(project.name)}.csv`);
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- print ----------

function printHeader(project, title) {
  const f = project.format;
  return `<header class="p-head">
    ${f.orgName ? `<div class="p-org">${esc(f.orgName)}</div>` : ""}
    <h1>${esc(title)}</h1>
    <table class="p-meta"><tr><td><b>Name of work:</b> ${esc(project.name)}</td><td><b>Date:</b> ${esc(project.date)}</td></tr>
    <tr><td>${project.client ? `<b>Client:</b> ${esc(project.client)}` : ""}</td><td>${project.reference ? `<b>Ref:</b> ${esc(project.reference)}` : ""}</td></tr>
    <tr><td>${project.location ? `<b>Location:</b> ${esc(project.location)}` : ""}</td><td>${project.preparedBy ? `<b>Prepared by:</b> ${esc(project.preparedBy)}` : ""}</td></tr></table>
  </header>`;
}

function printBoq(project, priced, rateBookName) {
  const f = project.format;
  const extra = (f.showCode ? 1 : 0);
  let n = 0;
  let body = "";
  project.sections.forEach((s, si) => {
    if (!s.items.length) return;
    body += `<tr class="p-sec"><td>${String.fromCharCode(65 + (si % 26))}</td><td colspan="${3 + extra + (priced ? 2 : 3)}">${esc(s.name)}</td></tr>`;
    for (const it of s.items) {
      n++;
      body += `<tr><td>${n}</td>${f.showCode ? `<td>${esc(it.code)}</td>` : ""}<td class="p-desc">${esc(it.description)}${f.showRateBook ? `<div class="p-src">${esc(rateBookName(it))}</div>` : ""}${f.showRemarks && it.remarks ? `<div class="p-src">${esc(it.remarks)}</div>` : ""}</td><td>${esc(it.unit)}</td><td class="n">${qtyFmt(itemQty(it))}</td>${
        priced ? `<td class="n">${money(Number(it.rate), false)}</td><td class="n">${money(itemAmount(it), false)}</td>` : `<td></td><td></td><td></td>`
      }</tr>`;
    }
    if (priced) body += `<tr class="p-tot"><td></td><td colspan="${3 + extra}">Total of ${esc(s.name)}</td><td></td><td class="n">${money(s.items.reduce((a, it) => a + itemAmount(it), 0), false)}</td></tr>`;
  });
  return `<section class="p-page">${printHeader(project, priced ? f.title || "Bill of Quantities" : "Bill of Quantities (for tender)")}
  <table class="p-table"><thead><tr><th>S.No.</th>${f.showCode ? "<th>Code</th>" : ""}<th>Description of item</th><th>Unit</th><th>Qty</th>${
    priced ? "<th>Rate</th><th>Amount</th>" : "<th>Rate (figures)</th><th>Rate (words)</th><th>Amount</th>"
  }</tr></thead><tbody>${body}</tbody></table></section>`;
}

function printMeasurement(project) {
  let n = 0, body = "";
  const v = (x) => (x === "" || x == null ? "" : qtyFmt(Number(x)));
  for (const s of project.sections) {
    if (!s.items.length) continue;
    body += `<tr class="p-sec"><td></td><td colspan="7">${esc(s.name)}</td></tr>`;
    for (const it of s.items) {
      n++;
      body += `<tr class="p-item"><td>${n}</td><td colspan="7">${it.code ? `<b>${esc(it.code)}</b> — ` : ""}${esc(it.description)}</td></tr>`;
      const ms = it.measurements?.length ? it.measurements : [{ label: "As per drawing", nos: itemQty(it), l: "", b: "", d: "" }];
      for (const m of ms) body += `<tr><td></td><td>${esc(m.label)}</td><td class="n">${v(m.nos)}</td><td class="n">${v(m.l)}</td><td class="n">${v(m.b)}</td><td class="n">${v(m.d)}</td><td class="n">${qtyFmt(measurementQty(m))}</td><td></td></tr>`;
      body += `<tr class="p-tot"><td></td><td>Total</td><td></td><td></td><td></td><td></td><td class="n">${qtyFmt(itemQty(it))}</td><td>${esc(it.unit)}</td></tr>`;
    }
  }
  return `<section class="p-page">${printHeader(project, "Measurement Sheet")}<table class="p-table"><thead><tr><th>Item</th><th>Description</th><th>Nos</th><th>L</th><th>B</th><th>D/H</th><th>Qty</th><th>Unit</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function printAbstract(project) {
  const ab = computeAbstract(project);
  let rows = ab.sections.filter((s) => s.count).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td class="n">${money(s.total, false)}</td></tr>`).join("");
  rows += `<tr class="p-tot"><td></td><td>Total cost of works (A)</td><td class="n">${money(ab.works, false)}</td></tr>`;
  for (const c of ab.charges) if (Number(c.percent)) rows += `<tr><td></td><td>Add ${esc(c.label)} @ ${c.percent}% on ${c.on === "running" ? "running total" : "(A)"}</td><td class="n">${money(c.amount, false)}</td></tr>`;
  rows += `<tr class="p-grand"><td></td><td>GRAND TOTAL</td><td class="n">${money(ab.grand)}</td></tr>`;
  return `<section class="p-page">${printHeader(project, "Abstract of Cost")}<table class="p-table"><thead><tr><th>S.No.</th><th>Description</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    ${project.format.amountInWords ? `<p class="p-words">(${esc(amountInWords(ab.grand))})</p>` : ""}
    ${project.format.footer ? `<p class="p-foot">${esc(project.format.footer)}</p>` : ""}
    <div class="p-sign"><div>Prepared by</div><div>Checked by</div><div>Approved by</div></div></section>`;
}

export function printProject(project, format, rateBookName) {
  const parts = [];
  if (format === "abstract" || format === "full") parts.push(printAbstract(project));
  if (format === "priced" || format === "full") parts.push(printBoq(project, true, rateBookName));
  if (format === "measurement" || format === "full") parts.push(printMeasurement(project));
  if (format === "tender" || format === "full") parts.push(printBoq(project, false, rateBookName));
  const area = document.getElementById("printArea");
  area.innerHTML = parts.join("");
  const old = document.title;
  document.title = `${project.name} - ${format}`;
  window.print();
  document.title = old;
}
