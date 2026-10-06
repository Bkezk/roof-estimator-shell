/**
 * Service material pricing (owner, Oct 6): a repair ticket's materials are priced from their own
 * list (service_materials — CenterPoint's 133, cost per unit), not from Estimate Pricing, which
 * stays the bids' and is not touched. The invoice bills cost × (1 + markup).
 *
 * Stock is still one ledger keyed by a cell (screen › row › price column). A service material
 * that is the same physical item as a bid-catalog product points at that cell (auto-matched in
 * 20261006130000_service_materials.sql — no control for users), so one count covers bid
 * leftovers and repair purchases; any other material is stocked under screen "service" with its
 * name as the row. Pure, so the server, the pickers and the tests share it.
 */
import type { PieceDef } from "@/lib/stock-units";

/** The stock screen of a material with no bid-catalog twin. */
export const SERVICE_STOCK_SCREEN = "service";
/** Its single price column (shown as no variant, like Adhesives' "price"). */
export const SERVICE_STOCK_COL = "price";
/** The category the Inventory page and truck lists show for those rows. */
export const SERVICE_CATEGORY = "Service materials";

export interface ServiceMaterialLink {
  name: string;
  unit: string;
  active: boolean;
  stock_screen_id: string | null;
  stock_row_label: string | null;
  stock_price_col: string | null;
  /**
   * Its group on the Inventory page when it has no bid-catalog twin (Underlayment, Sealants,
   * Cleaning Supplies …; owner, Oct 6); a twin shows under the catalog's own category.
   */
  category?: string | null;
  /**
   * Stock units in one of its units when they differ: an ISO board is 32 sq ft of the catalog's
   * ISO, which bids count by the sq ft. Null = the same unit.
   */
  stock_per_unit?: number | null;
  /** What one of its units is called on a truck / ticket when stock_per_unit is set ("board"). */
  piece_name?: string | null;
}
export interface ServiceMaterial extends ServiceMaterialLink {
  id: string;
  cost: number;
  sort: number;
}

export interface Cell {
  screen_id: string;
  row_label: string;
  price_col: string;
}
const key = (c: Cell) => `${c.screen_id}\u0000${c.row_label}\u0000${c.price_col}`;

/** The stock cell a material is counted in: its bid-catalog twin, or its own "service" row. */
export function stockCellOf(m: ServiceMaterialLink): Cell {
  return m.stock_screen_id && m.stock_row_label && m.stock_price_col
    ? { screen_id: m.stock_screen_id, row_label: m.stock_row_label, price_col: m.stock_price_col }
    : { screen_id: SERVICE_STOCK_SCREEN, row_label: m.name, price_col: SERVICE_STOCK_COL };
}

/**
 * Stock cell → the material that prices it. Active materials first, then the list's order: two
 * CenterPoint names can share one stock item (Duro-Caulk White twice; open and closed DL stacks
 * of a size are one catalog row), and the first one names and prices it.
 */
export function materialsByCell<T extends ServiceMaterialLink & { sort?: number }>(
  list: readonly T[],
): Map<string, T> {
  const sorted = [...list].sort(
    (a, b) => Number(b.active) - Number(a.active) || (a.sort ?? 0) - (b.sort ?? 0),
  );
  const out = new Map<string, T>();
  for (const m of sorted) {
    const k = key(stockCellOf(m));
    if (!out.has(k)) out.set(k, m);
  }
  return out;
}

export function materialForCell<T extends ServiceMaterialLink>(
  byCell: ReadonlyMap<string, T>,
  cell: Cell,
): T | undefined {
  return byCell.get(key(cell));
}

/**
 * What a truck / ticket row is called for service: the service material's name when there is
 * one for the cell, else null (the row keeps the catalog's own label).
 */
export function serviceLabel(
  byCell: ReadonlyMap<string, ServiceMaterialLink>,
  cell: Cell,
): string | null {
  return materialForCell(byCell, cell)?.name ?? null;
}

/**
 * The cost of one STOCK PACK of a cell from the service price (which is per piece / per unit
 * as CenterPoint lists it): a cell counted in packs of N pieces (a box of 1,000 plates, a bag of
 * 100 bands) costs N × the piece price; any other cell costs the price itself.
 */
export function packCostFor(cost: number, piece: PieceDef | null): number {
  return piece && piece.perPack > 0 ? cost * piece.perPack : cost;
}

/** The price a unit bills at: cost × (1 + markup), to the cent. */
export function sellPrice(cost: number, markup: number): number {
  return Math.round(cost * (1 + markup) * 100) / 100;
}

/** "Each" / "ea" / "EACH" / "1" → "each"; "SqFt" / "sqft" / "SF" → "sq ft"; "LF" / "Foot" → "ft". */
export function unitWord(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (["each", "ea", "1"].includes(u)) return "each";
  if (["sqft", "sf", "sq ft"].includes(u)) return "sq ft";
  if (["lf", "foot", "ft"].includes(u)) return "ft";
  if (["gal", "gallon"].includes(u)) return "gal";
  return u;
}

/**
 * The Inventory page's product search gains the service materials that have no bid-catalog twin
 * (a twin is already there under its catalog name), one group per category (Underlayment,
 * Sealants, Cleaning Supplies …), counted in each material's own unit — the shape of a catalog
 * price target.
 */
export function serviceStockTargets(list: readonly ServiceMaterialLink[]): {
  screen_id: string;
  category: string;
  rows: string[];
  price_cols: string[];
  values: Record<string, Record<string, number | null>>;
  row_units: Record<string, string>;
}[] {
  const own = list
    .filter((m) => m.active && !m.stock_screen_id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const groups = new Map<string, ServiceMaterialLink[]>();
  for (const m of own) {
    const c = m.category?.trim() || SERVICE_CATEGORY;
    groups.set(c, [...(groups.get(c) ?? []), m]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, ms]) => ({
      screen_id: SERVICE_STOCK_SCREEN,
      category,
      rows: ms.map((m) => m.name),
      price_cols: [SERVICE_STOCK_COL],
      values: {},
      row_units: Object.fromEntries(ms.map((m) => [m.name, unitWord(m.unit)])),
    }));
}

/**
 * A material counted in its own unit against stock kept in another (an ISO board = 32 sq ft):
 * the piece the truck and ticket count in, so 2 boards take 64 sq ft and bill as 2 boards.
 */
export function servicePiece(m: ServiceMaterialLink | undefined): PieceDef | null {
  const k = m?.stock_per_unit;
  if (!m || !k || !(k > 0) || k === 1) return null;
  return { name: m.piece_name?.trim() || unitWord(m.unit), perPack: 1 / k };
}

/** A "service" stock row's category: its material's group, else "Service materials". */
export function serviceCategoryOf(list: readonly ServiceMaterialLink[], rowLabel: string): string {
  const m = list.find((x) => !x.stock_screen_id && x.name === rowLabel);
  return m?.category?.trim() || SERVICE_CATEGORY;
}
