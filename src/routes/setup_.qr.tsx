import { createFileRoute, useRouter, useRouterState } from "@tanstack/react-router";
import { QrCode } from "lucide-react";

import { PublicFormsSetup } from "@/components/public-forms-setup";
import { SetupHeading, SetupTabsList } from "@/components/setup-tabs";
import { Tabs } from "@/components/ui/tabs";
import { hasDocumentsAccess } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import {
  cameBySetupTab,
  SETUP_TAB_PRESSED,
  setupTabHref,
  type SetupStripTab,
} from "@/lib/menu-places";

// Roof Care step 4 (Nov 21): the QR codes for the printed sheets and the three settings behind
// the two public pages. Access is the central gate's (pageForPath: /setup is a manager's and an
// admin's), the server's and the database's.
//
// Nov 23 (owner: "currently the QR pages are not located under the setup tab"): it was a menu row
// of its own and he looked for it under Setup. It is now Setup's sixth tab: the same heading and
// strip as /setup, QR pages lit, as Documents is the fifth on a page of its own. The address is
// unchanged, and /setup?tab=qr comes here.
export const Route = createFileRoute("/setup_/qr")({
  head: () => ({ meta: [{ title: "QR pages — JBK Portal" }] }),
  component: QrRoute,
});

function QrRoute() {
  const router = useRouter();
  const { profile } = useAuth();
  const documents = hasDocumentsAccess(profile);
  // Opened from the strip on Setup's other pages: the QR pages tab takes the keyboard focus.
  const arrivedByTab = useRouterState({ select: (s) => cameBySetupTab(s.location.state) });
  return (
    <div className="space-y-4">
      {/* The gate lets only an admin or a manager here, so the four service tabs always show. */}
      <SetupHeading money documents={documents} />
      <Tabs
        value="qr"
        activationMode="manual"
        onValueChange={(v) => {
          if (v !== "qr")
            void router.navigate({
              href: setupTabHref(v as SetupStripTab),
              state: SETUP_TAB_PRESSED,
            });
        }}
      >
        <SetupTabsList money documents={documents} page="qr" takeFocus={arrivedByTab} />
      </Tabs>
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <QrCode className="h-5 w-5" /> QR pages
        </h2>
        <p className="text-sm text-muted-foreground">
          The codes for the printed sheets, and what the two public pages offer.
        </p>
      </div>
      <PublicFormsSetup />
    </div>
  );
}
