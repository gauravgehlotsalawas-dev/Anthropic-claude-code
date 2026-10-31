// Turning drawing files of many formats into something Claude can read, plus a local DXF measurer.
import { unzipSync, strFromU8 } from "../vendor/libs.mjs";
import { pdfjsLib } from "./bsr-import.js";

const XLSX = window.XLSX;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_EDGE = 2576;

export function bytesToBase64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}
const dataUrlToBase64 = (u) => u.slice(u.indexOf(",") + 1);

/**
 * Prepare one uploaded file. Returns { parts: [...for Claude], dxf?: parsed, warning?: string }.
 * Each part is { kind: "pdf"|"image"|"text", name, mediaType, data|text, note }.
 */
export async function prepareDrawing(file, onProgress = () => {}) {
  const name = file.name;
  const ext = name.toLowerCase().split(".").pop();

  if (ext === "pdf") {
    if (file.size <= MAX_PDF_BYTES) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { parts: [{ kind: "pdf", name, mediaType: "application/pdf", data: bytesToBase64(bytes) }] };
    }
    onProgress(`${name} is large; converting pages to images`);
    return { parts: await pdfToImages(file, 20), warning: "Large PDF: the first 20 pages were sent as images." };
  }

  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"].includes(ext)) {
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch {
      throw new Error(`${name}: this browser cannot open .${ext} images. Save it as PNG, JPG or PDF and upload again.`);
    }
    return { parts: await bitmapToParts(bitmap, name) };
  }

  if (ext === "svg") {
    const text = await file.text();
    const bitmap = await svgToBitmap(text);
    const textInSvg = (text.match(/<text[\s\S]*?<\/text>/g) || []).map((t) => t.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    const parts = await bitmapToParts(bitmap, name);
    if (textInSvg.length) parts.push({ kind: "text", name: `${name} (text labels)`, text: textInSvg.join("\n").slice(0, 20000) });
    return { parts };
  }

  if (ext === "dxf") {
    const dxf = parseDxf(await file.text());
    const bitmap = await renderDxf(dxf);
    const parts = await bitmapToParts(bitmap, name, "rendered from DXF; line weights and hatches are simplified");
    parts.push({ kind: "text", name: `${name} (CAD data)`, text: dxfSummaryText(dxf) });
    return { parts, dxf };
  }

  if (ext === "cdr") return { parts: await cdrPreview(file), warning: "CorelDRAW file: the embedded preview image was used. For best accuracy export the drawing to PDF from CorelDRAW (File → Export → PDF)." };

  if (ext === "dwg") {
    throw new Error(`${name}: DWG is a closed AutoCAD format that cannot be read in the browser. In AutoCAD or any free viewer, use Save As → DXF (or Plot → PDF) and upload that.`);
  }

  if (["xlsx", "xls", "ods", "csv"].includes(ext)) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const text = wb.SheetNames.map((n) => `# Sheet: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
    return { parts: [{ kind: "text", name, text: text.slice(0, 400000) }] };
  }
  if (ext === "docx") {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const xml = strFromU8(files["word/document.xml"] || new Uint8Array());
    const text = xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    return { parts: [{ kind: "text", name, text: text.slice(0, 400000) }] };
  }
  if (["txt", "md"].includes(ext)) return { parts: [{ kind: "text", name, text: (await file.text()).slice(0, 400000) }] };

  throw new Error(`${name}: .${ext} files are not supported. Export the drawing as PDF, DXF or an image.`);
}

// ---------- images ----------

function canvasFor(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function encode(canvas) {
  // PNG keeps thin drawing lines sharp; fall back to JPEG if it is too big for the API.
  let url = canvas.toDataURL("image/png");
  let mediaType = "image/png";
  if (url.length > 4.8e6) { url = canvas.toDataURL("image/jpeg", 0.9); mediaType = "image/jpeg"; }
  if (url.length > 4.8e6) url = canvas.toDataURL("image/jpeg", 0.75);
  return { mediaType, data: dataUrlToBase64(url) };
}

/** Large drawings are sent as an overview plus overlapping tiles so small dimension text stays readable. */
export async function bitmapToParts(bitmap, name, note = "") {
  const W = bitmap.width, H = bitmap.height;
  const parts = [];
  const scale = Math.min(1, MAX_EDGE / Math.max(W, H));
  const ov = canvasFor(W * scale, H * scale);
  const octx = ov.getContext("2d");
  octx.fillStyle = "#fff"; octx.fillRect(0, 0, ov.width, ov.height);
  octx.drawImage(bitmap, 0, 0, ov.width, ov.height);
  parts.push({ kind: "image", name, note: [note, scale < 1 ? "overview of the whole sheet" : ""].filter(Boolean).join("; "), ...encode(ov) });

  if (Math.max(W, H) > MAX_EDGE * 1.4) {
    const cols = W >= H ? 3 : 2, rows = W >= H ? 2 : 3;
    const tw = W / cols, th = H / rows, pad = 0.08;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const sx = Math.max(0, (c - pad) * tw), sy = Math.max(0, (r - pad) * th);
      const sw = Math.min(W - sx, tw * (1 + 2 * pad)), sh = Math.min(H - sy, th * (1 + 2 * pad));
      const s = Math.min(1, MAX_EDGE / Math.max(sw, sh));
      const t = canvasFor(sw * s, sh * s);
      const ctx = t.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, t.width, t.height);
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, t.width, t.height);
      parts.push({ kind: "image", name: `${name} tile r${r + 1}c${c + 1}`, note: `zoomed tile, row ${r + 1} of ${rows}, column ${c + 1} of ${cols}, edges overlap`, ...encode(t) });
    }
  }
  return parts;
}

async function svgToBitmap(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  let w = parseFloat(svg.getAttribute("width")) || 0, h = parseFloat(svg.getAttribute("height")) || 0;
  const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb.length === 4) { w = vb[2]; h = vb[3]; }
  if (!w || !h) { w = 2000; h = 1400; }
  const k = 3000 / Math.max(w, h);
  svg.setAttribute("width", w * k); svg.setAttribute("height", h * k);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("Could not render the SVG file.")); img.src = url; });
    const c = canvasFor(w * k, h * k);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await createImageBitmap(c);
  } finally { URL.revokeObjectURL(url); }
}

export async function pdfToImages(file, maxPages = 20, scale = 2) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  return pdfDocToImages(pdf, 1, Math.min(pdf.numPages, maxPages), scale, file.name);
}

export async function pdfDocToImages(pdf, from, to, scale = 2, name = "page") {
  const parts = [];
  for (let p = from; p <= to; p++) {
    const page = await pdf.getPage(p);
    let vp = page.getViewport({ scale });
    const k = Math.min(1, MAX_EDGE / Math.max(vp.width, vp.height));
    vp = page.getViewport({ scale: scale * k });
    const c = canvasFor(vp.width, vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const url = c.toDataURL("image/jpeg", 0.85);
    parts.push({ kind: "image", name: `${name} p${p}`, page: p, mediaType: "image/jpeg", data: dataUrlToBase64(url) });
  }
  return parts;
}

// ---------- CorelDRAW ----------

async function cdrPreview(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    throw new Error(`${file.name}: this is an older CorelDRAW file (before X4) that browsers cannot read. Open it in CorelDRAW and use File → Export → PDF, then upload the PDF.`);
  }
  const files = unzipSync(bytes);
  const candidates = Object.keys(files).filter((k) => /\.(png|jpe?g|bmp)$/i.test(k) && /(thumb|preview|page)/i.test(k));
  candidates.sort((a, b) => files[b].length - files[a].length);
  if (!candidates.length) {
    throw new Error(`${file.name}: no preview image is stored in this CorelDRAW file. Export it to PDF from CorelDRAW and upload the PDF.`);
  }
  const key = candidates[0];
  const type = /png$/i.test(key) ? "image/png" : /bmp$/i.test(key) ? "image/bmp" : "image/jpeg";
  const bitmap = await createImageBitmap(new Blob([files[key]], { type }));
  const parts = await bitmapToParts(bitmap, file.name, "low-resolution preview embedded in the CorelDRAW file");
  // Text strings sometimes survive in the XML parts of newer CDR files.
  const texts = Object.keys(files).filter((k) => /\.xml$/i.test(k)).map((k) => strFromU8(files[k]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter((t) => t.length > 20);
  if (texts.length) parts.push({ kind: "text", name: `${file.name} (embedded text)`, text: texts.join("\n").slice(0, 20000) });
  return parts;
}

// ---------- DXF ----------

const INSUNITS_TO_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

export function parseDxf(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);

  let insunits = 0;
  const entities = [];
  let section = null, i = 0, inBlocks = false;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === 0 && val === "SECTION") { section = pairs[i + 1]?.[1]; inBlocks = section === "BLOCKS"; i += 2; continue; }
    if (code === 0 && val === "ENDSEC") { section = null; inBlocks = false; i++; continue; }
    if (section === "HEADER" && code === 9 && val === "$INSUNITS") { insunits = parseInt(pairs[i + 1][1], 10); i += 2; continue; }
    if (section === "ENTITIES" && code === 0 && !inBlocks) {
      const ent = { type: val, props: [] };
      i++;
      while (i < pairs.length && pairs[i][0] !== 0) { ent.props.push(pairs[i]); i++; }
      if (ent.type === "POLYLINE") {
        ent.vertices = [];
        while (i < pairs.length && pairs[i][1] !== "SEQEND") {
          if (pairs[i][0] === 0 && pairs[i][1] === "VERTEX") {
            const v = { props: [] }; i++;
            while (i < pairs.length && pairs[i][0] !== 0) { v.props.push(pairs[i]); i++; }
            ent.vertices.push(v);
          } else i++;
        }
      }
      entities.push(ent);
      continue;
    }
    i++;
  }

  const g = (props, c) => { const p = props.find((x) => x[0] === c); return p ? p[1] : undefined; };
  const gn = (props, c) => parseFloat(g(props, c) ?? "0") || 0;
  const all = (props, c) => props.filter((x) => x[0] === c).map((x) => parseFloat(x[1]) || 0);

  const layers = {};
  const shapes = [];
  const texts = [];
  const L = (name) => (layers[name] ||= { name, length: 0, area: 0, closed: 0, open: 0, blocks: {}, texts: 0 });

  for (const e of entities) {
    const layer = g(e.props, 8) || "0";
    const lay = L(layer);
    switch (e.type) {
      case "LINE": {
        const a = [gn(e.props, 10), gn(e.props, 20)], b = [gn(e.props, 11), gn(e.props, 21)];
        lay.length += Math.hypot(b[0] - a[0], b[1] - a[1]); lay.open++;
        shapes.push({ t: "poly", layer, pts: [a, b], closed: false });
        break;
      }
      case "LWPOLYLINE": case "POLYLINE": {
        let pts, bulges;
        if (e.type === "LWPOLYLINE") {
          const xs = all(e.props, 10), ys = all(e.props, 20);
          pts = xs.map((x, k) => [x, ys[k] ?? 0]);
          bulges = bulgesForLw(e.props, pts.length);
        } else {
          pts = e.vertices.map((v) => [gn(v.props, 10), gn(v.props, 20)]);
          bulges = e.vertices.map((v) => gn(v.props, 42));
        }
        const closed = (parseInt(g(e.props, 70) || "0", 10) & 1) === 1 ||
          (pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-6);
        lay.length += polyLength(pts, bulges, closed);
        if (closed && pts.length > 2) { lay.area += Math.abs(shoelace(pts)); lay.closed++; } else lay.open++;
        shapes.push({ t: "poly", layer, pts, closed });
        break;
      }
      case "CIRCLE": {
        const r = gn(e.props, 40);
        lay.length += 2 * Math.PI * r; lay.area += Math.PI * r * r; lay.closed++;
        shapes.push({ t: "circle", layer, c: [gn(e.props, 10), gn(e.props, 20)], r });
        break;
      }
      case "ARC": {
        const r = gn(e.props, 40);
        let a0 = gn(e.props, 50), a1 = gn(e.props, 51);
        let sweep = a1 - a0; if (sweep <= 0) sweep += 360;
        lay.length += (Math.PI * r * sweep) / 180; lay.open++;
        shapes.push({ t: "arc", layer, c: [gn(e.props, 10), gn(e.props, 20)], r, a0, a1: a0 + sweep });
        break;
      }
      case "TEXT": case "MTEXT": {
        const s = (e.props.filter((x) => x[0] === 1 || x[0] === 3).map((x) => x[1]).join("")).replace(/\\P/g, " ").replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "");
        if (s.trim()) { texts.push({ layer, s: s.trim(), x: gn(e.props, 10), y: gn(e.props, 20), h: gn(e.props, 40) }); lay.texts++; }
        break;
      }
      case "DIMENSION": {
        const over = g(e.props, 1);
        const meas = gn(e.props, 42);
        const s = over && over !== "<>" ? over.replace("<>", meas.toFixed(0)) : meas ? meas.toFixed(meas < 100 ? 2 : 0) : "";
        if (s) texts.push({ layer, s, x: gn(e.props, 11) || gn(e.props, 10), y: gn(e.props, 21) || gn(e.props, 20), h: 0, dim: true });
        break;
      }
      case "INSERT": {
        const name = g(e.props, 2) || "?";
        lay.blocks[name] = (lay.blocks[name] || 0) + 1;
        break;
      }
    }
  }
  const unitToM = INSUNITS_TO_M[insunits] ?? null;
  return { insunits, unitToM, layers: Object.values(layers).sort((a, b) => b.length - a.length), shapes, texts };
}

function bulgesForLw(props, n) {
  // Bulge (42) belongs to the vertex (10) before it.
  const out = new Array(n).fill(0);
  let k = -1;
  for (const [c, v] of props) { if (c === 10) k++; else if (c === 42 && k >= 0) out[k] = parseFloat(v) || 0; }
  return out;
}

function polyLength(pts, bulges, closed) {
  let len = 0;
  const n = pts.length;
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bu = bulges?.[k] || 0;
    if (bu) { const theta = 4 * Math.atan(Math.abs(bu)); len += (chord / 2 / Math.sin(theta / 2)) * theta; }
    else len += chord;
  }
  return len;
}

function shoelace(pts) {
  let s = 0;
  for (let k = 0; k < pts.length; k++) { const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % pts.length]; s += x1 * y2 - x2 * y1; }
  return s / 2;
}

function dxfBounds(dxf) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const s of dxf.shapes) {
    if (s.t === "poly") s.pts.forEach(([x, y]) => add(x, y));
    else { add(s.c[0] - s.r, s.c[1] - s.r); add(s.c[0] + s.r, s.c[1] + s.r); }
  }
  for (const t of dxf.texts) add(t.x, t.y);
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

export async function renderDxf(dxf, size = 3600) {
  const b = dxfBounds(dxf);
  const w = b.maxX - b.minX || 1, h = b.maxY - b.minY || 1;
  const k = (size - 80) / Math.max(w, h);
  const c = canvasFor(w * k + 80, h * k + 80);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  const X = (x) => 40 + (x - b.minX) * k, Y = (y) => c.height - 40 - (y - b.minY) * k;
  ctx.strokeStyle = "#000"; ctx.lineWidth = 1.2;
  for (const s of dxf.shapes) {
    ctx.beginPath();
    if (s.t === "poly") { s.pts.forEach(([x, y], n) => (n ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); if (s.closed) ctx.closePath(); }
    else if (s.t === "circle") ctx.arc(X(s.c[0]), Y(s.c[1]), s.r * k, 0, Math.PI * 2);
    else ctx.arc(X(s.c[0]), Y(s.c[1]), s.r * k, (-s.a0 * Math.PI) / 180, (-s.a1 * Math.PI) / 180, true);
    ctx.stroke();
  }
  ctx.fillStyle = "#003399";
  for (const t of dxf.texts) {
    const px = Math.max(11, Math.min(40, (t.h || 0) * k || 13));
    ctx.font = `${px}px sans-serif`;
    ctx.fillText(t.s.slice(0, 60), X(t.x), Y(t.y));
  }
  return createImageBitmap(c);
}

export function dxfSummaryText(dxf) {
  const u = dxf.unitToM ? `drawing units = ${dxf.unitToM} m (INSUNITS ${dxf.insunits})` : "drawing units not declared (often mm)";
  const lines = [`DXF measurement summary; ${u}.`, "Per layer: total line length (drawing units), total closed area (drawing units²), closed shapes, blocks."];
  for (const l of dxf.layers) {
    const blocks = Object.entries(l.blocks).map(([n, c]) => `${n}×${c}`).join(", ");
    lines.push(`- ${l.name}: length ${l.length.toFixed(1)}, area ${l.area.toFixed(1)}, closed ${l.closed}, open ${l.open}${blocks ? `, blocks ${blocks}` : ""}`);
  }
  const t = dxf.texts.slice(0, 1500).map((x) => `${x.dim ? "[dim] " : ""}${x.s} @(${x.x.toFixed(0)},${x.y.toFixed(0)}) layer ${x.layer}`);
  if (t.length) lines.push("", "Text and dimension values:", ...t);
  return lines.join("\n");
}
