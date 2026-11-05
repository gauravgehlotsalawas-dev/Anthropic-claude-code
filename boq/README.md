# RateBook BOQ

A web tool for contractors and engineers that builds bills of quantities (BOQ) and cost estimates from **your own schedules of rates** (BSR / SOR / DSR or a company rate list). It can also prepare a first BOQ straight from drawings.

It is a static site: no server and no build step. All data stays in the browser (IndexedDB).

## Run it

```bash
cd boq
python3 -m http.server 8000     # then open http://localhost:8000
```

Before each deploy run `python3 tools/version.py`: it stamps a version on every script URL, so browsers never mix new files with old cached ones.

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
   - **Review before anything reaches the estimate.** Every takeoff (AI, quick or DXF) lands in a draft that is saved with the project. For each line you can keep or remove it, delete it, duplicate it, edit its section, description, unit or quantity, open its Nos × L × B × D measurement sheet, and change the matched rate-book item or enter a rate. Filters show lines to add, removed lines, lines already in the BOQ, and lines that **need attention**: no rate, a unit mismatch, zero quantity, low confidence, or a possible duplicate. Bulk Keep, Remove and Delete act on whatever the filter shows, so for example you can filter low-confidence lines and remove them all at once. You can also add lines by hand. A new takeoff can be appended to the current draft, and lines that use a rate-book item already in the BOQ can be combined into that line's measurements.
4. **BOQ & estimate.** Multi-select with bulk move, duplicate and delete; **Undo / Redo** for every change (buttons or Ctrl+Z / Ctrl+Shift+Z); sections, measurement sheets (with deductions), non-schedule items, add-ons (contingencies, GST, cess, profit; each a % of the works total or of the running total), and an abstract of cost with the amount in words (lakh/crore for INR).
5. **Export.** Excel with live formulas (BOQ, abstract linked to section totals, measurement sheet, unpriced tender BOQ), Print / Save as PDF, CSV, and project files for backup and sharing.

## e-Tender BOQ for NIC / GePNIC portals (tab 5)

Departments that publish tenders on GePNIC portals, such as eproc.rajasthan.gov.in, must upload the BOQ in the portal's own Excel template (`BoQ_Ver3.0` / `BoQ_Ver4.0`, an .xls file with VBA macros, a very hidden `BoQ1` sheet, locked cells and validation lists). This tab writes the project's BOQ into that template:

1. **Add the template.** Use the blank BoQ template from the portal's Downloads section, or any BOQ .xls from a previous tender of the same type. Percentage, Item Rate and Item Wise BoQs are detected automatically, and templates are kept in the browser.
2. **Tender details.** Fill in the Tender Inviting Authority, Name of Work and Contract/NIT No. (rows 4 to 6). Then choose **All items**, **G-Schedule** (items from a rate book, BSR) or **H-Schedule** (non-BSR items). Change any item's schedule with its G/H button in the BOQ tab. Sections can be written as heading rows numbered 1, 1.01, 1.02 and so on.
3. **Check and download.** The tool checks the rules the template's own macro checks: unit present when there is a quantity, an estimated rate for every item of a Percentage BoQ, unique serial numbers, the bidder-name caption in A8 and a blank B8. Then it downloads the filled .xls.

What changes in the file: only the item rows of `BoQ1`. The `Total in Figures` and `Quoted Rate` rows move down. Their formulas, the drop-downs, merged cells and drawing objects are moved to match, and each new row gets the template's formulas (Addition/Deduction, amount and amount-in-words). On heading rows the bidder's rate cell is locked; on item rows it is unlocked, as the macro expects. The macros (the VBA streams) and the rest of the workbook are copied byte for byte. The department copy is saved unprotected, because GePNIC's department validation runs on an unprotected sheet.

**Before uploading:** open the file in Microsoft Excel, click *Enable Content*, check the items and press *Ctrl+S*. The template's own validation runs on save. Then upload the file to the portal. Check the first file you make on the portal's BOQ validation before relying on the tool for a live tender.

**Import:** "Import items" on a template, or *Import e-tender BOQ (.xls)* in the BOQ tab, turns any GePNIC BOQ into a project. Contractors can use this to price a tender BOQ against their own rates.

## Bills from the measurement book (tab 6)

The Bills tab keeps its own list of works, separate from the estimates and e-tender BOQs of tabs 1–5: nothing loaded for a bill appears in the BOQ or e-Tender tabs, and the other way round. While the Bills tab is open, the selector at the top lists the bill works and **＋** starts a new one. Rate books are shared.

For contractors, based on the project's BOQ (import the tender BOQ .xls; files with BoQ1 and BoQ2, for H- and G-Schedule, are read together):

