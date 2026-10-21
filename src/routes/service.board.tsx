import { createFileRoute, Navigate } from "@tanstack/react-router";

import { BoardPage } from "@/components/service/board-page";
import { isFieldOnly } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/service/board")({
  head: () => ({ meta: [{ title: "Tech Board — JBK Portal" }] }),
  // The Tech Board (docs/service-module-design.md §5.2). ?week=YYYY-MM-DD shows the week that
  // holds that day (so Back from a ticket returns to the same week); without it, this week.
  // Access is the central gate's (pageForPath: /service/board → Service); the board is the
  // office's view (Oct 21): a technician-only user is sent to My tickets, their page.
  validateSearch: (s: Record<string, unknown>): { week?: string } => {
    const w = s["week"];
    return typeof w === "string" && YMD.test(w) ? { week: w } : {};
  },
  component: BoardRoute,
});

function BoardRoute() {
  const { week } = Route.useSearch();
  const { profile } = useAuth();
  // Owner, Oct 21: the Tech Board is the office's; a technician-only user works from My tickets.
  if (isFieldOnly(profile)) return <Navigate to="/service/today" replace />;
  return <BoardPage week={week} />;
}
