/**
 * Price List Import triage (owner, Nov 2): after the item-number match, every leftover sheet line
 * lands in exactly one of two lists — Likely matches (paired with one catalog product) or No match
 * found — and a product is offered once, to its best line.
 */
import { describe, expect, it } from "vitest";
import type { ItemNumberMapping, SheetItem } from "@/lib/price-import";
import {
  likelyKey,
  strengthOf,
  triageUnmatched,
  type TriageTarget,
} from "@/lib/price-import-triage";

const line = (rowIndex: number, itemNo: string, description: string, price = 10): SheetItem => ({
  rowIndex,
  itemNo,
  key: itemNo.toUpperCase(),
  description,
  price,
  unit: "EA",
  size: "",
});
const map = (
  item_no: string,
  screen_id: string,
  row_label: string,
  price_col = "Price",
): ItemNumberMapping => ({
  item_no,
  screen_id,
  row_label,
  price_col,
});
const targets: TriageTarget[] = [
  {
    screen_id: "duro_last:sealants",
    category: "Sealants",
    rows: ["Duro-Caulk Plus - White", "Duro-Caulk Plus - Tan", "Strip Mastic (Pail)", "Tab Sealer"],
    price_cols: ["Price"],
    values: {
      "Duro-Caulk Plus - White": { Price: 10.2 },
      "Strip Mastic (Pail)": { Price: 149.15 },
    },
  },
  {
    screen_id: "duro_last:vents",
    category: "Vents",
    rows: ["White Vent", "Tan Vent"],
    price_cols: ["Price"],
    values: { "White Vent": { Price: 28.25 } },
  },
];

describe("triageUnmatched", () => {
  it("pairs a product with no number to the sheet line that names it, strong when every word is there", () => {
    const r = triageUnmatched({
      unmatched: [
        line(3, "1136", "DURO-CAULK PLUS WHT 10.3 OZ"),
        line(4, "9999", "ROOF HATCH 30X36"),
      ],
      notInSheet: [],
      mappings: [],
      targets,
    });
    expect(r.likely).toHaveLength(1);
    const p = r.likely[0]!;
    expect(p.kind).toBe("new");
    expect(p.item.itemNo).toBe("1136");
    expect(p.target).toMatchObject({
      screen_id: "duro_last:sealants",
      row_label: "Duro-Caulk Plus - White",
      price_col: "Price",
    });
    expect(p.strength).toBe("strong");
    expect(p.currentPrice).toBe(10.2);
    expect(r.noMatch.map((it) => it.itemNo)).toEqual(["9999"]);
  });

  it("never pairs a product that already has an item number as new", () => {
    const r = triageUnmatched({
      unmatched: [line(1, "1136X", "DURO-CAULK PLUS WHT")],
      notInSheet: [],
      mappings: [map("1136", "duro_last:sealants", "Duro-Caulk Plus - White")],
      targets,
    });
    expect(r.likely).toEqual([]);
    expect(r.noMatch).toHaveLength(1);
  });

  it("pairs a renumbered product (old number not on the sheet) with the line that names it", () => {
    const r = triageUnmatched({
      unmatched: [line(7, "1129N", "STRIP MASTIC PAIL 5 GAL")],
      notInSheet: [map("1129", "duro_last:sealants", "Strip Mastic (Pail)")],
      mappings: [map("1129", "duro_last:sealants", "Strip Mastic (Pail)")],
      targets,
    });
    expect(r.likely).toHaveLength(1);
    expect(r.likely[0]).toMatchObject({
      kind: "renumbered",
      oldItemNo: "1129",
      currentPrice: 149.15,
    });
    expect(r.likely[0]!.target.row_label).toBe("Strip Mastic (Pail)");
    expect(r.noMatch).toEqual([]);
  });

  it("offers one product to one line and one line to one product — the stronger pairing wins", () => {
    const r = triageUnmatched({
      unmatched: [line(1, "A", "WHITE VENT TWO-WAY"), line(2, "B", "VENT WHITE")],
      notInSheet: [],
      mappings: [],
      targets,
    });
    const vent = r.likely.filter((p) => p.target.row_label === "White Vent");
    expect(vent).toHaveLength(1);
    expect(r.likely.length + r.noMatch.length).toBe(2);
  });

  it("Not this drops the pair and the line falls to No match", () => {
    const it0 = line(3, "1136", "DURO-CAULK PLUS WHT");
    const first = triageUnmatched({ unmatched: [it0], notInSheet: [], mappings: [], targets });
    const key = first.likely[0]!.key;
    expect(key).toBe(likelyKey(it0, first.likely[0]!.target));
    const r = triageUnmatched({
      unmatched: [it0],
      notInSheet: [],
      mappings: [],
      targets,
      dismissed: new Set([key]),
    });
    expect(r.likely).toEqual([]);
    expect(r.noMatch.map((it) => it.itemNo)).toEqual(["1136"]);
  });

  it("calls 60–99% coverage possible and full coverage strong", () => {
    expect(strengthOf(1)).toBe("strong");
    expect(strengthOf(0.67)).toBe("possible");
  });
});
