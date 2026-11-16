/**
 * Inventory cost rules (owner, Nov 16: "How does it handle a situation where there's stock bought
 * for x amount of dollars then the same material bought later for more/less money?" … "Go with
 * all 6"). Every expected number below was worked out by hand first; the arithmetic is written
 * beside it so a reader can check it without running anything.
 */
import { describe, expect, it } from "vitest";

import {
  cents,
  countDifference,
  flowOf,
  fmtDollars,
  fmtUnitCost,
  parsePrice,
  replayLedger,
  sumDollars,
  yearSummary,
  type CostMovement,
  type StoredPrice,
} from "@/lib/inventory-cost";

const CELL = { screen_id: "service", row_label: "Box of plates", price_col: "price" };
const KEY = `${CELL.screen_id}\u0000${CELL.row_label}\u0000${CELL.price_col}`;

let seq = 0;
function mv(
  day: string,
  qty: number,
  reason: string,
  extra: Partial<CostMovement> = {},
): CostMovement {
  seq += 1;
  return {
    id: seq,
    location_id: "shop",
    ...CELL,
    qty,
    unit: "box",
    reason,
    created_at: `${day}T15:00:00.000Z`,
    ...extra,
  };
}
const priced = (rows: [CostMovement, number][]): Map<number, StoredPrice> =>
  new Map(rows.map(([m, p]) => [m.id, { unit_cost: p, source: "paid" }]));

/** The owner's example: buy 10 at $90, buy 10 at $100, use 5, buy 5 at $110. */
function example() {
  const buy1 = mv("2026-03-02", 10, "received");
  const buy2 = mv("2026-06-01", 10, "received");
  const use = mv("2026-09-01", -5, "consumed", { service_job_id: "t1" });
  const buy3 = mv("2027-02-01", 5, "received");
  return {
    buy1,
    buy2,
    use,
    buy3,
    movements: [buy1, buy2, use, buy3],
    prices: priced([
      [buy1, 90],
      [buy2, 100],
      [buy3, 110],
    ]),
  };
}

describe("moving average, the owner's example", () => {
  it("values every step as the table the owner was shown", () => {
    const ex = example();
    const at = (until: string) => replayLedger({ ...ex, until }).items.get(KEY)!;
    // buy 10 at $90
    expect(at("2026-04-01")).toMatchObject({ qty: 10, avg: 90, value: 900 });
    // buy 10 at $100: (900 + 1000) / 20 = 95
    expect(at("2026-07-01")).toMatchObject({ qty: 20, avg: 95, value: 1900 });
    // use 5: 15 left at 95 = 1,425
    expect(at("2026-10-01")).toMatchObject({ qty: 15, avg: 95, value: 1425 });
    // buy 5 at $110: (1425 + 550) / 20 = 98.75
    expect(replayLedger(ex).items.get(KEY)).toMatchObject({ qty: 20, avg: 98.75, value: 1975 });
  });

  it("charges the ticket the average on the day it took the stock", () => {
    const ex = example();
    const r = replayLedger(ex);
    expect(r.entries.get(ex.use.id)).toMatchObject({
      unit_cost: 95,
      amount: -475,
      source: "average",
      estimated: false,
      needsPrice: false,
    });
    expect(r.entries.get(ex.buy3.id)).toMatchObject({
      unit_cost: 110,
      amount: 550,
      source: "paid",
    });
  });

  it("does not move when the Setup cost changes", () => {
    const ex = example();
    const a = replayLedger({ ...ex, setupCost: () => 20 }).items.get(KEY)!;
    const b = replayLedger({ ...ex, setupCost: () => 500 }).items.get(KEY)!;
    expect(a.value).toBe(1975);
    expect(b.value).toBe(1975);
    expect(a.estimated).toBe(false);
  });

  it("gives the same answer whatever order the rows arrive in", () => {
    const ex = example();
    const shuffled = [ex.buy3, ex.use, ex.buy1, ex.buy2];
    expect(replayLedger({ ...ex, movements: shuffled }).items.get(KEY)).toMatchObject({
      qty: 20,
      avg: 98.75,
    });
  });

  it("leaves out an entry made at or after `until`", () => {
    const ex = example();
    const r = replayLedger({ ...ex, until: ex.buy3.created_at });
    expect(r.entries.has(ex.buy3.id)).toBe(false);
    expect(r.items.get(KEY)!.qty).toBe(15);
  });
});

