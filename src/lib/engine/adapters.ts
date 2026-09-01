/**
 * Data adapters (Phase 4g) — transform the seeded Supabase admin shapes into the engine's typed
 * inputs. Pure functions (no I/O), so they unit-test against the real stored shapes; the Supabase
 * server functions just fetch a row's `data` jsonb and pass it here.
 *
 * Covered now: the Duro-Last membrane PRICE MATRIX (from the seeded Duro-Last Membrane pricing
 * screen) and the LABOR MULTIPLIERS for a Roof Deck Labor combo (deck / on-center / tab / sheet-size
 * / thickness). Not yet available in the seed (capture-live gaps, see the checklist): the full
 * tab/width option lists (only the selected tab is captured → a single-entry tab band) and the
 * pull-test→fastener-spacing table (so `fastenerSpacing` stays empty; sections must supply a custom
 * fastener spacing, or that table must be captured, before the OC lookup resolves).
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
  key: string; // `${screenId}::${description}`
  category: string;
  description: string;
  price: number;
}

/**
 * Flatten seeded pricing_catalog screens into a pickable accessory list. v1 covers single-"Price"
 * screens (sealants, vents, washers, drain boots, CDR rings, termination/fascia bars, walk pads, …);
 * color-priced screens (Corners, Pipe Stacks, Drip Edge, Gravel Stops) and box-priced fasteners are
 * skipped here and handled in a later pass.
 */
export function buildAccessoryCatalog(
  rows: Array<{ id: string; category: string; data: MembraneScreen }>,
): AccessoryCatalogItem[] {
  const items: AccessoryCatalogItem[] = [];
  for (const row of rows) {
    if (!row.data?.columns?.includes("Price")) continue;
    for (const r of row.data.rows) {
      const description = String(r["Description"] ?? r["Name"] ?? "");
      const price = r["Price"];
      if (description && typeof price === "number") {
        items.push({
          key: `${row.id}::${description}`,
          category: row.category,
          description,
          price,
        });
      }
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
  /** Only the captured (selected) tab option — a single band until the full list is captured. */
  tabBands: Band[];
  sheetSizeMultiByLabel: Record<string, number>;
  thicknessLaborByMil: Record<number, number>;
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

  const thicknessLaborByMil: Record<number, number> = {};
  for (const t of combo.thickness_multipliers ?? []) thicknessLaborByMil[t.mil] = t.multiplier;

  return {
    deckTypeMulti,
    deckTypeIds,
    onCenterBands,
    tabBands,
    sheetSizeMultiByLabel,
    thicknessLaborByMil,
  };
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
}

/** Assemble the engine's admin inputs from the raw fetched rows (pure; no I/O). */
export function assembleEngineAdminData(raw: RawAdminData): EngineAdminData {
  const deckOrder = [...STANDARD_DECK_ORDER];
  const priceMatrix = raw.membraneScreen ? buildPriceMatrix(raw.membraneScreen) : {};

  const labor: Record<string, LaborTables> = {};
  for (const c of raw.combos) {
    labor[`${c.roof_system}|${c.attachment}`] = buildLaborTables(c.data, deckOrder);
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
  };
}
