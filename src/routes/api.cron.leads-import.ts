/**
 * POST /api/cron/leads-import — the nightly browser job's rows (Tennessee leads, round three).
 * Metro Nashville's and the City of Chattanooga's bid lists only render in a browser, so
 * .github/workflows/browser-bids.yml reads them in headless Chromium (scripts/browser-bids.ts)
 * and posts one portal at a time here, with `Authorization: Bearer <LOVABLE_CRON_SECRET>` like
 * the other cron routes. The body is checked with zod (src/lib/leads-browser.ts) and saved
 * the way a refresh saves a list (leads.server.ts, importBrowserBids). POST only.
 */
import { createFileRoute } from "@tanstack/react-router";

import { importRequest } from "@/lib/leads-import.server";

export const Route = createFileRoute("/api/cron/leads-import")({
  server: {
    handlers: {
      POST: ({ request }) => importRequest(request),
    },
  },
});
