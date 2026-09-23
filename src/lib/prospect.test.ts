import { describe, expect, it } from "vitest";

import {
  addYears,
  buildingLine,
  equivalentRectangle,
  sortWarrantyLeads,
  warrantyLeadFrom,
  warrantyYears,
} from "./prospect";

describe("equivalentRectangle", () => {
  it("returns the rectangle with the same area and perimeter", () => {
    // 98 × 79.5 → area 7,791, perimeter 355
    const r = equivalentRectangle(7791, 355);
    expect(r).toEqual({ width: 79.5, length: 98 });
  });
  it("falls back to a square without a perimeter or when none fits", () => {
    expect(equivalentRectangle(10000)).toEqual({ width: 100, length: 100 });
    // A circle-ish footprint: perimeter too short for any rectangle of that area.
    expect(equivalentRectangle(10000, 360)).toEqual({ width: 100, length: 100 });
    expect(equivalentRectangle(0, 100)).toEqual({ width: 0, length: 0 });
  });
});

describe("warranty helpers", () => {
  it("reads the years out of a warranty name", () => {
    expect(warrantyYears("15 Year NDL")).toBe(15);
    expect(warrantyYears("20-yr Supreme")).toBe(20);
    expect(warrantyYears("None")).toBeUndefined();
    expect(warrantyYears(undefined)).toBeUndefined();
  });
  it("adds years to an ISO date", () => {
    expect(addYears("2026-09-23", 15)).toBe("2041-09-23");
  });
});

describe("warrantyLeadFrom", () => {
  const row = {
    bid_id: "b1",
    bid_name: "Knox Admin",
    customer_name: "Knox County Fiscal Court",
    address: "401 Court Square",
    city: "Barbourville",
    state: "KY",
    zip: "40906",
    start_date: "2026-06-01",
    warranty_name: "15 Year NDL",
    updated_at: "2026-09-23T14:00:00Z",
    building_id: null,
  };
  it("turns an accepted bid into a lead with its warranty clock", () => {
    const lead = warrantyLeadFrom(row, "2026-09-24");
    expect(lead).toMatchObject({
      bidId: "b1",
      customerName: "Knox County Fiscal Court",
      address: "401 Court Square",
      installDate: "2026-06-01",
      warrantyName: "15 Year NDL",
      expires: "2041-06-01",
      yearsLeft: 14.7,
    });
  });
  it("falls back to the save date and reports an unknown expiry", () => {
    const lead = warrantyLeadFrom(
      { ...row, start_date: null, warranty_name: "", customer_name: null },
      "2026-09-24",
    );
    expect(lead.installDate).toBe("2026-09-23");
    expect(lead.customerName).toBe("Knox Admin");
    expect(lead.expires).toBeNull();
    expect(lead.yearsLeft).toBeNull();
  });
  it("sorts soonest expiry first and unknown last", () => {
    const a = warrantyLeadFrom({ ...row, bid_id: "a", start_date: "2020-01-01" }, "2026-09-24");
    const b = warrantyLeadFrom({ ...row, bid_id: "b", start_date: "2010-01-01" }, "2026-09-24");
    const c = warrantyLeadFrom({ ...row, bid_id: "c", warranty_name: null }, "2026-09-24");
    expect(sortWarrantyLeads([a, c, b]).map((l) => l.bidId)).toEqual(["b", "a", "c"]);
    expect(b.yearsLeft).toBeLessThan(0);
  });
});

describe("buildingLine", () => {
  it("joins what is known", () => {
    expect(
      buildingLine({ name: "Court House", address1: "401 Court Sq", city: "Barbourville" }),
    ).toBe("Court House — 401 Court Sq, Barbourville");
    expect(buildingLine({ name: "", address1: "", city: null })).toBe("(unnamed building)");
  });
});
