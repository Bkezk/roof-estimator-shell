/**
 * Owner, Nov 24, with a phone picture of Estimator › Metals: "can you make it to where the
 * metals price box is editable and it just stays on that bid, so on this menu I can change the
 * price and it only effect this bid and also if I set the price to 0 then update labor and
 * pricing one of the yellow/orange notes appears that says you set the price of x to 0 before
 * the last price update."
 *
 * The Cost/Quote amount of a Metals line can be typed over. The typed amount is kept on the bid
 * only, is applied around the engine (lib/metals-price-override.ts; nothing under lib/engine is
 * changed) and is not replaced by "Update pricing & labor". Every number below is made up.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  METALS_PRICE_BACK,
  METALS_PRICE_HINT,
  METALS_PRICE_MARK,
  MetalsScreens,
} from "@/components/metals-screens";
import { dismissNotice, restoreNotices, splitNotices } from "@/lib/bid-dismissed-notices";
import { buildBidSummary } from "@/lib/bid-summary";
import { summaryInput } from "@/lib/bid-summary.fixture";
import { combineSavedBids, combineWarningLines } from "@/lib/combine-bids";
import { duplicateBidRow } from "@/lib/duplicate-bid";
import {
  buildLaborTables,
  type EngineAdminData,
  type LaborCombo,
  type MetalsScreenData,
} from "@/lib/engine/adapters";
import { buildEstimateInputs, type BidInput } from "@/lib/engine/bid-builder";
import { computeEstimate } from "@/lib/engine/estimate";
import {
  buildMetalsRefData,
  computeMetals,
  emptyMetalsState,
  removeMetalsLine,
  type MetalsLineSource,
  type MetalsState,
} from "@/lib/engine/metals";
import { buildReviewLedger } from "@/lib/engine/review-ledger";
import {
  MAX_METALS_TYPED_PRICE,
  buildEstimateInputsWithMetalsPrices,
  clearMetalsTypedPrice,
  markMetalsZeroAtUpdate,
  metalsLineKeys,
  metalsMaterialLabel,
  metalsPriceAmount,
  metalsSourceKey,
  metalsStateSources,
  metalsTypedCount,
  metalsZeroNotice,
  metalsZeroNotices,
  priceMetals,
  pruneMetalsTypedPrices,
  readMetalsTypedPrices,
  setMetalsTypedPrice,
  type MetalsTypedPrice,
} from "@/lib/metals-price-override";
import { emptyCustomer, type SavedBidState } from "@/lib/proposal-bid";
import { buildReviewRows, type ReviewData } from "@/lib/review-export";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

// ── A made-up price list and a made-up bid ──────────────────────────────────────────────────

const SIZE = 'A = 6" B = 4" C = 4"';
const screen = (boxCost = 250): MetalsScreenData => ({
  kind: "metals",
  subscreens: {
    gutters: {
      styles: ["DX-Style"],
      sizes_by_style: { "DX-Style": [SIZE] },
      rows: [
        {
          description: 'DX-4 (A=6" B=4" C=4") — Gutter per LF',
          unit_cost: 5,
          labor_per_unit_lf: 0.05,
          labor_rate: 40,
        },
        { description: 'DX-4 (A=6" B=4" C=4") — End Caps (Left)', unit_cost: 10 },
      ],
    },
    pitch_pans: {
      rows: [{ description: "Test Pan", unit_cost: 12.5, labor_per_unit_lf: 0.25, labor_rate: 40 }],
    },
    collection_boxes: {
      options: ["With Scupper"],
      rows_by_option: {
        "With Scupper": [
          {
            description: 'Test Box 10"',
            unit_cost: boxCost,
            labor_per_unit_lf: 1.5,
            labor_rate: 40,
          },
          { description: "Test Box B", unit_cost: 80 },
        ],
      },
    },
  },
});

/** 4 boxes at 250 = 1,000; 2 pans at 12.50 = 25; 40 LF of gutter at 5 = 200; 3 caps at 10 = 30. */
const metalsState = (over: Partial<MetalsState> = {}): MetalsState => ({
  ...emptyMetalsState(),
  gutters: [{ style: "DX-Style", size: SIZE, lengthFt: 40, accQty: { "End Caps (Left)": 3 } }],
  pitchPanQty: { "Test Pan": 2 },
  collectionBoxQty: { "With Scupper": { 'Test Box 10"': 4 } },
  ...over,
});

const BOX: MetalsLineSource = {
  kind: "collectionBox",
  option: "With Scupper",
  desc: 'Test Box 10"',
};
const PAN: MetalsLineSource = { kind: "pitchPan", desc: "Test Pan" };
const GUTTER: MetalsLineSource = { kind: "gutter", style: "DX-Style", size: SIZE };
const BOX_KEY = metalsSourceKey(BOX);
const PAN_KEY = metalsSourceKey(PAN);
const BOX_ITEM = 'Test Box 10" (With Scupper)';

