/**
 * The property's aerial cover picture (owner, Nov 2: "cant we just have it take the satellite
 * image?"): migration 20261102210000, aerial-cover.ts (the frame, the painter, the rules) and
 * site-aerial-cover.server.ts (the lookup, the tiles, the file, the row), the photo functions'
 * source, saveSite's address rule, the document loader's hook and the card. Fails on the old
 * code: no modules, no columns, no hooks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { readGeneratedTypes } from "@/test/generated-types";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  AERIAL_REMOVED_NOTE,
  AERIAL_RETRY_DAYS,
  aerialCaption,
  aerialCoverFileId,
  aerialDue,
  compositeTiles,
  COVER_H,
  COVER_MAX_ZOOM,
  COVER_MIN_ZOOM,
  COVER_POINT_ZOOM,
  COVER_W,
  coverView,
  isAerialCoverPath,
  limitConcurrency,
} from "@/lib/aerial-cover";
import { addressChanged, saveSite } from "@/lib/crm.functions";
import {
  decodeTile,
  ensureAerialCover,
  renderAerialCoverJpeg,
} from "@/lib/site-aerial-cover.server";
import { clearSiteCoverPhoto, setSiteCoverPhoto } from "@/lib/site-photo.functions";
import { fakeSupabase } from "@/test/fake-supabase";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const OFFICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SITE = "11111111-1111-4111-8111-111111111111";
const profiles = [
  {
    id: OFFICE,
    role: "user",
    access: ["customers", "service"],
    technician: false,
    full_name: "Olive",
    email: "o@x",
  },
];
const call = <T>(fn: unknown, data: Row, db: unknown, userId = OFFICE) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: db, userId },
  });

/** A solid-colour tile as PNG or JPEG bytes. */
const pngTile = (w: number, h: number, rgb: [number, number, number], alpha = 255) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = alpha;
  }
  return new Uint8Array(PNG.sync.write(png));
};
const jpegTile = (w: number, h: number, rgb: [number, number, number]) => {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return new Uint8Array(jpeg.encode({ data, width: w, height: h }, 95).data);
};
const px = (rgba: Uint8Array, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
};

describe("the migration", () => {
  const sql = (() => {
    try {
      return flat("supabase/migrations/20261102210000_site_aerial_cover.sql");
    } catch {
      return "";
    }
  })();
  it("the six columns, the source and state checks", () => {
    expect(sql).toContain(
      "add column if not exists cover_photo_source text not null default 'photo'",
    );
    for (const c of [
      "lat double precision",
      "lng double precision",
      "aerial_state text",
      "aerial_tried_at timestamptz",
      "aerial_note text",
    ])
      expect(sql).toContain(`add column if not exists ${c}`);
    expect(sql).toContain("check (cover_photo_source in ('photo', 'aerial'))");
    expect(sql).toContain("check (aerial_state is null or aerial_state in ('KY', 'TN'))");
  });
  it("the generated types carry them", () => {
    const t = readGeneratedTypes();
    const i = t.indexOf("\n      crm_sites: {");
    const block = t.slice(i, t.indexOf("Relationships: [", i));
    for (const c of [
      "cover_photo_source: string;",
      "lat: number | null;",
      "lng: number | null;",
      "aerial_state: string | null;",
      "aerial_tried_at: string | null;",
      "aerial_note: string | null;",
    ])
      expect(block).toContain(c);
  });
});

