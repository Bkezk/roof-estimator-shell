/**
 * The gate no longer fails open when the profile load FAILED (the fifth audit, Oct 20; item
 * 1(iii)). `blocked` used to need a profile (`!!profile && …`), so with getMyProfile throwing —
 * or finding no row — every gated page rendered its chrome and ran its queries (the server
 * refused them one by one). Now lib/auth-flow.ts gateDecision(session, profile, profileFailed,
 * page) says "blocked" for a page that needs a profile once its load failed, "open" while it is
 * merely pending, and the routes every signed-in user may open (pageForPath null: Work Overview,
 * /account, Inventory …) stay open. The provider exposes `profileFailed` (lib/auth-context.tsx →
 * auth-store.ts AuthState).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pageForPath } from "@/lib/access";
import { gateDecision } from "@/lib/auth-flow";

const read = (p: string) => readFileSync(p, "utf8");
const S = { access_token: "t" };
const tech = { role: "user", access: ["service"], technician: true };
const office = { role: "user", access: ["service", "customers", "estimate", "pricing"] };
const manager = { role: "manager", access: [] };
const admin = { role: "admin", access: [] };

describe("gateDecision", () => {
  it("no session → no-session, whatever the page", () => {
    expect(gateDecision(null, null, false, "pricing")).toBe("no-session");
    expect(gateDecision(null, admin, true, null)).toBe("no-session");
  });
  it("a route every signed-in user may open is open with no profile, pending or failed", () => {
    for (const path of ["/my-work", "/account", "/followups", "/opportunities/1", "/"]) {
      const page = pageForPath(path);
      expect(page, path).toBeNull();
      expect(gateDecision(S, null, false, page)).toBe("open");
      expect(gateDecision(S, null, true, page)).toBe("open");
    }
  });
  it("Inventory is everyone's (EVERYONE_PAGES): open for a technician, and open on a failed load too", () => {
    expect(pageForPath("/inventory")).toBe("inventory");
    expect(gateDecision(S, tech, false, "inventory")).toBe("open");
    expect(gateDecision(S, null, false, "inventory")).toBe("open");
    expect(gateDecision(S, null, true, "inventory")).toBe("open");
  });
  it("profile pending (not failed) → open, as before; profile FAILED → blocked for a gated page", () => {
    for (const page of [
      "pricing",
      "estimate",
      "service",
      "customers",
      "admin",
      "manager",
    ] as const) {
      expect(gateDecision(S, null, false, page)).toBe("open");
      expect(gateDecision(S, null, true, page)).toBe("blocked");
    }
  });
  it("with a profile the page's own rule decides (admin → isAdmin, manager → managesTickets, else canAccess)", () => {
    expect(gateDecision(S, tech, false, "pricing")).toBe("blocked");
    expect(gateDecision(S, tech, false, "service")).toBe("open");
    expect(gateDecision(S, office, false, "pricing")).toBe("open");
    expect(gateDecision(S, office, false, "admin")).toBe("blocked");
    expect(gateDecision(S, office, false, "manager")).toBe("blocked");
    expect(gateDecision(S, manager, false, "manager")).toBe("open");
    expect(gateDecision(S, manager, false, "admin")).toBe("blocked");
    expect(gateDecision(S, admin, false, "admin")).toBe("open");
    // A stale `profileFailed` cannot block someone whose profile is here.
    expect(gateDecision(S, admin, true, "admin")).toBe("open");
  });
});

describe("the wiring", () => {
  it("the provider exposes profileFailed: set on a throw and on no row after the retry, cleared by a load that succeeds, a sign-out and a lost session", () => {
    const auth = read("src/lib/auth-context.tsx");
    expect(auth).toContain("const [profileFailed, setProfileFailed] = useState(false);");
    expect(auth).toMatch(
      /profileRef\.current = p;\s*setProfile\(p\);[\s\S]*?setProfileFailed\(!p\);/,
    );
    expect(auth).toMatch(
      /\} catch \{\s*profileRef\.current = null;\s*setProfile\(null\);\s*setProfileFailed\(true\);\s*\}/,
    );
    expect(auth).toMatch(
      /if \(!current\) \{\s*profileRef\.current = null;\s*setProfile\(null\);\s*setProfileFailed\(false\);/,
    );
    expect((auth.match(/setProfileFailed\(false\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(auth).toMatch(/loading,\s*profileFailed,/);
    expect(read("src/lib/auth-store.ts")).toContain("profileFailed: boolean;");
  });
  it("the gate reads it and decides through gateDecision; the open routes and Waiting are as before", () => {
    const gate = read("src/components/auth-gate.tsx");
    expect(gate).toContain(
      "const { session, profile, profileFailed, loading, refreshProfile } = useAuth();",
    );
    expect(gate).toContain(
      'const blocked = gateDecision(session, profile, profileFailed, page) === "blocked";',
    );
    expect(gate).not.toMatch(/const blocked =\s*!!profile &&/);
    expect(gate).toContain("if (blocked) return <Waiting />;");
    expect(gate).toMatch(/else if \(session && blocked\) \{\s*navigate\(\{ to: home \}\);/);
  });
});
