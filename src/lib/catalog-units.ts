/**
 * The price-free shape of a pricing_catalog screen (Oct 20, the fifth audit: the catalog's
 * SELECT policy is Estimate Pricing / Estimate only — a technician reads no price anywhere).
 * Inventory is everyone's, and it needs three things from a screen: the row labels (to name a
 * stock cell), the pack sizes (how many pieces one priced pack holds, stock-units.ts), and an
 * adhesive's unit type. The `pricing_catalog_units` view of
 * 20261020120000_pricing_reads_narrowed.sql serves exactly that through
 * `public.pricing_catalog_unit_data(jsonb)`; this is its TypeScript twin, so the shaping can be
 * tested here and the test stand-in (src/test/fake-supabase.ts) serves the view the same way.
 * Keep the two in step: UNIT_ROW_KEYS is the SQL's key list.
 */
import { PACK_QTY_COLS } from "@/lib/stock-units";

/**
 * The row keys the view keeps on a flat screen: the label (Description / Name), the two
 * disambiguators catalog-row-key.ts uses when a label repeats, and the pack-size columns. The
 * first column is kept too (labelColOf falls back to it). Every other key — every price and
 * labor column, colour prices included — is dropped.
 */
export const UNIT_ROW_KEYS: readonly string[] = [
  "Description",
  "Name",
  "Subtype",
  "Part #",
  ...PACK_QTY_COLS,
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** The `data` of one `pricing_catalog_units` row for a screen's full `data`. */
export function unitDataOf(data: unknown): Obj {
  const d = isObj(data) ? data : {};
  const kind = typeof d["kind"] === "string" ? d["kind"] : null;
  if (kind === "adhesives") {
    const products = Array.isArray(d["products"]) ? d["products"] : [];
    return {
      kind,
      products: products.map((p) => {
        const o = isObj(p) ? p : {};
        const out: Obj = {};
        // As jsonb_strip_nulls: a missing or null name / unit_type is left out.
        if (o["name"] != null) out["name"] = o["name"];
        if (o["unit_type"] != null) out["unit_type"] = o["unit_type"];
        return out;
      }),
    };
  }
  if (kind) return { kind };
  const columns = Array.isArray(d["columns"]) ? d["columns"] : [];
  const first = typeof columns[0] === "string" ? columns[0] : null;
  const keep = new Set<string>(UNIT_ROW_KEYS);
  if (first) keep.add(first);
  const rows = Array.isArray(d["rows"]) ? d["rows"] : [];
  return {
    columns,
    rows: rows.map((r) => {
      const o = isObj(r) ? r : {};
      const out: Obj = {};
      for (const k of Object.keys(o)) if (keep.has(k)) out[k] = o[k];
      return out;
    }),
  };
}
