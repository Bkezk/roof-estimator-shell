/**
 * The Repair List module's settings row and its thumbnails' Mark up (owner, Oct 28):
 *
 *   D1. The two switches were hidden until hover, so after turning pictures off the owner could
 *       not find them again. Now a small muted settings row always shows above the table — "All
 *       checklist items", "Show pictures" (or "Photos are off for this document" inline when the
 *       document's Photos option is off), the picture Size — and switching lists asks first when
 *       hand-edited rows would be lost.
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
  it("is always shown — no hover classes — as a compact muted row above the table", () => {
    expect(repairList).toContain(
      'className="mb-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500 dark:text-neutral-500"',
    );
    expect(repairList).toContain("data-repair-settings");
    const toolbar = repairList.slice(
      repairList.indexOf("const toolbar = ("),
      repairList.indexOf("if (!insp)"),
    );
    expect(toolbar).not.toContain("group-hover");
    expect(toolbar).not.toContain("hidden");
    // The row-editing affordances (Remove row, Add row) stay on hover — they are not settings.
    expect(repairList).toContain('title="Remove row"');
    // The row sits above the table in both states (no inspection, and the table).
    expect(repairList.match(/\{toolbar\}/g)).toHaveLength(2);
  });
  it("relabels the switches and says inline when photos are off for the document", () => {
    expect(repairList).toContain("All checklist items");
    expect(repairList).toContain('title="List every checklist item, not only the issues"');
    expect(repairList).not.toContain("Every item\n");
    expect(repairList).toContain("Show pictures");
    expect(repairList).toContain('title="Print each item\'s ticket photos under its row"');
    expect(repairList).toMatch(
      /\{env\.options\.photos \? \(\s*<label className="flex items-center gap-1">\s*<Switch\s+checked=\{m\.photos\}/,
    );
    expect(repairList).toContain(
      '<span className="italic" data-photos-off>\n          Photos are off for this document\n        </span>',
    );
    expect(repairList).not.toContain("disabled={!env.options.photos}");
    // The picture size sits in the same row, only while pictures print.
    expect(repairList).toContain(
      '{m.photos && env.options.photos ? (\n        <PhotoSizeControl module={m} set={set} what="the thumbnails" />\n      ) : null}',
    );
  });
  it("switching lists asks first when hand-edited rows would be lost (a plain confirm, as the delete confirms elsewhere)", () => {
    expect(repairList).toContain("const setAllItems = (allItems: boolean) => {");
    expect(repairList).toContain(
      '"Switching lists resets the rows to the inspection\'s. Your edits here will be lost."',
    );
    expect(repairList).toMatch(/if \(\s*editing &&\s*!window\.confirm\(/);
    expect(repairList).toContain("patch((t) => ({ ...t, allItems, rows: null }));");
    expect(repairList).toContain("onCheckedChange={setAllItems}");
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
    expect(affordance).toMatch(/onDoubleClick=\{\s*can && props\.doubleClick/);
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
