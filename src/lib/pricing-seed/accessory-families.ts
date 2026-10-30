/**
 * The accessory families (owner, Oct 26–27): the Duro-Tech TPO accessories on the Duro-Last
 * screens, and two new catalog branches — Non-DL TPO Accessories (`non_dl_tpo`) and EPDM
 * Accessories (`epdm`) — mirroring the Duro-Last screens the engine reads
 * (engine/adapters.ts buildAccessoryRefData), so the bid's three accessory groups compute the
 * same way. Transcribed from the owner's price sheets:
 *
 *  - Duro-Last "Duro-Tech TPO by Duro-Last" pages 23–24 and the TPO caulk / adhesives / vents
 *    page, dated 09/28/2026 (current).
 *  - Firestone Building Products: UltraPly TPO Flashing and Accessories, Adhesives and Sealants,
 *    Attachment Accessories (March 1, 2013); EPDM Flashings, Sealants and Adhesives and
 *    QuickSeam Products (July 1, 2012); Universal-System Sealants / Accessories, Universal
 *    Coatings, Ballast Pavers, Garden Roof, SkyPavers, V-Force (July 1, 2013); All Purpose,
 *    Heavy Duty / HD Plus, HD HailGard, Miscellaneous Fasteners and Plates, I.S.O. adhesives
 *    (July 1, 2012). THOSE PRICES ARE 2012–2013 LIST PRICES, loaded as printed; the owner updates
 *    them on Estimate Pricing or by a price-list import against the item numbers below.
 *
 * Item numbers: Firestone prints a prefix per page ("W56358…", "W56RAC…", "W56…" + "TPO…"); the
 * full code is stored (W563587031, W56RAC4180, W56TPO3024). Duro-Tech numbers are stored as
 * printed; tan and gray accessories end in TB / TG at the same price (the sheet's note).
 *
 * Conventions the engine needs (read before editing):
 *  - A Duro-Tech row on a Duro-Last screen starts with `DURO_TECH_PREFIX`. lib/accessory-families.ts
 *    strips it when it builds the Duro-Tech ref data, so a vent named "Duro-Tech TPO Tan Vent"
 *    counts on a tan Duro-Tech TPO roof the way "Tan Vent" does, and a pipe stack of a size the
 *    Duro-Last screen also carries replaces the Duro-Last one on a Duro-Tech TPO bid.
 *  - The Membrane Accs "T-Patch" row is the ONE t-joint product the engine counts per family
 *    (owner: UltraPly for Non-DL TPO; QuickSeam Joint Covers for EPDM).
 *  - A pipe stack row needs a numeric Size; a universal boot is listed once per size it covers.
 *  - Corner prices are read from the White / Tan / Gray columns; EPDM parts are black and are
 *    priced under White (the engine has no Black corner column).
 *  - Rows without an automatic count (flashing rolls, tapes, tools, anchors) live on the
 *    family's "Other Accessories" screen: a typed quantity × price, with labor hours per unit.
 */

export type SeedCell = string | number;
export type SeedRow = Record<string, SeedCell>;

export interface SeedScreen {
  id: string;
  branch: string;
  category: string;
  sort: number;
  columns: string[];
  help: string;
  rows: SeedRow[];
}

export interface SeedItemNumber {
  item_no: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  dl_description: string;
}

export const DURO_TECH_PREFIX = "Duro-Tech TPO ";
export const DURO_TECH_SYSTEM = "Duro-Tech TPO";
export const NON_DL_TPO_BRANCH = "non_dl_tpo";
export const EPDM_BRANCH = "epdm";
export const OTHER_ACCESSORIES_SCREEN = "other_accessories";
export const OTHER_ACCESSORIES_CATEGORY = "Other Accessories";

