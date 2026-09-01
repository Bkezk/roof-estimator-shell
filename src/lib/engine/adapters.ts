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

import type { PriceMatrix, PriceTier } from "./pricing";
import type { Band, DualValue } from "./labor";

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

export interface RawAdminData {
  membraneScreen: MembraneScreen | null;
  combos: Array<{ roof_system: string; attachment: string; data: LaborCombo }>;
  settings: RawCompanySettings | null;
  tearOffTimes?: TearOffTimesData | null;
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

  return { deckOrder, priceMatrix, labor, settings, ...(tearOff ? { tearOff } : {}) };
}
