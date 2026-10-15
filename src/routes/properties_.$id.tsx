// properties_.$id: a property's own page (owner, Oct 15: "make it to where you can click a
// property to open its own page where you can see its details, how many tickets were there, its
// sites, etc."). The underscore keeps it a top-level route, /properties/<uuid>, as customers_.$id
// does for /customers/<uuid>; there is no /properties list — properties live on their customer.
import { createFileRoute } from "@tanstack/react-router";

import { PropertyPage } from "@/components/property-page";

export const Route = createFileRoute("/properties_/$id")({
  head: () => ({ meta: [{ title: "Property — JBK Portal" }] }),
  component: PropertyRoute,
});

function PropertyRoute() {
  const { id } = Route.useParams();
  return <PropertyPage key={id} id={id} />;
}
