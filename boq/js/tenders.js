// Tenders: each contractor chooses which tenders they want to hear about (departments, districts,
// amount, kind of work, words) and how; a list of matching tenders from the feed; and their own
// tender tracker with reminders for the bid end and opening dates.
// The feed (data/tenders.json) is written by the scraper once it is switched on; until then the
// list stays empty and the tracker works on its own.
import { idb, uid, num, esc, money } from "./store.js";
import { readBidderBoq, fillBidderBoq, checkBid, bidAmounts, inrWords } from "./nicboq.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let ctx = null;

export const DEPTS = [
  ["pwd", "PWD (Public Works Department)", /public works|\bpwd\b/i],
  ["phed", "PHED / Jal Jeevan Mission", /phed|public health engineering|jal jeevan|water supply/i],
  ["lsg", "Nagar Nigam / Parishad / Palika (LSG)", /nagar nigam|nagar parishad|nagar palika|municipal|local self|\blsg\b|\bulb\b/i],
  ["da", "Development Authority (JDA / JoDA / ADA…)", /development authority|\bjda\b|\bjoda\b|\bada\b|\bkda\b/i],
  ["uit", "UIT (Urban Improvement Trust)", /urban improvement trust|\buit\b/i],
  ["ruidp", "RUIDP", /ruidp|urban infrastructure development/i],
  ["smart", "Smart City", /smart city/i],
  ["rhb", "Rajasthan Housing Board", /housing board/i],
  ["wrd", "Water Resources / Irrigation / IGNP", /water resources|irrigation|indira gandhi nahar|\bignp\b|\bwrd\b/i],
  ["pr", "Panchayati Raj / Zila Parishad / Rural Dev.", /panchayat|zila parishad|rural development|\bmgnrega\b/i],
  ["rsrdc", "RSRDC / Road Development Corporation", /rsrdc|road development corporation|state road/i],
  ["riico", "RIICO", /riico|industrial development/i],
  ["power", "Power (JVVNL / AVVNL / JdVVNL / RVPN)", /vidyut|jvvnl|avvnl|jdvvnl|rvpn|rvun|power|electricity/i],
  ["health", "Medical & Health / NHM", /medical|health|nhm|hospital/i],
  ["edu", "Education / Samagra Shiksha", /education|shiksha|school|college|university/i],
  ["forest", "Forest / Environment", /forest|environment|van vibhag/i],
  ["agri", "Agriculture / Krishi Mandi Board", /agricultur|krishi|mandi/i],
  ["police", "Police Housing (RPHCCL)", /police housing|rphccl|police/i],
  ["tourism", "Tourism / RTDC / Devasthan", /tourism|rtdc|devasthan|archaeolog/i],
];
export const DISTRICTS = ["Ajmer", "Alwar", "Balotra", "Banswara", "Baran", "Barmer", "Beawar", "Bharatpur", "Bhilwara", "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa", "Deeg", "Dholpur",
  "Didwana-Kuchaman", "Dungarpur", "Hanumangarh", "Jaipur", "Jaisalmer", "Jalore", "Jhalawar", "Jhunjhunu", "Jodhpur", "Karauli", "Khairthal-Tijara", "Kota", "Kotputli-Behror", "Nagaur", "Pali",
  "Phalodi", "Pratapgarh", "Rajsamand", "Salumbar", "Sawai Madhopur", "Sikar", "Sirohi", "Sri Ganganagar", "Tonk", "Udaipur"];
export const KINDS = [
  ["road", "Road (CC / bitumen / interlocking)", /road|\bcc\b|bitumen|interlock|paver|bt\b|sadak|सड़क/i],
  ["building", "Building / civil construction", /building|construction of .*(room|hall|bhawan|office|school|hostel)|bhawan|civil work/i],
  ["drain", "Drain / nala / sewer", /drain|nala|nalla|sewer|sewerage|manhole/i],
  ["water", "Water supply / pipeline / tubewell", /pipe ?line|water supply|tube ?well|bore ?well|\btank\b|reservoir|ohsr/i],
  ["bridge", "Bridge / culvert", /bridge|culvert|puliya/i],
  ["wall", "Boundary wall", /boundary wall|compound wall/i],
  ["electric", "Electrical / street light / solar", /electric|street ?light|lighting|solar|\bled\b|transformer/i],
  ["paint", "Painting / beautification", /paint|beautif|mural|art work/i],
  ["repair", "Repair / maintenance", /repair|maintenance|renovation|\bm&r\b|patch/i],
  ["park", "Park / garden / plantation", /park|garden|horticultur|plantation|tree/i],
  ["waste", "Solid waste / sanitation", /waste|sanitation|swachh|toilet|compost|landfill/i],
  ["supply", "Supply of material / equipment", /supply of|procurement of|purchase of/i],
  ["service", "Services / manpower / hiring", /hiring|manpower|outsourc|services|security/i],
];
export const AMOUNTS = [[0, 2500000, "Up to ₹25 L"], [2500000, 10000000, "₹25 L – 1 Cr"], [10000000, 50000000, "₹1 – 5 Cr"], [50000000, 0, "Above ₹5 Cr"]];

