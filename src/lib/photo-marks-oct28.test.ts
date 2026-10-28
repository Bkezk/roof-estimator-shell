/**
 * The photo markup's Oct 28 asks (owner: "we need two more colors a blue and a black. we also
 * need to be able to rotate the shapes/textboxes and fill the textboxes with a background if we
 * want to on the markups"): the five colours and the light halo under black, the tag number's
 * colour, a mark's own turn (`rot`: schema, bounds, hit-testing, moving, the canvas painter) and
 * a text's background (`fill`), with the editor's rotate handle and Background switch and the
 * PDF painter pinned to their sources.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { drawPhotoMarks } from "@/lib/invoices.server";
import { handlePlaces, selectionBounds } from "@/lib/markup-touch";
import { readMarkupMemory, writeMarkupMemory } from "@/lib/markup-memory";
import {
  DEFAULT_PHOTO_COLOR,
  HALO,
  LIGHT_HALO,
  PHOTO_COLORS,
  canTurn,
  emptyPhotoHistory,
  fullView,
  haloFor,
  haloPdf,
  hitTest,
  markCentre,
  markFill,
  markRot,
  moveMark,
  normalizeRot,
  paintPhotoMarks,
  parsePhotoMarks,
  photoColorHex,
  photoMarkSchema,
  photoMarksReducer,
  rotateAbout,
  rotatedBounds,
  roundMark,
  serializePhotoMarks,
  snapRot,
  tagNumberColor,
  textBox,
  textFillBox,
  textFillColor,
  type PhotoMark,
  type PhotoPaint2D,
} from "@/lib/photo-annotations";

const read = (p: string) => readFileSync(p, "utf8");
const W = 2000;
const H = 1000;

/** A thin box across the middle: 800 × 20 px on 2000 × 1000, centred at (1000, 500). */
const thin: PhotoMark = { kind: "rect", id: "r", color: "red", a: [0.3, 0.49], b: [0.7, 0.51] };
const upright: PhotoMark = { ...thin, rot: 90 } as PhotoMark;
const circle: PhotoMark = { kind: "ellipse", id: "c", color: "blue", a: [0.2, 0.2], b: [0.4, 0.6] };
const arrow: PhotoMark = { kind: "arrow", id: "a", color: "white", a: [0.1, 0.9], b: [0.3, 0.7] };
const text: PhotoMark = { kind: "text", id: "t", color: "red", at: [0.5, 0.8], text: "Leak here" };
const tag: PhotoMark = {
  kind: "tag",
  id: "g",
  color: "black",
  at: [0.7, 0.6],
  label: "Seam",
  note: "",
};

const parses = (m: unknown) => photoMarkSchema.safeParse(m);

describe("colours: red, yellow, white, blue, black (owner, Oct 28)", () => {
  it("five swatches in that order with their hexes; red stays the default", () => {
    expect(PHOTO_COLORS.map((c) => c.id)).toEqual(["red", "yellow", "white", "blue", "black"]);
    expect(PHOTO_COLORS.map((c) => c.hex)).toEqual([
      "#ef4444",
      "#facc15",
      "#ffffff",
      "#3b82f6",
      "#000000",
    ]);
    expect(PHOTO_COLORS.map((c) => c.label)).toEqual(["Red", "Yellow", "White", "Blue", "Black"]);
    expect(DEFAULT_PHOTO_COLOR).toBe("red");
    expect(photoColorHex("blue")).toBe("#3b82f6");
    expect(photoColorHex("black")).toBe("#000000");
    // The schema takes them; the Aerial's green is still no photo colour.
    expect(parses({ ...circle, color: "black" }).success).toBe(true);
    expect(parses({ ...circle, color: "blue" }).success).toBe(true);
    expect(parses({ ...circle, color: "green" }).success).toBe(false);
    // The device memory accepts the new pens.
    const map = new Map<string, string>();
    const s = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    writeMarkupMemory(s, { tool: "rect", color: "black" });
    expect(readMarkupMemory(s)).toEqual({ tool: "rect", color: "black" });
    writeMarkupMemory(s, { tool: "text", color: "blue" });
    expect(readMarkupMemory(s).color).toBe("blue");
  });
  it("the halo is dark under every colour but black, which takes a light one (on screen and in the PDF)", () => {
    expect(haloFor("red")).toBe(HALO);
    expect(haloFor("red")).toBe("rgba(0,0,0,0.6)");
    expect(haloFor("yellow")).toBe(HALO);
    expect(haloFor("white")).toBe(HALO);
    expect(haloFor("blue")).toBe(HALO);
    expect(haloFor("black")).toBe(LIGHT_HALO);
    expect(haloFor("black")).toBe("rgba(255,255,255,0.75)");
    expect(haloPdf("black")).toEqual({ rgb: [1, 1, 1], alpha: 0.75 });
    expect(haloPdf("red")).toEqual({ rgb: [0, 0, 0], alpha: 0.6 });
  });
  it("the tag's number: white on red, blue and black; black on yellow and white", () => {
    expect(tagNumberColor("red")).toBe("#ffffff");
    expect(tagNumberColor("blue")).toBe("#ffffff");
    expect(tagNumberColor("black")).toBe("#ffffff");
    expect(tagNumberColor("yellow")).toBe("#000000");
    expect(tagNumberColor("white")).toBe("#000000");
  });
  it("a text's background: black behind white and yellow words, white behind red, blue and black", () => {
    expect(textFillColor("white")).toBe("#000000");
    expect(textFillColor("yellow")).toBe("#000000");
    expect(textFillColor("red")).toBe("#ffffff");
    expect(textFillColor("blue")).toBe("#ffffff");
    expect(textFillColor("black")).toBe("#ffffff");
  });
});

