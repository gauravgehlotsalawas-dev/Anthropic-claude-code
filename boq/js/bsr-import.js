// Reading schedules of rates from Excel, CSV, PDF, Word, HTML, JSON and plain text.
import * as pdfjsLib from "../vendor/pdf.min.mjs";
import { unzipSync, strFromU8 } from "../vendor/libs.mjs";
import { num, uid } from "./store.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
export { pdfjsLib };

const XLSX = window.XLSX;

export const UNIT_WORDS = [
  "cum", "cu\\.?\\s?m", "m3", "m³", "cubic metre", "cubic meter",
  "sqm", "sq\\.?\\s?m", "m2", "m²", "square metre", "square meter", "sq\\.?\\s?mtr",
  "rmt", "r\\.?m", "rm", "running metre", "metre", "meter", "mtr", "m", "km", "mm",
  "kg", "kgs", "quintal", "qtl", "tonne", "tonnes", "ton", "mt", "m\\.?t",
  "no", "nos", "no\\.", "number", "each", "ea", "pcs", "piece", "set", "pair", "point", "points",
  "ltr", "litre", "liter", "kl",
  "sqft", "sq\\.?\\s?ft", "cft", "cu\\.?\\s?ft", "rft", "r\\.?ft",
  "job", "ls", "l\\.?s", "lump\\s?sum", "lumpsum", "hour", "hr", "day", "month", "trip", "kw", "kva", "%",
  "100\\s?sqm", "10\\s?sqm", "100\\s?kg", "10\\s?m", "100\\s?m", "1000\\s?nos", "100\\s?nos",
];
const UNIT_ALT = UNIT_WORDS.join("|");
const RATE = "(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|\\d+\\.\\d{1,2}|\\d{2,})";
const TAIL_UNIT_RATE = new RegExp(`(?:^|[\\s|])(?:per\\s+)?(${UNIT_ALT})\\.?\\s*(?:\\|\\s*)*(?:Rs\\.?|₹|INR)?\\s*${RATE}\\s*(?:\\|\\s*)*$`, "i");
const TAIL_RATE_UNIT = new RegExp(`(?:^|[\\s|])(?:Rs\\.?|₹|INR)?\\s*${RATE}\\s*(?:\\|\\s*)*(?:per|/)?\\s*(${UNIT_ALT})\\.?\\s*$`, "i");
const CODE_RE = /^\s*((?:[A-Z]{1,5}[-/ ]?)?\d{1,3}(?:[.\-/]\d{1,3}){0,5}[A-Z]?(?:\s?\([a-z0-9]{1,4}\))?)[.)]?\s+(.+)$/i;
const SUB_RE = /^\s*\(?((?:[a-h]|[ivx]{1,4}|\d{1,2}))\)\s+(.+)$/i;
const NOT_CODE_FOLLOW = new RegExp(`^(${UNIT_ALT}|thick|dia|mm|cm|x|×|layers?|coats?)\\b`, "i");

// ---------------------------------------------------------------------------
// File → raw content
// ---------------------------------------------------------------------------

/**
 * Returns { kind: "table", sheets: [{name, rows}] } or { kind: "lines", lines: [string], pages, hasText }
 */
export async function readRateFile(file, onProgress = () => {}) {
  const name = file.name.toLowerCase();
  const ext = name.split(".").pop();
  if (["xlsx", "xls", "xlsm", "xlsb", "ods", "csv", "tsv", "html", "htm"].includes(ext)) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: false });
    const sheets = wb.SheetNames.map((n) => ({
      name: n,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: false, blankrows: false }),
    })).filter((s) => s.rows.length);
    return { kind: "table", sheets };
  }
  if (ext === "json") {
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data) ? data : data.items || [];
    return { kind: "items", items };
  }
  if (ext === "pdf") return readPdf(file, onProgress);
  if (ext === "docx") return readDocx(file);
  // Plain text fallback
  const text = await file.text();
  if (text.includes("\t")) {
    return { kind: "table", sheets: [{ name: file.name, rows: text.split(/\r?\n/).filter(Boolean).map((l) => l.split("\t")) }] };
  }
  return { kind: "lines", lines: text.split(/\r?\n/), pages: 1, hasText: true };
}

