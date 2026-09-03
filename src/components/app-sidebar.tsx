import { useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  FileText,
  Settings,
  LogOut,
  KeyRound,
  SlidersHorizontal,
  Package,
  Layers,
  Calculator,
  ChevronRight,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
  useSidebar,
} from "@/components/ui/sidebar";

const estimatorItems = [
  { title: "New Estimate", url: "/estimate", icon: Calculator },
  { title: "Bids", url: "/bids", icon: FileText },
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
  | "catalog"
  | "adhesives"
  | "metals";

// A sub links to a tab on the parent page (`tab`), a catalog category on it
// (`cat`, matched by name), or its own page (`url` — e.g. Estimators).
type AdminSub = { title: string; tab?: AdminTab; cat?: string; url?: string };

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
      { title: "Estimators", url: "/admin/users" },
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
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const { profile, role, signOut } = useAuth();

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
  const isActive = (path: string) =>
    pathname === path || (path !== "/" && pathname.startsWith(path));

  // Manual open/close overrides; a section with the active page open by default.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Estimate</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {estimatorItems.map((item) => (
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
          </SidebarGroupContent>
        </SidebarGroup>

        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) =>
                  item.sub && !collapsed ? (
                    <Collapsible
                      key={item.title}
                      asChild
                      open={
                        openMenus[item.title] ??
                        (isActive(item.url) ||
                          item.sub.some((s) => s.url && isActive(s.url)))
                      }
                      onOpenChange={(open) =>
                        setOpenMenus((prev) => ({ ...prev, [item.title]: open }))
                      }
                    >
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.url)}
                          tooltip={item.title}
                        >
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
                            {item.sub.map((sub) => {
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
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(item.url)}
                        tooltip={item.title}
                      >
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {!collapsed && profile && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              <div className="truncate font-medium text-foreground">
                {profile.full_name || profile.email}
              </div>
              <div className="truncate capitalize">{profile.role}</div>
            </div>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/account")} tooltip="Change password">
              <Link to="/account">
                <KeyRound className="h-4 w-4" />
                {!collapsed && <span>Change password</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign out">
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
