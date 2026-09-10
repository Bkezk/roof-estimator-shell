/**
 * Accessories tab — the complete legacy money path, transcribed IL-exact from
 * docs/legacy-money-parity.md §12 (frmAccTerminations / frmAccFasteners / frmAccessory1/2/5 +
 * DataAccess.dll). Nothing here is inferred from behavior; every formula cites its §12 section.
 *
 * Billing route (§12.1): TotalCost → dMaterial[4] (inside M0); ManHours → CREW-rate direct labor
 * (LaborSubtotal1). Fasteners, Panduit, Sealants and Adhesives carry NO labor.
 *
 * Legacy quirks are transcribed as-is (parity mandate), each marked "LEGACY QUIRK":
 *  - Term Bar base footage is in Cost but excluded from Fasteners and from the BILLED hours
 *    (the labor-link seed includes it) — §12.2.
 *  - "Peel Stop" rows are dead UI (always 0) — §12.2.
 *  - Hours are billed unrounded through the footer; displays round to 2dp — §12.0.
 *  - Adhesive cost rounds to whole dollars per adhesive — §12.4 (applied in bid-builder).
 *
 * FLAGGED (capture gaps, not fabricated — see docs §12.7):
 *  - Two-Piece (Base & Snap) PRICES are uncaptured → ref rows carry 0 and a `priced:false` flag.
 *  - ref_GenericEdge UsePreDrill flags are uncaptured → the UsePreDrill=false labor branch is
 *    used for every part (the captured labor screens carry only the no-drill rate).
 *  - Stripping (Membrane Accs id 3) prices come from lookup category 5 (uncaptured) → $0 rows.
 *  - Pitch Pocket Filler CalcQty needs the RefID→part mapping + PitchPan.FillerAmount → left 0.
 *  - Generic-edge parapet drill split reads ref_DeckTypes.Predrill via the §12.2 parapet-index
 *    quirk (flags uncaptured) → parapet footage routes to the no-drill accumulator.
 */

import { bankersRound } from "./rounding";
import type { BidSectionInput, ParapetInput, CurbInput } from "./bid-builder";
import { sectionLayers } from "./bid-builder";
import { perimeterFromEdges } from "./edges";
import {
  dlRowStyleFastenersField,
  dlRowStyleFastenersPerim,
} from "./membrane-fasteners";
import { insulationFasteners, parapetDeckFasteners } from "./consumption";

/* ------------------------------------------------------------------------------------------------
 * Shared primitives (§12.0)
 * ---------------------------------------------------------------------------------------------- */

/** `DACommon.RoundToNextTen` (§12.0): 0 → 0; else Ceil up to the next multiple of 10. */
export const roundToNextTen = (x: number): number => (x <= 0 ? 0 : Math.ceil(x / 10) * 10);

/** The legacy `ldc.r4 1.03` single-precision scrap factor (1.0299999713897705). */
export const F32_SCRAP = Math.fround(1.03);

const round = (x: number, dp: number): number => bankersRound(x, dp);

/** Legacy Convert.ToInt32 — banker's round to a whole number. */
const toInt32 = (x: number): number => bankersRound(x, 0);

/** Colour fold (§12.2): Tan/Terra Cotta → Tan bar; Gray/Dark Gray/Rock Ply → Gray; White → White. */
export type TermColor = "White" | "Tan" | "Gray";
export const TERM_COLORS: TermColor[] = ["White", "Tan", "Gray"];
export function foldColor(color: string): TermColor {
  const c = color.trim().toLowerCase();
  if (c === "tan" || c === "terra cotta" || c === "terracotta") return "Tan";
  if (c === "white") return "White";
  return "Gray"; // Gray, Dark Gray, Rock Ply (and any unknown colour buys gray)
}

/** Termination label (edges.ts TERMINATION_OPTIONS) → legacy termination id (§12.2). */
export const TERMINATION_ID_BY_LABEL: Record<string, number> = {
  "T-Bar": 2,
  '1-3/4" Fascia': 3,
  '4" Fascia': 4,
  '2" Gravel Stop': 5,
  '4" Gravel Stop': 9,
  '2" Drip Edge': 6,
  '4" Drip Edge': 10,
  '3" 2-pc Metal': 11,
  '4" 2-pc Metal': 7,
  '5" 2-pc Metal': 12,
  '6" 2-pc Metal': 8,
  '7" 2-pc Metal': 13,
  '8" 2-pc Metal': 14,
};

/* ------------------------------------------------------------------------------------------------
 * Ref data (built from the admin snapshot — adapters.buildAccessoryRefData)
 * ---------------------------------------------------------------------------------------------- */

export interface FasciaSizeRef {
  barPricePerFt: number;
  vinylCoverPrice: Record<TermColor, number>;
  metalCoverPrice: number;
  insideCornerPrice: number;
  outsideCornerPrice: number;
  preDrillLaborPerFt: number;
  noDrillLaborPerFt: number;
}

/** One generic-edge part (bar / clip / corner / cover / IC / OC) with per-colour prices. */
export interface EdgePartRef {
  priceByColor: Record<TermColor, number>;
  /** Labor $/ft (bar, clips, cover) or hours/piece (corners) — accessory_labor rows. */
  laborFactor: number;
}

export interface EdgeSizeRef {
  bar: EdgePartRef;
  clip?: EdgePartRef;
  corner?: EdgePartRef;
  cover?: EdgePartRef;
  insideCorner?: EdgePartRef;
  outsideCorner?: EdgePartRef;
}

export type SnapSize = "3" | "4" | "5" | "6" | "7" | "8";
export const SNAP_SIZES: SnapSize[] = ["3", "4", "5", "6", "7", "8"];
/** Two-piece termination ids by size (§12.2: 0→7=4", 1→8=6", 2→11=3", 3→12=5", 4→13=7", 5→14=8"). */
export const SNAP_TERMINATION_ID: Record<SnapSize, number> = {
  "3": 11,
  "4": 7,
  "5": 12,
  "6": 8,
  "7": 13,
  "8": 14,
};
/** §12.2 fastener densities per 10 ft: sizes 4"/3"/5" → 42; 6"/7"/8" → 63. */
export const SNAP_FASTENERS_PER_10FT: Record<SnapSize, number> = {
  "3": 42,
  "4": 42,
  "5": 42,
  "6": 63,
  "7": 63,
  "8": 63,
};

export interface TwoPieceSizeRef {
  pricePerFt: number;
  coverPrice: number;
  insideCornerPrice: number;
  outsideCornerPrice: number;
  laborPerFt: number; // 0.043 h/ft
  cornerLaborPerPiece: number; // 0.2 h/pc
  /** False while the ref_TwoPieceMetal prices are uncaptured (material bills $0, flagged). */
  priced: boolean;
}

export interface CornerRowRef {
  description: string;
  priceByColor: Record<string, number>; // full 6-colour columns (not folded)
  hours: number;
}

export interface PipeStackSizeRef {
  size: number; // inches
  label: string; // e.g. `1"` / `1.5"`
  priceByColor: Record<string, number>; // White (base "Price") + colour columns
  closedOnly: boolean;
}

export interface AccessoryRefData {
  termBars: Record<TermColor, { pricePerFt: number }>;
  termBarLabor: { preDrillPerFt: number; noDrillPerFt: number };
  fascia: Record<"3" | "4", FasciaSizeRef>;
  dripEdge: Record<"2" | "4", EdgeSizeRef>;
  gravelStop: Record<"2" | "4", EdgeSizeRef>;
  twoPiece: Record<SnapSize, TwoPieceSizeRef>;
  corners: CornerRowRef[];
  pipeStackSizes: PipeStackSizeRef[];
  pipeStackUsages: Array<{ name: string; laborFactor: number }>;
  washers: Array<{ description: string; price: number; hours: number }>;
  drainBoots: Array<{ description: string; price: number; hours: number }>;
  drainRings: Array<{ description: string; price: number }>;
  drainRoofTypes: Array<{ name: string; cleanupHours: number; reinstallHours: number }>;
  strainers: Array<{ description: string; price: number; hours: number }>;
  walkPads: Array<{ description: string; price: number; hours: number }>;
  panduit: Array<{
    description: string;
    pricePerPart: number;
    partsPerBag: number;
    lengthIn: number | null; // 14 / 20 / null (tool)
  }>;
  sealants: Array<{ description: string; part: string; price: number }>;
  membraneAccs: {
    arp?: { pricePerPack: number; partsPerPack: number };
    tPatch?: { pricePerPack: number; partsPerPack: number };
    arpHours: number; // 0 (link shows no %)
    tPatchHours: number; // 0.1
    strippingHoursPerFt: number; // 0.04 (deck multiplier pending capture)
  };
  vents: Array<{ color: string; price: number }>;
  ventLaborHours: number; // 0.5
  /** Full fastener catalog (Fasteners & Bits): key = `${description}|${subtype}`. */
  fasteners: Array<{
    key: string;
    description: string;
    subtype: string;
    part: string;
    boxPrice: number;
    perBox: number;
  }>;
}

export const fastenerKey = (description: string, subtype: string): string =>
  `${description}|${subtype}`;

