import { createFileRoute } from "@tanstack/react-router";

import { PriceImportPage } from "@/components/price-import-page";

export const Route = createFileRoute("/admin/price-import")({
  head: () => ({ meta: [{ title: "Price List Import — JBK Portal" }] }),
  component: PriceImportPage,
});
