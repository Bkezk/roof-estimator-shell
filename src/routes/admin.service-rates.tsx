import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Service Rates became the Setup page (owner, Oct 5), under Opportunities in the Customers group.
 * The old address stays for bookmarks and sends everyone to /setup (its first tab is the rates).
 */
export const Route = createFileRoute("/admin/service-rates")({
  beforeLoad: () => {
    throw redirect({ to: "/setup", replace: true });
  },
});