describe("put-backs, counts and moves", () => {
  it("puts stock back at the cost the ticket took it at", () => {
    const ex = example();
    const back = mv("2027-03-01", 2, "released", { service_job_id: "t1" });
    const r = replayLedger({ ...ex, movements: [...ex.movements, back] });
    expect(r.entries.get(back.id)).toMatchObject({
      unit_cost: 95,
      amount: 190,
      source: "putback",
      needsPrice: false,
    });
    // (1975 + 190) / 22 = 98.4090…; value 2,165
    const item = r.items.get(KEY)!;
    expect(item.qty).toBe(22);
    expect(item.value).toBeCloseTo(2165, 6);
    expect(item.avg).toBeCloseTo(2165 / 22, 9);
  });

  it("a put-back on another ticket comes in at the average, not at the first ticket's cost", () => {
    const ex = example();
    const back = mv("2027-03-01", 2, "released", { service_job_id: "other" });
    const r = replayLedger({ ...ex, movements: [...ex.movements, back] });
    expect(r.entries.get(back.id)).toMatchObject({ unit_cost: 98.75, source: "average" });
  });

  it("stock found in a count comes in at the average and asks for no price", () => {
    const ex = example();
    const found = mv("2027-03-01", 3, "adjustment");
    const r = replayLedger({ ...ex, movements: [...ex.movements, found] });
    expect(r.entries.get(found.id)).toMatchObject({
      unit_cost: 98.75,
      amount: 296.25,
      source: "average",
      needsPrice: false,
      estimated: false,
    });
    // 23 at 98.75 = 2,271.25
    expect(r.items.get(KEY)).toMatchObject({ qty: 23, avg: 98.75, value: 2271.25 });
  });

  it("three boxes short at $98.75 is $296.25 lost", () => {
    const ex = example();
    const short = mv("2027-03-01", -3, "adjustment");
    const r = replayLedger({ ...ex, movements: [...ex.movements, short] });
    expect(r.entries.get(short.id)).toMatchObject({ unit_cost: 98.75, amount: -296.25 });
    expect(r.items.get(KEY)).toMatchObject({ qty: 17, avg: 98.75, value: 1678.75 });
    expect(countDifference(20, 17, 98.75)).toEqual({ diff: -3, value: -296.25 });
  });

  it("moving stock to a truck changes where it is, not what it cost", () => {
    const ex = example();
    const out = mv("2027-03-01", -4, "transfer_out");
    const into = mv("2027-03-01", 4, "transfer_in", { location_id: "truck" });
    const r = replayLedger({ ...ex, movements: [...ex.movements, out, into] });
    const item = r.items.get(KEY)!;
    expect(item).toMatchObject({ qty: 20, avg: 98.75, value: 1975 });
    expect(Object.fromEntries(item.byLocation)).toEqual({ shop: 16, truck: 4 });
    expect(r.entries.get(into.id)).toMatchObject({ needsPrice: false, unit_cost: 98.75 });
  });

  it("a price stored on a taking entry is ignored, and a price of $0 is honoured", () => {
    const ex = example();
    const free = mv("2027-03-01", 5, "received");
    const prices = new Map(ex.prices);
    prices.set(ex.use.id, { unit_cost: 1, source: "set" });
    prices.set(free.id, { unit_cost: 0, source: "paid" });
    const r = replayLedger({ movements: [...ex.movements, free], prices });
    expect(r.entries.get(ex.use.id)!.unit_cost).toBe(95);
    // 25 on hand for the same 1,975: average 79
    expect(r.items.get(KEY)).toMatchObject({ qty: 25, avg: 79, value: 1975 });
    expect(r.entries.get(free.id)).toMatchObject({ source: "paid", needsPrice: false });
  });
});

