// Local search and fuzzy matching of work descriptions to rate-book items.

const STOP = new Set(("a an the of in on at to for with and or by from as is be all any including incl inclusive etc " +
  "providing laying fixing complete per item work works upto up including means make making specified specification " +
  "required approved directed engineer charge site level levels lead lift all kinds as per cost rate rates its this that").split(" "));

const SYN = [
  [/\br\.?\s?c\.?\s?c\.?\b/g, " reinforced cement concrete "],
  [/\bp\.?\s?c\.?\s?c\.?\b/g, " plain cement concrete "],
  [/\bc\.?\s?c\.?\b/g, " cement concrete "],
  [/\bc\.?\s?m\.?\b(?=\s*1)/g, " cement mortar "],
  [/\bbrickwork\b/g, " brick masonry "],
  [/\bblockwork\b/g, " block masonry "],
  [/\btmt\b|\btor\b|\brebars?\b|\bhysd\b/g, " reinforcement steel bars "],
  [/\bexcav\w*/g, " excavation "],
  [/\bplastering\b/g, " plaster "],
  [/\bpainting\b/g, " paint "],
  [/\bwhite\s?wash\w*/g, " whitewash "],
  [/\bshuttering\b|\bformwork\b|\bcentering\b/g, " formwork centering shuttering "],
  [/\bflooring\b/g, " floor "],
  [/\btiles?\b|\btiling\b/g, " tile "],
  [/\bw\.?p\.?\b|\bwaterproof\w*/g, " waterproofing "],
  [/\bmm\b/g, "mm"],
];

export function tokens(s) {
  let t = " " + String(s || "").toLowerCase() + " ";
  for (const [re, rep] of SYN) t = t.replace(re, rep);
  t = t.replace(/(\d)\s*:\s*(\d)/g, "$1:$2").replace(/(\d+)\s*mm/g, "$1mm").replace(/\bm\s?-?\s?(\d{2})\b/g, "m$1");
  return t.split(/[^a-z0-9:]+/).filter((w) => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w))).map(stem);
}
const bigrams = (tk) => new Set(tk.slice(1).map((w, i) => tk[i] + " " + w));
const stem = (w) => (w.length > 4 ? w.replace(/(ings|ing|ed|es|s)$/, "") : w);

export class Index {
  constructor(items) {
    this.items = items;
    this.docs = items.map((it) => {
      const tk = tokens(`${it.description} ${it.chapter || ""} ${it.code || ""}`);
      return { it, set: new Set(tk), pairs: bigrams(tk), text: `${it.code} ${it.description} ${it.chapter || ""}`.toLowerCase() };
    });
    const df = new Map();
    for (const d of this.docs) for (const w of d.set) df.set(w, (df.get(w) || 0) + 1);
    const N = this.docs.length || 1;
    this.idf = (w) => Math.log(1 + N / (df.get(w) || 0.5));
  }

  /** Free-text search: every word must appear (prefix match) somewhere in the item. */
  search(q, filter = () => true, limit = 500) {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const d of this.docs) {
      if (!filter(d.it)) continue;
      if (words.every((w) => d.text.includes(w))) out.push(d.it);
      if (out.length >= limit) break;
    }
    if (out.length || !words.length) return out;
    // Nothing literal: fall back to fuzzy ranking.
    return this.match(q, "", 50).filter((m) => filter(m.item)).map((m) => m.item);
  }

  /** Rank items by weighted token overlap, with a bonus for compatible units. */
  match(description, unit = "", top = 5) {
    const q = [...new Set(tokens(description))];
    if (!q.length) return [];
    const qW = q.reduce((a, w) => a + this.idf(w), 0);
    const qPairs = [...bigrams(tokens(description))];
    const u = canonUnit(unit);
    const scored = [];
    for (const d of this.docs) {
      let s = 0;
      for (const w of q) if (d.set.has(w)) s += this.idf(w);
      if (!s) continue;
      // Phrase bonus: adjacent word pairs that also appear together in the item ("plinth beam", "suspended floor").
      for (const p of qPairs) if (d.pairs.has(p)) s += 0.5;
      let score = s / (qW + 0.15 * Math.sqrt(d.set.size));
      if (u && canonUnit(d.it.unit) === u) score *= 1.25;
      else if (u && d.it.unit && canonUnit(d.it.unit) !== u) score *= 0.75;
      scored.push({ item: d.it, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, top);
  }
}

export function canonUnit(u) {
  const s = String(u || "").toLowerCase().replace(/[\s.]/g, "");
  if (/^(cum|cum|m3|m³|cubicmet)/.test(s)) return "cum";
  if (/^(sqm|m2|m²|sqmtr|squaremet)/.test(s)) return "sqm";
  if (/^(m|rm|rmt|mtr|metre|meter|runningmet)$/.test(s)) return "m";
  if (/^(no|nos|each|ea|number|pcs|piece)/.test(s)) return "nos";
  if (/^(kg|kgs)$/.test(s)) return "kg";
  if (/^(t|mt|tonne|ton)/.test(s)) return "tonne";
  if (/^(quintal|qtl)$/.test(s)) return "quintal";
  return s;
}

/** Quantity conversion factor when rate unit differs only by multiplier (e.g. 10 sqm, quintal vs kg). */
export function unitFactor(fromUnit, toUnit) {
  const f = canonUnit(fromUnit), t = String(toUnit || "").toLowerCase().replace(/\s/g, "");
  const m = t.match(/^(\d+)(sqm|cum|m|kg|nos)$/);
  if (m && canonUnit(m[2]) === f) return 1 / Number(m[1]);
  if (f === "kg" && canonUnit(toUnit) === "quintal") return 0.01;
  if (f === "kg" && canonUnit(toUnit) === "tonne") return 0.001;
  if (f === "tonne" && canonUnit(toUnit) === "kg") return 1000;
  return 1;
}
