/**
 * Roof Care: the map's roof size, offered on the sign-up (owner, Nov 19; docs/roof-care-plans.md).
 *
 * The owner: "should we go ahead and lookup and save the customers properties to make it easier
 * to price the plans?" The roof size box started blank and was typed from memory or a guess.
 * Now, when our map has a building outline at the property's address, the sign-up says its size
 * beside the box and offers it. The box still starts blank: a person presses "Use this size".
 *
 * Nothing is saved by this. A trial of fifty properties is in
 * docs/qa/roof-care-map-size-2026-11-19.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  MAP_ROOF_MIN_SQFT,
  MAP_ROOF_MORE,
  MAP_ROOF_USE,
  mapRoofSize,
  mapRoofSizeLine,
} from "@/lib/roof-care-plan";
import { MAP_SIZE_WAIT_MS, siteMapSize } from "@/lib/roof-care-plan.functions";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

const SITE = {
  id: "s1",
  account_id: "a1",
  name: "Made Up Storage",
  address1: "12 Example St",
  address2: null,
  city: "Sometown",
  state: "KY",
  zip: "40000",
  lat: null,
  lng: null,
};
const sb = {} as never;
const answer = (areaSqFt: number | null, note: string | null = null) => ({
  address: "",
  addressState: "KY" as const,
  found: areaSqFt === undefined ? null : ({ areaSqFt } as never),
  note,
  near: null,
});

describe("the outline as a roof size to offer", () => {
  it("is said to the hundred, as an about", () => {
    expect(mapRoofSize({ areaSqFt: 22_437.6 }, null)).toEqual({ sqft: 22_400, sure: true });
    expect(mapRoofSize({ areaSqFt: 22_450 }, null)).toEqual({ sqft: 22_500, sure: true });
    expect(mapRoofSize({ areaSqFt: 8_049 }, null)).toEqual({ sqft: 8_000, sure: true });
  });

  it("is not offered with no building, a point without an outline, or a shed", () => {
    expect(mapRoofSize(null, "No building matches this address.")).toBeNull();
    expect(mapRoofSize(undefined, null)).toBeNull();
    expect(mapRoofSize({ areaSqFt: null }, "pick the building")).toBeNull();
    expect(mapRoofSize({ areaSqFt: Number.NaN }, null)).toBeNull();
    expect(mapRoofSize({ areaSqFt: MAP_ROOF_MIN_SQFT - 1 }, null)).toBeNull();
    expect(mapRoofSize({ areaSqFt: MAP_ROOF_MIN_SQFT }, null)).not.toBeNull();
  });

  it("says so when the building was found by the property's name, not its address", () => {
    const byName = mapRoofSize({ areaSqFt: 9_000 }, "Found by name: SOME SHOP, 1 A ST. Check it.");
    expect(byName).toEqual({ sqft: 9_000, sure: false });
    expect(mapRoofSizeLine(byName!)).toBe(
      "The map shows a building of about 9,000 sq ft that matches this property's name. Check it is the right building.",
    );
  });

  it("reads in plain words, with the number as people write it", () => {
    expect(mapRoofSizeLine({ sqft: 22_400, sure: true })).toBe(
      "The map shows a building of about 22,400 sq ft at this address.",
    );
    expect(MAP_ROOF_MORE).toBe("If the property has more than one roof, add them together.");
    expect(MAP_ROOF_USE).toBe("Use this size");
  });
});

describe("the lookup for a property", () => {
  it("asks the address finder with the property's whole address and its name", async () => {
    const find = vi.fn(async () => answer(31_260));
    expect(await siteMapSize(sb, SITE, find as never)).toEqual({ sqft: 31_300, sure: true });
    expect(find).toHaveBeenCalledWith(sb, "12 Example St, Sometown, KY 40000", {
      stateHint: "KY",
      propertyName: "Made Up Storage",
    });
  });

  it("offers nothing for a property with no street address, without asking", async () => {
    const find = vi.fn(async () => answer(31_260));
    expect(await siteMapSize(sb, { ...SITE, address1: "  " }, find as never)).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it("offers nothing when the map finds no outline", async () => {
    expect(await siteMapSize(sb, SITE, (async () => answer(null)) as never)).toBeNull();
    expect(
      await siteMapSize(sb, SITE, (async () => ({ ...answer(null), found: null })) as never),
    ).toBeNull();
  });

  it("never stops the sign-up: a failing map server is nothing to offer", async () => {
    const down = async () => {
      throw new Error("Could not reach the state map server");
    };
    expect(await siteMapSize(sb, SITE, down as never)).toBeNull();
  });

  it("does not wait on a slow map server past its limit", async () => {
    const slow = () => new Promise((done) => setTimeout(() => done(answer(31_260)), 400));
    const t0 = Date.now();
    expect(await siteMapSize(sb, SITE, slow as never, 30)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(300);
    expect(MAP_SIZE_WAIT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("the sign-up screen", () => {
  const page = flat("src/components/roof-care/plan-card.tsx");
  const server = flat("src/lib/roof-care-plan.functions.ts");

  it("shows the map's size beside the box with a button, and fills the box only when pressed", () => {
    expect(page).toContain('data-sign-line="map-size"');
    expect(page).toContain("{mapRoofSizeLine(mapSize.data)} {MAP_ROOF_MORE}");
    expect(page).toContain("onClick={() => setSqft(String(mapSize.data!.sqft))}");
    expect(page).toContain('data-action="use-map-size"');
    // The box starts blank, as every number box does.
    expect(page).toContain('const [sqft, setSqft] = useState("");');
  });

  it("asks once per property and does not ask again on a miss", () => {
    expect(page).toContain('queryKey: ["roof-care-map-size", siteId]');
    expect(page).toContain("retry: false");
  });

  it("is a read: the server function saves nothing and asks for a sign-in", () => {
    const fn = server.slice(server.indexOf("export const roofCareMapSize"));
    const body = fn.slice(0, fn.indexOf("const PLAN_SELECT"));
    expect(body).toContain('createServerFn({ method: "GET" })');
    expect(body).toContain("await signedIn(context);");
    expect(body).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});