/* ------------------------------------------------------------------------------------------------
 * Fastener slot model (§12.5: m_iQuantity[14])
 * ---------------------------------------------------------------------------------------------- */

/** The seven edge groups (slots 0–6) + the six deck buckets (slots 8–13). */
export type FastenerSlot =
  | "termBar" // 0
  | "parapet" // 1
  | "fascia3" // 2
  | "fascia4" // 3
  | "dripEdge" // 4
  | "gravelStop" // 5
  | "snapCover" // 6
  | "wood" // 8
  | "metal" // 9
  | "gypsum" // 10
  | "concrete" // 11
  | "lwConcrete" // 12
  | "lwSteel"; // 13

export type DeckBucket = "wood" | "metal" | "gypsum" | "concrete" | "lwConcrete" | "lwSteel";
export const DECK_BUCKETS: DeckBucket[] = [
  "wood",
  "metal",
  "gypsum",
  "concrete",
  "lwConcrete",
  "lwSteel",
];

/** Labor-deck name → §12.5 bucket (deck id → bucket: 1→Wood; 2,3,10→Metal; 5,8,9→Gypsum; …). */
export const BUCKET_BY_DECK: Record<string, DeckBucket> = {
  Wood: "wood",
  Steel: "metal",
  Retrofit: "metal",
  Purlin: "metal",
  Gypsum: "gypsum",
  Tectum: "gypsum",
  "LWC/Other": "gypsum",
  Concrete: "concrete",
  "LWC/Concrete": "lwConcrete",
  "LWC/Steel": "lwSteel",
};

/**
 * §2.6/§12.5 allowed screw subtypes per bucket (lower-cased). Stated bucket-keyed here (the same
 * data as consumption.SCREW_SUBTYPES_BY_DECK, which stays deck-keyed) — a literal rather than a
 * derivation to avoid a module-init cycle through bid-builder.
 */
export const SCREW_SUBTYPES_BY_BUCKET: Record<DeckBucket, string[]> = {
  wood: ["drill point", "spade", "xhd"],
  metal: ["drill point", "spade", "purlin", "xhd"],
  gypsum: ["ntb", "auger"],
  concrete: ["concrete screw", "nail"],
  lwConcrete: ["concrete screw", "nail", "ntb", "auger"],
  lwSteel: ["drill point", "spade", "purlin", "xhd"],
};

/** Special plate rows (§12.5 / §2.6): matched by exact catalog description within DL-Plates. */
export const PLATE_ROWS = {
  poly: fastenerKey('2" Poly Plates', "DL-Plates"), // ID 255
  steel: fastenerKey('3" Square Steel', "DL-Plates"), // ID 256 (parapet wall-tab plates)
  insulation: fastenerKey('3" Insulation Plates', "DL-Plates"), // ID 257
  induction: fastenerKey("Induction Welding Plates", "DL-Plates"), // ID 303
} as const;

/**
 * Edge-screen fastener groups (ref_FastenersSubgroups For* flags) — SEEDED FROM THE CAPTURED
 * LEGACY SCREENS (each screen's visible grid rows, photographed from the licensed app;
 * docs §12.7 flags the DB table itself as uncaptured). Keys match the web catalog rows.
 */
const G = fastenerKey;
const EDGE_GROUP_COMMON = [
  G("Metal Anchors", ""),
  G('1 1/2"', "Collated Screws"),
  G('1 1/4"', "Hex Head"),
  G('1 1/2"', "Spade"),
  G('2"', "Spade"),
  G('2 1/2"', "Spade"),
  G('3"', "Spade"),
  G('1 5/8" #12', "Stainless"),
];
export const EDGE_FASTENER_GROUPS: Record<
  "termBar" | "fascia3" | "fascia4" | "dripEdge" | "gravelStop" | "snapCover" | "parapet",
  string[]
> = {
  termBar: EDGE_GROUP_COMMON,
  fascia3: EDGE_GROUP_COMMON,
  fascia4: EDGE_GROUP_COMMON,
  dripEdge: EDGE_GROUP_COMMON,
  gravelStop: EDGE_GROUP_COMMON,
  // Base & Snap Cover ("Compression or Snap Cover") adds 1½" Roofing Nails.
  snapCover: [
    G("Metal Anchors", ""),
    G('1 1/2"', "Collated Screws"),
    G('1 1/4"', "Hex Head"),
    G('1 1/2"', "Roofing Nails"),
    G('1 1/2"', "Spade"),
    G('2"', "Spade"),
    G('2 1/2"', "Spade"),
    G('3"', "Spade"),
    G('1 5/8" #12', "Stainless"),
  ],
  // Parapet Wall-Tabs: no collated screws / roofing nails; spades run to 4".
  parapet: [
    G("Metal Anchors", ""),
    G('1 1/4"', "Hex Head"),
    G('1 1/2"', "Spade"),
    G('2"', "Spade"),
    G('2 1/2"', "Spade"),
    G('3"', "Spade"),
    G('3 1/2"', "Spade"),
    G('4"', "Spade"),
    G('1 5/8" #12', "Stainless"),
  ],
};

/* ------------------------------------------------------------------------------------------------
 * Bid-side state (all user inputs across the 21 screens)
 * ---------------------------------------------------------------------------------------------- */

export type ColorFeet = Partial<Record<TermColor, number>>;

export interface TermBarState {
  /** Additional Required (FEET) per colour per drill column (§12.1: edge Additional is feet). */
  additionalNoDrill: ColorFeet;
  additionalPreDrill: ColorFeet;
  stripMastic: boolean;
  /** Editable strip-mastic feet; absent = the computed GetTotalLength(false,false). */
  stripMasticLengthFt?: number;
  adjustNoDrillPct: number;
  adjustPreDrillPct: number;
}

export interface FasciaState {
  additionalNoDrillFt: number;
  additionalPreDrillFt: number;
  stripMastic: boolean;
  stripMasticLengthFt?: number;
  vinylCovers: { on: boolean; qty: ColorFeet };
  metalCovers: { on: boolean; qty: ColorFeet; inside: number; outside: number };
  adjustNoDrillPct: number;
  adjustPreDrillPct: number;
}

export interface GenericEdgeSizeState {
  /** Additional Required per colour (FEET). */
  extraFt: ColorFeet;
  /** Corner pieces per colour. */
  corners: ColorFeet;
  /** Gravel stop only: Metal Cover pieces per colour + inside/outside corner pieces. */
  coverQty?: ColorFeet;
  insideCorners?: number;
  outsideCorners?: number;
  adjustPct: number;
}

export interface SnapSizeState {
  additionalFt: number;
  coversOn: boolean;
  /** Cover feet; absent while coversOn = prefill GetTotalLength (editable). */
  coversQty?: number;
  insideCorners: number;
  outsideCorners: number;
  adjustPct: number;
}

export interface PipeStackEntry {
  id: string;
  usage: string; // ref_StackUses name ("Plumbing" | "Hot Stack" | "Pitch Pan")
  color: string;
  open: boolean;
  size: number; // inches
  quantity: number;
  adjustPct: number;
}

export interface DrainEntry {
  id: string;
  quantity: number;
  roofType: string; // ref_DrainRoofTypes name
  reuseRings: boolean;
  bootSize: string; // boot Description
  ringSize: string; // ring Description
  adjustPct: number;
}

export interface AccessoriesState {
  termBar: TermBarState;
  fascia: Record<"3" | "4", FasciaState>;
  dripEdge: Record<"2" | "4", GenericEdgeSizeState>;
  gravelStop: Record<"2" | "4", GenericEdgeSizeState>;
  snapCover: Record<SnapSize, SnapSizeState>;
  /** Corners: qty per row description per COLOUR (unfolded — the 6 catalog colour columns). */
  corners: { qty: Record<string, Record<string, number>>; adjustPct: number };
  pipeStacks: PipeStackEntry[];
  washers: { qty: Record<string, number>; adjustPct: number };
  drains: DrainEntry[];
  strainers: { qty: Record<string, number>; adjustPct: number };
  walkPads: { qty: Record<string, number>; adjustPct: number };
  /** Panduit extra units per row description. */
  panduitExtra: Record<string, number>;
  /** Sealant extra units per part number; showDiscontinued mirrors the legacy checkbox. */
  sealants: { extra: Record<string, number>; showDiscontinued: boolean };
  membraneAccs: {
    arpExtra: number;
    tPatchExtra: number;
    tPatchAdjustPct: number;
    /** Stripping feet per section id (derived rows; user-entered quantities). */
    strippingFtBySection: Record<string, number>;
    strippingAdjustPct: number;
  };
  /** Vents: user DELTA per colour (calc is derived; total = calc + delta, floored at 0). */
  vents: { delta: Record<string, number>; adjustPct: number };
  /** Adhesive EXTRA whole units per adhesive name (§12.4 — joins the bid-builder aggregate). */
  adhesivesExtra: Record<string, number>;
  /** Entered fastener quantities: slot → (fastener key → qty). Covers all screens' grids. */
  fastenerQty: Partial<Record<FastenerSlot, Record<string, number>>>;
}

