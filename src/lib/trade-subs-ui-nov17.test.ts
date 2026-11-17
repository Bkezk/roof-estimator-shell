/**
 * Trade Bids, subcontractor lines on the screens (owner, Nov 17: "Go ahead and add the
 * subcontractors line"; asked for: the quote typed on the bid's main screen, a flat amount or a
 * rate per measurement, no materials tax, its own markup percent, the sub picked from the vendor
 * list).
 *
 * The rules of the sum are trade-bid.ts (trade-subs-nov17.test.ts). Here: the helpers the screens
 * are built from (trade-bid-form.ts), then the editor, the bid and the trade's "Try it" drawn to
 * a string, then a few pins on the source. There is no browser here, so nothing below types in a
 * box, opens the vendor list or presses a button.
 *
 * The painting job of trade-screens-nov16.test.ts, with work handed to two subs. Every number
 * was worked out by hand first:
 *
 *   measured: walls 3,000 sq ft, trim 400 linear ft, doors 6
 *
 *   our own costs (the Nov 16 job)   materials 717.50 + tax 43.05 + labor 1,062 + lift 400
 *                                                                                 $2,222.55
 *   subs
 *     pressure washing   Clean Walls LLC, $0.20 a sq ft of walls × 3,000, its own markup 10%
 *                        cost 600.00, markup 60.00
 *     scaffolding crew   nobody picked yet, quoted $1,500 for the job, no markup of its own
 *                        cost 1,500.00 (overhead and profit apply to it)
 *                                                              subs              $2,100.00
 *   cost      2,222.55 + 2,100.00                                               $4,322.55
 *   overhead and profit are worked on everything but the line with its own markup:
 *             4,322.55 − 600.00                                                 $3,722.55
 *   overhead  15% of 3,722.55 = 558.3825                                          $558.38
 *   that part 3,722.55 × 1.15 × 1.20 = 5,137.119                               $5,137.12
 *   profit    5,137.12 − 3,722.55 − 558.38                                        $856.19
 *   price     5,137.12 + 600.00 + 60.00                                        $5,797.12
 *             (read down the screen: 4,322.55 + 558.38 + 856.19 + 60.00 = 5,797.12)
 *   margin    (5,797.12 − 4,322.55) ÷ 5,797.12 = 25.4%
 *   time      still 37 hours, 2.3 days: a sub's work is not our crew's.
 */
import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The screens are drawn to a string below. Nothing is loaded or saved, so the server wrapper,
// the sign-in and the router are stand-ins. The vendor list is put in the screen's own cache
// (`have`), so the real Vendor box and the real `useVendors` read it.
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@tanstack/react-router", () => ({
  useBlocker: () => ({ status: "idle", proceed: () => {}, reset: () => {} }),
  useNavigate: () => () => {},
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
}));

// The signed-in person, set by each test below.
const auth = vi.hoisted(() => ({
  profile: null as { id: string; full_name: string; role: string } | null,
}));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    session: {},
    profile: auth.profile,
    role: auth.profile?.role ?? null,
    can: () => true,
    loading: false,
    profileFailed: false,
  }),
}));

import { vendorsKey } from "@/components/crm/use-vendors";
import { TradeBidScreen, TradePrice } from "@/components/trade/trade-bid-screen";
import { SubQuoteRows, TradeLinesEditor } from "@/components/trade/trade-lines-editor";
import { TradeSetupScreen } from "@/components/trade/trade-setup-screen";
import {
  calcTradeBid,
  emptyCustomer,
  emptySetup,
  newTradeBid,
  tradeSetupSchema,
  type TradeSetup,
  type TradeSub,
} from "@/lib/trade-bid";
import {
  LINE_MAX,
  NO_SUB_PICKED,
  SET_AMOUNT,
  addFixed,
  addLabor,
  addMaterial,
  addMeasure,
  addSub,
  followers,
  goesBy,
  goesByPatch,
  isDirty,
  markupBaseNote,
  patchLine,
  removeLine,
  removeMeasure,
  resultTotals,
  subMarkupWords,
  subQuoteLabel,
  subRows,
  subVendorPatch,
  subsAsSaved,
} from "@/lib/trade-bid-form";
import type { TradeBid, TradeType } from "@/lib/trade-bids.functions";
import type { VendorRow } from "@/lib/vendors.functions";

const VENDOR = "9b0f4c1e-2a6d-4c57-8e31-5d7a6b2c1f09";
const OTHER_VENDOR = "5c2e8d7a-1b3f-4a69-9d04-7e6f5a4b3c21";

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

/** The Nov 16 painting job. It has no `subs` key: it was set up before sub lines existed. */
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
const WASH = sub("wash", {
  name: "Pressure washing",
  vendor_id: VENDOR,
  vendor_name: "Clean Walls LLC",
  basis: "measure",
  measure_id: "walls",
  rate: 0.2,
  markup_pct: 10,
});
const SCAFFOLD = sub("scaffold", { name: "Scaffolding crew", amount: 1500 });
const WITH_SUBS: TradeSetup = { ...PAINTING, subs: [WASH, SCAFFOLD] };
const JOB = { walls: 3000, trim: 400, doors: 6 };

/** Ids in order ("n1", "n2", …), so a new line's id is known. */
const counter = () => {
  let n = 0;
  return () => `n${++n}`;
};

// ── The form helpers ───────────────────────────────────────────────────────────────────────────

