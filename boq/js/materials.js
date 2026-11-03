// Approximate raw materials (cement, sand, aggregate, steel, bricks) for BOQ items, from the mix,
// grade, thickness and unit written in each item. Thumb rules as used on site; the department's
// analysis of rates governs.
import { num, round } from "./store.js";

export const MATS = [
  { key: "cement", label: "Cement", unit: "bags", re: /cement|opc|ppc|सीमेंट/i },
  { key: "sand", label: "Sand (coarse / fine)", unit: "cum", re: /sand|bajri|बजरी|रेत|reti/i },
  { key: "agg", label: "Aggregate / grit", unit: "cum", re: /aggregate|grit|gitti|गिट्टी|rodi|stone chips|kapchi/i },
  { key: "steel", label: "Steel", unit: "kg", re: /steel|tmt|saria|sariya|सरिया|\bbar\b|reinforcement/i },
  { key: "bricks", label: "Bricks", unit: "nos", re: /brick|ईंट|eent|\bint\b/i },
];
export const matOf = (name) => MATS.find((m) => m.re.test(String(name || "")))?.key || "";

const BAGS_PER_CUM = 1440 / 50; // cement: 1440 kg/cum, 50 kg bag
const DRY = 1.54 * 1.02; // dry volume of concrete ingredients for 1 cum wet, with 2 % wastage
const GRADE = { 5: [1, 5, 10], 7.5: [1, 4, 8], 10: [1, 3, 6], 15: [1, 2, 4], 20: [1, 1.5, 3] };
const DESIGN = { 25: 380, 30: 400, 35: 420, 40: 440, 45: 460 }; // kg cement per cum, design mixes

function normUnit(u) {
  const s = String(u || "").toLowerCase().replace(/[\s.]/g, "");
  if (/^(cum|cumt|m3|cubicmet(re|er)s?|cubm|cm)$/.test(s) || /cum|cu\.?m|m3/.test(s)) return "cum";
  if (/^(sqm|sqmt|m2|squaremet(re|er)s?)$/.test(s) || /sqm|sq\.?m|m2/.test(s)) return "sqm";
  if (/^(mt|tonne|tonnes|ton|tons|metricton)$/.test(s)) return "MT";
  if (/^(qtl|quintal|quintals)$/.test(s)) return "qtl";
  if (/^(kg|kgs|kilogram)$/.test(s)) return "kg";
  return s;
}

/** Materials for one cum of concrete of the given proportions (1 : s : a). */
const concrete = (s, a) => { const t = 1 + s + a; return { cement: (DRY / t) * BAGS_PER_CUM, sand: (DRY * s) / t, agg: (DRY * a) / t }; };
/** Materials for a dry mortar volume of the given proportion (1 : s). */
const mortar = (dry, s) => ({ cement: (dry / (1 + s)) * BAGS_PER_CUM, sand: (dry * s) / (1 + s) });

