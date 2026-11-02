/**
 * The property's aerial cover picture — the server half (owner, Nov 2; the rules are in
 * aerial-cover.ts). ensureAerialCover: a property with no cover photo gets one made from our
 * aerial imagery, once: the address is looked up the way the ticket aerial looks it up
 * (aerialForAddress: our stored buildings, then the state layers), the frame is chosen around
 * the building, the tiles are fetched from the state caches and painted into one JPEG, the
 * file goes to the documents bucket as sites/<id>/aerial-<uuid>.jpg, and the row takes the
 * path (cover_photo_source 'aerial'), the point (lat / lng) and the imagery's state. A property
 * nothing is found for keeps the note and the time, and is not looked up again for
 * AERIAL_RETRY_DAYS (or until "Try the aerial again").
 *
 * Called by the property card when it has no picture (site-aerial-cover.functions.ts
 * ensureSiteAerialCover, a few at a time) and by the document editor's loader, so a document
 * made for a property no one visited still prints the building. The lookups are injectable for
 * the tests. Server only (the decoders and the JPEG encoder are server weight): the pages reach it through the
 * server functions, which import it when they run.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import jpeg from "jpeg-js";
import UPNG from "upng-js";

import type { Database } from "@/integrations/supabase/types";
import {
  AERIAL_IMAGERY_DOWN_NOTE,
  aerialCoverFileId,
  aerialDue,
  compositeTiles,
  COVER_JPEG_QUALITY,
  coverView,
  type AerialCoverResult,
  type DecodedTile,
  type PlacedTile,
  type SiteCoverSource,
} from "@/lib/aerial-cover";
import { footprintPolygons, imageryFor, tilesForView, type AerialView } from "@/lib/aerial-geo";
import type { ImagerySource } from "@/lib/aerial-geo";
import { siteAddressLine } from "@/lib/crm.functions";
import { DOCUMENTS_BUCKET } from "@/lib/documents/server-pure";
import { siteCoverPath } from "@/lib/site-photo";
import type { AddressAerial } from "@/lib/service-aerial.functions";

type Client = SupabaseClient<Database>;

const SIGNED_SECONDS = 3600;
const TILE_TIMEOUT_MS = 15_000;

/** A tile's bytes from the state cache; null when it does not answer (the ground shows). */
export async function fetchTileBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** PNG (Kentucky's cache) or JPEG (Tennessee's) → RGBA; null for anything else. */
export function decodeTile(bytes: Uint8Array): DecodedTile | null {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      // upng-js, not pngjs: the server runs on Cloudflare Workers, where pngjs's zlib call
      // throws ("Class constructor Inflate cannot be invoked without 'new'") and every
      // Kentucky tile decoded to nothing (Nov 2, the first live run). upng-js inflates itself.
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      const png = UPNG.decode(copy.buffer);
      const rgba = UPNG.toRGBA8(png)[0];
      if (!rgba) return null;
      return { width: png.width, height: png.height, data: new Uint8Array(rgba) };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const img = jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true });
      return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
    }
  } catch {
    // A broken tile leaves the ground.
  }
  return null;
}

export type TileFetcher = (url: string) => Promise<Uint8Array | null>;

/**
 * The frame's imagery as a JPEG: every source's tiles fetched together, decoded, painted bottom
 * to top. `loaded` counts the tiles that came, so a cache that is down is told from a picture.
 */
export async function renderAerialCoverJpeg(
  view: AerialView,
  sources: ImagerySource[],
  fetchTile: TileFetcher = fetchTileBytes,
): Promise<{ jpeg: Uint8Array; loaded: number; asked: number }> {
  const placed: PlacedTile[] = [];
  let loaded = 0;
  let asked = 0;
  for (const src of sources) {
    const tiles = tilesForView(view, src);
    asked += tiles.length;
    const bytes = await Promise.all(tiles.map((t) => fetchTile(t.url)));
    tiles.forEach((t, i) => {
      const b = bytes[i];
      const tile = b ? decodeTile(b) : null;
      if (tile) loaded++;
      placed.push({ left: t.left, top: t.top, size: t.size, tile });
    });
  }
  const rgba = compositeTiles(view.width, view.height, placed);
  const out = jpeg.encode(
    {
      data: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      width: view.width,
      height: view.height,
    },
    COVER_JPEG_QUALITY,
  );
  return { jpeg: new Uint8Array(out.data), loaded, asked };
}

