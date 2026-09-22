import { describe, expect, it } from "vitest";

import { findRowByKey, rowKeys } from "./catalog-row-key";

describe("catalog row keys", () => {
  const cols = ["Part #", "Subtype", "Description", "Price/Box", "Fasteners/Box"];
  const rows = [
    { "Part #": "1446", Subtype: "Spade", Description: '2"', "Price/Box": 149.5 },
    { "Part #": "1751", Subtype: "Auger", Description: '2"', "Price/Box": 374.5 },
    { "Part #": "1243", Subtype: "Stainless", Description: '1 5/8" #12', "Price/Box": 598 },
  ];
  it("keeps a unique label as-is and disambiguates repeats by Subtype", () => {
    expect(rowKeys(cols, rows)).toEqual(['2" [Spade]', '2" [Auger]', '1 5/8" #12']);
    expect(findRowByKey(cols, rows, '2" [Auger]')?.["Part #"]).toBe("1751");
    expect(findRowByKey(cols, rows, '2"')).toBeUndefined();
  });
  it("falls back to Part # when the screen has no Subtype (vinyl covers on two bar sizes)", () => {
    const c = ["Description", "Part #", "Price"];
    const r = [
      { Description: '1 3/4" Fascia Bar', "Part #": "1568", Price: 2.5 },
      { Description: "White Vinyl Cover", "Part #": "1569", Price: 3.7 },
      { Description: '4" Fascia Bar', "Part #": "1571", Price: 4 },
      { Description: "White Vinyl Cover", "Part #": "1572", Price: 3.7 },
    ];
    expect(rowKeys(c, r)).toEqual([
      '1 3/4" Fascia Bar',
      "White Vinyl Cover [1569]",
      '4" Fascia Bar',
      "White Vinyl Cover [1572]",
    ]);
  });
});
