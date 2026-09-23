import { createFileRoute } from "@tanstack/react-router";

import { InventoryPage } from "@/components/inventory-page";

export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Bid-O-Matic" }] }),
  // ?bid=<id>: the estimator's "Record leftovers for this bid" link preselects the job.
  validateSearch: (s: Record<string, unknown>): { bid?: string } => {
    const b = s["bid"];
    return typeof b === "string" && b ? { bid: b } : {};
  },
  component: InventoryRoute,
});

function InventoryRoute() {
  const { bid } = Route.useSearch();
  return <InventoryPage initialBidId={bid} />;
}
