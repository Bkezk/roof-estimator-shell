import { describe, it, expect } from "vitest";

import {
  PAGES,
  canAccess,
  homeFor,
  isAdmin,
  isOffice,
  normalizeAccess,
  normalizeRole,
  pageForPath,
  seesEveryone,
} from "./access";

describe("per-page access", () => {
  const admin = { role: "admin", access: [] };
  const estimator = { role: "user", access: ["estimate"] };
  const field = { role: "user", access: ["inventory"] };
  const both = { role: "user", access: ["estimate", "inventory"] };
  const pricingOnly = { role: "user", access: ["pricing"] };

  it("admins reach everything; users only what is granted", () => {
    expect(canAccess(admin, "estimate")).toBe(true);
    expect(canAccess(admin, "pricing")).toBe(true);
    expect(canAccess(estimator, "estimate")).toBe(true);
    expect(canAccess(estimator, "inventory")).toBe(false);
    expect(canAccess(field, "inventory")).toBe(true);
    expect(canAccess(field, "estimate")).toBe(false);
    expect(canAccess(null, "estimate")).toBe(false);
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(both)).toBe(false);
  });

  it("maps routes to pages", () => {
    expect(pageForPath("/bids")).toBe("estimate");
    expect(pageForPath("/estimate")).toBe("estimate");
    expect(pageForPath("/proposal")).toBe("estimate");
    expect(pageForPath("/inventory")).toBe("inventory");
    expect(pageForPath("/admin/settings")).toBe("pricing");
    expect(pageForPath("/admin/price-import")).toBe("pricing");
    expect(pageForPath("/admin/users")).toBe("admin");
    expect(pageForPath("/admin/reminders")).toBe("admin");
    expect(pageForPath("/admin/service-rates")).toBe("admin");
    expect(pageForPath("/account")).toBeNull();
  });

  it("lands every signed-in user on My Work (owner, Sep 30)", () => {
    expect(homeFor(admin)).toBe("/my-work");
    expect(homeFor(estimator)).toBe("/my-work");
    expect(homeFor(field)).toBe("/my-work");
    expect(homeFor(pricingOnly)).toBe("/my-work");
    expect(homeFor({ role: "user", access: [] })).toBe("/my-work");
    expect(homeFor({ role: "user", access: ["service"], technician: true })).toBe("/my-work");
    expect(homeFor({ role: "manager", access: [] })).toBe("/my-work");
    expect(homeFor(null)).toBe("/my-work");
    // Every signed-in user may open My Work (and "/" only redirects there).
    expect(pageForPath("/my-work")).toBeNull();
    expect(pageForPath("/")).toBeNull();
    expect(pageForPath("/service")).toBe("service");
    expect(pageForPath("/customers")).toBe("customers");
    expect(pageForPath("/opportunities")).toBe("customers");
    expect(pageForPath("/followups")).toBeNull();
  });

  it("a manager reaches every page but Estimate Pricing, and no admin page", () => {
    const manager = { role: "manager", access: [] };
    for (const page of PAGES) expect(canAccess(manager, page)).toBe(page !== "pricing");
    expect(isAdmin(manager)).toBe(false);
    expect(pageForPath("/admin/users")).toBe("admin");
    expect(pageForPath("/admin/settings")).toBe("pricing");
    expect(normalizeRole("manager")).toBe("manager");
    expect(normalizeRole("admin")).toBe("admin");
    expect(normalizeRole("estimator")).toBe("user");
  });

  it("admins and managers see everyone and dispatch, even when ticked Technician", () => {
    const tech = { role: "user", access: ["service"], technician: true };
    const office = { role: "user", access: ["service"], technician: false };
    const managerTech = { role: "manager", access: [], technician: true };
    const adminTech = { role: "admin", access: [], technician: true };
    expect(seesEveryone(tech)).toBe(false);
    expect(seesEveryone(office)).toBe(false);
    expect(seesEveryone(managerTech)).toBe(true);
    expect(seesEveryone(adminTech)).toBe(true);
    expect(isOffice(tech)).toBe(false);
    expect(isOffice(office)).toBe(true);
    expect(isOffice(managerTech)).toBe(true);
    expect(isOffice(adminTech)).toBe(true);
    expect(isOffice(null)).toBe(false);
  });

  it("normalizes a stored access list", () => {
    expect(normalizeAccess(["inventory", "bogus", "estimate"])).toEqual(["estimate", "inventory"]);
    expect(normalizeAccess(null)).toEqual([]);
  });
});
