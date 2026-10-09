/**
 * The Materials part of the Oct 9 batch. B5: a total typed for a material the shop never stocked
 * failed with "Only -0.001 … on the shelf" until the stock read caught up, then asked the short
 * question again on the next add — now a yes is remembered per cell for the ticket, the server's
 * stock refusal opens the same question instead of a red error, and a search chip's new line
 * scrolls into view with its count box focused. B6: the Usual-for chip for an item not on the
 * truck only warned; it runs the same add path (the short question / search path take over) and
 * the chips show without a vehicle, sourcing the shop. Each pin fails on the Oct 8 screen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isStockRefusal } from "@/lib/material-search";

const src = readFileSync("src/components/service/materials-section.tsx", "utf8");

describe("isStockRefusal: addMovement's stock check, and nothing else that starts with Only", () => {
  it("the shelf and a truck, whole and decimal counts, the −0.001 of a never-stocked cell", () => {
    expect(isStockRefusal("Only 0.5 box on the shelf")).toBe(true);
    expect(isStockRefusal("Only -0.001 EA on the shelf")).toBe(true);
    expect(isStockRefusal("Only 2 EA on Truck 2")).toBe(true);
    expect(isStockRefusal("Only 12 sq ft on Trace's truck")).toBe(true);
    expect(isStockRefusal("  Only 0 tube on the shelf ")).toBe(true);
  });
  it("other refusals stay loud", () => {
    expect(isStockRefusal("Only an estimator can adjust counts or write stock off")).toBe(false);
    expect(isStockRefusal("Only your own entries from the last 24 hours can be undone")).toBe(
      false,
    );
    expect(
      isStockRefusal("Only the technician on this ticket or a manager says who is on the job"),
    ).toBe(false);
    expect(isStockRefusal("Failed to fetch")).toBe(false);
    expect(isStockRefusal("")).toBe(false);
  });
  it("matches the server's message exactly as inventory.functions.ts builds it", () => {
    const inv = readFileSync("src/lib/inventory.functions.ts", "utf8");
    expect(inv).toContain(
      '`Only ${Math.round(onHand * 1000) / 1000} ${unit} ${location.kind === "shop" ? "on the shelf" : `on ${location.name}`}`',
    );
  });
});

describe("B5 the short-stock yes is remembered per cell; the server's refusal asks, not shouts", () => {
  const add = src.slice(
    src.indexOf("const add = (r: ListRow"),
    src.indexOf("/** Take `units` back"),
  );
  it("add() reads and writes shortOkCells, keyed by the cell, for this ticket's screen", () => {
    expect(src).toContain("const shortOkCells = useRef<Set<string>>(new Set());");
    expect(add).toMatch(
      /const ok = shortOk \|\| shortOkCells\.current\.has\(r\.key\);\s*if \(ok\) shortOkCells\.current\.add\(r\.key\);/,
    );
    expect(add).toContain("if (checkStock && !ok && units > onHand + EPS) {");
    expect(add).toContain('await record(r, units, "consumed", ok);');
  });
  it("a stock refusal from the server opens the short dialog for that row and units; yes resends with short_ok", () => {
    expect(src).toContain("import {\n  SEARCH_MIN_CHARS,\n  isStockRefusal,");
    expect(add).toMatch(
      /catch \(e\) \{[\s\S]*?if \(!ok && isStockRefusal\(errText\(e\)\)\) \{\s*setShort\(\{ r, units \}\);\s*return;\s*\}\s*throw e;/,
    );
    // The dialog's yes is unchanged: add(r, units, false, true) → ok → short_ok on the wire.
    expect(src).toContain("add(s.r, s.units, false, true);");
    expect(src).toContain("...(shortOk ? { short_ok: true } : {}),");
  });
  it("a search chip's add scrolls the new On this ticket line into view and focuses its count box", () => {
    expect(src).toMatch(/focusAfter\.current = r\.key;\s*add\(r, 1, src\.on_hand !== null\);/);
    expect(add).toMatch(
      /if \(focusAfter\.current === r\.key\) \{\s*focusAfter\.current = null;\s*setFocusKey\(r\.key\);\s*\}/,
    );
    expect(src).toMatch(
      /aria-label="On this ticket"[\s\S]*?<TruckRow[\s\S]*?focus=\{focusKey === r\.key\}\s*onFocused=\{clearFocus\}/,
    );
    const row = src.slice(src.indexOf("function TruckRow({"));
    expect(row).toMatch(
      /useEffect\(\(\) => \{\s*if \(!focus\) return;\s*const el = inputRef\.current;\s*el\?\.scrollIntoView\?\.\(\{ block: "center", behavior: "smooth" \}\);\s*el\?\.focus\(\);\s*onFocused\?\.\(\);/,
    );
    expect(row).toMatch(/<Input\s+ref=\{inputRef\}\s+type="number"/);
  });
});

describe("B6 the Usual-for chips", () => {
  const chips = src.slice(
    src.indexOf("{templates.map((t, i) => {"),
    src.indexOf('aria-label="On this ticket"'),
  );
  it("show without a vehicle, sourcing the shop", () => {
    expect(src).not.toContain("{vehicleId &&\n            templates.map(");
    expect(src).toContain(
      'const shopId = (locations.data ?? []).find((l) => l.kind === "shop")?.id ?? "shop";',
    );
    expect(chips).toContain("const usualLoc = vehicleId ?? shopId;");
    expect(chips).toContain("const key = cellKey({ ...u, location_id: usualLoc });");
  });
  it("an item the place does not show runs the same add path (the short question takes over) instead of a warning", () => {
    expect(chips).not.toContain("toast.warning(");
    expect(chips).not.toContain("take it from the shop or another truck");
    expect(chips).toMatch(
      /const target: ListRow = r \?\? \{\s*key,\s*location_id: usualLoc,[\s\S]*?on_hand: 0,[\s\S]*?location_name: locName\(usualLoc\),\s*\};\s*add\(target, round6\(want - have\)\);/,
    );
  });
});
