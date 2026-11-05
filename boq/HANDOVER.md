# RateBook BOQ: handover notes

Read this first, then `README.md` (user-facing feature list). These notes are for a developer or an AI
assistant continuing the work.

## 1. What it is

A web tool for Indian (Rajasthan) contractors and engineers. It runs entirely in the browser; there is no
server and no build step.

- **Live:** https://gauravgehlotsalawas-dev.github.io/Anthropic-claude-code/boq/
- **Repository:** `gauravgehlotsalawas-dev/Anthropic-claude-code`, folder `boq/`
- **Branches:**
  - `claude/boq-estimator` is the working branch.
  - `claude/cross-car-parts-database-0ivvqo` is the repository's default branch. GitHub Pages serves it.
  - Another project, **SiteSaakshi** (folder `saakshi/`), is also pushed to the default branch. **Merge, never force-push.** Fetch first, merge `claude/boq-estimator` into it, then push.
- **Main users:** contractors working on an **iPad with Safari**. Phones are also used. Everything must work in Safari.

## 2. Run, test, deploy

```bash
cd boq && python3 -m http.server 8123      # open http://localhost:8123
python3 tools/version.py                   # before every deploy: stamps ?v= on every module URL (import map)
git push origin claude/boq-estimator
git push origin HEAD:claude/cross-car-parts-database-0ivvqo   # if rejected: fetch, merge, push (other project shares it)
```

- **Testing:** use Playwright with Chromium (headless) to drive the real UI.
  - Load the demo with *Bills → Load demo (Gaurav Nagar Nigam)*.
  - Upload the sample NIC `.xls` and PDFs.
  - Print with `page.emulateMedia({media:'print'})` and `page.pdf()`.
  - To get close to Safari's printable area, call `page.pdf` with `displayHeaderFooter: true` and margins of about 16 mm.
- **Safari quirks already handled:**
  - Time and number pickers may fire only `change`, so lists listen to both `input` and `change`.
  - Safari ignores named and landscape `@page` rules. Landscape content is therefore drawn as a box rotated by −90° on a portrait A4 sheet (`.p-rot` / `.p-rot-in`). The deviation statement is produced as a real landscape PDF with pdf-lib.
  - `blob:` images sometimes print broken, so print pages use data URLs.
  - An old open tab can block an IndexedDB version upgrade. Never bump a database version; add a new database instead.
  - The in-app browser of other apps injects scripts, so the error banner in `index.html` ignores "Script error." and errors from files outside the site.

## 3. Architecture

