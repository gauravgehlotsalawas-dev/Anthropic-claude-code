// Read and write NIC GePNIC "BoQ_Ver3.0" e-tender BOQ files (.xls, BIFF8 with VBA macros).
//
// The department's own template is used as-is: macros, very-hidden sheet state, styles, names,
// buttons and validation lists are preserved. Only the item rows of the "BoQ1" sheet are rewritten,
// and everything that depends on row positions (totals, formulas, drop-downs, merged cells,
// drawing anchors, print area) is moved to match.

const X = () => globalThis.XLSX;
const MAXREC = 8224;
const LAST_COL = 54; // column BC: the template's last data column

// Record types
const R = {
  BOF: 0x0809, EOF: 0x000a, BOUNDSHEET: 0x0085, SST: 0x00fc, EXTSST: 0x00ff, CONTINUE: 0x003c, NAME: 0x0018,
  SUPBOOK: 0x01ae, EXTERNSHEET: 0x0017, XF: 0x00e0, FONT: 0x0031, INDEX: 0x020b, DBCELL: 0x00d7, ROW: 0x0208,
  LABELSST: 0x00fd, LABEL: 0x0204, RSTRING: 0x00d6, NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, BLANK: 0x0201,
  MULBLANK: 0x00be, BOOLERR: 0x0205, FORMULA: 0x0006, STRING: 0x0207, SHRFMLA: 0x04bc, ARRAY: 0x0221, TABLE: 0x0236,
  DIMENSIONS: 0x0200, MERGEDCELLS: 0x00e5, DV: 0x01be, CONDFMT: 0x01b0, HLINK: 0x01b8, NOTE: 0x001c,
  MSODRAWING: 0x00ec, PROTECT: 0x0012, OBJPROTECT: 0x0063, SCENPROTECT: 0x00dd, COLINFO: 0x007d,
};
const CELL_TYPES = new Set([R.LABELSST, R.LABEL, R.RSTRING, R.NUMBER, R.RK, R.MULRK, R.BLANK, R.MULBLANK, R.BOOLERR, R.FORMULA]);
const TABLE_TYPES = new Set([...CELL_TYPES, R.ROW, R.DBCELL, R.STRING, R.SHRFMLA, R.ARRAY, R.TABLE]);

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const f64 = (b, o) => new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);
const set16 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; };
const set32 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; };
const setF64 = (b, o, v) => new DataView(b.buffer, b.byteOffset + o, 8).setFloat64(0, v, true);

class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 0xff); return this; }
  u16(v) { this.a.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u32(v) { this.a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); return this; }
  f64(v) { const b = new Uint8Array(8); setF64(b, 0, v); this.a.push(...b); return this; }
  bytes(b) { for (let i = 0; i < b.length; i++) this.a.push(b[i]); return this; }
  get length() { return this.a.length; }
  out() { return Uint8Array.from(this.a); }
}

