import { createFileRoute } from "@tanstack/react-router";

import { CustomersPage } from "@/components/customers-page";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "Customers — JBK Portal" }] }),
  // ?id=<uuid> opens that customer beside the list. Access is the central gate's
  // (pageForPath: /customers → Customers).
  validateSearch: (s: Record<string, unknown>): { id?: string } => {
    const id = s["id"];
    return typeof id === "string" && id ? { id } : {};
  },
  component: CustomersRoute,
});

function CustomersRoute() {
  const { id } = Route.useSearch();
  return <CustomersPage id={id} />;
}
