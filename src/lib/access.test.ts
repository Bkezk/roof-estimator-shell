import { describe, it, expect } from "vitest";

import { canAccess, homeFor, isAdmin, normalizeAccess, pageForPath } from "./access";

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
    expect(pageForPath("/account")).toBeNull();
  });

  it("lands each user on the first page they may open", () => {
    expect(homeFor(admin)).toBe("/bids");
    expect(homeFor(estimator)).toBe("/bids");
    expect(homeFor(field)).toBe("/inventory");
    expect(homeFor(pricingOnly)).toBe("/admin/settings");
    expect(homeFor({ role: "user", access: [] })).toBe("/account");
  });

  it("normalizes a stored access list", () => {
    expect(normalizeAccess(["inventory", "bogus", "estimate"])).toEqual(["estimate", "inventory"]);
    expect(normalizeAccess(null)).toEqual([]);
  });
});
