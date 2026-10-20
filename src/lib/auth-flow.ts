/**
 * The sign-in flow's rules (Oct 20, the fourth audit), pure so they can be tested apart from
 * the provider (lib/auth-context.tsx), the gate (components/auth-gate.tsx) and the login page
 * (routes/login.tsx) that apply them:
 *
 *  - `shouldHoldForProfile`: when a session change holds the gate's /login redirect for the
 *    profile. Only a real sign-in — no session before, one now — does; auth-js emits SIGNED_IN
 *    on every hidden → visible recovery too, and holding on those (as "SIGNED_IN with no profile
 *    yet" did) swapped the whole page for the spinner on every tab wake while the profile was
 *    null. A TOKEN_REFRESHED never holds.
 *  - `landingDecision`: where a signed-in visitor of /login goes. With a profile, home
 *    (homeFor: Work Overview, My tickets for a technician-only user). Without one, not yet —
 *    homeFor(null) is Work Overview, wrong for a technician whose profile is merely late — the
 *    profile is asked for again, PROFILE_LANDING_TRIES times PROFILE_RETRY_MS apart, and only
 *    then do they land on homeFor(null), told why (PROFILE_MISSING_TOAST).
 *  - The two bounds: SIGN_IN_STALL_MS before the login page (like the gate's Waiting) offers
 *    Reload / Sign in again, and PROFILE_HOLD_MS before the provider lets `loading` go when a
 *    profile read after a sign-in never settles (the same bound as its mount guard).
 */

import {
  canAccess,
  EVERYONE_PAGES,
  isAdmin,
  managesTickets,
  type AccessLike,
  type Page,
} from "@/lib/access";

/** How long a sign-in may hang before the way out is offered (the gate's Waiting uses it too). */
export const SIGN_IN_STALL_MS = 8_000;
/** How long the provider holds `loading` for a sign-in's profile before giving it up. */
export const PROFILE_HOLD_MS = 12_000;
/** How many times the gate asks for a missing profile before landing without one. */
export const PROFILE_LANDING_TRIES = 3;
/** The wait between those asks (each ask itself retries once, lib/auth-context.tsx loadProfile). */
export const PROFILE_RETRY_MS = 1_200;
export const PROFILE_MISSING_TOAST =
  "Could not load your profile — some pages may be missing until you reload";

/**
 * Hold the gate's redirect for the profile? Only a fresh sign-in: a SIGNED_IN with no session
 * before it. A tab wake (SIGNED_IN with a session already here), a TOKEN_REFRESHED, a SIGNED_OUT
 * and anything else never holds.
 */
export function shouldHoldForProfile(
  prevSession: unknown,
  nextSession: unknown,
  event: string,
): boolean {
  return event === "SIGNED_IN" && !!nextSession && !prevSession;
}

export type LandingDecision = "stay" | "home" | "retry" | "home-without-profile";

/**
 * A signed-in visitor of /login: "home" with a profile; "retry" (ask for the profile again)
 * while tries remain; "home-without-profile" once they are spent; "stay" without a session (the
 * login page is theirs to use).
 */
export function landingDecision(
  session: unknown,
  profile: unknown,
  tries: number,
): LandingDecision {
  if (!session) return "stay";
  if (profile) return "home";
  return tries < PROFILE_LANDING_TRIES ? "retry" : "home-without-profile";
}

export type GateDecision = "no-session" | "open" | "blocked";

/**
 * May the gate render this route (Oct 20, the fifth audit)? `page` is pageForPath(pathname):
 * null routes (/my-work, /account, /inventory, /followups, /opportunities, "/") are every
 * signed-in user's and always "open". A route that belongs to a page needs the profile: with
 * one, the page's own rule (admin → isAdmin, manager → managesTickets, else canAccess); with
 * none still loading (`profileFailed` false), "open" as before — nothing is blocked while the
 * profile is merely pending; with the load FAILED (getMyProfile threw, or found no row after its
 * retry), "blocked" — the gate used to fail open there, rendering the page's chrome and letting
 * its queries run (the server refused them one by one). The pages every signed-in user has
 * without a tick (EVERYONE_PAGES: Inventory) stay open on a failed load, as the null routes do.
 * Without a session, "no-session".
 */
export function gateDecision(
  session: unknown,
  profile: AccessLike | null | undefined,
  profileFailed: boolean,
  page: Page | "admin" | "manager" | null,
): GateDecision {
  if (!session) return "no-session";
  if (page === null) return "open";
  if (!profile)
    return profileFailed && !(EVERYONE_PAGES as readonly string[]).includes(page)
      ? "blocked"
      : "open";
  const ok =
    page === "admin"
      ? isAdmin(profile)
      : page === "manager"
        ? managesTickets(profile)
        : canAccess(profile, page);
  return ok ? "open" : "blocked";
}

/** Has a sign-in waited long enough to offer the way out? */
export const signInStalled = (leaving: boolean, waitedMs: number): boolean =>
  leaving && waitedMs >= SIGN_IN_STALL_MS;
