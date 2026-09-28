import { createFileRoute } from "@tanstack/react-router";

import { LeadsPage } from "@/components/leads-page";

export const Route = createFileRoute("/prospect/leads")({
  head: () => ({ meta: [{ title: "Leads — JBK Portal" }] }),
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
