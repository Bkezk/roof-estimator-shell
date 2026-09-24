import { createFileRoute } from "@tanstack/react-router";

import { TakeoffPage } from "@/components/takeoff-page";

export const Route = createFileRoute("/takeoff")({
  head: () => ({ meta: [{ title: "Takeoff — Bid-O-Matic" }] }),
  // ?id=<uuid> opens that takeoff in the editor; without it the page lists takeoffs.
  validateSearch: (s: Record<string, unknown>): { id?: string } => {
    const id = s["id"];
    return typeof id === "string" && id ? { id } : {};
  },
  component: TakeoffRoute,
});

function TakeoffRoute() {
  const { id } = Route.useSearch();
  return <TakeoffPage id={id} />;
}
