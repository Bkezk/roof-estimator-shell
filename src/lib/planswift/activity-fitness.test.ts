/**
 * The owner's "Activity & Fitness Center.xlsx" (Nov 4): "it's not really taking in the
 * downspouts, drops and A style 45s correctly". One sheet row carried four things —
 * `4" X 5" Down Souts, 2 Drops, 6 A style 45's, 10' of Gutter strap` at 22.99 ft — and the
 * importer read it as one thing: the word "gutter" made it a gutter; moved to Downspout by hand
 * it had no part, so the seeder treated it as an elbow and wrote 23 `45° A-Style Elbow` (the
 * 22.99 ft rounded) and no length, no drops. Now a compound FT / EA row is split into its parts
 * on the review screen — the length keeps the row's quantity, each counted part becomes its own
 * EA row carrying the length's size — "Down Souts" is read as downspouts, a strap is listed to
 * place by hand (its count is not in the sheet), and a downspout row with no part is seeded by
 * its unit (feet = a length) rather than as an elbow. Fails on the old code.
 */
import { describe, expect, it } from "vitest";

import type { MetalsCatalogItem } from "@/lib/engine/adapters";
import { classifyRows, describeTarget, splitCompoundRow } from "./classify";
import { parsePlanSwiftMatrix, type PlanSwiftRow } from "./parse";
import { pickFor, unresolvedRows } from "./picks";
import { planSwiftSeed, type PlanSwiftChoice } from "./to-seed";

const item = (category: string, description: string, unitCost: number): MetalsCatalogItem => ({
  key: `metals::${category}::${description}`,
  category,
  description,
  unitCost,
  laborPerUnit: 0.05,
  laborRate: 45,
});
const METALS: MetalsCatalogItem[] = [
  item('Downspouts 4"X5"', '4"X5" Downspout - Open', 5.1),
  item('Downspouts 4"X5"', '4"X5" Downspout - Closed', 5.3),
  item('Downspouts 4"X5"', "Drop/Outlet", 10.5),
  item('Downspouts 4"X5"', "45° A-Style Elbow", 8),
  item('Downspouts 4"X5"', "45° B-Style Elbow", 8),
  item('Downspouts 4"X5"', "80° A-Style Elbow", 8.5),
  item('Downspouts 3"X4"', '3"X4" Downspout - Open', 4.1),
  item("Downspout accessories", "Downspout Straps", 1.2),
];

/** The sheet as the bid's import record kept it (Name, Takeoff, Units), row for row. */
const SHEET = parsePlanSwiftMatrix(
  [
    ["Name", "Description", "Takeoff", "Units"],
    ['60 Mill Durobond, 1/4" Tappered ISO, 1 Layer 1.5" Poly ISO', "", 139.37, "SQ FT"],
    ['Parapet 01 ( 6"_/ 12" )', "", 16.41, "FT"],
    ["T-Bar", "", 33.53, "FT"],
    ['7" Gutters', "", 40.29, "FT"],
    ["4\" X 5\" Down Souts, 2 Drops, 6 A style 45's, 10' of Gutter strap", "", 22.99, "FT"],
  ],
  "Sheet1",
)!;

