/**
 * Data adapters (Phase 4g) — transform the seeded Supabase admin shapes into the engine's typed
 * inputs. Pure functions (no I/O), so they unit-test against the real stored shapes; the Supabase
 * server functions just fetch a row's `data` jsonb and pass it here.
 *
 * Covered now: the Duro-Last membrane PRICE MATRIX (from the seeded Duro-Last Membrane pricing
 * screen) and the LABOR MULTIPLIERS for a Roof Deck Labor combo (deck / on-center / tab / sheet-size
 * / thickness). The full legacy tab-multiplier set (mech_tab_multi) and the pull-test→spacing
 * table (mech_fastener_lookup) were later extracted from the shipped binaries and are wired here /
 * in fastener-spacing.ts; the combo screenshots still carry only the selected tab as `base`.
 */

import type { PriceMatrix, PriceTier, FreightStep } from "./pricing";
import type { Band, DualValue } from "./labor";
import type { SetupBandTable, InspectionBandTable } from "./quantities";

// ─────────────────────────────────────────────────────────────────────────────
// Membrane price matrix (from pricing_catalog id "duro_last:duro_last_membrane")
// ─────────────────────────────────────────────────────────────────────────────

export interface MembraneScreen {
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
}

const TIER_BY_LABEL: Record<string, PriceTier> = {
  "Roll Goods": "rollGoods",
  '28" Tabs': "tab28",
  '60" Tabs': "tab60",
  '120" Tabs': "tab120",
  Parapets: "parapet",
};

/** Parse a membrane row Description like `Duro-Last - 40mil Roll Goods` → { thickness, tier }. */
export function parseMembraneRow(
  description: string,
): { thickness: number; tier: PriceTier } | null {
  const m = /^Duro-Last - (\d+)mil (.+)$/.exec(description.trim());
  if (!m) return null; // skip Duro-Fleece / Duro-Bond / Duro-Tuff families
  const thickness = Number(m[1]);
  const tier = TIER_BY_LABEL[m[2]!.trim()];
  if (!tier) return null;
  return { thickness, tier };
}

/**
 * Build the engine PriceMatrix (thickness → tier → color → $/sqft) from the seeded Duro-Last
 * Membrane pricing screen. Non-Duro-Last-family rows and null cells are skipped.
 */
export function buildPriceMatrix(screen: MembraneScreen): PriceMatrix {
  const colors = screen.columns.filter((c) => c !== "Description");
  const matrix: PriceMatrix = {};
  for (const row of screen.rows) {
    const desc = String(row["Description"] ?? "");
    const parsed = parseMembraneRow(desc);
    if (!parsed) continue;
    const { thickness, tier } = parsed;
    const byTier = (matrix[thickness] ??= {});
    const byColor = (byTier[tier] ??= {});
    for (const color of colors) {
      const v = row[color];
      if (typeof v === "number") byColor[color] = v;
    }
  }
  return matrix;
}

/**
 * Build the underlayment $/sqft lookup by board name from the seeded Underlayment pricing screen
 * (columns "Name" / "Cost/Sq. Ft.").
 */
export function buildUnderlaymentPrices(screen: MembraneScreen): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const row of screen.rows) {
    const name = String(row["Name"] ?? "");
    const cost = row["Cost/Sq. Ft."];
    if (name && typeof cost === "number") prices[name] = cost;
  }
  return prices;
}

/** One pickable accessory item flattened from the seeded catalog screens. */
export interface AccessoryCatalogItem {
  key: string; // `${screenId}::${description}` (+ `::${variant}` when the screen is variant-priced)
  category: string;
  description: string; // includes the color/variant suffix when the screen is variant-priced
  price: number;
  /** Price-column variant (a color); "" for a plain "Price" or "Price/Box" (per-box) column. */
  variant: string;
  /** Fasteners per box (Fasteners & Bits rows) — used by the needed-quantities netting. */
  fastenersPerBox?: number;
  /** Fastener subtype (Fasteners & Bits rows) — keys the legacy §2.6 deck allow-list. */
  subtype?: string;
}

/** Columns that are never a price (identifiers, counts, sizes) even when they hold numbers. */
const NON_PRICE_COLUMNS = new Set([
  "description",
  "name",
  "part #",
  "size",
  "subtype",
  "open part #",
  "closed part #",
  "fasteners/box",
  "multiplier",
]);

/** Bare color-named price columns seen in the seeded catalog. */
const KNOWN_COLORS = new Set([
  "White",
  "Tan",
  "Gray",
  "Dark Gray",
  "Terra Cotta",
  "Rock Ply",
  "Rock-Ply",
]);

/**
 * Derive a price column's variant label from its name, or null if the column isn't a price column.
 * `Price` / `Price/Box` → "" (base, no suffix); `White Price` → "White"; a bare known color → itself.
 * This keys off column NAMES and value types in the seeded admin data — not model/user prose.
 */
function priceColumnVariant(col: string): string | null {
  const c = col.trim();
  if (NON_PRICE_COLUMNS.has(c.toLowerCase())) return null;
  if (c === "Price" || c === "Price/Box") return "";
  if (/ Price$/i.test(c)) return c.replace(/ Price$/i, "").trim();
  if (KNOWN_COLORS.has(c)) return c;
  return null;
}

/**
 * Flatten seeded pricing_catalog screens into a pickable accessory list. Handles plain single-"Price"
 * screens (sealants, vents, …), color-priced screens (Corners, Drip Edge, Gravel Stops, Pipe Stacks —
 * one item per color column), and box-priced fasteners ("Price/Box", with the "Fasteners/Box" count
 * left out). A screen with no recognizable price column is skipped.
 *
 * NOTE: accessory LABOR is not attached here — that is a separate table (accessory_labor) with its
 * own per-unit / per-foot / drill-variant columns; wiring it is a later pass.
 */