- **Static ES modules** in `js/`, all loaded by `js/app.js`.
- **Vendor libraries** are in `vendor/`:
  - SheetJS 0.18.5 (global `XLSX`, includes `XLSX.CFB`);
  - pdf.js;
  - pdf-lib 1.17.1;
  - `libs.mjs` (Anthropic SDK, plus fflate's `unzipSync` and `strFromU8`);
  - `ocr/` (Tesseract.js v5 with English and Hindi data, used on the device).
- **Storage** is IndexedDB, wrapped in `js/store.js` by `idb.all/get/put/del(store, …)`, which picks the database by store name.
  - Database `ratebook-boq` has the stores `bsrs`, `projects` and `kv`.
    - `projects` holds estimates (no `kind`) and bill works (`kind: "bill"`).
    - `kv` holds settings, the current ids, `company`, `tenderPrefs` and `myTenders`.
  - Database `ratebook-site` has the stores `sites`, `diary`, `files` (blobs) and `expenses`.
- **Cache safety:** `tools/version.py` writes an import map that adds `?v=` to every module, plus `window.APP_VERSION`.
- **Errors:** the `#guard` script in `index.html` shows start-up errors on the page.

| Tab | Module | What it does |
|---|---|---|
| 1–4 Rate books, Pick items, Drawing takeoff, BOQ & estimate | `app.js`, `bsr-import.js`, `match.js`, `quick.js`, `blueprint.js`, `ai.js`, `export.js` | Estimates from the user's own schedule of rates (BSR/SOR). AI takeoff (Claude/OpenAI key) is optional |
| 5 e-Tender BOQ | `nicboq.js` | Reads and writes NIC GePNIC BOQ `.xls` templates (BIFF8 binary editing, macros kept) |
| 6 Bills (MB) | `bills.js`, `docread.js`, `demo.js` | Contractor's running and final bills (P.W.A. Form 27G), part rates, MB references, extra items, deviation, photos. **No AI here** |
| 7 Site diary | `site.js`, `materials.js`, `docs.js`, `files.js` | Sites; daily entry (labour, machinery rent, work done with L×B×H/shapes, materials received and consumed); GPS camera; gallery; DPR/WPR/MPR; documents; STP application; BOQ progress |
| 8 Office | `office.js` | Purchase bills with OCR → accounts Excel/ZIP for the CA; company documents; company profile; full backup and restore |
| 9 Tenders | `tenders.js`, `nicboq.js` | Alert choices; matching tenders from `data/tenders.json` (feed not built yet); my tenders with reminders; **Bid BOQ**: fill the downloaded NIC BOQ (bidder name in B8, rates in column M for Item Rate / Item Wise, Excess/Less/At Par + % in the row under "Total in Figures" for Percentage; F holds a fraction, 5.25 % = 0.0525; At Par needs F = 0) with `readBidderBoq` / `checkBid` / `bidAmounts` / `fillBidderBoq` |

### Key functions

- **`bills.js`**
  - Bill model and maths:
    - `contract(p)`, `lines(p)` (G tender items, G extras, H items);
    - `computeBill(p, bill)` (gross G, T.P., H at agreement rates, previous bill, net, SAY);
    - `billNo`, `billTitle`, `formTitle` (roman ordinal, e.g. "IInd Running Bill"), `parseEntry`.
  - Prints:
    - `form27g()`: measured pagination (`.f-measure`, page height 258 mm), Carried Over / B/F rows, last page filled with a diagonal;
    - `certificateBlock`, `memorandum`, `extraSlip`;
    - `deviationSheet()`: HTML version, landscape by rotation;
    - `deviationPdf()` / `openDeviationPdf()`: the Print button uses this real landscape PDF;
    - `mbAbstract()`, `fitPages()`: scales a page that is too long.
  - Uploads: `extractBoq(files)` (exported; NIC xls / NIC PDF columns / OCR), `reviewBoq`, `loadWorkOrder` + `parseWorkOrder` (in `docread.js`).
  - Dialogs: `mbRefsDialog`, `addExtraDialog`.
  - `deleteExtras` also removes the item from every bill.
- **`site.js`**
  - Daily entry: `entry(day)`, `saveEntry`/`saveNow`, `rowTable`.
  - Amounts: `CALC.labour` (count × rate) and `CALC.machinery` (hour/day/trip; hours from start/end with `timeDiff`).
  - Work done: `workTable`, `measuredQty` (rect / tri ½ / trapezium / circle; negative Nos is a deduction), `measureText`, BOQ picker `acMatches`/`showAc`/`pickAc`, `doneUpTo`, `workInfo`, `overall`, `progressView`, `heroStats`, `ring`.
  - Reports: `aggregate`, `materialStatus`, `printReport`, `reportExcel`.
  - Photos: clean photos are saved with `stamped:false` and stamped only at export by `stamped()` / `photoExportDialog` / `photoSheets`.
  - STP: `stpCard`, `stpPrintHtml` (Hindi application to the Mining Engineer).
  - Site creation: `bindDocPicker` (reads the work order and BOQ to fill the form).
- **`materials.js`:** `itemMaterials(desc, unit, qty)` reads the mix (1:4:8, 1:1½:3), grade (M20/M25), plaster thickness, brick and stone masonry, and steel. `estimateMaterials(items)` adds them up.
- **`files.js`:** `saveFile`, `readExif`, `getPosition`, `reverseGeocode` (OpenStreetMap), `stampPhoto`, `thumbOf`, `scanEnhance`, `mergeToPdf` (pdf-lib), `makeZip` (stored ZIP), `blobToDataUrl`.

### Main records

- **Bill work (a project with `kind:"bill"`):**
  - `sections[].items[]` hold `{id, description, unit, qty, rate, schedule:"G"|"H", sno}`;
  - `contract{contractor, workOrderNo, woDate, tpPct, tpDir, extraLimitPct, commence, stipulated, completed, jen, aen, xen, office, terms[], hRates[], devOrient}`;
  - `extras[]`, `bills[]`, `photos[]`.
- **Bill:** `{id, kind:"running"|"final", number?, date, measured, mbNo, mbPages, jen, aen, qty{itemId: number|"q@r + q@r"}, parts{itemId:[{qty,rate}]}, partRate{itemId:rate}, mbRefs{itemId:[{page,qty,rate}]}, mbs{itemId: MB S.No}}`.
  - The final bill keeps part rates; only its title changes.
- **Site:** `{id, name, workOrderNo, woDate, client, location, amount, startDate, endDate, contractor, engineer, jen, aen, xen, folders[], boqItems[{sno, description, unit, qty, rate, schedule}], terms[], stp{district, appDate, minerals[], permitNo, permitDate, royalty, rawanna, assessed, noDues}}`.
- **Diary entry** (`id = siteId|YYYY-MM-DD`):
  - `labour[{type,count,rate,agency}]`;
  - `machinery[{name,count,basis,rate,start,end,hours}]`;
  - `work[{desc,boq,loc,shape,nos,l,l2,b,h,qty,unit}]`;
  - `materials[{name,qty,unit,supplier,challan}]`, `consumed[{name,qty,unit,usedFor}]`;
  - `weather, hours, hindrance, visitors, remarks`.
- **File:** `{id, owner: siteId|"company", kind:"photo"|"doc"|"bill", folder, name, type, size, blob, date, caption, gps{lat,lon,acc,address}, thumb, stamped}`.
- **Expense:** `{id, date, vendor, gstin, billNo, category, owner, taxable, gst, total, pay, note, fileId}`.

## 4. The user's requirements (keep them)

- **Language:** the user writes in Hinglish. Answer in short Hinglish and keep answers economical. The app's UI text is English, but Hindi documents (such as the STP application) are in Hindi.
- **Prints must look like the department's papers.** Reference documents are the Keru work (Nagar Nigam Jodhpur, W.O. 2026-2027/3260047 dt. 18.05.2026, T.P. 1 % below, contract value 49,26,831).
  - Form 27G running/final bill with page 3 memorandum and certificate.
  - The extra item slip prints **portrait**.
  - Photo sheets: **4 per page, landscape**, with the work name and W.O. No. on top and JEN/AEN/XEN signature spaces below.
  - Deviation statement: **landscape, filling the whole page** (real PDF).
  - Pages must look full; the last page must never hold only 2–4 lines.
- **Bills tool: no AI or API.** Use OCR (Tesseract on the device) and parsers only.
- **The MB serial number** is the contractor's own number, not the BOQ number. Previous bills can be entered so that the 2nd, 4th or final bill is exact.
- **Tabs 1–5 and tab 6 (bill works) keep separate data.** Site diary sites are separate too.
- **Never generate government-issued documents** (for example the STP permit signed by the Mining Engineer). Only the contractor's applications and records.
- **Do not bypass captchas or log-ins** on eProc.

## 5. Verified figures (use them as regression checks)

- **Keru bill:** net 31,55,498.64, SAY 31,55,499.
- **Keru deviation grand totals:** 49,26,831.03 / 31,55,498.64 / 3,42,644.70 / 2,38,400.15 / 23,52,377.23.
- **Demo (Gaurav Nagar Nigam):**
  - 2nd bill deducts the 1st bill's total of 24,20,443.91;
  - executed total 64,82,601.52;
  - deviation PDF shows 2 landscape pages.
- **Keru BOQ `.xls`:** 19 G-Schedule items and 1 H-Schedule item (1.01, painting). The Keru PDF holds only the G part.
- **Materials from the Keru BOQ:** cement about 1,817 bags, steel 3,605 kg.

## 6. Open items and ideas

1. **eProc tender scraper + alerts.**
   - Plan: run a GitHub Actions cron every 2–3 h on public listing pages only (no captcha).
   - It writes `boq/data/tenders.json` with tender fields `{id, tenderId, title, org, district, value, emd, type, bidEnd, opening, link, status}` and `updated`.
   - Alerts go to a Telegram bot (token kept in repository secrets; `getUpdates` is polled in the same job), then email.
   - Needs `eproc.rajasthan.gov.in` allowed in the session's network settings so the parser can be tested.
2. **Server, log-in and sync** across devices. Until then the data lives on the device (backup ZIP in Office).
3. Print the **complete bill file as one PDF**, with the bill in portrait and the deviation in landscape.
4. **Two-tab NIC BOQ writer** (BoQ1 Item Rate = H, BoQ2 Percentage = G in one `.xls`): deferred by the user.
5. JEN/AEN names are not read from blurry work-order scans.
6. A way to forget "Used before" (non-BOQ) work names in the work-done picker.
7. Chatbot that drives the app by chat: discussed, then parked by the user.
