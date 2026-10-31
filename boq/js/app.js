import {
  idb, uid, DEFAULT_SETTINGS, newProject, num, round, itemQty, itemAmount, sectionTotal, computeAbstract,
  money, qtyFmt, setSettingsRef, esc, measurementQty, amountInWords,
} from "./store.js";
import { readRateFile, detectMapping, rowsToItems, linesToItems, makeItem, summarise } from "./bsr-import.js";
import { configureAI, hasKey, testKey, takeoffFromDrawings, extractRatesFromText, extractRatesFromImages } from "./ai.js";
import { prepareDrawing, pdfDocToImages } from "./blueprint.js";
import { Index, unitFactor, canonUnit } from "./match.js";
import { QUICK_FIELDS, quickTakeoff } from "./quick.js";
import { exportXlsx, exportCsv, printProject, download } from "./export.js";
import { SAMPLE_BSR } from "./sample.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  settings: { ...DEFAULT_SETTINGS },
  bsrs: [],
  projects: [],
  projectId: null,
  index: null,
  drawings: [], // { id, file, status, parts, warning, error, dxf }
  takeoff: null, // { source, summary, assumptions, questions, lines: [...] }
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

  const key = localStorage.getItem("boq.apiKey") || sessionStorage.getItem("boq.apiKey") || "";
  configureAI({ apiKey: key, model: state.settings.model });
  $("#apiKey").value = key;
  $("#rememberKey").checked = !!localStorage.getItem("boq.apiKey");
  $("#modelSel").value = state.settings.model;

  rebuildIndex();
  bindGlobal();
  renderAll();
}

function renderAll() {
  renderProjectSelect();
  renderBsrList();
  renderPick();
  renderQuickForm();
  renderBoq();
  renderSettings();
  renderKeyHint();
}

const saveSettings = () => idb.put("kv", { ...state.settings, id: "settings" });
const saveBsr = (b) => idb.put("bsrs", b);
let saveTimer = null;
function saveProject() {
  const p = project();
  if (!p) return;
  p.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => idb.put("projects", p), 300);
}

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
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
  for (const b of state.bsrs) {
    if (b.enabled === false) continue;
    for (const it of b.items) items.push(Object.assign(it, { _bsr: b.id }));
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

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
  $("#exportXlsxBtn").addEventListener("click", () => guardEmpty() && exportXlsx(project(), $("#exportFormat").value, rateBookName));
  $("#exportPdfBtn").addEventListener("click", () => guardEmpty() && printProject(project(), $("#exportFormat").value, rateBookName));
  $("#exportCsvBtn").addEventListener("click", () => guardEmpty() && exportCsv(project()));
  $("#exportJsonBtn").addEventListener("click", () => {
    const p = project();
    const used = new Set(p.sections.flatMap((s) => s.items.map((i) => i.bsrId)).filter(Boolean));
    const payload = { app: "ratebook-boq", version: 1, project: p, bsrs: state.bsrs.filter((b) => used.has(b.id)) };
    download(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }), `${p.name.replace(/[^\w-]+/g, "_")}.boq.json`);
  });
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
  $("#apiKey").addEventListener("change", storeKey);
  $("#rememberKey").addEventListener("change", storeKey);
  $("#modelSel").addEventListener("change", (e) => { state.settings.model = e.target.value; configureAI({ model: e.target.value }); saveSettings(); });
  $("#testKeyBtn").addEventListener("click", async () => {
    storeKey();
    const s = $("#keyStatus");
    s.textContent = "Checking…"; s.className = "status";
    try { await testKey(); s.textContent = "Key works ✓"; s.className = "status ok"; }
    catch (e) { s.textContent = e.message; s.className = "status err"; }
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
    localStorage.removeItem("boq.apiKey"); sessionStorage.removeItem("boq.apiKey");
    location.reload();
  });
}

function storeKey() {
  const key = $("#apiKey").value.trim();
  localStorage.removeItem("boq.apiKey"); sessionStorage.removeItem("boq.apiKey");
  if (key) ($("#rememberKey").checked ? localStorage : sessionStorage).setItem("boq.apiKey", key);
  configureAI({ apiKey: key });
  renderKeyHint();
}

