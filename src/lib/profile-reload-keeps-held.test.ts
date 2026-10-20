/**
 * A failed profile RE-load no longer evicts the person (the sixth audit, Oct 21; item 1).
 * lib/auth-context.tsx loadProfile nulled the profile and set profileFailed on ANY throw — the
 * re-read on TOKEN_REFRESHED and on a tab-wake SIGNED_IN included — and the gate (gateDecision
 * "blocked" on profileFailed) then sent them home from the page they were on. Now the outcome
 * goes through lib/auth-flow.ts nextProfileState: with a profile already held this session a
 * failed re-read (a throw, or no row after the retry) KEEPS it and nothing fails (console.warn +
 * PROFILE_REFRESH_FAILED_TOAST at most once per PROFILE_REFRESH_WARN_EVERY_MS); only a load with
 * no profile to begin with nulls it and sets profileFailed. A session that ends still clears the
 * profile (loadProfile(null), signOut, the Unauthorized event).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  nextProfileState,
  PROFILE_REFRESH_FAILED_TOAST,
  PROFILE_REFRESH_WARN_EVERY_MS,
  profileRefreshWarnDue,
} from "@/lib/auth-flow";

const read = (p: string) => readFileSync(p, "utf8");
const held = { id: "u1", role: "user", access: ["service"], technician: true };
const fresh = { id: "u1", role: "user", access: ["service", "customers"], technician: true };

describe("nextProfileState", () => {
  it("a row: it is the profile, nothing failed, whether or not one was held", () => {
    expect(nextProfileState(null, { ok: true, profile: fresh })).toEqual({
      profile: fresh,
      failed: false,
      kept: false,
    });
    // A re-read that succeeds replaces the held one (an access change lands).
    expect(nextProfileState(held, { ok: true, profile: fresh })).toEqual({
      profile: fresh,
      failed: false,
      kept: false,
    });
  });
  it("a throw with a profile held: the held one is KEPT and nothing failed (the old code evicted)", () => {
    expect(nextProfileState(held, { ok: false })).toEqual({
      profile: held,
      failed: false,
      kept: true,
    });
  });
  it("no row after the retry with a profile held: kept too", () => {
    expect(nextProfileState(held, { ok: true, profile: null })).toEqual({
      profile: held,
      failed: false,
      kept: true,
    });
  });
  it("with no profile to begin with a throw or no row is null + failed, as before", () => {
    expect(nextProfileState(null, { ok: false })).toEqual({
      profile: null,
      failed: true,
      kept: false,
    });
    expect(nextProfileState(null, { ok: true, profile: null })).toEqual({
      profile: null,
      failed: true,
      kept: false,
    });
  });
});

describe("the 'could not refresh' toast is said at most once per five minutes", () => {
  it("the texts and the bound", () => {
    expect(PROFILE_REFRESH_FAILED_TOAST).toBe(
      "Could not refresh your profile — some things may be out of date",
    );
    expect(PROFILE_REFRESH_WARN_EVERY_MS).toBe(5 * 60_000);
  });
  it("profileRefreshWarnDue: never warned → due; warned under five minutes ago → not; at or past → due", () => {
    const t = 1_000_000;
    expect(profileRefreshWarnDue(null, t)).toBe(true);
    expect(profileRefreshWarnDue(t, t)).toBe(false);
    expect(profileRefreshWarnDue(t, t + PROFILE_REFRESH_WARN_EVERY_MS - 1)).toBe(false);
    expect(profileRefreshWarnDue(t, t + PROFILE_REFRESH_WARN_EVERY_MS)).toBe(true);
    expect(profileRefreshWarnDue(t, t + 60 * 60_000)).toBe(true);
  });
});

describe("the provider (lib/auth-context.tsx)", () => {
  const auth = read("src/lib/auth-context.tsx");
  it("loadProfile keeps the held profile through nextProfileState; a throw no longer nulls it", () => {
    expect(auth).toContain("const held = profileRef.current;");
    expect(auth).toMatch(
      /let result: ProfileLoadResult<UserProfile>;\s*try \{\s*let p = await getMyProfile\(\);[\s\S]*?result = \{ ok: true, profile: p \};\s*\} catch \{\s*result = \{ ok: false \};\s*\}/,
    );
    expect(auth).toMatch(
      /const next = nextProfileState\(held, result\);\s*profileRef\.current = next\.profile;\s*setProfile\(next\.profile\);\s*setProfileFailed\(next\.failed\);/,
    );
    // The old eviction is gone.
    expect(auth).not.toMatch(/\} catch \{\s*profileRef\.current = null;\s*setProfile\(null\);/);
    expect(auth).not.toContain("setProfileFailed(!p)");
    expect(auth).not.toContain("setProfileFailed(true)");
  });
  it("a kept profile warns: console.warn and the toast, throttled by profileRefreshWarnDue", () => {
    expect(auth).toContain('import { toast } from "sonner";');
    expect(auth).toContain("const warnedAtRef = useRef<number | null>(null);");
    expect(auth).toMatch(
      /if \(next\.kept\) \{\s*console\.warn\([^)]*\);\s*const now = Date\.now\(\);\s*if \(profileRefreshWarnDue\(warnedAtRef\.current, now\)\) \{\s*warnedAtRef\.current = now;\s*toast\.warning\(PROFILE_REFRESH_FAILED_TOAST\);\s*\}\s*\}/,
    );
  });
  it("a real sign-out or a lost session still clears the profile (session null → profile null)", () => {
    expect(auth).toMatch(
      /async function loadProfile\(current: Session \| null\) \{\s*if \(!current\) \{\s*profileRef\.current = null;\s*setProfile\(null\);\s*setProfileFailed\(false\);\s*return;\s*\}/,
    );
    // The listener passes the new session (null on SIGNED_OUT) straight to loadProfile.
    expect(auth).toMatch(/setSession\(next\);\s*await loadProfile\(next\);/);
    expect(auth).toMatch(
      /await supabase\.auth\.signOut\(\);\s*profileRef\.current = null;\s*setProfile\(null\);\s*setProfileFailed\(false\);/,
    );
    expect(auth).toMatch(
      /const onUnauthorized = \(\) => \{[\s\S]*?profileRef\.current = null;\s*setProfile\(null\);\s*setProfileFailed\(false\);/,
    );
  });
});
