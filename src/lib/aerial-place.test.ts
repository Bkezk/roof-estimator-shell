/**
 * Tags and text placed right on the ticket Aerial (owner, Oct 8): the tag shows as soon as the
 * picture is clicked with its menu beside it; the text box opens at the click.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { placePercent, popoverSide, textBoxWidthCh } from "./aerial-place";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const view = { width: 800, height: 600 };

describe("placing over the picture", () => {
  it("a view point becomes the same fraction of the picture's box", () => {
    expect(placePercent(400, 300, view)).toEqual({ left: "50.000%", top: "50.000%" });
    expect(placePercent(0, 0, view)).toEqual({ left: "0.000%", top: "0.000%" });
    expect(placePercent(200, 150, view)).toEqual({ left: "25.000%", top: "25.000%" });
    // Off the picture clamps to its edge.
    expect(placePercent(-5, 900, view)).toEqual({ left: "0.000%", top: "100.000%" });
  });
  it("the tag's menu opens to the right until the tag nears the right edge", () => {
    expect(popoverSide(100, 800)).toBe("right");
    expect(popoverSide(479, 800)).toBe("right");
    expect(popoverSide(480, 800)).toBe("left");
    expect(popoverSide(790, 800)).toBe("left");
  });
  it("the text box grows with what is typed", () => {
    expect(textBoxWidthCh("")).toBe(6);
    expect(textBoxWidthCh("Leak")).toBe(6);
    expect(textBoxWidthCh("Leak over office")).toBe(17);
  });
  it("the component: the tag is drawn at once, its menu is a popover beside it, the text box sits on the picture — nothing below it", () => {
    const src = read("../components/service/aerial-markup.tsx");
    // The provisional pin on the SVG while its menu is open, with the next number and the label as typed.
    expect(src).toContain('{draft && draft.kind === "pin" && (');
    expect(src).toContain("{numbers.size + 1}");
    // The menu: a popover anchored to the pin's spot over the picture, opening beside it.
    expect(src).toContain("<PopoverAnchor asChild>");
    expect(src).toContain("side={popoverSide(x, view.width)}");
    expect(src).toContain("placePercent(x, y, view)");
    // The text box: an input at the click, Enter adds, Esc drops, growing with the text.
    expect(src).toContain('aria-label="Text on the picture"');
    expect(src).toContain("width: `${textBoxWidthCh(pending.label)}ch`");
    expect(src).toContain('if (e.key === "Enter")');
    expect(src).toContain('if (e.key === "Escape")');
    // The old form under the lists is gone; the picture's box carries the overlay.
    expect(src).not.toMatch(/\{pending && canEdit && \(\s*<PlaceForm/);
    expect(src).toMatch(/className="relative mx-auto"/);
    expect(src).toContain("{children}");
  });
});
