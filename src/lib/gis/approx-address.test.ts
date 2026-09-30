import { describe, expect, it } from "vitest";

import {
  APPROX_MAX_M,
  APPROX_SEARCH_M,
  Grid,
  approxMatch,
  exactRadiusM,
  metres,
} from "./approx-address";

// A barn in Graves County; points are placed due north / east of it at known distances.
const BARN = { lat: 36.72, lng: -88.64 };
const north = (m: number, address: string) => ({
  lat: BARN.lat + m / 111320,
  lng: BARN.lng,
  address,
});
const east = (m: number, address: string) => ({
  lat: BARN.lat,
  lng: BARN.lng + m / (111320 * Math.cos((BARN.lat * Math.PI) / 180)),
  address,
});

describe("metres", () => {
  it("measures the placed fixture points", () => {
    const p = north(180, "x");
    expect(metres(BARN.lat, BARN.lng, p.lat, p.lng)).toBeCloseTo(180, 6);
    const q = east(250, "y");
    expect(metres(BARN.lat, BARN.lng, q.lat, q.lng)).toBeCloseTo(250, 6);
  });
});

describe("exactRadiusM", () => {
  it("is 100 m, or the roof's own size for big roofs", () => {
    expect(exactRadiusM(null)).toBe(100);
    expect(exactRadiusM(5000)).toBe(100);
    expect(exactRadiusM(1_000_000)).toBeCloseTo(304.8, 1);
  });
});

describe("approxMatch (owner's rules, Sep 29)", () => {
  it("takes the nearest point when the next is at least twice as far", () => {
    const r = approxMatch(BARN, [north(180, "1169 STATE ROUTE 136 W"), east(400, "22 OAK LN")]);
    expect(r.outcome).toBe("approx");
    if (r.outcome !== "approx") return;
    expect(r.point.address).toBe("1169 STATE ROUTE 136 W");
    expect(r.distanceM).toBeCloseTo(180, 3);
    expect(r.nextM).toBeCloseTo(400, 3);
  });

  it("accepts exactly twice as far (at least twice)", () => {
    const r = approxMatch(BARN, [north(150, "A ST"), east(300.0001, "B ST")]);
    expect(r.outcome).toBe("approx");
  });

  it("leaves it blank when two addresses are close contenders", () => {
    const r = approxMatch(BARN, [north(180, "1169 STATE ROUTE 136 W"), east(300, "22 OAK LN")]);
    expect(r.outcome).toBe("contested");
    if (r.outcome !== "contested") return;
    expect(r.next.address).toBe("22 OAK LN");
    expect(r.nextM).toBeCloseTo(300, 3);
  });

  it("does not look past 300 m", () => {
    expect(approxMatch(BARN, [north(301, "FAR RD")]).outcome).toBe("none");
    expect(approxMatch(BARN, [north(APPROX_MAX_M, "EDGE RD")]).outcome).toBe("approx");
    expect(approxMatch(BARN, []).outcome).toBe("none");
  });

  it("reports the nearest distance when nothing is within 300 m", () => {
    const r = approxMatch(BARN, [east(450, "FAR RD"), north(350, "FARTHER RD")]);
    expect(r).toMatchObject({ outcome: "none" });
    if (r.outcome === "none") expect(r.nearestM).toBeCloseTo(350, 3);
  });

  it("a second point with the same address is not a contender", () => {
    const r = approxMatch(BARN, [
      north(150, "1169 State Route 136 W"),
      east(170, "1169  STATE ROUTE 136 W"),
      east(500, "22 OAK LN"),
    ]);
    expect(r.outcome).toBe("approx");
    if (r.outcome !== "approx") return;
    expect(r.nextM).toBeCloseTo(500, 3);
    expect(r.strictNextM).toBeCloseTo(170, 3);
  });

  it("says nextM null when no other address lies within the 600 m search", () => {
    const r = approxMatch(BARN, [north(120, "A ST"), east(700, "B ST")]);
    expect(r).toMatchObject({ outcome: "approx", nextM: null, strictNextM: null });
  });

  it("does not depend on the order the candidates arrive in", () => {
    const pts = [east(400, "22 OAK LN"), north(190, "1 MAIN ST"), east(1000, "Z")];
    const a = approxMatch(BARN, pts);
    const b = approxMatch(BARN, [...pts].reverse());
    expect(a).toEqual(b);
    expect(a.outcome).toBe("approx");
  });
});

describe("Grid.within", () => {
  it("returns every point inside the search radius (a superset)", () => {
    const pts = [
      north(10, "a"),
      north(299, "b"),
      east(599, "c"),
      east(-599, "d"),
      north(-599, "e"),
      north(2000, "far"),
    ];
    const g = new Grid();
    pts.forEach((p, i) => g.add(p.lat, p.lng, i));
    const got = new Set(g.within(BARN.lat, BARN.lng, APPROX_SEARCH_M));
    for (let i = 0; i < 5; i++) expect(got.has(i)).toBe(true);
    expect(got.has(5)).toBe(false);
  });

  it("answers at once, with nothing, for a position that is not degrees (the Fleming hang)", () => {
    const g = new Grid();
    const p = east(120, "x");
    g.add(p.lat, p.lng, 0);
    // 315,450 = 876 turns + 90°: cos ≈ 0, so the naive cell count is in the trillions.
    const t0 = Date.now();
    expect(g.within(315450, 1836884.875, APPROX_SEARCH_M)).toEqual([]);
    expect(g.within(Number.NaN, 0, APPROX_SEARCH_M)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("around() still covers the 3 × 3 neighbourhood", () => {
    const g = new Grid();
    const p = east(120, "x");
    g.add(p.lat, p.lng, 0);
    expect(g.around(BARN.lat, BARN.lng)).toEqual([0]);
  });
});
