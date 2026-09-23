import { createFileRoute } from "@tanstack/react-router";

import { ProspectPage } from "@/components/prospect-page";

export const Route = createFileRoute("/prospect")({
  head: () => ({ meta: [{ title: "Buildings — Bid-O-Matic" }] }),
  // ?building=<id> opens that building (links from a bid, a task, a report card).
  validateSearch: (s: Record<string, unknown>): { building?: string } => {
    const b = s["building"];
    return typeof b === "string" && b ? { building: b } : {};
  },
  component: ProspectRoute,
});

function ProspectRoute() {
  const { building } = Route.useSearch();
  return <ProspectPage initialBuildingId={building} />;
}