describe("stock that came in with no price typed", () => {
  it("uses the Setup cost, and says the number is an estimate", () => {
    const left = mv("2026-03-02", 4, "leftover", { service_job_id: "t9" });
    const r = replayLedger({ movements: [left], prices: new Map(), setupCost: () => 50 });
    expect(r.entries.get(left.id)).toMatchObject({
      unit_cost: 50,
      amount: 200,
      source: "setup",
      needsPrice: true,
      estimated: true,
    });
    expect(r.items.get(KEY)).toMatchObject({ qty: 4, avg: 50, value: 200, estimated: true });
  });

  it("stays an estimate when priced stock is averaged in: (200 + 280) / 8 = 60", () => {
    const left = mv("2026-03-02", 4, "leftover");
    const buy = mv("2026-04-02", 4, "received");
    const r = replayLedger({
      movements: [left, buy],
      prices: priced([[buy, 70]]),
      setupCost: () => 50,
    });
    expect(r.items.get(KEY)).toMatchObject({ qty: 8, avg: 60, value: 480, estimated: true });
  });

  it("is exact again once a manager types what was paid", () => {
    const left = mv("2026-03-02", 4, "leftover");
    const buy = mv("2026-04-02", 4, "received");
    const r = replayLedger({
      movements: [left, buy],
      prices: priced([
        [left, 40],
        [buy, 70],
      ]),
      setupCost: () => 50,
    });
    // (160 + 280) / 8 = 55
    expect(r.items.get(KEY)).toMatchObject({ qty: 8, avg: 55, value: 440, estimated: false });
    expect(r.entries.get(left.id)!.needsPrice).toBe(false);
  });

  it("with no Setup cost either the value is unknown, never zero", () => {
    const left = mv("2026-03-02", 4, "leftover");
    const r = replayLedger({ movements: [left], prices: new Map() });
    expect(r.entries.get(left.id)).toMatchObject({
      unit_cost: null,
      amount: null,
      source: "none",
      needsPrice: true,
    });
    expect(r.items.get(KEY)).toMatchObject({ qty: 4, avg: null, value: null });
  });

  it("a leftover with no price is still asked for one when an average exists", () => {
    const ex = example();
    const left = mv("2027-03-01", 2, "leftover");
    const r = replayLedger({ ...ex, movements: [...ex.movements, left] });
    expect(r.entries.get(left.id)).toMatchObject({
      unit_cost: 98.75,
      source: "average",
      needsPrice: true,
      estimated: true,
    });
    expect(r.items.get(KEY)).toMatchObject({ qty: 22, avg: 98.75, estimated: true });
  });

  it("stock taken before any came in is costed at Setup, or not at all", () => {
    const use = mv("2026-03-02", -2, "consumed", { service_job_id: "t1" });
    const withSetup = replayLedger({ movements: [use], prices: new Map(), setupCost: () => 20 });
    expect(withSetup.entries.get(use.id)).toMatchObject({
      unit_cost: 20,
      amount: -40,
      source: "setup",
      estimated: true,
    });
    expect(withSetup.items.get(KEY)).toMatchObject({ qty: -2, avg: 20, value: -40 });
    const without = replayLedger({ movements: [use], prices: new Map() });
    expect(without.entries.get(use.id)).toMatchObject({ unit_cost: null, amount: null });
    expect(without.items.get(KEY)).toMatchObject({ qty: -2, value: null });
  });
});

describe("below zero", () => {
  /** 10 at $90, 15 taken (5 short), then 10 at $100. */
  function shortThenReceive() {
    const buy1 = mv("2027-01-10", 10, "received");
    const use = mv("2027-02-10", -15, "consumed", { service_job_id: "t1" });
    const buy2 = mv("2027-03-10", 10, "received");
    return {
      buy1,
      use,
      buy2,
      movements: [buy1, use, buy2],
      prices: priced([
        [buy1, 90],
        [buy2, 100],
      ]),
    };
  }

  it("starts the average afresh at what came in: 5 left at $100", () => {
    const s = shortThenReceive();
    const r = replayLedger(s);
    expect(r.entries.get(s.use.id)).toMatchObject({ unit_cost: 90, amount: -1350 });
    expect(r.items.get(KEY)).toMatchObject({ qty: 5, avg: 100, value: 500 });
    // The 5 taken short were costed at $90 and were really covered at $100: 5 × −$10 = −$50.
    expect(r.entries.get(s.buy2.id)!.revalued).toBeCloseTo(-50, 9);
  });

  it("shows that on its own line so the year still adds up", () => {
    const s = shortThenReceive();
    const y = yearSummary({
      ...s,
      since: "2027-01-01T05:00:00.000Z",
      until: "2028-01-01T05:00:00.000Z",
    });
    const d = y.items[0]!.dollars;
    expect(d).toMatchObject({ opening: 0, received: 1900, used: 1350, closing: 500 });
    expect(d.revalued).toBeCloseTo(-50, 9);
    // 0 + 1,900 − 1,350 − 50 = 500
    expect(d.opening + d.received - d.used + d.revalued).toBeCloseTo(d.closing, 9);
  });
});

