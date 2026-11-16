/**
 * Trade Bids, the sum (owner, Nov 16: "a bid setup where we can set labor and cost and time
 * similar to the project bid calculator but simpler and we can save it per job type").
 *
 * One painting job runs through the tests. Every number was worked out by hand first:
 *
 *   measured: walls 3,000 sq ft, trim 400 linear ft, doors 6
 *
 *   materials
 *     wall paint   $38 a gallon, 350 sq ft a gallon, 10% waste, bought whole
 *                  3000 ÷ 350 = 8.571 → +10% = 9.429 → 10 gallons            $380.00
 *     primer       $25 a gallon, 400 sq ft a gallon, no waste, not whole
 *                  3000 ÷ 400 = 7.5 gallons                                   $187.50
 *     trim paint   $45 a gallon, 200 linear ft a gallon, bought whole → 2     $90.00
 *     supplies     1 at $60, whatever the job measures                        $60.00
 *                                                              materials     $717.50
 *   tax 6% of materials                                                       $43.05
 *   labor
 *     roll walls   150 sq ft an hour at $28 → 20 h                           $560.00
 *     trim         40 linear ft an hour at $30 → 10 h                        $300.00
 *     doors        2 an hour at $30 → 3 h                                     $90.00
 *     set up       4 h flat at $28                                           $112.00
 *                                                       37 hours, labor    $1,062.00
 *   flat costs: lift rental                                                  $400.00
 *   cost      717.50 + 43.05 + 1,062.00 + 400.00                           $2,222.55
 *   overhead  15% of cost = 333.3825                                         $333.38
 *   price     2,222.55 × 1.15 × 1.20 = 3,067.119                           $3,067.12
 *   profit    3,067.12 − 2,222.55 − 333.38                                   $511.19
 *   margin    (3,067.12 − 2,222.55) ÷ 3,067.12 = 27.5%
 *   time      37 hours; 2 people × 8 hours a day → 2.3 days
 */
import { describe, expect, it } from "vitest";

import { asBidFigures } from "@/lib/bid-figures";
import {
  amountText,
  asTradeBidData,
  calcTradeBid,
  copySetup,
  emptySetup,
  fmtAmount,
  fmtDays,
  fmtMoney,
  isTradeData,
  lineId,
  newTradeBid,
  parseAmount,
  tradeFigures,
  tradeSetupSchema,
  type TradeSetup,
} from "@/lib/trade-bid";

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

