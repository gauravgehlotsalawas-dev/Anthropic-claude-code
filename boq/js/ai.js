// Claude API calls: reading drawings for quantity takeoff, and extracting rates from scanned/complex rate books.
import { Anthropic } from "../vendor/libs.mjs";

import { pdfjsLib } from "./bsr-import.js";

let session = { provider: "anthropic", apiKey: "", model: "claude-opus-5-5" };
/** provider: "anthropic" | "openai"; apiKey and model belong to that provider. */
export function configureAI({ provider, apiKey, model }) {
  if (provider) session.provider = provider;
  if (apiKey != null) session.apiKey = apiKey;
  if (model) session.model = model;
}
export const hasKey = () => !!session.apiKey;
export const providerLabel = () => (session.provider === "openai" ? "OpenAI" : "Claude");

function client() {
  if (!session.apiKey) throw new Error("Add your API key in Settings first.");
  // The key belongs to the person using this page and never leaves their browser except to api.anthropic.com.
  return new Anthropic({ apiKey: session.apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
}

async function structured(args) {
  return session.provider === "openai" ? openaiStructured(args) : claudeStructured(args);
}

/**
 * Streams one structured-output request and returns the parsed JSON.
 * Uses server-side refusal fallbacks; retries once without them if the API rejects the combination.
 */
async function claudeStructured({ system, content, schema, effort = "medium", maxTokens = 64000, onText }) {
  const c = client();
  const base = {
    model: session.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema } },
  };
  const run = async (withFallback) => {
    const params = withFallback ? { ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : base;
    const stream = withFallback ? c.beta.messages.stream(params) : c.messages.stream(params);
    let chars = 0;
    stream.on("text", (t) => { chars += t.length; onText && onText(chars); });
    return stream.finalMessage();
  };
  let msg;
  try {
    msg = await run(true);
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) msg = await run(false);
    else throw friendlyError(e);
  }
  if (msg.stop_reason === "refusal") {
    throw new Error("Claude declined this request" + (msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : "."));
  }
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (msg.stop_reason === "max_tokens") {
    throw new Error("The response was too long and got cut off. Try fewer files or pages at a time.");
  }
  try {
    return { data: JSON.parse(text), usage: msg.usage, model: msg.model };
  } catch {
    throw new Error("Claude's answer could not be read as JSON. Please try again.");
  }
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error("The API key was rejected. Check it in Settings.");
  if (e instanceof Anthropic.PermissionDeniedError) return new Error("This API key does not have access to the selected model.");
  if (e instanceof Anthropic.RateLimitError) return new Error("Rate limit reached. Wait a minute and try again.");
  if (e instanceof Anthropic.BadRequestError) return new Error("Request rejected: " + (e.error?.error?.message || e.message));
  if (e instanceof Anthropic.APIConnectionError) return new Error("Could not reach the Claude API. Check your internet connection.");
  if (e instanceof Anthropic.APIError) return new Error(`Claude API error (${e.status ?? "?"}): ${e.message}`);
  return e;
}

export async function testKey() {
  if (session.provider === "openai") return listOpenAIModels();
  const c = client();
  try {
    await c.models.retrieve(session.model);
    return null;
  } catch (e) {
    throw friendlyError(e);
  }
}

// ---------------------------------------------------------------------------
// OpenAI (Chat Completions with JSON-schema structured output)
// ---------------------------------------------------------------------------

const OPENAI = "https://api.openai.com/v1";

