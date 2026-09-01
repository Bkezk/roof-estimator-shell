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
