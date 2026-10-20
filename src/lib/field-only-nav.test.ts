/**
 * A technician-only user's menu and landing (owner, Oct 15: "if logged in as a technician-only
 * user they should really only see My tickets and Inventory, not Service and Work Overview").
 * Fails on the old code: Work Overview and Service in the menu for everyone, everyone landing
 * on Work Overview.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { homeFor, isFieldOnly, pageForPath } from "@/lib/access";

const techOnly = { role: "user", access: ["service", "inventory"], technician: true };
const officeTech = { role: "user", access: ["service", "customers"], technician: true };
const manager = { role: "manager", access: [], technician: false };

describe("homeFor", () => {
  it("a technician-only user lands on My tickets; everyone else on Work Overview", () => {
    expect(isFieldOnly(techOnly)).toBe(true);
    expect(homeFor(techOnly)).toBe("/service/today");
    expect(homeFor(officeTech)).toBe("/my-work");
    expect(homeFor(manager)).toBe("/my-work");
    expect(homeFor(null)).toBe("/my-work");
  });
  it("My tickets is every signed-in user's route (Oct 21), like Work Overview — the landing page never blocks", () => {
    expect(pageForPath(homeFor(techOnly))).toBeNull();
    expect(pageForPath(homeFor(null))).toBeNull();
  });
});

describe("the sidebar", () => {
  const src = readFileSync("src/components/app-sidebar.tsx", "utf8");
  it("Work Overview is not shown to a technician-only user", () => {
    expect(src).toContain("{profile && !isTech && (");
    expect(src.indexOf("{profile && !isTech && (")).toBeLessThan(
      src.indexOf('tooltip="Work Overview"'),
    );
  });
  it("the Service item is the office's; My tickets and Inventory stay", () => {
    const service = src.slice(
      src.indexOf('title: "Service",'),
      src.indexOf('title: "Opportunities",'),
    );
    expect(service).toContain("office: true,");
    expect(src).toContain(".filter((item) => !(item.office && isTech))");
    expect(src).toContain('title: "My tickets"');
    expect(src).toContain('{ title: "Inventory", url: "/inventory", icon: Package }');
  });
});

describe("an old Work Overview link", () => {
  it("sends a technician-only user to My tickets", () => {
    const route = readFileSync("src/routes/my-work.tsx", "utf8");
    expect(route).toContain(
      "if (isFieldOnly(profile)) return <Navigate to={homeFor(profile)} replace />;",
    );
  });
});
