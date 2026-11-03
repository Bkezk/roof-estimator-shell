/**
 * Owner, Nov 3: "ensure everything is as easy to use as possible on an ipad … go with all of
 * them." The seven iPad changes, each pinned so the old code fails:
 *   1. a narrow screen opens the editor in Focus; the pages list and the side panel slide over
 *      the drawing;
 *   2. a bar of buttons stands in for Enter / Backspace / Esc and typed lengths while drawing;
 *   3. finger-sized buttons and a wider hit area round handles and pins on a coarse pointer;
 *   4. one finger pans with the Select tool; "Pencil draws" makes a finger pan with any tool;
 *   5. the "?" button reads "Help" on touch (tooltips never open there);
 *   6. autosave flushes when the page goes to the background;
 *   7. the Ctrl K badge hides on touch; the app menu starts folded on a narrow screen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  NARROW_PX,
  TAP_PX,
  TOUCH_BUTTON_CLASS,
  TOUCH_HIT_PX,
  TOUCH_TARGET_PX,
  isNarrow,
  parsePencilPref,
  touchDrawBar,
  type DrawBarContext,
} from "./touch";

const read = (rel: string) => readFileSync(rel, "utf8");
const ctx = (over: Partial<DrawBarContext>): DrawBarContext => ({
  touch: true,
  tool: "area",
  draftPoints: 0,
  countSession: false,
  busy: false,
  scaled: true,
  ...over,
});

describe("1. a narrow screen (an iPad either way up)", () => {
  it("is anything under 1100 px", () => {
    expect(NARROW_PX).toBe(1100);
    expect(isNarrow(810)).toBe(true); // iPad upright
    expect(isNarrow(1024)).toBe(true); // iPad sideways
    expect(isNarrow(1194)).toBe(false); // iPad Pro 11 sideways
    expect(isNarrow(1440)).toBe(false);
  });
  it("the editor opens in Focus and its panels slide over the drawing", () => {
    const editor = read("src/components/takeoff/editor.tsx");
    expect(editor).toContain("const narrow = useNarrowScreen();");
    expect(editor).toContain("const touch = useCoarsePointer();");
    expect(editor).toContain(
      "    if (!narrow || narrowApplied.current) return;\n    narrowApplied.current = true;\n    setPagesOpen(false);\n    setPanelOpen(false);\n    if (!isMobile) setNavOpen(false);",
    );
    expect(editor).toContain('? "minmax(0,1fr)"');
    expect(editor).toContain(
      '"absolute inset-y-0 left-0 z-20 w-[220px] overflow-y-auto shadow-xl"',
    );
    expect(editor).toContain(
      '"absolute inset-y-0 right-0 z-20 flex w-[min(380px,92vw)] flex-col overflow-hidden shadow-xl"',
    );
    expect(editor).toContain('aria-label="Hide the pages list"');
    expect(editor).toContain('aria-label="Hide the side panel"');
    expect(editor).toContain("touch={touch}");
  });
});

describe("2. the drawing bar on a touch screen", () => {
  it("shows nothing on a mouse, nothing with nothing in progress, nothing while Edge or stamping is on", () => {
    expect(touchDrawBar(ctx({ touch: false, draftPoints: 2 }))).toBeNull();
    expect(touchDrawBar(ctx({ draftPoints: 0 }))).toBeNull();
    expect(touchDrawBar(ctx({ draftPoints: 2, busy: true }))).toBeNull();
  });
  it("Close for an area with three corners, Finish for a line with two, Done for a penetration session", () => {
    expect(touchDrawBar(ctx({ draftPoints: 1 }))).toEqual({
      finish: null,
      undo: true,
      cancel: true,
      length: true,
    });
    expect(touchDrawBar(ctx({ draftPoints: 3 }))!.finish).toBe("Close");
    expect(touchDrawBar(ctx({ tool: "cutout", draftPoints: 3 }))!.finish).toBe("Close");
    expect(touchDrawBar(ctx({ tool: "linear", draftPoints: 1 }))!.finish).toBeNull();
    expect(touchDrawBar(ctx({ tool: "linear", draftPoints: 2 }))!.finish).toBe("Finish");
    expect(touchDrawBar(ctx({ tool: "count", countSession: true }))).toEqual({
      finish: "Done",
      undo: false,
      cancel: true,
      length: false,
    });
    // No scale: no typed lengths. Scale / Dimension: Cancel and Undo point only.
    expect(touchDrawBar(ctx({ draftPoints: 1, scaled: false }))!.length).toBe(false);
    expect(touchDrawBar(ctx({ tool: "scale", draftPoints: 1 }))).toEqual({
      finish: null,
      undo: true,
      cancel: true,
      length: false,
    });
  });
  it("the viewer wires the buttons to finish, backspace, cancel and the typed length", () => {
    const viewer = read("src/components/takeoff/viewer.tsx");
    expect(viewer).toContain("const bar = touchDrawBar({");
    expect(viewer).toContain("data-draw-bar");
    expect(viewer).toContain("onClick={() => finish()}");
    expect(viewer).toContain("onClick={() => backspace()}");
    expect(viewer).toContain("onClick={() => cancel()}");
    expect(viewer).toContain("onChange={(e) => setTyped(e.target.value.slice(0, 16))}");
    expect(viewer).toContain('placeholder="Length 24\'6, or size 40 x 120"');
    // The status chip (which talks of Enter and right-click) gives way to the bar.
    expect(viewer).toContain("{status && !bar && (");
  });
});

describe("3. finger-sized targets", () => {
  it("44 px buttons in the toolbar and the editor, a 22 px hit circle round handles and pins", () => {
    expect(TOUCH_TARGET_PX).toBe(44);
    expect(TOUCH_HIT_PX).toBe(22);
    const toolbar = read("src/components/takeoff/toolbar.tsx");
    // Pixels, not rem: the app's root font is 13 px, so min-h-11 would be 36 px.
    expect(toolbar).toContain('${props.touch ? TOUCH_BUTTON_CLASS : ""}');
    expect(TOUCH_BUTTON_CLASS).toBe(
      "[&_button:not([role=switch]):not([role=checkbox])]:min-h-[44px] [&_button:not([role=switch]):not([role=checkbox])]:min-w-[44px]",
    );
    const editor = read("src/components/takeoff/editor.tsx");
    expect(editor).toContain('touch ? TOUCH_BUTTON_CLASS : ""');
    const viewer = read("src/components/takeoff/viewer.tsx");
    expect(viewer).not.toMatch(/data-draw-bar[\s\S]{0,900}className="h-11/);
    const overlay = read("src/components/takeoff/overlay.tsx");
    expect(overlay).toContain(
      "const hit = props.touch && props.interactive ? TOUCH_HIT_PX / zoom : null;",
    );
    expect(overlay.match(/data-touch-hit/g)).toHaveLength(2);
    expect(overlay).toContain('fill="transparent"');
  });
});

describe("4. one finger pans; Pencil draws", () => {
  it("the toggle is remembered; a finger that moves pans in Select or with Pencil draws on", () => {
    expect(TAP_PX).toBe(10);
    expect(parsePencilPref("true")).toBe(true);
    expect(parsePencilPref("false")).toBe(false);
    expect(parsePencilPref(null)).toBe(false);
    const viewer = read("src/components/takeoff/viewer.tsx");
    expect(viewer).toContain('(tool === "select" || pencilOnly) &&');
    expect(viewer).toContain("panRef.current = { sx: tap.sx, sy: tap.sy, x: view.x, y: view.y };");
    expect(viewer).toContain('const places = !(pencilOnly && tool !== "select");');
    expect(viewer).toContain('const fingerPans = pencilOnly && e.pointerType === "touch";');
    expect(viewer).toContain(
      "pencil={props.touch ? { on: pencilOnly, onToggle: togglePencil } : null}",
    );
    const toolbar = read("src/components/takeoff/toolbar.tsx");
    expect(toolbar).toContain('name="Pencil draws"');
  });
});

describe("5. help on touch", () => {
  it('the "?" button carries the word Help on a touch screen', () => {
    const toolbar = read("src/components/takeoff/toolbar.tsx");
    expect(toolbar).toContain('{props.touch && <span className="text-xs">Help</span>}');
  });
});

describe("6. autosave flushes when the page goes to the background", () => {
  it("listens for visibilitychange (hidden) and pagehide", () => {
    const hook = read("src/components/takeoff/use-autosave.ts");
    expect(hook).toContain('if (document.visibilityState === "hidden") void flush();');
    expect(hook).toContain('document.addEventListener("visibilitychange", onHide);');
    expect(hook).toContain('window.addEventListener("pagehide", onHide);');
  });
});

describe("7. the small things", () => {
  it("the Ctrl K badge hides on a coarse pointer; the app menu starts folded on a narrow screen", () => {
    expect(read("src/components/global-search.tsx")).toContain("[@media(pointer:coarse)]:hidden");
    const gate = read("src/components/auth-gate.tsx");
    expect(gate).toContain("function NarrowMenuDefault()");
    expect(gate).toContain("if (isNarrow(window.innerWidth)) setOpen(false);");
    expect(gate).toContain("<NarrowMenuDefault />");
  });
});
