import { useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, Loader2, Package, Receipt, Settings2, Truck } from "lucide-react";

import { seesEveryone } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { listLocations } from "@/lib/inventory.functions";
import {
  SetupFormsContext,
  shouldBlockLeaving,
  tabOfFormKey,
  type SetupForm,
  type SetupFormsRegistry,
} from "@/lib/setup-forms";
import { ServiceRatesSettings } from "@/components/service-rates-settings";
import { InspectionChecklistSettings } from "@/components/service/inspection-checklist-settings";
import { MaterialPricingSettings } from "@/components/service/material-pricing-settings";
import { VehicleDriversCard } from "@/components/inventory/vehicle-drivers-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Setup (owner, Oct 5): the Service Rates page renamed and moved from the Admin group to the
 * Customers group, under Opportunities, with Vehicles & drivers brought over from Inventory. One
 * page, three tabs so each part gets the whole screen: Service rates, Inspection checklist and
 * Vehicles & drivers — admins and managers (owner, Oct 9: "allow managers to set truck drivers";
 * setVehicleDrivers and RLS vehicle_drivers_write, 20261009130000, apply the same rule). ?tab=
 * deep-links a tab; /admin/service-rates redirects here. Access is the central gate's
 * (pageForPath: /setup → manager: admins and managers, as Service Rates was).
 *
 * Material pricing (owner, Oct 6): the service material price list repair tickets bill from,
 * separate from Estimate Pricing (the bids').
 *
 * Nov 4 (review items 1 and 5): a tab's card stays mounted once it has been opened (hidden, not
 * unmounted, when another tab is picked), so unsaved edits survive a tab switch; a tab with
 * unsaved edits carries a dot; leaving the page with unsaved edits asks — Stay / Leave without
 * saving / Save and leave, which saves every dirty card (lib/setup-forms.ts). The cards' own
 * data loads when their tab is first opened, nothing sooner. ?tab=vehicles waits for the profile
 * instead of painting Service rates first.
 */
export const SETUP_TABS = ["rates", "materials", "inspection", "vehicles"] as const;
export type SetupTab = (typeof SETUP_TABS)[number];

export const Route = createFileRoute("/setup")({
  validateSearch: (search: Record<string, unknown>): { tab?: SetupTab } =>
    SETUP_TABS.includes(search["tab"] as SetupTab) ? { tab: search["tab"] as SetupTab } : {},
  head: () => ({ meta: [{ title: "Setup — JBK Portal" }] }),
  component: SetupPage,
});

/** A visited tab's card: kept mounted, hidden while another tab is active. */
const KEEP = "mt-4 data-[state=inactive]:hidden";

const TAB_TITLES: Record<SetupTab, string> = {
  rates: "Service rates",
  materials: "Material pricing",
  inspection: "Inspection checklist",
  vehicles: "Vehicles & drivers",
};

