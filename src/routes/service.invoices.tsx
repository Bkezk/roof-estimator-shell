import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/service/invoices-page";
import { invoiceSearch } from "@/lib/invoice-search";

export const Route = createFileRoute("/service/invoices")({
  head: () => ({ meta: [{ title: "Invoices — JBK Portal" }] }),
  // The Invoices list (docs/service-module-design.md §5.4–§5.5). ?tab=to-invoice opens the
  // "Awaiting invoice" queue (Done tickets waiting for their invoice; the Tickets list links
  // here); ?id=<invoice uuid> opens that invoice full width (owner, Oct 1). Parsing:
  // lib/invoice-search.ts. Access is the central gate's (pageForPath: /service/invoices →
  // Service); the page itself turns technicians away.
  validateSearch: invoiceSearch,
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { tab, id, status } = Route.useSearch();
  return <InvoicesPage toInvoice={tab === "to-invoice"} invoiceId={id} status={status} />;
}
