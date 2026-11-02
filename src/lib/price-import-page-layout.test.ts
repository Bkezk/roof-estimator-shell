/**
 * Price List Import page (owner, Nov 2: "match via item number only ... items that are a
 * suspected match it lists and items that have no suspected match it lists and easy way to
 * associate them properly"). Pins the page's shape by reading its source, as
 * accessory-families-ui.test.ts does: three lists after the file step, Link / Not this / Skip,
 * and none of the old name cross-checks, Confirm-mapping button or gap-suggestion checkbox.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/components/price-import-page.tsx", "utf8");

describe("Price List Import page layout", () => {
  it("shows three lists in order: matched by item number, likely matches, no match found", () => {
    const a = page.indexOf("2. Matched by item number");
    const b = page.indexOf("3. Likely matches (");
    const c = page.indexOf("4. No match found (");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(page).toContain("triageUnmatched({");
  });
  it("likely matches get Link / Not this; no-match lines get Link / Skip and a small add-as-new link", () => {
    expect(page).toContain("onClick={() => void link(p)}");
    expect(page).toContain("Not this");
    expect(page).toContain("onSkip: (it: SheetItem) => void;");
    expect(page).toContain("add as new product");
    expect(page).toContain("strong");
    expect(page).toContain("possible");
  });
  it("drops the name cross-checks, the Confirm-mapping button and the gap-suggestion checkbox", () => {
    for (const gone of [
      "crossCheck(",
      "Confirm mapping",
      "suggestSheetLine(",
      "suggestCatalogRow(",
      "Also list products with no suggestion",
      "nameDiffers",
      "descChanged",
      "SheetSearch",
    ])
      expect(page, gone).not.toContain(gone);
  });
  it("keeps the one warning that matters — a price swing past ×2 / ÷2 — on the review", () => {
    expect(page).toContain("const isSuspect = (p: PlannedUpdate) => bigSwing(p.current, p.next);");
    expect(page).toContain("Review &amp; confirm price update");
    expect(page).toContain("function ImportHistory()");
  });
});
