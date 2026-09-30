import { describe, expect, it } from "vitest";

import {
  SHARED_COUNTY_NAMES,
  addYears,
  approxAddressNote,
  boxContains,
  buildingLine,
  clipBox,
  countyKeyFor,
  countyKeyInState,
  countyLabelFor,
  countyOptions,
  equivalentRectangle,
  kyTnLineLat,
  nearKyTnLine,
  parseCountyKey,
  searchFilters,
  shownAddress,
  sortWarrantyLeads,
  stateCode,
  stateForPoint,
  tnOutlinesQueryUrl,
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
  it("marks an approximate address", () => {
    expect(
      buildingLine({ name: "", address1: "64 Holly Rd", city: "Boaz", address_approx: true }),
    ).toBe("≈ 64 Holly Rd, Boaz");
  });
});

describe("approximate addresses (owner, Sep 29)", () => {
  it("prefixes ≈ only on an approximate address", () => {
    expect(shownAddress({ address1: "64 Holly Rd", address_approx: true })).toBe("≈ 64 Holly Rd");
    expect(shownAddress({ address1: "64 Holly Rd", address_approx: false })).toBe("64 Holly Rd");
    expect(shownAddress({ address1: "64 Holly Rd" })).toBe("64 Holly Rd");
    expect(shownAddress({ address1: "", address_approx: true })).toBe("");
    expect(shownAddress({ address1: null, address_approx: true })).toBe("");
  });
  it("notes the distance when it is known", () => {
    expect(
      approxAddressNote({ address1: "64 Holly Rd", address_approx: true, address_approx_m: 180.4 }),
    ).toBe("approximate: nearest address point, 180 m away — confirm on site");
    expect(
      approxAddressNote({ address1: "64 Holly Rd", address_approx: true, address_approx_m: null }),
    ).toBe("approximate: nearest address point; confirm on site");
    expect(approxAddressNote({ address1: "64 Holly Rd", address_approx: false })).toBeNull();
    expect(approxAddressNote({ address1: "", address_approx: true })).toBeNull();
  });
});

