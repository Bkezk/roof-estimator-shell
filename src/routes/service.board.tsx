import { createFileRoute } from "@tanstack/react-router";

import { BoardPage } from "@/components/service/board-page";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/service/board")({
  head: () => ({ meta: [{ title: "Tech Board — Bid-O-Matic" }] }),
  // The Tech Board (docs/service-module-design.md §5.2). ?week=YYYY-MM-DD shows the week that
  // holds that day (so Back from a ticket returns to the same week); without it, this week.
  // Access is the central gate's (pageForPath: /service/board → Service); the page itself
  // turns technicians away.
  validateSearch: (s: Record<string, unknown>): { week?: string } => {
    const w = s["week"];
    return typeof w === "string" && YMD.test(w) ? { week: w } : {};
  },
  component: BoardRoute,
});

function BoardRoute() {
  const { week } = Route.useSearch();
  return <BoardPage week={week} />;
}
