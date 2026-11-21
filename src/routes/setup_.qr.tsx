import { createFileRoute } from "@tanstack/react-router";
import { QrCode } from "lucide-react";

import { PublicFormsSetup } from "@/components/public-forms-setup";

// Roof Care step 4 (Nov 21): the QR codes for the printed sheets and the three settings behind
// the two public pages. Access is the central gate's (pageForPath: /setup is a manager's and an
// admin's), the server's and the database's.
export const Route = createFileRoute("/setup_/qr")({
  head: () => ({ meta: [{ title: "QR pages — JBK Portal" }] }),
  component: QrRoute,
});

function QrRoute() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <QrCode className="h-6 w-6" /> QR pages
        </h1>
        <p className="text-sm text-muted-foreground">
          The codes for the printed sheets, and what the two public pages offer.
        </p>
      </div>
      <PublicFormsSetup />
    </div>
  );
}
