import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { getMyProfile, type UserProfile } from "@/lib/auth.functions";
import { canAccess } from "@/lib/access";
import { AuthContext, UNAUTHORIZED_EVENT, type AuthState } from "@/lib/auth-store";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(current: Session | null) {
    if (!current) {
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
      setProfile(p);
    } catch {
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

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
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
      setProfile(null);
      setLoading(false);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);

    return () => {
      active = false;
      clearTimeout(guard);
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthState = {
    session,
    profile,
    role: profile?.role ?? null,
    can: (page) => canAccess(profile, page),
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
    },
    refreshProfile: async () => {
      const { data } = await supabase.auth.getSession();
      await loadProfile(data.session);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