const deckOrder = ["Wood", "Steel"];
const combo: LaborCombo = {
  roof_system: "Duro-Last",
  attachment: "mechanical",
  base: { tab_value: 28, tab_multiplier: 1.5125 },
  deck_multipliers: { Wood: 1 },
  fastener_spacing_multipliers: [{ spacing_in: 18, multiplier: 1 }],
  sheet_size_multipliers: [{ label: "1500 sf", roof_section: 1, underlayment: 1 }],
  thickness_multipliers: [{ mil: 40, multiplier: 1 }],
};
/** Freight as a percent of all material, sales tax on, so a metals change reaches every total. */
const admin = (boxCost = 250): EngineAdminData => ({
  deckOrder,
  priceMatrix: { 40: { rollGoods: { White: 1.25 } } },
  labor: { "Duro-Last|mechanical": buildLaborTables(combo, deckOrder) },
  settings: {
    hoursPerDay: 9,
    masterEliteCont: true,
    salesTax: 0.06,
    taxMaterialOnly: true,
    shippingMode: "percent",
    shippingPercent: 10,
  },
  metals: buildMetalsRefData(screen(boxCost)),
});

const bid = (over: Partial<BidInput> = {}): BidInput => ({
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  sections: [
    {
      id: "s1",
      name: "Main",
      length: 50,
      width: 50,
      deckType: "Wood",
      thickness: 40,
      color: "White",
      fieldLap: 28,
      fastenerOc: 18,
      perimLengthFt: 0,
      cornerLengthFt: 0,
      enhancementWidthFt: 3,
      perimFastenerOc: 18,
      cornerFastenerOc: 18,
      underlaymentBoard: "",
      sheetSizeLabel: "1500 sf",
      tearOff: false,
      tearOffType: "",
      toThicknessInches: 0,
    },
  ],
  accessories: [],
  nonDlLines: [],
  metals: [],
  metalsCalc: metalsState(),
  parapets: [],
  curbs: [],
  markupMode: 2,
  markup: 30,
  crewLaborRatePerHour: 50,
  commission: 0,
  commissionInMarkup: false,
  perDiem: 0,
  perDiemInMarkup: true,
  prepayDiscount: false,
  stdSizeDiscount: false,
  volumeDiscount: false,
  taxExempt: false,
  adjustLaborPct: 0,
  extraShipping: 0,
  subsCost: 0,
  servicesCost: 0,
  materialUnderlayment: 0,
  otherMaterial: 0,
  warrantyCostPerSqFt: 0,
  warrantyNonEliteMasterCharge: 0,
  warrantyIsHighWind: false,
  warrantyHighWindUpcharge: 0,
  ...over,
});

const typed = (key: string, amount: number, zeroAtUpdate = false): MetalsTypedPrice => ({
  key,
  amount,
  ...(zeroAtUpdate ? { zeroAtUpdate: true as const } : {}),
});
const listResult = (state = metalsState(), boxCost = 250) =>
  computeMetals(state, buildMetalsRefData(screen(boxCost)));
const lineOf = (r: ReturnType<typeof priceMetals>, key: string) =>
  r.lines.find((l) => l.priceKey === key)!;

// ── 1. A price typed on a line ──────────────────────────────────────────────────────────────

describe("a metals price typed on the bid replaces that line's amount (owner, Nov 24)", () => {
  it("the list as the engine works it: 1,255.00 of material over four lines", () => {
    const r = priceMetals(listResult(), []);
    expect(r.lines.map((l) => [l.item, l.materialCost])).toEqual([
      [`DX Gutter (${SIZE})`, 200],
      [`End Caps (Left) for DX Gutter (${SIZE})`, 30],
      ["Test Pan", 25],
      [BOX_ITEM, 1000],
    ]);
    expect(r.materialCost).toBe(1255);
    expect(r.lines.every((l) => !l.priceTyped && l.listMaterialCost === l.materialCost)).toBe(true);
    expect(metalsTypedCount(r)).toBe(0);
  });
  it("no typed price: the engine's own figures, to the last bit", () => {
    const odd = computeMetals(
      metalsState({ pitchPanQty: { "Test Pan": 7 } }),
      buildMetalsRefData({
        kind: "metals",
        subscreens: { pitch_pans: { rows: [{ description: "Test Pan", unit_cost: 1.37 }] } },
      }),
    );
    const r = priceMetals(odd, []);
    expect(r.materialCost).toBe(odd.materialCost);
    expect(r.laborCost).toBe(odd.laborCost);
    expect(r.laborHours).toBe(odd.laborHours);
    expect(r.lines.map((l) => l.materialCost)).toEqual(odd.lines.map((l) => l.materialCost));
  });
  it("the typed amount is the line's whole amount; the other lines and the labor stay", () => {
    const list = listResult();
    const r = priceMetals(list, [typed(BOX_KEY, 600)]);
    const box = lineOf(r, BOX_KEY);
    expect(box.materialCost).toBe(600);
    expect(box.listMaterialCost).toBe(1000);
    expect(box.priceTyped).toBe(true);
    expect(box.qtyOrLf).toBe(4);
    expect(box.hours).toBe(list.lines[3]!.hours);
    expect(box.laborCost).toBe(list.lines[3]!.laborCost);
    // 200 + 30 + 25 + 600
    expect(r.materialCost).toBe(855);
    expect(r.listMaterialCost).toBe(1255);
    expect(r.laborCost).toBe(list.laborCost);
    expect(r.laborHours).toBe(list.laborHours);
    expect(metalsTypedCount(r)).toBe(1);
  });
  it("a price of 0 is a price: the line bills nothing and is still marked", () => {
    const r = priceMetals(listResult(), [typed(BOX_KEY, 0)]);
    expect(lineOf(r, BOX_KEY).materialCost).toBe(0);
    expect(lineOf(r, BOX_KEY).priceTyped).toBe(true);
    expect(r.materialCost).toBe(255);
  });
  it("a typed price for a line that is not on the bid changes nothing", () => {
    const r = priceMetals(listResult(), [
      typed(metalsSourceKey({ kind: "pitchPan", desc: "Gone" }), 5),
    ]);
    expect(r.materialCost).toBe(1255);
    expect(metalsTypedCount(r)).toBe(0);
  });
});