- **Start from the documents:** upload the work order and the BOQ as PDF (typed or scanned), Excel, Word or photos. Typed PDFs and spreadsheets are read directly; scans and photos are read on the computer with Tesseract OCR (English and Hindi, bundled in `vendor/ocr`, no internet service or API key). From the work order the tool picks the contractor, work order No. and date, amount, T.P. %, dates, office, engineers, H-Schedule rates and terms. You check every value in a review dialog, and empty or doubtful cells are highlighted. After loading, the contract value is checked against the work order amount. Uploading the BOQ also fills the name of work, department and NIT No. from its header.
- **Contract:** contractor, work order / agreement No. and dates, tender premium (T.P.) % below or above, and the limit for extra items (default 5% of the contract value).
- **Bill (M.B. entry):** for each running bill, enter the up-to-date quantity of every item from the M.B. Part rates: one reduced rate for the whole quantity, or **＋ part rate** to split an item, for example 20 cum at the full rate and 20 cum at a part rate. Each split prints as its own line under the item, with the amount at full rate and the amount withheld. Typing `237.74@384.5 + 409.5@159` also works. The bill is printed page by page with *Carried Over* and *B/F* totals and page numbers, as in the department's forms. The bill works out amount up-to-date and since previous, G-Schedule total, less or add T.P., H-Schedule at the agreement rates, previous bill, net and SAY. Any bill can be made the final bill: everything stays as entered (part rates, previous bill, deductions), only the title becomes *Final Bill*. It prints as the full P.W.A. Form 27G: notes, the bill details block, I Account, footnotes, II Certificate and signatures, III Memorandum of payment, and the work order's terms. **Print complete bill file** adds the extra item slip, deviation statement and photo sheets. Excel export is also available.
- **M.B. references:** *MB refs* under an item's quantity takes one line per measurement book page (e.g. `10/02 → 237.74 cum`, with a part rate if allowed). The total becomes the up-to-date quantity, and **MB abstract** prints the abstract of cost as written in the M.B.: *Qty B/F this M.B. page no. …* lines, total, qty @ rate = amount, T.P., G + H totals, previous bill and net.
- **Previous bills:** for the 2nd, 4th or final bill, press *Enter last submitted bill*, choose its number (e.g. 3) and type its up-to-date quantities and rates. The next bill (4th or final) continues from it, so *since previous bill*, *deduct previous bill* and the deviation stay exact.
- **MB serial numbers:** each item takes its serial number from the measurement book / bill (*MB S.No*). The bill prints in that order as `MB S.No / BOQ No.` (`Ex` for extra items). A search box finds items quickly.
- **Extra items:** items not in the BOQ (picked from a rate book or typed), billed in the G-Schedule with T.P. The extra item slip prints, and the tool warns when extras pass the limit.
- **Deviation statement:** tender quantity, rate and amount against executed figures, with excess, extra and saving columns, T.P. and G/H totals. **Print** makes it as a PDF with real landscape A4 pages filled edge to edge (extra items and H-Schedule items under their own headings, column heads on every page, signatures at the end), so it comes out the same on every device; portrait can be chosen next to the button. In the complete bill file it prints landscape too.
- **Photos:** drop site photos; they print four to a page, laid out landscape (turned on the A4 sheet, so Safari / iPad prints them horizontally too), with the name of work and work order No. on top and JEN / AEN / XEN signature spaces at the bottom.

## Site diary (tab 7)

One folder per construction site (the selector at the top lists sites while this tab is open; **＋** adds one). When making a site you can add the work order, the BOQ and other documents (agreement, drawings, letters): the name of work, W.O. No. and date, department, amount, dates, contractor and engineers are read from them to fill the form, the BOQ items become the work items offered in the daily entry, and every file is saved in the site's folders. The same can be done later from *Site details*.

