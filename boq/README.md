# RateBook BOQ

A web tool for contractors and engineers that builds bills of quantities (BOQ) and cost estimates from **your own schedules of rates** (BSR / SOR / DSR or a company rate list). It can also prepare a first BOQ straight from drawings.

It is a static site: no server and no build step. All data stays in the browser (IndexedDB).

## Run it

```bash
cd boq
python3 -m http.server 8000     # then open http://localhost:8000
```

To put it online, serve the `boq/` folder from any static host (GitHub Pages, Netlify, an office web server). Opening `index.html` directly from disk does not work, because browsers block ES modules on `file://`.

## How it works

1. **Rate books.** Upload one or more schedules of rates. Supported formats:
   - Excel `.xlsx .xls .xlsm .xlsb`, OpenDocument `.ods`, `.csv`, `.tsv`, HTML tables: the header row and the code / description / unit / rate columns are detected automatically, and you can correct the mapping in a preview before importing. Rows without a rate become parent descriptions, so sub-items like *(a) in CM 1:6* get the full description.
   - PDF with a text layer: lines are rebuilt from the page layout, and item codes, sub-items, units and rates are recognised.
   - Scanned PDF, or layouts the parser gets wrong: **Extract with AI** (Claude or OpenAI) reads the pages, by text or by page image.
   - Word `.docx` (tables or paragraphs), JSON, or rows pasted from a spreadsheet.

   Each rate book has a **cost index %** (area or market premium) applied on top of the book rates. You can view, edit and export any rate book to Excel.
2. **Pick items.** Search across all rate books, filter by book or chapter, and add items with a quantity.
3. **Drawing takeoff.**
   - **With AI (Claude or OpenAI):** upload drawings (PDF, PNG/JPG/WebP, SVG, DXF, CorelDRAW CDR, TIFF/BMP where the browser supports it, plus schedules in Excel, Word or text). The AI measures each work item with a measurement sheet (nos × L × B × D), and lists its assumptions and open questions. It then matches each item to your rate books. Every line is reviewed before it is added: you can change the matched item, the quantity, or include and exclude lines. Large images are sent as an overview plus zoomed tiles, so dimension text stays readable.
   - **Without AI:** a dimension-based takeoff for framed RCC buildings, and a DXF layer measurer that gives the length, closed area and block count per layer.
4. **BOQ & estimate.** Sections, measurement sheets (with deductions), non-schedule items, add-ons (contingencies, GST, cess, profit; each a % of the works total or of the running total), and an abstract of cost with the amount in words (lakh/crore for INR).
5. **Export.** Excel with live formulas (BOQ, abstract linked to section totals, measurement sheet, unpriced tender BOQ), Print / Save as PDF, CSV, and project files for backup and sharing.

## File format notes

| Format | Handling |
|---|---|
| CDR (CorelDRAW X4 and later) | The preview image stored inside the file is used. For accurate takeoff, export to PDF from CorelDRAW. Files from before X4 cannot be read in a browser. |
| DWG | A closed format. Save as DXF or plot to PDF first. |
| DXF | Parsed locally: lines, polylines (with arcs), circles, arcs, text, dimensions and blocks. It is also rendered to an image for the AI. |
| TIFF / HEIC | These open only in browsers that support them (Safari). Otherwise convert them to PNG or PDF. |

## AI provider: Claude or OpenAI

Reading drawings and scanned rate books needs an API key from either provider. Choose the provider in the Settings tab.

- **Claude (Anthropic):** the default model is Claude Opus 5.5. Requests use the official SDK with structured JSON output and server-side refusal fallbacks.
- **OpenAI:** paste your key and press **Test key**. The tool lists the GPT models your key can use and selects the newest one; you can change it in the list. Requests use Chat Completions with a strict JSON schema, and PDFs are sent as file inputs. If the chosen model rejects an option, the tool adjusts the request and retries: it drops `reasoning_effort`, lowers the output-token limit, or sends PDF pages as images.

Each provider's key is stored separately in this browser (session storage, or local storage if you tick "Remember"). A key is sent only to its own provider's API, and usage is billed to your account with that provider.

AI takeoffs are a starting point for an estimator, not a substitute for one. Check the quantities against the drawings before you tender.

## Code layout

```
boq/
  index.html, styles.css
  js/app.js          UI and workflow
  js/store.js        IndexedDB storage, quantity and abstract maths, number formatting, amount in words
  js/bsr-import.js   rate-book parsing (Excel/CSV/PDF/Word/text)
  js/blueprint.js    drawing preparation (PDF, images, SVG, DXF parser and renderer, CDR preview)
  js/ai.js           AI calls to Claude or OpenAI (takeoff and rate extraction)
  js/match.js        local search and fuzzy matching of work items to rate-book items
  js/quick.js        dimension-based takeoff
  js/export.js       Excel, print/PDF and CSV output
  js/sample.js       sample rate book (demo rates only)
  vendor/            SheetJS 0.18.5, pdf.js 6.4, a browser bundle of @anthropic-ai/sdk 1.3 and fflate
```
