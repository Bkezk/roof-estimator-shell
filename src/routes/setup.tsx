import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, Package, Receipt, Settings2, Truck } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listLocations } from "@/lib/inventory.functions";
import { ServiceRatesSettings } from "@/components/service-rates-settings";
import { InspectionChecklistSettings } from "@/components/service/inspection-checklist-settings";
import { MaterialPricingSettings } from "@/components/service/material-pricing-settings";
import { VehicleDriversCard } from "@/components/inventory/vehicle-drivers-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Setup (owner, Oct 5): the Service Rates page renamed and moved from the Admin group to the
 * Customers group, under Opportunities, with Vehicles & drivers brought over from Inventory. One
 * page, three tabs so each part gets the whole screen: Service rates, Inspection checklist and
 * (admins only — setVehicleDrivers is an admin write) Vehicles & drivers. ?tab= deep-links a tab;
 * /admin/service-rates redirects here. Access is the central gate's (pageForPath: /setup →
 * manager: admins and managers, as Service Rates was).
 *
 * Material pricing (owner, Oct 6): the service material price list repair tickets bill from,
 * separate from Estimate Pricing (the bids').
 */
export const SETUP_TABS = ["rates", "materials", "inspection", "vehicles"] as const;
export type SetupTab = (typeof SETUP_TABS)[number];

export const Route = createFileRoute("/setup")({
  validateSearch: (search: Record<string, unknown>): { tab?: SetupTab } =>
    SETUP_TABS.includes(search["tab"] as SetupTab) ? { tab: search["tab"] as SetupTab } : {},
  head: () => ({ meta: [{ title: "Setup — JBK Portal" }] }),
  component: SetupPage,
});

function SetupPage() {
  const { role } = useAuth();
  const navigate = useNavigate({ from: "/setup" });
  const { tab } = Route.useSearch();
  const isAdmin = role === "admin";
  // A manager who lands on ?tab=vehicles (an old link) sees the rates instead.
  const active: SetupTab = tab === "vehicles" && !isAdmin ? "rates" : (tab ?? "rates");
  const locationsFn = useServerFn(listLocations);
  // The same query (and cache) as the Inventory page.
  const locationsQ = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => locationsFn(),
    enabled: isAdmin,
  });

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Settings2 className="h-6 w-6" /> Setup
        </h1>
        <p className="text-sm text-muted-foreground">
          How service work is priced and run: the rates and material prices invoices are built from,
          what an inspection asks about{isAdmin ? ", and who drives each vehicle" : ""}.
        </p>
      </div>
      <Tabs
        value={active}
        onValueChange={(v) =>
          void navigate({ search: v === "rates" ? {} : { tab: v as SetupTab }, replace: true })
        }
      >
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="rates" className="gap-1.5">
            <Receipt className="h-4 w-4" aria-hidden /> Service rates
          </TabsTrigger>
          <TabsTrigger value="materials" className="gap-1.5">
            <Package className="h-4 w-4" aria-hidden /> Material pricing
          </TabsTrigger>
          <TabsTrigger value="inspection" className="gap-1.5">
            <ClipboardList className="h-4 w-4" aria-hidden /> Inspection checklist
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="vehicles" className="gap-1.5">
              <Truck className="h-4 w-4" aria-hidden /> Vehicles &amp; drivers
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="rates" className="mt-4">
          <ServiceRatesSettings />
        </TabsContent>
        <TabsContent value="materials" className="mt-4">
          <MaterialPricingSettings />
        </TabsContent>
        <TabsContent value="inspection" className="mt-4">
          <InspectionChecklistSettings />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="vehicles" className="mt-4">
            {locationsQ.error ? (
              <p className="text-sm text-destructive">
                Could not load the vehicles:{" "}
                {locationsQ.error instanceof Error ? locationsQ.error.message : "unknown error"}
              </p>
            ) : (
              <VehicleDriversCard locations={locationsQ.data ?? []} />
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
