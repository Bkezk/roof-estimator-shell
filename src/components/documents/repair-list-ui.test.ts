/**
 * The Repair List module's settings row and its thumbnails' Mark up (owner, Oct 28):
 *
 *   D1. A small muted settings row always shows above the table. Later the same day the owner
 *       dropped its two switches — "All checklist items" and "Show pictures" ("we can select them
 *       on generation and I think it'll cause more problems than fix"): the list is as the module
 *       was saved (`allItems`, default issues only — nothing on the generation path sets it yet)
 *       and the pictures follow the document's Photos checkbox (the module's `photos` field stays
 *       in the schema for old documents, ignored). What remains: the picture Size, then "Edit
 *       rows" / "Undo edits" at the LEFT, with room kept at the right so the module's floating
 *       toolbar (Move up … Delete, top-right) never covers them. With no inspection snapshot on a
 *       document, a plain line says so and points at Refresh data.
 *   D2. A row's thumbnail carries the same "Mark up" launcher as a picture slot (the pencil on
 *       hover, always on touch, and a double-click), opening the same dialog that saves the marks
 *       on the ticket's photo.
 *
 * Read from the sources, as documents-ui.test.ts does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const moduleView = read("src/components/documents/editor/module-view.tsx");
const picker = read("src/components/documents/editor/photo-picker.tsx");
const repairList = moduleView.slice(
  moduleView.indexOf("function RepairList("),
  moduleView.indexOf("\nfunction ", moduleView.indexOf("function RepairList(") + 1),
);

describe("D1. the Repair List's settings row", () => {
  const toolbar = repairList.slice(
    repairList.indexOf("const toolbar = ("),
    repairList.indexOf("if (!insp)"),
  );
  it("is always shown — no hover classes — as a compact muted row above the table, with room at the right for the module's floating toolbar", () => {
    expect(repairList).toContain(
      'className="mb-1 flex flex-wrap items-center gap-3 pr-36 text-xs text-neutral-500 dark:text-neutral-500"',
    );
    expect(repairList).toContain("data-repair-settings");
    expect(toolbar).not.toContain("group-hover");
    expect(toolbar).not.toContain("hidden");
    // Nothing is pushed to the right under the floating toolbar any more.
    expect(toolbar).not.toContain("ml-auto");
    // The row-editing affordances (Remove row, Add row) stay on hover — they are not settings.
    expect(repairList).toContain('title="Remove row"');
    // The row sits above the table in both states (no inspection, and the table).
    expect(repairList.match(/\{toolbar\}/g)).toHaveLength(2);
  });
  it("the two switches are gone: no 'All checklist items', no 'Show pictures', no inline photos-off text, no confirm; the list and its pictures are as saved / as the document says", () => {
    expect(repairList).not.toContain("All checklist items");
    expect(repairList).not.toContain("Show pictures");
    expect(repairList).not.toContain("Photos are off for this document");
    expect(repairList).not.toContain("data-photos-off");
    expect(repairList).not.toContain("setAllItems");
    expect(repairList).not.toContain("window.confirm");
    expect(toolbar).not.toContain("<Switch");
    expect(repairList).not.toContain("m.photos");
    // The pictures follow the document's Photos checkbox, on screen as in the PDF.
    expect(repairList).toContain("const data = repairListData(m, insp, env.options.photos);");
    expect(read("src/lib/documents/pdf-layout.ts")).toContain(
      "const data = repairListData(m, ctx.inspection, ctx.photos !== false);",
    );
    // The module keeps `allItems` (and `photos`, ignored) in the schema for saved documents.
    expect(read("src/lib/documents/model.ts")).toContain("allItems: z.boolean(),");
    expect(read("src/lib/documents/model.ts")).toContain("photos: z.boolean(),");
  });
  it("what remains, in order: Size (while the document's Photos is on), then Edit rows / Undo edits", () => {
    const size = toolbar.indexOf('<PhotoSizeControl module={m} set={set} what="the thumbnails" />');
    const edit = toolbar.indexOf("Edit rows");
    const undo = toolbar.indexOf("Undo edits");
    expect(size).toBeGreaterThan(0);
    expect(undo).toBeGreaterThan(size);
    expect(edit).toBeGreaterThan(size);
    expect(toolbar).toContain(
      '{env.options.photos ? <PhotoSizeControl module={m} set={set} what="the thumbnails" /> : null}',
    );
    expect(toolbar).toContain('title="Copy the rows so they can be edited by hand"');
    expect(toolbar).toContain(
      'title="Throw away the typed changes and go back to the ticket\'s own findings"',
    );
    expect(repairList).not.toContain("Reset to the inspection");
    expect(toolbar).toContain("onClick={() => patch((t) => ({ ...t, rows: null }))}");
  });
  it("no inspection snapshot on a document: a plain visible line pointing at Refresh data; the template placeholder stays; the PDF prints nothing", () => {
    expect(repairList).toContain("data-no-inspection");
    expect(repairList).toContain("{NO_INSPECTION_HINT}");
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      '"No inspection findings were on the ticket when this document was made. Click Refresh data on the Variables tab to pull them in."',
    );
    expect(repairList).toContain("Repair List: the inspection&apos;s findings print here");
    expect(repairList).not.toContain("NO_INSPECTION_TEXT");
    expect(read("src/lib/documents/pdf-layout.ts")).toContain("if (!ctx.inspection) return [];");
  });
});

describe("D2. Mark up from the Repair List's thumbnails", () => {
  it("each repair-photo box carries the Mark up launcher, with double-click, around the untouched DocImage", () => {
    expect(repairList).toContain("data-repair-photo={photoId}");
    expect(repairList).toMatch(
      /<MarkUpAffordance\s+image=\{\{ kind: "ticketPhoto", photoId, marks: env\.options\.marks \}\}\s+onChange=\{\(\) => \{\}\}\s+doubleClick\s+className="h-full w-full"\s*>\s*<DocImage\s+image=\{\{ kind: "ticketPhoto", photoId, marks: env\.options\.marks \}\}\s+className="h-full w-full rounded-sm"\s*\/>\s*<\/MarkUpAffordance>/,
    );
    expect(moduleView).toContain(
      'import { DocImage, ImageSlot, MarkUpAffordance, PhotoPicker } from "./photo-picker";',
    );
  });
  it("the launcher is the picker slot's own, extracted: the pencil on hover (always on touch), double-click when asked, the same MarkupDialog", () => {
    const affordance = picker.slice(
      picker.indexOf("export function MarkUpAffordance("),
      picker.indexOf("\n/**", picker.indexOf("export function MarkUpAffordance(")),
    );
    expect(affordance).toContain("const can = canMarkUp(props.image);");
    expect(affordance).toContain("data-mark-up");
    expect(affordance).toContain('aria-label="Mark up"');
    expect(affordance).toContain("group-hover/markup:flex [@media(hover:none)]:flex");
    // (Oct 28: and not while the document's Marks checkbox is off — the pencil is disabled then.)
    expect(affordance).toMatch(/onDoubleClick=\{\s*can && !marksOff && props\.doubleClick/);
    expect(affordance).toContain("<MarkupDialog");
    // The slot uses it (one launcher, not two) — the old button and dialog are gone from ImageSlot.
    const slot = picker.slice(
      picker.indexOf("export function ImageSlot("),
      picker.indexOf("export function MarkUpAffordance("),
    );
    expect(slot).toContain(
      '<MarkUpAffordance image={props.image} onChange={props.onChange} className="group/slot">',
    );
    expect(slot).not.toContain("<MarkupDialog");
    expect(slot).not.toContain("group-hover/slot:flex");
    expect(slot).not.toContain("setMarkup");
    // Ticket photos save on the ticket's row, as before (the dialog is unchanged).
    expect(picker).toContain("const saveFn = useServerFn(savePhotoAnnotations);");
    expect(picker).toContain('toast.success("Marks saved on the ticket photo");');
  });
});
