/**
 * The aerial PNG's imagery painter (src/lib/aerial-png.ts), shared by the ticket's "Save markup"
 * and the takeoff's "From an address" (owner, Oct 27): the ground, then every tile of every source
 * at the place and size `tilesForView` gives it, a tile that fails to load leaving the ground.
 * Through a recording context and a stand-in tile loader (no canvas in node).
 */
import { describe, expect, it } from "vitest";

import { KY_SOURCE, TN_SOURCE, tilesForView, type AerialView } from "./aerial-geo";
import { AERIAL_GROUND, drawAerialImagery, type ImageryPaint2D } from "./aerial-png";

const view: AerialView = { center: [-88.3148, 36.6103], zoom: 19, width: 800, height: 600 };

function recorder() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const ctx: ImageryPaint2D = {
    fillStyle: "",
    fillRect: (...args) => calls.push({ op: "fillRect", args: [ctx.fillStyle, ...args] }),
    drawImage: (img, ...args) => calls.push({ op: "drawImage", args: [img, ...args] }),
  };
  return { ctx, calls };
}

describe("drawAerialImagery", () => {
  it("paints the dark ground, then each source's tiles where tilesForView places them", async () => {
    const { ctx, calls } = recorder();
    const loaded: string[] = [];
    await drawAerialImagery(ctx, view, [TN_SOURCE, KY_SOURCE], async (url) => {
      loaded.push(url);
      return { url } as unknown as CanvasImageSource;
    });
    expect(calls[0]).toEqual({ op: "fillRect", args: [AERIAL_GROUND, 0, 0, 800, 600] });
    const tn = tilesForView(view, TN_SOURCE);
    const ky = tilesForView(view, KY_SOURCE);
    expect(loaded).toEqual([...tn, ...ky].map((t) => t.url));
    const drawn = calls.filter((c) => c.op === "drawImage");
    expect(drawn).toHaveLength(tn.length + ky.length);
    [...tn, ...ky].forEach((t, i) => {
      expect(drawn[i]!.args).toEqual([{ url: t.url }, t.left, t.top, t.size, t.size]);
    });
  });
  it("a tile that does not load leaves the ground showing (no drawImage for it)", async () => {
    const { ctx, calls } = recorder();
    const tiles = tilesForView(view, KY_SOURCE);
    const bad = tiles[0]!.url;
    await drawAerialImagery(ctx, view, [KY_SOURCE], async (url) =>
      url === bad ? null : ({ url } as unknown as CanvasImageSource),
    );
    const drawn = calls.filter((c) => c.op === "drawImage");
    expect(drawn).toHaveLength(tiles.length - 1);
    expect(drawn.some((c) => (c.args[0] as { url: string }).url === bad)).toBe(false);
  });
  it("no sources: only the ground", async () => {
    const { ctx, calls } = recorder();
    await drawAerialImagery(ctx, view, [], async () => null);
    expect(calls).toEqual([{ op: "fillRect", args: [AERIAL_GROUND, 0, 0, 800, 600] }]);
  });
});
