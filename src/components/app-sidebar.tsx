import { useState, type MouseEvent, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Users,
  FileText,
  Settings,
  LogOut,
  UserRound,
  SlidersHorizontal,
  SlidersVertical,
  Package,
  FileSpreadsheet,
  Layers,
  ChevronDown,
  ChevronRight,
  Building2,
  Radar,
  Ruler,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
  Contact,
  Target,
  BellRing,
  Crown,
  CalendarCheck,
  CalendarDays,
  ListTodo,
  Settings2,
  CircleDollarSign,
  PaintRoller,
} from "lucide-react";

import logoSmall from "@/assets/jbk-logo-360.webp";
import { useAuth } from "@/lib/auth-store";
import { closeDrawerAfterLink, type Tapped } from "@/lib/sidebar-phone-close";
import {
  hasDocumentsAccess,
  isOffice,
  managesTickets,
  seesOpportunitiesList,
  type AccessLike,
  type Page,
} from "@/lib/access";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  isSettingsPath,
  livePricingPress,
  pricingOpenFor,
  SETTINGS_HOME,
  SETUP_DOCUMENTS_PATH,
  setupHomeFor,
  type PricingPress,
} from "@/lib/menu-places";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

// New bids start from the Bids page's "New Bid" button (owner: one entry point, not two).
const estimatorItems = [
  // Takeoff sits above Bids (owner, Sep 25): measure first, then bid.
  { title: "Takeoffs", url: "/takeoff", icon: Ruler, page: "takeoff" as const },
  // Owner, Oct 6: "change Bids to Project Bids" (the URL stays /bids).
  { title: "Project Bids", url: "/bids", icon: FileText, page: "estimate" as const },
];
// Customers group (owner, Sep 28): one group in the order the work flows — Customers, Service
// (tickets, with the Tech Board and Invoices as tabs), Opportunities, then Setup
// (owner, Oct 5: Service Rates renamed, plus the inspection checklist and vehicles & drivers;
// admins and managers). Follow-ups
// live on Work Overview (owner, Oct 1; /followups redirects there). Today sits first, for technicians
// only: it is
// the field day for the signed-in tech, so an office login never sees it. `exact`: active only
// on that path.
type ServiceItem = {
  title: string;
  url: string;
  icon: typeof Wrench;
  page: Page | null;
  exact?: boolean;
  /** Hidden for a technician who is not an admin (dispatching is the office's). */
  office?: boolean;
  /** Shown only when the profile has the technician tick. */
  techOnly?: boolean;
  /** Shown only when this says so (beyond `page`). */
  visible?: (p: AccessLike | null | undefined) => boolean;
  /** Lit on this path prefix instead of `url` (Service: every /service page). */
  lit?: string;
  /** Paths under `url` that belong to another item (My tickets has its own entry). */
  except?: string[];
  /** Where the row goes for this person, when it is not `url` for everyone. */
  urlFor?: (p: AccessLike | null | undefined) => string;
  /** Other path prefixes the row is lit on. */
  alsoLit?: string[];
};
const customerItems: ServiceItem[] = [
  {
    title: "My tickets",
    url: "/service/today",
    icon: CalendarCheck,
    page: "service",
    techOnly: true,
  },
  { title: "Customers", url: "/customers", icon: Contact, page: "customers" },
  // Owner, Oct 9: the menu opens on the Tech Board; the Tickets tab is a click away. The item
  // stays lit on every /service page but My tickets.
  // Not for a technician-only user (owner, Oct 15: My tickets and Inventory are their menu).
  {
    title: "Service",
    url: "/service/board",
    icon: Wrench,
    page: "service",
    lit: "/service",
    except: ["/service/today"],
    office: true,
  },
  // Customers or Estimate (seesOpportunitiesList); anyone else opens their own from Work Overview.
  {
    title: "Opportunities",
    url: "/opportunities",
    icon: Target,
    page: null,
    visible: seesOpportunitiesList,
  },
  // Service rates, the inspection checklist and (admins) vehicles & drivers: ticket money and
  // setup are a manager's (owner, Oct 1), so the same gate as Service Rates had.
  // Nov 16: Setup also holds Documents (its fifth tab, on its own page), so everyone with
  // Documents access sees the row; someone who may not open the service tabs lands on Documents
  // (`urlFor`). Lit on both addresses.
  {
    title: "Setup",
    url: "/setup",
    icon: Settings2,
    page: null,
    visible: hasDocumentsAccess,
    urlFor: (p) => setupHomeFor({ money: managesTickets(p) }),
    alsoLit: [SETUP_DOCUMENTS_PATH],
  },
];
const inventoryItems = [{ title: "Inventory", url: "/inventory", icon: Package }];
const prospectItems = [
  // Owner (Sep 29): "Roofs & Storms" (the map: every commercial roof plus storm call points)
  // and "Bid Board" (jobs out to bid and permits) instead of Buildings / Leads.
  { title: "Roofs & Storms", url: "/prospect", icon: Building2, except: ["/prospect/leads"] },
  // Construction leads (owner, Sep 28): state planroom jobs and Louisville commercial permits.
  { title: "Bid Board", url: "/prospect/leads", icon: Radar },
];
// The Admin group (owner, Nov 16, the shorter menu): Owner — the team's work and the margin
// (Oct 21: "owner should be its own tab") — and Settings, one row for Users & access and
// Reminders, which are the two tabs of it (components/settings-tabs.tsx; each keeps its page and
// address). Admins only. Documents left the group for Setup, as its fifth tab; the CenterPoint
// import (Oct 13) still opens by address (admin/centerpoint-import) and is not listed.
const adminGroupItems: {
  title: string;
  url: string;
  icon: typeof Crown;
  /** Lit on these paths instead of `url` (Settings: both of its pages). */
  lit?: (pathname: string) => boolean;
}[] = [
  { title: "Owner", url: "/owner", icon: Crown },
  { title: "Settings", url: SETTINGS_HOME, icon: Settings, lit: isSettingsPath },
];

