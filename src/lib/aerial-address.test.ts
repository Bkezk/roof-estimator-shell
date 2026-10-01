import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildingForPoint,
  parseStreetAddress,
  pickAddressMatch,
  scoreAddress,
  streetFilterWord,
  type AddressCandidate,
  type NearBuilding,
} from "./aerial-address";
import type { ArcGisFeatureSet } from "./gis/arcgis";
import { addressPointFromFeature } from "./gis/ky-layers";

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./gis/fixtures/${name}`, import.meta.url), "utf8")) as T;

describe("parseStreetAddress", () => {
  it("reads a site line (siteAddressLine's format) into normalised parts", () => {
    const a = parseStreetAddress("123 N. Main Street, Suite 200, Murray, KY 42071")!;
    expect(a).toMatchObject({
      house: "123",
      street: "N MAIN ST",
      core: ["MAIN"],
      suffix: "ST",
      directions: ["N"],
      city: "MURRAY",
      state: "KY",
      zip: "42071",
    });
    expect(parseStreetAddress("4500 Bardstown Road, Louisville, Kentucky")).toMatchObject({
      street: "BARDSTOWN RD",
      city: "LOUISVILLE",
      state: "KY",
      zip: null,
    });
    expect(parseStreetAddress("77 Elm Ave, Nashville, TN 37203-1234")).toMatchObject({
      state: "TN",
      zip: "37203",
    });
    expect(parseStreetAddress("12A Oak Ct #4")).toMatchObject({ house: "12A", core: ["OAK"] });
  });
  it("keeps a highway's number in the name, whatever it is called", () => {
    const a = parseStreetAddress("1169 State Route 136 West, Calhoun, KY")!;
    const b = parseStreetAddress("1169 STATE ROUTE 136 W")!;
    expect(a.core).toEqual(["STATE", "HWY", "136"]);
    expect(b.core).toEqual(a.core);
    expect(a.directions).toEqual(["W"]);
    expect(streetFilterWord(a)).toBe("136");
  });
  it("declines a line without a house number", () => {
    expect(parseStreetAddress("PO Box 12, Murray, KY 42071")).toBeNull();
    expect(parseStreetAddress("")).toBeNull();
    expect(parseStreetAddress(null)).toBeNull();
    expect(parseStreetAddress("Main Street")).toBeNull();
  });
  it("picks the longest plain street word for the database filter", () => {
    expect(streetFilterWord(parseStreetAddress("1338 Lynmar Dr")!)).toBe("LYNMAR");
    expect(streetFilterWord(parseStreetAddress("10 Old Hickory Blvd")!)).toBe("HICKORY");
  });
  it("reads Kentucky's 911 addresses as composed by the loader", () => {
    const set = fixture<ArcGisFeatureSet>("ky911-address-points.json");
    const first = (set.features ?? []).map(addressPointFromFeature).find((p) => p !== null)!;
    const parsed = parseStreetAddress(first.address)!;
    expect(parsed.house).toMatch(/^\d+$/);
    expect(parsed.core.length).toBeGreaterThan(0);
  });
});

const cand = (over: Partial<AddressCandidate>): AddressCandidate => ({
  source: "point",
  id: "c",
  address: "123 N MAIN ST",
  city: null,
  zip: null,
  lat: 36.61,
  lng: -88.31,
  building_id: null,
  ...over,
});

describe("scoreAddress / pickAddressMatch", () => {
  const target = parseStreetAddress("123 North Main Street, Murray, KY 42071")!;
  it("needs the same house number and street words", () => {
    expect(scoreAddress(target, cand({}))).toBeGreaterThanOrEqual(3);
    expect(scoreAddress(target, cand({ address: "125 N MAIN ST" }))).toBeNull();
    expect(scoreAddress(target, cand({ address: "123 N ELM ST" }))).toBeNull();
    // "OLD MAIN" contains "MAIN": weaker, but a match.
    const loose = scoreAddress(target, cand({ address: "123 OLD MAIN ST" }))!;
    expect(loose).toBeLessThan(scoreAddress(target, cand({}))!);
  });
  it("raises a matching zip / city and lowers a different one", () => {
    const plain = scoreAddress(target, cand({}))!;
    expect(scoreAddress(target, cand({ zip: "42071" }))!).toBeGreaterThan(plain);
    expect(scoreAddress(target, cand({ zip: "40202" }))!).toBeLessThan(plain);
    expect(scoreAddress(target, cand({ city: "Murray" }))!).toBeGreaterThan(plain);
  });
  it("takes the one place that matches, preferring the row that names its building", () => {
    const m = pickAddressMatch(target, [
      cand({ id: "pt", building_id: null }),
      cand({ id: "bld", source: "building", building_id: "b1", lat: 36.6101, lng: -88.3101 }),
      cand({ id: "other", address: "99 MAIN ST" }),
    ]);
    expect(m.outcome).toBe("match");
    expect(m.outcome === "match" && m.candidate.id).toBe("bld");
  });
  it("declines when the same address is equally good in two towns", () => {
    const m = pickAddressMatch(parseStreetAddress("123 Main St")!, [
      cand({ id: "a", address: "123 MAIN ST", lat: 36.61, lng: -88.31 }),
      cand({ id: "b", address: "123 MAIN ST", lat: 37.08, lng: -88.6 }),
    ]);
    expect(m).toEqual({ outcome: "ambiguous", count: 2 });
  });
  it("lets the zip settle which town it is", () => {
    const m = pickAddressMatch(target, [
      cand({ id: "murray", zip: "42071", lat: 36.61, lng: -88.31 }),
      cand({ id: "paducah", zip: "42001", lat: 37.08, lng: -88.6 }),
    ]);
    expect(m.outcome === "match" && m.candidate.id).toBe("murray");
  });
  it("finds nothing when nothing matches or has no position", () => {
    expect(pickAddressMatch(target, [])).toEqual({ outcome: "none" });
    expect(pickAddressMatch(target, [cand({ lat: null, lng: null })])).toEqual({ outcome: "none" });
  });
});

/** A square outline of `m` metres around (lat, lng). */
const square = (lat: number, lng: number, m: number) => {
  const dLat = m / 2 / 111320;
  const dLng = m / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  };
};
const bld = (id: string, lat: number, lng: number, m = 30): NearBuilding => ({
  id,
  address1: "",
  city: null,
  state: "KY",
  zip: null,
  centroid_lat: lat,
  centroid_lng: lng,
  roof_sqft: m * m * 10.76,
  footprint: square(lat, lng, m),
});

describe("buildingForPoint", () => {
  const p = { lat: 36.61, lng: -88.31 };
  it("takes the building the point names", () => {
    const r = buildingForPoint(p, [bld("a", 36.62, -88.31), bld("b", 36.61, -88.31)], "a");
    expect(r?.building.id).toBe("a");
    expect(r?.how).toBe("named");
  });
  it("else the outline containing the point (the smaller one when outlines overlap)", () => {
    const r = buildingForPoint(p, [
      bld("big", 36.61, -88.31, 200),
      bld("small", 36.61, -88.31, 20),
    ]);
    expect(r).toMatchObject({ how: "contains", building: { id: "small" } });
  });
  it("else the nearest outline within the exact matcher's radius (100 m for small roofs)", () => {
    // ≈ 55 m north: inside 100 m.
    const r = buildingForPoint(p, [bld("far", 36.612, -88.31), bld("near", 36.6105, -88.31)]);
    expect(r).toMatchObject({ how: "nearest", building: { id: "near" } });
    expect(r!.distanceM!).toBeGreaterThan(50);
    // ≈ 220 m away: no building.
    expect(buildingForPoint(p, [bld("far", 36.612, -88.31)])).toBeNull();
    expect(buildingForPoint(p, [])).toBeNull();
  });
});
