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
 *   "avoid"  - looks shared but must NOT be swapped (safety / incompatibility)
 *
 * vehicle.type: car | bike | commercial | aircraft | marine  (defaults to "car")
 *
 * `only`   - restrict a part to a subset of the family's vehicles (ids)
 * `except` - exclude vehicles from a part's interchange list (ids)
 *
 * IMPORTANT: this is illustrative seed data compiled from widely known
 * engine/platform sharing. It is NOT an OEM catalogue. Always confirm the
 * OEM part number (via VIN / EPC lookup) before buying.
 */

window.PARTTWIN_DB = {
  version: "0.2.0",

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
    { id: "bentley-bentayga",  make: "Bentley",    model: "Bentayga V8",       variant: "4.0 V8 TT", years: "2018–", market: "Global" },

    // ================= MORE CARS (global) =================
    { id: "vw-golf-gti-mk7",   type: "car", make: "Volkswagen", model: "Golf GTI (Mk7)",       variant: "2.0 TSI EA888 Gen3", years: "2013–2020", market: "Global" },
    { id: "skoda-octavia-rs-3g", type: "car", make: "Skoda",    model: "Octavia RS (3rd gen)", variant: "2.0 TSI EA888 Gen3", years: "2013–2020", market: "Global" },
    { id: "audi-a3-8v-20",     type: "car", make: "Audi",       model: "A3 / S3 (8V)",         variant: "2.0 TFSI EA888 Gen3", years: "2013–2020", market: "Global" },
    { id: "seat-leon-cupra-3", type: "car", make: "SEAT / Cupra", model: "Leon Cupra (Mk3)",   variant: "2.0 TSI EA888 Gen3", years: "2014–2020", market: "Europe" },
    { id: "vw-tiguan-2g-20",   type: "car", make: "Volkswagen", model: "Tiguan (2nd gen)",     variant: "2.0 TSI EA888 Gen3", years: "2016–2023", market: "Global" },
    { id: "toyota-camry-xv70", type: "car", make: "Toyota",     model: "Camry (XV70)",         variant: "2.5 A25A Dynamic Force", years: "2017–2024", market: "Global" },
    { id: "toyota-rav4-xa50",  type: "car", make: "Toyota",     model: "RAV4 (XA50)",          variant: "2.5 A25A Dynamic Force", years: "2018–", market: "Global" },
    { id: "lexus-es250-7g",    type: "car", make: "Lexus",      model: "ES 250 (7th gen)",     variant: "2.5 A25A Dynamic Force", years: "2018–", market: "Global" },

    // ================= MOTORCYCLES =================
    { id: "ktm-390-duke",      type: "bike", make: "KTM",        model: "390 Duke",            variant: "373 cc single", years: "2017–2023", market: "Global" },
    { id: "ktm-rc390",         type: "bike", make: "KTM",        model: "RC 390",              variant: "373 cc single", years: "2017–2021", market: "Global" },
    { id: "ktm-390-adv",       type: "bike", make: "KTM",        model: "390 Adventure",       variant: "373 cc single", years: "2019–2024", market: "Global" },
    { id: "husq-svartpilen-401", type: "bike", make: "Husqvarna", model: "Svartpilen 401",     variant: "373 cc single", years: "2018–2023", market: "Global" },
    { id: "husq-vitpilen-401", type: "bike", make: "Husqvarna",  model: "Vitpilen 401",        variant: "373 cc single", years: "2018–2023", market: "Global" },
    { id: "bajaj-dominar-400", type: "bike", make: "Bajaj",      model: "Dominar 400",         variant: "373 cc single (KTM-derived)", years: "2016–", market: "India / Global" },
    { id: "re-interceptor-650",type: "bike", make: "Royal Enfield", model: "Interceptor 650",  variant: "648 cc parallel twin", years: "2018–", market: "Global" },
    { id: "re-gt650",          type: "bike", make: "Royal Enfield", model: "Continental GT 650", variant: "648 cc parallel twin", years: "2018–", market: "Global" },
    { id: "re-super-meteor-650", type: "bike", make: "Royal Enfield", model: "Super Meteor 650", variant: "648 cc parallel twin", years: "2023–", market: "Global" },
    { id: "re-shotgun-650",    type: "bike", make: "Royal Enfield", model: "Shotgun 650",      variant: "648 cc parallel twin", years: "2024–", market: "Global" },
    { id: "re-classic-350",    type: "bike", make: "Royal Enfield", model: "Classic 350",      variant: "349 cc J-series", years: "2021–", market: "Global" },
    { id: "re-meteor-350",     type: "bike", make: "Royal Enfield", model: "Meteor 350",       variant: "349 cc J-series", years: "2020–", market: "Global" },
    { id: "re-hunter-350",     type: "bike", make: "Royal Enfield", model: "Hunter 350",       variant: "349 cc J-series", years: "2022–", market: "Global" },
    { id: "re-bullet-350-j",   type: "bike", make: "Royal Enfield", model: "Bullet 350",       variant: "349 cc J-series", years: "2023–", market: "Global" },
    { id: "tvs-apache-rr310",  type: "bike", make: "TVS",        model: "Apache RR 310",       variant: "312 cc single", years: "2017–", market: "India / Global" },
    { id: "bmw-g310r",         type: "bike", make: "BMW Motorrad", model: "G 310 R",           variant: "313 cc single (built by TVS)", years: "2016–", market: "Global" },
    { id: "bmw-g310gs",        type: "bike", make: "BMW Motorrad", model: "G 310 GS",          variant: "313 cc single (built by TVS)", years: "2017–", market: "Global" },
    { id: "honda-hness-cb350", type: "bike", make: "Honda",      model: "H'ness CB350",        variant: "348 cc single", years: "2020–", market: "India" },
    { id: "honda-cb350rs",     type: "bike", make: "Honda",      model: "CB350RS",             variant: "348 cc single", years: "2021–", market: "India" },
    { id: "yamaha-r15-v4",     type: "bike", make: "Yamaha",     model: "R15 V4",              variant: "155 cc VVA", years: "2021–", market: "India / Asia" },
    { id: "yamaha-mt15",       type: "bike", make: "Yamaha",     model: "MT-15",               variant: "155 cc VVA", years: "2019–", market: "India / Asia" },

    // ================= COMMERCIAL / PICK-UPS / VANS =================
    { id: "toyota-innova-crysta", type: "commercial", make: "Toyota", model: "Innova Crysta", variant: "2.4 2GD-FTV diesel", years: "2016–", market: "India / Asia" },
    { id: "toyota-fortuner-an160", type: "commercial", make: "Toyota", model: "Fortuner (2nd gen)", variant: "2.8 1GD-FTV / 2.4 2GD-FTV", years: "2015–", market: "Asia / Africa / LatAm" },
    { id: "toyota-hilux-an120", type: "commercial", make: "Toyota", model: "Hilux (8th gen)",  variant: "2.8 1GD-FTV / 2.4 2GD-FTV", years: "2015–", market: "Global (ex-US)" },
    { id: "fiat-ducato-x250",  type: "commercial", make: "Fiat",       model: "Ducato (X250/X290)", variant: "2.2 / 2.3 Multijet", years: "2006–", market: "Europe / Global" },
    { id: "peugeot-boxer-2g",  type: "commercial", make: "Peugeot",    model: "Boxer (2nd gen)",  variant: "2.0 / 2.2 BlueHDi", years: "2006–", market: "Europe / Global" },
    { id: "citroen-jumper-2g", type: "commercial", make: "Citroën",    model: "Jumper / Relay (2nd gen)", variant: "2.0 / 2.2 BlueHDi", years: "2006–", market: "Europe / Global" },
    { id: "ram-promaster",     type: "commercial", make: "Ram",        model: "ProMaster",        variant: "3.6 Pentastar V6", years: "2014–", market: "North America" },
    { id: "merc-sprinter-ncv3",type: "commercial", make: "Mercedes-Benz", model: "Sprinter (NCV3)", variant: "OM646 / OM651 diesel", years: "2006–2018", market: "Global" },
    { id: "vw-crafter-1g",     type: "commercial", make: "Volkswagen", model: "Crafter (1st gen)", variant: "2.5 / 2.0 TDI", years: "2006–2016", market: "Europe" },
    { id: "ford-ranger-p703",  type: "commercial", make: "Ford",       model: "Ranger (2022–)",   variant: "2.0 bi-turbo / 3.0 V6 diesel", years: "2022–", market: "Global (ex-NA diesels)" },
    { id: "vw-amarok-2g",      type: "commercial", make: "Volkswagen", model: "Amarok (2nd gen)", variant: "2.0 bi-turbo / 3.0 V6 diesel (Ford)", years: "2022–", market: "Global (ex-NA)" },
    { id: "ram-2500-cummins",  type: "commercial", make: "Ram",        model: "2500 / 3500 Heavy Duty", variant: "6.7 Cummins turbo diesel", years: "2007–", market: "North America" },
    { id: "freightliner-m2-b67", type: "commercial", make: "Freightliner", model: "M2 106", variant: "Cummins B6.7", years: "2010–", market: "North America" },

    // ================= AIRCRAFT =================
    { id: "cessna-172s",       type: "aircraft", make: "Cessna",  model: "172S Skyhawk SP",     variant: "Lycoming IO-360-L2A", years: "1998–", market: "Global" },
    { id: "piper-pa28-181",    type: "aircraft", make: "Piper",   model: "PA-28-181 Archer",    variant: "Lycoming O-360-A4M", years: "1976–", market: "Global" },
    { id: "piper-pa28r-200",   type: "aircraft", make: "Piper",   model: "PA-28R-200 Arrow",    variant: "Lycoming IO-360-C1C6", years: "1969–1976", market: "Global" },
    { id: "diamond-da40-180",  type: "aircraft", make: "Diamond", model: "DA40 180",            variant: "Lycoming IO-360-M1A", years: "1997–", market: "Global" },
    { id: "tecnam-p2008",      type: "aircraft", make: "Tecnam",  model: "P2008",               variant: "Rotax 912 iSc / ULS", years: "2008–", market: "Global" },
    { id: "pipistrel-virus-sw",type: "aircraft", make: "Pipistrel", model: "Virus SW",          variant: "Rotax 912 iS / ULS", years: "2008–", market: "Global" },
    { id: "aeroprakt-a22",     type: "aircraft", make: "Aeroprakt", model: "A-22 Foxbat / Vision", variant: "Rotax 912 UL / ULS", years: "1999–", market: "Global" },
    { id: "icon-a5",           type: "aircraft", make: "ICON",    model: "A5",                  variant: "Rotax 912 iS", years: "2014–", market: "Global" },
    { id: "airbus-a320ceo-cfm",type: "aircraft", make: "Airbus",  model: "A320ceo family",      variant: "CFM56-5B", years: "1988–", market: "Global" },
    { id: "boeing-737ng",      type: "aircraft", make: "Boeing",  model: "737 Next Generation", variant: "CFM56-7B", years: "1997–2019", market: "Global" },

    // ================= MARINE =================
    { id: "volvo-penta-57-gxi",type: "marine", make: "Volvo Penta", model: "5.7 GXi (sterndrive / inboard)", variant: "GM 5.7 L V8 based", years: "1996–2017", market: "Global" },
    { id: "mercruiser-350-mag",type: "marine", make: "MerCruiser", model: "350 MAG MPI",       variant: "GM 5.7 L V8 based", years: "1996–2017", market: "Global" },
    { id: "chevy-c1500-57-vortec", type: "car", make: "Chevrolet", model: "C/K 1500 pickup",   variant: "5.7 Vortec V8 (L31)", years: "1996–1999", market: "North America" }

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
    },

    // ==================================================================
    {
      id: "vag-ea888-g3",
      type: "engine",
      name: "VW Group 2.0 TSI EA888 Gen3 (MQB)",
      maker: "Volkswagen Group",
      summary: "One of the highest-volume performance engines in the world, used on the MQB platform in VW, Skoda, Audi and SEAT/Cupra. Wear and service parts (coils, PCV valve, water-pump/thermostat housing) are shared, and the VW/Skoda versions are typically cheapest.",
      vehicles: ["vw-golf-gti-mk7","skoda-octavia-rs-3g","audi-a3-8v-20","seat-leon-cupra-3","vw-tiguan-2g-20"],
      parts: [
        { category: "Ignition / glow", name: "Ignition coils", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "medium", note: "Plug spec depends on output (e.g. GTI vs S3 / Cupra)." },
        { category: "Cooling", name: "Water pump & thermostat housing assembly", confidence: "high", note: "Known wear item on Gen3; later revisions supersede earlier ones." },
        { category: "Engine", name: "PCV / oil separator valve", confidence: "high" },
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Engine", name: "Timing chain & tensioner kit", confidence: "high" },
        { category: "Transmission", name: "DSG (DQ250 / DQ381) service kit", confidence: "medium", note: "Match the gearbox code." },
        { category: "Brakes", name: "Front brake pads & discs", confidence: "medium", note: "Depends on brake package (e.g. 312 mm vs 340 mm discs)." },
        { category: "Suspension", name: "Front lower-arm bushes, drop links", confidence: "high", except: ["vw-tiguan-2g-20"] }
      ]
    },
    {
      id: "toyota-a25a",
      type: "engine",
      name: "Toyota 2.5 A25A-FKS Dynamic Force (TNGA-K)",
      maker: "Toyota / Lexus",
      summary: "The Camry, RAV4 and Lexus ES 250 share the 2.5 L Dynamic Force engine on the TNGA-K platform. Lexus-badged service parts often cost much more than the identical Toyota ones.",
      vehicles: ["toyota-camry-xv70","toyota-rav4-xa50","lexus-es250-7g"],
      parts: [
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "high" },
        { category: "Ignition / glow", name: "Ignition coils", confidence: "high" },
        { category: "Sensors", name: "Air-fuel ratio & oxygen sensors", confidence: "medium" },
        { category: "Cooling", name: "Electric water pump", confidence: "medium" },
        { category: "Brakes", name: "Front brake pads", confidence: "low", note: "Caliper sizes differ between models." }
      ]
    },

    // ======================== MOTORCYCLES ===========================
    {
      id: "ktm-373",
      type: "engine",
      name: "KTM 373 cc single (390 platform)",
      maker: "KTM / Husqvarna / Bajaj",
      summary: "KTM's 373 cc liquid-cooled single is built by Bajaj in India and used across KTM 390s and Husqvarna 401s. The Bajaj Dominar 400 uses a derivative of it. Service parts are commonly shared, and the Bajaj/KTM India versions are usually the cheapest.",
      vehicles: ["ktm-390-duke","ktm-rc390","ktm-390-adv","husq-svartpilen-401","husq-vitpilen-401","bajaj-dominar-400"],
      parts: [
        { category: "Lubrication", name: "Oil filter (paper insert)", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plug", confidence: "medium", note: "Early Dominar triple-spark engines use different plug arrangements." },
        { category: "Transmission", name: "Clutch plates & springs", confidence: "medium", note: "Slipper clutch on later models; match the clutch type." },
        { category: "Brakes", name: "Brake pads (ByBre calipers)", confidence: "medium", note: "Check caliper model; most use ByBre (Brembo group) units." },
        { category: "Cooling", name: "Radiator cap, coolant hoses", confidence: "low", note: "Hose routing differs by frame." },
        { category: "Engine", name: "Cam chain & tensioner", confidence: "high", except: ["bajaj-dominar-400"] },
        { category: "Electrical", name: "Regulator rectifier", confidence: "medium" }
      ]
    },
    {
      id: "re-650-twin",
      type: "engine",
      name: "Royal Enfield 648 cc parallel twin",
      maker: "Royal Enfield",
      summary: "The Interceptor 650, Continental GT 650, Super Meteor 650 and Shotgun 650 all use the same 648 cc twin. Engine service parts interchange widely; frames and cycle parts are model-specific.",
      vehicles: ["re-interceptor-650","re-gt650","re-super-meteor-650","re-shotgun-650"],
      parts: [
        { category: "Lubrication", name: "Oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "high" },
        { category: "Transmission", name: "Clutch plates (slip-assist)", confidence: "high" },
        { category: "Air intake", name: "Air filter element", confidence: "low", note: "Airbox differs between Interceptor/GT and Super Meteor/Shotgun." },
        { category: "Suspension", name: "Front fork seals", confidence: "high", only: ["re-interceptor-650","re-gt650"], note: "Conventional forks; the Super Meteor and Shotgun use USD forks." },
        { category: "Brakes", name: "Front brake pads", confidence: "medium", only: ["re-interceptor-650","re-gt650"] },
        { category: "Brakes", name: "Front brake pads", confidence: "medium", only: ["re-super-meteor-650","re-shotgun-650"] }
      ]
    },
    {
      id: "re-j-series",
      type: "engine",
      name: "Royal Enfield J-series 349 cc",
      maker: "Royal Enfield",
      summary: "The Meteor, Classic, Hunter and new Bullet 350 share the J-series engine, so engine service parts are common across all four.",
      vehicles: ["re-classic-350","re-meteor-350","re-hunter-350","re-bullet-350-j"],
      parts: [
        { category: "Lubrication", name: "Oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plug", confidence: "high" },
        { category: "Transmission", name: "Clutch plates", confidence: "high" },
        { category: "Engine", name: "Cam chain & tensioner", confidence: "high" },
        { category: "Electrical", name: "Regulator rectifier", confidence: "medium" },
        { category: "Brakes", name: "Brake pads", confidence: "medium", note: "Check disc size per model." }
      ]
    },
    {
      id: "tvs-bmw-310",
      type: "engine",
      name: "TVS / BMW 312–313 cc reverse-inclined single",
      maker: "TVS Motor / BMW Motorrad",
      summary: "BMW's G 310 R and G 310 GS are built by TVS in India and share their engine with the TVS Apache RR 310. TVS-branded parts are usually far cheaper than BMW-branded ones.",
      vehicles: ["tvs-apache-rr310","bmw-g310r","bmw-g310gs"],
      parts: [
        { category: "Lubrication", name: "Oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plug", confidence: "high" },
        { category: "Transmission", name: "Clutch plates", confidence: "medium" },
        { category: "Transmission", name: "Chain & sprocket kit", confidence: "low", note: "Sprocket sizes differ by model." },
        { category: "Brakes", name: "Brake pads", confidence: "medium" },
        { category: "Electrical", name: "Regulator rectifier", confidence: "medium" }
      ]
    },
    {
      id: "honda-cb350",
      type: "engine",
      name: "Honda 348 cc air-cooled single (CB350)",
      maker: "Honda (India)",
      summary: "The H'ness CB350 and CB350RS are the same motorcycle mechanically, with different styling.",
      vehicles: ["honda-hness-cb350","honda-cb350rs"],
      parts: [
        { category: "Lubrication", name: "Oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plug", confidence: "high" },
        { category: "Transmission", name: "Clutch plates", confidence: "high" },
        { category: "Brakes", name: "Brake pads", confidence: "high" },
        { category: "Suspension", name: "Fork seals", confidence: "high" }
      ]
    },
    {
      id: "yamaha-155-vva",
      type: "engine",
      name: "Yamaha 155 cc VVA",
      maker: "Yamaha",
      summary: "The R15 V4 and MT-15 share the 155 cc VVA engine and most of the chassis.",
      vehicles: ["yamaha-r15-v4","yamaha-mt15"],
      parts: [
        { category: "Lubrication", name: "Oil filter", confidence: "high" },
        { category: "Ignition / glow", name: "Spark plug", confidence: "high" },
        { category: "Transmission", name: "Clutch plates", confidence: "high" },
        { category: "Brakes", name: "Brake pads", confidence: "medium" },
        { category: "Transmission", name: "Chain & sprocket kit", confidence: "medium" }
      ]
    },

    // ======================== COMMERCIAL ===========================
    {
      id: "toyota-gd",
      type: "engine",
      name: "Toyota GD diesel (1GD 2.8 / 2GD 2.4) on IMV",
      maker: "Toyota",
      summary: "The Innova Crysta, Fortuner and Hilux share Toyota's GD-series diesels and the IMV ladder-frame platform. Filters and many wear parts are common to all three.",
      vehicles: ["toyota-innova-crysta","toyota-fortuner-an160","toyota-hilux-an120"],
      parts: [
        { category: "Lubrication", name: "Engine oil filter", confidence: "high" },
        { category: "Fuel system", name: "Fuel filter", confidence: "high" },
        { category: "Fuel system", name: "Diesel injector", confidence: "medium", note: "2.4 (2GD) and 2.8 (1GD) use different injectors." },
        { category: "Ignition / glow", name: "Glow plug", confidence: "high" },
        { category: "Engine", name: "Turbocharger", confidence: "low", note: "Specific to engine and power output." },
        { category: "Suspension", name: "Front suspension arms & bushes", confidence: "medium", only: ["toyota-fortuner-an160","toyota-hilux-an120"] },
        { category: "Brakes", name: "Front brake pads", confidence: "medium", only: ["toyota-fortuner-an160","toyota-hilux-an120"] }
      ]
    },
    {
      id: "sevel-van",
      type: "platform",
      name: "Sevel large van (Ducato / Boxer / Jumper / ProMaster)",
      maker: "Stellantis (formerly Fiat + PSA joint venture)",
      summary: "Europe's best-known badge-engineered van. Body, glass, suspension and brakes are shared across all four badges. Engines differ: Fiat uses Multijet, Peugeot/Citroën use HDi/BlueHDi, and the US Ram ProMaster uses a Pentastar V6.",
      vehicles: ["fiat-ducato-x250","peugeot-boxer-2g","citroen-jumper-2g","ram-promaster"],
      parts: [
        { category: "Brakes", name: "Brake pads & discs", confidence: "high", note: "Match the payload class (light vs heavy/Maxi) because disc sizes differ." },
        { category: "Suspension", name: "Front struts, wishbones, anti-roll links", confidence: "high" },
        { category: "Glass / body", name: "Windscreen, mirrors, door handles, lamps", confidence: "high", note: "Pre-/post-facelift lamps differ." },
        { category: "Glass / body", name: "Sliding-door rollers & hinges", confidence: "high" },
        { category: "Engine", name: "Engine service parts", confidence: "low", note: "Not shared across brands, since each badge uses different engines." }
      ]
    },
    {
      id: "sprinter-crafter",
      type: "platform",
      name: "Mercedes Sprinter ↔ VW Crafter (2006–2016)",
      maker: "Daimler / Volkswagen",
      summary: "The first-generation VW Crafter was built by Mercedes on the Sprinter (NCV3) body and chassis, with VW engines. Body and chassis parts interchange; engine parts do not.",
      vehicles: ["merc-sprinter-ncv3","vw-crafter-1g"],
      parts: [
        { category: "Glass / body", name: "Doors, glass, mirrors, sliding-door parts", confidence: "high" },
        { category: "Suspension", name: "Front leaf spring / shocks / bushes", confidence: "high" },
        { category: "Brakes", name: "Brake pads & discs", confidence: "high", note: "Match by axle rating." },
        { category: "Electrical", name: "Window regulators, switches", confidence: "medium" },
        { category: "Engine", name: "Engine parts", confidence: "avoid", note: "Different engines (Mercedes vs VW TDI) — do not interchange." }
      ]
    },
    {
      id: "ranger-amarok",
      type: "platform",
      name: "Ford Ranger ↔ VW Amarok (T6.2)",
      maker: "Ford (builds both)",
      summary: "The second-generation Amarok is built by Ford on the new Ranger platform with Ford engines. The mechanical parts are the Ranger's, while the styling differs.",
      vehicles: ["ford-ranger-p703","vw-amarok-2g"],
      parts: [
        { category: "Lubrication", name: "Engine oil & fuel filters", confidence: "high" },
        { category: "Fuel system", name: "Diesel injectors", confidence: "high", note: "Per engine (2.0 bi-turbo vs 3.0 V6)." },
        { category: "Suspension", name: "Shocks, control arms, leaf springs", confidence: "high" },
        { category: "Brakes", name: "Brake pads & discs", confidence: "high" },
        { category: "Glass / body", name: "Windscreen", confidence: "high" },
        { category: "Glass / body", name: "Headlamps, bumpers, grille", confidence: "avoid", note: "Brand-specific styling." }
      ]
    },
    {
      id: "cummins-b67",
      type: "engine",
      name: "Cummins 6.7 L B-series (ISB / B6.7)",
      maker: "Cummins",
      summary: "The Cummins 6.7 is used in Ram Heavy Duty pickups and in medium-duty trucks, buses and equipment. Filters and many service parts cross between pickup and commercial applications; ratings, ECUs and emissions hardware differ.",
      vehicles: ["ram-2500-cummins","freightliner-m2-b67"],
      parts: [
        { category: "Lubrication", name: "Oil filter", confidence: "medium", note: "Commercial engines may use a larger spec; check the filter head." },
        { category: "Fuel system", name: "Fuel filters", confidence: "medium" },
        { category: "Fuel system", name: "Common-rail injectors", confidence: "medium", note: "Match the Cummins CPL / ESN number." },
        { category: "Engine", name: "Gasket sets", confidence: "high" },
        { category: "Cooling", name: "Water pump, thermostat", confidence: "medium" },
        { category: "Engine", name: "Aftertreatment (DPF / SCR)", confidence: "avoid", note: "Application-specific." }
      ]
    },

    // ======================== AIRCRAFT ===========================
    {
      id: "lycoming-360",
      type: "engine",
      domain: "aircraft",
      name: "Lycoming 360 series (O-360 / IO-360)",
      maker: "Lycoming",
      summary: "The 360 cubic-inch flat-four powers many of the world's most common training and touring aircraft. Some components are shared across models, but in aviation a part is only usable if it is approved for that exact engine model and airframe.",
      vehicles: ["cessna-172s","piper-pa28-181","piper-pa28r-200","diamond-da40-180"],
      parts: [
        { category: "Ignition / glow", name: "Spark plugs", confidence: "medium", note: "Must appear in the plug manufacturer's approved application list for your exact engine model." },
        { category: "Lubrication", name: "Spin-on oil filter", confidence: "medium", note: "Check approval for the engine model and the filter adapter." },
        { category: "Ignition / glow", name: "Magnetos", confidence: "low", note: "Magneto model and timing are engine-specific." },
        { category: "Engine", name: "Cylinder assemblies", confidence: "low", note: "Compression ratio and parallel vs angle valve heads differ." },
        { category: "Fuel system", name: "Fuel injection servo / carburettor", confidence: "avoid", note: "O-360 is carburetted, IO-360 is fuel-injected." }
      ]
    },
    {
      id: "rotax-912",
      type: "engine",
      domain: "aircraft",
      name: "Rotax 912 family",
      maker: "BRP-Rotax",
      summary: "The Rotax 912 is the most common light-sport and ultralight aircraft engine. Its consumables are shared across every airframe that uses the same 912 variant.",
      vehicles: ["tecnam-p2008","pipistrel-virus-sw","aeroprakt-a22","icon-a5"],
      parts: [
        { category: "Lubrication", name: "Oil filter", confidence: "high", note: "Use the Rotax-approved filter." },
        { category: "Ignition / glow", name: "Spark plugs", confidence: "high", note: "Per Rotax specification for the variant." },
        { category: "Fuel system", name: "Carburettor diaphragms & floats", confidence: "medium", only: ["aeroprakt-a22","tecnam-p2008","pipistrel-virus-sw"], note: "Carburetted variants only; the 912 iS is fuel-injected." },
        { category: "Cooling", name: "Coolant hoses", confidence: "low", note: "Routing is airframe-specific." }
      ]
    },
    {
      id: "cfm56",
      type: "engine",
      domain: "aircraft",
      name: "CFM56 turbofan (-5B Airbus / -7B Boeing)",
      maker: "CFM International",
      summary: "The CFM56 powers both the Airbus A320ceo family (-5B) and the Boeing 737NG (-7B). The variants share a common core design, but most line-replaceable parts are variant-specific. This is mainly useful for MRO tooling and as a reference.",
      vehicles: ["airbus-a320ceo-cfm","boeing-737ng"],
      parts: [
        { category: "Engine", name: "Some consumables & tooling", confidence: "low", note: "Only where the Illustrated Parts Catalogue (IPC) lists the same P/N for both variants." },
        { category: "Engine", name: "Line-replaceable units (LRUs)", confidence: "avoid", note: "Variant-specific." }
      ]
    },

    // ======================== MARINE ===========================
    {
      id: "gm-57-marine",
      type: "engine",
      domain: "marine",
      name: "GM 5.7 L small-block V8: road vs marine",
      maker: "General Motors (marinised by Volvo Penta, MerCruiser)",
      summary: "Many sterndrive and inboard boat engines are marinised GM small-block V8s. Some internal parts match the truck engine, but many parts must not be swapped: marine starters, alternators and distributors are ignition-protected (to prevent fuel-vapour explosions), and marine gaskets, water pumps and cams differ.",
      vehicles: ["volvo-penta-57-gxi","mercruiser-350-mag","chevy-c1500-57-vortec"],
      parts: [
        { category: "Engine", name: "Pistons, rings, bearings", confidence: "medium", note: "Confirm the block casting and spec; marine engines often use different cams." },
        { category: "Engine", name: "Head gaskets", confidence: "avoid", note: "Marine raw-water-cooled engines need corrosion-resistant marine gaskets." },
        { category: "Electrical", name: "Starter, alternator, distributor", confidence: "avoid", note: "Automotive units are not ignition-protected. They can ignite fuel vapour in an engine bay." },
        { category: "Cooling", name: "Circulating water pump", confidence: "avoid", note: "Marine pumps differ in rotation, materials and seals." },
        { category: "Lubrication", name: "Oil filter", confidence: "medium", note: "Use the marine-specified filter where the engine maker requires it." },
        { category: "Engine", name: "Marine engine parts between Volvo Penta & MerCruiser", confidence: "low", only: ["volvo-penta-57-gxi","mercruiser-350-mag"], note: "Same GM base, but marinisation parts are brand-specific." }
      ]
    }

  ]
};