describe("adding, changing and removing a subcontractor line", () => {
  it("a new line is a flat quote: every number blank, nobody picked", () => {
    const next = addSub(PAINTING, counter());
    expect(next.subs).toEqual([
      {
        id: "n1",
        name: "",
        vendor_id: null,
        vendor_name: "",
        // Three things are measured, and it is still a set quote: that is what a sub hands over.
        basis: "flat",
        measure_id: null,
        rate: null,
        amount: null,
        markup_pct: null,
      },
    ]);
    // The setup it came from is left alone, and still has no list of sub lines.
    expect("subs" in PAINTING).toBe(false);
    expect(next).not.toBe(PAINTING);
    expect(addSub(next, () => "n2").subs!.map((s) => s.id)).toEqual(["n1", "n2"]);
    expect(next.subs).toHaveLength(1);
  });

  it("a new line waits for its quote, and what the form builds is what the server takes", () => {
    const next = addSub(PAINTING, counter());
    const r = calcTradeBid(next, JOB);
    expect(r.problems).toEqual(["Subcontractor: type the quote"]);
    // Left out, not guessed: the Nov 16 price.
    expect(r.price).toBe(3067.12);
    expect(tradeSetupSchema.safeParse(addSub(PAINTING)).success).toBe(true);
    expect(LINE_MAX.subs).toBe(50);
  });

  it("a setup with no sub lines gets the list only when a line is added", () => {
    // Older tests compare whole setups: nothing but adding a line may put a `subs` key on one.
    const untouched: TradeSetup[] = [
      patchLine(PAINTING, "subs", "nobody", { name: "x" }),
      removeLine(PAINTING, "subs", "nobody"),
      removeMeasure(PAINTING, "walls"),
      addMeasure(PAINTING, counter()),
      addMaterial(PAINTING, counter()),
      addLabor(PAINTING, counter()),
      addFixed(PAINTING, counter()),
      patchLine(PAINTING, "materials", "Primer", { cost: 26 }),
      removeLine(PAINTING, "fixed", "lift"),
    ];
    for (const setup of untouched) expect("subs" in setup).toBe(false);
    // Changing or removing a line that is not there changes nothing at all.
    expect(patchLine(PAINTING, "subs", "nobody", { name: "x" })).toBe(PAINTING);
    expect(removeLine(PAINTING, "subs", "nobody")).toBe(PAINTING);
    expect("subs" in addSub(PAINTING, counter())).toBe(true);
  });

  it("changing one line changes that line only", () => {
    const next = patchLine(WITH_SUBS, "subs", "scaffold", { amount: 1800 });
    expect(next.subs![1]).toEqual({ ...SCAFFOLD, amount: 1800 });
    expect(next.subs![0]).toBe(WASH);
    expect(SCAFFOLD.amount).toBe(1500);
    expect(next.materials).toBe(WITH_SUBS.materials);
    // cost 4,322.55 + 300 = 4,622.55; worked on 4,622.55 − 600 = 4,022.55;
    // 4,022.55 × 1.15 × 1.20 = 5,551.119 → 5,551.12; + 600.00 + 60.00 = 6,211.12
    expect(calcTradeBid(next, JOB).price).toBe(6211.12);
    expect(isDirty(WITH_SUBS, next)).toBe(true);
  });

  it("a markup typed as 0 is a number, and clearing it gives the line back to the bid's markup", () => {
    const zero = patchLine(WITH_SUBS, "subs", "wash", { markup_pct: 0 });
    expect(zero.subs![0]!.markup_pct).toBe(0);
    // Still apart from overhead and profit, with nothing added: 5,137.12 + 600.00 + 0.00
    expect(calcTradeBid(zero, JOB).price).toBe(5737.12);
    const blank = patchLine(WITH_SUBS, "subs", "wash", { markup_pct: null });
    // Overhead and profit on all of it: 4,322.55 × 1.15 × 1.20 = 5,965.119
    expect(calcTradeBid(blank, JOB).price).toBe(5965.12);
  });

  it("a markup changed on one line moves that line's markup and no other line's", () => {
    const next = patchLine(WITH_SUBS, "subs", "wash", { markup_pct: 25 });
    expect(next.subs![0]).toEqual({ ...WASH, markup_pct: 25 });
    expect(next.subs![1]).toBe(SCAFFOLD);
    const before = calcTradeBid(WITH_SUBS, JOB);
    const after = calcTradeBid(next, JOB);
    // 600.00 of washing at 25% is 150.00 where 10% was 60.00: the price moves by the 90.00.
    expect(after.subs[0]).toEqual({ ...before.subs[0], markup: 150 });
    expect(after.subs[1]).toEqual(before.subs[1]);
    expect(after.markupBase).toBe(before.markupBase);
    expect(after.price).toBe(5887.12);
    expect(isDirty(WITH_SUBS, next)).toBe(true);
  });

  it("picking the sub keeps the vendor's id and name together; clearing drops both", () => {
    expect(subVendorPatch({ id: VENDOR, name: "Clean Walls LLC" })).toEqual({
      vendor_id: VENDOR,
      vendor_name: "Clean Walls LLC",
    });
    expect(subVendorPatch(null)).toEqual({ vendor_id: null, vendor_name: "" });
    const picked = patchLine(
      WITH_SUBS,
      "subs",
      "scaffold",
      subVendorPatch({ id: OTHER_VENDOR, name: "Tall Ladder Test Co" }),
    );
    expect(picked.subs![1]).toMatchObject({
      vendor_id: OTHER_VENDOR,
      vendor_name: "Tall Ladder Test Co",
      amount: 1500,
    });
    // Who does the work is part of the bid: picking one is a change to save.
    expect(isDirty(WITH_SUBS, picked)).toBe(true);
    // The price does not care who does it.
    expect(calcTradeBid(picked, JOB).price).toBe(5797.12);
    expect(tradeSetupSchema.safeParse(picked).success).toBe(true);
  });

  it("removing a line takes it out of the price; the last one leaves an empty list", () => {
    const one = removeLine(WITH_SUBS, "subs", "wash");
    expect(one.subs).toEqual([SCAFFOLD]);
    expect(one.subs![0]).toBe(SCAFFOLD);
    expect(WITH_SUBS.subs).toHaveLength(2);
    // cost 2,222.55 + 1,500 = 3,722.55, all of it marked up: × 1.15 × 1.20 = 5,137.119
    expect(calcTradeBid(one, JOB).price).toBe(5137.12);
    const none = removeLine(one, "subs", "scaffold");
    expect(none.subs).toEqual([]);
    expect(calcTradeBid(none, JOB).price).toBe(3067.12);
  });

  it("adding a line and taking it out again is not a change to save", () => {
    const added = addSub(PAINTING, counter());
    const out = removeLine(added, "subs", "n1");
    expect(out.subs).toEqual([]);
    // Against a saved copy with no list at all, the empty list is dropped again.
    const settled = subsAsSaved(out, PAINTING);
    expect("subs" in settled).toBe(false);
    expect(settled).toEqual(PAINTING);
    expect(isDirty(PAINTING, settled)).toBe(false);
    expect(isDirty(PAINTING, out)).toBe(true);
    // A saved copy that holds an empty list (a trade set up since) keeps it.
    const savedEmpty: TradeSetup = { ...PAINTING, subs: [] };
    expect(subsAsSaved(out, savedEmpty)).toBe(out);
    expect(isDirty(savedEmpty, out)).toBe(false);
    // A list with a line in it is never touched, and neither is a setup with no list.
    expect(subsAsSaved(added, PAINTING)).toBe(added);
    expect(subsAsSaved(PAINTING, PAINTING)).toBe(PAINTING);
    expect(subsAsSaved(PAINTING, WITH_SUBS)).toBe(PAINTING);
    // Taking out every line of a bid saved with two IS a change, and stays one.
    const emptied = removeLine(removeLine(WITH_SUBS, "subs", "wash"), "subs", "scaffold");
    expect(subsAsSaved(emptied, WITH_SUBS)).toBe(emptied);
    expect(isDirty(WITH_SUBS, emptied)).toBe(true);
  });

  it("a setup read back from the server in another key order is not a change", () => {
    const back = JSON.parse(JSON.stringify(WITH_SUBS)) as TradeSetup;
    const reordered = {
      ...back,
      subs: back.subs!.map(({ id, name, ...rest }) => ({ ...rest, name, id })),
    };
    expect(isDirty(WITH_SUBS, reordered)).toBe(false);
  });

  it("removing a measure leaves a sub line that went by it asking what it is measured by", () => {
    expect(followers(WITH_SUBS, "walls")).toEqual([
      "Wall paint",
      "Primer",
      "Roll walls",
      "Pressure washing",
    ]);
    // The flat quote follows nothing.
    expect(followers(WITH_SUBS, "trim")).toEqual(["Trim paint", "Trim"]);
    const unnamed = patchLine(WITH_SUBS, "subs", "wash", { name: " " });
    expect(followers(unnamed, "walls")[3]).toBe("a subcontractor line with no name");

    const next = removeMeasure(WITH_SUBS, "walls");
    expect(next.subs![0]).toEqual({ ...WASH, measure_id: null });
    // Not quietly turned into a set quote: its rate of $0.20 would be read as the whole job.
    expect(next.subs![0]!.basis).toBe("measure");
    expect(next.subs![1]).toBe(SCAFFOLD);
    expect(WASH.measure_id).toBe("walls");
    expect(removeMeasure(WITH_SUBS, "trim").subs![0]).toBe(WASH);
    expect(calcTradeBid(next, { trim: 400, doors: 6 }).problems).toContain(
      "Pressure washing: pick what it is measured by",
    );
  });

  it("the Goes by choice of a sub line: one of the measures, or a set quote", () => {
    expect(goesBy(WASH, PAINTING.measures)).toBe("m:walls");
    expect(goesBy(SCAFFOLD, PAINTING.measures)).toBe(SET_AMOUNT);
    expect(goesBy({ ...WASH, measure_id: "gone" }, PAINTING.measures)).toBe("");
    // Picking a measure for the flat quote keeps the quote typed, out of sight; the rate is blank.
    const byTrim = patchLine(WITH_SUBS, "subs", "scaffold", goesByPatch("m:trim"));
    expect(byTrim.subs![1]).toEqual({ ...SCAFFOLD, basis: "measure", measure_id: "trim" });
    expect(calcTradeBid(byTrim, JOB).problems).toEqual(["Scaffolding crew: type the rate"]);
  });
});

