import { createFileRoute } from "@tanstack/react-router";

import { InventoryPage } from "@/components/inventory-page";

export const Route = createFileRoute("/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Bid-O-Matic" }] }),
  component: InventoryPage,
});
