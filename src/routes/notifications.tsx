import { createFileRoute } from "@tanstack/react-router";

import { NotificationsPage } from "@/components/notifications-page";

/**
 * The full inbox (owner, Oct 12). Every signed-in user (pageForPath: null — the rows are their
 * own under RLS). Reached from the bell's "See all" and the Account page, not the sidebar.
 */
export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — JBK Portal" }] }),
  component: NotificationsPage,
});