describe("the schema: `rot` on a circle, a box and a text; `fill` on a text", () => {
  it("takes whole degrees 0..359 on ellipse / rect / text, and drops one on an arrow or a tag", () => {
    for (const m of [circle, thin, text]) {
      const r = parses({ ...m, rot: 45 });
      expect(r.success, m.kind).toBe(true);
      expect(r.success && r.data.kind !== "arrow" && r.data.kind !== "tag" && r.data.rot).toBe(45);
      expect(parses({ ...m, rot: 0 }).success, m.kind).toBe(true);
      expect(parses({ ...m, rot: 359 }).success, m.kind).toBe(true);
      expect(parses({ ...m, rot: 360 }).success, m.kind).toBe(false);
      expect(parses({ ...m, rot: -1 }).success, m.kind).toBe(false);
      expect(parses({ ...m, rot: 12.5 }).success, m.kind).toBe(false);
    }
    // An arrow points any way already and a tag's pin is round: a `rot` on them is ignored
    // (stripped by the parse), not refused — nothing is lost from an older or odd row.
    for (const m of [arrow, tag]) {
      const r = parses({ ...m, rot: 45 });
      expect(r.success, m.kind).toBe(true);
      expect(r.success && "rot" in r.data, m.kind).toBe(false);
      expect(canTurn(m)).toBe(false);
      expect(markRot({ ...m, rot: 45 } as unknown as PhotoMark)).toBe(0);
    }
    expect(canTurn(circle)).toBe(true);
    expect(canTurn(thin)).toBe(true);
    expect(canTurn(text)).toBe(true);
  });
  it("takes `fill` on a text only (stripped elsewhere), a boolean", () => {
    const on = parses({ ...text, fill: true });
    expect(on.success && on.data.kind === "text" && on.data.fill).toBe(true);
    expect(parses({ ...text, fill: "yes" }).success).toBe(false);
    for (const m of [circle, thin, arrow, tag]) {
      const r = parses({ ...m, fill: true });
      expect(r.success, m.kind).toBe(true);
      expect(r.success && "fill" in r.data, m.kind).toBe(false);
      expect(markFill({ ...m, fill: true } as unknown as PhotoMark)).toBe(false);
    }
  });
  it("an older mark without rot / fill parses unchanged and reads as 0 / false; 0 and false are never written", () => {
    const old = [circle, thin, arrow, text, tag];
    expect(parsePhotoMarks({ v: 1, kind: "photo", marks: old })).toEqual(old);
    for (const m of old) {
      expect(markRot(m), m.kind).toBe(0);
      expect(markFill(m), m.kind).toBe(false);
    }
    // Stored: a turn of 0 and a background that is off are left out, so the JSON is as before.
    const stored = serializePhotoMarks([
      { ...thin, rot: 0 } as PhotoMark,
      { ...text, fill: false, rot: 0 } as PhotoMark,
      { ...circle, rot: 30 } as PhotoMark,
      { ...text, id: "t2", fill: true, rot: 350 } as PhotoMark,
    ])!;
    expect(stored.marks[0]).toEqual(thin);
    expect(stored.marks[1]).toEqual(text);
    expect(stored.marks[2]).toEqual({ ...circle, rot: 30 });
    expect(stored.marks[3]).toEqual({ ...text, id: "t2", fill: true, rot: 350 });
    expect(roundMark({ ...thin, rot: 360 } as PhotoMark)).toEqual(thin);
    expect(roundMark({ ...thin, rot: -90 } as PhotoMark)).toEqual({ ...thin, rot: 270 });
  });
  it("normalizeRot and the handle's 15° snap (within 4°)", () => {
    expect(normalizeRot(0)).toBe(0);
    expect(normalizeRot(360)).toBe(0);
    expect(normalizeRot(-90)).toBe(270);
    expect(normalizeRot(725)).toBe(5);
    expect(normalizeRot(44.6)).toBe(45);
    expect(normalizeRot(Number.NaN)).toBe(0);
    expect(snapRot(44)).toBe(45);
    expect(snapRot(46)).toBe(45);
    expect(snapRot(13)).toBe(15);
    expect(snapRot(8)).toBe(8); // 7° from 15 and 8° from 0: left alone
    expect(snapRot(50)).toBe(50);
    expect(snapRot(-3)).toBe(0);
    expect(snapRot(358)).toBe(0);
    expect(snapRot(272)).toBe(270);
  });
});

