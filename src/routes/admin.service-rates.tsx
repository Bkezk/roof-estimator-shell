import { createFileRoute } from "@tanstack/react-router";
import { Receipt } from "lucide-react";

import { ServiceRatesSettings } from "@/components/service-rates-settings";
import { InspectionChecklistSettings } from "@/components/service/inspection-checklist-settings";

// Owner, Sep 28: Service Rates is its own Admin page (it used to be a tab of Estimate Pricing ›
// General). Access is the central gate's (pageForPath: /admin/service-rates → pricing: managers
// and admins, owner Oct 1).
export const Route = createFileRoute("/admin/service-rates")({
  head: () => ({ meta: [{ title: "Service Rates — JBK Portal" }] }),
  component: ServiceRatesPage,
});

function ServiceRatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Receipt className="h-6 w-6" /> Service Rates
        </h1>
        <p className="text-sm text-muted-foreground">
          Travel and labor rates per rate kind and role, the material markup and the tax rate that
          service invoices are built from.
        </p>
      </div>
      <ServiceRatesSettings />
      <InspectionChecklistSettings />
    </div>
  );
}