const PAINTING: TradeSetup = {
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
const JOB = { walls: 3000, trim: 400, doors: 6 };

describe("the painting job, line by line", () => {
  const r = calcTradeBid(PAINTING, JOB);

  it("materials: what to buy and what it costs", () => {
    expect(r.materials).toEqual([
      { id: "Wall paint", qty: 10, cost: 380, problem: null },
      { id: "Primer", qty: 7.5, cost: 187.5, problem: null },
      { id: "Trim paint", qty: 2, cost: 90, problem: null },
      { id: "Supplies", qty: 1, cost: 60, problem: null },
    ]);
    expect(r.materialTotal).toBe(717.5);
    expect(r.tax).toBe(43.05);
  });

  it("labor: hours and dollars", () => {
    expect(r.labor).toEqual([
      { id: "Roll walls", hours: 20, cost: 560, problem: null },
      { id: "Trim", hours: 10, cost: 300, problem: null },
      { id: "Doors", hours: 3, cost: 90, problem: null },
      { id: "Set up and clean up", hours: 4, cost: 112, problem: null },
    ]);
    expect(r.laborTotal).toBe(1062);
    expect(r.hours).toBe(37);
  });

  it("cost, overhead, profit and price add up", () => {
    expect(r.fixedTotal).toBe(400);
    expect(r.cost).toBe(2222.55);
    expect(r.overhead).toBe(333.38);
    expect(r.profit).toBe(511.19);
    expect(r.price).toBe(3067.12);
    expect(Math.round((r.cost + r.overhead + r.profit) * 100) / 100).toBe(r.price);
    expect(r.marginPct).toBe(27.5);
    expect(r.problems).toEqual([]);
  });

  it("time: 37 hours is 2.3 days for two people on eight-hour days", () => {
    expect(r.crewDays).toBe(2.3);
    expect(fmtDays(r.crewDays)).toBe("2.3 days");
    expect(calcTradeBid({ ...PAINTING, crew_size: null }, JOB).crewDays).toBeNull();
    expect(calcTradeBid({ ...PAINTING, crew_size: 4 }, JOB).crewDays).toBe(1.2);
  });

  it("the Margin report's figures: the price is the revenue, the tax paid is a cost", () => {
    const f = tradeFigures(r);
    expect(f).toEqual({
      v: 1,
      revenue: 3024.07,
      material: 717.5,
      labor: 1062,
      other: 400,
      hours: 37,
      tax: 43.05,
      total: 3067.12,
      materialTax: 43.05,
    });
    // The shape the report accepts (bid-figures.ts).
    expect(asBidFigures(f)).toEqual(f);
    // As the report counts it: revenue + tax paid = the price; cost includes the tax paid.
    const revenue = f.revenue + f.materialTax!;
    const cost = f.material + f.materialTax! + f.labor + f.other;
    expect(Math.round(revenue * 100) / 100).toBe(3067.12);
    expect(Math.round((revenue - cost) * 100) / 100).toBe(844.57); // overhead 333.38 + profit 511.19
  });
});

describe("rounding and waste", () => {
  const one = (m: Partial<TradeSetup["materials"][number]>, q: number) =>
    calcTradeBid(
      {
        ...emptySetup(),
        measures: [{ id: "a", name: "Area", unit: "sq ft" }],
        materials: [material("m", { cost: 10, measure_id: "a", coverage: 100, ...m })],
      },
      { a: q },
    ).materials[0]!;

  it("bought whole rounds up, but an exact amount is not pushed to the next unit", () => {
    expect(one({ whole: true }, 301).qty).toBe(4);
    expect(one({ whole: true }, 300).qty).toBe(3);
    // 110 ÷ 100 × 1.1 is 1.2100000000000002 in a computer; it is still 2, and 1000 ÷ 100 is 10.
    expect(one({ whole: true, waste_pct: 10 }, 110).qty).toBe(2);
    expect(one({ whole: true }, 1000).qty).toBe(10);
  });

  it("not bought whole keeps the part unit, to the thousandth", () => {
    expect(one({}, 333).qty).toBe(3.33);
    expect(one({}, 333).cost).toBe(33.3);
    expect(one({ waste_pct: 5 }, 1000).qty).toBe(10.5);
  });

  it("nothing measured costs nothing and is not a problem", () => {
    expect(one({ whole: true }, 0)).toEqual({ id: "m", qty: 0, cost: 0, problem: null });
  });
});

describe("a blank is missing, never zero", () => {
  it("names each line that cannot be priced, and what it needs", () => {
    const setup: TradeSetup = {
      ...PAINTING,
      materials: [
        material("Wall paint", { cost: null, measure_id: "walls", coverage: 350 }),
        material("Primer", { cost: 25, measure_id: "walls", coverage: null }),
        material("", { cost: 5, measure_id: null }),
        material("Supplies", { cost: 60, basis: "flat", qty: null }),
      ],
      labor: [
        labor("Roll walls", { measure_id: "walls", per_hour: null, rate: 28 }),
        labor("Trim", { measure_id: "trim", per_hour: 40, rate: null }),
        labor("Doors", { measure_id: "doors", per_hour: 2, rate: 30 }),
        labor("Set up", { basis: "flat", hours: null, rate: 28 }),
      ],
      fixed: [{ id: "lift", name: "Lift rental", cost: null }],
    };
    const r = calcTradeBid(setup, { walls: 3000, trim: 400 });
    expect(r.problems).toEqual([
      "Wall paint: type the cost",
      "Primer: type how far one goes",
      "Material: pick what it is measured by",
      "Supplies: type how many",
      "Roll walls: type how much one person does an hour",
      "Trim: type the hourly rate",
      "Doors: type the doors",
      "Set up: type the hours",
      "Lift rental: type the cost",
    ]);
    // A line with a problem adds nothing; the quantity or hours it could work out still show.
    expect(r.materials[0]).toMatchObject({ qty: 8.571, cost: 0 });
    expect(r.labor[1]).toMatchObject({ hours: 10, cost: 0 });
    expect(r.materialTotal).toBe(0);
    expect(r.laborTotal).toBe(0);
    expect(r.hours).toBe(10);
    expect(r.price).toBe(0);
    expect(r.marginPct).toBeNull();
  });

  it("no overhead, profit or tax typed means none is added", () => {
    const r = calcTradeBid(
      { ...PAINTING, overhead_pct: null, profit_pct: null, tax_pct: null },
      JOB,
    );
    expect(r).toMatchObject({ tax: 0, cost: 2179.5, overhead: 0, profit: 0, price: 2179.5 });
    expect(r.marginPct).toBe(0);
  });
});

describe("a bid keeps its own numbers", () => {
  it("a new bid copies the trade's setup and shares nothing with it", () => {
    const trade = { id: "11111111-1111-4111-8111-111111111111", name: "Painting", setup: PAINTING };
    const bid = newTradeBid(trade);
    expect(bid).toMatchObject({
      kind: "trade",
      v: 1,
      trade_type_id: trade.id,
      trade_name: "Painting",
      quantities: {},
      scope: "",
    });
    expect(bid.setup).toEqual(PAINTING);
    // Raising the trade's paint price afterwards does not touch the bid.
    const before = calcTradeBid(bid.setup, JOB).price;
    trade.setup.materials[0]!.cost = 99;
    trade.setup.overhead_pct = 50;
    expect(bid.setup.materials[0]!.cost).toBe(38);
    expect(calcTradeBid(bid.setup, JOB).price).toBe(before);
    // Put the shared fixture back.
    trade.setup.materials[0]!.cost = 38;
    trade.setup.overhead_pct = 15;
    const copy = copySetup(PAINTING);
    expect(copy).toEqual(PAINTING);
    expect(copy.materials[0]).not.toBe(PAINTING.materials[0]);
  });

  it("what is stored reads back as a trade bid; a roofing bid's data does not", () => {
    const bid = newTradeBid({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Painting",
      setup: PAINTING,
    });
    expect(asTradeBidData(JSON.parse(JSON.stringify(bid)))).toEqual(bid);
    // The customer sits under the keys a roofing bid uses, and a key a customer link fills in
    // (the client's own address) is kept, not dropped.
    expect(bid.customer).toEqual({ name: "", contact: "", projectAddress: "", notes: "" });
    const linked = { ...bid, customer: { ...bid.customer, name: "Acme", clientCity: "London" } };
    expect(asTradeBidData(linked)?.customer).toMatchObject({ name: "Acme", clientCity: "London" });
    expect(isTradeData(bid)).toBe(true);
    expect(isTradeData({ jobName: "A roof", adminSnapshot: {} })).toBe(false);
    expect(asTradeBidData({ jobName: "A roof" })).toBeNull();
    expect(isTradeData(null)).toBe(false);
  });

  it("refuses a setup that is not one", () => {
    expect(tradeSetupSchema.safeParse(PAINTING).success).toBe(true);
    expect(tradeSetupSchema.safeParse({ ...PAINTING, overhead_pct: -1 }).success).toBe(false);
    expect(
      tradeSetupSchema.safeParse({
        ...PAINTING,
        materials: [{ ...PAINTING.materials[0], basis: "guess" }],
      }).success,
    ).toBe(false);
  });
});

describe("boxes and words", () => {
  it("reads a typed number, and leaves a blank blank", () => {
    expect(parseAmount("350")).toBe(350);
    expect(parseAmount("$1,250.50")).toBe(1250.5);
    expect(parseAmount("15%")).toBe(15);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1e3")).toBeNull();
  });

  it("puts a stored number back in its box, blank for none, never a 0 for nothing", () => {
    expect(amountText(350)).toBe("350");
    expect(amountText(0.5)).toBe("0.5");
    expect(amountText(null)).toBe("");
    expect(amountText(undefined)).toBe("");
    expect(amountText(0)).toBe("0");
  });

  it("writes money, amounts and days plainly", () => {
    expect(fmtMoney(3067.119)).toBe("$3,067.12");
    expect(fmtMoney(-5)).toBe("-$5.00");
    expect(fmtAmount(9.4286)).toBe("9.429");
    expect(fmtAmount(3000)).toBe("3,000");
    expect(fmtDays(1)).toBe("1 day");
    expect(fmtDays(null)).toBe("—");
  });

  it("makes a short id for a new line", () => {
    let n = 0;
    const id = lineId(() => (n++ % 32) / 32);
    expect(id).toBe("abcdefghij");
    expect(lineId()).toMatch(/^[a-z2-9]{10}$/);
  });
});