describe("the price with sub lines, as the screen shows it", () => {
  const OLD_KEYS = [
    "materials",
    "tax",
    "labor",
    "fixed",
    "cost",
    "overhead",
    "profit",
    "price",
    "hours",
    "days",
    "margin",
  ];

  it("with no sub lines the totals are exactly what they were", () => {
    const expected = [
      ["materials", "", "Materials", "$717.50", false],
      ["tax", "", "Sales tax on materials (6%)", "$43.05", false],
      ["labor", "", "Labor", "$1,062.00", false],
      ["fixed", "", "Flat costs", "$400.00", false],
      ["cost", "=", "Cost", "$2,222.55", false],
      ["overhead", "+", "Overhead (15%)", "$333.38", false],
      ["profit", "+", "Profit (20%)", "$511.19", false],
      ["price", "=", "Price", "$3,067.12", true],
      ["hours", "", "Labor hours", "37 hours", false],
      ["days", "", "Working days for a crew of 2", "2.3 days", false],
      ["margin", "", "Margin", "27.5% of the price", false],
    ];
    const flat = (setup: TradeSetup) =>
      resultTotals(setup, calcTradeBid(setup, JOB)).map((t) => [
        t.key,
        t.sign,
        t.label,
        t.value,
        t.strong,
      ]);
    expect(flat(PAINTING)).toEqual(expected);
    // An empty list is the same as none: a line was added and taken out again.
    expect(flat({ ...PAINTING, subs: [] })).toEqual(expected);
    expect(expected.map((t) => t[0])).toEqual(OLD_KEYS);
    expect(markupBaseNote(calcTradeBid(PAINTING, JOB))).toBeNull();
    expect(subRows(PAINTING, calcTradeBid(PAINTING, JOB))).toEqual([]);
  });

  it("the two subs: a Subcontractors line in the cost, their own markup beside the profit", () => {
    const r = calcTradeBid(WITH_SUBS, JOB);
    expect(
      resultTotals(WITH_SUBS, r).map((t) => [t.key, t.sign, t.label, t.value, t.strong]),
    ).toEqual([
      ["materials", "", "Materials", "$717.50", false],
      ["tax", "", "Sales tax on materials (6%)", "$43.05", false],
      ["labor", "", "Labor", "$1,062.00", false],
      ["fixed", "", "Flat costs", "$400.00", false],
      // 600.00 + 1,500.00
      ["subs", "", "Subcontractors", "$2,100.00", false],
      // 717.50 + 43.05 + 1,062.00 + 400.00 + 2,100.00
      ["cost", "=", "Cost", "$4,322.55", false],
      // 15% of 3,722.55; then 5,137.12 − 3,722.55 − 558.38
      ["overhead", "+", "Overhead (15%)", "$558.38", false],
      ["profit", "+", "Profit (20%)", "$856.19", false],
      // 10% of the 600.00 pressure washing
      ["subMarkup", "+", "Subcontractor markup", "$60.00", false],
      // 4,322.55 + 558.38 + 856.19 + 60.00
      ["price", "=", "Price", "$5,797.12", true],
      ["hours", "", "Labor hours", "37 hours", false],
      ["days", "", "Working days for a crew of 2", "2.3 days", false],
      ["margin", "", "Margin", "25.4% of the price", false],
    ]);
  });

  it("says what overhead and profit were worked on, when that is not the whole cost", () => {
    expect(markupBaseNote(calcTradeBid(WITH_SUBS, JOB))).toBe(
      "Overhead and profit are worked on $3,722.55: every cost except the subcontractor lines that carry their own markup.",
    );
  });

  it("a sub line with no markup of its own: in the cost, and nothing else is added or said", () => {
    const setup: TradeSetup = { ...PAINTING, subs: [SCAFFOLD] };
    const r = calcTradeBid(setup, JOB);
    const totals = resultTotals(setup, r);
    expect(totals.map((t) => t.key)).toEqual([
      "materials",
      "tax",
      "labor",
      "fixed",
      "subs",
      "cost",
      "overhead",
      "profit",
      "price",
      "hours",
      "days",
      "margin",
    ]);
    const of = (key: string) => totals.find((t) => t.key === key)!.value;
    expect(of("subs")).toBe("$1,500.00");
    // 2,222.55 + 1,500.00 = 3,722.55; 15% = 558.38; × 1.15 × 1.20 = 5,137.12; profit 856.19
    expect(of("cost")).toBe("$3,722.55");
    expect(of("overhead")).toBe("$558.38");
    expect(of("profit")).toBe("$856.19");
    expect(of("price")).toBe("$5,137.12");
    // Overhead and profit were worked on the whole cost: there is nothing to explain.
    expect(markupBaseNote(r)).toBeNull();
  });

  it("a line marked up 0% on its own still shows its markup line, at $0.00", () => {
    const setup: TradeSetup = { ...PAINTING, subs: [{ ...WASH, markup_pct: 0 }] };
    const r = calcTradeBid(setup, JOB);
    const totals = resultTotals(setup, r);
    const of = (key: string) => totals.find((t) => t.key === key)!;
    expect(of("subMarkup")).toMatchObject({ sign: "+", value: "$0.00" });
    // cost 2,222.55 + 600.00 = 2,822.55; overhead and profit on 2,222.55 → 3,067.12; + 600.00
    expect(of("cost").value).toBe("$2,822.55");
    expect(of("price").value).toBe("$3,667.12");
    expect(markupBaseNote(r)).toBe(
      "Overhead and profit are worked on $2,222.55: every cost except the subcontractor lines that carry their own markup.",
    );
  });

  it("the rows of the Subcontractors table: what, who, the cost, and the line's own markup", () => {
    expect(subRows(WITH_SUBS, calcTradeBid(WITH_SUBS, JOB))).toEqual([
      {
        id: "wash",
        name: "Pressure washing",
        vendor: "Clean Walls LLC",
        cost: "$600.00",
        markup: "plus $60.00 markup",
        problem: null,
      },
      {
        id: "scaffold",
        name: "Scaffolding crew",
        vendor: "No subcontractor picked",
        cost: "$1,500.00",
        markup: null,
        problem: null,
      },
    ]);
    expect(NO_SUB_PICKED).toBe("No subcontractor picked");
  });

  it("a line that cannot be priced shows what it waits for where its cost would be", () => {
    const setup: TradeSetup = {
      ...PAINTING,
      subs: [
        sub("a", { name: "Scaffolding crew", markup_pct: 10 }),
        sub("b", { name: "  ", basis: "measure", rate: 0.2 }),
        sub("c", { name: "Gutter cleaning", basis: "measure", measure_id: "trim" }),
      ],
    };
    const r = calcTradeBid(setup, JOB);
    expect(subRows(setup, r)).toEqual([
      // No cost, so no markup to show either.
      {
        id: "a",
        name: "Scaffolding crew",
        vendor: NO_SUB_PICKED,
        cost: null,
        markup: null,
        problem: "Type the quote",
      },
      {
        id: "b",
        name: "Subcontractor",
        vendor: NO_SUB_PICKED,
        cost: null,
        markup: null,
        problem: "Pick what it is measured by",
      },
      {
        id: "c",
        name: "Gutter cleaning",
        vendor: NO_SUB_PICKED,
        cost: null,
        markup: null,
        problem: "Type the rate",
      },
    ]);
    // None of the three is priced, so none stands apart: the Nov 16 price, and no markup line.
    expect(r.price).toBe(3067.12);
    const totals = resultTotals(setup, r);
    expect(totals.find((t) => t.key === "subs")!.value).toBe("$0.00");
    expect(totals.some((t) => t.key === "subMarkup")).toBe(false);
    expect(markupBaseNote(r)).toBeNull();
  });

  it("how a line is marked up, and what its one number box is called", () => {
    expect(subMarkupWords(WASH)).toBe("Marked up 10% on its own.");
    expect(subMarkupWords(SCAFFOLD)).toBe("Takes the bid's overhead and profit.");
    expect(subMarkupWords({ markup_pct: 0 })).toBe("Marked up 0% on its own.");
    expect(subMarkupWords({ markup_pct: 12.5 })).toBe("Marked up 12.5% on its own.");
    expect(subQuoteLabel(SCAFFOLD, PAINTING.measures)).toBe("Quote");
    expect(subQuoteLabel(WASH, PAINTING.measures)).toBe("Rate per sq ft");
    expect(subQuoteLabel({ ...WASH, measure_id: "trim" }, PAINTING.measures)).toBe(
      "Rate per linear ft",
    );
    // Nothing picked, a measure that is gone, a measure with no unit typed.
    expect(subQuoteLabel({ ...WASH, measure_id: null }, PAINTING.measures)).toBe("Rate per unit");
    expect(subQuoteLabel({ ...WASH, measure_id: "gone" }, PAINTING.measures)).toBe("Rate per unit");
    expect(subQuoteLabel(WASH, [{ id: "walls", name: "Walls", unit: " " }])).toBe("Rate per unit");
  });
});

