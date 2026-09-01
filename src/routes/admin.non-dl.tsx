import { createFileRoute } from "@tanstack/react-router";
import { CatalogEditor } from "@/components/catalog-editor";

export const Route = createFileRoute("/admin/non-dl")({
  head: () => ({ meta: [{ title: "Non-DL Pricing — Bid-O-Matic" }] }),
  component: () => (
    <CatalogEditor
      branch="non_dl"
      title="Non-Duro-Last Pricing"
      intro="Lumber, sheet metal, masonry, subcontractors, services and custom applications. Prices feed the Non-D/L items in a bid."
    />
  ),
});