// Admin pages with `sub` get a caret submenu; each sub deep-links to that page's
// tab via ?tab= (the first sub is the page's default tab). Tab keys must match
// the route's validateSearch list and the on-page <TabsTrigger> values.
type AdminTab =
  | "contractor"
  | "shipping"
  | "salestax"
  | "basiclabor"
  | "markup"
  | "warranties"
  | "setup"
  | "inspection"
  | "templates"
  | "curb"
  | "roofdeck"
  | "parapet"
  | "accessory"
  | "items"
  | "catalog"
  | "adhesives"
  | "metals";

// A sub links to a tab on the parent page (`tab`), a catalog category on it
// (`cat`, matched by name), or its own page (`url` — e.g. Estimators). `adminOnly` subs are
// hidden from pricing users who are not admins.
type AdminSub = { title: string; tab?: AdminTab; cat?: string; url?: string; adminOnly?: boolean };

// Mirrors the legacy Bid-Advantage admin tree (labels and order), flattened to
// one submenu level. Category names must match the seeded pricing_catalog rows.
// General has an icon of its own (Nov 16 audit, fix 27): it wore the gear, which is the Admin
// group's Settings row.
const adminItems: {
  title: string;
  url: string;
  icon: typeof Settings;
  defaultTab?: AdminTab;
  sub?: AdminSub[];
}[] = [
  {
    title: "General",
    url: "/admin/settings",
    icon: SlidersVertical,
    defaultTab: "contractor",
    sub: [
      { title: "Contractor Information", tab: "contractor" },
      { title: "Shipping Costs", tab: "shipping" },
      { title: "Sales Tax", tab: "salestax" },
      { title: "Basic Labor Settings", tab: "basiclabor" },
      { title: "Labor & Markup Options", tab: "markup" },
      { title: "Warranties", tab: "warranties" },
    ],
  },
  {
    title: "Advanced Labor",
    url: "/admin/labor",
    icon: SlidersHorizontal,
    defaultTab: "setup",
    sub: [
      { title: "Setup Times", tab: "setup" },
      { title: "Inspection Times", tab: "inspection" },
      { title: "Labor Templates", tab: "templates" },
      { title: "Roof Deck Labor", tab: "roofdeck" },
      { title: "Curb Labor", tab: "curb" },
      { title: "Parapet Labor", tab: "parapet" },
      { title: "Accessory Labor", tab: "accessory" },
    ],
  },
  {
    title: "Duro-Last Pricing",
    url: "/admin/duro-last",
    icon: Layers,
    sub: [
      { title: "Duro-Last Membrane", cat: "Duro-Last Membrane" },
      { title: "Underlayment", cat: "Underlayment" },
      { title: "Fasteners & Bits", cat: "Fasteners & Bits" },
      { title: "Sealants", cat: "Sealants" },
      { title: "Adhesives", tab: "adhesives" },
      { title: "Corners", cat: "Corners" },
      { title: "Conduit Washers", cat: "Conduit Washers" },
      { title: "Pipe Stacks", cat: "Pipe Stacks" },
      { title: "Panduit", cat: "Panduit" },
      { title: "Drain Boots", cat: "Drain Boots" },
      { title: "CDR Rings", cat: "CDR Rings" },
      { title: "Drain Boot Accessories", cat: "Drain Boot Accessories" },
      { title: "Vents", cat: "Vents" },
      { title: "Termination Bars", cat: "Termination Bars" },
      { title: "Facia Bars/Vinyl Covers", cat: "Facia Bars/Vinyl Covers" },
      { title: "Drip Edge", cat: "Drip Edge" },
      { title: "Gravel Stops", cat: "Gravel Stops" },
      { title: "Walk Pads & Wall Vents", cat: "Walk Pads & Wall Vents" },
      { title: "Membrane Accs", cat: "Membrane Accs" },
      // The Duro-Tech TPO items with no automatic count (owner, Oct 26–27).
      { title: "Other Accessories", cat: "Other Accessories" },
      { title: "EXCEPTIONAL Metals", tab: "metals" },
      { title: "Item Numbers", tab: "items" },
    ],
  },
  {
    title: "Non Duro-Last Pricing",
    url: "/admin/non-dl",
    icon: Package,
    sub: [
      // Its own page (owner, Oct 22): the two families from the Duro-Last Membrane screen.
      { title: "Non-DL TPO and EPDM", url: "/admin/non-dl-membrane" },
      // The non-DL adhesives (owner, Oct 27): a view of the one adhesives screen
      // (lib/non-dl-adhesives.ts), beside the membranes.
      { title: "Non-DL TPO and EPDM Adhesives", url: "/admin/non-dl-adhesives" },
      // The accessory families' own pages (owner, Oct 26–27): the `non_dl_tpo` and `epdm`
      // branches, each with a category picker like Duro-Last Pricing (catalog-branches.ts).
      { title: "Non-DL TPO Accessories", url: "/admin/non-dl-tpo" },
      { title: "EPDM Accessories", url: "/admin/epdm" },
      { title: "Roof Edge Blocking", cat: "Roof Edge Blocking" },
      { title: "Parapet Wall Blocking", cat: "Parapet Wall Blocking" },
      { title: "Structural Deck Materials", cat: "Structural Deck Materials" },
      { title: "Sheet Metal Work", cat: "Sheet Metal Work" },
      { title: "Masonry", cat: "Masonry" },
      { title: "Subcontractors", cat: "Subcontractors" },
      { title: "3rd Party Services", cat: "3rd Party Services" },
      { title: "Preset Custom Applications", cat: "Preset Custom Applications" },
    ],
  },
  {
    title: "Price List Import",
    url: "/admin/price-import",
    icon: FileSpreadsheet,
  },
];

