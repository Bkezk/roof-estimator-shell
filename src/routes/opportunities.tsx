import { createFileRoute } from "@tanstack/react-router";

import { OpportunitiesPage } from "@/components/opportunities-page";

export const Route = createFileRoute("/opportunities")({
  head: () => ({ meta: [{ title: "Opportunities — Bid-O-Matic" }] }),
  // ?id=<uuid> opens that opportunity; ?new=1 opens a blank one; without either the page lists
  // them. Access is the central gate's (pageForPath: /opportunities → Customers).
  validateSearch: (s: Record<string, unknown>): { id?: string; new?: 1 } => {
    const id = s["id"];
    if (typeof id === "string" && id) return { id };
    const n = s["new"];
    return n === 1 || n === "1" || n === true ? { new: 1 } : {};
  },
  component: OpportunitiesRoute,
});

function OpportunitiesRoute() {
  const search = Route.useSearch();
  return <OpportunitiesPage id={search.id} isNew={search.new === 1} />;
}
