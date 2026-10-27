/**
 * New takeoff › From an address (owner, Oct 27: "on the takeoffs can we expand its usage a bit,
 * we also want to be able to search an address, it pull up an aerial picture and we can mark it
 * up from that as well"). The server side through the fake Supabase with `fetch` standing in for
 * the state servers: lookupAddressAerial answers the ticket aerial's shape for a free-typed
 * address (found / not found / near), under Takeoff access; takeoffBuildingAt is the ticket's
 * "Pick the building" under the same access. Then the dialog's third option, the "Use this
 * picture" flow, the no-imagery line, the list row and the editor header, the column (migration
 * and types) and createTakeoff keeping it — pinned to the source.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  lookupAddressAerial,
  lookupAddressInput,
  takeoffBuildingAt,
  type FindAerial,
  type FoundBuilding,
} from "@/lib/takeoff-aerial.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const read = (rel: string) => readFileSync(rel, "utf8");

// ── Fixtures: Web Mercator features as the state layers send them ──────────────────────────

const R = 6378137;
const toMercator = (lng: number, lat: number): [number, number] => [
  (lng * Math.PI * R) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
function squareRing(lng: number, lat: number, sqft: number): number[][] {
  const [x, y] = toMercator(lng, lat);
  const side = Math.sqrt(sqft / 10.76391) / Math.cos((lat * Math.PI) / 180);
  const h = side / 2;
  return [
    [x - h, y - h],
    [x + h, y - h],
    [x + h, y + h],
    [x - h, y + h],
    [x - h, y - h],
  ];
}
const KY_AT = { lat: 36.6103, lng: -88.3148 };
const kyPoint = (over: Row = {}, at = KY_AT) => {
  const [x, y] = toMercator(at.lng, at.lat);
  return {
    attributes: {
      OBJECTID: 7,
      Site_NGUID: `SSAP${String(over["Add_Number"] ?? 412)}@calloway.ky`,
      Add_Number: 412,
      LSt_Name: "MAIN",
      LSt_Type: "ST",
      Post_Comm: "MURRAY",
      Post_Code: "42071",
      Inc_Muni: "MURRAY",
      County: "Calloway County",
      LandmkName: null,
      Place_Type: "Commercial",
      Lat: null,
      Long: null,
      ...over,
    },
    geometry: { x, y },
  };
};
const footprint = (at: { lat: number; lng: number }, sqft: number, attrs: Row = {}) => ({
  attributes: {
    BUILD_ID: 991,
    SQFEET: sqft,
    FIPS: "21035",
    PROP_ADDR: null,
    PROP_CITY: null,
    PROP_ZIP: null,
    OCC_CLS: "Commercial",
    LATITUDE: at.lat,
    LONGITUDE: at.lng,
    ...attrs,
  },
  geometry: { rings: [squareRing(at.lng, at.lat, sqft)] },
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let env: ReturnType<typeof fakeSupabase>;
let urls: string[];
let answers: Record<
  "Address_Points" | "Building_Footprints" | "USA_Structures" | "geocoding.geo.census.gov",
  () => Response
>;

function setup(profile: Row, rpcs: Record<string, () => unknown> = {}) {
  env = fakeSupabase(
    { profiles: [{ id: ME, role: "user", access: [], technician: false, ...profile }] },
    {
      rpcs: {
        service_aerial_address_candidates: () => [],
        service_aerial_buildings_near: () => [],
        ...rpcs,
      },
    },
  );
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const key = (Object.keys(answers) as (keyof typeof answers)[]).find((k) => url.includes(k));
      if (!key) throw new Error(`unexpected fetch ${url}`);
      return answers[key]();
    }),
  );
}
beforeEach(() => {
  answers = {
    Address_Points: () => json({ features: [] }),
    Building_Footprints: () => json({ features: [] }),
    USA_Structures: () => json({ features: [] }),
    "geocoding.geo.census.gov": () => json({ result: { addressMatches: [] } }),
  };
});
afterEach(() => vi.unstubAllGlobals());

type Call<T> = (a: { data: Row; context: unknown }) => Promise<T>;
const lookup = (address: string) =>
  (lookupAddressAerial as unknown as Call<FindAerial>)({
    data: { address },
    context: { supabase: env.db, userId: ME },
  });
const pickAt = (at: { lat: number; lng: number }) =>
  (takeoffBuildingAt as unknown as Call<FoundBuilding>)({
    data: at,
    context: { supabase: env.db, userId: ME },
  });
const TAKEOFF_USER = { access: ["takeoff"] };

describe("lookupAddressAerial", () => {
  it("found: a Kentucky address on the live layers → the outline, the ticket aerial's shape", async () => {
    setup(TAKEOFF_USER);
    answers.Address_Points = () => json({ features: [kyPoint()] });
    answers.Building_Footprints = () => json({ features: [footprint(KY_AT, 12000)] });
    const r = await lookup("412 Main St, Murray, KY 42071");
    // The ticket aerial's shape plus the finder's step and the choice list (owner, Oct 27).
    expect(Object.keys(r).sort()).toEqual([
      "address",
      "addressState",
      "candidates",
      "found",
      "how",
      "near",
      "note",
    ]);
    expect(r.how).toBe("ky-points");
    expect(r.candidates).toEqual([]);
    expect(r.address).toBe("412 Main St, Murray, KY 42071");
    expect(r.addressState).toBe("KY");
    expect(r.note).toBeNull();
    expect(r.near).toBeNull();
    expect(r.found).toMatchObject({
      id: null,
      how: "address",
      state: "KY",
      address: "412 MAIN ST",
    });
    expect(r.found!.footprint?.type).toBe("Polygon");
    expect(r.found!.areaSqFt).toBeGreaterThan(12000 - 300);
    expect(r.found!.areaSqFt).toBeLessThan(12000 + 300);
    expect(r.found!.lat).toBeCloseTo(KY_AT.lat, 3);
    expect(r.found!.lng).toBeCloseTo(KY_AT.lng, 3);
    // Our stored data was asked first, then the 911 points, then the outline under the point.
    expect(env.rpcCalls.map((c) => c.fn)).toEqual(["service_aerial_address_candidates"]);
    expect(urls.map((u) => (u.includes("Address_Points") ? "points" : "footprints"))).toEqual([
      "points",
      "footprints",
    ]);
  });

  it("found: a stored building wins without asking the state server", async () => {
    setup(TAKEOFF_USER, {
      service_aerial_address_candidates: () => [
        {
          source: "building",
          id: "b1",
          address: "412 MAIN ST",
          city: "MURRAY",
          zip: "42071",
          lat: KY_AT.lat,
          lng: KY_AT.lng,
          building_id: "b1",
        },
      ],
      service_aerial_buildings_near: () => [
        {
          id: "b1",
          address1: "412 Main St",
          city: "Murray",
          state: "KY",
          centroid_lat: KY_AT.lat,
          centroid_lng: KY_AT.lng,
          footprint: {
            type: "Polygon",
            coordinates: [
              [
                [KY_AT.lng - 0.0004, KY_AT.lat - 0.0003],
                [KY_AT.lng + 0.0004, KY_AT.lat - 0.0003],
                [KY_AT.lng + 0.0004, KY_AT.lat + 0.0003],
                [KY_AT.lng - 0.0004, KY_AT.lat + 0.0003],
                [KY_AT.lng - 0.0004, KY_AT.lat - 0.0003],
              ],
            ],
          },
        },
      ],
    });
    const r = await lookup("412 Main St, Murray, KY 42071");
    expect(r.found).toMatchObject({ id: "b1", how: "address", state: "KY" });
    expect(r.found!.areaSqFt).toBeGreaterThan(0);
    expect(r.note).toBeNull();
    expect(urls).toEqual([]);
  });

  it("not found: nothing stored and nothing on the state layers → found null and the note", async () => {
    setup(TAKEOFF_USER);
    const r = await lookup("412 Main St, Murray, KY 42071");
    // Owner, Oct 27: the finder went on to the town's street names (no closer spelling), the
    // street's own numbers (none) and the Census geocoder (no match) before giving up.
    expect(r).toEqual({
      address: "412 Main St, Murray, KY 42071",
      addressState: "KY",
      found: null,
      note: "No building or 911 address point in our map data matches this address. The Census geocoder has no match for it either.",
      near: null,
      how: null,
      candidates: [],
    });
    expect(urls.some((u) => u.includes("geocoding.geo.census.gov"))).toBe(true);
    expect(urls.some((u) => u.includes("USA_Structures"))).toBe(false);
  });

  it("near (owner, Oct 26): the number is not on the street but the street is → where Pick the building opens", async () => {
    setup(TAKEOFF_USER);
    const near = [
      kyPoint({ Add_Number: 400 }, { lat: 36.611, lng: -88.315 }),
      kyPoint({ Add_Number: 420 }, { lat: 36.6116, lng: -88.3154 }),
    ];
    answers.Address_Points = () => {
      const where = new URL(urls[urls.length - 1]!).searchParams.get("where") ?? "";
      // The by-number query has nothing; the on-street query (by town) has the neighbours.
      return json({ features: where.includes("Post_Comm IN") ? near : [] });
    };
    const r = await lookup("412 Main St, Murray, KY 42071");
    expect(r.found).toBeNull();
    expect(r.near).not.toBeNull();
    expect(r.near!.lat).toBeCloseTo(36.6113, 4);
    expect(r.near!.lng).toBeCloseTo(-88.3152, 4);
    expect(r.note).toBe(
      "Nothing at 412 on Main St in Murray; the map opens at 400–420 Main St — pick the building.",
    );
  });

  it("a line with no house number is searched as a place name (owner, Oct 27), then the Census geocoder", async () => {
    setup(TAKEOFF_USER);
    const r = await lookup("Main Street, Murray, KY");
    expect(r.found).toBeNull();
    expect(r.note).toBe(
      'No landmark named like "Main Street" in Murray on Kentucky\'s address points. The Census geocoder has no match for it either.',
    );
    expect(urls.map((u) => new URL(u).hostname)).toEqual([
      "kygisserver.ky.gov",
      "geocoding.geo.census.gov",
    ]);
    expect(new URL(urls[0]!).searchParams.get("where")).toBe(
      "LandmkName LIKE '%MAIN%' AND LandmkName LIKE '%STREE%' AND Post_Comm IN ('Murray','MURRAY')",
    );
    expect(env.rpcCalls).toEqual([]);
  });

  it("Takeoff access only: a Service-only user is refused; an admin and a manager pass", async () => {
    setup({ access: ["service"], technician: true });
    await expect(lookup("412 Main St, Murray, KY 42071")).rejects.toThrow(
      "Forbidden: Takeoff access required",
    );
    setup({ role: "admin" });
    expect((await lookup("412 Main St, Murray, KY 42071")).found).toBeNull();
    setup({ role: "manager" });
    expect((await lookup("412 Main St, Murray, KY 42071")).found).toBeNull();
  });

  it("the input is one address line, trimmed, 1–300 characters", () => {
    expect(lookupAddressInput.parse({ address: "  412 Main St " })).toEqual({
      address: "412 Main St",
    });
    expect(() => lookupAddressInput.parse({ address: "   " })).toThrow();
    expect(() => lookupAddressInput.parse({ address: "x".repeat(301) })).toThrow();
  });
});

describe("takeoffBuildingAt (Pick the building on the map)", () => {
  it("the state layer's outline under the tapped point, read but not stored, under Takeoff access", async () => {
    setup(TAKEOFF_USER);
    answers.Building_Footprints = () => json({ features: [footprint(KY_AT, 9000)] });
    const f = await pickAt(KY_AT);
    expect(f).toMatchObject({ id: null, how: "picked", state: "KY" });
    expect(f.footprint?.type).toBe("Polygon");
    expect(f.areaSqFt).toBeGreaterThan(8700);
    expect(env.writes).toEqual([]);
    setup({ access: ["service"] });
    await expect(pickAt(KY_AT)).rejects.toThrow("Forbidden: Takeoff access required");
  });
  it("no outline there: a plain error telling the user to zoom in", async () => {
    setup(TAKEOFF_USER);
    await expect(pickAt(KY_AT)).rejects.toThrow(
      "No building outline at that spot — zoom in and tap inside the roof",
    );
  });
});

// ── Pinned to the source ───────────────────────────────────────────────────────────────────

describe("the ticket aerial shares the lookup", () => {
  const src = read("src/lib/service-aerial.functions.ts");
  it("getTicketAerial's address step is aerialForAddress, which the takeoff calls too", () => {
    expect(src).toContain("export async function aerialForAddress(");
    const handler = src.slice(src.indexOf("export const getTicketAerial"));
    expect(handler).toContain("const byAddress = await aerialForAddress(sb, address, {");
    expect(handler).not.toContain("await locateAddress(");
    expect(src).toContain("export async function buildingAtImpl(");
    const fn = read("src/lib/takeoff-aerial.functions.ts");
    // Owner, Oct 27: the takeoff's lookup is the tolerant finder; the ticket keeps aerialForAddress.
    expect(fn).toContain("return findAddressAerial(context.supabase, data.address);");
    expect(fn).toContain(
      'if (data.point) return pointAerial(context.supabase, data.point, "picked", data.address);',
    );
    expect(fn).toContain(
      "return buildingAtImpl(context.supabase, { lat: data.lat, lng: data.lng });",
    );
    expect(
      fn.match(/assertPageAccess\(context\.supabase, context\.userId, "takeoff"\)/g),
    ).toHaveLength(2);
  });
});

describe("the New takeoff dialog's third option", () => {
  const src = read("src/components/takeoff-page.tsx");
  it('offers "From an address" beside the PDF and the screenshot', () => {
    expect(src).toContain('const TAKEOFF_SOURCES = ["pdf", "image", "address"] as const;');
    expect(src).toContain('address: "From an address",');
    expect(src).toContain('pdf: "Plan-set PDF",');
    expect(src).toContain('image: "Aerial screenshot",');
    expect(src).toContain("<AerialAddressPicker disabled={!!busy} onChange={setAerial} />");
  });
  it('"Use this picture": the imagery alone to a PNG, takeoffFromAerial, the same upload as a screenshot', () => {
    expect(src).toContain('"Use this picture"');
    expect(src).toContain("blob = await renderAerialImageryPng(sel.view, sel.sources);");
    expect(src).toContain("const { input } = takeoffFromAerial(sel.view, sel.address, {");
    expect(src).toContain("row = await createFn({ data: input });");
    expect(src).toContain('if (await upload(row, blob, "image/png")) finish(row);');
    expect(src).toContain("if (await upload(row, file, file.type)) finish(row);");
    expect(src).toContain(".upload(path, body, { contentType, upsert: true })");
    // The address option names the takeoff after the address unless a name is typed.
    expect(src).toContain(
      '"Optional. The takeoff is named after the address unless you type a name here."',
    );
  });
  it("the address panel: the state hint, Find, the imagery view with the outline, Pick the building, the no-imagery line", () => {
    const panel = read("src/components/takeoff/aerial-pick.tsx");
    expect(panel).toContain("const hint = addressStateHint(address);");
    expect(panel).toContain("{hint.hint}");
    expect(panel).toContain("lookup.mutate({ address: line });");
    // Owner, Oct 27: the accepted forms in the placeholder, the step that matched, the choice list.
    expect(panel).toContain(
      'placeholder="412 Main St, Murray, KY 42071 · Advance Auto Parts, Corbin KY · 36.9757, -84.1091 · a Google Maps link"',
    );
    expect(panel).toContain("FIND_HOW_LABELS[looked.result.how]");
    expect(panel).toContain("{candidates.map((c, i) => (");
    expect(panel).toContain("onClick={() => choose(c)}");
    expect(panel).toContain("lookup.mutate({ address: line, point: { lat: c.lat, lng: c.lng } });");
    expect(panel).toContain("<p>{NO_IMAGERY_MESSAGE}</p>");
    // Outside the imagery: no lookup; the line shows and the dialog stays open.
    expect(panel).toContain("if (hint.outside) {\n      setOutside(true);\n      return;\n    }");
    expect(panel).toContain("const nothing = outside || (looked !== null && !view);");
    expect(panel).toContain("Pick the building on the map");
    expect(panel).toContain("pickFn({ data: p })");
    expect(panel).toContain("tilesForView(view, s)");
    expect(panel).toContain("stroke={FOOTPRINT_STROKE}");
    expect(panel).toContain("onView(panView(d.view, p[0] - d.x, p[1] - d.y));");
    expect(panel).toContain('const ProspectMap = lazy(() => import("@/components/prospect-map"));');
  });
  it("the ticket's PNG renderer paints through the shared imagery painter", () => {
    const ticket = read("src/components/service/aerial-markup.tsx");
    expect(ticket).toContain(
      'import { aerialImageryCanvas, canvasToPng } from "@/lib/aerial-png";',
    );
    expect(ticket).toContain("const { canvas, ctx } = await aerialImageryCanvas(");
    expect(ticket).not.toContain("function loadTile(");
  });
});

describe("the address on the takeoff", () => {
  it("the migration adds takeoffs.source_address (nullable text) with a comment; the types carry it", () => {
    const sql = read("supabase/migrations/20261027170000_takeoff_source_address.sql");
    expect(sql).toContain(
      "alter table public.takeoffs add column if not exists source_address text;",
    );
    expect(sql).toMatch(/comment on column public\.takeoffs\.source_address is/);
    const types = read("src/integrations/supabase/types.ts");
    const t = types.slice(types.indexOf("      takeoffs: {\n        Row: {"));
    const row = t.slice(0, t.indexOf("Insert: {"));
    const insert = t.slice(t.indexOf("Insert: {"), t.indexOf("Update: {"));
    const update = t.slice(t.indexOf("Update: {"), t.indexOf("Relationships:"));
    expect(row).toContain("source_address: string | null;");
    expect(insert).toContain("source_address?: string | null;");
    expect(update).toContain("source_address?: string | null;");
  });
  it("createTakeoff stores it; Edit a copy carries it", () => {
    const fn = read("src/lib/takeoff.functions.ts");
    expect(fn).toContain(
      "source_address: z.string().trim().min(1).max(300).nullable().optional(),",
    );
    expect(fn).toContain("source_address: data.source_address ?? null,");
    const lock = read("src/lib/takeoff/lock.ts");
    expect(lock).toContain("source_address: src.source_address ?? null,");
  });
  it("shows on the list row and in the editor header", () => {
    const list = read("src/components/takeoff-page.tsx");
    expect(list).toContain("{t.source_address && (");
    expect(list).toContain('<span className="truncate">{t.source_address}</span>');
    const editor = read("src/components/takeoff/editor.tsx");
    expect(editor).toContain("{row.source_address && (");
    expect(editor).toContain('<span className="truncate">{row.source_address}</span>');
  });
});

describe("the editor opens an aerial takeoff calibrated", () => {
  it("a page with a scale is never the Scale tool's start, shows no 'No scale' prompt, and names the imagery as the scale's origin", () => {
    const editor = read("src/components/takeoff/editor.tsx");
    expect(editor).toContain(
      '!initial.pages.some((p) => p.scale)\n      ? "scale"\n      : "select"',
    );
    const viewer = read("src/components/takeoff/viewer.tsx");
    expect(viewer).toContain("{!page.scale && (");
    expect(viewer).toContain(
      '<span className="font-medium">{sheetScaleMessage(sheetInfo.note)}.</span>',
    );
    const overlay = read("src/components/takeoff/overlay.tsx");
    expect(overlay).toContain(
      'origin?.source === "sheet" ? scaleOriginLabel(origin.note) : `Scale ${feetInches(feet)}`',
    );
  });
});
