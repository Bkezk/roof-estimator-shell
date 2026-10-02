/**
 * Owner's rule: a number box starts blank and never shows a 0 — not a value, not a grey
 * placeholder (Oct 2: the opportunity's Est. value showed one; NumberField's default placeholder
 * was "0" everywhere).
 */
import { describe, expect, it } from "vitest";

import { numberFieldView } from "./number-field-view";

describe("numberFieldView: blank for 0, no placeholder 0", () => {
  it("a 0 shows as an empty box with no placeholder at all", () => {
    expect(numberFieldView({ value: 0 })).toEqual({ text: "", placeholder: undefined });
    expect(numberFieldView({ value: NaN })).toEqual({ text: "", placeholder: undefined });
  });
  it("a real value shows; a caller's own placeholder text is kept", () => {
    expect(numberFieldView({ value: 12.5 })).toEqual({ text: "12.5", placeholder: undefined });
    expect(numberFieldView({ value: 0, placeholder: "e.g. 3" })).toEqual({
      text: "",
      placeholder: "e.g. 3",
    });
  });
  it("blankZero: false (where a visible 0 matters) shows the 0 as text, still no placeholder", () => {
    expect(numberFieldView({ value: 0, blankZero: false })).toEqual({
      text: "0",
      placeholder: undefined,
    });
  });
  it("the component takes its placeholder from the view (no hard-coded 0 left)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/ui/number-field.tsx", "utf8");
    expect(src).toContain("placeholder={view.placeholder}");
    expect(src).not.toMatch(/placeholder=\{[^}]*"0"/);
    expect(readFileSync("src/lib/number-field-view.ts", "utf8")).not.toContain('"0"');
  });
});