/**
 * Trade Bids (owner, Nov 16: "Not under estimate pricing dropdown but under estimate pricing
 * above inventory on the nav bar"): a row of its own in the Estimate group, between the
 * Estimate Pricing row and Inventory.
 */
const TRADE_BIDS_PATH = "/trade-bids";

/** Is this one of the Estimate Pricing pages (the five rows and the pages their sub-lists open)? */
const isPricingPath = (pathname: string): boolean =>
  adminItems.some(
    (item) =>
      pathname.startsWith(item.url) ||
      (item.sub ?? []).some((sub) => !!sub.url && pathname.startsWith(sub.url)),
  );

/** Which menu groups the user folded up, remembered per browser. */
const NAV_KEY = "bid-o-matic:nav-collapsed";
const readNavCollapsed = (): string[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw: unknown = JSON.parse(window.localStorage.getItem(NAV_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const writeNavCollapsed = (ids: string[]) => {
  try {
    window.localStorage.setItem(NAV_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable — folding still works this visit.
  }
};

/**
 * A menu group whose label folds its items away (chevron), remembered per browser. In the
 * icon-only sidebar the labels are hidden, so every group shows its icons regardless.
 */
function NavGroup({
  label,
  id,
  iconMode,
  children,
}: {
  label: string;
  id: string;
  iconMode: boolean;
  children: ReactNode;
}) {
  const [folded, setFolded] = useState<boolean>(() => readNavCollapsed().includes(id));
  const open = iconMode || !folded;
  const setOpen = (o: boolean) => {
    setFolded(!o);
    const cur = readNavCollapsed().filter((x) => x !== id);
    writeNavCollapsed(o ? cur : [...cur, id]);
  };
  return (
    <SidebarGroup>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel
            className="cursor-pointer select-none justify-between hover:text-foreground"
            title={open ? `Fold ${label}` : `Unfold ${label}`}
          >
            <span>{label}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
              aria-hidden
            />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  // The desktop menu's collapsed flag is remembered in a cookie; the phone drawer is always full
  // width, so it never hides the names (owner, Nov 9: "the names don't show on the nav bar").
  const collapsed = !isMobile && state === "collapsed";
  // Owner, Oct 28: on a phone the drawer closes after a tap on a page link (sidebar-phone-close.ts).
  const onMenuClick = (e: MouseEvent<HTMLDivElement>) =>
    closeDrawerAfterLink(isMobile, e.target as Tapped, setOpenMobile);
  const navigate = useNavigate();
  const { profile, role, can, signOut } = useAuth();

  const pathname = useRouterState({
    select: (router) => router.location.pathname,
  });
  const searchTab = useRouterState({
    select: (router) => {
      const s = router.location.search as Record<string, unknown>;
      return typeof s["tab"] === "string" ? s["tab"] : undefined;
    },
  });
  const searchCat = useRouterState({
    select: (router) => {
      const s = router.location.search as Record<string, unknown>;
      return typeof s["cat"] === "string" ? s["cat"] : undefined;
    },
  });
  // A technician who is neither an admin nor a manager: My tickets first, no Board.
  const isTech = !!profile && !isOffice(profile);
  const isActive = (path: string) =>
    pathname === path || (path !== "/" && pathname.startsWith(path));

  // Manual open/close overrides; a section with the active page open by default.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const [pricingPress, setPricingPress] = useState<PricingPress | undefined>(undefined);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const renderItems = (items: ServiceItem[]) =>
    items
      .filter((item) => item.page === null || can(item.page))
      .filter((item) => !item.visible || item.visible(profile))
      .filter((item) => !(item.office && isTech))
      .filter((item) => !item.techOnly || !!profile?.technician)
      .map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton
            asChild
            isActive={
              item.exact
                ? pathname === item.url
                : (isActive(item.lit ?? item.url) || (item.alsoLit ?? []).some(isActive)) &&
                  !(item.except ?? []).some((p) => pathname.startsWith(p))
            }
            tooltip={item.title}
          >
            <Link to={item.urlFor ? item.urlFor(profile) : item.url}>
              <item.icon className="h-4 w-4" />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ));

  // The five Estimate Pricing pages, each with its own caret and sub-list as before.
  const pricingRows = (
    <>
      {adminItems.map((item) =>
        item.sub && !collapsed ? (
          <Collapsible
            key={item.title}
            asChild
            open={
              openMenus[item.title] ??
              (isActive(item.url) || item.sub.some((s) => s.url && isActive(s.url)))
            }
            onOpenChange={(open) => setOpenMenus((prev) => ({ ...prev, [item.title]: open }))}
          >
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                <Link to={item.url}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
              <CollapsibleTrigger asChild>
                <SidebarMenuAction className="transition-transform data-[state=open]:rotate-90">
                  <ChevronRight className="h-4 w-4" />
                  <span className="sr-only">Toggle {item.title}</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.sub
                    .filter((sub) => !sub.adminOnly || role === "admin")
                    .map((sub) => {
                      const active = sub.url
                        ? isActive(sub.url)
                        : isActive(item.url) &&
                          (sub.cat
                            ? searchCat === sub.cat
                            : !searchCat && (searchTab ?? item.defaultTab) === sub.tab);
                      // Duro-Last categories live on the Catalog tab; Non-DL has no tabs.
                      const search = sub.cat
                        ? item.url === "/admin/duro-last"
                          ? { tab: "catalog" as const, cat: sub.cat }
                          : { cat: sub.cat }
                        : { tab: sub.tab! };
                      return (
                        <SidebarMenuSubItem key={sub.title}>
                          <SidebarMenuSubButton asChild isActive={active}>
                            {sub.url ? (
                              <Link to={sub.url}>
                                <span>{sub.title}</span>
                              </Link>
                            ) : (
                              <Link to={item.url} search={search}>
                                <span>{sub.title}</span>
                              </Link>
                            )}
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ) : (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
              <Link to={item.url}>
                <item.icon className="h-4 w-4" />
                {!collapsed && <span>{item.title}</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ),
      )}
    </>
  );
  // Trade Bids: its own row under Estimate Pricing and above Inventory (owner, Nov 16). It is a
  // page for bidding, so it shows with Estimate access, as Project Bids does.
  const tradeBidsRow = (
    <SidebarMenuItem data-nav="trade-bids">
      <SidebarMenuButton asChild isActive={isActive(TRADE_BIDS_PATH)} tooltip="Trade Bids">
        <Link to={TRADE_BIDS_PATH}>
          <PaintRoller className="h-4 w-4" />
          {!collapsed && <span>Trade Bids</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
  const inventoryRows = inventoryItems.map((item) => (
    <SidebarMenuItem key={item.title}>
      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
        <Link to={item.url}>
          <item.icon className="h-4 w-4" />
          {!collapsed && <span>{item.title}</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  ));
  // Estimate Pricing opens in place: open while a pricing page is showing, closed otherwise. A
  // press on the row opens or closes it by hand, and holds until the visitor walks onto a pricing
  // page or off them (Nov 16 audit, fix 24: it held for the rest of the visit, so the row stayed
  // open after its pages were left). A press that has ended is dropped (state set during the
  // render, as React allows for "what changed since the last one"), so it cannot come back.
  const onPricingPage = isPricingPath(pathname);
  const livePress = livePricingPress(pricingPress, onPricingPage);
  if (pricingPress && !livePress) setPricingPress(undefined);
  const pricingOpen = pricingOpenFor(livePress, onPricingPage);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={collapsed ? "items-center px-1 py-2" : "px-3 pt-3 pb-1"}>
        {/* The logo's black banner and outline vanish on the dark sidebar, so it sits on the
            image-plate token: transparent in light mode, a lighter grey panel in dark mode
            (styles.css). The image itself is untouched.
            Nov 10 (the speed pass, finding 5): the menu draws a 360 px wide copy (12 KB, sharp on
            a 2x screen at the 180 px it is shown) that goes through the build, so it has a
            hashed address the browser keeps. public/jbk-logo.webp (2000 x 1125, 88 KB, fetched on
            every page with no cache header) stays for the document editor's preview, and the
            PDFs keep their own embedded copy (lib/jbk-logo.server.ts). */}
        <div
          data-image-plate=""
          className={`rounded-md bg-image-plate ${collapsed ? "p-0.5" : "mx-auto w-full max-w-[180px] p-1"}`}
        >
          <img
            src={logoSmall}
            width={360}
            height={203}
            alt="JBK Commercial Roofing"
            className={collapsed ? "h-6 w-auto" : "mx-auto h-auto w-full"}
          />
        </div>
      </SidebarHeader>
      <SidebarContent onClick={onMenuClick}>
        {/* Work Overview (owner, Sep 30): the landing page — their own tickets, tasks and
            follow-ups in one list and calendar. Not for a technician-only user (owner, Oct 15):
            My tickets is their page, and the Service board is the office's. */}
        {profile && !isTech && (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/my-work")} tooltip="Work Overview">
                  <Link to="/my-work">
                    <ListTodo className="h-4 w-4" />
                    {!collapsed && <span>Work Overview</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}

        {profile && (
          <NavGroup
            label={can("customers") ? "Customers" : "Service"}
            id="customers"
            iconMode={collapsed}
          >
            <SidebarMenu>{renderItems(customerItems)}</SidebarMenu>
          </NavGroup>
        )}

        {can("prospect") && (
          <NavGroup label="Prospecting" id="prospecting" iconMode={collapsed}>
            <SidebarMenu>
              {prospectItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    // Buildings is /prospect and Leads is /prospect/leads: without the except
                    // list both lit up on the Leads page (owner, Sep 29).
                    isActive={
                      isActive(item.url) && !(item.except ?? []).some((p) => pathname.startsWith(p))
                    }
                    tooltip={item.title}
                  >
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </NavGroup>
        )}

        {/* Estimate (owner, Nov 16: "takeoffs, projects bids, estimate pricing (with the
            dropdown …), inventory"): the pricing pages sit behind one Estimate Pricing row that
            opens in place, and Inventory is the group's last row. Each row shows only with its
            own access. Someone with Inventory and none of the estimate pages (a technician)
            gets Inventory as a plain row, with no "Estimate" header over it. */}
        {can("estimate") || can("takeoff") || can("pricing") ? (
          <NavGroup label="Estimate" id="estimate" iconMode={collapsed}>
            <SidebarMenu>
              {estimatorItems
                .filter((item) => can(item.page))
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              {can("pricing") &&
                (collapsed ? (
                  // Icons only: no room for a dropdown, so the five pricing pages are their icons.
                  pricingRows
                ) : (
                  <Collapsible
                    asChild
                    open={pricingOpen}
                    onOpenChange={(open) => setPricingPress({ open, onPricingPage })}
                  >
                    <SidebarMenuItem data-nav="estimate-pricing">
                      {/* The button's class (Nov 16 audit, fix 27): open, the row holds the five
                          pages' own carets, and the menu's button then keeps 32 px free on its
                          right for a caret of its own. This row has none there, so its chevron
                          jumped sideways; it keeps the 8 px it has when shut. */}
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          isActive={onPricingPage && !pricingOpen}
                          tooltip="Estimate Pricing"
                          title={pricingOpen ? "Close Estimate Pricing" : "Open Estimate Pricing"}
                          className="group-has-[[data-sidebar=menu-action]]/menu-item:pr-2"
                        >
                          <CircleDollarSign className="h-4 w-4" />
                          <span>Estimate Pricing</span>
                          <ChevronRight
                            className={`ml-auto h-4 w-4 transition-transform ${pricingOpen ? "rotate-90" : ""}`}
                            aria-hidden
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenu className="ml-2.5 mt-0.5 w-auto border-l pl-0.5">
                          {pricingRows}
                        </SidebarMenu>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ))}
              {can("estimate") && tradeBidsRow}
              {can("inventory") && inventoryRows}
            </SidebarMenu>
          </NavGroup>
        ) : (
          can("inventory") && (
            <SidebarGroup>
              <SidebarMenu>{inventoryRows}</SidebarMenu>
            </SidebarGroup>
          )
        )}

        {/* Admins only (Nov 16): Owner and Settings. */}
        {role === "admin" && (
          <NavGroup label="Admin" id="admin" iconMode={collapsed}>
            <SidebarMenu>
              {adminGroupItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={item.lit ? item.lit(pathname) : isActive(item.url)}
                    tooltip={item.title}
                  >
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </NavGroup>
        )}
      </SidebarContent>

      <SidebarFooter onClick={onMenuClick}>
        <SidebarMenu>
          {/* Owner, Sep 28: the account link (info, password, notifications) sits in the footer
              so the menu has one item fewer. Owner, Oct 12: it reads "My account"; the name is
              the small second line (the footer row was already two lines). */}
          {/* Nov 16 (the shorter menu): Sign out sits beside My account, as words, on one row.
              In the icon-only menu each is its own icon. */}
          <SidebarMenuItem className={collapsed ? undefined : "flex items-center gap-1"}>
            {profile && (
              <SidebarMenuButton
                asChild
                isActive={isActive("/account")}
                tooltip="My account"
                className={collapsed ? "h-auto py-1.5" : "h-auto min-w-0 flex-1 py-1.5"}
              >
                <Link to="/account" title="My account: info, password, notifications">
                  <UserRound className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <span className="min-w-0 text-xs leading-tight">
                      <span className="block truncate font-medium text-foreground">My account</span>
                      <span className="block truncate text-muted-foreground">
                        {profile.full_name || profile.email}
                      </span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            )}
            {!collapsed && (
              <button
                type="button"
                onClick={handleSignOut}
                data-nav="sign-out"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-sidebar-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
              >
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </button>
            )}
          </SidebarMenuItem>
          {collapsed && (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleSignOut} tooltip="Sign out">
                <LogOut className="h-4 w-4" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {/* Dark mode (owner, Oct 2): the sun / moon toggle sits to the right of Collapse menu;
              in the icon-only sidebar it is its own icon row beneath it. */}
          <SidebarMenuItem className={collapsed ? undefined : "flex items-center gap-1"}>
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip={collapsed ? "Expand menu" : "Collapse menu"}
              title="Ctrl+B / Cmd+B also toggles the menu"
              className={collapsed ? undefined : "min-w-0 flex-1"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
              {!collapsed && <span>Collapse menu</span>}
            </SidebarMenuButton>
            {!collapsed && <ThemeToggle variant="sidebar" />}
          </SidebarMenuItem>
          {collapsed && (
            <SidebarMenuItem>
              <ThemeToggle variant="sidebar-collapsed" />
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
      {/* The thin rail on the sidebar's edge: click it to collapse or expand. */}
      <SidebarRail />
    </Sidebar>
  );
}
