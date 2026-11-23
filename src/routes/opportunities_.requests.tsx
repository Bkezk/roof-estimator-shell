import { createFileRoute, redirect } from "@tanstack/react-router";

// The list "Requests from the public pages" lived here from Nov 23, and before that at
// /customers/requests. Later on Nov 23 the owner chose that every request becomes an
// opportunity the moment it is sent, so there is no list any more: a notice or a bookmark that
// still carries this address is sent on to Opportunities, where every request now is.
export const Route = createFileRoute("/opportunities_/requests")({
  beforeLoad: () => {
    throw redirect({ to: "/opportunities", replace: true });
  },
});
