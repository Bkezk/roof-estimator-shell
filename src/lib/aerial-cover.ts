/**
 * The property's aerial cover picture (owner, Nov 2: "cant we just have it take the satellite
 * image?"). A property with no uploaded cover photo gets one made from our own aerial imagery
 * (Kentucky's KyFromAbove, Tennessee's TDOT — the tiles the ticket aerial, the takeoff and Roofs
 * & Storms draw), centred on the building the address finds, framed as the ticket aerial frames
 * it, and saved beside the property as an ordinary cover photo (crm_sites.cover_photo_path,
 * cover_photo_source 'aerial'): the document cover page, the editor's picture picker and the
 * property card read it as any photo. A picture the office uploads wins (source 'photo'). The
 * found point is kept on the property (lat / lng).
 *
 * Pure here: the frame, the pixel painter (tiles into one RGBA picture, as the browser canvas
 * does for the ticket aerial), the file name, the retry rule and the caption. The server half,
 * which looks the address up, fetches and decodes the tiles and writes the JPEG, is
 * site-aerial-cover.server.ts.
 */
import {
  footprintBounds,
  lngLatToWorld,
  worldToLngLat,
  fitZoom,
  type AerialView,
  type LngLat,
} from "@/lib/aerial-geo";

/** The picture: the ticket aerial's frame (800 × 600). */
export const COVER_W = 800;
export const COVER_H = 600;
/** Close enough to read a roof, far enough to see the building whole. */
export const COVER_MIN_ZOOM = 17;
export const COVER_MAX_ZOOM = 20;
/** A bare point (no building outline found): this close. */
export const COVER_POINT_ZOOM = 19;
/** The JPEG quality the picture is written at. */
export const COVER_JPEG_QUALITY = 85;
/** The ground where no tile loads (the ticket aerial's). */
export const COVER_GROUND: [number, number, number] = [38, 38, 38];
/** A property whose aerial was not found is looked up again after this long. */
export const AERIAL_RETRY_DAYS = 30;

/** The frame around a footprint (or a point), its zoom held between the cover's limits. */
export function coverView(polys: LngLat[][][], fallback: LngLat): AerialView {
  const b = footprintBounds(polys);
  if (!b) return { center: fallback, zoom: COVER_POINT_ZOOM, width: COVER_W, height: COVER_H };
  const z = Math.min(
    COVER_MAX_ZOOM,
    Math.max(COVER_MIN_ZOOM, fitZoom(b, COVER_W, COVER_H, { padding: 60 })),
  );
  const [x0, y0] = lngLatToWorld(b[0], b[3], z);
  const [x1, y1] = lngLatToWorld(b[2], b[1], z);
  return {
    center: worldToLngLat((x0 + x1) / 2, (y0 + y1) / 2, z),
    zoom: z,
    width: COVER_W,
    height: COVER_H,
  };
}

/** What cover_photo_path is: a photo the office uploaded (wins) or the aerial made here. */
export type SiteCoverSource = "photo" | "aerial";
/** The property's cover picture as the card and the server functions hand it over. */
export interface AerialCoverResult {
  path: string | null;
  url: string | null;
  source: SiteCoverSource | null;
  /** The imagery's state when the picture is an aerial ("KY" / "TN"). */
  state: string | null;
  /** Why there is no aerial (the note kept on the property), else null. */
  note: string | null;
}

/** A decoded tile: RGBA pixels, row-major. */
export interface DecodedTile {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A tile placed on the picture (tilesForView's left / top / size), decoded or not. */
export interface PlacedTile {
  left: number;
  top: number;
  size: number;
  tile: DecodedTile | null;
}

/**
 * The picture's pixels: the ground, then every tile at its place and size (a tile drawn larger
 * than itself — past the cache's deepest level — is stretched nearest-neighbour, as a web map
 * stretches it). Sources are painted in the order given, later over earlier. A missing tile
 * leaves the ground.
 */
export function compositeTiles(width: number, height: number, placed: PlacedTile[]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const [gr, gg, gb] = COVER_GROUND;
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = gr;
    out[i * 4 + 1] = gg;
    out[i * 4 + 2] = gb;
    out[i * 4 + 3] = 255;
  }
  for (const p of placed) {
    const t = p.tile;
    if (!t || p.size <= 0) continue;
    const left = Math.round(p.left);
    const top = Math.round(p.top);
    const size = Math.round(p.size);
    const y0 = Math.max(0, top);
    const y1 = Math.min(height, top + size);
    const x0 = Math.max(0, left);
    const x1 = Math.min(width, left + size);
    for (let y = y0; y < y1; y++) {
      const sy = Math.min(t.height - 1, Math.floor(((y - top) * t.height) / size));
      for (let x = x0; x < x1; x++) {
        const sx = Math.min(t.width - 1, Math.floor(((x - left) * t.width) / size));
        const si = (sy * t.width + sx) * 4;
        const a = t.data[si + 3]! / 255;
        if (a <= 0) continue;
        const di = (y * width + x) * 4;
        // A transparent edge (a cache's state line) lets the layer under it show.
        out[di] = Math.round(t.data[si]! * a + out[di]! * (1 - a));
        out[di + 1] = Math.round(t.data[si + 1]! * a + out[di + 1]! * (1 - a));
        out[di + 2] = Math.round(t.data[si + 2]! * a + out[di + 2]! * (1 - a));
        out[di + 3] = 255;
      }
    }
  }
  return out;
}

/** The file's base name under sites/<id>/: an aerial is told from a photo by its name too. */
export const aerialCoverFileId = (uuid: string) => `aerial-${uuid}`;
export const isAerialCoverPath = (path: string | null | undefined) =>
  !!path && /\/aerial-[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(path);

/** Look the aerial up (again)? Never tried, or tried AERIAL_RETRY_DAYS or more ago. */
export function aerialDue(triedAt: string | null | undefined, now: Date): boolean {
  if (!triedAt) return true;
  const t = Date.parse(triedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= AERIAL_RETRY_DAYS * 86_400_000;
}

/** The caption under an aerial cover: whose imagery it is. */
export function aerialCaption(state: string | null | undefined): string {
  return state === "TN" ? "Aerial · TDOT imagery" : "Aerial · KyFromAbove imagery";
}

/** What the card says when the aerial is not there and why (the note kept on the property). */
export const NO_AERIAL_PREFIX = "No aerial";
export const AERIAL_IMAGERY_DOWN_NOTE = "The imagery server did not answer; try again later.";
export const AERIAL_REMOVED_NOTE =
  "The aerial was removed; set a cover photo, or try the aerial again.";

/**
 * At most `n` of the wrapped calls run at once; the rest wait their turn (the customer page with
 * 46 properties would otherwise ask for 46 aerials at once).
 */
export function limitConcurrency(n: number): <T>(run: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(run: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        run().then(resolve, reject).finally(next);
      };
      if (active < n) start();
      else queue.push(start);
    });
}
