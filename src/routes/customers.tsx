import { createFileRoute } from "@tanstack/react-router";

import { CustomersPage } from "@/components/customers-page";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Customers — JBK Portal" }] }),
  // ?id=<uuid> opens that customer beside the list; ?tab=vendors is the Vendors tab. Access is
  // the central gate's (pageForPath: /customers → Customers).
  validateSearch: (s: Record<string, unknown>): { id?: string; tab?: "vendors" } => {
    const id = s["id"];
    const out: { id?: string; tab?: "vendors" } = {};
    if (typeof id === "string" && id) out.id = id;
    if (s["tab"] === "vendors") out.tab = "vendors";
    return out;
  },
  component: CustomersRoute,
});

function CustomersRoute() {
  const { id, tab } = Route.useSearch();
  return <CustomersPage id={id} tab={tab} />;
}