describe("the compound downspout row is split into its parts", () => {
  const cs = classifyRows(SHEET.rows);
  const parts = cs.filter((c) => c.row.sheetRow === 6);

  it("row 6 becomes four rows: the length, the drops, the elbows and the strap", () => {
    expect(cs).toHaveLength(8);
    expect(parts.map((c) => [c.row.name, c.row.qty, c.row.units, c.row.part ?? 0])).toEqual([
      ['4" X 5" Down Souts', 22.99, "FT", 0],
      ['4" X 5" Drops', 2, "EA", 1],
      ['4" X 5" A style 45\'s', 6, "EA", 2],
      ["Gutter strap", 10, "FT", 3],
    ]);
  });

  it("the length is a 4\"X5\" downspout — 'Down Souts' is read as downspouts, not a gutter", () => {
    const len = parts[0]!;
    expect([len.target, len.confidence]).toEqual(["downspout", "high"]);
    expect(len.details).toMatchObject({ dsSize: '4"X5"', dsPart: "length", dsClosed: false });
    expect(describeTarget(len)).toBe('downspout 4"X5" open, 22.99 ft (Metals › Downspouts)');
  });

  it("the drops and the elbows carry the length's size, so nothing is asked", () => {
    expect(parts[1]!.details).toMatchObject({ dsSize: '4"X5"', dsPart: "Drop/Outlet" });
    expect(parts[2]!.details).toMatchObject({ dsSize: '4"X5"', dsPart: "elbow" });
    expect(describeTarget(parts[1]!)).toBe('drops / outlets 4"X5", ×2 (Metals › Downspouts)');
    expect(describeTarget(parts[2]!)).toBe('elbows 4"X5", ×6 (Metals › Downspouts)');
    // The elbow's name says 45 and A: the catalog row is known, no pick box.
    expect(pickFor(parts[2]!, "downspout", { metalsCatalog: METALS }, ['4"X5"'])).toBeNull();
    expect(pickFor(parts[1]!, "downspout", { metalsCatalog: METALS }, ['4"X5"'])).toBeNull();
  });

  it("the strap has no count in the sheet: it asks, then is listed to place by hand", () => {
    const strap = parts[3]!;
    expect(strap.target).toBe("unmatched");
    expect(strap.confidence).toBe("low");
    expect(strap.reason).toContain("Downspout Straps");
  });

  it('the 7" Gutters row and the others are as before', () => {
    expect(cs.slice(0, 4).map((c) => c.target)).toEqual([
      "section",
      "parapet",
      "unmatched",
      "gutter",
    ]);
  });

  describe("→ seed", () => {
    const choices: PlanSwiftChoice[] = cs.map((row) => ({
      row,
      target: row.target,
      ...(row.target === "gutter" ? { pick: 'LX-Style|A = 7" B = 6" C = 5"' } : {}),
    }));
    const seed = planSwiftSeed(SHEET, choices, {
      fileName: "Activity & Fitness Center.xlsx",
      metalsCatalog: METALS,
      gutterSizesByStyle: { "LX-Style": ['A = 7" B = 6" C = 5"'] },
      importedAt: "2026-11-04T15:11:49.097Z",
    });

    it('Metals › Downspouts: one 4"X5" entry — 22.99 ft open, 2 drops, 6 45° A-Style elbows', () => {
      expect(seed.metalsCalc.downspouts).toEqual([
        {
          size: '4"X5"',
          lengthByDesc: { '4"X5" Downspout - Open': 22.99 },
          accQty: { "Drop/Outlet": 2, "45° A-Style Elbow": 6 },
        },
      ]);
    });

    it("the strap and the T-Bar are listed to place by hand; the record keeps every part", () => {
      expect(seed.unmapped.map((u) => u.label)).toEqual(["T-Bar: 33.53 ft", "Gutter strap: 10 ft"]);
      expect(seed.unmapped[1]!.detail).toContain("Downspout Straps");
      expect(seed.summary).toContain("22.99 ft of downspout; 8 downspout drops / elbows");
      const m = seed.importInfo.mapping.filter((x) => x.sheetRow === 6);
      expect(m.map((x) => x.name)).toEqual([
        '4" X 5" Down Souts',
        '4" X 5" Drops',
        '4" X 5" A style 45\'s',
        "Gutter strap",
      ]);
      expect(m[0]!.detail).toBe(
        'Downspout (Metals): downspout 4"X5" open, 22.99 ft (Metals › Downspouts)',
      );
    });

    it("Create bid waits on the T-Bar and the strap only", () => {
      const rows = cs.map((row) => ({
        row,
        target: row.confidence === "low" ? null : row.target,
        ...(row.target === "gutter" ? { pick: 'LX-Style|A = 7" B = 6" C = 5"' } : {}),
      }));
      const open = unresolvedRows(
        rows,
        { metalsCatalog: METALS, gutterSizesByStyle: { "LX-Style": ['A = 7" B = 6" C = 5"'] } },
        ['4"X5"'],
      );
      expect(open.map((i) => cs[i]!.row.name)).toEqual(["T-Bar", "Gutter strap"]);
    });
  });
});

