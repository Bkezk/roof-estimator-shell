/**
 * Owner, Nov 20: "two things on mobile if youre marking it up, the tags pop up box is half off
 * screen."
 *
 * On the aerial the tag's menu was a 320 px box opened beside the tag, so on a phone half of it
 * ran off the side of the screen (measured at 390 px: it reached from 153 to 473). On a phone it
 * is now a sheet pinned to the bottom of the screen, as the photo tool's already was, and both
 * sheets ride on top of the keyboard instead of sitting behind it (lib/keyboard-inset.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  KEYBOARD_GAP_PX,
  SPOT_CLEAR_PX,
  keyboardInset,
  scrollToClearSpot,
  sheetStyleFor,
} from "@/lib/keyboard-inset";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("how far a bottom sheet rises for the keyboard", () => {
  it("an iPhone with the keyboard up: the page keeps its height, less of it shows", () => {
    // 844 tall, the keyboard covers the bottom 336.
    expect(keyboardInset({ innerHeight: 844, visual: { height: 508, offsetTop: 0 } })).toEqual({
      bottom: 336,
      visible: 508,
    });
    // The browser has also pushed the page up by 40 to show the box being typed in.
    expect(keyboardInset({ innerHeight: 844, visual: { height: 508, offsetTop: 40 } })).toEqual({
      bottom: 296,
      visible: 508,
    });
  });
  it("no keyboard, a page that got shorter by itself, or a browser that cannot say: nothing", () => {
    expect(keyboardInset({ innerHeight: 844, visual: { height: 844, offsetTop: 0 } }).bottom).toBe(
      0,
    );
    // Android here: the page itself is shorter, so the two heights agree.
    expect(keyboardInset({ innerHeight: 508, visual: { height: 508, offsetTop: 0 } }).bottom).toBe(
      0,
    );
    expect(keyboardInset({ innerHeight: 844, visual: null })).toEqual({ bottom: 0, visible: 844 });
    expect(keyboardInset({ innerHeight: 844 })).toEqual({ bottom: 0, visible: 844 });
    // A pixel or two is rounding, not a keyboard.
    expect(
      keyboardInset({ innerHeight: 844, visual: { height: 842.4, offsetTop: 0 } }).bottom,
    ).toBe(0);
  });
  it("a pinched-in page is not a keyboard", () => {
    expect(
      keyboardInset({ innerHeight: 844, visual: { height: 422, offsetTop: 100, scale: 2 } }),
    ).toEqual({ bottom: 0, visible: 844 });
  });
  it("the sheet's style: lifted onto the keys, no taller than what shows; nothing with no keyboard", () => {
    expect(sheetStyleFor({ bottom: 0, visible: 844 })).toBeUndefined();
    expect(sheetStyleFor({ bottom: 336, visible: 508 })).toEqual({
      bottom: "336px",
      maxHeight: `${508 - KEYBOARD_GAP_PX}px`,
    });
    // A very short screen still leaves the box and its button.
    expect(sheetStyleFor({ bottom: 300, visible: 90 })?.maxHeight).toBe("120px");
  });
});

describe("the spot being tagged is kept clear of the sheet", () => {
  it("a spot under the sheet moves up to sit just above it", () => {
    // The sheet's top is at 540; the spot was tapped at 600.
    expect(scrollToClearSpot({ spotY: 600, sheetTop: 540 })).toBe(600 - (540 - SPOT_CLEAR_PX));
  });
  it("a spot already clear is left where it is", () => {
    expect(scrollToClearSpot({ spotY: 300, sheetTop: 540 })).toBe(0);
    expect(scrollToClearSpot({ spotY: 540 - SPOT_CLEAR_PX, sheetTop: 540 })).toBe(0);
  });
  it("it is never pushed off the top of the screen", () => {
    // A short screen: the sheet's top is at 198, the header is 56 tall.
    const by = scrollToClearSpot({ spotY: 250, sheetTop: 198, topLimit: 56 });
    expect(by).toBe(88);
    expect(250 - by).toBeGreaterThanOrEqual(56);
    expect(scrollToClearSpot({ spotY: 60, sheetTop: 40, topLimit: 56 })).toBe(0);
  });
});

describe("the aerial's tag and text on a phone: a bottom sheet, never the side box", () => {
  const src = flat("src/components/service/aerial-markup.tsx");
  it("a phone gets the sheet for both; a computer keeps the box beside the tag", () => {
    expect(src).toContain("const coarse = useMemo(() => coarsePointer(), []);");
    const phone = src.slice(
      src.indexOf("if (coarse) return ("),
      src.indexOf('if (pending.kind === "pin")'),
    );
    expect(phone.length).toBeGreaterThan(200);
    expect(phone).toContain(
      "<Sheet open modal={false} onOpenChange={(o) => !o && setPending(null)}>",
    );
    expect(phone).toContain('side="bottom"');
    expect(phone).toContain("style={sheetStyleFor(keyboard)}");
    expect(phone).toContain('data-sheet="place-label"');
    expect(phone).not.toContain("<Popover");
    // The computer's box is still there, after the phone's branch.
    expect(src).toContain("side={popoverSide(x, view.width)}");
    expect(src).toContain('className="w-80 p-3"');
  });
  it("it is whole on any phone: full width at the bottom, capped, and scrolls inside", () => {
    expect(src).toContain(
      'className="max-h-[70vh] overflow-y-auto rounded-t-xl px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-neutral-700 [&>button]:right-1 [&>button]:top-1 [&>button]:flex [&>button]:h-[44px] [&>button]:w-[44px] [&>button]:items-center [&>button]:justify-center"',
    );
  });
  it("the picture is not dimmed, and the page moves so the tag shows above the sheet", () => {
    // Not a modal: no dark layer over the picture.
    expect(src).toContain("modal={false}");
    expect(src).toContain('data-spot="new-label"');
    expect(src).toContain(
      "const by = scrollToClearSpot({ spotY: at.top, sheetTop: window.innerHeight - keyboard.bottom - box.offsetHeight, topLimit: 56, });",
    );
    expect(src).toContain('if (by > 0) window.scrollBy({ top: by, behavior: "smooth" });');
  });
  it("a tap on the picture moves the tag and keeps what was typed; a tap elsewhere keeps a labelled one", () => {
    expect(src).toContain(
      'coarse && pending && pending.kind === kind ? { ...pending, at } : { kind, at, label: "" },',
    );
    expect(src).toContain(
      "if (t instanceof Node && stageBox.current?.contains(t)) { e.preventDefault(); return; }",
    );
    expect(src).toContain('addPending({ label: pending.label, note: "" });');
  });
  it("a tag does not raise the keyboard by itself; a text does", () => {
    expect(src).toContain(
      'e.preventDefault(); if (pending.kind === "text") sheetInput.current?.focus();',
    );
  });
  it("every button in the sheet is a thumb: 44 px, not the smaller rem sizes", () => {
    const form = src.slice(
      src.indexOf("if (phone) return ("),
      src.indexOf('<p className="text-sm font-medium">{kind === "pin" ? "New tag here"'),
    );
    expect(form.length).toBeGreaterThan(200);
    expect(form.match(/h-\[44px\]/g)!.length).toBeGreaterThanOrEqual(5);
    expect(form).not.toMatch(/\bh-(8|9|10|11)\b/);
    expect(form).toContain('data-chips="presets"');
    expect(form).toContain('data-action="add-note"');
  });
});

describe("the photo tool's sheet", () => {
  const src = flat("src/components/service/photo-markup.tsx");
  it("rides on the keyboard too, and its buttons are a thumb", () => {
    expect(src).toContain("const keyboard = useKeyboardInset(coarse && !!pending);");
    expect(src).toContain("style={sheetStyleFor(keyboard)}");
    expect(src).toContain('className={compact ? "h-[44px] px-3" : "h-9 sm:h-8"}');
    expect(src).toContain('className={compact ? "h-[44px] text-base" : "h-11 text-base sm:h-10"}');
    expect(src).toContain('className={compact ? "h-[44px] px-4" : "h-11 sm:h-9"}');
  });
});
