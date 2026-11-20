/**
 * Roof Care: an address the map cannot find (owner, Nov 18: "if it cant find the location on a
 * map can you just provide the address and look it up from there?").
 *
 * Until now only the building on our own map (Kentucky and Tennessee) gave a drive, so any other
 * address had no price. The chain is now: the building, the street address anywhere in the
 * country, the centre of the zip code, the centre of the town. The last two are an estimate and
 * the page says so. With none of the four there is still no price.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

const building = vi.fn<(...a: unknown[]) => Promise<{ lat: number; lng: number } | null>>();
vi.mock("@/lib/service-aerial.functions", () => ({
  geocodeAddress: (...a: unknown[]) => building(...a),
  // The office: always the same spot.
  geocodeAddressCached: async () => ({ lat: 37.13, lng: -84.08 }),
}));
// No road router in a test: the straight-line estimate is used.
// Nov 20: the drive asks routedDriveVia, which also says which router answered.
vi.mock("@/lib/drive-route", () => ({
  routedDrive: async () => null,
  routedDriveVia: async () => null,
}));

import { censusGeocoderUrl } from "@/lib/address-census";
import {
  NOT_PLACED_LINE,
  parseTownPlace,
  parseZipPlace,
  placedRoughly,
  roughPlaceLine,
  state2,
  townLookupUrl,
  zip5,
  zipLookupUrl,
} from "@/lib/roof-care-locate";
import { driveTo, placeAddress } from "@/lib/roof-care.functions";

type Sb = Parameters<typeof placeAddress>[0];
const sb = {} as Sb;

// The lookups' real answers for one zip code and one town, shortened.
const ZIP_BODY = {
  "post code": "40202",
  places: [
    {
      "place name": "Louisville",
      longitude: "-85.7476",
      latitude: "38.2507",
      "state abbreviation": "KY",
    },
  ],
};
const TOWN_BODY = {
  "state abbreviation": "KY",
  "place name": "London",
  places: [
    { "place name": "London", longitude: "-84.10", latitude: "37.16", "post code": "40741" },
    { "place name": "London", longitude: "-84.12", latitude: "37.14", "post code": "40742" },
    { "place name": "London", longitude: "-84.05", latitude: "37.12", "post code": "40743" },
  ],
};
const CENSUS_BODY = {
  result: {
    addressMatches: [
      {
        coordinates: { x: -84.5, y: 39.1 },
        matchedAddress: "100 MAIN ST, CINCINNATI, OH, 45202",
        addressComponents: { city: "CINCINNATI", state: "OH", zip: "45202" },
      },
    ],
  },
};

/** A fetcher that answers by address and remembers what it was asked, in order. */
function lookups(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    asked.push(url);
    return answers[url] ?? null;
  };
  return { asked, fetcher };
}

beforeEach(() => {
  building.mockReset();
  building.mockResolvedValue(null);
});

describe("reading a zip code and a town", () => {
  it("takes a five-digit zip, with or without the four more", () => {
    expect(zip5("40741")).toBe("40741");
    expect(zip5(" 40741-1234 ")).toBe("40741");
    expect(zip5("4074")).toBeNull();
    expect(zip5("K1A 0B1")).toBeNull();
    expect(zip5("")).toBeNull();
    expect(zip5(undefined)).toBeNull();
  });

  it("takes a two-letter state only", () => {
    expect(state2("ky")).toBe("KY");
    expect(state2(" Tn ")).toBe("TN");
    expect(state2("Kentucky")).toBeNull();
    expect(state2("")).toBeNull();
  });

  it("asks for the zip, and for the town inside its state", () => {
    expect(zipLookupUrl("40741")).toBe("https://api.zippopotam.us/us/40741");
    expect(townLookupUrl("KY", " Mount Vernon ")).toBe(
      "https://api.zippopotam.us/us/ky/mount%20vernon",
    );
  });

  it("a zip code's answer is its centre, named", () => {
    expect(parseZipPlace(ZIP_BODY)).toEqual({
      lat: 38.2507,
      lng: -85.7476,
      by: "zip",
      place: "Louisville, KY 40202",
    });
  });

  it("a town with several zip codes is the middle of them", () => {
    expect(parseTownPlace(TOWN_BODY)).toEqual({
      lat: 37.14,
      lng: -84.09,
      by: "town",
      place: "London, KY",
    });
  });

  it("no match, an empty answer and a broken one are all a miss", () => {
    for (const body of [null, {}, { places: [] }, "nope", { places: [{ latitude: "x" }] }]) {
      expect(parseZipPlace(body)).toBeNull();
      expect(parseTownPlace(body)).toBeNull();
    }
    // A point that is not on Earth is not a place.
    expect(parseZipPlace({ places: [{ latitude: "137.1", longitude: "-84" }] })).toBeNull();
    // A blank is not zero degrees.
    expect(parseZipPlace({ places: [{ latitude: "", longitude: "" }] })).toBeNull();
  });
});