describe("a downspout row re-targeted by hand is seeded by its unit", () => {
  const row = (name: string, qty: number, units: string): PlanSwiftRow => ({
    sheetRow: 2,
    name,
    description: "",
    qty,
    units,
    unitKind: units === "FT" ? "ft" : "ea",
    linearTotal: null,
    wallHeight: null,
    wallArea: null,
  });
  const sheet = { sheetName: "Sheet1", hasLinearTotal: false, warnings: [] };

  it("a 22.99 ft row the classifier called a gutter, moved to Downspout with the size picked, is a length — not 23 elbows", () => {
    const [c] = classifyRows([row("Gutter and more, see notes", 22.99, "FT")]);
    expect(c!.target).toBe("gutter");
    expect(describeTarget(c!, "downspout")).toBe(
      "downspout (no size in the name) open, 22.99 ft (Metals › Downspouts)",
    );
    const seed = planSwiftSeed(sheet, [{ row: c!, target: "downspout", pick: '4"X5"' }], {
      fileName: "x.xlsx",
      metalsCatalog: METALS,
    });
    expect(seed.metalsCalc.downspouts).toEqual([
      { size: '4"X5"', lengthByDesc: { '4"X5" Downspout - Open': 22.99 }, accQty: {} },
    ]);
    expect(seed.unmapped).toEqual([]);
  });

  it("an EA row moved to Downspout is read by its name: drops, elbows, else a count", () => {
    const [drops] = classifyRows([row("Outlets for the walls", 3, "EA")]);
    expect(describeTarget(drops!, "downspout")).toBe(
      "drops / outlets (no size in the name), ×3 (Metals › Downspouts)",
    );
    const [count] = classifyRows([row("Vents", 3, "EA")]);
    expect(describeTarget(count!, "downspout")).toBe(
      "downspouts (no size in the name), ×3 (Metals › Downspouts)",
    );
  });
});

describe("splitCompoundRow", () => {
  const ft = (name: string, qty = 10): PlanSwiftRow => ({
    sheetRow: 9,
    name,
    description: "d",
    qty,
    units: "FT",
    unitKind: "ft",
    linearTotal: 12,
    wallHeight: null,
    wallArea: null,
  });

  it("a name with no comma, or whose extra clauses are not counted parts, is one row", () => {
    expect(splitCompoundRow(ft('3" x 4" Downspouts'))).toHaveLength(1);
    const kept = splitCompoundRow(ft("Coping, 24 ga, Closed"));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.name).toBe("Coping, 24 ga, Closed");
  });

  it("a roof area is never split, whatever its name says", () => {
    const area: PlanSwiftRow = { ...ft('50 mil TPO, 2" ISO, 1/2" HD ISO'), unitKind: "sqft" };
    expect(splitCompoundRow(area)).toHaveLength(1);
  });

  it("counted downspout parts split off with the length's size; the description is shared", () => {
    const parts = splitCompoundRow(ft('3" x 4" Downspouts - Closed, 4 drops; 2 elbows', 50));
    expect(parts.map((p) => [p.name, p.qty, p.unitKind, p.description, p.linearTotal])).toEqual([
      ['3" x 4" Downspouts - Closed', 50, "ft", "d", 12],
      ['3" X 4" drops', 4, "ea", "d", null],
      ['3" X 4" elbows', 2, "ea", "d", null],
    ]);
  });

  it("a size too big for a downspout is a curb's — the parts carry no size", () => {
    const parts = splitCompoundRow(ft("26 X 26 X 12 Curb, 2 drops"));
    expect(parts.map((p) => p.name)).toEqual(["26 X 26 X 12 Curb", "drops"]);
  });
});
