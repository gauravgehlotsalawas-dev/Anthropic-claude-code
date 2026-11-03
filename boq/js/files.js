// Shared helpers for photos, documents and backups: EXIF date/GPS, GPS stamping,
// thumbnails, a small ZIP writer, and PDF merging (pdf-lib, loaded only when needed).
import { idb, uid } from "./store.js";

// ---------------------------------------------------------------------------
// File records (IndexedDB "files"): photos, documents, purchase bills
// ---------------------------------------------------------------------------

/** owner: a site id or "company". kind: "photo" | "doc" | "bill". */
export async function saveFile(blob, { owner, kind, folder = "", name = "", date = "", caption = "", gps = null, thumb = "", extra = {} }) {
  askPersist();
  const rec = { id: uid("f"), owner, kind, folder, name: name || blob.name || `${kind}-${Date.now()}`, type: blob.type || "", size: blob.size,
    blob, date: date || new Date().toISOString(), added: Date.now(), caption, gps, thumb, ...extra };
  await idb.put("files", rec);
  return rec;
}
export const allFiles = () => idb.all("files");
export const putFile = (f) => idb.put("files", f);
export const delFile = (id) => idb.del("files", id);

let persistAsked = false;
/** Ask the browser to keep this site's data (otherwise Safari may clear it after weeks without use). */
export function askPersist() {
  if (persistAsked) return; persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

export async function storageInfo() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0, persisted: await navigator.storage.persisted?.() }; }
  catch { return null; }
}
export const mb = (n) => `${(n / 1048576).toFixed(n > 104857600 ? 0 : 1)} MB`;

// ---------------------------------------------------------------------------
// EXIF: date taken and GPS position from JPEG photos
// ---------------------------------------------------------------------------

export async function readExif(blob) {
  try {
    const buf = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return {};
    let off = 2;
    while (off + 4 < buf.byteLength) {
      const marker = buf.getUint16(off), len = buf.getUint16(off + 2);
      if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) return parseTiff(buf, off + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
  } catch { /* not a readable JPEG */ }
  return {};
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
  const ifd = (o) => { const n = u16(o), tags = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 }; } return tags; };
  const str = (tag) => { if (!tag) return ""; const o = tag.count > 4 ? u32(tag.at) : tag.at; let s = ""; for (let i = 0; i < tag.count - 1; i++) s += String.fromCharCode(v.getUint8(t + o + i)); return s; };
  const rats = (tag) => { if (!tag) return null; const o = u32(tag.at), out = []; for (let i = 0; i < tag.count; i++) out.push(u32(o + i * 8) / (u32(o + i * 8 + 4) || 1)); return out; };
  const out = {};
  const ifd0 = ifd(u32(4));
  const exifPtr = ifd0[0x8769], gpsPtr = ifd0[0x8825];
  if (exifPtr) { const ex = ifd(u32(exifPtr.at)); const d = str(ex[0x9003]) || str(ifd0[0x0132]); if (d) { const m = d.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); if (m) out.date = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString(); } }
  if (gpsPtr) {
    const g = ifd(u32(gpsPtr.at));
    const lat = rats(g[2]), lon = rats(g[4]);
    if (lat && lon) {
      const dec = (a) => a[0] + a[1] / 60 + a[2] / 3600;
      const latRef = String.fromCharCode(v.getUint8(t + g[1].at)), lonRef = String.fromCharCode(v.getUint8(t + g[3].at));
      out.gps = { lat: dec(lat) * (latRef === "S" ? -1 : 1), lon: dec(lon) * (lonRef === "W" ? -1 : 1), from: "exif" };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export function getPosition(timeout = 12000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => resolve(null), { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}
/** Address from OpenStreetMap (needs internet; returns "" when offline). */
export async function reverseGeocode(lat, lon) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=en&lat=${lat}&lon=${lon}`, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json(); const a = j.address || {};
    return [a.road || a.neighbourhood || a.suburb, a.village || a.town || a.city || a.county, a.state, a.postcode].filter(Boolean).join(", ") || j.display_name || "";
  } catch { return ""; }
}
export const fmtLatLon = (g) => g ? `Lat ${Math.abs(g.lat).toFixed(6)}° ${g.lat >= 0 ? "N" : "S"}, Long ${Math.abs(g.lon).toFixed(6)}° ${g.lon >= 0 ? "E" : "W"}${g.acc ? ` (±${g.acc} m)` : ""}` : "";
export const fmtDateTime = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); let h = d.getHours(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())} ${ap} ${d.toLocaleDateString("en-IN", { weekday: "short" })}`; };

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be opened.")); };
    img.src = url;
  });
}
const toBlob = (canvas, q = 0.86) => new Promise((r) => canvas.toBlob(r, "image/jpeg", q));