export function emptyAccessoriesState(): AccessoriesState {
  const edgeSize = (): GenericEdgeSizeState => ({ extraFt: {}, corners: {}, adjustPct: 0 });
  const snap = (): SnapSizeState => ({
    additionalFt: 0,
    coversOn: false,
    insideCorners: 0,
    outsideCorners: 0,
    adjustPct: 0,
  });
  const fascia = (): FasciaState => ({
    additionalNoDrillFt: 0,
    additionalPreDrillFt: 0,
    stripMastic: false,
    vinylCovers: { on: false, qty: {} },
    metalCovers: { on: false, qty: {}, inside: 0, outside: 0 },
    adjustNoDrillPct: 0,
    adjustPreDrillPct: 0,
  });
  return {
    termBar: {
      additionalNoDrill: {},
      additionalPreDrill: {},
      stripMastic: false,
      adjustNoDrillPct: 0,
      adjustPreDrillPct: 0,
    },
    fascia: { "3": fascia(), "4": fascia() },
    dripEdge: { "2": edgeSize(), "4": edgeSize() },
    gravelStop: {
      "2": { ...edgeSize(), coverQty: {}, insideCorners: 0, outsideCorners: 0 },
      "4": { ...edgeSize(), coverQty: {}, insideCorners: 0, outsideCorners: 0 },
    },
    snapCover: { "3": snap(), "4": snap(), "5": snap(), "6": snap(), "7": snap(), "8": snap() },
    corners: { qty: {}, adjustPct: 0 },
    pipeStacks: [],
    washers: { qty: {}, adjustPct: 0 },
    drains: [],
    strainers: { qty: {}, adjustPct: 0 },
    walkPads: { qty: {}, adjustPct: 0 },
    panduitExtra: {},
    sealants: { extra: {}, showDiscontinued: false },
    membraneAccs: {
      arpExtra: 0,
      tPatchExtra: 0,
      tPatchAdjustPct: 0,
      strippingFtBySection: {},
      strippingAdjustPct: 0,
    },
    vents: { delta: {}, adjustPct: 0 },
    adhesivesExtra: {},
    fastenerQty: {},
  };
}

/** Fill later-added fields on a saved state (snapshot-drift protection — same class as admin). */
export function normalizeAccessoriesState(s: Partial<AccessoriesState> | undefined | null): AccessoriesState {
  const empty = emptyAccessoriesState();
  if (!s) return empty;
  return {
    termBar: { ...empty.termBar, ...(s.termBar ?? {}) },
    fascia: {
      "3": { ...empty.fascia["3"], ...(s.fascia?.["3"] ?? {}) },
      "4": { ...empty.fascia["4"], ...(s.fascia?.["4"] ?? {}) },
    },
    dripEdge: {
      "2": { ...empty.dripEdge["2"], ...(s.dripEdge?.["2"] ?? {}) },
      "4": { ...empty.dripEdge["4"], ...(s.dripEdge?.["4"] ?? {}) },
    },
    gravelStop: {
      "2": { ...empty.gravelStop["2"], ...(s.gravelStop?.["2"] ?? {}) },
      "4": { ...empty.gravelStop["4"], ...(s.gravelStop?.["4"] ?? {}) },
    },
    snapCover: Object.fromEntries(
      SNAP_SIZES.map((k) => [k, { ...empty.snapCover[k], ...(s.snapCover?.[k] ?? {}) }]),
    ) as Record<SnapSize, SnapSizeState>,
    corners: { ...empty.corners, ...(s.corners ?? {}) },
    pipeStacks: s.pipeStacks ?? [],
    washers: { ...empty.washers, ...(s.washers ?? {}) },
    drains: s.drains ?? [],
    strainers: { ...empty.strainers, ...(s.strainers ?? {}) },
    walkPads: { ...empty.walkPads, ...(s.walkPads ?? {}) },
    panduitExtra: s.panduitExtra ?? {},
    sealants: { ...empty.sealants, ...(s.sealants ?? {}) },
    membraneAccs: { ...empty.membraneAccs, ...(s.membraneAccs ?? {}) },
    vents: { ...empty.vents, ...(s.vents ?? {}) },
    adhesivesExtra: s.adhesivesExtra ?? {},
    fastenerQty: s.fastenerQty ?? {},
  };
}

/**
 * §8.5 Parapets.EdgeFasteners (wall-tab fasteners), summed across walls — feeds the Parapet
 * Wall-Tabs "Fasteners Needed" / "Steel Plates Needed" counts (display; money bills only what
 * is typed). The Duro-Last branch needs the intermediate-tab count model (CalcTabCount /
 * TabCount) which §8.5 leaves under-specified — those walls contribute 0 and raise a warning
 * (docs §12.8 open question) rather than a fabricated count.
 */
export function parapetEdgeFastenersCount(
  parapets: ParapetInput[],
  roofSystem: string,
  attachment: "mechanical" | "adhered",
  warnings?: string[],
): number {
  const in2Ft = (i: number): number => bankersRound(i / 12, 2);
  let total = 0;
  let flaggedDuroLast = false;
  for (const p of parapets) {
    if (p.lengthFt <= 0) continue;
    const pieces = p.pieces ?? 1;
    const adjLen = pieces >= 1 ? p.lengthFt + 1 + pieces : 0;
    const girth =
      p.skirtInches !== undefined ||
      p.cantInches !== undefined ||
      p.verticalInches !== undefined ||
      p.wallTopInches !== undefined ||
      p.dropInches !== undefined
        ? (p.skirtInches ?? 0) +
          (p.cantInches ?? 0) +
          (p.verticalInches ?? 0) +
          (p.wallTopInches ?? 0) +
          (p.dropInches ?? 0)
        : p.girthInches;
    const adjHeight = Math.ceil(girth);
    const vertical = p.verticalInches ?? girth;
    const cant = p.cantInches ?? 0;
    if (roofSystem === "Duro-Last" || roofSystem === "Duro-Roof") {
      if (vertical <= 30) continue; // durolast: vert ≤ 30 → 0
      flaggedDuroLast = true; // CalcTabCount / TabCount model uncaptured
    } else if (roofSystem === "Duro-Tuff") {
      total +=
        attachment === "mechanical"
          ? bankersRound((Math.ceil(adjHeight / 24) * adjLen) / in2Ft(15), 0)
          : bankersRound(((Math.floor(cant + vertical) / 60) * adjLen) / in2Ft(15), 0);
    } else if (roofSystem === "Duro-Bond") {
      total += bankersRound((adjLen / 1.5) * (adjHeight / 2), 0);
    } else if (roofSystem === "Duro-Fleece") {
      total += bankersRound((((cant + vertical) / 60) * adjLen) / in2Ft(15), 0);
    }
  }
  if (flaggedDuroLast && warnings) {
    warnings.push(
      "Parapet wall-tab fastener count: the Duro-Last tab-count model (§8.5 CalcTabCount) is not yet extracted — walls over 30\" vertical show 0 needed (entered fasteners still bill).",
    );
  }
  return total;
}

/* ------------------------------------------------------------------------------------------------
 * Geometry feeds (§12.2 length pipeline)
 * ---------------------------------------------------------------------------------------------- */

interface GeoInputs {
  sections: BidSectionInput[];
  parapets: ParapetInput[];
  curbs: CurbInput[];
  roofSystem: string;
  attachment: "mechanical" | "adhered";
  /** Bid default colour (first section's) — colours curbs/parapets that carry none. */
  defaultColor: string;
}

/** Per-side roof-edge feet for one termination id, folded by colour (ToInt32 each side). */
function roofEdgeFeetByColor(sections: BidSectionInput[], termId: number): Record<TermColor, number> {
  const out: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  for (const s of sections) {
    for (const e of s.edges ?? []) {
      if ((TERMINATION_ID_BY_LABEL[e.termination] ?? 0) === termId && e.lengthFt > 0) {
        out[foldColor(s.color)] += toInt32(e.lengthFt);
      }
    }
  }
  return out;
}

/** Curb footage (§12.2): Round((2A + 2B + 12)/12 × qty, 4) ft per curb with the given options. */
function curbFeetByColor(
  curbs: CurbInput[],
  termOptions: number[],
  defaultColor: string,
): Record<TermColor, number> {
  const out: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  for (const c of curbs) {
    if (termOptions.includes(c.termOption ?? 0) && c.quantity > 0) {
      const ft = round(((2 * c.widthIn + 2 * c.lengthIn + 12) / 12) * c.quantity, 4);
      out[foldColor(c.color ?? defaultColor)] += ft;
    }
  }
  return out;
}

/** Parapet termination feet (ToInt32(TermLength)); split by WallType 1 → no-drill (§12.2). */
function parapetFeetByColor(
  parapets: ParapetInput[],
  termId: number,
  defaultColor: string,
): { noDrill: Record<TermColor, number>; preDrill: Record<TermColor, number> } {
  const noDrill: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  const preDrill: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  for (const p of parapets) {
    if ((p.termOptionId ?? 0) === termId) {
      const ft = toInt32(p.termLengthFt ?? p.lengthFt);
      if (ft <= 0) continue;
      const col = foldColor(p.color ?? defaultColor);
      if ((p.wallType ?? 1) === 1) noDrill[col] += ft;
      else preDrill[col] += ft;
    }
  }
  return { noDrill, preDrill };
}

