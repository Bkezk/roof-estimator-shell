import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";

import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  nextProfileState,
  PROFILE_HOLD_MS,
  PROFILE_REFRESH_FAILED_TOAST,
  profileRefreshWarnDue,
  shouldHoldForProfile,
  type ProfileLoadResult,
} from "@/lib/auth-flow";
import { getMyProfile, type UserProfile } from "@/lib/auth.functions";
import { canAccess } from "@/lib/access";
import { AuthContext, UNAUTHORIZED_EVENT, type AuthState } from "@/lib/auth-store";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Oct 20: the last load failed (thrown, or no row after the retry); cleared by a load that
  // succeeds and by a session ending. The gate blocks the pages that need a profile on it.
  const [profileFailed, setProfileFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The query cache (routes/__root.tsx provides it above this): cleared when a session ends, so a
  // shared device never shows the previous person's cached rows (Oct 20 — Work Overview kept
  // its list for five minutes across a sign-out and a sign-in).
  const queryClient = useQueryClient();
  // The profile as the auth listener sees it (its closure is from the first render).
  const profileRef = useRef<UserProfile | null>(null);
  // The session the listener last saw (Oct 20): a SIGNED_IN with none before is a real sign-in.
  const sessionRef = useRef<Session | null>(null);
  // When the "could not refresh your profile" toast was last shown (Oct 21): at most one per
  // PROFILE_REFRESH_WARN_EVERY_MS, however often a tab wakes.
  const warnedAtRef = useRef<number | null>(null);

  async function loadProfile(current: Session | null) {
    if (!current) {
      profileRef.current = null;
      setProfile(null);
      setProfileFailed(false);
      return;
    }
    // Oct 21 (the sixth audit): a profile already held this session survives a failed RE-read
    // (TOKEN_REFRESHED, a tab-wake SIGNED_IN, refreshProfile) — nulling it and setting
    // profileFailed made the gate send the person home from the page they were on. Only a load
    // with no profile to begin with fails (lib/auth-flow.ts nextProfileState); a session that
    // ends still clears everything above.
    const held = profileRef.current;
    let result: ProfileLoadResult<UserProfile>;
    try {
      let p = await getMyProfile();
      if (!p) {
        // One retry: the first read right after login can race token propagation
        // (mobile especially); a beat later it resolves.
        await new Promise((r) => setTimeout(r, 1200));
        p = await getMyProfile();
      }
      // No row after the retry is a failed load too: the gate must not fail open on it.
      result = { ok: true, profile: p };
    } catch {
      result = { ok: false };
    }
    const next = nextProfileState(held, result);
    profileRef.current = next.profile;
    setProfile(next.profile);
    setProfileFailed(next.failed);
    if (next.kept) {
      console.warn("Profile re-read failed; keeping the profile already held this session");
      const now = Date.now();
      if (profileRefreshWarnDue(warnedAtRef.current, now)) {
        warnedAtRef.current = now;
        toast.warning(PROFILE_REFRESH_FAILED_TOAST);
      }
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
      sessionRef.current = data.session;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, next) => {
      if (!active) return;
      const had = sessionRef.current;
      sessionRef.current = next;
      // A session that ended outside signOut (Oct 20): another tab's sign-out, a refresh that
      // failed — nothing of this person stays cached for the next one.
      if (event === "SIGNED_OUT" || (!next && had)) queryClient.clear();
      // A real sign-in (Oct 20, shouldHoldForProfile: no session before, one now): `loading`
      // holds the gate's redirect off /login until the profile is here, so the landing page is
      // the person's own (homeFor: a technician-only user's is My tickets, not Work Overview).
      // auth-js emits SIGNED_IN on every tab wake too; with a session already here that is no
      // sign-in, and holding on it (as "no profile yet" did) remounted the page under the
      // spinner on every wake while the profile was null. A token refresh never holds.
      let guard: ReturnType<typeof setTimeout> | null = null;
      if (shouldHoldForProfile(had, next, event)) {
        setLoading(true);
        // Bounded like the mount guard: a profile read that never settles lets the gate go on.
        guard = setTimeout(() => {
          if (active) setLoading(false);
        }, PROFILE_HOLD_MS);
      }
      setSession(next);
      await loadProfile(next);
      if (guard) clearTimeout(guard);
      setLoading(false);
    });

    // A query hit Unauthorized (router.tsx): the stored token is unusable — drop the session so
    // the gate redirects to /login. Local sign-out only: no network round trip that could hang.
    const onUnauthorized = () => {
      if (!active) return;
      void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      sessionRef.current = null;
      setSession(null);
      profileRef.current = null;
      setProfile(null);
      setProfileFailed(false);
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
    profileFailed,
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
      setProfileFailed(false);
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
