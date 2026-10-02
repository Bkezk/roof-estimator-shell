import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The Follow-ups page is folded into Work Overview (owner, Oct 1: "the follow-up tab really isn't
 * necessary"). The route stays because emails, push notifications and old links point here: it
 * sends everyone to /my-work, where each row shows its follow-up state.
 */
export const Route = createFileRoute("/followups")({
  beforeLoad: () => {
    throw redirect({ to: "/my-work", replace: true });
  },
});