const sumColors = (r: Record<TermColor, number>): number => r.White + r.Tan + r.Gray;
const colorVal = (r: ColorFeet | undefined, c: TermColor): number => r?.[c] ?? 0;

/* ------------------------------------------------------------------------------------------------
 * Results
 * ---------------------------------------------------------------------------------------------- */

export interface EdgeScreenCounts {
  roofEdgesFt: number;
  parapetsFt: number;
  curbsFt?: number | undefined;
}

export interface TermBarResult {
  counts: EdgeScreenCounts;
  /** Per colour calc feet by drill split (the W/T/G Calculated boxes). */
  noDrillByColor: Record<TermColor, number>;
  preDrillByColor: Record<TermColor, number>;
  /** Base term bar (white, §12.2) per drill split. */
  baseNoDrillFt: number;
  basePreDrillFt: number;
  subTotalNoDrill: number;
  subTotalPreDrill: number;
  adjTotalLengthFt: number;
  fastenersNeeded: number;
  cost: number;
  billedHours: number; // excludes base footage (LEGACY QUIRK)
  linkBaseHours: { noDrill: number; preDrill: number }; // includes base footage (link seed)
  stripMasticDefaultFt: number;
  stripMasticFt: number; // R10(1.03f × entered/default) — feeds Sealants
}

export interface FasciaResult {
  counts: EdgeScreenCounts;
  noDrillFt: number;
  preDrillFt: number;
  totalLengthFt: number; // R10(1.03f × (calc + otherND + otherD))
  byColor: Record<TermColor, number>; // GetTotalLengthByColor (White includes Additionals)
  vinylPrefill: Record<TermColor, number>;
  metalPrefillWhite: number;
  vinylQty: Record<TermColor, number>; // effective (entered or prefill when on)
  metalQty: Record<TermColor, number>;
  fastenersNeeded: number;
  cost: number;
  billedHours: number;
  stripMasticFt: number;
  /** Cover feet per colour (vinyl + metal) — feeds the Duro-Caulk colour tubes (§2.5). */
  coverFtByColor: Record<TermColor, number>;
}

export interface GenericEdgeSizeResult {
  calcByColor: Record<TermColor, number>; // roof + parapet feet ("Calculated Total")
  lengthWithScrapByColor: Record<TermColor, number>;
  adjTotalLengthFt: number;
  cost: number;
  hours: number;
}

export interface GenericEdgeGroupResult {
  counts: EdgeScreenCounts;
  sizes: Record<"2" | "4", GenericEdgeSizeResult>;
  fastenersNeeded: number; // group total (both sizes)
  cost: number;
  billedHours: number;
}

export interface SnapSizeResult {
  calcFt: number;
  totalLengthFt: number;
  coversQty: number;
  fastenersNeeded: number;
  cost: number;
  hours: number;
}

export interface SimpleScreenResult {
  cost: number;
  hours: number;
}

export interface DeckBucketNeeds {
  fasteners: number;
  polyPlates: number;
  insulPlates: number;
  inductionPlates: number;
}

export interface FastenerRowTotal {
  key: string;
  totalQty: number;
  boxes: number;
  cost: number;
}

export interface AccessoriesResult {
  totalCost: number;
  manHours: number; // billed, unrounded (LEGACY: footer bills unrounded hours)
  termBar: TermBarResult;
  fascia: Record<"3" | "4", FasciaResult>;
  dripEdge: GenericEdgeGroupResult;
  gravelStop: GenericEdgeGroupResult;
  snapCover: {
    sizes: Record<SnapSize, SnapSizeResult>;
    countsBySize: Record<SnapSize, EdgeScreenCounts>;
    fastenersNeeded: number;
    cost: number;
    billedHours: number;
  };
  corners: SimpleScreenResult;
  pipeStacks: SimpleScreenResult & {
    perStackHours: Record<string, number>;
    panduit14: number;
    panduit20: number;
    sealantTubesByColor: Record<TermColor, number>;
  };
  washers: SimpleScreenResult;
  drains: SimpleScreenResult & { perDrainHours: Record<string, number> };
  strainers: SimpleScreenResult;
  walkPads: SimpleScreenResult;
  panduit: { cost: number; calcByLength: Record<string, number>; boxesByRow: Record<string, number> };
  sealants: { cost: number; calcByPart: Record<string, number> };
  membraneAccs: SimpleScreenResult & { tPatchCalc: number; arpCost: number };
  vents: SimpleScreenResult & { calcByColor: Record<string, number> };
  fasteners: { cost: number; rows: FastenerRowTotal[] };
  parapetTabs: { fastenersNeeded: number; steelPlatesNeeded: number };
  deckNeeds: Record<DeckBucket, DeckBucketNeeds>;
  warnings: string[];
}

/* ------------------------------------------------------------------------------------------------
 * The compute
 * ---------------------------------------------------------------------------------------------- */

export interface ComputeAccessoriesArgs {
  state: AccessoriesState;
  ref: AccessoryRefData;
  sections: BidSectionInput[];
  parapets: ParapetInput[];
  curbs: CurbInput[];
  roofSystem: string;
  attachment: "mechanical" | "adhered";
  /** §8.6 section+parapet ARP sq ft calc (already billed via the MembraneAccs ARP row). */
  arpCalcSqFt: number;
  /** §8.5 Parapets.EdgeFasteners total (wall-tab fasteners) — feeds slot 1 needs. */
  parapetEdgeFasteners: number;
}

const adj = (pct: number): number => 1 + (pct || 0) / 100;

