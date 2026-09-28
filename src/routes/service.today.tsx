import { createFileRoute } from "@tanstack/react-router";

import { TodayPage } from "@/components/service/today-page";

export const Route = createFileRoute("/service/today")({
  head: () => ({ meta: [{ title: "Today — JBK Portal" }] }),
  // The technician's day on the phone (docs/service-module-design.md §5.3). Access is the
  // central gate's (pageForPath: /service/today → Service); the server returns a technician's
  // own tickets only.
  component: TodayPage,
});
