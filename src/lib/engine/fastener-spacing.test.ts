import { describe, expect, it } from "vitest";

import {
  universalFastenerSpacing,
  type MechFastenerRow,
} from "./fastener-spacing";

// Verbatim subset of the seeded mech_fastener_lookup (docs/legacy-consumption-rules.md §1).
const R = (
  rs: number,
  th: number,
  dt: number,
  tab: number,
  pt: number,
  fs: number,
  ps: number,
  cs: number,
): MechFastenerRow => ({
  roofSystemId: rs,
  membraneThickness: th,
  designTable: dt,
  tabSpacing: tab,
  pullTest: pt,
  fieldSpacing: fs,
  perimSpacing: ps,
  cornerSpacing: cs,
});

const ROWS: MechFastenerRow[] = [
  // Duro-Last DT60 tab 28
  R(1, -1, 60, 28, 140, 12, -1, -1),
  R(1, -1, 60, 28, 150, 15, -1, -1),
  R(1, -1, 60, 28, 210, 18, -1, -1),
  R(1, -1, 60, 28, 450, 24, -1, -1),
  // Duro-Last DT60 tab 60
  R(1, -1, 60, 60, 150, 6, -1, -1),
  R(1, -1, 60, 60, 350, 15, -1, -1),
  // Duro-Bond 40mil DT60 (tab wildcard)
  R(2, 40, 60, -1, 210, 10, 12, 14),
  R(2, 40, 60, -1, 250, 8, 10, 12),
  R(2, 40, 60, -1, 350, 6, 8, 10),
];

describe("universalFastenerSpacing (§1 port)", () => {
  it("reproduces the doc's worked example: RS1 DT60 tab 28 pull 300 → 18\" (threshold 210 wins)", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 1,
      thickness: 40,
      designTable: 60,
      tabSpacings: [28],
      pullTest: 300,
      columnOffset: 0,
    });
    expect(r).toEqual({ ok: true, inches: 18 });
  });

  it("takes the largest threshold satisfied (450 at pull 450 → 24\")", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 1,
      thickness: 60,
      designTable: 60,
      tabSpacings: [28],
      pullTest: 450,
      columnOffset: 0,
    });
    expect(r).toEqual({ ok: true, inches: 24 });
  });

  it("error -3 when the pull test is below every threshold", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 1,
      thickness: 40,
      designTable: 60,
      tabSpacings: [28],
      pullTest: 139,
      columnOffset: 0,
    });
    expect(r).toEqual({ ok: false, error: -3 });
  });

  it("error -1 for a design table with no rows", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 1,
      thickness: 40,
      designTable: 105,
      tabSpacings: [28],
      pullTest: 300,
      columnOffset: 0,
    });
    expect(r).toEqual({ ok: false, error: -1 });
  });

  it("error -2 for a tab spacing with no rows (and no wildcard)", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 1,
      thickness: 40,
      designTable: 60,
      tabSpacings: [999],
      pullTest: 300,
      columnOffset: 0,
    });
    expect(r).toEqual({ ok: false, error: -2 });
  });

  it("error -5 when no rows match the roof system / thickness at all", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 5,
      thickness: 40,
      designTable: 60,
      tabSpacings: [28],
      pullTest: 300,
      columnOffset: 0,
    });
    expect(r).toEqual({ ok: false, error: -5 });
  });

  it("Duro-Bond discriminates by thickness and matches the -1 tab wildcard; perim/corner offsets work", () => {
    const args = {
      roofSystemId: 2,
      thickness: 40,
      designTable: 60,
      tabSpacings: [28],
      pullTest: 260,
    };
    expect(universalFastenerSpacing(ROWS, { ...args, columnOffset: 0 })).toEqual({
      ok: true,
      inches: 8,
    });
    expect(universalFastenerSpacing(ROWS, { ...args, columnOffset: 1 })).toEqual({
      ok: true,
      inches: 10,
    });
    expect(universalFastenerSpacing(ROWS, { ...args, columnOffset: 2 })).toEqual({
      ok: true,
      inches: 12,
    });
  });

  it("a winning row whose value column is -1 fails (not permitted), e.g. Duro-Last perimeter", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 1,
      thickness: 40,
      designTable: 60,
      tabSpacings: [28],
      pullTest: 300,
      columnOffset: 1,
    });
    expect(r).toEqual({ ok: false, error: -3 });
  });

  it("tab-spacing filter keeps rows apart: tab 60 at pull 350 → 15\", not the 28-tab row", () => {
    const r = universalFastenerSpacing(ROWS, {
      roofSystemId: 1,
      thickness: 40,
      designTable: 60,
      tabSpacings: [60],
      pullTest: 350,
      columnOffset: 0,
    });
    expect(r).toEqual({ ok: true, inches: 15 });
  });
});
