/**
 * The aerial picture as a PNG (browser only: a canvas). Shared by the ticket's "Save markup"
 * (src/components/service/aerial-markup.tsx — imagery, then the marks and legend painted over
 * it) and the takeoff's "New takeoff › From an address" (owner, Oct 27 — the imagery alone, as
 * the underlay the roof is measured on). The tiles are the same `tilesForView` the screen draws,
 * so the PNG is the view pixel for pixel: a point's ground scale is `metresPerPixel` at the
 * view's zoom and latitude (src/lib/aerial-geo.ts).
 */
import { tilesForView, type AerialView, type ImagerySource } from "@/lib/aerial-geo";

/** What the canvas needs of a tile image (an HTMLImageElement, or a stand-in in tests). */
export type TileImage = CanvasImageSource;
export type TileLoader = (url: string) => Promise<TileImage | null>;

/** The ground under the imagery where no tile loads (off the cache, offline). */
export const AERIAL_GROUND = "#262626";

/** One imagery tile for the canvas, or null when it cannot be loaded (off the cache, offline). */
export function loadTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The slice of a 2D context the imagery painter uses (so a test can pass a recorder). */
export interface ImageryPaint2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: TileImage, dx: number, dy: number, dw: number, dh: number): void;
}

/**
 * Paint the view's imagery into `ctx`: the dark ground, then every source's tiles bottom to top
 * at the places and sizes `tilesForView` gives them. A tile that fails to load leaves the ground
 * showing. Tiles of one source are fetched together; sources are painted in order.
 */
export async function drawAerialImagery(
  ctx: ImageryPaint2D,
  view: AerialView,
  sources: ImagerySource[],
  load: TileLoader = loadTile,
): Promise<void> {
  ctx.fillStyle = AERIAL_GROUND;
  ctx.fillRect(0, 0, view.width, view.height);
  for (const src of sources) {
    const tiles = tilesForView(view, src);
    const imgs = await Promise.all(tiles.map((t) => load(t.url)));
    tiles.forEach((t, i) => {
      const img = imgs[i];
      if (img) ctx.drawImage(img, t.left, t.top, t.size, t.size);
    });
  }
}

/** The canvas as a PNG blob; a tainted canvas (imagery without CORS) is reported plainly. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The picture could not be made"))),
        "image/png",
      );
    } catch (e) {
      reject(
        new Error(
          `The imagery could not be copied into the picture (${e instanceof Error ? e.message : String(e)})`,
        ),
      );
    }
  });
}

/**
 * A canvas the size of the view (plus `extraHeight` below it, the ticket's legend) with the
 * imagery painted; the caller draws over it and calls `canvasToPng`.
 */
export async function aerialImageryCanvas(
  view: AerialView,
  sources: ImagerySource[],
  extraHeight = 0,
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const canvas = document.createElement("canvas");
  canvas.width = view.width;
  canvas.height = view.height + extraHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the picture");
  await drawAerialImagery(ctx, view, sources);
  return { canvas, ctx };
}

/** The view's imagery alone as a PNG — the takeoff's underlay (no outline, marks or legend). */
export async function renderAerialImageryPng(
  view: AerialView,
  sources: ImagerySource[],
): Promise<Blob> {
  const { canvas } = await aerialImageryCanvas(view, sources);
  return canvasToPng(canvas);
}
