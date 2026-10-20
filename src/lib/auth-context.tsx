import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getMyProfile, type UserProfile } from "@/lib/auth.functions";
import { canAccess } from "@/lib/access";
import { AuthContext, UNAUTHORIZED_EVENT, type AuthState } from "@/lib/auth-store";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // The query cache (routes/__root.tsx provides it above this): cleared when a session ends, so a
  // shared device never shows the previous person's cached rows (Oct 20 — Work Overview kept
  // its list for five minutes across a sign-out and a sign-in).
  const queryClient = useQueryClient();
  // The profile as the auth listener sees it (its closure is from the first render).
  const profileRef = useRef<UserProfile | null>(null);

  async function loadProfile(current: Session | null) {
    if (!current) {
      profileRef.current = null;
      setProfile(null);
      return;
    }
    try {
      let p = await getMyProfile();
      if (!p) {
        // One retry: the first read right after login can race token propagation
        // (mobile especially); a beat later it resolves.
        await new Promise((r) => setTimeout(r, 1200));
        p = await getMyProfile();
      }
      profileRef.current = p;
      setProfile(p);
    } catch {
      profileRef.current = null;
      setProfile(null);
    }
  }

  useEffect(() => {
    let active = true;

    // Safety net: if the stored session / profile read never settles (a stuck auth lock in the
    // browser, an unreachable auth server), stop "loading" so the gate can show a way out
    // instead of spinning forever.
    const guard = setTimeout(() => {
      if (active) setLoading(false);
    }, 12_000);

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, next) => {
      if (!active) return;
      // A sign-in with no profile yet (Oct 20): `loading` holds the gate's redirect off /login
      // until the profile is here, so the landing page is the person's own (homeFor: a
      // technician-only user's is My tickets, not Work Overview). A token refresh on an open
      // page has its profile and never flips it.
      if (event === "SIGNED_IN" && next && !profileRef.current) setLoading(true);
      setSession(next);
      await loadProfile(next);
      setLoading(false);
    });

    // A query hit Unauthorized (router.tsx): the stored token is unusable — drop the session so
    // the gate redirects to /login. Local sign-out only: no network round trip that could hang.
    const onUnauthorized = () => {
      if (!active) return;
      void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      setSession(null);
      profileRef.current = null;
      setProfile(null);
      setLoading(false);
      queryClient.clear();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);

    return () => {
      active = false;
      clearTimeout(guard);
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const value: AuthState = {
    session,
    profile,
    role: profile?.role ?? null,
    can: (page) => canAccess(profile, page),
    loading,
    signOut: async () => {
      // A shared phone must not keep receiving the previous user's reminders (push is per
      // device); best effort, before the session goes.
      try {
        const { disablePushHere } = await import("@/lib/push-client");
        await disablePushHere();
      } catch {
        /* no push on this device */
      }
      await supabase.auth.signOut();
      profileRef.current = null;
      setProfile(null);
      // Nothing of this person stays for the next one (the gate has already swapped the page for
      // its spinner on the SIGNED_OUT event, so no mounted query is left reading the cache).
      queryClient.clear();
    },
    refreshProfile: async () => {
      const { data } = await supabase.auth.getSession();
      await loadProfile(data.session);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
