// Home: the BuildRigs dashboard. One look at every part of the work (estimates, bills, sites,
// accounts, tenders) and a door into each, following the product's Plan · Procure · Progress idea.
import { idb, esc, num } from "./store.js";

const $ = (s, el = document) => el.querySelector(s);
let ctx = null;

export function initHome(c) {
  ctx = c;
  $("#homeRoot").addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]"); if (!go) return;
    const [tab, sub] = go.dataset.go.split(":");
    ctx.showTab(tab);
    if (sub) setTimeout(() => document.querySelector(`[data-stab="${sub}"], [data-ttab="${sub}"], [data-otab="${sub}"], [data-rtab="${sub}"], [data-act="${sub}"]`)?.click(), 60);
  });
}

const lakh = (v) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);

export async function renderHome() {
  const root = $("#homeRoot"); if (!root) return;
  const [diary, files, expenses, mine] = await Promise.all([idb.all("diary"), idb.all("files"), idb.all("expenses"), idb.get("kv", "myTenders")]);
  const co = ctx.company() || {};
  const month = new Date().toISOString().slice(0, 7);
  const spent = expenses.filter((x) => String(x.date || "").startsWith(month)).reduce((a, x) => a + num(x.total), 0);
  const tenders = (mine?.value || []).filter((t) => !["Dropped", "Not L1", "Work order received"].includes(t.status));
  const next = tenders.map((t) => t.bidEnd).filter((d) => d && new Date(d) > new Date()).sort()[0];
  const bills = ctx.billWorks().reduce((a, w) => a + (w.bills?.length || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayEntries = diary.filter((d) => d.date === today).length;
  const stats = [
    ["Sites", ctx.sites().length, todayEntries ? `${todayEntries} diary entr${todayEntries > 1 ? "ies" : "y"} today` : "daily diary & GPS photos", "sites"],
    ["Bills", bills, `${ctx.billWorks().filter((w) => w.bills?.length).length} work(s) billed`, "bills"],
    ["Estimates", ctx.estimates().filter((p) => p.sections?.some((s) => s.items.length)).length, "BOQ & estimates", "boq"],
    ["Spent this month", spent ? lakh(spent) : "₹0", `${expenses.length} purchase bill(s) in all`, "office"],
    ["Tenders tracked", tenders.length, next ? `next bid end ${new Date(next).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "alerts & bid BOQ", "tenders"],
    ["Photos", files.filter((f) => f.kind === "photo").length, `${files.filter((f) => f.kind === "doc").length} document(s)`, "sites:photos"],
  ];
  const flow = [["Projects & BOQs", "boq"], ["Labour & Workforce", "resources:workforce"], ["Materials & Inventory", "resources:inventory"], ["Machinery & Equipment", "resources:equipment"], ["Vendors & Suppliers", "resources:vendors"], ["Accounts & Billing", "bills"], ["Tenders & Bidding", "tenders"], ["AI Construction Intelligence", ""]];
  const modules = [
    ["01", "Estimates & BOQ", "Rate books (BSR / SOR), item picking, drawing takeoff, measurement sheets and abstract of cost.", "ratebooks", "📐"],
    ["02", "e-Tender BOQ", "Write the department's BOQ into the GePNIC .xls template, ready for the portal.", "tender", "🏛️"],
    ["03", "Bills from the MB", "Running and final bills in P.W.A. Form 27G, part rates, extra items, deviation and photo sheets.", "bills", "🧾"],
    ["04", "Site diary", "Labour, machinery rent, work done by measurement, materials, GPS camera, DPR / WPR / MPR, STP.", "sites", "🏗️"],
    ["05", "Office & accounts", "Purchase bills read by OCR, Excel for the CA, company documents, scan & merge, backup.", "office", "📊"],
    ["06", "Tenders & bidding", "Tender alerts by department, district and amount; fill the portal BOQ with your rates.", "tenders", "📣"],
    ["07", "Workforce & attendance", "Worker register, daily attendance (P / ½ / A, overtime), muster roll and wage sheet with advances.", "resources:workforce", "👷"],
    ["08", "Materials, machinery & vendors", "Stock per site with low-stock alerts, equipment register with rent payable, supplier directory with credit.", "resources:inventory", "🚜"],
  ];
  const soon = [["ThekedarGPT", "The construction-aware AI assistant: ask, analyse and act on your project data."], ["Equipment rental", "On-demand machinery from verified owners, booked and billed in the app."], ["Marketplace", "Vendors, suppliers and surplus materials, connected to your sites."]];
  root.innerHTML = `<section class="br-hero">
      <div class="br-hero-main">
        <img src="img/logo-white.png" alt="BuildRigs" class="br-hero-logo">
        <div class="br-kicker">AI-powered construction super ecosystem</div>
        <h1>Plan <span>·</span> Procure <span>·</span> Progress</h1>
        <p>Projects, BOQs, bills, sites, people, materials, machinery, money and tenders: connected in one place${co.name ? ` for <b>${esc(co.name)}</b>` : ""}.</p>
        <div class="br-cta"><button class="primary" data-go="sites:newSite">＋ Start a site</button><button class="ghost dark" data-go="bills">🧾 Make a bill</button><button class="ghost dark" data-go="tenders:bid">📝 Fill a tender BOQ</button></div>
      </div>
      <div class="br-hero-art" aria-hidden="true"><svg viewBox="0 0 220 220"><defs><linearGradient id="hg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#FFC15E"/><stop offset="1" stop-color="#F9A01B"/></linearGradient></defs>
        <rect x="18" y="120" width="34" height="80" rx="4" fill="url(#hg)" opacity=".55"/><rect x="62" y="92" width="34" height="108" rx="4" fill="url(#hg)" opacity=".7"/><rect x="106" y="62" width="34" height="138" rx="4" fill="url(#hg)" opacity=".85"/><rect x="150" y="30" width="34" height="170" rx="4" fill="url(#hg)"/>
        <path d="M14 150 C70 140 120 110 196 22" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M180 18 l18 2 -4 18" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    </section>
    <div class="br-stats">${stats.map(([l, v, s, go]) => `<button class="br-stat" data-go="${go}"><small>${l}</small><b>${v}</b><span>${esc(s)}</span></button>`).join("")}</div>
    <div class="card br-flow"><h3>Building the intelligence layer for construction</h3>
      <div class="br-flow-row">${flow.map(([l, go], i) => `${i ? `<span class="br-arrow">→</span>` : ""}<button class="br-node ${go ? "" : "soon"}" ${go ? `data-go="${go}"` : "disabled"}>${l}${go ? "" : " <em>soon</em>"}</button>`).join("")}</div></div>
    <div class="br-modules">${modules.map(([n, t, d, go, ic]) => `<button class="br-mod" data-go="${go}"><span class="br-num">${n}</span><span class="br-ic">${ic}</span><b>${t}</b><span>${d}</span><i>Open →</i></button>`).join("")}</div>
    <div class="br-soon"><h3>Coming next on BuildRigs</h3><div class="br-soon-row">${soon.map(([t, d]) => `<div class="br-soon-card"><span class="badge">Coming soon</span><b>${t}</b><span>${d}</span></div>`).join("")}</div></div>
    <p class="br-foot">Your data stays on this device. Keep a backup from <button class="link" data-go="office:backup">Office → Backup</button>. · <a href="https://www.buildrigs.com" target="_blank" rel="noopener">www.buildrigs.com</a> · <a href="mailto:hello@buildrigs.com">hello@buildrigs.com</a></p>`;
}
