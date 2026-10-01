import { describe, expect, it } from "vitest";

import {
  CLOSE_PX,
  TOO_FEW_HINT,
  areaLabel,
  drawing,
  emptyAreaDraw,
  labelAt,
  liveEnd,
  liveRect,
  stepArea,
  type AreaDraw,
  type AreaDrawAction,
  type Pt,
} from "./aerial-area";
import {
  M_PER_PX_Z0,
  footprintAreaSqFt,
  lngLatAreaSqFt,
  metresPerPixel,
  pixelAreaSqFt,
  unproject,
  viewAreaSqFt,
  type AerialView,
} from "./aerial-geo";

const louisville: AerialView = { center: [-85.7585, 38.2527], zoom: 20, width: 800, height: 600 };

describe("ground scale from the imagery (Web Mercator, 256-px tiles, integer zoom)", () => {
  it("metres per pixel = 156543.03392 × cos(lat) / 2^zoom", () => {
    expect(M_PER_PX_Z0).toBeCloseTo(156543.03392, 4);
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03392, 4);
    expect(metresPerPixel(0, 20)).toBeCloseTo(0.149291071, 8);
    expect(metresPerPixel(38.2527, 20)).toBeCloseTo(0.11723645, 7);
    // One zoom level in halves the ground size of a pixel.
    expect(metresPerPixel(38.2527, 19)).toBeCloseTo(2 * metresPerPixel(38.2527, 20), 12);
  });

  it("a known rectangle: 100 × 50 px on the equator at zoom 20 is 1,200 sq ft", () => {
    const rect: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    // 5000 px² × 0.149291071² m²/px² × 10.76391 = 1,199.52 sq ft.
    expect(pixelAreaSqFt(rect, 0, 20)).toBeCloseTo(1199.52, 2);
    expect(Math.round(pixelAreaSqFt(rect, 0, 20))).toBe(1200);
  });

  it("a 200 × 150 px box in the middle of a Louisville view at zoom 20 is 4,438 sq ft", () => {
    const box: Pt[] = [
      [300, 225],
      [500, 225],
      [500, 375],
      [300, 375],
    ];
    // 30000 px² × 0.11723645² × 10.76391 = 4,438.30 sq ft.
    expect(viewAreaSqFt(louisville, box)).toBeCloseTo(4438.3, 1);
    // Stored as lng/lat it reads the same at any zoom (px² × 4 per level, (m/px)² ÷ 4).
    const ll = box.map(([x, y]) => unproject(louisville, x, y));
    for (const z of [15, 18, 20, 21]) expect(Math.round(lngLatAreaSqFt(ll, z))).toBe(4438);
    // And within half a percent of the footprint's own (ellipsoidal) measure of the same ring.
    const ellipsoidal = footprintAreaSqFt([[ll]])!;
    expect(Math.abs(ellipsoidal - 4438) / 4438).toBeLessThan(0.005);
  });

  it("fewer than three corners measure nothing", () => {
    expect(
      viewAreaSqFt(louisville, [
        [0, 0],
        [10, 10],
      ]),
    ).toBe(0);
    expect(lngLatAreaSqFt([louisville.center], 20)).toBe(0);
  });
});

describe("labels", () => {
  it("rounds to the nearest sq ft with thousands separators", () => {
    expect(areaLabel(2340)).toBe("2,340 sq ft");
    expect(areaLabel(2339.6)).toBe("2,340 sq ft");
    expect(areaLabel(999.4)).toBe("999 sq ft");
    expect(areaLabel(12345678)).toBe("12,345,678 sq ft");
  });
  it("sits at the area's centroid", () => {
    expect(
      labelAt([
        [0, 0],
        [100, 0],
        [100, 50],
        [0, 50],
      ]),
    ).toEqual([50, 25]);
  });
});