export function buildAccessoryCatalog(
  rows: Array<{ id: string; category: string; data: MembraneScreen }>,
): AccessoryCatalogItem[] {
  const items: AccessoryCatalogItem[] = [];
  for (const row of rows) {
    const cols = row.data?.columns ?? [];
    const priceCols = cols
      .map((c) => ({ col: c, variant: priceColumnVariant(c) }))
      .filter((p): p is { col: string; variant: string } => p.variant !== null);
    if (priceCols.length === 0) continue;
    for (const r of row.data.rows) {
      const baseDesc = String(r["Description"] ?? r["Name"] ?? "");
      if (!baseDesc) continue;
      for (const { col, variant } of priceCols) {
        const price = r[col];
        if (typeof price !== "number") continue; // skip null / N/A cells
        const description = variant ? `${baseDesc} — ${variant}` : baseDesc;
        const key = variant ? `${row.id}::${baseDesc}::${variant}` : `${row.id}::${baseDesc}`;
        const perBox = r["Fasteners/Box"];
        const subtype = r["Subtype"];
        items.push({
          key,
          category: row.category,
          description,
          price,
          variant,
          ...(typeof perBox === "number" && perBox > 0 ? { fastenersPerBox: perBox } : {}),
          ...(typeof subtype === "string" && subtype ? { subtype } : {}),
        });
      }
    }
  }
  return items;
}

/**
 * Build a best-effort accessory install-labor lookup (description → hours per unit) from the
 * accessory_labor screens. DELIBERATELY PARTIAL: only screens whose single labor column is exactly
 * "Labor(Hrs)" / "Labor (Hrs)" are mapped — the multi-column screens (PreDrill/NoDrill, Hr/Ft,
 * Multiplier, Area-Prep/Reinstallation) are left out because which column applies isn't determinable
 * without a captured bid. A description that resolves to two different hour values across screens is
 * dropped (ambiguous → manual entry). This is a UI prefill only; every value stays editable, and it
 * never fabricates a mapping (exact string equality on curated admin data, no fuzzy matching).
 *
 * FLAGGED FOR BID VALIDATION (Phase 6): per-foot / drill-variant / fastener-derived accessory labor,
 * and items whose pricing- and labor-screen descriptions differ, are not prefilled here.
 */
export function buildAccessoryLaborLookup(
  rows: Array<{ id: string; category: string; data: MembraneScreen }>,
): Record<string, number> {
  const HOURS_COLS = ["Labor(Hrs)", "Labor (Hrs)"];
  const seen: Record<string, number | null> = {}; // null marks an ambiguous (conflicting) key
  for (const row of rows) {
    const cols = row.data?.columns ?? [];
    const hoursCol = HOURS_COLS.find((c) => cols.includes(c));
    if (!hoursCol) continue; // skip multi-column / non-simple labor screens
    for (const r of row.data.rows ?? []) {
      const desc = String(r["Description"] ?? "");
      const h = r[hoursCol];
      if (!desc || typeof h !== "number") continue;
      if (desc in seen) {
        if (seen[desc] !== h) seen[desc] = null; // conflict → drop
      } else {
        seen[desc] = h;
      }
    }
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(seen)) if (v !== null) out[k] = v;
  return out;
}

/** One pickable non-Duro-Last catalog line (material Price + a labor component at its own rate). */
export interface NonDlCatalogItem {
  key: string; // `${screenId}::${description}`
  category: string;
  description: string;
  price: number; // material $/unit
  laborPerUnit: number; // labor hours/unit
  laborRate: number; // $/hr for this line's labor
}

/**
 * Flatten the non-DL pricing screens (uniform Description / Price / LaborPerUnit / Labor Rate shape:
 * Roof Edge Blocking, Sheet Metal Work, Masonry, Subcontractors, 3rd Party Services, …) into a
 * pickable list. Missing numeric cells default to 0.
 */
