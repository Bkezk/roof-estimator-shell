// customers_.$id: a customer's own page (owner, Oct 14: "when you click the card it takes you
// to the customer profile which has its own page"). The underscore keeps it out of the
// Customers list route's tree, as prospect_.leads does. /customers?id=<uuid>, the old address
// every customer link in the app still uses, redirects here (routes/customers.tsx).
import { createFileRoute } from "@tanstack/react-router";

import { CustomerPage } from "@/components/customers-page";

export const Route = createFileRoute("/customers_/$id")({
  head: () => ({ meta: [{ title: "Customer — JBK Portal" }] }),
  component: CustomerRoute,
});

function CustomerRoute() {
  const { id } = Route.useParams();
  return <CustomerPage key={id} id={id} />;
}
