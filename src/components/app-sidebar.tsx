import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  FileText,
  PlusCircle,
  Settings,
  Users,
  LogOut,
  KeyRound,
  SlidersHorizontal,
} from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const estimatorItems = [
  { title: "Bids", url: "/bids", icon: FileText },
  { title: "New Bid", url: "/new-bid", icon: PlusCircle },
];

const adminItems = [
  { title: "Settings", url: "/admin/settings", icon: Settings },
  { title: "Labor", url: "/admin/labor", icon: SlidersHorizontal },
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
  const isActive = (path: string) =>
    pathname === path || (path !== "/" && pathname.startsWith(path));

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
                {adminItems.map((item) => (
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
