import { createFileRoute } from "@tanstack/react-router";
import { BellRing } from "lucide-react";

import { RemindersSettings } from "@/components/reminders-settings";

// Owner, Sep 28: Reminders is its own Admin page (it used to be a tab of Estimate Pricing ›
// General). Access is the central gate's (pageForPath: /admin/reminders → admin).
export const Route = createFileRoute("/admin/reminders")({
  head: () => ({ meta: [{ title: "Reminders — JBK Portal" }] }),
  component: RemindersPage,
});

function RemindersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <BellRing className="h-6 w-6" /> Reminders
        </h1>
        <p className="text-sm text-muted-foreground">
          How long an opportunity or ticket may sit before it counts as untouched, how often the
          assignee is reminded, and who hears about untouched work.
        </p>
      </div>
      <RemindersSettings />
    </div>
  );
}