const DEFAULT_PREFS = { on: true, depts: [], districts: [], min: 0, max: 0, kinds: [], words: "", exclude: "", type: "Works", channels: { app: true, telegram: false, email: false }, email: "", telegram: "", remindDays: 3 };
const state = { prefs: { ...DEFAULT_PREFS }, mine: [], feed: null, feedErr: "", tab: "alerts", q: "" };

export async function initTenders(c) {
  ctx = c;
  state.prefs = { ...DEFAULT_PREFS, ...((await idb.get("kv", "tenderPrefs"))?.value || {}) };
  state.mine = (await idb.get("kv", "myTenders"))?.value || [];
  const root = $("#tendersRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", (e) => { if (e.target.matches("[data-pw]")) { state.prefs[e.target.dataset.pw] = e.target.value; savePrefs(false); } });
  root.addEventListener("input", onBidInput);
  await loadBidDraft();
  loadFeed();
  setTimeout(remindOnOpen, 1500);
}
const savePrefs = (render = true) => { idb.put("kv", { id: "tenderPrefs", value: state.prefs }); if (render) renderTenders(); };
const saveMine = () => idb.put("kv", { id: "myTenders", value: state.mine });

async function loadFeed() {
  try {
    const r = await fetch(`data/tenders.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 404 ? "not yet" : `HTTP ${r.status}`);
    const j = await r.json(); state.feed = Array.isArray(j) ? { tenders: j } : j; state.feedErr = "";
  } catch (e) { state.feed = null; state.feedErr = e.message; }
  if ($("#tab-tenders")?.classList.contains("active")) renderTenders();
}

/** Does a tender from the feed match the user's choices? */
export function matches(t, p = state.prefs) {
  const text = `${t.title || ""} ${t.org || ""} ${t.work || ""}`;
  const org = `${t.org || ""} ${t.dept || ""}`;
  if (p.type && p.type !== "All" && t.type && !new RegExp(p.type, "i").test(t.type)) return false;
  if (p.depts.length && !p.depts.some((k) => DEPTS.find((d) => d[0] === k)?.[2].test(org))) return false;
  if (p.districts.length && !p.districts.some((d) => new RegExp(d.split("-")[0], "i").test(`${t.district || ""} ${t.location || ""} ${org} ${t.title || ""}`))) return false;
  const v = num(t.value);
  if (v && p.min && v < p.min) return false;
  if (v && p.max && v > p.max) return false;
  if (p.kinds.length && !p.kinds.some((k) => KINDS.find((x) => x[0] === k)?.[2].test(text))) return false;
  const words = p.words.split(",").map((w) => w.trim()).filter(Boolean);
  if (words.length && !words.some((w) => text.toLowerCase().includes(w.toLowerCase()))) return false;
  const ex = p.exclude.split(",").map((w) => w.trim()).filter(Boolean);
  if (ex.some((w) => text.toLowerCase().includes(w.toLowerCase()))) return false;
  return true;
}

const fdt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const daysTo = (d) => (d ? Math.ceil((new Date(d) - Date.now()) / 864e5) : null);
const lakh = (v) => (num(v) ? (num(v) >= 1e7 ? `₹${(num(v) / 1e7).toFixed(2)} Cr` : `₹${(num(v) / 1e5).toFixed(2)} L`) : "");

export function renderTenders() {
  const root = $("#tendersRoot"); if (!root) return;
  const p = state.prefs;
  const tabs = [["alerts", "🔔 My alerts"], ["list", "📋 Matching tenders"], ["mine", `⭐ My tenders (${state.mine.length})`], ["bid", "📝 Bid BOQ (fill rates)"]];
  root.innerHTML = `<div class="tender-hero"><div><div class="hero-kicker">eProc Rajasthan · tender alerts</div><h2>Tenders you care about, nothing else</h2>
      <p>Choose the departments, districts, amount and kind of work. Only matching tenders are shown and alerted, with reminders before the bid end and opening dates.</p></div>
      <label class="switch big"><input type="checkbox" data-pon ${p.on ? "checked" : ""}><span></span><b>${p.on ? "Alerts on" : "Alerts paused"}</b></label></div>
    <nav class="subnav">${tabs.map(([k, l]) => `<button data-ttab="${k}" class="${state.tab === k ? "active" : ""}">${l}</button>`).join("")}</nav>
    <div id="tenderBody">${state.tab === "alerts" ? prefsView() : state.tab === "list" ? listView() : state.tab === "bid" ? bidView() : mineView()}</div>`;
}

const chip = (group, key, label, on) => `<button class="tchip ${on ? "on" : ""}" data-tg="${group}" data-tk="${esc(key)}">${on ? "✓ " : ""}${esc(label)}</button>`;
function prefsView() {
  const p = state.prefs;
  const amtOn = (a, b) => p.min === a && p.max === b;
  return `<div class="card"><h3><span class="hico">🏛️</span>Departments <span class="muted small">(none ticked = all)</span></h3>
      <div class="tchips">${DEPTS.map(([k, l]) => chip("depts", k, l, p.depts.includes(k))).join("")}</div></div>
    <div class="card"><h3><span class="hico">📍</span>Districts <span class="muted small">(none ticked = all of Rajasthan)</span></h3>
      <div class="tchips">${DISTRICTS.map((d) => chip("districts", d, d, p.districts.includes(d))).join("")}</div></div>
    <div class="grid-2">
      <div class="card"><h3><span class="hico">₹</span>Amount (estimated value)</h3>
        <div class="tchips">${AMOUNTS.map(([a, b, l]) => `<button class="tchip ${amtOn(a, b) ? "on" : ""}" data-amt="${a}|${b}">${amtOn(a, b) ? "✓ " : ""}${l}</button>`).join("")}<button class="tchip ${!p.min && !p.max ? "on" : ""}" data-amt="0|0">${!p.min && !p.max ? "✓ " : ""}Any amount</button></div>
        <div class="form-grid compact mt"><label class="field">From ₹ (lakh)<input type="number" step="any" data-amtl="min" value="${p.min ? p.min / 1e5 : ""}" placeholder="0"></label>
          <label class="field">Up to ₹ (lakh)<input type="number" step="any" data-amtl="max" value="${p.max ? p.max / 1e5 : ""}" placeholder="no limit"></label></div></div>
      <div class="card"><h3><span class="hico">📑</span>Tender type</h3>
        <div class="tchips">${["Works", "Goods", "Services", "All"].map((t) => `<button class="tchip ${p.type === t ? "on" : ""}" data-ttype="${t}">${p.type === t ? "✓ " : ""}${t}</button>`).join("")}</div>
        <label class="field mt">Remind me before the bid end date<select data-prem>${[1, 2, 3, 5, 7].map((d) => `<option value="${d}" ${num(p.remindDays) === d ? "selected" : ""}>${d} day${d > 1 ? "s" : ""} before</option>`).join("")}</select></label></div>
    </div>
    <div class="card"><h3><span class="hico">🏗️</span>Kind of work <span class="muted small">(none ticked = all)</span></h3>
      <div class="tchips">${KINDS.map(([k, l]) => chip("kinds", k, l, p.kinds.includes(k))).join("")}</div>
      <div class="form-grid compact mt"><label class="field">Must contain any of these words (comma separated)<input data-pw="words" value="${esc(p.words)}" placeholder="e.g. interlocking, CC road, Basni"></label>
        <label class="field">Leave out tenders with these words<input data-pw="exclude" value="${esc(p.exclude)}" placeholder="e.g. supply, AMC, hiring of vehicle"></label></div></div>
    <div class="card"><h3><span class="hico">📲</span>How to alert me</h3>
      <div class="checks"><label class="check"><input type="checkbox" data-ch="app" ${p.channels.app ? "checked" : ""}> In this app (Tenders tab and a note when the app opens)</label>
        <label class="check"><input type="checkbox" data-ch="telegram" ${p.channels.telegram ? "checked" : ""}> Telegram <span class="muted small">(free; switched on with the alert service)</span></label>
        <label class="check"><input type="checkbox" data-ch="email" ${p.channels.email ? "checked" : ""}> Email <span class="muted small">(switched on with the alert service)</span></label></div>
      <div class="form-grid compact mt">${p.channels.telegram ? `<label class="field">Telegram username or phone<input data-pw="telegram" value="${esc(p.telegram)}" placeholder="@yourname"></label>` : ""}${p.channels.email ? `<label class="field">Email<input type="email" data-pw="email" value="${esc(p.email)}"></label>` : ""}</div>
      <div class="row gap wrap mt"><button class="primary" data-tact="savePrefs">💾 Save my alert choices</button><button class="ghost" data-tact="resetPrefs">Clear all choices</button>
        <button class="ghost danger-text" data-tact="stop">${p.on ? "⏸ Pause all alerts" : "▶ Turn alerts on"}</button></div>
      <p class="muted small mt">${summary(p)}</p></div>`;
}
function summary(p) {
  const d = p.depts.length ? p.depts.map((k) => DEPTS.find((x) => x[0] === k)?.[1].split(" (")[0]).join(", ") : "all departments";
  const z = p.districts.length ? p.districts.join(", ") : "all districts";
  const a = !p.min && !p.max ? "any amount" : `${p.min ? `from ${lakh(p.min)}` : ""}${p.min && p.max ? " " : ""}${p.max ? `up to ${lakh(p.max)}` : ""}`;
  const k = p.kinds.length ? p.kinds.map((x) => KINDS.find((y) => y[0] === x)?.[1].split(" (")[0].split(" /")[0]).join(", ") : "all kinds of work";
  return `${p.on ? "You will get" : "Alerts are paused. When on, you get"}: <b>${esc(p.type === "All" ? "all" : p.type)}</b> tenders of <b>${esc(d)}</b> in <b>${esc(z)}</b>, <b>${esc(a)}</b>, for <b>${esc(k)}</b>${p.words ? ` containing “${esc(p.words)}”` : ""}${p.exclude ? `, leaving out “${esc(p.exclude)}”` : ""}.`;
}

function listView() {
  if (!state.feed) return `<div class="card empty-state"><h2>Tender list not connected yet</h2>
    <p>The list of new tenders from eproc.rajasthan.gov.in starts once the tender scraper is switched on. Your alert choices are already saved and will be used from then on. Meanwhile add the tenders you are working on in <b>⭐ My tenders</b> for date reminders.</p>
    <button class="ghost" data-tact="reload">↻ Check again</button></div>`;
  const all = state.feed.tenders || [];
  const list = all.filter((t) => matches(t)).filter((t) => !state.q || `${t.title} ${t.org} ${t.id}`.toLowerCase().includes(state.q.toLowerCase()));
  return `<div class="card"><div class="row between wrap"><h2>${list.length} matching of ${all.length} tenders</h2><input type="search" data-tq value="${esc(state.q)}" placeholder="Search"></div>
    <p class="muted small">Updated ${fdt(state.feed.updated)} · source: eproc.rajasthan.gov.in</p>
    <div class="tlist">${list.map((t) => tenderCard(t, true)).join("") || `<p class="muted">No tender matches your choices right now.</p>`}</div></div>`;
}
function tenderCard(t, fromFeed) {
  const d = daysTo(t.bidEnd || t.closing);
  const tracked = state.mine.some((m) => m.tenderId === (t.tenderId || t.id));
  return `<div class="tcard" data-tid="${esc(t.id)}"><div class="tcard-h"><span class="ac-no">${esc(t.tenderId || t.id || "")}</span>${d != null ? `<span class="badge ${d <= 2 ? "warn-badge" : ""}">${d < 0 ? "closed" : d === 0 ? "closes today" : `${d} days left`}</span>` : ""}${t.status ? `<span class="badge">${esc(t.status)}</span>` : ""}</div>
    <b>${esc(t.title || "")}</b><div class="muted small">${esc(t.org || t.dept || "")}${t.district ? ` · ${esc(t.district)}` : ""}</div>
    <div class="tmeta">${num(t.value) ? `<span>Value <b>${lakh(t.value)}</b></span>` : ""}${num(t.emd) ? `<span>EMD <b>${money(t.emd)}</b></span>` : ""}<span>Bid end <b>${fdt(t.bidEnd || t.closing)}</b></span><span>Opening <b>${fdt(t.opening)}</b></span></div>
    <div class="row gap wrap">${t.link ? `<a class="ghost btn small" href="${esc(t.link)}" target="_blank" rel="noopener">Open on eProc ↗</a>` : ""}
      ${fromFeed ? (tracked ? `<span class="badge">⭐ In my tenders</span>` : `<button class="ghost small" data-tact="track">⭐ Track</button>`) : `<button class="ghost small" data-tact="editMine">✎ Edit</button><button class="ghost small danger-text" data-tact="delMine">🗑 Remove</button>`}
      ${!fromFeed ? `<select data-mstatus>${["Studying", "Bid submitted", "Technical bid open", "L1", "Not L1", "Work order received", "Dropped"].map((s) => `<option ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}</div></div>`;
}
function mineView() {
  const list = [...state.mine].sort((a, b) => String(a.bidEnd || "9").localeCompare(String(b.bidEnd || "9")));
  return `<div class="card"><div class="row between wrap"><h2>My tenders</h2><button class="primary" data-tact="addMine">＋ Add a tender</button></div>
    <p class="muted small">Tenders you are studying or have bid for, with reminders ${state.prefs.remindDays} day(s) before the bid end and before the opening date.</p>
    <div class="tlist">${list.map((t) => tenderCard(t, false)).join("") || `<p class="muted">None yet. Add one with its tender ID, name and dates.</p>`}</div></div>`;
}

function mineDialog(t = {}) {
  const F = (k, l, type = "text", ph = "") => `<label class="field">${l}<input data-mf="${k}" type="${type}" value="${esc(t[k] ?? "")}" placeholder="${ph}"></label>`;
  ctx.modal(`<h2>${t.id ? "Edit tender" : "Add a tender"}</h2><div class="form-grid">
    ${F("tenderId", "Tender ID", "text", "2026_PWD_123456_1")}<label class="field" style="grid-column:1/-1">Name of work<textarea data-mf="title" rows="2">${esc(t.title || "")}</textarea></label>
    ${F("org", "Department / office")}${F("district", "District")}${F("value", "Estimated value ₹", "number")}${F("emd", "EMD ₹", "number")}
    ${F("bidEnd", "Bid submission end", "datetime-local")}${F("opening", "Bid opening", "datetime-local")}${F("link", "eProc link (optional)")}${F("notes", "Notes")}</div>
    <button class="primary mt" id="mSave">Save</button>`, (m) => {
    $("#mSave", m).onclick = () => {
      const rec = { ...t, id: t.id || uid("t"), status: t.status || "Studying" };
      $$("[data-mf]", m).forEach((i) => { rec[i.dataset.mf] = i.type === "number" ? num(i.value) : i.value.trim(); });
      if (!rec.title && !rec.tenderId) { ctx.toast("Give the tender ID or name."); return; }
      const i = state.mine.findIndex((x) => x.id === rec.id); if (i >= 0) state.mine[i] = rec; else state.mine.push(rec);
      saveMine(); ctx.closeModal(); state.tab = "mine"; renderTenders();
    };
  });
}

/** When the app opens: tenders whose bid end or opening is near. */
function remindOnOpen() {
  if (!state.prefs.on || !state.prefs.channels.app) return;
  const near = state.mine.filter((t) => !["Dropped", "Work order received", "Not L1"].includes(t.status)).flatMap((t) => {
    const out = [], b = daysTo(t.bidEnd), o = daysTo(t.opening);
    if (b != null && b >= 0 && b <= num(state.prefs.remindDays) && t.status === "Studying") out.push(`${t.tenderId || t.title}: bid ends ${b === 0 ? "today" : `in ${b} day${b > 1 ? "s" : ""}`}`);
    if (o != null && o >= 0 && o <= 2) out.push(`${t.tenderId || t.title}: opens ${o === 0 ? "today" : `in ${o} day${o > 1 ? "s" : ""}`}`);
    return out;
  });
  if (near.length) ctx.toast(`⏰ ${near.slice(0, 3).join(" · ")}${near.length > 3 ? ` (+${near.length - 3} more)` : ""}`, 9000);
}

function onBidInput(e) {
  const t = e.target;
  if (t.matches("[data-bidname]")) { bid.data.bidder = t.value; bid.msg = null; saveBidDraft(); return; }
  if (t.matches("[data-brate]")) {
    const [sh, row] = t.dataset.brate.split("|"); bid.data.sheets[sh].rates[row] = t.value === "" ? "" : Number(t.value);
    const it = bid.info.sheets.find((x) => x.name === sh).items.find((x) => String(x.row) === row);
    const cell = document.querySelector(`[data-bamt="${sh}|${row}"]`); if (cell) cell.textContent = rs((Number(it.qty) || 0) * (Number(t.value) || 0));
    t.classList.toggle("need", !(Number(t.value) > 0)); saveBidDraft();
  }
}
function onClick(e) {
  const t = e.target, p = state.prefs;
  const bact = t.closest("[data-tact]")?.dataset.tact;
  if (bact === "bidCheck") { bid.msg = checkBid(bid.info, bid.data); return renderTenders(); }
  if (bact === "bidSave") return bidSave();
  if (bact === "bidClose") { if (!confirm("Close this BOQ? Rates typed so far are lost unless the BOQ was saved.")) return; Object.assign(bid, { name: "", bytes: null, info: null, data: null, msg: null }); saveBidDraft(); return renderTenders(); }
  if (bact === "bulkLess") {
    const sh = t.closest("[data-sheet]").dataset.sheet, pc = num(document.querySelector(`[data-bulk="${sh}"]`)?.value);
    const s = bid.info.sheets.find((x) => x.name === sh);
    for (const it of s.items) if (!it.heading && it.est) bid.data.sheets[sh].rates[it.row] = Math.round(it.est * (1 - pc / 100) * 100) / 100;
    ctx.toast(`Rates set to the estimate ${pc >= 0 ? "less" : "plus"} ${Math.abs(pc)}%. Change any rate as needed.`); return bidRefresh();
  }
  const tt = t.closest("[data-ttab]"); if (tt) { state.tab = tt.dataset.ttab; return renderTenders(); }
  const c = t.closest("[data-tg]");
  if (c) { const g = c.dataset.tg, k = c.dataset.tk; p[g] = p[g].includes(k) ? p[g].filter((x) => x !== k) : [...p[g], k]; return savePrefs(); }
  const a = t.closest("[data-amt]"); if (a) { const [mn, mx] = a.dataset.amt.split("|").map(Number); p.min = mn; p.max = mx; return savePrefs(); }
  const ty = t.closest("[data-ttype]"); if (ty) { p.type = ty.dataset.ttype; return savePrefs(); }
  const act = t.closest("[data-tact]")?.dataset.tact;
  if (act === "savePrefs") { savePrefs(); ctx.toast("Alert choices saved ✓"); }
  if (act === "resetPrefs") { if (!confirm("Clear all alert choices?")) return; state.prefs = { ...DEFAULT_PREFS, channels: { ...DEFAULT_PREFS.channels } }; savePrefs(); }
  if (act === "stop") { p.on = !p.on; savePrefs(); ctx.toast(p.on ? "Alerts are on." : "All alerts paused. Turn them on again here any time."); }
  if (act === "reload") loadFeed();
  if (act === "addMine") mineDialog();
  const id = t.closest("[data-tid]")?.dataset.tid;
  if (act === "editMine") mineDialog(state.mine.find((x) => x.id === id));
  if (act === "delMine") { if (!confirm("Remove this tender from my tenders?")) return; state.mine = state.mine.filter((x) => x.id !== id); saveMine(); renderTenders(); }
  if (act === "track") {
    const f = (state.feed?.tenders || []).find((x) => String(x.id) === id); if (!f) return;
    state.mine.push({ id: uid("t"), tenderId: f.tenderId || f.id, title: f.title, org: f.org, district: f.district, value: f.value, emd: f.emd, bidEnd: f.bidEnd || f.closing, opening: f.opening, link: f.link, status: "Studying" });
    saveMine(); ctx.toast("Added to my tenders ⭐"); renderTenders();
  }
}
function onChange(e) {
  const t = e.target, p = state.prefs;
  if (t.matches("[data-bidfile]")) { const f = t.files[0]; t.value = ""; if (f) openBidFile(f); return; }
  if (t.matches("[data-bdir]")) { bid.data.sheets[t.dataset.bdir].quote.dir = t.value; return bidRefresh(); }
  if (t.matches("[data-bpct]")) { bid.data.sheets[t.dataset.bpct].quote.pct = t.value === "" ? "" : Number(t.value); return bidRefresh(); }
  if (t.matches("[data-brate]")) return bidRefresh();
  if (t.matches("[data-pon]")) { p.on = t.checked; return savePrefs(); }
  if (t.matches("[data-amtl]")) { p[t.dataset.amtl] = Math.round(num(t.value) * 1e5); return savePrefs(); }
  if (t.matches("[data-ch]")) { p.channels[t.dataset.ch] = t.checked; return savePrefs(); }
  if (t.matches("[data-prem]")) { p.remindDays = num(t.value); return savePrefs(); }
  if (t.matches("[data-tq]")) { state.q = t.value; return renderTenders(); }
  if (t.matches("[data-mstatus]")) { const m = state.mine.find((x) => x.id === t.closest("[data-tid]").dataset.tid); if (m) { m.status = t.value; saveMine(); } }
}

// ---------------------------------------------------------------------------
// Bid BOQ: open the BOQ downloaded from the portal, fill the firm's name and rates, check, save
// ---------------------------------------------------------------------------

const bid = { name: "", bytes: null, info: null, data: null, msg: null };

async function openBidFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = readBidderBoq(bytes);
    const data = { bidder: info.sheets[0]?.bidder || ctx.company?.()?.name || "", sheets: {} };
    for (const s of info.sheets) {
      const rates = {}; for (const it of s.items) if (!it.heading && it.rate != null) rates[it.row] = it.rate;
      data.sheets[s.name] = { rates, quote: { dir: s.quote.dir || "Select", pct: s.quote.pct ?? "" } };
    }
    Object.assign(bid, { name: file.name, bytes, info, data, msg: null });
    await saveBidDraft(); state.tab = "bid"; renderTenders();
  } catch (e) { ctx.toast("Could not open this BOQ: " + e.message, 7000); }
}
const saveBidDraft = () => idb.put("kv", { id: "bidDraft", value: bid.bytes ? { name: bid.name, bytes: bid.bytes.buffer.slice(0), data: bid.data } : null });
async function loadBidDraft() {
  const v = (await idb.get("kv", "bidDraft"))?.value;
  if (!v?.bytes) return;
  try { const bytes = new Uint8Array(v.bytes); Object.assign(bid, { name: v.name, bytes, info: readBidderBoq(bytes), data: v.data }); } catch { /* old draft no longer readable */ }
}

const rs = (v) => (Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function bidView() {
  if (!bid.info) return `<div class="card upload-card"><h2>Fill a BOQ for bidding</h2>
    <p class="muted">Open the BOQ (.xls) downloaded from the tender on eproc.rajasthan.gov.in. Enter the firm's name and your rates (Item Rate / Item Wise) or the percentage above or below (Percentage BoQ). The tool checks everything the template checks and saves the same .xls, ready to upload.</p>
    <label class="primary btn-file big">📂 Open BOQ (.xls)<input type="file" accept=".xls,application/vnd.ms-excel" data-bidfile hidden></label></div>`;
  const d = bid.data;
  const chk = bid.msg;
  return `<div class="card"><div class="row between wrap"><div><h2>${esc(bid.name)}</h2><p class="muted small">${esc(bid.info.sheets[0]?.work || "")}</p></div>
      <div class="row gap wrap"><label class="ghost btn-file">Open another<input type="file" accept=".xls,application/vnd.ms-excel" data-bidfile hidden></label><button class="ghost danger-text" data-tact="bidClose">Close</button></div></div>
    <label class="field mt">Name of the Bidder / Bidding Firm / Company (cell B8)<input data-bidname value="${esc(d.bidder)}" placeholder="M/s …"></label>
    <p class="muted small mt">The saved file keeps the same name, macros and protection as the downloaded BOQ; only the firm's name, the rates and the quote are filled in, with the amounts and the amount in words worked out. You may open it in Microsoft Excel, enable content and save before uploading, as the portal advises; after uploading, check the portal's BOQ validation.</p></div>
    ${bid.info.sheets.map(sheetCard).join("")}
    <div class="card bid-actions"><div class="row gap wrap"><button class="ghost" data-tact="bidCheck">✔ Check</button><button class="primary" data-tact="bidSave">💾 Save BOQ for upload (.xls)</button></div>
      ${chk ? `<div class="mt">${chk.errors.length ? `<div class="status err"><b>Fix before saving:</b><ul>${chk.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : `<div class="status ok">✔ All checks passed.</div>`}
        ${chk.warnings.length ? `<div class="status"><b>Please check:</b><ul>${chk.warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}</div>` : ""}
</div>`;
}
function sheetCard(s) {
  const sd = bid.data.sheets[s.name], am = bidAmounts(s, sd);
  const items = s.items;
  const dir = sd.quote.dir, choices = s.quote.choices;
  const quoteBox = `<div class="bid-quote"><label class="field">${s.perItemRate ? "Overall rebate / premium (optional)" : "Your offer"}<select data-bdir="${s.name}">${choices.map((c) => `<option ${c === dir ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      ${dir !== "At Par" ? `<label class="field">Percentage<input type="number" step="0.01" min="0" max="99.99" inputmode="decimal" data-bpct="${s.name}" value="${esc(sd.quote.pct ?? "")}" placeholder="e.g. 5.25"></label>` : ""}
      <div class="bid-total"><small>Total (estimated / your rates)</small><b>₹ ${rs(am.total)}</b>${(dir !== "Select") ? `<small>Quoted amount</small><b class="big">₹ ${rs(am.quotedRounded)}</b><small>${esc(inrWords(am.quotedRounded))}</small>` : ""}</div></div>`;
  return `<div class="card"><div class="row between wrap"><h3><span class="hico">${s.perItemRate ? "✍️" : "％"}</span>${esc(s.name)} · ${esc(s.type)} BoQ <span class="muted small">(${items.filter((i) => !i.heading).length} items)</span></h3>
      ${s.perItemRate && s.type === "Item Rate" && items.some((i) => i.est) ? `<div class="row gap"><input type="number" step="0.01" class="w80" data-bulk="${s.name}" placeholder="%"><button class="ghost small" data-tact="bulkLess" data-sheet="${s.name}">Rates = estimate − %</button></div>` : ""}</div>
    ${s.perItemRate ? "" : `<p class="muted small">Percentage BoQ: the department's estimated rates stay; you quote one percentage below (Less), above (Excess) or At Par.</p>`}
    ${quoteBox}
    <div class="table-wrap tall mt"><table class="data small bid-tab"><thead><tr><th>S.No</th><th>Description</th><th class="num">Qty</th><th>Unit</th>${s.items.some((i) => i.est) ? `<th class="num">Estimated rate</th>` : ""}${s.perItemRate ? `<th class="num">Your rate ₹</th>` : ""}<th class="num">Amount ₹</th></tr></thead>
      <tbody>${items.map((it) => it.heading ? `<tr class="grp"><td>${esc(it.sno)}</td><td colspan="6"><b>${esc(it.description)}</b></td></tr>`
        : `<tr><td>${esc(it.sno)}</td><td><div class="clamp">${esc(it.description)}</div></td><td class="num">${it.qty}</td><td>${esc(it.unit)}</td>${s.items.some((i) => i.est) ? `<td class="num">${it.est != null ? rs(it.est) : ""}</td>` : ""}
          ${s.perItemRate ? `<td class="num"><input type="number" step="0.01" min="0" inputmode="decimal" class="w100 num ${sd.rates[it.row] ? "" : "need"}" data-brate="${s.name}|${it.row}" value="${esc(sd.rates[it.row] ?? "")}" ${it.rateOpen ? "" : 'title="Locked in the template"'}></td>` : ""}
          <td class="num" data-bamt="${s.name}|${it.row}">${rs(am.rows.get(it.row) || 0)}</td></tr>`).join("")}</tbody></table></div></div>`;
}
function bidRefresh() { bid.msg = null; saveBidDraft(); renderTenders(); }
async function bidSave() {
  bid.msg = checkBid(bid.info, bid.data);
  if (bid.msg.errors.length) { renderTenders(); ctx.toast("Some details are missing: see the list."); return; }
  try {
    const out = fillBidderBoq(bid.bytes, bid.data);
    ctx.download(new Blob([out], { type: "application/vnd.ms-excel" }), bid.name); // same file name as downloaded
    renderTenders(); ctx.toast(`Saved ${bid.name} ✓`);
  } catch (e) { ctx.toast("Could not save: " + e.message, 7000); }
}
