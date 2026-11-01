// Persistence (IndexedDB) and the core data model.

const DB_NAME = "ratebook-boq";
const DB_VERSION = 1;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of ["bsrs", "projects", "kv"]) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

export const idb = {
  all: (store) => tx(store, "readonly", (s) => s.getAll()),
  put: (store, value) => tx(store, "readwrite", (s) => s.put(value)),
  del: (store, id) => tx(store, "readwrite", (s) => s.delete(id)),
  clear: (store) => tx(store, "readwrite", (s) => s.clear()),
};

export const uid = (p = "") =>
  p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DEFAULT_SETTINGS = {
  id: "settings",
  currency: "INR",
  locale: "en-IN",
  decimals: 2,
  qtyDecimals: 3,
  provider: "anthropic",
  model: "claude-opus-5-5",
  openaiModel: "",
};

export function defaultCharges() {
  return [
    { id: uid("c"), label: "Contingencies", percent: 3, on: "works" },
    { id: uid("c"), label: "Work-charged establishment", percent: 0, on: "works" },
    { id: uid("c"), label: "Contractor's profit & overheads", percent: 0, on: "works" },
    { id: uid("c"), label: "GST", percent: 18, on: "running" },
    { id: uid("c"), label: "Labour welfare cess", percent: 1, on: "works" },
  ];
}

export function newProject(name = "Untitled project") {
  return {
    id: uid("p"),
    name,
    client: "",
    location: "",
    preparedBy: "",
    reference: "",
    date: new Date().toISOString().slice(0, 10),
    sections: [{ id: uid("s"), name: "General", items: [] }],
    charges: defaultCharges(),
    format: {
      orgName: "",
      title: "Detailed Estimate",
      showCode: true,
      showRateBook: false,
      showRemarks: false,
      amountInWords: true,
      footer: "Rates are as per the schedule(s) of rates noted against each item.",
    },
    updatedAt: Date.now(),
  };
}

// ---------- maths ----------

export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).replace(/[,\s₹$€£]/g, "").replace(/^Rs\.?/i, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** One measurement row: nos × L × B × D, blank dimensions ignored. */
export function measurementQty(m) {
  const parts = [m.nos, m.l, m.b, m.d].filter((v) => v !== "" && v != null && !Number.isNaN(Number(v)));
  if (!parts.length) return 0;
  return parts.reduce((a, v) => a * Number(v), 1);
}

export function itemQty(item) {
  if (item.measurements && item.measurements.length) {
    return item.measurements.reduce((a, m) => a + measurementQty(m), 0);
  }
  return num(item.qty);
}

export const itemAmount = (item) => round(itemQty(item) * num(item.rate), 2);

export function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round((v + Number.EPSILON) * f) / f;
}

export function sectionTotal(section) {
  return round(section.items.reduce((a, it) => a + itemAmount(it), 0), 2);
}

/** Abstract: works total, then each add-on in order. "works" = % of works total, "running" = % of running total. */
export function computeAbstract(project) {
  const sections = project.sections.map((s) => ({ name: s.name, total: sectionTotal(s), count: s.items.length }));
  const works = round(sections.reduce((a, s) => a + s.total, 0), 2);
  let running = works;
  const charges = [];
  for (const c of project.charges) {
    const base = c.on === "running" ? running : works;
    const amount = round((base * num(c.percent)) / 100, 2);
    charges.push({ ...c, base, amount });
    running = round(running + amount, 2);
  }
  return { sections, works, charges, grand: running };
}

// ---------- formatting ----------

let settingsRef = DEFAULT_SETTINGS;
export function setSettingsRef(s) { settingsRef = s; }

export function money(v, withSymbol = true) {
  const s = settingsRef;
  try {
    return new Intl.NumberFormat(s.locale, {
      style: withSymbol ? "currency" : "decimal",
      currency: s.currency,
      minimumFractionDigits: s.decimals,
      maximumFractionDigits: s.decimals,
    }).format(v || 0);
  } catch {
    return (v || 0).toFixed(s.decimals);
  }
}

export function qtyFmt(v) {
  const d = settingsRef.qtyDecimals;
  return new Intl.NumberFormat(settingsRef.locale, { minimumFractionDigits: 0, maximumFractionDigits: d }).format(v || 0);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""); }
function three(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? two(r) : ""].filter(Boolean).join(" ");
}

/** Amount in words. Indian system (lakh/crore) for INR, international otherwise. */
export function amountInWords(v) {
  const cur = settingsRef.currency;
  const whole = Math.floor(Math.abs(v));
  const fraction = Math.round((Math.abs(v) - whole) * 100);
  let words;
  if (whole === 0) words = "Zero";
  else if (cur === "INR") {
    const parts = [];
    let n = whole;
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push((crore > 999 ? amountInWordsPlain(crore) : three(crore) || two(crore)) + " Crore");
    if (lakh) parts.push(two(lakh) + " Lakh");
    if (thousand) parts.push(two(thousand) + " Thousand");
    if (n) parts.push(three(n));
    words = parts.join(" ");
  } else words = amountInWordsPlain(whole);
  const names = { INR: ["Rupees", "Paise"], USD: ["Dollars", "Cents"], EUR: ["Euros", "Cents"], GBP: ["Pounds", "Pence"], AED: ["Dirhams", "Fils"] };
  const [major, minor] = names[cur] || [cur, "cents"];
  return `${major} ${words}${fraction ? ` and ${two(fraction)} ${minor}` : ""} only`;
}
function amountInWordsPlain(n) {
  const scales = ["", " Thousand", " Million", " Billion", " Trillion"];
  const out = [];
  let i = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) out.unshift(three(chunk) + scales[i]);
    n = Math.floor(n / 1000); i++;
  }
  return out.join(" ");
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
