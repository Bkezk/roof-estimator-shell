/**
 * Picking several ticket photos (owner, Oct 28: fewer taps; lib/photo-select.ts): a long press or
 * a modifier click enters the mode, a tap toggles, letting go of the last leaves; only loose
 * "other" photos can be attached to a checklist item. The thumb's and the bar's wiring is pinned
 * to its source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  attachable,
  enterSelect,
  LONG_PRESS_MS,
  NO_SELECTION,
  pruneSelect,
  removeQuestion,
  selectedLabel,
  thumbPress,
  toggleSelect,
} from "./photo-select";

describe("the select mode", () => {
  it("enters with the pressed photo, toggles others, and leaves when the last is let go", () => {
    let s = enterSelect("a");
    expect(s).toEqual({ on: true, ids: ["a"] });
    s = toggleSelect(s, "b");
    expect(s.ids).toEqual(["a", "b"]);
    s = toggleSelect(s, "a");
    expect(s.ids).toEqual(["b"]);
    s = toggleSelect(s, "b");
    expect(s).toEqual(NO_SELECTION);
    expect(s.on).toBe(false);
  });
  it("drops photos deleted elsewhere; none left leaves the mode; nothing changes when all exist", () => {
    const s = toggleSelect(enterSelect("a"), "b");
    expect(pruneSelect(s, ["a", "b", "c"])).toBe(s);
    expect(pruneSelect(s, ["b"])).toEqual({ on: true, ids: ["b"] });
    expect(pruneSelect(s, [])).toEqual(NO_SELECTION);
    expect(pruneSelect(NO_SELECTION, [])).toBe(NO_SELECTION);
  });
});

describe("thumbPress — what a press on a thumbnail means", () => {
  it("a plain tap opens the lightbox", () => {
    expect(thumbPress(false, {}, false)).toBe("open");
  });
  it("a long press (a finger) or Shift / Ctrl / ⌘ + click (a mouse) enters the mode", () => {
    expect(thumbPress(false, {}, true)).toBe("enter");
    expect(thumbPress(false, { shiftKey: true }, false)).toBe("enter");
    expect(thumbPress(false, { ctrlKey: true }, false)).toBe("enter");
    expect(thumbPress(false, { metaKey: true }, false)).toBe("enter");
  });
  it("in the mode every press toggles, modifiers or not", () => {
    expect(thumbPress(true, {}, false)).toBe("toggle");
    expect(thumbPress(true, { shiftKey: true }, false)).toBe("toggle");
    expect(thumbPress(true, {}, true)).toBe("toggle");
  });
  it("a long press is half a second", () => {
    expect(LONG_PRESS_MS).toBe(500);
  });
});

describe("attachable — the server's rule for a photo on a checklist item", () => {
  it("only loose 'other' photos (no repair); never a Before / After, a signature, or nothing", () => {
    expect(attachable([{ role: "other", repair_id: null }])).toBe(true);
    expect(
      attachable([
        { role: "other", repair_id: null },
        { role: "other", repair_id: null },
      ]),
    ).toBe(true);
    expect(
      attachable([
        { role: "other", repair_id: null },
        { role: "before", repair_id: "r1" },
      ]),
    ).toBe(false);
    expect(attachable([{ role: "other", repair_id: "r1" }])).toBe(false);
    expect(attachable([{ role: "signature", repair_id: null }])).toBe(false);
    expect(attachable([])).toBe(false);
  });
});

describe("words", () => {
  it("'3 selected', 'Remove this photo?' / 'Remove 3 photos?'", () => {
    expect(selectedLabel(3)).toBe("3 selected");
    expect(removeQuestion(1)).toBe("Remove this photo?");
    expect(removeQuestion(3)).toBe("Remove 3 photos?");
  });
});

describe("the thumbnail and the bar (pinned to their source)", () => {
  const shared = readFileSync("src/components/service/field-shared.tsx", "utf8");
  const thumb = shared.slice(
    shared.indexOf("export function PhotoThumb("),
    shared.indexOf("// Time entries"),
  );
  const bar = readFileSync("src/components/service/photo-select-bar.tsx", "utf8");
  const fold = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");
  const closeout = readFileSync("src/components/service/closeout.tsx", "utf8");
  it("the thumb enters on a touch long press (LONG_PRESS_MS) or a modifier click, toggles in the mode, hides its delete X and keeps the browser's image menu away", () => {
    expect(thumb).toMatch(/if \(!select \|\| select\.on \|\| e\.pointerType !== "touch"\) return;/);
    expect(thumb).toMatch(
      /window\.setTimeout\(\(\) => \{[\s\S]*?select\.onPress\("enter"\);[\s\S]*?\}, LONG_PRESS_MS\)/,
    );
    expect(thumb).toMatch(/const how = thumbPress\(!!select\?\.on, e, false\);/);
    expect(thumb).toContain("{onDelete && !select?.on && (");
    expect(thumb).toMatch(/onContextMenu=\{\(e\) => \{\s*if \(select\) e\.preventDefault\(\);/);
    expect(thumb).toMatch(/aria-pressed=\{select\?\.on \? select\.selected : undefined\}/);
  });
  it("the bar offers Remove (asks once), Attach to inspection item (loose photos only), Download and Cancel, and stays in reach (sticky)", () => {
    expect(bar).toContain('data-line="photo-select-bar"');
    expect(bar).toMatch(/className="sticky bottom-2 z-10/);
    expect(bar).toMatch(/if \(!window\.confirm\(removeQuestion\(n\)\)\) return;/);
    expect(bar).toMatch(/const canAttach = attachable\(selected\);/);
    expect(bar).toMatch(/\{canAttach && \([\s\S]*?Attach to inspection item/);
    expect(bar).toContain("await downloadPhoto(p, ticketNumber, ord.get(p.id) ?? i + 1);");
    expect(bar).toMatch(/aria-label="Cancel the selection"/);
    // Attach goes through setJobPhotoItem per photo (useSetPhotoItem), the item picked from the
    // ticket's checklist rows (getTicketInspection → mergeChecklist / visibleChecklist).
    expect(bar).toMatch(
      /setItem\.mutate\(\s*(\/\/[^\n]*\n\s*)?\{ ids: selected\.map\(\(p\) => p\.id\), item_key: itemKey, attach: true \}/,
    );
    expect(bar).toContain("visibleChecklist(mergeChecklist(q.data.inspection, q.data.checklist))");
  });
  it("the Photos & repairs fold and the close-out's repair strips hand the thumbs a select and show the bar", () => {
    for (const src of [fold, closeout]) {
      expect(src).toMatch(
        /setSel\(how === "enter" \? enterSelect\(p\.id\) : toggleSelect\(selection, p\.id\)\)/,
      );
      expect(src).toMatch(/<PhotoSelectBar[\s\S]*?onClear=\{\(\) => setSel\(NO_SELECTION\)\}/);
    }
    // The office fold picks only for an editor.
    expect(fold).toMatch(/select=\{\s*canEdit\s*\?/);
  });
});
