import { describe, expect, it } from "vitest";

import type { AerialView, LngLat } from "./aerial-geo";
import {
  annotationSchema,
  emptyHistory,
  legendHeight,
  legendLines,
  markupReducer,
  markupSchema,
  markupSummary,
  paintOverlay,
  parseMarkup,
  pathD,
  serializeMarkup,
  simplifyStroke,
  tagNumbers,
  type AerialMarkup,
  type Annotation,
  type Paint2D,
} from "./aerial-markup";

const at: LngLat = [-85.7585, 38.2527];
const near = (dx: number, dy: number): LngLat => [at[0] + dx * 1e-5, at[1] + dy * 1e-5];

const free: Annotation = {
  id: "f1",
  kind: "free",
  color: "red",
  points: [near(0, 0), near(1, 1), near(2, 1)],
};
const line: Annotation = {
  id: "l1",
  kind: "line",
  color: "blue",
  points: [near(0, 0), near(5, 0)],
};
const pin1: Annotation = {
  id: "p1",
  kind: "pin",
  color: "yellow",
  at: near(3, 3),
  label: "Ponding",
  note: "3 in. deep at the NE drain",
};
const pin2: Annotation = {
  id: "p2",
  kind: "pin",
  color: "red",
  at: near(6, 3),
  label: "Open seam",
  note: "",
};
const text: Annotation = { id: "t1", kind: "text", color: "white", at: near(1, 6), text: "HVAC" };

const markup: AerialMarkup = {
  v: 1,
  center: at,
  zoom: 20,
  building: {
    id: "7c3f8a4e-1b2d-4c5e-8f9a-0b1c2d3e4f5a",
    footprint: {
      type: "Polygon",
      coordinates: [[near(-10, -10), near(10, -10), near(10, 10), near(-10, 10), near(-10, -10)]],
    },
    address: "123 MAIN ST, Louisville",
    state: "KY",
    how: "address",
  },
  annotations: [free, line, pin1, text, pin2],
};

describe("annotation JSON", () => {
  it("accepts each kind and the markup as a whole", () => {
    for (const a of markup.annotations) expect(annotationSchema.safeParse(a).success).toBe(true);
    expect(markupSchema.safeParse(markup).success).toBe(true);
  });
  it("refuses colours outside the set, empty tags, a line of three points, a bad version", () => {
    expect(annotationSchema.safeParse({ ...free, color: "#123456" }).success).toBe(false);
    expect(annotationSchema.safeParse({ ...pin1, label: "  " }).success).toBe(false);
    expect(annotationSchema.safeParse({ ...pin1, label: "x".repeat(41) }).success).toBe(false);
    expect(
      annotationSchema.safeParse({ ...line, points: [near(0, 0), near(1, 1), near(2, 2)] }).success,
    ).toBe(false);
    expect(annotationSchema.safeParse({ ...free, points: [[200, 0], near(1, 1)] }).success).toBe(
      false,
    );
    expect(parseMarkup({ ...markup, v: 2 })).toBeNull();
    expect(parseMarkup(null)).toBeNull();
    expect(parseMarkup("junk")).toBeNull();
  });
  it("round-trips through JSON (what the database stores), rounded to 7 decimals", () => {
    const wobbly: AerialMarkup = {
      ...markup,
      center: [at[0] + 1.23456789e-9, at[1]],
      annotations: [{ ...free, points: [[-85.123456789, 38.1], near(1, 1)] }],
    };
    const stored = JSON.parse(JSON.stringify(serializeMarkup(wobbly))) as unknown;
    const back = parseMarkup(stored)!;
    expect(back).not.toBeNull();
    expect(back.center[0]).toBe(Math.round(at[0] * 1e7) / 1e7);
    const f = back.annotations[0]!;
    expect(f.kind === "free" && f.points[0]![0]).toBe(-85.1234568);
    expect(back.building).toEqual(markup.building);
    // A full markup survives unchanged apart from rounding.
    expect(parseMarkup(JSON.parse(JSON.stringify(serializeMarkup(markup))))).toEqual(
      serializeMarkup(markup),
    );
  });
  it("a tag's note defaults to empty", () => {
    const r = annotationSchema.parse({ id: "p", kind: "pin", color: "red", at, label: "Debris" });
    expect(r.kind === "pin" && r.note).toBe("");
  });
});

