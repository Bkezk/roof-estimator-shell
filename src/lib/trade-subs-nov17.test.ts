/**
 * Trade Bids, subcontractor lines (owner, Nov 17: "can it be used when we sub stuff out?" …
 * "Go ahead and add the subcontractors line").
 *
 * The painting job of trade-bid-nov16.test.ts, with work handed to two subs. Every number was
 * worked out by hand first:
 *
 *   our own costs (the Nov 16 job)   materials 717.50 + tax 43.05 + labor 1,062 + lift 400
 *                                                                                 $2,222.55
 *   subs
 *     pressure washing   $0.20 a sq ft of walls × 3,000, its own markup 10%
 *                        cost 600.00, markup 60.00
 *     scaffolding crew   quoted $1,500 for the job, no markup of its own
 *                        cost 1,500.00 (overhead and profit apply to it)
 *                                                              subs              $2,100.00
 *   cost      2,222.55 + 2,100.00                                               $4,322.55
 *   overhead and profit are worked on everything but the line with its own markup:
 *             4,322.55 − 600.00                                                 $3,722.55
 *   overhead  15% of 3,722.55 = 558.3825                                          $558.38
 *   that part 3,722.55 × 1.15 × 1.20 = 5,137.119                               $5,137.12
 *   profit    5,137.12 − 3,722.55 − 558.38                                        $856.19
 *   price     5,137.12 + 600.00 + 60.00                                        $5,797.12
 *   margin    (5,797.12 − 4,322.55) ÷ 5,797.12 = 25.4%
 *   time      still 37 hours: a sub's work is not our crew's.
 */
import { describe, expect, it } from "vitest";

import { asBidFigures } from "@/lib/bid-figures";
import {
  asTradeBidData,
  calcTradeBid,
  copySetup,
  emptySetup,
  newTradeBid,
  tradeFigures,
  tradeSetupSchema,
  type TradeSetup,
  type TradeSub,
} from "@/lib/trade-bid";

const VENDOR = "9b0f4c1e-2a6d-4c57-8e31-5d7a6b2c1f09";

const material = (
  id: string,
  over: Partial<TradeSetup["materials"][number]>,
): TradeSetup["materials"][number] => ({
  id,
  name: id,
  unit: "gallon",
  cost: null,
  basis: "measure",
  measure_id: null,
  coverage: null,
  waste_pct: null,
  whole: false,
  qty: null,
  ...over,
});
const labor = (
  id: string,
  over: Partial<TradeSetup["labor"][number]>,
): TradeSetup["labor"][number] => ({
  id,
  name: id,
  basis: "measure",
  measure_id: null,
  per_hour: null,
  hours: null,
  rate: null,
  ...over,
});
const sub = (id: string, over: Partial<TradeSub>): TradeSub => ({
  id,
  name: id,
  vendor_id: null,
  vendor_name: "",
  basis: "flat",
  measure_id: null,
  rate: null,
  amount: null,
  markup_pct: null,
  ...over,
});

const OWN: TradeSetup = {
  measures: [
    { id: "walls", name: "Walls", unit: "sq ft" },
    { id: "trim", name: "Trim", unit: "linear ft" },
    { id: "doors", name: "Doors", unit: "each" },
  ],
  materials: [
    material("Wall paint", {
      cost: 38,
      measure_id: "walls",
      coverage: 350,
      waste_pct: 10,
      whole: true,
    }),
    material("Primer", { cost: 25, measure_id: "walls", coverage: 400 }),
    material("Trim paint", { cost: 45, measure_id: "trim", coverage: 200, whole: true }),
    material("Supplies", { unit: "each", cost: 60, basis: "flat", qty: 1 }),
  ],
  labor: [
    labor("Roll walls", { measure_id: "walls", per_hour: 150, rate: 28 }),
    labor("Trim", { measure_id: "trim", per_hour: 40, rate: 30 }),
    labor("Doors", { measure_id: "doors", per_hour: 2, rate: 30 }),
    labor("Set up and clean up", { basis: "flat", hours: 4, rate: 28 }),
  ],
  fixed: [{ id: "lift", name: "Lift rental", cost: 400 }],
  overhead_pct: 15,
  profit_pct: 20,
  tax_pct: 6,
  crew_size: 2,
  hours_per_day: 8,
};
const WASH = sub("Pressure washing", {
  vendor_id: VENDOR,
  vendor_name: "Clean Walls LLC",
  basis: "measure",
  measure_id: "walls",
  rate: 0.2,
  markup_pct: 10,
});
const SCAFFOLD = sub("Scaffolding crew", { amount: 1500 });
const WITH_SUBS: TradeSetup = { ...OWN, subs: [WASH, SCAFFOLD] };
const JOB = { walls: 3000, trim: 400, doors: 6 };