describe("geometry of a turned mark: about its own centre", () => {
  it("markCentre: a box's / circle's centre, a text's box centre (as drawn, one size up on a phone); none for an arrow or a tag", () => {
    expect(markCentre(thin, W, H)).toEqual([1000, 500]);
    expect(markCentre(circle, W, H)).toEqual([600, 400]);
    const b = textBox(text, W, H);
    expect(markCentre(text, W, H)).toEqual([b.x + b.w / 2, b.y + b.h / 2]);
    expect(markCentre(text, W, H, 1.25)![0]).toBeCloseTo(b.x + (b.w * 1.25) / 2);
    expect(markCentre(arrow, W, H)).toBeNull();
    expect(markCentre(tag, W, H)).toBeNull();
  });
  it("rotateAbout turns clockwise (y down); rotatedBounds is the turned corners' box", () => {
    const [x, y] = rotateAbout([1100, 500], [1000, 500], 90);
    expect(x).toBeCloseTo(1000);
    expect(y).toBeCloseTo(600); // to the right of the centre → below it, clockwise on screen
    expect(rotateAbout([1100, 500], [1000, 500], 0)).toEqual([1100, 500]);
    const b = rotatedBounds({ x: 600, y: 490, w: 800, h: 20 }, [1000, 500], 90);
    expect(b.x).toBeCloseTo(990);
    expect(b.y).toBeCloseTo(100);
    expect(b.w).toBeCloseTo(20);
    expect(b.h).toBeCloseTo(800);
  });
  it("selectionBounds of a box turned 90° swaps its width and height; 45° grows both; a text turns about its centre", () => {
    const flat = selectionBounds(thin, W, H);
    expect(flat).toEqual({ x: 600, y: 490, w: 800, h: 20 });
    const up = selectionBounds(upright, W, H);
    expect(up.w).toBeCloseTo(flat.h);
    expect(up.h).toBeCloseTo(flat.w);
    expect(up.x + up.w / 2).toBeCloseTo(1000);
    expect(up.y + up.h / 2).toBeCloseTo(500);
    const tilted = selectionBounds({ ...thin, rot: 45 } as PhotoMark, W, H);
    expect(tilted.w).toBeGreaterThan(flat.h);
    expect(tilted.w).toBeLessThan(flat.w);
    expect(tilted.h).toBeGreaterThan(flat.h);
    const t = selectionBounds({ ...text, rot: 90 } as PhotoMark, W, H);
    const tb = textBox(text, W, H);
    expect(t.w).toBeCloseTo(tb.h);
    expect(t.h).toBeCloseTo(tb.w);
    expect(t.x + t.w / 2).toBeCloseTo(tb.x + tb.w / 2);
    // Arrows and tags know no turn: their bounds are as before.
    expect(selectionBounds(arrow, W, H)).toEqual(selectionBounds({ ...arrow } as PhotoMark, W, H));
  });
  it("hit-testing follows the turned outline: a hit where it now is, a miss where it was", () => {
    // On the thin box's top edge when flat; nowhere near it once it stands upright.
    expect(hitTest([thin], [700, 490], W, H, 5)).toBe("r");
    expect(hitTest([upright], [700, 490], W, H, 5)).toBeNull();
    // Inside / on the upright box (x 990..1010, y 100..900); empty picture when flat.
    expect(hitTest([upright], [1000, 150], W, H, 5)).toBe("r");
    expect(hitTest([upright], [1008, 850], W, H, 5)).toBe("r");
    expect(hitTest([thin], [1000, 150], W, H, 5)).toBeNull();
    // The centre is on both (inside the box).
    expect(hitTest([thin], [1000, 500], W, H, 5)).toBe("r");
    expect(hitTest([upright], [1000, 500], W, H, 5)).toBe("r");
    // A turned text is hit on its turned words.
    const tb = textBox(text, W, H); // from (1000, 800), 9 chars → 432 wide, 80 tall
    const turnedText = { ...text, rot: 90 } as PhotoMark;
    const below: [number, number] = [tb.x + tb.w / 2, tb.y + tb.h / 2 + tb.w / 2 - 10];
    expect(hitTest([turnedText], below, W, H, 0)).toBe("t");
    expect(hitTest([text], below, W, H, 0)).toBeNull();
    expect(hitTest([text], [tb.x + tb.w - 10, tb.y + 5], W, H, 0)).toBe("t");
    expect(hitTest([turnedText], [tb.x + tb.w - 10, tb.y + 5], W, H, 0)).toBeNull();
  });
  it("moveMark keeps rot (and fill); the move reducer too", () => {
    const moved = moveMark(upright, 0.1, -0.1);
    expect(markRot(moved)).toBe(90);
    expect(moved).toMatchObject({ a: [0.4, 0.39], b: [0.8, 0.41], rot: 90 });
    const filled = { ...text, fill: true, rot: 30 } as PhotoMark;
    expect(moveMark(filled, 0.1, 0)).toEqual({ ...filled, at: [0.6, 0.8] });
    const h = photoMarksReducer(emptyPhotoHistory([upright]), {
      type: "move",
      id: "r",
      du: 0.1,
      dv: 0,
    });
    expect(markRot(h.marks[0]!)).toBe(90);
  });
  it("textFillBox pads the words by a quarter of the font size all round, the corners the same", () => {
    const b = textBox(text, W, H);
    const f = textFillBox(text, W, H);
    expect(f.r).toBe(b.h * 0.25);
    expect(f).toEqual({ x: b.x - 20, y: b.y - 20, w: b.w + 40, h: b.h + 40, r: 20 });
    const big = textFillBox(text, W, H, 1.25);
    expect(big.h).toBeCloseTo(100 + 50);
    expect(big.y + big.h / 2).toBeCloseTo(800); // still centred on `at`
  });
});