describe("the year summary", () => {
  /**
   * 2026: 10 at $90, 10 at $100, 5 used. Closing 2026 = 15 at $95 = $1,425.
   * 2027: 5 at $110 (avg 98.75, $1,975); 1 damaged (−$98.75, $1,876.25); a count finds 1 fewer
   * (−$98.75, $1,777.50); 2 left over from a job at $80 ((1777.5 + 160) / 20 = 96.875, $1,937.50).
   */
  function twoYears() {
    const ex = example();
    const damaged = mv("2027-03-05", -1, "damaged");
    const counted = mv("2027-12-20", -1, "adjustment");
    const left = mv("2027-12-21", 2, "leftover", { service_job_id: "t7" });
    const prices = new Map(ex.prices);
    prices.set(left.id, { unit_cost: 80, source: "paid" });
    return { movements: [...ex.movements, damaged, counted, left], prices };
  }
  const Y2027 = { since: "2027-01-01T05:00:00.000Z", until: "2028-01-01T05:00:00.000Z" };
  const Y2026 = { since: "2026-01-01T05:00:00.000Z", until: "2027-01-01T05:00:00.000Z" };

  it("opens the year at what the year before closed at", () => {
    const y26 = yearSummary({ ...twoYears(), ...Y2026 }).items[0]!;
    const y27 = yearSummary({ ...twoYears(), ...Y2027 }).items[0]!;
    expect(y26.dollars).toMatchObject({ opening: 0, received: 1900, used: 475, closing: 1425 });
    expect(y26.qty).toMatchObject({ opening: 0, received: 20, used: 5, closing: 15 });
    expect(y27.dollars.opening).toBe(1425);
    expect(y27.qty.opening).toBe(15);
  });

  it("every line of 2027, in units and in dollars", () => {
    const y = yearSummary({ ...twoYears(), ...Y2027 });
    expect(y.needsPrice).toBe(0);
    const row = y.items[0]!;
    expect(row.qty).toEqual({
      opening: 15,
      received: 5,
      fromJobs: 2,
      openingStock: 0,
      used: 0,
      damaged: 1,
      counted: -1,
      other: 0,
      closing: 20,
    });
    expect(row.dollars).toMatchObject({
      opening: 1425,
      received: 550,
      fromJobs: 160,
      openingStock: 0,
      used: 0,
      damaged: 98.75,
      counted: -98.75,
      other: 0,
      closing: 1937.5,
      revalued: 0,
    });
    expect(row.avg).toBe(96.875);
    expect(row.estimated).toBe(false);
    expect(row.unknown).toBe(false);
    // 1,425 + 550 + 160 − 98.75 − 98.75 = 1,937.50
    const d = row.dollars;
    expect(d.opening + d.received + d.fromJobs - d.damaged + d.counted).toBe(d.closing);
  });

  it("nets a put-back off what was used, and a move to a truck to nothing", () => {
    const base = twoYears();
    const take = mv("2027-06-01", -4, "consumed", { service_job_id: "t8" });
    const back = mv("2027-06-02", 1, "released", { service_job_id: "t8" });
    const out = mv("2027-06-03", -3, "transfer_out");
    const into = mv("2027-06-03", 3, "transfer_in", { location_id: "truck" });
    const y = yearSummary({
      prices: base.prices,
      movements: [...base.movements, take, back, out, into],
      ...Y2027,
    });
    const row = y.items[0]!;
    // In June the average is 98.75: 4 taken, 1 put back, so 3 used = 296.25.
    expect(row.qty.used).toBe(3);
    expect(row.dollars.used).toBeCloseTo(296.25, 9);
    expect(row.qty.other).toBe(0);
    expect(row.dollars.other).toBeCloseTo(0, 9);
    expect(row.dollars.revalued).toBe(0);
  });

  it("counts the entries of the period that still need a price, and marks the row", () => {
    const base = twoYears();
    const left = mv("2027-08-01", 1, "leftover");
    const y = yearSummary({ ...base, movements: [...base.movements, left], ...Y2027 });
    expect(y.needsPrice).toBe(1);
    expect(y.items[0]!.estimated).toBe(true);
  });

  it("leaves out an item with nothing on hand and nothing done in the year", () => {
    const other = { screen_id: "service", row_label: "Old item", price_col: "price" };
    const inn = mv("2025-02-01", 2, "received", other);
    const gone = mv("2025-03-01", -2, "damaged", other);
    const base = twoYears();
    const prices = new Map(base.prices);
    prices.set(inn.id, { unit_cost: 5, source: "paid" });
    const y = yearSummary({ movements: [...base.movements, inn, gone], prices, ...Y2027 });
    expect(y.items.map((i) => i.row_label)).toEqual(["Box of plates"]);
  });

  it("an item with no cost at all is marked unknown and adds nothing to the dollars", () => {
    const other = { screen_id: "service", row_label: "No cost", price_col: "price" };
    const inn = mv("2027-02-01", 2, "leftover", other);
    const y = yearSummary({ ...twoYears(), movements: [...twoYears().movements, inn], ...Y2027 });
    const row = y.items.find((i) => i.row_label === "No cost")!;
    expect(row.unknown).toBe(true);
    expect(row.qty).toMatchObject({ fromJobs: 2, closing: 2 });
    expect(row.dollars).toMatchObject({ fromJobs: 0, closing: 0, revalued: 0 });
    expect(row.avg).toBeNull();
  });

  it("adds rows up line by line, to the cent", () => {
    const base = twoYears();
    const second = { screen_id: "service", row_label: "Second", price_col: "price" };
    const inn = mv("2027-02-01", 3, "received", second);
    const prices = new Map(base.prices);
    prices.set(inn.id, { unit_cost: 33.335, source: "paid" });
    const y = yearSummary({ movements: [...base.movements, inn], prices, ...Y2027 });
    const total = sumDollars(y.items);
    // 550 + 3 × 33.335 = 650.005 → 650.01; closing 1,937.50 + 100.005 = 2,037.505 → 2,037.51
    expect(total.received).toBe(650.01);
    expect(total.closing).toBe(2037.51);
    expect(total.opening).toBe(1425);
  });
});

