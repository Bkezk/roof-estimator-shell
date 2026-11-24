/**
 * Nov 24 (owner: the metals price box is editable on the bid). A number box sends 0 when it is
 * emptied. A metals price box must tell the two apart: an emptied box goes back to the list
 * price, a typed 0 is a price of $0. NumberField takes an `onBlank` for that; every other box
 * behaves as it did.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { numberFieldTyped } from "@/lib/number-field-view";

const flat = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\s+/g, " ");

describe("what the text typed into a number box means", () => {
  it("an emptied box, or one holding only a sign or a point, is blank", () => {
    for (const raw of ["", "   ", "-", ".", "-."]) expect(numberFieldTyped(raw, 0)).toBe("blank");
  });
  it("0 is a number, not blank", () => {
    expect(numberFieldTyped("0", 0)).toBe(0);
    expect(numberFieldTyped("0.00", 0)).toBe(0);
  });
  it("a number is kept between the box's limits", () => {
    expect(numberFieldTyped("12.5", 0)).toBe(12.5);
    expect(numberFieldTyped(" 7 ", 0)).toBe(7);
    expect(numberFieldTyped("-3", 0)).toBe(0);
    expect(numberFieldTyped("-3", -10)).toBe(-3);
    expect(numberFieldTyped("500", 0, 99.5)).toBe(99.5);
  });
  it("text that is not a number is ignored", () => {
    expect(numberFieldTyped("abc", 0)).toBeNull();
    expect(numberFieldTyped("1e999", 0)).toBeNull();
  });
});

describe("NumberField", () => {
  const src = flat("src/components/ui/number-field.tsx");
  it("tells a caller that asked about an emptied box, and sends 0 to every other", () => {
    expect(src).toContain("const typed = numberFieldTyped(raw, min, props.max);");
    expect(src).toContain(
      'if (typed === "blank") { if (props.onBlank) props.onBlank(); else props.onChange(Math.max(min, 0)); return; }',
    );
    expect(src).toContain("props.onChange(typed);");
  });
  it("can be named for a screen reader where no label sits beside it", () => {
    expect(src).toContain("aria-label={props.label}");
  });
});