export function computeAccessories(args: ComputeAccessoriesArgs): AccessoriesResult {
  const { state: st, ref } = args;
  const warnings: string[] = [];
  const defaultColor = args.sections[0]?.color ?? "White";
  const geo: GeoInputs = {
    sections: args.sections,
    parapets: args.parapets,
    curbs: args.curbs,
    roofSystem: args.roofSystem,
    attachment: args.attachment,
    defaultColor,
  };

  /* ---------------- Term Bar (§12.2) ---------------- */
  const tbRoof = roofEdgeFeetByColor(geo.sections, 2); // no-drill
  const tbCurb = curbFeetByColor(geo.curbs, [3, 4], defaultColor); // no-drill
  const tbPara = parapetFeetByColor(geo.parapets, 2, defaultColor);
  // Base term bar (WHITE bar only): UseTermBarOnBase walls add Round(Length) ft by WallType.
  let baseND = 0;
  let basePD = 0;
  for (const p of geo.parapets) {
    if (p.useTermBarOnBase && p.lengthFt > 0) {
      const ft = round(p.lengthFt, 0);
      if ((p.wallType ?? 1) === 1) baseND += ft;
      else basePD += ft;
    }
  }
  const tbRates = ref.termBarLabor;
  let tbCost = 0;
  let tbAdjTotal = 0;
  let tbFasteners = 0;
  let tbBilledNoDrill = 0;
  let tbBilledPreDrill = 0;
  let tbLinkNoDrill = 0;
  let tbLinkPreDrill = 0;
  let tbStripDefault = 0;
  const tbNoDrillByColor: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  const tbPreDrillByColor: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  for (const c of TERM_COLORS) {
    const noDrill = tbRoof[c] + tbCurb[c] + tbPara.noDrill[c];
    const preDrill = tbPara.preDrill[c];
    tbNoDrillByColor[c] = noDrill;
    tbPreDrillByColor[c] = preDrill;
    const addlND = colorVal(st.termBar.additionalNoDrill, c);
    const addlPD = colorVal(st.termBar.additionalPreDrill, c);
    const base = c === "White" ? baseND + basePD : 0;
    const lenWith = roundToNextTen(F32_SCRAP * (noDrill + preDrill + base + addlND + addlPD));
    const lenWithout = roundToNextTen(F32_SCRAP * (noDrill + preDrill + addlND + addlPD));
    tbAdjTotal += lenWith;
    if (lenWith > 0) tbCost += lenWith * (ref.termBars[c]?.pricePerFt ?? 0);
    if (lenWithout > 0) tbFasteners += Math.ceil((lenWithout / 10) * 21);
    tbStripDefault += lenWithout;
    // Billed hours EXCLUDE base footage; the labor-link seed INCLUDES it (LEGACY QUIRK §12.2).
    const baseNDc = c === "White" ? baseND : 0;
    const basePDc = c === "White" ? basePD : 0;
    tbBilledNoDrill += round(
      roundToNextTen(F32_SCRAP * (noDrill + addlND)) *
        tbRates.noDrillPerFt *
        adj(st.termBar.adjustNoDrillPct),
      4,
    );
    tbBilledPreDrill += round(
      roundToNextTen(F32_SCRAP * (preDrill + addlPD)) *
        tbRates.preDrillPerFt *
        adj(st.termBar.adjustPreDrillPct),
      4,
    );
    tbLinkNoDrill += round(
      roundToNextTen(F32_SCRAP * (noDrill + baseNDc + addlND)) * tbRates.noDrillPerFt,
      4,
    );
    tbLinkPreDrill += round(
      roundToNextTen(F32_SCRAP * (preDrill + basePDc + addlPD)) * tbRates.preDrillPerFt,
      4,
    );
  }
  const tbHours = round(tbBilledNoDrill + tbBilledPreDrill, 2);
  const tbStripFt = st.termBar.stripMastic
    ? roundToNextTen(F32_SCRAP * (st.termBar.stripMasticLengthFt ?? tbStripDefault))
    : 0;
  const termBar: TermBarResult = {
    counts: {
      roofEdgesFt: sumColors(tbRoof),
      curbsFt: sumColors(tbCurb),
      parapetsFt: sumColors(tbPara.noDrill) + sumColors(tbPara.preDrill),
    },
    noDrillByColor: tbNoDrillByColor,
    preDrillByColor: tbPreDrillByColor,
    baseNoDrillFt: baseND,
    basePreDrillFt: basePD,
    subTotalNoDrill: roundToNextTen(
      F32_SCRAP *
        (sumColors(tbNoDrillByColor) +
          baseND +
          basePD +
          TERM_COLORS.reduce((s, c) => s + colorVal(st.termBar.additionalNoDrill, c), 0)),
    ),
    subTotalPreDrill: roundToNextTen(
      F32_SCRAP *
        (sumColors(tbPreDrillByColor) +
          TERM_COLORS.reduce((s, c) => s + colorVal(st.termBar.additionalPreDrill, c), 0)),
    ),
    adjTotalLengthFt: tbAdjTotal,
    fastenersNeeded: tbFasteners,
    cost: tbCost,
    billedHours: tbHours,
    linkBaseHours: { noDrill: tbLinkNoDrill, preDrill: tbLinkPreDrill },
    stripMasticDefaultFt: tbStripDefault,
    stripMasticFt: tbStripFt,
  };

  /* ---------------- Fascia bars (§12.2) ---------------- */
  const fasciaResult = {} as Record<"3" | "4", FasciaResult>;
  for (const size of ["3", "4"] as const) {
    const termId = size === "3" ? 3 : 4;
    const fref = ref.fascia[size];
    const fst = st.fascia[size];
    const roofBy = roofEdgeFeetByColor(geo.sections, termId); // no-drill
    const curbBy =
      size === "3" ? curbFeetByColor(geo.curbs, [1], defaultColor) : { White: 0, Tan: 0, Gray: 0 };
    const paraBy = parapetFeetByColor(geo.parapets, termId, defaultColor);
    const ndFt = sumColors(roofBy) + sumColors(curbBy) + sumColors(paraBy.noDrill);
    const pdFt = sumColors(paraBy.preDrill);
    const calc = ndFt + pdFt;
    const otherND = fst.additionalNoDrillFt || 0;
    const otherPD = fst.additionalPreDrillFt || 0;
    const totalLength = roundToNextTen(F32_SCRAP * (calc + otherND + otherPD));
    // GetTotalLengthByColor: source feet folded per colour; White adds both Additional boxes.
    const byColor: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
    for (const c of TERM_COLORS) {
      byColor[c] = roofBy[c] + curbBy[c] + paraBy.noDrill[c] + paraBy.preDrill[c];
    }
    byColor.White += otherND + otherPD;
    // Vinyl covers: prefill byColor − metalCoverLength (entered qty wins once touched).
    const metalQty: Record<TermColor, number> = {
      White: fst.metalCovers.on
        ? (fst.metalCovers.qty.White ?? Math.max(0, byColor.White - (fst.vinylCovers.qty.White ?? 0)))
        : 0,
      Tan: fst.metalCovers.on ? (fst.metalCovers.qty.Tan ?? 0) : 0,
      Gray: fst.metalCovers.on ? (fst.metalCovers.qty.Gray ?? 0) : 0,
    };
    const vinylPrefill: Record<TermColor, number> = {
      White: Math.max(0, byColor.White - metalQty.White),
      Tan: Math.max(0, byColor.Tan - metalQty.Tan),
      Gray: Math.max(0, byColor.Gray - metalQty.Gray),
    };
    const vinylQty: Record<TermColor, number> = {
      White: fst.vinylCovers.on ? (fst.vinylCovers.qty.White ?? vinylPrefill.White) : 0,
      Tan: fst.vinylCovers.on ? (fst.vinylCovers.qty.Tan ?? vinylPrefill.Tan) : 0,
      Gray: fst.vinylCovers.on ? (fst.vinylCovers.qty.Gray ?? vinylPrefill.Gray) : 0,
    };
    const vinylCost =
      roundToNextTen(vinylQty.White) * fref.vinylCoverPrice.White +
      roundToNextTen(vinylQty.Tan) * fref.vinylCoverPrice.Tan +
      roundToNextTen(vinylQty.Gray) * fref.vinylCoverPrice.Gray;
    const metalCost =
      roundToNextTen(metalQty.White + metalQty.Tan + metalQty.Gray) * fref.metalCoverPrice +
      (fst.metalCovers.on ? fst.metalCovers.inside : 0) * fref.insideCornerPrice +
      (fst.metalCovers.on ? fst.metalCovers.outside : 0) * fref.outsideCornerPrice;
    const cost = totalLength * fref.barPricePerFt + vinylCost + metalCost;
    const fasteners = totalLength > 0 ? Math.ceil((totalLength / 10) * 21) : 0;
    const hoursND = round(
      roundToNextTen(F32_SCRAP * (ndFt + otherND)) *
        fref.noDrillLaborPerFt *
        adj(fst.adjustNoDrillPct),
      4,
    );
    const hoursPD = round(
      roundToNextTen(F32_SCRAP * (pdFt + otherPD)) *
        fref.preDrillLaborPerFt *
        adj(fst.adjustPreDrillPct),
      4,
    );
    const stripFt = fst.stripMastic
      ? roundToNextTen(F32_SCRAP * (fst.stripMasticLengthFt ?? totalLength))
      : 0;
    fasciaResult[size] = {
      counts: {
        roofEdgesFt: sumColors(roofBy),
        curbsFt: size === "3" ? sumColors(curbBy) : undefined,
        parapetsFt: sumColors(paraBy.noDrill) + sumColors(paraBy.preDrill),
      },
      noDrillFt: ndFt,
      preDrillFt: pdFt,
      totalLengthFt: totalLength,
      byColor,
      vinylPrefill,
      metalPrefillWhite: Math.max(0, byColor.White - (fst.vinylCovers.qty.White ?? 0)),
      vinylQty,
      metalQty,
      fastenersNeeded: fasteners,
      cost,
      billedHours: hoursND + hoursPD,
      stripMasticFt: stripFt,
      coverFtByColor: {
        White: vinylQty.White + metalQty.White,
        Tan: vinylQty.Tan + metalQty.Tan,
        Gray: vinylQty.Gray + metalQty.Gray,
      },
    };
  }

  /* ---------------- Drip edge / gravel stop (§12.2 GenericEdges) ---------------- */
  const genericGroup = (
    group: "dripEdge" | "gravelStop",
    termIdBySize: Record<"2" | "4", number>,
    refSizes: Record<"2" | "4", EdgeSizeRef>,
  ): GenericEdgeGroupResult => {
    const sizes = {} as Record<"2" | "4", GenericEdgeSizeResult>;
    let roofTotal = 0;
    let paraTotal = 0;
    let scrapLenAll = 0;
    let cost = 0;
    let billedHours = 0;
    for (const size of ["2", "4"] as const) {
      const termId = termIdBySize[size];
      const sst = st[group][size];
      const sref = refSizes[size];
      const roofBy = roofEdgeFeetByColor(geo.sections, termId);
      const paraBy = parapetFeetByColor(geo.parapets, termId, defaultColor);
      // FLAGGED: the §12.2 parapet-index drill quirk needs ref_DeckTypes.Predrill (uncaptured);
      // with UsePreDrill=false on every captured part, all footage rides the no-drill split.
      const calcBy: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
      for (const c of TERM_COLORS) calcBy[c] = roofBy[c] + paraBy.noDrill[c] + paraBy.preDrill[c];
      roofTotal += sumColors(roofBy);
      paraTotal += sumColors(paraBy.noDrill) + sumColors(paraBy.preDrill);
      const scrapBy: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
      let barCost = 0;
      for (const c of TERM_COLORS) {
        const withScrap = roundToNextTen(
          Math.ceil(F32_SCRAP * (calcBy[c] + colorVal(sst.extraFt, c))),
        );
        scrapBy[c] = withScrap;
        barCost += withScrap * (sref.bar.priceByColor[c] ?? 0);
      }
      const sizeScrapLen = sumColors(scrapBy);
      scrapLenAll += sizeScrapLen;
      // Corners (pieces, unrounded) + gravel-stop cover / IC / OC (pieces).
      let pieceCost = 0;
      for (const c of TERM_COLORS) {
        pieceCost += colorVal(sst.corners, c) * (sref.corner?.priceByColor[c] ?? 0);
        pieceCost += colorVal(sst.coverQty, c) * (sref.cover?.priceByColor[c] ?? 0);
      }
      pieceCost += (sst.insideCorners ?? 0) * (sref.insideCorner?.priceByColor.White ?? 0);
      pieceCost += (sst.outsideCorners ?? 0) * (sref.outsideCorner?.priceByColor.White ?? 0);
      const sizeCost = barCost + pieceCost;
      // Labor (§12.2, UsePreDrill=false branch): bar = LF × R10(noDrillLen + extra); corners =
      // LF × pieces; cover = LF × R10(pieces). Group counts only when the bar length > 0.
      let sizeHours = 0;
      if (sizeScrapLen > 0) {
        const totalCalc = sumColors(calcBy);
        const totalExtra = TERM_COLORS.reduce((s, c) => s + colorVal(sst.extraFt, c), 0);
        const cornerPieces = TERM_COLORS.reduce((s, c) => s + colorVal(sst.corners, c), 0);
        const coverPieces =
          TERM_COLORS.reduce((s, c) => s + colorVal(sst.coverQty, c), 0) +
          (sst.insideCorners ?? 0) +
          (sst.outsideCorners ?? 0);
        const a = adj(sst.adjustPct);
        sizeHours += round(
          sref.bar.laborFactor * roundToNextTen(totalCalc + totalExtra) * a,
          4,
        );
        if (sref.corner) sizeHours += round(sref.corner.laborFactor * cornerPieces * a, 4);
        // Gravel-stop metal cover + its corners: corner parts (45/50) are per-piece; cover (55)
        // rides the no-drill formula on R10(pieces).
        if (sref.cover && coverPieces > 0) {
          const coverOnly = TERM_COLORS.reduce((s, c) => s + colorVal(sst.coverQty, c), 0);
          if (coverOnly > 0)
            sizeHours += round(sref.cover.laborFactor * roundToNextTen(coverOnly) * a, 4);
          if (sref.insideCorner && (sst.insideCorners ?? 0) > 0)
            sizeHours += round(sref.insideCorner.laborFactor * (sst.insideCorners ?? 0) * a, 4);
          if (sref.outsideCorner && (sst.outsideCorners ?? 0) > 0)
            sizeHours += round(sref.outsideCorner.laborFactor * (sst.outsideCorners ?? 0) * a, 4);
        }
      }
      cost += sizeCost;
      billedHours += sizeHours;
      sizes[size] = {
        calcByColor: calcBy,
        lengthWithScrapByColor: scrapBy,
        adjTotalLengthFt: sizeScrapLen,
        cost: sizeCost,
        hours: sizeHours,
      };
    }
    return {
      counts: { roofEdgesFt: roofTotal, parapetsFt: paraTotal },
      sizes,
      fastenersNeeded: scrapLenAll > 0 ? Math.ceil((scrapLenAll / 10) * 21) : 0,
      cost,
      billedHours,
    };
  };
  const dripEdge = genericGroup("dripEdge", { "2": 6, "4": 10 }, ref.dripEdge);
  const gravelStop = genericGroup("gravelStop", { "2": 5, "4": 9 }, ref.gravelStop);

  /* ---------------- Base & Snap Cover (§12.2 TwoPieceMetal) ---------------- */
  const snapSizes = {} as Record<SnapSize, SnapSizeResult>;
  const snapCounts = {} as Record<SnapSize, EdgeScreenCounts>;
  let snapFasteners = 0;
  let snapCost = 0;
  let snapHours = 0;
  let anyUnpricedSnapLength = false;
  for (const size of SNAP_SIZES) {
    const termId = SNAP_TERMINATION_ID[size];
    const sst = st.snapCover[size];
    const sref = ref.twoPiece[size];
    const roofBy = roofEdgeFeetByColor(geo.sections, termId);
    const paraBy = parapetFeetByColor(geo.parapets, termId, defaultColor);
    const roofFt = sumColors(roofBy);
    const paraFt = sumColors(paraBy.noDrill) + sumColors(paraBy.preDrill);
    const calcFt = roofFt + paraFt;
    const totalLength = roundToNextTen(F32_SCRAP * (calcFt + (sst.additionalFt || 0)));
    const coversQty = sst.coversOn ? (sst.coversQty ?? totalLength) : 0;
    const cost =
      totalLength * sref.pricePerFt +
      coversQty * sref.coverPrice +
      sst.insideCorners * sref.insideCornerPrice +
      sst.outsideCorners * sref.outsideCornerPrice;
    if (totalLength > 0 && !sref.priced) anyUnpricedSnapLength = true;
    const fasteners =
      totalLength > 0 ? Math.ceil((totalLength / 10) * SNAP_FASTENERS_PER_10FT[size]) : 0;
    const hours = round(
      round(
        totalLength * sref.laborPerFt +
          (sst.insideCorners + sst.outsideCorners) * sref.cornerLaborPerPiece,
        4,
      ) * adj(sst.adjustPct),
      4,
    );
    snapFasteners += fasteners;
    snapCost += cost;
    snapHours += hours;
    snapSizes[size] = { calcFt, totalLengthFt: totalLength, coversQty, fastenersNeeded: fasteners, cost, hours };
    snapCounts[size] = { roofEdgesFt: roofFt, parapetsFt: paraFt };
  }
  if (anyUnpricedSnapLength) {
    warnings.push(
      "Base & Snap Cover footage present but the Two-Piece Metal prices are not captured — its material bills $0 (labor still bills).",
    );
  }

  /* ---------------- Corners (§12.3) ---------------- */
  let cornersCost = 0;
  let cornersHours = 0;
  for (const row of ref.corners) {
    const qtyBy = st.corners.qty[row.description] ?? {};
    for (const [color, qty] of Object.entries(qtyBy)) {
      if (!qty) continue;
      cornersCost += qty * (row.priceByColor[color] ?? 0);
      cornersHours += row.hours * qty;
    }
  }
  cornersHours = cornersHours * adj(st.corners.adjustPct);

  /* ---------------- Pipe stacks (§12.3) ---------------- */
  let stacksCost = 0;
  let stacksHours = 0;
  const perStackHours: Record<string, number> = {};
  let panduit14 = 0;
  let panduit20 = 0;
  const stackSealantFtByColor: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  for (const ps of st.pipeStacks) {
    if (ps.quantity <= 0) continue;
    const sizeRef = ref.pipeStackSizes.find((s) => s.size === ps.size);
    const usage = ref.pipeStackUsages.find((u) => u.name === ps.usage);
    const price = sizeRef?.priceByColor[ps.color] ?? sizeRef?.priceByColor["White"] ?? 0;
    stacksCost += price * ps.quantity;
    let h = ps.quantity * (ps.open ? 1.25 : 1) * (usage?.laborFactor ?? 0);
    if (ps.size > 18) h *= 2;
    else if (ps.size > 12) h *= 1.5;
    h = h * adj(ps.adjustPct);
    perStackHours[ps.id] = h;
    stacksHours += h;
    // Consumption (§12.3): circumference c = Ceil((size + ¼)π) in; sealant ft = c/12 × qty;
    // panduit 20" straps = ⌊c/17⌋, then 14" straps = Ceil(remainder/11), each × qty.
    const c = Math.ceil((ps.size + 0.25) * Math.PI);
    stackSealantFtByColor[foldColor(ps.color)] += (c / 12) * ps.quantity;
    const n20 = Math.floor(c / 17);
    const rem = c - n20 * 17;
    const n14 = rem > 0 ? Math.ceil(rem / 11) : 0;
    panduit20 += n20 * ps.quantity;
    panduit14 += n14 * ps.quantity;
  }
  const stackTubesByColor: Record<TermColor, number> = {
    White: stackSealantFtByColor.White > 0 ? Math.ceil((stackSealantFtByColor.White * 2) / 10) : 0,
    Tan: stackSealantFtByColor.Tan > 0 ? Math.ceil((stackSealantFtByColor.Tan * 2) / 10) : 0,
    Gray: stackSealantFtByColor.Gray > 0 ? Math.ceil((stackSealantFtByColor.Gray * 2) / 10) : 0,
  };

  /* ---------------- Conduit washers (§12.3) ---------------- */
  let washersCost = 0;
  let washersHours = 0;
  let washersQtyTotal = 0;
  for (const row of ref.washers) {
    const qty = st.washers.qty[row.description] ?? 0;
    if (!qty) continue;
    washersCost += row.price * qty;
    washersHours += round(row.hours * qty, 4);
    washersQtyTotal += qty;
  }
  washersHours = washersHours * adj(st.washers.adjustPct);

  /* ---------------- Drains & strainers (§12.3) ---------------- */
  let drainsCost = 0;
  let drainsHours = 0;
  const perDrainHours: Record<string, number> = {};
  for (const d of st.drains) {
    if (d.quantity <= 0) continue;
    const boot = ref.drainBoots.find((b) => b.description === d.bootSize);
    const ring = ref.drainRings.find((r) => r.description === d.ringSize);
    const roof = ref.drainRoofTypes.find((r) => r.name === d.roofType);
    drainsCost += d.reuseRings ? 0 : d.quantity * ((boot?.price ?? 0) + (ring?.price ?? 0));
    const h =
      round(
        d.quantity *
          ((roof?.cleanupHours ?? 0) + (d.reuseRings ? (roof?.reinstallHours ?? 0) : (boot?.hours ?? 0))),
        2,
      ) * adj(d.adjustPct);
    perDrainHours[d.id] = h;
    drainsHours += h;
  }
  let strainersCost = 0;
  let strainersHours = 0;
  for (const row of ref.strainers) {
    const qty = st.strainers.qty[row.description] ?? 0;
    if (!qty) continue;
    strainersCost += row.price * qty;
    strainersHours += qty * row.hours;
  }
  strainersHours = strainersHours * adj(st.strainers.adjustPct);

  /* ---------------- Walk pads & wall vents (§12.3 AccOther) ---------------- */
  let walkCost = 0;
  let walkHours = 0;
  for (const row of ref.walkPads) {
    const qty = st.walkPads.qty[row.description] ?? 0;
    if (!qty) continue;
    walkCost += row.price * qty;
    walkHours += qty * row.hours;
  }
  walkHours = walkHours * adj(st.walkPads.adjustPct);

  /* ---------------- Panduit (§12.4) ---------------- */
  let panduitCost = 0;
  const panduitCalc: Record<string, number> = {};
  const panduitBoxes: Record<string, number> = {};
  for (const row of ref.panduit) {
    const calcQty = row.lengthIn === 14 ? panduit14 : row.lengthIn === 20 ? panduit20 : 0;
    panduitCalc[row.description] = calcQty;
    const total = calcQty + (st.panduitExtra[row.description] ?? 0);
    const boxes = total > 0 && row.partsPerBag > 0 ? Math.ceil(total / row.partsPerBag) : 0;
    panduitBoxes[row.description] = boxes;
    panduitCost += boxes * (row.partsPerBag * row.pricePerPart);
  }

  /* ---------------- Sealants (§12.4 + §2.5) ---------------- */
  // Duro-Caulk Plus colour tubes: Ceil((termBarLF_c + fasciaCoverLF_c) / 12) — 1 tube / 12 LF.
  // (The §2.5 transcription's literal text is `Ceiling(x)/12`; whole tubes per the stated rule —
  // operator order flagged in docs §12.8 open questions.)
  const caulkByColor: Record<TermColor, number> = { White: 0, Tan: 0, Gray: 0 };
  for (const c of TERM_COLORS) {
    const barLf = tbNoDrillByColor[c] + tbPreDrillByColor[c] + colorVal(st.termBar.additionalNoDrill, c) + colorVal(st.termBar.additionalPreDrill, c);
    const coverLf = fasciaResult["3"].coverFtByColor[c] + fasciaResult["4"].coverFtByColor[c];
    const lf = barLf + coverLf;
    caulkByColor[c] = lf > 0 ? Math.ceil(lf / 12) : 0;
    // Pipe-stack tubes join the same colour rows (§2.5).
    caulkByColor[c] += stackTubesByColor[c];
  }
  // Drains: +1 tube per drain into the index-2 colour bucket (§2.5 — colour ids Tan 1 / Gray 2 /
  // White 3 → Gray); washers: +Ceil(0.25 × qty) into the same bucket.
  const drainCount = st.drains.reduce((s, d) => s + Math.max(0, d.quantity), 0);
  caulkByColor.Gray += drainCount + (washersQtyTotal > 0 ? Math.ceil(0.25 * washersQtyTotal) : 0);
  // Strip mastic: rolls = Ceil(totalFt / 350) — term bar + both fascia bars (§2.5).
  const stripFtTotal = tbStripFt + fasciaResult["3"].stripMasticFt + fasciaResult["4"].stripMasticFt;
  const stripRolls = stripFtTotal > 0 ? Math.ceil(stripFtTotal / 350) : 0;
  // Duro-Roof seam sealant (RefID 19 → "Tab Sealer") — §2.5: over Duro-Roof sections only.
  let tabSealer = 0;
  if (args.roofSystem === "Duro-Roof") {
    let seamLf = 0;
    for (const s of args.sections) {
      if (s.fieldLap > 0) seamLf += (s.width / (s.fieldLap / 12)) * s.length;
      const perimLen = s.edges?.length ? perimeterFromEdges(s.edges) : s.perimLengthFt;
      if (s.perimFastenerOc > 0 && s.enhancementWidthFt > 0) {
        seamLf += (s.enhancementWidthFt / (s.perimFastenerOc / 12)) * (perimLen + s.cornerLengthFt);
      }
    }
    tabSealer = round(seamLf / 30 / 5, 0);
  }
  const sealantCalcByPart: Record<string, number> = {
    "1136": caulkByColor.White, // Duro-Caulk Plus - White
    "1138": caulkByColor.Tan, // Duro-Caulk Plus - Tan
    "1134": caulkByColor.Gray, // Duro-Caulk Plus - Gray
    "1129": stripRolls, // Strip Mastic (Pail)
    "1119T": tabSealer, // Tab Sealer (Duro-Roof seam sealant)
    // Pitch Pocket Filler (1121/1122): RefID→part mapping + PitchPan.FillerAmount uncaptured — 0.
  };
  let sealantsCost = 0;
  for (const row of ref.sealants) {
    const calcQty = sealantCalcByPart[row.part] ?? 0;
    const total = calcQty + (st.sealants.extra[row.part] ?? 0);
    sealantsCost += row.price * total;
  }

  /* ---------------- Membrane Accs (§12.4) ---------------- */
  const ma = ref.membraneAccs;
  let maCost = 0;
  let maHours = 0;
  let tPatchCalc = 0;
  let arpCost = 0;
  if (ma.arp) {
    const total = args.arpCalcSqFt + st.membraneAccs.arpExtra;
    if (total > 0)
      arpCost = round(ma.arp.pricePerPack * Math.ceil(total / ma.arp.partsPerPack), 2);
    maCost += arpCost;
    // ARP labor: extra qty only, rate 0, adjust −2 (no %) — stays 0 (§12.4).
    maHours += st.membraneAccs.arpExtra * ma.arpHours;
  }
  // §12.4 states T-Patch CalcQty = Σ non-Duro-Tuff sections Round(AreaTotal/250) — but the §12.0
  // anchor bid (a 55×100 section) shows Calc Qty 0 on the captured screen AND a footer without
  // the $10 a 22-patch calc would add. CONTRADICTION → calc held at 0 (extra-only billing) until
  // the decompiler session resolves AreaTotal / the Duro-Tuff filter direction (docs §12.8).
  tPatchCalc = 0;
  if (ma.tPatch) {
    const total = tPatchCalc + st.membraneAccs.tPatchExtra;
    if (total > 0)
      maCost += round(ma.tPatch.pricePerPack * Math.ceil(total / ma.tPatch.partsPerPack), 2);
    maHours += st.membraneAccs.tPatchExtra * ma.tPatchHours * adj(st.membraneAccs.tPatchAdjustPct);
  }
  // Stripping rows (per section, user-entered feet): price uncaptured (lookup cat 5) → $0 +
  // warning when used; labor = ft × 0.04 (deck multiplier pending capture — docs §12.7).
  let strippingFtTotal = 0;
  for (const ft of Object.values(st.membraneAccs.strippingFtBySection)) strippingFtTotal += ft || 0;
  if (strippingFtTotal > 0) {
    warnings.push(
      "DL stripping feet entered but the stripping price table (lookup category 5) is not captured — stripping bills labor only.",
    );
    maHours +=
      strippingFtTotal * ma.strippingHoursPerFt * adj(st.membraneAccs.strippingAdjustPct);
  }

  /* ---------------- Vents (§12.4 — derived) ---------------- */
  const ventCalcByColor: Record<string, number> = {};
  for (const s of args.sections) {
    // Mechanically-attached sections only: Ceil(L×W/1000) per section, by section colour.
    if (args.attachment === "mechanical" && s.length * s.width > 0) {
      ventCalcByColor[s.color] = (ventCalcByColor[s.color] ?? 0) + Math.ceil((s.length * s.width) / 1000);
    }
  }
  let ventsCost = 0;
  let ventsHours = 0;
  for (const v of ref.vents) {
    const calcQty = ventCalcByColor[v.color.replace(/ Vent$/, "")] ?? 0;
    const delta = st.vents.delta[v.color] ?? 0;
    const total = Math.max(0, calcQty + delta);
    if (total <= 0) continue;
    ventsCost += v.price * total;
    ventsHours += round(total * ref.ventLaborHours, 4);
  }
  ventsHours = ventsHours * adj(st.vents.adjustPct);

  /* ---------------- Fasteners (§12.5 — one box count per catalog row) ---------------- */
  let fastenersCost = 0;
  const fastenerRows: FastenerRowTotal[] = [];
  for (const row of ref.fasteners) {
    let total = 0;
    for (const slot of Object.keys(st.fastenerQty) as FastenerSlot[]) {
      total += st.fastenerQty[slot]?.[row.key] ?? 0;
    }
    if (total <= 0) continue;
    const boxes = row.perBox > 0 ? Math.ceil(total / row.perBox) : 0;
    const cost = round(boxes * row.boxPrice, 2);
    fastenersCost += cost;
    fastenerRows.push({ key: row.key, totalQty: total, boxes, cost });
  }

  /* ---------------- Items Required per deck bucket (§12.5) ---------------- */
  const deckNeeds: Record<DeckBucket, DeckBucketNeeds> = Object.fromEntries(
    DECK_BUCKETS.map((b) => [b, { fasteners: 0, polyPlates: 0, insulPlates: 0, inductionPlates: 0 }]),
  ) as Record<DeckBucket, DeckBucketNeeds>;
  const isDuroBond = args.roofSystem === "Duro-Bond";
  const membraneAdheredOrBond = args.attachment === "adhered" || isDuroBond;
  const rowStyle =
    args.attachment === "mechanical" &&
    ["Duro-Last", "Duro-Roof", "Duro-Tuff"].includes(args.roofSystem);
  for (const s of args.sections) {
    const bucket = BUCKET_BY_DECK[s.deckType];
    if (!bucket) continue;
    // mf — §2.2 row-style field + perimeter counts (Round each).
    let mf = 0;
    if (rowStyle && s.fastenerOc > 0 && s.fieldLap > 6) {
      const bySide = (side: string) => (s.edges ?? []).find((e) => e.side === side);
      const sideIsPerim = (["A", "B", "C", "D"] as const).map(
        (side) => bySide(side)?.isPerimeter ?? false,
      ) as [boolean, boolean, boolean, boolean];
      mf =
        dlRowStyleFastenersField({
          lengthFt: s.length,
          widthFt: s.width,
          fieldLapIn: s.fieldLap,
          fieldSpacingIn: s.fastenerOc,
          overlapWidthIn: 6,
          perimLapIn: -1,
          perimEnhancementWidthFt: 0,
          sideIsPerim,
          useCustomSettings: false,
          quickBid: true,
        }) +
        dlRowStyleFastenersPerim({
          fieldLapIn: s.fieldLap,
          spacingIn: s.fastenerOc,
          perimSideLengthsFt: (["A", "B", "C", "D"] as const).map(
            (side) => bySide(side)?.lengthFt ?? 0,
          ) as [number, number, number, number],
          sideIsPerim,
        });
    }
    // uf — §2.3/§10.3 underlayment fasteners across all layers; insulPlates once per MECHANICAL
    // layer (LEGACY QUIRK §12.5: two mechanical layers double the plate count).
    const roofArea = s.length * s.width;
    const perimLen = s.edges?.length ? perimeterFromEdges(s.edges) : s.perimLengthFt;
    const perimArea = Math.min(roofArea, perimLen * s.enhancementWidthFt);
    const fieldArea = Math.max(0, roofArea - perimArea);
    let uf = 0;
    let mechLayers = 0;
    for (const layer of sectionLayers(s)) {
      if (layer.attachment !== "mechanical") continue;
      mechLayers += 1;
      if (s.uCustomFastenerDensity) {
        const d = s.uCustomFastenerDensity;
        uf +=
          bankersRound(d.field * fieldArea, 0) +
          bankersRound(d.perim * perimArea, 0) +
          bankersRound(d.corner * 0, 0);
      } else {
        const fourByFour = /4'\s?x\s?4/.test(layer.board);
        uf +=
          insulationFasteners(fieldArea, { fourByFour, membraneAdheredOrBond, perimeter: false }) +
          insulationFasteners(perimArea, { fourByFour, membraneAdheredOrBond, perimeter: true });
      }
    }
    const need = deckNeeds[bucket];
    need.fasteners += mf + uf;
    if (isDuroBond) need.inductionPlates += uf;
    else need.polyPlates += mf;
    // §12.5 LEGACY QUIRK (transcribed): insulPlates += uf once PER MECHANICAL LAYER, where uf
    // already sums every layer — two mechanical layers double the plate count.
    need.insulPlates += uf * mechLayers;
  }
  // Parapet deck screws: 1/ft + 1 poly plate each into the PARAPET's deck bucket (§12.5).
  for (const p of args.parapets) {
    const bucket = BUCKET_BY_DECK[p.deckType];
    if (!bucket) continue;
    const deckF = parapetDeckFasteners(p.lengthFt);
    deckNeeds[bucket].fasteners += deckF;
    deckNeeds[bucket].polyPlates += deckF;
  }
  // Netting: minus entered rows of allowed subtypes (screws) and the special plate rows.
  const rowByKey = new Map(ref.fasteners.map((r) => [r.key, r]));
  for (const b of DECK_BUCKETS) {
    const entered = st.fastenerQty[b] ?? {};
    let screwSum = 0;
    for (const [key, qty] of Object.entries(entered)) {
      const row = rowByKey.get(key);
      if (!row || !qty) continue;
      if (SCREW_SUBTYPES_BY_BUCKET[b].includes(row.subtype.toLowerCase())) screwSum += qty;
    }
    const need = deckNeeds[b];
    need.fasteners = Math.max(0, need.fasteners - screwSum);
    need.polyPlates = Math.max(0, need.polyPlates - (entered[PLATE_ROWS.poly] ?? 0));
    need.insulPlates = Math.max(0, need.insulPlates - (entered[PLATE_ROWS.insulation] ?? 0));
    need.inductionPlates = Math.max(0, need.inductionPlates - (entered[PLATE_ROWS.induction] ?? 0));
    if (b === "gypsum") {
      // §12.5: the Gypsum bucket forces Poly and Insul. plates to 0 (auger/NTB carry their own).
      need.polyPlates = 0;
      need.insulPlates = 0;
    }
  }

  /* ---------------- Parapet Wall-Tabs & Steel Plates (§12.5) ---------------- */
  const parapetEntered = st.fastenerQty["parapet"] ?? {};
  let parapetEnteredFasteners = 0;
  for (const [key, qty] of Object.entries(parapetEntered)) {
    const row = rowByKey.get(key);
    if (!row || !qty) continue;
    if (EDGE_FASTENER_GROUPS.parapet.includes(key) && key !== PLATE_ROWS.steel)
      parapetEnteredFasteners += qty;
  }
  const parapetTabsNeeded = Math.max(0, args.parapetEdgeFasteners - parapetEnteredFasteners);
  const steelPlatesNeeded = Math.max(
    0,
    Math.max(args.parapetEdgeFasteners, parapetEnteredFasteners) -
      (parapetEntered[PLATE_ROWS.steel] ?? 0),
  );

  /* ---------------- Edge-screen Fasteners Needed (netted, §12.2) ---------------- */
  const nettedEdgeNeed = (slot: FastenerSlot, gross: number): number => {
    const entered = st.fastenerQty[slot] ?? {};
    let sum = 0;
    for (const [key, qty] of Object.entries(entered)) {
      if (key === PLATE_ROWS.steel) continue;
      sum += qty || 0;
    }
    return Math.max(0, gross - sum);
  };
  termBar.fastenersNeeded = nettedEdgeNeed("termBar", termBar.fastenersNeeded);
  fasciaResult["3"].fastenersNeeded = nettedEdgeNeed("fascia3", fasciaResult["3"].fastenersNeeded);
  fasciaResult["4"].fastenersNeeded = nettedEdgeNeed("fascia4", fasciaResult["4"].fastenersNeeded);
  dripEdge.fastenersNeeded = nettedEdgeNeed("dripEdge", dripEdge.fastenersNeeded);
  gravelStop.fastenersNeeded = nettedEdgeNeed("gravelStop", gravelStop.fastenersNeeded);
  snapFasteners = nettedEdgeNeed("snapCover", snapFasteners);

  /* ---------------- Totals (§12.1) ---------------- */
  const totalCost =
    termBar.cost +
    fasciaResult["3"].cost +
    fasciaResult["4"].cost +
    dripEdge.cost +
    gravelStop.cost +
    snapCost +
    cornersCost +
    stacksCost +
    washersCost +
    drainsCost +
    strainersCost +
    walkCost +
    panduitCost +
    sealantsCost +
    maCost +
    ventsCost +
    fastenersCost;
  const manHours =
    termBar.billedHours +
    fasciaResult["3"].billedHours +
    fasciaResult["4"].billedHours +
    dripEdge.billedHours +
    gravelStop.billedHours +
    snapHours +
    cornersHours +
    stacksHours +
    washersHours +
    drainsHours +
    strainersHours +
    walkHours +
    ventsHours +
    maHours;

  return {
    totalCost,
    manHours,
    termBar,
    fascia: fasciaResult,
    dripEdge,
    gravelStop,
    snapCover: {
      sizes: snapSizes,
      countsBySize: snapCounts,
      fastenersNeeded: snapFasteners,
      cost: snapCost,
      billedHours: snapHours,
    },
    corners: { cost: cornersCost, hours: cornersHours },
    pipeStacks: {
      cost: stacksCost,
      hours: stacksHours,
      perStackHours,
      panduit14,
      panduit20,
      sealantTubesByColor: stackTubesByColor,
    },
    washers: { cost: washersCost, hours: washersHours },
    drains: { cost: drainsCost, hours: drainsHours, perDrainHours },
    strainers: { cost: strainersCost, hours: strainersHours },
    walkPads: { cost: walkCost, hours: walkHours },
    panduit: { cost: panduitCost, calcByLength: panduitCalc, boxesByRow: panduitBoxes },
    sealants: { cost: sealantsCost, calcByPart: sealantCalcByPart },
    membraneAccs: { cost: maCost, hours: maHours, tPatchCalc, arpCost },
    vents: { cost: ventsCost, hours: ventsHours, calcByColor: ventCalcByColor },
    fasteners: { cost: fastenersCost, rows: fastenerRows },
    parapetTabs: { fastenersNeeded: parapetTabsNeeded, steelPlatesNeeded },
    deckNeeds,
    warnings,
  };
}
