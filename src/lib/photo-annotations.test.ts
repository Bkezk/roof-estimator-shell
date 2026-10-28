/**
 * Marks on ticket photos (owner, Oct 1: "Ticket pictures need to be able to be annotated like
 * issues circled, text added etc, and those pictures need to be able to be exported if so
 * desired."). The pure helpers (photo-annotations.ts: schema, normalization, hit-testing, arrow
 * geometry, editing, zoom, file names, the canvas painter), the save (savePhotoAnnotations), and
 * the editor / lightbox / thumbnail / export markup and where they are mounted.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ANNOTATABLE_ROLES,
  PHOTO_COLORS,
  PHOTO_MARKS_MAX,
  ROTATIONS,
  TAP_SHAPE_FRAC,
  arrowGeom,
  arrowHeadPath,
  distToSegment,
  ellipseGeom,
  emptyPhotoHistory,
  fromNorm,
  fullView,
  hitTest,
  isAnnotatableRole,
  isMarked,
  markRows,
  marksSummary,
  moveMark,
  paintPhoto,
  paintPhotoMarks,
  panPhotoView,
  parsePhotoMarks,
  parsePhotoMarkup,
  parsePhotoRotation,
  pdfImagePlacement,
  photoColorHex,
  photoColorRgb,
  photoExt,
  photoFileName,
  photoMarksReducer,
  photoMarksSchema,
  photoOrdinals,
  rectGeom,
  rotatePoint,
  rotatedBox,
  rotationMatrix,
  rotationTransform,
  serializePhotoMarks,
  shapeFromDrag,
  strokeFor,
  textSizeFor,
  toNorm,
  turnRotation,
  unrotatePoint,
  viewZoom,
  zoomPhotoView,
  type PhotoMark,
  type PhotoPaint2D,
  type Pt,
  type Rotation,
} from "@/lib/photo-annotations";
import { savePhotoAnnotationsInput } from "@/lib/service-field.functions";

const read = (p: string) => readFileSync(p, "utf8");
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const PHOTO = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

const circle: PhotoMark = { kind: "ellipse", id: "c1", color: "red", a: [0.2, 0.2], b: [0.4, 0.6] };
const box: PhotoMark = { kind: "rect", id: "r1", color: "yellow", a: [0.6, 0.1], b: [0.9, 0.3] };
const arrow: PhotoMark = { kind: "arrow", id: "a1", color: "white", a: [0.1, 0.9], b: [0.3, 0.7] };
const text: PhotoMark = { kind: "text", id: "t1", color: "red", at: [0.5, 0.8], text: "Leak here" };
const tag: PhotoMark = {
  kind: "tag",
  id: "g1",
  color: "yellow",
  at: [0.7, 0.6],
  label: "Open seam",
  note: "6 in. at the curb",
};
const all = [circle, box, arrow, text, tag];

// ---------------------------------------------------------------------------------------------

describe("the stored schema: { v: 1, kind: 'photo', marks }", () => {
  it("every tool's mark round-trips through serialize → parse", () => {
    const stored = serializePhotoMarks(all)!;
    expect(stored.v).toBe(1);
    expect(stored.kind).toBe("photo");
    expect(photoMarksSchema.safeParse(JSON.parse(JSON.stringify(stored))).success).toBe(true);
    expect(parsePhotoMarks(JSON.parse(JSON.stringify(stored)))).toEqual(all);
  });
  it("no marks is stored as null (the row goes back to unmarked)", () => {
    expect(serializePhotoMarks([])).toBeNull();
    expect(isMarked(null)).toBe(false);
    expect(isMarked(serializePhotoMarks([circle]))).toBe(true);
  });
  it("an aerial's markup, garbage or a newer version is no photo marks (nothing drawn)", () => {
    const aerial = { v: 1, center: [-85, 38], zoom: 20, building: null, annotations: [] };
    expect(parsePhotoMarks(aerial)).toEqual([]);
    expect(parsePhotoMarks({ v: 2, kind: "photo", marks: [circle] })).toEqual([]);
    expect(parsePhotoMarks("x")).toEqual([]);
    expect(parsePhotoMarks(undefined)).toEqual([]);
  });
  it("refuses positions off the picture, unknown colours, empty words and too many marks", () => {
    const bad = (m: unknown) =>
      photoMarksSchema.safeParse({ v: 1, kind: "photo", marks: [m] }).success;
    expect(bad({ ...circle, a: [-0.1, 0.2] })).toBe(false);
    expect(bad({ ...circle, b: [0.5, 1.5] })).toBe(false);
    expect(bad({ ...circle, color: "blue" })).toBe(false);
    expect(bad({ ...text, text: "   " })).toBe(false);
    expect(bad({ ...tag, label: "" })).toBe(false);
    expect(bad({ ...circle, kind: "scribble" })).toBe(false);
    expect(
      photoMarksSchema.safeParse({
        v: 1,
        kind: "photo",
        marks: Array.from({ length: PHOTO_MARKS_MAX + 1 }, (_, i) => ({ ...circle, id: `c${i}` })),
      }).success,
    ).toBe(false);
  });
  it("colours: red (default), yellow and white", () => {
    expect(PHOTO_COLORS.map((c) => c.id)).toEqual(["red", "yellow", "white"]);
    expect(photoColorHex("red")).toBe("#ef4444");
    expect(photoColorHex("nope")).toBe("#ef4444");
    expect(photoColorRgb("white")).toEqual([1, 1, 1]);
  });
  it("only Before / After / other photos take marks", () => {
    expect([...ANNOTATABLE_ROLES]).toEqual(["before", "after", "other"]);
    expect(isAnnotatableRole("signature")).toBe(false);
    expect(isAnnotatableRole("aerial")).toBe(false);
    expect(isAnnotatableRole("before")).toBe(true);
  });
});

describe("normalized coordinates (0..1 of the picture)", () => {
  it("image px → normalized → image px round-trips within half a pixel, any size", () => {
    for (const [w, h] of [
      [2048, 1536],
      [1536, 2048],
      [640, 480],
      [4000, 3000],
    ] as const) {
      for (const p of [
        [0, 0],
        [w, h],
        [w * 0.3333, h * 0.6667],
        [123.4, 56.7],
      ] as [number, number][]) {
        const [x, y] = fromNorm(toNorm(p, w, h), w, h);
        expect(Math.abs(x - p[0])).toBeLessThanOrEqual(0.5);
        expect(Math.abs(y - p[1])).toBeLessThanOrEqual(0.5);
      }
    }
  });
  it("a point off the picture is held on its edge; values are rounded to 1e-4", () => {
    expect(toNorm([-20, 3000], 1000, 1000)).toEqual([0, 1]);
    expect(toNorm([333.33333, 1], 1000, 1000)).toEqual([0.3333, 0.001]);
    expect(serializePhotoMarks([{ ...circle, a: [0.123456789, 0.2] }])!.marks[0]).toMatchObject({
      a: [0.1235, 0.2],
    });
  });
  it("the same marks scale with the picture: stroke and lettering follow its long side", () => {
    expect(strokeFor(2048, 1536)).toBeCloseTo(12.288);
    expect(strokeFor(200, 150)).toBe(1.5); // never thinner than 1.5
    expect(textSizeFor(2048, 1536) / textSizeFor(1024, 768)).toBeCloseTo(2);
    const big = ellipseGeom(circle as never, 2000, 1000);
    const small = ellipseGeom(circle as never, 200, 100);
    expect(big.cx / small.cx).toBeCloseTo(10);
    expect(big.rx / small.rx).toBeCloseTo(10);
  });
});

describe("geometry", () => {
  it("an ellipse / box is the drag's bounding box, whichever corner it started from", () => {
    expect(ellipseGeom(circle as never, 1000, 1000)).toEqual({
      cx: 300,
      cy: 400,
      rx: 100,
      ry: 200,
    });
    const flipped = { ...box, a: box.b, b: box.a } as never;
    expect(rectGeom(flipped, 1000, 1000)).toEqual(rectGeom(box as never, 1000, 1000));
    expect(rectGeom(box as never, 1000, 1000)).toEqual({ x: 600, y: 100, w: 300, h: 200 });
  });
  it("an arrow's head is a triangle at the tip, the shaft stops at its base", () => {
    const right: PhotoMark = { kind: "arrow", id: "x", color: "red", a: [0.1, 0.5], b: [0.9, 0.5] };
    const g = arrowGeom(right as never, 1000, 1000, 10);
    expect(g.tip).toEqual([900, 500]);
    expect(g.tail).toEqual([100, 500]);
    expect(g.length).toBeCloseTo(800);
    // 4.5 strokes long, 28° half-angle: base about 39.7 px behind the tip, ±21.1 px wide.
    expect(g.base[0]).toBeCloseTo(900 - 45 * Math.cos((28 * Math.PI) / 180));
    expect(g.base[1]).toBeCloseTo(500);
    expect(g.left[1]).toBeCloseTo(500 - 45 * Math.sin((28 * Math.PI) / 180));
    expect(g.right[1]).toBeCloseTo(500 + 45 * Math.sin((28 * Math.PI) / 180));
    expect(g.left[0]).toBeCloseTo(g.base[0]);
    expect(arrowHeadPath(right as never, 1000, 1000)).toMatch(
      /^M900\.0 500\.0 L[\d.]+ [\d.]+ L[\d.]+ [\d.]+ Z$/,
    );
  });
  it("a short arrow keeps a head no longer than 60 % of itself; a zero-length one does not break", () => {
    const tiny: PhotoMark = { kind: "arrow", id: "x", color: "red", a: [0.5, 0.5], b: [0.51, 0.5] };
    const g = arrowGeom(tiny as never, 1000, 1000, 10);
    expect(Math.hypot(g.tip[0] - g.base[0], g.tip[1] - g.base[1])).toBeLessThanOrEqual(6.01);
    const zero = arrowGeom({ ...tiny, b: tiny.a } as never, 1000, 1000, 10);
    expect(zero.length).toBe(0);
    expect(Number.isFinite(zero.left[0])).toBe(true);
  });
  it("distance to a segment", () => {
    expect(distToSegment([5, 5], [0, 0], [10, 0])).toBe(5);
    expect(distToSegment([-3, 4], [0, 0], [10, 0])).toBe(5);
    expect(distToSegment([1, 1], [0, 0], [0, 0])).toBeCloseTo(Math.SQRT2);
  });
});

describe("hit-testing (the Move tool picks a mark)", () => {
  const W = 1000;
  const H = 1000;
  it("finds each kind on its line, words or pin", () => {
    expect(hitTest(all, [300, 200], W, H, 8)).toBe("c1"); // top of the ellipse
    expect(hitTest(all, [600, 200], W, H, 8)).toBe("r1"); // left side of the box
    expect(hitTest(all, [200, 800], W, H, 8)).toBe("a1"); // middle of the arrow
    expect(hitTest(all, [520, 800], W, H, 8)).toBe("t1"); // on the words
    expect(hitTest(all, [700, 600], W, H, 8)).toBe("g1"); // on the pin
  });
  it("misses empty picture; inside a circle or a box picks it when nothing is on top", () => {
    expect(hitTest(all, [50, 50], W, H, 8)).toBeNull();
    expect(hitTest(all, [300, 400], W, H, 8)).toBe("c1");
    expect(hitTest(all, [750, 200], W, H, 8)).toBe("r1");
    expect(hitTest([], [1, 1], W, H, 8)).toBeNull();
  });
  it("a line beats the inside of a circle drawn over it; the topmost wins", () => {
    const inside: PhotoMark = {
      kind: "arrow",
      id: "a2",
      color: "red",
      a: [0.25, 0.4],
      b: [0.35, 0.4],
    };
    // The circle is drawn after the arrow, yet the arrow's shaft is what is under the pointer.
    expect(hitTest([inside, circle], [300, 400], W, H, 8)).toBe("a2");
    const twin = { ...circle, id: "c2" };
    expect(hitTest([circle, twin], [300, 200], W, H, 8)).toBe("c2");
  });
  it("the tolerance is in image px (the editor passes screen px × image px per screen px)", () => {
    expect(hitTest([circle], [300, 170], W, H, 8)).toBeNull();
    expect(hitTest([circle], [300, 170], W, H, 30)).toBe("c1");
  });
});

describe("editing: add, move, remove, undo, clear", () => {
  it("add / remove / clear are undoable, in order", () => {
    let h = emptyPhotoHistory();
    h = photoMarksReducer(h, { type: "add", mark: circle });
    h = photoMarksReducer(h, { type: "add", mark: arrow });
    expect(h.marks.map((m) => m.id)).toEqual(["c1", "a1"]);
    h = photoMarksReducer(h, { type: "remove", id: "c1" });
    expect(h.marks.map((m) => m.id)).toEqual(["a1"]);
    h = photoMarksReducer(h, { type: "clear" });
    expect(h.marks).toEqual([]);
    h = photoMarksReducer(h, { type: "undo" });
    h = photoMarksReducer(h, { type: "undo" });
    expect(h.marks.map((m) => m.id)).toEqual(["c1", "a1"]);
    expect(photoMarksReducer(h, { type: "remove", id: "nope" })).toBe(h);
  });
  it("a move shifts the whole mark and is one undo step", () => {
    let h = emptyPhotoHistory([circle]);
    h = photoMarksReducer(h, { type: "move", id: "c1", du: 0.1, dv: -0.1 });
    expect(h.marks[0]).toMatchObject({ a: [0.3, 0.1], b: [0.5, 0.5] });
    expect(photoMarksReducer(h, { type: "move", id: "c1", du: 0, dv: 0 })).toBe(h);
    h = photoMarksReducer(h, { type: "undo" });
    expect(h.marks[0]).toEqual(circle);
  });
  it("a mark moved past an edge stops at the edge, keeping its shape", () => {
    const m = moveMark(circle, 5, -5);
    expect(m).toMatchObject({ a: [0.8, 0], b: [1, 0.4] });
    expect(moveMark(text, -1, 0)).toMatchObject({ at: [0, 0.8] });
  });
  it("a drag draws the shape; a tap draws a circle / box of a set size; a tap is no arrow", () => {
    expect(shapeFromDrag("ellipse", [0.1, 0.1], [0.3, 0.2], 1000, 1000, 8)).toEqual({
      a: [0.1, 0.1],
      b: [0.3, 0.2],
    });
    const tap = shapeFromDrag("rect", [0.5, 0.5], [0.501, 0.5], 1000, 1000, 8)!;
    expect(tap.a).toEqual([0.5 - TAP_SHAPE_FRAC, 0.5 - TAP_SHAPE_FRAC]);
    expect(tap.b).toEqual([0.5 + TAP_SHAPE_FRAC, 0.5 + TAP_SHAPE_FRAC]);
    expect(shapeFromDrag("arrow", [0.5, 0.5], [0.501, 0.5], 1000, 1000, 8)).toBeNull();
  });
  it("the list under the picture: one row per mark, tags numbered", () => {
    expect(markRows(all).map((r) => r.text)).toEqual([
      "Circle 1",
      "Box 1",
      "Arrow 1",
      "“Leak here”",
      "1. Open seam — 6 in. at the curb",
    ]);
    expect(marksSummary(all)).toBe("5 marks");
    expect(marksSummary([circle])).toBe("1 mark");
    expect(marksSummary([])).toBe("no marks");
  });
});

describe("zoom and pan", () => {
  it("zooms about a point, never past 6× or out of the picture, and pans within it", () => {
    const v0 = fullView(2000, 1000);
    expect(viewZoom(v0, 2000)).toBe(1);
    const v1 = zoomPhotoView(v0, 2000, 1000, 2, [500, 250]);
    expect(v1).toEqual({ x: 250, y: 125, w: 1000, h: 500 });
    expect(viewZoom(v1, 2000)).toBe(2);
    expect(viewZoom(zoomPhotoView(v1, 2000, 1000, 100), 2000)).toBeCloseTo(6);
    expect(zoomPhotoView(v1, 2000, 1000, 0.1)).toEqual(v0);
    expect(panPhotoView(v1, 2000, 1000, 10_000, 0).x).toBe(0);
    expect(panPhotoView(v1, 2000, 1000, -10_000, 0).x).toBe(1000);
    expect(panPhotoView(v1, 2000, 1000, 50, 25)).toMatchObject({ x: 200, y: 100 });
  });
});

describe("export: file names and the canvas painter", () => {
  it("<ticket number>-<role>-<n>.png, numbered per role oldest first", () => {
    const ord = photoOrdinals([
      { id: "b2", role: "before", created_at: "2026-10-01T10:05:00Z" },
      { id: "a1", role: "after", created_at: "2026-10-01T11:00:00Z" },
      { id: "b1", role: "before", created_at: "2026-10-01T10:00:00Z" },
    ]);
    expect([ord.get("b1"), ord.get("b2"), ord.get("a1")]).toEqual([1, 2, 1]);
    expect(photoFileName(6012, "before", 2)).toBe("6012-before-2.png");
    expect(photoFileName("6012.2", "after", 1, "jpg")).toBe("6012.2-after-1.jpg");
    expect(photoFileName(null, "other", 3)).toBe("ticket-other-3.png");
    expect(photoFileName("../x", "b/a d", 1)).toBe("..x-bad-1.png");
    expect(photoExt("job/123-abc.JPEG")).toBe("jpg");
    expect(photoExt("job/123-abc.png")).toBe("png");
    expect(photoExt("job/123-abc")).toBe("jpg");
  });
  it("paints every mark scaled to the canvas: ellipse, box, arrow line + head, words, tag", () => {
    const calls: string[] = [];
    const rec =
      (name: string) =>
      (...a: unknown[]) =>
        calls.push(
          `${name}(${a.map((x) => (typeof x === "number" ? Math.round(x) : x)).join(",")})`,
        );
    const ctx = {
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineJoin: "round",
      lineCap: "round",
      font: "",
      textAlign: "left",
      textBaseline: "middle",
      save: rec("save"),
      restore: rec("restore"),
      beginPath: rec("beginPath"),
      moveTo: rec("moveTo"),
      lineTo: rec("lineTo"),
      closePath: rec("closePath"),
      ellipse: rec("ellipse"),
      arc: rec("arc"),
      rect: rec("rect"),
      stroke: rec("stroke"),
      fill: rec("fill"),
      fillText: rec("fillText"),
      strokeText: rec("strokeText"),
    } as unknown as PhotoPaint2D;
    paintPhotoMarks(ctx, all, 2000, 1000);
    expect(calls).toContain("ellipse(600,400,200,200,0,0,6)");
    expect(calls).toContain("rect(1200,100,600,200)");
    expect(calls).toContain("moveTo(200,900)"); // the arrow's tail
    expect(calls).toContain("moveTo(600,700)"); // its tip (the head)
    expect(calls).toContain("fillText(Leak here,1000,800)");
    expect(calls.some((c) => c.startsWith("arc(1400,600,"))).toBe(true);
    expect(calls).toContain("fillText(1,1400,600)");
    expect(calls.some((c) => c.startsWith("fillText(Open seam,"))).toBe(true);
    expect(calls[0]).toBe("save()");
    expect(calls[calls.length - 1]).toBe("restore()");
  });
});

// ---------------------------------------------------------------------------------------------

describe("savePhotoAnnotations: validation and access", () => {
  const src = read("src/lib/service-field.functions.ts");
  const fn = serverFn(src, "savePhotoAnnotations");
  it("takes the photo, its ticket and versioned marks (or null)", () => {
    const ok = savePhotoAnnotationsInput.parse({
      id: PHOTO,
      service_job_id: JOB,
      annotations: serializePhotoMarks(all),
    });
    expect(ok.annotations?.marks).toHaveLength(5);
    expect(
      savePhotoAnnotationsInput.parse({ id: PHOTO, service_job_id: JOB, annotations: null })
        .annotations,
    ).toBeNull();
    const bad = (d: unknown) => savePhotoAnnotationsInput.safeParse(d).success;
    expect(bad({ id: "x", service_job_id: JOB, annotations: null })).toBe(false);
    expect(bad({ id: PHOTO, service_job_id: JOB })).toBe(false);
    expect(bad({ id: PHOTO, service_job_id: JOB, annotations: { v: 1, marks: [] } })).toBe(false);
    expect(
      bad({
        id: PHOTO,
        service_job_id: JOB,
        annotations: { v: 1, kind: "photo", marks: [{ ...circle, a: [2, 0] }] },
      }),
    ).toBe(false);
  });
  it("the same access as recording a photo: ownJob (Service, a tech only their own ticket)", () => {
    expect(fn).toMatch(/\.validator\(\(d: unknown\) => savePhotoAnnotationsInput\.parse\(d\)\)/);
    expect(fn).toMatch(/const job = await ownJob\(context, data\.service_job_id\)/);
    // The photo must be this ticket's, read and written by both ids.
    expect(fn.match(/\.eq\("service_job_id", job\.id\)/g)).toHaveLength(2);
    expect(fn).toMatch(/if \(!photo\) throw new Error/);
    expect(fn).toMatch(/if \(!isAnnotatableRole\(photo\.role\)\)\s*throw new Error/);
    // The marks and the rotation both come from the validated input (0 is never written).
    expect(fn).toMatch(
      /serializePhotoMarks\(\s*data\.annotations\?\.marks \?\? \[\],\s*data\.annotations\?\.rotation \?\? 0,?\s*\)/,
    );
    // Only the marks change; the stored image is never touched.
    expect(fn).toMatch(/\.update\(\{ annotations: value as unknown as Json \}\)/);
    expect(fn).not.toMatch(/storage|storage_path|upload|remove\(/);
    // ownJob is the photo rule: a technician only on their own ticket.
    const own = src.slice(src.indexOf("async function ownJob"), src.indexOf("/** Hours between"));
    expect(own).toMatch(/if \(!isOffice\(p\) && job\.technician_id !== ctx\.userId\)/);
    expect(serverFn(src, "registerJobPhoto")).toMatch(
      /await ownJob\(context, data\.service_job_id\)/,
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("the editor, lightbox, thumbnail and export", () => {
  const ui = read("src/components/service/photo-markup.tsx");
  const exp = read("src/components/service/photo-export.ts");
  const shared = read("src/components/service/field-shared.tsx");
  it("the editor's tools, colours, undo, delete, clear and zoom", () => {
    const editor = ui.slice(ui.indexOf("export function PhotoMarkupEditor"));
    for (const t of ['"Move"', '"Circle"', '"Arrow"', '"Box"', '"Text"', '"Tag"'])
      expect(ui).toContain(`label: ${t}`);
    expect(editor).toMatch(/PHOTO_COLORS\.map/);
    // Oct 28: the colour (and the tool) start from the device's remembered pen (lib/markup-memory.ts).
    expect(editor).toMatch(
      /useState<PhotoColor>\(\(\) => readMarkupMemory\(deviceStorage\(\)\)\.color\)/,
    );
    expect(editor).toMatch(/dispatch\(\{ type: "undo" \}\)/);
    expect(editor).toMatch(/dispatch\(\{ type: "remove", id: selected \}\)/);
    expect(editor).toMatch(/dispatch\(\{ type: "clear" \}\)/);
    expect(editor).toMatch(/hitTest\(history\.marks, p, W, H/);
    expect(editor).toMatch(/aria-label="Zoom in"/);
    // The view, the zoom and the pan live in the turned box (RW × RH).
    expect(editor).toMatch(/zoomPhotoView\(view, RW, RH, 2\)/);
    expect(editor).toMatch(/panPhotoView\(g\.view, RW, RH,/);
    expect(editor).toMatch(/useState<PhotoView>\(\(\) => fullView\(RW, RH\)\)/);
    // Pointer events (finger and mouse), mapped through the letterboxed viewBox.
    expect(editor).toMatch(/onPointerDown=\{down\}/);
    expect(editor).toMatch(/screenToView\(box\(\), \{ width: view\.w, height: view\.h \}/);
    expect(editor).toMatch(/touch-none/);
    // The marks listed under the picture, as on the Aerial.
    expect(editor).toMatch(/<MarkList\s+marks=\{history\.marks\}/);
  });
  it("auto-saves each change (debounced) through savePhotoAnnotations; a failure is a loud toast", () => {
    const editor = ui.slice(ui.indexOf("export function PhotoMarkupEditor"));
    expect(editor).toMatch(/useServerFn\(savePhotoAnnotations\)/);
    expect(editor).toMatch(/useAutosave</);
    expect(editor).toMatch(/autosave\.push\(next\)/);
    expect(editor).toMatch(/delay: 600/);
    // useAutosave's failure is loudError(`… did not save…`, e): the server's message.
    const utils = read("src/components/service/field-utils.ts");
    expect(utils).toMatch(/onError: \(e\) => loudError\(`\$\{what\.current\} did not save/);
    // The cached photo list takes the saved row, so the thumbnails redraw.
    expect(editor).toMatch(
      /qc\.setQueryData<JobPhotoRow\[\]>\(fieldKeys\.photos\(photo\.service_job_id\)/,
    );
  });
  it("the overlay scales the marks to the rendered picture (cover for thumbnails, contain in the lightbox)", () => {
    expect(ui).toMatch(
      /preserveAspectRatio=\{fit === "cover" \? "xMidYMid slice" : "xMidYMid meet"\}/,
    );
    expect(ui).toMatch(/viewBox=\{`0 0 \$\{w\} \$\{h\}`\}/);
    const box = ui.slice(
      ui.indexOf("export function PhotoLightbox"),
      ui.indexOf("// ── The editor"),
    );
    // The picture is RotatedPhoto (turned as kept, marks over it), fed the lightbox's own size.
    expect(box).toMatch(
      /<RotatedPhoto\s+url=\{url\}\s+alt=\{`\$\{label\} photo`\}\s+marks=\{marks\}\s+rotation=\{rotation\}\s+size=\{size\}\s+fit="contain"/,
    );
    expect(box).toMatch(/<MarkList marks=\{marks\} \/>/);
    expect(box).toMatch(/Mark up/);
    expect(box).toMatch(/const markable = canAnnotate && isAnnotatableRole\(photo\.role\)/);
    expect(box).toMatch(/Download/);
  });
  it("thumbnails draw the marks and carry a Marked badge; a tap opens the lightbox", () => {
    const thumb = shared.slice(
      shared.indexOf("export function PhotoThumb"),
      shared.indexOf("// Time entries"),
    );
    expect(thumb).toMatch(
      /<RotatedPhoto\s+url=\{url\.data\}\s+alt=\{[\s\S]*?\s+marks=\{marks\}\s+rotation=\{rotation\}\s+fit="cover"\s+className="h-full w-full"\s+loading="lazy"/,
    );
    expect(thumb).toMatch(/Marked/);
    expect(thumb).toMatch(/<PhotoLightbox/);
    expect(thumb).toMatch(/canAnnotate=\{canAnnotate\}/);
    expect(thumb).not.toMatch(/target="_blank"/);
  });
  it("export flattens the marks onto the photo at its natural size and saves <ticket>-<role>-<n>.png", () => {
    const flat = exp.slice(exp.indexOf("export async function flattenPhoto"));
    // The canvas is the turned box (sides swapped at 90 / 270); picture and marks go down together.
    expect(flat).toMatch(
      /const box = rotatedBox\(img\.naturalWidth, img\.naturalHeight, rotation\)/,
    );
    expect(flat).toMatch(/canvas\.width = box\.w;\s*canvas\.height = box\.h;/);
    expect(flat).toMatch(
      /paintPhoto\(ctx, img, img\.naturalWidth, img\.naturalHeight, marks, rotation\)/,
    );
    expect(flat).toMatch(/"image\/png"/);
    // A turned photo downloads as a PNG even without marks; an untouched one is the original file.
    expect(exp).toMatch(/if \(marks\.length \|\| rotation\)/);
    expect(exp).toMatch(/photoFileName\(ticket, photo\.role, n, "png"\)/);
    // Unmarked: the original file, untouched.
    expect(exp).toMatch(/else saveBlob\(blob, photoFileName\(ticket, photo\.role, n, photoExt/);
    const dl = ui.slice(
      ui.indexOf("export function DownloadAllPhotos"),
      ui.indexOf("// ── The lightbox"),
    );
    expect(dl).toMatch(/Download all photos/);
    expect(dl).toMatch(/for \(const \[i, p\] of sorted\.entries\(\)\)/);
    expect(dl).toMatch(/await downloadPhoto\(p, ticketNumber/);
  });
  it("mounted on the technician's close-out and the office ticket page", () => {
    const closeout = read("src/components/service/closeout.tsx");
    // Owner, Oct 9 (steps): mounted twice — step 2 (Before) and step 3 (The work).
    expect(closeout).toMatch(
      /<RepairsSection\s+jobId=\{job\.id\}\s+ticketNumber=\{job\.number\}\s+phase="before"\s+camera=\{camera\}\s*\/>/,
    );
    expect(closeout).toMatch(
      /<RepairsSection\s+jobId=\{job\.id\}\s+ticketNumber=\{job\.number\}\s+phase="work"\s+camera=\{camera\}\s*\/>/,
    );
    expect(closeout).toMatch(/canAnnotate\s+ticketNumber=\{ticketNumber\}/);
    const sections = read("src/components/service/ticket-field-sections.tsx");
    expect(sections).toMatch(/canAnnotate=\{canEdit\}/);
    expect(sections).toMatch(
      /<DownloadAllPhotos photos=\{pics\} ticketNumber=\{ticketNumber\} \/>/,
    );
    const page = read("src/components/service-page.tsx");
    expect(page).toMatch(
      /<TicketRepairs jobId=\{job\.id\} ticketNumber=\{job\.number\} canEdit=\{canEdit\} \/>/,
    );
    // The technician's one-column ticket page: the office and the ticket's own technician.
    expect(sections).toMatch(
      /const markup = canEdit \?\? \(officeOrAdmin \|\| \(!!profile && job\.technician_id === profile\.id\)\);/,
    );
    expect(sections).toMatch(
      /<RepairsReadOnly jobId=\{job\.id\} ticketNumber=\{job\.number\} canEdit=\{markup\} \/>/,
    );
  });
});

describe("the drawing surface is reusable (phase 2 of the documents, Oct 26)", () => {
  const ui = read("src/components/service/photo-markup.tsx");
  it("PhotoMarkupSurface owns the tools and the marks and reports them; the ticket editor wraps it with the autosave and Download", () => {
    const at = ui.indexOf("export function PhotoMarkupSurface(");
    expect(at).toBeGreaterThan(0);
    const surface = ui.slice(at);
    expect(surface).toMatch(/initialMarks: PhotoMark\[\];/);
    expect(surface).toMatch(/initialRotation\?: Rotation \| undefined;/);
    expect(surface).toMatch(
      /onChange\?: \(\(marks: PhotoMark\[\], rotation: Rotation\) => void\) \| undefined;/,
    );
    expect(surface).toMatch(/onDone: \(marks: PhotoMark\[\], rotation: Rotation\) => void;/);
    expect(surface).toContain("report.current?.(history.marks, history.rotation);");
    expect(surface).not.toContain("useServerFn");
    expect(surface).not.toContain("useAutosave");
    const editor = ui.slice(ui.indexOf("export function PhotoMarkupEditor("), at);
    expect(editor).toContain("<PhotoMarkupSurface");
    expect(editor).toContain("onChange={(marks, rotation) => setMarkup({ marks, rotation })}");
    expect(editor).toContain(
      "downloadPhoto(photo, ticketNumber, ordinal, markup.marks, markup.rotation)",
    );
    expect(editor).toMatch(/onDone=\{\(\) => \{\s*void autosave\.flush\(\);\s*onDone\(\);/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("rotation (owner, Oct 28: 'allow rotation of photos on markup')", () => {
  const W = 2000;
  const H = 1000;
  it("the schema takes rotation 0 / 90 / 180 / 270 and nothing else; 0 is never written", () => {
    const ok = (r: unknown) =>
      photoMarksSchema.safeParse({ v: 1, kind: "photo", marks: [circle], rotation: r }).success;
    for (const r of ROTATIONS) expect(ok(r)).toBe(true);
    expect(ok(45)).toBe(false);
    expect(ok(-90)).toBe(false);
    expect(ok("90")).toBe(false);
    expect(ok(360)).toBe(false);
    // Old JSON (no rotation) still parses and reads as not turned.
    expect(parsePhotoMarkup({ v: 1, kind: "photo", marks: [circle] })).toEqual({
      marks: [circle],
      rotation: 0,
    });
    expect(parsePhotoRotation(serializePhotoMarks([circle], 270))).toBe(270);
    expect(parsePhotoRotation(null)).toBe(0);
    expect(parsePhotoRotation({ v: 1, center: [-85, 38], zoom: 20 })).toBe(0); // an aerial
    // Written only when it is not 0: the unturned JSON is exactly what it was.
    const flat = serializePhotoMarks([circle], 0)!;
    expect(Object.keys(flat)).toEqual(["v", "kind", "marks"]);
    expect("rotation" in flat).toBe(false);
    expect(JSON.stringify(serializePhotoMarks([circle]))).toBe(JSON.stringify(flat));
    const turned = serializePhotoMarks([circle], 90)!;
    expect(turned.rotation).toBe(90);
    expect(JSON.parse(JSON.stringify(turned))).toEqual({ ...flat, rotation: 90 });
    // No marks but turned is still something to store; no marks and not turned is null.
    expect(serializePhotoMarks([], 180)).toEqual({ v: 1, kind: "photo", marks: [], rotation: 180 });
    expect(serializePhotoMarks([], 0)).toBeNull();
    // A turn alone is no "mark" (the thumbnail's Marked badge stays off).
    expect(isMarked(serializePhotoMarks([], 90))).toBe(false);
    expect(parsePhotoMarks(serializePhotoMarks([], 90))).toEqual([]);
  });
  it("a quarter turn each way wraps around; the turned box swaps its sides at 90 and 270", () => {
    expect(turnRotation(0, 1)).toBe(90);
    expect(turnRotation(270, 1)).toBe(0);
    expect(turnRotation(0, -1)).toBe(270);
    expect(turnRotation(90, -1)).toBe(0);
    expect(turnRotation(180, 1)).toBe(270);
    expect(rotatedBox(W, H, 0)).toEqual({ w: W, h: H });
    expect(rotatedBox(W, H, 90)).toEqual({ w: H, h: W });
    expect(rotatedBox(W, H, 180)).toEqual({ w: W, h: H });
    expect(rotatedBox(W, H, 270)).toEqual({ w: H, h: W });
  });
  it("a pointer in the turned view maps back into the picture, and round-trips, for all four turns", () => {
    // Clockwise: the picture's top-left corner shows top-right at 90, bottom-right at 180,
    // bottom-left at 270 — so a tap at the view's top-left is a different picture corner each time.
    expect(unrotatePoint([0, 0], W, H, 0)).toEqual([0, 0]);
    expect(unrotatePoint([0, 0], W, H, 90)).toEqual([0, H]); // the picture's bottom-left
    expect(unrotatePoint([0, 0], W, H, 180)).toEqual([W, H]); // its bottom-right
    expect(unrotatePoint([0, 0], W, H, 270)).toEqual([W, 0]); // its top-right
    // Drawn at the top-left of a 90°-turned view: stored at (0, 1) — the picture's bottom-left.
    expect(toNorm(unrotatePoint([0, 0], W, H, 90), W, H)).toEqual([0, 1]);
    // The view is H wide × W tall at 90: its far corner is the picture's top-right.
    expect(unrotatePoint([H, W], W, H, 90)).toEqual([W, 0]);
    expect(rotatePoint([0, 0], W, H, 90)).toEqual([H, 0]);
    expect(rotatePoint([W, H], W, H, 90)).toEqual([0, W]);
    const pts: Pt[] = [
      [0, 0],
      [W, H],
      [W, 0],
      [0, H],
      [123.4, 56.7],
      [W * 0.3333, H * 0.6667],
    ];
    for (const r of ROTATIONS)
      for (const p of pts) {
        const there = rotatePoint(p, W, H, r);
        const back = unrotatePoint(there, W, H, r);
        expect(back[0]).toBeCloseTo(p[0], 9);
        expect(back[1]).toBeCloseTo(p[1], 9);
        const fwd = rotatePoint(unrotatePoint(p, W, H, r), W, H, r);
        expect(fwd[0]).toBeCloseTo(p[0], 9);
        expect(fwd[1]).toBeCloseTo(p[1], 9);
        // Every mapped point lies inside the turned box.
        const box = rotatedBox(W, H, r);
        expect(there[0]).toBeGreaterThanOrEqual(-1e-9);
        expect(there[0]).toBeLessThanOrEqual(box.w + 1e-9);
        expect(there[1]).toBeGreaterThanOrEqual(-1e-9);
        expect(there[1]).toBeLessThanOrEqual(box.h + 1e-9);
      }
  });
  it("the SVG / canvas transform (shift, then a clockwise turn) moves the picture exactly as rotatePoint says", () => {
    expect(rotationTransform(W, H, 0)).toBe("");
    expect(rotationTransform(W, H, 90)).toBe("translate(1000 0) rotate(90)");
    expect(rotationTransform(W, H, 180)).toBe("translate(2000 1000) rotate(180)");
    expect(rotationTransform(W, H, 270)).toBe("translate(0 2000) rotate(270)");
    // SVG applies `translate(tx ty) rotate(deg)` as p' = T(R(p)), rotate clockwise with y down.
    const apply = (p: Pt, r: Rotation): Pt => {
      const m = rotationMatrix(W, H, r);
      const a = (m.deg * Math.PI) / 180;
      const [x, y] = p;
      return [x * Math.cos(a) - y * Math.sin(a) + m.tx, x * Math.sin(a) + y * Math.cos(a) + m.ty];
    };
    for (const r of ROTATIONS)
      for (const p of [
        [0, 0],
        [W, 0],
        [W, H],
        [0, H],
        [700, 300],
      ] as Pt[]) {
        const want = rotatePoint(p, W, H, r);
        const got = apply(p, r);
        expect(got[0]).toBeCloseTo(want[0], 6);
        expect(got[1]).toBeCloseTo(want[1], 6);
      }
  });
  it("pdfImagePlacement: the turned picture fills its box on the y-up page, turning about its own corner", () => {
    const box = { x: 48, y: 400, w: 180, h: 240 }; // a 480 × 270 picture on its side, scaled
    expect(pdfImagePlacement(box, 0)).toEqual({
      x: 48,
      y: 400,
      width: 180,
      height: 240,
      rotate: 0,
    });
    expect(pdfImagePlacement(box, 90)).toEqual({
      x: 48,
      y: 640,
      width: 240,
      height: 180,
      rotate: -90,
    });
    expect(pdfImagePlacement(box, 180)).toEqual({
      x: 228,
      y: 640,
      width: 180,
      height: 240,
      rotate: 180,
    });
    expect(pdfImagePlacement(box, 270)).toEqual({
      x: 228,
      y: 400,
      width: 240,
      height: 180,
      rotate: 90,
    });
    // pdf-lib turns the image counter-clockwise by `rotate` about (x, y): the four corners of
    // the drawn picture must span exactly the box, whichever way it is turned.
    for (const r of ROTATIONS) {
      const p = pdfImagePlacement(box, r);
      const a = (p.rotate * Math.PI) / 180;
      const corners = [
        [0, 0],
        [p.width, 0],
        [p.width, p.height],
        [0, p.height],
      ].map(([cx, cy]) => [
        p.x + cx! * Math.cos(a) - cy! * Math.sin(a),
        p.y + cx! * Math.sin(a) + cy! * Math.cos(a),
      ]);
      const xs = corners.map((c) => c[0]!);
      const ys = corners.map((c) => c[1]!);
      expect(Math.min(...xs)).toBeCloseTo(box.x, 6);
      expect(Math.max(...xs)).toBeCloseTo(box.x + box.w, 6);
      expect(Math.min(...ys)).toBeCloseTo(box.y, 6);
      expect(Math.max(...ys)).toBeCloseTo(box.y + box.h, 6);
      // The picture's own top-left (local (0, height)) lands where the clockwise turn puts it:
      // top-left at 0, top-right at 90, bottom-right at 180, bottom-left at 270.
      const tl = corners[3]!;
      const corner: Record<Rotation, Pt> = {
        0: [box.x, box.y + box.h],
        90: [box.x + box.w, box.y + box.h],
        180: [box.x + box.w, box.y],
        270: [box.x, box.y],
      };
      const want = corner[r];
      expect(tl[0]).toBeCloseTo(want[0], 6);
      expect(tl[1]).toBeCloseTo(want[1], 6);
    }
  });
  it("the editor's history: a turn is one undoable step like a mark, kept with the marks", () => {
    let h = emptyPhotoHistory([circle]);
    expect(h.rotation).toBe(0);
    h = photoMarksReducer(h, { type: "rotate", by: 1 });
    expect(h.rotation).toBe(90);
    expect(h.marks).toEqual([circle]); // the marks stay in the picture's own space
    h = photoMarksReducer(h, { type: "add", mark: arrow });
    h = photoMarksReducer(h, { type: "rotate", by: -1 });
    expect(h.rotation).toBe(0);
    expect(h.past).toHaveLength(3);
    h = photoMarksReducer(h, { type: "undo" });
    expect(h.rotation).toBe(90);
    expect(h.marks.map((m) => m.id)).toEqual(["c1", "a1"]);
    h = photoMarksReducer(h, { type: "undo" });
    expect(h.marks.map((m) => m.id)).toEqual(["c1"]);
    expect(h.rotation).toBe(90);
    h = photoMarksReducer(h, { type: "undo" });
    expect(h.rotation).toBe(0);
    expect(photoMarksReducer(h, { type: "undo" })).toBe(h);
    // Loading a saved photo brings its rotation; a clear keeps the turn.
    expect(photoMarksReducer(h, { type: "load", marks: [], rotation: 270 })).toEqual(
      emptyPhotoHistory([], 270),
    );
    const cleared = photoMarksReducer(emptyPhotoHistory([circle], 180), { type: "clear" });
    expect(cleared.marks).toEqual([]);
    expect(cleared.rotation).toBe(180);
  });
  it("paintPhoto (the export): the canvas is shifted and turned once, then the picture and its marks go down as unturned", () => {
    const calls: string[] = [];
    const rec =
      (name: string) =>
      (...a: unknown[]) =>
        calls.push(
          `${name}(${a
            .map((x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : String(x)))
            .join(",")})`,
        );
    const ctx = {
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineJoin: "round",
      lineCap: "round",
      font: "",
      textAlign: "left",
      textBaseline: "middle",
      save: rec("save"),
      restore: rec("restore"),
      beginPath: rec("beginPath"),
      moveTo: rec("moveTo"),
      lineTo: rec("lineTo"),
      closePath: rec("closePath"),
      ellipse: rec("ellipse"),
      arc: rec("arc"),
      rect: rec("rect"),
      stroke: rec("stroke"),
      fill: rec("fill"),
      fillText: rec("fillText"),
      strokeText: rec("strokeText"),
      translate: rec("translate"),
      rotate: rec("rotate"),
      drawImage: rec("drawImage"),
    } as unknown as PhotoPaint2D;
    const pic = "PICTURE" as unknown as CanvasImageSource;
    paintPhoto(ctx, pic, W, H, [circle], 90);
    expect(calls.slice(0, 4)).toEqual([
      "save()",
      "translate(1000,0)",
      `rotate(${Math.round((Math.PI / 2) * 1000) / 1000})`,
      "drawImage(PICTURE,0,0)",
    ]);
    // The ellipse at its unturned place (600, 400 on 2000 × 1000): the turn is the canvas's.
    expect(calls).toContain("ellipse(600,400,200,200,0,0,6.283)");
    expect(calls[calls.length - 1]).toBe("restore()");
    calls.length = 0;
    paintPhoto(ctx, pic, W, H, [circle], 0);
    expect(calls.slice(0, 2)).toEqual(["save()", "drawImage(PICTURE,0,0)"]);
    expect(calls.some((c) => c.startsWith("rotate("))).toBe(false);
    calls.length = 0;
    paintPhoto(ctx, pic, W, H, [], 270);
    expect(calls).toEqual([
      "save()",
      "translate(0,2000)",
      `rotate(${Math.round(((270 * Math.PI) / 180) * 1000) / 1000})`,
      "drawImage(PICTURE,0,0)",
      "save()",
      "restore()",
      "restore()",
    ]);
  });
  it("the save takes the rotation through the same validator (and refuses a bad one)", () => {
    const ok = savePhotoAnnotationsInput.parse({
      id: PHOTO,
      service_job_id: JOB,
      annotations: { v: 1, kind: "photo", marks: [], rotation: 90 },
    });
    expect(ok.annotations?.rotation).toBe(90);
    expect(
      savePhotoAnnotationsInput.safeParse({
        id: PHOTO,
        service_job_id: JOB,
        annotations: { v: 1, kind: "photo", marks: [], rotation: 45 },
      }).success,
    ).toBe(false);
    const stored = savePhotoAnnotationsInput.parse({
      id: PHOTO,
      service_job_id: JOB,
      annotations: serializePhotoMarks(all),
    });
    expect("rotation" in stored.annotations!).toBe(false);
  });
  it("the editor: Rotate left / right in the toolbar row that wraps, 44 px on a phone; the picture and marks in one turned group; the pointer turned back", () => {
    const ui = read("src/components/service/photo-markup.tsx");
    const surface = ui.slice(ui.indexOf("export function PhotoMarkupSurface("));
    const toolbar = surface.slice(
      surface.indexOf('<div className="flex flex-wrap items-center gap-2">'),
      surface.indexOf('<p className="text-xs text-muted-foreground">'),
    );
    // In the same wrapping row as the tools, the colours and Undo / Delete / Clear.
    expect(toolbar).toContain('role="group" aria-label="Tool"');
    expect(toolbar).toContain('role="group" aria-label="Rotate"');
    expect(toolbar).toMatch(
      /aria-label="Rotate left"[\s\S]*?onClick=\{\(\) => dispatch\(\{ type: "rotate", by: -1 \}\)\}[\s\S]*?<RotateCcw/,
    );
    expect(toolbar).toMatch(
      /aria-label="Rotate right"[\s\S]*?onClick=\{\(\) => dispatch\(\{ type: "rotate", by: 1 \}\)\}[\s\S]*?<RotateCw/,
    );
    expect(toolbar.match(/className="h-11 w-11 sm:h-10 sm:w-10"/g)).toHaveLength(2);
    expect(ui).toMatch(/^\s+RotateCcw,\n\s+RotateCw,/m);
    // Offered unless the caller says not to (a document's uploaded picture keeps no rotation).
    expect(toolbar).toContain("{rotatable && (");
    expect(read("src/components/documents/editor/photo-picker.tsx")).toContain(
      "rotatable={!upload}",
    );
    // The picture and the marks turn as one; the viewBox is the turned box.
    expect(surface).toContain("<g transform={rotationTransform(W, H, rotation) || undefined}>");
    expect(surface).toMatch(
      /<g transform=\{rotationTransform\(W, H, rotation\) \|\| undefined\}>\s*<image href=\{url\}[^>]*\/>\s*<MarkShapes marks=\{shown\} w=\{W\} h=\{H\} selected=\{selected\} \/>\s*<\/g>/,
    );
    expect(surface).toContain("aspectRatio: `${RW} / ${RH}`");
    expect(surface).toContain("const { w: RW, h: RH } = rotatedBox(W, H, rotation);");
    // A pointer is clamped to the turned box, then turned back into the picture before it draws.
    expect(surface).toMatch(
      /Math\.min\(RW, Math\.max\(0, view\.x \+ vx\)\),\s*Math\.min\(RH, Math\.max\(0, view\.y \+ vy\)\),\s*\];\s*return unrotatePoint\(inView, W, H, rotation\);/,
    );
    // Hit-testing, moving and the shapes stay in the picture's own px.
    expect(surface).toMatch(/hitTest\(history\.marks, p, W, H/);
    expect(surface).toMatch(/shapeFromDrag\(g\.kind, g\.a, norm\(toImg\(e\)\), W, H/);
    // A turn shows the whole turned picture again.
    expect(surface).toMatch(
      /if \(viewRotation\.current === rotation\) return;\s*viewRotation\.current = rotation;\s*setView\(fullView\(RW, RH\)\);/,
    );
    expect(surface).toContain("onDone(history.marks, history.rotation)");
    // The ticket editor autosaves the rotation with the marks (one JSON, one debounce).
    const editor = ui.slice(
      ui.indexOf("export function PhotoMarkupEditor("),
      ui.indexOf("export function PhotoMarkupSurface("),
    );
    expect(editor).toContain("const next = serializePhotoMarks(markup.marks, markup.rotation);");
    expect(editor).toContain("initialRotation={initial.rotation}");
  });
  it("every place a ticket photo shows goes through RotatedPhoto; both PDFs through drawPhoto", () => {
    const uses = (p: string, n: number) => {
      const src = read(p);
      expect(src.match(/<RotatedPhoto\b/g) ?? [], p).toHaveLength(n);
      expect(src, p).not.toMatch(/<MarksOverlay\b/);
    };
    uses("src/components/service/field-shared.tsx", 1); // PhotoThumb: ticket page, close-out, invoice fold, aerial, inspection
    uses("src/components/service/inspection-item-photos.tsx", 1); // the item picker's tiles
    uses("src/components/service/site-history.tsx", 1); // the site's history thumbnails
    uses("src/components/documents/editor/photo-picker.tsx", 2); // the document canvas and its picker
    const ui = read("src/components/service/photo-markup.tsx");
    expect(ui.match(/<RotatedPhoto\b/g)).toHaveLength(1); // the lightbox
    // No other <img> of a ticket photo is left behind in these files.
    for (const p of [
      "src/components/service/field-shared.tsx",
      "src/components/service/inspection-item-photos.tsx",
      "src/components/service/site-history.tsx",
      "src/components/documents/editor/photo-picker.tsx",
    ])
      expect(read(p).match(/<img\b/g) ?? [], p).toHaveLength(
        p.endsWith("photo-picker.tsx") ? 1 : 0, // the mark-up dialog's hidden measuring <img>
      );
    // The document's photo rows and canvas carry the rotation.
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain("const { marks, rotation } = parsePhotoMarkup(r.annotations);");
    expect(fns).toMatch(/rotation: Rotation;/);
    const picker = read("src/components/documents/editor/photo-picker.tsx");
    expect(picker).toContain("const rotation = imageRotation(image, env.photos);");
    expect(picker).toContain("annotations: serializePhotoMarks(m.marks, m.rotation),");
    // The server PDFs: the invoice's two photo places and the document's drawer all draw through drawPhoto.
    const inv = read("src/lib/invoices.server.ts");
    expect(inv.match(/drawPhoto\(doc, img, marks, \{/g)).toHaveLength(2);
    expect(inv).toContain("const shown = rotatedBox(img.width, img.height, rotation);");
    expect(inv).toMatch(/const h = Math\.min\(160, \(shown\.h \/ shown\.w\) \* w\);/);
    expect(inv).toMatch(/const scale = Math\.min\(cellW \/ shown\.w, CELL_H \/ shown\.h\);/);
    const docPdf = read("src/lib/documents/document-pdf.server.ts");
    expect(docPdf).not.toContain("drawPhotoMarks");
    expect(docPdf).toMatch(
      /drawPhoto\(\s*\{ page: this\.page, bold: this\.fonts\.bold \},\s*img\.image,\s*img\.marks,\s*box,\s*img\.rotation,?\s*\)/,
    );
    expect(docPdf).toContain("rotatedBox(img.width, img.height, markup.rotation)");
  });
});
