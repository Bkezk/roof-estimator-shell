import { createFileRoute, Navigate, Outlet, useChildMatches } from "@tanstack/react-router";

import { ServicePage } from "@/components/service-page";
import { isFieldOnly } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { parseServiceSearch } from "@/lib/service-search";

export const Route = createFileRoute("/service")({
  head: () => ({ meta: [{ title: "Service — JBK Portal" }] }),
  // ?id=<uuid> opens that ticket; ?new=1 opens a blank ticket, optionally prefilled with a
  // technician `tech=<uuid>` and a day `date=YYYY-MM-DD` (the Tech Board's "+"), with the
  // customer side of an earlier ticket `from=<ticket uuid>` ("New ticket for this site"), or
  // with a customer `account=<uuid>` and site `site=<uuid>` (the Customers page), or from an
  // opportunity `opportunity=<uuid>` (its "Start a ticket": customer, site, description); without
  // either the page lists tickets with its filters from the URL — `stage=` (a stage, or
  // `openwork`), `overdue=1` (the Customers page counts strip), `q=`, `tech=`, `type=` (owner,
  // Oct 9: the list keeps its filters and Back restores them). A ticket's `from=board&week=` /
  // `from=invoices` says where its Back link returns. Parsing: lib/service-search.ts.
  // Access is the central gate's (pageForPath: /service → Service). The list itself is the
  // office's (Oct 21): a technician-only user is sent to My tickets; a ticket (?id) still opens
  // for them, as the field page (components/service-page.tsx `fieldPage`).
  validateSearch: parseServiceSearch,
  component: ServiceRoute,
});

function ServiceRoute() {
  const search = Route.useSearch();
  // /service/board and /service/today are child routes of this file (flat-route nesting):
  // render them in place of the list.
  const children = useChildMatches();
  const { profile } = useAuth();
  if (children.length > 0) return <Outlet />;
  // The Tickets list (and a blank ticket, which the server refuses them) is the office's: a
  // technician-only user's page is My tickets (owner, Oct 21; the pattern of routes/my-work.tsx).
  if (!search.id && isFieldOnly(profile)) return <Navigate to="/service/today" replace />;
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
      q={search.q}
      tech={search.tech}
      type={search.type}
    />
  );
}
