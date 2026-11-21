// properties_.$id: a property's own page (owner, Oct 15: "make it to where you can click a
// property to open its own page where you can see its details, how many tickets were there, its
// sites, etc."). The underscore keeps it a top-level route, /properties/<uuid>, as customers_.$id
// does for /customers/<uuid>; there is no /properties list — properties live on their customer.
import { createFileRoute } from "@tanstack/react-router";

import { PropertyPage } from "@/components/property-page";
import { careRequestFromSearch } from "@/lib/public-requests";

export const Route = createFileRoute("/properties_/$id")({
  head: () => ({ meta: [{ title: "Property — JBK Portal" }] }),
  // `care_request`: a Roof Care request from the public page, matched to this property by the
  // office (Nov 21). The sign-up opens with what the customer typed. Anything that is not a
  // request's id is dropped.
  validateSearch: (search: Record<string, unknown>): { care_request?: string } =>
    careRequestFromSearch(search),
  component: PropertyRoute,
});

function PropertyRoute() {
  const { id } = Route.useParams();
  const { care_request } = Route.useSearch();
  return <PropertyPage key={id} id={id} careRequest={care_request ?? null} />;
}
