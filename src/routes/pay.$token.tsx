import { createFileRoute } from "@tanstack/react-router";

import { PublicPayPage } from "@/components/public/pay-page";

// A Roof Care customer's own card payment link (Nov 23): a public page, no sign-in
// (components/auth-gate.tsx lets a path that is exactly /pay/<token> through). The token is a
// long random one that belongs to one plan. The address is inside emails, so it must not change.
export const Route = createFileRoute("/pay/$token")({
  head: () => ({
    meta: [
      { title: "Pay for your Roof Care plan | JBK Commercial Roofing" },
      // Reached from an email to one customer, never from a search.
      { name: "robots", content: "noindex, nofollow" },
      // The address holds the token: it is never sent on to another site as where one came from.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PayRoute,
});

function PayRoute() {
  const { token } = Route.useParams();
  return <PublicPayPage token={token} />;
}
