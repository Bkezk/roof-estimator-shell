import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/service/invoices-page";

export const Route = createFileRoute("/service/invoices")({
  head: () => ({ meta: [{ title: "Invoices — Bid-O-Matic" }] }),
  // The Invoices list (docs/service-module-design.md §5.4–§5.5). Access is the central gate's
  // (pageForPath: /service/invoices → Service); the page itself turns technicians away.
  component: InvoicesPage,
});
