import {
  idb, uid, DEFAULT_SETTINGS, newProject, num, round, itemQty, itemAmount, sectionTotal, computeAbstract,
  money, qtyFmt, setSettingsRef, esc, measurementQty, amountInWords,
} from "./store.js";
import { readRateFile, detectMapping, rowsToItems, linesToItems, makeItem, summarise } from "./bsr-import.js";
import { configureAI, hasKey, testKey, providerLabel, takeoffFromDrawings, extractRatesFromText, extractRatesFromImages } from "./ai.js";
import { prepareDrawing, pdfDocToImages } from "./blueprint.js";
import { Index, unitFactor, canonUnit } from "./match.js";
import { QUICK_FIELDS, quickTakeoff } from "./quick.js";
import { exportXlsx, exportCsv, printProject, download } from "./export.js";
import { SAMPLE_BSR } from "./sample.js";
import { readNicBoq, writeNicBoq, nicNumbering } from "./nicboq.js";
import { initBills, renderBills } from "./bills.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  settings: { ...DEFAULT_SETTINGS },
  bsrs: [],
  projects: [],
  projectId: null,
  index: null,
  drawings: [], // { id, file, status, parts, warning, error, dxf }
  itemById: new Map(),
  tf: null, // review filters
  boqSel: new Set(),
  nicTemplates: [],
  tender: null, // e-tender export options
};
const project = () => state.projects.find((p) => p.id === state.projectId);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  const [bsrs, projects, kv] = await Promise.all([idb.all("bsrs"), idb.all("projects"), idb.all("kv")]);
  const saved = kv.find((k) => k.id === "settings");
  if (saved) state.settings = { ...DEFAULT_SETTINGS, ...saved };
  setSettingsRef(state.settings);
  state.bsrs = bsrs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.projects = projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!state.projects.length) {
    const p = newProject("My first estimate");
    state.projects.push(p);
    await idb.put("projects", p);
  }
  state.projectId = (kv.find((k) => k.id === "current")?.value) || state.projects[0].id;
  if (!project()) state.projectId = state.projects[0].id;

  // Keys from before OpenAI support was added belong to Claude.
  const legacy = localStorage.getItem("boq.apiKey");
  if (legacy) { localStorage.setItem("boq.apiKey.anthropic", legacy); localStorage.removeItem("boq.apiKey"); }
  applyProvider();

  await loadNicTemplates();
  rebuildIndex();
  bindGlobal();
  bindTender();
  initBills({
    project, saveProject, toast, modal, closeModal, download,
    searchItems: (q) => state.index.search(q, () => true, 200),
    findItem: (id) => state.itemById.get(id),
    rateOf: (it) => indexedRate(bsrById(it._bsr), it),
  });
  renderAll();
  resetHistory();
}

function renderAll() {
  renderProjectSelect();
  renderBsrList();
  renderPick();
  renderQuickForm();
  renderBoq();
  renderTakeoff();
  renderTender();
  renderSettings();
  renderKeyHint();
}

const saveSettings = () => idb.put("kv", { ...state.settings, id: "settings" });
const saveBsr = (b) => idb.put("bsrs", b);
let saveTimer = null;
// ---------- undo / redo (whole-project snapshots, bursts of edits coalesced) ----------
const hist = { undo: [], redo: [], last: null, lastAt: 0 };
const snap = (p) => JSON.stringify({ ...p, updatedAt: 0 });
function resetHistory() { hist.undo = []; hist.redo = []; hist.last = project() ? snap(project()) : null; hist.lastAt = 0; updateUndoButtons(); }
/** coalesce: merge with the previous step when it was less than 0.8 s ago (used while typing numbers). */
function recordHistory(coalesce = false) {
  const cur = snap(project());
  if (cur === hist.last) return;
  const now = Date.now();
  if (!coalesce || now - hist.lastAt > 800 || !hist.undo.length) { hist.undo.push(hist.last); if (hist.undo.length > 60) hist.undo.shift(); }
  hist.lastAt = now; hist.last = cur; hist.redo = [];
  updateUndoButtons();
}
function restoreProject(json) {
  const p = JSON.parse(json);
  p.updatedAt = Date.now();
  state.projects[state.projects.findIndex((x) => x.id === p.id)] = p;
  hist.last = json; hist.lastAt = 0;
  idb.put("projects", p);
  state.boqSel.clear();
  renderProjectSelect(); renderBoq(); renderTakeoff(); renderSectionOptions(); updateUndoButtons();
}
function undo() {
  if (!hist.undo.length) { toast("Nothing to undo."); return; }
  hist.redo.push(hist.last);
  restoreProject(hist.undo.pop());
  toast("Undone.", 2000);
}
function redo() {
  if (!hist.redo.length) { toast("Nothing to redo."); return; }
  hist.undo.push(hist.last);
  restoreProject(hist.redo.pop());
  toast("Redone.", 2000);
}
function updateUndoButtons() {
  $$("[data-undo]").forEach((b) => (b.disabled = !hist.undo.length));
  $$("[data-redo]").forEach((b) => (b.disabled = !hist.redo.length));
}

function saveProject(coalesce = false) {
  const p = project();
  if (!p) return;
  recordHistory(coalesce);
  queueMicrotask(updateBadges);
  p.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => idb.put("projects", p), 300);
}

function toast(msg, ms = 3200, action = null) {
  const t = $("#toast");
  t.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-btn"; b.textContent = action.label;
    b.onclick = () => { t.classList.add("hidden"); action.fn(); };
    t.append(" ", b);
  }
  t.classList.remove("hidden");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add("hidden"), ms);
}

function modal(html, onMount) {
  $("#modalBody").innerHTML = html;
  $("#modal").classList.remove("hidden");
  onMount && onMount($("#modalBody"));
}
const closeModal = () => $("#modal").classList.add("hidden");

function rebuildIndex() {
  const items = [];
  state.itemById = new Map();
  for (const b of state.bsrs) {
    for (const it of b.items) { it._bsr = b.id; state.itemById.set(it.id, it); }
    if (b.enabled !== false) items.push(...b.items);
  }
  state.index = new Index(items);
}
const bsrById = (id) => state.bsrs.find((b) => b.id === id);
const rateBookName = (it) => (it.bsrId ? bsrById(it.bsrId)?.name || it.bsrName || "" : "Non-schedule item");
const indexedRate = (bsr, it) => round(num(it.rate) * (1 + num(bsr?.costIndex) / 100), 2);

// ---------------------------------------------------------------------------
// Global bindings
// ---------------------------------------------------------------------------

function bindGlobal() {
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $(".modal-close").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    const k = e.key.toLowerCase();
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && !inField && (k === "z" || k === "y")) {
      e.preventDefault();
      if (k === "y" || e.shiftKey) redo(); else undo();
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("#boqUndo")) undo();
    if (e.target.closest("#boqRedo")) redo();
  });

  // Project switching
  $("#projectSelect").addEventListener("change", (e) => switchProject(e.target.value));
  $("#newProjectBtn").addEventListener("click", async () => {
    const name = prompt("Name of the new project / work:", "New estimate");
    if (!name) return;
    const p = newProject(name);
    state.projects.unshift(p);
    await idb.put("projects", p);
    switchProject(p.id);
    showTab("boq");
  });

  // Rate books
  setupDrop($("#bsrDrop"), $("#bsrFile"), (files) => importRateFiles(files));
  $("#pasteBsrBtn").addEventListener("click", pasteRates);
  $("#manualBsrBtn").addEventListener("click", async () => {
    const b = newBsr("My rate book");
    b.items.push(makeItem("1", "New item", "sqm", 0));
    await addBsr(b);
    openBsrEditor(b.id);
  });
  $("#sampleBsrBtn").addEventListener("click", async () => {
    const b = newBsr(SAMPLE_BSR.name, { region: SAMPLE_BSR.region, year: SAMPLE_BSR.year, source: "sample" });
    b.items = SAMPLE_BSR.items.map(([ch, code, d, u, r]) => makeItem(code, d, u, r, ch));
    await addBsr(b);
    toast(`Loaded ${b.items.length} sample items. These rates are for demonstration only.`);
  });

  // Pick
  let pickT;
  $("#pickSearch").addEventListener("input", () => { clearTimeout(pickT); pickT = setTimeout(renderPickRows, 150); });
  $("#pickBsr").addEventListener("change", () => { renderChapterOptions(); renderPickRows(); });
  $("#pickChapter").addEventListener("change", renderPickRows);
  $("#pickTable").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    const tr = btn.closest("tr");
    const qty = num($("input", tr).value);
    addFromRateBook(btn.dataset.bsr, btn.dataset.add, qty, $("#pickSection").value);
    btn.textContent = "Added ✓";
    btn.classList.add("done");
  });

  // Takeoff
  setupDrop($("#bpDrop"), $("#bpFile"), addDrawings);
  $("#bpRunBtn").addEventListener("click", runAiTakeoff);
  $$(".subtabs button").forEach((b) => b.addEventListener("click", () => {
    $$(".subtabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".sub").forEach((s) => s.classList.toggle("active", s.id === "sub-" + b.dataset.sub));
  }));
  $("#quickRunBtn").addEventListener("click", runQuickTakeoff);

  // BOQ
  $("#addSectionBtn").addEventListener("click", () => {
    const name = prompt("Section name (e.g. Earthwork, Concrete, Masonry):");
    if (!name) return;
    project().sections.push({ id: uid("s"), name, items: [] });
    saveProject(); renderBoq(); renderSectionOptions();
  });
  $("#addCustomItemBtn").addEventListener("click", () => {
    const p = project();
    const sec = p.sections.at(-1) || (p.sections.push({ id: uid("s"), name: "General", items: [] }), p.sections[0]);
    sec.items.push({ id: uid("b"), bsrId: "", code: "NS", description: "Non-schedule item: describe the work", unit: "nos", qty: 1, rate: 0, measurements: [] });
    saveProject(); renderBoq();
  });
  $("#reapplyRatesBtn").addEventListener("click", reapplyRates);
  $("#addChargeBtn").addEventListener("click", () => {
    project().charges.push({ id: uid("c"), label: "Add-on", percent: 0, on: "works" });
    saveProject(); renderCharges(); renderAbstract();
  });
  $("#exportXlsxBtn").addEventListener("click", () => { if (guardEmpty()) { exportXlsx(project(), $("#exportFormat").value, rateBookName); project().exportedAt = Date.now(); saveProject(); } });
  $("#exportPdfBtn").addEventListener("click", () => guardEmpty() && printProject(project(), $("#exportFormat").value, rateBookName));
  $("#exportCsvBtn").addEventListener("click", () => guardEmpty() && exportCsv(project()));
  $("#exportJsonBtn").addEventListener("click", () => {
    const p = project();
    const used = new Set(p.sections.flatMap((s) => s.items.map((i) => i.bsrId)).filter(Boolean));
    const payload = { app: "ratebook-boq", version: 1, project: p, bsrs: state.bsrs.filter((b) => used.has(b.id)) };
    download(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }), `${p.name.replace(/[^\w-]+/g, "_")}.boq.json`);
  });
  $("#importNic").addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; importNicFiles(files); });
  $("#importJson").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.project) throw new Error("Not a project file");
      for (const b of data.bsrs || []) if (!bsrById(b.id)) { state.bsrs.push(b); await saveBsr(b); }
      const p = { ...data.project, id: uid("p"), updatedAt: Date.now() };
      state.projects.unshift(p);
      await idb.put("projects", p);
      rebuildIndex(); switchProject(p.id); renderBsrList();
      toast(`Opened "${p.name}".`);
    } catch (err) { toast("Could not open that file: " + err.message); }
  });

  // Settings
  $("#providerSel").addEventListener("change", (e) => { state.settings.provider = e.target.value; saveSettings(); applyProvider(); $("#keyStatus").textContent = ""; });
  $("#apiKey").addEventListener("change", storeKey);
  $("#rememberKey").addEventListener("change", storeKey);
  $("#modelSel").addEventListener("change", (e) => {
    if (state.settings.provider === "openai") state.settings.openaiModel = e.target.value; else state.settings.model = e.target.value;
    configureAI({ model: e.target.value }); saveSettings();
  });
  $("#testKeyBtn").addEventListener("click", async () => {
    storeKey();
    const s = $("#keyStatus");
    s.textContent = "Checking…"; s.className = "status";
    try {
      const models = await testKey();
      if (models) {
        if (!models.length) throw new Error("This key works but has no GPT chat models available.");
        if (!models.includes(state.settings.openaiModel)) state.settings.openaiModel = models[0];
        state.settings.openaiModels = models;
        saveSettings(); applyProvider();
        s.textContent = `Key works ✓ · ${models.length} models · using ${state.settings.openaiModel}`;
      } else s.textContent = "Key works ✓";
      s.className = "status ok";
    } catch (e) { s.textContent = e.message; s.className = "status err"; }
  });
  $("#backupAllBtn").addEventListener("click", () => {
    const payload = { app: "ratebook-boq", version: 1, backup: true, settings: state.settings, bsrs: state.bsrs, projects: state.projects };
    download(new Blob([JSON.stringify(payload)], { type: "application/json" }), `ratebook-boq-backup-${new Date().toISOString().slice(0, 10)}.json`);
  });
  $("#restoreAll").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.backup) throw new Error("Not a backup file");
      if (!confirm("Restoring adds the rate books and projects from the backup to this browser. Continue?")) return;
      for (const b of data.bsrs || []) { if (!bsrById(b.id)) state.bsrs.push(b); await saveBsr(b); }
      for (const p of data.projects || []) { if (!state.projects.find((x) => x.id === p.id)) state.projects.push(p); await idb.put("projects", p); }
      rebuildIndex(); renderAll(); toast("Backup restored.");
    } catch (err) { toast("Could not restore: " + err.message); }
  });
  $("#wipeBtn").addEventListener("click", async () => {
    if (!confirm("Delete ALL rate books and projects stored in this browser? This cannot be undone.")) return;
    await Promise.all(["bsrs", "projects", "kv"].map((s) => idb.clear(s)));
    for (const k of ["boq.apiKey", "boq.apiKey.anthropic", "boq.apiKey.openai"]) { localStorage.removeItem(k); sessionStorage.removeItem(k); }
    location.reload();
  });
}

