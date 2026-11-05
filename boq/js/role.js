// Workspaces by role. A contractor and a department engineer need different parts of BuildRigs:
// each sees only the tabs, home cards and shortcuts of their own work. The choice is kept on this
// device and can be changed from the header or Settings. It shapes the screens; it is not a login,
// so anyone using the same device can switch.

const KEY = "br.role";

export const ROLES = {
  contractor: {
    label: "Contractor",
    icon: "👷",
    kicker: "Contractor workspace",
    title: "Win · Build · Get paid",
    pitch: "Price tenders with your own rates, run your sites, keep labour, materials and machines in check, and make your running and final bills",
    // Everything a firm doing the work uses. The department's e-tender template is not theirs to make.
    tabs: ["home", "ratebooks", "pick", "takeoff", "boq", "bills", "sites", "office", "tenders", "resources", "settings"],
    cta: [["primary", "sites:newSite", "＋ Start a site"], ["ghost dark", "bills", "🧾 Make a bill"], ["ghost dark", "tenders:bid", "📝 Fill a tender BOQ"]],
    gets: ["Tender alerts and bid BOQ with your rates", "Bills from the MB, extra items, deviation", "Site diary, DPR and GPS camera", "Workforce, materials, machinery and vendors", "Office accounts, purchase bills and backup"],
  },
  engineer: {
    label: "Engineer",
    icon: "📐",
    kicker: "Engineer workspace · JEN / AEN / XEN",
    title: "Estimate · Tender · Measure",
    pitch: "Prepare estimates from the BSR, publish the e-tender BOQ in the GePNIC template, record measurements and check running and final bills",
    // A department engineer's work: estimating, tendering, measuring and checking. No contractor's
    // accounts, workforce, stock or bidding.
    tabs: ["home", "ratebooks", "pick", "takeoff", "boq", "tender", "bills", "sites", "settings"],
    cta: [["primary", "boq", "📐 Make an estimate"], ["ghost dark", "tender", "🏛️ e-Tender BOQ"], ["ghost dark", "bills", "🧾 Check a bill"]],
    gets: ["Rate books (BSR / SOR) and drawing takeoff", "Estimates, measurement sheets and abstract of cost", "e-Tender BOQ in the GePNIC .xls template", "Bills, MB abstract and deviation statement", "Site inspections with diary and GPS photos"],
  },
};

let onChange = () => {};

export const role = () => (ROLES[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : null);
export const roleInfo = () => ROLES[role()] || null;
// Before a role is chosen, nothing is hidden.
export const allowed = (tab) => { const r = roleInfo(); return !r || r.tabs.includes(String(tab).split(":")[0]); };

export function setRole(r) {
  localStorage.setItem(KEY, r);
  applyRole();
  onChange(r);
}

export function applyRole() {
  const r = role();
  document.body.dataset.role = r || "";
  let n = 0;
  document.querySelectorAll(".tabs button").forEach((b) => {
    const ok = allowed(b.dataset.tab);
    b.classList.toggle("hidden", !ok);
    // Renumber the visible work tabs 1, 2, 3 … so the steps stay in order.
    const step = b.querySelector(".step");
    if (ok && step && /^\d+$/.test(step.dataset.n ||= step.textContent.trim())) step.textContent = ++n;
  });
  const chip = document.getElementById("roleChip");
  if (chip) {
    const info = roleInfo();
    chip.innerHTML = info ? `<span>${info.icon}</span> ${info.label} <small>switch</small>` : "Choose workspace";
  }
}

export function chooseRole(first = false) {
  document.getElementById("rolePick")?.remove();
  const cur = role();
  const el = document.createElement("div");
  el.id = "rolePick"; el.className = "role-pick"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="role-box">
      <img src="img/logo.png" alt="BuildRigs" class="role-logo">
      <h2>${first ? "Welcome to BuildRigs. Who are you?" : "Switch workspace"}</h2>
      <p class="muted">Each workspace shows only the tools for that work. You can switch at any time from the top bar or Settings; your data stays the same.</p>
      <div class="role-cards">${Object.entries(ROLES).map(([k, r]) => `
        <button class="role-card role-${k} ${cur === k ? "on" : ""}" data-role="${k}">
          <span class="role-ic">${r.icon}</span><b>I am a${k === "engineer" ? "n" : ""} ${r.label}</b>
          <span class="role-sub">${r.kicker}</span>
          <ul>${r.gets.map((g) => `<li>${g}</li>`).join("")}</ul>
          <i>${cur === k ? "Current workspace" : "Open this workspace →"}</i>
        </button>`).join("")}</div>
      ${first ? "" : `<button class="ghost role-cancel">Cancel</button>`}
    </div>`;
  document.body.append(el);
  el.addEventListener("click", (e) => {
    const c = e.target.closest("[data-role]");
    if (c) { el.remove(); setRole(c.dataset.role); return; }
    if (e.target.closest(".role-cancel") || (e.target === el && !first)) el.remove();
  });
}

export function initRole({ onRoleChange }) {
  onChange = onRoleChange || onChange;
  const tabs = document.querySelector(".tabs");
  if (tabs && !document.getElementById("roleChip")) {
    const chip = document.createElement("button");
    chip.id = "roleChip"; chip.className = "role-chip"; chip.title = "Change workspace (Contractor / Engineer)";
    chip.addEventListener("click", () => chooseRole());
    tabs.after(chip);
  }
  applyRole();
  if (!role()) chooseRole(true);
}
