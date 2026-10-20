/**
 * /service/today no longer blocks on a failed first profile load, and a block on a failed load is
 * said out loud (the sixth audit, Oct 21; item a). pageForPath("/service/today") was "service",
 * so a technician-only user whose first profile read failed was blocked from their own landing
 * page and sent to Work Overview (homeFor(null)), in silence. Now the route is null (every
 * signed-in user's, like /my-work: the server lists the caller's own tickets), and the gate, when
 * it blocks because `profileFailed` (lib/auth-flow.ts blockedForProfile — not a real access
 * miss), toasts PROFILE_MISSING_TOAST with a "Try again" action that runs refreshProfile, once
 * per block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { homeFor, pageForPath } from "@/lib/access";
import { blockedForProfile, gateDecision } from "@/lib/auth-flow";

const read = (p: string) => readFileSync(p, "utf8");
const S = { access_token: "t" };
const tech = { role: "user", access: ["service"], technician: true };
const office = { role: "user", access: ["service", "customers"], technician: false };

describe("pageForPath('/service/today')", () => {
  it("is null — open to every signed-in user, pending or failed profile alike", () => {
    expect(pageForPath("/service/today")).toBeNull();
    expect(gateDecision(S, null, false, pageForPath("/service/today"))).toBe("open");
    expect(gateDecision(S, null, true, pageForPath("/service/today"))).toBe("open");
    expect(gateDecision(S, tech, false, pageForPath("/service/today"))).toBe("open");
    expect(gateDecision(S, office, false, pageForPath("/service/today"))).toBe("open");
  });
  it("the technician-only landing page is never a blocked route; the rest of Service still is Service", () => {
    expect(homeFor(tech)).toBe("/service/today");
    expect(pageForPath(homeFor(tech))).toBeNull();
    expect(pageForPath("/service")).toBe("service");
    expect(pageForPath("/service/board")).toBe("service");
    expect(pageForPath("/service/invoices")).toBe("invoices");
    expect(gateDecision(S, null, true, pageForPath("/service"))).toBe("blocked");
  });
  it("the sidebar still lists My tickets for the Technician tick only, and nothing with no profile", () => {
    const side = read("src/components/app-sidebar.tsx");
    expect(side).toMatch(/title: "My tickets",\s*url: "\/service\/today",[\s\S]*?techOnly: true,/);
    expect(side).toContain(".filter((item) => !item.techOnly || !!profile?.technician)");
    // The page itself reads only the session (the server scopes the day to the caller).
    const today = read("src/components/service/today-page.tsx");
    expect(today).toMatch(/export function TodayPage\(\) \{\s*const \{ session \} = useAuth\(\);/);
    expect(read("src/routes/service.today.tsx")).toContain("pageForPath: /service/today → null");
  });
});

describe("blockedForProfile", () => {
  it("true only for a block with no profile and a FAILED load", () => {
    expect(blockedForProfile(true, null, true)).toBe(true);
    // A real access miss (a profile in hand) is the page's rule: quiet.
    expect(blockedForProfile(true, tech, false)).toBe(false);
    expect(blockedForProfile(true, tech, true)).toBe(false);
    // Not blocked at all, or merely pending.
    expect(blockedForProfile(false, null, true)).toBe(false);
    expect(blockedForProfile(true, null, false)).toBe(false);
  });
  it("agrees with gateDecision on the cases that matter", () => {
    const blockedNull = gateDecision(S, null, true, "service") === "blocked";
    expect(blockedForProfile(blockedNull, null, true)).toBe(true);
    const blockedTech = gateDecision(S, tech, false, "pricing") === "blocked";
    expect(blockedForProfile(blockedTech, tech, false)).toBe(false);
  });
});

describe("the gate (components/auth-gate.tsx)", () => {
  const gate = read("src/components/auth-gate.tsx");
  it("toasts PROFILE_MISSING_TOAST with a Try again that runs refreshProfile, once per block, after loading", () => {
    expect(gate).toMatch(/import \{[^}]*\bblockedForProfile\b[^}]*\} from "@\/lib\/auth-flow";/);
    expect(gate).toContain(
      "const profileBlock = blockedForProfile(blocked, profile, profileFailed);",
    );
    expect(gate).toMatch(
      /useEffect\(\(\) => \{\s*if \(loading \|\| !profileBlock\) return;\s*toast\.warning\(PROFILE_MISSING_TOAST, \{\s*action: \{ label: "Try again", onClick: \(\) => void refreshRef\.current\(\) \},\s*\}\);\s*\}, \[loading, profileBlock\]\);/,
    );
    // The redirect itself is as it was (the toast is beside it, not instead of it).
    expect(gate).toMatch(/\} else if \(session && blocked\) \{\s*navigate\(\{ to: home \}\);\s*\}/);
    expect(gate).toContain("if (blocked) return <Waiting />;");
  });
});
