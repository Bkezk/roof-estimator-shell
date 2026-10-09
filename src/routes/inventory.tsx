import { createFileRoute } from "@tanstack/react-router";

import { InventoryPage } from "@/components/inventory-page";
import { parseInventorySearch } from "@/lib/inventory-search";

export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Inventory — JBK Portal" }] }),
  // ?tab=stock|history|reconcile, ?bid=<id>, ?job=<id>: src/lib/inventory-search.ts.
  validateSearch: parseInventorySearch,
  component: InventoryRoute,
});

function InventoryRoute() {
  const { tab, bid, job } = Route.useSearch();
  return <InventoryPage tab={tab} initialBidId={bid} initialServiceJobId={job} />;
}
