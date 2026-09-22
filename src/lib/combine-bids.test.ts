import { describe, it, expect } from "vitest";

import { combineSavedBids, combineWarningLines } from "./combine-bids";
import type { BidSectionInput } from "./engine/bid-builder";
import { emptyCustomer, type SavedBidState } from "./proposal-bid";

const section = (id: string, over: Partial<BidSectionInput> = {}): BidSectionInput => ({
  id,
  name: id,
  length: 100,
  width: 80,
  deckType: "Steel",
  thickness: 60,
  color: "White",
  fieldLap: 60,
  fastenerOc: 18,
  perimLengthFt: 0,
  cornerLengthFt: 0,
  enhancementWidthFt: 3,
  perimFastenerOc: 12,
  cornerFastenerOc: 6,
  underlaymentBoard: "",
  sheetSizeLabel: "1500 sf",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  ...over,
});

const fresh = (): SavedBidState => ({
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  sections: [],
  accessories: [],
  nonDlLines: [],
  customer: emptyCustomer(),
  markupMode: 2,
  markup: 35,
  laborRate: 50,
  commission: 3,
  taxExempt: false,
  perDiem: 0,
});

const quoteLayer = (qid: string) => ({
  board: "Flute Filler",
  attachment: "mechanical" as const,
  fastenersPerBoard: 0,
  adhesiveName: "",
  substrate: "",
  quote: { id: qid, name: "FF", lumpSum: 100, laborAmount: 2 },
});