describe("a job with no sub lines is priced as before", () => {
  it("a setup saved before sub lines existed: the Nov 16 numbers, to the cent", () => {
    const r = calcTradeBid(OWN, JOB);
    expect(r.subs).toEqual([]);
    expect(r.subTotal).toBe(0);
    expect(r.subMarkup).toBe(0);
    expect(r.cost).toBe(2222.55);
    expect(r.markupBase).toBe(2222.55);
    expect(r.overhead).toBe(333.38);
    expect(r.profit).toBe(511.19);
    expect(r.price).toBe(3067.12);
    expect(r.marginPct).toBe(27.5);
  });
  it("an empty list is the same as none", () => {
    expect(calcTradeBid({ ...OWN, subs: [] }, JOB).price).toBe(3067.12);
  });
});

describe("the painting job with two subs", () => {
  const r = calcTradeBid(WITH_SUBS, JOB);
  it("each line: what the sub is paid, and its own markup when it has one", () => {
    expect(r.subs).toEqual([
      // 3,000 sq ft × $0.20 = 600.00; 10% of it = 60.00
      { id: "Pressure washing", cost: 600, markup: 60, problem: null },
      // The quote as typed; no markup of its own.
      { id: "Scaffolding crew", cost: 1500, markup: null, problem: null },
    ]);
    expect(r.subTotal).toBe(2100);
    expect(r.subMarkup).toBe(60);
  });
  it("the subs are a cost of the job", () => {
    expect(r.cost).toBe(4322.55);
  });
  it("overhead and profit leave out the line that carries its own markup", () => {
    expect(r.markupBase).toBe(3722.55);
    expect(r.overhead).toBe(558.38);
    expect(r.profit).toBe(856.19);
  });
  it("the price is every part added up", () => {
    expect(r.price).toBe(5797.12);
    // cost + overhead + profit + the subs' own markup
    expect(Math.round((r.cost + r.overhead + r.profit + r.subMarkup) * 100) / 100).toBe(r.price);
    expect(r.marginPct).toBe(25.4);
    expect(r.problems).toEqual([]);
  });
  it("no sales tax on a sub and no hours for one", () => {
    // Tax is still 6% of the materials alone, hours still our crew's.
    expect(r.tax).toBe(43.05);
    expect(r.hours).toBe(37);
    expect(r.crewDays).toBe(2.3);
  });
});

describe("a job that is all subbed out", () => {
  const all: TradeSetup = {
    ...emptySetup(),
    overhead_pct: 15,
    profit_pct: 20,
    subs: [sub("Painting, complete", { amount: 4000, markup_pct: 15 })],
  };
  it("a $4,000 quote marked up 15% is $4,600; overhead and profit have nothing to work on", () => {
    const r = calcTradeBid(all, {});
    expect(r.cost).toBe(4000);
    expect(r.markupBase).toBe(0);
    expect(r.overhead).toBe(0);
    expect(r.profit).toBe(0);
    expect(r.subMarkup).toBe(600);
    expect(r.price).toBe(4600);
    // 600 ÷ 4,600 = 13.04%
    expect(r.marginPct).toBe(13);
    expect(r.hours).toBe(0);
  });
  it("the same quote with its markup left blank takes the bid's overhead and profit", () => {
    const r = calcTradeBid({ ...all, subs: [sub("Painting, complete", { amount: 4000 })] }, {});
    // 4,000 × 1.15 × 1.20 = 5,520.00; overhead 600.00; profit 920.00
    expect(r.markupBase).toBe(4000);
    expect(r.overhead).toBe(600);
    expect(r.profit).toBe(920);
    expect(r.subMarkup).toBe(0);
    expect(r.price).toBe(5520);
  });
  it("a markup typed as 0 is a markup of its own: the quote passes through at cost", () => {
    const r = calcTradeBid(
      { ...all, subs: [sub("Painting, complete", { amount: 4000, markup_pct: 0 })] },
      {},
    );
    expect(r.subs[0]).toEqual({ id: "Painting, complete", cost: 4000, markup: 0, problem: null });
    expect(r.price).toBe(4000);
  });
});