export interface AerialCoverDeps {
  locate: (
    sb: Client,
    address: string,
    opts: { stateHint?: string | null; propertyName?: string | null },
  ) => Promise<AddressAerial>;
  fetchTile: TileFetcher;
  now: () => Date;
  uuid: () => string;
}

const defaultDeps = async (): Promise<AerialCoverDeps> => {
  const { aerialForAddress } = await import("@/lib/service-aerial.functions");
  const { randomUUID } = await import("node:crypto");
  return {
    locate: aerialForAddress,
    fetchTile: fetchTileBytes,
    now: () => new Date(),
    uuid: randomUUID,
  };
};

const SITE_COLS =
  "id, name, address1, address2, city, state, zip, deleted_at, cover_photo_path, cover_photo_source, aerial_state, aerial_tried_at, aerial_note";

async function signed(sb: Client, path: string): Promise<string | null> {
  const { data } = await sb.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_SECONDS);
  return data?.signedUrl ?? null;
}

/**
 * The property's cover picture, made from the aerial when it has none (and the lookup is due).
 * Never throws for a miss: the result's note says why; a failing database read or write does.
 */
export async function ensureAerialCover(
  sb: Client,
  siteId: string,
  deps?: Partial<AerialCoverDeps>,
): Promise<AerialCoverResult> {
  const d = { ...(await defaultDeps()), ...deps };
  const { data: site, error } = await sb
    .from("crm_sites")
    .select(SITE_COLS)
    .eq("id", siteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!site) throw new Error("Property not found");
  if (site.deleted_at) throw new Error("This property was deleted");
  const source = (site.cover_photo_source === "aerial" ? "aerial" : "photo") as SiteCoverSource;
  if (site.cover_photo_path)
    return {
      path: site.cover_photo_path,
      url: await signed(sb, site.cover_photo_path),
      source,
      state: source === "aerial" ? site.aerial_state : null,
      note: null,
    };
  const now = d.now();
  if (!aerialDue(site.aerial_tried_at, now))
    return { path: null, url: null, source: null, state: null, note: site.aerial_note };

  const miss = async (note: string): Promise<AerialCoverResult> => {
    const { error: uErr } = await sb
      .from("crm_sites")
      .update({ aerial_tried_at: now.toISOString(), aerial_note: note })
      .eq("id", site.id);
    if (uErr) throw new Error(uErr.message);
    return { path: null, url: null, source: null, state: null, note };
  };

  const address = siteAddressLine(site);
  const found = await d.locate(sb, address, { stateHint: site.state, propertyName: site.name });
  if (!found.found) return miss(found.note ?? "No building found for this address.");
  const b = found.found;
  const at: [number, number] = [b.lng, b.lat];
  const view = coverView(footprintPolygons(b.footprint), at);
  const imagery = imageryFor({ buildingState: b.state, addressState: found.addressState, at });
  const pic = await renderAerialCoverJpeg(view, imagery.sources, d.fetchTile);
  if (pic.loaded === 0) return miss(AERIAL_IMAGERY_DOWN_NOTE);

  const path = siteCoverPath(site.id, aerialCoverFileId(d.uuid()), "jpeg");
  const { error: upErr } = await sb.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, pic.jpeg, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw new Error(`Could not store the aerial: ${upErr.message}`);
  const { error: rowErr } = await sb
    .from("crm_sites")
    .update({
      cover_photo_path: path,
      cover_photo_source: "aerial",
      lat: b.lat,
      lng: b.lng,
      aerial_state: imagery.state,
      aerial_tried_at: now.toISOString(),
      aerial_note: null,
    })
    .eq("id", site.id);
  if (rowErr) {
    await sb.storage.from(DOCUMENTS_BUCKET).remove([path]);
    throw new Error(rowErr.message);
  }
  return { path, url: await signed(sb, path), source: "aerial", state: imagery.state, note: null };
}
