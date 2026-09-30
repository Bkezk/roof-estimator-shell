import { describe, expect, it } from "vitest";

import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
import { emptyCustomer, type SavedBidState } from "@/lib/proposal-bid";
import type { TakeoffBidSeed } from "./create-bid";
import { newBidFromSeed } from "./seed-to-bid";

const make = {
  newSection: (d: Partial<BidSectionInput>) =>
    ({ id: "s1", name: "Section 1", length: 0, width: 0, thickness: 40, ...d }) as BidSectionInput,
  newParapet: (d: Partial<ParapetInput>) =>
    ({ id: "p1", name: "Parapet 1", lengthFt: 1, ...d }) as ParapetInput,
  newCurb: (d: Partial<CurbInput>) =>
    ({ id: "c1", name: "Curb 1", quantity: 1, ...d }) as CurbInput,
};

const saved: SavedBidState & { sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]> } = {
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  sections: [make.newSection({})],
  accessories: [],
  accessoriesCalc: { vents: { delta: { White: 2 }, adjustPct: 0 } },
  nonDlLines: [],
  customer: { ...emptyCustomer(), name: "Keep me" },
  markupMode: 2,
  markup: 35,
  laborRate: 45,
  commission: 0,
  taxExempt: false,
  sectionDefaults: {
    deckType: "Wood",
    thickness: 40,
    color: "White",
    sheetSizeLabel: "1500 sf",
    designTable: 60,
  },
  parapetDefaults: { wallType: 4 },
};

describe("newBidFromSeed (moved from the estimate route's ?takeoff= handler)", () => {
  it("seed defaults over the bid's, entries through the factories, the rest kept", () => {
    const seed: TakeoffBidSeed = {
      roofSystem: "Duro-Tech TPO",
      sectionDefaults: { thickness: 60, deckType: "Steel" },
      parapetDefaults: { attachment: "adhered" },
      sections: [{ name: "Roof A", length: 100, width: 50 }],
      parapets: [{ name: "North", lengthFt: 80 }],
      curbs: [{ name: "RTU", quantity: 2, widthIn: 48, lengthIn: 96 }],
      pipeStacks: [
        {
          id: "takeoff-pipe-1",
          usage: "Plumbing",
          color: "White",
          open: false,
          size: 4,
          quantity: 3,
          adjustPct: 0,
        },
      ],
      drains: [],
      unmapped: [],
      summary: "",
    };
    const b = newBidFromSeed(saved, seed, make);
    expect(b.roofSystem).toBe("Duro-Tech TPO");
    expect(b.attachment).toBe("mechanical");
    expect(b.sections).toEqual([
      {
        id: "s1",
        name: "Roof A",
        length: 100,
        width: 50,
        thickness: 60,
        deckType: "Steel",
        color: "White",
        sheetSizeLabel: "1500 sf",
        designTable: 60,
      },
    ]);
    expect(b.parapets).toEqual([{ id: "p1", name: "North", lengthFt: 80 }]);
    expect(b.curbs).toEqual([{ id: "c1", name: "RTU", quantity: 2, widthIn: 48, lengthIn: 96 }]);
    expect(b.accessoriesCalc).toEqual({
      vents: { delta: { White: 2 }, adjustPct: 0 },
      pipeStacks: seed.pipeStacks,
      drains: [],
    });
    expect(b.sectionDefaults).toMatchObject({ thickness: 60, deckType: "Steel", color: "White" });
    expect(b.parapetDefaults).toEqual({ wallType: 4, attachment: "adhered" });
    expect(b.customer.name).toBe("Keep me");
  });
});