describe("a sub line that cannot be priced says what is missing", () => {
  const priced = (s: TradeSub, job: Record<string, number | null> = JOB) =>
    calcTradeBid({ ...OWN, subs: [s] }, job);
  it("a quote not typed yet", () => {
    const r = priced(sub("Scaffolding crew", {}));
    expect(r.subs[0]).toEqual({
      id: "Scaffolding crew",
      cost: 0,
      markup: null,
      problem: "type the quote",
    });
    expect(r.problems).toEqual(["Scaffolding crew: type the quote"]);
    // The rest of the job is still priced; the line is left out, not guessed.
    expect(r.price).toBe(3067.12);
  });
  it("a rate not typed, a measure not picked, a measurement not typed", () => {
    expect(priced(sub("Wash", { basis: "measure", measure_id: "walls" })).problems).toEqual([
      "Wash: type the rate",
    ]);
    expect(priced(sub("Wash", { basis: "measure", rate: 0.2 })).problems).toEqual([
      "Wash: pick what it is measured by",
    ]);
    expect(
      priced(sub("Wash", { basis: "measure", measure_id: "walls", rate: 0.2 }), {
        trim: 400,
        doors: 6,
      }).problems,
    ).toContain("Wash: type the walls");
  });
  it("a line with no name is called Subcontractor", () => {
    expect(priced(sub("x", { name: "  " })).problems).toEqual(["Subcontractor: type the quote"]);
  });
  it("a quote of $0 is a number, not a blank", () => {
    const r = priced(sub("Free touch-up", { amount: 0 }));
    expect(r.subs[0]!.problem).toBeNull();
    expect(r.price).toBe(3067.12);
  });
});

describe("the Margin report's figures", () => {
  it("what the subs are paid sits with the flat costs, so cost and revenue add up", () => {
    const r = calcTradeBid(WITH_SUBS, JOB);
    const f = tradeFigures(r);
    // other = lift 400 + subs 2,100
    expect(f.other).toBe(2500);
    expect(f.material).toBe(717.5);
    expect(f.labor).toBe(1062);
    expect(f.materialTax).toBe(43.05);
    expect(f.total).toBe(5797.12);
    // The report's cost: 717.50 + 43.05 + 1,062 + 2,500 = 4,322.55, the bid's own cost.
    expect(Math.round((f.material + (f.materialTax ?? 0) + f.labor + f.other) * 100) / 100).toBe(
      r.cost,
    );
    expect(asBidFigures(f)).toEqual(f);
  });
});

describe("saving and copying", () => {
  it("the server's rule takes sub lines, and a setup with none is left as it is", () => {
    expect(tradeSetupSchema.parse(WITH_SUBS).subs).toEqual([WASH, SCAFFOLD]);
    expect(tradeSetupSchema.parse(OWN)).toEqual(OWN);
  });
  it("refuses a vendor id that is not an id, a negative quote and a markup past 1,000%", () => {
    const bad = (over: Partial<TradeSub>) =>
      tradeSetupSchema.safeParse({ ...OWN, subs: [sub("x", over)] }).success;
    expect(bad({ vendor_id: "clean-walls" })).toBe(false);
    expect(bad({ amount: -1 })).toBe(false);
    expect(bad({ markup_pct: 1001 })).toBe(false);
    expect(bad({ amount: 1500, markup_pct: 10 })).toBe(true);
  });
  it("a new bid takes its own copy of the sub lines: changing the bid leaves the trade alone", () => {
    const trade = { id: VENDOR, name: "Painting", setup: WITH_SUBS };
    const bid = newTradeBid(trade);
    expect(bid.setup.subs).toEqual([WASH, SCAFFOLD]);
    bid.setup.subs![1]!.amount = 1800;
    expect(WITH_SUBS.subs![1]!.amount).toBe(1500);
    // A setup with none is copied as it is: no empty list is added to it.
    expect(copySetup(OWN)).toEqual(OWN);
  });
  it("a saved bid with sub lines reads back whole", () => {
    const bid = {
      ...newTradeBid({ id: VENDOR, name: "Painting", setup: WITH_SUBS }),
      quantities: JOB,
    };
    const back = asTradeBidData(JSON.parse(JSON.stringify(bid)));
    expect(back?.setup.subs).toEqual([WASH, SCAFFOLD]);
    expect(calcTradeBid(back!.setup, back!.quantities).price).toBe(5797.12);
  });
});