describe("Kentucky / Tennessee", () => {
  it("picks the state along the shared band by the line, not the box", () => {
    // Inside Tennessee's box but Kentucky: Murray, Middlesboro, Fulton.
    expect(stateForPoint(36.61, -88.31)).toBe("KY");
    expect(stateForPoint(36.61, -83.72)).toBe("KY");
    expect(stateForPoint(36.504, -88.874)).toBe("KY");
    // Tennessee right under the line: Portland, Clarksville, South Fulton, Jellico.
    expect(stateForPoint(36.58, -86.52)).toBe("TN");
    expect(stateForPoint(36.53, -87.36)).toBe("TN");
    expect(stateForPoint(36.495, -88.874)).toBe("TN");
    expect(stateForPoint(36.587, -84.13)).toBe("TN");
    // Well inside either state.
    expect(stateForPoint(36.16, -86.78)).toBe("TN");
    expect(stateForPoint(35.15, -90.05)).toBe("TN");
    expect(stateForPoint(36.99, -86.44)).toBe("KY");
    expect(stateForPoint(38.25, -85.76)).toBe("KY");
  });
  it("follows the Walker line east of the Tennessee River", () => {
    expect(kyTnLineLat(-89)).toBeCloseTo(36.5, 2);
    expect(kyTnLineLat(-87)).toBeGreaterThan(36.63);
    expect(kyTnLineLat(-87)).toBeLessThan(36.66);
    expect(kyTnLineLat(-95)).toBe(36.5);
    expect(kyTnLineLat(-80)).toBeCloseTo(36.612, 3);
  });
  it("reads a state however a bid spells it", () => {
    expect(stateCode("Tennessee")).toBe("TN");
    expect(stateCode(" tn ")).toBe("TN");
    expect(stateCode("Tenn.")).toBe("TN");
    expect(stateCode("Kentucky")).toBe("KY");
    expect(stateCode("in")).toBe("IN");
    expect(stateCode("")).toBeNull();
    expect(stateCode(null)).toBeNull();
    expect(stateCode("Indiana")).toBeNull();
  });
  it("knows the 34 county names both states use", () => {
    expect(SHARED_COUNTY_NAMES.size).toBe(34);
    for (const n of ["franklin", "warren", "montgomery", "knox", "shelby", "robertson"])
      expect(SHARED_COUNTY_NAMES.has(n)).toBe(true);
    expect(SHARED_COUNTY_NAMES.has("davidson")).toBe(false);
    expect(SHARED_COUNTY_NAMES.has("jefferson")).toBe(true);
    expect(SHARED_COUNTY_NAMES.has("fayette")).toBe(true);
    expect(SHARED_COUNTY_NAMES.has("pike")).toBe(false);
  });
  it("splits a shared county name into one entry per state", () => {
    // building_county_counts() rows: (county, state, n), state TN or KY (anything not TN).
    const opts = countyOptions([
      { county: "Warren", state: "KY", count: 650 },
      { county: "Davidson", state: "TN", count: 5000 },
      { county: "Adair", state: "KY", count: 40 },
      { county: "Franklin", state: "KY", count: 300 },
      { county: "Warren", state: "TN", count: 250 },
    ]);
    expect(opts).toEqual([
      { key: "Adair", county: "Adair", state: null, label: "Adair", count: 40 },
      { key: "Davidson", county: "Davidson", state: null, label: "Davidson", count: 5000 },
      { key: "Franklin|KY", county: "Franklin", state: "KY", label: "Franklin, KY", count: 300 },
      { key: "Warren|KY", county: "Warren", state: "KY", label: "Warren, KY", count: 650 },
      { key: "Warren|TN", county: "Warren", state: "TN", label: "Warren, TN", count: 250 },
    ]);
    // A one-state name the data holds under both states is split too (never two same keys).
    expect(
      countyOptions([
        { county: "Adair", state: "KY", count: 3 },
        { county: "Adair", state: "TN", count: 1 },
      ]).map((o) => o.key),
    ).toEqual(["Adair|KY", "Adair|TN"]);
    expect(parseCountyKey("Warren|TN")).toEqual({ county: "Warren", state: "TN" });
    expect(parseCountyKey("Warren|KY")).toEqual({ county: "Warren", state: "KY" });
    expect(parseCountyKey("Davidson")).toEqual({ county: "Davidson", state: null });
    expect(parseCountyKey("")).toEqual({ county: "", state: null });
  });
  it("keeps a county filter only while it is in the chosen state", () => {
    // Bug: Adair (Kentucky only) stayed picked after State → Tennessee ("No buildings match").
    expect(countyKeyInState("Adair", "TN")).toBe(false);
    expect(countyKeyInState("Adair", "KY")).toBe(true);
    expect(countyKeyInState("Davidson", "KY")).toBe(false);
    expect(countyKeyInState("Davidson", "TN")).toBe(true);
    expect(countyKeyInState("Warren|KY", "TN")).toBe(false);
    expect(countyKeyInState("Warren|TN", "TN")).toBe(true);
    expect(countyKeyInState("Adair", "all")).toBe(true);
    expect(countyKeyInState("", "TN")).toBe(true);
  });
  it("keys and labels a county by state only where both states use the name", () => {
    expect(countyKeyFor("Lawrence", "TN")).toBe("Lawrence|TN");
    expect(countyLabelFor("Lawrence", "KY")).toBe("Lawrence, KY");
    expect(countyKeyFor("Adair", "KY")).toBe("Adair");
    expect(countyLabelFor("Davidson", "TN")).toBe("Davidson");
    expect(countyKeyFor("(unknown)", "TN")).toBe("(unknown)");
  });
  it("quotes search text for PostgREST, one filter per comma-separated part", () => {
    // Bug: "1338 LYNMAR DR, 1" (a permit lead's ?q=) failed to parse; "Smith (Annex)" found nothing.
    const [a, b] = searchFilters("1338 LYNMAR DR, 1");
    expect(a).toContain('name.ilike."%1338 LYNMAR DR%"');
    expect(a).toContain('address1.ilike."%1338 LYNMAR DR%"');
    expect(b).toContain('address1.ilike."%1%"');
    expect(searchFilters("Smith (Annex)")[0]).toContain('name.ilike."%Smith (Annex)%"');
    expect(searchFilters('Joe "Bob"')[0]).toContain('name.ilike."%Joe \\"Bob\\"%"');
    // LIKE sees a literal backslash (\\), PostgREST an escaped one per character.
    expect(searchFilters("a\\b")[0]).toContain('name.ilike."%a\\\\\\\\b%"');
    expect(searchFilters("50%_off*")[0]).toContain('name.ilike."%50off%"');
    expect(searchFilters(" , ,")).toEqual([]);
    expect(searchFilters("a,b,c,d,e,f,g,h")).toHaveLength(6);
  });
  it("knows the band along the line where the state needs asking", () => {
    // Fulton, KY: 0.4 km north of the (thinned) line, inside Tennessee's box.
    expect(nearKyTnLine(36.50356, -88.87884)).toBe(true);
    expect(nearKyTnLine(36.496, -88.879)).toBe(true);
    // Portland, TN (8 km south) and Bowling Green (far north) are not.
    expect(nearKyTnLine(36.58, -86.52)).toBe(false);
    expect(nearKyTnLine(36.99, -86.44)).toBe(false);
    expect(nearKyTnLine(36.16, -86.78)).toBe(false);
  });
  it("asks for Tennessee's outlines inside a box", () => {
    const url = new URL(
      tnOutlinesQueryUrl("https://x.test/FeatureServer/0/", [-86.8, 36.1, -86.7, 36.2]),
    );
    expect(url.pathname).toBe("/FeatureServer/0/query");
    const p = url.searchParams;
    expect(p.get("where")).toBe("SQFEET >= 5000");
    expect(p.get("geometry")).toBe("-86.80000,36.10000,-86.70000,36.20000");
    expect(p.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(p.get("inSR")).toBe("4326");
    expect(p.get("outSR")).toBe("4326");
    expect(p.get("f")).toBe("geojson");
    expect(p.get("resultRecordCount")).toBe("2000");
  });
  it("clips and compares boxes", () => {
    const tn: [number, number, number, number] = [-90.31, 34.98, -81.65, 36.68];
    expect(clipBox([-87, 36.5, -86, 37], tn)).toEqual([-87, 36.5, -86, 36.68]);
    expect(clipBox([-87, 36.9, -86, 37], tn)).toBeNull();
    expect(boxContains(tn, [-87, 36, -86, 36.5])).toBe(true);
    expect(boxContains(tn, [-87, 36, -86, 36.9])).toBe(false);
  });
});
