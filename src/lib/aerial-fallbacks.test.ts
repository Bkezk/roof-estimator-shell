/**
 * Owner, Oct 26: "sometimes the aerial photos dont appear" — ticket 6036, 531 E Cumberland Gap
 * Pkwy, Corbin: Kentucky's 911 layer has no 531 on that road; it lists the building as ADVANCE
 * AUTO PARTS at 187 W Cumberland Gap Pkwy, and the nearest numbers it has are 440, 446, 676 and
 * 700 W. Two fallbacks after the number misses: the landmark that carries the property's name
 * on that street in that town, then the nearest numbers, where Pick the building opens.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseStreetAddress } from "./aerial-address";
import {
  cityVariants,
  foundByNameNote,
  type NamedPoint,
  nameSearchStems,
  nearNote,
  nearestOnStreet,
  pickByName,
} from "./aerial-fallbacks";
import { addressPointsOnStreetUrl, landmarksByNameUrl } from "./gis/ky-layers";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const target = parseStreetAddress("531 East Cumberland Gap Parkway, Corbin, KY 40701")!;
const pt = (address: string, landmark: string | null, lat: number, lng: number): NamedPoint => ({
  source: "point",
  id: address,
  address,
  city: "CORBIN",
  zip: "40701",
  lat,
  lng,
  building_id: null,
  landmark,
});

describe("by name", () => {
  it("stems: 4+ letter words, first five letters, stop words dropped, three at most", () => {
    expect(nameSearchStems("Advanced Auto")).toEqual(["ADVAN", "AUTO"]);
    expect(nameSearchStems("The Corbin Wellness Center, Inc.")).toEqual([
      "CORBI",
      "WELLN",
      "CENTE",
    ]);
    expect(nameSearchStems("5K, Inc")).toEqual([]);
    expect(nameSearchStems(null)).toEqual([]);
  });
  it("the town's spellings", () => {
    expect(cityVariants("CORBIN")).toEqual(["Corbin", "CORBIN"]);
    expect(cityVariants("bowling green")).toEqual(["Bowling Green", "BOWLING GREEN"]);
    expect(cityVariants("")).toEqual([]);
  });
  it("picks the one landmark carrying every stem; a different street loses to the same street", () => {
    const stems = nameSearchStems("Advanced Auto");
    const points = [
      pt("187 W CUMBERLAND GAP PKWY", "ADVANCE AUTO PARTS", 36.95, -84.1),
      pt("12 MAIN ST", "ADVANCE AUTO PARTS", 36.9, -84.0),
      pt("700 W CUMBERLAND GAP PKWY", "AUTOZONE", 36.96, -84.11),
    ];
    expect(pickByName(target, stems, points)?.address).toBe("187 W CUMBERLAND GAP PKWY");
    // Two different buildings with the name: no guess.
    expect(
      pickByName(target, stems, [
        pt("187 W CUMBERLAND GAP PKWY", "ADVANCE AUTO PARTS", 36.95, -84.1),
        pt("900 W CUMBERLAND GAP PKWY", "ADVANCE AUTO PARTS", 36.99, -84.2),
      ]),
    ).toBeNull();
    expect(pickByName(target, [], points)).toBeNull();
    expect(
      pickByName(target, stems, [pt("700 W CUMBERLAND GAP PKWY", "AUTOZONE", 1, 1)]),
    ).toBeNull();
  });
  it("the note says to check it", () => {
    expect(foundByNameNote("ADVANCE AUTO PARTS", "187 W CUMBERLAND GAP PKWY")).toBe(
      "Found by name: ADVANCE AUTO PARTS, 187 W CUMBERLAND GAP PKWY. Check it is the right building — pick it on the map if not.",
    );
  });
  it("the state query: every stem on the landmark name, the town's spellings, no UPPER()", () => {
    const u = new URL(landmarksByNameUrl(["ADVAN", "AUTO"], ["Corbin", "CORBIN"])!);
    expect(u.searchParams.get("where")).toBe(
      "LandmkName LIKE '%ADVAN%' AND LandmkName LIKE '%AUTO%' AND Post_Comm IN ('Corbin','CORBIN')",
    );
    expect(u.searchParams.get("returnGeometry")).toBe("true");
    expect(landmarksByNameUrl([], ["Corbin"])).toBeNull();
    expect(landmarksByNameUrl(["ADVAN"], [])).toBeNull();
    expect(landmarksByNameUrl(["AD'VAN"], ["Corbin"])).toBeNull();
  });
});

describe("the nearest numbers", () => {
  const street = [
    pt("440 W CUMBERLAND GAP PKWY", "CORBIN WELLNESS CENTER", 36.95, -84.1),
    pt("446 W CUMBERLAND GAP PKWY", null, 36.951, -84.101),
    pt("676 W CUMBERLAND GAP PKWY", "TRACTOR SUPPLY", 36.96, -84.11),
    pt("700 W CUMBERLAND GAP PKWY", "AUTOZONE", 36.961, -84.111),
    pt("412 MAINARD ST", null, 36.0, -84.0),
  ];
  it("takes the points on the same street (core words), nearest the typed number, and their centre", () => {
    const near = nearestOnStreet(target, street)!;
    expect(near.numbers).toEqual([440, 446, 676, 700]);
    expect(near.street).toBe("W CUMBERLAND GAP PKWY");
    expect(near.centre.lat).toBeCloseTo((36.95 + 36.951 + 36.96 + 36.961) / 4, 6);
    expect(nearestOnStreet(target, street, 2)!.numbers).toEqual([440, 446]);
  });
  it("412 MAIN ST never takes MAINARD; nothing on the street → null", () => {
    const main = parseStreetAddress("412 Main St, Murray, KY 42071")!;
    expect(nearestOnStreet(main, [pt("412 MAINARD ST", null, 36, -88)])).toBeNull();
    expect(nearestOnStreet(target, [])).toBeNull();
  });
  it("the note names the typed number, the street, the town and the numbers found", () => {
    const near = nearestOnStreet(target, street)!;
    expect(nearNote(target, near)).toBe(
      "Nothing at 531 on E Cumberland Gap Pkwy in Corbin; the map opens at 440–700 W Cumberland Gap Pkwy — pick the building.",
    );
  });
  it("the state query: the street word in the town, by house number", () => {
    const u = new URL(addressPointsOnStreetUrl("CUMBERLAND", ["Corbin", "CORBIN"])!);
    expect(u.searchParams.get("where")).toBe(
      "LSt_Name LIKE '%CUMBERLAND%' AND Post_Comm IN ('Corbin','CORBIN')",
    );
    expect(u.searchParams.get("orderByFields")).toBe("Add_Number");
    expect(addressPointsOnStreetUrl("CUMBERLAND", [])).toBeNull();
  });
});

describe("the wiring", () => {
  it("the ticket lookup passes the property's name, tries the name then the street after the number misses, and returns `near`", () => {
    const src = read("./service-aerial.functions.ts");
    expect(src).toContain("site_address, site_name, account_id");
    expect(src).toContain("if (s.name?.trim()) propertyName = s.name;");
    expect(src).toContain("locateAddress(sb, parsed, word, addressState, propertyName)");
    const number = src.indexOf("addressPointsByAddressUrl(parsed.house, word)");
    const name = src.indexOf("landmarksByNameUrl(nameSearchStems(propertyName), towns)");
    const streetQ = src.indexOf("addressPointsOnStreetUrl(word, towns)");
    expect(number).toBeGreaterThan(0);
    expect(name).toBeGreaterThan(number);
    expect(streetQ).toBeGreaterThan(name);
    expect(src).toContain(
      'return { kind: "near", near: near.centre, note: nearNote(parsed, near) };',
    );
    expect(src).toContain(
      "return { address, addressState, saved: null, found: null, note, near };",
    );
  });
  it("Pick the building opens at the nearest numbers when nothing was found", () => {
    const ui = read("../components/service/aerial-markup.tsx");
    expect(ui).toContain("(data.near ?? null)");
    expect(ui).toContain("fitTo={view || data.near ? undefined : data.addressState}");
  });
});
