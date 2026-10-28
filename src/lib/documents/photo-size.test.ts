/**
 * The picture size on the photo-carrying modules (owner, Oct 28: "on the generate inspection
 * report we need to be able to resize the photo on the document editor" — and, the owner
 * clarified, on every ticket and bid document: the setting is the module's, whatever template the
 * document came from). Full Photo has had `heightIn` since Oct 26; Photo on left / right, Two
 * Photos, Photo Grid and Repair List take `photoHeightIn` the same way. The schema, the helper
 * that never writes 0 / undefined, the PDF layout placing the picture at the asked height, and
 * the editor's control on every one of those modules.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type DocModule,
  moduleSchema,
  newModule,
  PHOTO_HEIGHT_MAX,
  PHOTO_SIZE_PRESETS,
  type PhotoGridModule,
  photoHeightOf,
  type PhotoTextModule,
  PICTURE_MODULE_TYPES,
  PT_PER_IN,
  type RepairListModule,
  richFromText,
  type TwoPhotosModule,
  withPhotoHeight,
} from "./model";
import {
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  GRID_BOX_RATIO,
  GRID_GUTTER,
  type LayoutContext,
  layoutModule,
  layoutPhotoGrid,
  layoutRepairList,
  type Piece,
  REPAIR_THUMB_HEIGHT,
  REPAIR_THUMB_WIDTH,
  repairThumbBox,
  TWO_PHOTOS_HEIGHT,
} from "./pdf-layout";
import { type InspectionSnapshot, variableLabel } from "./variables";

const read = (p: string) => readFileSync(p, "utf8");
const moduleView = read("src/components/documents/editor/module-view.tsx");

const measure = (text: string, _font: unknown, size: number) => text.length * size * 0.5;
const img = {
  kind: "upload" as const,
  path: "docs/a.jpg",
  width: 1600,
  height: 1200,
  name: "a.jpg",
};
const PHOTO = "11111111-1111-4111-8111-111111111111";
const ctx = (over: Partial<LayoutContext> = {}): LayoutContext => ({
  width: CONTENT_WIDTH,
  measure,
  vars: {},
  labelOf: variableLabel,
  // Landscape 4:3: the width decides unless a box height is lower.
  image: () => ({ width: 1600, height: 1200 }),
  pricing: { bid: null },
  ...over,
});
const images = (pieces: Piece[]): Array<Extract<Piece, { kind: "image" }>> => {
  const out: Array<Extract<Piece, { kind: "image" }>> = [];
  const walk = (list: readonly Piece[]) => {
    for (const p of list) {
      if (p.kind === "image") out.push(p);
      if (p.kind === "columns") p.columns.forEach((c) => walk(c.pieces));
    }
  };
  walk(pieces);
  return out;
};

describe("the schema and the helper", () => {
  it("photoHeightIn is optional (0–9) on Photo left/right, Two Photos, Photo Grid and Repair List; absent stays absent", () => {
    const grid = {
      ...(newModule("photoGrid") as PhotoGridModule),
      images: [{ image: img, caption: "" }],
    };
    expect(moduleSchema.parse(grid)).toEqual(grid);
    expect(moduleSchema.parse(grid)).not.toHaveProperty("photoHeightIn");
    expect(moduleSchema.parse({ ...grid, photoHeightIn: 2.5 })).toMatchObject({
      photoHeightIn: 2.5,
    });
    expect(() => moduleSchema.parse({ ...grid, photoHeightIn: 9.5 })).toThrow();
    expect(() => moduleSchema.parse({ ...grid, photoHeightIn: -1 })).toThrow();
    const list = newModule("repairList");
    expect(moduleSchema.parse({ ...list, photoHeightIn: 4 })).toMatchObject({ photoHeightIn: 4 });
    const text = newModule("photoLeft");
    expect(moduleSchema.parse({ ...text, photoHeightIn: 1.5 })).toMatchObject({
      photoHeightIn: 1.5,
    });
    const two = newModule("twoPhotos");
    expect(moduleSchema.parse({ ...two, photoHeightIn: 3 })).toMatchObject({ photoHeightIn: 3 });
    // A body module does not take it (the discriminated union strips unknown keys).
    expect(moduleSchema.parse({ ...newModule("body"), photoHeightIn: 3 })).not.toHaveProperty(
      "photoHeightIn",
    );
    // New modules carry no size (today's behaviour).
    for (const t of ["photoLeft", "photoRight", "twoPhotos", "photoGrid", "repairList"] as const)
      expect(newModule(t)).not.toHaveProperty("photoHeightIn");
  });
  it("photoHeightOf: 0 for absent, 0, or rubbish; clamped to 9. withPhotoHeight writes a positive height and removes the key for natural — never 0 or undefined", () => {
    expect(photoHeightOf({})).toBe(0);
    expect(photoHeightOf({ photoHeightIn: 0 })).toBe(0);
    expect(photoHeightOf({ photoHeightIn: Number.NaN })).toBe(0);
    expect(photoHeightOf({ photoHeightIn: 2.5 })).toBe(2.5);
    expect(photoHeightOf({ photoHeightIn: 99 })).toBe(PHOTO_HEIGHT_MAX);
    const grid = newModule("photoGrid") as PhotoGridModule;
    const sized = withPhotoHeight(grid, 2.5);
    expect(sized).toEqual({ ...grid, photoHeightIn: 2.5 });
    const natural = withPhotoHeight(sized, 0);
    expect(natural).toEqual(grid);
    expect(Object.keys(natural)).not.toContain("photoHeightIn");
    expect(JSON.stringify(natural)).not.toContain("photoHeightIn");
    expect(withPhotoHeight(grid, 20).photoHeightIn).toBe(PHOTO_HEIGHT_MAX);
    expect(withPhotoHeight(grid, -2)).toEqual(grid);
    expect(withPhotoHeight(grid, Number.NaN)).toEqual(grid);
    expect(PHOTO_SIZE_PRESETS.map((p) => [p.label, p.heightIn])).toEqual([
      ["Small", 1.5],
      ["Medium", 2.5],
      ["Large", 4],
    ]);
  });
});

describe("the PDF layout honours the size", () => {
  it("Photo Grid: no size → the cell's 4:3 box (the width decides); a size → that height, the width following", () => {
    const grid: PhotoGridModule = {
      ...(newModule("photoGrid") as PhotoGridModule),
      id: "g",
      columns: 2,
      images: [
        { image: img, caption: "" },
        { image: img, caption: "" },
      ],
    };
    const cellW = (CONTENT_WIDTH - GRID_GUTTER) / 2;
    const natural = images(layoutPhotoGrid(grid, 0, CONTENT_WIDTH, ctx()));
    expect(natural[0]!.width).toBeCloseTo(cellW);
    // A 4:3 picture in the cell's 1.33 box: the width decides, the box (cellW / 1.33) is a hair taller.
    expect(natural[0]!.height).toBeCloseTo(cellW * (1200 / 1600));
    expect(natural[0]!.height).toBeLessThanOrEqual(cellW / GRID_BOX_RATIO);
    const small = images(layoutPhotoGrid({ ...grid, photoHeightIn: 1.5 }, 0, CONTENT_WIDTH, ctx()));
    expect(small[0]!.height).toBeCloseTo(1.5 * PT_PER_IN);
    expect(small[0]!.width).toBeCloseTo(1.5 * PT_PER_IN * (1600 / 1200));
    // Centred in its cell.
    expect(small[0]!.x).toBeCloseTo((cellW - small[0]!.width) / 2);
    expect(small[1]!.x).toBeCloseTo(cellW + GRID_GUTTER + (cellW - small[1]!.width) / 2);
    // A tall size is still capped by the cell's width.
    const large = images(layoutPhotoGrid({ ...grid, photoHeightIn: 9 }, 0, CONTENT_WIDTH, ctx()));
    expect(large[0]!.width).toBeCloseTo(cellW);
    expect(large[0]!.height).toBeCloseTo(cellW * (1200 / 1600));
    // layoutModule routes the same way.
    expect(
      images(layoutModule({ ...grid, photoHeightIn: 1.5 }, 0, CONTENT_WIDTH, ctx()))[0]!.height,
    ).toBeCloseTo(1.5 * PT_PER_IN);
  });
  const insp: InspectionSnapshot = {
    inspectedOn: "2026-10-20",
    grade: "C",
    technician: "T",
    notes: "",
    recommendRepairs: true,
    items: [
      {
        id: "b",
        label: "Seams",
        status: "issue",
        note: "Open lap",
        photoIds: ["p1", "p2", "p3", "p4"],
      },
    ],
  };
  const list = (over: Partial<RepairListModule> = {}): RepairListModule => ({
    ...(newModule("repairList") as RepairListModule),
    id: "r",
    ...over,
  });
  const lines = (pieces: Piece[]) =>
    pieces.filter((p): p is Extract<Piece, { kind: "columns" }> => p.kind === "columns");
  it("Repair List: no size → 1.6 × 1.2 in, three a line; a size → a 4:3 box of that height, as many a line as fit", () => {
    expect(repairThumbBox({}, CONTENT_WIDTH)).toEqual({
      thumbW: REPAIR_THUMB_WIDTH,
      thumbH: REPAIR_THUMB_HEIGHT,
      perLine: 3,
    });
    const medium = repairThumbBox({ photoHeightIn: 2.5 }, CONTENT_WIDTH);
    expect(medium.thumbH).toBeCloseTo(2.5 * PT_PER_IN);
    expect(medium.thumbW).toBeCloseTo(2.5 * PT_PER_IN * GRID_BOX_RATIO);
    expect(medium.perLine).toBe(2);
    const large = repairThumbBox({ photoHeightIn: 4 }, CONTENT_WIDTH);
    expect(large.perLine).toBe(1);
    expect(large.thumbW).toBeCloseTo(4 * PT_PER_IN * GRID_BOX_RATIO);
    // Never wider than the row.
    expect(repairThumbBox({ photoHeightIn: 9 }, CONTENT_WIDTH).thumbW).toBe(CONTENT_WIDTH);
    const natural = layoutRepairList(list(), 0, CONTENT_WIDTH, ctx({ inspection: insp }));
    expect(lines(natural).map((l) => l.columns.length)).toEqual([3, 1]);
    expect(images(natural)[0]!.width).toBeCloseTo(REPAIR_THUMB_WIDTH);
    // Portrait pictures, so the box's height (not its 1.33 width) decides the fit.
    const sized = layoutRepairList(
      list({ photoHeightIn: 2.5 }),
      0,
      CONTENT_WIDTH,
      ctx({ inspection: insp, image: () => ({ width: 1200, height: 1600 }) }),
    );
    expect(lines(sized).map((l) => l.columns.length)).toEqual([2, 2]);
    const pics = images(sized);
    expect(pics).toHaveLength(4);
    for (const p of pics) expect(p.height).toBeCloseTo(2.5 * PT_PER_IN);
    expect(pics[0]!.width).toBeCloseTo(2.5 * PT_PER_IN * (1200 / 1600));
    // A landscape 4:3 picture in the same 1.33 box fills its width, a hair under the height.
    const wide = images(
      layoutRepairList(list({ photoHeightIn: 2.5 }), 0, CONTENT_WIDTH, ctx({ inspection: insp })),
    )[0]!;
    expect(wide.width).toBeCloseTo(2.5 * PT_PER_IN * GRID_BOX_RATIO);
    expect(wide.height).toBeLessThanOrEqual(2.5 * PT_PER_IN);
    expect(wide.height).toBeGreaterThan(2.4 * PT_PER_IN);
    // The keys the loader fills stay row/photo-based whatever the size.
    expect(pics.map((p) => p.key)).toEqual(["r:r0p0", "r:r0p1", "r:r0p2", "r:r0p3"]);
    // Pictures off: no thumbnails, size or not.
    expect(
      images(
        layoutRepairList(
          list({ photos: false, photoHeightIn: 2.5 }),
          0,
          CONTENT_WIDTH,
          ctx({ inspection: insp }),
        ),
      ),
    ).toEqual([]);
  });
  it("Photo on left / right: no size → up to 60% of the page in its 45% column; a size → that height", () => {
    const m: PhotoTextModule = {
      ...(newModule("photoLeft") as PhotoTextModule),
      id: "t",
      image: img,
      text: richFromText("Beside"),
    };
    // Tall portrait: the height decides.
    const tall = ctx({ image: () => ({ width: 600, height: 2400 }) });
    const natural = images(layoutModule(m, 0, CONTENT_WIDTH, tall))[0]!;
    expect(natural.height).toBeCloseTo(CONTENT_HEIGHT * 0.6);
    const sized = images(layoutModule({ ...m, photoHeightIn: 2.5 }, 0, CONTENT_WIDTH, tall))[0]!;
    expect(sized.height).toBeCloseTo(2.5 * PT_PER_IN);
    expect(sized.width).toBeCloseTo(2.5 * PT_PER_IN * (600 / 2400));
    expect(
      images(
        layoutModule({ ...m, type: "photoRight", photoHeightIn: 1.5 }, 0, CONTENT_WIDTH, tall),
      )[0]!.height,
    ).toBeCloseTo(1.5 * PT_PER_IN);
  });
  it("Two Photos: no size → up to 4 in each; a size → that height for both", () => {
    const m: TwoPhotosModule = {
      ...(newModule("twoPhotos") as TwoPhotosModule),
      id: "two",
      images: [img, img],
    };
    const tall = ctx({ image: () => ({ width: 600, height: 2400 }) });
    const natural = images(layoutModule(m, 0, CONTENT_WIDTH, tall));
    expect(natural.map((p) => p.height)).toEqual([TWO_PHOTOS_HEIGHT, TWO_PHOTOS_HEIGHT]);
    expect(TWO_PHOTOS_HEIGHT).toBe(4 * PT_PER_IN);
    const sized = images(layoutModule({ ...m, photoHeightIn: 1.5 }, 0, CONTENT_WIDTH, tall));
    expect(sized.map((p) => p.height)).toEqual([1.5 * PT_PER_IN, 1.5 * PT_PER_IN]);
  });
  it("Full Photo keeps its heightIn (unchanged)", () => {
    const m = { ...newModule("fullPhoto"), image: img, heightIn: 2 } as DocModule;
    expect(images(layoutModule(m, 0, CONTENT_WIDTH, ctx()))[0]!.height).toBeCloseTo(2 * PT_PER_IN);
  });
});

describe("the editor's Size control", () => {
  /** The source of one module's view function. */
  const fnBody = (name: string) => {
    const from = moduleView.indexOf(`function ${name}(`);
    expect(from).toBeGreaterThan(-1);
    const next = moduleView.indexOf("\nfunction ", from + 1);
    return moduleView.slice(from, next === -1 ? undefined : next);
  };
  it("is a Size select (Natural / Small / Medium / Large, Custom when none matches) beside the exact box in inches, blank = natural, writing through withPhotoHeight", () => {
    const control = fnBody("PhotoSizeControl");
    expect(control).toContain('<option value="natural">Natural</option>');
    expect(control).toContain("{PHOTO_SIZE_PRESETS.map((p) => (");
    expect(control).toContain("{p.label} ({p.heightIn} in)");
    expect(control).toContain(
      '{selectValue === "custom" ? <option value="custom">Custom</option> : null}',
    );
    expect(control).toContain(
      "set((c) => withPhotoHeight(c as PhotoHeightModule, heightIn) as DocModule);",
    );
    expect(control).toMatch(/<NumberField\s+value=\{h\}\s+min=\{0\}\s+max=\{PHOTO_HEIGHT_MAX\}/);
    expect(control).toContain('placeholder="auto"');
    expect(control).toContain('aria-label="Picture size"');
    // Dark mode on the new surface.
    expect(control).toContain("dark:text-neutral-700");
  });
  it("every module type with pictures exposes the size setting", () => {
    expect([...PICTURE_MODULE_TYPES]).toEqual([
      "fullPhoto",
      "photoLeft",
      "photoRight",
      "twoPhotos",
      "photoGrid",
      "repairList",
    ]);
    const views: Record<(typeof PICTURE_MODULE_TYPES)[number], string> = {
      fullPhoto: "FullPhoto",
      photoLeft: "PhotoText",
      photoRight: "PhotoText",
      twoPhotos: "TwoPhotos",
      photoGrid: "PhotoGrid",
      repairList: "RepairList",
    };
    for (const type of PICTURE_MODULE_TYPES) {
      const body = fnBody(views[type]);
      if (type === "fullPhoto") expect(body).toMatch(/<NumberField\s+value=\{m\.heightIn\}/);
      else expect(body).toContain("<PhotoSizeControl module={m} set={set}");
    }
    // The rich-text modules hold no pictures (text and variable nodes only), so none there.
    expect(read("src/lib/documents/model.ts")).not.toMatch(/type: "image"/);
    // The screen draws the size: grid cells, the repair thumbnails, the photo-text slot, both Two Photos slots.
    expect(fnBody("PhotoGrid")).toContain(
      "heightPx={photoHeightOf(m) > 0 ? Math.round(photoHeightOf(m) * IN_PX) : undefined}",
    );
    expect(fnBody("RepairList")).toContain("const box = repairThumbBox(m, CONTENT_WIDTH);");
    expect(fnBody("RepairList")).toContain(
      "<div key={photoId} style={thumbStyle} data-repair-photo={photoId}>",
    );
    expect(fnBody("PhotoText")).toContain("heightPx={heightPx}");
    expect(fnBody("TwoPhotos")).toContain("heightPx={heightPx}");
  });
});
