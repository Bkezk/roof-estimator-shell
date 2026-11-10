/**
 * Speed pass, Nov 10, finding 12: the Roofs & Storms building list asked for whole rows
 * (`select("*")`): 500 buildings with their owner and parcel fields, notes, the loader's
 * bookkeeping and every building's outline — 1.2 MB. Measured on the live table the same day:
 * 729 KB of plain JSON for 500 whole rows, 252 KB for the list's columns, 386 KB with outlines.
 *
 * Now the list asks for the columns a row shows and the map's pin needs
 * (BUILDING_LIST_COLUMNS), and for the outline only on the storm-hit list, the one the map
 * draws. The open building's whole row still comes from getBuilding.
 *
 * Fails on the old code: select("*"), every column in every row.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  BUILDING_LIST_COLUMNS,
  BUILDING_LIST_COLUMNS_WITH_OUTLINE,
  listBuildings,
} from "@/lib/prospect.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cols = (s: string) => s.split(",").map((c) => c.trim());

const building = (n: number, more: Row = {}): Row => ({
  id: `b${n}`,
  name: `Building ${n}`,
  address1: `${n} Main St`,
  address2: null,
  address_approx: n === 2,
  address_approx_m: 14,
  address_checked_at: null,
  city: "Corbin",
  county: "Whitley",
  state: "KY",
  zip: "40701",
  parcel_id: `P-${n}`,
  owner_name: "An Owner LLC",
  owner_address: "PO Box 1",
  land_use: "Commercial",
  roof_sqft: 12000 + n,
  building_sqft: 11000,
  lot_sqft: 90000,
  perimeter_ft: 440,
  height_ft: 22,
  stories: 1,
  year_built: 1998,
  roof_year: 2004,
  tax_year: 2025,
  deed: "D-1",
  notes: "a long note the list never shows",
  own_book: false,
  prospect_stage: n === 1 ? "prospect" : null,
  prospect_owner_name: null,
  prospected_at: null,
  last_reroof_on: n === 3 ? "2026-03-01" : null,
  last_reroof_by: n === 3 ? "A Roofer" : null,
  last_storm_at: n === 2 ? "2026-09-21T00:00:00Z" : null,
  last_storm_kind: n === 2 ? "hail" : null,
  last_storm_magnitude: n === 2 ? 1 : null,
  last_storm_miles: n === 2 ? 2.4 : null,
  centroid_lat: 36.9,
  centroid_lng: -84.1,
  footprint: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  source: "ky",
  source_key: `k${n}`,
  source_layer: "footprints",
  imported_at: "2026-09-24T00:00:00Z",
  created_at: "2026-09-24T00:00:00Z",
  created_by: null,
  created_by_name: null,
  updated_at: `2026-10-0${n}T00:00:00Z`,
  deleted_at: null,
  ...more,
});

const world = () =>
  fakeSupabase({
    profiles: [{ id: ME, role: "user", access: ["prospect"], full_name: "P", email: "p@x" }],
    buildings: [building(1), building(2), building(3), building(4, { deleted_at: "2026-10-09" })],
  });
const list = (db: unknown, data: Row = {}) =>
  (listBuildings as unknown as (a: { data: unknown; context: unknown }) => Promise<Row[]>)({
    data,
    context: { supabase: db, userId: ME },
  });

describe("the building list reads the list's columns", () => {
  it("a row carries what the list shows and nothing else; no outline", async () => {
    const rows = await list(world().db);
    expect(rows.map((r) => r["id"]).sort()).toEqual(["b1", "b2", "b3"]);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual([...cols(BUILDING_LIST_COLUMNS), "footprint"].sort());
      expect(r["footprint"]).toBeNull();
      for (const k of ["notes", "owner_name", "owner_address", "parcel_id", "deed", "source_key"])
        expect(r).not.toHaveProperty(k);
    }
    const b3 = rows.find((r) => r["id"] === "b3")!;
    expect(b3).toMatchObject({
      name: "Building 3",
      address1: "3 Main St",
      county: "Whitley",
      roof_sqft: 12003,
      land_use: "Commercial",
      last_reroof_on: "2026-03-01",
      last_reroof_by: "A Roofer",
      centroid_lat: 36.9,
    });
  });
  it("the storm-hit list (the one the map draws) carries the outlines", async () => {
    const rows = await list(world().db, { stormHit: true, sort: "storm" });
    expect(rows.map((r) => r["id"])).toEqual(["b2"]);
    expect(rows[0]!["footprint"]).toEqual(building(2)["footprint"]);
    expect(Object.keys(rows[0]!).sort()).toEqual(cols(BUILDING_LIST_COLUMNS_WITH_OUTLINE).sort());
  });
  it("the answer is well under half the size of whole rows", async () => {
    const env = world();
    const slim = JSON.stringify(await list(env.db)).length;
    const whole = JSON.stringify(env.tables["buildings"]!.filter((b) => !b["deleted_at"])).length;
    expect(slim).toBeLessThan(whole * 0.55);
  });
  it("the server never asks for every column on the list", () => {
    const s = read("src/lib/prospect.functions.ts");
    const fn = s.slice(
      s.indexOf("export const listBuildings"),
      s.indexOf("/** The Tennessee imagery index"),
    );
    expect(fn).toContain(
      ".select(data.stormHit ? BUILDING_LIST_COLUMNS_WITH_OUTLINE : BUILDING_LIST_COLUMNS)",
    );
    expect(fn).not.toContain('.select("*")');
    expect(fn).toContain(".limit(500)");
  });
});

describe("every field a list row reads is asked for", () => {
  const page = read("src/components/prospect-page.tsx");
  const asked = cols(BUILDING_LIST_COLUMNS);
  it("the row's title, its detail line, the stage chip, the storm badge", () => {
    // What rowTitle, rowDetail (with roofAge and the re-roof stamp) and stormBadge read.
    for (const k of [
      "name",
      "address1",
      "address_approx",
      "roof_sqft",
      "building_sqft",
      "city",
      "county",
      "roof_year",
      "year_built",
      "land_use",
      "last_reroof_on",
      "last_reroof_by",
      "prospect_stage",
      "last_storm_at",
      "last_storm_kind",
      "last_storm_magnitude",
      "last_storm_miles",
    ])
      expect(asked, k).toContain(k);
    const rows = page.slice(
      page.indexOf("{(buildings.data ?? []).map((b) => ("),
      page.indexOf("</CardContent>", page.indexOf("{(buildings.data ?? []).map((b) => (")),
    );
    // Every `b.<field>` the list's rows touch directly is a list column.
    const used = [...new Set([...rows.matchAll(/\bb\.([a-z_0-9]+)/g)].map((m) => m[1]!))];
    expect(used.length).toBeGreaterThan(3);
    for (const k of used) expect(asked, `b.${k}`).toContain(k);
  });
  it("the map's pin: the point, and the outline from the storm-hit list or the open building", () => {
    for (const k of ["centroid_lat", "centroid_lng"]) expect(asked).toContain(k);
    expect(page).toContain(
      "const src = stormHit ? (buildings.data ?? []) : (prospects.data ?? []);",
    );
    expect(page).toContain("...(stormHit ? { stormHit: true } : {}),");
    expect(page).toContain("footprint: b.footprint,");
  });
  it("the star's in-place patch keeps the list's rows as list rows", () => {
    expect(page).toContain(
      'qc.setQueriesData<BuildingListRow[]>({ queryKey: ["buildings"] }, (list) =>',
    );
  });
});
