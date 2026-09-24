/**
 * Legacy Bid-Advantage `.bax` importer (docs/TODO.md item 1).
 *
 * A .bax is a zip holding one `EstimateData` XML document with three parts: `<management>` (the
 * company's whole reference catalog and price tables AS THEY WERE when the bid was last saved),
 * `<estimate>` (the bid) and `<reports>` (empty on every sample). This module turns that document
 * into the web app's saved-bid state:
 *
 * - every legacy id is resolved through the FILE'S OWN management tables (deck types, colours,
 *   roof systems, sheet sizes, boards, terminations, tear-off types, adhesives, curb styles,
 *   statuses…), so an import never depends on the live catalog's ids;
 * - the bid-level money settings (labor rate, markup and mode, commission, per diem, tax, extra
 *   shipping, hours per man-day) come straight from the estimate;
 * - Non-Duro-Last items and Exceptional Metals keep the exact unit costs, labor per unit and
 *   labor rates the legacy bid stored, as custom rows / flat lines;
 * - `applyLegacyPricing` overlays the file's price tables (membrane $/sqft by mil × tier × colour,
 *   the flat Duro-Bond / Duro-Tuff / Duro-Fleece prices, adhesives, accessories, freight steps,
 *   setup / inspection bands, company settings) onto a copy of the live admin data, which becomes
 *   the imported bid's frozen snapshot — the legacy "Update Pricing & Labor" semantics.
 *
 * Proven legacy facts used here (docs/legacy-money-parity.md): price categories 5 = Roll Goods,
 * 1 = 28" Tabs, 4 = 60" Tabs, 2 = 120" Tabs, 3 = Parapets (§1); colour ids 1 Tan, 2 Gray, 3 White,
 * 4 Dark Gray, 5 Terra Cotta, 6 Rock Ply and price columns Price(White)/Tan/Gray/DarkGray/
 * TerraCotta/RockPly (§7.2); the Review's Bid Total uses `Markup` — `CustomMarkup` is the
 * second "what-if" Amount column (ReviewCalc IL, dTotals[14..16] column 1). Everything the
 * converter is unsure about goes into `warnings`, shown before the import is saved.
 */

import type {
  BidSectionInput,
  CurbInput,
  NonDlLine,
  ParapetInput,
  UnderlaymentLayer,
} from "@/lib/engine/bid-builder";
import type { EdgeInput } from "@/lib/engine/edges";
import {
  emptyAccessoriesState,
  type AccessoriesState,
  type FastenerSlot,
  type SnapSize,
  type TermColor,
} from "@/lib/engine/accessories";
import { emptyNonDlState, type NonDlGroup, type NonDlState } from "@/lib/engine/nondl";
import { STANDARD_DECK_ORDER, type EngineAdminData } from "@/lib/engine/adapters";
import {
  LEGACY_ROOF_SYSTEM_IDS,
  universalFastenerSpacing,
  type MechFastenerRow,
} from "@/lib/engine/fastener-spacing";
import type { MarkupMode } from "@/lib/engine/money";
import type { PriceTier } from "@/lib/engine/pricing";
import { PER_DIEM_ITEMS, type PerDiemChart } from "@/lib/per-diem-chart";
import { asBidStatus, type BidStatus } from "@/lib/bid-status";
import {
  cityStZip,
  MAX_WIND_OPTIONS,
  type CustomerInfo,
  type SavedBidState,
  type WarrantyData,
} from "@/lib/proposal-bid";
import { attrNum, bool, child, children, num, parseXml, text, type XNode } from "./xml";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** What the web bid remembers about its legacy origin (SavedBidState.importInfo). */
export interface BaxImportInfo {
  source: "bid-advantage";
  fileName: string;
  importedAt: string;
  appVersion: string;
  formulasVersion: string;
  legacyStatus: string;
  /** Legacy `locktimestamp` (last save in Bid-Advantage), ISO. */
  lastSavedAt: string | null;
  startDate: string | null;
  finishDate: string | null;
  /** The Review's second "what-if" markup column (`CustomMarkup`), when one was set. */
  whatIfMarkup: number | null;
  laborTemplate: string;
  /** Price tables that were overlaid from the file onto the frozen snapshot. */
  pricingOverlays: string[];
}

export interface BaxConversion {
  name: string;
  status: BidStatus;
  legacyStatus: string;
  /** Legacy last-save time (ISO) — becomes the imported row's created_at. */
  lastSavedAt: string | null;
  saved: SavedBidState;
  warnings: string[];
  importInfo: BaxImportInfo;
}

