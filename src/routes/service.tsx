import { createFileRoute, Outlet, useChildMatches } from "@tanstack/react-router";

import { ServicePage } from "@/components/service-page";
import { parseServiceSearch } from "@/lib/service-search";

export const Route = createFileRoute("/service")({
  head: () => ({ meta: [{ title: "Service — JBK Portal" }] }),
  // ?id=<uuid> opens that ticket; ?new=1 opens a blank ticket, optionally prefilled with a
  // technician `tech=<uuid>` and a day `date=YYYY-MM-DD` (the Tech Board's "+"), with the
  // customer side of an earlier ticket `from=<ticket uuid>` ("New ticket for this site"), or
  // with a customer `account=<uuid>` and site `site=<uuid>` (the Customers page), or from an
  // opportunity `opportunity=<uuid>` (its "Start a ticket": customer, site, description); without
  // either the page lists tickets, with its stage chip preset by `stage=` (a stage, or
  // `openwork`) and `overdue=1` (the Customers page counts strip). Parsing: lib/service-search.ts.
  // Access is the central gate's (pageForPath: /service → Service).
  validateSearch: parseServiceSearch,
  component: ServiceRoute,
});

function ServiceRoute() {
  const search = Route.useSearch();
  // /service/board and /service/today are child routes of this file (flat-route nesting):
  // render them in place of the list.
  const children = useChildMatches();
  if (children.length > 0) return <Outlet />;
  return (
    <ServicePage
      id={search.id}
      isNew={search.new === 1}
      closeout={search.closeout === 1}
      from={search.from}
      account={search.account}
      site={search.site}
      opportunity={search.opportunity}
      stage={search.stage}
      overdue={search.overdue === 1}
    />
  );
}
