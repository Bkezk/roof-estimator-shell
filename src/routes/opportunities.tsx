import { createFileRoute } from "@tanstack/react-router";

import { OpportunitiesPage } from "@/components/opportunities-page";
import { parseOpportunitiesSearch } from "@/lib/opportunities-search";

export const Route = createFileRoute("/opportunities")({
  head: () => ({ meta: [{ title: "Opportunities — JBK Portal" }] }),
  // ?id=<uuid> opens that opportunity; ?new=1 opens a blank one; without either the page lists
  // them, with its status chip preset by `status=` (a status, or `allopen`), `overdue=1` (the
  // Customers page counts strip) and `assignee=<id>` (one person's: the Owner view's numbers).
  // Parsing: lib/opportunities-search.ts. Access is the central
  // gate's (pageForPath: /opportunities → Customers).
  validateSearch: parseOpportunitiesSearch,
  component: OpportunitiesRoute,
});

function OpportunitiesRoute() {
  const search = Route.useSearch();
  return (
    <OpportunitiesPage
      id={search.id}
      isNew={search.new === 1}
      status={search.status}
      overdue={search.overdue === 1}
      assignee={search.assignee}
    />
  );
}