/** Run inputs through the Area tool; returns the last state and every finished area. */
function run(actions: AreaDrawAction[], start: AreaDraw = emptyAreaDraw()) {
  let d = start;
  const done: Pt[][] = [];
  const hints: string[] = [];
  for (const a of actions) {
    const r = stepArea(d, a);
    d = r.draw;
    if (r.done) done.push(r.done);
    if (r.hint) hints.push(r.hint);
  }
  return { d, done, hints };
}
/** A tap (press and release on the spot) at view point p, with the screen at `scale`. */
const tap = (p: Pt, scale = 1, touch = false): AreaDrawAction[] => [
  { type: "down", p, sx: p[0] * scale, sy: p[1] * scale },
  { type: "up", p, scale, touch },
];
/** A press at a, dragged to b, released there. */
const dragTo = (a: Pt, b: Pt, scale = 1, touch = false): AreaDrawAction[] => [
  { type: "down", p: a, sx: a[0] * scale, sy: a[1] * scale },
  { type: "move", p: b, sx: b[0] * scale, sy: b[1] * scale },
  { type: "up", p: b, scale, touch },
];

describe("the Area tool (the takeoff's area drawer on the aerial)", () => {
  it("a tap places a corner; the next corners snap level / plumb within 7°", () => {
    const { d } = run([...tap([100, 100]), ...tap([200, 105]), ...tap([206, 200])]);
    // 5 px over 100 is 2.9° off level → level; 6 px over 95 is 3.6° off plumb → plumb.
    expect(d.points).toEqual([
      [100, 100],
      [200, 100],
      [200, 200],
    ]);
    expect(drawing(d)).toBe(true);
  });

  it("a side steeper than 7° keeps its angle (an angled building still draws)", () => {
    const { d } = run([...tap([0, 0]), ...tap([100, 30])]);
    expect(d.points[1]).toEqual([100, 30]);
  });

  it("square to the previous side on an angled building (relativeSnap)", () => {
    // First side at 30°; the second drawn 4° off square to it locks square.
    const a: Pt = [0, 0];
    const b: Pt = [100 * Math.cos(Math.PI / 6), 100 * Math.sin(Math.PI / 6)];
    const off = ((120 - 4) * Math.PI) / 180; // 90° + 30° − 4°
    const c: Pt = [b[0] + 80 * Math.cos(off), b[1] + 80 * Math.sin(off)];
    const { d } = run([...tap(a), ...tap(b), ...tap(c)]);
    const p = d.points[2]!;
    const side1 = [b[0] - a[0], b[1] - a[1]];
    const side2 = [p[0] - b[0], p[1] - b[1]];
    expect(side1[0]! * side2[0]! + side1[1]! * side2[1]!).toBeCloseTo(0, 6);
  });

  it("tapping the first corner closes the area", () => {
    const { d, done } = run([
      ...tap([100, 100]),
      ...tap([300, 100]),
      ...tap([300, 250]),
      ...tap([105, 104]), // within CLOSE_PX of the first corner
    ]);
    expect(done).toEqual([
      [
        [100, 100],
        [300, 100],
        [300, 250],
      ],
    ]);
    expect(d.points).toEqual([]);
    expect(drawing(d)).toBe(false);
  });

  it("a finger closes from further away than a mouse, on a phone-sized picture", () => {
    const scale = 0.45; // an 800-px view on a 360-px screen
    const corners = [...tap([100, 100], scale, true), ...tap([400, 100], scale, true)];
    const third = tap([400, 400], scale, true);
    // 30 view px = 13.5 screen px from the first corner: past a mouse's 9, inside a finger's 18.
    const near: Pt = [100, 130];
    expect(30 * scale).toBeGreaterThan(CLOSE_PX);
    expect(run([...corners, ...third, ...tap(near, scale, true)]).done).toHaveLength(1);
    expect(run([...corners, ...third, ...tap(near, scale, false)]).done).toHaveLength(0);
  });

  it("a double-click / double-tap on the last corner finishes", () => {
    const { done } = run([...tap([0, 0]), ...tap([100, 0]), ...tap([100, 80]), ...tap([100, 80])]);
    expect(done).toEqual([
      [
        [0, 0],
        [100, 0],
        [100, 80],
      ],
    ]);
  });

  it("right-click / Enter closes; with fewer than 3 corners it says so and keeps them", () => {
    const two = run([...tap([0, 0]), ...tap([100, 0]), { type: "close" }]);
    expect(two.done).toEqual([]);
    expect(two.hints).toEqual([TOO_FEW_HINT]);
    expect(two.d.points).toHaveLength(2);
    const three = run([{ type: "close" }], run([...tap([60, 90])], two.d).d);
    expect(three.done).toHaveLength(1);
    expect(three.done[0]).toHaveLength(3);
    // Nothing in progress: nothing to close, no hint.
    expect(run([{ type: "close" }]).hints).toEqual([]);
  });

  it("press-and-drag with nothing in progress draws a whole rectangle", () => {
    const live = run([
      { type: "down", p: [10, 20], sx: 10, sy: 20 },
      { type: "move", p: [110, 80], sx: 110, sy: 80 },
    ]).d;
    expect(liveRect(live, 1)).toHaveLength(4);
    expect(liveEnd(live, 1)).toEqual([110, 80]);
    const { d, done } = run(dragTo([110, 80], [10, 20]));
    expect(done).toEqual([
      [
        [10, 20],
        [110, 20],
        [110, 80],
        [10, 80],
      ],
    ]);
    expect(d.points).toEqual([]);
  });

  it("a finger holding and dragging on a phone draws the rectangle too", () => {
    const scale = 0.45;
    // 100 × 60 view px = 45 × 27 screen px.
    expect(run(dragTo([100, 100], [200, 160], scale, true)).done).toHaveLength(1);
  });

  it("a wobble under 6 screen px is a tap (one corner at the press point)", () => {
    const { d, done } = run(dragTo([50, 50], [53, 52]));
    expect(done).toEqual([]);
    expect(d.points).toEqual([[50, 50]]);
    // A drag that is wide but too thin is a tap as well.
    expect(run(dragTo([50, 50], [150, 52])).d.points).toEqual([[50, 50]]);
  });

  it("dragging after the first corner moves the live end, not a rectangle", () => {
    const { d, done } = run([...tap([0, 0]), ...dragTo([60, 3], [100, 2])]);
    expect(done).toEqual([]);
    expect(d.points).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });

  it("Esc cancels the shape in progress; Undo takes back its last corner", () => {
    const three = run([...tap([0, 0]), ...tap([100, 0]), ...tap([100, 100])]).d;
    expect(run([{ type: "undo" }], three).d.points).toEqual([
      [0, 0],
      [100, 0],
    ]);
    const cancelled = run([{ type: "cancel" }], three).d;
    expect(cancelled.points).toEqual([]);
    expect(drawing(cancelled)).toBe(false);
    // Esc in the middle of a drag drops it.
    const mid = run([
      { type: "down", p: [0, 0], sx: 0, sy: 0 },
      { type: "move", p: [90, 90], sx: 90, sy: 90 },
      { type: "cancel" },
      { type: "up", p: [90, 90], scale: 1 },
    ]);
    expect(mid.done).toEqual([]);
    expect(mid.d.points).toEqual([]);
  });

  it("a cancelled pointer (the browser took the gesture) places nothing", () => {
    const { d } = run([{ type: "down", p: [5, 5], sx: 5, sy: 5 }, { type: "lift" }]);
    expect(d.points).toEqual([]);
    expect(d.press).toBeNull();
  });

  it("the target marker follows the snapped live end and lands on the first corner to close", () => {
    const d = run([...tap([0, 0]), ...tap([100, 0]), ...tap([100, 100])]).d;
    const hover = (p: Pt) => stepArea(d, { type: "move", p, sx: p[0], sy: p[1] }).draw;
    // Square to the previous side (level here): the live end drops onto y = 100.
    const end = liveEnd(hover([3, 104]), 1)!;
    expect(end[0]).toBeCloseTo(3, 9);
    expect(end[1]).toBeCloseTo(100, 9);
    expect(liveEnd(hover([4, 3]), 1)).toBe(d.points[0]);
    expect(liveEnd(stepArea(d, { type: "leave" }).draw, 1)).toBeNull();
  });

  it("zooming mid-shape carries the corners onto the new view", () => {
    const d = run([...tap([100, 100]), ...tap([200, 100])]).d;
    const r = stepArea(d, { type: "remap", f: ([x, y]) => [x * 2 - 400, y * 2 - 300] });
    expect(r.draw.points).toEqual([
      [-200, -100],
      [0, -100],
    ]);
  });
});
