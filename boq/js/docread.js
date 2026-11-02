// Read any document a contractor has — Excel, Word, PDF (typed or scanned) or photos — without any online service.
// Scans and photos are read with Tesseract OCR running inside the browser (English + Hindi).
import { pdfjsLib, groupTextIntoLines, UNIT_WORDS, normaliseUnit } from "./bsr-import.js";
import { unzipSync, strFromU8 } from "../vendor/libs.mjs";
import { num } from "./store.js";

const XLSX = window.XLSX;
const OCR_BASE = new URL("../vendor/ocr/", import.meta.url).href;
let workerP = null, progressFn = null;

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load the OCR engine.")); document.head.appendChild(s); });
}

async function ocrWorker() {
  if (!workerP) {
    workerP = (async () => {
      if (!window.Tesseract) await loadScript(OCR_BASE + "tesseract.min.js");
      return window.Tesseract.createWorker(["eng", "hin"], 1, {
        workerPath: OCR_BASE + "worker.min.js", corePath: OCR_BASE, langPath: OCR_BASE, gzip: true,
        logger: (m) => progressFn?.(m),
      });
    })();
  }
  return workerP;
}

/** Scale and clean up an image for OCR (grey, stretched contrast, ~2400 px wide). */
function prepCanvas(src, w, h) {
  const k = Math.min(3, Math.max(1, 2400 / w));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < a.length; i += 16) { const g = (a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11); lo = Math.min(lo, g); hi = Math.max(hi, g); }
  const span = Math.max(40, hi - lo);
  for (let i = 0; i < a.length; i += 4) { const g = ((a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) - lo) * 255 / span; a[i] = a[i + 1] = a[i + 2] = Math.max(0, Math.min(255, g)); }
  x.putImageData(d, 0, 0);
  return c;
}