/** Resize and, when lines are given, burn a GPS-camera style band into the bottom of the photo. */
export async function stampPhoto(blob, lines = [], max = 2000) {
  const img = await loadImage(blob);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h);
  const L = lines.filter(Boolean);
  if (L.length) {
    const fs = Math.max(14, Math.round(Math.min(w, h) / 30)), lh = Math.round(fs * 1.3), pad = Math.round(fs * 0.6);
    x.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    // wrap long lines
    const wrapped = [];
    for (const line of L) {
      let cur = "";
      for (const word of String(line).split(" ")) {
        const t = cur ? cur + " " + word : word;
        if (x.measureText(t).width > w - pad * 2 && cur) { wrapped.push(cur); cur = word; } else cur = t;
      }
      wrapped.push(cur);
    }
    const bh = wrapped.length * lh + pad * 2;
    x.fillStyle = "rgba(0,0,0,.55)"; x.fillRect(0, h - bh, w, bh);
    x.fillStyle = "#fff"; x.textBaseline = "top";
    wrapped.forEach((t, i) => x.fillText(t, pad, h - bh + pad + i * lh));
  }
  return toBlob(c);
}
export async function thumbOf(blob, size = 360) {
  const img = await loadImage(blob);
  const s = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}
export const blobToDataUrl = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });

/** "Scan": clean up a photographed page (greyscale, stronger contrast) so it prints like a scan. */
export async function scanEnhance(blob) {
  const img = await loadImage(blob);
  const s = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < a.length; i += 40) { const g = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]; lo = Math.min(lo, g); hi = Math.max(hi, g); }
  const black = lo + (hi - lo) * 0.18, white = lo + (hi - lo) * 0.78;
  for (let i = 0; i < a.length; i += 4) {
    const g = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2];
    const v = Math.max(0, Math.min(255, ((g - black) / (white - black)) * 255));
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  return toBlob(c, 0.82);
}

// ---------------------------------------------------------------------------
// PDF: merge PDFs and images into one file (A4 pages for images)
// ---------------------------------------------------------------------------

let pdfLib = null;
const PDFLib = async () => (pdfLib ||= await import("../vendor/pdf-lib.esm.min.js"));

export async function mergeToPdf(items) {
  const { PDFDocument } = await PDFLib();
  const out = await PDFDocument.create();
  const A4 = [595.28, 841.89], M = 24;
  for (const it of items) {
    const type = it.type || it.blob.type || "";
    const bytes = new Uint8Array(await it.blob.arrayBuffer());
    if (type === "application/pdf" || /\.pdf$/i.test(it.name || "")) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
    } else if (type.startsWith("image/")) {
      let img;
      if (type === "image/png") img = await out.embedPng(bytes);
      else if (type === "image/jpeg") img = await out.embedJpg(bytes);
      else { const j = await stampPhoto(it.blob, [], 2400); img = await out.embedJpg(new Uint8Array(await j.arrayBuffer())); }
      const land = img.width > img.height;
      const [pw, ph] = land ? [A4[1], A4[0]] : A4;
      const s = Math.min((pw - 2 * M) / img.width, (ph - 2 * M) / img.height);
      const page = out.addPage([pw, ph]);
      page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
    }
  }
  if (!out.getPageCount()) throw new Error("None of the chosen files is a PDF or an image.");
  return new Blob([await out.save()], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// ZIP (stored, no compression: photos and PDFs are already compressed)
// ---------------------------------------------------------------------------

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (a) => { let c = 0xffffffff; for (let i = 0; i < a.length; i++) c = CRC[(c ^ a[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** files: [{ name, data: Uint8Array | Blob | string }] → Blob (application/zip) */
export async function makeZip(files) {
  const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)), dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate());
  const used = new Set();
  for (const f of files) {
    let name = f.name.replace(/[\\:*?"<>|]+/g, "_"); let k = 1;
    while (used.has(name)) name = f.name.replace(/(\.[^.]*)?$/, `_${k++}$1`); used.add(name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
    const nm = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(h, nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
    central.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((a, x) => a + (x.byteLength ?? x.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e], { type: "application/zip" });
}

export const extOf = (type, name = "") => (name.match(/\.(\w{2,5})$/)?.[1] || { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" }[type] || "bin");
export const safeName = (s) => String(s || "file").replace(/[^\w\- .]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
