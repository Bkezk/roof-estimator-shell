/**
 * Owner, Oct 27: the finder's nationwide fallback (the Census geocoder, pure side) and the
 * state-layer queries the typo tolerance and place-name search add (ky-layers / tn-layers).
 * Fails on the old code (none of these existed).
 */
import { describe, expect, it } from "vitest";

import {
  CENSUS_OUTSIDE_NOTE,
  censusGeocoderUrl,
  imageryStateForPoint,
  parseCensusResponse,
} from "./address-census";
import { landmarksByNameUrl, streetNamesFromFeatures, streetNamesInTownUrl } from "./gis/ky-layers";
import { structureStreetNamesFromFeatures, structureStreetNamesInTownUrl } from "./gis/tn-layers";

const where = (url: string) => new URL(url).searchParams.get("where");

describe("the Census geocoder", () => {
  it("asks the one-line endpoint, current benchmark, JSON", () => {
    const u = new URL(censusGeocoderUrl("412 Main St, Murray, KY 42071"));
    expect(u.origin + u.pathname).toBe(
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
    );
    expect(u.searchParams.get("address")).toBe("412 Main St, Murray, KY 42071");
    expect(u.searchParams.get("benchmark")).toBe("Public_AR_Current");
    expect(u.searchParams.get("format")).toBe("json");
  });

  it("reads the first match (as the service answered on Oct 27, 2026) and nothing from an empty one", () => {
    const body = {
      result: {
        input: { address: { address: "412 Main St, Murray, KY 42071" } },
        addressMatches: [
          {
            tigerLine: { side: "R", tigerLineId: "31708999" },
            coordinates: { x: -88.302243077406, y: 36.610640406489 },
            addressComponents: { zip: "42071", streetName: "MAIN", city: "MURRAY", state: "KY" },
            matchedAddress: "412 MAIN ST, MURRAY, KY, 42071",
          },
        ],
      },
    };
    expect(parseCensusResponse(body)).toEqual({
      lat: 36.610640406489,
      lng: -88.302243077406,
      matchedAddress: "412 MAIN ST, MURRAY, KY, 42071",
      city: "MURRAY",
      state: "KY",
      zip: "42071",
    });
    expect(parseCensusResponse({ result: { addressMatches: [] } })).toBeNull();
    expect(parseCensusResponse(null)).toBeNull();
    expect(parseCensusResponse("<html>down</html>")).toBeNull();
    expect(
      parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: "a" } }] } }),
    ).toBeNull();
  });

  it("which imagery a point falls in: Kentucky, Tennessee, or neither", () => {
    expect(imageryStateForPoint(36.6106, -88.3022)).toBe("KY"); // Murray
    expect(imageryStateForPoint(36.9757, -84.1091)).toBe("KY"); // Corbin
    expect(imageryStateForPoint(36.1627, -86.7816)).toBe("TN"); // Nashville
    expect(imageryStateForPoint(35.0456, -85.3097)).toBe("TN"); // Chattanooga
    expect(imageryStateForPoint(39.9612, -82.9988)).toBeNull(); // Columbus OH
    expect(imageryStateForPoint(33.749, -84.388)).toBeNull(); // Atlanta
    expect(CENSUS_OUTSIDE_NOTE("100 HIGH ST, COLUMBUS, OH, 43215")).toBe(
      "Found by the Census geocoder (100 HIGH ST, COLUMBUS, OH, 43215); outside the Kentucky / Tennessee imagery.",
    );
  });
});

describe("the state layers' street names in a town (typo tolerance)", () => {
  it("Kentucky: one distinct-values query on LSt_Name for the town's spellings", () => {
    const url = streetNamesInTownUrl(["Corbin", "CORBIN"])!;
    expect(url).toContain("Ky_911_Site_Structure_Address_Points");
    expect(where(url)).toBe("Post_Comm IN ('Corbin','CORBIN')");
    const p = new URL(url).searchParams;
    expect(p.get("outFields")).toBe("LSt_Name");
    expect(p.get("returnDistinctValues")).toBe("true");
    expect(p.get("returnGeometry")).toBe("false");
    expect(streetNamesInTownUrl([])).toBeNull();
    expect(streetNamesInTownUrl(["x'; DROP"])).toBeNull();
    expect(
      streetNamesFromFeatures({
        features: [
          { attributes: { LSt_Name: "Cumberland Gap" } },
          { attributes: { LSt_Name: "MAIN" } },
          { attributes: { LSt_Name: "MAIN" } },
          { attributes: { LSt_Name: " " } },
        ],
      }),
    ).toEqual(["CUMBERLAND GAP", "MAIN"]);
  });

  it("Tennessee: distinct PROP_ADDR in the town, the street read off each", () => {
    const url = structureStreetNamesInTownUrl(["Clarksville", "CLARKSVILLE"])!;
    expect(url).toContain("USA_Structures_View");
    expect(where(url)).toBe(
      "UPPER(PROP_CITY) IN ('CLARKSVILLE') AND FIPS LIKE '47%' AND PROP_ADDR IS NOT NULL",
    );
    expect(new URL(url).searchParams.get("returnDistinctValues")).toBe("true");
    expect(structureStreetNamesInTownUrl([])).toBeNull();
    expect(
      structureStreetNamesFromFeatures({
        features: [
          { attributes: { PROP_ADDR: "412 Main St" } },
          { attributes: { PROP_ADDR: "500 MAIN ST" } },
          { attributes: { PROP_ADDR: "12A  Fort Campbell Blvd" } },
          { attributes: { PROP_ADDR: null } },
        ],
      }),
    ).toEqual(["MAIN ST", "FORT CAMPBELL BLVD"]);
  });

  it("a place name with no town searches Kentucky's landmarks statewide, with two or more stems", () => {
    expect(landmarksByNameUrl(["CORBI", "HIGH", "SCHOO"], [])).toBeNull();
    const url = landmarksByNameUrl(["CORBI", "HIGH", "SCHOO"], [], 40, true)!;
    expect(where(url)).toBe(
      "LandmkName LIKE '%CORBI%' AND LandmkName LIKE '%HIGH%' AND LandmkName LIKE '%SCHOO%'",
    );
    // One stem alone is too vague for a statewide scan.
    expect(landmarksByNameUrl(["WALMA"], [], 40, true)).toBeNull();
    // With a town the query is as before.
    expect(where(landmarksByNameUrl(["ADVAN", "AUTO"], ["Corbin", "CORBIN"])!)).toBe(
      "LandmkName LIKE '%ADVAN%' AND LandmkName LIKE '%AUTO%' AND Post_Comm IN ('Corbin','CORBIN')",
    );
  });
});
