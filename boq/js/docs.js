// Document folders for a site or for the company: upload, scan, view, merge into one PDF, download.
import { esc } from "./store.js";
import { saveFile, allFiles, putFile, delFile, mergeToPdf, makeZip, scanEnhance, thumbOf, safeName, extOf, mb } from "./files.js";

export const SITE_FOLDERS = ["Work order", "Agreement", "BOQ", "Drawings", "Test reports", "STP", "MB & bills", "Letters", "Challans", "Others"];
export const COMPANY_FOLDERS = ["Registration", "PAN & GST", "Experience certificates", "Bank & solvency", "Tender documents", "Staff & labour", "Others"];

const $ = (s, el = document) => el.querySelector(s);
const fmtD = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const icon = (f) => (f.thumb ? `<img src="${f.thumb}" alt="">` : `<span class="doc-ico">${esc(extOf(f.type, f.name).toUpperCase())}</span>`);

/**
 * opts: { owner, title, folders, saveFolders(list), targets: () => [{id, name}], ctx: {toast, modal, closeModal, download} }
 * Returns a render function; state (folder, selection) is kept between renders.
 */
export function docsPanel(el, opts) {
  const st = { folder: "", sel: new Set(), q: "" };
  const { ctx } = opts;

  async function render() {
    const files = (await allFiles()).filter((f) => f.owner === opts.owner && f.kind === "doc");
    const folders = [...new Set([...opts.folders(), ...files.map((f) => f.folder).filter(Boolean)])];
    const shown = files.filter((f) => (!st.folder || f.folder === st.folder) && (!st.q || (f.name + " " + f.caption).toLowerCase().includes(st.q))).sort((a, b) => b.added - a.added);
    st.sel = new Set([...st.sel].filter((id) => files.some((f) => f.id === id)));
    const count = (fd) => files.filter((f) => f.folder === fd).length;
    el.innerHTML = `<div class="card"><div class="row between wrap"><h2>${esc(opts.title)}</h2>
        <div class="row gap wrap"><label class="ghost btn-file">⇪ Upload<input type="file" multiple data-up hidden></label>
        <label class="ghost btn-file" title="Photograph pages; they are cleaned up like a scan and saved as one PDF">📄 Scan pages<input type="file" accept="image/*" capture="environment" multiple data-scan hidden></label>
        <button class="ghost" data-newfolder>＋ Folder</button></div></div>
      <div class="chips mt"><button class="chip ${st.folder ? "" : "active"}" data-folder="">All (${files.length})</button>${folders.map((fd) => `<button class="chip ${st.folder === fd ? "active" : ""}" data-folder="${esc(fd)}">${esc(fd)} (${count(fd)})</button>`).join("")}</div>
      <div class="row gap wrap mt"><input type="search" data-q placeholder="Search documents" value="${esc(st.q)}" class="grow">
        <span class="muted small">${st.sel.size ? `${st.sel.size} selected` : "Tick documents to merge or download them"}</span>
        <button class="primary" data-merge ${st.sel.size ? "" : "disabled"} title="PDFs and images, in the order ticked, as one PDF">Merge into one PDF</button>
        <button class="ghost" data-zip ${st.sel.size ? "" : "disabled"}>Download (ZIP)</button>
        <button class="ghost" data-move ${st.sel.size ? "" : "disabled"}>Move…</button>
        <button class="ghost danger-text" data-del ${st.sel.size ? "" : "disabled"}>Delete</button></div>
      ${shown.length ? `<div class="doc-list mt">${shown.map((f) => `<div class="doc ${st.sel.has(f.id) ? "sel" : ""}" data-id="${f.id}">
          <label class="doc-check"><input type="checkbox" data-pick ${st.sel.has(f.id) ? "checked" : ""}>${st.sel.has(f.id) ? `<b>${[...st.sel].indexOf(f.id) + 1}</b>` : ""}</label>
          <button class="doc-thumb" data-open>${icon(f)}</button>
          <div class="doc-meta"><input class="doc-name" data-rename value="${esc(f.name)}"><small class="muted">${esc(f.folder || "No folder")} · ${fmtD(f.date)} · ${mb(f.size)}</small></div></div>`).join("")}</div>`
        : `<p class="muted mt">No documents here yet. Upload files (PDF, Word, Excel, photos…) or scan pages with the camera.</p>`}
      <p class="muted small mt">Upload into: <select data-into>${folders.map((fd) => `<option ${fd === (st.folder || folders[0]) ? "selected" : ""}>${esc(fd)}</option>`).join("")}</select></p></div>`;
  }

  const into = () => $("[data-into]", el)?.value || st.folder || opts.folders()[0];

  el.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-folder]")) { st.folder = t.closest("[data-folder]").dataset.folder; return render(); }
    if (t.matches("[data-newfolder]")) {
      const n = prompt("Folder name:"); if (!n?.trim()) return;
      opts.saveFolders([...opts.folders(), n.trim()]); st.folder = n.trim(); return render();
    }
    const id = t.closest("[data-id]")?.dataset.id;
    if (t.closest("[data-open]") && id) { const f = (await allFiles()).find((x) => x.id === id); if (f) openFile(f, ctx); return; }
    const picked = async () => { const all = await allFiles(); return [...st.sel].map((i) => all.find((f) => f.id === i)).filter(Boolean); };
    if (t.matches("[data-merge]")) {
      try { ctx.toast("Merging…"); const blob = await mergeToPdf(await picked()); ctx.download(blob, `${safeName(opts.title)}_merged.pdf`); ctx.toast("Merged PDF ready."); }
      catch (err) { ctx.toast("Could not merge: " + err.message, 6000); }
    }
    if (t.matches("[data-zip]")) { const fs = await picked(); ctx.download(await makeZip(fs.map((f) => ({ name: `${safeName(f.folder)}/${safeName(f.name.replace(/\.\w+$/, ""))}.${extOf(f.type, f.name)}`, data: f.blob }))), `${safeName(opts.title)}.zip`); }
    if (t.matches("[data-del]")) {
      if (!confirm(`Delete ${st.sel.size} document(s)?`)) return;
      for (const i of st.sel) await delFile(i); st.sel.clear(); render();
    }
    if (t.matches("[data-move]")) moveDialog(await picked());
  });
  el.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-pick]")) { const id = t.closest("[data-id]").dataset.id; t.checked ? st.sel.add(id) : st.sel.delete(id); return render(); }
    if (t.matches("[data-rename]")) { const f = (await allFiles()).find((x) => x.id === t.closest("[data-id]").dataset.id); if (f) { f.name = t.value.trim() || f.name; await putFile(f); } return; }
    if (t.matches("[data-up]")) {
      const fd = into();
      for (const f of t.files) await saveFile(f, { owner: opts.owner, kind: "doc", folder: fd, name: f.name, thumb: f.type.startsWith("image/") ? await thumbOf(f).catch(() => "") : "" });
      ctx.toast(`${t.files.length} file(s) saved in ${fd}.`); t.value = ""; return render();
    }
    if (t.matches("[data-scan]")) {
      const files = [...t.files]; t.value = ""; if (!files.length) return;
      await saveScan(files, opts.owner, into(), ctx); return render();
    }
  });
  el.addEventListener("input", (e) => { if (e.target.matches("[data-q]")) { st.q = e.target.value.toLowerCase(); clearTimeout(st.qt); st.qt = setTimeout(() => { render().then(() => { const q = $("[data-q]", el); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 250); } });

  function moveDialog(files) {
    const targets = opts.targets();
    ctx.modal(`<h2>Move ${files.length} document(s)</h2>
      <label class="field">To<select id="mvOwner">${targets.map((t) => `<option value="${t.id}" ${t.id === opts.owner ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
      <label class="field">Folder<input id="mvFolder" list="mvList" value="${esc(files[0]?.folder || "")}"><datalist id="mvList">${[...SITE_FOLDERS, ...COMPANY_FOLDERS].map((f) => `<option>${esc(f)}</option>`).join("")}</datalist></label>
      <button class="primary mt" id="mvGo">Move</button>`, (m) => {
      $("#mvGo", m).onclick = async () => {
        for (const f of files) { f.owner = $("#mvOwner", m).value; f.folder = $("#mvFolder", m).value.trim() || f.folder; await putFile(f); }
        st.sel.clear(); ctx.closeModal(); ctx.toast("Moved."); render();
      };
    });
  }
  return render;
}

/** Photographed pages → cleaned-up scan → one PDF saved as a document. */
export async function saveScan(images, owner, folder, ctx, name = "") {
  ctx.toast(`Scanning ${images.length} page(s)…`, 8000);
  const pages = [];
  for (const im of images) pages.push({ blob: await scanEnhance(im), type: "image/jpeg" });
  const pdf = await mergeToPdf(pages);
  const d = new Date();
  const rec = await saveFile(new File([pdf], name || `Scan ${d.toLocaleDateString("en-IN")} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.pdf`, { type: "application/pdf" }),
    { owner, kind: "doc", folder, thumb: await thumbOf(pages[0].blob).catch(() => "") });
  ctx.toast(`Scan saved as PDF (${images.length} page${images.length > 1 ? "s" : ""}) in ${folder}.`);
  return rec;
}

export function openFile(f, ctx) {
  const url = URL.createObjectURL(f.blob);
  if (f.type.startsWith("image/")) {
    ctx.modal(`<h2>${esc(f.name)}</h2><img src="${url}" style="max-width:100%;border-radius:8px"><p><a class="ghost btn" href="${url}" download="${esc(f.name)}">Download</a></p>`);
  } else {
    // PDFs open in the browser's viewer; other types download.
    const a = document.createElement("a"); a.href = url;
    if (f.type === "application/pdf") a.target = "_blank"; else a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
