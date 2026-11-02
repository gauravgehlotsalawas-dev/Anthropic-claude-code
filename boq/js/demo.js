// A complete, fictional demo work for trying the bills module: "Gaurav Nagar Nigam".
// Every name, number and rate here is invented for demonstration.
import { uid, newProject } from "./store.js";

const G = [
  ["Earth work in excavation in foundation, trenches etc. including dressing of sides and ramming of bottoms, getting out the excavated material, refilling after laying pipe / foundation and disposal of surplus excavated material at a lead up to 50 m, depth up to 1.5 m, in ordinary soil.", "cum", 420, 312.0],
  ["Providing and laying in position cement concrete of specified grade excluding the cost of centring and shuttering - all work up to plinth level : 1:4:8 (1 cement : 4 coarse sand : 8 graded stone aggregate 40 mm nominal size).", "cum", 96, 4620.0],
  ["Providing and laying in position machine batched and machine mixed design mix cement concrete of grade M-25 for rigid pavement, laid with paver, including curing, joints and finishing complete.", "cum", 310, 7480.0],
  ["Reinforcement for R.C.C. work at all levels including straightening, cutting, bending, placing in position and binding all complete : Thermo-mechanically treated bars Fe 500.", "kg", 6800, 86.5],
  ["Centring and shuttering including strutting, propping etc. and removal of form for foundations, footings, bases of columns and walls of drains.", "sqm", 940, 298.0],
  ["Providing and laying in position specified grade of reinforced cement concrete excluding the cost of centring, shuttering, finishing and reinforcement : 1:1.5:3 (1 cement : 1.5 coarse sand : 3 graded stone aggregate 20 mm) for drain walls and base.", "cum", 145, 6380.0],
  ["Cement plaster 12 mm thick in cement mortar 1:4 (1 cement : 4 fine sand) on drain walls, including curing and finishing smooth.", "sqm", 1250, 318.0],
  ["Providing and fixing precast R.C.C. drain cover slabs 75 mm thick in M-25 with lifting hooks, fixed in cement mortar 1:3 complete.", "sqm", 410, 1265.0],
  ["Granular sub-base with well graded material, spread in uniform layers on prepared surface, compacted with vibratory roller to the required density.", "cum", 260, 1420.0],
  ["Painting road marking with hot applied thermoplastic compound 2.5 mm thick including reflectorising glass beads, as per IRC:35.", "sqm", 180, 865.0],
  ["Providing and erecting retro-reflectorised cautionary and informatory signs on M.S. angle post with M-15 concrete foundation complete.", "nos", 14, 6150.0],
  ["Silt clearance of existing drains and disposal of silt within 1 km lead including loading and unloading.", "cum", 520, 205.0],
];
const H = [
  ["Painting of theme based murals on boundary walls (Swachh Bharat / culture of Gaurav Nagar) with weather-proof acrylic colours on prepared surface, as directed by Engineer-in-charge.", "sqm", 650, 455.0],
  ["Supply, installation, testing and commissioning of 9 m octagonal pole with 60 W LED solar street light, battery and controller complete.", "nos", 12, 48500.0],
];

/** Small placeholder "site photographs" drawn on a canvas, so the demo needs no real images. */
function demoPhoto(title, hue) {
  const c = document.createElement("canvas"); c.width = 800; c.height = 600;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 600); g.addColorStop(0, `hsl(${hue},45%,72%)`); g.addColorStop(0.55, `hsl(${hue},25%,58%)`); g.addColorStop(1, "#6b6457");
  x.fillStyle = g; x.fillRect(0, 0, 800, 600);
  x.fillStyle = "rgba(60,55,48,.85)"; x.beginPath(); x.moveTo(0, 600); x.lineTo(330, 330); x.lineTo(470, 330); x.lineTo(800, 600); x.fill();
  x.strokeStyle = "#f2f0e6"; x.lineWidth = 6; x.setLineDash([40, 30]); x.beginPath(); x.moveTo(400, 340); x.lineTo(400, 600); x.stroke();
  x.setLineDash([]); x.fillStyle = "rgba(255,255,255,.9)"; x.fillRect(0, 0, 800, 70);
  x.fillStyle = "#222"; x.font = "bold 30px sans-serif"; x.fillText(title, 24, 46);
  x.font = "20px sans-serif"; x.fillStyle = "#fff"; x.fillText("DEMO SITE PHOTOGRAPH · Gaurav Nagar Nigam", 24, 580);
  return c.toDataURL("image/jpeg", 0.85);
}

