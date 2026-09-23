import { describe, expect, it } from "vitest";

import {
  addYears,
  buildingLine,
  equivalentRectangle,
  ownBookFromBid,
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

describe("ownBookFromBid", () => {
  const base = {
    roofSystem: "Duro-Bond",
    startDate: "2026-06-01",
    warrantyName: "15 Year NDL",
    customer: {
      name: "Knox County Fiscal Court",
      contact: "",
      projectAddress: "401 Court Square",
      notes: "",
      jobCity: "Barbourville",
      jobState: "KY",
      jobZip: "40906",
    },
    sections: [
      { id: "s1", name: "Section 1", length: 79.5, width: 98, roofSystem: null },
      { id: "s2", name: "Section 2", length: 107.5, width: 89 },
    ],
  } as unknown as Parameters<typeof ownBookFromBid>[0];

  it("maps an accepted bid to a building and one roof per section", () => {
    const seed = ownBookFromBid(base, { name: "Knox Admin", updatedAt: "2026-09-23T14:00:00Z" });
    expect(seed.building).toMatchObject({
      name: "Knox County Fiscal Court",
      address1: "401 Court Square",
      city: "Barbourville",
      state: "KY",
      zip: "40906",
      own_book: true,
      source: "won_bid",
      roof_sqft: 7791 + 9567.5,
    });
    expect(seed.roofs).toHaveLength(2);
    expect(seed.roofs[0]).toMatchObject({
      section_name: "Section 1",
      roof_system: "Duro-Bond",
      area_sqft: 7791,
      install_date: "2026-06-01",
      warranty_type: "15 Year NDL",
      warranty_expires: "2041-06-01",
    });
  });
  it("uses the save date and a single roof when the bid has no sections", () => {
    const bare = { ...base, sections: [], warrantyName: "" };
    delete bare.startDate;
    const seed = ownBookFromBid(bare, { name: "Bare bid", updatedAt: "2026-09-23T14:00:00Z" });
    expect(seed.roofs).toEqual([
      {
        section_name: "Roof",
        roof_system: "Duro-Bond",
        area_sqft: null,
        install_date: "2026-09-23",
        installer: null,
        warranty_type: null,
        warranty_expires: null,
      },
    ]);
    expect(seed.building.roof_sqft).toBeNull();
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
