import { createFileRoute } from "@tanstack/react-router";

import { PublicCarePage } from "@/components/public/care-page";

// A public page: no sign-in (components/auth-gate.tsx lets this path and /request through, and
// nothing else). Printed inside a QR code, so the path is short and must not change.
export const Route = createFileRoute("/care")({
  head: () => ({
    meta: [
      { title: "Roof Care Plans | JBK Commercial Roofing" },
      {
        name: "description",
        content:
          "Two roof inspections a year, spring and fall, with a photo report after every visit. See the price for your building.",
      },
      // Reached from a printed sheet, not from a search.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicCarePage,
});
