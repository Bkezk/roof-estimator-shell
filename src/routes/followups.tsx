import { createFileRoute } from "@tanstack/react-router";

import { FollowupsPage } from "@/components/followups-page";

export const Route = createFileRoute("/followups")({
  head: () => ({ meta: [{ title: "Follow-ups — Bid-O-Matic" }] }),
  // Every signed-in user (pageForPath: /followups → null); the server returns only the
  // follow-ups the user may see.
  component: FollowupsPage,
});
