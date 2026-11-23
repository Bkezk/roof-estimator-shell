/**
 * Setup's heading and tab strip, shared by the two pages that make up Setup (owner, Nov 16:
 * "I think documents may should fall under the setup page as another tab option"). The four
 * service tabs live on /setup (routes/setup.tsx); Documents — the templates, saved snippets and
 * PDF library — keeps its own page and address (/admin/documents) and shows this same heading
 * and strip with Documents lit, so it reads and works as Setup's fifth tab.
 *
 * Who sees which tab, the names and the addresses: lib/menu-places.ts.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { ClipboardList, Files, Package, QrCode, Receipt, Settings2, Truck } from "lucide-react";

import {
  SETUP_TAB_TITLES,
  setupBlurb,
  setupTabHasPanel,
  setupTabsFor,
  type SetupStripPage,
  type SetupStripTab,
} from "@/lib/menu-places";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS = {
  rates: Receipt,
  materials: Package,
  inspection: ClipboardList,
  vehicles: Truck,
  documents: Files,
  qr: QrCode,
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

/** A tab with no panel on this page claims none (the tab library names one for every tab). */
const NO_PANEL = { "aria-controls": undefined };

/**
 * The strip itself; it goes inside a <Tabs activationMode="manual"> whose value is the lit tab.
 *
 * Manual (Nov 16 audit, fix 25): the arrow keys only move the highlight along the strip, and
 * Enter, Space or a click opens a tab. Left to open on arrow, Right from Vehicles & drivers
 * landed on Documents and changed the page under the keyboard.
 */
export function SetupTabsList(props: {
  money: boolean;
  documents: boolean;
  /** Which of Setup's two pages this is: only the tabs with a panel on it say they control one. */
  page: SetupStripPage;
  /** A marker after a tab's name (Setup's "unsaved changes" dot). */
  dot?: (tab: SetupStripTab) => ReactNode;
  /**
   * The page was opened from the strip on Setup's other page (menu-places.ts cameBySetupTab):
   * the lit tab takes the keyboard focus the pressed one had.
   */
  takeFocus?: boolean;
}) {
  const { takeFocus } = props;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!takeFocus) return;
    list.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
  }, [takeFocus]);
  return (
    <TabsList ref={list} className="h-auto flex-wrap" data-setup-tabs>
      {setupTabsFor(props).map((tab) => {
        const Icon = ICONS[tab];
        return (
          <TabsTrigger
            key={tab}
            value={tab}
            className="gap-1.5"
            {...(setupTabHasPanel(tab, props.page) ? null : NO_PANEL)}
          >
            <Icon className="h-4 w-4" aria-hidden /> {SETUP_TAB_TITLES[tab]}
            {props.dot?.(tab)}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
