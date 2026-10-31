/*
 * PartTwin seed database
 * ----------------------
 * Model: cars share parts because they share a COMPONENT FAMILY
 * (an engine, a gearbox or a platform). Every part listed under a family is
 * a candidate for interchange between all vehicles in that family.
 *
 * confidence:
 *   "high"   - same engine/platform code, part is normally identical across the family
 *   "medium" - often identical, but varies with power tune / model year / emission norm
 *   "low"    - same family but fitment usually depends on body/variant; compare dimensions
 *
 * `only`   - restrict a part to a subset of the family's vehicles (ids)
 * `except` - exclude vehicles from a part's interchange list (ids)
 *
 * IMPORTANT: this is illustrative seed data compiled from widely known
 * engine/platform sharing. It is NOT an OEM catalogue. Always confirm the
 * OEM part number (via VIN / EPC lookup) before buying.
 */

window.PARTTWIN_DB = {
  version: "0.1.0",

  vehicles: [
    // ---------- Honda (India) ----------
    { id: "honda-city-4g-d",   make: "Honda", model: "City",   variant: "1.5 i-DTEC diesel (4th gen)", years: "2014–2020", market: "India" },
    { id: "honda-city-5g-d",   make: "Honda", model: "City",   variant: "1.5 i-DTEC diesel (5th gen)", years: "2020–2023", market: "India" },
    { id: "honda-amaze-1g-d",  make: "Honda", model: "Amaze",  variant: "1.5 i-DTEC diesel (1st gen)", years: "2013–2018", market: "India" },
    { id: "honda-amaze-2g-d",  make: "Honda", model: "Amaze",  variant: "1.5 i-DTEC diesel (2nd gen)", years: "2018–2023", market: "India" },
    { id: "honda-jazz-3g-d",   make: "Honda", model: "Jazz",   variant: "1.5 i-DTEC diesel (3rd gen)", years: "2015–2020", market: "India" },
    { id: "honda-wrv-d",       make: "Honda", model: "WR-V",   variant: "1.5 i-DTEC diesel",           years: "2017–2023", market: "India" },
    { id: "honda-mobilio-d",   make: "Honda", model: "Mobilio",variant: "1.5 i-DTEC diesel",           years: "2014–2017", market: "India" },
    { id: "honda-brv-d",       make: "Honda", model: "BR-V",   variant: "1.5 i-DTEC diesel",           years: "2016–2020", market: "India" },

    // ---------- Fiat 1.3 Multijet users ----------
    { id: "maruti-swift-ddis",   make: "Maruti Suzuki", model: "Swift",        variant: "1.3 DDiS diesel",  years: "2007–2020", market: "India" },
    { id: "maruti-dzire-ddis",   make: "Maruti Suzuki", model: "Dzire",        variant: "1.3 DDiS diesel",  years: "2008–2020", market: "India" },
    { id: "maruti-ritz-ddis",    make: "Maruti Suzuki", model: "Ritz",         variant: "1.3 DDiS diesel",  years: "2009–2016", market: "India" },
    { id: "maruti-ertiga-ddis",  make: "Maruti Suzuki", model: "Ertiga",       variant: "1.3 DDiS diesel",  years: "2012–2019", market: "India" },
    { id: "maruti-ciaz-ddis",    make: "Maruti Suzuki", model: "Ciaz",         variant: "1.3 DDiS SHVS",    years: "2014–2020", market: "India" },
    { id: "maruti-brezza-ddis",  make: "Maruti Suzuki", model: "Vitara Brezza",variant: "1.3 DDiS diesel",  years: "2016–2020", market: "India" },
    { id: "maruti-baleno-ddis",  make: "Maruti Suzuki", model: "Baleno",       variant: "1.3 DDiS diesel",  years: "2015–2020", market: "India" },
    { id: "tata-vista-qjet",     make: "Tata",          model: "Indica Vista", variant: "1.3 Quadrajet",    years: "2008–2015", market: "India" },
    { id: "tata-zest-qjet",      make: "Tata",          model: "Zest",         variant: "1.3 Quadrajet",    years: "2014–2019", market: "India" },
    { id: "tata-bolt-qjet",      make: "Tata",          model: "Bolt",         variant: "1.3 Quadrajet",    years: "2015–2019", market: "India" },
    { id: "fiat-punto-mjd",      make: "Fiat",          model: "Punto / Grande Punto", variant: "1.3 Multijet", years: "2005–2018", market: "Europe / India" },
    { id: "fiat-linea-mjd",      make: "Fiat",          model: "Linea",        variant: "1.3 Multijet",     years: "2007–2018", market: "Europe / India" },
    { id: "opel-corsa-d-cdti",   make: "Opel / Vauxhall", model: "Corsa D",    variant: "1.3 CDTi",         years: "2006–2014", market: "Europe" },
    { id: "chevrolet-sail-d",    make: "Chevrolet",     model: "Sail",         variant: "1.3 SMARTECH diesel", years: "2012–2017", market: "India" },
    { id: "suzuki-swift-eu-ddis",make: "Suzuki",        model: "Swift",        variant: "1.3 DDiS diesel",  years: "2005–2016", market: "Europe" },

    // ---------- Renault K9K 1.5 dCi users ----------
    { id: "renault-duster-dci",  make: "Renault",  model: "Duster",       variant: "1.5 dCi K9K",   years: "2012–2020", market: "India / Europe (Dacia)" },
    { id: "nissan-terrano-dci",  make: "Nissan",   model: "Terrano",      variant: "1.5 dCi K9K",   years: "2013–2020", market: "India" },
    { id: "nissan-sunny-dci",    make: "Nissan",   model: "Sunny",        variant: "1.5 dCi K9K",   years: "2011–2020", market: "India" },
    { id: "renault-scala-dci",   make: "Renault",  model: "Scala",        variant: "1.5 dCi K9K",   years: "2012–2017", market: "India" },
    { id: "nissan-micra-dci",    make: "Nissan",   model: "Micra (K13)",  variant: "1.5 dCi K9K",   years: "2010–2020", market: "India" },
    { id: "renault-pulse-dci",   make: "Renault",  model: "Pulse",        variant: "1.5 dCi K9K",   years: "2012–2017", market: "India" },
    { id: "mahindra-logan-dci",  make: "Mahindra", model: "Logan / Verito", variant: "1.5 dCi K9K", years: "2007–2019", market: "India" },
    { id: "renault-lodgy-dci",   make: "Renault",  model: "Lodgy",        variant: "1.5 dCi K9K",   years: "2015–2019", market: "India" },
    { id: "renault-captur-dci",  make: "Renault",  model: "Captur",       variant: "1.5 dCi K9K",   years: "2013–2020", market: "Europe / India" },
    { id: "nissan-qashqai-dci",  make: "Nissan",   model: "Qashqai J10/J11", variant: "1.5 dCi K9K", years: "2007–2021", market: "Europe" },
    { id: "merc-a180-cdi-w176",  make: "Mercedes-Benz", model: "A 180 CDI (W176)", variant: "1.5 CDI (OM607 = K9K)", years: "2012–2018", market: "Europe" },
    { id: "merc-citan-cdi",      make: "Mercedes-Benz", model: "Citan",   variant: "1.5 CDI (OM607 = K9K)", years: "2012–2021", market: "Europe" },

    // ---------- VW Group India 2.0 (MQB-A0-IN) ----------
    { id: "skoda-kushaq",   make: "Skoda",      model: "Kushaq",  variant: "1.0 / 1.5 TSI", years: "2021–", market: "India" },
    { id: "skoda-slavia",   make: "Skoda",      model: "Slavia",  variant: "1.0 / 1.5 TSI", years: "2022–", market: "India" },
    { id: "vw-taigun",      make: "Volkswagen", model: "Taigun",  variant: "1.0 / 1.5 TSI", years: "2021–", market: "India" },
    { id: "vw-virtus",      make: "Volkswagen", model: "Virtus",  variant: "1.0 / 1.5 TSI", years: "2022–", market: "India" },

    // ---------- VW Group PQ25 (older India) ----------
    { id: "vw-polo-6r",     make: "Volkswagen", model: "Polo (6R/6C)", variant: "1.2 / 1.5 TDI / 1.2 TSI", years: "2010–2022", market: "India" },
    { id: "vw-vento",       make: "Volkswagen", model: "Vento",        variant: "1.6 / 1.5 TDI / 1.2 TSI", years: "2010–2022", market: "India" },
    { id: "skoda-rapid",    make: "Skoda",      model: "Rapid (India)",variant: "1.6 / 1.5 TDI / 1.0 TSI", years: "2011–2021", market: "India" },
    { id: "vw-ameo",        make: "Volkswagen", model: "Ameo",         variant: "1.2 / 1.5 TDI",           years: "2016–2020", market: "India" },

    // ---------- Toyota–Suzuki rebadges ----------
    { id: "maruti-baleno-k12",  make: "Maruti Suzuki", model: "Baleno",          variant: "1.2 K12 petrol",  years: "2019–", market: "India" },
    { id: "toyota-glanza",      make: "Toyota",        model: "Glanza",          variant: "1.2 K12 petrol",  years: "2019–", market: "India" },
    { id: "maruti-brezza-k15",  make: "Maruti Suzuki", model: "Vitara Brezza",   variant: "1.5 K15 petrol",  years: "2020–2022", market: "India" },
    { id: "toyota-urban-cruiser", make: "Toyota",      model: "Urban Cruiser",   variant: "1.5 K15 petrol",  years: "2020–2022", market: "India" },
    { id: "maruti-grand-vitara", make: "Maruti Suzuki", model: "Grand Vitara",   variant: "1.5 K15C mild-hybrid", years: "2022–", market: "India" },
    { id: "toyota-hyryder",     make: "Toyota",        model: "Urban Cruiser Hyryder", variant: "1.5 K15C mild-hybrid", years: "2022–", market: "India" },
    { id: "maruti-ertiga-k15",  make: "Maruti Suzuki", model: "Ertiga",          variant: "1.5 K15 petrol",  years: "2018–", market: "India" },
    { id: "toyota-rumion",      make: "Toyota",        model: "Rumion",          variant: "1.5 K15 petrol",  years: "2023–", market: "India" },
    { id: "maruti-swift-k12",   make: "Maruti Suzuki", model: "Swift",           variant: "1.2 K12 petrol",  years: "2018–2024", market: "India" },
    { id: "maruti-dzire-k12",   make: "Maruti Suzuki", model: "Dzire",           variant: "1.2 K12 petrol",  years: "2017–2024", market: "India" },
    { id: "maruti-ignis-k12",   make: "Maruti Suzuki", model: "Ignis",           variant: "1.2 K12 petrol",  years: "2017–", market: "India" },

    // ---------- Hyundai–Kia ----------
    { id: "hyundai-creta-2g",  make: "Hyundai", model: "Creta (2nd gen)", variant: "1.5 MPi / 1.5 CRDi", years: "2020–", market: "India" },
    { id: "kia-seltos",        make: "Kia",     model: "Seltos",          variant: "1.5 MPi / 1.5 CRDi", years: "2019–", market: "India" },
    { id: "hyundai-verna-5g",  make: "Hyundai", model: "Verna (5th gen)", variant: "1.5 MPi / 1.5 CRDi", years: "2020–2023", market: "India" },
    { id: "kia-carens",        make: "Kia",     model: "Carens",          variant: "1.5 MPi / 1.5 CRDi", years: "2022–", market: "India" },
    { id: "hyundai-venue",     make: "Hyundai", model: "Venue",           variant: "1.2 / 1.0 T-GDi / 1.5 CRDi", years: "2019–", market: "India" },
    { id: "kia-sonet",         make: "Kia",     model: "Sonet",           variant: "1.2 / 1.0 T-GDi / 1.5 CRDi", years: "2020–", market: "India" },

    // ---------- Luxury ↔ mainstream ----------
    { id: "vw-phaeton-w12",    make: "Volkswagen", model: "Phaeton",           variant: "6.0 W12",  years: "2002–2016", market: "Global" },
    { id: "bentley-cgt-1g",    make: "Bentley",    model: "Continental GT (1st gen)", variant: "6.0 W12 twin-turbo", years: "2003–2011", market: "Global" },
    { id: "bentley-flying-spur-1g", make: "Bentley", model: "Continental Flying Spur", variant: "6.0 W12 twin-turbo", years: "2005–2013", market: "Global" },
    { id: "audi-a8-d3-w12",    make: "Audi",       model: "A8 (D3)",           variant: "6.0 W12",  years: "2004–2010", market: "Global" },
    { id: "bugatti-veyron",    make: "Bugatti",    model: "Veyron 16.4",       variant: "8.0 W16 quad-turbo", years: "2005–2015", market: "Global" },
    { id: "porsche-cayenne-955", make: "Porsche",  model: "Cayenne (955/957)", variant: "V6 / V8",  years: "2002–2010", market: "Global" },
    { id: "vw-touareg-7l",     make: "Volkswagen", model: "Touareg (7L)",      variant: "V6 / V8 / V10 TDI", years: "2002–2010", market: "Global" },
    { id: "audi-q7-4l",        make: "Audi",       model: "Q7 (4L)",           variant: "V6 / V8 / V12 TDI", years: "2005–2015", market: "Global" },
    { id: "lambo-huracan",     make: "Lamborghini",model: "Huracán",           variant: "5.2 V10",  years: "2014–2024", market: "Global" },
    { id: "audi-r8-2g",        make: "Audi",       model: "R8 (2nd gen)",      variant: "5.2 V10",  years: "2015–2024", market: "Global" },
    { id: "lambo-urus",        make: "Lamborghini",model: "Urus",              variant: "4.0 V8 TT", years: "2018–", market: "Global" },
    { id: "audi-rsq8",         make: "Audi",       model: "RS Q8",             variant: "4.0 V8 TT", years: "2019–", market: "Global" },
    { id: "porsche-cayenne-3g",make: "Porsche",    model: "Cayenne (3rd gen) Turbo", variant: "4.0 V8 TT", years: "2018–", market: "Global" },
    { id: "bentley-bentayga",  make: "Bentley",    model: "Bentayga V8",       variant: "4.0 V8 TT", years: "2018–", market: "Global" }
  ],

  families: [
    // ==================================================================
    {
      id: "honda-n15a",
      type: "engine",
      name: "Honda 1.5 i-DTEC (N15A)",
      maker: "Honda",
      summary: "Honda's all-aluminium 1.5 L common-rail diesel built for India. Same engine across City, Amaze, Jazz, WR-V, Mobilio and BR-V — so engine-internal and service parts from the cheaper/high-volume models (Amaze, Jazz) are usually the same as the City's.",
      vehicles: ["honda-city-4g-d","honda-city-5g-d","honda-amaze-1g-d","honda-amaze-2g-d","honda-jazz-3g-d","honda-wrv-d","honda-mobilio-d","honda-brv-d"],
      parts: [
        { category: "Fuel system", name: "Diesel fuel injector (nozzle)", confidence: "medium", note: "Same injector family across N15A; injector coding/part revision can differ between BS4 and BS6 engines and between 80 PS (Amaze CVT) and 100 PS tunes. Match the number printed on the injector body." },
        { category: "Fuel system", name: "Fuel filter element", confidence: "high" },
        { category: "Ignition / glow", name: "Glow plug", confidence: "high" },
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Lubrication", name: "Oil drain plug & washer", confidence: "high" },
        { category: "Engine", name: "Rocker / valve cover gasket", confidence: "high" },
        { category: "Engine", name: "Turbocharger", confidence: "medium", note: "Differs between power tunes and emission norms." },
        { category: "Engine", name: "EGR valve", confidence: "medium", note: "BS6 engines have revised emission hardware." },
        { category: "Cooling", name: "Water pump", confidence: "high" },
        { category: "Cooling", name: "Thermostat", confidence: "high" },
        { category: "Electrical", name: "Alternator", confidence: "medium", note: "Check amperage and pulley." },
        { category: "Electrical", name: "Starter motor", confidence: "medium" },
        { category: "Mounting", name: "Engine mounting (right side, engine-side)", confidence: "low", note: "Mounts are body-specific. Platform pairs (Jazz / WR-V; City 4G vs 5G) are the best candidates. Compare bolt pattern, bush hardness and bracket shape." },
        { category: "Mounting", name: "Transmission mounting", confidence: "low", note: "Depends on gearbox (MT vs CVT) and body." },
        { category: "Transmission", name: "Clutch kit (plate, pressure plate, release bearing)", confidence: "medium", note: "Manual-gearbox diesels only; confirm disc diameter and spline count." }
      ]
    },

    // ==================================================================
    {
      id: "fiat-13-mjd",
      type: "engine",
      name: "Fiat 1.3 Multijet (SDE)",
      maker: "Fiat (FCA) — built under licence by Maruti, Tata, GM",
      summary: "One of the most widely shared diesels ever. Sold as Maruti 'DDiS', Tata 'Quadrajet', GM/Chevrolet 'SMARTECH', Opel 'CDTi' and Fiat 'Multijet'. Engine-internal and service parts commonly interchange across brands — often much cheaper from one brand than another.",
      vehicles: ["maruti-swift-ddis","maruti-dzire-ddis","maruti-ritz-ddis","maruti-ertiga-ddis","maruti-ciaz-ddis","maruti-brezza-ddis","maruti-baleno-ddis","tata-vista-qjet","tata-zest-qjet","tata-bolt-qjet","fiat-punto-mjd","fiat-linea-mjd","opel-corsa-d-cdti","chevrolet-sail-d","suzuki-swift-eu-ddis"],
      parts: [
        { category: "Fuel system", name: "Diesel fuel injector (nozzle)", confidence: "medium", note: "Same Bosch/Magneti Marelli injector families. 75 PS (fixed-geometry) vs 90 PS (VGT) engines may use different injector revisions. Match the injector body number." },
        { category: "Fuel system", name: "High-pressure fuel pump", confidence: "medium" },
        { category: "Fuel system", name: "Fuel filter", confidence: "medium", note: "Housing differs by car; cartridge often common." },
        { category: "Ignition / glow", name: "Glow plug", confidence: "high" },
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Engine", name: "Timing chain kit", confidence: "high" },
        { category: "Engine", name: "Cylinder head gasket", confidence: "high", note: "Choose the correct thickness grade." },
        { category: "Engine", name: "Turbocharger", confidence: "medium", note: "Fixed-geometry vs VGT versions are not interchangeable." },
        { category: "Engine", name: "EGR valve", confidence: "medium" },
        { category: "Sensors", name: "Crankshaft position sensor", confidence: "high" },
        { category: "Sensors", name: "Camshaft position sensor", confidence: "high" },
        { category: "Cooling", name: "Water pump", confidence: "high" },
        { category: "Cooling", name: "Thermostat", confidence: "medium" },
        { category: "Mounting", name: "Engine mounting", confidence: "low", note: "Brackets are vehicle-specific. Within Maruti (Swift / Dzire / Ritz) the mounts are often shared." }
      ]
    },

    // ==================================================================
    {
      id: "renault-k9k",
      type: "engine",
      name: "Renault 1.5 dCi (K9K)",
      maker: "Renault — shared with Nissan, Dacia, Mahindra and Mercedes-Benz (OM607)",
      summary: "The K9K was used across the Renault-Nissan Alliance and even in Mercedes A-Class, B-Class and Citan (as OM607). Service parts for a Mercedes A180 CDI can often be sourced as Renault/Nissan parts at a much lower price.",
      vehicles: ["renault-duster-dci","nissan-terrano-dci","nissan-sunny-dci","renault-scala-dci","nissan-micra-dci","renault-pulse-dci","mahindra-logan-dci","renault-lodgy-dci","renault-captur-dci","nissan-qashqai-dci","merc-a180-cdi-w176","merc-citan-cdi"],
      parts: [
        { category: "Fuel system", name: "Diesel fuel injector (nozzle)", confidence: "medium", note: "Delphi (older) and Continental/Siemens (newer) systems are not interchangeable. Match the injector type first." },
        { category: "Fuel system", name: "Fuel filter", confidence: "medium" },
        { category: "Ignition / glow", name: "Glow plug", confidence: "high" },
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Engine", name: "Timing belt kit (belt, tensioner, idler)", confidence: "high" },
        { category: "Engine", name: "Turbocharger", confidence: "medium", note: "Varies by output (65–110 PS)." },
        { category: "Engine", name: "EGR valve", confidence: "medium" },
        { category: "Cooling", name: "Water pump", confidence: "high" },
        { category: "Sensors", name: "Crankshaft position sensor", confidence: "high" },
        { category: "Mounting", name: "Engine mounting", confidence: "low", note: "Shared within platform pairs (Duster/Terrano, Sunny/Scala, Micra/Pulse), not across all K9K cars." }
      ]
    },

    // ==================================================================
    {
      id: "renault-nissan-b0",
      type: "platform",
      name: "Renault-Nissan B0 / V platform pairs (badge-engineered)",
      maker: "Renault-Nissan Alliance (India)",
      summary: "These pairs are essentially the same car with different badges. Suspension, brakes, mounts, glass and many body parts are shared within each pair.",
      vehicles: ["renault-duster-dci","nissan-terrano-dci","nissan-sunny-dci","renault-scala-dci","nissan-micra-dci","renault-pulse-dci"],
      parts: [
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "high", only: ["renault-duster-dci","nissan-terrano-dci"], note: "Duster ↔ Terrano." },
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "high", only: ["nissan-sunny-dci","renault-scala-dci"], note: "Sunny ↔ Scala." },
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "high", only: ["nissan-micra-dci","renault-pulse-dci"], note: "Micra ↔ Pulse." },
        { category: "Suspension", name: "Front shock absorber / strut", confidence: "high", only: ["renault-duster-dci","nissan-terrano-dci"] },
        { category: "Suspension", name: "Front lower control arm", confidence: "high", only: ["renault-duster-dci","nissan-terrano-dci"] },
        { category: "Suspension", name: "Front shock absorber / strut", confidence: "high", only: ["nissan-sunny-dci","renault-scala-dci"] },
        { category: "Brakes", name: "Front brake pads & discs", confidence: "high", only: ["nissan-sunny-dci","renault-scala-dci","nissan-micra-dci","renault-pulse-dci"] },
        { category: "Glass / body", name: "Windscreen", confidence: "high", only: ["renault-duster-dci","nissan-terrano-dci"] },
        { category: "Glass / body", name: "Door glass, mirrors, door handles", confidence: "medium", note: "Within each pair; mirror caps and handle colours differ." }
      ]
    },

    // ==================================================================
    {
      id: "vw-mqb-a0-in",
      type: "platform",
      name: "VW Group MQB-A0-IN (India 2.0)",
      maker: "Volkswagen / Skoda",
      summary: "Kushaq, Slavia, Taigun and Virtus share the platform, the 1.0 TSI (EA211) and 1.5 TSI (EA211 evo) engines, and most of the running gear.",
      vehicles: ["skoda-kushaq","skoda-slavia","vw-taigun","vw-virtus"],
      parts: [
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "high", note: "1.0 TSI and 1.5 TSI use different plugs — match the engine." },
        { category: "Ignition / glow", name: "Ignition coils", confidence: "high" },
        { category: "Air intake", name: "Air filter", confidence: "high" },
        { category: "Air intake", name: "Cabin (AC) filter", confidence: "high" },
        { category: "Brakes", name: "Front brake pads & discs", confidence: "high" },
        { category: "Suspension", name: "Front strut, lower arm, link rods", confidence: "high", note: "Spring rates differ between SUVs and sedans." },
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "medium", note: "Per engine/gearbox combo (MT / AT / DSG)." },
        { category: "Electrical", name: "Headlamp / tail lamp", confidence: "low", note: "Unique styling per model — not shared." }
      ]
    },

    // ==================================================================
    {
      id: "vw-pq25-in",
      type: "platform",
      name: "VW Group PQ25 (Polo / Vento / Rapid / Ameo)",
      maker: "Volkswagen / Skoda",
      summary: "The older India-built VW/Skoda cars share platform, engines (1.2 MPI, 1.5 TDI, 1.6 MPI, 1.2 TSI / 1.0 TSI) and much of the suspension and braking.",
      vehicles: ["vw-polo-6r","vw-vento","skoda-rapid","vw-ameo"],
      parts: [
        { category: "Suspension", name: "Front lower control arm & bushes", confidence: "high" },
        { category: "Suspension", name: "Front link rods / stabiliser links", confidence: "high" },
        { category: "Brakes", name: "Front brake pads & discs", confidence: "high" },
        { category: "Lubrication", name: "Engine oil filter (per engine)", confidence: "high" },
        { category: "Fuel system", name: "1.5 TDI fuel injector", confidence: "medium", note: "Same engine family in Polo, Vento, Rapid and Ameo." },
        { category: "Mounting", name: "Engine mounting (per engine)", confidence: "medium" },
        { category: "Air intake", name: "Cabin (AC) filter", confidence: "high" }
      ]
    },

    // ==================================================================
    {
      id: "suzuki-toyota-rebadge",
      type: "platform",
      name: "Suzuki ↔ Toyota rebadges",
      maker: "Maruti Suzuki / Toyota Kirloskar",
      summary: "Toyota models built by or with Maruti Suzuki are the same car mechanically. Pairs: Baleno ↔ Glanza, Vitara Brezza ↔ Urban Cruiser, Grand Vitara ↔ Hyryder, Ertiga ↔ Rumion. Nearly all mechanical and most body parts interchange within a pair.",
      vehicles: ["maruti-baleno-k12","toyota-glanza","maruti-brezza-k15","toyota-urban-cruiser","maruti-grand-vitara","toyota-hyryder","maruti-ertiga-k15","toyota-rumion"],
      parts: [
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "high", only: ["maruti-baleno-k12","toyota-glanza"] },
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "high", only: ["maruti-brezza-k15","toyota-urban-cruiser"] },
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "high", only: ["maruti-grand-vitara","toyota-hyryder"], note: "Mild-hybrid only; the Toyota strong-hybrid powertrain is different." },
        { category: "Mounting", name: "Engine & gearbox mountings", confidence: "high", only: ["maruti-ertiga-k15","toyota-rumion"] },
        { category: "Suspension", name: "Shock absorbers, control arms, links", confidence: "high", note: "Within each pair." },
        { category: "Brakes", name: "Brake pads, discs, drums", confidence: "high", note: "Within each pair." },
        { category: "Glass / body", name: "Doors, glass, mirrors", confidence: "high", note: "Within each pair; bumpers and grilles differ." },
        { category: "Electrical", name: "Headlamp", confidence: "low", note: "Usually restyled for the Toyota version." }
      ]
    },

    // ==================================================================
    {
      id: "suzuki-k-series",
      type: "engine",
      name: "Suzuki K12 / K15 petrol (K-series)",
      maker: "Suzuki — also in Toyota rebadges",
      summary: "Maruti's K-series petrol engines power most of its range and the Toyota rebadges. Service and ignition parts are widely shared.",
      vehicles: ["maruti-swift-k12","maruti-dzire-k12","maruti-ignis-k12","maruti-baleno-k12","toyota-glanza","maruti-brezza-k15","toyota-urban-cruiser","maruti-ertiga-k15","toyota-rumion","maruti-grand-vitara","toyota-hyryder"],
      parts: [
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "medium", note: "K12M, K12N (DualJet) and K15B/K15C use different plugs — match the engine code." },
        { category: "Ignition / glow", name: "Ignition coil", confidence: "medium", note: "Match the engine code." },
        { category: "Fuel system", name: "Fuel injector", confidence: "medium", note: "Match the engine code; DualJet engines have two injectors per cylinder." },
        { category: "Sensors", name: "Oxygen (lambda) sensor", confidence: "medium" },
        { category: "Engine", name: "Timing chain kit", confidence: "medium", note: "Per engine code." },
        { category: "Cooling", name: "Thermostat", confidence: "medium" }
      ]
    },

    // ==================================================================
    {
      id: "hyundai-kia-k2",
      type: "platform",
      name: "Hyundai–Kia K2 / 1.5 Smartstream (Creta, Seltos, Verna, Carens)",
      maker: "Hyundai Motor Group",
      summary: "The Creta, Seltos, Verna and Carens share engines (1.5 MPi, 1.5 CRDi U2, turbo-petrols) and much of the platform. Parts sold for the Kia are often identical to the Hyundai ones and vice versa.",
      vehicles: ["hyundai-creta-2g","kia-seltos","hyundai-verna-5g","kia-carens"],
      parts: [
        { category: "Fuel system", name: "1.5 CRDi fuel injector", confidence: "medium", note: "Same U2 1.5 diesel; check BS6 phase 1 vs phase 2." },
        { category: "Ignition / glow", name: "Glow plug (1.5 CRDi)", confidence: "high" },
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Air intake", name: "Cabin (AC) filter", confidence: "medium" },
        { category: "Brakes", name: "Front brake pads", confidence: "medium" },
        { category: "Suspension", name: "Front lower arm, links", confidence: "medium", note: "Creta ↔ Seltos is the closest match." },
        { category: "Mounting", name: "Engine mounting", confidence: "medium", only: ["hyundai-creta-2g","kia-seltos"], note: "Creta ↔ Seltos." }
      ]
    },
    {
      id: "hyundai-kia-venue-sonet",
      type: "platform",
      name: "Hyundai Venue ↔ Kia Sonet",
      maker: "Hyundai Motor Group",
      summary: "The two compact SUVs share engines, gearboxes and the underlying platform.",
      vehicles: ["hyundai-venue","kia-sonet"],
      parts: [
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs / ignition coils (per engine)", confidence: "high" },
        { category: "Fuel system", name: "1.5 CRDi fuel injector", confidence: "medium" },
        { category: "Brakes", name: "Front brake pads & discs", confidence: "medium" },
        { category: "Suspension", name: "Front strut & lower arm", confidence: "medium" },
        { category: "Mounting", name: "Engine mounting", confidence: "medium" }
      ]
    },

    // ==================================================================
    {
      id: "vag-w12",
      type: "engine",
      name: "VW Group 6.0 W12",
      maker: "Volkswagen Group",
      summary: "The VW Phaeton, Audi A8 W12 and first-generation Bentley Continental GT / Flying Spur share the W12 engine family (twin-turbo in the Bentleys) and, for Phaeton and Bentley, the D1 platform. Many engine and suspension parts carry VW-group numbers and cost far less through VW or Audi channels than through Bentley.",
      vehicles: ["vw-phaeton-w12","audi-a8-d3-w12","bentley-cgt-1g","bentley-flying-spur-1g"],
      parts: [
        { category: "Ignition / glow", name: "Ignition coils", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "medium", note: "Turbo vs naturally aspirated W12 may use different heat ranges." },
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Sensors", name: "Camshaft / crankshaft sensors", confidence: "high" },
        { category: "Cooling", name: "Coolant pipes, thermostat housings", confidence: "medium" },
        { category: "Suspension", name: "Air-suspension struts & compressor", confidence: "medium", only: ["vw-phaeton-w12","bentley-cgt-1g","bentley-flying-spur-1g"], note: "D1 platform (Phaeton ↔ Bentley). Damper tuning may differ." },
        { category: "Interior / switchgear", name: "Window switches, stalks, some switchgear", confidence: "medium", only: ["vw-phaeton-w12","bentley-cgt-1g","bentley-flying-spur-1g"] }
      ]
    },
    {
      id: "bugatti-vag",
      type: "platform",
      name: "Bugatti Veyron ↔ VW Group components",
      maker: "Volkswagen Group",
      summary: "The Veyron's W16 powertrain, gearbox and chassis are bespoke. The sharing is in smaller items — some sensors, switchgear and electrical components with VW-group origins. Treat every match here as 'verify carefully'.",
      vehicles: ["bugatti-veyron","vw-phaeton-w12","bentley-cgt-1g","audi-a8-d3-w12"],
      parts: [
        { category: "Interior / switchgear", name: "Selected switches & control modules", confidence: "low", note: "Some items have VW-group origins. Cross-check the part number stamped on the component." },
        { category: "Sensors", name: "Selected generic sensors", confidence: "low", note: "Only where the VW-group part number matches exactly." }
      ]
    },

    // ==================================================================
    {
      id: "vag-pl71",
      type: "platform",
      name: "VW Group PL71 (Cayenne 955 / Touareg 7L / Q7 4L)",
      maker: "Volkswagen Group / Porsche",
      summary: "Porsche and VW co-developed the first Cayenne and Touareg on one platform; the first Audi Q7 used a derivative. Suspension, brakes and many chassis parts are shared, and the VW/Audi versions are usually cheaper.",
      vehicles: ["porsche-cayenne-955","vw-touareg-7l","audi-q7-4l"],
      parts: [
        { category: "Suspension", name: "Control arms & bushes", confidence: "medium", note: "Cayenne ↔ Touareg is the closest match; Q7 differs more." },
        { category: "Suspension", name: "Air-suspension compressor", confidence: "medium" },
        { category: "Brakes", name: "Brake discs & pads (non-ceramic)", confidence: "medium", note: "Match the caliper size; Porsche fitted larger brakes on some trims." },
        { category: "Transmission", name: "Transfer case", confidence: "medium", only: ["porsche-cayenne-955","vw-touareg-7l"] },
        { category: "Electrical", name: "Window regulators, door locks", confidence: "medium", only: ["porsche-cayenne-955","vw-touareg-7l"] },
        { category: "Cooling", name: "Coolant pipes (V8)", confidence: "low", note: "The V8 engines differ (Porsche vs VW/Audi)." }
      ]
    },
    {
      id: "vag-52-v10",
      type: "engine",
      name: "Audi / Lamborghini 5.2 V10",
      maker: "Audi / Lamborghini",
      summary: "The Lamborghini Huracán and second-generation Audi R8 share the 5.2 V10, the 7-speed dual-clutch gearbox and much of the chassis. Audi-sourced parts are frequently cheaper.",
      vehicles: ["lambo-huracan","audi-r8-2g"],
      parts: [
        { category: "Ignition / glow", name: "Ignition coils", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "high" },
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Air intake", name: "Air filters", confidence: "medium" },
        { category: "Sensors", name: "Engine sensors (cam / crank / knock)", confidence: "high" },
        { category: "Transmission", name: "Dual-clutch gearbox service parts", confidence: "medium" },
        { category: "Suspension", name: "Control arms, bushes", confidence: "medium" },
        { category: "Brakes", name: "Steel brake pads", confidence: "low", note: "Caliper suppliers and sizes can differ." }
      ]
    },
    {
      id: "vag-40-v8tt",
      type: "engine",
      name: "VW Group 4.0 V8 twin-turbo (EA825) & MLB Evo",
      maker: "Volkswagen Group",
      summary: "The Lamborghini Urus, Audi RS Q8, Porsche Cayenne Turbo and Bentley Bentayga V8 share the 4.0 TFSI V8 family and the MLB Evo platform. Service parts often cross over, with the Audi part usually the cheapest.",
      vehicles: ["lambo-urus","audi-rsq8","porsche-cayenne-3g","bentley-bentayga"],
      parts: [
        { category: "Ignition / glow", name: "Ignition coils", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "medium", note: "Porsche specifies its own plug on some versions." },
        { category: "Lubrication", name: "Engine oil filter", confidence: "medium" },
        { category: "Sensors", name: "Engine sensors", confidence: "medium" },
        { category: "Suspension", name: "Air-suspension components", confidence: "low", note: "Each brand tunes and specifies differently." },
        { category: "Brakes", name: "Brake pads", confidence: "low", note: "Brake systems differ strongly between brands." }
      ]
    }
  ]
};