- **Daily entry:** labour in groups with their daily rate (e.g. 4 at ₹700 and 6 at ₹900 from the chowk) and amount; machinery on rent per hour (start and end time give the hours), per day or per trip, with the amount; work done (measured as Nos × L × B × H for a rectangle, ½ × base × height × thickness for a triangle, (L + L2)/2 × B × H for a trapezium or π/4 × D² × H for a circle, so the quantity is worked out; a minus Nos is a deduction; type a few words or the BOQ No. and pick the BOQ item: its full description, unit and BOQ No. are filled in, with tender quantity, done to date and balance; reports carry the BOQ No.), location, quantity and unit; materials received (supplier, challan) and materials consumed; hindrances, instructions and remarks. *Copy last day's labour* saves typing.
- **Materials for the work:** from the BOQ items (mix such as 1:4:8 or 1:1½:3, grade such as M20 / M25, plaster thickness, brick and stone masonry, steel), the approximate cement, sand, aggregate, steel and bricks needed, item by item, with the material account: required, received, consumed, balance at site and still to come. Common site thumb rules; the department's analysis of rates governs.
- **GPS camera:** choose the site, write what the photo is about, and choose what is stamped on it: GPS location, address (needs internet), date and time, site name and W.O. No. (or nothing). *Take photo* opens the camera on a phone or tablet; *Choose from gallery* reads the date and GPS position stored in the photo. Photos go to that site's gallery and to that day's DPR. The photo is kept clean with its details; what is stamped on it (work name and W.O. No., caption, GPS location, address, date and time, or nothing) is chosen again each time photos are printed or downloaded.
- **Gallery:** by date, with captions, search, select, print four to a page (with name of work, W.O. No. and JEN / AEN / XEN), download as ZIP, move to another site.
- **Reports:** DPR (a day), WPR (a week), MPR (a month) or any period: labour (man-days), work done in the period and up to date, materials, machinery, hindrances and remarks, a day-wise summary and photo sheets. Print / save as PDF, or Excel.
- **Mining permit (STP), option 'C':** the application to the Mining Engineer (in Hindi) is filled from the work order, the company profile and the minerals worked out from the BOQ (sand, aggregate, masonry stone in cum and tonnes, editable). After the permit is issued, record its No. and date, keep the rawanna / royalty receipts in the STP folder, and tick the royalty assessment and the no-dues certificate needed before the final bill. The permit itself comes from the mining office; the tool does not make it.
- **Documents:** folders per site (work order, agreement, BOQ, drawings, test reports, STP, MB & bills, letters, challans, your own folders). Upload any file, scan pages with the camera (cleaned up and saved as one PDF), tick documents and merge them into one PDF, or download them as a ZIP.

## Office (tab 8)

- **Purchase bills & accounts:** photograph or upload a bill; the date, bill No., GSTIN, GST and total are read on the device (OCR) for you to check, with the category and site. Filter by month, financial year, site or category. **Excel for CA** gives the purchase register with totals by category, site and vendor; **Excel + bill copies (ZIP)** adds every bill copy, named by date, vendor and amount.
- **Company documents:** the same folders, upload, scan and merge as for sites (registration, PAN & GST, experience certificates, bank, tender documents…).
- **Company profile:** printed on the progress reports.
- **Backup & storage:** all data stays in the browser on that device. **Download full backup (ZIP)** regularly and keep it on Drive or email; **Restore** it on another device to move everything there.

## Tenders (tab 9)

- **My alerts:** each contractor chooses the tenders they want: departments (PWD, PHED, Nagar Nigam / LSG, development authorities, UIT, RUIDP, Water Resources, Panchayati Raj, RSRDC, RIICO, power companies and more), districts of Rajasthan, the amount (presets such as up to ₹25 L or ₹1–5 Cr, or their own range in lakh), the tender type (works, goods, services), kinds of work (road, building, drain, water supply, bridge, electrical, painting, repair…), words that must or must not appear, how many days before the bid end to be reminded, and how to be alerted (in the app; Telegram and email once the alert service runs). A sentence sums up the choices. Alerts can be paused or the choices cleared at any time.
- **Matching tenders:** tenders from the feed (`data/tenders.json`, written by the eProc scraper once it is switched on) that match the choices, with value, EMD, bid end and opening dates, a link to eProc and *Track*.
- **Bid BOQ (fill rates):** open the BOQ `.xls` downloaded from the tender on the portal. Enter the bidder's name (cell B8) and either a rate for every item (Item Rate and Item Wise BoQs; a "rates = estimate − %" helper is offered where estimated rates are given) or the offer below, above or at par with a percentage (Percentage BoQ). The amounts, totals, quoted amount and amount in words are worked out as the template does. **Check** lists what must be fixed (missing name or rates, no offer chosen, a percentage of 100 or more…) and what to look at. **Save** writes the same `.xls`, under the same file name, with its macros and protection kept and only the bidder's cells filled (percentages are stored as the template expects: 5.25 % as 0.0525). The draft is kept on the device until closed.
- **My tenders:** tenders being studied or bid, with status (studying, bid submitted, L1, work order received…) and a reminder when the app opens before the bid end and the opening date.

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
  js/nicboq.js       reads and writes NIC GePNIC BOQ templates (BIFF8 .xls with macros)
  js/bills.js        contractor's bills from the measurement book (tab 6)
  js/site.js         site diary, GPS camera, gallery and DPR / WPR / MPR (tab 7)
  js/office.js       accounts, company documents and backup (tab 8)
  js/docs.js         document folders, scan and merge
  js/files.js        photo stamping, EXIF, ZIP and PDF helpers
  js/tenders.js      tender alert choices, matching tenders and my tenders (tab 9)
  js/materials.js    approximate materials from BOQ items
  js/sample.js       sample rate book (demo rates only)
  vendor/            SheetJS 0.18.5, pdf.js 6.4, pdf-lib 1.17.1 (MIT), a browser bundle of @anthropic-ai/sdk 1.3 and fflate
```
