import { createFileRoute } from "@tanstack/react-router";

import { ServicePage } from "@/components/service-page";

export const Route = createFileRoute("/service")({
  head: () => ({ meta: [{ title: "Service — Bid-O-Matic" }] }),
  // ?id=<uuid> opens that ticket; ?new=1 opens a blank ticket; without either the page lists
  // tickets. Access is the central gate's (pageForPath: /service → Service).
  validateSearch: (s: Record<string, unknown>): { id?: string; new?: 1 } => {
    const id = s["id"];
    if (typeof id === "string" && id) return { id };
    const n = s["new"];
    return n === 1 || n === "1" || n === true ? { new: 1 } : {};
  },
  component: ServiceRoute,
});

function ServiceRoute() {
  const search = Route.useSearch();
  return <ServicePage id={search.id} isNew={search.new === 1} />;
}