describe("the frame", () => {
  it("a footprint: fitted, the zoom held between the limits; a point: COVER_POINT_ZOOM", () => {
    const tiny = coverView(
      [
        [
          [
            [-84.505, 38.0405],
            [-84.5049, 38.0405],
            [-84.5049, 38.0404],
            [-84.505, 38.0404],
            [-84.505, 38.0405],
          ],
        ],
      ],
      [-84.5, 38],
    );
    expect(tiny.zoom).toBe(COVER_MAX_ZOOM);
    expect([tiny.width, tiny.height]).toEqual([COVER_W, COVER_H]);
    const huge = coverView(
      [
        [
          [
            [-84.6, 38.1],
            [-84.4, 38.1],
            [-84.4, 37.9],
            [-84.6, 37.9],
            [-84.6, 38.1],
          ],
        ],
      ],
      [-84.5, 38],
    );
    expect(huge.zoom).toBe(COVER_MIN_ZOOM);
    const point = coverView([], [-86.78, 36.16]);
    expect(point).toEqual({
      center: [-86.78, 36.16],
      zoom: COVER_POINT_ZOOM,
      width: COVER_W,
      height: COVER_H,
    });
    // A building-sized box lands in between, centred on the box.
    const bldg = coverView(
      [
        [
          [
            [-84.505, 38.0455],
            [-84.502, 38.0455],
            [-84.502, 38.0435],
            [-84.505, 38.0435],
            [-84.505, 38.0455],
          ],
        ],
      ],
      [0, 0],
    );
    expect(bldg.zoom).toBeGreaterThanOrEqual(COVER_MIN_ZOOM);
    expect(bldg.zoom).toBeLessThanOrEqual(COVER_MAX_ZOOM);
    expect(bldg.center[0]).toBeCloseTo(-84.5035, 3);
    expect(bldg.center[1]).toBeCloseTo(38.0445, 3);
  });
});