describe("undo / clear", () => {
  it("adds, undoes, clears and undoes the clear", () => {
    let h = emptyHistory();
    h = markupReducer(h, { type: "add", annotation: free });
    h = markupReducer(h, { type: "add", annotation: pin1 });
    expect(h.annotations.map((a) => a.id)).toEqual(["f1", "p1"]);
    h = markupReducer(h, { type: "undo" });
    expect(h.annotations.map((a) => a.id)).toEqual(["f1"]);
    h = markupReducer(h, { type: "add", annotation: line });
    h = markupReducer(h, { type: "clear" });
    expect(h.annotations).toEqual([]);
    h = markupReducer(h, { type: "undo" });
    expect(h.annotations.map((a) => a.id)).toEqual(["f1", "l1"]);
    h = markupReducer(h, { type: "remove", id: "f1" });
    expect(h.annotations.map((a) => a.id)).toEqual(["l1"]);
    h = markupReducer(h, { type: "undo" });
    expect(h.annotations.map((a) => a.id)).toEqual(["f1", "l1"]);
    h = markupReducer(h, { type: "undo" });
    expect(h.annotations.map((a) => a.id)).toEqual(["f1"]);
    h = markupReducer(h, { type: "undo" });
    expect(h.annotations).toEqual([]);
    // Nothing more to undo: unchanged.
    expect(markupReducer(h, { type: "undo" })).toBe(h);
  });
  it("loading saved marks starts a fresh history", () => {
    const h = markupReducer(emptyHistory([free]), { type: "load", annotations: [pin1, pin2] });
    expect(h).toEqual({ annotations: [pin1, pin2], past: [] });
  });
});

describe("strokes, tags and the legend", () => {
  it("drops points on a straight run and keeps the corners", () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0.3],
      [20, -0.2],
      [30, 0],
      [30, 10],
      [30, 20],
    ];
    expect(simplifyStroke(pts, 1.5)).toEqual([
      [0, 0],
      [30, 0],
      [30, 20],
    ]);
    expect(
      pathD([
        [1, 2],
        [3.25, 4],
      ]),
    ).toBe("M1.0 2.0 L3.3 4.0");
  });
  it("numbers tags in the order placed and lists them with their notes", () => {
    expect([...tagNumbers(markup.annotations).entries()]).toEqual([
      ["p1", 1],
      ["p2", 2],
    ]);
    expect(legendLines(markup.annotations)).toEqual([
      "1. Ponding — 3 in. deep at the NE drain",
      "2. Open seam",
    ]);
    expect(markupSummary(markup.annotations)).toBe("2 tags, 3 marks");
    expect(markupSummary([])).toBe("no marks");
    expect(legendHeight([])).toBe(0);
    expect(legendHeight(markup.annotations)).toBeGreaterThan(40);
  });
});

/** A canvas stand-in that records what is drawn. */
function recorder() {
  const calls: string[] = [];
  const texts: string[] = [];
  const ctx: Paint2D = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    lineCap: "butt",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    closePath: () => calls.push("closePath"),
    arc: () => calls.push("arc"),
    stroke: () => calls.push("stroke"),
    fill: () => calls.push("fill"),
    fillRect: () => calls.push("fillRect"),
    fillText: (t: string) => {
      calls.push("fillText");
      texts.push(t);
    },
    strokeText: () => calls.push("strokeText"),
    measureText: (t: string) => ({ width: t.length * 8 }),
  };
  return { ctx, calls, texts };
}

describe("the PNG painter (smoke)", () => {
  const view: AerialView = { center: at, zoom: 20, width: 800, height: 600 };
  it("draws the outline, every mark, the tag numbers, the caption and the legend", () => {
    const { ctx, calls, texts } = recorder();
    paintOverlay(ctx, view, markup, { caption: "123 Main St, Louisville, KY" });
    expect(calls[0]).toBe("save");
    expect(calls[calls.length - 1]).toBe("restore");
    // One closed ring for the outline.
    expect(calls.filter((c) => c === "closePath")).toHaveLength(1);
    // Two pins drawn as circles.
    expect(calls.filter((c) => c === "arc")).toHaveLength(2);
    expect(texts).toContain("1");
    expect(texts).toContain("2");
    expect(texts).toContain("Ponding");
    expect(texts).toContain("HVAC");
    const caption = texts.find((t) => t.startsWith("123 Main St"))!;
    expect(caption).toMatch(/sq ft footprint$/);
    expect(texts).toContain("1. Ponding — 3 in. deep at the NE drain");
    expect(texts).toContain("2. Open seam");
  });
  it("draws nothing but the caption-free outline when there are no marks", () => {
    const { ctx, texts, calls } = recorder();
    paintOverlay(ctx, view, { annotations: [], building: null });
    expect(texts).toEqual([]);
    expect(calls.filter((c) => c === "stroke")).toHaveLength(0);
  });
});
