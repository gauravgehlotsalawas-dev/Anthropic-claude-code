# PartTwin: cross-vehicle spare-parts interchange finder

Covers **cars, motorcycles, commercial vehicles, aircraft and marine engines**.

A spare part for one car is often expensive or unavailable, while the **same part** is sold cheaply for a different car. For example, a Honda City 1.5 diesel shares its engine with the Amaze, Jazz and WR-V. A Mercedes A180 CDI uses the same Renault K9K engine as the Duster and Nissan Sunny. And a Bentley Continental GT shares its W12 with the VW Phaeton.

PartTwin lets you pick your car and the part you need, then lists every other car that shares that part.

## Run it

It is a static site with no build step and no dependencies.

```bash
open index.html            # or
python3 -m http.server     # then visit http://localhost:8000
```

To publish it, enable **GitHub Pages** on this branch (root folder).

## How the data works (`data/db.js`)

Cars share parts because they share a **component family**: an engine, a gearbox or a platform.

| Entity | Purpose |
|---|---|
| `vehicles` | make, model, engine variant, years, market |
| `families` | a shared engine or platform, the vehicles that use it, and its part groups |
| `families[].parts` | a part that interchanges inside the family, with `confidence` (`high` / `medium` / `low`), an optional `note`, and an optional `only` / `except` list of vehicle ids |

The app works out "also fits" lists by joining vehicles to families to parts. Adding a new car to a family therefore links it to every part in that family at once.

## Features

- **Command-palette search**: press `/` or `Ctrl/⌘ K` anywhere and use the keyboard to move through vehicles, families and parts
- **Guided finder**: pick a vehicle type, then make, then model/engine, then (optionally) the part
- **Twin network graph**: an interactive SVG showing every vehicle that shares parts with yours. Colour shows the best match confidence, and line thickness shows how many parts are shared
- **Closest twins** ranking, with one-click **Compare**
- **Compare page**: any two vehicles side by side, with a tally of shared parts and their confidence levels
- **Part filters**: free-text search with synonyms (nozzle→injector, mounts→mounting), category pills and confidence toggles, all kept in the URL so links can be shared
- **Four confidence levels**: High / Likely / Check fitment / **Do not swap** (flags parts that look shared but are unsafe or incompatible)
- **Safety banners** on aircraft and marine pages
- **My garage**: save vehicles for quick access (stored in the browser)
- **Contribute**: record matches you know and export them as JSON
- Light, dark and auto themes; mobile bottom navigation; reduced-motion support; no dependencies

## ⚠️ Data disclaimer

The seed dataset (129 vehicles across cars, motorcycles, commercial vehicles, aircraft and marine; 32 families) is **hand-curated and illustrative**. It is built from widely known engine and platform sharing, not from OEM catalogues. It deliberately contains **no OEM part numbers**. Users must confirm the part number (VIN lookup or the number stamped on the old part) before buying.

## Roadmap to "every car, every part"

1. **Part-number layer.** Add OEM and aftermarket part numbers per vehicle, so that matching is based on identical part numbers rather than family membership.
2. **Licensed catalogue data.** Use TecDoc (TecAlliance) for cars, bikes and commercial vehicles; OEM EPC catalogues; supplier catalogues (Bosch, Denso, Delphi, NGK, SKF, etc.); aviation IPCs and PMA listings; and marine engine catalogues.
3. **Backend.** Move to Postgres with a search engine (Meilisearch or Typesense), a REST/GraphQL API, and VIN decoding.
4. **Community verification.** Let users submit matches with photos of part numbers, then apply voting and moderation to promote a match from `low` to `high`.
5. **Sourcing.** Add price comparison and links to dealers and marketplaces for each matching part.