describe("combineSavedBids — legacy BidCombiner semantics", () => {
  const a: SavedBidState = {
    ...fresh(),
    roofSystem: "Duro-Fleece",
    attachment: "adhered",
    membraneAdhesiveName: "Duro-Grip Adhesive(CR-20)",
    laborRate: 45,
    markup: 40,
    customer: { ...emptyCustomer(), name: "Client A", estimatorName: "Pat" },
    sections: [
      section("s1", { layers: [quoteLayer("q1")] }),
      section("s2", { layers: [quoteLayer("q1")] }),
    ],
    parapets: [
      {
        id: "p1",
        name: "P",
        lengthFt: 10,
        heightBand: "0-2",
        deckType: "Steel",
        predrill: false,
        canted: false,
        girthInches: 24,
      },
    ],
    curbs: [
      {
        id: "c1",
        name: "C",
        quantity: 1,
        widthIn: 24,
        lengthIn: 24,
        curbType: "Open",
        deckType: "Steel",
      },
    ],
    accessories: [{ description: "Pads", price: 10, quantity: 2 }],
    nonDlLines: [{ description: "Rope", price: 5, laborPerUnit: 0, laborRate: 0, quantity: 1 }],
    accessoriesCalc: {
      corners: { qty: { "Inside Corner": { White: 4 } }, adjustPct: 15 },
      washers: { qty: { '2" Plate': 10 }, adjustPct: 0 },
      pipeStacks: [
        {
          id: "x",
          usage: "Plumbing",
          color: "White",
          open: true,
          size: 4,
          quantity: 2,
          adjustPct: 0,
        },
      ],
      drains: [
        {
          id: "d",
          quantity: 1,
          roofType: "BUR",
          reuseRings: false,
          bootSize: '8"',
          ringSize: '8"',
          adjustPct: 0,
        },
      ],
      termBar: {
        additionalNoDrill: { White: 50 },
        additionalPreDrill: {},
        stripMastic: true,
        adjustNoDrillPct: 0,
        adjustPreDrillPct: 0,
      },
      membraneAccs: {
        arpExtra: 1,
        tPatchExtra: 0,
        tPatchAdjustPct: 0,
        strippingFtBySection: { s1: 40 },
        strippingAdjustPct: 0,
      },
      fastenerQty: { termBar: { "#14 HD": 100 } },
      adhesivesExtra: { "Duro-Grip Adhesive(CR-20)": 2 },
    },
    metalsCalc: {
      gutters: [{ style: "Box", size: "6", lengthFt: 100, accQty: { "End Cap": 2 } }],
      pitchPanQty: { PP1: 1 },
    },
    nonDlCalc: {
      rows: { roofEdgeBlocking: { "2x4": { extra: 10, unitCost: 1.09 } } },
      custom: {
        others: [{ description: "Crane", qty: 1, unitCost: 500, laborPerUnit: 0, laborRate: 0 }],
      },
    },
  };
  const b: SavedBidState = {
    ...fresh(),
    roofSystem: "Duro-Last",
    attachment: "mechanical",
    customer: { ...emptyCustomer(), name: "Client B", estimatorName: "Sam" },
    sections: [section("s1", { layers: [quoteLayer("q1")] })],
    curbs: [
      {
        id: "c1",
        name: "C",
        quantity: 2,
        widthIn: 24,
        lengthIn: 24,
        curbType: "Open",
        deckType: "Steel",
      },
    ],
    accessories: [
      { description: "Pads", price: 10, quantity: 3 },
      { description: "Pads", price: 12, quantity: 1 },
    ],
    nonDlLines: [{ description: "Rope", price: 5, laborPerUnit: 0, laborRate: 0, quantity: 4 }],
    accessoriesCalc: {
      corners: { qty: { "Inside Corner": { White: 6, Tan: 1 } }, adjustPct: 0 },
      pipeStacks: [
        {
          id: "y",
          usage: "Plumbing",
          color: "White",
          open: true,
          size: 4,
          quantity: 3,
          adjustPct: 0,
        },
        {
          id: "z",
          usage: "Plumbing",
          color: "White",
          open: false,
          size: 4,
          quantity: 1,
          adjustPct: 0,
        },
      ],
      drains: [
        {
          id: "e",
          quantity: 2,
          roofType: "BUR",
          reuseRings: false,
          bootSize: '8"',
          ringSize: '8"',
          adjustPct: 0,
        },
      ],
      termBar: {
        additionalNoDrill: { White: 25, Tan: 5 },
        additionalPreDrill: {},
        stripMastic: false,
        adjustNoDrillPct: 0,
        adjustPreDrillPct: 0,
      },
      membraneAccs: {
        arpExtra: 0,
        tPatchExtra: 2,
        tPatchAdjustPct: 0,
        strippingFtBySection: { s1: 60 },
        strippingAdjustPct: 0,
      },
      adhesivesExtra: { "Duro-Grip Adhesive(CR-20)": 1 },
    },
    metalsCalc: {
      gutters: [
        { style: "Box", size: "6", lengthFt: 50, accQty: { "End Cap": 2, Miter: 1 } },
        { style: "K", size: "5", lengthFt: 20, accQty: {} },
      ],
      pitchPanQty: { PP1: 2 },
    },
    nonDlCalc: {
      rows: { roofEdgeBlocking: { "2x4": { extra: 5, unitCost: 1.2 } } },
      custom: {
        others: [{ description: "Crane", qty: 1, unitCost: 650, laborPerUnit: 0, laborRate: 0 }],
      },
    },
  };
  const r = combineSavedBids(
    [
      { id: "A", name: "Bid A", saved: a },
      { id: "B", name: "Bid B", saved: b },
    ],
    fresh(),
    "2026-09-22T00:00:00.000Z",
  );

  it("estimate-level values come from the fresh defaults; system fields from the first bid", () => {
    expect(r.saved.laborRate).toBe(50);
    expect(r.saved.markup).toBe(35);
    expect(r.saved.roofSystem).toBe("Duro-Fleece");
    expect(r.saved.attachment).toBe("adhered");
    expect(r.saved.membraneAdhesiveName).toBe("Duro-Grip Adhesive(CR-20)");
    expect(r.saved.customer.name).toBe("");
    expect(r.saved.adminSnapshot).toBeUndefined();
    expect(r.saved.combineInfo?.sources.map((s) => s.client)).toEqual(["Client A", "Client B"]);
  });

  it("sections / parapets / curbs are appended with unique ids; a differing-system section is stamped", () => {
    expect(r.saved.sections.map((s) => s.id)).toEqual(["1.s1", "1.s2", "2.s1"]);
    expect(r.saved.sections[0]!.roofSystem).toBeUndefined();
    expect(r.saved.sections[2]!.roofSystem).toBe("Duro-Last");
    expect(r.saved.sections[2]!.attachment).toBe("mechanical");
    expect(r.saved.parapets?.map((p) => p.id)).toEqual(["1.p1"]);
    expect(r.saved.curbs?.map((c) => c.id)).toEqual(["1.c1", "2.c1"]);
  });

  it("quote ids are re-keyed per source: shared within a bid, never across bids", () => {
    const qids = r.saved.sections.map((s) => s.layers![0]!.quote!.id);
    expect(qids[0]).toBe(qids[1]);
    expect(qids[2]).not.toBe(qids[0]);
  });

  it("accessory quantities sum by item; fasteners are dropped; adjust % reset; stripping follows the new ids", () => {
    const ac = r.saved.accessoriesCalc!;
    expect(ac.corners!.qty).toEqual({ "Inside Corner": { White: 10, Tan: 1 } });
    expect(ac.corners!.adjustPct).toBe(0);
    expect(ac.washers!.qty).toEqual({ '2" Plate': 10 });
    expect(ac.pipeStacks!.map((p) => [p.open, p.quantity])).toEqual([
      [true, 5],
      [false, 1],
    ]);
    expect(ac.drains!.map((d) => d.quantity)).toEqual([3]);
    expect(ac.termBar!.additionalNoDrill).toEqual({ White: 75, Tan: 5 });
    expect(ac.termBar!.stripMastic).toBe(true);
    expect(ac.membraneAccs!.arpExtra).toBe(1);
    expect(ac.membraneAccs!.tPatchExtra).toBe(2);
    expect(ac.membraneAccs!.strippingFtBySection).toEqual({ "1.s1": 40, "2.s1": 60 });
    expect(ac.fastenerQty).toEqual({});
    expect(ac.adhesivesExtra).toEqual({ "Duro-Grip Adhesive(CR-20)": 3 });
  });

  it("metals sum by gutter style+size / downspout size; pitch pans by ref", () => {
    const m = r.saved.metalsCalc!;
    expect(m.gutters).toEqual([
      { style: "Box", size: "6", lengthFt: 150, accQty: { "End Cap": 4, Miter: 1 } },
      { style: "K", size: "5", lengthFt: 20, accQty: {} },
    ]);
    expect(m.pitchPanQty).toEqual({ PP1: 3 });
  });

  it("Non-DL rows combine by description, reporting price conflicts; custom rows with other prices stay separate", () => {
    const nd = r.saved.nonDlCalc!;
    expect(nd.rows!.roofEdgeBlocking!["2x4"]).toEqual({ extra: 15, unitCost: 1.09 });
    expect(nd.custom!.others!.map((c) => c.unitCost)).toEqual([500, 650]);
    expect(r.info.conflicts).toHaveLength(2);
    expect(r.info.conflicts[0]).toContain("2x4");
  });

  it("plain lines sum when every field but quantity matches", () => {
    expect(r.saved.accessories).toEqual([
      { description: "Pads", price: 10, quantity: 5 },
      { description: "Pads", price: 12, quantity: 1 },
    ]);
    expect(r.saved.nonDlLines[0]!.quantity).toBe(5);
  });

  it("warning text lists the source bids and the remaining steps", () => {
    const lines = combineWarningLines(r.info);
    expect(lines[0]).toContain("Bid Combiner");
    expect(lines.at(-1)).toContain("“Bid A” for Client A, bid by Pat");
    expect(lines.at(-1)).toContain("“Bid B” for Client B, bid by Sam");
  });

  it("refuses fewer than two bids", () => {
    expect(() => combineSavedBids([{ id: "A", name: "A", saved: a }], fresh())).toThrow();
  });
});
