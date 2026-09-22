import type { PriceTarget } from "@/lib/admin-item-numbers.functions";

/** A catalog price cell: screen · product row · price column. */
export interface TargetRef {
  screen_id: string;
  row_label: string;
  price_col: string;
}

/** The first mappable cell of the catalog — the pickers' starting value. */
export const firstTarget = (targets: PriceTarget[]): TargetRef | null =>
  targets.length
    ? {
        screen_id: targets[0]!.screen_id,
        row_label: targets[0]!.rows[0] ?? "",
        price_col: targets[0]!.price_cols[0] ?? "",
      }
    : null;
