/**
 * The money figures a bid carries for the Margin report (owner, Oct 21: "do bids that are
 * accepted go into that report? if not please add them and have it to where you can filter just
 * service, just bids, or both"). The engine's output is never stored with a bid — only its inputs
 * and the pricing snapshot — and the server cannot recompute it (that takes the estimator page's
 * state assembly), so the estimator stores THESE figures on the row (bids.figures, jsonb) at every
 * save and the report reads them. A bid marked Won from the Bids list without a fresh save keeps
 * the figures of its last save, which is what it was priced at.
 *
 * From the money chain (engine/money.ts computeMoney, dTotals `d`), all cents-rounded:
 *  - total   = d20, the bid total, tax included when the bid charges it.
 *  - tax     = taxCharged: the material-only tax (folded into purchases, d8) or the end-of-chain
 *              sales tax (d19), whichever mode the bid is in.
 *  - revenue = total − tax — BEFORE tax, the owner's rule for this report ("keep it before tax").
 *  - material = d4 + d6 + d7: Duro-Last material after discounts, underlayment, other (non-DL)
 *              material. Never the material tax (that is `tax`).
 *  - labor   = d10 + d11: direct labor, and subs and services (the two are disjoint).
 *  - other   = d5 + d9 + d17 + d18: warranty, shipping, per diem, commission. Per diem and
 *              commission count as cost whether or not they are "in markup" — they are real money
 *              paid out either way.
 *  - hours   = laborSubtotal1Hours, the direct-labor hours (the report's Hours column).
 *
 * So margin = revenue − (material + labor + other) is the markup value (d14) in every markup
 * mode, give or take a cent of rounding: with per diem and commission outside the markup, revenue
 * is d16 + d17 + d18 and cost is d13 + d17 + d18; with them inside, both sides carry them in d13
 * and d16. The report shows margin, not markup, because an invoice has no markup line — the two
 * sides of the report then mean the same thing.
 *
 * `v` is the shape's version: a reader that finds another version (or no column: a bid saved
 * before Oct 21, 2026) treats the bid as having no figures and lists it rather than guessing.
 */
import { z } from "zod";

import type { EstimateResult } from "@/lib/engine/estimate";

export const BID_FIGURES_VERSION = 1;

export interface BidFigures {
  v: 1;
  /** The bid total before tax (total − tax). */
  revenue: number;
  /** d4 + d6 + d7. */
  material: number;
  /** d10 + d11. */
  labor: number;
  /** Warranty + shipping + per diem + commission (d5 + d9 + d17 + d18). */
  other: number;
  /** Direct-labor hours (laborSubtotal1Hours). */
  hours: number;
  /** What the bid charged in tax (taxCharged), whichever mode. */
  tax: number;
  /** The bid total (grandTotal, d20). */
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The figures of an engine result (the estimator calls this on `result.r` when it saves). */
export function bidFigures(r: Pick<EstimateResult, "laborSubtotal1Hours" | "money">): BidFigures {
  const d = r.money.dTotals;
  const total = r2(num(r.money.grandTotal));
  const tax = r2(num(r.money.taxCharged));
  return {
    v: BID_FIGURES_VERSION,
    revenue: r2(total - tax),
    material: r2(num(d[4]) + num(d[6]) + num(d[7])),
    labor: r2(num(d[10]) + num(d[11])),
    other: r2(num(d[5]) + num(d[9]) + num(d[17]) + num(d[18])),
    hours: r2(num(r.laborSubtotal1Hours)),
    tax,
    total,
  };
}

const money = z.number().finite();
/** The server's check of what the estimator sends (bids.functions.ts saveBidSchema). */
export const bidFiguresSchema = z.object({
  v: z.literal(1),
  revenue: money,
  material: money,
  labor: money,
  other: money,
  hours: money,
  tax: money,
  total: money,
});

/** The column read back: the figures, or null for a missing column, another version or garbage. */
export function asBidFigures(x: unknown): BidFigures | null {
  const r = bidFiguresSchema.safeParse(x);
  return r.success ? r.data : null;
}