const CLAUDE_MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (recommended)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (faster, cheaper)"],
  ["claude-fable-5-1", "Claude Fable 5.1 (most capable, costliest)"],
];

/** Show the key and model of the selected provider and hand them to the AI module. */
function applyProvider() {
  const s = state.settings;
  const prov = s.provider === "openai" ? "openai" : "anthropic";
  const slot = "boq.apiKey." + prov;
  const key = localStorage.getItem(slot) || sessionStorage.getItem(slot) || "";
  $("#providerSel").value = prov;
  $("#apiKey").value = key;
  $("#rememberKey").checked = !!localStorage.getItem(slot);
  if (prov === "openai") {
    $("#keyLabel").textContent = "OpenAI API key";
    $("#apiKey").placeholder = "sk-...";
    $("#keyWhere").innerHTML = `Create one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>, then press "Test key" to load the models your key can use.`;
    const list = s.openaiModels?.length ? s.openaiModels : s.openaiModel ? [s.openaiModel] : [];
    $("#modelSel").innerHTML = list.length
      ? list.map((m) => `<option value="${esc(m)}" ${m === s.openaiModel ? "selected" : ""}>${esc(m)}</option>`).join("")
      : `<option value="">Press "Test key" to load models</option>`;
  } else {
    $("#keyLabel").textContent = "Claude API key";
    $("#apiKey").placeholder = "sk-ant-...";
    $("#keyWhere").innerHTML = `Create one at <a href="https://platform.claude.com/" target="_blank" rel="noopener">platform.claude.com</a>.`;
    $("#modelSel").innerHTML = CLAUDE_MODELS.map(([v, l]) => `<option value="${v}" ${v === s.model ? "selected" : ""}>${l}</option>`).join("");
  }
  configureAI({ provider: prov, apiKey: key, model: prov === "openai" ? s.openaiModel || "" : s.model });
  renderKeyHint();
}

function storeKey() {
  const slot = "boq.apiKey." + (state.settings.provider === "openai" ? "openai" : "anthropic");
  const key = $("#apiKey").value.trim();
  localStorage.removeItem(slot); sessionStorage.removeItem(slot);
  if (key) ($("#rememberKey").checked ? localStorage : sessionStorage).setItem(slot, key);
  configureAI({ apiKey: key });
  renderKeyHint();
}

function renderKeyHint() {
  $("#bpKeyHint").innerHTML = hasKey()
    ? `Drawings are sent to the ${state.settings.provider === "openai" ? "OpenAI" : "Anthropic Claude"} API using your key. Large sets can take a few minutes.`
    : `Reading drawings needs a Claude or OpenAI API key. <a href="#" data-goto="settings">Add one in Settings</a>, or use the quick takeoff on the right.`;
  const a = $("#bpKeyHint [data-goto]");
  if (a) a.addEventListener("click", (e) => { e.preventDefault(); showTab("settings"); });
}

function showTab(name) {
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  if (name === "pick") renderPick();
  if (name === "boq") renderBoq();
  if (name === "tender") renderTender();
  if (name === "bills") renderBills();
  window.scrollTo({ top: 0 });
}

function setupDrop(label, input, onFiles) {
  input.addEventListener("change", () => { onFiles([...input.files]); input.value = ""; });
  label.addEventListener("dragover", (e) => { e.preventDefault(); label.classList.add("over"); });
  label.addEventListener("dragleave", () => label.classList.remove("over"));
  label.addEventListener("drop", (e) => { e.preventDefault(); label.classList.remove("over"); onFiles([...e.dataTransfer.files]); });
}

function guardEmpty() {
  if (project().sections.some((s) => s.items.length)) return true;
  toast("The BOQ is empty. Add items from a rate book or a drawing takeoff first.");
  return false;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function renderProjectSelect() {
  $("#projectSelect").innerHTML = state.projects.map((p) => `<option value="${p.id}" ${p.id === state.projectId ? "selected" : ""}>${esc(p.name)}</option>`).join("");
}
function switchProject(id) {
  state.projectId = id;
  idb.put("kv", { id: "current", value: id });
  state.boqSel.clear(); state.tf = null; if (state.tender) state.tender.scope = "all";
  renderProjectSelect(); renderBoq(); renderSectionOptions(); renderTakeoff(); renderBills();
  resetHistory();
}

// ---------------------------------------------------------------------------
// Rate books
// ---------------------------------------------------------------------------

function newBsr(name, extra = {}) {
  return { id: uid("r"), name, region: "", year: "", costIndex: 0, enabled: true, items: [], createdAt: Date.now(), ...extra };
}
async function addBsr(b) {
  state.bsrs.push(b);
  await saveBsr(b);
  rebuildIndex(); renderBsrList(); renderPick();
}

function renderBsrList() {
  updateBadges();
  const el = $("#bsrList");
  if (!state.bsrs.length) {
    el.innerHTML = `<p class="muted">No rate books yet. Upload your BSR / SOR, paste rows, or load the sample to try the tool.</p>`;
    return;
  }
  el.innerHTML = state.bsrs.map((b) => `
    <div class="bsr-card ${b.enabled === false ? "off" : ""}" data-id="${b.id}">
      <div class="bsr-main">
        <strong>${esc(b.name)}</strong>
        <span class="muted small">${b.items.length} items${b.region ? " · " + esc(b.region) : ""}${b.year ? " · " + esc(b.year) : ""}${b.source === "sample" ? " · demo rates" : ""}</span>
      </div>
      <label class="inline small" title="Cost index / area premium applied on top of the book rates">Cost index
        <input type="number" step="0.01" class="w70" data-act="index" value="${num(b.costIndex)}">%</label>
      <label class="check small"><input type="checkbox" data-act="enable" ${b.enabled === false ? "" : "checked"}> use</label>
      <div class="row gap">
        <button class="ghost small" data-act="edit">View / edit</button>
        <button class="ghost small" data-act="export">Excel</button>
        <button class="ghost small danger-text" data-act="delete">Delete</button>
      </div>
    </div>`).join("");
  el.onclick = async (e) => {
    const card = e.target.closest(".bsr-card"); if (!card) return;
    const b = bsrById(card.dataset.id);
    const act = e.target.dataset.act;
    if (act === "edit") openBsrEditor(b.id);
    if (act === "export") {
      const rows = [["Chapter", "Code", "Description", "Unit", "Rate"], ...b.items.map((i) => [i.chapter, i.code, i.description, i.unit, i.rate])];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 90 }, { wch: 8 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, "Rates");
      XLSX.writeFile(wb, `${b.name.replace(/[^\w-]+/g, "_")}.xlsx`);
    }
    if (act === "delete" && confirm(`Delete rate book "${b.name}"? Items already in a BOQ keep their rates.`)) {
      state.bsrs = state.bsrs.filter((x) => x.id !== b.id);
      await idb.del("bsrs", b.id);
      rebuildIndex(); renderBsrList(); renderPick();
      $("#bsrEditor").classList.add("hidden");
    }
  };
  el.onchange = async (e) => {
    const card = e.target.closest(".bsr-card"); if (!card) return;
    const b = bsrById(card.dataset.id);
    if (e.target.dataset.act === "index") b.costIndex = num(e.target.value);
    if (e.target.dataset.act === "enable") { b.enabled = e.target.checked; card.classList.toggle("off", !b.enabled); rebuildIndex(); renderPick(); }
    await saveBsr(b);
  };
}

const status = (html, cls = "") => { const s = $("#importStatus"); s.innerHTML = html; s.className = "status " + cls; };

async function importRateFiles(files) {
  for (const file of files) {
    status(`Reading ${esc(file.name)}…`);
    try {
      const content = await readRateFile(file, (m) => status(`${esc(file.name)}: ${esc(m)}`));
      const baseName = file.name.replace(/\.[^.]+$/, "");
      if (content.kind === "items") {
        const b = newBsr(baseName, { source: file.name });
        b.items = content.items.map((i) => makeItem(i.code, i.description, i.unit, i.rate, i.chapter));
        await addBsr(b);
        status(`Imported ${b.items.length} items from ${esc(file.name)}.`, "ok");
      } else if (content.kind === "table") {
        status("");
        openTableWizard(baseName, content.sheets, file.name);
      } else {
        status("");
        openLinesWizard(baseName, content, file);
      }
    } catch (e) {
      console.error(e);
      status(`${esc(file.name)}: ${esc(e.message || e)}`, "err");
    }
  }
}

function pasteRates() {
  modal(`<h2>Paste rate rows</h2>
    <p class="muted">Copy the rows from Excel, Google Sheets or a web page (code, description, unit, rate in any order) and paste below.</p>
    <textarea id="pasteArea" rows="14" class="mono" placeholder="1.1\tEarthwork in excavation...\tcum\t285.50"></textarea>
    <div class="row gap mt"><button class="primary" id="pasteGo">Continue</button></div>`, (m) => {
    $("#pasteGo", m).onclick = () => {
      const text = $("#pasteArea", m).value;
      if (!text.trim()) return;
      const delim = text.includes("\t") ? "\t" : text.includes("|") ? "|" : ",";
      const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(delim).map((c) => c.trim()));
      closeModal();
      openTableWizard("Pasted rates", [{ name: "Pasted", rows }], "paste");
    };
  });
}

function wizardMeta(name) {
  return `<div class="form-grid compact">
    <label class="field">Rate book name<input id="wzName" value="${esc(name)}"></label>
    <label class="field">Region / department<input id="wzRegion" placeholder="e.g. PWD Maharashtra"></label>
    <label class="field">Year / edition<input id="wzYear" placeholder="e.g. 2025-26"></label>
    <label class="field">Cost index %<input id="wzIndex" type="number" step="0.01" value="0"></label>
  </div>`;
}
const wizardMetaValues = () => ({ name: $("#wzName").value.trim() || "Rate book", region: $("#wzRegion").value.trim(), year: $("#wzYear").value.trim(), costIndex: num($("#wzIndex").value) });

function previewTable(items, limit = 12) {
  const s = summarise(items);
  return `<p class="small"><b>${s.count}</b> priced items found${s.chapters ? `, ${s.chapters} chapters` : ""}${s.noUnit ? `, <span class="warn">${s.noUnit} without a unit</span>` : ""}.</p>
  <div class="table-wrap"><table class="data small"><thead><tr><th>Chapter</th><th>Code</th><th>Description</th><th>Unit</th><th class="num">Rate</th></tr></thead><tbody>
  ${items.slice(0, limit).map((i) => `<tr><td>${esc(i.chapter.slice(0, 30))}</td><td>${esc(i.code)}</td><td>${esc(i.description.slice(0, 220))}${i.description.length > 220 ? "…" : ""}</td><td>${esc(i.unit)}</td><td class="num">${i.rate.toFixed(2)}</td></tr>`).join("")}
  ${items.length > limit ? `<tr><td colspan="5" class="muted">… and ${items.length - limit} more</td></tr>` : ""}
  </tbody></table></div>`;
}

function openTableWizard(name, sheets, source) {
  const w = $("#importWizard");
  w.classList.remove("hidden");
  const maps = sheets.map((s) => detectMapping(s.rows));
  let active = 0;
  const selected = new Set(sheets.map((_, i) => i).filter((i) => maps[i].cols.rate != null));
  if (!selected.size) selected.add(0);

  const colOptions = (rows, val) => {
    const width = Math.max(...rows.slice(0, 60).map((r) => r.length), 1);
    const head = maps[active].headerRow >= 0 ? rows[maps[active].headerRow] : [];
    return `<option value="">(none)</option>` + Array.from({ length: width }, (_, i) =>
      `<option value="${i}" ${val === i ? "selected" : ""}>Column ${XLSX.utils.encode_col(i)}${head[i] ? ` – ${esc(String(head[i]).slice(0, 24))}` : ""}</option>`).join("");
  };

  const allItems = () => [...selected].sort().flatMap((i) => rowsToItems(sheets[i].rows, maps[i], sheets.length > 1 ? sheets[i].name : ""));

  const render = () => {
    const s = sheets[active], m = maps[active];
    w.innerHTML = `<div class="row between"><h2>Import: ${esc(name)}</h2><button class="ghost" id="wzCancel">Cancel</button></div>
      ${wizardMeta(name)}
      ${sheets.length > 1 ? `<div class="sheet-tabs">${sheets.map((sh, i) => `<label class="chip ${i === active ? "active" : ""}"><input type="checkbox" data-sheet="${i}" ${selected.has(i) ? "checked" : ""}> <span data-show="${i}">${esc(sh.name)}</span></label>`).join("")}</div><p class="muted small">Tick the sheets to import; click a name to adjust its columns.</p>` : ""}
      <div class="form-grid compact mapping">
        <label class="field">Header row<input type="number" min="0" id="wzHeader" value="${m.headerRow + 1}"></label>
        ${["code", "description", "unit", "rate"].map((k) => `<label class="field">${k[0].toUpperCase() + k.slice(1)} column<select data-col="${k}">${colOptions(s.rows, m.cols[k])}</select></label>`).join("")}
      </div>
      <details><summary class="small">Raw rows of "${esc(s.name)}"</summary><div class="table-wrap"><table class="data small raw">${s.rows.slice(0, 25).map((r, ri) => `<tr><th>${ri + 1}</th>${r.map((c) => `<td>${esc(String(c).slice(0, 60))}</td>`).join("")}</tr>`).join("")}</table></div></details>
      <div id="wzPreview"></div>
      <div class="row gap mt"><button class="primary" id="wzImport">Import rate book</button></div>`;
    $("#wzPreview").innerHTML = previewTable(allItems());
    $("#wzCancel").onclick = () => w.classList.add("hidden");
    $("#wzHeader").onchange = (e) => { m.headerRow = Math.max(0, num(e.target.value)) - 1; render(); };
    $$("[data-col]", w).forEach((sel) => sel.onchange = () => { m.cols[sel.dataset.col] = sel.value === "" ? undefined : Number(sel.value); render(); });
    $$("[data-sheet]", w).forEach((cb) => cb.onchange = () => { cb.checked ? selected.add(+cb.dataset.sheet) : selected.delete(+cb.dataset.sheet); $("#wzPreview").innerHTML = previewTable(allItems()); });
    $$("[data-show]", w).forEach((sp) => sp.onclick = (e) => { e.preventDefault(); active = +sp.dataset.show; render(); });
    $("#wzImport").onclick = async () => {
      const items = allItems();
      if (!items.length) { toast("No priced items found. Check the column mapping."); return; }
      const b = newBsr("", { ...wizardMetaValues(), source });
      b.items = items;
      await addBsr(b);
      w.classList.add("hidden");
      status(`Imported ${items.length} items into "${esc(b.name)}".`, "ok");
    };
  };
  render();
  w.scrollIntoView({ behavior: "smooth" });
}