// ── Drawn ──────────────────────────────────────────────────────────────────────────────────────

const vendorRow = (id: string, name: string): VendorRow => ({
  id,
  name,
  billable: false,
  archived_at: null,
  account_number: null,
  address1: null,
  address2: null,
  city: null,
  state: null,
  zip: null,
  contact_name: null,
  email: null,
  phone: null,
  notes: null,
  terms: null,
  sage_customer_id: null,
  created_by: null,
  created_at: "2026-11-01T15:00:00.000Z",
  updated_at: "2026-11-01T15:00:00.000Z",
});
const VENDORS: [readonly unknown[], unknown] = [
  vendorsKey(false),
  [vendorRow(VENDOR, "Clean Walls LLC"), vendorRow(OTHER_VENDOR, "Tall Ladder Test Co")],
];

/** Drawn to a string with its answers already in hand, as it stands the moment it opens. */
function draw(el: React.ReactElement, have: [readonly unknown[], unknown][] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const [key, data] of have) qc.setQueryData(key, data);
  const html = renderToString(React.createElement(QueryClientProvider, { client: qc }, el));
  // Nothing that is not a word or a number ever reaches the page.
  for (const junk of ["[object Object]", "undefined", "NaN", ">null<"])
    expect(html).not.toContain(junk);
  // As a person reads it: no marker between two pieces of text, an apostrophe as itself.
  return html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
}
const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The part of the page from one marker up to (not including) another. */
const between = (html: string, from: string, to: string) => {
  const start = html.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf(to, start + from.length);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
};
const numberBoxes = (html: string) => html.match(/<input[^>]*inputMode="decimal"[^>]*>/g) ?? [];
const quoteBox = (html: string, id: string) =>
  html.match(new RegExp(`<input[^>]*data-sub-quote="${id}"[^>]*>`))?.[0] ?? "";
/** The markup box of one line on the bid's main screen (given that line's row). */
const markupBox = (row: string) =>
  row.match(/<input[^>]*data-sub-markup-box="[^"]*"[^>]*>/)?.[0] ?? "";