describe("small helpers", () => {
  it("files every reason on its line", () => {
    expect(flowOf("received")).toBe("received");
    expect(flowOf("leftover")).toBe("fromJobs");
    expect(flowOf("opening")).toBe("openingStock");
    expect(flowOf("consumed")).toBe("used");
    expect(flowOf("released")).toBe("used");
    expect(flowOf("vehicle_used")).toBe("used");
    expect(flowOf("damaged")).toBe("damaged");
    expect(flowOf("adjustment")).toBe("counted");
    expect(flowOf("transfer_in")).toBe("other");
    expect(flowOf("allocated")).toBe("other");
  });

  it("a count that matches is worth nothing, and one with no cost is unknown", () => {
    expect(countDifference(5, 5, null)).toEqual({ diff: 0, value: 0 });
    expect(countDifference(5, 7, null)).toEqual({ diff: 2, value: null });
    expect(countDifference(0.25, 0.5, 91)).toEqual({ diff: 0.25, value: 22.75 });
  });

  it("writes money and unit costs the way the reports show them", () => {
    expect(fmtDollars(1975)).toBe("$1,975.00");
    expect(fmtDollars(-50)).toBe("-$50.00");
    expect(fmtDollars(null)).toBe("—");
    expect(fmtDollars(-0.001)).toBe("$0.00");
    expect(cents(650.005)).toBe(650.01);
    expect(cents(-1.005)).toBe(-1.01);
    expect(fmtUnitCost(98.75)).toBe("98.75");
    expect(fmtUnitCost(0.0915)).toBe("0.0915");
    expect(fmtUnitCost(91)).toBe("91.00");
    expect(fmtUnitCost(null)).toBe("");
  });

  it("reads a typed price, and refuses what is not one", () => {
    expect(parsePrice("98.75")).toBe(98.75);
    expect(parsePrice("$1,250.50")).toBe(1250.5);
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice(" .5 ")).toBe(0.5);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(".")).toBeNull();
    expect(parsePrice("-4")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("1e3")).toBeNull();
  });
});
