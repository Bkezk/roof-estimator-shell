import { createFileRoute, redirect } from "@tanstack/react-router";

import { PUBLIC_REQUESTS_PATH } from "@/lib/public-requests";

// The list's first address (Nov 21). On Nov 23 it moved to Opportunities; a notice or a bookmark
// that still carries this address is sent on, so it opens the same list.
export const Route = createFileRoute("/customers_/requests")({
  beforeLoad: () => {
    throw redirect({ to: PUBLIC_REQUESTS_PATH, replace: true });
  },
});
