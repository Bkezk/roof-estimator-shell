/**
 * /inventory's search params (src/routes/inventory.tsx validateSearch). Pure, so the parsing is
 * tested without the route.
 *
 *   ?tab=stock|history|reconcile  which view (owner, Oct 9: "make the history and reconcile
 *                                 different tabs within the inventory page and only visible to
 *                                 managers and owners"). Anything else, or nothing, is Stock; the
 *                                 page itself sends anyone who is not an admin or manager to
 *                                 Stock whatever the URL says (the gate is the page's — it knows
 *                                 the profile — not the parser's).
 *   ?bid=<id>                     the estimator's "Record leftovers for this bid" link preselects
 *                                 the job.
 *   ?job=<id>                     a service ticket's "Log material" link opens "Take from
 *                                 inventory" for it.
 */
import { z } from "zod";

export const INVENTORY_TABS = ["stock", "history", "reconcile"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export interface InventorySearch {
  /** Left out at its default (Stock) so links that only carry a bid or a job stay short. */
  tab?: InventoryTab;
  bid?: string;
  job?: string;
}

/** A non-empty string, else nothing. */
const idParam = z.string().min(1).optional().catch(undefined);
const SEARCH = z.object({
  // Junk (a typo, an old link) is Stock, never an error page.
  tab: z.enum(INVENTORY_TABS).catch("stock"),
  bid: idParam,
  job: idParam,
});

export function parseInventorySearch(s: Record<string, unknown>): InventorySearch {
  const p = SEARCH.parse(s);
  return {
    ...(p.tab !== "stock" ? { tab: p.tab } : {}),
    ...(p.bid ? { bid: p.bid } : {}),
    ...(p.job ? { job: p.job } : {}),
  };
}