describe("the editor's history: a turn and a background toggle are undoable like a move", () => {
  it("turn: sets the mark's rot (normalized), one undo step; nothing for an arrow / tag or no change", () => {
    let h = emptyPhotoHistory([thin, arrow]);
    h = photoMarksReducer(h, { type: "turn", id: "r", rot: 45 });
    expect(markRot(h.marks[0]!)).toBe(45);
    expect(h.past).toHaveLength(1);
    h = photoMarksReducer(h, { type: "turn", id: "r", rot: 405 });
    expect(markRot(h.marks[0]!)).toBe(45); // the same angle: no step
    expect(h.past).toHaveLength(1);
    h = photoMarksReducer(h, { type: "turn", id: "r", rot: -90 });
    expect(markRot(h.marks[0]!)).toBe(270);
    expect(h.past).toHaveLength(2);
    expect(photoMarksReducer(h, { type: "turn", id: "a", rot: 90 })).toBe(h);
    expect(photoMarksReducer(h, { type: "turn", id: "nope", rot: 90 })).toBe(h);
    h = photoMarksReducer(h, { type: "undo" });
    expect(markRot(h.marks[0]!)).toBe(45);
    h = photoMarksReducer(h, { type: "undo" });
    expect(h.marks[0]).toEqual(thin);
    expect("rot" in h.marks[0]!).toBe(false);
    // Back to 0 drops the key (stored as before).
    h = photoMarksReducer(emptyPhotoHistory([upright]), { type: "turn", id: "r", rot: 0 });
    expect(h.marks[0]).toEqual(thin);
  });
  it("fill: on / off on a text only, one undo step each, no step when unchanged", () => {
    let h = emptyPhotoHistory([text, thin]);
    expect(photoMarksReducer(h, { type: "fill", id: "t", fill: false })).toBe(h);
    expect(photoMarksReducer(h, { type: "fill", id: "r", fill: true })).toBe(h);
    h = photoMarksReducer(h, { type: "fill", id: "t", fill: true });
    expect(markFill(h.marks[0]!)).toBe(true);
    expect(h.past).toHaveLength(1);
    h = photoMarksReducer(h, { type: "fill", id: "t", fill: false });
    expect(h.marks[0]).toEqual(text);
    expect("fill" in h.marks[0]!).toBe(false);
    expect(h.past).toHaveLength(2);
    h = photoMarksReducer(h, { type: "undo" });
    expect(markFill(h.marks[0]!)).toBe(true);
  });
  it("handlePlaces: a rotate handle at the top centre of a circle / box / text, none for an arrow or a tag; a Background toggle on a text only", () => {
    const h = handlePlaces(thin, W, H, 0, fullView(W, H));
    expect(h.rotate).toEqual({ left: 50, top: 49 });
    expect(h.fill).toBeNull();
    const up = handlePlaces(upright, W, H, 0, fullView(W, H));
    expect(up.rotate!.left).toBeCloseTo(50);
    expect(up.rotate!.top).toBeCloseTo(10);
    expect(handlePlaces(arrow, W, H, 0, fullView(W, H)).rotate).toBeNull();
    expect(handlePlaces(tag, W, H, 0, fullView(W, H)).rotate).toBeNull();
    expect(handlePlaces(tag, W, H, 0, fullView(W, H)).fill).toBeNull();
    const t = handlePlaces(text, W, H, 0, fullView(W, H));
    expect(t.rotate).not.toBeNull();
    expect(t.fill).toEqual({ left: 50, top: 76 });
  });
});

