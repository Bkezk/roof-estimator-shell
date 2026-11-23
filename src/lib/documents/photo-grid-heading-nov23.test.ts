/**
 * Nov 23, the owner: "4 go". On the Care plan report the heading "Other pictures from this
 * visit" was a text module of its own before the Photo Grid. With Photos switched off in the
 * editor, or once the pictures were taken out of the grid, the heading printed with nothing
 * under it.
 *
 * The heading is now the grid's own (PhotoGridModule.heading). It prints, in the PDF and in the
 * editor, only when the grid shows a picture: never with Photos off, never over an empty grid.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OTHER_PICTURES_HEADING, withOtherPictures } from "@/lib/documents/care-plan-report";
import { CARE_PLAN_REPORT_TEMPLATE, defaultTemplates } from "@/lib/documents/defaults";
import { INSPECTION_REPORT_OPTIONS } from "@/lib/documents/inspection-report";
import {
  instantiatePages,
  newModule,
  pagesSchema,
  type DocModule,
  type PhotoGridModule,
} from "@/lib/documents/model";
import {
  CONTENT_WIDTH,
  layoutModules,
  layoutPhotoGrid,
  photoGridHeading,
  photoGridHeadingShown,
  type Piece,
} from "@/lib/documents/pdf-layout";
import { splitRepairLists } from "@/lib/documents/server-pure";
import type { InspectionSnapshot } from "@/lib/documents/variables";

const X1 = "0a1b2c3d-0000-4000-8000-000000000001";
const X2 = "0a1b2c3d-0000-4000-8000-000000000002";
const X3 = "0a1b2c3d-0000-4000-8000-000000000003";
const X4 = "0a1b2c3d-0000-4000-8000-000000000004";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const insp: InspectionSnapshot = {
  inspectedOn: "2026-11-20",
  grade: "B",
  technician: "Sam Sample",
  notes: "",
  recommendRepairs: false,
  items: [{ id: "a", label: "Seams", status: "ok", note: "", photoIds: [] }],
};
const ctx = (over: Record<string, unknown> = {}) =>
  ({
    width: CONTENT_WIDTH,
    measure: (t: string, _f: string, s: number) => t.length * s * 0.5,
    vars: {},
    labelOf: (k: string) => k,
    image: () => ({ width: 4, height: 3 }),
    pricing: { bid: null },
    inspection: insp,
    marks: true,
    ...over,
  }) as never;
const words = (pieces: readonly Piece[]) =>
  pieces
    .filter((p) => p.kind === "text")
    .map((p) => (p.kind === "text" ? p.line.segments.map((s) => s.text).join("") : ""));
const cell = (photoId: string) => ({
  image: { kind: "ticketPhoto" as const, photoId, marks: true },
  caption: "",
});
const grid = (over: Partial<PhotoGridModule> = {}): PhotoGridModule => ({
  ...(newModule("photoGrid") as PhotoGridModule),
  columns: 3,
  images: [cell(X1), cell(X2)],
  heading: "Other pictures from this visit",
  ...over,
});
const report = () =>
  splitRepairLists(
    instantiatePages(
      defaultTemplates().find((t) => t.name === CARE_PLAN_REPORT_TEMPLATE)!.pages,
      INSPECTION_REPORT_OPTIONS,
    ),
    insp,
  );

describe("when a Photo Grid's heading is shown", () => {
  it("only with Photos on and a picture under it", () => {
    expect(photoGridHeadingShown(grid(), true)).toBe(true);
    expect(photoGridHeadingShown(grid(), false)).toBe(false);
    expect(photoGridHeadingShown(grid({ images: [] }), true)).toBe(false);
    expect(photoGridHeadingShown(grid({ heading: "   " }), true)).toBe(false);
    expect(photoGridHeadingShown(grid({ heading: undefined }), true)).toBe(false);
    expect(photoGridHeading(grid({ heading: "  More pictures " }))).toBe("More pictures");
    expect(photoGridHeading(grid({ heading: undefined }))).toBe("");
  });
});

describe("the PDF", () => {
  it("prints the heading over the pictures, and keeps it on the page with the first line of them", () => {
    const laid = layoutPhotoGrid(grid(), 0, CONTENT_WIDTH, ctx());
    expect(words(laid)).toEqual(["Other pictures from this visit"]);
    const firstRow = laid.findIndex((p) => p.kind === "columns");
    const text = laid.findIndex((p) => p.kind === "text");
    expect(text).toBeGreaterThan(-1);
    expect(text).toBeLessThan(firstRow);
    // Nothing between the heading and the pictures lets a page break in.
    for (const p of laid.slice(0, firstRow))
      if (p.kind !== "gap") expect((p as { keepWithNext?: boolean }).keepWithNext).toBe(true);
  });
  it("a long grid: the heading once, before the first line only", () => {
    const laid = layoutPhotoGrid(
      grid({ images: [cell(X1), cell(X2), cell(X3), cell(X4)] }),
      0,
      CONTENT_WIDTH,
      ctx(),
    );
    expect(words(laid)).toEqual(["Other pictures from this visit"]);
    expect(laid.filter((p) => p.kind === "columns")).toHaveLength(2);
  });
  it("with Photos switched off nothing is printed: no pictures and no heading", () => {
    expect(layoutPhotoGrid(grid(), 0, CONTENT_WIDTH, ctx({ photos: false }))).toEqual([]);
    expect(layoutModules([grid()], ctx({ photos: false }))).toEqual([]);
  });
  it("with no picture in the grid nothing is printed either", () => {
    expect(layoutPhotoGrid(grid({ images: [] }), 0, CONTENT_WIDTH, ctx())).toEqual([]);
    expect(layoutModules([grid({ images: [] })], ctx())).toEqual([]);
  });
  it("a grid with no heading, or a blank one, prints exactly as before", () => {
    const plain = layoutPhotoGrid(grid({ heading: undefined }), 0, CONTENT_WIDTH, ctx());
    expect(words(plain)).toEqual([]);
    expect(plain.filter((p) => p.kind === "columns")).toHaveLength(1);
    expect(plain).toHaveLength(1);
    const blank = grid({ heading: " " });
    expect(layoutPhotoGrid(blank, 0, CONTENT_WIDTH, ctx())).toEqual(
      layoutPhotoGrid({ ...blank, heading: undefined }, 0, CONTENT_WIDTH, ctx()),
    );
  });
});

describe("the Care plan report's other pictures", () => {
  it("are one module: the grid carries its own heading, and no text module is added for it", () => {
    const pages = report();
    const out = withOtherPictures(pages, [X1, X2]);
    expect(pagesSchema.safeParse(out).success).toBe(true);
    const before = pages[pages.length - 1]!.modules;
    const last: DocModule[] = out[out.length - 1]!.modules;
    expect(last).toHaveLength(before.length + 1);
    const added = last[last.length - 1]!;
    expect(added.type).toBe("photoGrid");
    expect(added.type === "photoGrid" && added.heading).toBe(OTHER_PICTURES_HEADING);
    // The words are in the document once, on the grid: there is no heading left to stand alone.
    expect(JSON.stringify(out).split(OTHER_PICTURES_HEADING)).toHaveLength(2);
    expect(last.filter((m) => m.type === "body")).toEqual(before.filter((m) => m.type === "body"));
  });
  it("Photos off: the last page prints what it printed with no other pictures at all", () => {
    const pages = report();
    const out = withOtherPictures(pages, [X1, X2]);
    const off = ctx({ photos: false });
    const lastOf = (p: typeof pages) => p[p.length - 1]!.modules;
    expect(words(layoutModules(lastOf(out), off))).toEqual(
      words(layoutModules(lastOf(pages), off)),
    );
    expect(words(layoutModules(lastOf(out), off))).not.toContain(OTHER_PICTURES_HEADING);
    // Photos on: the heading is there.
    expect(words(layoutModules(lastOf(out), ctx()))).toContain(OTHER_PICTURES_HEADING);
  });
  it("the pictures taken back out of the grid: the heading goes with them", () => {
    const out = withOtherPictures(report(), [X1, X2]);
    const emptied = out.map((p) => ({
      ...p,
      modules: p.modules.map((m) => (m.type === "photoGrid" ? { ...m, images: [] } : m)),
    }));
    const text = emptied.flatMap((p) => words(layoutModules(p.modules, ctx())));
    expect(text).not.toContain(OTHER_PICTURES_HEADING);
  });
  it("the heading is kept through a save and a reload", () => {
    const out = withOtherPictures(report(), [X1]);
    const back = pagesSchema.parse(JSON.parse(JSON.stringify(out)));
    const g = back[back.length - 1]!.modules.at(-1)!;
    expect(g.type === "photoGrid" && g.heading).toBe(OTHER_PICTURES_HEADING);
    // A grid saved before this change has no heading and still reads.
    const old = { id: "g1", type: "photoGrid", images: [], columns: 2 };
    expect(pagesSchema.safeParse([{ ...back[0]!, modules: [old] }]).success).toBe(true);
  });
});

describe("the editor draws what the PDF prints", () => {
  const view = flat(read("src/components/documents/editor/module-view.tsx"));
  it("Photos off: the grid is one muted line, so its heading is not drawn", () => {
    expect(view).toContain(
      'if (!env.options.photos) { switch (m.type) { case "fullPhoto": case "twoPhotos": case "photoGrid": return <PicturesHidden />;',
    );
  });
  it("the heading is drawn only over pictures, and can be reworded or cleared", () => {
    expect(view).toContain(
      '{m.heading !== undefined && (photoGridHeadingShown(m, true) || (m.images.length > 0 && m.heading.trim() === "") ? ( <input',
    );
    expect(view).toContain("onChange={(e) => patch((g) => ({ ...g, heading: e.target.value }))}");
    // No picture in the grid yet: the heading is not drawn, only a note that it waits.
    expect(view).toContain("data-grid-heading-waits");
    expect(view).toContain("prints once a picture is here.");
  });
});
