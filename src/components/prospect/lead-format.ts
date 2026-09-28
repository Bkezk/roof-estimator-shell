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

/** A planroom lead whose bid date has passed. */
export const isClosedBid = (l: LeadRow, now = Date.now()) =>
  l.source === "ky_planroom" && !!l.bid_at && Date.parse(l.bid_at) < now;
