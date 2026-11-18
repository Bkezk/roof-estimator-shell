import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

import { RoofCareSettingsPage } from "@/components/roof-care-settings";
import { SettingsTabs } from "@/components/settings-tabs";

// Owner, Nov 18: Roof Care plans (docs/roof-care-plans.md). The numbers the plan prices are
// worked from, and a place to try a building. Access is the central gate's (pageForPath:
// /admin/roof-care is admin), the server's and the database's.
export const Route = createFileRoute("/admin/roof-care")({
  head: () => ({ meta: [{ title: "Roof Care plans — JBK Portal" }] }),
  component: RoofCarePage,
});

function RoofCarePage() {
  return (
    <div className="space-y-6">
      <SettingsTabs active="roof-care" />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ShieldCheck className="h-6 w-6" /> Roof Care plans
        </h1>
        <p className="text-sm text-muted-foreground">
          What a plan costs the customer and what it costs us, and how the price follows the drive
          from the office.
        </p>
      </div>
      <RoofCareSettingsPage />
    </div>
  );
}
