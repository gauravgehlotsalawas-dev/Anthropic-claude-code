/* PartTwin: cross-vehicle parts interchange finder (static, no build step) */
(function () {
  "use strict";

  const DB = window.PARTTWIN_DB;
  DB.vehicles.forEach(v => { v.type = v.type || "car"; });

  const LS = { contrib: "parttwin.contributions.v1", garage: "parttwin.garage.v1", theme: "parttwin.theme" };
  const app = document.getElementById("app");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------- icons (inline SVG, stroke-based) ----------------
  const I = {
    car: '<path d="M5 17H3v-4l2.2-5.1A2 2 0 0 1 7 6.7h10a2 2 0 0 1 1.8 1.2L21 13v4h-2"/><path d="M3 13h18"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>',
    bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h5l4.5 7.5"/><path d="M9 9 12 16.5h3M14 9l1.5-3H18"/>',
    commercial: '<rect x="1.5" y="4" width="13" height="11" rx="1"/><path d="M14.5 8h4l3 3.5V15h-7z"/><circle cx="6" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
    aircraft: '<path d="M21 15.5v-2l-8-5V4a1.5 1.5 0 0 0-3 0v4.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/>',
    marine: '<path d="M2 20c1.7 1 3.3 1 5 0s3.3-1 5 0 3.3 1 5 0 3.3-1 5 0"/><path d="M4 16.5 3 12h18l-2.5 4.5"/><path d="M12 3v9M8 8h8l-1.2-3.5H9.2z"/>',
    all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" fill="currentColor"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    compare: '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>'
  };
  const icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ""}</svg>`;

  const TYPES = {
    all:        { label: "Everything",  plural: "All vehicles" },
    car:        { label: "Cars",        plural: "Cars" },
    bike:       { label: "Motorcycles", plural: "Motorcycles" },
    commercial: { label: "Commercial",  plural: "Pick-ups, vans & trucks" },
    aircraft:   { label: "Aircraft",    plural: "Aircraft" },
    marine:     { label: "Marine",      plural: "Boats & marine engines" }
  };
  const TYPE_KEYS = Object.keys(TYPES).filter(k => k !== "all");

  const CONF = {
    high:   { label: "High match",    short: "High",   hint: "Same engine/platform code, normally identical", w: 3 },
    medium: { label: "Likely match",  short: "Likely", hint: "Often identical, confirm the part number", w: 2 },
    low:    { label: "Check fitment", short: "Check",  hint: "Fitment depends on body/variant, compare dimensions", w: 1 },
    avoid:  { label: "Do not swap",   short: "Avoid",  hint: "Looks shared but must NOT be interchanged", w: 0 }
  };
  const CONF_KEYS = Object.keys(CONF);
  const CONF_RANK = { high: 0, medium: 1, low: 2, avoid: 3 };

  const SAFETY = {
    aircraft: "Aviation: a part is only airworthy if it is approved for your exact engine/airframe (Type Certificate, STC, PMA or IPC part number) and installed or signed off by a licensed engineer. Use PartTwin for research only.",
    marine: "Marine: automotive starters, alternators and distributors are not ignition-protected, and they can ignite fuel vapour. Use marine-rated parts wherever the engine maker requires them."
  };

  // ---------------- indexes ----------------
  const vehiclesById = new Map(DB.vehicles.map(v => [v.id, v]));
  const familiesById = new Map(DB.families.map(f => [f.id, f]));
  const familiesByVehicle = new Map();
  DB.families.forEach(f => {
    const counts = {};
    f.vehicles.forEach(vid => {
      const v = vehiclesById.get(vid);
      if (!v) { console.warn(`Family ${f.id} references unknown vehicle ${vid}`); return; }
      counts[v.type] = (counts[v.type] || 0) + 1;
      if (!familiesByVehicle.has(vid)) familiesByVehicle.set(vid, []);
      familiesByVehicle.get(vid).push(f);
    });
    f.domain = f.domain || Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "car";
  });

  // ---------------- helpers ----------------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const vName = v => `${v.make} ${v.model}`;
  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = q => norm(q).split(/[^a-z0-9.]+/).filter(Boolean);
  const matchesAll = (hay, toks) => { const h = norm(hay); return toks.every(t => h.includes(t)); };
  const SYN = {
    nozzle: "injector", nozzles: "injector", injectors: "injector",
    mountings: "mounting", mounts: "mounting", mount: "mounting",
    shocker: "shock", shockers: "shock", damper: "shock", dampers: "shock",
    sparkplug: "spark", rotor: "disc", rotors: "disc", ac: "cabin", pollen: "cabin",
    belt: "timing", turbo: "turbocharger", mag: "magneto", plane: "aircraft", boat: "marine"
  };
  const partTokens = q => tokens(q).map(t => SYN[t] || t);
  // Prefer the part name; fall back to the category only when the query is a category word (e.g. "brakes")
  const matchesPart = (p, toks) => matchesAll(p.name, toks) || (toks.length > 0 && matchesAll(p.category, toks));
  const plural = (n, s, p = s + "s") => `${n} ${n === 1 ? s : p}`;

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const garage = () => store.get(LS.garage, []).filter(id => vehiclesById.has(id));
  const inGarage = id => garage().includes(id);

  // ---------------- core queries ----------------
  const poolOf = (p, f) => (p.only || f.vehicles).filter(x => !(p.except || []).includes(x));

  const _partsCache = new Map();
  function partsForVehicle(vid) {
    if (_partsCache.has(vid)) return _partsCache.get(vid);
    const out = [];
    (familiesByVehicle.get(vid) || []).forEach(f => f.parts.forEach(p => {
      const pool = poolOf(p, f);
      if (!pool.includes(vid)) return;
      const shared = pool.filter(x => x !== vid);
      if (shared.length) out.push({ ...p, family: f, shared });
    }));
    out.sort((a, b) => a.category.localeCompare(b.category) || CONF_RANK[a.confidence] - CONF_RANK[b.confidence]);
    _partsCache.set(vid, out);
    return out;
  }

  function twinsFor(vid) {
    const m = new Map();
    partsForVehicle(vid).forEach(p => p.shared.forEach(o => {
      const t = m.get(o) || { id: o, score: 0, parts: [], best: "avoid" };
      if (p.confidence !== "avoid") t.parts.push(p);
      t.score += CONF[p.confidence].w;
      if (CONF_RANK[p.confidence] < CONF_RANK[t.best]) t.best = p.confidence;
      m.set(o, t);
    }));
    return [...m.values()].filter(t => t.parts.length).sort((a, b) => b.score - a.score);
  }

  const sharedBetween = (a, b) => partsForVehicle(a).filter(p => p.shared.includes(b));

  function search(q, limit = 50) {
    const toks = tokens(q), ptoks = partTokens(q);
    if (!toks.length) return { vehicles: [], families: [], parts: [] };
    const vehicles = DB.vehicles.filter(v => matchesAll(`${v.make} ${v.model} ${v.variant} ${v.years} ${v.market} ${TYPES[v.type].label}`, toks)).slice(0, limit);
    const families = DB.families.filter(f => matchesAll(`${f.name} ${f.maker} ${f.summary}`, toks)).slice(0, limit);
    const parts = [];
    DB.families.forEach(f => f.parts.forEach(p => {
      if (matchesPart(p, ptoks)) parts.push({ ...p, family: f, shared: poolOf(p, f) });
    }));
    return { vehicles, families, parts: parts.slice(0, limit) };
  }

  // ---------------- components ----------------
  const badge = c => `<span class="badge b-${c}" title="${esc(CONF[c].hint)}">${esc(CONF[c].label)}</span>`;
  const typeIcon = (t, cls = "") => icon(t, cls);

  const chip = vid => {
    const v = vehiclesById.get(vid);
    if (!v) return "";
    return `<a class="chip" href="#/vehicle/${esc(v.id)}">${typeIcon(v.type, "chip-ic")}<span><strong>${esc(vName(v))}</strong><small>${esc(v.variant)} · ${esc(v.years)}</small></span></a>`;
  };
  const chipSm = vid => {
    const v = vehiclesById.get(vid);
    if (!v) return "";
    return `<a class="chip sm" href="#/vehicle/${esc(v.id)}" title="${esc(v.variant)} · ${esc(v.years)}">${typeIcon(v.type, "chip-ic")}<strong>${esc(vName(v))}</strong><small>${esc(v.years)}</small></a>`;
  };
  const famLink = f => `<a class="fam-link" href="#/family/${esc(f.id)}">${icon(f.type === "engine" ? "gear" : "layers")} ${esc(f.name)}</a>`;

  function vehicleCard(v) {
    const n = twinsFor(v.id).length;
    return `<a class="vcard t-${v.type}" href="#/vehicle/${esc(v.id)}">
      <div class="vcard-ic">${typeIcon(v.type)}</div>
      <div class="vcard-body">
        <div class="vcard-make">${esc(v.make)}</div>
        <div class="vcard-model">${esc(v.model)}</div>
        <div class="vcard-var">${esc(v.variant)} · ${esc(v.years)}</div>
      </div>
      <div class="vcard-n" title="Vehicles sharing parts"><b>${n}</b><span>twins</span></div>
    </a>`;
  }

  function familyCard(f) {
    return `<a class="fcard" href="#/family/${esc(f.id)}">
      <div class="fcard-top"><span class="pill">${icon(f.type === "engine" ? "gear" : "layers")} ${f.type === "engine" ? "Engine family" : "Platform family"}</span><span class="pill ghost">${typeIcon(f.domain)} ${esc(TYPES[f.domain].label)}</span></div>
      <h3>${esc(f.name)}</h3>
      <p>${esc(f.summary.length > 160 ? f.summary.slice(0, 157) + "…" : f.summary)}</p>
      <div class="fcard-foot"><span>${plural(f.vehicles.length, "vehicle")}</span><span>${plural(f.parts.length, "part group")}</span>${icon("arrow")}</div>
    </a>`;
  }

  function partCard(p, opts = {}) {
    const MAX = opts.compact ? 10 : 8;
    const chips = p.shared.map(opts.compact ? chipSm : chip);
    const head = chips.slice(0, MAX).join("");
    const rest = chips.length > MAX ? `<details class="more"><summary>+${chips.length - MAX} more</summary><div class="chips">${chips.slice(MAX).join("")}</div></details>` : "";
    return `<article class="part c-${p.confidence}">
      <div class="part-head">
        <div><div class="eyebrow">${esc(p.category)}</div><h4>${esc(p.name)}</h4></div>
        ${badge(p.confidence)}
      </div>
      ${p.note ? `<p class="note">${p.confidence === "avoid" ? icon("warn") + " " : ""}${esc(p.note)}</p>` : ""}
      ${opts.showFamily !== false ? `<div class="via">via ${famLink(p.family)}</div>` : ""}
      <div class="fits-label">${esc(opts.label || (p.confidence === "avoid" ? "Do NOT swap with" : "Also fits"))} · ${p.shared.length}</div>
      <div class="chips">${head}</div>${rest}
    </article>`;
  }

  const disclaimer = () => `<div class="notice">${icon("warn")}<p>Matches come from shared engine and platform families, not an OEM catalogue. Always confirm the <strong>OEM part number</strong> (VIN lookup or the number stamped on your old part) before buying.</p></div>`;
  const safetyNotice = type => SAFETY[type] ? `<div class="notice danger">${icon("warn")}<p>${esc(SAFETY[type])}</p></div>` : "";

  // ---------- twin network graph ----------
  function twinGraph(vid, twins) {
    const v = vehiclesById.get(vid);
    const nodes = twins.slice(0, 18);
    if (!nodes.length) return "";
    const W = 640, H = 460, cx = W / 2, cy = H / 2;
    const maxScore = Math.max(...nodes.map(n => n.score));
    const R = nodes.length <= 6 ? 150 : 175;
    const pts = nodes.map((n, i) => {
      const a = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
      return { ...n, x: cx + Math.cos(a) * R * 1.25, y: cy + Math.sin(a) * R, a };
    });
    const edges = pts.map((p, i) => {
      const w = 1.2 + (p.score / maxScore) * 4.5;
      return `<line class="edge e-${p.best}" x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke-width="${w.toFixed(1)}" style="--d:${i * 40}ms"/>`;
    }).join("");
    const nodeEls = pts.map((p, i) => {
      const o = vehiclesById.get(p.id);
      const cos = Math.cos(p.a);
      const anchor = Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end";
      const lx = p.x + (anchor === "start" ? 16 : anchor === "end" ? -16 : 0);
      const ly = p.y + (anchor === "middle" ? (Math.sin(p.a) > 0 ? 26 : -18) : 4);
      const r = 7 + (p.score / maxScore) * 5;
      return `<a href="#/vehicle/${esc(p.id)}" class="node n-${p.best}" style="--d:${120 + i * 40}ms">
        <title>${esc(vName(o))}: ${plural(p.parts.length, "shared part")} (best: ${CONF[p.best].label})</title>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"/>
        <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}"><tspan class="nl-make">${esc(o.make)}</tspan> <tspan class="nl-model">${esc(o.model.length > 22 ? o.model.slice(0, 21) + "…" : o.model)}</tspan></text>
      </a>`;
    }).join("");
    return `<figure class="graph">
      <svg viewBox="-130 -10 ${W + 260} ${H + 20}" role="img" aria-label="Network of vehicles sharing parts with ${esc(vName(v))}">
        <defs><radialGradient id="cg" r="0.6"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>
        <circle cx="${cx}" cy="${cy}" r="110" fill="url(#cg)"/>
        ${edges}
        ${nodeEls}
        <circle class="center" cx="${cx}" cy="${cy}" r="34"/>
        <g transform="translate(${cx - 14} ${cy - 14}) scale(1.17)" class="center-ic">${`<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[v.type]}</g>`}</g>
      </svg>
      <figcaption>
        <span><i class="dot d-high"></i>High</span><span><i class="dot d-medium"></i>Likely</span><span><i class="dot d-low"></i>Check fitment</span>
        <span class="muted">Thicker line = more shared parts${twins.length > nodes.length ? ` · top ${nodes.length} of ${twins.length}` : ""}</span>
      </figcaption>
    </figure>`;
  }

  function scoreRing(n, max, label) {
    const pct = Math.max(0.04, Math.min(1, n / max));
    const C = 2 * Math.PI * 42;
    return `<div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="ring-bg"/><circle cx="50" cy="50" r="42" class="ring-fg" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"/></svg><div><b>${n}</b><span>${esc(label)}</span></div></div>`;
  }

  // ---------- cascading selectors ----------
  function makesFor(type) {
    return [...new Set(DB.vehicles.filter(v => type === "all" || v.type === type).map(v => v.make))].sort((a, b) => a.localeCompare(b));
  }
  function modelsFor(type, make) {
    return DB.vehicles.filter(v => (type === "all" || v.type === type) && v.make === make).sort((a, b) => a.model.localeCompare(b.model) || a.years.localeCompare(b.years));
  }

  // ================= VIEWS =================
  const STORIES = [
    { a: "honda-city-4g-d", b: "honda-amaze-2g-d", t: "Honda City ↔ Amaze", d: "Same 1.5 i-DTEC diesel, so injectors, glow plugs and filters are shared." },
    { a: "merc-a180-cdi-w176", b: "renault-duster-dci", t: "Mercedes A180 CDI ↔ Renault Duster", d: "Both use the Renault 1.5 dCi K9K engine." },
    { a: "bentley-cgt-1g", b: "vw-phaeton-w12", t: "Bentley Continental GT ↔ VW Phaeton", d: "W12 engine and D1 platform siblings." },
    { a: "bmw-g310r", b: "tvs-apache-rr310", t: "BMW G 310 R ↔ TVS Apache RR 310", d: "Both bikes are built by TVS around the same engine." },
    { a: "lexus-es250-7g", b: "toyota-camry-xv70", t: "Lexus ES 250 ↔ Toyota Camry", d: "Same 2.5 Dynamic Force engine; the Lexus-badged part usually costs more." },
    { a: "lambo-huracan", b: "audi-r8-2g", t: "Lamborghini Huracán ↔ Audi R8", d: "Shared 5.2 V10, gearbox and chassis." }
  ];

  function viewHome(params) {
    const type = TYPES[params.get("type")] ? params.get("type") : "all";
    const nParts = DB.families.reduce((s, f) => s + f.parts.length, 0);
    const makes = new Set(DB.vehicles.map(v => v.make)).size;
    const g = garage();
    const counts = { all: DB.vehicles.length };
    TYPE_KEYS.forEach(k => counts[k] = DB.vehicles.filter(v => v.type === k).length);
    return `
      <section class="hero">
        <div class="hero-bg" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="hero-inner">
          <div class="kicker">${icon("compare")} Cross-vehicle parts interchange</div>
          <h1>The part you need is probably<br>on <span class="grad">another vehicle</span>.</h1>
          <p class="lead">Carmakers share engines, gearboxes and platforms across models and even brands. Find the twins of your car, bike, van, aircraft or boat engine, and buy the same part where it's cheaper or in stock.</p>

          <div class="types" role="tablist">
            ${["all", ...TYPE_KEYS].map(k => `<button class="type-tab${k === type ? " on" : ""}" data-type="${k}" role="tab" aria-selected="${k === type}">${icon(k)}<span>${esc(TYPES[k].label)}</span><em>${counts[k]}</em></button>`).join("")}
          </div>

          <form class="finder" id="finder" autocomplete="off">
            <label class="f-field"><span>Make</span>
              <select id="f-make" required><option value="">Choose make…</option>${makesFor(type).map(m => `<option>${esc(m)}</option>`).join("")}</select></label>
            <label class="f-field"><span>Model & engine</span>
              <select id="f-model" required disabled><option value="">Choose make first</option></select></label>
            <label class="f-field grow"><span>Part you need <em>optional</em></span>
              <input id="f-part" list="f-parts" type="search" placeholder="injector, mounting, glow plug…"><datalist id="f-parts"></datalist></label>
            <button class="btn primary big" type="submit">${icon("search")} Find twins</button>
          </form>
          <div class="quick">or press <kbd>/</kbd> to search anything ·
            <a href="#/vehicle/honda-city-4g-d?part=injector">Honda City diesel nozzle</a>
            <a href="#/vehicle/re-classic-350">Royal Enfield Classic 350</a>
            <a href="#/vehicle/cessna-172s">Cessna 172S</a>
            <a href="#/vehicle/fiat-ducato-x250">Fiat Ducato</a>
          </div>
        </div>
      </section>

      <section class="stats">
        <div><b data-count="${DB.vehicles.length}">${DB.vehicles.length}</b><span>vehicles</span></div>
        <div><b data-count="${makes}">${makes}</b><span>brands</span></div>
        <div><b data-count="${DB.families.length}">${DB.families.length}</b><span>shared families</span></div>
        <div><b data-count="${nParts}">${nParts}</b><span>part groups</span></div>
      </section>

      ${g.length ? `<section><div class="sec-head"><h2>${icon("star")} Your garage</h2><a href="#/garage">Manage →</a></div><div class="vgrid">${g.map(id => vehicleCard(vehiclesById.get(id))).join("")}</div></section>` : ""}

      <section>
        <div class="sec-head"><h2>Twins you might not expect</h2><a href="#/compare">Compare any two →</a></div>
        <div class="stories">${STORIES.filter(s => vehiclesById.has(s.a) && vehiclesById.has(s.b)).map(s => {
          const a = vehiclesById.get(s.a), b = vehiclesById.get(s.b);
          return `<a class="story" href="#/compare?a=${s.a}&b=${s.b}">
            <div class="story-ics">${typeIcon(a.type)}<span>⇄</span>${typeIcon(b.type)}</div>
            <h3>${esc(s.t)}</h3><p>${esc(s.d)}</p>
            <div class="story-n">${plural(sharedBetween(s.a, s.b).filter(p => p.confidence !== "avoid").length, "shared part group")} ${icon("arrow")}</div></a>`;
        }).join("")}</div>
      </section>

      <section>
        <div class="sec-head"><h2>Explore by type</h2><a href="#/browse">Browse everything →</a></div>
        <div class="tiles">${TYPE_KEYS.map(k => `<a class="tile t-${k}" href="#/browse?type=${k}">${icon(k)}<b>${esc(TYPES[k].plural)}</b><span>${plural(counts[k], "vehicle")} · ${plural(DB.families.filter(f => f.domain === k).length, "family", "families")}</span></a>`).join("")}</div>
      </section>

      <section class="how">
        <div><span class="step">1</span><h3>Shared families</h3><p>Vehicles are grouped by the engine or platform they share. For example, the Fiat 1.3 Multijet is sold as Maruti DDiS, Tata Quadrajet and Opel CDTi.</p></div>
        <div><span class="step">2</span><h3>Rated matches</h3><p>Every part group has a confidence level: ${["high", "medium", "low", "avoid"].map(badge).join(" ")}</p></div>
        <div><span class="step">3</span><h3>Source smarter</h3><p>Ask for the twin's part, or the supplier's own box (Bosch, Denso, Delphi…), and confirm the part number before you buy.</p></div>
      </section>`;
  }

  function viewVehicle(id, params) {
    const v = vehiclesById.get(id);
    if (!v) return notFound();
    const fams = familiesByVehicle.get(id) || [];
    const all = partsForVehicle(id);
    const twins = twinsFor(id);
    const q = params.get("part") || "";
    const cat = params.get("cat") || "";
    const confOn = (params.get("conf") || CONF_KEYS.join(",")).split(",").filter(c => CONF[c]);
    const toks = partTokens(q);
    const parts = all.filter(p => (!toks.length || matchesPart(p, toks)) && (!cat || p.category === cat) && confOn.includes(p.confidence));
    const cats = [...new Set(all.map(p => p.category))].sort();
    const byCat = {};
    parts.forEach(p => (byCat[p.category] = byCat[p.category] || []).push(p));
    const starred = inGarage(id);

    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/browse?type=${v.type}">${esc(TYPES[v.type].label)}</a><span>/</span>${esc(v.make)}</nav>
      <header class="vhero t-${v.type}">
        <div class="vhero-ic">${typeIcon(v.type)}</div>
        <div class="vhero-main">
          <div class="eyebrow">${esc(v.make)} · ${esc(TYPES[v.type].label)}</div>
          <h1>${esc(v.model)}</h1>
          <p class="sub">${esc(v.variant)} · ${esc(v.years)} · ${esc(v.market)}</p>
          <div class="fams">${fams.map(famLink).join("")}</div>
        </div>
        <div class="vhero-side">
          ${scoreRing(twins.length, Math.max(twins.length, 12), twins.length === 1 ? "twin vehicle" : "twin vehicles")}
          <div class="actions">
            <button class="btn${starred ? " on" : ""}" id="star" aria-pressed="${starred}">${icon("star")} ${starred ? "In garage" : "Save"}</button>
            <button class="btn" id="share">${icon("link")} Share</button>
          </div>
        </div>
      </header>
      ${safetyNotice(v.type)}

      ${twins.length ? `<div class="vlayout">
        <section class="panel">
          <h2>Twin network</h2>
          ${twinGraph(id, twins)}
        </section>
        <section class="panel">
          <h2>Closest twins</h2>
          <ol class="twinlist">${twins.slice(0, 8).map(t => {
            const o = vehiclesById.get(t.id);
            return `<li><a href="#/vehicle/${esc(t.id)}">${typeIcon(o.type)}<span><b>${esc(vName(o))}</b><small>${esc(o.variant)}</small></span></a>
              <span class="tl-n">${t.parts.length}</span><a class="tl-cmp" href="#/compare?a=${esc(id)}&b=${esc(t.id)}" title="Compare">${icon("compare")}</a></li>`;
          }).join("")}</ol>
        </section>
      </div>` : ""}

      <section id="parts">
        <div class="sec-head"><h2>Shared parts <span class="count">${parts.length}/${all.length}</span></h2></div>
        <div class="filters">
          <div class="searchbox">${icon("search")}<input id="vpart" type="search" value="${esc(q)}" placeholder="Filter: injector, mounting, brake pads…" autocomplete="off"></div>
          <div class="pills">
            <button class="fpill${!cat ? " on" : ""}" data-cat="">All</button>
            ${cats.map(c => `<button class="fpill${c === cat ? " on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
          </div>
          <div class="pills conf">
            ${CONF_KEYS.filter(c => all.some(p => p.confidence === c)).map(c => `<button class="fpill cf-${c}${confOn.includes(c) ? " on" : ""}" data-conf="${c}"><i class="dot d-${c}"></i>${CONF[c].short}</button>`).join("")}
          </div>
        </div>
        ${disclaimer()}
        ${parts.length ? Object.keys(byCat).sort().map(c => `<div class="cat"><h3 class="cat-h">${esc(c)}</h3><div class="parts">${byCat[c].map(p => partCard(p, { compact: true })).join("")}</div></div>`).join("")
          : `<div class="empty">${icon("search", "big")}<h3>No shared parts match</h3>
             <p>${all.length ? "Try clearing filters, or " : "We have no interchange records for this vehicle yet. "}<a href="#/contribute?vehicle=${esc(id)}&part=${encodeURIComponent(q)}">add a match you know</a>${q ? `, or <a href="#/search?q=${encodeURIComponent(q)}">search “${esc(q)}” everywhere</a>` : ""}.</p></div>`}
      </section>`;
  }

  function viewFamily(id) {
    const f = familiesById.get(id);
    if (!f) return notFound();
    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span><a href="#/browse?type=${f.domain}">${esc(TYPES[f.domain].label)}</a><span>/</span>Family</nav>
      <header class="vhero t-${f.domain}">
        <div class="vhero-ic">${icon(f.type === "engine" ? "gear" : "layers")}</div>
        <div class="vhero-main">
          <div class="eyebrow">${f.type === "engine" ? "Engine family" : "Platform family"} · ${esc(f.maker)}</div>
          <h1>${esc(f.name)}</h1>
          <p class="lead-s">${esc(f.summary)}</p>
        </div>
        <div class="vhero-side">${scoreRing(f.vehicles.length, Math.max(f.vehicles.length, 12), "vehicles")}</div>
      </header>
      ${safetyNotice(f.domain)}
      <section><h2>Vehicles in this family</h2><div class="vgrid">${f.vehicles.map(vid => vehiclesById.get(vid)).filter(Boolean).map(vehicleCard).join("")}</div></section>
      <section><h2>Interchangeable part groups</h2>${disclaimer()}
        <div class="parts">${f.parts.map(p => partCard({ ...p, family: f, shared: poolOf(p, f) }, { showFamily: false, label: p.confidence === "avoid" ? "Do NOT swap between" : "Fits" })).join("")}</div></section>`;
  }

  function viewSearch(params) {
    const q = params.get("q") || "";
    const r = search(q);
    const total = r.vehicles.length + r.families.length + r.parts.length;
    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span>Search</nav>
      <h1 class="page-h">${q ? `Results for “${esc(q)}”` : "Search"}</h1>
      <form class="searchbox big" id="bigsearch">${icon("search")}<input id="bq" type="search" value="${esc(q)}" placeholder="Vehicle, engine code or part…" autofocus></form>
      ${r.vehicles.length ? `<section><h2>Vehicles <span class="count">${r.vehicles.length}</span></h2><div class="vgrid">${r.vehicles.map(vehicleCard).join("")}</div></section>` : ""}
      ${r.families.length ? `<section><h2>Families <span class="count">${r.families.length}</span></h2><div class="fgrid">${r.families.map(familyCard).join("")}</div></section>` : ""}
      ${r.parts.length ? `<section><h2>Parts <span class="count">${r.parts.length}</span></h2>${disclaimer()}<div class="parts">${r.parts.map(p => partCard(p, { label: p.confidence === "avoid" ? "Do NOT swap between" : "Fits" })).join("")}</div></section>` : ""}
      ${q && !total ? `<div class="empty">${icon("search", "big")}<h3>Nothing found for “${esc(q)}”</h3><p>Try a broader word (“injector”, “Swift”, “K9K”, “Rotax”), or <a href="#/contribute">add a match</a>.</p></div>` : ""}`;
  }

  function viewBrowse(params) {
    const type = TYPES[params.get("type")] ? params.get("type") : "all";
    const make = params.get("make") || "";
    const vs = DB.vehicles.filter(v => (type === "all" || v.type === type) && (!make || v.make === make))
      .sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
    const fs = DB.families.filter(f => type === "all" || f.domain === type);
    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span>Browse</nav>
      <h1 class="page-h">${esc(TYPES[type].plural)}</h1>
      <div class="types small">${["all", ...TYPE_KEYS].map(k => `<a class="type-tab${k === type ? " on" : ""}" href="#/browse?type=${k}">${icon(k)}<span>${esc(TYPES[k].label)}</span></a>`).join("")}</div>
      <div class="pills makes">
        <a class="fpill${!make ? " on" : ""}" href="#/browse?type=${type}">All brands</a>
        ${makesFor(type).map(m => `<a class="fpill${m === make ? " on" : ""}" href="#/browse?type=${type}&make=${encodeURIComponent(m)}">${esc(m)}</a>`).join("")}
      </div>
      <section><h2>Vehicles <span class="count">${vs.length}</span></h2><div class="vgrid">${vs.map(vehicleCard).join("")}</div></section>
      ${!make ? `<section><h2>Shared families <span class="count">${fs.length}</span></h2><div class="fgrid">${fs.map(familyCard).join("")}</div></section>` : ""}`;
  }

  function vehicleSelect(name, selected) {
    return `<select name="${name}" id="${name}"><option value="">Choose a vehicle…</option>${TYPE_KEYS.map(t => {
      const list = DB.vehicles.filter(v => v.type === t).sort((a, b) => vName(a).localeCompare(vName(b)));
      return `<optgroup label="${esc(TYPES[t].plural)}">${list.map(v => `<option value="${esc(v.id)}"${v.id === selected ? " selected" : ""}>${esc(vName(v))}: ${esc(v.variant)} (${esc(v.years)})</option>`).join("")}</optgroup>`;
    }).join("")}</select>`;
  }

  function viewCompare(params) {
    const a = vehiclesById.has(params.get("a")) ? params.get("a") : "";
    const b = vehiclesById.has(params.get("b")) ? params.get("b") : "";
    let body = `<div class="empty">${icon("compare", "big")}<h3>Pick two vehicles</h3><p>See exactly which parts they share.</p></div>`;
    if (a && b && a !== b) {
      const shared = sharedBetween(a, b);
      const ok = shared.filter(p => p.confidence !== "avoid");
      const va = vehiclesById.get(a), vb = vehiclesById.get(b);
      const tally = c => shared.filter(p => p.confidence === c).length;
      body = `
        <div class="cmp-hero">
          <a class="cmp-side" href="#/vehicle/${a}">${typeIcon(va.type)}<b>${esc(vName(va))}</b><small>${esc(va.variant)}</small></a>
          ${scoreRing(ok.length, Math.max(ok.length, 10), "shared groups")}
          <a class="cmp-side" href="#/vehicle/${b}">${typeIcon(vb.type)}<b>${esc(vName(vb))}</b><small>${esc(vb.variant)}</small></a>
        </div>
        <div class="tally">${CONF_KEYS.map(c => `<span class="tchip cf-${c}"><i class="dot d-${c}"></i>${tally(c)} ${CONF[c].short}</span>`).join("")}</div>
        ${safetyNotice(va.type) || safetyNotice(vb.type)}
        ${shared.length ? disclaimer() + `<div class="parts">${shared.map(p => partCard({ ...p, shared: [b] }, { label: p.confidence === "avoid" ? "Do NOT swap with" : "Same part as" })).join("")}</div>`
          : `<div class="empty"><h3>No known shared parts</h3><p>These two aren't linked in our data yet. <a href="#/contribute?vehicle=${a}">Know a match? Add it.</a></p></div>`}`;
    } else if (a && a === b) {
      body = `<div class="empty"><h3>Choose two different vehicles</h3></div>`;
    }
    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span>Compare</nav>
      <h1 class="page-h">Compare two vehicles</h1>
      <form class="cmp-form" id="cmpform">
        <label><span>Vehicle A</span>${vehicleSelect("a", a)}</label>
        <button type="button" class="btn icon" id="swap" title="Swap">${icon("compare")}</button>
        <label><span>Vehicle B</span>${vehicleSelect("b", b)}</label>
      </form>
      ${body}`;
  }

  function viewGarage() {
    const g = garage();
    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span>Garage</nav>
      <h1 class="page-h">${icon("star")} My garage</h1>
      <p class="muted">Save the vehicles you own or work on for one-tap access. Stored in this browser only.</p>
      ${g.length ? `<div class="vgrid">${g.map(id => `<div class="gwrap">${vehicleCard(vehiclesById.get(id))}<button class="btn small ghost" data-unstar="${esc(id)}">${icon("close")} Remove</button></div>`).join("")}</div>`
        : `<div class="empty">${icon("star", "big")}<h3>Your garage is empty</h3><p>Open any vehicle and press <b>Save</b>.</p><a class="btn primary" href="#/browse">Browse vehicles</a></div>`}`;
  }

  function viewContribute(params) {
    const list = store.get(LS.contrib, []);
    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span>Contribute</nav>
      <h1 class="page-h">Add a parts match</h1>
      <p class="muted">Found a part that fits two different vehicles? Record it. Matches are saved in <b>this browser only</b> for now; use “Export JSON” to submit them for review.</p>
      <form id="contrib" class="contrib panel">
        <label><span>Vehicle A</span>${vehicleSelect("ca", params.get("vehicle")).replace('name="ca"', 'name="a" required')}</label>
        <label><span>Vehicle B (shares the part)</span>${vehicleSelect("cb").replace('name="cb"', 'name="b"')}</label>
        <label><span>Vehicle B not listed? Describe it</span><input name="bText" placeholder="e.g. Fiat Doblo 1.3 Multijet 2012"></label>
        <label><span>Part</span><input name="part" required value="${esc(params.get("part") || "")}" placeholder="e.g. Glow plug"></label>
        <label><span>OEM / supplier part number(s)</span><input name="pn" placeholder="Number stamped on the part"></label>
        <label><span>Evidence</span><select name="evidence"><option>Fitted it myself</option><option>Same part number on both</option><option>Mechanic / dealer confirmed</option><option>Online catalogue</option><option>Heard / not sure</option></select></label>
        <label class="full"><span>Notes</span><textarea name="notes" rows="3" placeholder="Differences, modifications needed, price you paid…"></textarea></label>
        <button class="btn primary" type="submit">${icon("plus")} Save match</button>
      </form>
      <section><div class="sec-head"><h2>Your saved matches <span class="count">${list.length}</span></h2>${list.length ? `<button class="btn" id="export">Export JSON</button>` : ""}</div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Vehicle A</th><th>Vehicle B</th><th>Part</th><th>Part no.</th><th>Evidence</th><th></th></tr></thead><tbody>
        ${list.map((c, i) => `<tr><td>${esc(vehiclesById.get(c.a) ? vName(vehiclesById.get(c.a)) : c.a)}</td><td>${esc(c.bText || (vehiclesById.get(c.b) ? vName(vehiclesById.get(c.b)) : c.b))}</td><td>${esc(c.part)}</td><td>${esc(c.pn)}</td><td>${esc(c.evidence)}</td><td><button class="btn small ghost" data-del="${i}">Delete</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">None yet.</p>`}</section>`;
  }

  function viewAbout() {
    const counts = TYPE_KEYS.map(k => `${DB.vehicles.filter(v => v.type === k).length} ${TYPES[k].label.toLowerCase()}`).join(", ");
    return `
      <nav class="crumbs"><a href="#/">Home</a><span>/</span>About</nav>
      <article class="prose">
      <h1 class="page-h">About PartTwin</h1>
      <p>A spare part for one vehicle can be expensive or out of stock, while the <em>identical</em> part is sold cheaply for a different vehicle. This happens because manufacturers share engines, gearboxes and platforms across models and brands, and because suppliers such as Bosch, Denso, Delphi and Continental make the same component for many makers.</p>
      <h2>Sourcing tips</h2>
      <ul>
        <li><b>The part number is the proof.</b> Read it off the old part or get it from a VIN-based catalogue. A car name alone doesn't prove a match.</li>
        <li><b>Ask for the supplier's box.</b> The same Bosch or Denso part in its own packaging is often cheaper than the carmaker-branded one.</li>
        <li><b>Engine internals and service parts</b> (injectors, plugs, filters, sensors, timing kits) are the most likely to interchange.</li>
        <li><b>Body-mounted parts</b> (engine mounts, lamps, glass) usually interchange only between badge-engineered twins.</li>
        <li><b>The same engine doesn't mean the same calibration.</b> Turbos, injectors and EGR valves can change with power output and emission norms.</li>
        <li><b>Aircraft & marine:</b> regulatory and safety rules come first. See the warnings on those pages.</li>
      </ul>
      <h2>Data status</h2>
      <p>Seed dataset v${esc(DB.version)}: ${DB.vehicles.length} vehicles (${counts}) in ${DB.families.length} shared families. It is hand-curated from widely known engine and platform sharing. It is <b>not</b> a complete or official catalogue and deliberately contains no part numbers. Covering every vehicle on the planet requires licensed catalogue data (e.g. TecDoc for cars and commercial vehicles, OEM EPCs, aviation IPCs) plus verified community submissions. See the README roadmap.</p>
      </article>`;
  }

  const notFound = () => `<div class="empty">${icon("search", "big")}<h1>Not found</h1><p><a class="btn primary" href="#/">Back to home</a></p></div>`;

  // ================= ROUTER =================
  function parseHash() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = hash.split("?");
    return { seg: path.split("/").filter(Boolean), params: new URLSearchParams(qs || "") };
  }

  function route(opts) {
    opts = opts || {};
    const { seg, params } = parseHash();
    let html;
    switch (seg[0]) {
      case undefined:    html = viewHome(params); break;
      case "vehicle":    html = viewVehicle(decodeURIComponent(seg[1] || ""), params); break;
      case "family":     html = viewFamily(decodeURIComponent(seg[1] || "")); break;
      case "search":     html = viewSearch(params); break;
      case "browse":     html = viewBrowse(params); break;
      case "compare":    html = viewCompare(params); break;
      case "garage":     html = viewGarage(); break;
      case "contribute": html = viewContribute(params); break;
      case "about":      html = viewAbout(); break;
      default:           html = notFound();
    }
    app.innerHTML = html;
    if (!opts.keepScroll) { app.classList.remove("enter"); void app.offsetWidth; app.classList.add("enter"); window.scrollTo(0, 0); }
    document.querySelectorAll(".nav a, .mnav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === `#/${seg[0] || ""}`));
    const v = seg[0] === "vehicle" && vehiclesById.get(seg[1]);
    document.title = v ? `${vName(v)} ${v.variant}: shared parts · PartTwin` : "PartTwin: find the same part on another vehicle";
    updateGarageBadge();
    bind(seg, params);
  }

  function setParams(mut, keepScroll = true) {
    const { seg, params } = parseHash();
    mut(params);
    const qs = params.toString();
    history.replaceState(null, "", `#/${seg.join("/")}${qs ? "?" + qs : ""}`);
    route({ keepScroll });
  }

  function bind(seg, params) {
    // --- home finder ---
    const fMake = document.getElementById("f-make");
    if (fMake) {
      const type = TYPES[params.get("type")] ? params.get("type") : "all";
      const fModel = document.getElementById("f-model"), fParts = document.getElementById("f-parts");
      document.querySelectorAll(".type-tab[data-type]").forEach(b => b.addEventListener("click", () => setParams(p => b.dataset.type === "all" ? p.delete("type") : p.set("type", b.dataset.type))));
      fMake.addEventListener("change", () => {
        const ms = modelsFor(type, fMake.value);
        fModel.disabled = !ms.length;
        fModel.innerHTML = ms.length ? `<option value="">Choose model…</option>` + ms.map(v => `<option value="${esc(v.id)}">${esc(v.model)}: ${esc(v.variant)} (${esc(v.years)})</option>`).join("") : `<option value="">Choose make first</option>`;
        if (ms.length === 1) { fModel.value = ms[0].id; fModel.dispatchEvent(new Event("change")); }
      });
      fModel.addEventListener("change", () => {
        fParts.innerHTML = [...new Set(partsForVehicle(fModel.value).map(p => p.name))].map(n => `<option value="${esc(n)}">`).join("");
      });
      document.getElementById("finder").addEventListener("submit", e => {
        e.preventDefault();
        const vid = fModel.value, part = document.getElementById("f-part").value.trim();
        if (vid) location.hash = `#/vehicle/${vid}${part ? `?part=${encodeURIComponent(part)}` : ""}`;
      });
      countUp();
    }

    // --- vehicle page ---
    const vpart = document.getElementById("vpart");
    if (vpart) {
      let t;
      vpart.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const pos = vpart.selectionStart;
          setParams(p => vpart.value.trim() ? p.set("part", vpart.value.trim()) : p.delete("part"));
          const n = document.getElementById("vpart"); n.focus(); n.setSelectionRange(pos, pos);
        }, 200);
      });
      document.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => setParams(p => b.dataset.cat ? p.set("cat", b.dataset.cat) : p.delete("cat"))));
      document.querySelectorAll("[data-conf]").forEach(b => b.addEventListener("click", () => setParams(p => {
        let on = (p.get("conf") || CONF_KEYS.join(",")).split(",");
        on = on.includes(b.dataset.conf) ? on.filter(c => c !== b.dataset.conf) : [...on, b.dataset.conf];
        on.length === CONF_KEYS.length ? p.delete("conf") : p.set("conf", on.join(",") || "none");
      })));
      document.getElementById("star").addEventListener("click", () => {
        const id = seg[1]; let g = garage();
        g = g.includes(id) ? g.filter(x => x !== id) : [...g, id];
        store.set(LS.garage, g);
        toast(g.includes(id) ? "Saved to your garage" : "Removed from garage");
        route({ keepScroll: true });
      });
    }
    const share = document.getElementById("share");
    if (share) share.addEventListener("click", async () => {
      try {
        if (navigator.share) await navigator.share({ title: document.title, url: location.href });
        else { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
      } catch { /* user cancelled */ }
    });

    // --- search page ---
    const bs = document.getElementById("bigsearch");
    if (bs) bs.addEventListener("submit", e => { e.preventDefault(); location.hash = `#/search?q=${encodeURIComponent(document.getElementById("bq").value.trim())}`; });

    // --- compare ---
    const cmp = document.getElementById("cmpform");
    if (cmp) {
      const go = () => { location.hash = `#/compare?a=${cmp.a.value}&b=${cmp.b.value}`; };
      cmp.a.addEventListener("change", go); cmp.b.addEventListener("change", go);
      document.getElementById("swap").addEventListener("click", () => { const x = cmp.a.value; cmp.a.value = cmp.b.value; cmp.b.value = x; go(); });
    }

    // --- garage ---
    document.querySelectorAll("[data-unstar]").forEach(b => b.addEventListener("click", () => {
      store.set(LS.garage, garage().filter(x => x !== b.dataset.unstar)); route({ keepScroll: true });
    }));

    // --- contribute ---
    const contrib = document.getElementById("contrib");
    if (contrib) contrib.addEventListener("submit", e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(contrib).entries());
      if (!d.b && !d.bText) { toast("Choose or describe Vehicle B"); return; }
      d.created = new Date().toISOString();
      store.set(LS.contrib, [...store.get(LS.contrib, []), d]);
      toast("Match saved. Thank you!");
      route({ keepScroll: true });
    });
    document.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      const l = store.get(LS.contrib, []); l.splice(+b.dataset.del, 1); store.set(LS.contrib, l); route({ keepScroll: true });
    }));
    const exp = document.getElementById("export");
    if (exp) exp.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(store.get(LS.contrib, []), null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "parttwin-contributions.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  function countUp() {
    if (reduceMotion) return;
    document.querySelectorAll("[data-count]").forEach(el => {
      const end = +el.dataset.count, t0 = performance.now(), dur = 900;
      const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // ================= TOAST =================
  let toastT;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function updateGarageBadge() {
    const b = document.getElementById("garage-n"); const n = garage().length;
    b.textContent = n; b.hidden = !n;
  }

  // ================= THEME =================
  const THEMES = ["auto", "light", "dark"];
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const btn = document.getElementById("theme");
    btn.innerHTML = icon(t === "auto" ? "auto" : t === "light" ? "sun" : "moon");
    btn.title = `Theme: ${t}`;
  }
  document.getElementById("theme").addEventListener("click", () => {
    const cur = store.get(LS.theme, "auto");
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    store.set(LS.theme, next); applyTheme(next); toast(`Theme: ${next}`);
  });
  applyTheme(store.get(LS.theme, "auto"));

  // ================= COMMAND PALETTE =================
  const pal = document.getElementById("palette"), palIn = document.getElementById("pal-q"), palList = document.getElementById("pal-list");
  let palItems = [], palIdx = 0;

  function openPalette() { pal.hidden = false; document.body.classList.add("modal-open"); palIn.value = ""; renderPalette(); requestAnimationFrame(() => palIn.focus()); }
  function closePalette() { pal.hidden = true; document.body.classList.remove("modal-open"); }

  function renderPalette() {
    const q = palIn.value.trim();
    palItems = [];
    if (!q) {
      const g = garage();
      g.forEach(id => { const v = vehiclesById.get(id); palItems.push({ sec: "Your garage", href: `#/vehicle/${id}`, ic: v.type, t: vName(v), s: v.variant }); });
      STORIES.slice(0, 4).forEach(s => palItems.push({ sec: "Popular comparisons", href: `#/compare?a=${s.a}&b=${s.b}`, ic: "compare", t: s.t, s: s.d }));
      TYPE_KEYS.forEach(k => palItems.push({ sec: "Browse", href: `#/browse?type=${k}`, ic: k, t: TYPES[k].plural, s: "" }));
    } else {
      const r = search(q, 8);
      r.vehicles.forEach(v => palItems.push({ sec: "Vehicles", href: `#/vehicle/${v.id}`, ic: v.type, t: vName(v), s: `${v.variant} · ${v.years}` }));
      r.families.forEach(f => palItems.push({ sec: "Families", href: `#/family/${f.id}`, ic: f.type === "engine" ? "gear" : "layers", t: f.name, s: plural(f.vehicles.length, "vehicle") }));
      const seen = new Set();
      r.parts.forEach(p => { const k = p.name; if (seen.has(k)) return; seen.add(k); palItems.push({ sec: "Parts", href: `#/search?q=${encodeURIComponent(q)}`, ic: "search", t: p.name, s: p.family.name }); });
      palItems.push({ sec: "", href: `#/search?q=${encodeURIComponent(q)}`, ic: "arrow", t: `See all results for “${q}”`, s: "" });
    }
    palIdx = 0;
    let last = null;
    palList.innerHTML = palItems.map((it, i) => {
      const h = it.sec !== last && it.sec ? `<li class="pal-sec">${esc(it.sec)}</li>` : "";
      last = it.sec;
      return `${h}<li><a href="${esc(it.href)}" class="pal-item${i === 0 ? " on" : ""}" data-i="${i}">${icon(it.ic)}<span><b>${esc(it.t)}</b>${it.s ? `<small>${esc(it.s)}</small>` : ""}</span><kbd>↵</kbd></a></li>`;
    }).join("") || `<li class="pal-empty">No matches</li>`;
  }
  function movePal(d) {
    const els = palList.querySelectorAll(".pal-item");
    if (!els.length) return;
    els[palIdx].classList.remove("on");
    palIdx = (palIdx + d + els.length) % els.length;
    els[palIdx].classList.add("on"); els[palIdx].scrollIntoView({ block: "nearest" });
  }
  palIn.addEventListener("input", renderPalette);
  palIn.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); movePal(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); movePal(-1); }
    else if (e.key === "Enter") { e.preventDefault(); const it = palItems[palIdx]; if (it) { location.hash = it.href; closePalette(); } }
  });
  palList.addEventListener("click", e => { if (e.target.closest("a")) closePalette(); });
  palList.addEventListener("mousemove", e => {
    const a = e.target.closest(".pal-item"); if (!a || +a.dataset.i === palIdx) return;
    palList.querySelectorAll(".pal-item").forEach(x => x.classList.remove("on")); a.classList.add("on"); palIdx = +a.dataset.i;
  });
  pal.addEventListener("click", e => { if (e.target === pal) closePalette(); });
  document.getElementById("open-search").addEventListener("click", openPalette);
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); }
    else if (e.key === "Escape" && !pal.hidden) closePalette();
  });

  window.addEventListener("hashchange", () => route());
  route();
})();
