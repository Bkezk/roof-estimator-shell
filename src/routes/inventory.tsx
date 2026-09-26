import { createFileRoute } from "@tanstack/react-router";

import { InventoryPage } from "@/components/inventory-page";

export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Bid-O-Matic" }] }),
  // ?bid=<id>: the estimator's "Record leftovers for this bid" link preselects the job.
  // ?job=<id>: a service ticket's "Log material" link opens "Take from inventory" for it.
  validateSearch: (s: Record<string, unknown>): { bid?: string; job?: string } => {
    const b = s["bid"];
    const j = s["job"];
    return {
      ...(typeof b === "string" && b ? { bid: b } : {}),
      ...(typeof j === "string" && j ? { job: j } : {}),
    };
  },
  component: InventoryRoute,
});

function InventoryRoute() {
  const { bid, job } = Route.useSearch();
  return <InventoryPage initialBidId={bid} initialServiceJobId={job} />;
}
