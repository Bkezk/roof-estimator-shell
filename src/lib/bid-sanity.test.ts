/**
 * "Are these numbers right?" before a bid save (owner, Oct 7): the rules, the facts, and the
 * save-anyway memory.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  acknowledgeAll,
  bidSanityWarnings,
  SANITY_BANDS,
  sanityFactsFromSaved,
  unacknowledged,
  type SanityFacts,
} from "./bid-sanity";

const base: SanityFacts = {
  roofSqFt: 10_240,
  perimeterFt: 416, // 128 × 80
  sections: [{ name: "Roof 1", lengthFt: 128, widthFt: 80 }],
  parapets: [{ name: "Parapet 01", lengthFt: 300, verticalIn: 24 }],
  curbs: [{ name: "Exhaust fans", widthIn: 26, lengthIn: 26, quantity: 10 }],
  drainCount: 6,
  hasGuttersOrScuppers: false,
  pipeStackCount: 10,
  grandTotal: 180_000,
  markupMode: 2,
  markup: 35,
  perDiemRate: 0,
};
const ids = (f: SanityFacts) => bidSanityWarnings(f).map((w) => w.id);

describe("bidSanityWarnings", () => {
  it("a sound bid trips nothing", () => {
    expect(ids(base)).toEqual([]);
  });
  it("1 ft of parapet on a 10,000 sq ft building (the owner's example) is asked about", () => {
    const w = bidSanityWarnings({
      ...base,
      parapets: [{ name: "Parapet 01", lengthFt: 1, verticalIn: 24 }],
    });
    expect(w.map((x) => x.id)).toEqual(["parapet-short"]);
    expect(w[0]!.title).toBe("Parapet 1 ft on a 10,240 sq ft roof");
    expect(w[0]!.detail).toContain("416 ft");
    expect(w[0]!.key).toBe("parapet-short:1");
  });
  it("more parapet than roof edge; a parapet with no height or over 20 ft", () => {
    expect(ids({ ...base, parapets: [{ name: "P", lengthFt: 600, verticalIn: 24 }] })).toEqual([
      "parapet-long",
    ]);
    expect(ids({ ...base, parapets: [{ name: "P", lengthFt: 300, verticalIn: 0 }] })).toEqual([
      "parapet-height",
    ]);
    expect(ids({ ...base, parapets: [{ name: "P", lengthFt: 300, verticalIn: 300 }] })).toEqual([
      "parapet-height",
    ]);
  });
  it("sections: a tiny or huge side, a strip 30× longer than wide, a tiny or huge area", () => {
    expect(ids({ ...base, sections: [{ name: "S", lengthFt: 128, widthFt: 1.5 }] })).toContain(
      "section-side",
    );
    expect(ids({ ...base, sections: [{ name: "S", lengthFt: 1200, widthFt: 80 }] })).toContain(
      "section-side",
    );
    // The Towneplace PlanSwift rectangle: 659.93 × 21.12 ft.
    expect(
      ids({ ...base, sections: [{ name: "Roof 1", lengthFt: 659.93, widthFt: 21.12 }] }),
    ).toContain("section-skinny");
    expect(ids({ ...base, sections: [{ name: "S", lengthFt: 9, widthFt: 9 }] })).toContain(
      "section-area",
    );
    expect(ids({ ...base, sections: [{ name: "S", lengthFt: 800, widthFt: 700 }] })).toContain(
      "section-area",
    );
  });
  it("drainage: none on a big roof, unless gutters or scuppers drain it; too many stacks or curbs; odd curb sizes", () => {
    expect(ids({ ...base, drainCount: 0 })).toEqual(["drains-none"]);
    expect(ids({ ...base, drainCount: 0, hasGuttersOrScuppers: true })).toEqual([]);
    expect(ids({ ...base, pipeStackCount: 60 })).toEqual(["stacks-many"]);
    expect(
      ids({ ...base, curbs: [{ name: "C", widthIn: 26, lengthIn: 26, quantity: 45 }] }),
    ).toEqual(["curbs-many"]);
    expect(
      ids({ ...base, curbs: [{ name: "Drops", widthIn: 3, lengthIn: 4, quantity: 7 }] }),
    ).toEqual(["curb-size"]);
    expect(
      ids({ ...base, curbs: [{ name: "C", widthIn: 300, lengthIn: 26, quantity: 1 }] }),
    ).toEqual(["curb-size"]);
    expect(ids({ ...base, curbs: [{ name: "C", widthIn: 3, lengthIn: 4, quantity: 0 }] })).toEqual(
      [],
    );
  });
  it("money: $3–$60 a sq ft, markup 5–100 % (not for a flat $/man-day markup), per diem ≤ $500", () => {
    expect(SANITY_BANDS.pricePerSqFt).toEqual({ min: 3, max: 60 });
    expect(ids({ ...base, grandTotal: 20_000 })).toEqual(["price-per-sqft"]);
    expect(ids({ ...base, grandTotal: 700_000 })).toEqual(["price-per-sqft"]);
    expect(bidSanityWarnings({ ...base, grandTotal: 20_000 })[0]!.title).toBe(
      "Bid total $20,000.00 is $1.95 a sq ft",
    );
    expect(ids({ ...base, markup: 2 })).toEqual(["markup"]);
    expect(ids({ ...base, markup: 150 })).toEqual(["markup"]);
    expect(ids({ ...base, markupMode: 1, markup: 150 })).toEqual([]);
    expect(ids({ ...base, perDiemRate: 800 })).toEqual(["per-diem"]);
  });
});

describe("sanityFactsFromSaved", () => {
  it("reads the saved bid and the engine's roof area and total", () => {
    const f = sanityFactsFromSaved(
      {
        sections: [{ name: "", length: 128, width: 80 }],
        parapets: [{ name: "Parapet 01", lengthFt: 300, verticalInches: 24 }],
        curbs: [{ name: "Hatch", widthIn: 42, lengthIn: 42, quantity: 1 }],
        accessoriesCalc: {
          pipeStacks: [{ quantity: 4 }, { quantity: 6 }],
          drains: [{ quantity: 6 }],
        },
        metalsCalc: { gutters: [], collectionBoxQty: { "Scupper A": { Box: 2 } } },
        markupMode: 2,
        markup: 35,
        perDiem: 40,
      },
      { roofSqFootage: 10_240, money: { grandTotal: 180_000 } },
    );
    expect(f).toMatchObject({
      roofSqFt: 10_240,
      perimeterFt: 416,
      drainCount: 6,
      hasGuttersOrScuppers: true,
      pipeStackCount: 10,
      grandTotal: 180_000,
      perDiemRate: 40,
    });
    expect(f.sections[0]!.name).toBe("Section 1");
    // Before the estimate has run: the sections' own area, no total.
    const early = sanityFactsFromSaved({ sections: [{ length: 10, width: 10 }] }, null);
    expect([early.roofSqFt, early.grandTotal]).toEqual([100, 0]);
  });
});

describe("save-anyway memory", () => {
  const w = bidSanityWarnings({
    ...base,
    parapets: [{ name: "P", lengthFt: 1, verticalIn: 24 }],
    perDiemRate: 800,
  });
  it("a waved-through value is not asked again; a changed value is; stale keys are dropped", () => {
    expect(w.map((x) => x.key)).toEqual(["parapet-short:1", "per-diem:800"]);
    const ack = acknowledgeAll(["old-rule:9"], w);
    expect(ack).toEqual(["parapet-short:1", "per-diem:800"]);
    expect(unacknowledged(w, ack)).toEqual([]);
    const changed = bidSanityWarnings({
      ...base,
      parapets: [{ name: "P", lengthFt: 2, verticalIn: 24 }],
      perDiemRate: 800,
    });
    expect(unacknowledged(changed, ack).map((x) => x.key)).toEqual(["parapet-short:2"]);
  });
});

describe("the wiring", () => {
  it("the estimator asks before saving, remembers the answer on the bid, and shows a checks badge", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../routes/estimate.tsx", import.meta.url)),
      "utf8",
    );
    expect(src).toContain("const open = unacknowledged(sanityWarnings, sanityAcknowledged);");
    expect(src).toContain("setSanityPrompt({ warnings: open, after: opts?.after });");
    expect(src).toContain("...(ack.length ? { sanityAcknowledged: ack } : {}),");
    expect(src).toContain("Are these numbers right?");
    expect(src).toContain("Save anyway");
    expect(src).toMatch(
      /\{sanityWarnings\.length\} check\{sanityWarnings\.length === 1 \? "" : "s"\}/,
    );
    expect(
      readFileSync(fileURLToPath(new URL("./proposal-bid.ts", import.meta.url)), "utf8"),
    ).toContain("sanityAcknowledged?: string[];");
  });
});
