/**
 * The price cells an item number can point at, built from catalog screens — the pure part of
 * listPriceTargets (admin-item-numbers.functions.ts), so the list the Item Numbers tab and the
 * price import offer is unit-tested as the server builds it. Since the accessory families (owner,
 * Oct 26–27) the screens come from four branches (catalog-branches.ts), ordered by branch then
 * by the screen's sort, and the Exceptional Metals › Pitch Pans rows are offered by Unit Cost
 * (the seed maps the Firestone penetration pockets there).
 */
import { branchOfScreen, branchOrder } from "@/lib/catalog-branches";
import { labelColOf, rowKeys } from "@/lib/catalog-row-key";
import {
  PACK_QTY_COLS,
  pieceDefFromPack,
  pieceDefFromUnitType,
  type PieceDef,
} from "@/lib/stock-units";

/** A price cell an item number can point at. */
export interface PriceTarget {
  screen_id: string;
  /** The branch (`duro_last`, `non_dl`, `non_dl_tpo`, `epdm`) — set by priceTargetsOf. */
  branch?: string;
  category: string;
  /** A master-detail screen's kind ("adhesives", "metals"); absent on a flat screen. */
  kind?: string;
  rows: string[];
  price_cols: string[];
  /** Current catalog value per row label → price column (null when blank / non-numeric). */
  values: Record<string, Record<string, number | null>>;
  /** The screen's pack-quantity column ("Fasteners/Box", "Parts/Bag", "Parts/Package"), if any. */
  pack_col?: string;
  /** Pack quantity per row label (units per box / bag / package) when the screen has one. */
  packs?: Record<string, number | null>;
  /** Adhesives: the product's own unit ("5-gal. Box Set", "4-Cartridge Case", …) per row. */
  row_units?: Record<string, string>;
  /** Pieces one priced pack holds, per row, where the catalog says (stock-units.ts). */
  pieces?: Record<string, PieceDef>;
}

/** The columns of a flat screen that are not prices: labels, part numbers, sizes, pack sizes, labor. */
export const NON_PRICE_COLS = new Set([
  "Part #",
  "Open Part #",
  "Closed Part #",
  "Subtype",
  "Size",
  "Fasteners/Box",
  "Parts/Bag",
  "Parts/Package",
  // Labor columns: the family "Other Accessories" screens and Non-DL › Preset Custom Applications.
  "Labor (Hrs)",
  "LaborPerUnit",
  "Labor Rate",
]);

/** The one price column of Exceptional Metals › Pitch Pans an item number may point at. */
export const METALS_PITCH_PAN_COL = "Unit Cost";

export const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export interface TargetScreenRow {
  id: string;
  branch?: string | null;
  category: string;
  sort?: number | null;
  data: unknown;
}

interface ScreenShape {
  kind?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  products?: { name: string; price?: unknown; unit_type?: unknown }[];
  subscreens?: {
    pitch_pans?: { rows?: { description?: string | null; unit_cost?: unknown }[] };
  };
}

/** One target per screen that has mappable cells, in branch then sort order. */
export function priceTargetsOf(screens: readonly TargetScreenRow[]): PriceTarget[] {
  const ordered = [...screens].sort((a, b) => {
    const ba = a.branch ?? branchOfScreen(a.id);
    const bb = b.branch ?? branchOfScreen(b.id);
    const o = branchOrder(ba) - branchOrder(bb);
    return o !== 0 ? o : (a.sort ?? 0) - (b.sort ?? 0);
  });
  const out: PriceTarget[] = [];
  for (const s of ordered) {
    const d = s.data as ScreenShape | null;
    if (!d) continue;
    const branch = s.branch ?? branchOfScreen(s.id);
    if (d.kind === "adhesives") {
      const values: PriceTarget["values"] = {};
      const rowUnits: Record<string, string> = {};
      const pieces: Record<string, PieceDef> = {};
      for (const p of d.products ?? []) {
        values[p.name] = { price: numOrNull(p.price) };
        if (typeof p.unit_type === "string" && p.unit_type.trim()) {
          rowUnits[p.name] = p.unit_type.trim();
          const def = pieceDefFromUnitType(p.unit_type);
          if (def) pieces[p.name] = def;
        }
      }
      out.push({
        screen_id: s.id,
        branch,
        category: s.category,
        kind: d.kind,
        rows: (d.products ?? []).map((p) => p.name),
        price_cols: ["price"],
        values,
        row_units: rowUnits,
        pieces,
      });
      continue;
    }
    if (d.kind === "metals") {
      // Exceptional Metals: only the Pitch Pans rows take an item number (the Firestone
      // penetration pockets), by description, on Unit Cost.
      const rows: string[] = [];
      const values: PriceTarget["values"] = {};
      for (const r of d.subscreens?.pitch_pans?.rows ?? []) {
        const label = String(r.description ?? "").trim();
        if (!label || label in values) continue;
        rows.push(label);
        values[label] = { [METALS_PITCH_PAN_COL]: numOrNull(r.unit_cost) };
      }
      if (rows.length)
        out.push({
          screen_id: s.id,
          branch,
          category: `${s.category} › Pitch Pans`,
          kind: d.kind,
          rows,
          price_cols: [METALS_PITCH_PAN_COL],
          values,
        });
      continue;
    }
    if (d.kind) continue; // Some other master-detail screen: no item numbers.
    const cols = d.columns ?? [];
    const labelCol = labelColOf(cols);
    const priceCols = cols.filter((c) => c !== labelCol && !NON_PRICE_COLS.has(c));
    const values: PriceTarget["values"] = {};
    const rows: string[] = [];
    const packCol = PACK_QTY_COLS.find((c) => cols.includes(c));
    const packs: Record<string, number | null> = {};
    // Rows are addressed by their KEY: the label, or "label [Subtype|Part #]" where the label
    // repeats on the screen (catalog-row-key.ts).
    const keys = rowKeys(cols, d.rows ?? []);
    for (const [i, r] of (d.rows ?? []).entries()) {
      const label = keys[i]!;
      if (label === "") continue;
      rows.push(label);
      const v: Record<string, number | null> = {};
      for (const c of priceCols) v[c] = numOrNull(r[c]);
      values[label] = v;
      if (packCol) packs[label] = numOrNull(r[packCol]);
    }
    const pieces: Record<string, PieceDef> = {};
    if (packCol)
      for (const [label, q] of Object.entries(packs)) {
        const def = pieceDefFromPack(packCol, q);
        if (def) pieces[label] = def;
      }
    out.push({
      screen_id: s.id,
      branch,
      category: s.category,
      rows,
      price_cols: priceCols,
      values,
      ...(packCol ? { pack_col: packCol, packs, pieces } : {}),
    });
  }
  return out;
}
