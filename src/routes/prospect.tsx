import { createFileRoute } from "@tanstack/react-router";

import { ProspectPage } from "@/components/prospect-page";

export const Route = createFileRoute("/prospect")({
  head: () => ({ meta: [{ title: "Buildings — JBK Portal" }] }),
  // ?building=<id> opens that building (links from a bid, a task, a report card).
  // ?storm=1 opens with the Storm hit filter on (the "new storm call points" notification).
  // ?at=lat,lng flies the map to that point with the outlines on (a Louisville permit lead).
  // ?q=<text> opens with that search typed in (a permit lead with no point).
  validateSearch: (
    s: Record<string, unknown>,
  ): { building?: string; storm?: 1; at?: string; q?: string } => {
    const b = s["building"];
    const st = s["storm"];
    const at = s["at"];
    const q = s["q"];
    return {
      ...(typeof b === "string" && b ? { building: b } : {}),
      ...(st === 1 || st === "1" || st === true ? { storm: 1 as const } : {}),
      ...(typeof at === "string" && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(at) ? { at } : {}),
      ...(typeof q === "string" && q.trim() ? { q: q.trim().slice(0, 120) } : {}),
    };
  },
  component: ProspectRoute,
});

function ProspectRoute() {
  const { building, storm, at, q } = Route.useSearch();
  const [lat, lng] = at ? at.split(",").map(Number) : [];
  return (
    <ProspectPage
      initialBuildingId={building}
      initialStorm={storm === 1}
      initialAt={lat !== undefined && lng !== undefined ? { lat, lng } : undefined}
      initialQuery={q}
    />
  );
}