function openLinesWizard(name, content, file) {
  const w = $("#importWizard");
  w.classList.remove("hidden");
  let items = content.hasText ? linesToItems(content.lines) : [];
  const isPdf = !!content.pdf;
  const render = (msg = "") => {
    w.innerHTML = `<div class="row between"><h2>Import: ${esc(name)}</h2><button class="ghost" id="wzCancel">Cancel</button></div>
      ${wizardMeta(name)}
      ${content.hasText
        ? `<p class="muted small">Read ${content.pages} page(s) of text. Check the preview. If descriptions or rates look wrong, let the AI read the document instead.</p>`
        : `<p class="warn">This looks like a scanned PDF with no text layer. The AI can read the page images (needs a Claude or OpenAI key in Settings).</p>`}
      <div id="wzPreview">${items.length ? previewTable(items) : `<p class="muted">No items recognised yet.</p>`}</div>
      <div class="row gap mt wrap">
        ${items.length ? `<button class="primary" id="wzImport">Import ${items.length} items</button>` : ""}
        <button class="${items.length ? "ghost" : "primary"}" id="wzAi">Extract with ${providerLabel()}${hasKey() ? "" : " (add key in Settings)"}</button>
        ${isPdf ? `<label class="inline small">Pages <input id="wzFrom" type="number" min="1" value="1" class="w70"> to <input id="wzTo" type="number" min="1" value="${content.pages}" class="w70"></label>` : ""}
        <span class="status" id="wzStatus">${msg}</span>
      </div>`;
    $("#wzCancel").onclick = () => w.classList.add("hidden");
    if ($("#wzImport")) $("#wzImport").onclick = async () => {
      const b = newBsr("", { ...wizardMetaValues(), source: file.name });
      b.items = items;
      await addBsr(b);
      w.classList.add("hidden");
      status(`Imported ${items.length} items into "${esc(b.name)}".`, "ok");
    };
    $("#wzAi").onclick = async () => {
      if (!hasKey()) { showTab("settings"); return; }
      const meta = wizardMetaValues();
      const st = $("#wzStatus");
      $("#wzAi").disabled = true;
      try {
        const from = isPdf ? Math.max(1, num($("#wzFrom").value)) : 1;
        const to = isPdf ? Math.min(content.pages, num($("#wzTo").value) || content.pages) : 1;
        const found = [];
        if (content.hasText) {
          // Chunk page text so each request stays well within output limits.
          const pages = content.pageTexts ? content.pageTexts.slice(from - 1, to) : [content.lines.join("\n")];
          const chunks = [];
          let cur = "";
          pages.forEach((t, i) => { const block = `\n--- page ${from + i} ---\n${t}`; if (cur.length + block.length > 30000 && cur) { chunks.push(cur); cur = ""; } cur += block; });
          if (cur) chunks.push(cur);
          for (let c = 0; c < chunks.length; c++) {
            st.textContent = `${providerLabel()} is reading part ${c + 1} of ${chunks.length}… (${found.length} items so far)`;
            const res = await extractRatesFromText(chunks[c]);
            found.push(...res);
          }
        } else {
          const per = 6;
          for (let p = from; p <= to; p += per) {
            const last = Math.min(to, p + per - 1);
            st.textContent = `${providerLabel()} is reading pages ${p}–${last} of ${to}… (${found.length} items so far)`;
            const imgs = await pdfDocToImages(content.pdf, p, last, 2, name);
            found.push(...(await extractRatesFromImages(imgs)));
          }
        }
        items = found.filter((i) => i.description && i.rate).map((i) => makeItem(i.code, i.description, i.unit, i.rate, i.chapter));
        render(`${providerLabel()} found ${items.length} items.`);
        $("#wzName").value = meta.name; $("#wzRegion").value = meta.region; $("#wzYear").value = meta.year; $("#wzIndex").value = meta.costIndex;
      } catch (e) {
        st.textContent = e.message; st.className = "status err";
        $("#wzAi").disabled = false;
      }
    };
  };
  render();
  w.scrollIntoView({ behavior: "smooth" });
}

function openBsrEditor(id) {
  const b = bsrById(id);
  const el = $("#bsrEditor");
  el.classList.remove("hidden");
  let filter = "", page = 0;
  const PAGE = 100;
  const render = () => {
    const list = b.items.filter((i) => !filter || `${i.code} ${i.description} ${i.chapter}`.toLowerCase().includes(filter));
    const slice = list.slice(page * PAGE, (page + 1) * PAGE);
    el.innerHTML = `<div class="row between wrap gap"><h2>${esc(b.name)}</h2><button class="ghost" id="edClose">Close</button></div>
      <div class="form-grid compact">
        <label class="field">Name<input data-meta="name" value="${esc(b.name)}"></label>
        <label class="field">Region / department<input data-meta="region" value="${esc(b.region || "")}"></label>
        <label class="field">Year / edition<input data-meta="year" value="${esc(b.year || "")}"></label>
      </div>
      <div class="row gap wrap mt"><input type="search" id="edSearch" placeholder="Filter items" value="${esc(filter)}"><button class="ghost" id="edAdd">＋ Item</button>
      <span class="muted small">${list.length} items${list.length > PAGE ? ` · page ${page + 1} of ${Math.ceil(list.length / PAGE)}` : ""}</span>
      ${list.length > PAGE ? `<button class="ghost small" id="edPrev" ${page ? "" : "disabled"}>‹</button><button class="ghost small" id="edNext" ${(page + 1) * PAGE < list.length ? "" : "disabled"}>›</button>` : ""}</div>
      <div class="table-wrap tall"><table class="data edit"><thead><tr><th>Chapter</th><th>Code</th><th>Description</th><th>Unit</th><th class="num">Rate</th><th></th></tr></thead><tbody>
      ${slice.map((i) => `<tr data-id="${i.id}"><td><input data-f="chapter" value="${esc(i.chapter)}"></td><td><input data-f="code" class="w80" value="${esc(i.code)}"></td><td><textarea data-f="description" rows="2">${esc(i.description)}</textarea></td><td><input data-f="unit" class="w70" value="${esc(i.unit)}"></td><td><input data-f="rate" type="number" step="0.01" class="w100 num" value="${i.rate}"></td><td><button class="icon danger-text" data-del title="Delete">×</button></td></tr>`).join("")}
      </tbody></table></div>`;
    $("#edClose").onclick = () => el.classList.add("hidden");
    $("#edSearch").oninput = (e) => { filter = e.target.value.toLowerCase(); page = 0; const pos = e.target.selectionStart; render(); const s = $("#edSearch"); s.focus(); s.setSelectionRange(pos, pos); };
    $("#edAdd").onclick = () => { b.items.unshift(makeItem("", "New item", "", 0, "")); filter = ""; page = 0; saveBsr(b); rebuildIndex(); render(); };
    if ($("#edPrev")) { $("#edPrev").onclick = () => { page--; render(); }; $("#edNext").onclick = () => { page++; render(); }; }
    $$("[data-meta]", el).forEach((inp) => inp.onchange = () => { b[inp.dataset.meta] = inp.value; saveBsr(b); renderBsrList(); });
    $("tbody", el).onchange = (e) => {
      const tr = e.target.closest("tr"); const it = b.items.find((x) => x.id === tr.dataset.id);
      const f = e.target.dataset.f; if (!f) return;
      it[f] = f === "rate" ? num(e.target.value) : e.target.value;
      saveBsr(b); rebuildIndex();
    };
    $("tbody", el).onclick = (e) => {
      if (!e.target.matches("[data-del]")) return;
      const tr = e.target.closest("tr");
      b.items = b.items.filter((x) => x.id !== tr.dataset.id);
      saveBsr(b); rebuildIndex(); render(); renderBsrList();
    };
  };
  render();
  el.scrollIntoView({ behavior: "smooth" });
}

// ---------------------------------------------------------------------------
// Pick items
// ---------------------------------------------------------------------------

function renderPick() {
  const sel = $("#pickBsr");
  const cur = sel.value;
  sel.innerHTML = `<option value="">All rate books</option>` + state.bsrs.filter((b) => b.enabled !== false).map((b) => `<option value="${b.id}" ${b.id === cur ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  renderChapterOptions();
  renderSectionOptions();
  renderPickRows();
}
function renderChapterOptions() {
  const bid = $("#pickBsr").value;
  const chapters = [...new Set(state.bsrs.filter((b) => b.enabled !== false && (!bid || b.id === bid)).flatMap((b) => b.items.map((i) => i.chapter)).filter(Boolean))];
  const cur = $("#pickChapter").value;
  $("#pickChapter").innerHTML = `<option value="">All chapters</option>` + chapters.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
}
function renderSectionOptions() {
  const p = project(); if (!p) return;
  const cur = $("#pickSection").value;
  $("#pickSection").innerHTML = `<option value="__auto">Add to section: by chapter</option>` + p.sections.map((s) => `<option value="${s.id}" ${s.id === cur ? "selected" : ""}>Add to: ${esc(s.name)}</option>`).join("");
}
function renderPickRows() {
  const tbody = $("#pickTable tbody");
  if (!state.bsrs.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="muted pad">Add a rate book first (tab 1).</td></tr>`;
    $("#pickCount").textContent = "";
    return;
  }
  const bid = $("#pickBsr").value, ch = $("#pickChapter").value;
  const inBoq = new Set(project().sections.flatMap((s) => s.items.map((i) => i.bsrItemId)));
  const results = state.index.search($("#pickSearch").value, (it) => (!bid || it._bsr === bid) && (!ch || it.chapter === ch), 400);
  $("#pickCount").textContent = `${results.length >= 400 ? "Showing first 400" : results.length} matching items. Enter a quantity (optional) and press Add. You can enter detailed measurements later in the BOQ.`;
  tbody.innerHTML = results.map((it) => {
    const b = bsrById(it._bsr);
    const rate = indexedRate(b, it);
    return `<tr><td>${inBoq.has(it.id) ? "✓" : ""}</td><td class="small muted">${esc(b?.name || "")}</td><td>${esc(it.code)}</td>
      <td class="desc">${it.chapter ? `<span class="tag">${esc(it.chapter.slice(0, 40))}</span> ` : ""}${esc(it.description)}</td><td>${esc(it.unit)}</td>
      <td class="num">${money(rate, false)}${num(b?.costIndex) ? `<div class="small muted">book ${money(it.rate, false)}</div>` : ""}</td>
      <td><input type="number" step="any" class="w80 num" placeholder="0"></td>
      <td><button class="small" data-add="${it.id}" data-bsr="${it._bsr}">Add</button></td></tr>`;
  }).join("") || `<tr><td colspan="8" class="muted pad">No items match.</td></tr>`;
}

function ensureSection(name) {
  const p = project();
  let s = p.sections.find((x) => x.name.toLowerCase() === String(name || "General").toLowerCase());
  if (!s) {
    // Reuse an empty default "General" section for the first real section.
    const g = p.sections.length === 1 && !p.sections[0].items.length && p.sections[0].name === "General" ? p.sections[0] : null;
    if (g) { g.name = name || "General"; s = g; }
    else { s = { id: uid("s"), name: name || "General", items: [] }; p.sections.push(s); }
  }
  return s;
}

function addFromRateBook(bsrId, itemId, qty, sectionId, extra = {}) {
  const b = bsrById(bsrId);
  const it = b?.items.find((x) => x.id === itemId);
  if (!it) return;
  const p = project();
  const sec = sectionId && sectionId !== "__auto" ? p.sections.find((s) => s.id === sectionId) : ensureSection(extra.section || it.chapter || "General");
  sec.items.push({
    id: uid("b"), bsrId, bsrItemId: it.id, bsrName: b.name, code: it.code, description: it.description, unit: it.unit,
    baseRate: it.rate, rate: indexedRate(b, it), qty: qty || 0, measurements: extra.measurements || [], remarks: extra.remarks || "",
  });
  saveProject();
  renderSectionOptions();
}

// ---------------------------------------------------------------------------
// Drawing takeoff
// ---------------------------------------------------------------------------

async function addDrawings(files) {
  for (const file of files) {
    const d = { id: uid("d"), file, status: "preparing", parts: [], warning: "", error: "" };
    state.drawings.push(d);
    renderDrawingChips();
    try {
      const res = await prepareDrawing(file, (m) => { d.status = m; renderDrawingChips(); });
      Object.assign(d, res, { status: "ready" });
      if (res.dxf) renderDxfPanel(res.dxf, file.name);
    } catch (e) {
      d.status = "error"; d.error = e.message || String(e);
    }
    renderDrawingChips();
  }
}

function renderDrawingChips() {
  const el = $("#bpFiles");
  el.innerHTML = state.drawings.map((d) => `<div class="file-chip ${d.status === "error" ? "err" : d.status === "ready" ? "ok" : ""}">
      <span>${esc(d.file.name)}</span>
      <small>${d.status === "ready" ? `${d.parts.length} part${d.parts.length > 1 ? "s" : ""} ready${d.dxf ? " · DXF measured" : ""}` : d.status === "error" ? "" : esc(d.status)}</small>
      ${d.warning ? `<small class="warn">${esc(d.warning)}</small>` : ""}${d.error ? `<small class="err">${esc(d.error)}</small>` : ""}
      <button class="icon" data-rm="${d.id}" title="Remove">×</button></div>`).join("");
  el.onclick = (e) => {
    const id = e.target.dataset.rm; if (!id) return;
    state.drawings = state.drawings.filter((d) => d.id !== id);
    renderDrawingChips();
  };
}

function renderQuickForm() {
  const saved = state.settings.quick || {};
  $("#quickForm").innerHTML = QUICK_FIELDS.map(([k, label, def]) => `<label class="field small">${esc(label)}<input id="q_${k}" type="number" step="any" value="${saved[k] ?? def}"></label>`).join("");
}

