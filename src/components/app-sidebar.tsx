import { useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  FileText,
  Settings,
  Users,
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
  | "company"
  | "shipping"
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

const adminItems: {
  title: string;
  url: string;
  icon: typeof Settings;
  sub?: { title: string; tab: AdminTab }[];
}[] = [
  {
    title: "General",
    url: "/admin/settings",
    icon: Settings,
    sub: [
      { title: "Company & Bid", tab: "company" },
      { title: "Shipping", tab: "shipping" },
      { title: "Labor & Markup", tab: "markup" },
      { title: "Warranties", tab: "warranties" },
    ],
  },
  {
    title: "Labor",
    url: "/admin/labor",
    icon: SlidersHorizontal,
    sub: [
      { title: "Setup Times", tab: "setup" },
      { title: "Inspection Times", tab: "inspection" },
      { title: "Labor Templates", tab: "templates" },
      { title: "Curb Labor", tab: "curb" },
      { title: "Roof Deck Labor", tab: "roofdeck" },
      { title: "Parapet Labor", tab: "parapet" },
      { title: "Accessory Labor", tab: "accessory" },
    ],
  },
  {
    title: "Duro-Last Pricing",
    url: "/admin/duro-last",
    icon: Layers,
    sub: [
      { title: "Catalog", tab: "catalog" },
      { title: "Adhesives", tab: "adhesives" },
      { title: "Exceptional Metals", tab: "metals" },
    ],
  },
  { title: "Non-DL Pricing", url: "/admin/non-dl", icon: Package },
  { title: "Users", url: "/admin/users", icon: Users },
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
                      open={openMenus[item.title] ?? isActive(item.url)}
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
                            {item.sub.map((sub) => (
                              <SidebarMenuSubItem key={sub.tab}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={
                                    isActive(item.url) &&
                                    (searchTab ?? item.sub![0]!.tab) === sub.tab
                                  }
                                >
                                  <Link to={item.url} search={{ tab: sub.tab }}>
                                    <span>{sub.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
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
