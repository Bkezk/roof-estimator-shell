import { createFileRoute, Outlet, useChildMatches } from "@tanstack/react-router";

import { ServicePage } from "@/components/service-page";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/service")({
  head: () => ({ meta: [{ title: "Service — Bid-O-Matic" }] }),
  // ?id=<uuid> opens that ticket; ?new=1 opens a blank ticket (optionally prefilled with a
  // technician `tech=<uuid>` and a day `date=YYYY-MM-DD`, from the Tech Board's "+"); without
  // either the page lists tickets. Access is the central gate's (pageForPath: /service →
  // Service).
  validateSearch: (
    s: Record<string, unknown>,
  ): { id?: string; closeout?: 1; new?: 1; tech?: string; date?: string } => {
    const id = s["id"];
    if (typeof id === "string" && id) {
      // closeout=1 (from Today) opens the ticket at its close-out.
      const c = s["closeout"];
      return c === 1 || c === "1" || c === true ? { id, closeout: 1 } : { id };
    }
    const n = s["new"];
    if (!(n === 1 || n === "1" || n === true)) return {};
    const tech = s["tech"];
    const date = s["date"];
    return {
      new: 1,
      ...(typeof tech === "string" && tech ? { tech } : {}),
      ...(typeof date === "string" && YMD.test(date) ? { date } : {}),
    };
  },
  component: ServiceRoute,
});

function ServiceRoute() {
  const search = Route.useSearch();
  // /service/board and /service/today are child routes of this file (flat-route nesting):
  // render them in place of the list.
  const children = useChildMatches();
  if (children.length > 0) return <Outlet />;
  return <ServicePage id={search.id} isNew={search.new === 1} closeout={search.closeout === 1} />;
}
