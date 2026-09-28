import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { canAccess, homeFor, isAdmin, pageForPath } from "@/lib/access";
import { dispatchRemindersIfDue } from "@/lib/followups.functions";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-background">{children}</div>;
}

/** Clear the browser's stored Supabase session and reload — the way out of a stuck sign-in. */
function startOver() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith("sb-")) sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  window.location.href = "/login";
}

/**
 * The gate's spinner, with an escape hatch: after a few seconds it explains itself and offers
 * Reload / Start over (clear the stored session), so a sign-in that never settles is never a
 * blank spinner on someone's phone.
 */
function Waiting() {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), 8_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        {stalled && (
          <>
            <p className="max-w-sm text-sm text-muted-foreground">
              This is taking longer than it should. Your saved sign-in may be stuck, or the
              connection is slow.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
              <Button size="sm" onClick={startOver}>
                Sign in again
              </Button>
            </div>
          </>
        )}
      </div>
    </FullScreen>
  );
}

// Users the lazy reminder dispatcher already ran for in this page load.
const dispatchedFor = new Set<string>();

/**
 * The lazy reminder dispatcher: once per page load, an office user's app asks the server to fire
 * any due follow-up reminders (the server itself skips it when the last pass was under ten
 * minutes ago). Fire and forget; failures only reach the console.
 */
function useLazyReminderDispatch() {
  const { profile } = useAuth();
  const officeLike =
    !!profile &&
    (canAccess(profile, "customers") ||
      canAccess(profile, "service") ||
      canAccess(profile, "estimate"));
  const userId = profile?.id;
  useEffect(() => {
    if (!officeLike || !userId || dispatchedFor.has(userId)) return;
    dispatchedFor.add(userId);
    dispatchRemindersIfDue().catch((e: unknown) => console.error("Reminder dispatch failed", e));
  }, [officeLike, userId]);
}

function AuthedShell({ children }: { children: ReactNode }) {
  useLazyReminderDispatch();
  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b px-4">
            <SidebarTrigger />
            <span className="font-semibold">JBK Portal</span>
            <div className="ml-auto flex items-center gap-1">
              <NotificationsBell />
            </div>
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
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  const isLogin = pathname === "/login";
  // Per-page access (src/lib/access.ts): a route belongs to a page; a user without that page is
  // sent to the first page they may open. Until the profile has loaded nothing is blocked.
  const page = pageForPath(pathname);
  const blocked =
    !!profile &&
    page !== null &&
    (page === "admin" ? !isAdmin(profile) : !canAccess(profile, page));
  const home = homeFor(profile);

  useEffect(() => {
    if (loading) return;
    if (!session && !isLogin) {
      navigate({ to: "/login" });
    } else if (session && isLogin) {
      navigate({ to: home });
    } else if (session && blocked) {
      navigate({ to: home });
    }
  }, [loading, session, pathname, isLogin, blocked, home, navigate]);

  // The login screen renders full-bleed, with no app chrome.
  if (isLogin) return <>{children}</>;

  if (loading || !session) return <Waiting />;

  // Mid-redirect away from a page this user may not open: don't flash the other UI.
  if (blocked) return <Waiting />;

  return <AuthedShell>{children}</AuthedShell>;
}