async function ocrCanvas(canvas, label, onStatus) {
  const w = await ocrWorker();
  progressFn = (m) => { if (m.status === "recognizing text") onStatus?.(`Reading ${label}… ${Math.round(m.progress * 100)}%`); else if (/load/i.test(m.status)) onStatus?.("Loading the text reader (first time only)…"); };
  const { data } = await w.recognize(canvas);
  return (data.text || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Text of any document as lines. Returns { lines, rows (for spreadsheets), ocr: boolean, kind }.
 * onStatus(text) reports progress.
 */
export async function readDocument(files, onStatus = () => {}) {
  const out = { lines: [], rows: [], ocr: false, pdfFiles: [], xlsFiles: [] };
  for (const file of files) {
    const name = file.name.toLowerCase(), ext = name.split(".").pop();
    if (["xls", "xlsx", "xlsm", "ods", "csv"].includes(ext)) {
      out.xlsFiles.push(file);
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      for (const sn of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: false, blankrows: false });
        out.rows.push({ sheet: sn, rows });
        rows.forEach((r) => { const t = r.map((c) => String(c).trim()).filter(Boolean).join(" | "); if (t) out.lines.push(t); });
      }
    } else if (ext === "docx") {
      const z = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const xml = strFromU8(z["word/document.xml"] || new Uint8Array());
      xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " | ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => out.lines.push(l));
    } else if (ext === "pdf") {
      out.pdfFiles.push(file);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        onStatus(`Reading ${file.name}, page ${p} of ${pdf.numPages}…`);
        const page = await pdf.getPage(p);
        const lines = groupTextIntoLines((await page.getTextContent()).items);
        if (lines.join("").length > 60) { out.lines.push(...lines); continue; }
        // Scanned page: render and read with OCR.
        const vp = page.getViewport({ scale: 2.6 });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        out.ocr = true;
        out.lines.push(...(await ocrCanvas(prepCanvas(c, c.width, c.height), `${file.name}, page ${p}`, onStatus)));
      }
    } else if (/^image\//.test(file.type) || ["jpg", "jpeg", "png", "webp", "bmp", "gif", "heic"].includes(ext)) {
      let bmp;
      try { bmp = await createImageBitmap(file); } catch { throw new Error(`${file.name}: this browser cannot open this image. Use JPG or PNG.`); }
      out.ocr = true;
      out.lines.push(...(await ocrCanvas(prepCanvas(bmp, bmp.width, bmp.height), file.name, onStatus)));
    } else if (["txt", "text"].includes(ext)) {
      (await file.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => out.lines.push(l));
    } else throw new Error(`${file.name}: use PDF, Excel, Word or a photo (JPG/PNG).`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Work order
// ---------------------------------------------------------------------------

const DATE = "(\\d{1,2}\\s*[\\/.\\-]\\s*\\d{1,2}\\s*[\\/.\\-]\\s*\\d{2,4})";
export function isoDate(s) {
  const m = String(s || "").replace(/\s/g, "").match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (!m) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/^[\s:.\-–]+|[\s:.\-–|]+$/g, "").trim();

/** Pick out work order details from its text. Every field is a suggestion for the user to check. */
export function parseWorkOrder(lines) {
  const text = lines.join("\n");
  const one = (re, i = 1) => { const m = text.match(re); return m ? clean(m[i]) : ""; };
  const f = {};
  f.workOrderNo = one(/work\s*order\s*no\.?\s*[:.]?\s*([0-9A-Z][0-9A-Z\/\-.]{3,40})/i) || one(/order\s*no\.?\s*[:.]?\s*([0-9A-Z][0-9A-Z\/\-.]{3,40})/i);
  f.woDate = isoDate(one(new RegExp("work\\s*order\\s*no[^\\n]*?date[d]?\\s*[:.]?\\s*" + DATE, "i")) || one(new RegExp("\\bdated?\\s*[:.\\-]?\\s*" + DATE, "i")));
  f.contractor = one(/M\s*\/\s*s\.?\s*[:\-]?\s*([A-Z][A-Za-z0-9 &.,()'\-]{3,80})/) || one(/name\s*of\s*(?:the\s*)?contractor\s*[:\-–.]*\s*([A-Za-z][^\n|]{3,80})/i);
  f.contractor = f.contractor.replace(/\s+(Address|GSTIN|PAN)\b.*$/i, "").replace(/^M\s*\/\s*s\.?\s*/i, "");
  if (f.contractor && !/^m\/s/i.test(f.contractor)) f.contractor = "M/s " + f.contractor;
  // Name of work: after the label, up to the next sentence that starts the letter or a numbered field.
  const wn = text.match(/(?:name\s*of\s*(?:the\s*)?work|कार्य\s*का\s*नाम|sub(?:ject)?\s*[:\-])\s*[:\-–.]*\s*([\s\S]{10,400}?)(?=\n\s*(?:your|by|with|आप|reference|ref\.|\d+\s*[-.)]|sir)|$)/i);
  f.workName = wn ? clean(wn[1]) : "";
  f.amount = num(one(/work\s*order\s*amount\s*[:\-–.]*\s*(?:rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i) || one(/contract\s*(?:amount|value)\s*[:\-–.]*\s*(?:rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i));
  const tp = text.match(/(\d+(?:\.\d+)?)\s*%\s*(below|above|less|excess|बिलो|कम|अधिक)/i);
  if (tp) { f.tpPct = num(tp[1]); f.tpDir = /above|excess|अधिक/i.test(tp[2]) ? "above" : "below"; }
  else if (/at\s*par/i.test(text)) { f.tpPct = 0; f.tpDir = "par"; }
  f.commence = isoDate(one(new RegExp("(?:date\\s*of\\s*commencement|commence(?:ment)?\\s*date)\\s*[:\\-–.]*\\s*" + DATE, "i")));
  f.stipulated = isoDate(one(new RegExp("(?:date\\s*of\\s*completion|completion\\s*date|stipulated\\s*date)\\s*[:\\-–.]*\\s*" + DATE, "i")));
  const per = text.match(/period\s*[:\-]?\s*(\d+)\s*(month|day|week)/i) || text.match(/within\s*(\d+)\s*(month|day|week)/i);
  f.period = per ? `${per[1]} ${per[2].toLowerCase()}s` : "";
  const eng = (re) => { const m = text.match(re); return m ? clean(m[1]).replace(/\s+(J\.?E\.?N|A\.?E\.?N|X\.?E\.?N|E\.?E)\b.*$/i, "") : ""; };
  f.jen = eng(/J\.?\s*E\.?\s*N\.?\s*[:\-.]?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/);
  f.aen = eng(/A\.?\s*E\.?\s*N\.?\s*[:\-.]?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/);
  f.xen = eng(/(?:X\.?\s*E\.?\s*N|Executive\s*Engineer)\.?\s*[:\-.,]?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/);
  const off = lines.find((l) => /(nagar\s*nigam|municipal\s*corporation|development\s*authority|public\s*works|p\.?w\.?d|phed|नगर\s*निगम|नगर\s*परिषद|नगर\s*पालिका|office\s*of)/i.test(l));
  f.office = off ? clean(off).replace(/^[^A-Za-z\u0900-\u097F]+/, "").replace(/^[a-z]\s*[:.]\s*/i, "").replace(/^office\s*of\s*(the\s*)?/i, "") : "";
  // H-Schedule item rates written in the order, e.g. "H-SCHEDULE / ITEM 1 - 480/-SQM"
  f.hRates = [...text.matchAll(/item\s*(?:no\.?)?\s*(\d+)\s*[-–:]\s*(?:rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*\/?-?\s*(?:per\s*)?([A-Za-z.]{2,6})?/gi)].map((m) => ({ item: m[1], rate: num(m[2]), unit: m[3] || "" }));
  // Terms: numbered lines under a "terms"/"conditions"/"notes" heading.
  const ti = lines.findIndex((l) => /^\W*(terms\s*(and|&)\s*conditions|conditions\s*of\s*(the\s*)?(contract|work\s*order)|general\s*conditions|शर्तें|शर्ते)/i.test(l));
  f.terms = ti >= 0 ? lines.slice(ti + 1).filter((l) => /^\s*(\d+|[a-z]|[ivx]+)[.)]\s+\S/i.test(l) && !/^\s*\d+\s*-\s*[A-Z]/.test(l)).slice(0, 30).map(clean) : [];
  return f;
}

// ---------------------------------------------------------------------------
// BOQ from text lines (scans, photos, other PDFs) or any spreadsheet
// ---------------------------------------------------------------------------

const UNIT_RE = `(${UNIT_WORDS.join("|")}|sq\\.?\\s*ft|sqft|kgs?|each|job|set)`;
const DATA_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}\\.?\\s+(?:rs\\.?\\s*)?(\\d[\\d,]*(?:\\.\\d+)?)`, "i");

const UNIT_ONLY = new RegExp(`^${UNIT_RE}$`, "i");
/** Quantity, unit, rate and amount at the end of an item's first line, e.g. "167.580 cum 1064.00 178305.12". */
function dataTail(line) {
  const re = /(\d[\d,]*\.\d{1,3}|\d+)\s*\|?\s*([A-Za-z.]{1,8})?\s*\|?\s*(\d[\d,]*\.\d{2})\s*\|?\s*(\d[\d,]*\.\d{2})?/g;
  let best = null;
  for (const m of line.matchAll(re)) {
    const q = num(m[1]), r = num(m[3]), a = m[4] ? num(m[4]) : null;
    const unitOk = m[2] && UNIT_ONLY.test(m[2].replace(/\.$/, ""));
    const amountOk = a != null && Math.abs(q * r - a) <= Math.max(1, a * 0.002);
    if (amountOk || unitOk) { best = { index: m.index, qty: q, unit: unitOk ? normaliseUnit(m[2]) : "", rate: r, sure: amountOk }; if (amountOk) break; }
  }
  return best;
}

export function parseBoqLines(lines) {
  const items = [];
  let sched = "G", cur = null, lastNo = 0;
  const push = () => { if (cur && cur.description) items.push(cur); cur = null; };
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (/item\s*rate\s*boq|h\s*[-–]?\s*schedule/i.test(line)) { push(); sched = "H"; if (line.length < 40) continue; }
    if (/percentage\s*boq|g\s*[-–]?\s*schedule/i.test(line)) { push(); sched = "G"; if (line.length < 40) continue; }
    if (/^total\s*in\s*figures|^quoted\s*rate/i.test(line)) { push(); continue; }
    const start = line.match(/^(\d{1,3}(?:\.\d{1,2})?)[\s.)|]+(?=[A-Za-z\u0900-\u097F(])(.*)$/);
    let body = start ? start[2] : line;
    const d = dataTail(body);
    // A new item starts at a serial number, or at a line carrying quantity/rate/amount when the current item already has them.
    if (start || (d && (!cur || cur.unit || cur.rate))) {
      push();
      const no = start ? start[1] : String(Math.floor(lastNo) + 1);
      lastNo = num(no) || lastNo + 1;
      cur = { schedule: sched, sno: no, description: "", quantity: 0, unit: "", rate: 0 };
    }
    if (!cur) continue;
    if (d && !cur.rate) { cur.quantity = d.qty; cur.unit = d.unit; cur.rate = d.rate; body = body.slice(0, d.index); }
    body = body.replace(/\|/g, " ").replace(/\bINR\b.*$/i, "").replace(/\b\d{5,}(?:\.\d+)?\b.*$/, "").replace(/\s+/g, " ").trim();
    if (body) cur.description += (cur.description ? " " : "") + body;
  }
  push();
  return items.filter((i) => i.description.length > 3);
}

/** BOQ from any spreadsheet: finds the header row with description / quantity / unit / rate. */
export function parseBoqRows(sheets) {
  const items = [];
  for (const { sheet, rows } of sheets) {
    let hdr = -1, cols = null;
    for (let r = 0; r < Math.min(rows.length, 40) && hdr < 0; r++) {
      const cells = rows[r].map((c) => String(c).toLowerCase());
      const find = (re) => cells.findIndex((c) => re.test(c));
      const desc = find(/description|particular|item\s*of\s*work|name\s*of\s*item/), qty = find(/^\s*(qty|quantity)|quantity/);
      if (desc >= 0 && qty >= 0) { hdr = r; cols = { sno: find(/^\s*(s\.?\s*no|sl\.?\s*no|sr\.?\s*no|item\s*no)/), desc, qty, unit: find(/^\s*units?\b|uom/), rate: find(/rate/) }; }
    }
    if (!cols) continue;
    const sched = /h|item\s*rate/i.test(sheet) && !/boq1$/i.test(sheet) ? "H" : "G";
    for (const r of rows.slice(hdr + 1)) {
      const d = String(r[cols.desc] ?? "").trim(), q = num(r[cols.qty]);
      if (!d || /^total/i.test(d) || /^\d+$/.test(d)) continue;
      items.push({ schedule: sched, sno: String(r[cols.sno] ?? "").trim(), description: d, quantity: q, unit: normaliseUnit(r[cols.unit] ?? ""), rate: num(r[cols.rate]) });
    }
  }
  return items;
}
