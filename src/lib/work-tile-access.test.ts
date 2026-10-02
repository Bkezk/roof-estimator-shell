/**
 * Audit, Oct 2, item 2: the counts strip's ticket tiles linked to /service for everyone; a
 * Customers-only user who clicked one was bounced by the gate (pageForPath("/service") needs
 * Service) to My Work. A tile links only when the user may open its page; otherwise it shows
 * the number without a link, titled "Needs Service access".
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { pageForPath } from "@/lib/access";
import { tileHref, WORK_TILES } from "@/lib/work-counts";
// Loaded in beforeAll, so the strip test below still runs (and fails) against the old code.
let m: typeof import("@/lib/work-tile-access");

const customersOnly = { role: "user", access: ["customers"] };
const serviceOnly = { role: "user", access: ["service"] };
const manager = { role: "manager", access: [] };
const admin = { role: "admin", access: [] };

describe("tileBlockedTitle", () => {
  beforeAll(async () => {
    m = await import("@/lib/work-tile-access");
  });
  it("a Customers-only user: the ticket tiles are not links ('Needs Service access'); the opportunity tiles are", () => {
    expect(pageForPath(tileHref("openTickets").to)).toBe("service");
    expect(m.tileBlockedTitle(customersOnly, "openTickets")).toBe("Needs Service access");
    expect(m.tileBlockedTitle(customersOnly, "overdueTickets")).toBe("Needs Service access");
    expect(m.tileBlockedTitle(customersOnly, "openOpps")).toBeNull();
    expect(m.tileBlockedTitle(customersOnly, "overdueOpps")).toBeNull();
  });
  it("a manager and an admin: every tile links", () => {
    for (const p of [manager, admin])
      for (const t of WORK_TILES) expect(m.tileBlockedTitle(p, t.kind)).toBeNull();
  });
  it("a Service-only user: tickets link, and so do opportunities (the page is open to every signed-in user; the list shows their own)", () => {
    expect(m.tileBlockedTitle(serviceOnly, "openTickets")).toBeNull();
    expect(m.tileBlockedTitle(serviceOnly, "openOpps")).toBeNull();
    // A technician with no page grants at all: tickets blocked, opportunities still open.
    expect(m.tileBlockedTitle({ role: "user", access: [], technician: true }, "openTickets")).toBe(
      "Needs Service access",
    );
    expect(
      m.tileBlockedTitle({ role: "user", access: [], technician: true }, "openOpps"),
    ).toBeNull();
  });
  it("canOpenPath is the gate's rule (admin pages, manager pages, free pages; no profile = no)", () => {
    expect(m.canOpenPath(customersOnly, "/service")).toBe(false);
    expect(m.canOpenPath(customersOnly, "/opportunities")).toBe(true);
    expect(m.canOpenPath(customersOnly, "/my-work")).toBe(true);
    expect(m.canOpenPath(manager, "/admin/users")).toBe(false);
    expect(m.canOpenPath(manager, "/admin/service-rates")).toBe(true);
    expect(m.canOpenPath(customersOnly, "/admin/service-rates")).toBe(false);
    expect(m.canOpenPath(admin, "/admin/users")).toBe(true);
    expect(m.canOpenPath(null, "/service")).toBe(false);
  });
});

describe("the strip (work-counts-strip.tsx)", () => {
  const src = readFileSync("src/components/work-counts-strip.tsx", "utf8");
  it("renders a Link only when the tile is not blocked; otherwise a titled div", () => {
    expect(src).toContain("const blocked = tileBlockedTitle(profile, t.kind);");
    expect(src).toMatch(/if \(blocked\)\s*return \(\s*<div\s+key=\{t\.kind\}\s+title=\{blocked\}/);
    expect(src.indexOf("if (blocked)")).toBeLessThan(src.indexOf("<Link"));
    expect(src).toContain("const { session, profile } = useAuth();");
  });
});
