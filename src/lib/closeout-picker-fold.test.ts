/**
 * Owner, Oct 9 ("the repairs look the same?"): the compact repair rows landed, but what filled
 * the screen was the picker — the roof-type chips and thirty tap-to-add chips. Now the picker
 * folds behind "Add another repair" once a repair is on the ticket (open on an empty ticket),
 * the search sits first, and the chips show eight until "Show all N".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/service/closeout.tsx", "utf8");

describe("the repair picker folds", () => {
  it("open on an empty ticket, folded behind Add another repair once a repair exists", () => {
    // Owner, Oct 9 (steps): the picker is step 2's (Before) — never in step 3's The work.
    expect(src).toContain("const showPicker = before && (rows.length === 0 || pickerOpen);");
    expect(src).toMatch(/\{before && !showPicker && \(\s*<Button[\s\S]*?Add another repair/);
    expect(src).toMatch(/\{showPicker && \(\s*<div className="space-y-3">/);
    // Adding a repair folds it again.
    expect(src).toMatch(
      /setExpanded\(row\.id\);\s*setPickerOpen\(false\);\s*setAllChips\(false\);/,
    );
    expect(src).toContain("Done adding");
  });
  it("the search box comes first in the picker", () => {
    const picker = src.slice(
      src.indexOf("{showPicker && ("),
      src.indexOf('aria-label="Roof type"'),
    );
    expect(picker).toContain('placeholder="Search all repairs…"');
  });
  it("eight chips, then Show all N / Show fewer (the chip block is hidden while searching)", () => {
    expect(src).toContain("const PICKER_CHIPS = 8;");
    // Owner, Oct 9 (S5): typing no longer expands the chips — the whole block hides and the
    // matches sit under the search box (closeout-batch-oct9.test.ts).
    expect(src).toContain("const chipRows = allChips ? favRows : favRows.slice(0, PICKER_CHIPS);");
    expect(src).not.toContain("allChips || q.length >= 2");
    expect(src).toMatch(/\{favRows\.length > PICKER_CHIPS && \(/);
    expect(src).toContain('{allChips ? "Show fewer" : `Show all ${favRows.length}`}');
    expect(src).not.toMatch(/\{favRows\.map\(\(t\) => \(\s*<Chip/);
  });
});