describe("the canvas painter (the download): the turn and the background", () => {
  const record = () => {
    const calls: string[] = [];
    const rec =
      (name: string) =>
      (...a: unknown[]) =>
        calls.push(
          `${name}(${a.map((x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : String(x))).join(",")})`,
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
    };
    // Styles set, in order (the halo and the colours).
    const styles: string[] = [];
    const spy = new Proxy(ctx, {
      set(target, key, value) {
        if (key === "strokeStyle" || key === "fillStyle")
          styles.push(`${String(key)}=${String(value)}`);
        (target as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    });
    return { ctx: spy as unknown as PhotoPaint2D, calls, styles };
  };
  it("a turned box: translate to its centre, rotate, translate back, the box at its unturned place", () => {
    const { ctx, calls } = record();
    paintPhotoMarks(ctx, [upright], W, H);
    const i = calls.indexOf("translate(1000,500)");
    expect(i).toBeGreaterThan(0);
    expect(calls[i + 1]).toBe(`rotate(${Math.round((Math.PI / 2) * 1000) / 1000})`);
    expect(calls[i + 2]).toBe("translate(-1000,-500)");
    expect(calls).toContain("rect(600,490,800,20)");
    expect(calls.filter((c) => c === "save()")).toHaveLength(2);
    expect(calls.filter((c) => c === "restore()")).toHaveLength(2);
    // Not turned: no rotate at all.
    const flat = record();
    paintPhotoMarks(flat.ctx, [thin, circle, arrow, text, tag], W, H);
    expect(flat.calls.some((c) => c.startsWith("rotate("))).toBe(false);
  });
  it("a text with a background: a filled rounded box (four quarter-circle corners) before the words, no halo on them", () => {
    const { ctx, calls, styles } = record();
    paintPhotoMarks(ctx, [{ ...text, fill: true } as PhotoMark], W, H);
    const fillAt = calls.indexOf("fill()");
    const wordsAt = calls.findIndex((c) => c.startsWith("fillText("));
    expect(fillAt).toBeGreaterThan(0);
    expect(fillAt).toBeLessThan(wordsAt);
    expect(calls.slice(0, fillAt).filter((c) => c.startsWith("arc("))).toHaveLength(4);
    expect(calls.some((c) => c.startsWith("strokeText("))).toBe(false);
    expect(styles).toContain("fillStyle=#ffffff"); // white behind red words
    expect(styles).toContain("fillStyle=#ef4444");
    // Without it: the words on their halo, no box.
    const plain = record();
    paintPhotoMarks(plain.ctx, [text], W, H);
    expect(plain.calls.some((c) => c.startsWith("arc("))).toBe(false);
    expect(plain.calls.some((c) => c.startsWith("strokeText("))).toBe(true);
    expect(plain.styles).toContain("strokeStyle=rgba(0,0,0,0.6)");
  });
  it("a black mark strokes on the light halo; the tag's number colour follows the rule", () => {
    const { ctx, styles } = record();
    paintPhotoMarks(
      ctx,
      [{ ...thin, color: "black" }, tag, { ...tag, id: "g2", color: "yellow" }],
      W,
      H,
    );
    expect(styles[0]).toBe("strokeStyle=rgba(255,255,255,0.75)");
    expect(styles[1]).toBe("strokeStyle=#000000");
    // The black tag's number is white; the yellow tag's black.
    const fills = styles.filter((s) => s.startsWith("fillStyle="));
    expect(fills).toContain("fillStyle=#ffffff");
    expect(fills).toContain("fillStyle=#000000");
  });
});

describe("the PDF painter (invoices.server.ts drawPhotoMarks)", () => {
  async function streams(bytes: Uint8Array): Promise<string> {
    const doc = await PDFDocument.load(bytes);
    const out: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const filter = obj.dict.get(PDFName.of("Filter"));
      try {
        out.push(
          (filter === PDFName.of("FlateDecode")
            ? inflateSync(Buffer.from(obj.contents))
            : Buffer.from(obj.contents)
          ).toString("latin1"),
        );
      } catch {
        /* an image */
      }
    }
    return out.join("\n");
  }
  it("turns a box, a circle and a text about their centres (a rotation cm), fills a text's background, keeps a flat box's path", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const box = { x: 48, y: 400, w: 240, h: 180 };
    const marks: PhotoMark[] = [
      upright,
      { ...circle, rot: 45 } as PhotoMark,
      { ...text, rot: 30, fill: true } as PhotoMark,
      thin,
    ];
    expect(drawPhotoMarks({ page, bold }, marks, box)).toBe(4);
    const ops = await streams(await doc.save());
    // A quarter turn (cos 90° ≈ 0, sin ±1) and a 45° one (cos = sin = 0.7071) as transforms.
    expect(ops).toMatch(/\S+ -1 1 \S+ 0 0 cm/);
    expect(ops).toMatch(/0\.7071\d* -0\.7071\d* 0\.7071\d* 0\.7071\d* 0 0 cm/);
    // The flat thin box: 0.3..0.7 × 0.49..0.51 of 240 × 180 = 96 × 3.6 points, its bottom-left at (120, 488.2).
    expect(ops).toMatch(
      /1 0 0 1 120 488\.2 cm\n(?:1 0 0 1 0 0 cm\n)*0 0 m\n0 3\.5999\d* l\n96 3\.5999\d* l\n96 0 l\nh\n/,
    );
    // The background: a filled path with curved corners (c) and the words after it; the band's
    // translucent rectangle is not drawn for that text.
    expect(ops).toMatch(/c\n[\s\S]*?h\nf\n/);
    expect(ops).toContain("<4C65616B2068657265> Tj"); // "Leak here", hex-encoded
  });
  it("source: a mark's rot is pdf-lib's rotate: degrees(-rot); the fill is a solid rounded box; the halo is haloPdf", () => {
    const src = read("src/lib/invoices.server.ts");
    const painter = src.slice(src.indexOf("export function drawPhotoMarks("));
    expect(painter).toContain("deg: degrees(-rot),");
    expect(painter).toContain("...(rot ? { rotate: degrees(-rot) } : {}),");
    expect(painter).toMatch(
      /page\.drawRectangle\(\{\s*\.\.\.at,\s*borderColor: color, borderWidth: sw \}\)/,
    );
    expect(painter).toContain(
      "page.drawSvgPath(roundedBoxPath(tw + 2 * pad, size + 2 * pad, pad), {",
    );
    expect(painter).toContain("fill: markFill(m) ? rgb(...hexRgb(textFillColor(m.color))) : null,");
    expect(painter).toContain("const h = haloPdf(m.color);");
    expect(painter).toContain("color: rgb(...hexRgb(tagNumberColor(m.color))),");
    expect(src).toContain(
      "function roundedBoxPath(w: number, h: number, radius: number): string {",
    );
  });
});

