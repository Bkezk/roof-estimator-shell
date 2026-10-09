import { createFileRoute } from "@tanstack/react-router";

import { TodayPage } from "@/components/service/today-page";

export const Route = createFileRoute("/service/today")({
  head: () => ({ meta: [{ title: "My tickets — JBK Portal" }] }),
  // My tickets: the technician's day on the phone (docs/service-module-design.md §5.3). Access
  // is the central gate's (pageForPath: /service/today → Service); the server returns the
  // signed-in person's own tickets only, whoever they are (owner, Oct 9).
  component: TodayPage,
});
