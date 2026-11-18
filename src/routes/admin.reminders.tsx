import { createFileRoute } from "@tanstack/react-router";
import { BellRing } from "lucide-react";

import { RemindersSettings } from "@/components/reminders-settings";
import { SettingsTabs } from "@/components/settings-tabs";

// Owner, Sep 28: Reminders is its own Admin page (it used to be a tab of Estimate Pricing ›
// General). Access is the central gate's (pageForPath: /admin/reminders → admin).
export const Route = createFileRoute("/admin/reminders")({
  head: () => ({ meta: [{ title: "Reminders — JBK Portal" }] }),
  component: RemindersPage,
});

function RemindersPage() {
  return (
    <div className="space-y-6">
      <SettingsTabs active="reminders" />
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <BellRing className="h-6 w-6" /> Reminders
        </h1>
        <p className="text-sm text-muted-foreground">
          Who is alerted about service tickets, opportunities and bids, and how often.
        </p>
      </div>
      <RemindersSettings />
    </div>
  );
}
