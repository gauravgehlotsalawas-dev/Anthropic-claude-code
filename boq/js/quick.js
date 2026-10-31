// Quantity takeoff from overall building dimensions (framed RCC building), no AI needed.

export const QUICK_FIELDS = [
  ["floors", "Number of floors", 2],
  ["area", "Plinth area per floor (sqm)", 100],
  ["height", "Floor-to-floor height (m)", 3.0],
  ["plinth", "Plinth height above ground (m)", 0.45],
  ["extWall", "External wall length per floor (m)", 42],
  ["intWall", "Internal wall length per floor (m)", 30],
  ["extT", "External wall thickness (m)", 0.23],
  ["intT", "Internal wall thickness (m)", 0.115],
  ["footings", "Number of footings / columns", 12],
  ["footL", "Footing length (m)", 1.5],
  ["footB", "Footing breadth (m)", 1.5],
  ["footT", "Footing thickness (m)", 0.45],
  ["footDepth", "Foundation depth below ground (m)", 1.5],
  ["colB", "Column size B (m)", 0.23],
  ["colD", "Column size D (m)", 0.45],
  ["beamB", "Beam width (m)", 0.23],
  ["beamD", "Beam depth incl. slab (m)", 0.45],
  ["slabT", "Slab thickness (m)", 0.125],
  ["doors", "Doors (nos, 1.0 × 2.1 m)", 8],
  ["windows", "Windows (nos, 1.5 × 1.2 m)", 10],
  ["steelFoot", "Steel in footings (kg/cum)", 80],
  ["steelCol", "Steel in columns (kg/cum)", 180],
  ["steelBeam", "Steel in beams (kg/cum)", 140],
  ["steelSlab", "Steel in slabs (kg/cum)", 90],
];

const r3 = (v) => Math.round(v * 1000) / 1000;
const M = (label, nos, l, b, d) => ({ label, nos: r3(nos), l: l === "" ? "" : r3(l), b: b === "" ? "" : r3(b), d: d === "" ? "" : r3(d) });
const vol = (ms) => ms.reduce((a, m) => a + [m.nos, m.l, m.b, m.d].filter((x) => x !== "").reduce((p, x) => p * x, 1), 0);

