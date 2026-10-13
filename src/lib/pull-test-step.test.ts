/**
 * The pull test box's arrows move by 25 lbs (owner, Oct 13: "the pull test arrows that adjust
 * the number on the form, can the arrows move it in increments of 25?") on both places the box
 * appears: the takeoff's Setup tab (the bid's default) and each section on the Sections screen.
 * Typing stays free: the box is a NumberField, whose onChange takes whatever is typed. Fails on
 * the old code (step "any" on Setup, no step on the section).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("the pull test arrows step by 25", () => {
  it("takeoff Setup tab", () => {
    const src = read("src/components/takeoff/setup-tab.tsx");
    const box = src.slice(src.indexOf('<Field label="Pull test (lbs)">'));
    const field = box.slice(0, box.indexOf("</Field>"));
    expect(field).toContain('step="25"');
    expect(field).not.toContain('step="any"');
  });
  it("each section on the Sections screen", () => {
    const src = read("src/components/sections-screen.tsx");
    const box = src.slice(src.indexOf('<Field label="Pull Test (lbs)">'));
    const field = box.slice(0, box.indexOf("</Field>"));
    expect(field).toContain('step="25"');
  });
  it("the number field passes step to the input and still accepts any typed number", () => {
    const src = read("src/components/ui/number-field.tsx");
    expect(src).toContain('step={props.step ?? "1"}');
    expect(src).toContain("const n = Number(t);");
  });
});
