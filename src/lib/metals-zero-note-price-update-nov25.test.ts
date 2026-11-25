/**
 * Which update counts for the $0 note (owner, Nov 25, 2026). Asked whether only an update with
 * Material Pricing ticked should count, he said: "yes the whole reason we add the note is to
 * remind them to check the price since previously it was set to 0 then updated".
 *
 * Before, any OK of the "Update pricing & labor" window counted: a price typed as 0, then an
 * update with only the labor template ticked, gave "You set the price of … to $0 before the
 * last price update" although no price had been updated.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { markMetalsAfterUpdate, type MetalsTypedPrice } from "@/lib/metals-price-override";

const zero: MetalsTypedPrice = { key: "pan", amount: 0 };
const priced: MetalsTypedPrice = { key: "box", amount: 75 };

describe("only a price update flags a $0 price", () => {
  it("Material Pricing ticked: a price that is 0 is flagged", () => {
    expect(markMetalsAfterUpdate([zero, priced], true)).toEqual([
      { key: "pan", amount: 0, zeroAtUpdate: true },
      { key: "box", amount: 75 },
    ]);
  });

  it("only the labor template or the formulas ticked: nothing is flagged", () => {
    expect(markMetalsAfterUpdate([zero, priced], false)).toEqual([zero, priced]);
  });

  it("a flag from an earlier price update stays through an update that changes no price", () => {
    const flagged: MetalsTypedPrice = { key: "pan", amount: 0, zeroAtUpdate: true };
    expect(markMetalsAfterUpdate([flagged], false)).toEqual([flagged]);
  });

  it("the typed amounts are never changed, whichever boxes were ticked", () => {
    for (const ticked of [true, false])
      expect(markMetalsAfterUpdate([zero, priced], ticked).map((t) => t.amount)).toEqual([0, 75]);
  });

  it("the estimator asks the rule, and says the note only after a price update", () => {
    const src = readFileSync("src/routes/estimate.tsx", "utf8").replace(/\s+/g, " ");
    expect(src).toContain(
      "const zeroNow = markMetalsAfterUpdate(metalsTypedPrices, o.materialPricing);",
    );
    expect(src).toContain(
      "const zeroNotes = o.materialPricing ? metalsZeroNotices(result?.metalsScreen, zeroNow) : [];",
    );
    expect(src).not.toContain("const zeroNow = markMetalsZeroAtUpdate(metalsTypedPrices);");
  });
});
