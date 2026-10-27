/**
 * Non-DL TPO and EPDM Adhesives on their own page (owner, Oct 27: the Firestone / I.S.O. products
 * sat in the Duro-Last › Adhesives dropdown — confusing). Done as the membranes were
 * (lib/non-dl-membrane.ts): the back end keeps the ONE adhesives screen (pricing_catalog
 * duro_last:adhesives), which the engine reads every product's coverage groups from; the new page
 * (routes/admin.non-dl-adhesives.tsx) is a view of the non-DL products in the same editor
 * (components/adhesives-editor.tsx AdhesivesTab), and the Duro-Last › Adhesives tab shows the
 * rest. Each view edits its part and merges it back into the whole product list on save
 * (mergeRows), so neither side can lose the other's products.
 */

import { mergeRows } from "@/lib/non-dl-membrane";

/** The two non-Duro-Last coverage groups (engine/adapters LEGACY_RS_ID_BY_NAME names). */
export const NON_DL_ADHESIVE_GROUPS: readonly string[] = ["Non-DL TPO", "EPDM Rubber"];
/** The Firestone part-number prefix: the I.S.O. insulation adhesives carry it under "Insulations". */
export const FIRESTONE_PART_PREFIX = "W56";

/** The screen both views edit. */
export const ADHESIVES_SCREEN_ID = "duro_last:adhesives";
/** The new page's address (a Non Duro-Last Pricing menu entry; a pricing page by access.ts). */
export const NON_DL_ADHESIVES_PATH = "/admin/non-dl-adhesives";
export const NON_DL_ADHESIVES_TITLE = "Non-DL TPO and EPDM Adhesives";
/** What a product added on the new page starts with: its first coverage row's group. */
export const NON_DL_ADHESIVE_DEFAULT_GROUP = "Non-DL TPO";

/** One coverage row of an adhesive product (the screen's `products[].coverage[]`). */
export interface AdhesiveCoverageRow {
  group: string;
  substrate: string;
  field_coverage: number | null;
}

/** One product of the adhesives screen, as the editor and the engine's adapter read it. */
export interface AdhesiveProduct {
  name: string;
  price: number;
  unit_type: string;
  part_no: string;
  field_spacing: string;
  perim_spacing: string;
  coverage: AdhesiveCoverageRow[];
}

/**
 * Is this product a non-Duro-Last one: any coverage row in the "Non-DL TPO" or "EPDM Rubber"
 * group, or a Firestone part number (W56…, the I.S.O. insulation adhesives whose group is
 * "Insulations"). TECH-Bond is Duro-Tech — a Duro-Last family — and stays on the Duro-Last side.
 */
export function isNonDlAdhesive(
  product: Pick<AdhesiveProduct, "part_no"> & {
    coverage?: Array<Pick<AdhesiveCoverageRow, "group">>;
  },
): boolean {
  if (
    String(product.part_no ?? "")
      .trim()
      .toUpperCase()
      .startsWith(FIRESTONE_PART_PREFIX)
  )
    return true;
  return (product.coverage ?? []).some((c) =>
    NON_DL_ADHESIVE_GROUPS.includes(String(c.group ?? "").trim()),
  );
}

/** The Duro-Last side: every product that is not a non-DL one. */
export const isDuroLastAdhesive = (product: Parameters<typeof isNonDlAdhesive>[0]): boolean =>
  !isNonDlAdhesive(product);

/**
 * The whole product list with one view's edits merged back in (lib/non-dl-membrane.ts mergeRows:
 * edits land in place, deletions drop, additions go after the last product of the view's kind;
 * the products the view never showed stay where they were).
 */
export function mergeAdhesiveProducts<P extends AdhesiveProduct>(
  stored: readonly P[],
  keep: (product: P) => boolean,
  edited: readonly P[],
): P[] {
  return mergeRows(stored, keep, edited);
}
