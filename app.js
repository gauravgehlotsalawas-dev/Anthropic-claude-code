/* PartTwin — cross-vehicle parts interchange finder (static, no build step) */
(function () {
  "use strict";

  const DB = window.PARTTWIN_DB;
  const LS_KEY = "parttwin.contributions.v1";
  const app = document.getElementById("app");

  // ---------- indexes ----------
  const vehiclesById = new Map(DB.vehicles.map(v => [v.id, v]));
  const familiesById = new Map(DB.families.map(f => [f.id, f]));
  const familiesByVehicle = new Map();
  DB.families.forEach(f => f.vehicles.forEach(vid => {
    if (!vehiclesById.has(vid)) console.warn(`Family ${f.id} references unknown vehicle ${vid}`);
    if (!familiesByVehicle.has(vid)) familiesByVehicle.set(vid, []);
    familiesByVehicle.get(vid).push(f);
  }));

  const CONF = {
    high:   { label: "High match",   hint: "Same engine/platform code, normally identical" },
    medium: { label: "Likely match", hint: "Often identical, confirm the part number" },
    low:    { label: "Check fitment",hint: "Fitment depends on body/variant, compare dimensions" }
  };
  const CONF_RANK = { high: 0, medium: 1, low: 2 };

  // ---------- helpers ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const vName = v => `${v.make} ${v.model}`;
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = q => norm(q).split(/[^a-z0-9.]+/).filter(Boolean);
  const matchesAll = (hay, toks) => { const h = norm(hay); return toks.every(t => h.includes(t)); };

  // Synonyms so "nozzle", "mounting", "plug" etc. find the right parts
  const SYN = {
    nozzle: "injector", nozzles: "injector", injectors: "injector",
    mountings: "mounting", mounts: "mounting", mount: "mounting",
    pads: "pad", disc: "disc", discs: "disc", rotor: "disc", rotors: "disc",
    shocker: "shock", shockers: "shock", damper: "shock", dampers: "shock",
    coil: "coil", coils: "coil", plugs: "plug", sparkplug: "spark",
    "ac": "cabin", pollen: "cabin", arm: "arm", arms: "arm",
    belt: "timing", chain: "timing", turbo: "turbocharger"
  };
  const partTokens = q => tokens(q).map(t => SYN[t] || t);

  function partsForVehicle(vid) {
    const out = [];
    (familiesByVehicle.get(vid) || []).forEach(f => {
      f.parts.forEach(p => {
        let pool = p.only ? p.only.slice() : f.vehicles.slice();
        if (!pool.includes(vid)) return;           // this part row doesn't apply to this car
        if (p.except) pool = pool.filter(x => !p.except.includes(x));
        const shared = pool.filter(x => x !== vid);
        if (!shared.length) return;
        out.push({ ...p, family: f, shared });
      });
    });
    return out.sort((a, b) => a.category.localeCompare(b.category) || CONF_RANK[a.confidence] - CONF_RANK[b.confidence]);
  }

  function partSearch(q) {
    const toks = partTokens(q);
    if (!toks.length) return [];
    const res = [];
    DB.families.forEach(f => f.parts.forEach(p => {
      if (matchesAll(`${p.name} ${p.category}`, toks)) {
        const pool = (p.only || f.vehicles).filter(x => !(p.except || []).includes(x));
        res.push({ ...p, family: f, shared: pool });
      }
    }));
    return res;
  }

  function vehicleSearch(q) {
    const toks = tokens(q);
    if (!toks.length) return [];
    return DB.vehicles.filter(v => matchesAll(`${v.make} ${v.model} ${v.variant} ${v.years} ${v.market}`, toks));
  }

  function familySearch(q) {
    const toks = tokens(q);
    if (!toks.length) return [];
    return DB.families.filter(f => matchesAll(`${f.name} ${f.maker} ${f.summary}`, toks));
  }

  const badge = c => `<span class="badge badge-${c}" title="${esc(CONF[c].hint)}">${esc(CONF[c].label)}</span>`;
  const chip = vid => {
    const v = vehiclesById.get(vid);
    if (!v) return "";
    return `<a class="chip" href="#/vehicle/${esc(v.id)}"><strong>${esc(vName(v))}</strong><small>${esc(v.variant)} · ${esc(v.years)}</small></a>`;
  };
  const famLink = f => `<a class="fam-link fam-${esc(f.type)}" href="#/family/${esc(f.id)}">${f.type === "engine" ? "⚙️" : "🧱"} ${esc(f.name)}</a>`;

  function vehicleOptions(selected) {
    const makes = {};
    DB.vehicles.forEach(v => (makes[v.make] = makes[v.make] || []).push(v));
    return Object.keys(makes).sort().map(m =>
      `<optgroup label="${esc(m)}">${makes[m].sort((a, b) => a.model.localeCompare(b.model)).map(v =>
        `<option value="${esc(v.id)}"${v.id === selected ? " selected" : ""}>${esc(v.model)}: ${esc(v.variant)} (${esc(v.years)})</option>`).join("")}</optgroup>`
    ).join("");
  }

  const disclaimer = `<p class="disclaimer">⚠️ Matches are based on shared engine and platform families, not on an OEM catalogue. Before you buy, confirm the <strong>OEM part number</strong> with a VIN lookup or from the number stamped on your old part.</p>`;

  // ---------- views ----------
  function viewHome() {
    const nFam = DB.families.length, nVeh = DB.vehicles.length;
    const nParts = DB.families.reduce((s, f) => s + f.parts.length, 0);
    const makes = new Set(DB.vehicles.map(v => v.make)).size;
    return `
      <section class="hero">
        <h1>Find the same part on a <span class="accent">different car</span></h1>
        <p class="lead">Many cars share engines, gearboxes and platforms, and so they share parts. Pick your car and the part you need, and PartTwin lists the other cars that use the same part. A part sold for another brand, or by a different dealer, can cost much less.</p>
        <form class="finder" id="finder">
          <label>
            <span>1. Your car</span>
            <select id="f-vehicle" required>
              <option value="">Select make / model / engine…</option>
              ${vehicleOptions()}
            </select>
          </label>
          <label>
            <span>2. Part you need <em>(optional)</em></span>
            <input id="f-part" type="search" placeholder="e.g. injector, engine mounting, glow plug" autocomplete="off">
          </label>
          <button class="btn primary" type="submit">Find shared parts →</button>
        </form>
        <div class="examples">Try:
          <a href="#/vehicle/honda-city-4g-d?part=injector">Honda City 1.5 diesel nozzle</a>
          <a href="#/vehicle/honda-city-4g-d?part=mounting">Honda City engine mounting</a>
          <a href="#/vehicle/merc-a180-cdi-w176">Mercedes A180 CDI</a>
          <a href="#/vehicle/bentley-cgt-1g">Bentley Continental GT</a>
          <a href="#/vehicle/lambo-huracan">Lamborghini Huracán</a>
        </div>
      </section>
      <section class="stats">
        <div><b>${nVeh}</b><span>vehicles</span></div>
        <div><b>${makes}</b><span>brands</span></div>
        <div><b>${nFam}</b><span>shared engine/platform families</span></div>
        <div><b>${nParts}</b><span>interchangeable part groups</span></div>
      </section>
      <section>
        <h2>How it works</h2>
        <div class="how">
          <div><h3>1 · Shared families</h3><p>Cars are grouped by the engine, gearbox or platform they share, e.g. the Fiat 1.3 Multijet sold as Maruti DDiS, Tata Quadrajet and Opel CDTi.</p></div>
          <div><h3>2 · Part groups</h3><p>Each family lists parts that usually interchange, each with a confidence level: <span class="badge badge-high">High</span> <span class="badge badge-medium">Likely</span> <span class="badge badge-low">Check fitment</span></p></div>
          <div><h3>3 · Source smarter</h3><p>Ask a dealer or parts shop for the matching car's part, or for the OEM supplier's (Bosch, Denso, Delphi…) box, and check the part number before you buy.</p></div>
        </div>
      </section>
      <section>
        <h2>Popular shared families</h2>
        <div class="grid">${DB.families.slice(0, 6).map(familyCard).join("")}</div>
        <p><a href="#/browse">Browse all families & vehicles →</a></p>
      </section>`;
  }

  function familyCard(f) {
    return `<a class="card" href="#/family/${esc(f.id)}">
      <div class="card-type">${f.type === "engine" ? "⚙️ Engine family" : "🧱 Platform family"}</div>
      <h3>${esc(f.name)}</h3>
      <p>${esc(f.summary.length > 150 ? f.summary.slice(0, 147) + "…" : f.summary)}</p>
      <div class="card-meta">${f.vehicles.length} vehicles · ${f.parts.length} part groups</div>
    </a>`;
  }

  function partRow(p, opts = {}) {
    return `<div class="part">
      <div class="part-head">
        <div><div class="part-cat">${esc(p.category)}</div><h4>${esc(p.name)}</h4></div>
        ${badge(p.confidence)}
      </div>
      ${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}
      ${opts.showFamily !== false ? `<div class="via">Shared via ${famLink(p.family)}</div>` : ""}
      <div class="shared-label">${opts.label || "Also used in"} (${p.shared.length}):</div>
      <div class="chips">${p.shared.map(chip).join("")}</div>
    </div>`;
  }

  function viewVehicle(id, params) {
    const v = vehiclesById.get(id);
    if (!v) return notFound();
    const fams = familiesByVehicle.get(id) || [];
    let parts = partsForVehicle(id);
    const q = params.get("part") || "";
    const toks = partTokens(q);
    if (toks.length) parts = parts.filter(p => matchesAll(`${p.name} ${p.category}`, toks));

    const sharedCars = new Set(partsForVehicle(id).flatMap(p => p.shared));
    const byCat = {};
    parts.forEach(p => (byCat[p.category] = byCat[p.category] || []).push(p));

    return `
      <nav class="crumbs"><a href="#/">Home</a> › <a href="#/browse">Browse</a> › ${esc(v.make)}</nav>
      <header class="vhead">
        <div>
          <h1>${esc(vName(v))}</h1>
          <p class="sub">${esc(v.variant)} · ${esc(v.years)} · ${esc(v.market)}</p>
          <div class="fams">${fams.map(famLink).join("")}</div>
        </div>
        <div class="vstat"><b>${sharedCars.size}</b><span>other cars share parts with this one</span></div>
      </header>
      <div class="filterbar">
        <input id="vpart" type="search" value="${esc(q)}" placeholder="Filter parts: injector, mounting, brake pad…" autocomplete="off">
        ${q ? `<a class="btn ghost" href="#/vehicle/${esc(id)}">Clear</a>` : ""}
      </div>
      ${disclaimer}
      ${parts.length ? Object.keys(byCat).sort().map(cat => `
        <section class="cat"><h2>${esc(cat)}</h2>${byCat[cat].map(p => partRow(p)).join("")}</section>`).join("")
        : `<div class="empty">
             <p>No shared-part records ${q ? `match “${esc(q)}” ` : ""}for this vehicle yet.</p>
             <p>Know a match? <a href="#/contribute?vehicle=${esc(id)}&part=${encodeURIComponent(q)}">Add it</a>, or <a href="#/search?q=${encodeURIComponent(q)}">search “${esc(q)}” across all cars</a>.</p>
           </div>`}
    `;
  }

  function viewFamily(id) {
    const f = familiesById.get(id);
    if (!f) return notFound();
    return `
      <nav class="crumbs"><a href="#/">Home</a> › <a href="#/browse">Browse</a> › Family</nav>
      <header class="vhead"><div>
        <div class="card-type">${f.type === "engine" ? "⚙️ Engine family" : "🧱 Platform family"}</div>
        <h1>${esc(f.name)}</h1>
        <p class="sub">${esc(f.maker)}</p>
        <p>${esc(f.summary)}</p>
      </div><div class="vstat"><b>${f.vehicles.length}</b><span>vehicles</span></div></header>
      <h2>Vehicles in this family</h2>
      <div class="chips">${f.vehicles.map(chip).join("")}</div>
      <h2>Interchangeable part groups</h2>
      ${disclaimer}
      ${f.parts.map(p => partRow({ ...p, family: f, shared: (p.only || f.vehicles).filter(x => !(p.except || []).includes(x)) }, { showFamily: false, label: "Fits" })).join("")}
    `;
  }

  function viewSearch(params) {
    const q = params.get("q") || "";
    const vs = vehicleSearch(q), ps = partSearch(q), fs = familySearch(q);
    return `
      <nav class="crumbs"><a href="#/">Home</a> › Search</nav>
      <h1>Results for “${esc(q)}”</h1>
      ${!q ? `<p>Type a car, engine or part in the search box above.</p>` : ""}
      ${vs.length ? `<h2>Vehicles (${vs.length})</h2><div class="chips">${vs.map(v => chip(v.id)).join("")}</div>` : ""}
      ${fs.length ? `<h2>Engine / platform families (${fs.length})</h2><div class="grid">${fs.map(familyCard).join("")}</div>` : ""}
      ${ps.length ? `<h2>Parts (${ps.length})</h2>${disclaimer}${ps.map(p => partRow(p, { label: "Fits" })).join("")}` : ""}
      ${q && !vs.length && !ps.length && !fs.length ? `<div class="empty"><p>Nothing found for “${esc(q)}”.</p><p>Try a broader word (e.g. “injector”, “Swift”, “K9K”), or <a href="#/contribute">add a match</a>.</p></div>` : ""}
    `;
  }

  function viewBrowse() {
    const makes = {};
    DB.vehicles.forEach(v => (makes[v.make] = makes[v.make] || []).push(v));
    return `
      <nav class="crumbs"><a href="#/">Home</a> › Browse</nav>
      <h1>Browse</h1>
      <h2>Engine families</h2>
      <div class="grid">${DB.families.filter(f => f.type === "engine").map(familyCard).join("")}</div>
      <h2>Platform / badge-engineering families</h2>
      <div class="grid">${DB.families.filter(f => f.type !== "engine").map(familyCard).join("")}</div>
      <h2>All vehicles by brand</h2>
      ${Object.keys(makes).sort().map(m => `<h3 class="make">${esc(m)}</h3><div class="chips">${makes[m].map(v => chip(v.id)).join("")}</div>`).join("")}
    `;
  }

  // ---------- contributions (local only for now) ----------
  const loadContribs = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } };
  const saveContribs = list => localStorage.setItem(LS_KEY, JSON.stringify(list));

  function viewContribute(params) {
    const list = loadContribs();
    return `
      <nav class="crumbs"><a href="#/">Home</a> › Contribute</nav>
      <h1>Add a parts match</h1>
      <p class="lead small">Found a part that fits two different cars? Record it here. Submissions are saved in <strong>this browser only</strong> for now; use “Export JSON” to send them in for review.</p>
      <form id="contrib" class="contrib">
        <label><span>Car A</span><select name="a" required><option value="">Select…</option>${vehicleOptions(params.get("vehicle"))}</select></label>
        <label><span>Car B (shares the part)</span><select name="b" required><option value="">Select…</option>${vehicleOptions()}</select></label>
        <label><span>Not in the list? Describe Car B</span><input name="bText" placeholder="e.g. Fiat Doblo 1.3 Multijet 2012"></label>
        <label><span>Part</span><input name="part" required value="${esc(params.get("part") || "")}" placeholder="e.g. Glow plug"></label>
        <label><span>OEM / supplier part number(s)</span><input name="pn" placeholder="e.g. Bosch 0 250 ..."></label>
        <label><span>How do you know?</span>
          <select name="evidence"><option>Fitted it myself</option><option>Same part number on both</option><option>Mechanic / dealer confirmed</option><option>Online catalogue</option><option>Heard / not sure</option></select></label>
        <label class="full"><span>Notes</span><textarea name="notes" rows="3" placeholder="Differences, modifications needed, price you paid…"></textarea></label>
        <button class="btn primary" type="submit">Save match</button>
      </form>
      <h2>Your saved matches (${list.length})</h2>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Car A</th><th>Car B</th><th>Part</th><th>Part no.</th><th>Evidence</th><th></th></tr></thead><tbody>
        ${list.map((c, i) => `<tr>
          <td>${esc(vehiclesById.get(c.a) ? vName(vehiclesById.get(c.a)) : c.a)}</td>
          <td>${esc(c.bText || (vehiclesById.get(c.b) ? vName(vehiclesById.get(c.b)) : c.b))}</td>
          <td>${esc(c.part)}</td><td>${esc(c.pn)}</td><td>${esc(c.evidence)}</td>
          <td><button class="btn ghost small" data-del="${i}">Delete</button></td></tr>`).join("")}
      </tbody></table></div>
      <p><button class="btn" id="export">Export JSON</button></p>` : `<p class="muted">None yet.</p>`}
    `;
  }

  function viewAbout() {
    return `
      <nav class="crumbs"><a href="#/">Home</a> › About</nav>
      <h1>About PartTwin</h1>
      <p>A spare part for one car is often hard to find or expensive, while the same part sold for another car is easy to get and cheaper. This happens because manufacturers share engines, gearboxes and platforms across models and brands, and because parts suppliers such as Bosch, Denso, Delphi and Continental make the same component for several carmakers.</p>
      <h2>Tips for sourcing</h2>
      <ul>
        <li><strong>Get the OEM part number</strong> from the old part or a VIN-based catalogue lookup. The part number is the real test of a match; the car name is not.</li>
        <li><strong>Ask for the supplier's box.</strong> The same Bosch or Denso part sold in the supplier's own packaging often costs less than the carmaker-branded one.</li>
        <li><strong>Engine-internal and service parts</strong> (injectors, glow plugs, filters, sensors, timing kits) are the most likely to interchange.</li>
        <li><strong>Body-mounted parts</strong> (engine mounts, lamps, bumpers, glass) usually interchange only between badge-engineered twins.</li>
        <li><strong>Same engine doesn't mean the same calibration.</strong> Turbos, injectors and EGR valves can change with power output and emission norms (e.g. BS4 vs BS6).</li>
      </ul>
      <h2>Data status</h2>
      <p>This is an early prototype with a hand-curated seed dataset (v${esc(DB.version)}): ${DB.vehicles.length} vehicles in ${DB.families.length} shared families. It is not a complete or official catalogue. See the project README for how the database can grow (licensed catalogue data, OEM EPC numbers, verified community submissions).</p>
    `;
  }

  const notFound = () => `<div class="empty"><h1>Not found</h1><p><a href="#/">Back to home</a></p></div>`;

  // ---------- router ----------
  function route(opts) {
    opts = opts || {};
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = hash.split("?");
    const params = new URLSearchParams(qs || "");
    const seg = path.split("/").filter(Boolean);
    let html;
    switch (seg[0]) {
      case undefined:    html = viewHome(); break;
      case "vehicle":    html = viewVehicle(decodeURIComponent(seg[1] || ""), params); break;
      case "family":     html = viewFamily(decodeURIComponent(seg[1] || "")); break;
      case "search":     html = viewSearch(params); break;
      case "browse":     html = viewBrowse(); break;
      case "contribute": html = viewContribute(params); break;
      case "about":      html = viewAbout(); break;
      default:           html = notFound();
    }
    app.innerHTML = html;
    document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === `#/${seg[0] || ""}`));
    if (!opts.keepScroll) window.scrollTo(0, 0);
    bind(seg, params);
  }

  function bind(seg, params) {
    const finder = document.getElementById("finder");
    if (finder) finder.addEventListener("submit", e => {
      e.preventDefault();
      const vid = document.getElementById("f-vehicle").value;
      const part = document.getElementById("f-part").value.trim();
      if (vid) location.hash = `#/vehicle/${vid}${part ? `?part=${encodeURIComponent(part)}` : ""}`;
    });

    const vpart = document.getElementById("vpart");
    if (vpart) {
      let t;
      vpart.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const v = vpart.value.trim();
          history.replaceState(null, "", `#/vehicle/${seg[1]}${v ? `?part=${encodeURIComponent(v)}` : ""}`);
          const pos = vpart.selectionStart;
          route({ keepScroll: true });
          const n = document.getElementById("vpart");
          n.focus(); n.setSelectionRange(pos, pos);
        }, 250);
      });
    }

    const contrib = document.getElementById("contrib");
    if (contrib) contrib.addEventListener("submit", e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(contrib).entries());
      d.created = new Date().toISOString();
      const list = loadContribs(); list.push(d); saveContribs(list);
      route();
    });
    document.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      const list = loadContribs(); list.splice(+b.dataset.del, 1); saveContribs(list); route();
    }));
    const exp = document.getElementById("export");
    if (exp) exp.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(loadContribs(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "parttwin-contributions.json"; a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // global search box
  document.getElementById("gsearch").addEventListener("submit", e => {
    e.preventDefault();
    const q = document.getElementById("gq").value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });

  window.addEventListener("hashchange", route);
  route();
})();