describe("placing an address, most exact first", () => {
  const a = { address: "100 Main St", city: "London", state: "KY", zip: "40741" };
  const line = "100 Main St, London, KY 40741";

  it("the building on our map is used and nothing else is asked", async () => {
    building.mockResolvedValue({ lat: 37.2, lng: -84.1 });
    const l = lookups({});
    expect(await placeAddress(sb, a, l.fetcher)).toEqual({
      lat: 37.2,
      lng: -84.1,
      by: "building",
      place: null,
    });
    expect(l.asked).toEqual([]);
    expect(building).toHaveBeenCalledWith(sb, line, "KY");
  });

  it("an address outside our map is found by its street, anywhere in the country", async () => {
    const l = lookups({ [censusGeocoderUrl(line)]: CENSUS_BODY });
    expect(await placeAddress(sb, a, l.fetcher)).toEqual({
      lat: 39.1,
      lng: -84.5,
      by: "street",
      place: null,
    });
    expect(l.asked).toEqual([censusGeocoderUrl(line)]);
  });

  it("a street nobody has falls back to the zip code's centre", async () => {
    const l = lookups({ [zipLookupUrl("40741")]: ZIP_BODY });
    const got = await placeAddress(sb, a, l.fetcher);
    expect(got?.by).toBe("zip");
    expect(got?.place).toBe("Louisville, KY 40202");
    expect(l.asked).toEqual([censusGeocoderUrl(line), zipLookupUrl("40741")]);
  });

  it("with no zip, or a zip nobody has, it falls back to the town", async () => {
    const l = lookups({ [townLookupUrl("KY", "London")]: TOWN_BODY });
    const got = await placeAddress(sb, a, l.fetcher);
    expect(got).toEqual({ lat: 37.14, lng: -84.09, by: "town", place: "London, KY" });
    expect(l.asked).toEqual([
      censusGeocoderUrl(line),
      zipLookupUrl("40741"),
      townLookupUrl("KY", "London"),
    ]);

    const noZip = lookups({ [townLookupUrl("KY", "London")]: TOWN_BODY });
    await placeAddress(sb, { address: "100 Main St", city: "London", state: "KY" }, noZip.fetcher);
    expect(noZip.asked).toEqual([
      censusGeocoderUrl("100 Main St, London, KY"),
      townLookupUrl("KY", "London"),
    ]);
  });

  it("with none of the four there is no place, and no guess", async () => {
    const l = lookups({});
    expect(await placeAddress(sb, a, l.fetcher)).toBeNull();
    // A street alone has nothing to fall back to.
    const bare = lookups({});
    expect(await placeAddress(sb, { address: "100 Main St" }, bare.fetcher)).toBeNull();
    expect(bare.asked).toEqual([censusGeocoderUrl("100 Main St")]);
  });
});

describe("the drive says how the address was placed", () => {
  const origin = { line: "1 Office Rd, London, KY", state: "KY" };
  const a = { address: "100 Main St", city: "Louisville", state: "KY", zip: "40202" };

  it("to the building: an exact price", async () => {
    building.mockResolvedValue({ lat: 38.25, lng: -85.75 });
    const d = await driveTo(sb, origin, a, lookups({}).fetcher);
    expect(d?.placed_by).toBe("building");
    expect(d?.place).toBeNull();
    expect(d!.miles).toBeGreaterThan(150);
    expect(d!.hours).toBeGreaterThan(2);
    expect(placedRoughly(d!.placed_by)).toBe(false);
  });

  it("to the zip code's centre: the same drive, marked as an estimate", async () => {
    const d = await driveTo(sb, origin, a, lookups({ [zipLookupUrl("40202")]: ZIP_BODY }).fetcher);
    expect(d?.placed_by).toBe("zip");
    expect(d?.place).toBe("Louisville, KY 40202");
    expect(d!.miles).toBeGreaterThan(150);
    expect(placedRoughly(d!.placed_by)).toBe(true);
  });

  it("nowhere: no drive, so no price", async () => {
    expect(await driveTo(sb, origin, a, lookups({}).fetcher)).toBeNull();
  });
});

describe("what the page says", () => {
  it("names the town the drive is to, and that the price is an estimate", () => {
    expect(roughPlaceLine("London, KY 40741")).toBe(
      "The street address is not on the map. The drive is to the centre of London, KY 40741, so this price is an estimate until the office confirms the address.",
    );
    expect(roughPlaceLine(null)).toContain("the centre of its town");
    expect(placedRoughly("town")).toBe(true);
    expect(placedRoughly("street")).toBe(false);
    expect(NOT_PLACED_LINE).toContain("no price is given");
  });

  it("the page shows both lines", () => {
    const page = readFileSync("src/components/roof-care-settings.tsx", "utf8");
    expect(page).toContain('data-try-line="rough"');
    expect(page).toContain("roughPlaceLine(drive.place)");
    expect(page).toContain("{NOT_PLACED_LINE}");
  });
});
