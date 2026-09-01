import { createFileRoute } from "@tanstack/react-router";
import { CatalogEditor } from "@/components/catalog-editor";

export const Route = createFileRoute("/admin/duro-last")({
  head: () => ({ meta: [{ title: "Duro-Last Pricing — Bid-O-Matic" }] }),
  component: () => (
    <CatalogEditor
      branch="duro_last"
      title="Duro-Last Pricing"
      intro="Duro-Last membrane, underlayment, fasteners, sealants, flashings, drains and accessories. Prices feed the Duro-Last items in a bid."
    />
  ),
});