export async function readPdf(file, onProgress = () => {}) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const lines = [];
  const pageTexts = [];
  let chars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress(`Reading page ${p} of ${pdf.numPages}`);
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageLines = groupTextIntoLines(tc.items);
    chars += pageLines.join("").length;
    pageTexts.push(pageLines.join("\n"));
    lines.push(...pageLines);
  }
  return { kind: "lines", lines, pageTexts, pages: pdf.numPages, hasText: chars > pdf.numPages * 40, pdf, buffer: buf };
}

/** Rebuild visual lines from pdf.js text items; large horizontal gaps become " | " column markers. */
export function groupTextIntoLines(items) {
  const parts = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || 8, s: it.str }));
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const p of parts) {
    const row = rows.find((r) => Math.abs(r.y - p.y) <= Math.max(2, p.h * 0.35));
    if (row) row.parts.push(p);
    else rows.push({ y: p.y, parts: [p] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x);
    let out = "";
    let lastEnd = null;
    for (const p of r.parts) {
      if (lastEnd != null) {
        const gap = p.x - lastEnd;
        out += gap > p.h * 1.8 ? " | " : gap > p.h * 0.15 ? " " : "";
      }
      out += p.s;
      lastEnd = p.x + p.w;
    }
    return out.replace(/\s+/g, " ").trim();
  });
}