const OTHER_COLUMNS = ["Description", "Part #", "Price", "Labor (Hrs)"];
const PRICE_COLUMNS = ["Description", "Part #", "Price"];
const CORNER_COLUMNS = [
  "Description",
  "Part #",
  "White",
  "Tan",
  "Gray",
  "Dark Gray",
  "Terra Cotta",
];
const PIPE_COLUMNS = [
  "Description",
  "Size",
  "Open Part #",
  "Closed Part #",
  "Price",
  "Tan Price",
  "Gray Price",
  "Dark Gray",
  "Terra Cotta",
  "Rock Ply",
];
const FASTENER_COLUMNS = ["Part #", "Subtype", "Description", "Price/Box", "Fasteners/Box"];
const MEMBRANE_ACCS_COLUMNS = ["Description", "Part #", "Parts/Package", "Price/Package"];
const DRAIN_BOOT_COLUMNS = ["Description", "Part #", "Price", "+ for Color"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const row = (description: string, part: string, price: number): SeedRow => ({
  Description: description,
  "Part #": part,
  Price: price,
});
const other = (description: string, part: string, price: number, hours = 0): SeedRow => ({
  Description: description,
  "Part #": part,
  Price: price,
  "Labor (Hrs)": hours,
});
const corner = (
  description: string,
  part: string,
  white: number,
  tan: number | "" = white,
  gray: number | "" = white,
): SeedRow => ({
  Description: description,
  "Part #": part,
  White: white,
  Tan: tan,
  Gray: gray,
  "Dark Gray": "",
  "Terra Cotta": "",
});
const pipe = (
  description: string,
  size: number,
  openPart: string,
  closedPart: string,
  price: number,
  tan: number | "" = price,
  gray: number | "" = price,
): SeedRow => ({
  Description: description,
  Size: size,
  "Open Part #": openPart,
  "Closed Part #": closedPart,
  Price: price,
  "Tan Price": tan,
  "Gray Price": gray,
  "Dark Gray": "",
  "Terra Cotta": "",
  "Rock Ply": "",
});
const fastener = (
  part: string,
  subtype: string,
  description: string,
  priceBox: number,
  perBox: number,
): SeedRow => ({
  "Part #": part,
  Subtype: subtype,
  Description: description,
  "Price/Box": priceBox,
  "Fasteners/Box": perBox,
});

/* ================================================================================================
 * Duro-Tech TPO → the Duro-Last screens (prefixed rows; the 09/28/2026 Duro-Last price sheet)
 * ============================================================================================== */

const DT = DURO_TECH_PREFIX;

/** Rows appended to existing Duro-Last screens (never replacing a row). */
export const DURO_LAST_ADDITIONS: Array<{ screen_id: string; rows: SeedRow[] }> = [
  {
    screen_id: "duro_last:sealants",
    rows: [
      row(`${DT}White TPO Caulk`, "1136T", 10.0),
      // Owner, Oct 27: a second row beside Pitch Pocket Filler (10.2 oz) 1121, to be safe.
      row(`${DT}Pitch Pan Filler (30/case or single)`, "11222", 10.7),
      row(`${DT}Duro-Stop Non-Skinning Sealant (water cut-off mastic)`, "11029", 9.5),
      row(`${DT}TECH-Bond LVOC Splice Wash Cleaner (3 gal)`, "11022T", 165.0),
      row(`${DT}Primer Millennium 240LVOC (6 × 1 gal case)`, "11221T", 423.9),
    ],
  },
  {
    screen_id: "duro_last:pipe_stacks",
    rows: [
      pipe(`${DT}1" Open Only`, 1, "2315TW", "0", 24.5),
      pipe(`${DT}1.5" Closed/Open`, 1.5, "2315HTW", "1315HTW", 24.5),
      pipe(`${DT}2" Closed/Open`, 2, "2316TW", "1316TW", 24.5),
      pipe(`${DT}3" Closed/Open`, 3, "2317TW", "1317TW", 26.75),
      pipe(`${DT}4" Closed/Open`, 4, "2318TW", "1318TW", 26.75),
      pipe(`${DT}5" Closed/Open`, 5, "2319TW", "1319TW", 31.2),
      pipe(`${DT}6" Closed/Open`, 6, "2320TW", "1320TW", 31.2),
      pipe(`${DT}7" Closed/Open`, 7, "2321TW", "1321TW", 35.65),
      pipe(`${DT}8" Closed/Open`, 8, "2322TW", "1322TW", 35.65),
      pipe(`${DT}9" Closed/Open`, 9, "2323TW", "1323TW", 40.1),
      pipe(`${DT}10" Closed/Open`, 10, "2324TW", "1324TW", 40.1),
      pipe(`${DT}11" Closed/Open`, 11, "2325TW", "1325TW", 44.55),
      pipe(`${DT}12" Closed/Open`, 12, "2326TW", "1326TW", 44.55),
      pipe(`${DT}13" Closed/Open`, 13, "2327TW", "1327TW", 49.0),
      pipe(`${DT}14" Closed/Open`, 14, "2328TW", "1328TW", 49.0),
      pipe(`${DT}15" Closed/Open`, 15, "2329TW", "1329TW", 51.25),
    ],
  },
  {
    screen_id: "duro_last:corners",
    rows: [
      corner(`${DT}6" x 6" Inside`, "1311TW", 11.15),
      corner(`${DT}6" x 6" Outside`, "1312TW", 11.15),
      // Priced per corner from the box / bag price on the sheet (20 per: $178.05 / $200.35).
      corner(`${DT}Inside/Outside Molded Corner (20/box)`, "45106TW", r2(178.05 / 20)),
      corner(`${DT}Pre-Molded Outside Corner (20/bag)`, "45107TW", r2(200.35 / 20)),
      corner(`${DT}7" Curb Corner (12" x 12" x 9")`, "13307TW", 15.6),
      corner(`${DT}13" Curb Corner (24" x 24" x 12")`, "13313TW", 22.3),
      corner(`${DT}19" Curb Corner (36" x 36" x 12")`, "13319TW", 29.0),
      corner(`${DT}25" Curb Corner (48" x 48" x 12")`, "13325TW", 35.65),
      corner(`${DT}31" Curb Corner (60" x 60" x 12")`, "13331TW", 42.35),
      corner(`${DT}37" Curb Corner (72" x 72" x 12")`, "13337TW", 49.0),
    ],
  },
  {
    screen_id: "duro_last:walk_pads_wall_vents",
    rows: [
      row(`${DT}White 30" x 50' Roll - Walk Pad`, "10800TW", 507.0),
      row(`${DT}CROSSGRIP Mat White 2'6" x 30' (drop-ship)`, "1037TW", 949.0),
      row(`${DT}CROSSGRIP Mat Gray 2'6" x 30' (drop-ship)`, "1037TG", 949.0),
      row(`${DT}CROSSGRIP Mat Yellow 2'6" x 30' (drop-ship)`, "1037TY", 949.0),
    ],
  },
  {
    screen_id: "duro_last:drain_boots",
    rows: [
      { ...row(`${DT}2" Drain Boot`, "1916TW", 27.85), "+ for Color": "" },
      { ...row(`${DT}2 1/2" Drain Boot`, "1916HTW", 27.85), "+ for Color": "" },
      { ...row(`${DT}3" Drain Boot`, "1917TW", 27.85), "+ for Color": "" },
      { ...row(`${DT}3 1/2" Drain Boot`, "1917HTW", 27.85), "+ for Color": "" },
      { ...row(`${DT}4" Drain Boot`, "1918TW", 27.85), "+ for Color": "" },
      { ...row(`${DT}4 1/2" Drain Boot`, "1918HTW", 27.85), "+ for Color": "" },
      { ...row(`${DT}5" Drain Boot`, "1922TW", 27.85), "+ for Color": "" },
      { ...row(`${DT}5 1/2" Drain Boot`, "1922HTW", 33.4), "+ for Color": "" },
      { ...row(`${DT}6" Drain Boot`, "1921TW", 33.4), "+ for Color": "" },
      { ...row(`${DT}6 1/2" Drain Boot`, "1921HTW", 33.4), "+ for Color": "" },
      { ...row(`${DT}7" Drain Boot`, "1923TW", 33.4), "+ for Color": "" },
      { ...row(`${DT}7 1/2" Drain Boot`, "1923HTW", 36.8), "+ for Color": "" },
      { ...row(`${DT}8" Drain Boot`, "1924TW", 36.8), "+ for Color": "" },
    ],
  },
  {
    screen_id: "duro_last:drain_boot_accessories",
    rows: [
      row(`${DT}Dome Strainer White`, "1830TW", 72.0),
      row(`${DT}Drain Guard White Tabs`, "18301TW", 72.0),
      row("Drain Guard Clamping Ring Attachment Clips (pair)", "1830-2", 6.8),
      // Retrofit drain assemblies (owner, Oct 27: typed quantity here).
      row(`${DT}OMG Hercules Roof Drain 3"`, "1509-001T", 525.0),
      row(`${DT}OMG Hercules Roof Drain 4"`, "1510-001T", 531.0),
      row(`${DT}OMG Hercules Roof Drain 5"`, "1511-001T", 550.0),
      row(`${DT}OMG Hercules Roof Drain 6"`, "1512-001T", 582.0),
      row(`${DT}TRUFAST EasySeal Roof Drain 3"`, "1513-001", 479.0),
      row(`${DT}TRUFAST EasySeal Roof Drain 4"`, "1514-001", 499.0),
      row(`${DT}TRUFAST EasySeal Roof Drain 5"`, "1515-001", 510.0),
      row(`${DT}TRUFAST EasySeal Roof Drain w/ TPO Coated Flange 3"`, "1516-001T", 502.0),
      row(`${DT}TRUFAST EasySeal Roof Drain w/ TPO Coated Flange 4"`, "1517-001T", 518.0),
      row(`${DT}TRUFAST EasySeal Roof Drain w/ TPO Coated Flange 5"`, "1518-001T", 532.0),
    ],
  },
  {
    screen_id: "duro_last:vents",
    // Named by colour so a Duro-Tech TPO roof counts them like the Duro-Last vents (owner,
    // Oct 27): a two-way vent, white body with a white / tan / gray skirt.
    rows: [
      row(`${DT}White Vent`, "13303TW", 35.0),
      row(`${DT}Tan Vent`, "13303TB", 35.0),
      row(`${DT}Gray Vent`, "13303TG", 35.0),
    ],
  },
  {
    screen_id: "duro_last:fasteners_and_bits",
    rows: [
      fastener("1305T", "DL-Plates", `${DT}HD Seam Plate`, 470.0, 1000),
      fastener("1302T", "DL-Plates", `${DT}Induction Plate`, 480.0, 500),
    ],
  },
];

/** The Composite Drain Rings renumbered to the 09/28/2026 sheet (same sizes, same prices). */
export const CDR_RENUMBER: Array<{ from: string; to: string }> = [
  { from: "1536", to: "15361" },
  { from: "1536H", to: "15361H" },
  { from: "1537", to: "15371" },
  { from: "1537H", to: "15371H" },
  { from: "1538", to: "15381" },
  { from: "1538H", to: "15381H" },
  { from: "1539", to: "15391" },
  { from: "1539H", to: "15391H" },
  { from: "1540", to: "15401" },
  { from: "1540H", to: "15401H" },
  { from: "1541", to: "15411" },
  { from: "1541H", to: "15411H" },
  { from: "1542", to: "15421" },
];

/** Duro-Tech TPO 10' × 100' roll numbers → the membrane screen's price cells ($/sq ft). */
export const MEMBRANE_ITEM_NUMBERS: SeedItemNumber[] = [
  ["44103", "Duro-Tech TPO - 45", "White"],
  ["44107", "Duro-Tech TPO - 45", "Tan"],
  ["44111", "Duro-Tech TPO - 45", "Gray"],
  ["44115", "Duro-Tech TPO - 60", "White"],
  ["44119", "Duro-Tech TPO - 60", "Tan"],
  ["44123", "Duro-Tech TPO - 60", "Gray"],
  ["44127", "Duro-Tech TPO - 80", "White"],
  ["44131", "Duro-Tech TPO - 80", "Tan"],
  ["44135", "Duro-Tech TPO - 80", "Gray"],
].map(([item_no, row_label, price_col]) => ({
  item_no: item_no!,
  screen_id: "duro_last:duro_last_membrane",
  row_label: row_label!,
  price_col: price_col!,
  dl_description: `${row_label} ${price_col} 10' x 100' roll`,
}));

/* ================================================================================================
 * Universal rows (Firestone "Universal-System" pages: EPDM and TPO columns both X)
 * ============================================================================================== */

const universalSealants = (): SeedRow[] => [
  row('FillGard "M" Pourable Sealer (carton of 4 kits)', "W563587088", 270.0),
  row("Pourable Sealer S10 (per gal; 4 × 1 gal/ctn, 185 cu in/gal)", "W563587065", 71.0),
  row("WaterBlock Seal S20 (25 cartridges/ctn, 250 lin ft)", "W563587071", 138.0),
  row("AP Sealant (30 tubes/ctn, 2,760 fastener heads)", "W563587078", 350.0),
  row("AP Sealant Sausage Chubs (20 × 20 oz/ctn, 3,500 fastener heads)", "W563587079", 326.0),
  row("Splice Wash SW-100 (per gal; 5 gal pail, 200–250 sq ft/gal)", "W563587066", 19.0),
  row("Single Ply LVOC Primer (per gal; 3 gal pail, 200–250 sq ft/gal)", "W563587110", 99.0),
  row("Single Ply LVOC Primer (4 × 1 gal/ctn)", "W563587111", 359.0),
  row("Single Ply LVOC Primer (12 qts/ctn)", "W563587112", 725.0),
  row("Single Ply LVOC Splice Wash (per gal; 3 gal pail, 250–300 sq ft/gal)", "W563587113", 38.0),
];

const universalOther = (): SeedRow[] => [
  other("Metal Batten Strips 1\" x 10' (500 lin ft/tube, 50 pieces)", "W56RAC3053", 227.0),
  other("Polymer Batten Strips 3/4\" x 250' (250 lin ft/ctn)", "W56RAC3071", 87.0),
  other("Coiled Metal Batten Strip 1\" x 220' (220 ft/ctn)", "W56RAC3052", 81.0),
  other("Polymer Auger Batten Strip (Metal) 1\" x 10' (500 lin ft/tube)", "W56RAC3059", 195.0),
  other("Protection Mat 4.5 oz (per sq ft; 15' x 320' roll, 4,800 sq ft)", "W56RAC9000", 0.22),
  other("Drain Bar 4\" x 10' (includes fasteners; 100 lin ft/tube)", "W56RAC358-3065", 335.0),
  other('Drain Bar Fasteners 1 1/2" (1000/ctn)', "W56RAC4255", 655.0),
  other("Quickseam Yellow Safety Strip 5.5\" x 100' (100 lin ft)", "W56RAC1870", 397.0),
  other("Setter Tool (AP & HD pre-assembled plates)", "W56RAC358-2035", 107.0),
  other("Stand-Up Fastening Tool (AP & HD pre-assembled plates)", "W56RAC358-2039", 469.0),
  other("Metal Cap Nailing Machine", "W56RAC2700", 3000.0),
  other('Drive Steel Caps and Nails 1 1/4" (2 × 1,500 piece coils)', "W56RAC2701", 119.0),
  other("I.S.O.FIX Hose and Wand Kit (3 canisters)", "W56RACINSH", 53.0),
  other("I.S.O. Twin Pack Hand Dispenser", "W56RACINTG", 236.0),
  other("I.S.O. Twin Pack Four Bead Dispenser", "W56RACINT4", 3500.0),
];

const universalStrainers = (): SeedRow[] => [
  row('3" Drain Insert (3" reroof drain)', "W56RAC2713", 249.0),
  row('4" Drain Insert (4" reroof drain)', "W56RAC2714", 284.0),
];

/** Aluminum termination bar, $397 per 500 ft tube, the same for every colour. */
const universalTermBars = (): SeedRow[] => [
  row("White", "W56RAC3061", r2(397 / 500)),
  row("Tan", "W56RAC3061", r2(397 / 500)),
  row("Gray", "W56RAC3061", r2(397 / 500)),
];

/**
 * Firestone fasteners and plates (July 1, 2012 pages), filed under the Duro-Last fastener types
 * the bid's deck screens sort by (owner approved the filing, Oct 27): All-Purpose → Spade;
 * Heavy Duty / HD Plus / HailGard / Stainless → XHD; Purlin → Purlin; Concrete Drive, Drive Pins,
 * Impact Nail → Nail; Polymer, LWC Base-Ply → Auger; plates → DL-Plates.
 */
const universalFasteners = (): SeedRow[] => {
  const out: SeedRow[] = [];
  const add = (
    prefixCode: string,
    subtype: string,
    name: string,
    items: Array<[string, string, number, number]>,
  ) => {
    for (const [code, size, price, perBox] of items)
      out.push(fastener(`${prefixCode}${code}`, subtype, `${size} ${name}`, price, perBox));
  };
  add("W56RAC", "Spade", "All-Purpose (.235)", [
    ["4200", '1-1/4"', 65, 1000],
    ["4201", '1-5/8"', 76, 1000],
    ["4202", '2-1/4"', 87, 1000],
    ["4203", '2-7/8"', 108, 1000],
    ["4204", '3-1/4"', 119, 1000],
    ["4205", '3-3/4"', 135, 1000],
    ["4206", '4-1/2"', 163, 1000],
    ["4207", '5"', 194, 1000],
    ["4198", '5-1/2"', 210, 1000],
    ["4208", '6"', 227, 1000],
    ["4209", '7"', 163, 500],
    ["4210", '8"', 215, 500],
  ]);
  add("W56RAC", "Spade", "White All-Purpose (.235)", [
    ["4199", '1-1/4"', 80, 1000],
    ["4215", '2-1/4"', 92, 1000],
    ["4216", '2-7/8"', 135, 1000],
    ["4217", '3-1/4"', 146, 1000],
    ["4218", '3-3/4"', 172, 1000],
    ["4219", '4-1/2"', 205, 1000],
    ["4220", '5"', 243, 1000],
    ["4221", '6"', 280, 1000],
    ["4222", '7"', 205, 500],
    ["4223", '8"', 270, 500],
  ]);
  add("W56RAC", "Spade", "Pre-Assembled #12 w/ Insulation Plate (.196)", [
    ["4162", '2-1/4"', 67, 250],
    ["4163", '2-7/8"', 70, 250],
    ["4164", '3-1/4"', 74, 250],
    ["4165", '3-3/4"', 77, 250],
    ["4166", '4-1/2"', 83, 250],
    ["4167", '5"', 98, 250],
    ["4168", '6"', 111, 250],
    ["4169", '7"', 119, 200],
    ["4170", '8"', 126, 200],
  ]);
  add("W56RAC", "XHD", "Heavy Duty (.260)", [
    ["4230", '1-1/4"', 79, 1000],
    ["4232", '2"', 107, 1000],
    ["4234", '3"', 146, 1000],
    ["4236", '4"', 186, 1000],
    ["4237", '5"', 253, 1000],
    ["4249", '6"', 167, 500],
    ["4239", '7"', 247, 500],
    ["4240", '8"', 292, 500],
    ["4241", '10"', 465, 500],
    ["4242", '12"', 526, 500],
    ["4243", '14"', 572, 500],
  ]);
  add("W56RAC", "XHD", "Pre-Assembled Heavy Duty w/ Insulation Plate (.260)", [
    ["4003", '3"', 194, 500],
    ["4004", '4"', 113, 250],
    ["4005", '5"', 127, 250],
    ["4006", '6"', 148, 250],
    ["4007", '7"', 197, 250],
    ["4008", '8"', 209, 250],
    ["4010", '10"', 151, 125],
  ]);
  add("W56RAC", "XHD", "White Heavy Duty (.260)", [
    ["4390", '1-1/4"', 138, 1000],
    ["4391", '2"', 201, 1000],
    ["4392", '3"', 273, 1000],
    ["4393", '4"', 343, 1000],
    ["4394", '5"', 421, 1000],
    ["4395", '6"', 256, 500],
  ]);
  add("W56RAC", "XHD", "HD Plus (batten strips / HD Plus seam plates only)", [
    ["4283", '3"', 232, 1000],
    ["4284", '4"', 169, 500],
    ["4285", '5"', 186, 500],
    ["4286", '6"', 248, 500],
    ["4287", '7"', 184, 250],
    ["4288", '8"', 218, 250],
  ]);
  add("W56RAC", "XHD", "HD HailGard (.265)", [
    ["4405", '2-1/2"', 228, 1000],
    ["4406", '3"', 248, 1000],
    ["4407", '3-1/2"', 291, 1000],
    ["4408", '4"', 312, 1000],
    ["4409", '4-1/2"', 334, 1000],
    ["4410", '5"', 354, 1000],
    ["4411", '5-1/2"', 188, 500],
    ["4412", '6"', 197, 500],
    ["4413", '6-1/2"', 280, 500],
    ["4414", '7"', 291, 500],
    ["4415", '7-1/2"', 312, 500],
    ["4416", '8"', 334, 500],
  ]);
  add("W56RAC", "Purlin", "Purlin Fastener", [
    ["4382", '2-3/4"', 215, 1000],
    ["4383", '3-3/4"', 270, 1000],
    ["4384", '4-3/4"', 335, 1000],
    ["4385", '5-3/4"', 428, 1000],
    ["4386", '6-3/4"', 586, 1000],
    ["4387", '7-3/4"', 349, 500],
  ]);
  add("W56RAC", "Auger", "Polymer Fastener", [
    ["4527", '2-3/4"', 147, 500],
    ["4530", '3"', 153, 500],
    ["4535", '3-1/2"', 169, 500],
    ["4540", '4"', 181, 500],
    ["4545", '4-1/2"', 189, 500],
    ["4550", '5"', 205, 500],
    ["4555", '5-1/2"', 221, 500],
    ["4560", '6"', 228, 500],
    ["4565", '6-1/2"', 261, 500],
    ["4570", '7"', 136, 250],
    ["4575", '7-1/2"', 168, 250],
    ["4580", '8"', 178, 250],
  ]);
  add("W56RAC", "Auger", "Lightweight Concrete (LWC) Base-Ply Fastener", [
    ["4256", '1.2"', 194, 1000],
    ["4257", '1.7"', 208, 1000],
  ]);
  add("W56RAC", "Nail", "Two Piece Impact Nail", [
    ["4258", '1.4"', 200, 500],
    ["4259", '1.8"', 200, 500],
    ["4260", '2.8"', 241, 500],
    ["4263", '3.8"', 241, 500],
    ["4264", '4.8"', 241, 250],
  ]);
  add("W56RAC", "Nail", "Concrete Drive Fastener", [
    ["4320", '1-1/2"', 91, 500],
    ["4321", '2"', 105, 500],
    ["4322", '2-1/2"', 125, 500],
    ["4323", '3"', 140, 500],
    ["4324", '3-1/2"', 153, 500],
    ["4325", '4"', 171, 500],
    ["4326", '4-1/2"', 192, 500],
    ["4327", '5"', 211, 500],
    ["4328", '5-1/2"', 228, 500],
    ["4349", '6"', 132, 250],
    ["4350", '6-1/2"', 177, 250],
    ["4351", '7"', 195, 250],
    ["4352", '7-1/2"', 213, 250],
    ["4353", '8"', 230, 250],
  ]);
  add("W56RAC", "Nail", "Coated Drive Pin", [
    ["4250", '1-1/4"', 371, 1000],
    ["4252", '2"', 266, 500],
  ]);
  add("W56RAC", "XHD", "AP Stainless Steel Fastener", [
    ["4361", '1-1/2"', 290, 1000],
    ["4362", '2"', 351, 1000],
    ["4363", '3"', 476, 1000],
    ["4364", '4"', 621, 1000],
    ["4365", '5"', 748, 1000],
    ["4366", '6"', 904, 1000],
    ["4367", '7"', 541, 500],
    ["4368", '8"', 613, 500],
    ["4369", '9"', 905, 500],
    ["4370", '10"', 493, 250],
    ["4372", '12"', 519, 250],
  ]);
  out.push(fastener("W56RAC4180", "DL-Plates", '2" Metal Plates', 105, 1000));
  out.push(fastener("W56RAC4190", "DL-Plates", '3" Insulation Fastening Plate (Round)', 110, 1000));
  out.push(fastener("W56RAC4182", "DL-Plates", '2-1/4" V-Plate', 59, 500));
  out.push(fastener("W56RAC4502", "DL-Plates", '2" Polymer Fastener Seam Plate', 118, 1000));
  out.push(fastener("W56RAC4503", "DL-Plates", '3" Polymer Fastener Insulation Plate', 61, 500));
  return out;
};

/* ================================================================================================
 * Non-DL TPO Accessories (branch non_dl_tpo) — Firestone UltraPly TPO + universal rows
 * ============================================================================================== */

const TPO_HELP =
  "Firestone UltraPly TPO (March 1, 2013) and Universal-System (July 1, 2013) list prices as printed on the owner's sheets; update here or by a price-list import. Rows named like the Duro-Last screen compute the same way in a bid's Non-DL TPO accessories group.";

export const NON_DL_TPO_SCREENS: SeedScreen[] = [
  {
    id: "non_dl_tpo:sealants",
    branch: NON_DL_TPO_BRANCH,
    category: "Sealants",
    sort: 1,
    columns: PRICE_COLUMNS,
    help: `${TPO_HELP} Quantities are typed (no Duro-Last part number to count from).`,
    rows: [
      row(
        "UltraPly TPO Cut Edge Sealant - White (per gal; 2 gal w/4 bottles, 600 lin ft/gal)",
        "W56TPO3001",
        58.0,
      ),
      row(
        "UltraPly TPO Cut Edge Sealant - Tan (per gal; 2 gal w/4 bottles, 600 lin ft/gal)",
        "W56TPOT001",
        58.0,
      ),
      row(
        "UltraPly TPO Cut Edge Sealant - Gray (per gal; 2 gal w/4 bottles, 600 lin ft/gal)",
        "W56TPOG001",
        58.0,
      ),
      row(
        "UltraPly TPO Cut Edge Sealant LVOC - White (2 gal carton w/4 bottles)",
        "W56TPO3001C",
        210.0,
      ),
      row(
        "UltraPly TPO Cut Edge Sealant LVOC - Tan (2 gal carton w/4 bottles)",
        "W56TPOT001C",
        210.0,
      ),
      row(
        "UltraPly TPO Cut Edge Sealant LVOC - Gray (2 gal carton w/4 bottles)",
        "W56TPOG001C",
        210.0,
      ),
      // Per tube (owner, Oct 27): the family's term bar caulk, counted by the tube like Duro-Caulk.
      row(
        "UltraPly TPO General Purpose Sealant - White (per tube; 25 tubes/ctn at $206, 50 ft/tube; the term bar caulk)",
        "W56TPO3002",
        8.24,
      ),
      row("Single-Ply QuickPrime Primer (3 gal pail, 200–225 sq ft/gal)", "W56358704A", 121.0),
      row(
        "UltraPly TPO QuickPrime LVOC Primer (per gal; 3 gal pail, 200–250 sq ft/gal)",
        "W56TPO300L",
        95.0,
      ),
      ...universalSealants(),
    ],
  },
  {
    id: "non_dl_tpo:corners",
    branch: NON_DL_TPO_BRANCH,
    category: "Corners",
    sort: 2,
    columns: CORNER_COLUMNS,
    help: `${TPO_HELP} Priced per corner from the carton price (20 molded corners, 12 curb corners, 20 QuickSeam corners per carton).`,
    rows: [
      corner("UltraPly TPO Inside/Outside Molded Corner (20/ctn)", "W56TPO301C", r2(160 / 20)),
      corner('UltraPly TPO Reinforced Curb Corner 7" (12/ctn)', "W56TPO3C07", r2(305 / 12)),
      corner('UltraPly TPO Reinforced Curb Corner 13" (12/ctn)', "W56TPO3C13", r2(320 / 12)),
      corner('UltraPly TPO Reinforced Curb Corner 19" (12/ctn)', "W56TPO3C19", r2(350 / 12)),
      corner('UltraPly TPO Reinforced Curb Corner 25" (12/ctn)', "W56TPO3C25", r2(375 / 12)),
      corner('UltraPly TPO Reinforced Curb Corner 31" (12/ctn)', "W56TPO3C31", r2(390 / 12)),
      corner('UltraPly TPO Reinforced Curb Corner 37" (12/ctn)', "W56TPO3C37", r2(410 / 12)),
      corner(
        "UltraPly QuickSeam Outside Corner (20/ctn, white only)",
        "W56TPO3031",
        r2(635 / 20),
        "",
        "",
      ),
    ],
  },
  {
    id: "non_dl_tpo:pipe_stacks",
    branch: NON_DL_TPO_BRANCH,
    category: "Pipe Stacks",
    sort: 3,
    columns: PIPE_COLUMNS,
    help: `${TPO_HELP} The universal boots are listed once per pipe size they fit (1"–6" universal $31 each from $310/10; 6"–8" large $32 each from $320/10), so the pipe stack calculator prices every size. Split boots and the QuickSeam pipe boot are on Other Accessories.`,
    rows: [
      ...[1, 2, 3, 4, 5, 6].map((size) =>
        pipe(
          `UltraPly TPO Universal Pipe Flashing ${size}" (1"–6" boot, 10/ctn)`,
          size,
          "W56TPO301U",
          "W56TPO301U",
          31.0,
        ),
      ),
      ...[7, 8].map((size) =>
        pipe(
          `UltraPly TPO Large Pipe Flashing ${size}" (6"–8" boot, 10/ctn)`,
          size,
          "W56TPO3013",
          "W56TPO3013",
          32.0,
        ),
      ),
    ],
  },
  {
    id: "non_dl_tpo:drain_boot_accessories",
    branch: NON_DL_TPO_BRANCH,
    category: "Drain Boot Accessories",
    sort: 4,
    columns: PRICE_COLUMNS,
    help: `${TPO_HELP} Typed quantities with the Duro-Last strainer labor.`,
    rows: universalStrainers(),
  },
  {
    id: "non_dl_tpo:walk_pads_wall_vents",
    branch: NON_DL_TPO_BRANCH,
    category: "Walk Pads & Wall Vents",
    sort: 5,
    columns: PRICE_COLUMNS,
    help: `${TPO_HELP} Priced per roll from the sheet's per-sq-ft price (30" x 50' = 125 sq ft at $4.40; 30" x 30' = 75 sq ft at $12.60).`,
    rows: [
      row("UltraPly TPO Walkway Pad 30\" x 50' roll (125 sq ft)", "W56TPO3024", r2(125 * 4.4)),
      row(
        "UltraPly TPO X-Tread Walkway Pad (white) 30\" x 30' roll (75 sq ft)",
        "W56TPO301X",
        r2(75 * 12.6),
      ),
    ],
  },
  {
    id: "non_dl_tpo:membrane_accs",
    branch: NON_DL_TPO_BRANCH,
    category: "Membrane Accs",
    sort: 6,
    columns: MEMBRANE_ACCS_COLUMNS,
    help: `${TPO_HELP} The T-Patch row is UltraPly TPO T-Joint Covers (TPO3014, 100/ctn): the one t-joint product the bid counts for this family (owner, Oct 27). No ARP row: TPO has none.`,
    rows: [
      {
        Description: "T-Patch",
        "Part #": "W56TPO3014",
        "Parts/Package": 100,
        "Price/Package": 63.0,
      },
    ],
  },
  {
    id: "non_dl_tpo:termination_bars",
    branch: NON_DL_TPO_BRANCH,
    category: "Termination Bars",
    sort: 7,
    columns: PRICE_COLUMNS,
    help: `${TPO_HELP} Aluminum termination bar W56RAC3061, $397 per 500 ft tube = $0.79/ft, the same for every colour.`,
    rows: universalTermBars(),
  },
  {
    id: "non_dl_tpo:fasteners_and_bits",
    branch: NON_DL_TPO_BRANCH,
    category: "Fasteners & Bits",
    sort: 8,
    columns: FASTENER_COLUMNS,
    help: `${TPO_HELP} Firestone fasteners filed under the Duro-Last types the deck screens use (Spade, XHD, Purlin, Auger, Nail, DL-Plates).`,
    rows: [
      ...universalFasteners(),
      fastener(
        "W56TPOPL02",
        "DL-Plates",
        '2-3/4" HD Plus Seam Plate (HD Plus fasteners only)',
        121,
        500,
      ),
      fastener("W56TPOPL03", "DL-Plates", '2-3/8" HD Seam Plate (stacked)', 206, 1000),
      fastener("W56TPOPL04", "DL-Plates", '3" InvisiWeld Plate', 326, 500),
      fastener("W56TPO3103", "XHD", '3" Pre-Assembled HD Fastener w/ HD Seam Plate', 121, 250),
      fastener("W56TPO3104", "XHD", '4" Pre-Assembled HD Fastener w/ HD Seam Plate', 137, 250),
      fastener("W56TPO3105", "XHD", '5" Pre-Assembled HD Fastener w/ HD Seam Plate', 171, 250),
      fastener("W56TPO3106", "XHD", '6" Pre-Assembled HD Fastener w/ HD Seam Plate', 191, 250),
      fastener("W56TPO3107", "XHD", '7" Pre-Assembled HD Fastener w/ HD Seam Plate', 228, 250),
      fastener("W56TPO3108", "XHD", '8" Pre-Assembled HD Fastener w/ HD Seam Plate', 261, 250),
      fastener("W56TPO3110", "XHD", '10" Pre-Assembled HD Fastener w/ HD Seam Plate', 159, 125),
    ],
  },
  {
    id: `non_dl_tpo:${OTHER_ACCESSORIES_SCREEN}`,
    branch: NON_DL_TPO_BRANCH,
    category: OTHER_ACCESSORIES_CATEGORY,
    sort: 9,
    columns: OTHER_COLUMNS,
    help: `${TPO_HELP} Items with no automatic count: typed quantity × price; Labor (Hrs) per unit is blank until the office fills it.`,
    rows: [
      other("UltraPly TPO Coated Metal 4' x 10' sheet (10 sheets/pallet)", "W56TPO3023", 235.0),
      other(
        'UltraPly TPO 8" Cover Strip .060, 8" x 50\' (2 rolls/ctn, 100 lin ft)',
        "W56TPO3S08",
        185.0,
      ),
      other(
        'UltraPly TPO T-Joint Covers 4" x 4" (100/ctn; counted on Membrane Accs)',
        "W56TPO3014",
        63.0,
      ),
      other(
        'UltraPly TPO Split Pipe Boot Small 1"–3" (10 boots & clamps/ctn)',
        "W56TPO3SB3",
        315.0,
      ),
      other(
        'UltraPly TPO Split Pipe Boot Medium 3"–5 1/2" (10 boots & clamps/ctn)',
        "W56TPO3SB6",
        340.0,
      ),
      other(
        'UltraPly TPO Split Pipe Boot Large 5 1/2"–8" (10 boots & clamps/ctn)',
        "W56TPO3SB9",
        450.0,
      ),
      other("UltraPly TPO Unsupported Flashing .060, 24\" x 50' roll", "W56TPO3017", 335.0),
      other("UltraPly TPO 18\" Curb Flashing, 50' roll", "W56TPO3018", 100.0),
      other("UltraPly QuickSeam RMA Strip 10\" x 100' (1 roll/ctn)", "W56TPO30T0", 295.0),
      other(
        "UltraPly QuickSeam RPF Strip 6\" x 100' (2 rolls/ctn, 200 lin ft)",
        "W56TPO30T1",
        385.0,
      ),
      other(
        'UltraPly TPO 5 1/2" QuickSeam Flashing 5 1/2" x 100\' (2 rolls/ctn)',
        "W56TPO30T7",
        530.0,
      ),
      other(
        'UltraPly TPO 9 1/2" QuickSeam Flashing 9 1/2" x 100\' (1 roll/ctn)',
        "W56TPO30T9",
        485.0,
      ),
      other('UltraPly QuickSeam Pipe Boot 1"–6 3/4" (10 boots & clamps/ctn)', "W56TPO3033", 370.0),
      other('UltraPly QuickSeam T-Joint Covers 4" x 4" (100/ctn)', "W56TPO3034", 370.0),
      ...universalOther(),
    ],
  },
];

/* ================================================================================================
 * EPDM Accessories (branch epdm) — Firestone EPDM / QuickSeam + universal rows
 * ============================================================================================== */

const EPDM_HELP =
  "Firestone EPDM Flashings, Sealants and Adhesives and QuickSeam Products (July 1, 2012) and Universal-System (July 1, 2013) list prices as printed on the owner's sheets; update here or by a price-list import. Rows named like the Duro-Last screen compute the same way in a bid's EPDM accessories group.";

export const EPDM_SCREENS: SeedScreen[] = [
  {
    id: "epdm:sealants",
    branch: EPDM_BRANCH,
    category: "Sealants",
    sort: 1,
    columns: PRICE_COLUMNS,
    help: `${EPDM_HELP} Quantities are typed. Splice adhesives and seam primers are here (seam products, like the Duro-Last tab sealer), not on Adhesives.`,
    rows: [
      // Per tube (owner, Oct 27): the family's term bar caulk, counted by the tube like Duro-Caulk.
      row(
        "Lap Sealant-HS Tubes (per tube; 28 cartridges/pail at $241, 560 lin ft/pail; the term bar caulk)",
        "W563587031",
        8.61,
      ),
      row("Lap Sealant-HS Pails (per gal; 5 gal pail)", "W563587032", 50.0),
      row("Lap Sealant-HS Qt. (10 quart tubes/ctn, 640 lin ft; direct ship)", "W563587034", 184.0),
      row("Lap Sealant-HS Sausage Chubs (20 × 20 oz/ctn, 800 lin ft)", "W563587030", 247.0),
      row(
        "Lap Sealant-HS Cardboard Cartons (25 × 11 oz cartridges/ctn, 500 lin ft)",
        "W56358703E",
        216.0,
      ),
      row("Splice Adhesive 3-gal (per gal; 3 gal pail, 150 lin ft/gal)", "W563587059", 42.0),
      row(
        "Splice Adhesive 1-gal (per gal; 4 × 1 gal pails/ctn, 150 lin ft/gal)",
        "W563587058",
        50.0,
      ),
      row('Splice Adhesive Brushes 4" (12/ctn)', "W563582040", 48.0),
      row("QuickPrime Plus 3 gal (per gal; 200–225 lin ft/gal)", "W563587044", 38.0),
      row("QuickPrime Plus 1 gal (per gal; 200–225 lin ft/gal)", "W563587041", 47.0),
      row("Single-Ply QuickPrime Primer (3 gal pail, 75 pails/pallet)", "W56358704A", 121.0),
      ...universalSealants(),
    ],
  },
  {
    id: "epdm:corners",
    branch: EPDM_BRANCH,
    category: "Corners",
    sort: 2,
    columns: CORNER_COLUMNS,
    help: `${EPDM_HELP} EPDM parts are black; the price is under White (the bid's corner colour columns). $147 per carton of 20.`,
    rows: [
      corner('QuickSeam Corner Flashing 8-1/2" dia. (20/ctn)', "W56RAC1646", r2(147 / 20), "", ""),
    ],
  },
  {
    id: "epdm:pipe_stacks",
    branch: EPDM_BRANCH,
    category: "Pipe Stacks",
    sort: 3,
    columns: PIPE_COLUMNS,
    help: `${EPDM_HELP} Universal Pipe Flashing (non-taped) 1033 fits 1"–6 7/8": listed once per size 1–6 at $37 each ($370/10). The QuickSeam universal boot is on Other Accessories.`,
    rows: [1, 2, 3, 4, 5, 6].map((size) =>
      pipe(
        `Universal Pipe Flashing (Non-Taped) ${size}" (1"–6 7/8" boot, 10/ctn)`,
        size,
        "W563581033",
        "W563581033",
        37.0,
        "",
        "",
      ),
    ),
  },
  {
    id: "epdm:conduit_washers",
    branch: EPDM_BRANCH,
    category: "Conduit Washers",
    sort: 4,
    columns: PRICE_COLUMNS,
    help: `${EPDM_HELP} $378 per carton of 10 pieces with rings.`,
    rows: [row("QuickSeam Conduit Flashing (10 pcs w/ rings per ctn)", "W563581070", r2(378 / 10))],
  },
  {
    id: "epdm:drain_boot_accessories",
    branch: EPDM_BRANCH,
    category: "Drain Boot Accessories",
    sort: 5,
    columns: PRICE_COLUMNS,
    help: `${EPDM_HELP} Typed quantities with the Duro-Last strainer labor.`,
    rows: universalStrainers(),
  },
  {
    id: "epdm:walk_pads_wall_vents",
    branch: EPDM_BRANCH,
    category: "Walk Pads & Wall Vents",
    sort: 6,
    columns: PRICE_COLUMNS,
    help: `${EPDM_HELP} $1,475 per carton of 50 pads.`,
    rows: [row("QuickSeam WalkWay Pad 2-1/2' x 2-1/2' (50 pads/ctn)", "W56RAC1860", r2(1475 / 50))],
  },
  {
    id: "epdm:membrane_accs",
    branch: EPDM_BRANCH,
    category: "Membrane Accs",
    sort: 7,
    columns: MEMBRANE_ACCS_COLUMNS,
    help: `${EPDM_HELP} The T-Patch row is QuickSeam Joint Covers 6" dia. (1644, 100/ctn): the one t-joint product the bid counts for this family. No ARP row.`,
    rows: [
      {
        Description: "T-Patch",
        "Part #": "W56RAC1644",
        "Parts/Package": 100,
        "Price/Package": 446.0,
      },
    ],
  },
  {
    id: "epdm:termination_bars",
    branch: EPDM_BRANCH,
    category: "Termination Bars",
    sort: 8,
    columns: PRICE_COLUMNS,
    help: `${EPDM_HELP} Aluminum termination bar W56RAC3061, $397 per 500 ft tube = $0.79/ft, the same for every colour.`,
    rows: universalTermBars(),
  },
  {
    id: "epdm:fasteners_and_bits",
    branch: EPDM_BRANCH,
    category: "Fasteners & Bits",
    sort: 9,
    columns: FASTENER_COLUMNS,
    help: `${EPDM_HELP} Firestone fasteners filed under the Duro-Last types the deck screens use (Spade, XHD, Purlin, Auger, Nail, DL-Plates).`,
    rows: universalFasteners(),
  },
  {
    id: `epdm:${OTHER_ACCESSORIES_SCREEN}`,
    branch: EPDM_BRANCH,
    category: OTHER_ACCESSORIES_CATEGORY,
    sort: 10,
    columns: OTHER_COLUMNS,
    help: `${EPDM_HELP} Items with no automatic count: typed quantity × price; Labor (Hrs) per unit is blank until the office fills it. FormFlash and Neoprene rolls are priced per roll from the sheet's per-sq-ft price.`,
    rows: [
      other(
        "60-mil EPDM FormFlash 6\" x 100' roll (50 sq ft at $2.40; 2 rolls/ctn)",
        "W563581508",
        r2(50 * 2.4),
      ),
      other(
        "60-mil EPDM FormFlash 9\" x 100' roll (75 sq ft at $2.40; 2 rolls/ctn)",
        "W563581509",
        r2(75 * 2.4),
      ),
      other(
        "60-mil EPDM FormFlash 12\" x 100' roll (100 sq ft at $2.40; 2 rolls/ctn)",
        "W563581510",
        r2(100 * 2.4),
      ),
      other(
        "60-mil EPDM FormFlash 18\" x 100' roll (150 sq ft at $2.40)",
        "W563581511",
        r2(150 * 2.4),
      ),
      other(
        "60-mil EPDM FormFlash 24\" x 100' roll (200 sq ft at $2.40)",
        "W563581512",
        r2(200 * 2.4),
      ),
      other(
        "60-mil EPDM FormFlash 36\" x 100' roll (300 sq ft at $2.40)",
        "W563581514",
        r2(300 * 2.4),
      ),
      other(
        "60-mil EPDM FormFlash 48\" x 100' roll (400 sq ft at $2.40)",
        "W563581515",
        r2(400 * 2.4),
      ),
      other(
        "60-mil Neoprene Membrane 24\" x 100' roll (200 sq ft at $4.05)",
        "W563581602",
        r2(200 * 4.05),
      ),
      other(
        "60-mil Neoprene Membrane 48\" x 100' roll (400 sq ft at $4.05)",
        "W563581600",
        r2(400 * 4.05),
      ),
      other('6" RPF Strip 6" x 100\' (2 rolls/ctn, 200 lin ft)', "W563581540", 200.0),
      other('QuickSeam 3" Splice Tape 3" x 100\' (6 rolls/ctn)', "W56RAC1603", 530.0),
      other('QuickSeam 6" Splice Tape 6" x 100\' (2 rolls/ctn)', "W56RAC1626", 280.0),
      other('QuickSeam 7" Splice Tape 7" x 100\' (2 rolls/ctn)', "W56RAC1617", 340.0),
      other("QuickSeam Flashing 5\" x 100' (2 rolls/ctn)", "W56RAC1615", 558.0),
      other('QuickSeam 6" Batten Cover 6" x 100\' (2 rolls/ctn)', "W56RAC1616", 709.0),
      other('QuickSeam 9" Batten Cover 9" x 100\' (1 roll/ctn)', "W56RAC1619", 554.0),
      other('QuickSeam 12" Batten Cover 12" x 50\' (1 roll/ctn)', "W56RAC1624", 455.0),
      other("QuickSeam RPF Strip 6\" x 100' (2 rolls/ctn)", "W56RAC1632", 472.0),
      other("QuickSeam R.M.A. Strip 10\" x 100' (1 roll/ctn)", "W56RAC1610", 277.0),
      other('QuickSeam 9" FormFlash 9" x 50\' (2 rolls/ctn)', "W56RAC1650", 474.0),
      other('QuickSeam 12" FormFlash 12" x 50\' (1 roll/ctn)', "W56RAC1653", 337.0),
      other('QuickSeam 18" FormFlash 18" x 50\' (1 roll/ctn)', "W56RAC162A", 535.0),
      other('18" QuickSeam SA Flashing 18" x 50\' (full width tape)', "W56RAC1620", 383.0),
      other("QuickSeam Curb Flashing 18\" x 50'", "W56RAC1622", 245.0),
      other(
        'QuickSeam Joint Covers 6" dia. (100/ctn; counted on Membrane Accs)',
        "W56RAC1644",
        446.0,
      ),
      other('QuickSeam Universal Pipe Flashing 1"–6 7/8" (10 ctn w/ rings)', "W563581063", 399.0),
      other('QuickSeam SA Patch for Pipe Flashing 18" x 18" (25 pcs/ctn)', "W56RAC1629", 399.0),
      other('QuickSeam SA Patch for Conduit Flashing 18" x 18" (25 pcs/ctn)', "W56RAC1621", 399.0),
      other(
        "QuickScrubber Plus Stand-Up Tool w/ Pads and Handles (20 pads, 4 handles/ctn)",
        "W563582049",
        70.0,
      ),
      other("QuickScrubber Kits (30 pads, 4 handles/ctn)", "W563582045", 26.0),
      other("QuickScrubber Pads (100 pads/ctn)", "W563582057", 38.0),
      other("QuickScrubber Handles (40 handles/ctn)", "W563582056", 205.0),
      other("QuickSeam Silicone Roller (6/ctn)", "W563582023", 200.0),
      other("QuickRoller (2 rollers, 2 sleeves; direct ship)", "W563582026", 390.0),
      other("QuickSeam Roller Sleeves (12/ctn; direct ship)", "W563582027", 275.0),
      ...universalOther(),
    ],
  },
];

/* ================================================================================================
 * Duro-Last › Other Accessories (the Duro-Tech items without an automatic count)
 * ============================================================================================== */

export const DURO_LAST_OTHER_SCREEN: SeedScreen = {
  id: `duro_last:${OTHER_ACCESSORIES_SCREEN}`,
  branch: "duro_last",
  category: OTHER_ACCESSORIES_CATEGORY,
  sort: 60,
  columns: OTHER_COLUMNS,
  help: "Duro-Tech TPO items with no automatic count (09/28/2026 Duro-Last price sheet): flashing rolls, strips, the universal boot, spray equipment and U-Anchors. Typed quantity × price; Labor (Hrs) per unit is blank until the office fills it. Tan and gray end in TB / TG at the same price.",
  rows: [
    other(`${DT}60 mil Unsupported Flashing 24" x 50' - White`, "44145", 342.0),
    other(`${DT}60 mil Unsupported Flashing 24" x 50' - Tan`, "44146", 342.0),
    other(`${DT}60 mil Unsupported Flashing 24" x 50' - Gray`, "44147", 342.0),
    other(`${DT}R.M.A. (Roof Membrane Attachment) Strip 10" x 100'`, "45101TW", 348.7),
    other(
      `${DT}6" x 100' Reinforced Perimeter Fastening (RPF) Strip (2 rolls/container)`,
      "45102TW",
      455.8,
    ),
    other(`${DT}Unsupported Universal Pipe Flashing 1"–6"`, "2330TW", 34.0),
    other(`${DT}Unsupported T-Joint Cover - White (100/box)`, "45105TW", 67.0),
    other(`${DT}Unsupported T-Joint Cover - Tan (100/box)`, "45105TB", 67.0),
    other(`${DT}Unsupported T-Joint Cover - Gray (100/box)`, "45105TG", 67.0),
    other(`${DT}TECH-Bond Spray Solvent Adhesive (canister)`, "11028T", 595.0),
    other(`${DT}TECH-Bond Spray Adhesive Cleaner (canister)`, "11021T", 265.0),
    other(`${DT}TECH-Bond Spray Gun (vertical application)`, "11023-111T", 172.0),
    other(`${DT}TECH-Bond Spray Gun with Extension (horizontal application)`, "11023T", 403.0),
    other(`${DT}TECH-Bond 60° Spray Tip (5/bag)`, "11027T", 75.0),
    other(`${DT}TECH-Bond Canister Hose 12 ft`, "11025T", 69.0),
    other(`${DT}TECH-Bond Canister Hose 18 ft`, "11024T", 109.95),
    other(`${DT}U-Anchor 2000 - White`, "1242-200TW", 142.0),
    other(`${DT}U-Anchor 2000 - Tan`, "1242-200TB", 142.0),
    other(`${DT}U-Anchor 2000 - Gray`, "1242-200TG", 142.0),
    other(`${DT}U-Anchor 2400 - White`, "1242-240TW", 60.57),
    other(`${DT}U-Anchor 2400 - Tan`, "1242-240TB", 60.57),
    other(`${DT}U-Anchor 2400 - Gray`, "1242-240TG", 60.57),
    other(`${DT}U-Anchor 3400 - White`, "1242-261TW", 89.95),
    other(`${DT}U-Anchor 3400 - Tan`, "1242-261TB", 89.95),
    other(`${DT}U-Anchor 3400 - Gray`, "1242-261TG", 89.95),
    other(`${DT}U-Anchor 4400 (4/box) - White`, "1242-270TW", 309.0),
    other(`${DT}U-Anchor 4400 (4/box) - Tan`, "1242-270TB", 309.0),
    other(`${DT}U-Anchor 4400 (4/box) - Gray`, "1242-270TG", 309.0),
  ],
};

export const FAMILY_SCREENS: SeedScreen[] = [
  ...NON_DL_TPO_SCREENS,
  ...EPDM_SCREENS,
  DURO_LAST_OTHER_SCREEN,
];

/* ================================================================================================
 * Adhesives (the Duro-Last › Adhesives master-detail, pricing_catalog duro_last:adhesives)
 * ============================================================================================== */

export interface SeedAdhesiveProduct {
  name: string;
  part_no: string;
  /** Price per unit (a pail, a box set, a carton). */
  price: number;
  /** The unit the price buys, for the admin's eye. */
  unit: string;
  /** Coverage rows: group = roof system family or "Insulations"; sq ft per UNIT (null = unknown). */
  coverage: Array<{ group: string; substrate: string; field_coverage: number | null }>;
}

/** The membrane substrates a bonding adhesive covers (the Duro-Last group's rows plus the decks). */
const MEMBRANE_SUBSTRATES = [
  "Wood",
  "Structural Metal",
  "Concrete",
  "Gypsum",
  "Lightweight Concrete/Corrugated Metal",
  "Lightweight Concrete/Concrete",
  "Lightweight Concrete/Other",
  "Tectum",
  "ISO 4'x8'",
  "ISO 4'x4'",
  "DensDeck/Securock",
  "DensDeck Prime",
  "EPO/XPS 4'x8'",
  "EPO/XPS 4'x4'",
  "Gypsum Board",
  "Smooth Mod-Bit",
  "Granulated Mod-Bit",
  "Smooth Built-Up",
  "Graveled Built-Up",
  "Spray Foam",
  "Walls",
];
/** Insulation substrates the Insulations group lists today (0 = needs a quote, as the seed does). */
const INSULATION_SUBSTRATES = [
  "Wood",
  "Structural Metal",
  "Concrete",
  "Gypsum",
  "Lightweight Concrete/Corrugated Metal",
  "Lightweight Concrete/Concrete",
  "Lightweight Concrete/Other",
  "Tectum",
  "ISO 4'x8'",
  "ISO 4'x4'",
  "EPO/XPS 4'x8'",
  "EPO/XPS 4'x4'",
  "DensDeck/Securock",
  "DensDeck Prime",
  "Smooth Mod-Bit",
  "Granulated Mod-Bit",
  "Smooth Built-Up",
  "Graveled Built-Up",
  "Spray Foam",
];
const NEEDS_QUOTE = ["Tapered ISO", "Tapered Rigid", "Crickets/Other"];

/** Coverage per unit = the sheet's sq ft/gal range midpoint × gallons per unit (owner, Oct 27: midpoint). */
const membraneCoverage = (
  groups: string[],
  perUnitSqFt: number | null,
): SeedAdhesiveProduct["coverage"] =>
  groups.flatMap((group) => [
    ...MEMBRANE_SUBSTRATES.map((substrate) => ({ group, substrate, field_coverage: perUnitSqFt })),
    ...NEEDS_QUOTE.map((substrate) => ({ group, substrate, field_coverage: 0 })),
  ]);
const insulationCoverage = (perUnitSqFt: number | null): SeedAdhesiveProduct["coverage"] => [
  ...INSULATION_SUBSTRATES.map((substrate) => ({
    group: "Insulations",
    substrate,
    field_coverage: perUnitSqFt,
  })),
  ...NEEDS_QUOTE.map((substrate) => ({ group: "Insulations", substrate, field_coverage: 0 })),
];

const TPO = "Non-DL TPO";
const EPDM = "EPDM Rubber";
const BOTH = [TPO, EPDM];
const mid = (lo: number, hi: number) => (lo + hi) / 2;

export const ADHESIVE_PRODUCTS: SeedAdhesiveProduct[] = [
  // ---- Firestone bonding adhesives (5 gal pails): price per pail, coverage per pail.
  {
    name: "Single-Ply LVOC Bonding Adhesive",
    part_no: "W56358705L",
    price: 49 * 5,
    unit: "5 gal pail ($49/gal)",
    coverage: membraneCoverage(BOTH, mid(45, 60) * 5),
  },
  {
    name: "Single-Ply LVOC Bonding Adhesive - 1168",
    part_no: "W56358705LC",
    price: 51 * 5,
    unit: "5 gal pail ($51/gal)",
    coverage: membraneCoverage(BOTH, mid(45, 60) * 5),
  },
  {
    name: "Water Based Bonding Adhesive (P)",
    part_no: "W563587038",
    price: 46 * 5,
    unit: "5 gal pail ($46/gal)",
    coverage: membraneCoverage(BOTH, mid(100, 120) * 5),
  },
  {
    name: "LVOC Water Based Bonding Adhesive",
    part_no: "W563587035",
    price: 58 * 5,
    unit: "5 gal pail ($58/gal)",
    coverage: membraneCoverage(BOTH, mid(100, 125) * 5),
  },
  {
    name: "UltraPly Bonding Adhesive",
    part_no: "W56TPO3005",
    price: 27 * 5,
    unit: "5 gal pail ($27/gal)",
    coverage: membraneCoverage([TPO], mid(45, 60) * 5),
  },
  {
    name: "XR Bonding Adhesive",
    part_no: "W56TPO3009",
    price: 48 * 5,
    unit: "5 gal pail ($48/gal)",
    coverage: membraneCoverage([TPO], mid(70, 85) * 5),
  },
  {
    // The sheet prints "EPDM Bonding Adhesive (BA-2004 T)"; the estimator's name (Oct 30).
    name: "EPDM Bonding Adhesive",
    part_no: "W563587052",
    price: 27 * 5,
    unit: "5 gal pail ($27/gal)",
    coverage: membraneCoverage([EPDM], mid(45, 60) * 5),
  },
  // ---- Coverage "See TIS" on the sheet: priced, coverage left blank for the office.
  {
    name: "XR Stick Membrane Adhesive (carton)",
    part_no: "W56TPO3400",
    price: 333,
    unit: "carton",
    coverage: membraneCoverage([TPO], null),
  },
  {
    name: "XR Stick Membrane Adhesive - Part 1",
    part_no: "W56TPO3401",
    price: 346,
    unit: "5 gal box",
    coverage: membraneCoverage([TPO], null),
  },
  {
    name: "XR Stick Membrane Adhesive - Part 2",
    part_no: "W56TPO3402",
    price: 346,
    unit: "5 gal box",
    coverage: membraneCoverage([TPO], null),
  },
  // ---- Duro-Tech TECH-Bond (no coverage on the sheet). Named as the bid estimator has known them
  //      since Sept 22 (legacy_adhesive; owner, Oct 30): the sheet prints "TECH-Bond TPO Bonding
  //      Solvent Adhesive" / "… LVOC Solvent Bonding Adhesive", but the estimator joins an
  //      adhesive's price to a bid by exact name, so a second spelling priced nothing
  //      (20261030120000_adhesive_names_match_estimator.sql). Never rename one without the other.
  {
    name: "TECH-Bond TPO Bonding Adhesive",
    part_no: "1112T",
    price: 140,
    unit: "5 gal",
    coverage: membraneCoverage([DURO_TECH_SYSTEM], null),
  },
  {
    name: "TECH-Bond TPO LVOC Bonding Adhesive",
    part_no: "1112-010T",
    price: 220,
    unit: "5 gal",
    coverage: membraneCoverage([DURO_TECH_SYSTEM], null),
  },
  // ---- Firestone insulation adhesives (the Insulations group = the underlayment adhesive list).
  {
    name: "I.S.O.SPRAY S Part A + Part B (55 gal drum set)",
    part_no: "W56RACIASD + W56RACIBSD",
    price: 1835 * 2,
    unit: "one A drum + one B drum ($1,835 each)",
    coverage: insulationCoverage(mid(9000, 10000)),
  },
  {
    name: "I.S.O.SPRAY S Part A + Part B (15 gal pail set)",
    part_no: "W56RACIASP + W56RACIBSP",
    price: 635 * 2,
    unit: "one A pail + one B pail ($635 each)",
    coverage: insulationCoverage(mid(2350, 2600)),
  },
  {
    name: "I.S.O.FIX Adhesive (canister; hose and wand separate)",
    part_no: "W56RACINSA",
    price: 330,
    unit: "canister",
    coverage: insulationCoverage(null),
  },
  {
    name: "I.S.O.Stick Insulation Adhesive Part 1 + Part 2 (5 gal box set)",
    part_no: "W56RACIA5B1 + W56RACIA5B2",
    price: 266 * 2,
    unit: "one Part 1 box + one Part 2 box ($266 each)",
    coverage: insulationCoverage(null),
  },
  {
    name: "I.S.O. Twin Pack Insulation Adhesive (case)",
    part_no: "W56RACINTA",
    price: 213,
    unit: "case",
    coverage: insulationCoverage(null),
  },
];

/* ================================================================================================
 * EXCEPTIONAL Metals › Pitch Pans (Firestone penetration pockets, owner Oct 27)
 * ============================================================================================== */

export const PITCH_PAN_ROWS: Array<{
  description: string;
  unit_cost: number;
  labor_per_unit_lf: number;
  labor_rate: number;
}> = [
  // Labor per unit and rate copied from the Duro-Last pitch pan rows (1 h at $45); the office edits.
  {
    description: "UltraPly TPO Penetration Pocket (6 pockets/kit, $200)",
    unit_cost: r2(200 / 6),
    labor_per_unit_lf: 1,
    labor_rate: 45,
  },
  {
    description: "QuickSeam QS6 Penetration Pocket Kit (6 kits/ctn, $273)",
    unit_cost: r2(273 / 6),
    labor_per_unit_lf: 1,
    labor_rate: 45,
  },
  {
    description: "QuickSeam QS10 Penetration Pocket Kit (6 kits/ctn, $467)",
    unit_cost: r2(467 / 6),
    labor_per_unit_lf: 1,
    labor_rate: 45,
  },
];
export const PITCH_PAN_ITEM_NUMBERS: Array<{ item_no: string; description: string }> = [
  { item_no: "W56TPO301L", description: PITCH_PAN_ROWS[0]!.description },
  { item_no: "W56RACQS06", description: PITCH_PAN_ROWS[1]!.description },
  { item_no: "W56RACQS10", description: PITCH_PAN_ROWS[2]!.description },
];

/* ================================================================================================
 * Non Duro-Last › Preset Custom Applications (coatings, pavers, garden roof, vapor barrier)
 * ============================================================================================== */

const custom = (description: string, price: number, part: string): SeedRow & { part: string } => ({
  Description: description,
  Price: price,
  // No hours on the sheets; a 0 rate bills the estimate's crew rate (the NDL rule).
  LaborPerUnit: 0,
  "Labor Rate": 0,
  part,
});
export const CUSTOM_APPLICATION_ROWS: Array<SeedRow & { part: string }> = [
  custom("EPDM Membrane PreWash (per gal; 5 gal pail, 300–500 sq ft/gal)", 39.0, "W56RAC6500"),
  custom(
    "AcryliTop PC-100 Coating White (4.75 gal pail, 100 sq ft/gal spray)",
    246.0,
    "W56FAC6550P",
  ),
  custom(
    "AcryliTop PC-100 Coating Gray (4.75 gal pail, 100 sq ft/gal spray; direct ship)",
    246.0,
    "W56FAC6560P",
  ),
  custom(
    "AcryliTop PC-100 Coating Tan (4.75 gal pail, 100 sq ft/gal spray; direct ship)",
    246.0,
    "W56FAC6570P",
  ),
  custom(
    "AcryliTop Base Coat for EPDM (Light Gray; 4.75 gal pail, 200 sq ft/gal)",
    246.0,
    "W56RAC6501P",
  ),
  custom(
    "AcryliTop Base Coat for Asphalt (Yellow; 4.75 gal pail, 100 sq ft/gal; per gal on the sheet)",
    246.0,
    "W70RACACBSP",
  ),
  custom('Ballast Paver (natural grey) 11.75" x 16.5" (each; 144/pallet)', 4.9, "W56RACPV01"),
  custom('Ballast Paver (Adobe) 11.75" x 16.5" (each; special order)', 5.25, "W56RACPVTC"),
  custom('Ballast Paver (Sable) 11.75" x 16.5" (each; special order)', 5.25, "W56RACPVCG"),
  custom('Ballast Paver (Canyon Red) 11.75" x 16.5" (each; special order)', 5.25, "W56RACPVCR"),
  custom('Ballast Paver (Desert Sand) 11.75" x 16.5" (each; special order)', 5.25, "W56RACPVSD"),
  custom("Ballast Paver Mat 12'-6\" x 360' roll", 1125.0, "W5635890PV"),
  custom('Ballast Paver Clips 3.5" x 2.4" x 1.5" (100 pcs/box)', 98.0, "W56RACPVCL"),
  custom(
    'Garden Roof Edge Metal 8" sections w/ 4" connectors (11 pcs/tube)',
    825.0,
    "W56-RAC-GR02",
  ),
  custom('SkyPaver Ruby 4" x 8" x 1.23" (per grid of 8, 1.78 sq ft)', 24.0, "W56GARPAVR"),
  custom('SkyPaver Chestnut 4" x 8" x 1.23" (per grid of 8, 1.78 sq ft)', 24.0, "W56GARPAVW"),
  custom('SkyPaver Sage 4" x 8" x 1.23" (per grid of 8, 1.78 sq ft)', 24.0, "W56GARPAVO"),
  custom('SkyPaver Ash 4" x 8" x 1.23" (per grid of 8, 1.78 sq ft)', 24.0, "W56GARPAVW"),
  custom('SkyPaver Lavender 4" x 8" x 1.23" (per grid of 8, 1.78 sq ft)', 24.0, "W56GARPAVV"),
  custom('SkyPaver Ruby 4" x 8" x 1.98" (per grid of 8, 1.78 sq ft)', 32.0, "W56GARPAVR2"),
  custom('SkyPaver Chestnut 4" x 8" x 1.98" (per grid of 8, 1.78 sq ft)', 32.0, "W56GARPAVB2"),
  custom('SkyPaver Sage 4" x 8" x 1.98" (per grid of 8, 1.78 sq ft)', 32.0, "W56GARPAVO2"),
  custom('SkyPaver Ash 4" x 8" x 1.98" (per grid of 8, 1.78 sq ft)', 32.0, "W56GARPAVW2"),
  custom('SkyPaver Lavender 4" x 8" x 1.98" (per grid of 8, 1.78 sq ft)', 32.0, "W56GARPAVV2"),
  custom("SkyDrain 4' x 50' roll (per sq ft; 200 sq ft/roll)", 1.8711, "W56GARDR05"),
  custom("V-Force Vapor Barrier Membrane 45\" x 133' roll (500 sq ft)", 311.89, "W56358900V"),
  custom("V-Force WB Primer (5 gal pail, 130–412 sq ft/gal)", 243.0, "W563587091"),
  custom(
    "V-Force SB Primer (5 gal pail, 100–165 porous / 195–400 non-porous sq ft/gal)",
    189.0,
    "W563587090",
  ),
];

/* ================================================================================================
 * Accessory labor rows (accessory_labor tables) for the family descriptions
 * ============================================================================================== */

/** Hours per unit copied from the nearest Duro-Last row (owner, Oct 27: same work, same time). */
export const LABOR_ROWS: Array<{ table: string; column: string; rows: Array<[string, number]> }> = [
  {
    table: "corners",
    column: "Labor(Hrs)",
    rows: [
      ...NON_DL_TPO_SCREENS.find((s) => s.id === "non_dl_tpo:corners")!.rows.map(
        (r) => [String(r["Description"]), 0.1667] as [string, number],
      ),
      ...EPDM_SCREENS.find((s) => s.id === "epdm:corners")!.rows.map(
        (r) => [String(r["Description"]), 0.1667] as [string, number],
      ),
      // Duro-Tech corners (prefix stripped: the ref builder looks labor up by the stripped name).
      ["Inside/Outside Molded Corner (20/box)", 0.1667],
      ["Pre-Molded Outside Corner (20/bag)", 0.1667],
      ['7" Curb Corner (12" x 12" x 9")', 0.2222],
      ['13" Curb Corner (24" x 24" x 12")', 0.2222],
      ['19" Curb Corner (36" x 36" x 12")', 0.2222],
      ['25" Curb Corner (48" x 48" x 12")', 0.2222],
      ['31" Curb Corner (60" x 60" x 12")', 0.2222],
      ['37" Curb Corner (72" x 72" x 12")', 0.2222],
    ],
  },
  {
    table: "washers",
    column: "Labor(Hrs)",
    rows: [["QuickSeam Conduit Flashing (10 pcs w/ rings per ctn)", 0.3333]],
  },
  {
    table: "strainers",
    column: "Labor(Hrs)",
    rows: [
      ['3" Drain Insert (3" reroof drain)', 0.5],
      ['4" Drain Insert (4" reroof drain)', 0.5],
      ["Dome Strainer White", 0.5],
      ["Drain Guard White Tabs", 0.5],
      ["Drain Guard Clamping Ring Attachment Clips (pair)", 0.25],
      ...["3", "4", "5", "6"].map((s) => [`OMG Hercules Roof Drain ${s}"`, 1] as [string, number]),
      ...["3", "4", "5"].map((s) => [`TRUFAST EasySeal Roof Drain ${s}"`, 1] as [string, number]),
      ...["3", "4", "5"].map(
        (s) => [`TRUFAST EasySeal Roof Drain w/ TPO Coated Flange ${s}"`, 1] as [string, number],
      ),
    ],
  },
  {
    table: "accessory_others",
    column: "Labor(Hrs)",
    rows: [
      ["UltraPly TPO Walkway Pad 30\" x 50' roll (125 sq ft)", 0.5],
      ["UltraPly TPO X-Tread Walkway Pad (white) 30\" x 30' roll (75 sq ft)", 0.5],
      ["QuickSeam WalkWay Pad 2-1/2' x 2-1/2' (50 pads/ctn)", 0.5],
      ["White 30\" x 50' Roll - Walk Pad", 0.5],
      ["CROSSGRIP Mat White 2'6\" x 30' (drop-ship)", 0.5],
      ["CROSSGRIP Mat Gray 2'6\" x 30' (drop-ship)", 0.5],
      ["CROSSGRIP Mat Yellow 2'6\" x 30' (drop-ship)", 0.5],
    ],
  },
];

/* ================================================================================================
 * Item numbers
 * ============================================================================================== */

/** The price column an item number points at, per screen column set. */
function priceColumnOf(columns: string[]): string {
  if (columns.includes("Price")) return "Price";
  if (columns.includes("Price/Box")) return "Price/Box";
  if (columns.includes("Price/Package")) return "Price/Package";
  if (columns.includes("White")) return "White";
  throw new Error(`no price column in ${columns.join(",")}`);
}

const DURO_TECH_COLOR_SUFFIX: Array<[string, string]> = [
  ["TB", "Tan"],
  ["TG", "Gray"],
];

/** Every item-number mapping the seed carries (one per price cell an item number buys). */
export function seedItemNumbers(existing: Record<string, string[]>): SeedItemNumber[] {
  const out: SeedItemNumber[] = [];
  const keys = new Set<string>();
  const push = (m: SeedItemNumber) => {
    if (!m.item_no || m.item_no === "0") return;
    // A boot with one code for open and closed maps the same cell once.
    const key = `${m.item_no}|${m.screen_id}|${m.row_label}|${m.price_col}`;
    if (keys.has(key)) return;
    keys.add(key);
    out.push(m);
  };
  const screenRows: Array<{ screen_id: string; columns: string[]; rows: SeedRow[] }> = [
    ...FAMILY_SCREENS.map((s) => ({ screen_id: s.id, columns: s.columns, rows: s.rows })),
    ...DURO_LAST_ADDITIONS.map((a) => ({
      screen_id: a.screen_id,
      columns: existing[a.screen_id] ?? [],
      rows: a.rows,
    })),
  ];
  for (const s of screenRows) {
    for (const r of s.rows) {
      const label = String(r["Description"]);
      if (s.columns.includes("Open Part #")) {
        for (const col of ["Open Part #", "Closed Part #"]) {
          const code = String(r[col] ?? "");
          push({
            item_no: code,
            screen_id: s.screen_id,
            row_label: label,
            price_col: "Price",
            dl_description: label,
          });
          if (code.endsWith("TW"))
            for (const [suffix, colour] of DURO_TECH_COLOR_SUFFIX)
              push({
                item_no: code.slice(0, -2) + suffix,
                screen_id: s.screen_id,
                row_label: label,
                price_col: `${colour} Price`,
                dl_description: `${label} (${colour})`,
              });
        }
        continue;
      }
      const code = String(r["Part #"] ?? "");
      if (!code) continue;
      const priceCol = priceColumnOf(s.columns);
      push({
        item_no: code,
        screen_id: s.screen_id,
        row_label: label,
        price_col: priceCol,
        dl_description: label,
      });
      // Duro-Tech colour columns on the Corners screen: TB / TG at the same price.
      if (priceCol === "White" && code.endsWith("TW"))
        for (const [suffix, colour] of DURO_TECH_COLOR_SUFFIX)
          push({
            item_no: code.slice(0, -2) + suffix,
            screen_id: s.screen_id,
            row_label: label,
            price_col: colour,
            dl_description: `${label} (${colour})`,
          });
      // Firestone colour codes (White W56TPO3…, Tan W56TPOT…, Gray W56TPOG…) on colour-priced rows.
      if (priceCol === "White" && /^W56TPO3/.test(code) && r["Tan"] !== "")
        for (const [replacement, colour] of [
          ["W56TPOT", "Tan"],
          ["W56TPOG", "Gray"],
        ] as const)
          push({
            item_no: code.replace(/^W56TPO3/, replacement),
            screen_id: s.screen_id,
            row_label: label,
            price_col: colour,
            dl_description: `${label} (${colour})`,
          });
    }
  }
  // Firestone TPO colour codes for single-price rows (tan / gray boots and plates share the price).
  const TPO_COLOUR_PAIRS: Array<[string, string, string]> = [
    ["non_dl_tpo:pipe_stacks", "W56TPO301U", "01U"],
    ["non_dl_tpo:pipe_stacks", "W56TPO3013", "013"],
  ];
  for (const [screen_id, white, tail] of TPO_COLOUR_PAIRS)
    for (const r of FAMILY_SCREENS.find((s) => s.id === screen_id)!.rows)
      if (r["Open Part #"] === white)
        for (const [replacement, colour] of [
          ["W56TPOT", "Tan"],
          ["W56TPOG", "Gray"],
        ] as const)
          push({
            item_no: replacement + tail,
            screen_id,
            row_label: String(r["Description"]),
            price_col: `${colour} Price`,
            dl_description: `${r["Description"]} (${colour})`,
          });
  for (const m of MEMBRANE_ITEM_NUMBERS) push(m);
  for (const m of PITCH_PAN_ITEM_NUMBERS)
    push({
      item_no: m.item_no,
      screen_id: "duro_last:exceptional_metals",
      row_label: m.description,
      price_col: "Unit Cost",
      dl_description: m.description,
    });
  for (const r of CUSTOM_APPLICATION_ROWS)
    push({
      item_no: r.part,
      screen_id: "non_dl:preset_custom_applications",
      row_label: String(r["Description"]),
      price_col: "Price",
      dl_description: String(r["Description"]),
    });
  for (const p of ADHESIVE_PRODUCTS)
    for (const code of p.part_no.split(" + "))
      push({
        item_no: code,
        screen_id: "duro_last:adhesives",
        row_label: p.name,
        price_col: "Price",
        dl_description: p.name,
      });
  return out;
}

/** Duplicates the seed deliberately skips: already on the Duro-Last screens at the same price. */
export const SKIPPED_DUPLICATES = [
  "Panduit Tool 1221 ($239) — on Panduit",
  '3/8" x 14" S.S. Bands 1222 ($44/50 = $0.88 per part) — on Panduit',
  '3/8" x 20" S.S. Bands 1222P ($65/50 = $1.30 per part) — on Panduit',
  "Splice Wash SW100 7066 on the EPDM page — the same row as the universal page (one row per family)",
  "Single-Ply QuickPrime Primer 704A on the EPDM page — the same as the universal 358704A (one row per family)",
  'Duro-Tech TPO membrane rolls and 10" stripping — the membrane screen prices them per sq ft; roll item numbers attached',
];

/** Left out, with the reason (owner, Oct 27). */
export const LEFT_OUT = [
  "SunWave skylights and curbs — no prices on that page",
  "Firestone Roof Edge Systems (AnchorGard, EdgeGard, Coping) — call for quotation",
  "U-Anchor Snow Retention TPO — call for quote",
  "UltraPly TPO membrane page and DensDeck page — item numbers only, owner chose not to attach them",
];