function renderDxfPanel(dxf, name) {
  const el = $("#dxfPanel");
  el.classList.remove("muted");
  const unitDefault = dxf.unitToM || 0.001;
  const modes = [["", "Ignore"], ["len", "Length → m"], ["lenH", "Length × height → sqm"], ["lenTH", "Length × thickness × height → cum"], ["area", "Closed area → sqm"], ["areaT", "Closed area × thickness → cum"], ["blocks", "Block count → nos"]];
  el.innerHTML = `<p class="small"><b>${esc(name)}</b> · ${dxf.layers.length} layers · ${dxf.texts.length} texts/dimensions</p>
    <label class="inline small">1 drawing unit =
      <select id="dxfUnit">${[[0.001, "1 mm"], [0.01, "1 cm"], [1, "1 m"], [0.0254, "1 inch"], [0.3048, "1 foot"]].map(([v, l]) => `<option value="${v}" ${v === unitDefault ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${dxf.unitToM ? "" : `<span class="warn">units not declared in file; check this</span>`}</label>
    <div class="table-wrap"><table class="data small" id="dxfTable"><thead><tr><th>Layer</th><th class="num">Length (m)</th><th class="num">Area (sqm)</th><th>Blocks</th><th>Take as</th><th>Height / thk (m)</th><th>Description</th></tr></thead><tbody></tbody></table></div>
    <button class="primary mt" id="dxfGo">Use these quantities</button>`;
  const fill = () => {
    const k = num($("#dxfUnit").value);
    $("#dxfTable tbody").innerHTML = dxf.layers.map((l, i) => {
      const blocks = Object.values(l.blocks).reduce((a, b) => a + b, 0);
      return `<tr data-i="${i}"><td>${esc(l.name)}</td><td class="num">${(l.length * k).toFixed(2)}</td><td class="num">${(l.area * k * k).toFixed(2)}</td><td>${blocks || ""}</td>
      <td><select data-mode>${modes.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></td>
      <td><input data-h type="number" step="any" class="w70" placeholder="3.0"> <input data-t type="number" step="any" class="w70" placeholder="0.23"></td>
      <td><input data-desc value="${esc(guessLayerDesc(l.name))}"></td></tr>`;
    }).join("");
  };
  fill();
  $("#dxfUnit").onchange = fill;
  $("#dxfGo").onclick = () => {
    const k = num($("#dxfUnit").value);
    const lines = [];
    $$("#dxfTable tbody tr").forEach((tr) => {
      const mode = $("[data-mode]", tr).value; if (!mode) return;
      const l = dxf.layers[+tr.dataset.i];
      const h = num($("[data-h]", tr).value) || 3, t = num($("[data-t]", tr).value) || 0.23;
      const len = l.length * k, area = l.area * k * k;
      const desc = $("[data-desc]", tr).value || l.name;
      const map = {
        len: ["m", [{ label: `Layer ${l.name}`, nos: 1, l: len, b: "", d: "" }]],
        lenH: ["sqm", [{ label: `Layer ${l.name}`, nos: 1, l: len, b: "", d: h }]],
        lenTH: ["cum", [{ label: `Layer ${l.name} (centre-line length; deduct openings)`, nos: 1, l: len, b: t, d: h }]],
        area: ["sqm", [{ label: `Layer ${l.name} closed areas`, nos: 1, l: area, b: "", d: "" }]],
        areaT: ["cum", [{ label: `Layer ${l.name} closed areas`, nos: 1, l: area, b: "", d: t }]],
        blocks: ["nos", Object.entries(l.blocks).map(([n, c]) => ({ label: `Block ${n}`, nos: c, l: "", b: "", d: "" }))],
      };
      const [unit, measurements] = map[mode];
      lines.push(toTakeoffLine({ section: "From DXF", description: desc, unit, measurements, notes: "Measured from DXF geometry", confidence: "medium" }));
    });
    if (!lines.length) { toast("Choose how to take at least one layer."); return; }
    applyTakeoff({ source: `DXF layer takeoff (${name})`, files: [name], summary: "", assumptions: ["Wall lengths from DXF are the sum of all drawn lines on the layer; for double-line walls halve the length."], questions: [], lines });
  };
}
function guessLayerDesc(n) {
  const s = n.toLowerCase();
  if (/wall/.test(s)) return "Brick masonry in cement mortar 1:6 in superstructure";
  if (/col/.test(s)) return "RCC M25 in columns";
  if (/beam/.test(s)) return "RCC M25 in beams";
  if (/slab/.test(s)) return "RCC M25 in slabs";
  if (/floor|tile/.test(s)) return "Vitrified tile flooring";
  if (/door/.test(s)) return "Flush door shutters";
  if (/win/.test(s)) return "Aluminium sliding windows";
  return n;
}

// ---------------------------------------------------------------------------
// Takeoff draft: review, keep/remove, edit and send to the BOQ.
// The draft lives on the project, so it survives reloads and is covered by undo.
// ---------------------------------------------------------------------------

const draft = () => project()?.draft || null;
const lineCands = (l) => (l.candIds || []).map((id) => state.itemById.get(id)).filter(Boolean);
const pickedItem = (l) => (l.pick ? state.itemById.get(l.pick) || null : null);
const isKept = (l) => l.status !== "removed";

/** Build a review line with local match candidates. aiPick: rate item chosen by the AI, if any. */
function toTakeoffLine(l, aiPick = null) {
  const qty = l.measurements?.length ? l.measurements.reduce((a, m) => a + measurementQty(m), 0) : num(l.qty);
  const cands = state.index.match(`${l.description} ${l.section}`, l.unit, 6).map((m) => m.item);
  if (aiPick) { const i = cands.indexOf(aiPick); if (i >= 0) cands.splice(i, 1); cands.unshift(aiPick); }
  const best = cands[0] || null;
  const compatible = best && (!l.unit || canonUnit(best.unit) === canonUnit(l.unit) || unitFactor(l.unit, best.unit) !== 1);
  return {
    id: uid("t"), status: "keep", added: false,
    section: l.section || "General", description: l.description || "", unit: l.unit || "", notes: l.notes || "", confidence: l.confidence || "medium",
    measurements: l.measurements || [], qty: round(qty, 3),
    candIds: cands.map((c) => c.id), pick: best && (aiPick || compatible) ? best.id : "",
    aiPicked: !!aiPick, autoPick: !aiPick, customRate: 0,
  };
}

/** Refresh match candidates after an edit; lines without a chosen item get the best one with a compatible unit. */
function rematch(l) {
  const found = state.index.match(`${l.description} ${l.section}`, l.unit, 6).map((m) => m.item);
  const cands = found.map((c) => c.id);
  if (l.pick && !cands.includes(l.pick)) cands.unshift(l.pick);
  l.candIds = cands;
  if ((!l.pick || l.autoPick) && !num(l.customRate)) {
    const ok = found.find((c) => !l.unit || canonUnit(c.unit) === canonUnit(l.unit) || unitFactor(l.unit, c.unit) !== 1);
    l.pick = ok ? ok.id : "";
    l.autoPick = true;
  }
}

function lineAmount(l) {
  const it = pickedItem(l);
  if (!it) return round(l.qty * num(l.customRate), 2);
  return round(l.qty * unitFactor(l.unit, it.unit) * indexedRate(bsrById(it._bsr), it), 2);
}

/** Reasons a line needs a second look. */
function lineIssues(l, all) {
  const out = [];
  const it = pickedItem(l);
  if (!it && !num(l.customRate)) out.push("No rate-book item or rate");
  if (it && canonUnit(it.unit) !== canonUnit(l.unit) && unitFactor(l.unit, it.unit) === 1) out.push(`Unit "${l.unit}" differs from rate-book unit "${it.unit}"`);
  if (!l.qty) out.push("Zero quantity");
  if (l.qty < 0) out.push("Negative quantity");
  if (l.confidence === "low") out.push("Low confidence");
  if (it) {
    const idx = all.indexOf(l);
    const dup = all.findIndex((o, i) => i < idx && isKept(o) && o.pick === l.pick);
    if (dup >= 0) out.push(`Same rate-book item as line ${dup + 1}`);
  }
  return out;
}

/** Put a new takeoff into the project's draft, asking whether to append when unfinished lines exist. */
async function applyTakeoff(next) {
  const cur = draft();
  const pending = cur?.lines?.filter((l) => isKept(l) && !l.added).length || 0;
  let mode = "replace";
  if (pending) {
    mode = await new Promise((resolve) => {
      modal(`<h2>You already have a draft</h2>
        <p>The current draft has <b>${pending}</b> kept line(s) not yet added to the BOQ. What should happen to the new ${next.lines.length} line(s)?</p>
        <div class="row gap wrap mt"><button class="primary" data-m="append">Add them to the current draft</button>
        <button class="ghost" data-m="replace">Replace the current draft</button><button class="ghost" data-m="cancel">Cancel</button></div>`, (m) => {
        m.onclick = (e) => { const v = e.target.dataset.m; if (v) { closeModal(); resolve(v); } };
      });
    });
  }
  if (mode === "cancel") return false;
  if (mode === "append") {
    cur.lines.push(...next.lines);
    cur.source = cur.source === next.source ? cur.source : "Combined takeoffs";
    cur.summary = [cur.summary, next.summary].filter(Boolean).join(" | ");
    cur.assumptions = [...(cur.assumptions || []), ...(next.assumptions || [])];
    cur.questions = [...(cur.questions || []), ...(next.questions || [])];
  } else {
    project().draft = { createdAt: Date.now(), ...next };
  }
  state.tf = { view: "all", conf: "", section: "", q: "" };
  saveProject();
  renderTakeoff(true);
  return true;
}

async function runAiTakeoff() {
  const st = $("#bpStatus");
  const ready = state.drawings.filter((d) => d.status === "ready");
  if (!ready.length) { toast("Upload at least one drawing first."); return; }
  if (!hasKey()) { toast("Add your Claude or OpenAI API key in Settings."); showTab("settings"); return; }
  const parts = ready.flatMap((d) => d.parts);
  const imgCount = parts.filter((p) => p.kind === "image").length;
  if (imgCount > 90) { toast(`That is ${imgCount} images; please send fewer drawings at a time (max about 90 images).`); return; }

  let rateList = null;
  const pool = state.index.items;
  if ($("#bpSendRates").checked && pool.length) {
    if (pool.length > 4000) toast(`Your rate books have ${pool.length} items; only the local matcher will be used to save cost.`, 5000);
    else rateList = pool.map((it, i) => ({ ref: "R" + i, code: it.code, description: it.description, unit: it.unit, _it: it }));
  }
  $("#bpRunBtn").disabled = true;
  st.className = "status";
  const t0 = Date.now();
  let lastMsg = "Sending…";
  const tick = setInterval(() => { st.textContent = `${lastMsg} ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
  try {
    const res = await takeoffFromDrawings({
      files: parts, notes: $("#bpNotes").value.trim(), rateList, effort: $("#bpEffort").value,
      onProgress: (m) => { lastMsg = m; st.textContent = `${m} ${Math.round((Date.now() - t0) / 1000)}s`; },
    });
    const data = res.data;
    const lines = data.items.map((it) => {
      const aiPick = rateList && it.rate_ref ? rateList.find((r) => r.ref === it.rate_ref)?._it : null;
      return toTakeoffLine({
        section: it.section, description: it.description, unit: it.unit, notes: it.notes, confidence: it.confidence,
        measurements: it.measurements.map((m) => ({ label: m.label, nos: m.nos, l: m.length, b: m.breadth, d: m.depth })),
      }, aiPick);
    });
    const u = res.usage || {};
    st.textContent = `Done in ${Math.round((Date.now() - t0) / 1000)}s · ${lines.length} items · ${((u.input_tokens || 0) / 1000).toFixed(0)}k in / ${((u.output_tokens || 0) / 1000).toFixed(1)}k out tokens`;
    st.className = "status ok";
    await applyTakeoff({
      source: `${providerLabel()} drawing takeoff${res.model ? ` (${res.model})` : ""}`, files: ready.map((d) => d.file.name),
      summary: data.summary, scale: data.drawing_scale, assumptions: data.assumptions, questions: data.questions, lines,
    });
  } catch (e) {
    console.error(e);
    st.textContent = e.message || String(e);
    st.className = "status err";
  } finally {
    clearInterval(tick);
    $("#bpRunBtn").disabled = false;
  }
}

function runQuickTakeoff() {
  const v = {};
  for (const [k] of QUICK_FIELDS) v[k] = num($(`#q_${k}`).value);
  state.settings.quick = v; saveSettings();
  applyTakeoff({
    source: "Quick takeoff from building dimensions", summary: `Framed RCC building, ${v.floors} floor(s), ${v.area} sqm per floor.`,
    assumptions: ["Quantities are approximate, worked out from overall dimensions and typical proportions. Check against drawings before tendering.", "Steel is estimated from kg/cum ratios."],
    questions: [], lines: quickTakeoff(v).map((l) => toTakeoffLine(l)),
  });
}

function renderTakeoff(scroll = false) {
  queueMicrotask(updateBadges);
  const el = $("#takeoffResults");
  const t = draft();
  if (!t || !t.lines) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");
  const f = (state.tf ||= { view: "all", conf: "", section: "", q: "" });
  const all = t.lines;
  const issues = new Map(all.map((l) => [l.id, lineIssues(l, all)]));
  const inView = {
    all: () => true,
    kept: (l) => isKept(l) && !l.added,
    removed: (l) => !isKept(l),
    issues: (l) => isKept(l) && !l.added && issues.get(l.id).length > 0,
    added: (l) => l.added,
  };
  const matches = (l) => inView[f.view](l) && (!f.conf || l.confidence === f.conf) && (!f.section || l.section === f.section) &&
    (!f.q || `${l.description} ${l.section} ${l.notes}`.toLowerCase().includes(f.q.toLowerCase()));
  const shown = all.filter(matches);
  const sections = [...new Set(all.map((l) => l.section || "General"))];
  const pending = all.filter((l) => isKept(l) && !l.added);
  const pendingTotal = pending.reduce((a, l) => a + lineAmount(l), 0);
  const count = (v) => all.filter(inView[v]).length;
  const chip = (v, label) => `<button class="chip ${f.view === v ? "active" : ""}" data-view="${v}">${label} <b>${count(v)}</b></button>`;
  const boqSections = project().sections.map((s) => s.name);

  const optionsFor = (l) => {
    const cands = lineCands(l);
    const cur = pickedItem(l);
    if (cur && !cands.includes(cur)) cands.unshift(cur);
    return `<option value="">Non-schedule item (enter rate)</option>` + cands.map((c) => {
      const b = bsrById(c._bsr);
      return `<option value="${c.id}" ${c.id === l.pick ? "selected" : ""}>${esc(c.code)} · ${esc(c.description.slice(0, 90))} · ${esc(c.unit)} · ${money(indexedRate(b, c), false)}${b && state.bsrs.length > 1 ? ` · ${esc(b.name.slice(0, 20))}` : ""}</option>`;
    }).join("") + `<option value="__search">Search all rate books…</option>`;
  };

  const row = (l) => {
    const n = all.indexOf(l) + 1;
    const it = pickedItem(l);
    const factor = it ? unitFactor(l.unit, it.unit) : 1;
    const iss = issues.get(l.id);
    const kept = isKept(l);
    return `<tr data-id="${l.id}" class="${kept ? "" : "excluded"} ${l.added ? "is-added" : ""}">
      <td class="keepcell"><button class="keep ${kept ? "on" : ""}" data-act="toggle" title="${kept ? "Kept: click to remove from the estimate" : "Removed: click to keep"}">${kept ? "✓ Keep" : "✕ Removed"}</button>
        <div class="small muted">#${n}</div></td>
      <td class="desc">
        <input data-f="section" value="${esc(l.section)}" list="tfSections" class="sec-in" title="Section">
        <textarea data-f="description" rows="2">${esc(l.description)}</textarea>
        <div class="small muted"><span class="conf ${esc(l.confidence)}">${esc(l.confidence || "")}</span> ${esc(l.notes || "")}
          ${l.added ? `<span class="badge-added">In BOQ ✓</span>` : ""}</div>
        ${iss.length && kept ? `<div class="issues">${iss.map((x) => `<span>⚠ ${esc(x)}</span>`).join("")}</div>` : ""}
      </td>
      <td class="num"><input data-f="qty" type="number" step="any" class="w100 num" value="${l.qty}">
        <div><button class="link small" data-act="meas">${l.measurements?.length ? `${l.measurements.length} measurement row${l.measurements.length > 1 ? "s" : ""}` : "add measurements"}</button></div>
        ${factor !== 1 ? `<div class="small muted">= ${qtyFmt(l.qty * factor)} ${esc(it.unit)}</div>` : ""}</td>
      <td><input data-f="unit" value="${esc(l.unit)}" class="w70"></td>
      <td><select data-f="pick" class="pick">${optionsFor(l)}</select>${l.aiPicked && l.pick === l.candIds?.[0] ? `<div class="small muted">chosen by AI</div>` : ""}</td>
      <td class="num">${it ? money(indexedRate(bsrById(it._bsr), it), false) : `<input data-f="customRate" type="number" step="any" class="w90 num" value="${l.customRate || ""}" placeholder="rate">`}</td>
      <td class="num">${money(lineAmount(l), false)}</td>
      <td class="actions"><button class="icon" data-act="dup" title="Duplicate">⧉</button><button class="icon danger-text" data-act="del" title="Delete permanently">🗑</button></td>
    </tr>`;
  };

  let body = "";
  for (const s of sections) {
    const rows = shown.filter((l) => (l.section || "General") === s);
    if (!rows.length) continue;
    const keptRows = rows.filter(isKept);
    body += `<tr class="grp" data-grp="${esc(s)}"><td colspan="8"><b>${esc(s)}</b>
      <span class="muted small">${keptRows.length} of ${rows.length} kept · ${money(keptRows.reduce((a, l) => a + lineAmount(l), 0))}</span>
      <span class="grp-actions"><button class="link small" data-grp-act="keep">keep all</button> · <button class="link small" data-grp-act="remove">remove all</button></span></td></tr>`;
    body += rows.map(row).join("");
  }

  el.innerHTML = `<div class="row between wrap gap">
      <div><h2>Review takeoff: keep, remove or edit before adding to the estimate</h2>
        <p class="muted small">${esc(t.source || "")}${t.files?.length ? ` · ${t.files.map(esc).join(", ")}` : ""}${t.scale ? ` · Scale: ${esc(t.scale)}` : ""}</p>
        ${t.summary ? `<p class="muted">${esc(t.summary)}</p>` : ""}</div>
      <div class="row gap"><button class="ghost" data-undo title="Undo (Ctrl+Z)">↶ Undo</button><button class="ghost" data-redo title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        <button class="ghost danger-text" id="tfClear">Discard draft</button></div></div>
    ${t.assumptions?.length || t.questions?.length ? `<details class="notes" open><summary><b>Notes from the takeoff</b> <span class="muted small">(${(t.assumptions?.length || 0) + (t.questions?.length || 0)})</span></summary><div class="grid-2">
      ${t.assumptions?.length ? `<div><h3>Assumptions</h3><ul>${t.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
      ${t.questions?.length ? `<div><h3>Questions to check</h3><ul>${t.questions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}</div></details>` : ""}
    <div class="tf-chips">${chip("all", "All")}${chip("kept", "To add")}${chip("issues", "⚠ Needs attention")}${chip("removed", "Removed")}${chip("added", "Already in BOQ")}</div>
    <div class="tf-tools">
      <input type="search" id="tfQ" placeholder="Search lines" value="${esc(f.q)}">
      <select id="tfSec"><option value="">All sections</option>${sections.map((s) => `<option ${s === f.section ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <select id="tfConf"><option value="">Any confidence</option>${["high", "medium", "low"].map((c) => `<option value="${c}" ${c === f.conf ? "selected" : ""}>${c[0].toUpperCase() + c.slice(1)} confidence</option>`).join("")}</select>
      <span class="muted small">On the ${shown.length} shown:</span>
      <button class="ghost small" data-bulk="keep">Keep</button><button class="ghost small" data-bulk="remove">Remove</button><button class="ghost small danger-text" data-bulk="delete">Delete</button>
      <button class="ghost small" id="tfAddLine">＋ Add line</button>
    </div>
    <datalist id="tfSections">${[...new Set([...sections, ...boqSections])].map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <div class="table-wrap"><table class="data review"><thead><tr><th>Keep?</th><th>Section / work item</th><th class="num">Qty</th><th>Unit</th><th>Rate-book item</th><th class="num">Rate</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${body || `<tr><td colspan="8" class="muted pad">No lines match this filter.</td></tr>`}</tbody></table></div>
    <div class="tf-foot">
      <label class="check small"><input type="checkbox" id="tfMerge" ${state.settings.mergeTakeoff === false ? "" : "checked"}> Combine with BOQ lines that use the same rate-book item (adds the measurements to the existing line)</label>
      <div class="row gap"><span><b>${pending.length}</b> line(s) to add · <b>${money(pendingTotal)}</b></span>
        <button class="primary" id="tfAdd" ${pending.length ? "" : "disabled"}>Add ${pending.length} kept line(s) to BOQ</button></div>
    </div>`;

  updateUndoButtons();
  bindTakeoffEvents(el);
  if (scroll) el.scrollIntoView({ behavior: "smooth" });
}

function bindTakeoffEvents(el) {
  const t = draft();
  const f = state.tf;
  const lineOf = (node) => t.lines.find((x) => x.id === node.closest("tr[data-id]")?.dataset.id);
  const changed = () => { saveProject(); renderTakeoff(); };
  const shownLines = () => $$("tr[data-id]", el).map((tr) => t.lines.find((l) => l.id === tr.dataset.id)).filter(Boolean);

  el.onclick = (e) => {
    const view = e.target.closest("[data-view]")?.dataset.view;
    if (view) { f.view = view; renderTakeoff(); return; }
    if (e.target.closest("[data-undo]")) { undo(); return; }
    if (e.target.closest("[data-redo]")) { redo(); return; }
    const bulk = e.target.dataset.bulk;
    if (bulk) {
      const ls = shownLines();
      if (!ls.length) return;
      if (bulk === "delete") {
        if (!confirm(`Delete the ${ls.length} shown line(s) from the draft?`)) return;
        t.lines = t.lines.filter((l) => !ls.includes(l));
        saveProject(); renderTakeoff();
        toast(`Deleted ${ls.length} line(s).`, 6000, { label: "Undo", fn: undo });
        return;
      }
      ls.forEach((l) => (l.status = bulk === "keep" ? "keep" : "removed"));
      changed(); return;
    }
    const ga = e.target.dataset.grpAct;
    if (ga) {
      const sec = e.target.closest("tr.grp").dataset.grp;
      shownLines().filter((l) => (l.section || "General") === sec).forEach((l) => (l.status = ga === "keep" ? "keep" : "removed"));
      changed(); return;
    }
    if (e.target.id === "tfAddLine") {
      const l = toTakeoffLine({ section: f.section || t.lines.at(-1)?.section || "General", description: "", unit: "cum", qty: 0, notes: "Added manually", confidence: "high" });
      t.lines.push(l);
      f.view = "all"; f.q = "";
      saveProject(); renderTakeoff();
      const ta = $(`tr[data-id="${l.id}"] textarea`, el);
      if (ta) { ta.scrollIntoView({ block: "center" }); ta.focus(); }
      return;
    }
    if (e.target.id === "tfAdd") { addTakeoffToBoq(); return; }
    if (e.target.id === "tfClear") {
      if (!confirm("Discard this takeoff draft? Lines already added to the BOQ stay in the BOQ.")) return;
      project().draft = null; saveProject(); renderTakeoff();
      toast("Draft discarded.", 6000, { label: "Undo", fn: undo });
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const l = lineOf(e.target); if (!l) return;
    if (act === "toggle") { l.status = isKept(l) ? "removed" : "keep"; changed(); }
    if (act === "dup") {
      const copy = { ...structuredClone(l), id: uid("t"), added: false, status: "keep", notes: [l.notes, "copy"].filter(Boolean).join(" · ") };
      t.lines.splice(t.lines.indexOf(l) + 1, 0, copy); changed();
    }
    if (act === "del") {
      t.lines.splice(t.lines.indexOf(l), 1); changed();
      toast("Line deleted.", 6000, { label: "Undo", fn: undo });
    }
    if (act === "meas") {
      openMeasurements(l, () => { l.qty = round(itemQty(l), 3); renderTakeoff(); });
    }
  };

  el.onchange = (e) => {
    if (e.target.id === "tfMerge") { state.settings.mergeTakeoff = e.target.checked; saveSettings(); return; }
    if (e.target.id === "tfSec") { f.section = e.target.value; renderTakeoff(); return; }
    if (e.target.id === "tfConf") { f.conf = e.target.value; renderTakeoff(); return; }
    const fld = e.target.dataset.f; if (!fld) return;
    const l = lineOf(e.target); if (!l) return;
    if (fld === "qty") { l.qty = num(e.target.value); l.measurements = []; }
    else if (fld === "customRate") l.customRate = num(e.target.value);
    else if (fld === "pick") {
      if (e.target.value === "__search") { searchPick(l); return; }
      l.pick = e.target.value; l.aiPicked = false; l.autoPick = false;
    } else if (fld === "description" || fld === "section" || fld === "unit") { l[fld] = e.target.value.trim(); rematch(l); }
    else l[fld] = e.target.value;
    changed();
  };
  let qT;
  $("#tfQ", el).oninput = (e) => {
    clearTimeout(qT);
    qT = setTimeout(() => { f.q = e.target.value; renderTakeoff(); const q = $("#tfQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250);
  };
}

function measTableHtml(ms) {
  const v = (x) => (x === "" || x == null ? "" : qtyFmt(Number(x)));
  return `<table class="meas"><tr><th></th><th>Nos</th><th>L</th><th>B</th><th>D</th><th>Qty</th></tr>${ms.map((m) => `<tr><td>${esc(m.label)}</td><td>${v(m.nos)}</td><td>${v(m.l)}</td><td>${v(m.b)}</td><td>${v(m.d)}</td><td>${qtyFmt(measurementQty(m))}</td></tr>`).join("")}</table>`;
}

function searchPick(l) {
  modal(`<h2>Choose a rate-book item</h2><p class="muted small">${esc(l.description)} · ${qtyFmt(l.qty)} ${esc(l.unit)}</p>
    <input type="search" id="spQ" value="${esc(l.description.split(/\s+/).slice(0, 3).join(" "))}">
    <div class="table-wrap tall mt"><table class="data small" id="spT"><tbody></tbody></table></div>`, (m) => {
    const fill = () => {
      const res = state.index.search($("#spQ", m).value, () => true, 150);
      $("#spT tbody", m).innerHTML = res.map((it) => `<tr><td>${esc(it.code)}</td><td>${esc(it.description.slice(0, 200))}</td><td>${esc(it.unit)}</td><td class="num">${money(indexedRate(bsrById(it._bsr), it), false)}</td><td><button class="small" data-id="${it.id}">Use</button></td></tr>`).join("") || `<tr><td class="muted">No matches</td></tr>`;
    };
    fill();
    $("#spQ", m).oninput = fill;
    $("#spT", m).onclick = (e) => {
      const id = e.target.dataset.id; if (!id) return;
      if (!l.candIds.includes(id)) l.candIds.unshift(id);
      l.pick = id; l.aiPicked = false; l.autoPick = false;
      closeModal(); saveProject(); renderTakeoff();
    };
  });
  // Keep the select showing the real pick if the dialog is closed without choosing.
  renderTakeoff();
}

function addTakeoffToBoq() {
  const t = draft();
  const sel = t.lines.filter((l) => isKept(l) && !l.added);
  if (!sel.length) { toast("Nothing to add: keep at least one line."); return; }
  const merge = $("#tfMerge")?.checked !== false;
  const p = project();
  let added = 0, merged = 0;
  for (const l of sel) {
    const it = pickedItem(l);
    let measurements = (l.measurements || []).map((m) => ({ ...m }));
    let qty = l.qty;
    let unit = l.unit;
    if (it) {
      const f = unitFactor(l.unit, it.unit);
      if (f !== 1) {
        measurements = measurements.map((m) => ({ ...m, nos: round(num(m.nos === "" ? 1 : m.nos) * f, 6), label: `${m.label} (× ${f} to ${it.unit})` }));
        qty = round(qty * f, 3);
      }
      unit = it.unit;
      const existing = merge ? p.sections.flatMap((s) => s.items).find((x) => x.bsrItemId === it.id) : null;
      if (existing) {
        if (!existing.measurements?.length) existing.measurements = num(existing.qty) ? [{ label: "Earlier quantity", nos: num(existing.qty), l: "", b: "", d: "" }] : [];
        if (!measurements.length) measurements = [{ label: "", nos: qty, l: "", b: "", d: "" }];
        const tag = l.description.slice(0, 50);
        existing.measurements.push(...measurements.map((m) => ({ ...m, label: m.label ? `${tag}: ${m.label}` : tag })));
        existing.qty = round(itemQty(existing), 3);
        l.added = true; merged++;
        continue;
      }
      const b = bsrById(it._bsr);
      ensureSection(l.section || "General").items.push({
        id: uid("b"), bsrId: b.id, bsrItemId: it.id, bsrName: b.name, code: it.code, description: it.description, unit,
        baseRate: it.rate, rate: indexedRate(b, it), qty, measurements, remarks: [l.description !== it.description ? `Takeoff: ${l.description}` : "", l.notes].filter(Boolean).join(" · "),
      });
    } else {
      ensureSection(l.section || "General").items.push({ id: uid("b"), bsrId: "", code: "NS", description: l.description, unit, rate: num(l.customRate), qty, measurements, remarks: l.notes || "" });
    }
    l.added = true; added++;
  }
  saveProject();
  renderSectionOptions();
  renderTakeoff();
  toast(`${added} line(s) added${merged ? `, ${merged} combined with existing BOQ lines` : ""} in "${p.name}".`, 6000, { label: "Undo", fn: undo });
  showTab("boq");
}

// ---------------------------------------------------------------------------
// BOQ
// ---------------------------------------------------------------------------

function renderBoq() {
  const p = project(); if (!p) return;
  renderProjectForm();
  const body = $("#boqBody");
  let sNo = 0;
  const sel = state.boqSel;
  for (const id of [...sel]) if (!findItem(id).item) sel.delete(id);
  const bulkBar = sel.size ? `<div class="bulkbar"><b>${sel.size} selected</b>
      <select data-bulk-move><option value="">Move to section…</option>${p.sections.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}<option value="__new">＋ New section…</option></select>
      <button class="ghost small" data-bulk="dup">Duplicate</button>
      <button class="ghost small danger-text" data-bulk="del">Delete</button>
      <button class="ghost small" data-bulk="clear">Clear selection</button></div>` : "";
  body.innerHTML = bulkBar + p.sections.map((s, si) => `
    <div class="section" data-sec="${s.id}">
      <div class="section-head">
        <span class="sec-letter">${String.fromCharCode(65 + (si % 26))}</span>
        <input class="sec-name" data-sec-name value="${esc(s.name)}">
        <span class="sec-total" data-sec-total>${money(sectionTotal(s))}</span>
        <button class="icon" data-sec-act="up" title="Move up">↑</button>
        <button class="icon" data-sec-act="down" title="Move down">↓</button>
        <button class="icon danger-text" data-sec-act="del" title="Delete section">×</button>
      </div>
      ${s.items.length ? `<div class="table-wrap"><table class="data boq"><thead><tr><th><input type="checkbox" data-sel-sec title="Select all in section" ${s.items.every((i) => sel.has(i.id)) ? "checked" : ""}></th><th>#</th><th>Code</th><th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${s.items.map((it) => { sNo++; return `<tr data-item="${it.id}" class="${sel.has(it.id) ? "selected" : ""}">
        <td><input type="checkbox" data-sel ${sel.has(it.id) ? "checked" : ""}></td>
        <td>${sNo}</td>
        <td><div class="code-cell"><input data-f="code" class="w80" value="${esc(it.code)}"><button class="sched ${itemSchedule(it)}" data-act="sched" title="${itemSchedule(it) === "G" ? "G-Schedule (BSR item). Click for H-Schedule" : "H-Schedule (non-BSR item). Click for G-Schedule"}">${itemSchedule(it)}</button></div><div class="small muted">${esc(it.bsrId ? (bsrById(it.bsrId)?.name || it.bsrName || "").slice(0, 22) : "Non-schedule")}</div></td>
        <td class="desc"><textarea data-f="description" rows="2">${esc(it.description)}</textarea>${it.remarks ? `<div class="small muted">${esc(it.remarks)}</div>` : ""}</td>
        <td><input data-f="unit" class="w70" value="${esc(it.unit)}"></td>
        <td class="num">${it.measurements?.length ? `<button class="link" data-act="meas">${qtyFmt(itemQty(it))}</button><div class="small muted">${it.measurements.length} row${it.measurements.length > 1 ? "s" : ""}</div>` : `<input data-f="qty" type="number" step="any" class="w90 num" value="${it.qty || ""}"><div><button class="link small" data-act="meas">measure</button></div>`}</td>
        <td class="num"><input data-f="rate" type="number" step="0.01" class="w100 num" value="${it.rate}"></td>
        <td class="num" data-amount>${money(itemAmount(it), false)}</td>
        <td class="actions"><button class="icon" data-act="up" title="Move up">↑</button><button class="icon" data-act="move" title="Move to section">⇄</button><button class="icon" data-act="dup" title="Duplicate">⧉</button><button class="icon danger-text" data-act="del" title="Delete">🗑</button></td>
      </tr>`; }).join("")}
      </tbody></table></div>` : `<p class="muted small pad">No items in this section. Add some from <a href="#" data-goto="pick">Pick items</a> or <a href="#" data-goto="takeoff">Drawing takeoff</a>.</p>`}
    </div>`).join("");

  $$("[data-goto]", body).forEach((a) => a.onclick = (e) => { e.preventDefault(); showTab(a.dataset.goto); });

  body.oninput = (e) => {
    const tr = e.target.closest("tr[data-item]"); if (!tr) return;
    const f = e.target.dataset.f;
    if (f !== "qty" && f !== "rate") return;
    const { item, sec } = findItem(tr.dataset.item);
    item[f] = num(e.target.value);
    $("[data-amount]", tr).textContent = money(itemAmount(item), false);
    $(`[data-sec="${sec.id}"] [data-sec-total]`).textContent = money(sectionTotal(sec));
    renderAbstract();
    saveProject(true);
  };
  body.onchange = (e) => {
    if (e.target.matches("[data-sel]")) {
      const id = e.target.closest("tr[data-item]").dataset.item;
      e.target.checked ? sel.add(id) : sel.delete(id);
      renderBoq(); return;
    }
    if (e.target.matches("[data-sel-sec]")) {
      const sec = p.sections.find((x) => x.id === e.target.closest("[data-sec]").dataset.sec);
      sec.items.forEach((i) => (e.target.checked ? sel.add(i.id) : sel.delete(i.id)));
      renderBoq(); return;
    }
    if (e.target.matches("[data-bulk-move]")) {
      let to = e.target.value; if (!to) return;
      let target;
      if (to === "__new") { const n = prompt("New section name:"); if (!n) { renderBoq(); return; } target = { id: uid("s"), name: n, items: [] }; p.sections.push(target); }
      else target = p.sections.find((x) => x.id === to);
      const moving = p.sections.flatMap((x) => x.items.filter((i) => sel.has(i.id)));
      p.sections.forEach((x) => (x.items = x.items.filter((i) => !sel.has(i.id))));
      target.items.push(...moving);
      sel.clear(); saveProject(); renderBoq(); renderSectionOptions();
      toast(`Moved ${moving.length} item(s) to "${target.name}".`, 6000, { label: "Undo", fn: undo });
      return;
    }
    if (e.target.matches("[data-sec-name]")) {
      const sec = p.sections.find((s) => s.id === e.target.closest("[data-sec]").dataset.sec);
      sec.name = e.target.value.trim() || "Section";
      saveProject(); renderAbstract(); renderSectionOptions();
      return;
    }
    const tr = e.target.closest("tr[data-item]"); if (!tr) return;
    const f = e.target.dataset.f;
    if (!f || f === "qty" || f === "rate") return;
    findItem(tr.dataset.item).item[f] = e.target.value;
    saveProject();
  };
  body.onclick = (e) => {
    const bulk = e.target.dataset.bulk;
    if (bulk) {
      if (bulk === "clear") sel.clear();
      if (bulk === "del") {
        const n = sel.size;
        p.sections.forEach((x) => (x.items = x.items.filter((i) => !sel.has(i.id))));
        sel.clear(); saveProject();
        toast(`Deleted ${n} item(s).`, 6000, { label: "Undo", fn: undo });
      }
      if (bulk === "dup") {
        p.sections.forEach((x) => {
          x.items = x.items.flatMap((i) => (sel.has(i.id) ? [i, { ...structuredClone(i), id: uid("b") }] : [i]));
        });
        sel.clear(); saveProject();
      }
      renderBoq(); return;
    }
    const secEl = e.target.closest("[data-sec]");
    const sa = e.target.dataset.secAct;
    if (sa) {
      const i = p.sections.findIndex((s) => s.id === secEl.dataset.sec);
      if (sa === "up" && i > 0) [p.sections[i - 1], p.sections[i]] = [p.sections[i], p.sections[i - 1]];
      if (sa === "down" && i < p.sections.length - 1) [p.sections[i + 1], p.sections[i]] = [p.sections[i], p.sections[i + 1]];
      if (sa === "del") {
        if (p.sections[i].items.length && !confirm(`Delete section "${p.sections[i].name}" and its ${p.sections[i].items.length} items?`)) return;
        p.sections.splice(i, 1);
        if (!p.sections.length) p.sections.push({ id: uid("s"), name: "General", items: [] });
        toast("Section deleted.", 6000, { label: "Undo", fn: undo });
      }
      saveProject(); renderBoq(); renderSectionOptions();
      return;
    }
    const act = e.target.dataset.act; if (!act) return;
    const tr = e.target.closest("tr[data-item]");
    const { item, sec } = findItem(tr.dataset.item);
    const idx = sec.items.indexOf(item);
    if (act === "del") { sec.items.splice(idx, 1); sel.delete(item.id); toast("Item deleted.", 6000, { label: "Undo", fn: undo }); }
    if (act === "dup") sec.items.splice(idx + 1, 0, { ...structuredClone(item), id: uid("b") });
    if (act === "sched") item.schedule = itemSchedule(item) === "G" ? "H" : "G";
    if (act === "up" && idx > 0) [sec.items[idx - 1], sec.items[idx]] = [sec.items[idx], sec.items[idx - 1]];
    if (act === "meas") { openMeasurements(item); return; }
    if (act === "move") { moveItem(item, sec); return; }
    saveProject(); renderBoq();
  };
  renderCharges();
  renderAbstract();
  renderFormatOptions();
  updateUndoButtons();
}

function findItem(id) {
  for (const sec of project().sections) {
    const item = sec.items.find((i) => i.id === id);
    if (item) return { item, sec };
  }
  return {};
}

function moveItem(item, from) {
  const p = project();
  modal(`<h2>Move item to section</h2><p class="small muted">${esc(item.description.slice(0, 160))}</p>
    <div class="col gap">${p.sections.filter((s) => s !== from).map((s) => `<button class="ghost" data-to="${s.id}">${esc(s.name)}</button>`).join("")}
    <button class="ghost" data-to="__new">＋ New section…</button></div>`, (m) => {
    m.onclick = (e) => {
      let to = e.target.dataset.to; if (!to) return;
      let target;
      if (to === "__new") { const n = prompt("New section name:"); if (!n) return; target = { id: uid("s"), name: n, items: [] }; p.sections.push(target); }
      else target = p.sections.find((s) => s.id === to);
      from.items.splice(from.items.indexOf(item), 1);
      target.items.push(item);
      saveProject(); closeModal(); renderBoq(); renderSectionOptions();
    };
  });
}

function openMeasurements(item, after = renderBoq) {
  const ms = (item.measurements || []).map((m) => ({ ...m }));
  if (!ms.length) ms.push({ label: "", nos: 1, l: num(item.qty) || "", b: "", d: "" });
  const render = (m) => {
    const total = ms.reduce((a, r) => a + measurementQty(r), 0);
    $("#measBody", m).innerHTML = ms.map((r, i) => `<tr data-i="${i}">
      <td><input data-k="label" value="${esc(r.label)}" placeholder="e.g. Ground floor, grid A-B"></td>
      ${["nos", "l", "b", "d"].map((k) => `<td><input data-k="${k}" type="number" step="any" class="w80 num" value="${r[k] ?? ""}"></td>`).join("")}
      <td class="num">${qtyFmt(measurementQty(r))}</td><td><button class="icon danger-text" data-rm="${i}">×</button></td></tr>`).join("");
    $("#measTotal", m).textContent = `${qtyFmt(total)} ${item.unit}`;
  };
  modal(`<h2>Measurements</h2><p class="small muted">${esc(item.code)} ${esc(item.description.slice(0, 200))}</p>
    <p class="small muted">Quantity = Nos × L × B × D for each row (blank dimensions are skipped). Use a negative Nos for deductions such as openings.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Description / location</th><th>Nos</th><th>L</th><th>B</th><th>D / H</th><th class="num">Qty</th><th></th></tr></thead><tbody id="measBody"></tbody>
    <tfoot><tr><td colspan="5"><button class="ghost small" id="measAdd">＋ Row</button> <button class="ghost small" id="measDeduct">＋ Deduction</button></td><td class="num"><b id="measTotal"></b></td><td></td></tr></tfoot></table></div>
    <div class="row gap mt"><button class="primary" id="measSave">Save</button><button class="ghost" id="measClear">Use a single quantity instead</button></div>`, (m) => {
    render(m);
    $("#measBody", m).oninput = (e) => {
      const tr = e.target.closest("tr"); const r = ms[+tr.dataset.i]; const k = e.target.dataset.k;
      r[k] = k === "label" ? e.target.value : e.target.value === "" ? "" : Number(e.target.value);
      tr.querySelector("td.num").textContent = qtyFmt(measurementQty(r));
      $("#measTotal", m).textContent = `${qtyFmt(ms.reduce((a, x) => a + measurementQty(x), 0))} ${item.unit}`;
    };
    $("#measBody", m).onclick = (e) => { const i = e.target.dataset.rm; if (i == null) return; ms.splice(+i, 1); render(m); };
    $("#measAdd", m).onclick = () => { ms.push({ label: "", nos: 1, l: "", b: "", d: "" }); render(m); };
    $("#measDeduct", m).onclick = () => { ms.push({ label: "Deduct", nos: -1, l: "", b: "", d: "" }); render(m); };
    $("#measSave", m).onclick = () => {
      item.measurements = ms.filter((r) => measurementQty(r) !== 0 || r.label);
      item.qty = round(itemQty(item), 3);
      saveProject(); closeModal(); after();
    };
    $("#measClear", m).onclick = () => {
      item.qty = round(ms.reduce((a, r) => a + measurementQty(r), 0), 3);
      item.measurements = [];
      saveProject(); closeModal(); after();
    };
  });
}

function renderProjectForm() {
  const p = project();
  const f = [["name", "Name of work"], ["client", "Client / department"], ["location", "Location"], ["reference", "Estimate / tender ref."], ["preparedBy", "Prepared by"], ["date", "Date", "date"]];
  $("#projectForm").innerHTML = f.map(([k, l, t]) => `<label class="field">${l}<input data-p="${k}" type="${t || "text"}" value="${esc(p[k] || "")}"></label>`).join("") +
    `<div class="field"><span>&nbsp;</span><button class="ghost danger-text" id="delProject">Delete project</button></div>`;
  $("#projectForm").onchange = (e) => {
    const k = e.target.dataset.p; if (!k) return;
    p[k] = e.target.value;
    saveProject();
    if (k === "name") renderProjectSelect();
  };
  $("#delProject").onclick = async () => {
    if (!confirm(`Delete the project "${p.name}"?`)) return;
    state.projects = state.projects.filter((x) => x.id !== p.id);
    await idb.del("projects", p.id);
    if (!state.projects.length) { const np = newProject("My first estimate"); state.projects.push(np); await idb.put("projects", np); }
    switchProject(state.projects[0].id);
  };
}

function renderCharges() {
  const p = project();
  $("#chargesBody").innerHTML = `<table class="data"><thead><tr><th>Add-on</th><th class="num">%</th><th>Applied on</th><th></th></tr></thead><tbody>
    ${p.charges.map((c) => `<tr data-c="${c.id}"><td><input data-k="label" value="${esc(c.label)}"></td><td><input data-k="percent" type="number" step="0.01" class="w70 num" value="${c.percent}"></td>
      <td><select data-k="on"><option value="works" ${c.on === "works" ? "selected" : ""}>Cost of works</option><option value="running" ${c.on === "running" ? "selected" : ""}>Running total</option></select></td>
      <td><button class="icon danger-text" data-rm>×</button></td></tr>`).join("")}</tbody></table>
    <p class="small muted">Set a percentage to 0 to leave it out. "Running total" applies on works plus the add-ons above it (typical for GST).</p>`;
  const body = $("#chargesBody");
  body.oninput = (e) => {
    const tr = e.target.closest("tr[data-c]"); if (!tr) return;
    const c = p.charges.find((x) => x.id === tr.dataset.c);
    c[e.target.dataset.k] = e.target.dataset.k === "percent" ? num(e.target.value) : e.target.value;
    saveProject(); renderAbstract();
  };
  body.onchange = body.oninput;
  body.onclick = (e) => {
    if (!e.target.matches("[data-rm]")) return;
    p.charges = p.charges.filter((x) => x.id !== e.target.closest("tr").dataset.c);
    saveProject(); renderCharges(); renderAbstract();
  };
}

/** Short amount for badges: ₹12.4 L, ₹1.2 Cr (INR) or compact notation for other currencies. */
function moneyShort(v) {
  const st = state.settings;
  if (st.currency === "INR") {
    if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
    if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
    return money(v).replace(/\.\d+$/, "");
  }
  try { return new Intl.NumberFormat(st.locale, { style: "currency", currency: st.currency, notation: "compact", maximumFractionDigits: 1 }).format(v); } catch { return money(v); }
}

function updateBadges() {
  const p = project(); if (!p) return;
  const items = p.sections.reduce((a, s) => a + s.items.length, 0);
  const pending = p.draft?.lines?.filter((l) => l.status !== "removed" && !l.added).length || 0;
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  set("tbRate", state.bsrs.length ? `${state.bsrs.length} loaded` : "add your BSR");
  set("tbTake", pending ? `${pending} to review` : "AI or quick");
  set("tbBoq", items ? `${items} items · ${moneyShort(computeAbstract(p).grand)}` : "empty");
  renderWelcome();
}

function renderWelcome() {
  const el = $("#welcome"); if (!el) return;
  const p = project();
  const items = p ? p.sections.reduce((a, s) => a + s.items.length, 0) : 0;
  const steps = [
    ["ratebooks", "Add rate books", "Upload BSR / SOR in Excel, PDF or Word", state.bsrs.length > 0],
    ["pick", "Add items", "Pick from BSR or read drawings", items > 0],
    ["boq", "Check the estimate", "Measurements, add-ons, abstract", items > 0 && computeAbstract(p).grand > 0],
    ["tender", "Export", "Excel / PDF estimate or e-tender BOQ", !!p?.exportedAt],
  ];
  el.className = "card welcome";
  el.innerHTML = `<div><h2>${items ? "Your estimate" : "Make a BOQ in four steps"}</h2>
      <p class="muted">${items ? `${esc(p.name)}: ${items} items, ${moneyShort(computeAbstract(p).grand)} with add-ons.` : "Bring your own schedule of rates, add items by hand or from drawings, and export an estimate or a portal-ready e-tender BOQ."}</p></div>
    <div class="welcome-steps">${steps.map(([tab, t, d, done], i) => `<button class="wstep ${done ? "done" : ""}" data-goto-tab="${tab}"><span class="n">${done ? "✓" : i + 1}</span><b>${t}</b><span>${d}</span></button>`).join("")}</div>`;
  el.onclick = (e) => { const t = e.target.closest("[data-goto-tab]")?.dataset.gotoTab; if (t) showTab(t); };
}

function renderKpis() {
  const el = $("#boqKpis"); if (!el) return;
  const p = project(); const ab = computeAbstract(p);
  const items = p.sections.flatMap((s) => s.items);
  const g = items.filter((it) => itemSchedule(it) === "G").length;
  el.innerHTML = `
    <div class="kpi"><small>Items</small><b>${items.length}</b> <span class="muted small">in ${p.sections.filter((s) => s.items.length).length} sections</span></div>
    <div class="kpi"><small>G / H schedule</small><b>${g} / ${items.length - g}</b> <span class="muted small">BSR / non-BSR</span></div>
    <div class="kpi"><small>Cost of works</small><b>${money(ab.works)}</b></div>
    <div class="kpi"><small>Add-ons and taxes</small><b>${money(ab.grand - ab.works)}</b></div>
    <div class="kpi grand"><small>Grand total</small><b>${money(ab.grand)}</b></div>`;
}

function renderAbstract() {
  renderKpis();
  updateBadges();
  const ab = computeAbstract(project());
  $("#abstractBody").innerHTML = `<table class="data abstract"><tbody>
    ${ab.sections.map((s) => `<tr><td>${esc(s.name)} <span class="muted small">(${s.count})</span></td><td class="num">${money(s.total)}</td></tr>`).join("")}
    <tr class="sub"><td>Total cost of works</td><td class="num">${money(ab.works)}</td></tr>
    ${ab.charges.filter((c) => num(c.percent)).map((c) => `<tr><td>${esc(c.label)} @ ${c.percent}%</td><td class="num">${money(c.amount)}</td></tr>`).join("")}
    <tr class="grand"><td>Grand total</td><td class="num">${money(ab.grand)}</td></tr></tbody></table>
    <p class="small muted">${esc(amountInWords(ab.grand))}</p>
    ${(() => {
      const items = project().sections.flatMap((s) => s.items);
      const g = items.filter((it) => itemSchedule(it) === "G").reduce((a, it) => a + itemAmount(it), 0);
      const h = items.filter((it) => itemSchedule(it) === "H").reduce((a, it) => a + itemAmount(it), 0);
      return items.length ? `<div class="gh-split"><span><b class="sched G">G</b> BSR items ${money(g)}</span><span><b class="sched H">H</b> non-BSR items ${money(h)}</span></div>` : "";
    })()}`;
}

function renderFormatOptions() {
  const f = project().format;
  $("#formatOptions").innerHTML = `
    <label class="field">Organisation / letterhead line<input data-fmt="orgName" value="${esc(f.orgName)}" placeholder="e.g. ABC Constructions Pvt Ltd"></label>
    <label class="field">Document title<input data-fmt="title" value="${esc(f.title)}"></label>
    <label class="field wide">Footer note<input data-fmt="footer" value="${esc(f.footer)}"></label>
    <label class="check"><input type="checkbox" data-fmt="showCode" ${f.showCode ? "checked" : ""}> Item code column</label>
    <label class="check"><input type="checkbox" data-fmt="showRateBook" ${f.showRateBook ? "checked" : ""}> Rate book name</label>
    <label class="check"><input type="checkbox" data-fmt="showRemarks" ${f.showRemarks ? "checked" : ""}> Remarks</label>
    <label class="check"><input type="checkbox" data-fmt="amountInWords" ${f.amountInWords ? "checked" : ""}> Amount in words</label>`;
  $("#formatOptions").onchange = (e) => {
    const k = e.target.dataset.fmt; if (!k) return;
    f[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    saveProject();
  };
}

function reapplyRates() {
  let n = 0, missing = 0;
  for (const s of project().sections) for (const it of s.items) {
    if (!it.bsrId) continue;
    const b = bsrById(it.bsrId); const src = b?.items.find((x) => x.id === it.bsrItemId);
    if (!src) { missing++; continue; }
    const r = indexedRate(b, src);
    if (r !== it.rate) { it.rate = r; it.baseRate = src.rate; n++; }
  }
  saveProject(); renderBoq();
  toast(`${n} rate(s) updated${missing ? `; ${missing} item(s) whose rate book was deleted kept their rate` : ""}.`);
}

// ---------------------------------------------------------------------------
// e-Tender BOQ (NIC GePNIC .xls)
// ---------------------------------------------------------------------------

/** G-Schedule = items from a rate book (BSR); H-Schedule = non-BSR items. Users can override per item. */
const itemSchedule = (it) => it.schedule || (it.bsrId ? "G" : "H");

async function loadNicTemplates() {
  const rec = (await idb.all("kv")).find((k) => k.id === "nicTemplates");
  state.nicTemplates = rec?.list || [];
}
const saveNicTemplates = () => idb.put("kv", { id: "nicTemplates", list: state.nicTemplates });

async function addNicTemplates(files) {
  for (const file of files) {
    try {
      const data = await file.arrayBuffer();
      const info = readNicBoq(data);
      const t = {
        id: uid("n"), name: file.name, boqType: info.boqType, version: info.version, items: info.items.length,
        protected: info.protected, hasMacros: info.hasMacros, work: info.work, addedAt: Date.now(), data,
      };
      state.nicTemplates.push(t);
      state.tender.tplId = t.id;
      await saveNicTemplates();
      toast(`Template added: ${info.boqType} BoQ (${info.version}).`);
    } catch (e) {
      console.error(e);
      toast(`${file.name}: ${e.message}`, 7000);
    }
  }
  renderTender();
}

function tenderDetails() {
  const p = project();
  p.tender ||= { authority: p.client || "", work: p.name || "", contract: p.reference || "" };
  return p.tender;
}

/** Items in NIC order with numbering, filtered by schedule. */
function tenderItems() {
  const p = project();
  const opt = state.tender;
  const tpl = state.nicTemplates.find((t) => t.id === opt.tplId);
  const secs = p.sections.map((s) => ({
    name: s.name,
    items: s.items.filter((it) => opt.scope === "all" || itemSchedule(it) === opt.scope).map((it) => ({
      description: it.description, qty: round(itemQty(it), 3), unit: it.unit,
      rate: opt.rates ? round(num(it.rate), 2) : null, code: it.code || "", _id: it.id,
    })),
  })).filter((s) => s.items.length);
  let list = nicNumbering(secs, { headings: opt.headings && secs.length > 0 });
  if (tpl?.boqType === "Item Wise") {
    let n = 0;
    list = list.map((x) => (x.heading ? x : { ...x, code: `item${++n}` }));
  }
  return { list, tpl };
}

function tenderChecks(list, tpl) {
  const errors = [], warnings = [];
  if (!state.nicTemplates.length) errors.push("Add a BOQ template (.xls) from the e-procurement portal.");
  else if (!tpl) errors.push("Choose which template to use.");
  const items = list.filter((x) => !x.heading);
  if (!items.length) errors.push("There are no items for the chosen schedule. Add items in the BOQ tab or change the schedule.");
  const label = (x) => `S.No ${x.sno}`;
  const noUnit = items.filter((x) => !String(x.unit || "").trim());
  if (noUnit.length) errors.push(`Unit missing for ${noUnit.length} item(s): ${noUnit.slice(0, 6).map(label).join(", ")}${noUnit.length > 6 ? "…" : ""}. The portal rejects items with a quantity but no unit.`);
  const noDesc = items.filter((x) => !String(x.description || "").trim());
  if (noDesc.length) errors.push(`Description missing for ${noDesc.length} item(s).`);
  const zero = items.filter((x) => !(x.qty > 0));
  if (zero.length) warnings.push(`${zero.length} item(s) have zero or negative quantity: ${zero.slice(0, 6).map(label).join(", ")}${zero.length > 6 ? "…" : ""}.`);
  if (tpl?.boqType === "Percentage") {
    if (!state.tender.rates) errors.push("A Percentage BoQ needs the estimated rate of every item (column F). Tick “Write estimated rates”.");
    const noRate = items.filter((x) => !(num(x.rate) > 0));
    if (state.tender.rates && noRate.length) errors.push(`Estimated rate missing for ${noRate.length} item(s): ${noRate.slice(0, 6).map(label).join(", ")}${noRate.length > 6 ? "…" : ""}.`);
  }
  if (tpl && tpl.boqType !== "Percentage" && state.tender.scope === "G") warnings.push("G-Schedule (BSR) items are usually tendered on a Percentage BoQ; the chosen template is " + tpl.boqType + ".");
  if (tpl && tpl.boqType === "Percentage" && state.tender.scope === "H") warnings.push("H-Schedule (non-BSR) items are usually tendered on an Item Rate BoQ; the chosen template is Percentage.");
  const d = tenderDetails();
  if (!d.authority.trim()) warnings.push("Tender Inviting Authority is blank; the template's text will be kept.");
  if (!d.work.trim()) warnings.push("Name of Work is blank; the template's text will be kept.");
  const long = items.filter((x) => String(x.description).length > 8000);
  if (long.length) warnings.push(`${long.length} description(s) are very long (over 8,000 characters).`);
  return { errors, warnings };
}

function renderTender() {
  const el = $("#tab-tender"); if (!el) return;
  const p = project(); if (!p) return;
  const opt = (state.tender ||= { tplId: state.nicTemplates[0]?.id || "", scope: "all", headings: true, rates: true });
  if (!state.nicTemplates.find((t) => t.id === opt.tplId)) opt.tplId = state.nicTemplates[0]?.id || "";

  // Templates
  $("#nicTemplates").innerHTML = state.nicTemplates.length ? state.nicTemplates.map((t) => `
    <label class="tpl ${t.id === opt.tplId ? "active" : ""}">
      <input type="radio" name="nicTpl" value="${t.id}" ${t.id === opt.tplId ? "checked" : ""}>
      <div class="tpl-main"><strong>${esc(t.boqType)} BoQ</strong> <span class="badge">${esc(t.version.replace("BoQ_", ""))}</span>
        <div class="small muted">${esc(t.name)} · ${t.items} item rows in template${t.protected ? " · bidder copy (will be unprotected for the department)" : ""}${t.hasMacros ? "" : " · <span class='warn'>no macros found</span>"}</div></div>
      <div class="tpl-actions"><button class="link small" data-tpl-import="${t.id}" title="Create a project from the items in this file">Import items</button>
        <button class="icon danger-text" data-tpl-del="${t.id}" title="Remove template">🗑</button></div>
    </label>`).join("") : `<p class="muted small pad">No templates yet. On the portal, open Downloads → BoQ template (or download the BOQ of any tender of the same type), then add the .xls file here.</p>`;

  // Details + scope
  const d = tenderDetails();
  $("#tenderForm").innerHTML = `
    <label class="field wide">Tender Inviting Authority<input data-td="authority" value="${esc(d.authority)}" placeholder="e.g. Executive Engineer, PWD City Division, Jodhpur"></label>
    <label class="field wide">Name of Work<input data-td="work" value="${esc(d.work)}"></label>
    <label class="field wide">Contract / NIT No.<input data-td="contract" value="${esc(d.contract)}" placeholder="e.g. NIT No 08 of 2026-27, Item No. 03"></label>`;
  const all = p.sections.flatMap((s) => s.items);
  const g = all.filter((it) => itemSchedule(it) === "G"), h = all.filter((it) => itemSchedule(it) === "H");
  const sum = (arr) => money(arr.reduce((a, it) => a + itemAmount(it), 0));
  $("#tenderScope").innerHTML = `
    <div class="scope">
      <label class="scope-opt ${opt.scope === "all" ? "active" : ""}"><input type="radio" name="scope" value="all" ${opt.scope === "all" ? "checked" : ""}><b>All items</b><span>${all.length} items · ${sum(all)}</span></label>
      <label class="scope-opt ${opt.scope === "G" ? "active" : ""}"><input type="radio" name="scope" value="G" ${opt.scope === "G" ? "checked" : ""}><b>G-Schedule</b><span>BSR items · ${g.length} · ${sum(g)}</span></label>
      <label class="scope-opt ${opt.scope === "H" ? "active" : ""}"><input type="radio" name="scope" value="H" ${opt.scope === "H" ? "checked" : ""}><b>H-Schedule</b><span>non-BSR items · ${h.length} · ${sum(h)}</span></label>
    </div>
    <p class="muted small">Items from a rate book count as G-Schedule and non-schedule items as H-Schedule. Change any item with its G/H button in the BOQ tab.</p>
    <label class="check"><input type="checkbox" id="tdHeadings" ${opt.headings ? "checked" : ""}> Write BOQ sections as heading rows (numbered 1, 1.01, 1.02 …)</label>
    <label class="check"><input type="checkbox" id="tdRates" ${opt.rates ? "checked" : ""}> Write estimated rates (column F)</label>`;

  // Checks + preview
  const { list, tpl } = tenderItems();
  const { errors, warnings } = tenderChecks(list, tpl);
  $("#tenderChecks").innerHTML = `${errors.map((e) => `<div class="check-line err">✕ ${esc(e)}</div>`).join("")}${warnings.map((w) => `<div class="check-line warn">⚠ ${esc(w)}</div>`).join("")}${!errors.length && !warnings.length ? `<div class="check-line ok">✓ Ready: ${(() => { const n = list.filter((x) => !x.heading).length; return `${n} item${n === 1 ? "" : "s"}`; })()} will be written into the ${esc(tpl.boqType)} BoQ template.</div>` : ""}`;
  $("#nicDownload").disabled = errors.length > 0;
  const shown = list.slice(0, 300);
  const total = list.reduce((a, x) => a + (x.heading ? 0 : (num(x.qty) * num(x.rate))), 0);
  $("#tenderPreview").innerHTML = list.length ? `<div class="table-wrap tall"><table class="data small nicprev"><thead><tr><th>Sl. No.</th><th>Item Description</th>${tpl?.boqType === "Item Wise" ? "<th>Item Code</th>" : ""}<th class="num">Quantity</th><th>Units</th><th class="num">Estimated Rate</th><th class="num">Amount</th></tr></thead><tbody>
    ${shown.map((x) => x.heading ? `<tr class="nic-head"><td>${x.sno}</td><td colspan="${tpl?.boqType === "Item Wise" ? 6 : 5}">${esc(x.description)}</td></tr>`
      : `<tr><td>${x.sno}</td><td>${esc(x.description.slice(0, 260))}${x.description.length > 260 ? "…" : ""}</td>${tpl?.boqType === "Item Wise" ? `<td>${esc(x.code)}</td>` : ""}<td class="num">${qtyFmt(x.qty)}</td><td>${esc(x.unit)}</td><td class="num">${x.rate == null ? "" : money(x.rate, false)}</td><td class="num">${x.rate == null ? "" : money(num(x.qty) * num(x.rate), false)}</td></tr>`).join("")}
    ${list.length > shown.length ? `<tr><td colspan="7" class="muted">… ${list.length - shown.length} more rows</td></tr>` : ""}
    </tbody><tfoot><tr><td colspan="${tpl?.boqType === "Item Wise" ? 6 : 5}" class="num"><b>Total in Figures (estimated)</b></td><td class="num"><b>${money(total)}</b></td></tr></tfoot></table></div>` : "";
}

function bindTender() {
  setupDrop($("#nicDrop"), $("#nicFile"), addNicTemplates);
  const el = $("#tab-tender");
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "nicTpl") state.tender.tplId = t.value;
    else if (t.name === "scope") state.tender.scope = t.value;
    else if (t.id === "tdHeadings") state.tender.headings = t.checked;
    else if (t.id === "tdRates") state.tender.rates = t.checked;
    else if (t.dataset.td) { tenderDetails()[t.dataset.td] = t.value; saveProject(); }
    else return;
    $("#tenderDone").innerHTML = "";
    renderTender();
  });
  el.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-tpl-del]")?.dataset.tplDel;
    if (del) {
      e.preventDefault();
      if (!confirm("Remove this template from the browser?")) return;
      state.nicTemplates = state.nicTemplates.filter((t) => t.id !== del);
      await saveNicTemplates(); renderTender(); return;
    }
    const imp = e.target.closest("[data-tpl-import]")?.dataset.tplImport;
    if (imp) { e.preventDefault(); importNicAsProject(state.nicTemplates.find((t) => t.id === imp)); return; }
    if (e.target.id === "nicDownload") downloadNicBoq();
  });
}

function downloadNicBoq() {
  const { list, tpl } = tenderItems();
  const { errors } = tenderChecks(list, tpl);
  if (errors.length) { toast(errors[0], 6000); return; }
  const d = tenderDetails();
  try {
    const report = {};
    const bytes = writeNicBoq(tpl.data, list, { authority: d.authority.trim(), work: d.work.trim(), contract: d.contract.trim() }, { unprotect: true, report });
    const base = (d.contract || d.work || project().name).replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "BOQ";
    const sched = state.tender.scope === "all" ? "" : `_${state.tender.scope}-Schedule`;
    download(new Blob([bytes], { type: "application/vnd.ms-excel" }), `BOQ_${base}${sched}.xls`);
    project().exportedAt = Date.now(); saveProject();
    $("#tenderDone").innerHTML = `<div class="done-box">
      <h3>✓ ${report.rows} rows written into the ${esc(report.boqType)} BoQ template</h3>
      ${report.fixes?.length ? `<p class="small">Corrected in the template: ${report.fixes.map(esc).join("; ")}.</p>` : ""}
      <p><b>Before uploading to the portal:</b></p>
      <ol>
        <li>Open the file in <b>Microsoft Excel</b> (Windows) and click <b>Enable Content</b> so the BOQ macros run. The BoQ1 sheet appears only with macros enabled.</li>
        <li>Check the items, then press <b>Ctrl + S</b>. The template's own validation runs on save and should report that the basic BoQ validations are complied.</li>
        <li>Upload the saved file on the e-procurement portal as the tender's BOQ.</li>
      </ol>
      <p class="small muted">Keep the file name and the sheet name BoQ1 unchanged. Rows 1 to 3 are for system use.</p></div>`;
  } catch (e) {
    console.error(e);
    toast("Could not write the BOQ: " + e.message, 8000);
  }
}

/** Create a project from a NIC BOQ. Every BoQ sheet is read (e.g. BoQ1 = H-Schedule item rate, BoQ2 = G-Schedule percentage). */
async function importNicAsProject(tpl, rawInfo) {
  const first = rawInfo || readNicBoq(tpl.data);
  const infos = first.sheetNames.length > 1 ? first.sheetNames.map((n) => readNicBoq(tpl.data, n)) : [first];
  const strip = (s) => String(s || "").replace(/^[^:]*:\s*/, "").trim();
  const p = newProject(strip(first.work) || tpl?.name || "Imported BOQ");
  p.client = strip(first.authority);
  p.reference = strip(first.contract);
  p.tender = { authority: p.client, work: p.name, contract: p.reference };
  p.sections = [];
  // G-Schedule (percentage) sheets first, as in bills and deviation statements.
  infos.sort((a, b) => (a.boqType === "Percentage" ? 0 : 1) - (b.boqType === "Percentage" ? 0 : 1));
  let count = 0;
  for (const info of infos) {
    const sched = info.boqType === "Percentage" ? "G" : "H";
    const label = `${sched}-Schedule`;
    let sec = null;
    for (const it of info.items) {
      if (it.heading) { sec = { id: uid("s"), name: `${label}: ${it.description.slice(0, 100)}`, items: [] }; p.sections.push(sec); continue; }
      if (!sec) { sec = { id: uid("s"), name: label, items: [] }; p.sections.push(sec); }
      sec.items.push({
        id: uid("b"), bsrId: "", code: /^item\d+$|^BI\d+$/i.test(it.code) ? "" : it.code, description: it.description,
        unit: it.unit, qty: it.qty || 0, rate: it.rate || 0, measurements: [], schedule: sched, sno: it.sno,
        remarks: `${info.sheetName} S.No ${it.sno}`,
      });
      count++;
    }
  }
  p.sections = p.sections.filter((s) => s.items.length);
  if (!p.sections.length) p.sections.push({ id: uid("s"), name: "General", items: [] });
  state.projects.unshift(p);
  await idb.put("projects", p);
  switchProject(p.id);
  toast(`Imported ${count} items (${infos.map((i) => `${i.sheetName}: ${i.boqType}`).join(", ")}) into "${p.name}".`, 6000);
  showTab("boq");
}

async function importNicFiles(files) {
  for (const file of files) {
    try {
      const data = await file.arrayBuffer();
      const info = readNicBoq(data);
      await importNicAsProject({ name: file.name, data }, info);
    } catch (e) { toast(`${file.name}: ${e.message}`, 7000); }
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function renderSettings() {
  const s = state.settings;
  const currencies = [["INR", "en-IN", "₹ Indian Rupee"], ["USD", "en-US", "$ US Dollar"], ["EUR", "de-DE", "€ Euro"], ["GBP", "en-GB", "£ Pound"], ["AED", "en-AE", "AED Dirham"], ["SAR", "en-SA", "SAR Riyal"], ["NPR", "en-IN", "NPR Nepalese Rupee"], ["BDT", "en-IN", "BDT Taka"], ["LKR", "en-IN", "LKR Sri Lankan Rupee"], ["KES", "en-KE", "KES Shilling"], ["NGN", "en-NG", "NGN Naira"]];
  $("#settingsForm").innerHTML = `
    <label class="field">Currency<select id="setCur">${currencies.map(([c, , l]) => `<option value="${c}" ${c === s.currency ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field">Number format<select id="setLocale">${[["en-IN", "12,34,567.89 (Indian)"], ["en-US", "1,234,567.89"], ["de-DE", "1.234.567,89"], ["en-GB", "1,234,567.89 (UK)"]].map(([v, l]) => `<option value="${v}" ${v === s.locale ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field">Decimals for amounts<input id="setDec" type="number" min="0" max="3" value="${s.decimals}"></label>
    <label class="field">Decimals for quantities<input id="setQDec" type="number" min="0" max="4" value="${s.qtyDecimals}"></label>`;
  $("#settingsForm").onchange = () => {
    s.currency = $("#setCur").value;
    s.locale = $("#setLocale").value;
    s.decimals = Math.max(0, Math.min(3, num($("#setDec").value)));
    s.qtyDecimals = Math.max(0, Math.min(4, num($("#setQDec").value)));
    saveSettings(); renderBoq(); renderPickRows();
  };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("afterbegin", `<div class="fatal">Could not start: ${esc(e.message)}. Try a recent version of Chrome, Edge, Firefox or Safari.</div>`);
});
