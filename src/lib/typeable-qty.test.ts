/**
 * Owner, Oct 9: "the forms dont need to be arrow single increments, they need to be able to type
 * in them." The truck row's count between − and + is an always-visible typeable box (blank when
 * nothing is used), committed on blur and Enter; the tap-the-number-to-reveal-a-form pattern is
 * gone. Every other number on the close-out already types (NumberField). These fail on the old
 * TruckRow ("Tap to type a number", "Used in all").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/service/materials-section.tsx", "utf8");
const row = src.slice(src.indexOf("function TruckRow({"));

describe("TruckRow", () => {
  it("has a typeable number box between − and +, blank when nothing is used", () => {
    expect(row).toContain('const shown = used > EPS ? fmtNum(used) : "";');
    const minus = row.indexOf("of ${cellName(row)} fewer`}");
    const box = row.indexOf('type="number"');
    const plus = row.indexOf("of ${cellName(row)} more`}");
    expect(minus).toBeGreaterThan(0);
    expect(box).toBeGreaterThan(minus);
    expect(plus).toBeGreaterThan(box);
    expect(row).toContain('inputMode="decimal"');
    expect(row).toContain("min={0}");
    expect(row).toContain('step="any"');
    expect(row).toContain("h-12 w-16 px-1 text-center");
    expect(row).toContain("value={text ?? shown}");
  });
  it("commits on blur and on Enter through onSet, rounded to 3 dp, loud on a non-number", () => {
    expect(row).toContain("onBlur={commit}");
    expect(row).toMatch(
      /if \(e\.key === "Enter"\) \{\s*e\.preventDefault\(\);\s*e\.currentTarget\.blur\(\);/,
    );
    expect(row).toContain("onSet(Math.round(n * 1000) / 1000);");
    expect(row).toContain(
      'loudError("Type how many", new Error(`a number of ${unitLabel(2, row.piece, row.unit)}`));',
    );
    // A blank or unchanged box changes nothing (never "set to 0" by accident).
    expect(row).toContain("if (!t || t === shown) return;");
  });
  it("no reveal form any more; − and + stay as one-unit nudges", () => {
    expect(src).not.toContain("Tap to type a number");
    expect(src).not.toContain("Used in all");
    expect(src).not.toContain("setTyping(");
    expect(row).toContain("onClick={() => onReduce(Math.min(1, used))}");
    expect(row).toContain("onClick={() => onAdd(1)}");
  });
});

describe("the rest of the close-out types its numbers", () => {
  it("repair quantity and hours are NumberFields; no number is nudge-only", () => {
    const closeout = readFileSync("src/components/service/closeout.tsx", "utf8");
    const shared = readFileSync("src/components/service/field-shared.tsx", "utf8");
    expect(closeout).toMatch(/<NumberField\s+value=\{vals\.quantity\}/);
    expect(shared).toMatch(/<NumberField\s+value=\{vals\.hours\}/);
    for (const s of [closeout, shared]) expect(s).not.toContain("<Minus ");
  });
});
