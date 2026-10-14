import { createFileRoute, redirect } from "@tanstack/react-router";

import { CustomersPage } from "@/components/customers-page";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Customers — JBK Portal" }] }),
  // ?id=<uuid> is a customer's old address (every customer link in the app): it redirects to the
  // customer's own page, /customers/<uuid> (owner, Oct 14). ?tab=vendors is the Vendors tab.
  // Access is the central gate's (pageForPath: /customers → Customers).
  validateSearch: (s: Record<string, unknown>): { id?: string; tab?: "vendors" } => {
    const id = s["id"];
    const out: { id?: string; tab?: "vendors" } = {};
    if (typeof id === "string" && id) out.id = id;
    if (s["tab"] === "vendors") out.tab = "vendors";
    return out;
  },
  beforeLoad: ({ search }) => {
    if (search.id)
      throw redirect({ to: "/customers/$id", params: { id: search.id }, replace: true });
  },
  component: CustomersRoute,
});

function CustomersRoute() {
  const { tab } = Route.useSearch();
  return <CustomersPage tab={tab} />;
}
