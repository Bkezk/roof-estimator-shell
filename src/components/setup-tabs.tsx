/**
 * Setup's heading and tab strip, shared by the two pages that make up Setup (owner, Nov 16:
 * "I think documents may should fall under the setup page as another tab option"). The four
 * service tabs live on /setup (routes/setup.tsx); Documents — the templates, saved snippets and
 * PDF library — keeps its own page and address (/admin/documents) and shows this same heading
 * and strip with Documents lit, so it reads and works as Setup's fifth tab.
 *
 * Who sees which tab, the names and the addresses: lib/menu-places.ts.
 */
import type { ReactNode } from "react";
import { ClipboardList, Files, Package, Receipt, Settings2, Truck } from "lucide-react";

import { SETUP_TAB_TITLES, setupBlurb, setupTabsFor, type SetupStripTab } from "@/lib/menu-places";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS = {
  rates: Receipt,
  materials: Package,
  inspection: ClipboardList,
  vehicles: Truck,
  documents: Files,
} as const;

export function SetupHeading(props: { money: boolean; documents: boolean }) {
  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Settings2 className="h-6 w-6" /> Setup
      </h1>
      <p className="text-sm text-muted-foreground">{setupBlurb(props)}</p>
    </div>
  );
}

/** The strip itself; it goes inside a <Tabs> whose value is the lit tab. */
export function SetupTabsList(props: {
  money: boolean;
  documents: boolean;
  /** A marker after a tab's name (Setup's "unsaved changes" dot). */
  dot?: (tab: SetupStripTab) => ReactNode;
}) {
  return (
    <TabsList className="h-auto flex-wrap" data-setup-tabs>
      {setupTabsFor(props).map((tab) => {
        const Icon = ICONS[tab];
        return (
          <TabsTrigger key={tab} value={tab} className="gap-1.5">
            <Icon className="h-4 w-4" aria-hidden /> {SETUP_TAB_TITLES[tab]}
            {props.dot?.(tab)}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