export function buildDemoProject() {
  const p = newProject("Construction of C.C. Road and Covered Drain from Gandhi Chowk to Shastri Park, Ward No. 12, Gaurav Nagar");
  p.client = "Gaurav Nagar Nigam";
  p.reference = "NIT No. GNN/12/2026-27";
  const mk = (rows, sched, prefix) => rows.map(([description, unit, qty, rate], i) => ({ id: uid("b"), bsrId: "", code: "", description, unit, qty, rate, measurements: [], schedule: sched, sno: prefix ? `${i + 1}` : i + 1 }));
  const g = mk(G, "G", true), h = mk(H, "H", true);
  p.sections = [{ id: uid("s"), name: "G-Schedule", items: g }, { id: uid("s"), name: "H-Schedule", items: h }];
  p.contract = {
    contractor: "M/s Demo Builders & Contractors", workOrderNo: "GNN/WO/2026-27/0457", woDate: "2026-04-15", office: "Gaurav Nagar Nigam",
    tpPct: 3.5, tpDir: "below", extraLimitPct: 5, commence: "2026-04-20", stipulated: "2026-10-19", completed: "",
    jen: "Ramesh Kumar", aen: "Suresh Sharma", xen: "Anil Mehta",
    terms: [
      "The work shall be completed within six months from the date of the written order to commence.",
      "Security deposit at 5% of the gross amount shall be deducted from each running bill.",
      "Income tax, GST and labour welfare cess shall be deducted as per rules in force.",
      "Payment of extra items shall be made only after sanction of the competent authority.",
      "The contractor shall maintain the work for a defect liability period of three years.",
    ],
  };
  const ex1 = { id: uid("x"), description: "Dismantling of existing brick masonry drain walls including stacking of serviceable material and disposal of unserviceable material within 50 m lead.", unit: "cum", rate: 640.0 };
  const ex2 = { id: uid("x"), description: "Supply and fixing of 300 mm dia NP-3 R.C.C. hume pipe for road crossing including jointing and bedding complete.", unit: "mtr", rate: 2950.0 };
  p.extras = [ex1, ex2];
  const q = (arr) => Object.fromEntries(arr.filter(([, v]) => v != null).map(([i, v]) => [i.id, v]));
  const bill1 = {
    id: uid("bl"), kind: "running", date: "2026-06-28", measured: "2026-06-25", mbNo: "GNN/MB/88/2026-27", mbPages: "1 to 24", jen: "Ramesh Kumar", aen: "Suresh Sharma", voucher: "",
    qty: q([[g[0], 365.4], [g[1], 82.15], [g[2], 140.6], [g[3], 2860], [g[4], 512.8], [g[5], 74.25], [g[11], 488.5], [h[0], 320], [ex1, 38.6]]),
    // Concrete for the road paid at a part rate until the joints are finished.
    partRate: { [g[2].id]: 6200 },
    // Silt clearance: part of the quantity accepted at a reduced rate.
    parts: { [g[11].id]: [{ qty: 410, rate: "" }, { qty: 78.5, rate: 120 }] },
    mbs: {},
  };
  delete bill1.qty[g[11].id];
  const bill2 = {
    id: uid("bl"), kind: "running", date: "2026-08-30", measured: "2026-08-27", mbNo: "GNN/MB/88/2026-27", mbPages: "25 to 51", jen: "Ramesh Kumar", aen: "Suresh Sharma", voucher: "",
    qty: q([[g[0], 412.3], [g[1], 95.6], [g[2], 306.4], [g[3], 6720], [g[4], 925.4], [g[5], 143.8], [g[6], 1190], [g[7], 288], [g[8], 254.7], [h[0], 655.5], [h[1], 8], [ex1, 38.6], [ex2, 46]]),
    partRate: {},
    parts: { [g[11].id]: [{ qty: 488.5, rate: "" }, { qty: 41.2, rate: 120 }] },
    mbs: {},
  };
  p.bills = [bill1, bill2];
  p.photos = [
    ["Excavation for drain, Ch. 0-120 m", 30], ["Reinforcement of drain base", 200], ["Drain walls after de-shuttering", 120],
    ["M-25 road concrete with paver", 45], ["Precast cover slabs fixed", 160], ["Theme mural on boundary wall (H-Schedule)", 300],
  ].map(([t, hue]) => ({ id: uid("ph"), src: demoPhoto(t, hue), caption: t }));
  return p;
}