function SetupPage() {
  const { profile } = useAuth();
  const navigate = useNavigate({ from: "/setup" });
  const { tab } = Route.useSearch();
  // Admins and managers set the drivers (owner, Oct 9); the gate already keeps everyone else off
  // the page, so this only guards a stale profile.
  const canSetDrivers = seesEveryone(profile);
  // Someone who may not set drivers but lands on ?tab=vehicles (an old link) sees the rates.
  const active: SetupTab = tab === "vehicles" && !canSetDrivers ? "rates" : (tab ?? "rates");
  // ?tab=vehicles before the profile has arrived: wait, rather than paint the rates and switch.
  const settling = tab === "vehicles" && !profile;

  // The tabs opened so far: their cards stay mounted (hidden) afterwards. (State set during
  // the render, as React allows for "what was shown before", so the card is there at once.)
  const [visited, setVisited] = useState<Set<SetupTab>>(() => new Set(settling ? [] : [active]));
  if (!settling && !visited.has(active)) setVisited((v) => new Set(v).add(active));

  // The cards' unsaved edits and saves (lib/setup-forms.ts).
  const forms = useRef(new Map<string, SetupForm>());
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);
  const registry = useMemo<SetupFormsRegistry>(
    () => ({
      register: (key, form) => {
        forms.current.set(key, form);
        setDirtyKeys((cur) => {
          const next = [...forms.current].filter(([, f]) => f.dirty).map(([k]) => k);
          return next.length === cur.length && next.every((k, i) => k === cur[i]) ? cur : next;
        });
      },
      unregister: (key) => {
        forms.current.delete(key);
        setDirtyKeys((cur) => cur.filter((k) => k !== key));
      },
    }),
    [],
  );
  const anyDirty = dirtyKeys.length > 0;
  const dirtyRef = useRef(false);
  dirtyRef.current = anyDirty;
  /** The tabs with unsaved edits (a dot on the tab; named in the leave dialog). */
  const marked = useMemo(() => new Set(dirtyKeys.map(tabOfFormKey)), [dirtyKeys]);

  // Leaving with unsaved edits asks (owner, Nov 4): Stay / Leave without saving / Save and
  // leave. A tab switch stays on /setup and never asks. Closing the browser tab keeps its own
  // warning.
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => shouldBlockLeaving(next.pathname, dirtyRef.current),
    withResolver: true,
    enableBeforeUnload: () => dirtyRef.current,
  });
  const [leaving, setLeaving] = useState(false);
  const stayHere = () => {
    setLeaving(false);
    if (blocker.status === "blocked") blocker.reset();
  };
  const saveAndLeave = async () => {
    setLeaving(true);
    try {
      await Promise.all([...forms.current.values()].filter((f) => f.dirty).map((f) => f.save()));
      if (blocker.status === "blocked") blocker.proceed();
    } catch {
      // The card's own toast says what failed; the user stays to see it.
      stayHere();
    }
  };

  const dot = (value: SetupTab) =>
    marked.has(value) ? (
      <span
        className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
        aria-label="unsaved changes"
        title="Unsaved changes"
        data-dot={value}
      />
    ) : null;
  // Mounted once visited; hidden (not unmounted) while another tab is active.
  const content = (value: SetupTab, node: ReactNode) =>
    visited.has(value) ? (
      <TabsContent value={value} forceMount className={KEEP}>
        {node}
      </TabsContent>
    ) : null;

  return (
    <SetupFormsContext.Provider value={registry}>
      <div className="max-w-5xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Settings2 className="h-6 w-6" /> Setup
          </h1>
          <p className="text-sm text-muted-foreground">
            How service work is priced and run: the rates and material prices invoices are built
            from, what an inspection asks about
            {canSetDrivers ? ", and who drives each vehicle" : ""}.
          </p>
        </div>
        {settling ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <Tabs
            value={active}
            onValueChange={(v) =>
              void navigate({ search: v === "rates" ? {} : { tab: v as SetupTab }, replace: true })
            }
          >
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="rates" className="gap-1.5">
                <Receipt className="h-4 w-4" aria-hidden /> {TAB_TITLES.rates}
                {dot("rates")}
              </TabsTrigger>
              <TabsTrigger value="materials" className="gap-1.5">
                <Package className="h-4 w-4" aria-hidden /> {TAB_TITLES.materials}
                {dot("materials")}
              </TabsTrigger>
              <TabsTrigger value="inspection" className="gap-1.5">
                <ClipboardList className="h-4 w-4" aria-hidden /> {TAB_TITLES.inspection}
                {dot("inspection")}
              </TabsTrigger>
              {canSetDrivers && (
                <TabsTrigger value="vehicles" className="gap-1.5">
                  <Truck className="h-4 w-4" aria-hidden /> Vehicles &amp; drivers
                  {dot("vehicles")}
                </TabsTrigger>
              )}
            </TabsList>
            {content("rates", <ServiceRatesSettings />)}
            {content("materials", <MaterialPricingSettings />)}
            {content("inspection", <InspectionChecklistSettings />)}
            {canSetDrivers && (
              <TabsContent value="vehicles" forceMount className={KEEP}>
                {visited.has("vehicles") && <VehiclesTab canSetDrivers={canSetDrivers} />}
              </TabsContent>
            )}
          </Tabs>
        )}

        <AlertDialog
          open={blocker.status === "blocked" && !leaving}
          onOpenChange={(o) => !o && stayHere()}
        >
          <AlertDialogContent data-dialog="leave-setup">
            <AlertDialogHeader>
              <AlertDialogTitle>Save changes to Setup?</AlertDialogTitle>
              <AlertDialogDescription>
                {[...marked].map((t) => TAB_TITLES[t as SetupTab]).join(", ") || "This page"}{" "}
                {marked.size > 1 ? "have" : "has"} changes that are not saved. Save them before you
                leave, or leave without saving — those changes are then lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={stayHere}>Stay</AlertDialogCancel>
              <Button
                variant="outline"
                onClick={() => {
                  if (blocker.status === "blocked") blocker.proceed();
                }}
              >
                Leave without saving
              </Button>
              <AlertDialogAction
                onClick={(e) => {
                  // Not the dialog's own close: it closes once the saves have gone through.
                  e.preventDefault();
                  void saveAndLeave();
                }}
              >
                Save and leave
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SetupFormsContext.Provider>
  );
}

/** The Vehicles & drivers tab: its vehicle list loads when the tab is first opened. */
function VehiclesTab({ canSetDrivers }: { canSetDrivers: boolean }) {
  const locationsFn = useServerFn(listLocations);
  // The same query (and cache) as the Inventory page.
  const locationsQ = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => locationsFn(),
    enabled: canSetDrivers,
  });
  return locationsQ.error ? (
    <p className="text-sm text-destructive">
      Could not load the vehicles:{" "}
      {locationsQ.error instanceof Error ? locationsQ.error.message : "unknown error"}
    </p>
  ) : (
    <VehicleDriversCard locations={locationsQ.data ?? []} />
  );
}