async function openaiFetch(path, init = {}) {
  if (!session.apiKey) throw new Error("Add your OpenAI API key in Settings first.");
  let res;
  try {
    res = await fetch(OPENAI + path, {
      ...init,
      headers: { Authorization: `Bearer ${session.apiKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
  } catch {
    throw new Error("Could not reach the OpenAI API. Check your internet connection.");
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 300) || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    err.code = json?.error?.code || "";
    err.param = json?.error?.param || "";
    throw err;
  }
  return json;
}

function openaiFriendly(e) {
  if (e.status === 401) return new Error("OpenAI rejected the API key. Check it in Settings.");
  if (e.status === 404) return new Error(`OpenAI model "${session.model}" was not found for this key. Press "Test key" in Settings to load your available models.`);
  if (e.status === 429) return new Error(e.code === "insufficient_quota" ? "Your OpenAI account has no remaining credit or quota." : "OpenAI rate limit reached. Wait a minute and try again.");
  if (e.status === 413) return new Error("The upload is too large for OpenAI. Send fewer drawings or pages at a time.");
  if (e.status) return new Error(`OpenAI error (${e.status}): ${e.message}`);
  return e;
}

/** Newest general-purpose GPT models first; non-chat models removed. */
export async function listOpenAIModels() {
  let data;
  try { data = await openaiFetch("/models"); } catch (e) { throw openaiFriendly(e); }
  const skip = /(audio|realtime|transcribe|tts|search|image|embed|instruct|moderation|dall|whisper|babbage|davinci|codex|computer|deep-research|oss|chat-latest)/i;
  const ids = (data.data || []).map((m) => m.id).filter((id) => /^(gpt-\d|o\d)/.test(id) && !skip.test(id) && !/-\d{4}-\d{2}-\d{2}$/.test(id));
  const ver = (id) => parseFloat((id.match(/^gpt-(\d+(?:\.\d+)?)/) || id.match(/^o(\d+)/) || [0, 0])[1]);
  const size = (id) => (/nano/.test(id) ? 0 : /mini/.test(id) ? 1 : 2);
  ids.sort((a, b) => (b.startsWith("gpt") - a.startsWith("gpt")) || ver(b) - ver(a) || size(b) - size(a) || a.length - b.length);
  return ids;
}

const dataUrl = (mediaType, data) => `data:${mediaType};base64,${data}`;

function toOpenAIParts(content) {
  return content.map((b) => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "image") return { type: "image_url", image_url: { url: dataUrl(b.source.media_type, b.source.data), detail: "high" } };
    if (b.type === "document") return { type: "file", file: { filename: (b.title || "document").replace(/\.pdf$/i, "") + ".pdf", file_data: dataUrl("application/pdf", b.source.data) } };
    return { type: "text", text: JSON.stringify(b) };
  });
}

/** Fallback when a model refuses PDF file parts: render each PDF page to an image instead. */
async function rasterisePdfParts(content) {
  const out = [];
  for (const b of content) {
    if (b.type !== "document") { out.push(b); continue; }
    const bin = Uint8Array.from(atob(b.source.data), (c) => c.charCodeAt(0));
    const pdf = await pdfjsLib.getDocument({ data: bin }).promise;
    const pages = Math.min(pdf.numPages, 20);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      let vp = page.getViewport({ scale: 2 });
      const k = Math.min(1, 2048 / Math.max(vp.width, vp.height));
      vp = page.getViewport({ scale: 2 * k });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ type: "text", text: `${b.title || "PDF"}, page ${p}` });
      out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] } });
    }
  }
  return out;
}

async function openaiStructured({ system, content, schema, effort = "medium", maxTokens = 64000 }) {
  if (!session.model || !session.model.trim()) throw new Error('Choose an OpenAI model first: in Settings press "Test key" to load the models your key can use.');
  const opts = { effort: effort === "xhigh" || effort === "max" ? "high" : effort, maxTokens, content, sendEffort: true };
  for (let attempt = 0; attempt < 6; attempt++) {
    const body = {
      model: session.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: toOpenAIParts(opts.content) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema } },
      max_completion_tokens: opts.maxTokens,
    };
    if (opts.sendEffort) body.reasoning_effort = opts.effort;
    let res;
    try {
      res = await openaiFetch("/chat/completions", { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      // Adjust and retry for parameters some OpenAI models do not accept.
      const m = `${e.param} ${e.message}`.toLowerCase();
      if (e.status === 400 && opts.sendEffort && m.includes("reasoning")) { opts.sendEffort = false; continue; }
      if (e.status === 400 && /max_completion_tokens|max_tokens|maximum/.test(m) && opts.maxTokens > 8000) { opts.maxTokens = Math.floor(opts.maxTokens / 2); continue; }
      if (e.status === 400 && /file|pdf|document/.test(m) && opts.content.some((b) => b.type === "document")) { opts.content = await rasterisePdfParts(opts.content); continue; }
      throw openaiFriendly(e);
    }
    const choice = res.choices?.[0];
    if (!choice) throw new Error("OpenAI returned an empty response.");
    if (choice.message?.refusal) throw new Error("OpenAI declined this request: " + choice.message.refusal);
    if (choice.finish_reason === "length") throw new Error("The response was too long and got cut off. Try fewer files or pages at a time.");
    try {
      return {
        data: JSON.parse(choice.message.content),
        usage: { input_tokens: res.usage?.prompt_tokens || 0, output_tokens: res.usage?.completion_tokens || 0 },
        model: res.model,
      };
    } catch {
      throw new Error("OpenAI's answer could not be read as JSON. Please try again.");
    }
  }
  throw new Error("OpenAI did not accept the request after several adjustments.");
}

// ---------------------------------------------------------------------------
// Drawing takeoff
// ---------------------------------------------------------------------------

const measurementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "nos", "length", "breadth", "depth"],
  properties: {
    label: { type: "string" },
    nos: { type: "number" },
    length: { type: "number" },
    breadth: { type: "number" },
    depth: { type: "number" },
  },
};

const takeoffSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "drawing_scale", "assumptions", "questions", "items"],
  properties: {
    summary: { type: "string" },
    drawing_scale: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "description", "unit", "rate_ref", "confidence", "notes", "measurements"],
        properties: {
          section: { type: "string" },
          description: { type: "string" },
          unit: { type: "string" },
          rate_ref: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          notes: { type: "string" },
          measurements: { type: "array", items: measurementSchema },
        },
      },
    },
  },
};

const TAKEOFF_SYSTEM = `You are a senior quantity surveyor and estimating engineer. You prepare bills of quantities (BOQ) from architectural, structural and services drawings.

How to work:
- Read every dimension, grid, level, schedule, legend and note in the drawings. Work out the scale from written dimensions or the scale bar before measuring anything.
- Measure in metric units (m, sqm, cum, kg, nos) following the standard method of measurement the user names, or IS 1200 if none is named. Measure net quantities, and enter openings and other deductions as measurement rows with a negative "nos".
- Every item needs measurement rows that reproduce its quantity: quantity = sum of (nos × length × breadth × depth). Put 1 in any dimension that does not apply (for example length only for running metres).
- Group items into sections by trade in construction order (earthwork, concrete, reinforcement, masonry, plaster, flooring, doors and windows, painting, waterproofing, plumbing, electrical, external works) and include only sections relevant to the drawings.
- Include items the drawing clearly implies even when they are not drawn separately (excavation and backfill for footings, PCC below foundations, curing, plinth filling), and mark those as "medium" or "low" confidence with a note.
- Reinforcement: if no bar schedule is given, estimate steel from typical kg/cum ratios for each member type and say so in the notes.
- If a rate-book item list is provided, set rate_ref to the ref of the closest matching item with a compatible unit; use an empty string when nothing fits. Never change your measured quantity to suit a rate-book unit; convert units in the measurements instead (for example 10 sqm units).
- State all assumptions you had to make, and list questions for the engineer where information was missing.
- Do not invent dimensions that contradict the drawing. When something cannot be read, say so in assumptions and give your best estimate with low confidence.`;

/**
 * files: [{ kind: "pdf"|"image"|"text", name, mediaType, data(base64)|text }]
 * rateList: [{ ref, code, description, unit }] or null
 */
export async function takeoffFromDrawings({ files, notes, rateList, effort, onProgress }) {
  const content = [];
  for (const f of files) {
    if (f.kind === "pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name });
    } else if (f.kind === "image") {
      content.push({ type: "text", text: `Drawing image: ${f.name}${f.note ? ` (${f.note})` : ""}` });
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
    } else {
      content.push({ type: "text", text: `<document name="${f.name}">\n${f.text}\n</document>` });
    }
  }
  if (rateList && rateList.length) {
    const lines = rateList.map((r) => `${r.ref} | ${r.code} | ${r.description.slice(0, 160)} | ${r.unit}`).join("\n");
    content.push({ type: "text", text: `<rate_book_items>\nref | code | description | unit\n${lines}\n</rate_book_items>` });
  }
  content.push({
    type: "text",
    text: `Prepare a complete bill of quantities for the work shown in the attached drawings and documents.${
      notes ? `\n\nNotes from the engineer:\n${notes}` : ""
    }${rateList && rateList.length ? "\n\nMatch each item to the rate-book list above using rate_ref." : "\n\nNo rate book was provided; leave rate_ref empty."}`,
  });
  onProgress && onProgress(`${providerLabel()} is reading the drawings…`);
  return structured({
    system: TAKEOFF_SYSTEM,
    content,
    schema: takeoffSchema,
    effort,
    onText: (n) => onProgress && onProgress(`Writing the BOQ… (${Math.round(n / 1000)}k characters)`),
  });
}

// ---------------------------------------------------------------------------
// Rate book extraction (scanned PDFs or layouts the text parser can't read)
// ---------------------------------------------------------------------------

const ratesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chapter", "code", "description", "unit", "rate"],
        properties: {
          chapter: { type: "string" },
          code: { type: "string" },
          description: { type: "string" },
          unit: { type: "string" },
          rate: { type: "number" },
        },
      },
    },
  },
};

const RATES_SYSTEM = `You convert pages of a construction schedule of rates (BSR, SOR, DSR or a contractor's rate list) into structured items.
- Output one entry per priced item. When a main item has priced sub-items such as (a), (b), (i), (ii), write each sub-item's description as the main description followed by " — " and the sub-item text, and its code as the main code followed by the sub-item label, e.g. "5.2(a)".
- Keep descriptions complete and word-for-word apart from joining broken lines. Do not summarise.
- rate is the main rate of the item as a plain number. If several rate columns exist (for example with and without labour, or for different zones), use the overall "rate" column, or the first one if unsure.
- unit is the unit of measurement as printed (cum, sqm, m, kg, nos, each, etc.).
- chapter is the chapter or sub-head the item falls under, or an empty string.
- Skip unpriced headings, notes and page furniture. Items cut off at the end of the page should still be included if their rate is visible.`;

export async function extractRatesFromText(text, { onProgress } = {}) {
  const res = await structured({
    system: RATES_SYSTEM,
    content: [{ type: "text", text: `<pages>\n${text}\n</pages>\n\nExtract every priced item.` }],
    schema: ratesSchema,
    effort: "low",
    onText: (n) => onProgress && onProgress(n),
  });
  return res.data.items;
}

export async function extractRatesFromImages(images, { onProgress } = {}) {
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Page ${img.page ?? i + 1}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  });
  content.push({ type: "text", text: "Extract every priced item on these pages." });
  const res = await structured({ system: RATES_SYSTEM, content, schema: ratesSchema, effort: "low", onText: (n) => onProgress && onProgress(n) });
  return res.data.items;
}