export function itemMaterials(desc, unit, qty) {
  const d = String(desc || "").toLowerCase().replace(/\s+/g, " ")
    .replace(/(\d)\s*½/g, "$1.5").replace(/(\d)\s*¼/g, "$1.25").replace(/(\d)\s*¾/g, "$1.75").replace(/½/g, "0.5");
  const u = normUnit(unit), q = num(qty);
  if (!q) return null;
  // Mix proportions such as 1:4:8 or 1:6, but not standard numbers such as "IS 16481:2022".
  const mixes = [...d.matchAll(/(^|[^\d.])1\s*:\s*(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?/g)].filter((m) => num(m[2]) <= 12);
  const r3 = mixes.find((m) => m[3]), r2 = mixes.find((m) => !m[3]);
  const ratio3 = r3 ? [r3[0], r3[2], r3[3]] : null;
  const ratio2 = r2 ? [r2[0], r2[2]] : null;
  const grade = d.match(/\bm\s*-?\s*(\d{1,2}(?:\.5)?)\b/);
  const mm = d.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:thick|th\.?|thk)/) || d.match(/(\d{2,3})\s*mm/);
  const out = (o, basis) => ({ ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v * (k === "steel" || k === "bricks" ? 1 : 1) * 1, 3)])), basis });

  // Steel items: quantity is the steel itself.
  if (/steel|reinforcement|tmt|\bfe\s*-?\s*(415|500|550)|bars?\b/.test(d) && ["kg", "MT", "qtl"].includes(u)) {
    const kg = u === "MT" ? q * 1000 : u === "qtl" ? q * 100 : q;
    return out({ steel: kg * 1.03 }, "steel + 3 % wastage");
  }
  // Plaster first: plaster items often mention concrete ("per cum of concrete / mortar").
  if (/plaster|rendering/.test(d) && u === "sqm") {
    const t = mm ? num(mm[1]) : 12, s = ratio2 ? num(ratio2[1]) : 6;
    const m = mortar((t / 1000) * 1.33 * q, s);
    return out({ cement: m.cement, sand: m.sand }, `${t} mm plaster, CM 1:${s}`);
  }
  const isConcrete = /concrete|\bp\.?c\.?c\b|\br\.?c\.?c\b|cement concrete|c\.c\./.test(d);
  // Concrete in cum (or in sqm with a real thickness, such as flooring and pavements).
  if (isConcrete && (u === "cum" || (u === "sqm" && mm && num(mm[1]) >= 25))) {
    const vol = u === "cum" ? q : q * (num(mm[1]) / 1000);
    const g = grade ? num(grade[1]) : 0;
    let per, basis;
    if (g && DESIGN[g]) { per = { cement: DESIGN[g] / 50, sand: 0.42, agg: 0.84 }; basis = `M${g} design mix ≈ ${DESIGN[g]} kg cement/cum`; }
    else if (g && GRADE[g]) { const [, s, a] = GRADE[g]; per = concrete(s, a); basis = `M${g} (1:${s}:${a})`; }
    else if (ratio3) { per = concrete(num(ratio3[1]), num(ratio3[2])); basis = `1:${ratio3[1]}:${ratio3[2]}`; }
    else return null;
    return out({ cement: per.cement * vol, sand: per.sand * vol, agg: per.agg * vol }, `${basis}${u === "sqm" ? `, ${mm[1]} mm thick` : ""}`);
  }
  // Brick masonry: about 500 bricks and 0.30 cum dry mortar per cum.
  if (/brick/.test(d) && u === "cum") {
    const s = ratio2 ? num(ratio2[1]) : 6;
    const m = mortar(0.30 * q, s);
    return out({ bricks: 500 * q, cement: m.cement, sand: m.sand }, `brickwork, CM 1:${s}`);
  }
  if (/brick/.test(d) && u === "sqm" && /half|115|4\.5|110/.test(d)) {
    const s = ratio2 ? num(ratio2[1]) : 4;
    const m = mortar(0.035 * q, s);
    return out({ bricks: 58 * q, cement: m.cement, sand: m.sand }, `half-brick wall, CM 1:${s}`);
  }
  // Stone masonry: about 0.42 cum dry mortar per cum.
  if (/stone masonry|rubble|r\.?r\.? masonry|stone work/.test(d) && u === "cum") {
    const s = ratio2 ? num(ratio2[1]) : 6;
    const m = mortar(0.42 * q, s);
    return out({ cement: m.cement, sand: m.sand }, `stone masonry, CM 1:${s} (stone not counted)`);
  }
  // Plaster: dry mortar = thickness × 1.33 per sqm.
  if (/plaster|rendering/.test(d) && u === "sqm") {
    const t = mm ? num(mm[1]) : 12, s = ratio2 ? num(ratio2[1]) : 6;
    const m = mortar((t / 1000) * 1.33 * q, s);
    return out({ cement: m.cement, sand: m.sand }, `${t} mm plaster, CM 1:${s}`);
  }
  // Flooring / pointing / bedding in cement mortar with a thickness.
  if (/mortar|screed|bedding/.test(d) && u === "sqm" && mm && ratio2) {
    const s = num(ratio2[1]);
    const m = mortar((num(mm[1]) / 1000) * 1.33 * q, s);
    return out({ cement: m.cement, sand: m.sand }, `${mm[1]} mm mortar 1:${s}`);
  }
  return null;
}

/** items: [{description, unit, qty, sno}] → { rows, totals, skipped } */
export function estimateMaterials(items) {
  const rows = [], totals = { cement: 0, sand: 0, agg: 0, steel: 0, bricks: 0 };
  let skipped = 0;
  for (const it of items || []) {
    const m = itemMaterials(it.description, it.unit, it.qty);
    if (!m) { skipped++; continue; }
    rows.push({ sno: it.sno, description: it.description, unit: it.unit, qty: num(it.qty), ...m });
    for (const k of Object.keys(totals)) totals[k] += num(m[k]);
  }
  for (const k of Object.keys(totals)) totals[k] = round(totals[k], k === "cement" || k === "bricks" || k === "steel" ? 0 : 2);
  return { rows, totals, skipped };
}
