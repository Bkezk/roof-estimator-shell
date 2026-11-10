/**
 * Re-check, Nov 10 (docs/qa/recheck-service-takeoff-setup-roles-2026-11-10.md, Part 2, finding
 * 1): on most iPads held sideways the takeoff drawing got a small corner of the screen. The
 * editor opened in Focus only under NARROW_PX (1,100 px); an iPad Air (1,180), an iPad Pro 11
 * (1,194) and an iPad Pro 12.9 (1,366) are wider, so the menu, the Pages list and the side panel
 * all stayed open: 396 × 264 px of drawing on a 1,194 × 834 screen.
 *
 * Now a touch screen opens in Focus whatever its width (`panelsSlide`), once per visit; a
 * desktop with a mouse keeps the width rule; and the menu the editor folded on a wide touch
 * screen opens again when the takeoff is left.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { NARROW_PX, isNarrow, panelsSlide } from "./touch";

const read = (rel: string) => readFileSync(rel, "utf8");

describe("which screens open the takeoff in Focus", () => {
  it("every iPad, either way up, with a finger", () => {
    for (const width of [744, 810, 820, 834, 1024, 1080, 1133, 1180, 1194, 1366])
      expect(panelsSlide({ width, coarse: true })).toBe(true);
  });

  it("the three that stayed unfocused before: iPad Air, iPad Pro 11 and iPad Pro 12.9 sideways", () => {
    for (const width of [1180, 1194, 1366]) {
      expect(isNarrow(width)).toBe(false); // the old rule: not Focus
      expect(panelsSlide({ width, coarse: true })).toBe(true);
    }
  });

  it("a desktop with a mouse keeps the width rule", () => {
    expect(NARROW_PX).toBe(1100);
    expect(panelsSlide({ width: 1099, coarse: false })).toBe(true);
    expect(panelsSlide({ width: 1100, coarse: false })).toBe(false);
    expect(panelsSlide({ width: 1194, coarse: false })).toBe(false);
    expect(panelsSlide({ width: 1440, coarse: false })).toBe(false);
    expect(panelsSlide({ width: 2560, coarse: false })).toBe(false);
  });

  it("a big touch screen too: the finger decides, not the width", () => {
    expect(panelsSlide({ width: 1920, coarse: true })).toBe(true);
  });
});

describe("the editor uses the rule", () => {
  const editor = read("src/components/takeoff/editor.tsx");
  const screen = read("src/components/takeoff/use-screen.ts");

  it("use-screen reads the pointer and the width through panelsSlide, and follows the window", () => {
    expect(screen).toContain("export function usePanelsSlide(): boolean {");
    expect(screen).toContain(
      "const update = () => setSlide(panelsSlide({ width: window.innerWidth, coarse }));",
    );
    expect(screen).toContain('window.addEventListener("resize", update);');
  });

  it("the editor folds the pages, the panel and the menu once per visit when the rule says so", () => {
    expect(editor).toContain("const slide = usePanelsSlide();");
    expect(editor).toContain(
      "    if (!slide || slideApplied.current) return;\n    slideApplied.current = true;\n    setPagesOpen(false);\n    setPanelOpen(false);",
    );
    // The old wiring keyed on the width alone.
    expect(editor).not.toContain("if (!narrow || narrowApplied.current) return;");
  });

  it("the panels slide OVER the drawing and carry their own close buttons under the same rule", () => {
    expect(editor).toContain('const gridCols = slide\n    ? "minmax(0,1fr)"');
    expect(editor).toContain(
      'slide\n                ? "absolute inset-y-0 left-0 z-20 w-[220px] overflow-y-auto shadow-xl"',
    );
    expect(editor).toContain(
      'slide\n                ? "absolute inset-y-0 right-0 z-20 flex w-[min(380px,92vw)] flex-col overflow-hidden shadow-xl"',
    );
    expect(editor.match(/\{slide && \(/g)).toHaveLength(2);
    expect(editor).not.toContain("{narrow && (");
    expect(editor).toContain('data-slide={slide ? "" : undefined}');
  });

  it("the menu folded on a wide touch screen opens again on leaving; a narrow one stays folded", () => {
    expect(editor).toContain(
      "foldedWideMenu.current = navOpen && !isNarrow(window.innerWidth);\n      setNavOpen(false);",
    );
    expect(editor).toContain("if (foldedWideMenu.current) setNavOpenRef.current(true);");
  });

  it("leaving Focus is still the person's own toggle", () => {
    expect(editor).toContain("const focused = !pagesOpen && !panelOpen && (isMobile || !navOpen);");
    expect(editor).toContain("const toggleFocus = () => {");
  });
});
