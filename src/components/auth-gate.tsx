import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-background">{children}</div>;
}

function AuthedShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b px-4">
            <SidebarTrigger />
            <span className="font-semibold">Bid-O-Matic</span>
          </header>
          <SidebarInset className="p-6">{children}</SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}

// Central access control. UI routing here is convenience; the real enforcement
// is RLS + the admin checks inside every server function.
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, role, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  const isLogin = pathname === "/login";
  const isAdminRoute = pathname.startsWith("/admin");

  useEffect(() => {
    if (loading) return;
    if (!session && !isLogin) {
      navigate({ to: "/login" });
    } else if (session && isLogin) {
      navigate({ to: "/bids" });
    } else if (session && isAdminRoute && role && role !== "admin") {
      navigate({ to: "/bids" });
    }
  }, [loading, session, role, pathname, isLogin, isAdminRoute, navigate]);

  // The login screen renders full-bleed, with no app chrome.
  if (isLogin) return <>{children}</>;

  if (loading || !session) {
    return (
      <FullScreen>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </FullScreen>
    );
  }

  // An estimator mid-redirect away from an admin route: don't flash admin UI.
  if (isAdminRoute && role !== "admin") {
    return (
      <FullScreen>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </FullScreen>
    );
  }

  return <AuthedShell>{children}</AuthedShell>;
}