export function buildNonDlCatalog(
  rows: Array<{ id: string; category: string; data: MembraneScreen }>,
): NonDlCatalogItem[] {
  const num = (v: string | number | null | undefined): number => (typeof v === "number" ? v : 0);
  const items: NonDlCatalogItem[] = [];
  for (const row of rows) {
    for (const r of row.data?.rows ?? []) {
      const description = String(r["Description"] ?? r["Name"] ?? "");
      if (!description) continue;
      items.push({
        key: `${row.id}::${description}`,
        category: row.category,
        description,
        price: num(r["Price"]),
        laborPerUnit: num(r["LaborPerUnit"]),
        laborRate: num(r["Labor Rate"]),
      });
    }
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Labor multipliers (from a Roof Deck Labor "Membrane Labor" combo)
// ─────────────────────────────────────────────────────────────────────────────

export interface LaborCombo {
  roof_system: string;
  attachment: string;
  base?: { tab_value: number; tab_multiplier: number } | null;
  deck_multipliers?: Record<string, number> | null;
  fastener_spacing_multipliers?: Array<{ spacing_in: number; multiplier: number }> | null;
  sheet_size_multipliers?: Array<{
    label: string;
    roof_section: number;
    underlayment: number;
  }> | null;
  thickness_multipliers?: Array<{ mil: number; multiplier: number }> | null;
}

export interface LaborTables {
  /** SmartDeckTypeMultiplier / DefaultDeckTypeMultiplier keyed by deck id (column-order index). */
  deckTypeMulti: Record<number, DualValue>;
  /** Deck name → id, so a section can reference the right column. */
  deckTypeIds: Record<string, number>;
  onCenterBands: Band[];
  /**
   * Tab-spacing → labor multiplier bands. buildLaborTables seeds only the captured (selected)
   * tab option; assembleEngineAdminData expands mechanical combos to the full legacy
   * mech_tab_multi set when those rows are provided.
   */
  tabBands: Band[];
  sheetSizeMultiByLabel: Record<string, number>;
  thicknessLaborByMil: Record<number, number>;
  /**
   * The combo's FIRST sheet-size label (legacy RoofSystem.SheetSizeList[0] — "Roll Good" in the
   * seeded data): sections on this sheet price membrane at the roll-goods tier; other sheets
   * price by zone at tab tiers ("" when the combo has no sheet list → treat as roll goods).
   */
  rollGoodsSheetLabel: string;
}

/**
 * Build the engine labor lookups from one Roof Deck Labor combo. Deck ids come from `deckOrder`
 * (the standard column order), so `RoofSection.deckTypeId` = the deck's index in that order.
 */
export function buildLaborTables(combo: LaborCombo, deckOrder: string[]): LaborTables {
  const deckTypeIds: Record<string, number> = {};
  deckOrder.forEach((name, i) => (deckTypeIds[name] = i));

  const deckTypeMulti: Record<number, DualValue> = {};
  for (const [name, value] of Object.entries(combo.deck_multipliers ?? {})) {
    const id = deckTypeIds[name];
    if (id !== undefined) deckTypeMulti[id] = { default: value };
  }

  const onCenterBands: Band[] = (combo.fastener_spacing_multipliers ?? []).map((r) => ({
    key: r.spacing_in,
    value: r.multiplier,
  }));

  const tabBands: Band[] = combo.base
    ? [{ key: combo.base.tab_value, value: combo.base.tab_multiplier }]
    : [];

  const sheetSizeMultiByLabel: Record<string, number> = {};
  for (const s of combo.sheet_size_multipliers ?? [])
    sheetSizeMultiByLabel[s.label] = s.roof_section;
  const rollGoodsSheetLabel = combo.sheet_size_multipliers?.[0]?.label ?? "";

  const thicknessLaborByMil: Record<number, number> = {};
  for (const t of combo.thickness_multipliers ?? []) thicknessLaborByMil[t.mil] = t.multiplier;

  return {
    deckTypeMulti,
    deckTypeIds,
    onCenterBands,
    tabBands,
    sheetSizeMultiByLabel,
    thicknessLaborByMil,
    rollGoodsSheetLabel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parapet labor (labor_parapet: deck × wall-height band × drill/cant → hrs per 50 LF)
// ─────────────────────────────────────────────────────────────────────────────

/** A seeded labor_parapet row (numerics arrive from Supabase as strings). */
export interface RawParapetRow {
  deck_type: string;
  wall_height_band: string;
  no_drill_no_cant: number | string;
  no_drill_canted: number | string;
  predrill_no_cant: number | string;
  predrill_canted: number | string;
  sort: number;
}

export interface ParapetModeRates {
  noDrillNoCant: number;
  noDrillCanted: number;
  predrillNoCant: number;
  predrillCanted: number;
}

export interface ParapetLaborTables {
  /** Wall-height band labels in sort order (e.g. 0"-30", 31"-48", …) — picked, not parsed. */
  bands: string[];
  /** lookup[tearoffDeckName][band] → hrs per 50 lineal ft by install mode. */
  lookup: Record<string, Record<string, ParapetModeRates>>;
}

/** Build the parapet labor lookup. Deck names use the tear-off taxonomy (TEAROFF_DECK_BY_LABOR_DECK). */
export function buildParapetLabor(rows: RawParapetRow[]): ParapetLaborTables {
  const bands: string[] = [];
  const lookup: ParapetLaborTables["lookup"] = {};
  for (const r of [...rows].sort((a, b) => a.sort - b.sort)) {
    if (!bands.includes(r.wall_height_band)) bands.push(r.wall_height_band);
    (lookup[r.deck_type] ??= {})[r.wall_height_band] = {
      noDrillNoCant: Number(r.no_drill_no_cant),
      noDrillCanted: Number(r.no_drill_canted),
      predrillNoCant: Number(r.predrill_no_cant),
      predrillCanted: Number(r.predrill_canted),
    };
  }
  return { bands, lookup };
}

/** Pick the install-mode rate (hrs per 50 LF) from a parapet matrix entry. */
export function parapetModeRate(e: ParapetModeRates, predrill: boolean, canted: boolean): number {
  if (predrill) return canted ? e.predrillCanted : e.predrillNoCant;
  return canted ? e.noDrillCanted : e.noDrillNoCant;
}

// ─────────────────────────────────────────────────────────────────────────────
// Underlayment labor (Layout & Mechanical + Adhesive Times) and adhesive prices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Layout & Mechanical tab uses its own deck-name variant ("Steel", "LWC / Steel", …).
 * Map the estimator's labor deck names onto it (a third taxonomy beside labor and tear-off).
 */
export const UNDERLAYMENT_DECK_BY_LABOR_DECK: Record<string, string> = {
  Wood: "Wood",
  Steel: "Steel",
  Retrofit: "Metal Retrofit",
  Concrete: "Concrete",
  Gypsum: "Gypsum",
  "LWC/Steel": "LWC / Steel",
  "LWC/Concrete": "LWC / Concrete",
  "LWC/Other": "LWC / Other",
  Tectum: "Tectum",
  Purlin: "Purlin Fastened",
};

/** Seeded rdl_labor_tables id "underlayment_layout_mechanical". */
export interface RawUnderlaymentLayoutData {
  rows: Array<{ underlayment: string; layout_hours_per_2500sqft: number }>;
  fasteners_per_4x8_options?: Array<{ count: number; per_sqft: number; selected?: boolean }>;
  fastening_times_min_per_fastener_by_deck?: Record<string, number>;
}

export interface UnderlaymentLaborTables {
  /** Product name → layout hours per 2,500 sq ft. */
  layoutHoursByProduct: Record<string, number>;
  /** Fasteners-per-4×8-board options (5..20), first = the app's selected default. */
  fastenerCounts: number[];
  /** Minutes per fastener by (underlayment-taxonomy) deck name. */
  fastenerMinutesByDeck: Record<string, number>;
}

export function buildUnderlaymentLabor(data: RawUnderlaymentLayoutData): UnderlaymentLaborTables {
  const layoutHoursByProduct: Record<string, number> = {};
  for (const r of data.rows ?? [])
    layoutHoursByProduct[r.underlayment] = Number(r.layout_hours_per_2500sqft);
  const opts = data.fasteners_per_4x8_options ?? [];
  const selected = opts.find((o) => o.selected);
  const fastenerCounts = [
    ...(selected ? [selected.count] : []),
    ...opts.filter((o) => !o.selected).map((o) => o.count),
  ];
  return {
    layoutHoursByProduct,
    fastenerCounts,
    fastenerMinutesByDeck: { ...(data.fastening_times_min_per_fastener_by_deck ?? {}) },
  };
}

/**
 * Mechanical underlayment labor (the app's own header formula: "Labor = Layout Time + (Time for
 * One Fastener by Deck Type) × # Fasteners in 2500 SqFt", scaled by area):
 * hours = (area/2500) × layoutHoursPer2500 + (minutesPerFastener/60) × (fastenersPerBoard/32) × area
 * (a 4×8 board is 32 sq ft, so fasteners/sqft = count/32).
 */
export function underlaymentMechanicalHours(i: {
  areaSqFt: number;
  layoutHoursPer2500: number;
  minutesPerFastener: number;
  fastenersPerBoard: number;
}): number {
  return (
    (i.areaSqFt / 2500) * i.layoutHoursPer2500 +
    (i.minutesPerFastener / 60) * (i.fastenersPerBoard / 32) * i.areaSqFt
  );
}

/** Seeded rdl_labor_tables id "underlayment_adhesive_times". */
export interface RawAdhesiveTimesData {
  adhesives: Array<{
    adhesive: string;
    unit_type?: string;
    rows: Array<{ substrate: string; coverage_sqft: number; labor: number }>;
  }>;
}

export interface AdhesiveTimesTables {
  /** Adhesive names in table order. */
  adhesives: string[];
  /** bySubstrate[adhesive][substrate] = { coverageSqFt, labor } (0/0 rows = not applicable). */
  bySubstrate: Record<string, Record<string, { coverageSqFt: number; labor: number }>>;
}

export function buildAdhesiveTimes(data: RawAdhesiveTimesData): AdhesiveTimesTables {
  const adhesives: string[] = [];
  const bySubstrate: AdhesiveTimesTables["bySubstrate"] = {};
  for (const a of data.adhesives ?? []) {
    adhesives.push(a.adhesive);
    const subs: Record<string, { coverageSqFt: number; labor: number }> = {};
    for (const r of a.rows ?? [])
      subs[r.substrate] = { coverageSqFt: Number(r.coverage_sqft), labor: Number(r.labor) };
    bySubstrate[a.adhesive] = subs;
  }
  return { adhesives, bySubstrate };
}

/**
 * Adhesive underlayment attachment (§5.3): units = area ÷ coverage (sq ft per unit, by substrate);
 * labor hours = area × labor ÷ 1000. LABOR SCALE FLAGGED FOR BID VALIDATION: engine-truth §3.3
 * names the admin Adhesive Times table as GetAdhesiveBaseHours, "hrs per 1000 sq ft" — that scale
 * is applied here. Units are NOT rounded up (the spec states the bare formula; whole-unit
 * purchasing rounding is a validation question). Zero coverage (not-applicable row) → 0 units/hours.
 */
export function underlaymentAdhesive(i: {
  areaSqFt: number;
  coverageSqFt: number;
  laborPer1000SqFt: number;
}): { units: number; hours: number } {
  if (i.coverageSqFt <= 0) return { units: 0, hours: 0 };
  return {
    units: i.areaSqFt / i.coverageSqFt,
    hours: (i.areaSqFt * i.laborPer1000SqFt) / 1000,
  };
}

/** The seeded Adhesives master-detail (pricing_catalog kind "adhesives"), trimmed to what we read. */
export interface AdhesivesScreenData {
  kind: string;
  products?: Array<{ name: string; price?: number | null }>;
}

/** Adhesive product name → price per unit (exact-name join; all 6 Times-table names match). */
export function buildAdhesivePrices(data: AdhesivesScreenData | null): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const p of data?.products ?? [])
    if (p.name && typeof p.price === "number") prices[p.name] = p.price;
  return prices;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exceptional Metals catalog (master-detail screen → flat pickable list)
// ─────────────────────────────────────────────────────────────────────────────

interface MetalRow {
  description: string;
  unit_cost?: number | null;
  labor_per_unit_lf?: number | null;
  labor_rate?: number | null;
  price?: number | null; // two_piece_metals rows use `price`
}

/** The seeded Exceptional Metals master-detail data (pricing_catalog kind: "metals"). */
export interface MetalsScreenData {
  kind: string;
  subscreens?: {
    gutters?: { rows?: MetalRow[]; captured_for?: { style?: string; size?: string } };
    downspouts?: {
      size_grid?: { rows_by_size?: Record<string, MetalRow[]> };
      general_downspout?: { rows?: MetalRow[] };
    };
    pitch_pans?: { rows?: MetalRow[] };
    collection_boxes?: { rows_by_option?: Record<string, MetalRow[]> };
    two_piece_metals?: { rows?: MetalRow[] };
  };
}

/** One pickable Exceptional Metals line (unit cost + labor/unit at the line's own rate). */
export interface MetalsCatalogItem {
  key: string;
  category: string;
  description: string;
  unitCost: number;
  laborPerUnit: number; // hours per unit / LF
  laborRate: number; // $/hr for this line's labor
}

/**
 * Flatten the Exceptional Metals subscreens (gutters, downspouts by size + general accessories,
 * pitch pans, collection boxes by scupper option, two-piece metals) into a pickable list. Gutter
 * rows are mostly $0 in the source (capture-live gap — real prices pending); they're included since
 * the values are editable in admin. Two-piece rows are price-only (their per-foot labor lives in
 * the accessory_labor "Two Piece Metals" screen — flagged, entered manually for now).
 */
export function buildMetalsCatalog(data: MetalsScreenData | null): MetalsCatalogItem[] {
  const items: MetalsCatalogItem[] = [];
  const num = (v: number | null | undefined): number => (typeof v === "number" ? v : 0);
  const push = (category: string, r: MetalRow) => {
    if (!r.description) return;
    items.push({
      key: `metals::${category}::${r.description}`,
      category,
      description: r.description,
      unitCost: num(r.unit_cost) || num(r.price),
      laborPerUnit: num(r.labor_per_unit_lf),
      laborRate: num(r.labor_rate),
    });
  };
  const s = data?.subscreens;
  if (!s) return items;

  const gutterFor = s.gutters?.captured_for;
  const gutterCat = gutterFor?.style
    ? `Gutters — ${gutterFor.style}${gutterFor.size ? ` (${gutterFor.size})` : ""}`
    : "Gutters";
  for (const r of s.gutters?.rows ?? []) push(gutterCat, r);

  const bySize = s.downspouts?.size_grid?.rows_by_size ?? {};
  for (const [size, rows] of Object.entries(bySize))
    for (const r of rows) push(`Downspouts ${size}`, r);
  for (const r of s.downspouts?.general_downspout?.rows ?? []) push("Downspout accessories", r);

  for (const r of s.pitch_pans?.rows ?? []) push("Pitch Pans", r);

  const byOption = s.collection_boxes?.rows_by_option ?? {};
  for (const [option, rows] of Object.entries(byOption))
    for (const r of rows) push(`Collection Boxes — ${option}`, r);

  // Two-piece compression: the capture lists each size's base row followed by its
  // "Cover" / "Outside Corner" / "Inside Corner" rows. Prefix the sub-rows with the
  // base size so the picker offers distinct base metal + cover metal choices (legacy
  // selects base and cover separately) and catalog keys stay unique.
  let twoPieceBase = "";
  for (const r of s.two_piece_metals?.rows ?? []) {
    const isSub = ["Cover", "Outside Corner", "Inside Corner"].includes(r.description ?? "");
    if (!isSub) twoPieceBase = r.description ?? "";
    push(
      "Two-Piece Metals",
      isSub && twoPieceBase ? { ...r, description: `${twoPieceBase} — ${r.description}` } : r,
    );
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Curb labor (labor_curb setup minutes + labor_curb_deck min/LF × labor_curb_type multiplier)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawCurbDeckRow {
  deck_type: string;
  minutes: number | string;
}
export interface RawCurbTypeRow {
  curb_type: string;
  multiplier: number | string;
}

export interface CurbLaborTables {
  /** Setup minutes per curb (labor_curb.setup_minutes). */
  setupMinutes: number;
  /** Minutes per lineal foot by tear-off-taxonomy deck name. */
  minutesByDeck: Record<string, number>;
  /** Curb-type multiplier (Open 1.1, Closed 1, Scupper 4, …). */
  multiplierByType: Record<string, number>;
  /** Curb type names in sort order, for the picker. */
  curbTypes: string[];
}

/** Build the curb labor tables. Deck names use the tear-off taxonomy (TEAROFF_DECK_BY_LABOR_DECK). */
export function buildCurbLabor(
  setupMinutes: number | string | null | undefined,
  deckRows: RawCurbDeckRow[],
  typeRows: RawCurbTypeRow[],
): CurbLaborTables {
  const minutesByDeck: Record<string, number> = {};
  for (const d of deckRows) minutesByDeck[d.deck_type] = Number(d.minutes);
  const multiplierByType: Record<string, number> = {};
  const curbTypes: string[] = [];
  for (const t of typeRows) {
    multiplierByType[t.curb_type] = Number(t.multiplier);
    curbTypes.push(t.curb_type);
  }
  return { setupMinutes: Number(setupMinutes ?? 0), minutesByDeck, multiplierByType, curbTypes };
}

/**
 * Curb labor hours (§5.3): per curb, setup minutes + (min/LF for the deck × curb-type multiplier)
 * × curb perimeter LF; total = quantity × that, converted to hours.
 */
export function curbLaborHours(i: {
  quantity: number;
  setupMinutes: number;
  minutesPerLF: number;
  typeMultiplier: number;
  perimeterFt: number;
}): number {
  const minutesPerCurb = i.setupMinutes + i.minutesPerLF * i.typeMultiplier * i.perimeterFt;
  return (i.quantity * minutesPerCurb) / 60;
}

// ─────────────────────────────────────────────────────────────────────────────
// Labor templates (per-category % adjustments; 0 = use default = 100)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawLaborTemplate {
  id: string;
  name: string;
  sort?: number;
}
export interface RawLaborTemplateAdjustment {
  template_id: string;
  area: string;
  value: number | string;
  sort?: number;
}

export interface LaborTemplates {
  /** Template names in sort order. */
  names: string[];
  /** byName[template][area] = stored value (0 = use-default sentinel ≡ 100). */
  byName: Record<string, Record<string, number>>;
}

export function buildLaborTemplates(
  templates: RawLaborTemplate[],
  adjustments: RawLaborTemplateAdjustment[],
): LaborTemplates {
  const names: string[] = [];
  const byId: Record<string, string> = {};
  const byName: LaborTemplates["byName"] = {};
  for (const tpl of [...templates].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    names.push(tpl.name);
    byId[tpl.id] = tpl.name;
    byName[tpl.name] = {};
  }
  for (const a of adjustments) {
    const name = byId[a.template_id];
    if (name) byName[name]![a.area] = Number(a.value);
  }
  return { names, byName };
}

/** Template factor for one area: 0 (or missing) is the use-default sentinel ≡ ×1; else value/100. */
export function laborTemplateFactor(
  areas: Record<string, number> | undefined,
  area: string,
): number {
  const v = areas?.[area];
  return v === undefined || v === 0 ? 1 : v / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole-catalog assembly (pure) — used by the Supabase server fn
// ─────────────────────────────────────────────────────────────────────────────

/** The standard Roof Deck Labor deck-type column order; a deck's index in it is its id. */
export const STANDARD_DECK_ORDER = [
  "Wood",
  "Steel",
  "Retrofit",
  "Concrete",
  "Gypsum",
  "LWC/Steel",
  "LWC/Concrete",
  "LWC/Other",
  "Tectum",
  "Purlin",
] as const;

export interface RawCompanySettings {
  hours_per_man_day?: number | null;
  master_elite?: boolean | null;
  sales_tax_rate?: number | null;
  only_tax_material?: boolean | null;
  shipping_method?: string | null;
  shipping_percent?: number | null;
}

/** Seeded Tearoff Times (rdl_labor_tables id "tearoff_times"): types × deck grid, Hours/100SqFt. */
export interface TearOffTimesData {
  deck_columns: string[];
  rows: Array<{ tearoff_type: string; by_deck: Record<string, number> }>;
}

export interface TearOffTables {
  deckColumns: string[];
  tearoffTypes: string[];
  /** Per-sqft labor: lookup[tearoffDeckName][tearoffType] = grid Hours/100SqFt ÷ 100. */
  lookup: Record<string, Record<string, number>>;
}

/** Map a labor deck-type name to the Tearoff Times table's deck column name (different taxonomy). */
export const TEAROFF_DECK_BY_LABOR_DECK: Record<string, string> = {
  Wood: "Wood",
  Steel: "Structural Metal",
  Retrofit: "Metal Retrofit",
  Concrete: "Concrete",
  Gypsum: "Gypsum",
  "LWC/Steel": "LWC over Steel",
  "LWC/Concrete": "LWC over Concrete",
  "LWC/Other": "LWC over Other",
  Tectum: "Tectum",
  Purlin: "Purlin Fastened",
};

/**
 * Build the per-sqft tear-off labor lookup. The seeded grid is entered as Hours/100SqFt, and the
 * engine multiplies raw area with no ÷100, so we divide by 100 here (scale flagged in the checklist
 * for confirmation against a real bid).
 */
export function buildTearOffLookup(data: TearOffTimesData): TearOffTables {
  const lookup: Record<string, Record<string, number>> = {};
  for (const deck of data.deck_columns) lookup[deck] = {};
  for (const row of data.rows) {
    for (const [deck, v] of Object.entries(row.by_deck)) {
      (lookup[deck] ??= {})[row.tearoff_type] = v / 100;
    }
  }
  return {
    deckColumns: data.deck_columns,
    tearoffTypes: data.rows.map((r) => r.tearoff_type),
    lookup,
  };
}

/** A seeded shipping_steps row (numeric columns arrive from Supabase as strings). */
export interface RawShippingStep {
  material_threshold: number | string;
  shipping_cost: number | string;
}

/**
 * Build the stepped freight table from the seeded shipping_steps rows. Thresholds are lower-bound
 * "from" edges (row 0 = Minimum); sorted ascending for the lower-bound lookup in `freightStepped`.
 */
export function buildShippingSteps(rows: RawShippingStep[]): FreightStep[] {
  return rows
    .map((r) => ({ fromThreshold: Number(r.material_threshold), cost: Number(r.shipping_cost) }))
    .sort((a, b) => a.fromThreshold - b.fromThreshold);
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / inspection band tables (§2.4 / §2.5)
// ─────────────────────────────────────────────────────────────────────────────

/** labor_setup: the Minimum-row hours the base setup time is floored to. */
export interface RawSetup {
  minimum_hours?: number | string | null;
}
/** labor_setup_steps: a setup band (sqft edge × multiplier). Mode-1 (×Ceiling(sqft)) throughout. */
export interface RawSetupStep {
  sqft: number | string;
  multiplier: number | string;
}
/** labor_inspection_steps: a flat-hours inspection band keyed by its lower-bound sqft edge. */
export interface RawInspectionStep {
  sqft: number | string;
  hours: number | string;
}

/**
 * Build the setup band table (§2.4). Seeded steps are all mode-1 multiplier bands
 * (BaseSetup = Ceiling(sqft) × multiplier), floored to labor_setup.minimum_hours.
 */
export function buildSetupTable(setup: RawSetup | null, steps: RawSetupStep[]): SetupBandTable {
  const bands = steps
    .map((s) => ({ upTo: Number(s.sqft), value: Number(s.multiplier), multiply: true }))
    .sort((a, b) => a.upTo - b.upTo);
  return { minimum: Number(setup?.minimum_hours ?? 0), bands };
}

/**
 * Build the inspection band table (§2.5) — flat hours per lower-bound sqft band. The lowest-edge
 * row's hours double as the Minimum (value for sqft below the first band edge).
 */
export function buildInspectionTable(steps: RawInspectionStep[]): InspectionBandTable {
  const bands = steps
    .map((s) => ({ edge: Number(s.sqft), value: Number(s.hours) }))
    .sort((a, b) => a.edge - b.edge);
  return { minimum: bands[0]?.value ?? 0, bands };
}

// ─────────────────────────────────────────────────────────────────────────────
// Membrane / parapet-wall adhesive coverage (legacy AdhesiveCoverage tables, extracted
// verbatim from the shipped bootstrap script — docs/legacy-consumption-rules.md §2.4)
// ─────────────────────────────────────────────────────────────────────────────

export interface RawAdhesiveCoverageRow {
  roof_system_id: number;
  adhesive_id: number;
  coverage_sqft: number | string;
  deck_type_id?: number;
  underlayment_group_id?: number;
}
export interface RawLegacyAdhesiveRow {
  adhesive_id: number;
  long_name: string;
}

/** global_DeckType id → our labor-deck name. */
export const LEGACY_DECK_NAME_BY_ID: Record<number, string> = {
  1: "Wood",
  2: "Steel",
  3: "Retrofit",
  4: "Concrete",
  5: "Gypsum",
  6: "LWC/Steel",
  7: "LWC/Concrete",
  8: "LWC/Other",
  9: "Tectum",
  10: "Purlin",
};

export interface MembraneAdhesiveCoverage {
  /** Bare-deck coverage (sq ft/unit) by our deck name — membrane adhered straight to the deck. */
  byDeckName: Record<string, number>;
  /**
   * Coverage when adhering over insulation. The captured tables are UNIFORM across board groups
   * per (system, adhesive) — e.g. Water Based 700 everywhere, Solvent 300 — so a single value is
   * exposed; null when the source rows disagree (then the caller warns instead of guessing,
   * because the board→group mapping itself lives in uncaptured MySQL).
   */
  underlaymentUniform: number | null;
  /** Parapet wall coverage; null when absent or the source rows are ambiguous (RS3 duplicates). */
  wallCoverage: number | null;
}

export function buildMembraneAdhesives(raw: {
  adhesives: RawLegacyAdhesiveRow[];
  deckRows: RawAdhesiveCoverageRow[];
  underlaymentRows: RawAdhesiveCoverageRow[];
  wallRows: RawAdhesiveCoverageRow[];
}): Record<number, Record<string, MembraneAdhesiveCoverage>> {
  const nameById = new Map(raw.adhesives.map((a) => [a.adhesive_id, a.long_name]));
  const out: Record<number, Record<string, MembraneAdhesiveCoverage>> = {};
  const ensure = (rs: number, name: string): MembraneAdhesiveCoverage =>
    ((out[rs] ??= {})[name] ??= {
      byDeckName: {},
      underlaymentUniform: null,
      wallCoverage: null,
    });

  for (const r of raw.deckRows) {
    const name = nameById.get(r.adhesive_id);
    const deck = LEGACY_DECK_NAME_BY_ID[r.deck_type_id ?? -1];
    const cov = Number(r.coverage_sqft);
    if (name && deck && cov > 0) ensure(r.roof_system_id, name).byDeckName[deck] = cov;
  }

  const uniq = (rows: RawAdhesiveCoverageRow[], positiveOnly: boolean) => {
    const map = new Map<string, Set<number>>();
    for (const r of rows) {
      const name = nameById.get(r.adhesive_id);
      if (!name) continue;
      const cov = Number(r.coverage_sqft);
      if (positiveOnly && cov <= 0) continue; // 0 rows = "needs quote" (tapered/crickets)
      const key = `${r.roof_system_id}|${name}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(cov);
    }
    return map;
  };

  for (const [key, vals] of uniq(raw.underlaymentRows, true)) {
    const rs = Number(key.slice(0, key.indexOf("|")));
    const name = key.slice(key.indexOf("|") + 1);
    ensure(rs, name).underlaymentUniform = vals.size === 1 ? [...vals][0]! : null;
  }
  for (const [key, vals] of uniq(raw.wallRows, false)) {
    const rs = Number(key.slice(0, key.indexOf("|")));
    const name = key.slice(key.indexOf("|") + 1);
    const only = vals.size === 1 ? [...vals][0]! : null;
    ensure(rs, name).wallCoverage = only !== null && only > 0 ? only : null;
  }
  return out;
}

/**
 * A seeded mech_tab_multi row (legacy MechTabMulti, extracted verbatim from the shipped
 * Bid-Advantage bootstrap script): per roof system, tab spacing (inches) → labor multiplier.
 */
export interface RawTabMultiRow {
  roof_system_id: number;
  tab_spacing: number;
  multiplier: number | string;
}

/**
 * Legacy RoofSystemID by our rdl_combos roof-system name (exact-name join on curated admin data;
 * ids per the seeded legacy_roof_system table). Duro-Fleece (5) has no MechTabMulti rows — its
 * combos keep the captured base band.
 */
export const LEGACY_RS_ID_BY_NAME: Record<string, number> = {
  "Duro-Last": 1,
  "Duro-Bond": 2,
  "Duro-Tuff": 3,
  "Duro-Roof": 4,
  "Duro-Fleece": 5,
};

export interface RawAdminData {
  membraneScreen: MembraneScreen | null;
  combos: Array<{ roof_system: string; attachment: string; data: LaborCombo }>;
  settings: RawCompanySettings | null;
  tearOffTimes?: TearOffTimesData | null;
  underlaymentScreen?: MembraneScreen | null;
  shippingSteps?: RawShippingStep[] | null;
  setup?: RawSetup | null;
  setupSteps?: RawSetupStep[] | null;
  inspectionSteps?: RawInspectionStep[] | null;
  parapetRows?: RawParapetRow[] | null;
  curbSetupMinutes?: number | string | null;
  curbDeckRows?: RawCurbDeckRow[] | null;
  curbTypeRows?: RawCurbTypeRow[] | null;
  underlaymentLayout?: RawUnderlaymentLayoutData | null;
  adhesiveTimes?: RawAdhesiveTimesData | null;
  adhesivesScreen?: AdhesivesScreenData | null;
  laborTemplateRows?: RawLaborTemplate[] | null;
  laborTemplateAdjustments?: RawLaborTemplateAdjustment[] | null;
  /** Legacy mech_tab_multi rows; when present, mechanical combos get their FULL tab-band set. */
  tabMultiRows?: RawTabMultiRow[] | null;
  /** Legacy mech_sheet_tab_spacing rows (selectable tab pitches per roof system). */
  sheetTabRows?: Array<{ roof_system_id: number; spacing: number }> | null;
  /** Legacy adhesive-coverage tables (membrane/wall adhesive units for adhered systems). */
  legacyAdhesiveRows?: RawLegacyAdhesiveRow[] | null;
  adhesiveCoverageDeck?: RawAdhesiveCoverageRow[] | null;
  adhesiveCoverageUnderlayment?: RawAdhesiveCoverageRow[] | null;
  adhesiveWallCoverage?: RawAdhesiveCoverageRow[] | null;
}

export interface EngineSettings {
  hoursPerDay: number;
  masterEliteCont: boolean;
  salesTax: number;
  taxMaterialOnly: boolean;
  shippingMode: string;
  shippingPercent: number;
}

export interface EngineAdminData {
  deckOrder: string[];
  priceMatrix: PriceMatrix;
  /** Labor tables keyed by `${roof_system}|${attachment}` (e.g. "Duro-Last|mechanical"). */
  labor: Record<string, LaborTables>;
  settings: EngineSettings;
  /** Tear-off labor lookup (absent if the Tearoff Times table wasn't fetched). */
  tearOff?: TearOffTables;
  /** Underlayment $/sqft by board name (absent if the Underlayment screen wasn't fetched). */
  underlaymentPrices?: Record<string, number>;
  /** Stepped freight table (absent if shipping_steps wasn't fetched); used in stepped mode. */
  shippingSteps?: FreightStep[];
  /** Setup-time band table (absent if labor_setup wasn't fetched). */
  setupTable?: SetupBandTable;
  /** Inspection-time band table (absent if labor_inspection_steps wasn't fetched). */
  inspectionTable?: InspectionBandTable;
  /** Parapet labor matrix (absent if labor_parapet wasn't fetched). */
  parapetLabor?: ParapetLaborTables;
  /** Curb labor tables (absent if the labor_curb tables weren't fetched). */
  curbLabor?: CurbLaborTables;
  /** Underlayment Layout & Mechanical labor tables (absent if not fetched). */
  underlaymentLabor?: UnderlaymentLaborTables;
  /** Adhesive Times (coverage + labor per substrate per adhesive; absent if not fetched). */
  adhesiveTimes?: AdhesiveTimesTables;
  /** Adhesive product name → price per unit (absent if the Adhesives screen wasn't fetched). */
  adhesivePrices?: Record<string, number>;
  /** Membrane/wall adhesive coverage by legacy roof-system id → adhesive name (§2.4). */
  membraneAdhesives?: Record<number, Record<string, MembraneAdhesiveCoverage>>;
  /** Per-category labor templates (absent if labor_templates wasn't fetched). */
  laborTemplates?: LaborTemplates;
  /** Selectable tab pitches by legacy roof-system id (mech_sheet_tab_spacing; absent if unfetched). */
  sheetTabSpacings?: Record<number, number[]>;
}

/** Assemble the engine's admin inputs from the raw fetched rows (pure; no I/O). */
export function assembleEngineAdminData(raw: RawAdminData): EngineAdminData {
  const deckOrder = [...STANDARD_DECK_ORDER];
  const priceMatrix = raw.membraneScreen ? buildPriceMatrix(raw.membraneScreen) : {};

  // Full tab-band sets per legacy roof-system id (mech_tab_multi). The screenshot-captured combos
  // carry only the SELECTED tab row (e.g. Duro-Last 28 → 1.5125); the legacy table also defines
  // the other selectable pitches (60/64 → 1.0, 120 → 0.8, …). Legacy MechTabMulti belongs to the
  // mechanical system, so only mechanical-attachment combos are expanded; adhered combos (and
  // systems with no rows) keep the captured base band. bandLookup on the full set returns the
  // exact row for every legal Field Tab Spacing value, matching CustomTabSpacingMultiplier's
  // exact-key dictionary get.
  const sheetTabSpacings: Record<number, number[]> = {};
  for (const r of raw.sheetTabRows ?? []) {
    (sheetTabSpacings[r.roof_system_id] ??= []).push(r.spacing);
  }

  const tabBandsByRs = new Map<number, Band[]>();
  for (const r of raw.tabMultiRows ?? []) {
    const bands = tabBandsByRs.get(r.roof_system_id) ?? [];
    bands.push({ key: r.tab_spacing, value: Number(r.multiplier) });
    tabBandsByRs.set(r.roof_system_id, bands);
  }

  const labor: Record<string, LaborTables> = {};
  for (const c of raw.combos) {
    const tables = buildLaborTables(c.data, deckOrder);
    if (c.attachment === "mechanical") {
      const bands = tabBandsByRs.get(LEGACY_RS_ID_BY_NAME[c.roof_system] ?? -1);
      if (bands && bands.length > 0) tables.tabBands = bands;
    }
    labor[`${c.roof_system}|${c.attachment}`] = tables;
  }

  const s = raw.settings;
  const settings: EngineSettings = {
    hoursPerDay: s?.hours_per_man_day ?? 9,
    masterEliteCont: s?.master_elite ?? true,
    salesTax: s?.sales_tax_rate ?? 0,
    taxMaterialOnly: s?.only_tax_material ?? false,
    shippingMode: s?.shipping_method ?? "stepped",
    shippingPercent: s?.shipping_percent ?? 0,
  };

  const tearOff = raw.tearOffTimes ? buildTearOffLookup(raw.tearOffTimes) : undefined;
  const underlaymentPrices = raw.underlaymentScreen
    ? buildUnderlaymentPrices(raw.underlaymentScreen)
    : undefined;
  const shippingSteps = raw.shippingSteps ? buildShippingSteps(raw.shippingSteps) : undefined;
  const setupTable = raw.setupSteps
    ? buildSetupTable(raw.setup ?? null, raw.setupSteps)
    : undefined;
  const inspectionTable = raw.inspectionSteps
    ? buildInspectionTable(raw.inspectionSteps)
    : undefined;
  const parapetLabor = raw.parapetRows?.length ? buildParapetLabor(raw.parapetRows) : undefined;
  const curbLabor = raw.curbDeckRows?.length
    ? buildCurbLabor(raw.curbSetupMinutes, raw.curbDeckRows, raw.curbTypeRows ?? [])
    : undefined;
  const underlaymentLabor = raw.underlaymentLayout
    ? buildUnderlaymentLabor(raw.underlaymentLayout)
    : undefined;
  const adhesiveTimes = raw.adhesiveTimes ? buildAdhesiveTimes(raw.adhesiveTimes) : undefined;
  const adhesivePrices = raw.adhesivesScreen ? buildAdhesivePrices(raw.adhesivesScreen) : undefined;
  const membraneAdhesives = raw.legacyAdhesiveRows?.length
    ? buildMembraneAdhesives({
        adhesives: raw.legacyAdhesiveRows,
        deckRows: raw.adhesiveCoverageDeck ?? [],
        underlaymentRows: raw.adhesiveCoverageUnderlayment ?? [],
        wallRows: raw.adhesiveWallCoverage ?? [],
      })
    : undefined;
  const laborTemplates = raw.laborTemplateRows?.length
    ? buildLaborTemplates(raw.laborTemplateRows, raw.laborTemplateAdjustments ?? [])
    : undefined;

  return {
    deckOrder,
    priceMatrix,
    labor,
    settings,
    ...(tearOff ? { tearOff } : {}),
    ...(underlaymentPrices ? { underlaymentPrices } : {}),
    ...(shippingSteps ? { shippingSteps } : {}),
    ...(setupTable ? { setupTable } : {}),
    ...(inspectionTable ? { inspectionTable } : {}),
    ...(parapetLabor ? { parapetLabor } : {}),
    ...(curbLabor ? { curbLabor } : {}),
    ...(underlaymentLabor ? { underlaymentLabor } : {}),
    ...(adhesiveTimes ? { adhesiveTimes } : {}),
    ...(adhesivePrices ? { adhesivePrices } : {}),
    ...(membraneAdhesives ? { membraneAdhesives } : {}),
    ...(laborTemplates ? { laborTemplates } : {}),
    ...(raw.sheetTabRows?.length ? { sheetTabSpacings } : {}),
  };
}
