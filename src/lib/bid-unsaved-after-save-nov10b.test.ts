/**
 * A saved bid must not read "Unsaved changes" (owner, Nov 10: "Look into that please"). Two
 * causes, both old:
 *  1. "Save anyway" (the unusual-numbers question) sent the waved-through list with the save but
 *     took the saved baseline from the render before the list was in state, so the bid looked
 *     changed until a second Save.
 *  2. A section added with "+ New Section" kept the placeholder fastener spacing (18 / 12 / 6)
 *     and was priced on it; the next time the bid was opened the open pass "re-derived" it from
 *     the fastener lookup and left the bid unsaved.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { BidSectionInput } from "@/lib/engine/bid-builder";
import type { MechFastenerRow } from "@/lib/engine/fastener-spacing";
import type { SheetAdmin } from "@/lib/bid-sheets";
import { savedWithAcknowledged } from "@/lib/bid-sanity";
import { snapBidChain, snapNewSection } from "@/lib/section-chain";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const route = flat("src/routes/estimate.tsx");

describe("1. Save anyway does not leave the bid unsaved", () => {
  /** The estimator's own `saved`, in miniature: the waved-through list is the LAST key. */
  const asTheStateReads = (acknowledged: string[]) => ({
    sections: [{ id: "s1" }],
    markup: 20,
    ...(acknowledged.length ? { sanityAcknowledged: acknowledged } : {}),
  });

  it("nothing waved through: the very same object", () => {
    const saved = asTheStateReads([]);
    expect(savedWithAcknowledged(saved, [])).toBe(saved);
  });

  it("the baseline reads exactly as `saved` will once the state has the list", () => {
    const before = asTheStateReads([]);
    const after = asTheStateReads(["no-drains:5000"]);
    expect(JSON.stringify(savedWithAcknowledged(before, ["no-drains:5000"]))).toBe(
      JSON.stringify(after),
    );
  });

  it("an older list is replaced, and the list stays last", () => {
    const before = asTheStateReads(["a"]);
    const next = savedWithAcknowledged(before, ["a", "b"]);
    expect(JSON.stringify(next)).toBe(JSON.stringify(asTheStateReads(["a", "b"])));
    expect(Object.keys(next).at(-1)).toBe("sanityAcknowledged");
    expect(before.sanityAcknowledged).toEqual(["a"]);
  });

  it("the estimator keeps the list last in `saved`, sends it, and baselines with it", () => {
    // Last key of the `saved` object literal.
    expect(route).toMatch(
      /\.\.\.\(importInfo \? \{ importInfo \} : \{\}\), (?:\/\/[^;]*? )?\.\.\.\(sanityAcknowledged\.length \? \{ sanityAcknowledged \} : \{\}\), \}; \/\/ Unsaved-changes tracking/,
    );
    expect(route).not.toContain(
      "perDiemFromChart, ...(sanityAcknowledged.length ? { sanityAcknowledged } : {}),",
    );
    expect(route).toContain("...(ack.length ? { sanityAcknowledged: ack } : {}),");
    expect(route).toContain(
      "lastSavedBody.current = bodyJsonOf(row?.name ?? bidName, savedWithAcknowledged(saved, ack));",
    );
    expect(route).toContain("const bodyJsonOf = (name: string, body: SavedBidState = saved) =>");
  });
});

describe("2. A new section takes the lookup's spacing at once", () => {
  const row = (
    designTable: number,
    tabSpacing: number,
    pullTest: number,
    [fieldSpacing, perimSpacing, cornerSpacing]: [number, number, number],
  ): MechFastenerRow => ({
    roofSystemId: 1,
    membraneThickness: -1,
    designTable,
    tabSpacing,
    pullTest,
    fieldSpacing,
    perimSpacing,
    cornerSpacing,
  });
  // 60 psf, 60" tab, 350 lb: 15 / 9 / 6 (the live table's answer for a default section).
  const lookup: MechFastenerRow[] = [
    row(60, 28, 210, [18, 12, 6]),
    row(60, 60, 350, [15, 9, 6]),
    row(60, 60, 210, [12, 9, 6]),
  ];
  const admin: SheetAdmin = {
    labor: {
      "Duro-Last|mechanical": {
        sheetSizeMultiByLabel: { "Roll Good": 4, "1500 sf": 1 },
        rollGoodsSheetLabel: "Roll Good",
      },
    },
    rollGoodWidthMulti: { 1: { 64: 1 } },
    sheetTabSpacings: { 1: [28, 60, 120] },
  };
  /** A section as "+ New Section" makes it: the placeholders 18 / 12 / 6. */
  const fresh = (over: Partial<BidSectionInput> = {}): BidSectionInput =>
    ({
      id: "new1",
      name: "",
      length: 0,
      width: 0,
      thickness: 40,
      color: "White",
      sheetSizeLabel: "1500 sf",
      fieldLap: 60,
      fastenerOc: 18,
      perimFastenerOc: 12,
      cornerFastenerOc: 6,
      deckType: "Wood",
      designTable: 60,
      pullTest: 350,
      ...over,
    }) as BidSectionInput;
  const bid = {
    roofSystem: "Duro-Last",
    attachment: "mechanical" as const,
    membraneAdhesiveName: "Water Based Adhesive",
    sections: [] as BidSectionInput[],
    customSpacing: {},
  };

  it("derives field / perimeter / corner from the lookup, not the placeholders", () => {
    const s = snapNewSection(bid, fresh(), admin, lookup);
    expect([s.fastenerOc, s.perimFastenerOc, s.cornerFastenerOc]).toEqual([15, 9, 6]);
  });

  it("so opening the saved bid has nothing left to re-derive", () => {
    const s = snapNewSection(bid, fresh(), admin, lookup);
    const reopened = snapBidChain({ ...bid, sections: [s] }, admin, lookup);
    expect(reopened.changes).toEqual([]);
    // The old way: the placeholder section is what the open pass had to correct.
    expect(snapBidChain({ ...bid, sections: [fresh()] }, admin, lookup).changes).toEqual([
      'Section 1: field spacing re-derived to 15" (was 18"), perimeter spacing to 9" (was 12").',
    ]);
  });

  it("leaves the section alone without a lookup, and an adhered one always", () => {
    const f = fresh();
    expect(snapNewSection(bid, f, admin, undefined)).toBe(f);
    expect(snapNewSection({ ...bid, attachment: "adhered" as const }, f, admin, lookup)).toBe(f);
  });

  it("does not touch the bid's other sections or its Setup default", () => {
    const other = fresh({ id: "old", fastenerOc: 7 });
    const state = {
      ...bid,
      sections: [other],
      sectionDefaults: {
        deckType: "Wood",
        thickness: 40,
        color: "White",
        sheetSizeLabel: "1500 sf",
        designTable: 105,
      },
    };
    const s = snapNewSection(state, fresh(), admin, lookup);
    expect(s.id).toBe("new1");
    expect(state.sections).toEqual([other]);
    expect(state.sectionDefaults.designTable).toBe(105);
  });

  it("the Sections screen's + New Section goes through it", () => {
    expect(route).toMatch(
      /newSection=\{\(\) => (?:\/\/[^{]*? )?snapNewSection\( chainState\(\), newSection\(\{ \.\.\.sectionDefaults, \.\.\.seedSectionAdjust\(templateDeltas\) \}\), admin, fastenerLookup, \) \}/,
    );
  });
});
