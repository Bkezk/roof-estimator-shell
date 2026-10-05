import { useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Users,
  FileText,
  Settings,
  LogOut,
  UserRound,
  SlidersHorizontal,
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
  CalendarCheck,
  CalendarDays,
  ListTodo,
  Settings2,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  PAGE_LABELS,
  ROLE_LABELS,
  isOffice,
  managesTickets,
  seesOpportunitiesList,
  type AccessLike,
  type Page,
} from "@/lib/access";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  { title: "Bids", url: "/bids", icon: FileText, page: "estimate" as const },
];
// Customers group (owner, Sep 28): one group in the order the work flows — Customers, Service
// (tickets, with the Tech Board above them and Invoices as a tab), Opportunities, then Setup
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
  /** Paths under `url` that belong to another item (Today has its own entry). */
  except?: string[];
};
const customerItems: ServiceItem[] = [
  { title: "Today", url: "/service/today", icon: CalendarCheck, page: "service", techOnly: true },
  { title: "Customers", url: "/customers", icon: Contact, page: "customers" },
  { title: "Service", url: "/service", icon: Wrench, page: "service", except: ["/service/today"] },
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
  { title: "Setup", url: "/setup", icon: Settings2, page: null, visible: managesTickets },
];
const inventoryItems = [{ title: "Inventory", url: "/inventory", icon: Package }];
const prospectItems = [
  // Owner (Sep 29): "Roofs & Storms" (the map: every commercial roof plus storm call points)
  // and "Bid Board" (jobs out to bid and permits) instead of Buildings / Leads.
  { title: "Roofs & Storms", url: "/prospect", icon: Building2, except: ["/prospect/leads"] },
  // Construction leads (owner, Sep 28): state planroom jobs and Louisville commercial permits.
  { title: "Bid Board", url: "/prospect/leads", icon: Radar },
];
// The Admin group: who can sign in and which pages each person may open, and the reminder and
// untouched-work rules — admins only. (Service Rates moved out to Setup, under Opportunities,
// owner Oct 5.) Owner, Sep 28: their own pages under Admin, not tabs of Estimate Pricing › General.
const adminGroupItems = [
  { title: "Users & access", url: "/admin/users", icon: Users, adminOnly: true },
  { title: "Reminders", url: "/admin/reminders", icon: BellRing, adminOnly: true },
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
    icon: Settings,
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
      { title: "EXCEPTIONAL Metals", tab: "metals" },
      { title: "Item Numbers", tab: "items" },
    ],
  },
  {
    title: "Non Duro-Last Pricing",
    url: "/admin/non-dl",
    icon: Package,
    sub: [
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
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
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
  // A technician who is neither an admin nor a manager: Today first, no Board.
  const isTech = !!profile && !isOffice(profile);
  const isActive = (path: string) =>
    pathname === path || (path !== "/" && pathname.startsWith(path));

  // Manual open/close overrides; a section with the active page open by default.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});

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
                : isActive(item.url) && !(item.except ?? []).some((p) => pathname.startsWith(p))
            }
            tooltip={item.title}
          >
            <Link to={item.url}>
              <item.icon className="h-4 w-4" />
              {!collapsed && <span>{item.title}</span>}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={collapsed ? "items-center px-1 py-2" : "px-3 pt-3 pb-1"}>
        {/* The logo's black banner and outline vanish on the dark sidebar, so it sits on the
            image-plate token: transparent in light mode, a lighter grey panel in dark mode
            (styles.css). The image itself is untouched. */}
        <div
          data-image-plate=""
          className={`rounded-md bg-image-plate ${collapsed ? "p-0.5" : "mx-auto w-full max-w-[180px] p-1"}`}
        >
          <img
            src="/jbk-logo.webp"
            alt="JBK Commercial Roofing"
            className={collapsed ? "h-6 w-auto" : "mx-auto h-auto w-full"}
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* Work Overview (owner, Sep 30): every signed-in user's landing page — their own tickets,
            tasks and follow-ups in one list and calendar. */}
        {profile && (
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

        {(can("estimate") || can("takeoff")) && (
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
            </SidebarMenu>
          </NavGroup>
        )}

        {can("pricing") && (
          <NavGroup label="Estimate Pricing" id="estimate-pricing" iconMode={collapsed}>
            <SidebarMenu>
              {adminItems.map((item) =>
                item.sub && !collapsed ? (
                  <Collapsible
                    key={item.title}
                    asChild
                    open={
                      openMenus[item.title] ??
                      (isActive(item.url) || item.sub.some((s) => s.url && isActive(s.url)))
                    }
                    onOpenChange={(open) =>
                      setOpenMenus((prev) => ({ ...prev, [item.title]: open }))
                    }
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
            </SidebarMenu>
          </NavGroup>
        )}

        {can("inventory") && (
          <NavGroup label="Inventory" id="inventory" iconMode={collapsed}>
            <SidebarMenu>
              {inventoryItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
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

        {role === "admin" && (
          <NavGroup label="Admin" id="admin" iconMode={collapsed}>
            <SidebarMenu>
              {adminGroupItems
                .filter((item) => !item.adminOnly || role === "admin")
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
            </SidebarMenu>
          </NavGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* Owner, Sep 28: the name is the account link (info, password, notifications) so
              the menu has one item fewer. */}
          {profile && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive("/account")}
                tooltip="My account"
                className="h-auto py-1.5"
              >
                <Link to="/account" title="My account: info, password, notifications">
                  <UserRound className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <span className="min-w-0 text-xs leading-tight">
                      <span className="block truncate font-medium text-foreground">
                        {profile.full_name || profile.email}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {profile.role !== "user"
                          ? ROLE_LABELS[profile.role]
                          : profile.access.map((p) => PAGE_LABELS[p]).join(" · ") || "No pages"}
                      </span>
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign out">
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
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