function renderKeyHint() {
  $("#bpKeyHint").innerHTML = hasKey()
    ? "Drawings are sent to Anthropic's Claude API using your key. Large sets can take a few minutes."
    : `Reading drawings needs a Claude API key. <a href="#" data-goto="settings">Add one in Settings</a>, or use the quick takeoff on the right.`;
  const a = $("#bpKeyHint [data-goto]");
  if (a) a.addEventListener("click", (e) => { e.preventDefault(); showTab("settings"); });
}

function showTab(name) {
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  if (name === "pick") renderPick();
  if (name === "boq") renderBoq();
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
  renderProjectSelect(); renderBoq(); renderSectionOptions();
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
        ? `<p class="muted small">Read ${content.pages} page(s) of text. Check the preview. If descriptions or rates look wrong, let Claude read the document instead.</p>`
        : `<p class="warn">This looks like a scanned PDF with no text layer. Claude can read the page images (needs an API key).</p>`}
      <div id="wzPreview">${items.length ? previewTable(items) : `<p class="muted">No items recognised yet.</p>`}</div>
      <div class="row gap mt wrap">
        ${items.length ? `<button class="primary" id="wzImport">Import ${items.length} items</button>` : ""}
        <button class="${items.length ? "ghost" : "primary"}" id="wzAi">Extract with Claude${hasKey() ? "" : " (add key in Settings)"}</button>
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
            st.textContent = `Claude is reading part ${c + 1} of ${chunks.length}… (${found.length} items so far)`;
            const res = await extractRatesFromText(chunks[c]);
            found.push(...res);
          }
        } else {
          const per = 6;
          for (let p = from; p <= to; p += per) {
            const last = Math.min(to, p + per - 1);
            st.textContent = `Claude is reading pages ${p}–${last} of ${to}… (${found.length} items so far)`;
            const imgs = await pdfDocToImages(content.pdf, p, last, 2, name);
            found.push(...(await extractRatesFromImages(imgs)));
          }
        }
        items = found.filter((i) => i.description && i.rate).map((i) => makeItem(i.code, i.description, i.unit, i.rate, i.chapter));
        render(`Claude found ${items.length} items.`);
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

async function runAiTakeoff() {
  const st = $("#bpStatus");
  const ready = state.drawings.filter((d) => d.status === "ready");
  if (!ready.length) { toast("Upload at least one drawing first."); return; }
  if (!hasKey()) { toast("Add your Claude API key in Settings."); showTab("settings"); return; }
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
  const tick = setInterval(() => { st.dataset.t = Math.round((Date.now() - t0) / 1000); }, 1000);
  try {
    const res = await takeoffFromDrawings({
      files: parts, notes: $("#bpNotes").value.trim(), rateList, effort: $("#bpEffort").value,
      onProgress: (m) => { st.textContent = `${m} ${Math.round((Date.now() - t0) / 1000)}s`; },
    });
    const data = res.data;
    const lines = data.items.map((it) => {
      const aiPick = rateList && it.rate_ref ? rateList.find((r) => r.ref === it.rate_ref)?._it : null;
      return toTakeoffLine({
        section: it.section, description: it.description, unit: it.unit, notes: it.notes, confidence: it.confidence,
        measurements: it.measurements.map((m) => ({ label: m.label, nos: m.nos, l: m.length, b: m.breadth, d: m.depth })),
      }, aiPick);
    });
    state.takeoff = { source: "Claude drawing takeoff", summary: data.summary, scale: data.drawing_scale, assumptions: data.assumptions, questions: data.questions, lines };
    const u = res.usage || {};
    st.textContent = `Done in ${Math.round((Date.now() - t0) / 1000)}s · ${lines.length} items · ${((u.input_tokens || 0) / 1000).toFixed(0)}k in / ${((u.output_tokens || 0) / 1000).toFixed(1)}k out tokens`;
    st.className = "status ok";
    renderTakeoff();
  } catch (e) {
    console.error(e);
    st.textContent = e.message || String(e);
    st.className = "status err";
  } finally {
    clearInterval(tick);
    $("#bpRunBtn").disabled = false;
  }
}

