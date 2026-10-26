import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { canAccess, homeFor, pageForPath } from "@/lib/access";
import {
  blockedForProfile,
  gateDecision,
  landingDecision,
  PROFILE_MISSING_TOAST,
  PROFILE_RETRY_MS,
  SIGN_IN_STALL_MS,
} from "@/lib/auth-flow";
import { committedPathname } from "@/lib/committed-pathname";
import { dispatchRemindersIfDue } from "@/lib/followups.functions";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { GlobalSearch } from "@/components/global-search";
import { StalledNotice } from "@/components/stalled-sign-in";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-background">{children}</div>;
}

/**
 * The gate's spinner, with an escape hatch: after a few seconds (SIGN_IN_STALL_MS) it explains
 * itself and offers Reload / Sign in again (components/stalled-sign-in.tsx: clear the stored
 * session), so a sign-in that never settles is never a blank spinner on someone's phone.
 */
function Waiting() {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), SIGN_IN_STALL_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        {stalled && <StalledNotice />}
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
            {/* One search over everything, Ctrl / ⌘ K (owner, Oct 6, as CenterPoint's header). */}
            <div className="flex flex-1 justify-center px-2">
              <GlobalSearch />
            </div>
            <div className="flex items-center gap-1">
              <NotificationsBell />
            </div>
          </header>
          <SidebarInset className="p-4 sm:p-6">{children}</SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}

// Central access control. UI routing here is convenience; the real enforcement
// is RLS + the admin checks inside every server function.
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, profile, profileFailed, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  // The pathname of what the Outlet is RENDERING (Oct 20): the committed matches' leaf, which
  // moves in the same router commit as the Outlet's content (lib/committed-pathname.ts). Reading
  // `location` here let the signed-out redirect to /login flip `isLogin` on while the Outlet
  // still held the page being left — so that page (Work Overview, five column tooltips) rendered
  // once outside AuthedShell, with no TooltipProvider, and the error boundary caught "Tooltip
  // must be used within TooltipProvider" ×5 on the way to the sign-in screen. Reading
  // `resolvedLocation` (the first fix) had the opposite leg: it moves in a layout effect AFTER
  // the commit that renders the destination, so leaving /login after a sign-in rendered the
  // destination once bare — a cached Work Overview, the same five tooltips, the same boundary.
  const pathname = useRouterState({ select: committedPathname });

  const isLogin = pathname === "/login";
  // Per-page access (src/lib/access.ts): a route belongs to a page; a user without that page is
  // sent to the first page they may open. Until the profile has loaded nothing is blocked; once
  // its load has FAILED (Oct 20, lib/auth-flow.ts gateDecision) a page that needs it is blocked
  // instead of rendered — the routes every signed-in user may open (pageForPath null: Work
  // Overview, /account, Inventory …) stay open.
  const page = pageForPath(pathname);
  const blocked = gateDecision(session, profile, profileFailed, page) === "blocked";
  const home = homeFor(profile);

  // Oct 20 (d): a signed-in visitor of /login with no profile yet is not sent anywhere — the
  // profile is asked for again, a few times (landingDecision; refreshProfile runs loadProfile's
  // own retry each time), and only then do they land on homeFor(null), told why. Until then the
  // login page keeps its "Signing in…" (and, after SIGN_IN_STALL_MS, its way out).
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!session) setTries(0);
  }, [session]);
  const refreshRef = useRef(refreshProfile);
  useEffect(() => {
    refreshRef.current = refreshProfile;
  }, [refreshProfile]);

  const decision = !loading && session && isLogin ? landingDecision(session, profile, tries) : null;

  useEffect(() => {
    if (loading) return;
    if (!session && !isLogin) {
      navigate({ to: "/login" });
    } else if (session && isLogin) {
      if (decision === "home") {
        navigate({ to: home });
      } else if (decision === "home-without-profile") {
        toast.warning(PROFILE_MISSING_TOAST);
        navigate({ to: homeFor(null) });
      }
      // "retry": the effect below asks for the profile again.
    } else if (session && blocked) {
      navigate({ to: home });
    }
  }, [loading, session, pathname, isLogin, blocked, home, navigate, decision]);

  // One ask per try, PROFILE_RETRY_MS after the last answer (`tries` moves when it settles).
  useEffect(() => {
    if (decision !== "retry") return undefined;
    const t = setTimeout(() => {
      void refreshRef.current().finally(() => setTries((n) => n + 1));
    }, PROFILE_RETRY_MS);
    return () => clearTimeout(t);
  }, [decision, tries]);

  // Oct 21 (the sixth audit): a block on a FAILED profile load (not a real access miss) is said
  // out loud — once per block, with "Try again" running refreshProfile — instead of a silent
  // redirect home. A block with a profile in hand is the page's own rule and stays quiet.
  const profileBlock = blockedForProfile(blocked, profile, profileFailed);
  useEffect(() => {
    if (loading || !profileBlock) return;
    toast.warning(PROFILE_MISSING_TOAST, {
      action: { label: "Try again", onClick: () => void refreshRef.current() },
    });
  }, [loading, profileBlock]);

  // The login screen renders full-bleed, with no app chrome.
  if (isLogin) return <>{children}</>;

  // Oct 20 (b): with a session the shell renders through a profile load — `loading` only holds
  // the /login redirect (above). A tab wake that re-read a null profile used to swap the whole
  // page for the spinner and remount it.
  if (!session) return <Waiting />;

  // Mid-redirect away from a page this user may not open: don't flash the other UI.
  if (blocked) return <Waiting />;

  return <AuthedShell>{children}</AuthedShell>;
}