function readRecords(u8) {
  const out = [];
  let p = 0;
  while (p + 4 <= u8.length) {
    const type = u16(u8, p), len = u16(u8, p + 2);
    out.push({ type, data: u8.slice(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  return out;
}

function recordsToBytes(recs) {
  let n = 0;
  for (const r of recs) n += 4 + r.data.length;
  const out = new Uint8Array(n);
  let p = 0;
  for (const r of recs) {
    if (r.data.length > MAXREC) throw new Error(`Record 0x${r.type.toString(16)} is too long (${r.data.length})`);
    set16(out, p, r.type); set16(out, p + 2, r.data.length);
    out.set(r.data, p + 4);
    p += 4 + r.data.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared string table
// ---------------------------------------------------------------------------

function parseSST(chunks) {
  let ci = 0, p = 8;
  const cstTotal = u32(chunks[0], 0), cstUnique = u32(chunks[0], 4);
  const ensure = () => { while (ci < chunks.length && p >= chunks[ci].length) { ci++; p = 0; } };
  const byte = () => { ensure(); return chunks[ci][p++]; };
  const bytes = (n) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = byte(); return o; };
  const strings = [];
  for (let s = 0; s < cstUnique; s++) {
    ensure();
    if (ci >= chunks.length) break;
    const cch = byte() | (byte() << 8);
    const flags = byte();
    let high = flags & 1;
    const cRun = flags & 8 ? byte() | (byte() << 8) : 0;
    const cbExt = flags & 4 ? (byte() | (byte() << 8) | (byte() << 16)) + byte() * 0x1000000 : 0;
    let text = "", left = cch;
    while (left > 0) {
      if (p >= chunks[ci].length) { ci++; p = 0; high = chunks[ci][p++] & 1; }
      const avail = Math.floor((chunks[ci].length - p) / (high ? 2 : 1));
      const n = Math.min(avail, left);
      for (let i = 0; i < n; i++) {
        text += String.fromCharCode(high ? u16(chunks[ci], p) : chunks[ci][p]);
        p += high ? 2 : 1;
      }
      left -= n;
    }
    const tail = bytes(cRun * 4 + cbExt);
    strings.push({ text, flags: flags & 0x0c, cRun, cbExt, tail });
  }
  return { cstTotal, strings };
}

/** Serialise the SST into SST + CONTINUE records. Returns bucket start positions for EXTSST. */
function buildSST(strings, cstTotal) {
  const recs = [];
  let cur = new W().u32(cstTotal).u32(strings.length);
  const marks = []; // [recIndex, offsetInData] per string
  const flush = () => { recs.push(cur.out()); cur = new W(); };
  strings.forEach((s) => {
    const high = /[^\x00-\xff]/.test(s.text) ? 1 : 0;
    const hdr = 3 + (s.flags & 8 ? 2 : 0) + (s.flags & 4 ? 4 : 0);
    if (MAXREC - cur.length < hdr + (high ? 2 : 1)) flush();
    marks.push([recs.length, cur.length]);
    cur.u16(s.text.length).u8(high | s.flags);
    if (s.flags & 8) cur.u16(s.cRun);
    if (s.flags & 4) cur.u32(s.cbExt);
    let i = 0;
    while (i < s.text.length) {
      let room = Math.floor((MAXREC - cur.length) / (high ? 2 : 1));
      if (room <= 0) { flush(); cur.u8(high); room = Math.floor((MAXREC - 1) / (high ? 2 : 1)); }
      const n = Math.min(room, s.text.length - i);
      for (let k = 0; k < n; k++) {
        const c = s.text.charCodeAt(i + k);
        if (high) cur.u16(c); else cur.u8(c);
      }
      i += n;
    }
    for (let k = 0; k < s.tail.length; k++) {
      if (cur.length >= MAXREC) flush();
      cur.u8(s.tail[k]);
    }
  });
  flush();
  return { records: recs.map((data, i) => ({ type: i ? R.CONTINUE : R.SST, data })), marks };
}

// ---------------------------------------------------------------------------
// Formula tokens (BIFF8 Ptg)
// ---------------------------------------------------------------------------

function ptgLen(rgce, i) {
  const t = rgce[i];
  const b = t >= 0x20 ? (t & 0x1f) | 0x20 : t;
  if (b >= 0x03 && b <= 0x16) return 1;
  switch (b) {
    case 0x01: case 0x02: return 5;
    case 0x17: return 3 + rgce[i + 1] * (rgce[i + 2] & 1 ? 2 : 1);
    case 0x19: return rgce[i + 1] & 0x04 ? 4 + 2 * (u16(rgce, i + 2) + 1) : 4;
    case 0x1c: case 0x1d: return 2;
    case 0x1e: return 3;
    case 0x1f: return 9;
    case 0x20: return 8;
    case 0x21: return 3;
    case 0x22: return 4;
    case 0x23: return 5;
    case 0x24: case 0x2a: case 0x2c: return 5;
    case 0x25: case 0x2b: case 0x2d: return 9;
    case 0x26: case 0x27: case 0x28: return 7;
    case 0x29: return 3;
    case 0x39: return 7;
    case 0x3a: case 0x3c: return 7;
    case 0x3b: case 0x3d: return 11;
    default: throw new Error(`Unsupported formula token 0x${t.toString(16)}`);
  }
}
const ptgBase = (t) => (t >= 0x20 ? (t & 0x1f) | 0x20 : t);

/** Visit every token; fn(base, index) may patch rgce in place. */
function eachPtg(rgce, fn) {
  for (let i = 0; i < rgce.length;) {
    const len = ptgLen(rgce, i);
    fn(ptgBase(rgce[i]), i);
    i += len;
  }
}

/** Shift the row numbers of 2-D references using rowMap(row, role) where role is "ref", "first" or "last". */
function remapRows(rgce, rowMap, sheet3d = null) {
  const out = rgce.slice();
  eachPtg(out, (b, i) => {
    if (b === 0x24) set16(out, i + 1, rowMap(u16(out, i + 1), "ref"));
    else if (b === 0x25) { set16(out, i + 1, rowMap(u16(out, i + 1), "first")); set16(out, i + 3, rowMap(u16(out, i + 3), "last")); }
    else if (b === 0x3a && sheet3d?.(u16(out, i + 1))) set16(out, i + 3, rowMap(u16(out, i + 3), "ref"));
    else if (b === 0x3b && sheet3d?.(u16(out, i + 1))) { set16(out, i + 3, rowMap(u16(out, i + 3), "first")); set16(out, i + 5, rowMap(u16(out, i + 5), "last")); }
  });
  return out;
}

/** Copy a cell formula to another row: relative row references move with it. */
function moveFormula(rgce, dRow) {
  const out = rgce.slice();
  const fix = (o) => { if (u16(out, o + 2) & 0x8000) set16(out, o, (u16(out, o) + dRow) & 0xffff); };
  eachPtg(out, (b, i) => {
    if (b === 0x24) fix(i + 1);
    else if (b === 0x25) {
      if (u16(out, i + 5) & 0x8000) set16(out, i + 1, (u16(out, i + 1) + dRow) & 0xffff);
      if (u16(out, i + 7) & 0x8000) set16(out, i + 3, (u16(out, i + 3) + dRow) & 0xffff);
    }
  });
  return out;
}

/** Turn a shared formula (relative RefN/AreaN tokens) into an ordinary formula for cell (row, col). */
function unshare(rgce, row, col) {
  const out = rgce.slice();
  const rel = (o, base) => {
    const rw = u16(out, o), cf = u16(out, o + 2);
    const newRow = cf & 0x8000 ? (base.row + rw) & 0xffff : rw;
    const newCol = cf & 0x4000 ? (base.col + (cf & 0xff)) & 0xff : cf & 0x3fff;
    set16(out, o, newRow); set16(out, o + 2, (cf & 0xc000) | newCol);
  };
  eachPtg(out, (b, i) => {
    if (b === 0x2c) { out[i] -= 8; rel(i + 1, { row, col }); }
    else if (b === 0x2d) {
      out[i] -= 8;
      const r1 = u16(out, i + 1), r2 = u16(out, i + 3), c1 = u16(out, i + 5), c2 = u16(out, i + 7);
      const fix = (rw, cf) => [cf & 0x8000 ? (row + rw) & 0xffff : rw, (cf & 0xc000) | (cf & 0x4000 ? (col + (cf & 0xff)) & 0xff : cf & 0x3fff)];
      const [nr1, nc1] = fix(r1, c1), [nr2, nc2] = fix(r2, c2);
      set16(out, i + 1, nr1); set16(out, i + 3, nr2); set16(out, i + 5, nc1); set16(out, i + 7, nc2);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Workbook model
// ---------------------------------------------------------------------------

function loadContainer(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8[0] !== 0xd0 || u8[1] !== 0xcf) {
    throw new Error("This is not an Excel 97-2003 (.xls) file. Download the BOQ template (.xls) from the e-procurement portal.");
  }
  const cfb = X().CFB.read(u8, { type: "array" });
  const entry = X().CFB.find(cfb, "Workbook") || X().CFB.find(cfb, "Book");
  if (!entry) throw new Error("No Excel workbook stream found in this file.");
  return { cfb, entry, stream: Uint8Array.from(entry.content) };
}

function splitSubstreams(recs) {
  const subs = [];
  let cur = null;
  for (const r of recs) {
    if (r.type === R.BOF) { cur = []; subs.push(cur); }
    if (cur) cur.push(r);
  }
  return subs;
}

function sheetsInfo(globals) {
  return globals.filter((r) => r.type === R.BOUNDSHEET).map((r) => {
    const d = r.data;
    const cch = d[6], high = d[7] & 1;
    let name = "";
    for (let i = 0; i < cch; i++) name += String.fromCharCode(high ? u16(d, 8 + i * 2) : d[8 + i]);
    return { rec: r, name, pos: u32(d, 0), hidden: d[4] & 3 };
  });
}

/** Explode a sheet's cell table into rows: { row: { rowRec, cells: Map(col -> cell) } }. */
function readCellTable(recs, sharedOut) {
  const rows = new Map();
  const get = (r) => { if (!rows.has(r)) rows.set(r, { rowRec: null, cells: new Map() }); return rows.get(r); };
  let lastFormula = null;
  for (const rec of recs) {
    const d = rec.data;
    switch (rec.type) {
      case R.ROW: get(u16(d, 0)).rowRec = d; break;
      case R.NUMBER: get(u16(d, 0)).cells.set(u16(d, 2), { kind: "num", xf: u16(d, 4), value: f64(d, 6) }); break;
      case R.RK: get(u16(d, 0)).cells.set(u16(d, 2), { kind: "num", xf: u16(d, 4), value: rkValue(u32(d, 6)) }); break;
      case R.MULRK: {
        const row = u16(d, 0), c0 = u16(d, 2), n = (d.length - 6) / 6;
        for (let k = 0; k < n; k++) get(row).cells.set(c0 + k, { kind: "num", xf: u16(d, 4 + k * 6), value: rkValue(u32(d, 6 + k * 6)) });
        break;
      }
      case R.LABELSST: get(u16(d, 0)).cells.set(u16(d, 2), { kind: "sst", xf: u16(d, 4), isst: u32(d, 6) }); break;
      case R.BLANK: get(u16(d, 0)).cells.set(u16(d, 2), { kind: "blank", xf: u16(d, 4) }); break;
      case R.MULBLANK: {
        const row = u16(d, 0), c0 = u16(d, 2), n = (d.length - 6) / 2;
        for (let k = 0; k < n; k++) get(row).cells.set(c0 + k, { kind: "blank", xf: u16(d, 4 + k * 2) });
        break;
      }
      case R.FORMULA: {
        const cell = { kind: "formula", xf: u16(d, 4), result: d.slice(6, 14), grbit: u16(d, 14), rgce: d.slice(22, 22 + u16(d, 20)), extra: d.slice(22 + u16(d, 20)), string: null };
        get(u16(d, 0)).cells.set(u16(d, 2), cell);
        lastFormula = cell;
        break;
      }
      case R.STRING: if (lastFormula) lastFormula.string = d; break;
      case R.SHRFMLA: {
        const rw1 = u16(d, 0), rw2 = u16(d, 2), c1 = d[4], c2 = d[5];
        sharedOut.push({ rw1, rw2, c1, c2, rgce: d.slice(10, 10 + u16(d, 8)) });
        break;
      }
      case R.ARRAY: case R.TABLE:
        throw new Error("This template uses array or table formulas, which this tool cannot rewrite safely.");
      case R.DBCELL: break;
      default: // LABEL, RSTRING, BOOLERR: keep raw
        if (CELL_TYPES.has(rec.type)) get(u16(d, 0)).cells.set(u16(d, 2), { kind: "raw", type: rec.type, data: d });
    }
  }
  return rows;
}

function rkValue(rk) {
  let v;
  if (rk & 2) v = (rk >> 2);
  else { const b = new Uint8Array(8); set32(b, 4, rk & 0xfffffffc); v = f64(b, 0); }
  return rk & 1 ? v / 100 : v;
}

/** Resolve a shared formula reference (ptgExp) to an ordinary formula for this cell. */
function resolveFormula(cell, row, col, shared) {
  if (cell.rgce.length === 5 && cell.rgce[0] === 0x01) {
    const r0 = u16(cell.rgce, 1), c0 = u16(cell.rgce, 3);
    const sh = shared.find((s) => s.rw1 === r0 && s.c1 === c0 && row >= s.rw1 && row <= s.rw2 && col >= s.c1 && col <= s.c2) ||
      shared.find((s) => row >= s.rw1 && row <= s.rw2 && col >= s.c1 && col <= s.c2);
    if (!sh) throw new Error(`Shared formula for row ${row + 1} not found.`);
    return unshare(sh.rgce, row, col);
  }
  return cell.rgce;
}

/** Write one row's cells as records, merging neighbouring blanks into MULBLANK. */
function writeRowCells(row, cells, sstIndex) {
  const recs = [];
  const cols = [...cells.keys()].sort((a, b) => a - b);
  for (let k = 0; k < cols.length; k++) {
    const col = cols[k], c = cells.get(col);
    if (c.kind === "blank") {
      let end = k;
      while (end + 1 < cols.length && cols[end + 1] === cols[end] + 1 && cells.get(cols[end + 1]).kind === "blank") end++;
      if (end > k) {
        const w = new W().u16(row).u16(col);
        for (let j = k; j <= end; j++) w.u16(cells.get(cols[j]).xf);
        w.u16(cols[end]);
        recs.push({ type: R.MULBLANK, data: w.out() });
        k = end;
      } else recs.push({ type: R.BLANK, data: new W().u16(row).u16(col).u16(c.xf).out() });
    } else if (c.kind === "num") {
      recs.push({ type: R.NUMBER, data: new W().u16(row).u16(col).u16(c.xf).f64(c.value).out() });
    } else if (c.kind === "sst" || c.kind === "text") {
      const isst = c.kind === "text" ? sstIndex(c.text) : c.isst;
      recs.push({ type: R.LABELSST, data: new W().u16(row).u16(col).u16(c.xf).u32(isst).out() });
    } else if (c.kind === "formula") {
      const w = new W().u16(row).u16(col).u16(c.xf).bytes(c.result).u16(c.grbit & ~0x0008).u32(0).u16(c.rgce.length).bytes(c.rgce).bytes(c.extra || []);
      recs.push({ type: R.FORMULA, data: w.out() });
      if (c.string) recs.push({ type: R.STRING, data: c.string });
    } else if (c.kind === "raw") {
      const d = c.data.slice(); set16(d, 0, row);
      recs.push({ type: c.type, data: d });
    }
  }
  return recs;
}

const numResult = (v) => { const b = new Uint8Array(8); setF64(b, 0, v); return b; };
const emptyStringResult = () => Uint8Array.from([3, 0, 0, 0, 0, 0, 0xff, 0xff]);
const isStringResult = (res) => res[6] === 0xff && res[7] === 0xff && res[0] === 0;

// ---------------------------------------------------------------------------
// Public: inspect / import
// ---------------------------------------------------------------------------

/** Summarise a NIC BOQ file and list its items. */
export function readNicBoq(buffer) {
  const { cfb, stream } = loadContainer(buffer);
  const recs = readRecords(stream);
  const subs = splitSubstreams(recs);
  const globals = subs[0];
  const sheets = sheetsInfo(globals);
  const si = sheets.findIndex((s) => s.name === "BoQ1");
  if (si < 0) throw new Error('This file has no "BoQ1" sheet, so it is not a GePNIC BOQ template.');
  const sstAt = globals.findIndex((r) => r.type === R.SST);
  const chunks = [globals[sstAt].data];
  for (let i = sstAt + 1; globals[i]?.type === R.CONTINUE; i++) chunks.push(globals[i].data);
  const { strings } = parseSST(chunks);
  const sheetRecs = subs[si + 1];
  const shared = [];
  const rows = readCellTable(sheetRecs.filter((r) => TABLE_TYPES.has(r.type)), shared);
  const text = (row, col) => {
    const c = rows.get(row)?.cells.get(col);
    if (!c) return "";
    if (c.kind === "sst") return strings[c.isst]?.text ?? "";
    if (c.kind === "num") return c.value;
    return "";
  };
  const footer = [...rows.keys()].sort((a, b) => a - b).find((r) => r >= 12 && /^total in figures/i.test(String(text(r, 0)).trim()));
  if (footer == null) throw new Error('Could not find the "Total in Figures" row in BoQ1.');
  const items = [];
  for (let r = 12; r < footer; r++) {
    if (!rows.has(r)) continue;
    const sno = text(r, 0), desc = String(text(r, 1)).trim();
    if (sno === "" && !desc) continue;
    const qty = text(r, 3), unit = String(text(r, 4)).trim(), rate = text(r, 5);
    items.push({
      row: r + 1, sno, description: desc, code: String(text(r, 2)).trim(),
      qty: typeof qty === "number" ? qty : null, unit, rate: typeof rate === "number" ? rate : null,
      heading: qty === "" || qty == null,
    });
  }
  const protect = sheetRecs.find((r) => r.type === R.PROTECT);
  return {
    version: String(text(1, 0)), boqType: String(text(1, 1)), chartType: String(text(1, 2)), currencyMode: String(text(1, 3)),
    title: String(text(0, 0)), authority: String(text(3, 0)), work: String(text(4, 0)), contract: String(text(5, 0)),
    protected: !!(protect && u16(protect.data, 0)), sheetHidden: sheets[si].hidden,
    hasMacros: cfb.FullPaths.some((p) => /_VBA_PROJECT/i.test(p)), items, firstItemRow: 13, footerRow: footer + 1,
  };
}

// ---------------------------------------------------------------------------
// Public: generate
// ---------------------------------------------------------------------------

/**
 * Fill a GePNIC BOQ template with new items.
 * items: [{ sno, description, code, qty, unit, rate, heading }] (heading rows have no qty/unit/rate)
 * header: { authority, work, contract } (optional; template text kept when blank)
 * options: { unprotect: true }
 */
export function writeNicBoq(templateBuffer, items, header = {}, options = {}) {
  if (!items.length) throw new Error("There are no items to write.");
  const { cfb, entry, stream } = loadContainer(templateBuffer);
  const recs = readRecords(stream);
  const subs = splitSubstreams(recs);
  let globals = subs[0];
  const sheets = sheetsInfo(globals);
  const si = sheets.findIndex((s) => s.name === "BoQ1");
  if (si < 0) throw new Error('This file has no "BoQ1" sheet, so it is not a GePNIC BOQ template.');

  // --- shared strings
  const sstAt = globals.findIndex((r) => r.type === R.SST);
  let sstEnd = sstAt + 1;
  while (globals[sstEnd]?.type === R.CONTINUE) sstEnd++;
  const sst = parseSST(globals.slice(sstAt, sstEnd).map((r) => r.data));
  const sstMap = new Map();
  sst.strings.forEach((s, i) => { if (!s.flags && !sstMap.has(s.text)) sstMap.set(s.text, i); });
  const sstIndex = (t) => {
    const s = String(t ?? "").slice(0, 32767);
    if (sstMap.has(s)) return sstMap.get(s);
    sst.strings.push({ text: s, flags: 0, cRun: 0, cbExt: 0, tail: new Uint8Array(0) });
    sstMap.set(s, sst.strings.length - 1);
    return sst.strings.length - 1;
  };

  // --- XF table (to find a locked version of a cell format)
  const xfRecs = globals.map((r, i) => [r, i]).filter(([r]) => r.type === R.XF);
  const xfAdded = [];
  const lockedXf = (xf) => {
    const base = xfRecs[xf]?.[0].data;
    if (!base || base[4] & 1) return xf;
    const want = base.slice(); want[4] |= 1;
    const same = xfRecs.findIndex(([r]) => r.data.length === want.length && r.data.every((v, k) => v === want[k]));
    if (same >= 0) return same;
    const prior = xfAdded.findIndex((d) => d.every((v, k) => v === want[k]));
    if (prior >= 0) return xfRecs.length + prior;
    xfAdded.push(want);
    return xfRecs.length + xfAdded.length - 1;
  };

  // --- sheet cell table
  const sheetRecs = subs[si + 1];
  const tStart = sheetRecs.findIndex((r) => TABLE_TYPES.has(r.type));
  let tEnd = tStart;
  for (let i = tStart; i < sheetRecs.length; i++) if (TABLE_TYPES.has(sheetRecs[i].type)) tEnd = i;
  for (let i = tStart; i <= tEnd; i++) {
    if (!TABLE_TYPES.has(sheetRecs[i].type)) throw new Error(`Unexpected record 0x${sheetRecs[i].type.toString(16)} inside the cell table.`);
  }
  const shared = [];
  const rows = readCellTable(sheetRecs.slice(tStart, tEnd + 1), shared);
  const textAt = (row, col) => {
    const c = rows.get(row)?.cells.get(col);
    return c?.kind === "sst" ? sst.strings[c.isst]?.text ?? "" : c?.kind === "num" ? String(c.value) : "";
  };
  const boqType = textAt(1, 1).trim();
  if (!/^BoQ_Ver\d+(\.\d+)?$/.test(textAt(1, 0).trim())) throw new Error(`Cell A2 should hold the BoQ version (for example "BoQ_Ver3.0") but reads "${textAt(1, 0)}". Use the BOQ template downloaded from the e-procurement portal.`);
  const FIRST = 12;
  const sortedRows = [...rows.keys()].sort((a, b) => a - b);
  const footer = sortedRows.find((r) => r >= FIRST && /^total in figures/i.test(textAt(r, 0).trim()));
  if (footer == null) throw new Error('Could not find the "Total in Figures" row in BoQ1.');
  const oldLast = footer - 1;
  if (oldLast < FIRST) throw new Error("The template has no item row to copy the format from.");

  // Prototype rows: an item (has quantity) and, if present, a heading (no quantity).
  const itemRows = sortedRows.filter((r) => r >= FIRST && r <= oldLast);
  const hasQty = (r) => rows.get(r).cells.get(3)?.kind === "num";
  const protoItemRow = itemRows.find(hasQty);
  if (protoItemRow == null) throw new Error("The template has no item row with a quantity to copy the format from.");
  const protoHeadRow = itemRows.find((r) => !hasQty(r) && rows.get(r).cells.get(1));
  const protoItem = rows.get(protoItemRow), protoHead = protoHeadRow != null ? rows.get(protoHeadRow) : null;

  const newLast = FIRST + items.length - 1;
  const delta = newLast - oldLast;
  if (footer + delta + 8 > 65535) throw new Error("Too many items for one Excel 97-2003 sheet.");
  const rowMap = (r, role) => {
    if (r < FIRST) return r;
    if (r <= oldLast) return role === "last" ? newLast : r === oldLast && role === "ref" ? newLast : r;
    return r + delta;
  };

  // Sheet index mapping for 3-D references (print area and similar)
  const extIdx = globals.findIndex((r) => r.type === R.EXTERNSHEET);
  const supbooks = globals.filter((r) => r.type === R.SUPBOOK);
  const selfBook = supbooks.findIndex((r) => r.data.length === 4 && u16(r.data, 2) === 0x0401);
  const xti = [];
  if (extIdx >= 0) {
    const d = globals[extIdx].data;
    for (let k = 0; k < u16(d, 0); k++) xti.push({ book: u16(d, 2 + k * 6), first: u16(d, 4 + k * 6), last: u16(d, 6 + k * 6) });
  }
  const isThisSheet = (ixti) => xti[ixti] && xti[ixti].book === selfBook && xti[ixti].first === si;

  // --- column widths (for row heights)
  const colWidth = (col) => {
    for (const r of sheetRecs) {
      if (r.type === R.COLINFO && u16(r.data, 0) <= col && col <= u16(r.data, 2)) return u16(r.data, 4) / 256;
    }
    return 8.43;
  };
  const descChars = Math.max(20, colWidth(1) * 1.05);
  const fontHeight = (() => {
    const xf = protoItem.cells.get(1)?.xf ?? 0;
    const ifnt = xfRecs[xf] ? u16(xfRecs[xf][0].data, 0) : 0;
    const fonts = globals.filter((r) => r.type === R.FONT);
    const f = fonts[ifnt >= 4 ? ifnt - 1 : ifnt];
    return f ? u16(f.data, 0) : 200;
  })();

  // --- build new item rows
  const newRows = new Map();
  const protoCols = (proto) => new Map([...proto.cells].filter(([c]) => c <= LAST_COL));
  items.forEach((it, k) => {
    const row = FIRST + k;
    const heading = !!it.heading;
    const proto = heading ? (protoHead || protoItem) : protoItem;
    const pRow = heading ? (protoHeadRow ?? protoItemRow) : protoItemRow;
    const cells = new Map();
    for (const [col, c] of protoCols(proto)) {
      if (c.kind === "formula") {
        const rgce = moveFormula(resolveFormula(c, pRow, col, shared), row - pRow);
        cells.set(col, { ...c, rgce, grbit: c.grbit | 0x0001, string: null, result: isStringResult(c.result) ? emptyStringResult() : c.result });
      } else cells.set(col, { ...c });
    }
    const put = (col, cell) => {
      const xf = cells.get(col)?.xf ?? protoItem.cells.get(col)?.xf ?? 15;
      cells.set(col, { ...cell, xf });
    };
    put(0, { kind: "num", value: Number(it.sno) });
    put(1, { kind: "text", text: it.description || "" });
    if (it.code) put(2, { kind: "text", text: String(it.code).slice(0, 100) });
    if (heading) {
      if (!protoHead) {
        // Synthesised heading: everything after the description is blank and locked (bidders cannot quote on it).
        for (let col = 3; col <= LAST_COL; col++) {
          const src = protoItem.cells.get(col);
          cells.set(col, { kind: "blank", xf: lockedXf(src?.xf ?? 15) });
        }
      } else {
        for (const col of [3, 4, 5]) if (cells.has(col)) cells.set(col, { kind: "blank", xf: cells.get(col).xf });
      }
    } else {
      put(3, { kind: "num", value: Number(it.qty) || 0 });
      put(4, { kind: "text", text: it.unit || "" });
      if (it.rate != null && it.rate !== "") put(5, { kind: "num", value: Number(it.rate) || 0 });
      else if (cells.has(5)) cells.set(5, { kind: "blank", xf: cells.get(5).xf });
      // Cached results so readers that do not recalculate still see the right amounts.
      const amount = boqType === "Percentage" ? (Number(it.qty) || 0) * (Number(it.rate) || 0) : 0;
      for (const col of [52, 53]) {
        const c = cells.get(col);
        if (c?.kind === "formula") c.result = numResult(Math.round(amount * 100) / 100);
      }
    }
    // Row record with a height that fits the description.
    const base = (heading ? protoHead?.rowRec : null) || protoItem.rowRec || new W().u16(0).u16(0).u16(LAST_COL + 1).u16(255).u16(0).u16(0).u32(0x00000100 | (15 << 16)).out();
    const rowRec = base.slice();
    set16(rowRec, 0, row); set16(rowRec, 2, 0); set16(rowRec, 4, LAST_COL + 1);
    const text = String(it.description || "");
    const lines = text.split(/\n/).reduce((a, part) => a + Math.max(1, Math.ceil(part.length / descChars)), 0);
    const twips = Math.min(8190, Math.max(300, Math.round(lines * fontHeight * 1.3 + 60)));
    set16(rowRec, 6, twips);
    set16(rowRec, 12, u16(rowRec, 12) | 0x0040); // custom height
    newRows.set(row, { rowRec, cells });
  });

  // --- header text (rows 4-6)
  const headerRows = new Map();
  for (const r of sortedRows.filter((r) => r < FIRST)) {
    const src = rows.get(r);
    const cells = new Map([...src.cells].map(([c, v]) => [c, v.kind === "formula" ? { ...v, rgce: remapRows(resolveFormula(v, r, c, shared), rowMap, isThisSheet) } : { ...v }]));
    headerRows.set(r, { rowRec: src.rowRec, cells });
  }
  const setHeader = (r, value) => {
    if (!value) return;
    const row = headerRows.get(r); const c = row?.cells.get(0);
    if (!c) return;
    const old = textAt(r, 0);
    const prefix = old.includes(":") ? old.slice(0, old.indexOf(":") + 1) + " " : "";
    row.cells.set(0, { kind: "text", text: prefix + value, xf: c.xf });
  };
  // GePNIC validation needs this exact caption in A8 and an empty B8.
  const fixes = [];
  const a8 = headerRows.get(7)?.cells.get(0);
  if (a8 && textAt(7, 0).trim() !== "Name of the Bidder/ Bidding Firm / Company :") {
    headerRows.get(7).cells.set(0, { kind: "text", text: "Name of the Bidder/ Bidding Firm / Company :", xf: a8.xf });
    fixes.push(`A8 changed from "${textAt(7, 0).trim()}" to the standard caption`);
  }
  const b8 = headerRows.get(7)?.cells.get(1);
  if (b8 && b8.kind !== "blank") { headerRows.get(7).cells.set(1, { kind: "blank", xf: b8.xf }); fixes.push("B8 cleared (bidder name must be blank)"); }
  setHeader(3, header.authority);
  setHeader(4, header.work);
  setHeader(5, header.contract);

  // --- footer rows move down by delta
  const total = items.reduce((a, it) => a + (it.heading ? 0 : (boqType === "Percentage" ? (Number(it.qty) || 0) * (Number(it.rate) || 0) : 0)), 0);
  const footerRows = new Map();
  for (const r of sortedRows.filter((r) => r > oldLast)) {
    const src = rows.get(r);
    const cells = new Map();
    for (const [col, c] of src.cells) {
      if (c.kind === "formula") {
        const rgce = remapRows(resolveFormula(c, r, col, shared), rowMap, isThisSheet);
        let result = isStringResult(c.result) ? emptyStringResult() : c.result;
        if (r === footer && (col === 52 || col === 53)) result = numResult(Math.round(total * 100) / 100);
        cells.set(col, { ...c, rgce, grbit: c.grbit | 0x0001, string: null, result });
      } else cells.set(col, { ...c });
    }
    let rowRec = src.rowRec;
    if (rowRec) { rowRec = rowRec.slice(); set16(rowRec, 0, r + delta); }
    footerRows.set(r + delta, { rowRec, cells });
  }

  // --- assemble the new cell table (no INDEX/DBCELL: they are optional and rebuilt by Excel)
  const allRows = new Map([...headerRows, ...newRows, ...footerRows]);
  const order = [...allRows.keys()].sort((a, b) => a - b);
  const table = [];
  for (let b = 0; b < order.length; b += 32) {
    const block = order.slice(b, b + 32);
    for (const r of block) if (allRows.get(r).rowRec) table.push({ type: R.ROW, data: allRows.get(r).rowRec });
    for (const r of block) table.push(...writeRowCells(r, allRows.get(r).cells, sstIndex));
  }
  let maxCol = 0;
  for (const r of order) for (const c of allRows.get(r).cells.keys()) maxCol = Math.max(maxCol, c);

  // --- other sheet records that hold row numbers
  const fixSqref = (d, off) => {
    const n = u16(d, off);
    const refs = [];
    for (let k = 0; k < n; k++) refs.push([u16(d, off + 2 + 8 * k), u16(d, off + 4 + 8 * k), u16(d, off + 6 + 8 * k), u16(d, off + 8 + 8 * k)]);
    const out = [];
    // Item rows: the new rows get the rule wherever it applied to the prototype item row.
    const protoCols = new Set();
    for (const [r1, r2, c1, c2] of refs) {
      if (r2 < FIRST) out.push([r1, r2, c1, c2]);
      else if (r1 > oldLast) out.push([r1 + delta, r2 + delta, c1, c2]);
      else {
        if (r1 <= protoItemRow && protoItemRow <= r2) for (let c = c1; c <= c2; c++) protoCols.add(c);
        if (r1 < FIRST) out.push([r1, FIRST - 1, c1, c2]);
        if (r2 > oldLast) out.push([oldLast + 1 + delta, r2 + delta, c1, c2]);
      }
    }
    const cols = [...protoCols].sort((a, b) => a - b);
    for (let k = 0; k < cols.length;) {
      let e = k;
      while (e + 1 < cols.length && cols[e + 1] === cols[e] + 1) e++;
      out.push([FIRST, newLast, cols[k], cols[e]]);
      k = e + 1;
    }
    const w = new W().u16(out.length);
    for (const [r1, r2, c1, c2] of out) w.u16(r1).u16(r2).u16(c1).u16(c2);
    return w.out();
  };
  const pre = sheetRecs.slice(0, tStart).filter((r) => r.type !== R.INDEX).map((r) => {
    if (r.type === R.DIMENSIONS) {
      const d = r.data.slice();
      set32(d, 0, order[0] ?? 0); set32(d, 4, (order.at(-1) ?? 0) + 1); set16(d, 8, 0); set16(d, 10, maxCol + 1);
      return { type: r.type, data: d };
    }
    if (options.unprotect !== false && (r.type === R.PROTECT || r.type === R.OBJPROTECT || r.type === R.SCENPROTECT)) {
      return { type: r.type, data: Uint8Array.from([0, 0]) };
    }
    return r;
  });
  const post = sheetRecs.slice(tEnd + 1).map((r) => {
    const d = r.data.slice();
    switch (r.type) {
      case R.MERGEDCELLS: {
        const n = u16(d, 0);
        for (let k = 0; k < n; k++) {
          const o = 2 + 8 * k;
          set16(d, o, rowMap(u16(d, o), "first")); set16(d, o + 2, rowMap(u16(d, o + 2), "last"));
        }
        return { type: r.type, data: d };
      }
      case R.DV: {
        let p = 4;
        for (let s = 0; s < 4; s++) { const cch = u16(d, p), hi = d[p + 2] & 1; p += 3 + cch * (hi ? 2 : 1); }
        const c1 = u16(d, p); const f1 = remapRows(d.slice(p + 4, p + 4 + c1), rowMap, isThisSheet); d.set(f1, p + 4); p += 4 + c1;
        const c2 = u16(d, p); const f2 = remapRows(d.slice(p + 4, p + 4 + c2), rowMap, isThisSheet); d.set(f2, p + 4); p += 4 + c2;
        const head = d.slice(0, p);
        const sq = fixSqref(d, p);
        if (u16(sq, 0) === 0) return null; // rule no longer applies anywhere
        const out = new Uint8Array(head.length + sq.length); out.set(head); out.set(sq, head.length);
        return { type: r.type, data: out };
      }
      case R.CONDFMT: {
        set16(d, 4, rowMap(u16(d, 4), "first")); set16(d, 6, rowMap(u16(d, 6), "last"));
        const head = d.slice(0, 12), sq = fixSqref(d, 12);
        if (u16(sq, 0) === 0) return { type: r.type, data: d }; // keep conditional formats untouched rather than leave them empty
        const out = new Uint8Array(head.length + sq.length); out.set(head); out.set(sq, head.length);
        return { type: r.type, data: out };
      }
      case R.NOTE: set16(d, 0, rowMap(u16(d, 0), "ref")); return { type: r.type, data: d };
      case R.HLINK: set16(d, 0, rowMap(u16(d, 0), "first")); set16(d, 2, rowMap(u16(d, 2), "last")); return { type: r.type, data: d };
      case R.MSODRAWING: {
        // OfficeArt client anchors (0xF010): shapes below the item rows move down with the totals.
        for (let q = 0; q + 26 <= d.length; q++) {
          if (u16(d, q + 2) === 0xf010 && u32(d, q + 4) === 18) {
            // record header (8 bytes), then flag, col1, dx1, row1, dy1, col2, dx2, row2, dy2
            const r1 = u16(d, q + 14), r2 = u16(d, q + 22);
            if (r1 > oldLast) { set16(d, q + 14, r1 + delta); set16(d, q + 22, r2 + delta); }
          }
        }
        return { type: r.type, data: d };
      }
      default: return r;
    }
  });
  // Data-validation count lives in DVAL.
  const postKept = post.filter(Boolean);
  const dvCount = postKept.filter((r) => r.type === R.DV).length;
  const dval = postKept.find((r) => r.type === 0x01b2);
  if (dval) { const d = dval.data.slice(); set32(d, 14, dvCount); dval.data = d; }
  const newSheet = [...pre, ...table, ...postKept];

  // --- globals: print area / names, SST, added XFs
  globals = globals.map((r) => {
    if (r.type !== R.NAME) return r;
    const d = r.data.slice();
    const cch = d[3], cce = u16(d, 4);
    const nameLen = 1 + cch * (d[14] & 1 ? 2 : 1);
    const at = 14 + nameLen;
    if (at + cce > d.length || !cce) return r;
    try {
      const rgce = remapRows(d.slice(at, at + cce), (row, role) => rowMap(row, role), isThisSheet);
      d.set(rgce, at);
      return { type: r.type, data: d };
    } catch { return r; }
  });
  const sstBuilt = buildSST(sst.strings, sst.cstTotal);
  const lastXf = xfRecs.length ? xfRecs.at(-1)[1] : -1;
  const g2 = [];
  globals.forEach((r, i) => {
    if (i === sstAt) { g2.push(...sstBuilt.records); return; }
    if (i > sstAt && i < sstEnd) return;
    if (r.type === R.EXTSST) { g2.push({ type: R.EXTSST, data: new Uint8Array(2) }); return; } // placeholder, filled below
    g2.push(r);
    if (i === lastXf) for (const d of xfAdded) g2.push({ type: R.XF, data: d });
  });

  // --- lay out the stream, then fix BOUNDSHEET offsets and EXTSST
  const others = subs.slice(1).map((s, k) => (k === si ? newSheet : s));
  const layout = () => {
    let pos = 0;
    const recPos = g2.map((r) => { const p = pos; pos += 4 + r.data.length; return p; });
    const sheetPos = others.map((s) => { const p = pos; for (const r of s) pos += 4 + r.data.length; return p; });
    return { recPos, sheetPos };
  };
  let { recPos, sheetPos } = layout();
  // BOUNDSHEET lbPlyPos
  let bs = 0;
  for (const r of g2) if (r.type === R.BOUNDSHEET) { const d = r.data.slice(); set32(d, 0, sheetPos[bs++]); r.data = d; }
  // EXTSST
  const sstRecIdx = g2.findIndex((r) => r.type === R.SST);
  const dsst = Math.max(8, Math.ceil(sst.strings.length / 128));
  const ext = new W().u16(dsst);
  for (let k = 0; k < sst.strings.length; k += dsst) {
    const [ri, off] = sstBuilt.marks[k];
    ext.u32(recPos[sstRecIdx + ri] + 4 + off).u16(4 + off).u16(0);
  }
  const extAt = g2.findIndex((r) => r.type === R.EXTSST);
  if (extAt >= 0) g2[extAt] = { type: R.EXTSST, data: ext.out() };
  // EXTSST size change shifts later offsets: lay out again.
  ({ recPos, sheetPos } = layout());
  bs = 0;
  for (const r of g2) if (r.type === R.BOUNDSHEET) { const d = r.data.slice(); set32(d, 0, sheetPos[bs++]); r.data = d; }

  // Total count of LABELSST cells in the workbook (first field of the SST)
  let refs = 0;
  for (const r of others.flat()) if (r.type === R.LABELSST) refs++;
  const sstData = g2[sstRecIdx].data.slice(); set32(sstData, 0, refs); g2[sstRecIdx] = { type: R.SST, data: sstData };

  const newStream = recordsToBytes([...g2, ...others.flat()]);
  entry.content = newStream;
  entry.size = newStream.length;
  const out = X().CFB.write(cfb, { type: "array" });
  const bytes = out instanceof Uint8Array ? out : Uint8Array.from(out);
  if (options.report) Object.assign(options.report, { fixes, boqType, rows: items.length, footerRow: footer + delta + 1, unprotected: options.unprotect !== false });
  return bytes;
}

// ---------------------------------------------------------------------------
// Numbering helper: headings 1, 2, 3 … and items 1.01, 1.02 … (as in many GePNIC BOQs)
// ---------------------------------------------------------------------------

export function nicNumbering(sections, { headings = true } = {}) {
  const out = [];
  let n = 0;
  sections.forEach((s, si) => {
    if (!s.items.length) return;
    if (headings) {
      const h = si + 1;
      out.push({ heading: true, sno: h, description: s.name });
      const step = s.items.length > 99 ? 1000 : 100;
      s.items.forEach((it, k) => out.push({ ...it, sno: Math.round((h + (k + 1) / step) * step) / step }));
    } else {
      s.items.forEach((it) => out.push({ ...it, sno: ++n }));
    }
  });
  return out;
}
