import { createFileRoute } from "@tanstack/react-router";

import { ProspectPage } from "@/components/prospect-page";

export const Route = createFileRoute("/prospect")({
  head: () => ({ meta: [{ title: "Buildings — JBK Portal" }] }),
  // ?building=<id> opens that building (links from a bid, a task, a report card).
  // ?storm=1 opens with the Storm hit filter on (the "new storm call points" notification).
  validateSearch: (s: Record<string, unknown>): { building?: string; storm?: 1 } => {
    const b = s["building"];
    const st = s["storm"];
    return {
      ...(typeof b === "string" && b ? { building: b } : {}),
      ...(st === 1 || st === "1" || st === true ? { storm: 1 as const } : {}),
    };
  },
  component: ProspectRoute,
});

function ProspectRoute() {
  const { building, storm } = Route.useSearch();
  return <ProspectPage initialBuildingId={building} initialStorm={storm === 1} />;
}
