import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  cellNumber,
  parsePlanSwiftMatrix,
  readPlanSwiftWorkbook,
  unitKind,
  type PlanSwiftSheet,
} from "./parse";

const planswiftFixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

describe("readPlanSwiftWorkbook — the two real exports", () => {
  it("test_pS.xlsx: 11 rows, with Linear total", async () => {
    const s: PlanSwiftSheet = await readPlanSwiftWorkbook(planswiftFixture("test_pS.xlsx"));
    expect(s.sheetName).toBe("Sheet1");
    expect(s.hasLinearTotal).toBe(true);
    expect(s.warnings).toEqual([]);
    expect(s.rows).toHaveLength(11);
    expect(s.rows[0]).toEqual({
      sheetRow: 2,
      name: '50 mill DT / Duro-Teck TPO 2" Iso, 1/2" HD Poly ISO Coverboard',
      description: "",
      qty: 13445.64,
      units: "SQ FT",
      unitKind: "sqft",
      linearTotal: 1268.56,
      wallHeight: 0,
      wallArea: 0,
    });
    expect(s.rows.map((r) => [r.name, r.qty, r.unitKind, r.linearTotal])).toEqual([
      ['50 mill DT / Duro-Teck TPO 2" Iso, 1/2" HD Poly ISO Coverboard', 13445.64, "sqft", 1268.56],
      ["Coping/2-piece", 1344.01, "ft", 1344.01],
      ["tapperd Iso/ Crickets", 5185.38, "sqft", 1103.64],
      ['Parapet 01 ( 6"_/ 102" )', 604.56, "ft", 604.56],
      ['Parapet 02 ( 6"_/ 36" )', 415.49, "ft", 415.49],
      ['Parapet 03 ( 6"_/ 66" )', 114.83, "ft", 114.83],
      ["Gutter", 200.96, "ft", 200.96],
      ["Down spouts/ splash blocks", 7, "ea", 159.17],
      ["Exhaust fans 26 X 26 X 12", 10, "ea", 275.82],
      ["Roof Hatch 42 X 42 X 12", 1, "ea", 0],
      ["Drains", 12, "ea", 491.08],
    ]);
    // EA rows have blank Wall Height / Wall Area cells.
    expect(s.rows[7]!.wallHeight).toBeNull();
  });

  it("knox.xlsx: 42 rows, no Linear total", async () => {
    const s = await readPlanSwiftWorkbook(planswiftFixture("knox.xlsx"));
    expect(s.hasLinearTotal).toBe(false);
    expect(s.rows).toHaveLength(42);
    expect(s.rows.every((r) => r.linearTotal === null)).toBe(true);
    expect(s.rows.filter((r) => r.unitKind === "sqft")).toHaveLength(7);
    expect(s.rows.filter((r) => r.unitKind === "ft")).toHaveLength(21);
    expect(s.rows.filter((r) => r.unitKind === "ea")).toHaveLength(14);
    expect(s.rows[41]).toMatchObject({ sheetRow: 43, name: "ACM Panels", qty: 1355.83 });
  });

  it("a workbook without the PlanSwift headers is refused with a message", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Item", "Cost"],
        ["x", 1],
      ]),
      "S",
    );
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    await expect(readPlanSwiftWorkbook(bytes)).rejects.toThrow(/Name, Takeoff and Units/);
  });
});

describe("parsePlanSwiftMatrix — header and cell tolerance", () => {
  it("header case / spacing, a title row above, blank rows, Units twice, numbers as text", () => {
    const s = parsePlanSwiftMatrix([
      ["Job: Maple St"],
      [],
      ["  NAME ", "description", "Take off", "units", "Linear  Total", "Units"],
      ["Roof A", "", "1,250.5", "sq ft", "150", "FT"],
      [null, null, null, null, null, null],
      ["", "", "", "", "", ""],
      ["Parapet", "north", 80, "LF", 80, "FT"],
      ["No number", "", "n/a", "EA", null, null],
    ])!;
    expect(s.hasLinearTotal).toBe(true);
    expect(
      s.rows.map((r) => [r.sheetRow, r.name, r.qty, r.units, r.unitKind, r.linearTotal]),
    ).toEqual([
      [4, "Roof A", 1250.5, "sq ft", "sqft", 150],
      [7, "Parapet", 80, "LF", "ft", 80],
    ]);
    expect(s.rows[1]!.description).toBe("north");
    expect(s.warnings).toEqual(['Row 8 "No number": no number in Takeoff — skipped.']);
  });

  it("the first Units after Takeoff is the quantity's unit even when Linear total's comes first", () => {
    const s = parsePlanSwiftMatrix([
      ["Units", "Name", "Takeoff", "Units"],
      ["FT", "Roof", 100, "SQ FT"],
    ])!;
    expect(s.rows[0]!.units).toBe("SQ FT");
    expect(s.hasLinearTotal).toBe(false);
  });

  it("no header row → null", () => {
    expect(
      parsePlanSwiftMatrix([
        ["a", "b"],
        [1, 2],
      ]),
    ).toBeNull();
  });

  it("units and numbers", () => {
    expect(["SQ FT", "sq. ft.", "SF", "sqft"].map(unitKind)).toEqual([
      "sqft",
      "sqft",
      "sqft",
      "sqft",
    ]);
    expect(["FT", "LF", "lin ft"].map(unitKind)).toEqual(["ft", "ft", "ft"]);
    expect(["EA", "each", "Count"].map(unitKind)).toEqual(["ea", "ea", "ea"]);
    expect(unitKind("CY")).toBe("other");
    expect(cellNumber(" 1,234.5 ")).toBe(1234.5);
    expect(cellNumber("12 EA")).toBeNull();
    expect(cellNumber(Number.NaN)).toBeNull();
  });
});