/** Build a review line with local match candidates. aiPick: rate item chosen by Claude, if any. */
function toTakeoffLine(l, aiPick = null) {
  const qty = l.measurements?.length ? l.measurements.reduce((a, m) => a + measurementQty(m), 0) : num(l.qty);
  const cands = state.index.match(`${l.description} ${l.section}`, l.unit, 6).map((m) => m.item);
  if (aiPick && !cands.includes(aiPick)) cands.unshift(aiPick);
  else if (aiPick) { cands.splice(cands.indexOf(aiPick), 1); cands.unshift(aiPick); }
  const best = cands[0] || null;
  const compatible = best && (!l.unit || canonUnit(best.unit) === canonUnit(l.unit) || unitFactor(l.unit, best.unit) !== 1);
  return {
    id: uid("t"), include: true, ...l, qty: round(qty, 3), candidates: cands,
    pick: best && (aiPick || compatible) ? best.id : "",
    aiPicked: !!aiPick, customRate: 0,
  };
}

function runQuickTakeoff() {
  const v = {};
  for (const [k] of QUICK_FIELDS) v[k] = num($(`#q_${k}`).value);
  state.settings.quick = v; saveSettings();
  const lines = quickTakeoff(v).map((l) => toTakeoffLine(l));
  state.takeoff = {
    source: "Quick takeoff from building dimensions", summary: `Framed RCC building, ${v.floors} floor(s), ${v.area} sqm per floor.`,
    assumptions: ["Quantities are approximate, worked out from overall dimensions and typical proportions. Check against drawings before tendering.", "Steel is estimated from kg/cum ratios."],
    questions: [], lines,
  };
  renderTakeoff();
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
    state.takeoff = { source: `DXF layer takeoff (${name})`, summary: "", assumptions: ["Wall lengths from DXF are the sum of all drawn lines on the layer; for double-line walls halve the length."], questions: [], lines };
    renderTakeoff();
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

function renderTakeoff() {
  const t = state.takeoff;
  const el = $("#takeoffResults");
  el.classList.remove("hidden");
  const optionsFor = (l) => {
    const opts = l.candidates.map((c) => {
      const b = bsrById(c._bsr);
      return `<option value="${c.id}" ${c.id === l.pick ? "selected" : ""}>${esc(c.code)} · ${esc(c.description.slice(0, 90))} · ${esc(c.unit)} · ${money(indexedRate(b, c), false)}${b && state.bsrs.length > 1 ? ` · ${esc(b.name.slice(0, 20))}` : ""}</option>`;
    }).join("");
    return `<option value="">Non-schedule item (enter rate)</option>${opts}<option value="__search">Search all rate books…</option>`;
  };
  const totalAmt = t.lines.filter((l) => l.include).reduce((a, l) => a + lineAmount(l), 0);
  el.innerHTML = `<div class="row between wrap gap"><div><h2>Review: ${esc(t.source)}</h2>${t.summary ? `<p class="muted">${esc(t.summary)}</p>` : ""}${t.scale ? `<p class="small muted">Scale: ${esc(t.scale)}</p>` : ""}</div>
      <div class="row gap"><button class="ghost" id="toAll">Select all</button><button class="ghost" id="toNone">Select none</button><button class="primary" id="toAdd">Add selected to BOQ</button></div></div>
    ${t.assumptions?.length || t.questions?.length ? `<div class="grid-2 notes">
      ${t.assumptions?.length ? `<div><h3>Assumptions</h3><ul>${t.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
      ${t.questions?.length ? `<div><h3>Questions to check</h3><ul>${t.questions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}</div>` : ""}
    <div class="table-wrap"><table class="data review"><thead><tr><th></th><th>Section</th><th>Work item</th><th class="num">Qty</th><th>Unit</th><th>Rate-book item</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>
    ${t.lines.map((l) => {
      const it = pickedItem(l);
      const factor = it ? unitFactor(l.unit, it.unit) : 1;
      return `<tr data-id="${l.id}" class="${l.include ? "" : "excluded"}">
        <td><input type="checkbox" data-f="include" ${l.include ? "checked" : ""}></td>
        <td><input data-f="section" value="${esc(l.section)}" class="w120"></td>
        <td class="desc"><textarea data-f="description" rows="2">${esc(l.description)}</textarea>
          <div class="small muted"><span class="conf ${l.confidence}">${esc(l.confidence || "")}</span> ${esc(l.notes || "")}
          ${l.measurements?.length ? `<details><summary>${l.measurements.length} measurement row(s)</summary>${measTableHtml(l.measurements)}</details>` : ""}</div></td>
        <td class="num"><input data-f="qty" type="number" step="any" class="w90 num" value="${l.qty}" ${l.measurements?.length ? 'title="Calculated from measurements; editing replaces them"' : ""}>${factor !== 1 ? `<div class="small muted">= ${qtyFmt(l.qty * factor)} ${esc(it.unit)}</div>` : ""}</td>
        <td>${esc(l.unit)}${it && canonUnit(it.unit) !== canonUnit(l.unit) && factor === 1 ? `<div class="warn small" title="Rate-book unit differs">≠ ${esc(it.unit)}</div>` : ""}</td>
        <td><select data-f="pick" class="pick">${optionsFor(l)}</select>${l.aiPicked && l.pick === l.candidates[0]?.id ? `<div class="small muted">chosen by Claude</div>` : ""}</td>
        <td class="num">${it ? money(indexedRate(bsrById(it._bsr), it), false) : `<input data-f="customRate" type="number" step="any" class="w90 num" value="${l.customRate || ""}" placeholder="rate">`}</td>
        <td class="num">${money(lineAmount(l), false)}</td></tr>`;
    }).join("")}
    </tbody><tfoot><tr><td colspan="7" class="num"><b>Selected total (before add-ons)</b></td><td class="num"><b>${money(totalAmt)}</b></td></tr></tfoot></table></div>`;

  $("#toAll").onclick = () => { t.lines.forEach((l) => (l.include = true)); renderTakeoff(); };
  $("#toNone").onclick = () => { t.lines.forEach((l) => (l.include = false)); renderTakeoff(); };
  $("#toAdd").onclick = addTakeoffToBoq;
  $("tbody", el).onchange = (e) => {
    const tr = e.target.closest("tr"); const l = t.lines.find((x) => x.id === tr.dataset.id);
    const f = e.target.dataset.f;
    if (f === "include") l.include = e.target.checked;
    else if (f === "qty") { l.qty = num(e.target.value); l.measurements = []; }
    else if (f === "customRate") l.customRate = num(e.target.value);
    else if (f === "pick") {
      if (e.target.value === "__search") { searchPick(l); return; }
      l.pick = e.target.value;
    } else if (f) l[f] = e.target.value;
    if (f === "description" || f === "section") return;
    renderTakeoff();
  };
  el.scrollIntoView({ behavior: "smooth" });
}

function measTableHtml(ms) {
  const v = (x) => (x === "" || x == null ? "" : qtyFmt(Number(x)));
  return `<table class="meas"><tr><th></th><th>Nos</th><th>L</th><th>B</th><th>D</th><th>Qty</th></tr>${ms.map((m) => `<tr><td>${esc(m.label)}</td><td>${v(m.nos)}</td><td>${v(m.l)}</td><td>${v(m.b)}</td><td>${v(m.d)}</td><td>${qtyFmt(measurementQty(m))}</td></tr>`).join("")}</table>`;
}

const pickedItem = (l) => (l.pick ? l.candidates.find((c) => c.id === l.pick) || state.index.items.find((c) => c.id === l.pick) : null);
function lineAmount(l) {
  const it = pickedItem(l);
  if (!it) return round(l.qty * num(l.customRate), 2);
  return round(l.qty * unitFactor(l.unit, it.unit) * indexedRate(bsrById(it._bsr), it), 2);
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
      const it = state.index.items.find((x) => x.id === id);
      if (!l.candidates.includes(it)) l.candidates.unshift(it);
      l.pick = id;
      closeModal(); renderTakeoff();
    };
  });
}