/** The amount on one line of the totals. */
const total = (html: string, key: string) =>
  html.match(new RegExp(`data-total="${key}"[\\s\\S]*?tabular-nums">([^<]*)<`))?.[1] ?? null;
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("the setup editor with sub lines, drawn", () => {
  const html = draw(
    React.createElement(TradeLinesEditor, {
      value: WITH_SUBS,
      onChange: () => {},
      note: "Only this bid changes.",
    }),
    [VENDORS],
  );
  const washRow = between(html, 'data-sub-row="wash"', 'data-sub-row="scaffold"');
  const scaffoldRow = between(html, 'data-sub-row="scaffold"', 'data-add="sub"');

  it("a Subcontractors card between Labor and Flat costs and markup, with what it means", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at('data-card="trade-labor"')).toBeGreaterThan(-1);
    expect(at('data-card="trade-labor"')).toBeLessThan(at('data-card="trade-subs"'));
    expect(at('data-card="trade-subs"')).toBeLessThan(at('data-card="trade-markup"'));
    const card = between(html, 'data-card="trade-subs"', 'data-card="trade-markup"');
    expect(card).toContain(">Subcontractors<");
    expect(card).toContain(
      "Work you hand to a subcontractor. No sales tax and no crew hours are added for it.",
    );
    expect(card).toContain(
      "Leave a line's markup blank and the bid's overhead and profit apply to it. Type one and that line is marked up on its own instead.",
    );
    expect(card).toContain("Only this bid changes.");
    expect(count(card, "data-sub-row=")).toBe(2);
    expect(count(html, 'data-add="sub"')).toBe(1);
    expect(card).toContain("Add a subcontractor");
  });

  it("each row: what is subbed out, who, how it is charged, the number and its own markup", () => {
    for (const row of [washRow, scaffoldRow]) {
      for (const label of ["What is subbed out", "Subcontractor", "Goes by", "Its own markup"])
        expect(row).toContain(`>${label}</label>`);
      expect(row).toContain('placeholder="Pressure washing"');
      expect(row).toContain('placeholder="Pick from your vendors…"');
      expect(numberBoxes(row)).toHaveLength(2);
    }
    expect(washRow).toContain('value="Pressure washing"');
    expect(scaffoldRow).toContain('value="Scaffolding crew"');
    // A way to remove each that says what it removes.
    expect(washRow).toContain('aria-label="Remove Pressure washing"');
    expect(scaffoldRow).toContain('aria-label="Remove Scaffolding crew"');
  });

  it("the boxes hold 0.2 and 10, then 1500 and nothing", () => {
    // By a measure: the sub's rate for one unit of it, named with the measure's unit.
    expect(washRow).toContain(">Rate per sq ft</label>");
    expect(washRow).not.toContain(">Quote</label>");
    expect(numberBoxes(washRow).map((b) => b.match(/value="([^"]*)"/)![1])).toEqual(["0.2", "10"]);
    // A set quote: the one amount; its own markup left blank, never 0.
    expect(scaffoldRow).toContain(">Quote</label>");
    expect(scaffoldRow).not.toContain("Rate per");
    expect(numberBoxes(scaffoldRow).map((b) => b.match(/value="([^"]*)"/)![1])).toEqual([
      "1500",
      "",
    ]);
    for (const box of [...numberBoxes(washRow), ...numberBoxes(scaffoldRow)])
      expect(box).toContain('type="text"');
    // The 25 boxes of the painting setup (trade-screens-nov16.test.ts) and these four.
    expect(numberBoxes(html)).toHaveLength(29);
    expect(html).not.toContain('type="number"');
  });

  it("the vendor's name shows in the Subcontractor box; nobody picked is a blank box", () => {
    const pickers = (row: string) => row.match(/<input[^>]*role="combobox"[^>]*>/g) ?? [];
    expect(pickers(washRow)).toHaveLength(1);
    expect(pickers(washRow)[0]).toContain('value="Clean Walls LLC"');
    expect(pickers(scaffoldRow)).toHaveLength(1);
    expect(pickers(scaffoldRow)[0]).toContain('value=""');
    // Only a picked vendor can be cleared.
    expect(count(washRow, "Clear the vendor")).toBeGreaterThan(0);
    expect(count(scaffoldRow, "Clear the vendor")).toBe(0);
  });

  it("a vendor since archived, or a list not read yet, still shows the name kept on the line", () => {
    const noList = draw(
      React.createElement(TradeLinesEditor, { value: WITH_SUBS, onChange: () => {} }),
    );
    expect(noList).toContain('value="Clean Walls LLC"');
    const archived = draw(
      React.createElement(TradeLinesEditor, { value: WITH_SUBS, onChange: () => {} }),
      [[vendorsKey(false), [vendorRow(OTHER_VENDOR, "Tall Ladder Test Co")]]],
    );
    expect(archived).toContain('value="Clean Walls LLC"');
  });

  it("no sub lines: the empty words and the Add button, and not one box more", () => {
    const none = draw(
      React.createElement(TradeLinesEditor, { value: PAINTING, onChange: () => {} }),
    );
    const card = between(none, 'data-card="trade-subs"', 'data-card="trade-markup"');
    expect(card).toContain("No subcontractors yet.");
    expect(card).toContain('data-add="sub"');
    expect(card).not.toContain("data-sub-row");
    expect(numberBoxes(none)).toHaveLength(25);
    // No Subcontractor box either. (A "Goes by" choice is a button, not a box.)
    expect(none).not.toMatch(/<input[^>]*role="combobox"/);
  });

  it("a new line shows blank boxes, never a 0", () => {
    const blank = draw(
      React.createElement(TradeLinesEditor, {
        value: addSub(emptySetup(), counter()),
        onChange: () => {},
      }),
    );
    const row = between(blank, 'data-sub-row="n1"', 'data-add="sub"');
    // The quote and its own markup.
    expect(numberBoxes(row)).toHaveLength(2);
    for (const box of numberBoxes(row)) expect(box).toContain('value=""');
    expect(row).toContain(">Quote</label>");
    expect(row).toContain('aria-label="Remove this subcontractor"');
    expect(blank).not.toContain('value="0"');
  });

  it("a sub line whose measure was removed asks for a new pick, and keeps its markup box", () => {
    const orphaned = draw(
      React.createElement(TradeLinesEditor, {
        value: removeMeasure(WITH_SUBS, "walls"),
        onChange: () => {},
      }),
    );
    const row = between(orphaned, 'data-sub-row="wash"', 'data-sub-row="scaffold"');
    expect(row).toContain("Pick what it is measured by.");
    expect(row).not.toContain("Rate per");
    expect(numberBoxes(row).map((b) => b.match(/value="([^"]*)"/)![1])).toEqual(["10"]);
  });
});

// ── The two screens, drawn ─────────────────────────────────────────────────────────────────────

const TRADE_ID = "11111111-1111-4111-8111-111111111111";
const BID_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const MANAGER = { id: "u1", full_name: "Dana Manager", role: "manager" };
const OFFICE = { id: "u2", full_name: "Olive Office", role: "user" };

const trade = (setup: TradeSetup): TradeType => ({
  id: TRADE_ID,
  name: "Painting",
  setup,
  updated_at: "2026-11-17T15:00:00.000Z",
});
const savedBid = (setup: TradeSetup, grandTotal: number): TradeBid => ({
  id: BID_ID,
  name: "Corner house, exterior",
  status: "submitted",
  due_date: "2026-12-01",
  lost_reason: null,
  account_id: ACCOUNT_ID,
  site_id: null,
  account: { id: ACCOUNT_ID, name: "Corner House Owner" },
  data: {
    ...newTradeBid(trade(setup)),
    quantities: JOB,
    scope: "Paint the outside of the house.",
    customer: { ...emptyCustomer(), name: "Corner House Owner", estimatorName: "Dana Manager" },
  },
  grand_total: grandTotal,
  updated_at: "2026-11-17T15:00:00.000Z",
  updated_by_name: "Dana Manager",
  deleted_at: null,
});
const bidScreen = (bid: TradeBid) =>
  draw(React.createElement(TradeBidScreen, { bidId: BID_ID }), [
    [["trade-bid", BID_ID], bid],
    VENDORS,
  ]);
const saveNote = (html: string) => text(between(html, "data-save-note", "data-save="));

describe("a bid with nothing subbed out, drawn", () => {
  auth.profile = OFFICE;
  const html = bidScreen(savedBid(PAINTING, 3067.12));
  const card = between(html, 'data-card="trade-bid-subs"', 'data-card="trade-bid-price"');

  it("the Subcontractor quotes card is always there, right after the measurements", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at('data-card="trade-bid-measurements"')).toBeGreaterThan(-1);
    expect(at('data-card="trade-bid-measurements"')).toBeLessThan(at('data-card="trade-bid-subs"'));
    expect(at('data-card="trade-bid-subs"')).toBeLessThan(at('data-card="trade-bid-price"'));
    expect(card).toContain(">Subcontractor quotes<");
  });

  it("says nothing is subbed out, and offers to add a subcontractor", () => {
    expect(card).toContain("Nothing is subbed out on this bid.");
    const button = card.match(/<button[^>]*data-add-sub-here="true"[^>]*>[\s\S]*?<\/button>/)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain("Add a subcontractor");
    expect(button).not.toContain('disabled=""');
    expect(card).not.toContain("data-sub-quote");
    expect(card).not.toMatch(/<input[^>]*role="combobox"/);
    // Nothing to point at under the rates yet.
    expect(card).not.toContain("open Change this bid's rates and lines below");
  });

  it("the price is the Nov 16 price, with no line and no table for subs", () => {
    expect(total(html, "price")).toBe("$3,067.12");
    expect(html).not.toContain('data-total="subs"');
    expect(html).not.toContain('data-total="subMarkup"');
    expect(html).not.toContain('data-price-table="subs"');
    expect(html).not.toContain("data-markup-base");
    expect(html).not.toContain("data-problems");
    // The card alone is no change to save.
    expect(saveNote(html)).toContain("All changes are saved.");
  });

  it("a new bid of a trade with no sub lines shows the same card", () => {
    auth.profile = MANAGER;
    const fresh = draw(React.createElement(TradeBidScreen, { tradeTypeId: TRADE_ID }), [
      [["trade-type", TRADE_ID], trade(PAINTING)],
    ]);
    expect(fresh).toContain('data-card="trade-bid-subs"');
    expect(fresh).toContain("Nothing is subbed out on this bid.");
    expect(fresh).toContain("data-add-sub-here");
  });
});

