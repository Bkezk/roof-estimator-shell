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
  paintPhotoMarks,
  panPhotoView,
  parsePhotoMarks,
  photoColorHex,
  photoColorRgb,
  photoExt,
  photoFileName,
  photoMarksReducer,
  photoMarksSchema,
  photoOrdinals,
  rectGeom,
  serializePhotoMarks,
  shapeFromDrag,
  strokeFor,
  textSizeFor,
  toNorm,
  viewZoom,
  zoomPhotoView,
  type PhotoMark,
  type PhotoPaint2D,
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
    expect(fn).toMatch(/serializePhotoMarks\(data\.annotations\?\.marks \?\? \[\]\)/);
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
    expect(editor).toMatch(/useState<PhotoColor>\(DEFAULT_PHOTO_COLOR\)/);
    expect(editor).toMatch(/dispatch\(\{ type: "undo" \}\)/);
    expect(editor).toMatch(/dispatch\(\{ type: "remove", id: selected \}\)/);
    expect(editor).toMatch(/dispatch\(\{ type: "clear" \}\)/);
    expect(editor).toMatch(/hitTest\(history\.marks, p, W, H/);
    expect(editor).toMatch(/aria-label="Zoom in"/);
    expect(editor).toMatch(/zoomPhotoView\(view, W, H, 2\)/);
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
    expect(box).toMatch(
      /<MarksOverlay marks=\{marks\} w=\{size\.w\} h=\{size\.h\} fit="contain" \/>/,
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
      /<MarksOverlay marks=\{marks\} w=\{natural\.w\} h=\{natural\.h\} fit="cover" \/>/,
    );
    expect(thumb).toMatch(/Marked/);
    expect(thumb).toMatch(/<PhotoLightbox/);
    expect(thumb).toMatch(/canAnnotate=\{canAnnotate\}/);
    expect(thumb).not.toMatch(/target="_blank"/);
  });
  it("export flattens the marks onto the photo at its natural size and saves <ticket>-<role>-<n>.png", () => {
    const flat = exp.slice(exp.indexOf("export async function flattenPhoto"));
    expect(flat).toMatch(/canvas\.width = img\.naturalWidth/);
    expect(flat).toMatch(/ctx\.drawImage\(img, 0, 0\)/);
    expect(flat).toMatch(/paintPhotoMarks\(ctx, marks, canvas\.width, canvas\.height\)/);
    expect(flat).toMatch(/"image\/png"/);
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
    expect(closeout).toMatch(/<RepairsSection jobId=\{job\.id\} ticketNumber=\{job\.number\} \/>/);
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
