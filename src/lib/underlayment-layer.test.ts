/**
 * Quoted underlayment layers keep their quote (owner, Oct 26: "when brian was putting on tapered
 * insulation, he entered the quotes for the tapered it automatically shows a fastener on the
 * visual and when he clicks attachment method none … it cleared the tapered quotes"). Two causes:
 * "Apply layer N to selected" rebuilt the layer from the form and dropped the quote, and the
 * quote dialog hard-coded a new quote layer as mechanical, which the layer stack then drew as a
 * screw whatever the layer said (it drew EVERY quoted layer as mechanical). A quote bills its
 * material and labor verbatim and never adds fasteners (engine/consumption.ts skips quote
 * layers), so the attachment on a quoted layer is what the picture shows and, for adhesive, the
 * quoted containers — it follows the form like any other layer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { UnderlaymentLayer } from "@/lib/engine/bid-builder";
import { nextLayerFromForm } from "@/lib/underlayment-layer";

const read = (p: string) => readFileSync(p, "utf8");
const quote = { id: "q1", name: "Tapered ISO — ABC Supply", lumpSum: 4200, laborAmount: 16 };
const existing: UnderlaymentLayer = {
  board: "Tapered ISO",
  attachment: "mechanical",
  fastenersPerBoard: 0,
  adhesiveName: "",
  substrate: "",
  quote,
};

describe("nextLayerFromForm", () => {
  it("the same board keeps its quote whatever the attachment becomes (None, mechanical, adhesive)", () => {
    for (const attachment of ["none", "mechanical", "durobond"] as const) {
      const l = nextLayerFromForm(existing, {
        board: "Tapered ISO",
        attachment,
        adhesiveName: "",
        quoteAdhesiveUnits: 0,
      });
      expect(l.quote).toEqual(quote);
      expect(l.attachment).toBe(attachment);
      expect(l.adhesiveName).toBe("");
      expect(l).not.toHaveProperty("quoteAdhesiveUnits");
    }
    const adhered = nextLayerFromForm(existing, {
      board: "Tapered ISO",
      attachment: "adhesive",
      adhesiveName: "Water Based Adhesive",
      quoteAdhesiveUnits: 12,
    });
    expect(adhered).toMatchObject({
      quote,
      attachment: "adhesive",
      adhesiveName: "Water Based Adhesive",
      quoteAdhesiveUnits: 12,
    });
  });
  it("a different board is a new layer: no quote carried", () => {
    const l = nextLayerFromForm(existing, {
      board: '1/2" ISO',
      attachment: "none",
      adhesiveName: "",
      quoteAdhesiveUnits: 0,
    });
    expect(l).toEqual({
      board: '1/2" ISO',
      attachment: "none",
      fastenersPerBoard: 0,
      adhesiveName: "",
      substrate: "",
    });
  });
  it("no existing layer: the plain layer; adhesive containers only when adhesive and above 0", () => {
    expect(
      nextLayerFromForm(undefined, {
        board: "Flute Filler",
        attachment: "mechanical",
        adhesiveName: "",
        quoteAdhesiveUnits: 5,
      }),
    ).toEqual({
      board: "Flute Filler",
      attachment: "mechanical",
      fastenersPerBoard: 0,
      adhesiveName: "",
      substrate: "",
    });
    expect(
      nextLayerFromForm(undefined, {
        board: "Flute Filler",
        attachment: "adhesive",
        adhesiveName: "X",
        quoteAdhesiveUnits: 5,
      }),
    ).toMatchObject({ quoteAdhesiveUnits: 5 });
    expect(
      nextLayerFromForm(undefined, {
        board: "Flute Filler",
        attachment: "adhesive",
        adhesiveName: "X",
        quoteAdhesiveUnits: 0,
      }),
    ).not.toHaveProperty("quoteAdhesiveUnits");
  });
});

describe("the estimator and the stack", () => {
  it("Apply writes the layer through nextLayerFromForm; a new quote layer takes the form's attachment, never a hard-coded mechanical", () => {
    const route = read("src/routes/estimate.tsx");
    expect(route).toContain("nextLayerFromForm(nextLayers[idx], {");
    expect(route).not.toMatch(/board,\s*attachment: "mechanical",\s*fastenersPerBoard: 0,/);
    expect(route).toContain(
      "attachment: uAttach,\n                                          fastenersPerBoard: 0,",
    );
  });
  it("the stack draws a quoted layer's own attachment (no screw unless it says mechanical)", () => {
    const stack = read("src/components/layer-stack.tsx");
    expect(stack).toContain('const att = l ? p.attachmentOf(l) : "none";');
    expect(stack).not.toContain('!l.quote ? p.attachmentOf(l) : l ? "mechanical" : "none"');
  });
});