/** Returns BOQ lines: { section, description, unit, measurements, notes } */
export function quickTakeoff(v) {
  const n = v.floors, H = v.height;
  const doorA = 1.0 * 2.1, winA = 1.5 * 1.2;
  const out = [];
  const add = (section, description, unit, measurements, notes = "") => out.push({ section, description, unit, measurements, notes, confidence: "medium" });

  const exc = [M("Footing pits (0.3 m working space each side)", v.footings, v.footL + 0.6, v.footB + 0.6, v.footDepth)];
  add("Earthwork", "Earthwork in excavation for foundation in all kinds of soil including disposal", "cum", exc);

  const pcc = [M("Below footings", v.footings, v.footL + 0.2, v.footB + 0.2, 0.1)];
  add("Concrete", "Plain cement concrete 1:4:8 in foundation bed", "cum", pcc);

  const foot = [M("Isolated footings", v.footings, v.footL, v.footB, v.footT)];
  const colBelow = Math.max(0, v.footDepth - v.footT - 0.1);
  const col = [
    M("Columns below ground (pedestal)", v.footings, v.colB, v.colD, colBelow),
    M("Columns plinth to roof", v.footings, v.colB, v.colD, v.plinth + n * H),
  ];
  const beamLen = v.extWall + v.intWall;
  const beams = [
    M("Plinth beams", 1, beamLen, v.beamB, v.beamD - 0.0),
    M("Floor/roof beams below slab", n, beamLen, v.beamB, v.beamD - v.slabT),
  ];
  const slab = [M("Floor and roof slabs", n, v.area, "", v.slabT)];
  add("Concrete", "Reinforced cement concrete M25 in footings, bases of columns, rafts", "cum", foot);
  add("Concrete", "Reinforced cement concrete M25 in columns, pillars, piers above plinth", "cum", col);
  add("Concrete", "Reinforced cement concrete M25 in beams, lintels, girders", "cum", beams);
  add("Concrete", "Reinforced cement concrete M25 in suspended floors, roofs (slabs)", "cum", slab);

  add("Reinforcement", "Steel reinforcement TMT bars Fe500 including cutting, bending, binding", "kg", [
    M(`Footings @ ${v.steelFoot} kg/cum`, 1, vol(foot), v.steelFoot, ""),
    M(`Columns @ ${v.steelCol} kg/cum`, 1, vol(col), v.steelCol, ""),
    M(`Beams @ ${v.steelBeam} kg/cum`, 1, vol(beams), v.steelBeam, ""),
    M(`Slabs @ ${v.steelSlab} kg/cum`, 1, vol(slab), v.steelSlab, ""),
  ], "Steel estimated from typical kg per cum ratios; replace with bar bending schedule quantities when available.");

  add("Formwork", "Centering and shuttering (formwork) for columns, pillars, piers", "sqm", [
    M("Column sides", v.footings, 2 * (v.colB + v.colD), "", colBelow + v.plinth + n * H),
  ]);
  add("Formwork", "Centering and shuttering (formwork) for beams, lintels, girders", "sqm", [
    M("Beam sides and soffit", n + 1, beamLen, v.beamB + 2 * (v.beamD - v.slabT), ""),
  ]);
  add("Formwork", "Centering and shuttering (formwork) for suspended floors, roofs, landings (slabs)", "sqm", [M("Slab soffit", n, v.area, "", "")]);

  const fill = [M("Excavation", 1, vol(exc), "", ""), M("Less PCC", -1, vol(pcc), "", ""), M("Less footings", -1, vol(foot), "", ""),
    M("Less pedestals", -v.footings, v.colB, v.colD, colBelow)];
  add("Earthwork", "Filling and compacting excavated earth in foundation trenches", "cum", fill);
  add("Earthwork", "Filling in plinth with earth or sand in layers, watering and ramming", "cum", [M("Plinth filling", 1, v.area * 0.85, "", Math.max(0, v.plinth - 0.1))]);

  const wallH = H - v.beamD;
  add("Masonry", "Brick masonry in cement mortar 1:6 in superstructure", "cum", [
    M("External walls", n, v.extWall, v.extT, wallH),
    M("Internal walls", n, v.intWall, v.intT, wallH),
    M("Deduct doors (assume half in external walls)", -v.doors / 2, 1.0, v.extT, 2.1),
    M("Deduct doors in internal walls", -v.doors / 2, 1.0, v.intT, 2.1),
    M("Deduct windows", -v.windows, 1.5, v.extT, 1.2),
  ], "Half-brick internal walls are often measured in sqm; change the unit if your rate book does.");

  add("Plaster", "12 mm cement plaster 1:6 on internal walls", "sqm", [
    M("Inner face of external walls", n, v.extWall, "", wallH),
    M("Both faces of internal walls", 2 * n, v.intWall, "", wallH),
    M("Deduct doors (2 faces)", -v.doors * 2, 1.0, "", 2.1),
    M("Deduct windows (1 face)", -v.windows, 1.5, "", 1.2),
  ]);
  add("Plaster", "20 mm cement plaster 1:4 on external walls", "sqm", [
    M("External face", 1, v.extWall + 8 * v.extT, "", n * H + v.plinth),
    M("Deduct windows", -v.windows, 1.5, "", 1.2),
  ]);
  add("Plaster", "6 mm cement plaster 1:3 on ceiling", "sqm", [M("Ceilings", n, v.area * 0.88, "", "")]);

  add("Flooring", "Vitrified tile flooring on cement mortar bed", "sqm", [M("Floor area (carpet ≈ 85% of plinth)", n, v.area * 0.85, "", "")]);
  add("Flooring", "Skirting with vitrified tiles 100 mm high", "m", [M("Room perimeters (≈ wall lengths × 2)", n, v.extWall + 2 * v.intWall, "", "")]);

  add("Doors and windows", "Flush door shutters with frame, fittings complete", "sqm", [M("Doors 1.0 × 2.1", v.doors, 1.0, 2.1, "")]);
  add("Doors and windows", "Aluminium / UPVC sliding windows with glazing", "sqm", [M("Windows 1.5 × 1.2", v.windows, 1.5, 1.2, "")]);

  add("Finishing", "Acrylic emulsion paint on internal walls and ceiling, two coats over primer and putty", "sqm", [
    M("Internal walls (as plaster)", 1, vol(out.find((o) => o.description.startsWith("12 mm")).measurements), "", ""),
    M("Ceilings", n, v.area * 0.88, "", ""),
  ]);
  add("Finishing", "Exterior acrylic weatherproof paint, two coats over primer", "sqm", [
    M("As external plaster", 1, vol(out.find((o) => o.description.startsWith("20 mm")).measurements), "", ""),
  ]);
  add("Waterproofing", "Waterproofing treatment on roof with brick bat coba / membrane", "sqm", [M("Roof area", 1, v.area, "", "")]);

  return out;
}
