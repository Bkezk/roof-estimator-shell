import { createFileRoute } from "@tanstack/react-router";

import { PublicRequestPage } from "@/components/public/request-page";

// A public page: no sign-in (components/auth-gate.tsx lets this path and /care through, and
// nothing else). Printed inside a QR code, so the path is short and must not change.
export const Route = createFileRoute("/request")({
  head: () => ({
    meta: [
      { title: "Request Service | JBK Commercial Roofing" },
      {
        name: "description",
        content: "Tell JBK Commercial Roofing about your building and what you need.",
      },
      // Reached from a printed sheet, not from a search.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicRequestPage,
});
