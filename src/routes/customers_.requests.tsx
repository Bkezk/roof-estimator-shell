import { createFileRoute, Link } from "@tanstack/react-router";
import { Inbox, QrCode } from "lucide-react";

import { PublicRequestsPage } from "@/components/public-requests-page";
import { PUBLIC_REQUESTS_TITLE, PUBLIC_SETUP_PATH } from "@/lib/public-requests";

// Roof Care step 4 (Nov 21): what visitors sent through the two QR pages, held here until the
// office says who each one is. Access is the central gate's (pageForPath: /customers is
// Customers), the server's (listPublicRequests) and the database's (public_requests' read rule).
export const Route = createFileRoute("/customers_/requests")({
  head: () => ({ meta: [{ title: `${PUBLIC_REQUESTS_TITLE} — JBK Portal` }] }),
  component: RequestsRoute,
});

function RequestsRoute() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Inbox className="h-6 w-6" /> {PUBLIC_REQUESTS_TITLE}
          </h1>
          <p className="text-sm text-muted-foreground">
            Sent by customers from the Roof Care plans page and the Request service page. Each one
            waits here until you say whose it is.
          </p>
        </div>
        <Link
          to={PUBLIC_SETUP_PATH}
          className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
        >
          <QrCode className="h-4 w-4" /> QR codes and settings
        </Link>
      </div>
      <PublicRequestsPage />
    </div>
  );
}
