/**
 * "Materials & POs" (owner, Oct 27): the ticket page's Materials fold and Purchase orders fold
 * as ONE collapsible fold with two tabs, Materials first, the Work fold's pattern
 * (ticket-field-sections.tsx WorkFold). The fold opens by default where the Materials fold did —
 * a technician on an Open / Scheduled ticket logs material here, a manager reviewing a Done /
 * Authorized ticket (its own remembered key) — else folded, remembered under "materials-pos".
 * The two bodies render unchanged inside their tabs: the Materials body the page hands in (the
 * logging screen, or the read-only list for a login that may not log) and the Purchase orders
 * body (`embedded`; its own queries, permissions and approval rule untouched). The last tab is
 * remembered per device. Serves the office column and the technician's one-column page alike.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Package, Receipt } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listServiceJobMaterials } from "@/lib/service.functions";
import { listPurchaseOrders } from "@/lib/service-pos.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Box } from "@/components/service/field-shared";
import { fieldKeys } from "@/components/service/field-utils";
import {
  MATERIALS_TAB_KEY,
  materialsPosSummary,
  readMaterialsTab,
  ticketLineCount,
  type MaterialsTab,
} from "@/components/service/materials-pos";
import { PurchaseOrdersSection } from "@/components/service/purchase-orders-section";

function initialMaterialsTab(): MaterialsTab {
  try {
    return readMaterialsTab(window.localStorage.getItem(MATERIALS_TAB_KEY));
  } catch {
    return "materials"; // no window (SSR), or storage blocked
  }
}
function rememberMaterialsTab(tab: MaterialsTab) {
  try {
    window.localStorage.setItem(MATERIALS_TAB_KEY, tab);
  } catch {
    // Storage blocked (private mode, blocked site data): the tab still switches this visit.
  }
}

export function MaterialsPosFold({
  jobId,
  defaultOpen,
  storageKey = "materials-pos",
  materials,
}: {
  jobId: string;
  /** Its first open state (the remembered one wins once toggled) — the Materials fold's rule. */
  defaultOpen: boolean;
  /** "materials-pos", or "materials-pos-review" for a manager's review (remembered apart). */
  storageKey?: "materials-pos" | "materials-pos-review" | undefined;
  /** The Materials tab's body: MaterialsSection (non-collapsible), or the read-only list. */
  materials: React.ReactNode;
}) {
  const { session } = useAuth();
  const materialsFn = useServerFn(listServiceJobMaterials);
  const posFn = useServerFn(listPurchaseOrders);
  // The same keys the two bodies read, so the fold's line shares their cache (and the
  // Materials body's 30 s freshness, S13).
  const ledger = useQuery({
    queryKey: fieldKeys.materials(jobId),
    queryFn: () => materialsFn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 30_000,
  });
  const pos = useQuery({
    queryKey: fieldKeys.pos(jobId),
    queryFn: () => posFn({ data: { jobId } }),
    enabled: !!session,
  });
  const [tab, setTab] = useState<MaterialsTab>(initialMaterialsTab);
  const summary =
    ledger.error || pos.error ? (
      <span className="text-destructive">could not load</span>
    ) : (
      materialsPosSummary({
        lines: ledger.data ? ticketLineCount(ledger.data) : null,
        pos: pos.data?.pos ?? null,
      }) || null
    );
  const tabIcon = "mr-1 h-4 w-4";
  return (
    <Box
      title="Materials & POs"
      icon={Package}
      collapsible
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      summary={summary}
    >
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const t = readMaterialsTab(v);
          setTab(t);
          rememberMaterialsTab(t);
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-2" aria-label="Materials & POs">
          <TabsTrigger value="materials" className="min-h-9">
            <Package className={tabIcon} aria-hidden /> Materials
          </TabsTrigger>
          <TabsTrigger value="pos" className="min-h-9">
            <Receipt className={tabIcon} aria-hidden /> Purchase orders
          </TabsTrigger>
        </TabsList>
        <TabsContent value="materials" className="mt-3">
          {materials}
        </TabsContent>
        <TabsContent value="pos" className="mt-3">
          <PurchaseOrdersSection jobId={jobId} embedded />
        </TabsContent>
      </Tabs>
    </Box>
  );
}
