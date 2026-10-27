/**
 * Owner, Oct 27: "make the From an address finder as robust as possible." The pure reading of
 * what was typed (src/lib/address-query.ts): whitespace and case, a comma-less line, a missing
 * state or city, directionals / suffixes / route prefixes, unit words, ZIP, intersections,
 * place names, coordinates and map links; the step labels; the typo-tolerant street match.
 * Fails on the old code (parseStreetAddress alone needed "street, city, ST zip").
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_QUERY_MESSAGE,
  FIND_HOW_LABELS,
  INTERSECTION_MESSAGE,
  LINK_WITHOUT_POINT_MESSAGE,
  closestStreetName,
  correctedStreetNote,
  editDistance,
  normalizeAddressLine,
  parseAddressQuery,
  parseCoordinates,
  parseMapLink,
  searchedStatesNote,
} from "./address-query";
import { isStreetSuffixWord, parseStreetAddress } from "./aerial-address";

const street = (line: string) => {
  const q = parseAddressQuery(line);
  if (q.kind !== "street") throw new Error(`${line} read as ${q.kind}`);
  return q;
};

describe("input tolerance", () => {
  it("trims and collapses whitespace, case-insensitive", () => {
    expect(normalizeAddressLine("  412   main\tst ,  murray ,KY  ")).toBe(
      "412 main st , murray ,KY",
    );
    const q = street("  412   main st,  murray,  ky 42071 ");
    expect(q.parsed.house).toBe("412");
    expect(q.parsed.street).toBe("MAIN ST");
    expect(q.parsed.city).toBe("MURRAY");
    expect(q.states).toEqual(["KY"]);
    expect(q.zip).toBe("42071");
    expect(q.word).toBe("MAIN");
  });

  it("accepts the layout without commas", () => {
    const q = street("412 Main St Murray KY 42071");
    expect(q.parsed.house).toBe("412");
    expect(q.parsed.street).toBe("MAIN ST");
    expect(q.parsed.city).toBe("MURRAY");
    expect(q.parsed.state).toBe("KY");
    expect(q.zip).toBe("42071");
    const two = street("531 E Cumberland Gap Pkwy Corbin KY");
    expect(two.parsed.street).toBe("E CUMBERLAND GAP PKWY");
    expect(two.parsed.city).toBe("CORBIN");
    // A post-directional after the suffix is not a town, and NE is a direction here, not Nebraska.
    const post = street("412 Main St NE");
    expect(post.parsed.city).toBeNull();
    expect(post.parsed.street).toBe("MAIN ST NE");
    expect(post.states).toEqual(["KY", "TN"]);
    const hwy = street("1169 State Route 136 W Murray Kentucky");
    expect(hwy.parsed.core).toEqual(["STATE", "HWY", "136"]);
    expect(hwy.parsed.city).toBe("MURRAY");
    expect(hwy.states).toEqual(["KY"]);
  });

  it("a missing state searches Kentucky then Tennessee; a missing city searches by number + street", () => {
    const noState = street("412 Main St, Murray");
    expect(noState.states).toEqual(["KY", "TN"]);
    expect(noState.parsed.city).toBe("MURRAY");
    expect(searchedStatesNote(noState.states)).toBe("Searched Kentucky, then Tennessee");
    expect(searchedStatesNote(["TN"])).toBeNull();
    const noCity = street("412 Main St, KY");
    expect(noCity.parsed.city).toBeNull();
    expect(noCity.states).toEqual(["KY"]);
    const tn = street("100 Broadway, TN");
    expect(tn.states).toEqual(["TN"]);
    const bare = street("412 Main St");
    expect(bare.parsed.city).toBeNull();
    expect(bare.states).toEqual(["KY", "TN"]);
  });

  it("another state is named: nothing of ours to search (the Census step says where it is)", () => {
    const q = street("100 High St, Columbus, OH 43215");
    expect(q.states).toEqual([]);
    expect(q.outsideState).toBe("OH");
    expect(street("100 High St Columbus Ohio").outsideState).toBe("OH");
  });

  it("normalises directionals, suffixes both ways, route prefixes, and drops unit words", () => {
    expect(street("412 North Main Street, Murray, KY").parsed.street).toBe("N MAIN ST");
    expect(street("412 n. main st., murray, ky").parsed.street).toBe("N MAIN ST");
    for (const [typed, want] of [
      ["Highway", "HWY"],
      ["Hwy", "HWY"],
      ["Parkway", "PKWY"],
      ["Trail", "TRL"],
      ["Way", "WAY"],
      ["Terrace", "TER"],
      ["Loop", "LOOP"],
      ["Bypass", "BYP"],
      ["Pike", "PIKE"],
      ["Alley", "ALY"],
      ["Plaza", "PLZ"],
      ["Square", "SQ"],
      ["Crossing", "XING"],
      ["Turnpike", "TPKE"],
    ] as const) {
      expect(isStreetSuffixWord(typed)).toBe(true);
      expect(isStreetSuffixWord(want)).toBe(true);
      if (want !== "HWY") {
        expect(street(`10 Oak ${typed}, Corbin, KY`).parsed.suffix).toBe(want);
        expect(street(`10 Oak ${want}, Corbin, KY`).parsed.suffix).toBe(want);
      }
    }
    expect(street("100 US 25E, Corbin, KY").parsed.core).toEqual(["US", "25E"]);
    expect(street("100 US-25E Corbin KY").parsed.core).toEqual(["US", "25E"]);
    expect(street("100 US Hwy 25E, Corbin, KY").parsed.core).toEqual(["US", "HWY", "25E"]);
    expect(street("100 KY 80, Somerset, KY").parsed.core).toEqual(["KY", "80"]);
    expect(street("100 Hwy 27, Somerset KY").parsed.core).toEqual(["HWY", "27"]);
    expect(street("100 Hwy 27, Somerset KY").word).toBe("27");
    expect(street("100 SR-80 Somerset KY").parsed.core).toEqual(["STATE", "HWY", "80"]);
    // Unit words are dropped, however written.
    for (const unit of ["Suite 200", "Ste 200", "Unit B", "Apt 4", "#4"]) {
      const q = street(`412 Main St ${unit}, Murray, KY 42071`);
      expect(q.parsed.street).toBe("MAIN ST");
      expect(q.parsed.city).toBe("MURRAY");
    }
    expect(street("412 Main St, Suite 2, Murray, KY 42071").parsed.city).toBe("MURRAY");
  });

  it("the ZIP is read but matching does not need it (no ZIP → city table exists)", () => {
    const q = street("412 Main St 42071");
    expect(q.zip).toBe("42071");
    expect(q.parsed.city).toBeNull();
    expect(q.parsed.zip).toBe("42071");
  });

  it("rejects an intersection with a clear message", () => {
    for (const line of [
      "Main St & 5th Ave, Murray KY",
      "Main St and 5th Ave",
      "N Main St at Oak Rd",
    ]) {
      const q = parseAddressQuery(line);
      expect(q.kind).toBe("intersection");
      expect(q.kind === "intersection" && q.message).toBe(INTERSECTION_MESSAGE);
    }
    // A business with "and" in its name is a place, not an intersection.
    expect(parseAddressQuery("Smith and Sons Hardware, Corbin KY").kind).toBe("place");
  });

  it("empty input", () => {
    const q = parseAddressQuery("   ");
    expect(q.kind).toBe("empty");
    expect(q.kind === "empty" && q.message).toBe(EMPTY_QUERY_MESSAGE);
  });
});

describe("place names", () => {
  it("a line with no house number is a place, in its town, both states when none is given", () => {
    const q = parseAddressQuery("Advance Auto Parts, Corbin KY");
    expect(q).toMatchObject({
      kind: "place",
      name: "Advance Auto Parts",
      city: "CORBIN",
      states: ["KY"],
    });
    const noTown = parseAddressQuery("Corbin High School");
    expect(noTown).toMatchObject({ kind: "place", name: "Corbin High School", city: null });
    expect(noTown.kind === "place" && noTown.states).toEqual(["KY", "TN"]);
    const tn = parseAddressQuery("Walmart, Clarksville, TN 37040");
    expect(tn).toMatchObject({
      kind: "place",
      name: "Walmart",
      city: "CLARKSVILLE",
      states: ["TN"],
    });
  });
});

describe("coordinates and map links", () => {
  it("lat, lng in the usual spellings", () => {
    expect(parseCoordinates("36.9757, -84.1091")).toEqual({ lat: 36.9757, lng: -84.1091 });
    expect(parseCoordinates("36.9757 -84.1091")).toEqual({ lat: 36.9757, lng: -84.1091 });
    expect(parseCoordinates("36.9757,-84.1091")).toEqual({ lat: 36.9757, lng: -84.1091 });
    // lng, lat the wrong way round still reads.
    expect(parseCoordinates("-84.1091, 36.9757")).toEqual({ lat: 36.9757, lng: -84.1091 });
    expect(parseCoordinates("412 Main")).toBeNull();
    expect(parseCoordinates("412 1200")).toBeNull();
    expect(parseAddressQuery(" 36.9757 , -84.1091 ")).toMatchObject({
      kind: "point",
      at: { lat: 36.9757, lng: -84.1091 },
    });
  });

  it("Google Maps links: the place's own point first, then ?q=, then the camera", () => {
    expect(
      parseMapLink(
        "https://www.google.com/maps/place/Advance+Auto+Parts/@36.9512,-84.1123,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d36.95118!4d-84.10989!16s",
      ),
    ).toEqual({ lat: 36.95118, lng: -84.10989 });
    expect(parseMapLink("https://www.google.com/maps/@36.9757,-84.1091,19z")).toEqual({
      lat: 36.9757,
      lng: -84.1091,
    });
    expect(parseMapLink("https://maps.google.com/?q=36.9757,-84.1091")).toEqual({
      lat: 36.9757,
      lng: -84.1091,
    });
    expect(
      parseMapLink("https://www.google.com/maps/search/?api=1&query=36.9757%2C-84.1091"),
    ).toEqual({
      lat: 36.9757,
      lng: -84.1091,
    });
    expect(parseMapLink("https://maps.apple.com/?ll=36.9757,-84.1091&q=Corbin")).toEqual({
      lat: 36.9757,
      lng: -84.1091,
    });
    expect(parseMapLink("https://www.openstreetmap.org/#map=19/36.9757/-84.1091")).toEqual({
      lat: 36.9757,
      lng: -84.1091,
    });
    expect(parseAddressQuery("https://maps.google.com/?q=36.9757,-84.1091")).toMatchObject({
      kind: "point",
    });
    const noPoint = parseAddressQuery("https://www.google.com/maps/place/Corbin,+KY");
    expect(noPoint.kind).toBe("link-without-point");
    expect(noPoint.kind === "link-without-point" && noPoint.message).toBe(
      LINK_WITHOUT_POINT_MESSAGE,
    );
  });
});

describe("the step labels", () => {
  it("name every step the picker reports", () => {
    expect(FIND_HOW_LABELS).toEqual({
      stored: "Found in our map data",
      "ky-points": "Found on Kentucky's address points",
      "tn-structures": "Found on Tennessee's structures",
      "by-name": "Found by name",
      "corrected-street": "Corrected street",
      nearest: "Nearest numbers on the street",
      census: "Census geocoder",
      point: "Found at the coordinates",
      picked: "Picked on the map",
    });
    expect(correctedStreetNote("CUMBERLAND GAP", "CUMBERLND GAP")).toBe(
      "Searched Cumberland Gap (you typed Cumberlnd Gap)",
    );
  });
});

describe("typo tolerance", () => {
  const names = ["CUMBERLAND GAP", "MAIN", "MASTER", "MAPLE", "KENTUCKY", "OAK"];
  it("edit distance", () => {
    expect(editDistance("MAIN", "MAIN")).toBe(0);
    expect(editDistance("MIAN", "MAIN")).toBe(2);
    expect(editDistance("CUMBERLND", "CUMBERLAND")).toBe(1);
  });
  it("picks the one close name (≤ 2 edits or ≤ 25%), never when the exact name exists or two tie", () => {
    expect(closestStreetName("CUMBERLND GAP", names)).toEqual({
      name: "CUMBERLAND GAP",
      distance: 1,
    });
    expect(closestStreetName("CUMBERLAND GAPP", names)?.name).toBe("CUMBERLAND GAP");
    expect(closestStreetName("MAIN", names)).toBeNull();
    expect(closestStreetName("MAIM", names)?.name).toBe("MAIN");
    // "MAPEL" is 2 from MAPLE and 3 from MAIN → MAPLE; "MANE" is 2 from both → no guess.
    expect(closestStreetName("MAPEL", names)?.name).toBe("MAPLE");
    expect(closestStreetName("MANE", names)).toBeNull();
    // Equally close to two different names → no guess.
    expect(closestStreetName("MAXN", ["MAIN", "MANN"])).toBeNull();
    expect(closestStreetName("ZZZZZZ", names)).toBeNull();
    expect(closestStreetName("OK", names)).toBeNull();
  });
  it("the typed core words are what gets corrected (the suffix is not part of the name)", () => {
    const p = parseStreetAddress("531 E Cumberlnd Gap Pkwy, Corbin, KY")!;
    expect(closestStreetName(p.core.join(" "), names)?.name).toBe("CUMBERLAND GAP");
  });
});
