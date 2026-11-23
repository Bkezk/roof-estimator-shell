import { createFileRoute, redirect } from "@tanstack/react-router";

// The requests' first address (Nov 21). Every request is an opportunity now (Nov 23), so a
// notice or a bookmark that still carries this address is sent on to Opportunities.
export const Route = createFileRoute("/customers_/requests")({
  beforeLoad: () => {
    throw redirect({ to: "/opportunities", replace: true });
  },
});