function addTakeoffToBoq() {
  const t = state.takeoff;
  const sel = t.lines.filter((l) => l.include);
  if (!sel.length) { toast("Nothing selected."); return; }
  const p = project();
  for (const l of sel) {
    const it = pickedItem(l);
    const sec = ensureSection(l.section || "General");
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
      const b = bsrById(it._bsr);
      sec.items.push({
        id: uid("b"), bsrId: b.id, bsrItemId: it.id, bsrName: b.name, code: it.code, description: it.description, unit,
        baseRate: it.rate, rate: indexedRate(b, it), qty, measurements, remarks: [l.description !== it.description ? `Takeoff: ${l.description}` : "", l.notes].filter(Boolean).join(" · "),
      });
    } else {
      sec.items.push({ id: uid("b"), bsrId: "", code: "NS", description: l.description, unit, rate: num(l.customRate), qty, measurements, remarks: l.notes || "" });
    }
  }
  saveProject();
  renderSectionOptions();
  toast(`Added ${sel.length} items to "${p.name}".`);
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
  body.innerHTML = p.sections.map((s, si) => `
    <div class="section" data-sec="${s.id}">
      <div class="section-head">
        <span class="sec-letter">${String.fromCharCode(65 + (si % 26))}</span>
        <input class="sec-name" data-sec-name value="${esc(s.name)}">
        <span class="sec-total" data-sec-total>${money(sectionTotal(s))}</span>
        <button class="icon" data-sec-act="up" title="Move up">↑</button>
        <button class="icon" data-sec-act="down" title="Move down">↓</button>
        <button class="icon danger-text" data-sec-act="del" title="Delete section">×</button>
      </div>
      ${s.items.length ? `<div class="table-wrap"><table class="data boq"><thead><tr><th>#</th><th>Code</th><th>Description</th><th>Unit</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${s.items.map((it) => { sNo++; return `<tr data-item="${it.id}">
        <td>${sNo}</td>
        <td><input data-f="code" class="w80" value="${esc(it.code)}"><div class="small muted">${esc(it.bsrId ? (bsrById(it.bsrId)?.name || it.bsrName || "").slice(0, 22) : "NS")}</div></td>
        <td class="desc"><textarea data-f="description" rows="2">${esc(it.description)}</textarea>${it.remarks ? `<div class="small muted">${esc(it.remarks)}</div>` : ""}</td>
        <td><input data-f="unit" class="w70" value="${esc(it.unit)}"></td>
        <td class="num">${it.measurements?.length ? `<button class="link" data-act="meas">${qtyFmt(itemQty(it))}</button><div class="small muted">${it.measurements.length} rows</div>` : `<input data-f="qty" type="number" step="any" class="w90 num" value="${it.qty || ""}"><div><button class="link small" data-act="meas">measure</button></div>`}</td>
        <td class="num"><input data-f="rate" type="number" step="0.01" class="w100 num" value="${it.rate}"></td>
        <td class="num" data-amount>${money(itemAmount(it), false)}</td>
        <td class="actions"><button class="icon" data-act="up" title="Move up">↑</button><button class="icon" data-act="move" title="Move to section">⇄</button><button class="icon danger-text" data-act="del" title="Remove">×</button></td>
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
    saveProject();
  };
  body.onchange = (e) => {
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
      }
      saveProject(); renderBoq(); renderSectionOptions();
      return;
    }
    const act = e.target.dataset.act; if (!act) return;
    const tr = e.target.closest("tr[data-item]");
    const { item, sec } = findItem(tr.dataset.item);
    const idx = sec.items.indexOf(item);
    if (act === "del") sec.items.splice(idx, 1);
    if (act === "up" && idx > 0) [sec.items[idx - 1], sec.items[idx]] = [sec.items[idx], sec.items[idx - 1]];
    if (act === "meas") { openMeasurements(item); return; }
    if (act === "move") { moveItem(item, sec); return; }
    saveProject(); renderBoq();
  };
  renderCharges();
  renderAbstract();
  renderFormatOptions();
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

function openMeasurements(item) {
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
      saveProject(); closeModal(); renderBoq();
    };
    $("#measClear", m).onclick = () => {
      item.qty = round(ms.reduce((a, r) => a + measurementQty(r), 0), 3);
      item.measurements = [];
      saveProject(); closeModal(); renderBoq();
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

function renderAbstract() {
  const ab = computeAbstract(project());
  $("#abstractBody").innerHTML = `<table class="data abstract"><tbody>
    ${ab.sections.map((s) => `<tr><td>${esc(s.name)} <span class="muted small">(${s.count})</span></td><td class="num">${money(s.total)}</td></tr>`).join("")}
    <tr class="sub"><td>Total cost of works</td><td class="num">${money(ab.works)}</td></tr>
    ${ab.charges.filter((c) => num(c.percent)).map((c) => `<tr><td>${esc(c.label)} @ ${c.percent}%</td><td class="num">${money(c.amount)}</td></tr>`).join("")}
    <tr class="grand"><td>Grand total</td><td class="num">${money(ab.grand)}</td></tr></tbody></table>
    <p class="small muted">${esc(amountInWords(ab.grand))}</p>`;
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