describe("the painting bid with two subs, drawn", () => {
  auth.profile = OFFICE;
  const html = bidScreen(savedBid(WITH_SUBS, 5797.12));
  const card = between(html, 'data-card="trade-bid-subs"', 'data-card="trade-bid-price"');
  const washRow = between(card, 'data-sub-quote-row="wash"', 'data-sub-quote-row="scaffold"');
  const scaffoldRow = between(card, 'data-sub-quote-row="scaffold"', "data-add-sub-here");
  const price = between(html, 'data-card="trade-bid-price"', "data-open-rates");

  it("each line on the main screen: what, who, and the one number", () => {
    expect(count(card, "data-sub-quote-row=")).toBe(2);
    expect(washRow).toContain('value="Pressure washing"');
    expect(washRow).toContain('value="Clean Walls LLC"');
    expect(scaffoldRow).toContain('value="Scaffolding crew"');
    for (const row of [washRow, scaffoldRow]) {
      expect(row).toContain(">What is subbed out</label>");
      expect(row).toContain(">Subcontractor</label>");
      expect(row).toContain('placeholder="Pick from your vendors…"');
      // Two number boxes a line: the quote, and the line's own markup (owner, Nov 17, later
      // the same day: "can you make the 10% mark up editable per line"; one box before).
      expect(numberBoxes(row)).toHaveLength(2);
      expect(row).toContain(">Its own markup</label>");
    }
    // The markup box holds the line's own 10; a line with none is blank, never 0.
    expect(markupBox(washRow)).toContain('value="10"');
    expect(markupBox(scaffoldRow)).toContain('value=""');
    for (const row of [washRow, scaffoldRow]) {
      expect(markupBox(row)).toContain('inputMode="decimal"');
      expect(markupBox(row)).not.toContain('disabled=""');
    }
    expect(washRow).toContain('aria-label="Remove Pressure washing"');
    expect(scaffoldRow).toContain('aria-label="Remove Scaffolding crew"');
    expect(card).not.toContain("Nothing is subbed out on this bid.");
    expect(card.match(/<button[^>]*data-add-sub-here="true"[^>]*>/)).not.toBeNull();
  });

  it("the two quote boxes hold 0.2 and 1500, each named for what it is", () => {
    expect(count(card, "data-sub-quote=")).toBe(2);
    expect(quoteBox(card, "wash")).toContain('value="0.2"');
    expect(washRow).toContain(">Rate per sq ft</label>");
    expect(quoteBox(card, "scaffold")).toContain('value="1500"');
    expect(scaffoldRow).toContain(">Quote</label>");
    for (const id of ["wash", "scaffold"]) {
      expect(quoteBox(card, id)).toContain('type="text"');
      expect(quoteBox(card, id)).toContain('inputMode="decimal"');
      expect(quoteBox(card, id)).not.toContain('disabled=""');
    }
  });

  it("under each, how it is marked up; and where the rest is changed", () => {
    expect(washRow).toContain("Marked up 10% on its own.");
    expect(washRow).not.toContain("Takes the bid's overhead and profit.");
    expect(scaffoldRow).toContain("Takes the bid's overhead and profit.");
    expect(card).toContain(
      "Leave a markup blank and the line takes the bid's overhead and profit. To charge by a measurement, open Change this bid's rates and lines below.",
    );
    expect(html).toContain("Change this bid's rates and lines</button>");
    // Both lines are priced: nothing is waiting.
    expect(card).not.toContain("data-sub-problem");
  });

  it("the price: $5,797.12, with the subs in the cost and their own markup beside the profit", () => {
    expect(total(price, "subs")).toBe("$2,100.00");
    expect(total(price, "cost")).toBe("$4,322.55");
    expect(total(price, "overhead")).toBe("$558.38");
    expect(total(price, "profit")).toBe("$856.19");
    expect(total(price, "subMarkup")).toBe("$60.00");
    expect(total(price, "price")).toBe("$5,797.12");
    expect(total(price, "margin")).toBe("25.4% of the price");
    // The lines of the sum in the order they are added up.
    const keys = [...price.matchAll(/data-total="([^"]*)"/g)].map((m) => m[1]);
    expect(keys).toEqual([
      "materials",
      "tax",
      "labor",
      "fixed",
      "subs",
      "cost",
      "overhead",
      "profit",
      "subMarkup",
      "price",
      "hours",
      "days",
      "margin",
    ]);
    expect(text(between(price, 'data-total="subs"', 'data-total="cost"'))).toContain(
      "Subcontractors $2,100.00",
    );
    expect(text(between(price, 'data-total="subMarkup"', 'data-total="price"'))).toContain(
      "plus Subcontractor markup $60.00",
    );
  });

  it("says what overhead and profit were worked on: $3,722.55", () => {
    const note = price.match(/<p[^>]*data-markup-base="true"[^>]*>([^<]*)<\/p>/)?.[1];
    expect(note).toBe(
      "Overhead and profit are worked on $3,722.55: every cost except the subcontractor lines that carry their own markup.",
    );
    // Under the sum it explains, above the time and the margin.
    expect(price.indexOf("data-markup-base")).toBeGreaterThan(price.indexOf('data-total="price"'));
    expect(price.indexOf("data-markup-base")).toBeLessThan(price.indexOf('data-total="hours"'));
  });

  it("a sub adds no hours and no sales tax: still 37 hours, 2.3 days, $43.05", () => {
    expect(total(price, "hours")).toBe("37 hours");
    expect(total(price, "days")).toBe("2.3 days");
    expect(total(price, "tax")).toBe("$43.05");
  });

  it("the Subcontractors table: each line, who does it, its cost and its own markup", () => {
    const table = between(price, 'data-price-table="subs"', "</table>");
    const rows = table.split("<tr").slice(2).map(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Pressure washing");
    expect(rows[0]).toContain("Clean Walls LLC");
    expect(rows[0]).toContain("$600.00");
    expect(rows[0]).toContain("plus $60.00 markup");
    expect(rows[1]).toContain("Scaffolding crew");
    expect(rows[1]).toContain("No subcontractor picked");
    expect(rows[1]).toContain("$1,500.00");
    expect(rows[1]).not.toContain("markup");
    // After the flat costs, before the sum.
    expect(price.indexOf('data-price-table="fixed"')).toBeLessThan(
      price.indexOf('data-price-table="subs"'),
    );
    expect(price.indexOf('data-price-table="subs"')).toBeLessThan(
      price.indexOf("data-price-totals"),
    );
    expect(html).not.toContain("data-problems");
  });

  it("opening it is no change to save, and its own rates stay closed until asked for", () => {
    expect(saveNote(html)).toContain("All changes are saved.");
    expect(html).not.toContain("data-sub-row=");
    expect(html).not.toContain('data-card="trade-subs"');
  });

  it("a deleted bid's sub lines can be read, not changed", () => {
    const gone = bidScreen({
      ...savedBid(WITH_SUBS, 5797.12),
      deleted_at: "2026-11-17T16:00:00.000Z",
    });
    const goneCard = between(gone, 'data-card="trade-bid-subs"', 'data-card="trade-bid-price"');
    for (const input of goneCard.match(/<input[^>]*>/g) ?? [])
      expect(input).toContain('disabled=""');
    for (const button of goneCard.match(/<button[^>]*>/g) ?? [])
      expect(button).toContain('disabled=""');
    expect(quoteBox(goneCard, "scaffold")).toContain('value="1500"');
    expect(total(gone, "price")).toBe("$5,797.12");
  });
});

describe("a sub line with its quote left blank, drawn", () => {
  auth.profile = OFFICE;
  // The scaffolding quote has not come in yet. The line adds nothing:
  //   cost      2,222.55 + 600.00 (the pressure washing)                          $2,822.55
  //   overhead and profit on 2,822.55 − 600.00 = 2,222.55, as on Nov 16           $3,067.12
  //   price     3,067.12 + 600.00 + 60.00                                         $3,727.12
  const setup: TradeSetup = { ...PAINTING, subs: [WASH, { ...SCAFFOLD, amount: null }] };
  const html = bidScreen(savedBid(setup, 3727.12));
  const card = between(html, 'data-card="trade-bid-subs"', 'data-card="trade-bid-price"');
  const scaffoldRow = between(card, 'data-sub-quote-row="scaffold"', "data-add-sub-here");
  const price = between(html, 'data-card="trade-bid-price"', "data-open-rates");

  it("its box is blank, never 0, and the line says what it is waiting for", () => {
    expect(quoteBox(card, "scaffold")).toContain('value=""');
    expect(card).not.toContain('value="0"');
    const problem = scaffoldRow.match(/<p[^>]*data-sub-problem="scaffold"[^>]*>([^<]*)<\/p>/)?.[1];
    expect(problem).toBe("Type the quote.");
    // The line that is priced has nothing to say.
    expect(count(card, "data-sub-problem")).toBe(1);
  });

  it("the price names the line and leaves it out", () => {
    expect(price).toContain('data-problems="1"');
    expect(price).toContain("1 line is missing a number, so the price is not complete yet.");
    expect(price).toContain("Scaffolding crew: type the quote");
    const rows = between(price, 'data-price-table="subs"', "</table>")
      .split("<tr")
      .slice(2)
      .map(text);
    expect(rows[1]).toContain("Scaffolding crew");
    expect(rows[1]).toContain("Type the quote");
    expect(rows[1]).not.toContain("$");
    expect(total(price, "subs")).toBe("$600.00");
    expect(total(price, "cost")).toBe("$2,822.55");
    expect(total(price, "subMarkup")).toBe("$60.00");
    expect(total(price, "price")).toBe("$3,727.12");
  });
});

describe("the rows on the bid's main screen, alone", () => {
  it("a line that goes by a measure nobody picked says so, and its box is still a rate", () => {
    const setup = removeMeasure(WITH_SUBS, "walls");
    const html = draw(
      React.createElement(SubQuoteRows, {
        setup,
        result: calcTradeBid(setup, { trim: 400, doors: 6 }),
        onChange: () => {},
      }),
      [VENDORS],
    );
    const row = between(html, 'data-sub-quote-row="wash"', 'data-sub-quote-row="scaffold"');
    expect(row).toContain(">Rate per unit</label>");
    expect(quoteBox(row, "wash")).toContain('value="0.2"');
    expect(row).toMatch(/data-sub-problem="wash"[^>]*>Pick what it is measured by\.</);
  });

  it("a line with no name yet is removed as this subcontractor", () => {
    const setup = addSub(PAINTING, counter());
    const html = draw(
      React.createElement(SubQuoteRows, {
        setup,
        result: calcTradeBid(setup, JOB),
        onChange: () => {},
      }),
    );
    expect(html).toContain('aria-label="Remove this subcontractor"');
    expect(quoteBox(html, "n1")).toContain('value=""');
    expect(html).toContain("Takes the bid's overhead and profit.");
    expect(html).toMatch(/data-sub-problem="n1"[^>]*>Type the quote\.</);
  });
});

describe("the trade's Try it with sub lines, drawn", () => {
  it("shows the same price: the flat quote counted, the measured line waiting for the walls", () => {
    auth.profile = MANAGER;
    const html = draw(React.createElement(TradeSetupScreen, { tradeTypeId: TRADE_ID }), [
      [["trade-type", TRADE_ID], trade(WITH_SUBS)],
      VENDORS,
    ]);
    // The editor is open on a trade: both rows, with every box.
    expect(count(html, "data-sub-row=")).toBe(2);
    expect(saveNote(html)).toContain("All changes are saved.");
    const tryIt = between(html, 'data-card="trade-try"', "data-save-bar");
    // Nothing measured yet: the six lines of Nov 16 that go by a measure, and the washing.
    expect(tryIt).toContain("7 lines are missing a number, so the price is not complete yet.");
    expect(tryIt).toContain("Pressure washing: type the walls");
    const rows = between(tryIt, 'data-price-table="subs"', "</table>")
      .split("<tr")
      .slice(2)
      .map(text);
    expect(rows[0]).toContain("Type the walls");
    expect(rows[1]).toContain("$1,500.00");
    // What can be priced with nothing measured: supplies 60.00 + tax 3.60 + set up 112.00 +
    // lift 400.00 + scaffolding 1,500.00 = 2,075.60; × 1.15 × 1.20 = 2,864.328
    expect(total(tryIt, "subs")).toBe("$1,500.00");
    expect(total(tryIt, "cost")).toBe("$2,075.60");
    expect(total(tryIt, "price")).toBe("$2,864.33");
    // The washing is not priced yet, so nothing stands apart from overhead and profit.
    expect(tryIt).not.toContain('data-total="subMarkup"');
    expect(tryIt).not.toContain("data-markup-base");
    // The quotes card is the bid's; a trade is set up in the editor.
    expect(html).not.toContain('data-card="trade-bid-subs"');
  });

  it("a job that is all subbed out has something to price", () => {
    // A $4,000 quote marked up 15% on its own: 4,000.00 + 600.00 = 4,600.00
    const setup: TradeSetup = {
      ...emptySetup(),
      overhead_pct: 15,
      profit_pct: 20,
      subs: [sub("all", { name: "Painting, complete", amount: 4000, markup_pct: 15 })],
    };
    const html = draw(React.createElement(TradePrice, { setup, result: calcTradeBid(setup, {}) }));
    expect(html).not.toContain("Nothing to price yet");
    expect(html).toContain('data-price-table="subs"');
    expect(html).toContain("plus $600.00 markup");
    expect(total(html, "subs")).toBe("$4,000.00");
    expect(total(html, "overhead")).toBe("$0.00");
    expect(total(html, "subMarkup")).toBe("$600.00");
    expect(total(html, "price")).toBe("$4,600.00");
    expect(html).toContain("Overhead and profit are worked on $0.00");
    // And a trade with nothing at all still says so, naming the subs too.
    const empty = draw(
      React.createElement(TradePrice, {
        setup: emptySetup(),
        result: calcTradeBid(emptySetup(), {}),
      }),
    );
    expect(empty).toContain(
      "Nothing to price yet: this trade has no materials, labor, flat costs or subcontractors.",
    );
  });
});

// ── Pins on the source ─────────────────────────────────────────────────────────────────────────

const read = (path: string) => readFileSync(path, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const EDITOR = read("src/components/trade/trade-lines-editor.tsx");
const BID = read("src/components/trade/trade-bid-screen.tsx");
const SETUP = read("src/components/trade/trade-setup-screen.tsx");

describe("pins on the source", () => {
  it("the quotes card edits the bid's OWN copy, through the same door as its rates and lines", () => {
    const card = flat(
      BID.slice(
        BID.indexOf('data-card="trade-bid-subs"'),
        BID.indexOf('data-card="trade-bid-price"'),
      ),
    );
    // `setSetup` is what the bid's editor hands its changes to: it changes the draft that the
    // leave guard and Save compare with the copy last saved.
    expect(card).toContain("<SubQuoteRows");
    expect(card).toContain("setup={draft.data.setup}");
    expect(card).toContain("onChange={setSetup}");
    expect(card).toContain("disabled={locked}");
    expect(flat(BID)).toContain("<TradeLinesEditor value={draft.data.setup} onChange={setSetup}");
    expect(BID).toContain("const dirty = !deleted && isDirty(saved, draft);");
    // Both screens settle "no sub lines" against the copy last saved, on every change.
    expect(BID).toContain("const setup = subsAsSaved(changed, saved.data.setup);");
    expect(SETUP).toContain("const setup = subsAsSaved(changed, saved.setup);");
    // A box here holding something that is not a number stops the save, like any other.
    expect(card).toContain("<InvalidBoxes onChange={setBadSubs}>");
    expect(BID).toContain("invalidBoxes: badQuantities + badSubs + badRates,");
    // Not behind a condition: every bid has the card.
    expect(flat(BID)).toMatch(/<\/Card> <Card data-card="trade-bid-subs">/);
  });

  it("picking a vendor sets the id and the name together, in both places", () => {
    const pickers = flat(EDITOR).match(/<VendorPicker [^/]*\/>/g) ?? [];
    expect(pickers).toHaveLength(2);
    for (const picker of pickers) {
      expect(picker).toContain("value={s.vendor_id}");
      expect(picker).toContain("fallbackName={s.vendor_name}");
      expect(picker).toContain("disabled={props.disabled}");
      expect(picker).toContain('placeholder="Pick from your vendors…"');
      expect(picker).toContain("onChange={(vendor) => props.onPatch(subVendorPatch(vendor))}");
    }
    expect(EDITOR).toContain('import { VendorPicker } from "@/components/crm/vendor-picker";');
  });

  it("every number of a sub line goes through the shared number box", () => {
    // The screens type no number of their own (trade-screens-nov16.test.ts pins the same).
    for (const src of [BID, SETUP]) expect(src).not.toContain("inputMode=");
    // The editor's row: the quote, the rate, and the line's own markup with the percent limit.
    const rows = EDITOR.slice(
      EDITOR.indexOf("function SubRow("),
      EDITOR.indexOf("function FixedRow("),
    );
    expect(rows.match(/<AmountBox/g)).toHaveLength(3);
    expect(rows.match(/max=\{BOX_MAX\.amount\}/g)).toHaveLength(2);
    expect(rows.match(/max=\{BOX_MAX\.pct\}/g)).toHaveLength(1);
    expect(flat(rows)).toMatch(
      /value=\{s\.markup_pct\} max=\{BOX_MAX\.pct\} disabled=\{props\.disabled\} after="%"/,
    );
    // The main screen's row: the quote, and the line's own markup (owner, Nov 17, later the
    // same day: "can you make the 10% mark up editable per line"; it was one box before).
    const quoteRow = EDITOR.slice(
      EDITOR.indexOf("function SubQuoteRow("),
      EDITOR.indexOf("export function SubQuoteRows("),
    );
    expect(quoteRow.match(/<AmountBox/g)).toHaveLength(2);
    expect(quoteRow).toContain('hooks={{ "data-sub-quote": s.id }}');
    expect(quoteRow).toContain("max={BOX_MAX.amount}");
  });

  it("the markup of a sub line is typed on the bid's main screen, line by line", () => {
    const quoteRow = EDITOR.slice(
      EDITOR.indexOf("function SubQuoteRow("),
      EDITOR.indexOf("export function SubQuoteRows("),
    );
    // A percent box of its own on each row, held to the same most as every percent box.
    expect(flat(quoteRow)).toMatch(
      /<Field label="Its own markup" htmlFor=\{`\$\{id\}-markup`\}> <AmountBox id=\{`\$\{id\}-markup`\} value=\{s\.markup_pct\} max=\{BOX_MAX\.pct\} disabled=\{props\.disabled\} after="%"/,
    );
    expect(quoteRow).toContain('hooks={{ "data-sub-markup-box": s.id }}');
    // It changes that line only, and blank is handed on as blank (null), never as 0.
    expect(quoteRow).toContain("onChange={(markup_pct) => props.onPatch({ markup_pct })}");
    // The sentence under the row still says which way the line is priced.
    expect(quoteRow).toContain("{subMarkupWords(s)}");
    // The note under the rows no longer sends anyone elsewhere for the markup.
    const rows = EDITOR.slice(
      EDITOR.indexOf("export function SubQuoteRows("),
      EDITOR.indexOf("// ── The editor"),
    );
    expect(flat(rows)).toContain(
      "Leave a markup blank and the line takes the bid&apos;s overhead and profit.",
    );
    expect(flat(rows)).not.toContain("set a line&apos;s own markup, open");
  });

  it("nothing new has a fixed width: on a 390 px phone the rows stack and wrap", () => {
    const added = [
      EDITOR.slice(EDITOR.indexOf("function SubRow("), EDITOR.indexOf("function FixedRow(")),
      EDITOR.slice(EDITOR.indexOf("function SubQuoteRow("), EDITOR.indexOf("// ── The editor")),
      BID.slice(
        BID.indexOf('data-card="trade-bid-subs"'),
        BID.indexOf('data-card="trade-bid-price"'),
      ),
    ];
    for (const src of added) {
      expect(src.length).toBeGreaterThan(200);
      // (`min-w-0` is the opposite of a fixed width: it lets a long line shrink and wrap.)
      expect(src).not.toMatch(/(?<!min-)\bw-(?:\[|\d)|min-w-\[|whitespace-nowrap|overflow-x/);
      // Columns only from a width up; on a phone a grid is one column.
      expect(src).not.toMatch(/(?<![:\w-])grid-cols-/);
    }
  });

  it("the hooks a browser test holds on to", () => {
    for (const hook of [
      'data-card="trade-subs"',
      "data-sub-row={s.id}",
      'kind="sub"',
      "data-sub-quote-row={s.id}",
      '"data-sub-quote": s.id',
      "data-sub-markup={s.id}",
      "data-sub-problem={s.id}",
      "data-add-sub-here",
    ])
      expect(EDITOR).toContain(hook);
    expect(BID).toContain('data-card="trade-bid-subs"');
    expect(BID).toContain("data-markup-base");
    expect(BID).toContain('kind="subs"');
    expect(EDITOR).toContain('setLabel="A set quote"');
  });
});
