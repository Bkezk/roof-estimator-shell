import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/service/invoices-page";

export const Route = createFileRoute("/service/invoices")({
  head: () => ({ meta: [{ title: "Invoices — Bid-O-Matic" }] }),
  // The Invoices list (docs/service-module-design.md §5.4–§5.5). ?tab=to-invoice opens the
  // "To invoice" queue (Done tickets waiting for their invoice; the Tickets list links here).
  // Access is the central gate's (pageForPath: /service/invoices → Service); the page itself
  // turns technicians away.
  validateSearch: (s: Record<string, unknown>): { tab?: "to-invoice" } =>
    s["tab"] === "to-invoice" ? { tab: "to-invoice" } : {},
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { tab } = Route.useSearch();
  return <InvoicesPage toInvoice={tab === "to-invoice"} />;
}