export interface ConvertOptions {
  fileName: string;
  importedAt?: string;
  /** Live MechFastenerLookup rows: fills each mechanical section's field/perim/corner OC. */
  fastenerLookup?: MechFastenerRow[];
  /** Live board names (admin.underlaymentPrices keys) to spell legacy board names the app's way. */
  boardNames?: string[];
  /** Live labor template names; a legacy template not among them is flagged. */
  laborTemplateNames?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Management lookups (the file's own reference tables)
// ─────────────────────────────────────────────────────────────────────────────

interface RefTables {
  deckById: Map<number, { description: string; predrill: boolean }>;
  colorById: Map<number, string>;
  systemById: Map<
    number,
    {
      longName: string;
      shortName: string;
      membraneTypes: Map<number, { thickness: number; description: string }>;
      sheetSizes: Map<number, string>;
    }
  >;
  boardById: Map<number, { name: string; subtype: number; groupId: number; needQuote: boolean }>;
  terminationById: Map<number, string>;
  tearOffById: Map<number, string>;
  warrantyById: Map<number, { name: string; isHighWind: boolean; termYears: number }>;
  adhesiveByShort: Map<string, { id: number; longName: string; price: number }>;
  adhesiveById: Map<number, { longName: string; price: number }>;
  mechShortNames: Set<string>;
  curbStyleById: Map<number, string>;
  templateById: Map<number, string>;
  statusById: Map<number, string>;
  arpSizeById: Map<number, number>;
  parapetStyleById: Map<number, string>;
  pipeUsageById: Map<number, string>;
  drainRoofTypeById: Map<number, string>;
  capstoneById: Map<number, string>;
  cornerByRef: Map<number, { name: string }>;
  drainBootById: Map<number, string>;
  drainRingById: Map<number, string>;
  fastenerByRef: Map<number, { description: string; subtype: string }>;
  panduitByRef: Map<number, string>;
  pipeStackSizeById: Map<number, number>;
  sealantByRef: Map<number, { description: string; part: string }>;
  strainerByRef: Map<number, string>;
  termBarByRef: Map<number, string>;
  twoPieceByRef: Map<number, { description: string; sizeIn: string }>;
  ventByRef: Map<number, string>;
  washerByRef: Map<number, string>;
  accOtherByRef: Map<number, string>;
  membraneAccByRef: Map<number, { description: string; subtype: string }>;
  gutterByRef: Map<number, { style: string; size: string; a: number; b: number; c: number }>;
  gutterAccByRef: Map<number, string>;
  downspoutByRef: Map<number, { description: string; style: string; a: number; b: number }>;
  downspoutAccByRef: Map<number, string>;
  pitchPanByRef: Map<number, string>;
  collectionBoxByRef: Map<number, string>;
}

/** Legacy termination ids → the app's Edge Options labels (edges.ts TERMINATION_OPTIONS). */
const TERMINATION_BY_ID: Record<number, string> = {
  1: "No Termination",
  2: "T-Bar",
  3: '1-3/4" Fascia',
  4: '4" Fascia',
  5: '2" Gravel Stop',
  9: '4" Gravel Stop',
  6: '2" Drip Edge',
  10: '4" Drip Edge',
  11: '3" 2-pc Metal',
  7: '4" 2-pc Metal',
  12: '5" 2-pc Metal',
  8: '6" 2-pc Metal',
  13: '7" 2-pc Metal',
  14: '8" 2-pc Metal',
};

/** Legacy `DeckTypes` ids 1..10 are exactly the app's STANDARD_DECK_ORDER. */
const deckNameForId = (id: number): string | undefined => STANDARD_DECK_ORDER[id - 1];

/** Legacy fraction glyphs → the app's spelling ("2½\" ISO" → "2 1/2\" ISO", "¼\"" → "1/4\""). */
export function normalizeLegacyName(s: string): string {
  return s
    .replace(/(\d)([½¼¾⅛⅜⅝⅞])/g, "$1 $2")
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/⅛/g, "1/8")
    .replace(/⅜/g, "3/8")
    .replace(/⅝/g, "5/8")
    .replace(/⅞/g, "7/8")
    .replace(/\s+/g, " ")
    .trim();
}

const nameKey = (s: string) => normalizeLegacyName(s).toLowerCase().replace(/\s+/g, "");

function id(node: XNode | undefined, attr = "id"): number {
  return attrNum(node, attr, -1);
}

function buildRefTables(management: XNode | undefined): RefTables {
  const t: RefTables = {
    deckById: new Map(),
    colorById: new Map(),
    systemById: new Map(),
    boardById: new Map(),
    terminationById: new Map(),
    tearOffById: new Map(),
    warrantyById: new Map(),
    adhesiveByShort: new Map(),
    adhesiveById: new Map(),
    mechShortNames: new Set(),
    curbStyleById: new Map(),
    templateById: new Map(),
    statusById: new Map(),
    arpSizeById: new Map(),
    parapetStyleById: new Map(),
    pipeUsageById: new Map(),
    drainRoofTypeById: new Map(),
    capstoneById: new Map(),
    cornerByRef: new Map(),
    drainBootById: new Map(),
    drainRingById: new Map(),
    fastenerByRef: new Map(),
    panduitByRef: new Map(),
    pipeStackSizeById: new Map(),
    sealantByRef: new Map(),
    strainerByRef: new Map(),
    termBarByRef: new Map(),
    twoPieceByRef: new Map(),
    ventByRef: new Map(),
    washerByRef: new Map(),
    accOtherByRef: new Map(),
    membraneAccByRef: new Map(),
    gutterByRef: new Map(),
    gutterAccByRef: new Map(),
    downspoutByRef: new Map(),
    downspoutAccByRef: new Map(),
    pitchPanByRef: new Map(),
    collectionBoxByRef: new Map(),
  };
  const m = management;
  for (const d of children(child(m, "decktypes"), "decktype"))
    t.deckById.set(id(d), {
      description: d.attrs["description"] ?? "",
      predrill: bool(d.attrs["predrill"]),
    });
  for (const c of children(child(m, "colors"), "color"))
    t.colorById.set(id(c), c.attrs["name"] ?? "");
  for (const s of children(child(m, "roofsystems"), "system")) {
    const membraneTypes = new Map<number, { thickness: number; description: string }>();
    for (const mt of children(child(s, "membranetypes"), "membranetype"))
      membraneTypes.set(id(mt), {
        thickness: attrNum(mt, "thickness"),
        description: (mt.attrs["description"] ?? "").trim(),
      });
    const sheetSizes = new Map<number, string>();
    for (const ss of children(child(s, "sheetsizes"), "sheetsize"))
      sheetSizes.set(id(ss), (ss.attrs["description"] ?? "").trim());
    t.systemById.set(id(s), {
      longName: s.attrs["longname"] ?? "",
      shortName: s.attrs["shortname"] ?? "",
      membraneTypes,
      sheetSizes,
    });
  }
  for (const u of children(child(m, "underlayments"), "underlayment"))
    t.boardById.set(id(u), {
      name: u.attrs["name"] ?? "",
      subtype: attrNum(u, "subtype"),
      groupId: attrNum(u, "adhesivegroupid"),
      // Legacy "needquote" boards (Flute Filler, tapered…) are always priced by a custom quote.
      needQuote: /^true$/i.test(u.attrs["needquote"] ?? ""),
    });
  for (const x of children(child(m, "terminations"), "termination"))
    t.terminationById.set(id(x), x.attrs["description"] ?? "");
  for (const x of children(child(m, "tearoffroofs"), "tabspacing"))
    t.tearOffById.set(id(x), x.attrs["name"] ?? "");
  for (const w of children(child(m, "warranties"), "warranty"))
    t.warrantyById.set(id(w), {
      name: w.attrs["name"] ?? "",
      isHighWind: bool(w.attrs["ishighwind"]),
      termYears: attrNum(w, "warrantylength"),
    });
  for (const a of children(child(m, "adhesivesystems"), "adhesive")) {
    const rec = {
      id: id(a),
      longName: (a.attrs["longname"] ?? "").trim(),
      price: attrNum(a, "price"),
    };
    t.adhesiveByShort.set(a.attrs["shortname"] ?? "", rec);
    t.adhesiveById.set(rec.id, rec);
  }
  for (const ms of children(child(m, "mechanicalsystems"), "mechanicalsystem"))
    t.mechShortNames.add(ms.attrs["shortname"] ?? "");
  for (const c of children(child(m, "curbstyles"), "curbstyle"))
    t.curbStyleById.set(id(c), c.attrs["description"] ?? "");
  for (const lt of children(child(m, "templates"), "labortemplate"))
    t.templateById.set(id(lt), text(lt, "description"));
  for (const s of children(child(m, "estimatestatuses"), "estimatestatus"))
    t.statusById.set(id(s), s.attrs["description"] ?? "");
  for (const a of children(child(m, "arps"), "arp")) t.arpSizeById.set(id(a), attrNum(a, "size"));
  for (const p of children(child(m, "parapetstyles"), "blocking"))
    t.parapetStyleById.set(id(p), p.attrs["name"] ?? "");
  for (const p of children(child(m, "pipestackusages"), "blocking"))
    t.pipeUsageById.set(id(p), p.attrs["description"] ?? "");
  for (const d of children(child(m, "drainrooftypes"), "drainrooftype"))
    t.drainRoofTypeById.set(id(d), d.attrs["description"] ?? "");
  for (const c of children(child(m, "capstoneoptions"), "capoption"))
    t.capstoneById.set(id(c), c.attrs["description"] ?? "");
  for (const c of children(child(m, "corners"), "corner"))
    t.cornerByRef.set(id(c, "refid"), { name: c.attrs["name"] ?? "" });
  for (const d of children(child(m, "drainboots"), "drainboot"))
    t.drainBootById.set(id(d), d.attrs["description"] ?? "");
  for (const d of children(child(m, "drainrings"), "drainring"))
    t.drainRingById.set(id(d), d.attrs["description"] ?? "");
  for (const f of children(child(m, "fasteners"), "fastener"))
    t.fastenerByRef.set(id(f, "refid"), {
      description: normalizeLegacyName(f.attrs["description"] ?? ""),
      subtype: f.attrs["subtype"] ?? "",
    });
  for (const p of children(child(m, "panduits"), "panduit"))
    t.panduitByRef.set(id(p, "refid"), p.attrs["description"] ?? "");
  for (const p of children(child(m, "pipestacksizes"), "blocking"))
    t.pipeStackSizeById.set(id(p), attrNum(p, "size"));
  for (const s of children(child(m, "sealants"), "sealant"))
    t.sealantByRef.set(id(s, "refid"), {
      description: s.attrs["description"] ?? "",
      part: s.attrs["partnumber"] ?? "",
    });
  for (const s of children(child(m, "strainers"), "strainer"))
    t.strainerByRef.set(id(s, "refid"), s.attrs["description"] ?? "");
  for (const s of children(child(m, "termbars"), "termbar"))
    t.termBarByRef.set(id(s, "refid"), s.attrs["description"] ?? "");
  for (const s of children(child(m, "twopiecemetals"), "twopiecemetal")) {
    const desc = s.attrs["description"] ?? "";
    const sizeIn = /^(\d+)"/.exec(desc)?.[1] ?? "";
    t.twoPieceByRef.set(id(s, "refid"), { description: desc, sizeIn });
  }
  for (const v of children(child(m, "vents"), "vent"))
    t.ventByRef.set(id(v, "refid"), v.attrs["description"] ?? "");
  for (const w of children(child(m, "washers"), "washer"))
    t.washerByRef.set(id(w, "refid"), normalizeLegacyName(w.attrs["description"] ?? ""));
  for (const a of children(child(m, "accothers"), "accother"))
    t.accOtherByRef.set(id(a, "refid"), a.attrs["description"] ?? "");
  for (const a of children(child(m, "membraneaccs"), "accother"))
    t.membraneAccByRef.set(id(a, "refid"), {
      description: a.attrs["description"] ?? "",
      subtype: a.attrs["subtype"] ?? "",
    });
  for (const g of children(child(m, "gutters"), "gutter"))
    t.gutterByRef.set(id(g, "refid"), {
      style: g.attrs["style"] ?? "",
      size: g.attrs["size"] ?? "",
      a: attrNum(g, "dimensiona"),
      b: attrNum(g, "dimensionb"),
      c: attrNum(g, "dimensionc"),
    });
  for (const g of children(child(m, "gutteraccs"), "gutteracc"))
    t.gutterAccByRef.set(id(g, "refid"), g.attrs["description"] ?? "");
  for (const d of children(child(m, "downspouts"), "downspout"))
    t.downspoutByRef.set(id(d, "refid"), {
      description: d.attrs["description"] ?? "",
      style: d.attrs["style"] ?? "",
      a: attrNum(d, "dimensiona"),
      b: attrNum(d, "dimensionb"),
    });
  for (const d of children(child(m, "downspoutaccs"), "downspoutacc"))
    t.downspoutAccByRef.set(id(d, "refid"), d.attrs["description"] ?? "");
  for (const p of children(child(m, "pitchpans"), "pitchpan"))
    t.pitchPanByRef.set(
      id(p, "refid"),
      `${p.attrs["description"] ?? "Pitch Pan"} ${attrNum(p, "dimensiona")}"x${attrNum(p, "dimensionb")}"x${attrNum(p, "dimensionc")}"`,
    );
  for (const c of children(child(m, "collectionboxes"), "collectionbox"))
    t.collectionBoxByRef.set(
      id(c, "refid"),
      `${c.attrs["description"] ?? "Collection Box"} ${attrNum(c, "dimensiona")}"x${attrNum(c, "dimensionb")}"x${attrNum(c, "dimensionc")}"`,
    );
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Legacy US date-time ("9/22/2026 2:36:51 PM" / "10/24/2024 12:00:00 AM") → ISO, or null. */
export function parseLegacyDate(s: string | undefined): string | null {
  const m =
    /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?\s*$/i.exec(
      s ?? "",
    );
  if (!m) return null;
  const [, mo, d, y, hh, mm, ss, ap] = m;
  let h = Number(hh ?? 0);
  if (ap) {
    const pm = ap.toUpperCase() === "PM";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), h, Number(mm ?? 0), Number(ss ?? 0));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** "10/24/2024 12:00:00 AM" → "2024-10-24" (the app's date-input format). */
export function legacyDateOnly(s: string | undefined): string | undefined {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s ?? "");
  if (!m) return undefined;
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/** Legacy `MarkupMode` names → the engine's MarkupMode (0 % of cost, 1 $/man-day, 2 GP %). */
export function legacyMarkupMode(s: string): MarkupMode | null {
  const k = s.trim().toLowerCase();
  if (k === "accountingpercentage" || k === "2") return 2;
  if (k === "percentageofsubtotal" || k === "0") return 0;
  if (k.includes("manday") || k.includes("perday") || k === "1") return 1;
  return null;
}

/** Legacy status description → the four web statuses (bid-status.ts legacy fold). */
export function legacyStatusToWeb(description: string): BidStatus {
  return asBidStatus(description.trim().toLowerCase().replace(/\s+/g, "_"));
}

const PER_DIEM_KEYWORDS: Array<[RegExp, (typeof PER_DIEM_ITEMS)[number]]> = [
  [/mobiliz/i, "Mobilization"],
  [/superv/i, "Supervision"],
  [/boom/i, "Boom truck"],
  [/fork/i, "Fork lift"],
  [/rental/i, "Rental equipment"],
  [/equip|deliver/i, "Equipment"],
  [/fuel/i, "Fuel"],
  [/trash|dumpster|dispos/i, "Dumpsters / trash"],
  [/bond/i, "Security bond"],
  [/fringe|benefit/i, "Fringe benefits"],
  [/hotel|lodg/i, "Hotel"],
  [/food|meal/i, "Food"],
  [/porta/i, "Porta jon"],
  [/seamer/i, "Mechanical seamer"],
  [/trip|new cons/i, "New cons / multiple trips"],
  [/misc/i, "Miscellaneous"],
];

/**
 * The legacy Notes ("Description") usually carries the per-diem breakdown as free text:
 * "Per Diem based on 5 men  11 days" then "Supervision      3300.00" lines and a Total. Parse
 * what can be read into the Setup per-diem chart; anything else stays in the notes verbatim.
 */
export function parsePerDiemChart(description: string): PerDiemChart | null {
  const men = /(\d+)\s*men/i.exec(description);
  const days = /(\d+)\s*days?/i.exec(description);
  const items: PerDiemChart["items"] = PER_DIEM_ITEMS.map((label) => ({
    label,
    checked: false,
    price: 0,
  }));
  let any = false;
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^total\b/i.test(line) || /per\s*d[ie]{2}m\s+based/i.test(line)) continue;
    const m = /^(.*?\S)\s{2,}\$?\s*([\d,]+(?:\.\d+)?)\.?$/.exec(line);
    if (!m) continue;
    const label = m[1]!.trim();
    const price = Number(m[2]!.replace(/,/g, ""));
    if (!Number.isFinite(price)) continue;
    const std = PER_DIEM_KEYWORDS.find(([re]) => re.test(label))?.[1];
    const target = std ? items.find((it) => it.label === std && !it.checked) : undefined;
    if (target) {
      target.checked = true;
      target.price = price;
    } else {
      items.push({ label, checked: true, price });
    }
    any = true;
  }
  if (!any && !men && !days) return null;
  return { men: men ? Number(men[1]) : 0, days: days ? Number(days[1]) : 0, items };
}

const COLOR_QTY_ATTRS: Array<[string, string]> = [
  ["whiteqty", "White"],
  ["tanqty", "Tan"],
  ["grayqty", "Gray"],
  ["darkgrayqty", "Dark Gray"],
  ["terracottaqty", "Terra Cotta"],
  ["rockplyqty", "Rock Ply"],
];

const FASTENER_SLOT_ATTRS: Array<[string, FastenerSlot]> = [
  ["termbar", "termBar"],
  ["parapet", "parapet"],
  ["smfascia", "fascia3"],
  ["lgfascia", "fascia4"],
  ["dripedge", "dripEdge"],
  ["gravelstop", "gravelStop"],
  ["snapon", "snapCover"],
  ["deckwood", "wood"],
  ["deckmetals", "metal"],
  ["deckgypsum", "gypsum"],
  ["deckconcrete", "concrete"],
  ["decklwconcrete", "lwConcrete"],
  ["decklwsteel", "lwSteel"],
];

const NON_DL_GROUP_BY_TAG: Record<string, NonDlGroup> = {
  customapps: "customApps",
  deckmaterials: "deckMaterials",
  edgeblockings: "roofEdgeBlocking",
  masonry: "masonry",
  services: "services",
  sheetmetals: "sheetMetal",
  subcontractors: "subcontractors",
  blockings: "wallBlocking",
  wallblockings: "wallBlocking",
  otherndl: "others",
  others: "others",
};

/** Legacy curb `TermOption` enum names → the app's 0..5 (docs §8.3). */
export function legacyCurbTermOption(s: string): number | null {
  const k = s.replace(/[^a-z]/gi, "").toLowerCase();
  if (!k || k === "isnone" || k === "none") return 0;
  if (k.includes("scupper") || k.includes("fascia")) return 1;
  if (k.includes("tuck")) return 2;
  if (k.includes("counter")) return 5;
  if (k.includes("nolift") && k.includes("tbar")) return 4;
  if (k.includes("lift") && k.includes("tbar")) return 3;
  return null;
}

const isTermColor = (c: string): c is TermColor => c === "White" || c === "Tan" || c === "Gray";

// ─────────────────────────────────────────────────────────────────────────────
// The conversion
// ─────────────────────────────────────────────────────────────────────────────

export function parseBax(xml: string): XNode {
  const doc = parseXml(xml);
  if (doc.tag !== "badata" || !child(doc, "estimate"))
    throw new Error("Not a Bid-Advantage estimate (no <badata><estimate>).");
  return doc;
}

export function convertBax(doc: XNode, opts: ConvertOptions): BaxConversion {
  const warnings: string[] = [];
  const warn = (s: string) => {
    if (!warnings.includes(s)) warnings.push(s);
  };
  const management = child(doc, "management");
  const est = child(doc, "estimate");
  if (!est) throw new Error("No <estimate> in the file.");
  const ref = buildRefTables(management);
  const versions = child(doc, "versions");

  // Board names the app knows (for spelling), keyed loosely.
  const boardKeyToName = new Map<string, string>();
  for (const n of opts.boardNames ?? []) boardKeyToName.set(nameKey(n), n);
  // `quoted`: the layer carries a custom quote (Flute Filler, tapered, ISO-rigid quote), so it
  // is priced from the file's lump sum and the live price list is irrelevant — no warning.
  const boardName = (legacyId: number, quoted = false): string => {
    const b = ref.boardById.get(legacyId);
    if (!b) {
      warn(`Unknown underlayment board id ${legacyId} — layer imported without a board name.`);
      return "";
    }
    const norm = normalizeLegacyName(b.name);
    const known = boardKeyToName.get(nameKey(norm));
    if (known) return known;
    if (opts.boardNames?.length && !quoted && !b.needQuote)
      warn(`Board "${norm}" is not in the current underlayment price list — check its price.`);
    return norm;
  };

  const systemName = (rsId: number): string => {
    const s = ref.systemById.get(rsId);
    if (!s) warn(`Unknown roof system id ${rsId}; using Duro-Last.`);
    return s?.longName || "Duro-Last";
  };
  const attachmentOf = (
    short: string,
  ): { attachment: "mechanical" | "adhered"; adhesive?: string } => {
    if (ref.mechShortNames.has(short) || /mech$/i.test(short)) return { attachment: "mechanical" };
    const adh = ref.adhesiveByShort.get(short);
    if (adh) return { attachment: "adhered", adhesive: adh.longName };
    if (short && short !== "nothing")
      warn(
        `Attachment "${short}" is neither a fastener system nor an adhesive; read as mechanical.`,
      );
    return { attachment: "mechanical" };
  };
  const colorName = (cid: number): string => ref.colorById.get(cid) ?? "White";
  const deckName = (did: number, where: string): string => {
    const n = deckNameForId(did);
    if (!n) warn(`${where}: unknown deck type id ${did}; using Wood.`);
    return n ?? "Wood";
  };
  const thicknessOf = (rsId: number, mtId: number, where: string): number => {
    const mt = ref.systemById.get(rsId)?.membraneTypes.get(mtId);
    if (!mt) {
      warn(`${where}: unknown membrane type ${mtId} for roof system ${rsId}; using 50 mil.`);
      return 50;
    }
    if (/plus/i.test(mt.description))
      warn(
        `${where}: legacy membrane "${mt.description}" — the app prices the plain ${mt.thickness} mil row.`,
      );
    return mt.thickness || 50;
  };

  // Quotes (CustomQuotes) — shared by id across sections; one quote bills once.
  const quotes = new Map<number, NonNullable<UnderlaymentLayer["quote"]>>();
  for (const q of children(child(est, "CustomQuotes"), "quote")) {
    const qid = attrNum(q, "quoteid", -1);
    const pieces = num(q, "pieces");
    const perPiece = num(q, "perpiece");
    quotes.set(qid, {
      id: `bax-quote-${qid}`,
      name: text(q, "name") || `Quote ${qid}`,
      pieceMode: pieces > 0 && perPiece > 0,
      lumpSum: num(q, "lumpsum"),
      pieces,
      costPerPiece: perPiece,
      laborAmount: num(q, "laborunits"),
      laborInDays: bool(text(q, "isdays")),
    });
  }

  // ── Sections ─────────────────────────────────────────────────────────────
  const sections: BidSectionInput[] = [];
  const secNodes = children(child(est, "roofsections"), "roofsection");
  secNodes.forEach((s, idx) => {
    const where = `Section ${idx + 1}`;
    const rsId = num(s, "roofsystemid", 1);
    const roofSystem = systemName(rsId);
    const field = attachmentOf(text(s, "fieldattachmentsystem"));
    const perimShort = text(s, "perimattachmentsystem");
    if (perimShort && perimShort !== text(s, "fieldattachmentsystem"))
      warn(
        `${where}: perimeter attachment "${perimShort}" differs from the field's; the app uses one.`,
      );
    const thickness = thicknessOf(rsId, num(s, "membranetype"), where);
    const length = num(s, "length");
    const width = num(s, "width");
    const tab = num(s, "tabrgwidth");
    const sheetLabel = ref.systemById.get(rsId)?.sheetSizes.get(num(s, "sheetsizeid")) ?? "";
    if (!sheetLabel) warn(`${where}: unknown sheet size id ${num(s, "sheetsizeid")}.`);

    // Edges A–D (0..3): A/C run the length, B/D the width.
    const perimFlags = child(s, "sideisperimeter")?.attrs ?? {};
    const perimLens = child(s, "perimsidelength")?.attrs ?? {};
    const sideKeys = ["sidea", "sideb", "sidec", "sided"];
    const edges: EdgeInput[] = ["A", "B", "C", "D"].map((side, i) => {
      const termNode = child(s, `termination${i}`);
      const termId = attrNum(termNode, "refid", 1);
      const termination =
        TERMINATION_BY_ID[termId] ?? ref.terminationById.get(termId) ?? "No Termination";
      if (!TERMINATION_BY_ID[termId] && termId !== 1)
        warn(`${where} side ${side}: termination id ${termId} is not in the app's list.`);
      const termW = attrNum(termNode, "width");
      const blk = child(s, `blocking${i}`);
      const arp = child(s, `arp${i}`);
      const arpSize = ref.arpSizeById.get(attrNum(arp, "refid", 0)) ?? 0;
      const arpW = attrNum(arp, "width");
      const isPerimeter = bool(perimFlags[sideKeys[i]!]);
      const pl = Number(perimLens[sideKeys[i]!] ?? 0);
      const e: EdgeInput = {
        side,
        lengthFt: i % 2 === 0 ? length : width,
        isPerimeter,
        termination,
        blockingFt: attrNum(blk, "refid") === 2 ? attrNum(blk, "width") : 0,
        arpSizeIn: arpSize,
      };
      if (isPerimeter && pl > 0) e.perimLengthFt = pl;
      if (termination !== "No Termination" && termW > 0) e.termLengthFt = termW;
      if (arpSize > 0 && arpW > 0) e.arpLengthFt = arpW;
      return e;
    });
    const cornerFlags = child(s, "cornerisperimcorner")?.attrs ?? {};
    const perimCorners = [0, 1, 2, 3].map((i) => bool(cornerFlags[`c${i}`])) as [
      boolean,
      boolean,
      boolean,
      boolean,
    ];
    const perimLengthFt = edges.reduce(
      (sum, e) => sum + (e.isPerimeter ? (e.perimLengthFt ?? e.lengthFt) : 0),
      0,
    );
    const enhancementWidthFt = num(s, "perimenhancementwidth");
    if (perimLengthFt > 0 && enhancementWidthFt <= 0)
      warn(`${where}: perimeter edges are marked but the enhancement width is 0.`);

    // Layers (four legacy slots).
    const uatt = child(s, "uattachmentsystems")?.attrs ?? {};
    const layers: UnderlaymentLayer[] = [];
    const fieldShort = text(s, "fieldattachmentsystem");
    let adhesiveSpacing: { field: number; perim: number } | undefined;
    for (let i = 0; i < 4; i++) {
      const u = child(s, `underlayment${i}`);
      const boardId = attrNum(u, "refid", -1);
      if (!u || boardId < 0) continue;
      const short = uatt[`am${i}`] ?? "nothing";
      let attachment: UnderlaymentLayer["attachment"] = "none";
      let adhesiveName = "";
      if (short === "nothing" || short === "") {
        // Legacy "Section Fastened w/ Durobond" (docs §22.17): boards under a Duro-Bond field
        // attachment are held by the membrane's induction plates and bill layout labor only.
        attachment = fieldShort === "durobondmech" ? "durobond" : "none";
      } else if (ref.mechShortNames.has(short) || /mech$/i.test(short)) {
        attachment = "mechanical";
      } else {
        const adh = ref.adhesiveByShort.get(short);
        if (adh) {
          attachment = "adhesive";
          adhesiveName = adh.longName;
        } else warn(`${where} layer ${i + 1}: unknown attachment "${short}"; read as none.`);
      }
      const qid = num(u, "quoteid", -1);
      const layer: UnderlaymentLayer = {
        board: boardName(boardId, qid >= 0),
        attachment,
        fastenersPerBoard: 0,
        adhesiveName,
        substrate: "",
      };
      if (qid >= 0) {
        const q = quotes.get(qid);
        if (q) layer.quote = { ...q };
        else warn(`${where} layer ${i + 1}: quote ${qid} is not in the file's quote list.`);
      }
      const cau = num(u, "customadhesiveunits");
      if (cau > 0) layer.quoteAdhesiveUnits = cau;
      const ca = child(s, `ucustomadhesive${i}`);
      const caField = attrNum(ca, "field", -1);
      const caPerim = attrNum(ca, "perim", -1);
      if (caField > 0 && !adhesiveSpacing)
        adhesiveSpacing = { field: caField, perim: caPerim > 0 ? caPerim : caField };
      layers.push(layer);
    }

    const sec: BidSectionInput = {
      id: `s${idx + 1}`,
      name: (s.attrs["customname"] ?? "").trim() || `Section ${idx + 1}`,
      length,
      width,
      deckType: deckName(num(s, "decktypeid", 1), where),
      thickness,
      color: colorName(num(s, "color", 3)),
      fieldLap: tab,
      fastenerOc: 18,
      pullTest: num(s, "pulltest", 350),
      designTable: num(s, "designtable", 60),
      perimLengthFt,
      cornerLengthFt: 0,
      enhancementWidthFt: enhancementWidthFt > 0 ? enhancementWidthFt : 3,
      perimFastenerOc: 12,
      cornerFastenerOc: 6,
      underlaymentBoard: "",
      layers,
      edges,
      perimCorners,
      roofSystem,
      attachment: field.attachment,
      sheetSizeLabel: sheetLabel,
      tearOff: bool(text(s, "tearoff")),
      tearOffType: "",
      toThicknessInches: num(s, "to_thickness"),
      isQuickBid: bool(text(s, "quickbid") || "True"),
      adjustLaborPct: num(s, "adjustlabor"),
      adjustUnderlaymentLaborPct: num(s, "adjustullabor"),
      tearOffAdditionalPct: num(s, "to_additional"),
    };
    if (field.adhesive) sec.membraneAdhesiveName = field.adhesive;
    const notes = text(s, "notes");
    if (notes) sec.notes = notes;
    const cplx = num(s, "complexityfactorid", -1);
    if (cplx >= 0) sec.complexity = cplx;
    if (sec.tearOff) {
      const toId = num(s, "to_typeid");
      sec.tearOffType = ref.tearOffById.get(toId) ?? "";
      if (!sec.tearOffType) warn(`${where}: tear-off type id ${toId} is unknown.`);
    }
    const pLap = num(s, "customperimeterlap0", -1);
    const cLap = num(s, "customcornerlap0", -1);
    if (pLap >= 0) sec.perimLap = pLap;
    if (cLap >= 0) sec.cornerLap = cLap;
    const csFlags = child(s, "uusemechcustomsettings")?.attrs ?? {};
    if (bool(csFlags["cs0"])) {
      sec.tuffCustom = {
        rows: [num(s, "numcustomrowsouterperim"), num(s, "numcustomrowsinnerperim")],
        perimOc: [num(s, "customperimeterfspacing0", -1), num(s, "customperimeterfspacing1", -1)],
        cornerOc: [num(s, "customcornerfspacing0", -1), num(s, "customcornerfspacing1", -1)],
      };
      const fl = num(s, "customfieldlap", -1);
      const fo = num(s, "customfieldfspacing", -1);
      if (fl >= 0) sec.tuffCustom.fieldLapIn = fl;
      if (fo >= 0) sec.tuffCustom.fieldOc = fo;
    }
    const uf = child(s, "ucustomfasteners")?.attrs ?? {};
    const ufField = Number(uf["field"] ?? -1);
    if (ufField >= 0)
      sec.uCustomFastenerDensity = {
        field: ufField,
        perim: Math.max(0, Number(uf["perim"] ?? 0)),
        corner: Math.max(0, Number(uf["corner"] ?? 0)),
      };
    if (adhesiveSpacing) {
      sec.uAdhesiveSpacingIn = adhesiveSpacing.field;
      sec.uAdhesiveSpacingPerimIn = adhesiveSpacing.perim;
    }
    const custFieldCost = num(s, "customfieldsqftcost", -1);
    if (custFieldCost >= 0)
      warn(
        `${where}: a custom field $/sqft (${custFieldCost}) was set in Bid-Advantage; the app prices from its tables.`,
      );
    if (Math.abs(sec.adjustUnderlaymentLaborPct ?? 0) >= 500)
      warn(
        `${where}: underlayment labor adjustment is ${sec.adjustUnderlaymentLaborPct}% in the file — check it.`,
      );

    // Fastener OC from the live pull-test lookup (mechanical sections only).
    if (field.attachment === "mechanical" && opts.fastenerLookup?.length) {
      const rsWebId = LEGACY_ROOF_SYSTEM_IDS[roofSystem] ?? rsId;
      const args = {
        roofSystemId: rsWebId,
        thickness,
        designTable: sec.designTable ?? 60,
        tabSpacings: [tab],
        pullTest: sec.pullTest ?? 350,
      };
      const f = universalFastenerSpacing(opts.fastenerLookup, { ...args, columnOffset: 0 });
      const p = universalFastenerSpacing(opts.fastenerLookup, { ...args, columnOffset: 1 });
      const c = universalFastenerSpacing(opts.fastenerLookup, { ...args, columnOffset: 2 });
      if (f.ok) sec.fastenerOc = f.inches;
      if (p.ok) sec.perimFastenerOc = p.inches;
      if (c.ok) sec.cornerFastenerOc = c.inches;
      if (!f.ok && rsId !== 2)
        warn(
          `${where}: no fastener spacing row for ${roofSystem} ${thickness} mil, tab ${tab}", pull test ${sec.pullTest}; default spacing kept.`,
        );
    }
    sections.push(sec);
  });
  if (sections.length === 0) warn("The file has no roof sections.");

  // ── Parapets ─────────────────────────────────────────────────────────────
  const parapets: ParapetInput[] = children(child(est, "parapets"), "parapet").map((p, idx) => {
    const where = `Parapet ${idx + 1}`;
    const rsId = num(p, "roofsystemid", 1);
    const att = attachmentOf(text(p, "attachmentsystem"));
    const skirt = num(p, "skirt");
    const cant = num(p, "cant");
    const vertical = num(p, "vertical");
    const wallTop = num(p, "walltop");
    const drop = num(p, "drop");
    const wallType = num(p, "walltypeid", 1);
    const out: ParapetInput = {
      id: `p${idx + 1}`,
      name: `Parapet ${idx + 1}`,
      lengthFt: num(p, "length"),
      heightBand: "",
      deckType: deckName(num(p, "decktypeid", 1), where),
      predrill: att.attachment !== "mechanical" || wallType === 4,
      canted: cant > 0,
      girthInches: skirt + cant + vertical + wallTop + drop,
      pieces: num(p, "pieces", 1),
      adjustLaborPct: num(p, "adjustlabor"),
      useSlipsheet: bool(text(p, "useplastic")),
      thicknessMil: thicknessOf(rsId, num(p, "thickness"), where),
      color: colorName(num(p, "color", 3)),
      hasBlocking: bool(text(p, "hasblocking")),
      capstoneOption: num(p, "capstoneid"),
      roofSystem: systemName(rsId),
      attachment: att.attachment,
      wallType,
      skirtInches: skirt,
      cantInches: cant,
      verticalInches: vertical,
      wallTopInches: wallTop,
      dropInches: drop,
    };
    if (att.adhesive) out.membraneAdhesiveName = att.adhesive;
    const capLen = num(p, "capstonelength");
    if (capLen > 0) out.capstoneLengthFt = capLen;
    const arpSize = ref.arpSizeById.get(num(p, "arpid")) ?? 0;
    if (arpSize > 0) {
      out.arpSizeIn = arpSize;
      const arpLen = num(p, "arplength");
      if (arpLen > 0) out.arpLengthFt = arpLen;
    }
    const termOpt = num(p, "termoption", 1);
    if (termOpt > 1) {
      out.termOptionId = termOpt;
      const tl = num(p, "termlength");
      if (tl > 0) out.termLengthFt = tl;
    }
    const bl = num(p, "blockinglength");
    if (bl > 0) out.blockingLengthFt = bl;
    const notes = text(p, "notes");
    if (notes) out.notes = notes;
    return out;
  });

  // ── Curbs ────────────────────────────────────────────────────────────────
  const curbs: CurbInput[] = children(child(est, "curbs"), "curb").map((c, idx) => {
    const where = `Curb ${idx + 1}`;
    const styleId = num(c, "styleid", 1);
    const curbType = ref.curbStyleById.get(styleId) ?? "Open";
    if (!ref.curbStyleById.has(styleId))
      warn(`${where}: unknown curb style ${styleId}; using Open.`);
    const out: CurbInput = {
      id: `c${idx + 1}`,
      name: `Curb ${idx + 1}`,
      quantity: num(c, "qty", 1),
      widthIn: num(c, "dimension0"),
      lengthIn: num(c, "dimension1"),
      curbType,
      deckType: deckName(num(c, "decktypeid", 1), where),
      styleId,
      dimCIn: num(c, "dimension2"),
      dimDIn: num(c, "dimension3"),
      thicknessMil: num(c, "thickness", 40),
      color: colorName(num(c, "color", 3)),
      adjustLaborPct: num(c, "adjustlabor"),
      hasInsulation: bool(text(c, "hasinsulation")),
      hasPlastic: bool(text(c, "hasplastic")),
    };
    const termRaw = text(c, "termoption");
    const term = legacyCurbTermOption(termRaw);
    if (term === null)
      warn(`${where}: termination option "${termRaw}" is not recognised; set to None.`);
    else if (term > 0) out.termOption = term;
    return out;
  });

  // ── Accessories (the §12 calculated screens) ─────────────────────────────
  const acc: AccessoriesState = emptyAccessoriesState();
  const accNode = child(est, "accessories");
  for (const c of children(child(accNode, "corners"), "corner")) {
    const name = ref.cornerByRef.get(attrNum(c, "refid", -1))?.name;
    if (!name) {
      warn(`Corner id ${c.attrs["refid"]} is unknown; skipped.`);
      continue;
    }
    for (const [attr, color] of COLOR_QTY_ATTRS) {
      const q = attrNum(c, attr);
      if (q > 0) (acc.corners.qty[name] ??= {})[color] = q;
    }
    if (attrNum(c, "adjustlabor")) acc.corners.adjustPct = attrNum(c, "adjustlabor");
  }
  children(child(accNode, "drains"), "drain").forEach((d, i) => {
    const q = attrNum(d, "quantity");
    if (q <= 0) return;
    acc.drains.push({
      id: `bax-drain-${i + 1}`,
      quantity: q,
      roofType: ref.drainRoofTypeById.get(attrNum(d, "existingrooftypeid", 1)) ?? "None",
      reuseRings: bool(d.attrs["reusering"]),
      bootSize: ref.drainBootById.get(attrNum(d, "drainbootsizeid", -1)) ?? "",
      ringSize: ref.drainRingById.get(attrNum(d, "drainringsizeid", -1)) ?? "",
      adjustPct: attrNum(d, "adjustlabor"),
    });
  });
  for (const f of children(child(accNode, "fasteners"), "fastener")) {
    const fr = ref.fastenerByRef.get(attrNum(f, "refid", -1));
    if (!fr) {
      warn(`Fastener id ${f.attrs["refid"]} is unknown; its quantities were skipped.`);
      continue;
    }
    const key = `${fr.description}|${fr.subtype}`;
    for (const [attr, slot] of FASTENER_SLOT_ATTRS) {
      const q = attrNum(f, attr);
      if (q > 0) {
        const bySlot = (acc.fastenerQty[slot] ??= {});
        bySlot[key] = (bySlot[key] ?? 0) + q;
      }
    }
  }
  for (const p of children(child(accNode, "panduits"), "panduit")) {
    const q = attrNum(p, "quantity");
    const d = ref.panduitByRef.get(attrNum(p, "refid", -1));
    if (q > 0 && d) acc.panduitExtra[d] = q;
  }
  children(child(accNode, "pipestacks"), "pipestack").forEach((p, i) => {
    const q = attrNum(p, "quantity");
    if (q <= 0) return;
    acc.pipeStacks.push({
      id: `bax-stack-${i + 1}`,
      usage: ref.pipeUsageById.get(attrNum(p, "usageid", 1)) ?? "Plumbing",
      color: colorName(attrNum(p, "color", 3)),
      open: bool(p.attrs["isopen"]),
      size: ref.pipeStackSizeById.get(attrNum(p, "sizeid", -1)) ?? 0,
      quantity: q,
      adjustPct: attrNum(p, "adjustlabor"),
    });
  });
  for (const s of children(child(accNode, "sealants"), "sealant")) {
    const q = attrNum(s, "quantity");
    const r = ref.sealantByRef.get(attrNum(s, "refid", -1));
    if (q > 0 && r) acc.sealants.extra[r.part || r.description] = q;
  }
  for (const a of children(child(accNode, "adhesivesystems"), "adhesive")) {
    const q = attrNum(a, "qty");
    const r = ref.adhesiveById.get(attrNum(a, "id", -1));
    if (q > 0 && r) acc.adhesivesExtra[r.longName] = q;
  }
  for (const s of children(child(accNode, "strainers"), "strainer")) {
    const q = attrNum(s, "quantity");
    const d = ref.strainerByRef.get(attrNum(s, "refid", -1));
    if (q > 0 && d) acc.strainers.qty[d] = q;
    if (attrNum(s, "adjustlabor")) acc.strainers.adjustPct = attrNum(s, "adjustlabor");
  }
  for (const tb of children(child(accNode, "termbars"), "termbar")) {
    const color = ref.termBarByRef.get(attrNum(tb, "refid", -1)) ?? "White";
    const nd = attrNum(tb, "othernodrilllength");
    const pd = attrNum(tb, "otherpredrilllength");
    if (isTermColor(color)) {
      if (nd > 0) acc.termBar.additionalNoDrill[color] = nd;
      if (pd > 0) acc.termBar.additionalPreDrill[color] = pd;
    } else if (nd > 0 || pd > 0) warn(`Term bar colour "${color}" extra feet were skipped.`);
    if (bool(tb.attrs["usestripmastic"])) {
      acc.termBar.stripMastic = true;
      const sm = attrNum(tb, "stripmasticlength");
      if (sm > 0) acc.termBar.stripMasticLengthFt = sm;
    }
    if (attrNum(tb, "adjustlabornodrill"))
      acc.termBar.adjustNoDrillPct = attrNum(tb, "adjustlabornodrill");
    if (attrNum(tb, "adjustlaborpredrill"))
      acc.termBar.adjustPreDrillPct = attrNum(tb, "adjustlaborpredrill");
  }
  for (const tp of children(child(accNode, "twopiecemetals"), "twopiecemetal")) {
    const r = ref.twoPieceByRef.get(attrNum(tp, "refid", -1));
    const size = r?.sizeIn as SnapSize | undefined;
    if (!size || !(size in acc.snapCover)) {
      warn(`Two-piece metal id ${tp.attrs["refid"]} has no size the app knows; skipped.`);
      continue;
    }
    const st = acc.snapCover[size];
    const covers = attrNum(tp, "coverquantity");
    st.additionalFt = attrNum(tp, "otherlength");
    st.coversOn = covers > 0;
    if (covers > 0) st.coversQty = covers;
    st.insideCorners = attrNum(tp, "insidecornerqty");
    st.outsideCorners = attrNum(tp, "outsidecornerqty");
    st.adjustPct = attrNum(tp, "adjustlabor");
  }
  const ventsNode = child(accNode, "vents");
  for (const v of children(ventsNode, "vent")) {
    const q = attrNum(v, "quantity");
    const d = ref.ventByRef.get(attrNum(v, "refid", -1));
    if (q > 0 && d) acc.vents.delta[d] = q;
    if (attrNum(v, "adjustlabor")) acc.vents.adjustPct = attrNum(v, "adjustlabor");
  }
  for (const w of children(child(accNode, "washers"), "washer")) {
    const q = attrNum(w, "quantity", attrNum(w, "qty"));
    const d = ref.washerByRef.get(attrNum(w, "refid", -1));
    if (q > 0 && d) acc.washers.qty[d] = q;
    if (attrNum(w, "adjustlabor")) acc.washers.adjustPct = attrNum(w, "adjustlabor");
  }
  for (const a of children(child(accNode, "accothers"), "accother")) {
    const q = attrNum(a, "quantity", attrNum(a, "qty"));
    const d = ref.accOtherByRef.get(attrNum(a, "refid", -1));
    if (q > 0 && d) acc.walkPads.qty[d] = q;
    if (attrNum(a, "adjustlabor")) acc.walkPads.adjustPct = attrNum(a, "adjustlabor");
  }
  for (const a of children(child(accNode, "membraneaccs"), "accother")) {
    const q = attrNum(a, "qty", attrNum(a, "quantity"));
    if (q <= 0) continue;
    const r = ref.membraneAccByRef.get(attrNum(a, "refid", -1));
    const sub = (r?.subtype ?? "").toLowerCase();
    if (sub === "arp") acc.membraneAccs.arpExtra = q;
    else if (sub === "tpatch") acc.membraneAccs.tPatchExtra = q;
    else
      warn(`Membrane accessory "${r?.description ?? a.attrs["refid"]}" × ${q} was not imported.`);
  }
  for (const tag of ["dripedges", "gravelstops", "fasciabars"]) {
    const n = child(accNode, tag)?.children.length ?? 0;
    if (n > 0)
      warn(
        `${n} ${tag.replace(/s$/, "")} entr${n === 1 ? "y" : "ies"} in the file were not imported — re-enter on the Accessories tab.`,
      );
  }

  // ── Metals → flat lines (keeps the legacy per-line price / labor / rate exactly) ──
  const metals: NonDlLine[] = [];
  const metalsNode = child(est, "metals");
  const lineFrom = (
    n: XNode,
    description: string,
    category: string,
    qtyAttr: string,
    laborAttr: string,
  ): NonDlLine => ({
    description,
    category,
    price: attrNum(n, "price"),
    laborPerUnit: attrNum(n, laborAttr),
    laborRate: attrNum(n, "laborrate"),
    quantity: attrNum(n, qtyAttr),
  });
  for (const g of children(child(metalsNode, "gutters"), "gutter")) {
    const r = ref.gutterByRef.get(attrNum(g, "refid", -1));
    const desc = r
      ? `Gutter ${r.style}-${r.size} (A=${r.a}" B=${r.b}" C=${r.c}")`
      : `Gutter (id ${g.attrs["refid"]})`;
    metals.push(lineFrom(g, desc, "Gutters", "length", "laborperunit"));
    for (const a of children(child(g, "gutteraccs"), "gutteracc")) {
      const d =
        ref.gutterAccByRef.get(attrNum(a, "refid", -1)) ?? `Gutter accessory ${a.attrs["refid"]}`;
      metals.push(
        lineFrom(
          a,
          `${d} (${r ? `${r.style}-${r.size}` : "gutter"})`,
          "Gutters",
          "qty",
          "laborperunit",
        ),
      );
    }
  }
  for (const d of children(child(metalsNode, "downspouts"), "downspout")) {
    const r = ref.downspoutByRef.get(attrNum(d, "refid", -1));
    const desc = r
      ? `Downspout ${r.description} (${r.style} ${r.a}"x${r.b}")`
      : `Downspout (id ${d.attrs["refid"]})`;
    metals.push(lineFrom(d, desc, "Downspouts", "length", "laborperfoot"));
  }
  for (const a of children(child(metalsNode, "downspoutaccs"), "downspoutacc")) {
    const d =
      ref.downspoutAccByRef.get(attrNum(a, "refid", -1)) ??
      `Downspout accessory ${a.attrs["refid"]}`;
    metals.push(lineFrom(a, d, "Downspouts", "qty", "laborperunit"));
  }
  for (const p of children(child(metalsNode, "pitchpans"), "pitchpan")) {
    const d = ref.pitchPanByRef.get(attrNum(p, "refid", -1)) ?? `Pitch pan ${p.attrs["refid"]}`;
    metals.push(
      lineFrom(
        p,
        d,
        "Pitch Pans",
        p.attrs["qty"] !== undefined ? "qty" : "quantity",
        "laborperunit",
      ),
    );
  }
  for (const c of children(child(metalsNode, "collectionboxes"), "collectionbox")) {
    const d =
      ref.collectionBoxByRef.get(attrNum(c, "refid", -1)) ?? `Collection box ${c.attrs["refid"]}`;
    metals.push(
      lineFrom(
        c,
        d,
        "Collection Boxes",
        c.attrs["qty"] !== undefined ? "qty" : "quantity",
        "laborperunit",
      ),
    );
  }
  const metalLump = num(child(est, "nondl"), "metalmaterialcost");
  if (metalLump > 0) {
    metals.push({
      description: "Metal material (legacy lump sum)",
      category: "Metals",
      price: metalLump,
      laborPerUnit: 0,
      laborRate: 0,
      quantity: 1,
    });
    warn(
      `A legacy metal material lump sum of ${metalLump} was added as one Exceptional Metals line.`,
    );
  }
  const zeroQty = metals.filter((m) => m.quantity <= 0);
  for (const z of zeroQty) metals.splice(metals.indexOf(z), 1);

  // ── Non-Duro-Last items → custom rows with the legacy money ─────────────
  const nonDlCalc: NonDlState = emptyNonDlState();
  const ndlNode = child(est, "nondl");
  for (const grp of ndlNode?.children ?? []) {
    if (grp.tag === "metalmaterialcost") continue;
    const group = NON_DL_GROUP_BY_TAG[grp.tag];
    if (!group) {
      if (grp.children.length)
        warn(
          `Non-DL group "${grp.tag}" is not known to the app; ${grp.children.length} item(s) skipped.`,
        );
      continue;
    }
    for (const it of children(grp, "ndlitem")) {
      const qty = attrNum(it, "qty");
      const row = {
        description: (it.attrs["description"] ?? "").trim() || "Item",
        qty,
        unitCost: attrNum(it, "unitcost"),
        laborPerUnit: attrNum(it, "laborperunit"),
        laborRate: attrNum(it, "laborrate"),
        laborHours: attrNum(it, "labor"),
      };
      if (qty <= 0 && row.unitCost <= 0 && row.laborHours <= 0) continue;
      (nonDlCalc.custom[group] ??= []).push(row);
    }
  }

  // ── Estimate-level money & info ──────────────────────────────────────────
  const markupMode = legacyMarkupMode(text(est, "markupmode"));
  if (markupMode === null)
    warn(`Markup mode "${text(est, "markupmode")}" is unknown; gross-profit % assumed.`);
  const whatIf = text(est, "custommarkup");
  const whatIfMarkup =
    /^-?\d/.test(whatIf) && Number.isFinite(Number(whatIf)) ? Number(whatIf) : null;
  if (whatIfMarkup !== null)
    warn(
      `Bid-Advantage also showed a what-if column at ${whatIfMarkup}% markup; the bid total used ${num(est, "markup")}%.`,
    );
  const statusId = num(est, "estimatestatusid", 1);
  const legacyStatus = ref.statusById.get(statusId) ?? `status ${statusId}`;
  const status = legacyStatusToWeb(legacyStatus);
  const warranty = ref.warrantyById.get(num(est, "warranty", -1));
  const maxWind = num(est, "maxwind", 72);
  const windOpt = MAX_WIND_OPTIONS.find((o) => o.value === maxWind);
  if (!windOpt) warn(`Max expected wind ${maxWind} mph is not one of the app's bands.`);
  const templateName = ref.templateById.get(num(est, "template", -1)) ?? "";
  if (templateName && opts.laborTemplateNames && !opts.laborTemplateNames.includes(templateName))
    warn(
      `Labor template "${templateName}" is not in the app's list; the bid keeps its per-item adjustments.`,
    );
  const description = text(est, "description");
  const perDiemChart = parsePerDiemChart(description);
  if (num(est, "discount") !== 0)
    warn(`A legacy discount of ${num(est, "discount")} was not imported.`);
  if (num(est, "tearoffadjust", 1) !== 1)
    warn(`Legacy tear-off adjust ${num(est, "tearoffadjust")} was not imported.`);
  const inspAdj = num(est, "inspectiontime");
  if (inspAdj !== 0)
    warn(
      `Legacy inspection time adjustment ${inspAdj} was imported as an inspection % — check it.`,
    );

  const first = sections[0];
  const customer: CustomerInfo = {
    name: text(est, "clientname"),
    contact: text(est, "clientcontact"),
    projectAddress: text(est, "address1"),
    notes: description,
  };
  const setIf = <K extends keyof CustomerInfo>(k: K, v: CustomerInfo[K]) => {
    if (v !== undefined && v !== "" && v !== null) customer[k] = v;
  };
  setIf("projectAddress2", text(est, "address2"));
  setIf("jobCity", text(est, "city"));
  setIf("jobState", text(est, "state"));
  setIf("jobZip", text(est, "zip"));
  setIf("jobCityStZip", cityStZip(text(est, "city"), text(est, "state"), text(est, "zip")));
  setIf("jobNumber", text(est, "jobnumber"));
  setIf("shipVia", text(est, "shipvia"));
  setIf("shipTo", text(est, "shipto"));
  setIf("phone", text(est, "clientphone"));
  setIf("phoneExt", text(est, "clientextension"));
  setIf("email", text(est, "clientemail"));
  setIf("fax", text(est, "clientfax"));
  setIf("clientAddress", text(est, "clientaddress1"));
  setIf("clientCity", text(est, "clientcity"));
  setIf("clientState", text(est, "clientstate"));
  setIf("clientZip", text(est, "clientzip"));
  if (perDiemChart) customer.perDiemChart = perDiemChart;

  const defSec = child(est, "roofsection");
  const defPar = child(est, "parapet");
  const defRs = num(defSec, "roofsystemid", 1);
  const salesTax = num(est, "salestax");
  const taxExempt = bool(text(est, "taxexempt"));
  const hoursPerDay = num(child(management, "settings"), "mandayhours", 0);

  const saved: SavedBidState = {
    roofSystem: first?.roofSystem ?? systemName(defRs),
    attachment: first?.attachment ?? "mechanical",
    sections,
    accessories: [],
    accessoriesCalc: acc,
    nonDlCalc,
    nonDlLines: [],
    metals,
    parapets,
    curbs,
    customer,
    markupMode: markupMode ?? 2,
    markup: num(est, "markup"),
    laborRate: num(est, "laborrate"),
    commission: num(est, "commission"),
    taxExempt,
    prepayDiscount: false,
    stdSizeDiscount: bool(text(est, "largesheetdiscount")),
    volumeDiscount: false,
    perDiem: num(est, "perdiem"),
    perDiemInMarkup: bool(text(est, "perdieminmarkup")),
    commissionInMarkup: bool(text(est, "commissioninmarkup")),
    adjustLaborPct: 0,
    adjustSetupPct: num(est, "setupadjust"),
    adjustInspectionPct: inspAdj,
    laborTemplateName: templateName,
    extraShipping: num(est, "extrashipping"),
    salesTaxRate: salesTax,
    taxMaterialOnly: num(est, "taxmode") === 1,
    maxWindExpected: windOpt ? maxWind : 72,
    warrantyName: warranty?.name ?? "",
    highWind: warranty?.isHighWind ?? false,
    highWindTermYears: warranty?.termYears ?? 0,
    highWindBand: windOpt?.band ?? "",
  };
  if (hoursPerDay > 0) saved.hoursPerDay = hoursPerDay;
  const membraneAdhesive =
    sections.find((s) => s.membraneAdhesiveName)?.membraneAdhesiveName ??
    parapets.find((p) => p.membraneAdhesiveName)?.membraneAdhesiveName;
  if (membraneAdhesive) saved.membraneAdhesiveName = membraneAdhesive;
  const fv = (est.attrs["formulasversion"] ?? "").trim();
  if (fv) saved.formulasVersion = fv;
  const startDate = legacyDateOnly(text(est, "startdate"));
  if (startDate) saved.startDate = startDate;
  if (defSec) {
    saved.sectionDefaults = {
      deckType: deckName(num(defSec, "decktypeid", 1), "Defaults"),
      thickness: thicknessOf(defRs, num(defSec, "membranetype"), "Defaults"),
      color: colorName(num(defSec, "color", 3)),
      sheetSizeLabel:
        ref.systemById.get(defRs)?.sheetSizes.get(num(defSec, "sheetsizeid")) ??
        first?.sheetSizeLabel ??
        "",
      designTable: num(defSec, "designtable", 60),
    };
  }
  if (defPar) {
    const pAtt = attachmentOf(text(defPar, "attachmentsystem"));
    const pRs = num(defPar, "roofsystemid", 1);
    saved.parapetDefaults = {
      roofSystem: systemName(pRs),
      attachment: pAtt.attachment,
      thicknessMil: thicknessOf(pRs, num(defPar, "thickness"), "Parapet defaults"),
      color: colorName(num(defPar, "color", 3)),
      wallType: num(defPar, "walltypeid", 1),
    };
    if (pAtt.adhesive) saved.parapetDefaults.membraneAdhesiveName = pAtt.adhesive;
  }

  const lastSavedAt = parseLegacyDate(text(est, "locktimestamp"));
  const importInfo: BaxImportInfo = {
    source: "bid-advantage",
    fileName: opts.fileName,
    importedAt: opts.importedAt ?? new Date().toISOString(),
    appVersion: versions?.attrs["App"] ?? versions?.attrs["app"] ?? "",
    formulasVersion: fv,
    legacyStatus,
    lastSavedAt,
    startDate: parseLegacyDate(text(est, "startdate")),
    finishDate: parseLegacyDate(text(est, "finishdate")),
    whatIfMarkup,
    laborTemplate: templateName,
    pricingOverlays: [],
  };
  saved.importInfo = importInfo;

  return {
    name: text(est, "title") || opts.fileName.replace(/\.bax$/i, "") || "Imported bid",
    status,
    legacyStatus,
    lastSavedAt,
    saved,
    warnings,
    importInfo,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing overlay: the file's price tables onto a copy of the live admin data
// ─────────────────────────────────────────────────────────────────────────────

const TIER_BY_CATEGORY: Record<number, PriceTier> = {
  5: "rollGoods",
  1: "tab28",
  4: "tab60",
  2: "tab120",
  3: "parapet",
};
/** lookup_DuroLastPrices columns val2..val7 (docs §7.2). */
const PRICE_COLUMN_COLORS = ["White", "Tan", "Gray", "Dark Gray", "Terra Cotta", "Rock Ply"];

function rowsOf(management: XNode | undefined, tag: string): XNode[] {
  return children(child(management, tag), "row");
}

const clone = <T>(v: T): T =>
  typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

/**
 * Overlay the legacy file's prices onto a copy of the live admin data. Returns the new admin
 * data and a list of what was overlaid (kept on the bid's importInfo). Tables the file does not
 * carry (labor hour tables, underlayment $/sqft — empty in every sample, fastener box prices)
 * stay the live values.
 */
export function applyLegacyPricing(
  admin: EngineAdminData,
  doc: XNode,
): { admin: EngineAdminData; applied: string[]; notes: string[] } {
  const out = clone(admin);
  const applied: string[] = [];
  const notes: string[] = [];
  const m = child(doc, "management");
  const ref = buildRefTables(m);

  // Duro-Last / Duro-Roof membrane matrix: thickness × category × colour.
  const priceRows = rowsOf(m, "lookupprices");
  if (priceRows.length) {
    let n = 0;
    for (const r of priceRows) {
      const thickness = attrNum(r, "val0");
      const tier = TIER_BY_CATEGORY[attrNum(r, "val1")];
      if (!tier) continue;
      PRICE_COLUMN_COLORS.forEach((color, i) => {
        const v = attrNum(r, `val${i + 2}`, -1);
        if (v < 0) return;
        ((out.priceMatrix[thickness] ??= {})[tier] ??= {})[color] = v;
        n++;
      });
    }
    if (n) applied.push(`Duro-Last membrane prices (${n} cells)`);
  }
  // Flat family prices.
  const fam = (out.familyMembranePrices ??= {});
  const famColor = (out.familyMembranePricesByColor ??= {});
  const setFamily = (family: string, variant: string, price: number) => {
    (fam[family] ??= {})[variant] = price;
    ((famColor[family] ??= {})[variant] ??= {})["White"] = price;
  };
  let famN = 0;
  for (const r of rowsOf(m, "lookupdurobondprices")) {
    const v = attrNum(r, "val1", -1);
    if (v >= 0) {
      setFamily("Duro-Bond", String(attrNum(r, "val0")), v);
      famN++;
    }
  }
  for (const r of rowsOf(m, "lookupdurotuffprices")) {
    const v = attrNum(r, "val1", -1);
    if (v >= 0) {
      setFamily("Duro-Tuff", String(attrNum(r, "val0")), v);
      famN++;
    }
  }
  const fleece = ref.systemById.get(5);
  for (const r of rowsOf(m, "lookupdurofleeceprices")) {
    const v = attrNum(r, "val1", -1);
    const mt = fleece?.membraneTypes.get(attrNum(r, "val0", -1));
    if (v >= 0 && mt) {
      setFamily("Duro-Fleece", mt.description, v);
      famN++;
    }
  }
  if (famN) applied.push(`Duro-Bond / Duro-Tuff / Duro-Fleece prices (${famN} rows)`);

  // Adhesives.
  if (out.adhesivePrices && ref.adhesiveById.size) {
    let n = 0;
    for (const a of ref.adhesiveById.values()) {
      if (a.longName in out.adhesivePrices && a.price >= 0) {
        out.adhesivePrices[a.longName] = a.price;
        n++;
      }
    }
    if (n) applied.push(`adhesive prices (${n})`);
  }

  // Company settings and freight / setup / inspection bands.
  const settings = child(m, "settings");
  if (settings) {
    const hpd = num(settings, "mandayhours", 0);
    if (hpd > 0) out.settings.hoursPerDay = hpd;
    out.settings.salesTax = num(settings, "salestax", out.settings.salesTax);
    out.settings.taxMaterialOnly =
      num(settings, "taxmode", out.settings.taxMaterialOnly ? 1 : 0) === 1;
    out.settings.masterEliteCont = bool(text(settings, "masterelite") || "1");
    const mode = text(settings, "shipcalcmode");
    if (mode) out.settings.shippingMode = mode;
    out.settings.shippingPercent = num(
      settings,
      "shipcalcpercentage",
      out.settings.shippingPercent,
    );
    applied.push("company settings (hours per man-day, sales tax, shipping mode)");
  }
  const freight = rowsOf(m, "freightcosts");
  if (freight.length) {
    out.shippingSteps = freight
      .map((r) => ({ fromThreshold: attrNum(r, "val2"), cost: attrNum(r, "val1") }))
      .sort((a, b) => a.fromThreshold - b.fromThreshold);
    applied.push(`freight steps (${freight.length})`);
  }
  const setup = rowsOf(m, "setuptimes");
  if (setup.length && out.setupTable) {
    // Legacy rows: val1 = sqft edge, val2 = hours (mode 0) or multiplier (mode 1 = val3).
    const minRow = setup.find((r) => attrNum(r, "val3") === 0);
    const bands = setup
      .filter((r) => attrNum(r, "val3") === 1)
      .map((r) => ({ upTo: attrNum(r, "val1"), value: attrNum(r, "val2"), multiply: true }))
      .sort((a, b) => a.upTo - b.upTo);
    if (bands.length) {
      out.setupTable = {
        minimum: minRow ? attrNum(minRow, "val2") : out.setupTable.minimum,
        bands,
      };
      applied.push("setup time bands");
    } else notes.push("Setup time table in the file had no multiplier rows; live table kept.");
  }
  const insp = rowsOf(m, "inspectiontimes");
  if (insp.length) {
    const bands = insp
      .map((r) => ({ edge: attrNum(r, "val1"), value: attrNum(r, "val2") }))
      .sort((a, b) => a.edge - b.edge);
    out.inspectionTable = { minimum: bands[0]?.value ?? 0, bands };
    applied.push("inspection time bands");
  }

  // Accessory catalog prices (matched by description; unmatched rows keep the live price).
  const acc = out.accessories;
  if (acc) {
    let n = 0;
    const byDesc = <T extends { description: string }>(list: T[] | undefined, d: string) =>
      list?.find((x) => nameKey(x.description) === nameKey(d));
    for (const c of children(child(m, "corners"), "corner")) {
      const row = byDesc(acc.corners, c.attrs["name"] ?? "");
      if (!row) continue;
      const pairs: Array<[string, string]> = [
        ["unitcost", "White"],
        ["tancost", "Tan"],
        ["graycost", "Gray"],
        ["darkgraycost", "Dark Gray"],
        ["terracottacost", "Terra Cotta"],
      ];
      for (const [attr, color] of pairs)
        if (color in row.priceByColor && c.attrs[attr] !== undefined) {
          row.priceByColor[color] = attrNum(c, attr);
          n++;
        }
    }
    for (const d of children(child(m, "drainboots"), "drainboot")) {
      const row = byDesc(acc.drainBoots, d.attrs["description"] ?? "");
      if (row) {
        row.price = attrNum(d, "price");
        n++;
      }
    }
    for (const d of children(child(m, "drainrings"), "drainring")) {
      const row = byDesc(acc.drainRings, d.attrs["description"] ?? "");
      if (row) {
        row.price = attrNum(d, "price");
        n++;
      }
    }
    for (const s of children(child(m, "strainers"), "strainer")) {
      const row = byDesc(acc.strainers, s.attrs["description"] ?? "");
      if (row) {
        row.price = attrNum(s, "price");
        n++;
      }
    }
    for (const w of children(child(m, "washers"), "washer")) {
      const row = byDesc(acc.washers, w.attrs["description"] ?? "");
      if (row) {
        row.price = attrNum(w, "price");
        n++;
      }
    }
    for (const a of children(child(m, "accothers"), "accother")) {
      const row = byDesc(acc.walkPads, a.attrs["description"] ?? "");
      if (row) {
        row.price = attrNum(a, "unitprice");
        n++;
      }
    }
    for (const s of children(child(m, "sealants"), "sealant")) {
      const row =
        acc.sealants.find((x) => x.part && x.part === (s.attrs["partnumber"] ?? "")) ??
        byDesc(acc.sealants, s.attrs["description"] ?? "");
      if (row) {
        row.price = attrNum(s, "price");
        n++;
      }
    }
    for (const p of children(child(m, "panduits"), "panduit")) {
      const row = byDesc(acc.panduit, p.attrs["description"] ?? "");
      if (row) {
        row.pricePerPart = attrNum(p, "perunit");
        n++;
      }
    }
    for (const v of children(child(m, "vents"), "vent")) {
      const color = (v.attrs["description"] ?? "").replace(/\s*vent$/i, "").trim();
      const row = acc.vents.find((x) => nameKey(x.color) === nameKey(color));
      if (row) {
        row.price = attrNum(v, "price");
        n++;
      }
    }
    for (const tb of children(child(m, "termbars"), "termbar")) {
      const color = tb.attrs["description"] ?? "";
      if (isTermColor(color) && acc.termBars[color]) {
        acc.termBars[color].pricePerFt = attrNum(tb, "price");
        n++;
      }
    }
    for (const tp of children(child(m, "twopiecemetals"), "twopiecemetal")) {
      const size = /^(\d+)"/.exec(tp.attrs["description"] ?? "")?.[1] as SnapSize | undefined;
      const row = size ? acc.twoPiece[size] : undefined;
      if (row) {
        row.pricePerFt = attrNum(tp, "price");
        row.coverPrice = attrNum(tp, "coverprice");
        row.insideCornerPrice = attrNum(tp, "insidecornerprice");
        row.outsideCornerPrice = attrNum(tp, "outsidecornerprice");
        row.priced = true;
        n++;
      }
    }
    for (const fb of children(child(m, "faciabars"), "faciabar")) {
      const size =
        /4/.test(fb.attrs["size"] ?? "") && !/1_3_4/.test(fb.attrs["size"] ?? "") ? "4" : "3";
      const row = acc.fascia[size];
      if (row) {
        row.barPricePerFt = attrNum(fb, "price");
        n++;
      }
    }
    const edgeGroups: Array<
      [string, Record<"2" | "4", { bar: { priceByColor: Record<TermColor, number> } }> | undefined]
    > = [
      ["dripedges", acc.dripEdge],
      ["gravelstops", acc.gravelStop],
    ];
    for (const [tag, target] of edgeGroups) {
      if (!target) continue;
      for (const ge of children(child(m, tag), "genericedge")) {
        const base = child(ge, "baseitem");
        const size = /4"/.test(base?.attrs["description"] ?? "") ? "4" : "2";
        const row = target[size];
        if (!row || !base) continue;
        row.bar.priceByColor.White = attrNum(base, "whiteprice", row.bar.priceByColor.White);
        row.bar.priceByColor.Tan = attrNum(base, "tanprice", row.bar.priceByColor.Tan);
        row.bar.priceByColor.Gray = attrNum(base, "grayprice", row.bar.priceByColor.Gray);
        n++;
      }
    }
    const arp = [...ref.membraneAccByRef.values()].find((x) => x.subtype.toLowerCase() === "arp");
    const tpatch = [...ref.membraneAccByRef.values()].find(
      (x) => x.subtype.toLowerCase() === "tpatch",
    );
    for (const a of children(child(m, "membraneaccs"), "accother")) {
      const sub = (a.attrs["subtype"] ?? "").toLowerCase();
      const target =
        sub === "arp"
          ? acc.membraneAccs.arp
          : sub === "tpatch"
            ? acc.membraneAccs.tPatch
            : undefined;
      if (target) {
        target.pricePerPack = attrNum(a, "priceperpack", target.pricePerPack);
        target.partsPerPack =
          attrNum(a, "itemsperpack", target.partsPerPack) || target.partsPerPack;
        n++;
      }
    }
    void arp;
    void tpatch;
    if (n) applied.push(`accessory catalog prices (${n} items)`);
  }
  notes.push(
    "Not in the file: underlayment $/sqft, fastener box prices and the labor hour tables — the live values apply.",
  );
  return { admin: out, applied, notes };
}

/** The file's warranty $/sqft and high-wind upcharges over the live warranty data. */
export function applyLegacyWarranty(
  live: WarrantyData,
  doc: XNode,
): { warranty: WarrantyData; applied: string[] } {
  const out = clone(live);
  const applied: string[] = [];
  const m = child(doc, "management");
  let n = 0;
  for (const w of children(child(m, "warranties"), "warranty")) {
    const row = out.warranties.find((x) => x.name === (w.attrs["name"] ?? ""));
    if (!row) continue;
    row.pricePerSqFt = attrNum(w, "costpersqft", row.pricePerSqFt);
    row.nonMasterEliteSurcharge = attrNum(w, "nonelitemastercharge", row.nonMasterEliteSurcharge);
    n++;
  }
  if (n) applied.push(`warranty prices (${n})`);
  let hw = 0;
  for (const r of rowsOf(m, "lookuphighwindcharges")) {
    const term = attrNum(r, "val0");
    const band = MAX_WIND_OPTIONS.find((o) => o.value === attrNum(r, "val1"))?.band;
    const row = band
      ? out.highWind.find((x) => x.termYears === term && x.windBand === band)
      : undefined;
    if (!row) continue;
    row.mechPerSqFt = attrNum(r, "val2", row.mechPerSqFt);
    row.adheredPerSqFt = attrNum(r, "val3", row.adheredPerSqFt);
    hw++;
  }
  if (hw) applied.push(`high-wind upcharges (${hw})`);
  return { warranty: out, applied };
}
