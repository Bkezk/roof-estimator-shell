import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Inbox, QrCode } from "lucide-react";

import { PublicRequestsPage } from "@/components/public-requests-page";
import { managesTickets } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { PUBLIC_REQUESTS_TITLE, PUBLIC_SETUP_PATH } from "@/lib/public-requests";

// Roof Care step 4 (Nov 21): what visitors sent through the two QR pages, held here until the
// office says who each one is.
//
// Nov 23 (owner: "we need to find somewhere else for the public requests"): it was a menu row of
// its own under Customers, at /customers/requests. A request from the public pages is a lead, so
// it now lives with Opportunities: this address, a "Public requests" button at the top of the
// Opportunities page, and the Opportunities row lit here. The old address sends people on
// (routes/customers_.requests.tsx), so a notice already sent still opens.
//
// Who may open it is unchanged: the central gate (access.ts pageForPath: this address is the
// Customers page's, as the old one was), the server (listPublicRequests) and the database
// (public_requests' read rule).
export const Route = createFileRoute("/opportunities_/requests")({
  head: () => ({ meta: [{ title: `${PUBLIC_REQUESTS_TITLE} — JBK Portal` }] }),
  component: RequestsRoute,
});

function RequestsRoute() {
  const { profile } = useAuth();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/opportunities"
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Opportunities
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Inbox className="h-6 w-6" /> {PUBLIC_REQUESTS_TITLE}
          </h1>
          <p className="text-sm text-muted-foreground">
            Sent by customers from the Roof Care plans page and the Request service page. Each one
            waits here until you say whose it is.
          </p>
        </div>
        {/* Setup is a manager's and an admin's: nobody else is shown a link they cannot open. */}
        {managesTickets(profile) && (
          <Link
            to={PUBLIC_SETUP_PATH}
            className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
          >
            <QrCode className="h-4 w-4" /> QR codes and settings
          </Link>
        )}
      </div>
      <PublicRequestsPage />
    </div>
  );
}
