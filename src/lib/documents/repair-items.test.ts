/**
 * The Checklist item module and "One checklist item per page" (owner, Oct 28: "the checklist
 * currently comes through as one big box, id like the ability to manipulate each checklist item
 * box so i can have space between them or one for each page" → "lets have it default to split
 * items but also have the one item per page toggle"):
 *
 *   R1. The model: a `repairItem` module (one item, live or typed label / note, the thumbnail
 *       size, the gap below) and the `itemPerPage` option; documents saved before read as off.
 *   R2. Generating from a template on an inspection ticket splits every Repair List into one
 *       item module per item it would list, in its place (splitRepairLists); a list with nothing
 *       to list stays, as does everything else.
 *   R3. The PDF prints the item's name in bold, the typed note or the snapshot's, its pictures as
 *       thumbnails and the gap below; a missing item prints nothing.
 *   R4. One item per page: the screen packs a flagged module onto a new sheet (not the first), the
 *       PDF gets a pageBreak piece before every item only while the option is on, and paginate
 *       starts a new page on it (not at the top of one).
 *   R5. Refresh data counts the flagged items no item module shows, in one plain sentence.
 *   R6. The tile, the Options checkbox, the Split link and createDocument are wired (source pins).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { packIntoSheets } from "./editor-helpers";
import {
  DEFAULT_OPTIONS,
  type DocPage,
  MODULE_LABELS,
  MODULE_TILES,
  moduleSchema,
  newModule,
  newPage,
  optionsSchema,
  type RepairItemModule,
  type RepairListModule,
  REPAIR_ITEM_SPACE_IN,
  repairItemSpaceOf,
  withRepairItemSpace,
} from "./model";
import {
  CONTENT_WIDTH,
  type LayoutContext,
  layoutModules,
  layoutRepairItem,
  type Measure,
  MODULE_GAP,
  paginate,
  type Piece,
  repairItemData,
} from "./pdf-layout";
import {
  flaggedItemsNotShown,
  notOnPageNote,
  repairItemModules,
  splitRepairListModule,
  splitRepairLists,
} from "./server-pure";
import { type InspectionSnapshot, repairItemTitle, variableLabel } from "./variables";

const read = (p: string) => readFileSync(p, "utf8");

const snapshot: InspectionSnapshot = {
  inspectedOn: "2026-10-27",
  grade: "C",
  technician: "Tony",
  notes: "",
  recommendRepairs: true,
  items: [
    {
      id: "seams",
      label: "Seams",
      status: "issue",
      note: "Open lap at the east drain",
      photoIds: ["p1", "p2"],
    },
    { id: "drains", label: "Drains", status: "ok", note: "", photoIds: [] },
    {
      id: "flashing",
      label: "Perimeter flashings",
      status: "issue",
      note: "Lifted at the corner",
      photoIds: ["p3"],
    },
    { id: "skylight", label: "Skylights", status: "na", note: "", photoIds: [] },
  ],
};

const list = (over: Partial<RepairListModule> = {}): RepairListModule => ({
  ...(newModule("repairList") as RepairListModule),
  id: "list",
  ...over,
});
const item = (over: Partial<RepairItemModule> = {}): RepairItemModule => ({
  id: "item",
  type: "repairItem",
  itemId: "seams",
  label: null,
  note: null,
  ...over,
});

const measure: Measure = (text, _font, size) => text.length * size * 0.5;
const ctx = (over: Partial<LayoutContext> = {}): LayoutContext => ({
  width: CONTENT_WIDTH,
  measure,
  vars: {},
  labelOf: variableLabel,
  image: () => ({ width: 1600, height: 1200 }),
  pricing: { bid: null },
  inspection: snapshot,
  ...over,
});
const texts = (pieces: Piece[]) =>
  pieces
    .filter((p): p is Extract<Piece, { kind: "text" }> => p.kind === "text")
    .map((p) => p.line.segments.map((s) => s.text).join(""));

describe("R1. the model", () => {
  it("has the Checklist item tile right after the Repair List, and the schema takes the module", () => {
    expect(MODULE_LABELS.repairItem).toBe("Checklist item");
    expect(MODULE_TILES.indexOf("repairItem")).toBe(MODULE_TILES.indexOf("repairList") + 1);
    const fresh = newModule("repairItem");
    expect(fresh).toMatchObject({ type: "repairItem", itemId: "", label: null, note: null });
    expect(moduleSchema.safeParse(fresh).success).toBe(true);
    const parsed = moduleSchema.parse({
      id: "x",
      type: "repairItem",
      itemId: "seams",
      label: "Seams (east)",
      note: null,
      photoHeightIn: 2.5,
      spaceBelowIn: 1,
    });
    expect(parsed).toEqual({
      id: "x",
      type: "repairItem",
      itemId: "seams",
      label: "Seams (east)",
      note: null,
      photoHeightIn: 2.5,
      spaceBelowIn: 1,
    });
    expect(moduleSchema.safeParse({ id: "x", type: "repairItem", itemId: "seams" }).success).toBe(
      false,
    );
  });
  it("the gap below: 0.25 in by default; the box writes a positive gap and removes the key for blank", () => {
    expect(REPAIR_ITEM_SPACE_IN).toBe(0.25);
    expect(repairItemSpaceOf(item())).toBe(0.25);
    expect(repairItemSpaceOf(item({ spaceBelowIn: 0 }))).toBe(0.25);
    expect(repairItemSpaceOf(item({ spaceBelowIn: 1.5 }))).toBe(1.5);
    const spaced = withRepairItemSpace(item(), 1);
    expect(spaced.spaceBelowIn).toBe(1);
    const back = withRepairItemSpace(spaced, 0);
    expect(Object.keys(back)).not.toContain("spaceBelowIn");
    expect(JSON.stringify(back)).not.toContain("spaceBelowIn");
  });
  it("itemPerPage is an option, off by default; options saved before it parse with false", () => {
    expect(DEFAULT_OPTIONS.itemPerPage).toBe(false);
    const old = { prices: "none", photos: true, marks: true, footer: true, pageBreakIn: 8.8 };
    expect(optionsSchema.parse(old)).toEqual({ ...old, itemPerPage: false });
    expect(optionsSchema.parse({ ...old, itemPerPage: true }).itemPerPage).toBe(true);
  });
});

describe("R2. splitting a Repair List into items", () => {
  const pages: DocPage[] = [
    newPage([{ ...newModule("body"), id: "heading" }, list(), { ...newModule("hr"), id: "rule" }]),
    newPage([{ ...newModule("signature"), id: "sig" }]),
  ];
  it("one live item module per flagged item, in the list's place; everything else keeps its order", () => {
    const out = splitRepairLists(pages, snapshot);
    expect(out[0]!.modules.map((m) => m.type)).toEqual(["body", "repairItem", "repairItem", "hr"]);
    expect(out[0]!.modules[0]!.id).toBe("heading");
    expect(out[0]!.modules[3]!.id).toBe("rule");
    const items = out[0]!.modules.filter((m): m is RepairItemModule => m.type === "repairItem");
    expect(items.map((m) => m.itemId)).toEqual(["seams", "flashing"]);
    for (const m of items) {
      expect(m.label).toBeNull();
      expect(m.note).toBeNull();
      expect(m).not.toHaveProperty("photoHeightIn");
    }
    expect(new Set(items.map((m) => m.id)).size).toBe(2);
    expect(out[1]).toEqual(pages[1]);
    // The pages themselves are untouched.
    expect(pages[0]!.modules.map((m) => m.type)).toEqual(["body", "repairList", "hr"]);
  });
  it("carries the list's thumbnail size, lists every item when allItems, and leaves a list with nothing to list", () => {
    const sized = repairItemModules(list({ photoHeightIn: 2.5 }), snapshot);
    expect(sized.map((m) => m.photoHeightIn)).toEqual([2.5, 2.5]);
    const all = repairItemModules(list({ allItems: true }), snapshot);
    expect(all.map((m) => m.itemId)).toEqual(["seams", "drains", "flashing", "skylight"]);
    const nothing: InspectionSnapshot = {
      ...snapshot,
      items: snapshot.items.map((i) => ({ ...i, status: "ok" })),
    };
    expect(splitRepairLists(pages, nothing)[0]!.modules.map((m) => m.type)).toEqual([
      "body",
      "repairList",
      "hr",
    ]);
    expect(splitRepairLists(pages, null)).toEqual(pages);
  });
  it("splitRepairListModule splits only the named list", () => {
    const two = [newPage([list(), list({ id: "other" })])];
    const out = splitRepairListModule(two, "list", snapshot);
    expect(out[0]!.modules.map((m) => m.type)).toEqual(["repairItem", "repairItem", "repairList"]);
    expect(out[0]!.modules[2]!.id).toBe("other");
    expect(splitRepairListModule(two, "nope", snapshot)).toEqual(two);
  });
});

describe("R3. what a Checklist item prints", () => {
  it("the name in bold with its status when it is not an issue, the typed note or the snapshot's, the pictures, the gap", () => {
    expect(repairItemTitle("Seams", "issue")).toBe("Seams");
    expect(repairItemTitle("Drains", "ok")).toBe("Drains · OK");
    expect(repairItemTitle("Drains", null)).toBe("Drains · OK");
    expect(repairItemTitle("Skylights", "na")).toBe("Skylights · N/A");
    const live = layoutRepairItem(item(), 0, CONTENT_WIDTH, ctx());
    expect(texts(live)).toEqual(["Seams", "Open lap at the east drain"]);
    const title = live.find((p) => p.kind === "text");
    expect(title!.kind === "text" && title!.line.segments[0]!.font).toBe("bold");
    // Two pictures: one row of thumbnails.
    expect(live.filter((p) => p.kind === "columns")).toHaveLength(1);
    const last = live[live.length - 1]!;
    expect(last).toEqual({ kind: "gap", height: 0.25 * 72 });
    const typed = layoutRepairItem(
      item({ label: "East seams", note: "Fixed on site" }),
      0,
      CONTENT_WIDTH,
      ctx(),
    );
    expect(texts(typed)).toEqual(["East seams", "Fixed on site"]);
    const spaced = layoutRepairItem(item({ spaceBelowIn: 2 }), 0, CONTENT_WIDTH, ctx());
    expect(spaced[spaced.length - 1]).toEqual({ kind: "gap", height: 144 });
    // Photos off: no thumbnails; an OK item carries its status.
    const noPhotos = layoutRepairItem(item(), 0, CONTENT_WIDTH, ctx({ photos: false }));
    expect(noPhotos.some((p) => p.kind === "columns")).toBe(false);
    expect(texts(layoutRepairItem(item({ itemId: "drains" }), 0, CONTENT_WIDTH, ctx()))).toEqual([
      "Drains · OK",
    ]);
  });
  it("a missing item, a blank pick or no snapshot prints nothing", () => {
    expect(layoutRepairItem(item({ itemId: "gone" }), 0, CONTENT_WIDTH, ctx())).toEqual([]);
    expect(layoutRepairItem(item({ itemId: "" }), 0, CONTENT_WIDTH, ctx())).toEqual([]);
    expect(layoutRepairItem(item(), 0, CONTENT_WIDTH, ctx({ inspection: null }))).toEqual([]);
    expect(repairItemData(item({ itemId: "gone" }), snapshot)).toBeNull();
    expect(repairItemData(item({ label: "Typed" }), snapshot)).toMatchObject({
      title: "Typed",
      label: "Typed",
      note: "Open lap at the east drain",
      photoIds: ["p1", "p2"],
    });
  });
});

describe("R4. one item per page", () => {
  it("packIntoSheets: a module flagged breakBefore starts a new sheet, unless it is first on its sheet", () => {
    const items = [
      { id: "a", height: 100 },
      { id: "b", height: 100, breakBefore: true },
      { id: "c", height: 100, breakBefore: true },
      { id: "d", height: 100 },
    ];
    expect(packIntoSheets(items, 1000, 12)).toEqual([["a"], ["b"], ["c", "d"]]);
    expect(packIntoSheets([{ id: "b", height: 100, breakBefore: true }], 1000, 12)).toEqual([
      ["b"],
    ]);
    // Without the flag the old packing holds.
    expect(
      packIntoSheets(
        items.map(({ id, height }) => ({ id, height })),
        1000,
        12,
      ),
    ).toEqual([["a", "b", "c", "d"]]);
  });
  it("paginate: a pageBreak piece starts a new page, and does nothing at the top of one", () => {
    const text = (): Piece => ({
      kind: "text",
      x: 0,
      width: 100,
      height: 20,
      line: { segments: [], width: 0, size: 10, color: "body" } as unknown as Extract<
        Piece,
        { kind: "text" }
      >["line"],
    });
    const brk: Piece = { kind: "pageBreak", height: 0 };
    const pages = paginate([text(), brk, text(), text()], 1000);
    expect(pages.map((p) => p.length)).toEqual([1, 2]);
    expect(pages[1]![0]!.y).toBe(0);
    expect(paginate([brk, text(), text()], 1000).map((p) => p.length)).toEqual([2]);
    expect(paginate([text(), brk, brk, text()], 1000).map((p) => p.length)).toEqual([1, 1]);
    // A trailing break adds no empty page.
    expect(paginate([text(), brk], 1000).map((p) => p.length)).toEqual([1]);
  });
  it("layoutModules puts a pageBreak before every Checklist item only while the option is on", () => {
    const modules = [item({ id: "i1" }), item({ id: "i2", itemId: "flashing" })];
    const off = layoutModules(modules, ctx());
    expect(off.some((p) => p.kind === "pageBreak")).toBe(false);
    expect(off.filter((p) => p.kind === "gap" && p.height === MODULE_GAP)).toHaveLength(1);
    const on = layoutModules(modules, ctx({ itemPerPage: true }));
    expect(on.filter((p) => p.kind === "pageBreak")).toHaveLength(2);
    expect(on[0]!.kind).toBe("pageBreak");
    // The break comes before the gap between modules, so the new page never starts with a gap.
    const second = on.findIndex((p, i) => i > 0 && p.kind === "pageBreak");
    expect(on[second + 1]).toEqual({ kind: "gap", height: MODULE_GAP });
    expect(paginate(on, 1000)).toHaveLength(2);
    // A Repair List is not an item: no break even with the option on.
    expect(
      layoutModules([list()], ctx({ itemPerPage: true })).some((p) => p.kind === "pageBreak"),
    ).toBe(false);
  });
});

describe("R5. Refresh data's note", () => {
  it("counts the flagged items no Checklist item module shows; none with a Repair List or no snapshot", () => {
    expect(flaggedItemsNotShown([newPage([item()])], snapshot)).toBe(1);
    expect(
      flaggedItemsNotShown([newPage([item(), item({ id: "b", itemId: "flashing" })])], snapshot),
    ).toBe(0);
    expect(flaggedItemsNotShown([newPage([newModule("body")])], snapshot)).toBe(2);
    expect(flaggedItemsNotShown([newPage([list()])], snapshot)).toBe(0);
    expect(flaggedItemsNotShown([newPage([item()])], null)).toBe(0);
    expect(notOnPageNote(0)).toBeNull();
    expect(notOnPageNote(1)).toBe(
      "1 flagged item is not on the page yet — add it with the Checklist item tile.",
    );
    expect(notOnPageNote(3)).toBe(
      "3 flagged items are not on the page yet — add them with the Checklist item tile.",
    );
  });
});

describe("R6. wiring (source pins)", () => {
  const moduleView = read("src/components/documents/editor/module-view.tsx");
  const route = read("src/routes/documents.tsx");
  it("the tile, the item view and its settings", () => {
    expect(moduleView).toContain(
      'case "repairItem":\n      return <RepairItem m={m} set={set} />;',
    );
    const view = moduleView.slice(
      moduleView.indexOf("function RepairItem("),
      moduleView.indexOf("\n// ----", moduleView.indexOf("function RepairItem(")),
    );
    expect(view).toContain('aria-label="Checklist item"');
    expect(view).toContain('<PhotoSizeControl module={m} set={set} what="the thumbnails" />');
    expect(view).toContain("Space below");
    expect(view).toContain("placeholder={String(REPAIR_ITEM_SPACE_IN)}");
    expect(view).toContain("value={m.spaceBelowIn ?? 0}");
    expect(view).toContain("{m.itemId ? ITEM_GONE_HINT : PICK_ITEM_HINT}");
    expect(view).toContain("{NO_INSPECTION_HINT}");
    expect(view).toContain("data-item-photo={photoId}");
    expect(view).toContain("height: Math.round(repairItemSpaceOf(m) * IN_PX)");
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      'ITEM_GONE_HINT = "This item is no longer on the inspection"',
    );
    expect(route).toContain("repairItem: ListTodo,");
  });
  it("the Options checkbox and its hint; the sheet packer gets the flag", () => {
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      'itemPerPage: "One checklist item per page: every Checklist item starts a new page"',
    );
    expect(route).toContain("title={OPTION_HINTS.itemPerPage}");
    expect(route).toContain("onCheckedChange={(c) => setOpt({ itemPerPage: c === true })}");
    expect(route).toContain("\n            One checklist item per page\n");
    expect(read("src/components/documents/editor/page-canvas.tsx")).toContain(
      'breakBefore: m.type === "repairItem" && env.options.itemPerPage,',
    );
    expect(read("src/lib/documents/document-pdf.server.ts")).toContain(
      "itemPerPage: options.itemPerPage,",
    );
    expect(read("src/lib/documents/inspection-report.ts")).toContain("itemPerPage: false,");
  });
  it("the Split link on a Repair List, and createDocument splitting on generation", () => {
    const repairList = moduleView.slice(
      moduleView.indexOf("function RepairList("),
      moduleView.indexOf("\nfunction ", moduleView.indexOf("function RepairList(") + 1),
    );
    expect(repairList).toContain("Split into items");
    expect(repairList).toContain("disabled={!insp || !splitItems.length}");
    expect(repairList).toContain(
      'env.dispatch({ type: "splitRepairList", moduleId: m.id, inspection: insp })',
    );
    expect(read("src/components/documents/editor/editor-state.ts")).toContain(
      "splitRepairListModule(state.pages, action.moduleId, action.inspection)",
    );
    const fns = read("src/lib/documents.functions.ts");
    expect(fns).toContain(
      "templatePages && inspection ? splitRepairLists(generated, inspection) : generated",
    );
    // Refresh data adds the sentence for the flagged items not on the page yet.
    expect(route).toContain("flaggedItemsNotShown(state.pages, storedInspection(r.variables))");
  });
});