describe("the painter", () => {
  it("the ground, a tile at its place, a stretched tile nearest-neighbour, a later tile over an earlier, a transparent tile letting the one under show", () => {
    const red = {
      width: 2,
      height: 2,
      data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    };
    const blue = { width: 1, height: 1, data: new Uint8Array([0, 0, 255, 255]) };
    const half = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 128]) };
    const out = compositeTiles(6, 4, [
      { left: 0, top: 0, size: 4, tile: red }, // 2×2 drawn at 4×4: each pixel becomes 2×2
      { left: 4, top: 0, size: 1, tile: blue },
      { left: 5, top: 0, size: 1, tile: null },
      { left: 4, top: 1, size: 1, tile: blue },
      { left: 4, top: 1, size: 1, tile: half }, // over the blue: white at half strength
      { left: 5, top: 3, size: 3, tile: blue }, // off the edge: clipped, no throw
    ]);
    expect(px(out, 6, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 6, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(out, 6, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(px(out, 6, 0, 2)).toEqual([0, 0, 255, 255]);
    expect(px(out, 6, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(px(out, 6, 4, 0)).toEqual([0, 0, 255, 255]);
    expect(px(out, 6, 5, 0)).toEqual([38, 38, 38, 255]);
    expect(px(out, 6, 4, 1)).toEqual([128, 128, 255, 255]);
    expect(px(out, 6, 5, 3)).toEqual([0, 0, 255, 255]);
    expect(px(out, 6, 5, 2)).toEqual([38, 38, 38, 255]);
  });
  it("decodeTile: PNG (Kentucky's cache) and JPEG (Tennessee's); anything else null", () => {
    const p = decodeTile(pngTile(2, 1, [10, 20, 30]))!;
    expect([p.width, p.height, ...p.data.slice(0, 4)]).toEqual([2, 1, 10, 20, 30, 255]);
    const j = decodeTile(jpegTile(2, 2, [200, 100, 50]))!;
    expect([j.width, j.height]).toEqual([2, 2]);
    expect(Math.abs(j.data[0]! - 200)).toBeLessThan(8);
    expect(decodeTile(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("renderAerialCoverJpeg: every source's tiles fetched, painted, a JPEG the frame's size; loaded counts what came", async () => {
    const { KY_SOURCE, TN_SOURCE, tilesForView } = await import("@/lib/aerial-geo");
    const view = {
      center: [-88.3148, 36.6103] as [number, number],
      zoom: 19,
      width: 64,
      height: 48,
    };
    const asked: string[] = [];
    const r = await renderAerialCoverJpeg(view, [TN_SOURCE, KY_SOURCE], async (url) => {
      asked.push(url);
      return url.includes("tnmap") ? jpegTile(256, 256, [0, 0, 200]) : null;
    });
    const tn = tilesForView(view, TN_SOURCE);
    const ky = tilesForView(view, KY_SOURCE);
    expect(asked).toEqual([...tn, ...ky].map((t) => t.url));
    expect(r.asked).toBe(tn.length + ky.length);
    expect(r.loaded).toBe(tn.length);
    const img = jpeg.decode(Buffer.from(r.jpeg), { useTArray: true });
    expect([img.width, img.height]).toEqual([64, 48]);
    expect(img.data[2]).toBeGreaterThan(150);
  });
});

describe("the rules", () => {
  it("file name and path; due after AERIAL_RETRY_DAYS; the caption", () => {
    expect(aerialCoverFileId("abc")).toBe("aerial-abc");
    expect(isAerialCoverPath("sites/x/aerial-abc.jpg")).toBe(true);
    expect(isAerialCoverPath("sites/x/abc.jpg")).toBe(false);
    const now = new Date("2026-11-02T12:00:00Z");
    expect(aerialDue(null, now)).toBe(true);
    expect(aerialDue("2026-11-01T12:00:00Z", now)).toBe(false);
    expect(
      aerialDue(new Date(now.getTime() - AERIAL_RETRY_DAYS * 86_400_000).toISOString(), now),
    ).toBe(true);
    expect(aerialDue("junk", now)).toBe(true);
    expect(aerialCaption("KY")).toBe("Aerial · KyFromAbove imagery");
    expect(aerialCaption("TN")).toBe("Aerial · TDOT imagery");
  });
  it("limitConcurrency: at most n at once, the rest in turn, results kept", async () => {
    const turn = limitConcurrency(2);
    let active = 0;
    let peak = 0;
    const job = (v: number) =>
      turn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return v;
      });
    expect(await Promise.all([job(1), job(2), job(3), job(4), job(5)])).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    await expect(
      turn(async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(await turn(async () => 9)).toBe(9);
  });
});

describe("ensureAerialCover (the server)", () => {
  const siteRow = (extra: Row = {}): Row => ({
    id: SITE,
    account_id: ACC,
    name: "Rupp Arena",
    address1: "430 W Vine St",
    address2: null,
    city: "Lexington",
    state: "KY",
    zip: "40507",
    deleted_at: null,
    cover_photo_path: null,
    cover_photo_source: "photo",
    lat: null,
    lng: null,
    aerial_state: null,
    aerial_tried_at: null,
    aerial_note: null,
    ...extra,
  });
  const found = {
    address: "430 W Vine St, Lexington, KY 40507",
    addressState: "KY" as const,
    found: {
      id: "b1",
      footprint: {
        type: "Polygon",
        coordinates: [
          [
            [-84.505, 38.0455],
            [-84.502, 38.0455],
            [-84.502, 38.0435],
            [-84.505, 38.0435],
            [-84.505, 38.0455],
          ],
        ],
      },
      address: "430 W Vine St, Lexington",
      state: "KY" as const,
      how: "address" as const,
      lat: 38.0445,
      lng: -84.5035,
      areaSqFt: 100000,
    },
    note: null,
    near: null,
  };
  const deps = (locate: unknown, tile: Uint8Array | null = pngTile(256, 256, [90, 120, 60])) => ({
    locate: locate as never,
    fetchTile: async () => tile,
    now: () => new Date("2026-11-02T15:00:00Z"),
    uuid: () => "u-1",
  });
  it("no cover: looks the address up, paints the tiles, stores sites/<id>/aerial-u-1.jpg and the row", async () => {
    const env = fakeSupabase({ profiles, crm_sites: [siteRow()] });
    const locate = vi.fn(async () => found);
    const r = await ensureAerialCover(env.db, SITE, deps(locate));
    expect(locate).toHaveBeenCalledWith(env.db, "430 W Vine St, Lexington, KY 40507", {
      stateHint: "KY",
      propertyName: "Rupp Arena",
    });
    expect(r).toMatchObject({
      path: `sites/${SITE}/aerial-u-1.jpg`,
      source: "aerial",
      state: "KY",
      note: null,
    });
    expect(env.uploads).toEqual([
      { bucket: "documents", path: `sites/${SITE}/aerial-u-1.jpg`, upsert: false },
    ]);
    const bytes = env.objects[`sites/${SITE}/aerial-u-1.jpg`]!;
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    const img = jpeg.decode(Buffer.from(bytes), { useTArray: true });
    expect([img.width, img.height]).toEqual([COVER_W, COVER_H]);
    expect(env.tables["crm_sites"]![0]).toMatchObject({
      cover_photo_path: `sites/${SITE}/aerial-u-1.jpg`,
      cover_photo_source: "aerial",
      lat: 38.0445,
      lng: -84.5035,
      aerial_state: "KY",
      aerial_tried_at: "2026-11-02T15:00:00.000Z",
      aerial_note: null,
    });
  });
  it("a cover already there (a photo or an aerial): handed back, nothing looked up or written", async () => {
    const env = fakeSupabase({
      profiles,
      crm_sites: [siteRow({ cover_photo_path: `sites/${SITE}/p.jpg` })],
    });
    const locate = vi.fn(async () => found);
    const r = await ensureAerialCover(env.db, SITE, deps(locate));
    expect(r).toMatchObject({ path: `sites/${SITE}/p.jpg`, source: "photo", state: null });
    expect(locate).not.toHaveBeenCalled();
    expect(env.writes).toEqual([]);
    expect(env.uploads).toEqual([]);
  });
  it("nothing found: the note and the time kept, no file; not looked up again inside AERIAL_RETRY_DAYS; due again after", async () => {
    const env = fakeSupabase({ profiles, crm_sites: [siteRow()] });
    const locate = vi.fn(async () => ({
      ...found,
      found: null,
      note: "No building or 911 address point in our map data matches this address.",
    }));
    const r = await ensureAerialCover(env.db, SITE, deps(locate));
    expect(r).toMatchObject({
      path: null,
      source: null,
      note: "No building or 911 address point in our map data matches this address.",
    });
    expect(env.uploads).toEqual([]);
    expect(env.tables["crm_sites"]![0]).toMatchObject({
      aerial_tried_at: "2026-11-02T15:00:00.000Z",
      aerial_note: r.note,
      cover_photo_path: null,
    });
    const again = await ensureAerialCover(env.db, SITE, deps(locate));
    expect(again.note).toBe(r.note);
    expect(locate).toHaveBeenCalledTimes(1);
    const later = { ...deps(locate), now: () => new Date("2026-12-03T15:00:00Z") };
    await ensureAerialCover(env.db, SITE, later);
    expect(locate).toHaveBeenCalledTimes(2);
  });
  it("the imagery server down (no tile came): a note, no file, no row path", async () => {
    const env = fakeSupabase({ profiles, crm_sites: [siteRow()] });
    const r = await ensureAerialCover(
      env.db,
      SITE,
      deps(async () => found, null),
    );
    expect(r.path).toBeNull();
    expect(r.note).toBe("The imagery server did not answer; try again later.");
    expect(env.uploads).toEqual([]);
  });
  it("a deleted property is refused", async () => {
    const env = fakeSupabase({
      profiles,
      crm_sites: [siteRow({ deleted_at: "2026-10-01T00:00:00Z" })],
    });
    await expect(
      ensureAerialCover(
        env.db,
        SITE,
        deps(async () => found),
      ),
    ).rejects.toThrow("This property was deleted");
  });
});

describe("a photo wins; removing; the address", () => {
  const site = (extra: Row = {}): Row => ({
    id: SITE,
    account_id: ACC,
    name: "Rupp Arena",
    address1: "430 W Vine St",
    address2: null,
    city: "Lexington",
    state: "KY",
    zip: "40507",
    deleted_at: null,
    cover_photo_path: `sites/${SITE}/aerial-u-1.jpg`,
    cover_photo_source: "aerial",
    aerial_tried_at: "2026-11-02T15:00:00Z",
    aerial_note: null,
    ...extra,
  });
  it("setSiteCoverPhoto over an aerial: source 'photo'", async () => {
    const env = fakeSupabase(
      { profiles, crm_sites: [site()] },
      { objects: { [`sites/${SITE}/aerial-u-1.jpg`]: new Uint8Array([1]) } },
    );
    const png = Buffer.from(pngTile(2, 2, [1, 2, 3])).toString("base64");
    const r = await call<Row>(setSiteCoverPhoto, { siteId: SITE, bytesBase64: png }, env.db);
    expect(String(r["path"])).toMatch(/^sites\/.*\.png$/);
    expect(env.tables["crm_sites"]![0]).toMatchObject({
      cover_photo_source: "photo",
      cover_photo_path: r["path"],
    });
  });
  it("clearSiteCoverPhoto on an aerial: not made again (the removed note, the time); on a photo: the aerial may come", async () => {
    const env = fakeSupabase({ profiles, crm_sites: [site()] });
    await call(clearSiteCoverPhoto, { siteId: SITE }, env.db);
    expect(env.tables["crm_sites"]![0]).toMatchObject({
      cover_photo_path: null,
      cover_photo_source: "photo",
      aerial_note: AERIAL_REMOVED_NOTE,
    });
    expect(env.tables["crm_sites"]![0]!["aerial_tried_at"]).not.toBe("2026-11-02T15:00:00Z");
    const env2 = fakeSupabase({
      profiles,
      crm_sites: [site({ cover_photo_source: "photo", cover_photo_path: `sites/${SITE}/p.jpg` })],
    });
    await call(clearSiteCoverPhoto, { siteId: SITE }, env2.db);
    expect(env2.tables["crm_sites"]![0]).toMatchObject({
      cover_photo_path: null,
      aerial_tried_at: null,
      aerial_note: null,
    });
  });
  it("addressChanged: any part, case and blanks aside; a part left out is unchanged", () => {
    const before = {
      address1: "430 W Vine St",
      address2: null,
      city: "Lexington",
      state: "KY",
      zip: "40507",
    };
    expect(addressChanged(before, { address1: "430 w vine st " })).toBe(false);
    expect(addressChanged(before, { zip: "40508" })).toBe(true);
    expect(addressChanged(before, { address2: "" })).toBe(false);
    expect(addressChanged(before, { name: "x" } as never)).toBe(false);
  });
  it("saveSite with a new address drops the aerial (the file too) so the next visit makes a new one; the same address keeps it", async () => {
    const env = fakeSupabase(
      { profiles, crm_accounts: [{ id: ACC, deleted_at: null }], crm_sites: [site()] },
      { objects: { [`sites/${SITE}/aerial-u-1.jpg`]: new Uint8Array([1]) } },
    );
    const same = await call<Row>(
      saveSite,
      {
        id: SITE,
        account_id: ACC,
        name: "Rupp Arena",
        address1: "430 W Vine St",
        city: "Lexington",
        state: "KY",
        zip: "40507",
      },
      env.db,
    );
    expect(same["cover_photo_path"]).toBe(`sites/${SITE}/aerial-u-1.jpg`);
    const moved = await call<Row>(
      saveSite,
      {
        id: SITE,
        account_id: ACC,
        name: "Rupp Arena",
        address1: "1 Other Rd",
        city: "Lexington",
        state: "KY",
        zip: "40507",
      },
      env.db,
    );
    expect(moved).toMatchObject({
      cover_photo_path: null,
      aerial_tried_at: null,
      aerial_note: null,
      address1: "1 Other Rd",
    });
    expect(env.objects[`sites/${SITE}/aerial-u-1.jpg`]).toBeUndefined();
  });
});

describe("the address finder (shared with the ticket aerial): a different town is not the address", () => {
  it("200 E Main St, Lexington is not Scottsville's 200 E Main St (no zip on that row); the zip can say it is the same place", async () => {
    const { parseStreetAddress, scoreAddress, pickAddressMatch } =
      await import("@/lib/aerial-address");
    const target = parseStreetAddress("200 E Main St, Lexington, KY 40507")!;
    const scottsville = {
      source: "building" as const,
      id: "s",
      address: "200 E MAIN ST",
      city: "SCOTTSVILLE",
      zip: null,
      lat: 36.7528,
      lng: -86.1892,
      building_id: "s",
    };
    expect(scoreAddress(target, scottsville)).toBeNull();
    expect(pickAddressMatch(target, [scottsville])).toEqual({ outcome: "none" });
    // The same town: still scored, the city adding its 2.
    expect(scoreAddress(target, { ...scottsville, city: "Lexington" })).toBe(6.5);
    // Another name for the same place (the zip agrees): kept.
    expect(scoreAddress(target, { ...scottsville, city: "Fayette", zip: "40507" })).toBe(6.5);
    // No city on the row: as before (neither helped nor ruled out), the zip deciding.
    expect(scoreAddress(target, { ...scottsville, city: null, zip: "40507" })).toBe(7.5);
  });
});

describe("the server runs on Cloudflare Workers", () => {
  it("decodes PNG with upng-js, never pngjs (its zlib call throws there: every Kentucky tile decoded to nothing on the first live run)", () => {
    const src = read("src/lib/site-aerial-cover.server.ts");
    expect(src).toContain('import UPNG from "upng-js";');
    expect(src).not.toContain('from "pngjs"');
    expect(src).toContain("UPNG.toRGBA8(png)[0]");
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies["upng-js"]).toBeTruthy();
    expect(pkg.dependencies["jpeg-js"]).toBeTruthy();
    expect(pkg.dependencies["pngjs"]).toBeUndefined();
  });
  it("the card says plainly when the server could not make the aerial, with Try the aerial again", () => {
    const card = read("src/components/crm/property-sites.tsx");
    expect(card).toContain("data-cover-error");
    expect(card).toContain("Could not make the aerial: {errText(cover.error).slice(0, 120)}");
    expect(card).toContain("{!has && (note || cover.isError) && !cover.isPending && (");
  });
});

describe("the document loader and the card", () => {
  it("documents: a property with no cover gets its aerial made when the editor opens", () => {
    const src = read("src/lib/documents.functions.ts");
    expect(src).toContain(
      'const { ensureAerialCover } = await import("@/lib/site-aerial-cover.server");',
    );
    expect(src).toContain("const made = await ensureAerialCover(sb, site.id);");
  });
  it("the card: takes the row, asks a few at a time, captions an aerial, Set a photo / Remove / Try the aerial again", () => {
    const src = read("src/components/crm/property-sites.tsx");
    expect(src).toContain(
      "export function SiteCoverPhoto({ site, canEdit }: { site: SiteCoverSite; canEdit: boolean })",
    );
    expect(src).toContain("const aerialTurn = limitConcurrency(2);");
    expect(src).toContain("aerialTurn(() => ensureFn({ data: { siteId } }))");
    expect(src).toContain("{aerialCaption(c.state)}");
    expect(src).toContain('{isAerial && has ? "Set a photo" : coverButtonLabel(has)}');
    expect(src).toContain('data-action="retry-aerial"');
    expect(src).toContain("data-cover-making");
    expect(read("src/components/customers-page.tsx")).toContain(
      "<SiteCoverPhoto site={s} canEdit={!readOnly} />",
    );
    expect(read("src/components/property-page.tsx")).toContain(
      "<SiteCoverPhoto site={s} canEdit={!deleted} />",
    );
  });
});