async function readDocx(file) {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const xml = strFromU8(files["word/document.xml"] || new Uint8Array());
  const text = (frag) =>
    (frag.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
      .map((t) => (t.startsWith("<w:t") && !t.startsWith("<w:tab") ? t.replace(/<[^>]+>/g, "") : " "))
      .join("")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .trim();
  const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  if (tables.length) {
    const rows = [];
    for (const t of tables) {
      for (const tr of t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
        rows.push((tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map((tc) =>
          (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(text).filter(Boolean).join(" ")));
      }
    }
    return { kind: "table", sheets: [{ name: file.name, rows }] };
  }
  const paras = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(text);
  return { kind: "lines", lines: paras, pages: 1, hasText: true };
}

// ---------------------------------------------------------------------------
// Tables → items
// ---------------------------------------------------------------------------

const HEAD = {
  code: /^(s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|item\s*(no\.?|code|number|ref)|code|ref\.?|ssr\s*no\.?|dsr\s*no\.?|bsr\s*no\.?|sor\s*no\.?|no\.?|item\s*#)$/i,
  description: /(description|particulars|item\s+of\s+work|specification|name\s+of\s+(the\s+)?item|^items?$|^work$|details)/i,
  unit: /^(unit|units|uom|u\.o\.m\.?|per|unit\s+of\s+measurement)$/i,
  rate: /(rate|price|cost|amount)/i,
};

export function detectMapping(rows) {
  let best = { score: 0, headerRow: -1, cols: {} };
  const limit = Math.min(rows.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = rows[r].map((c) => String(c).trim());
    const cols = {};
    let score = 0;
    row.forEach((c, i) => {
      if (!c || c.length > 60) return;
      for (const key of ["code", "unit", "description", "rate"]) {
        if (cols[key] == null && HEAD[key].test(c)) {
          if (key === "rate" && /words/i.test(c)) continue;
          cols[key] = i; score += key === "rate" || key === "description" ? 2 : 1; break;
        }
      }
    });
    // Prefer a column literally named "rate" over "amount".
    const rateIdx = row.findIndex((c) => /\brate\b/i.test(c) && !/words/i.test(c));
    if (rateIdx >= 0) cols.rate = rateIdx;
    if (score > best.score) best = { score, headerRow: r, cols };
  }
  if (best.score >= 3 && best.cols.description != null && best.cols.rate != null) return best;
  return guessMapping(rows);
}

function guessMapping(rows) {
  const sample = rows.slice(0, 300);
  const width = Math.max(...sample.map((r) => r.length), 0);
  const stats = Array.from({ length: width }, (_, i) => {
    let numeric = 0, textLen = 0, unitLike = 0, codeLike = 0, filled = 0;
    const unitRe = new RegExp(`^(${UNIT_ALT})\\.?$`, "i");
    for (const r of sample) {
      const c = String(r[i] ?? "").trim();
      if (!c) continue;
      filled++;
      if (/^[₹$]?\s*[\d,]+(\.\d+)?$/.test(c)) numeric++;
      if (unitRe.test(c)) unitLike++;
      if (/^[A-Z]{0,5}[-/ ]?\d{1,3}([.\-/]\d{1,3}){0,5}[A-Z]?$/i.test(c)) codeLike++;
      textLen += c.length;
    }
    return { i, numeric, avgLen: filled ? textLen / filled : 0, unitLike, codeLike, filled };
  });
  const by = (f) => [...stats].sort((a, b) => f(b) - f(a))[0]?.i;
  const description = by((s) => s.avgLen * (s.filled > 2 ? 1 : 0));
  const unit = by((s) => (s.i === description ? -1 : s.unitLike));
  const rate = by((s) => (s.i === description || s.i === unit ? -1 : s.numeric * 1000 + s.i));
  const code = by((s) => ([description, unit, rate].includes(s.i) ? -1 : s.codeLike));
  return { score: 0, headerRow: -1, cols: { code: stats[code]?.codeLike ? code : undefined, description, unit: stats[unit]?.unitLike ? unit : undefined, rate } };
}

/** Convert table rows into rate items. Rows without a rate become parent descriptions or chapters. */
export function rowsToItems(rows, mapping, chapterDefault = "") {
  const { cols, headerRow } = mapping;
  const get = (r, k) => (cols[k] == null ? "" : String(r[cols[k]] ?? "").replace(/\s+/g, " ").trim());
  const items = [];
  let chapter = chapterDefault;
  let parent = null;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some((c) => String(c).trim())) continue;
    const code = get(r, "code");
    let description = get(r, "description");
    const unit = get(r, "unit");
    const rateText = get(r, "rate");
    const rate = num(rateText);
    const filled = r.filter((c) => String(c).trim()).length;
    if (!description && !rate) continue;
    if (rate > 0 && /[a-z]/i.test(description || code)) {
      const isSub = SUB_RE.test(description) || /\([a-z0-9]{1,4}\)$/i.test(code) || (!code && parent);
      let full = description;
      let fullCode = code;
      if (parent && isSub && parent.description && !description.startsWith(parent.description)) {
        full = `${parent.description} — ${description}`;
        if (!code && parent.code) fullCode = parent.code + subSuffix(description);
      }
      items.push(makeItem(fullCode, full, unit, rate, chapter));
    } else if (description && !rate) {
      const looksChapter = filled === 1 && description.length < 120 && (!code || /^(chapter|section|part)\b/i.test(description) || description === description.toUpperCase());
      if (looksChapter) { chapter = cleanChapter(description); parent = null; }
      else parent = { code, description };
    }
  }
  return items;
}

const subSuffix = (desc) => {
  const m = desc.match(SUB_RE);
  return m ? `(${m[1].toLowerCase()})` : "";
};
const cleanChapter = (s) => s.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);

export function makeItem(code, description, unit, rate, chapter = "") {
  return {
    id: uid("i"),
    code: String(code || "").trim(),
    description: String(description || "").replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim(),
    unit: normaliseUnit(unit),
    rate: Math.round(num(rate) * 100) / 100,
    chapter: chapter || "",
  };
}

export function normaliseUnit(u) {
  const s = String(u || "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return "";
  const map = [
    [/^(cum|cu\.?\s?m|m3|m³|cubic\s+met(re|er)s?)$/, "cum"],
    [/^(sqm|sq\.?\s?m|m2|m²|sq\.?\s?mtr|square\s+met(re|er)s?)$/, "sqm"],
    [/^(rmt|r\.?m|rm|running\s+metre|met(re|er)s?|mtr|m)$/, "m"],
    [/^(no|nos|no\.|number|numbers|each|ea|pcs|piece)$/, "nos"],
    [/^(kg|kgs)$/, "kg"],
    [/^(tonnes?|tons?|mt|m\.t)$/, "tonne"],
    [/^(qtl|quintal)$/, "quintal"],
    [/^(ltr|litre|liter)s?$/, "litre"],
    [/^(ls|l\.s|lump\s?sum)$/, "LS"],
  ];
  for (const [re, v] of map) if (re.test(s)) return v;
  return String(u).trim();
}

// ---------------------------------------------------------------------------
// Text lines (PDF / Word / txt) → items
// ---------------------------------------------------------------------------

export function linesToItems(lines) {
  const items = [];
  let chapter = "";
  let parent = null;
  let cur = null;

  const flush = () => {
    if (!cur) return;
    if (cur.rate > 0) items.push(makeItem(cur.code, cur.desc.join(" "), cur.unit, cur.rate, chapter));
    else if (cur.desc.join(" ").length < 4000) parent = { code: cur.code, description: cur.desc.join(" ").replace(/\s*\|\s*/g, " ").trim(), sub: cur.sub };
    cur = null;
  };

  for (let raw of lines) {
    let line = String(raw || "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/^(page\s*\d+|\d+\s*of\s*\d+|-\s*\d+\s*-)$/i.test(line)) continue;
    if (/^\|?\s*(s\.?\s?no|item\s*no|code)\b.*\b(description|particulars)\b/i.test(line)) continue;

    const tail = matchTail(line);
    const body = tail ? line.slice(0, tail.index).replace(/[\s|]+$/, "") : line;

    let m;
    if ((m = body.match(CODE_RE)) && !NOT_CODE_FOLLOW.test(m[2]) && isPlausibleCode(m[1])) {
      flush();
      cur = { code: m[1].trim(), desc: [m[2]], unit: "", rate: 0 };
    } else if ((m = body.match(SUB_RE)) && (parent || cur)) {
      const base = cur && !cur.rate ? { code: cur.code, description: cur.desc.join(" ") } : parent;
      if (cur && !cur.rate) { parent = base; cur = null; } else flush();
      cur = { code: (base?.code || "") + `(${m[1].toLowerCase()})`, desc: [base?.description ? `${base.description} —` : "", `(${m[1].toLowerCase()}) ${m[2]}`].filter(Boolean), unit: "", rate: 0, sub: true };
    } else if (!cur && !tail && isHeading(line)) {
      chapter = cleanChapter(line);
      parent = null;
      continue;
    } else if (cur && !cur.rate) {
      if (body) cur.desc.push(body);
    } else if (tail) {
      // A rate line following a finished item: a new un-coded sub item.
      flush();
      const base = parent;
      cur = { code: base?.code || "", desc: [base?.description ? `${base.description} —` : "", body].filter(Boolean), unit: "", rate: 0, sub: true };
    } else {
      // Text after a priced item: start of a new un-coded description.
      flush();
      cur = { code: "", desc: [body], unit: "", rate: 0 };
    }

    if (tail && cur) {
      cur.unit = tail.unit;
      cur.rate = tail.rate;
      const done = cur;
      flush();
      // Keep the parent for following sub items.
      if (!done.sub && parent && parent.code === done.code) parent = null;
    }
  }
  flush();
  return items.filter((it) => it.description.length > 2);
}

function matchTail(line) {
  let m = line.match(TAIL_UNIT_RATE);
  if (m) return { index: m.index, unit: m[1], rate: num(m[2]) };
  m = line.match(TAIL_RATE_UNIT);
  if (m) return { index: m.index, unit: m[2], rate: num(m[1]) };
  return null;
}

function isPlausibleCode(c) {
  const s = c.replace(/\s/g, "");
  if (/[.\-/()]/.test(s) || /[A-Z]/i.test(s)) return true;
  return Number(s) < 400;
}

function isHeading(line) {
  const clean = line.replace(/[|]/g, " ").trim();
  if (clean.length > 120 || clean.length < 4) return false;
  if (/^(chapter|section|part|sub[- ]head)\b/i.test(clean)) return true;
  const letters = clean.replace(/[^a-z]/gi, "");
  return letters.length > 5 && letters === letters.toUpperCase();
}

/** Stats used for import preview quality hints. */
export function summarise(items) {
  const chapters = new Set(items.map((i) => i.chapter).filter(Boolean));
  const noUnit = items.filter((i) => !i.unit).length;
  return { count: items.length, chapters: chapters.size, noUnit };
}