describe("what a typed price is remembered by", () => {
  it("each kind of line has its own key", () => {
    const keys = [
      GUTTER,
      { kind: "gutterAcc", style: "DX-Style", size: SIZE, desc: "End Caps (Left)" },
      { kind: "downspout", size: '4"X4"', desc: "Open" },
      { kind: "downspoutAcc", size: '4"X4"', desc: "Open" },
      { kind: "generalAcc", desc: "Test Pan" },
      PAN,
      BOX,
    ].map((s) => metalsSourceKey(s as MetalsLineSource));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("two lines from the same entry get their own keys, so one typed price is not billed twice", () => {
    expect(metalsLineKeys([GUTTER, PAN, GUTTER])).toEqual([
      metalsSourceKey(GUTTER),
      PAN_KEY,
      `${metalsSourceKey(GUTTER)}#2`,
    ]);
    const twice = metalsState({
      gutters: [
        { style: "DX-Style", size: SIZE, lengthFt: 40, accQty: {} },
        { style: "DX-Style", size: SIZE, lengthFt: 20, accQty: {} },
      ],
    });
    const r = priceMetals(listResult(twice), [typed(metalsSourceKey(GUTTER), 1)]);
    expect(r.lines.filter((l) => l.category === "Gutters").map((l) => l.materialCost)).toEqual([
      1, 100,
    ]);
  });
  it("the state's own entries give the same keys as the engine's lines", () => {
    const fromLines = metalsLineKeys(listResult().lines.map((l) => l.source)).sort();
    expect(metalsLineKeys(metalsStateSources(metalsState())).sort()).toEqual(fromLines);
  });
});

describe("the list kept on the bid", () => {
  it("is read safely: an older bid has none, a bad entry is dropped, cents are kept", () => {
    expect(readMetalsTypedPrices(undefined)).toEqual([]);
    expect(readMetalsTypedPrices("x")).toEqual([]);
    expect(
      readMetalsTypedPrices([
        null,
        { key: "", amount: 1 },
        { key: "a", amount: "5" },
        { key: "b", amount: Number.NaN },
        { key: "c", amount: 12.346 },
        { key: "d", amount: -3 },
        { key: "e", amount: 0, zeroAtUpdate: true },
        { key: "f", amount: 7, zeroAtUpdate: true },
      ]),
    ).toEqual([
      { key: "c", amount: 12.35 },
      { key: "d", amount: 0 },
      { key: "e", amount: 0, zeroAtUpdate: true },
      { key: "f", amount: 7 },
    ]);
  });
  it("no negative amounts, and a ceiling", () => {
    expect(metalsPriceAmount(-0.01)).toBe(0);
    expect(Object.is(metalsPriceAmount(-0), 0)).toBe(true);
    expect(metalsPriceAmount(1e12)).toBe(MAX_METALS_TYPED_PRICE);
    expect(metalsPriceAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it("typing sets it, typing again replaces it, clearing goes back to the list price", () => {
    let list = setMetalsTypedPrice([], BOX_KEY, 600);
    expect(list).toEqual([{ key: BOX_KEY, amount: 600 }]);
    list = setMetalsTypedPrice(list, PAN_KEY, 9.999);
    list = setMetalsTypedPrice(list, BOX_KEY, 0);
    expect(list).toEqual([
      { key: BOX_KEY, amount: 0 },
      { key: PAN_KEY, amount: 10 },
    ]);
    list = clearMetalsTypedPrice(list, BOX_KEY);
    expect(list).toEqual([{ key: PAN_KEY, amount: 10 }]);
    expect(lineOf(priceMetals(listResult(), list), BOX_KEY).priceTyped).toBe(false);
    expect(lineOf(priceMetals(listResult(), list), BOX_KEY).materialCost).toBe(1000);
  });
  it("survives a Save and a reopen: what is saved reads back the same", () => {
    const list = [typed(BOX_KEY, 600), typed(PAN_KEY, 0, true)];
    const saved = JSON.parse(JSON.stringify({ metalsTypedPrices: list })) as {
      metalsTypedPrices: unknown;
    };
    expect(readMetalsTypedPrices(saved.metalsTypedPrices)).toEqual(list);
  });
});

// ── 2. Around the engine ────────────────────────────────────────────────────────────────────

describe("every total downstream is worked by the engine from the changed metals material", () => {
  it("no typed price: exactly what buildEstimateInputs gives", () => {
    const plain = buildEstimateInputs(bid(), admin());
    const priced = buildEstimateInputsWithMetalsPrices(bid(), admin(), undefined);
    expect(priced.inputs).toEqual(plain.inputs);
    expect(priced.metalsMaterial).toBe(plain.metalsMaterial);
    expect(priced.warnings).toEqual(plain.warnings);
    expect(priced.metalsScreen?.materialCost).toBe(plain.metalsScreen?.materialCost);
  });
  it("a typed 600 on the 1,000 line moves the metals material, the Duro-Last material and the material total by 400", () => {
    const plain = buildEstimateInputs(bid(), admin());
    const priced = buildEstimateInputsWithMetalsPrices(bid(), admin(), [typed(BOX_KEY, 600)]);
    expect(plain.metalsMaterial).toBe(1255);
    expect(priced.metalsMaterial).toBe(855);
    expect(priced.metalsScreen?.materialCost).toBe(855);
    expect(priced.inputs.duroLastMaterial).toBeCloseTo(plain.inputs.duroLastMaterial - 400, 6);
    expect(priced.inputs.materialTotalBeforeTax).toBeCloseTo(
      plain.inputs.materialTotalBeforeTax - 400,
      6,
    );
    // Freight is 10 % of all material here: 40 less.
    expect(priced.inputs.shipping).toBeCloseTo(plain.inputs.shipping - 40, 4);
    // Labor is not touched by a typed price.
    expect(priced.inputs.ownRateDirectLaborCost).toBe(plain.inputs.ownRateDirectLaborCost);
    expect(priced.inputs.ownRateDirectLaborHours).toBe(plain.inputs.ownRateDirectLaborHours);
    expect(priced.breakdown.metalsLaborCost).toBe(plain.breakdown.metalsLaborCost);
  });
  it("the bid total is the one the engine gives a price list that works that amount itself", () => {
    // 4 boxes: a list price of 150 each works 600 with no typed price.
    const native = buildEstimateInputs(bid(), admin(150));
    const priced = buildEstimateInputsWithMetalsPrices(bid(), admin(250), [typed(BOX_KEY, 600)]);
    const a = computeEstimate(native.inputs);
    const b = computeEstimate(priced.inputs);
    expect(b.money.grandTotal).toBe(a.money.grandTotal);
    expect(b.money.dTotals).toEqual(a.money.dTotals);
    expect(b.money.taxCharged).toBe(a.money.taxCharged);
    expect(b.laborSubtotal1).toBe(a.laborSubtotal1);
    // And it is not the list-price total.
    const list = computeEstimate(buildEstimateInputs(bid(), admin(250)).inputs);
    expect(b.money.grandTotal).toBeLessThan(list.money.grandTotal);
  });
  it("a typed price above the list price raises the total the same way", () => {
    const native = computeEstimate(buildEstimateInputs(bid(), admin(500)).inputs);
    const priced = computeEstimate(
      buildEstimateInputsWithMetalsPrices(bid(), admin(250), [typed(BOX_KEY, 2000)]).inputs,
    );
    expect(priced.money.grandTotal).toBe(native.money.grandTotal);
  });
  it("a typed 0 takes the line's material out of the bid", () => {
    const priced = buildEstimateInputsWithMetalsPrices(bid(), admin(), [typed(BOX_KEY, 0)]);
    expect(priced.metalsMaterial).toBe(255);
    const native = computeEstimate(buildEstimateInputs(bid(), admin(0)).inputs);
    expect(computeEstimate(priced.inputs).money.grandTotal).toBe(native.money.grandTotal);
  });
  it("the Review ledger's Metals row and the saved figures read the typed amount", () => {
    const b = bid();
    const priced = buildEstimateInputsWithMetalsPrices(b, admin(), [typed(BOX_KEY, 600)]);
    const est = computeEstimate(priced.inputs);
    const ledger = buildReviewLedger({ bid: b, result: priced, est, crewRate: 50 });
    expect(ledger.purchases.duroLast.find((r) => r.label === "Metals")?.cost).toBe(855);
  });
  it("the bid handed in is not changed, and older flat metals lines still bill beside it", () => {
    const flatLine = {
      description: "Old line",
      price: 100,
      laborPerUnit: 0,
      laborRate: 0,
      quantity: 2,
    };
    const b = bid({ metals: [flatLine] });
    const priced = buildEstimateInputsWithMetalsPrices(b, admin(), [typed(BOX_KEY, 600)]);
    expect(b.metals).toEqual([flatLine]);
    expect(priced.metalsMaterial).toBe(1055);
  });
  it("a pricing snapshot with no metals list: nothing to change, nothing breaks", () => {
    const { metals: _m, ...noMetals } = admin();
    const priced = buildEstimateInputsWithMetalsPrices(bid(), noMetals, [typed(BOX_KEY, 600)]);
    expect(priced.metalsMaterial).toBe(0);
    expect(priced.metalsScreen).toBeUndefined();
  });
});

describe('"Update pricing & labor" does not replace a typed price', () => {
  it("the price list moves: the untyped lines follow it, the typed line stays", () => {
    const list = [typed(BOX_KEY, 600)];
    // The update itself only flags zeros; the amounts are what they were.
    expect(markMetalsZeroAtUpdate(list)).toEqual(list);
    const before = buildEstimateInputsWithMetalsPrices(bid(), admin(250), list);
    const after = buildEstimateInputsWithMetalsPrices(
      bid(),
      admin(400),
      markMetalsZeroAtUpdate(list),
    );
    expect(lineOf(after.metalsScreen!, BOX_KEY).listMaterialCost).toBe(1600);
    expect(lineOf(after.metalsScreen!, BOX_KEY).materialCost).toBe(600);
    expect(after.metalsMaterial).toBe(before.metalsMaterial);
  });
  it("the estimator's update writes the flags back and keeps the amounts", () => {
    const src = flat("src/routes/estimate.tsx");
    expect(src).toContain("const zeroNow = markMetalsZeroAtUpdate(metalsTypedPrices);");
    expect(src).toContain("setMetalsTypedPrices(zeroNow);");
    // Nothing in the update empties the list.
    expect(src).not.toContain("setMetalsTypedPrices([])");
  });
});

// ── 3. The zero note ────────────────────────────────────────────────────────────────────────

describe("the zero note (owner: 'you set the price of x to 0 before the last price update')", () => {
  const NOTE = `You set the price of ${BOX_ITEM} to $0 before the last price update.`;
  it("its words", () => {
    expect(metalsZeroNotice("Test Pan")).toBe(
      "You set the price of Test Pan to $0 before the last price update.",
    );
  });
  it("a price set to 0 says nothing until the update is pressed", () => {
    const list = setMetalsTypedPrice([], BOX_KEY, 0);
    expect(metalsZeroNotices(priceMetals(listResult(), list), list)).toEqual([]);
  });
  it("pressing the update with a price at 0 gives one note for that line, and only that line", () => {
    const list = markMetalsZeroAtUpdate([typed(BOX_KEY, 0), typed(PAN_KEY, 40)]);
    expect(list).toEqual([typed(BOX_KEY, 0, true), typed(PAN_KEY, 40)]);
    expect(metalsZeroNotices(priceMetals(listResult(), list), list)).toEqual([NOTE]);
  });
  it("one note for each line at 0", () => {
    const list = markMetalsZeroAtUpdate([typed(BOX_KEY, 0), typed(PAN_KEY, 0)]);
    expect(metalsZeroNotices(priceMetals(listResult(), list), list)).toEqual([
      "You set the price of Test Pan to $0 before the last price update.",
      NOTE,
    ]);
  });
  it("it is there after a Save and a reopen", () => {
    const list = readMetalsTypedPrices(
      JSON.parse(JSON.stringify(markMetalsZeroAtUpdate([typed(BOX_KEY, 0)]))),
    );
    expect(metalsZeroNotices(priceMetals(listResult(), list), list)).toEqual([NOTE]);
  });
  it("it goes when the price is no longer 0, and typing 0 again waits for the next update", () => {
    const flagged = markMetalsZeroAtUpdate([typed(BOX_KEY, 0)]);
    const changed = setMetalsTypedPrice(flagged, BOX_KEY, 75);
    expect(metalsZeroNotices(priceMetals(listResult(), changed), changed)).toEqual([]);
    const zeroAgain = setMetalsTypedPrice(changed, BOX_KEY, 0);
    expect(zeroAgain).toEqual([typed(BOX_KEY, 0)]);
    expect(metalsZeroNotices(priceMetals(listResult(), zeroAgain), zeroAgain)).toEqual([]);
    const next = markMetalsZeroAtUpdate(zeroAgain);
    expect(metalsZeroNotices(priceMetals(listResult(), next), next)).toEqual([NOTE]);
  });
  it("retyping 0 over a flagged 0 keeps the note; going back to the list price ends it", () => {
    const flagged = markMetalsZeroAtUpdate([typed(BOX_KEY, 0)]);
    expect(setMetalsTypedPrice(flagged, BOX_KEY, 0)).toEqual(flagged);
    const cleared = clearMetalsTypedPrice(flagged, BOX_KEY);
    expect(metalsZeroNotices(priceMetals(listResult(), cleared), cleared)).toEqual([]);
  });
  it("an update with the price above 0 takes the flag off", () => {
    const list = markMetalsZeroAtUpdate([typed(BOX_KEY, 75, true)]);
    expect(list).toEqual([typed(BOX_KEY, 75)]);
  });
  it("it is a yellow notice like the others: dismissed one at a time by its words, and brought back", () => {
    const notices = ["Some other notice.", NOTE];
    let dismissed = dismissNotice([], NOTE);
    expect(splitNotices(notices, dismissed)).toEqual({
      open: ["Some other notice."],
      hidden: [NOTE],
    });
    // The next update shows it again: a new update, the same words.
    dismissed = restoreNotices(dismissed, [NOTE]);
    expect(splitNotices(notices, dismissed).open).toEqual(notices);
  });
  it("the estimator puts it in the bid's one list of yellow notices and shows it again at each update", () => {
    const src = flat("src/routes/estimate.tsx");
    // The same list the "Check inputs" box shows and the yellow triangles count.
    expect(src).toContain(
      "warnings: [...warnings, ...metalsZeroNotices(build.metalsScreen, metalsTypedPrices)],",
    );
    expect(src).toContain(
      "const openInputWarnings = result ? splitNotices(result.warnings, dismissedNotices).open : [];",
    );
    expect(src).toContain("notices={result.warnings}");
    expect(src).toContain(
      "if (zeroNotes.length) setDismissedNotices((prev) => restoreNotices(prev, zeroNotes));",
    );
    expect(src).toContain(
      "for (const note of zeroNotes) toast.warning(note, { duration: 15_000 });",
    );
  });
});

// ── 4. The line's quantity is edited, or the line is removed ────────────────────────────────

describe("a typed price belongs to its line", () => {
  const list = [typed(BOX_KEY, 600), typed(PAN_KEY, 9)];
  it("the quantity is edited: the typed amount and its mark stay", () => {
    const more = metalsState({ collectionBoxQty: { "With Scupper": { 'Test Box 10"': 9 } } });
    expect(pruneMetalsTypedPrices(list, more)).toBe(list);
    const r = priceMetals(listResult(more), list);
    expect(lineOf(r, BOX_KEY).qtyOrLf).toBe(9);
    expect(lineOf(r, BOX_KEY).materialCost).toBe(600);
    expect(lineOf(r, BOX_KEY).listMaterialCost).toBe(2250);
    expect(lineOf(r, BOX_KEY).priceTyped).toBe(true);
  });
  it("the line is removed: its typed price goes, the others stay", () => {
    const after = removeMetalsLine(metalsState(), BOX);
    expect(pruneMetalsTypedPrices(list, after)).toEqual([typed(PAN_KEY, 9)]);
  });
  it("removed and added again: it starts at the list price", () => {
    const kept = pruneMetalsTypedPrices(list, removeMetalsLine(metalsState(), BOX));
    const r = priceMetals(listResult(metalsState()), kept);
    expect(lineOf(r, BOX_KEY).priceTyped).toBe(false);
    expect(lineOf(r, BOX_KEY).materialCost).toBe(1000);
  });
  it("a quantity left at nothing is a removed line", () => {
    const none = metalsState({ pitchPanQty: { "Test Pan": 0 } });
    expect(pruneMetalsTypedPrices(list, none)).toEqual([typed(BOX_KEY, 600)]);
  });
  it("the screen drops it at Remove and when an entry screen is closed, not while a quantity is retyped", () => {
    const src = flat("src/components/metals-screens.tsx");
    expect(src).toContain("dropGonePrices(next, ln.priceKey);");
    expect(src).toContain("const closeTile = () => { setOpenTile(null); dropGonePrices(state); };");
    expect(src.match(/onClose=\{closeTile\}/g)).toHaveLength(4);
    expect(src).not.toContain("onClose={() => setOpenTile(null)}");
  });
});

// ── 5. On the screen ────────────────────────────────────────────────────────────────────────

describe("the Metals list shows a box for each amount and marks a typed one", () => {
  const render = (prices: MetalsTypedPrice[]) =>
    renderToStaticMarkup(
      createElement(MetalsScreens, {
        refData: buildMetalsRefData(screen()),
        state: metalsState(),
        onChange: () => {},
        result: priceMetals(listResult(), prices),
        prices,
        onPricesChange: () => {},
      }),
    );
  it("the words", () => {
    expect(METALS_PRICE_HINT).toBe(
      "Tap a Cost/Quote amount to type your own price. It stays on this bid only.",
    );
    expect(METALS_PRICE_MARK).toBe("Your price");
    expect(METALS_PRICE_BACK).toBe("Use the list price");
  });
  it("every amount is a box to tap, and none is marked while nothing was typed", () => {
    const html = render([]);
    expect(html).toContain(METALS_PRICE_HINT);
    expect(html.match(/data-metals-price="list"/g)).toHaveLength(4);
    expect(html).not.toContain('data-metals-price="typed"');
    expect(html).not.toContain(METALS_PRICE_MARK);
    expect(html).not.toContain(METALS_PRICE_BACK);
    expect(html).toContain(">$1,000.00</button>");
    // The Totals row.
    expect(html).toContain(">$1,255.00</td>");
  });
  it("a typed amount shows in its box, marked, with the way back and the list price", () => {
    const html = render([typed(BOX_KEY, 600)]);
    expect(html.match(/data-metals-price="typed"/g)).toHaveLength(1);
    expect(html.match(/data-metals-price="list"/g)).toHaveLength(3);
    expect(html).toContain(">$600.00</button>");
    expect(html.match(/Your price/g)).toHaveLength(1);
    expect(html).toContain("Use the list price ($1,000.00)");
    expect(html).toContain('data-action="metals-list-price"');
    // The Totals row reads the typed amount.
    expect(html).toContain(">$855.00</td>");
    expect(html).not.toContain(">$1,255.00</td>");
  });
  it("a typed $0 is shown as $0.00 and marked", () => {
    const html = render([typed(BOX_KEY, 0)]);
    expect(html).toContain(">$0.00</button>");
    expect(html).toContain(METALS_PRICE_MARK);
  });
  it("the box is the project's number box: no negatives, emptied = list price, no phone zoom", () => {
    const src = flat("src/components/metals-screens.tsx");
    const at = src.indexOf("<NumberField autoFocus");
    expect(at).toBeGreaterThan(0);
    const box = src.slice(at, src.indexOf("/>", at));
    expect(box).toContain("onChange={props.onAmount}");
    expect(box).toContain("onBlank={props.onListPrice}");
    expect(box).toContain("blankZero={false}");
    expect(box).toContain("max={MAX_METALS_TYPED_PRICE}");
    expect(box).toContain('inputMode="decimal"');
    // The number box's own lower limit is 0; the metals box does not lift it.
    expect(box).not.toContain("min=");
    expect(flat("src/components/ui/number-field.tsx")).toContain("const min = props.min ?? 0;");
    // An iPhone zooms the page on a tap into letters under 16 px (the site's own are smaller):
    // on a phone the box takes the next size up (1.125rem, over 16 px with the site text scale),
    // and the site's own iPhone rule is still in place.
    expect(box).toContain("max-md:text-lg");
    expect(box).not.toMatch(/(^|[\s"])text-(xs|sm)\b/);
    expect(read("src/routes/__root.tsx")).toContain("lockIosFocusZoom");
    // A double tap in the box is typing, not "open this row's entry screen".
    expect(src).toContain("onDoubleClick={(e) => e.stopPropagation()}");
  });
  it("on a phone the box is thumb-sized and the list is no wider than it was with plain amounts", () => {
    const src = flat("src/components/metals-screens.tsx");
    // 44 px tall below the md width, for the amount and for the box it turns into.
    expect(src.match(/max-md:h-\[44px\]/g)).toHaveLength(2);
    // The cell gives its side padding to the box; the typing box and the mark take the
    // column's width instead of setting it.
    expect(src).toContain('const PRICE_CELL = "px-0 text-right tabular-nums";');
    expect(src).toContain('const FILL = "w-0 min-w-full";');
    expect(src).toContain("<TableCell className={PRICE_CELL}>");
    expect(src).toContain("<div className={FILL}> <NumberField autoFocus");
    expect(src).toContain(
      "className={`${FILL} flex flex-col items-end gap-0.5 text-right text-xs`}",
    );
  });
  it("the estimator hands the screen the priced list and keeps the typed prices on the bid", () => {
    const src = flat("src/routes/estimate.tsx");
    expect(src).toContain("prices={metalsTypedPrices} onPricesChange={setMetalsTypedPrices}");
    expect(src).toContain("setMetalsTypedPrices(readMetalsTypedPrices(d.metalsTypedPrices));");
    expect(src).toContain("...(metalsTypedPrices.length ? { metalsTypedPrices } : {}),");
    expect(src).toContain("}, [admin, JSON.stringify(bid), JSON.stringify(metalsTypedPrices)]);");
    expect(src).toContain(
      "buildEstimateInputsWithMetalsPrices(b, adminForBid(admin, b.roofSystem), metalsTypedPrices)",
    );
    // The card's Material total and the Review row read the same priced result.
    expect(src).toContain("money(result.metalsScreen.materialCost)");
    expect(src).toContain("label={metalsMaterialLabel(metalsTypedCount(result.metalsScreen))}");
  });
});

// ── 6. Everything else that reads the metals material ───────────────────────────────────────

describe("the other readers of the metals material", () => {
  it("the Review step and its export say when the amount holds typed prices", () => {
    expect(metalsMaterialLabel(0)).toBe("Metals material");
    expect(metalsMaterialLabel(1)).toBe("Metals material (1 price typed on this bid)");
    expect(metalsMaterialLabel(3)).toBe("Metals material (3 prices typed on this bid)");
    const data: ReviewData = {
      bidName: "ZZ made-up bid",
      statusLabel: "Draft",
      membraneMaterial: 3000,
      parapetMaterial: 0,
      curbMaterial: 0,
      metalsMaterial: 855,
      metalsTypedPrices: 1,
      adhesiveMaterial: 0,
      accessoryMaterial: 0,
      underlaymentMaterial: 0,
      otherMaterial: 0,
      discounts: 0,
      warrantyCost: 0,
      shipping: 0,
      laborCost: 700,
      subsServices: 0,
      subtotal1: 4555,
      markupLabel: "Gross profit %",
      markupValue: 0,
      subtotal2: 4555,
      commissionValue: 0,
      perDiemCharge: 0,
      salesTaxValue: 0,
      grandTotal: 4555,
      installHours: 14,
      setupHours: 0,
      inspectionHours: 0,
      tearOffHours: 0,
      accessoryHours: 0,
      parapetHours: 0,
      curbHours: 0,
      underlaymentHours: 0,
      ownRateHours: 0,
      totalManDays: 2,
      disposalUnits: 0,
      roofSqFt: 2500,
      membraneSqFt: 2600,
    };
    const row = (d: ReviewData) => buildReviewRows(d).find((r) => r[1]?.startsWith("Metals"));
    expect(row(data)).toEqual([
      "Purchases",
      "Metals material (1 price typed on this bid)",
      "855.00",
    ]);
    // Typed down to nothing: the row stays, where a plain 0 is left out.
    expect(row({ ...data, metalsMaterial: 0 })?.[2]).toBe("0.00");
    expect(row({ ...data, metalsMaterial: 0, metalsTypedPrices: 0 })).toBeUndefined();
    expect(row({ ...data, metalsTypedPrices: 0 })?.[1]).toBe("Metals material");
    expect(flat("src/routes/estimate.tsx")).toContain(
      "metalsTypedPrices: metalsTypedCount(result.metalsScreen),",
    );
  });
  it("the bid summary's Metals table reads the typed amounts", () => {
    const priced = priceMetals(listResult(), [typed(BOX_KEY, 600)]);
    const summary = buildBidSummary({
      ...summaryInput,
      computed: { ...summaryInput.computed, metalsScreen: priced },
    });
    const text = JSON.stringify(summary.steps.find((s) => s.key === "metals"));
    expect(text).toContain("$600.00");
    expect(text).toContain("$855.00");
    expect(text).not.toContain("$1,255.00");
  });
  it("the proposal prices the bid the same way, from the bid's own list", () => {
    const src = flat("src/routes/proposal.tsx");
    expect(src).toContain(
      "buildEstimateInputsWithMetalsPrices( b, adminForBid(cd.admin!, b.roofSystem), saved.metalsTypedPrices, )",
    );
    // Its saved state spreads the stored bid first, so the list comes along.
    expect(src).toContain("...(raw as SavedBidState),");
    expect(src).not.toContain("buildEstimateInputs(b,");
  });
});

// ── 7. It stays on that bid ─────────────────────────────────────────────────────────────────

describe("it stays on that bid only", () => {
  const savedWith = (prices: MetalsTypedPrice[]): SavedBidState => ({
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
    metalsCalc: metalsState(),
    ...(prices.length ? { metalsTypedPrices: prices } : {}),
  });
  it("nothing of it is in the price list: the same list prices another bid at list", () => {
    const a = admin();
    const before = JSON.stringify(a);
    buildEstimateInputsWithMetalsPrices(bid(), a, [typed(BOX_KEY, 600)]);
    expect(JSON.stringify(a)).toBe(before);
    expect(buildEstimateInputsWithMetalsPrices(bid(), a, undefined).metalsMaterial).toBe(1255);
  });
  it("a copy of the bid takes the whole saved bid, typed prices and zero flags with it", () => {
    const prices = [typed(BOX_KEY, 600), typed(PAN_KEY, 0, true)];
    const copy = duplicateBidRow(
      {
        name: "ZZ made-up bid",
        data: savedWith(prices),
        grand_total: 1,
        account_id: null,
        site_id: null,
        building_id: null,
        roof_id: null,
      },
      null,
      "2026-11-24T00:00:00.000Z",
    );
    expect(readMetalsTypedPrices((copy.data as SavedBidState).metalsTypedPrices)).toEqual(prices);
  });
  it("combined bids are priced at the list price again, and the bids that had typed prices are named", () => {
    const r = combineSavedBids(
      [
        { id: "a", name: "Made-up A", saved: savedWith([typed(BOX_KEY, 600), typed(PAN_KEY, 9)]) },
        { id: "b", name: "Made-up B", saved: savedWith([]) },
      ],
      savedWith([]),
      "2026-11-24T00:00:00.000Z",
    );
    expect(r.saved.metalsTypedPrices).toBeUndefined();
    expect(r.info.metalsPricesNotCarried).toEqual([{ name: "Made-up A", count: 2 }]);
    expect(combineWarningLines(r.info).at(-1)).toBe(
      "Metals prices typed on a bid were not carried over. This bid uses the list prices. Typed on: “Made-up A” (2 prices)",
    );
    const none = combineSavedBids(
      [
        { id: "a", name: "Made-up A", saved: savedWith([]) },
        { id: "b", name: "Made-up B", saved: savedWith([]) },
      ],
      savedWith([]),
    );
    expect(none.info.metalsPricesNotCarried).toBeUndefined();
    expect(combineWarningLines(none.info).join(" ")).not.toContain("Metals prices");
  });
});
