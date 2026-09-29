/** Small formatting helpers for the Leads page (kept apart so the card file only exports components). */
import type { LeadRow } from "@/lib/leads.functions";

/** "$2.9M" from a million up, "$100,000" below. */
export function formatCost(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * A lead whose bid date has passed, whatever the source (owner, Sep 29: closed campus and
 * SAM.gov bids were showing with "Show closed bids" off). Permits have no bid date.
 */
export const isClosedBid = (l: LeadRow, now = Date.now()) =>
  !!l.bid_at && Date.parse(l.bid_at) < now;
