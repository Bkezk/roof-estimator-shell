/**
 * The underlayment layer stack drawn like Bid Advantage (owner, Oct 26, screenshot: "can you
 * make the fastener visual match bid advantage better on the underlayment"): the layer bars sit
 * tight on top of each other with the blue Deck under them, and ONE tall black screw stands in
 * the middle, its head above the topmost mechanically fastened layer and its tip in the deck —
 * the screw goes through every layer beneath it, whatever holds those (an adhered or loose board
 * under a fastened one is still pierced). The green adhesive bed still sits between an adhered
 * layer and what it sits on. The web used to draw a short screw between each fastened layer and
 * the one below.
 */
import { describe, expect, it } from "vitest";

import { ROW, screwSpan, stackRows, type StackRow } from "@/lib/layer-stack-geometry";

/** Attachments listed TOP-DOWN (Layer 3, Layer 2, Layer 1); the stack indexes layers by slot. */
const rows = (atts: Array<"mechanical" | "adhesive" | "none" | "durobond" | null>): StackRow[] =>
  stackRows([2, 1, 0], [...atts].reverse(), (a) => a ?? "none");

describe("stackRows: the rows top-down", () => {
  it("empty slots, then the filled bars, a bed under an adhered layer, the deck last", () => {
    expect(rows([null, "adhesive", "mechanical"]).map((r) => r.kind)).toEqual([
      "empty",
      "bar",
      "bed",
      "bar",
      "deck",
    ]);
  });
});

describe("screwSpan: one screw from the topmost fastened layer into the deck", () => {
  it("the Bid Advantage case: two fastened layers → the head above Layer 2, the tip in the deck", () => {
    const r = rows([null, "mechanical", "mechanical"]);
    const s = screwSpan(r);
    expect(s).not.toBeNull();
    expect(s!.fromRow).toBe(1);
    // Through Layer 2, the gap, Layer 1, the gap, and halfway into the deck.
    expect(s!.heightPx).toBe(ROW.bar + ROW.gap + ROW.bar + ROW.gap + ROW.deck / 2);
  });
  it("a loose (None) tapered board under a fastened one is pierced: the screw still starts at the top layer", () => {
    const s = screwSpan(rows([null, "mechanical", "none"]));
    expect(s!.fromRow).toBe(1);
  });
  it("an adhered layer on top of a fastened one: the screw starts at the fastened one, under the bed", () => {
    const r = rows([null, "adhesive", "mechanical"]);
    const s = screwSpan(r);
    expect(r[s!.fromRow]!.kind).toBe("bar");
    expect(s!.fromRow).toBe(3);
    expect(s!.heightPx).toBe(ROW.bar + ROW.gap + ROW.deck / 2);
  });
  it("Duro-Bond counts as fastened; nothing fastened → no screw", () => {
    expect(screwSpan(rows([null, null, "durobond"]))!.fromRow).toBe(2);
    expect(screwSpan(rows([null, "adhesive", "adhesive"]))).toBeNull();
    expect(screwSpan(rows([null, null, null]))).toBeNull();
  });
});