describe("the editor (photo-markup.tsx): the rotate handle, the Background toggle and switch, five swatches", () => {
  const src = read("src/components/service/photo-markup.tsx");
  const surface = src.slice(src.indexOf("export function PhotoMarkupSurface("));
  it("a third handle, rotate, over a circle / box / text: a drag turns the mark (snapRot) and is one undoable 'turn'", () => {
    expect(surface).toContain('data-handle="rotate"');
    expect(surface).toMatch(/\{handles\.rotate && \([\s\S]*?data-handle="rotate"/);
    expect(surface).toContain('<RotateCw className="h-3 w-3" aria-hidden />');
    expect(surface).toContain("spin(e, selectedMark);");
    expect(surface).toContain("snapRot(g.rot0 + angleFrom(g.c, p) - g.start);");
    expect(surface).toContain('dispatch({ type: "turn", id: g.id, rot: spinRot(g, toImg(e)) });');
    expect(surface).toContain(
      'else if (g.type === "spin") setSpinning({ id: g.id, rot: spinRot(g, p) });',
    );
    // Finger-sized like the grip and the ×, lifted above the mark's top centre.
    expect(surface.match(/width: handle\.hit,\s*height: handle\.hit,/g)).toHaveLength(4);
    expect(surface).toMatch(/data-handle="rotate"[\s\S]*?-translate-x-1\/2 -translate-y-full/);
    // The turn shows as the finger goes round.
    expect(surface).toContain(
      "if (spinning && m.id === spinning.id && canTurn(m)) return { ...m, rot: spinning.rot };",
    );
  });
  it("Background: a toggle beside a selected text's handles (aria-pressed) and a switch in the text form; both undoable / stored", () => {
    expect(surface).toContain('data-handle="fill"');
    expect(surface).toContain('aria-label="Background"');
    expect(surface).toContain("aria-pressed={markFill(selectedMark)}");
    expect(surface).toContain(
      'dispatch({ type: "fill", id: selectedMark.id, fill: !markFill(selectedMark) })',
    );
    expect(surface).toMatch(/\{handles\.fill && selectedMark\.kind === "text" && \(/);
    const form = src.slice(src.indexOf("function PlaceForm("));
    expect(form).toContain(
      '<Switch id="photo-mark-fill" checked={fill} onCheckedChange={setFill} />',
    );
    expect(form).toMatch(/<Label htmlFor="photo-mark-fill"[^>]*>\s*Background\s*<\/Label>/);
    expect(form).toContain('{kind === "text" && (');
    expect(form).toContain(
      'onAdd({ label: label.trim(), note: note.trim(), fill: kind === "text" && fill });',
    );
    expect(surface).toContain(
      ': { ...base, kind: "text", text: f.label, ...(f.fill ? { fill: true } : {}) },',
    );
  });
  it("the SVG draws the turn (rotate about the centre), the background box, the per-colour halo and the tag number's colour", () => {
    const shapes = src.slice(
      src.indexOf("export function MarkShapes("),
      src.indexOf("function SelectionBox("),
    );
    expect(shapes).toContain("return c ? `rotate(${rot} ${c[0]} ${c[1]})` : undefined;");
    expect(shapes).toContain("const halo = haloFor(m.color);");
    expect(shapes).toContain('data-fill="text"');
    expect(shapes).toContain("fill={textFillColor(m.color)}");
    expect(shapes).toContain("fill={tagNumberColor(m.color)}");
    expect(shapes).toContain("style={fb ? undefined : { ...words, stroke: halo }}");
    // The five swatches, 44 px each, from PHOTO_COLORS.
    expect(surface).toMatch(
      /\{PHOTO_COLORS\.map\(\(c\) => \([\s\S]*?className=\{`h-11 w-11 rounded-full/,
    );
  });
});
