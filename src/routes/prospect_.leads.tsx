// prospect_.leads: the underscore keeps this page OUT of the Buildings route's tree (that page
// renders no <Outlet />, so a nested /prospect/leads showed Buildings instead — owner, Sep 29).
import { createFileRoute } from "@tanstack/react-router";

import { LeadsPage } from "@/components/leads-page";

export const Route = createFileRoute("/prospect_/leads")({
  head: () => ({ meta: [{ title: "Bid Board — JBK Portal" }] }),
  // ?roof=1 opens with the roof-only filter on (the "new roof leads" notification).
  validateSearch: (s: Record<string, unknown>): { roof?: 1 } => {
    const r = s["roof"];
    return r === 1 || r === "1" || r === true ? { roof: 1 as const } : {};
  },
  component: LeadsRoute,
});

function LeadsRoute() {
  const { roof } = Route.useSearch();
  return <LeadsPage initialRoofOnly={roof === 1} />;
}
