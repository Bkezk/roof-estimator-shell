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
    expect(src).toContain("const showPicker = rows.length === 0 || pickerOpen;");
    expect(src).toMatch(/\{!showPicker && \(\s*<Button[\s\S]*?Add another repair/);
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
  it("eight chips, then Show all N / Show fewer (not while searching)", () => {
    expect(src).toContain("const PICKER_CHIPS = 8;");
    expect(src).toContain(
      "const chipRows = allChips || q.length >= 2 ? favRows : favRows.slice(0, PICKER_CHIPS);",
    );
    expect(src).toMatch(/\{favRows\.length > PICKER_CHIPS && q\.length < 2 && \(/);
    expect(src).toContain('{allChips ? "Show fewer" : `Show all ${favRows.length}`}');
    expect(src).not.toMatch(/\{favRows\.map\(\(t\) => \(\s*<Chip/);
  });
});
