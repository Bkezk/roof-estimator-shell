import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  WEBSTER_FIELD_MAP,
  countyFromServiceUrl,
  guessFieldMap,
  looksLikeAddress,
  mercatorToLngLat,
  parcelFromFeature,
  parcelGeometry,
  parcelQueryUrl,
  type ArcGisFeatureSet,
} from "./arcgis";

const sample = JSON.parse(
  readFileSync(new URL("./fixtures/webster-parcels.json", import.meta.url), "utf8"),
) as ArcGisFeatureSet;

describe("Webster County parcel sample (owner-supplied, 2026-09-24)", () => {
  it("guesses the field map from the layer's field list", () => {
    const map = guessFieldMap(sample.fields ?? []);
    expect(map).toEqual(WEBSTER_FIELD_MAP);
  });

  it("reads owner, addresses, class and the published sq ft / ft measures", () => {
    const c = parcelFromFeature(sample.features![0]!, WEBSTER_FIELD_MAP)!;
    expect(c).toMatchObject({
      parcelId: "096-015-000",
      ownerName: "PAYNE MICHAEL ALLEN & CHARLES ANTHONY PAYNE",
      ownerAddress: "7005 US HWY 41 S, SLAUGHTERS, KY 42456",
      location: "GRAVEL PIT",
      landUse: "FARM",
      acres: 9.39376287,
      lotSqFt: 409192, // AREA = ACRES × 43,560
      perimeterFt: 2900,
      deed: "WB 028-131",
      taxYear: 2026,
    });
    expect(c.geometry?.centroidLat).toBeCloseTo(37.5807, 3);
    expect(c.geometry?.centroidLng).toBeCloseTo(-87.4156, 3);
    // Ground-corrected computed area agrees with the PVA's acres within ~0.3 %.
    expect(c.geometry!.computedAreaSqFt / 409192).toBeCloseTo(1, 2);
    expect(c.geometry!.computedPerimeterFt).toBeGreaterThan(2880);
    expect(c.geometry!.computedPerimeterFt).toBeLessThan(2920);
    expect(c.geometry!.footprint.type).toBe("Polygon");
  });

  it("keeps the owner's mailing address apart from the property location", () => {
    const c = parcelFromFeature(sample.features![1]!, WEBSTER_FIELD_MAP)!;
    expect(c.ownerName).toBe("MORVATT ENTERPRISES LLC C/O CHARLES MORRIS");
    expect(c.ownerAddress).toBe("1044 N FOREST OAK, HENDERSON, KY 42420");
    expect(c.location).toBe("70 HONEYSUCKLE LN");
    expect(looksLikeAddress(c.location)).toBe(true);
    expect(looksLikeAddress("GRAVEL PIT")).toBe(false);
  });

  it("falls back to acres, then to the computed area, when AREA is missing", () => {
    const f = sample.features![2]!;
    const noArea = { ...f, attributes: { ...f.attributes, AREA: null } };
    expect(parcelFromFeature(noArea, WEBSTER_FIELD_MAP)!.lotSqFt).toBe(
      Math.round(4.63013251 * 43560),
    );
    const noAcres = { ...noArea, attributes: { ...noArea.attributes, ACRES: null } };
    const c = parcelFromFeature(noAcres, WEBSTER_FIELD_MAP)!;
    expect(c.lotSqFt).toBe(c.geometry!.computedAreaSqFt);
  });
});

describe("geometry and URLs", () => {
  it("converts Web Mercator to lng/lat", () => {
    expect(mercatorToLngLat([0, 0])).toEqual([0, 0]);
    const [lng, lat] = mercatorToLngLat([-9731188.8218, 4520535.5958]);
    expect(lng).toBeCloseTo(-87.4168, 3);
    expect(lat).toBeCloseTo(37.5819, 3);
  });
  it("returns null for a degenerate ring", () => {
    expect(
      parcelGeometry([
        [
          [0, 0],
          [1, 1],
        ],
      ]),
    ).toBeNull();
  });
  it("builds paged and count-only query URLs", () => {
    const layer =
      "https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_PVA_Webster_Parcels_WGS84WM/MapServer/1/";
    const u = new URL(
      parcelQueryUrl(layer, { where: "CLASS = 'COMMERCIAL'", offset: 500, count: 250 }),
    );
    expect(u.pathname.endsWith("/MapServer/1/query")).toBe(true);
    expect(u.searchParams.get("where")).toBe("CLASS = 'COMMERCIAL'");
    expect(u.searchParams.get("resultOffset")).toBe("500");
    expect(u.searchParams.get("resultRecordCount")).toBe("250");
    expect(u.searchParams.get("returnGeometry")).toBe("true");
    const c = new URL(parcelQueryUrl(layer, { where: "", countOnly: true }));
    expect(c.searchParams.get("where")).toBe("1=1");
    expect(c.searchParams.get("returnCountOnly")).toBe("true");
    expect(countyFromServiceUrl(layer)).toBe("Webster");
  });
});
