/**
 * PlanSwift drains with a size pick their boot AND the same-size ring (owner, Oct 8: "if there is
 * say a 3" drain boot, it should know we need the corresponding same size drain ring").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyRows } from "./classify";
import { inchToken, matchDrainPicks } from "./drain-picks";
import type { PlanSwiftRow } from "./parse";
import { planSwiftSeed, type PlanSwiftChoice } from "./to-seed";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// The live price list's names (pricing_catalog duro_last:drain_boots / duro_last:cdr_rings, Oct 8).
const BOOTS = [
  '2" Drain Boot',
  '2 1/2" Drain Boot',
  '3" Drain Boot',
  '3 1/2" Drain Boot',
  '4" Drain Boot',
  '8" Drain Boot',
];
const RINGS = [
  '2" Drain Rings',
  '2 1/2" Drain Ring',
  '3" Drain Rings',
  '3 1/2" Drain Rings',
  '4" Drain Rings',
  '8" Drain Rings',
];

describe("a drain's size picks its boot and ring", () => {
  it("spells a size the way the price list does", () => {
    expect(inchToken(3)).toBe('3"');
    expect(inchToken(3.5)).toBe('3 1/2"');
    expect(inchToken(2.5)).toBe('2 1/2"');
    expect(inchToken(3.25)).toBe('3 1/4"');
    expect(inchToken(8)).toBe('8"');
  });
  it("finds the boot and the SAME size ring, halves included, singular or plural 'Ring'", () => {
    expect(matchDrainPicks(3, BOOTS, RINGS)).toEqual({
      bootSize: '3" Drain Boot',
      ringSize: '3" Drain Rings',
    });
    expect(matchDrainPicks(2.5, BOOTS, RINGS)).toEqual({
      bootSize: '2 1/2" Drain Boot',
      ringSize: '2 1/2" Drain Ring',
    });
    // 3" never matches 3 1/2" (the size is the whole front of the name).
    expect(matchDrainPicks(3, ['3 1/2" Drain Boot'], ['3 1/2" Drain Rings'])).toBeNull();
    // A size the list lacks, or a list without the other half: nothing picked.
    expect(matchDrainPicks(5, BOOTS, RINGS)).toBeNull();
    expect(matchDrainPicks(3, BOOTS, [])).toBeNull();
    expect(matchDrainPicks(3, [], RINGS)).toBeNull();
  });
});

const row = (over: Partial<PlanSwiftRow>): PlanSwiftRow => ({
  sheetRow: 2,
  name: "Drains",
  description: "",
  qty: 4,
  units: "EA",
  unitKind: "ea",
  linearTotal: null,
  wallHeight: null,
  wallArea: null,
  ...over,
});
const AREA = row({
  sheetRow: 1,
  name: "Duro-Last 50 mil",
  qty: 10000,
  units: "SQ FT",
  unitKind: "sqft",
  linearTotal: 400,
});
const seedOf = (rows: PlanSwiftRow[], opts: Record<string, unknown> = {}) => {
  const choices: PlanSwiftChoice[] = classifyRows(rows).map((c) => ({ row: c, target: c.target }));
  return planSwiftSeed({ sheetName: "Test", hasLinearTotal: true, warnings: [] }, choices, {
    fileName: "t.xlsx",
    drainBoots: BOOTS,
    drainRings: RINGS,
    ...opts,
  });
};

describe("the import: sized drains land on Roof Drains & Boots", () => {
  it('"3\\" Drains" ×4 becomes four drains with the 3" boot and the 3" ring', () => {
    const seed = seedOf([AREA, row({ name: '3" Drains' })]);
    expect(seed.drains).toHaveLength(1);
    expect(seed.drains[0]).toMatchObject({
      quantity: 4,
      bootSize: '3" Drain Boot',
      ringSize: '3" Drain Rings',
      roofType: "None",
      reuseRings: false,
    });
    expect(seed.unmapped.filter((u) => /drain/i.test(u.label))).toEqual([]);
    expect(seed.warnings.join("\n")).not.toMatch(/drain/i);
  });
  it('"3 1/2\\" Drain" picks the halves; two sizes make two drain rows', () => {
    const seed = seedOf([
      AREA,
      row({ name: '3 1/2" Drain', qty: 2 }),
      row({ sheetRow: 3, name: '4" Drains', qty: 1 }),
    ]);
    expect(seed.drains.map((d) => [d.quantity, d.bootSize, d.ringSize])).toEqual([
      [2, '3 1/2" Drain Boot', '3 1/2" Drain Rings'],
      [1, '4" Drain Boot', '4" Drain Rings'],
    ]);
  });
  it("a drain with no size, or a size the price list lacks, is listed to place by hand with a warning for the latter", () => {
    const plain = seedOf([AREA, row({ name: "Drains" })]);
    expect(plain.drains).toEqual([]);
    expect(plain.unmapped.map((u) => u.label)).toContain("4 × Drains");
    const odd = seedOf([AREA, row({ name: '5" Drains' })]);
    expect(odd.drains).toEqual([]);
    expect(odd.unmapped.map((u) => u.label)).toContain('4 × 5" Drains');
    expect(odd.warnings).toContain(
      '5" Drains: no 5" drain boot and ring in the price list — pick them on each drain.',
    );
    // Without the price list at all (older callers): as before, no warning, place by hand.
    const none = seedOf([AREA, row({ name: '3" Drains' })], {
      drainBoots: undefined,
      drainRings: undefined,
    });
    expect(none.drains).toEqual([]);
    expect(none.warnings.join("\n")).not.toMatch(/drain boot/);
  });
  it("the dialog hands the live boot and ring lists to the importer", () => {
    const dialog = read("../../components/import-planswift-dialog.tsx");
    expect(dialog).toContain(
      "drainBoots: liveAdmin.accessories.drainBoots.map((b) => b.description)",
    );
    expect(dialog).toContain(
      "drainRings: liveAdmin.accessories.drainRings.map((r) => r.description)",
    );
  });
});
