/**
 * Trade Bids, the two screens (owner, Nov 16: "a bid setup where we can set labor and cost and
 * time similar to the project bid calculator but simpler and we can save it per job type" …
 * "ensure if someone leaves the pages the pop up reminding to save or giving the option to leave
 * without saving is offered" … "a saved bid should keep its own numbers").
 *
 * First the helpers the screens are built from (trade-bid-form.ts), then the shared pieces drawn
 * to a string, then a few pins on the screens' source. There is no browser here, so nothing
 * below types in a box or presses Save.
 *
 * The same painting job as trade-bid-nov16.test.ts runs through it. Every number was worked out
 * by hand first:
 *
 *   measured: walls 3,000 sq ft, trim 400 linear ft, doors 6
 *
 *   materials
 *     wall paint   $38 a gallon, 350 sq ft a gallon, 10% waste, bought whole
 *                  3000 ÷ 350 = 8.571 → +10% = 9.429 → 10 gallons            $380.00
 *     primer       $25 a gallon, 400 sq ft a gallon → 7.5 gallons            $187.50
 *     trim paint   $45 a gallon, 200 linear ft a gallon, bought whole → 2     $90.00
 *     supplies     1 at $60                                                   $60.00
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
 *   overhead  15% of cost                                                    $333.38
 *   price     2,222.55 × 1.15 × 1.20 = 3,067.119                           $3,067.12
 *   profit    3,067.12 − 2,222.55 − 333.38                                   $511.19
 *   margin    (3,067.12 − 2,222.55) ÷ 3,067.12 = 27.5%
 *   time      37 hours; 2 people × 8 hours a day = 16 a day → 2.3 days
 */
import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The shared pieces are drawn to a string below. Nothing is loaded or saved, so the server
// wrapper, the sign-in and the router are stand-ins; the leave guard is pinned in source.
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

import { TradeBidScreen, TradePrice } from "@/components/trade/trade-bid-screen";
import { MeasureBoxes, TradeLinesEditor } from "@/components/trade/trade-lines-editor";
import { TradeSetupScreen } from "@/components/trade/trade-setup-screen";
import {
  calcTradeBid,
  emptyCustomer,
  emptySetup,
  newTradeBid,
  type TradeSetup,
} from "@/lib/trade-bid";
import type { TradeBid, TradeType } from "@/lib/trade-bids.functions";
import {
  NOT_A_NUMBER,
  PICK_CUSTOMER,
  PICK_DUE_DATE,
  SET_AMOUNT,
  addFixed,
  addLabor,
  addMaterial,
  addMeasure,
  amountProblem,
  amountValue,
  bidHeading,
  bidSaveProblems,
  customerToSend,
  fillJobAddress,
  followers,
  goesBy,
  goesByPatch,
  isDirty,
  patchLine,
  pluralUnit,
  problemsNotice,
  removeLine,
  removeMeasure,
  resultRows,
  resultTotals,
  setCustomerField,
  setupSaveProblems,
  stableJson,
  tidyQuantities,
  unitWords,
} from "@/lib/trade-bid-form";

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

/** Ids in order ("n1", "n2", …), so a new line's id is known. */
const counter = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe("is there something to save?", () => {
  it("writes the same thing the same way, whatever order its parts are in", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [3, { f: undefined, e: 4 }] } })).toBe(
      '{"a":{"c":[3,{"e":4}],"d":2},"b":1}',
    );
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
    // A list's order is part of it: the second material is not the first.
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
    expect(stableJson(undefined)).toBe("null");
  });

  it("a part that is not there and a part that is undefined are the same", () => {
    expect(isDirty({ name: "Painting" }, { name: "Painting", note: undefined })).toBe(false);
    expect(isDirty({ name: "Painting", note: undefined }, { name: "Painting" })).toBe(false);
    // Blank text and nothing are NOT the same: a box cleared by hand is a change.
    expect(isDirty({ name: "Painting" }, { name: "Painting", note: "" })).toBe(true);
    expect(isDirty({ n: null }, { n: 0 })).toBe(true);
  });

  it("a setup read back from the server in another key order is not a change", () => {
    const back = JSON.parse(JSON.stringify(PAINTING)) as TradeSetup;
    const reordered = {
      hours_per_day: back.hours_per_day,
      crew_size: back.crew_size,
      tax_pct: back.tax_pct,
      profit_pct: back.profit_pct,
      overhead_pct: back.overhead_pct,
      fixed: back.fixed,
      labor: back.labor,
      materials: back.materials.map(({ id, ...rest }) => ({ ...rest, id })),
      measures: back.measures,
    };
    expect(isDirty(PAINTING, reordered)).toBe(false);
    expect(isDirty(PAINTING, patchLine(PAINTING, "materials", "Primer", { cost: 26 }))).toBe(true);
    expect(isDirty({ name: "Painting", setup: PAINTING }, { name: "Paint", setup: PAINTING })).toBe(
      true,
    );
  });
});

describe("what is missing before a save", () => {
  it("a new bid needs its customer and its due date, in that order", () => {
    expect(bidSaveProblems({ isNew: true, accountId: null, dueDate: "" })).toEqual([
      PICK_CUSTOMER,
      PICK_DUE_DATE,
    ]);
    expect(PICK_CUSTOMER).toBe("Pick the customer");
    expect(PICK_DUE_DATE).toBe("Pick the due date");
    expect(bidSaveProblems({ isNew: true, accountId: "a1", dueDate: "" })).toEqual([PICK_DUE_DATE]);
    expect(bidSaveProblems({ isNew: true, accountId: null, dueDate: "2026-12-01" })).toEqual([
      PICK_CUSTOMER,
    ]);
    expect(bidSaveProblems({ isNew: true, accountId: "a1", dueDate: "2026-12-01" })).toEqual([]);
  });

  it("a saved bid is asked for its customer only: the due date is a new bid's rule", () => {
    expect(bidSaveProblems({ isNew: false, accountId: "a1", dueDate: "" })).toEqual([]);
    expect(bidSaveProblems({ isNew: false, accountId: null, dueDate: "" })).toEqual([
      PICK_CUSTOMER,
    ]);
  });

  it("a box holding something that is not a number stops the save, last in the list", () => {
    expect(bidSaveProblems({ isNew: true, accountId: null, dueDate: "", invalidBoxes: 1 })).toEqual(
      [
        PICK_CUSTOMER,
        PICK_DUE_DATE,
        "1 box holds something that is not a number. Fix it or clear it.",
      ],
    );
    expect(
      bidSaveProblems({ isNew: false, accountId: "a1", dueDate: "", invalidBoxes: 3 }),
    ).toEqual(["3 boxes hold something that is not a number. Fix them or clear them."]);
  });

  it("a trade needs a name", () => {
    expect(setupSaveProblems({ name: "  " })).toEqual(["Type the trade name"]);
    expect(setupSaveProblems({ name: "Painting" })).toEqual([]);
    expect(setupSaveProblems({ name: "", invalidBoxes: 2 })).toEqual([
      "Type the trade name",
      "2 boxes hold something that is not a number. Fix them or clear them.",
    ]);
  });
});

describe("a number box", () => {
  it("blank is fine, a number is fine, anything else says so", () => {
    expect(amountProblem("")).toBeNull();
    expect(amountProblem("   ")).toBeNull();
    expect(amountProblem("350")).toBeNull();
    expect(amountProblem("0.")).toBeNull();
    expect(amountProblem("$1,250.50")).toBeNull();
    expect(amountProblem("abc")).toBe(NOT_A_NUMBER);
    expect(amountProblem("-3")).toBe(NOT_A_NUMBER);
    expect(amountProblem("12x")).toBe(NOT_A_NUMBER);
    expect(NOT_A_NUMBER).toBe("Type a number, like 350 or 12.5");
  });

  it("a day has 24 hours: over the most a box takes says the most", () => {
    expect(amountProblem("24", 24)).toBeNull();
    expect(amountProblem("30", 24)).toBe("No more than 24");
    expect(amountProblem("2000", 1000)).toBe("No more than 1,000");
  });

  it("what the box means: its number, or nothing while it holds a mistake", () => {
    expect(amountValue("350")).toBe(350);
    expect(amountValue("0.")).toBe(0);
    expect(amountValue("")).toBeNull();
    expect(amountValue("abc")).toBeNull();
    expect(amountValue("30", 24)).toBeNull();
    expect(amountValue("8", 24)).toBe(8);
  });
});

describe("adding, changing and removing lines", () => {
  it("a new measure is blank, has its own id and leaves the setup it came from alone", () => {
    const start = emptySetup();
    const next = addMeasure(start, counter());
    expect(next.measures).toEqual([{ id: "n1", name: "", unit: "" }]);
    expect(start.measures).toEqual([]);
    expect(next).not.toBe(start);
  });

  it("a new material starts with every number blank, never 0", () => {
    const next = addMaterial(PAINTING, counter());
    expect(next.materials).toHaveLength(5);
    expect(next.materials[4]).toEqual({
      id: "n1",
      name: "",
      unit: "",
      cost: null,
      // Three things are measured: which one it goes by is for the person to pick.
      basis: "measure",
      measure_id: null,
      coverage: null,
      waste_pct: null,
      whole: false,
      qty: null,
    });
    expect(PAINTING.materials).toHaveLength(4);
  });

  it("a new line goes by the only measure there is, or by a set amount when there is none", () => {
    const one: TradeSetup = {
      ...emptySetup(),
      measures: [{ id: "a", name: "Area", unit: "sq ft" }],
    };
    expect(addMaterial(one, counter()).materials[0]).toMatchObject({
      basis: "measure",
      measure_id: "a",
    });
    expect(addLabor(one, counter()).labor[0]).toMatchObject({ basis: "measure", measure_id: "a" });
    expect(addMaterial(emptySetup(), counter()).materials[0]).toMatchObject({
      basis: "flat",
      measure_id: null,
    });
    expect(addLabor(emptySetup(), counter()).labor[0]).toEqual({
      id: "n1",
      name: "",
      basis: "flat",
      measure_id: null,
      per_hour: null,
      hours: null,
      rate: null,
    });
  });

  it("a new flat cost is a blank name and a blank cost", () => {
    const next = addFixed(PAINTING, counter());
    expect(next.fixed).toEqual([
      { id: "lift", name: "Lift rental", cost: 400 },
      { id: "n1", name: "", cost: null },
    ]);
  });

  it("changing one line changes that line only", () => {
    const next = patchLine(PAINTING, "materials", "Wall paint", { cost: 42 });
    expect(next.materials[0]).toMatchObject({ id: "Wall paint", cost: 42, coverage: 350 });
    expect(next.materials[1]).toBe(PAINTING.materials[1]);
    expect(PAINTING.materials[0]!.cost).toBe(38);
    // 10 gallons × $42 = 420.00 → materials 757.50; tax 6% = 45.45;
    // cost 757.50 + 45.45 + 1,062.00 + 400.00 = 2,264.95; × 1.15 × 1.20 = 3,125.631
    expect(calcTradeBid(next, JOB).price).toBe(3125.63);
    expect(patchLine(PAINTING, "measures", "walls", { name: "Wall area" }).measures[0]).toEqual({
      id: "walls",
      name: "Wall area",
      unit: "sq ft",
    });
    expect(patchLine(PAINTING, "labor", "Trim", { rate: 32 }).labor[1]!.rate).toBe(32);
    expect(patchLine(PAINTING, "fixed", "lift", { cost: 450 }).fixed[0]!.cost).toBe(450);
  });

  it("removing a line takes it out of the price", () => {
    const next = removeLine(PAINTING, "materials", "Primer");
    expect(next.materials.map((m) => m.id)).toEqual(["Wall paint", "Trim paint", "Supplies"]);
    expect(PAINTING.materials).toHaveLength(4);
    // materials 717.50 − 187.50 = 530.00; tax 6% = 31.80;
    // cost 530.00 + 31.80 + 1,062.00 + 400.00 = 2,023.80; × 1.15 × 1.20 = 2,792.844
    expect(calcTradeBid(next, JOB).price).toBe(2792.84);
    expect(removeLine(PAINTING, "labor", "Doors").labor).toHaveLength(3);
    expect(removeLine(PAINTING, "fixed", "lift").fixed).toEqual([]);
  });

  it("says which lines go by a measure, so removing it can ask first", () => {
    expect(followers(PAINTING, "walls")).toEqual(["Wall paint", "Primer", "Roll walls"]);
    expect(followers(PAINTING, "doors")).toEqual(["Doors"]);
    expect(followers(addMeasure(PAINTING, counter()), "n1")).toEqual([]);
    const unnamed = patchLine(PAINTING, "materials", "Primer", { name: " " });
    expect(followers(unnamed, "walls")).toEqual([
      "Wall paint",
      "a material with no name",
      "Roll walls",
    ]);
  });

  it("removing a measure leaves its lines asking what they are measured by", () => {
    const next = removeMeasure(PAINTING, "walls");
    expect(next.measures.map((m) => m.id)).toEqual(["trim", "doors"]);
    expect(next.materials.map((m) => [m.id, m.basis, m.measure_id])).toEqual([
      ["Wall paint", "measure", null],
      ["Primer", "measure", null],
      ["Trim paint", "measure", "trim"],
      ["Supplies", "flat", null],
    ]);
    expect(next.labor.map((l) => l.measure_id)).toEqual([null, "trim", "doors", null]);
    expect(PAINTING.materials[0]!.measure_id).toBe("walls");

    // Its quantity goes with it; a box cleared by hand is the same as one never typed in.
    const quantities = tidyQuantities({ ...JOB, trim: null }, next);
    expect(quantities).toEqual({ doors: 6 });

    const r = calcTradeBid(next, tidyQuantities(JOB, next));
    expect(r.problems).toEqual([
      "Wall paint: pick what it is measured by",
      "Primer: pick what it is measured by",
      "Roll walls: pick what it is measured by",
    ]);
    // What is left: materials 90.00 + 60.00 = 150.00; tax 6% = 9.00;
    // labor 300.00 + 90.00 + 112.00 = 502.00; flat 400.00;
    // cost 150.00 + 9.00 + 502.00 + 400.00 = 1,061.00; × 1.15 × 1.20 = 1,464.18
    expect(r.price).toBe(1464.18);
  });

  it("the Goes by choice: one of the measures, or a set amount", () => {
    expect(goesBy(PAINTING.materials[0]!, PAINTING.measures)).toBe("m:walls");
    expect(goesBy(PAINTING.materials[3]!, PAINTING.measures)).toBe(SET_AMOUNT);
    // Nothing picked, or a measure that is gone: the box shows "Pick one".
    expect(goesBy(material("x", {}), PAINTING.measures)).toBe("");
    expect(goesBy(material("x", { measure_id: "gone" }), PAINTING.measures)).toBe("");
    expect(goesByPatch("m:trim")).toEqual({ basis: "measure", measure_id: "trim" });
    expect(goesByPatch(SET_AMOUNT)).toEqual({ basis: "flat", measure_id: null });
    // A measure whose id happens to be the word for a set amount is still a measure.
    expect(goesByPatch(`m:${SET_AMOUNT}`)).toEqual({ basis: "measure", measure_id: SET_AMOUNT });
  });
});

describe("unit wording", () => {
  it("one gallon, ten gallons", () => {
    expect(unitWords(1, "gallon")).toBe("1 gallon");
    expect(unitWords(10, "gallon")).toBe("10 gallons");
    expect(unitWords(7.5, "gallon")).toBe("7.5 gallons");
    expect(unitWords(0.5, "gallon")).toBe("0.5 gallons");
    expect(unitWords(0, "gallon")).toBe("0 gallons");
    expect(unitWords(9.4286, "gallon")).toBe("9.429 gallons");
    expect(unitWords(1, "box")).toBe("1 box");
    expect(unitWords(2, "box")).toBe("2 boxes");
    expect(unitWords(12, "inch")).toBe("12 inches");
    expect(unitWords(4, "assembly")).toBe("4 assemblies");
    expect(unitWords(3, "day")).toBe("3 days");
    expect(unitWords(2, "linear foot")).toBe("2 linear feet");
    expect(unitWords(20, "hour")).toBe("20 hours");
    expect(unitWords(1, "hour")).toBe("1 hour");
  });

  it("a short form, and a unit already in the plural, stay as typed", () => {
    expect(unitWords(3000, "sq ft")).toBe("3,000 sq ft");
    expect(unitWords(400, "linear ft")).toBe("400 linear ft");
    expect(unitWords(6, "each")).toBe("6 each");
    expect(unitWords(1, "each")).toBe("1 each");
    expect(unitWords(10, "EA")).toBe("10 EA");
    expect(unitWords(5, "gallons")).toBe("5 gallons");
    expect(unitWords(2, "roll (100 ft)")).toBe("2 roll (100 ft)");
    expect(unitWords(2, "")).toBe("2");
    expect(pluralUnit(" box ", 2)).toBe("boxes");
    expect(pluralUnit("box", 1)).toBe("box");
  });
});

describe("the price, as the screen shows it", () => {
  const result = calcTradeBid(PAINTING, JOB);

  it("the materials, the labor and the flat costs of the painting job", () => {
    expect(resultRows(PAINTING, result)).toEqual({
      materials: [
        { id: "Wall paint", name: "Wall paint", qty: "10 gallons", cost: "$380.00", problem: null },
        { id: "Primer", name: "Primer", qty: "7.5 gallons", cost: "$187.50", problem: null },
        { id: "Trim paint", name: "Trim paint", qty: "2 gallons", cost: "$90.00", problem: null },
        { id: "Supplies", name: "Supplies", qty: "1 each", cost: "$60.00", problem: null },
      ],
      labor: [
        { id: "Roll walls", name: "Roll walls", qty: "20 hours", cost: "$560.00", problem: null },
        { id: "Trim", name: "Trim", qty: "10 hours", cost: "$300.00", problem: null },
        { id: "Doors", name: "Doors", qty: "3 hours", cost: "$90.00", problem: null },
        {
          id: "Set up and clean up",
          name: "Set up and clean up",
          qty: "4 hours",
          cost: "$112.00",
          problem: null,
        },
      ],
      fixed: [{ id: "lift", name: "Lift rental", qty: "", cost: "$400.00", problem: null }],
    });
  });

  it("the totals read as a sum, ending in the price", () => {
    expect(
      resultTotals(PAINTING, result).map((t) => [t.key, t.sign, t.label, t.value, t.strong]),
    ).toEqual([
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
    ]);
  });

  it("no crew, no markup, no price: says so instead of showing a made-up number", () => {
    const bare: TradeSetup = { ...emptySetup(), measures: PAINTING.measures };
    const totals = resultTotals(bare, calcTradeBid(bare, {}));
    const of = (key: string) => totals.find((t) => t.key === key)!;
    expect(of("tax").label).toBe("Sales tax on materials");
    expect(of("overhead").label).toBe("Overhead");
    expect(of("price").value).toBe("$0.00");
    expect(of("hours").value).toBe("0 hours");
    expect(of("days")).toMatchObject({
      label: "Working days for the crew",
      value: "—",
      hint: "Type the people on the crew and the hours in a working day to see this.",
    });
    expect(of("margin").value).toBe("—");
    // One person: "a crew of 1". 37 hours ÷ (1 × 8) = 4.625 → 4.6 days.
    const solo = { ...PAINTING, crew_size: 1 };
    const soloDays = resultTotals(solo, calcTradeBid(solo, JOB)).find((t) => t.key === "days")!;
    expect(soloDays).toMatchObject({ label: "Working days for a crew of 1", value: "4.6 days" });
  });

  it("a line with a problem shows the problem where its cost would be", () => {
    const setup: TradeSetup = {
      ...PAINTING,
      materials: [
        material("Wall paint", { cost: null, measure_id: "walls", coverage: 350 }),
        material("", { cost: 5, measure_id: null }),
      ],
      labor: [
        labor("Trim", { measure_id: "trim", per_hour: 40, rate: null }),
        labor("Doors", { measure_id: "doors", per_hour: 2, rate: 30 }),
      ],
      fixed: [{ id: "lift", name: "", cost: null }],
    };
    const r = calcTradeBid(setup, { walls: 3000, trim: 400 });
    expect(resultRows(setup, r)).toEqual({
      materials: [
        // 3000 ÷ 350 = 8.571: what to buy is known, what it costs is not.
        {
          id: "Wall paint",
          name: "Wall paint",
          qty: "8.571 gallons",
          cost: null,
          problem: "Type the cost",
        },
        { id: "", name: "Material", qty: "", cost: null, problem: "Pick what it is measured by" },
      ],
      labor: [
        // 400 ÷ 40 = 10 hours, with no rate to price them at.
        { id: "Trim", name: "Trim", qty: "10 hours", cost: null, problem: "Type the hourly rate" },
        { id: "Doors", name: "Doors", qty: "", cost: null, problem: "Type the doors" },
      ],
      fixed: [{ id: "lift", name: "Flat cost", qty: "", cost: null, problem: "Type the cost" }],
    });
    expect(r.problems).toHaveLength(5);
    expect(problemsNotice(5)).toBe(
      "5 lines are missing a number, so the price is not complete yet.",
    );
    expect(problemsNotice(1)).toBe("1 line is missing a number, so the price is not complete yet.");
  });
});

describe("the job's words", () => {
  it("the heading: the job name, or what kind of bid it is", () => {
    expect(bidHeading({ name: "Smith house, exterior", tradeName: "Painting", isNew: true })).toBe(
      "Smith house, exterior",
    );
    expect(bidHeading({ name: "  ", tradeName: "Painting", isNew: true })).toBe("New Painting bid");
    expect(bidHeading({ name: "", tradeName: "Siding", isNew: false })).toBe("Siding bid");
    expect(bidHeading({ name: "", tradeName: " ", isNew: true })).toBe("New trade bid");
  });

  it("a box of the customer block: cleared is the same as never typed", () => {
    const c = setCustomerField(emptyCustomer(), "jobCity", "London");
    expect(c.jobCity).toBe("London");
    expect(isDirty(emptyCustomer(), setCustomerField(c, "jobCity", ""))).toBe(false);
    // The four the block always has stay text.
    expect(setCustomerField(c, "projectAddress", "").projectAddress).toBe("");
    expect(setCustomerField(emptyCustomer(), "estimatorName", "Brian")).toMatchObject({
      estimatorName: "Brian",
      name: "",
    });
  });

  it("what is sent leaves a cleared box out, and keeps anything a customer link filled in", () => {
    const typed = setCustomerField(
      setCustomerField({ ...emptyCustomer(), name: "Acme", clientCity: "London" }, "jobCity", "x"),
      "jobCity",
      "",
    );
    expect("jobCity" in typed).toBe(true);
    const sent = customerToSend(typed);
    expect("jobCity" in sent).toBe(false);
    expect(sent).toEqual({
      name: "Acme",
      contact: "",
      projectAddress: "",
      notes: "",
      clientCity: "London",
    });
  });

  it("the property's address fills a blank job address, and never writes over a typed one", () => {
    const site = { address1: "12 Main St", city: "London", state: "KY", zip: "40741" };
    expect(fillJobAddress(emptyCustomer(), site)).toMatchObject({
      projectAddress: "12 Main St",
      jobCity: "London",
      jobState: "KY",
      jobZip: "40741",
    });
    const typed = setCustomerField(emptyCustomer(), "jobCity", "Corbin");
    expect(fillJobAddress(typed, site)).toBe(typed);
    // A property with no address on file changes nothing.
    const none = { address1: null, city: null, state: null, zip: null };
    expect(isDirty(emptyCustomer(), fillJobAddress(emptyCustomer(), none))).toBe(false);
  });
});

// ── The shared pieces, drawn ───────────────────────────────────────────────────────────────────

const draw = (el: React.ReactElement) => renderToString(el);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the setup editor, drawn", () => {
  const html = draw(
    React.createElement(TradeLinesEditor, {
      value: PAINTING,
      onChange: () => {},
      note: "Only this bid changes.",
    }),
  );

  it("four sections in order, each with its Add button", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at("What you measure")).toBeGreaterThan(-1);
    expect(at("What you measure")).toBeLessThan(at(">Materials<"));
    expect(at(">Materials<")).toBeLessThan(at(">Labor<"));
    expect(at(">Labor<")).toBeLessThan(at("Flat costs and markup"));
    for (const kind of ["measure", "material", "labor", "fixed"])
      expect(count(html, `data-add="${kind}"`)).toBe(1);
    expect(html).toContain("The amounts a bid asks for, such as wall area or number of doors.");
    expect(html).toContain(
      "Overhead is added to the cost. Profit is added on top of cost and overhead.",
    );
    expect(html).toContain("Tax you pay the supplier. It is counted as a cost.");
    // The note sits under the title of each of the four sections.
    expect(count(html, "Only this bid changes.")).toBe(4);
  });

  it("one row per line, each with a way to remove it that says what it removes", () => {
    expect(count(html, "data-measure-row")).toBe(3);
    expect(count(html, "data-material-row")).toBe(4);
    expect(count(html, "data-labor-row")).toBe(4);
    expect(count(html, "data-fixed-row")).toBe(1);
    expect(html).toContain('aria-label="Remove Walls"');
    expect(html).toContain('aria-label="Remove Wall paint"');
    expect(html).toContain('aria-label="Remove Roll walls"');
    expect(html).toContain('aria-label="Remove Lift rental"');
  });

  it("says in words how each line gets its amount", () => {
    expect(html).toContain("One gallon covers");
    expect(html).toContain("Bought whole (round up)");
    expect(html).toContain("One person does");
    expect(html).toContain("sq ft an hour");
    expect(html).toContain("How many");
    expect(html).toContain("People on the crew");
    expect(html).toContain("Hours in a working day");
  });

  it("every number box is a text box for decimals, holding the number or nothing", () => {
    const boxes = html.match(/<input[^>]*inputMode="decimal"[^>]*>/g) ?? [];
    // materials: 3 by a measure × (cost, covers, waste) + 1 set amount × (cost, how many) = 11
    // labor: 3 by a measure × (rate, does) + 1 set hours × (rate, hours) = 8
    // flat: 1; markup: overhead, profit, tax, crew, hours a day = 5.   11 + 8 + 1 + 5 = 25
    expect(boxes).toHaveLength(25);
    for (const box of boxes) expect(box).toContain('type="text"');
    expect(html).not.toContain('type="number"');
    expect(html).toContain('value="350"');
    expect(html).toContain('value="38"');
  });

  it("a new, empty trade shows blank boxes, never a 0", () => {
    const blank = draw(
      React.createElement(TradeLinesEditor, {
        value: addFixed(addLabor(addMaterial(emptySetup(), counter()), counter()), counter()),
        onChange: () => {},
      }),
    );
    const boxes = blank.match(/<input[^>]*inputMode="decimal"[^>]*>/g) ?? [];
    // material (cost, how many) + labor (rate, hours) + flat (cost) + markup 5 = 10
    expect(boxes).toHaveLength(10);
    for (const box of boxes) expect(box).toContain('value=""');
    expect(blank).not.toContain('value="0"');
  });

  it("a line whose measure was removed asks for a new pick", () => {
    const orphaned = draw(
      React.createElement(TradeLinesEditor, {
        value: removeMeasure(PAINTING, "walls"),
        onChange: () => {},
      }),
    );
    // Wall paint, Primer and Roll walls followed Walls.
    expect(count(orphaned, "Pick what it is measured by")).toBe(3);
    expect(count(html, "Pick what it is measured by")).toBe(0);
  });
});

describe("the measurements and the price, drawn", () => {
  it("one blank box per measure, named with its unit", () => {
    const html = draw(
      React.createElement(MeasureBoxes, {
        measures: PAINTING.measures,
        quantities: { walls: 3000 },
        onChange: () => {},
      }),
    );
    for (const id of ["walls", "trim", "doors"]) expect(html).toContain(`data-quantity="${id}"`);
    expect(html).toContain("Walls");
    expect(html).toContain("linear ft");
    expect(html).toContain('value="3000"');
    expect(count(html, 'value=""')).toBe(2);
    expect(html).not.toContain('type="number"');
  });

  it("the painting job: every total, the price in bold, the days and the margin", () => {
    const html = draw(
      React.createElement(TradePrice, { setup: PAINTING, result: calcTradeBid(PAINTING, JOB) }),
    );
    for (const key of [
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
    ])
      expect(count(html, `data-total="${key}"`)).toBe(1);
    expect(html).toContain("10 gallons");
    expect(html).toContain("$380.00");
    expect(html).toContain("$3,067.12");
    expect(html).toContain("2.3 days");
    expect(html).toContain("27.5% of the price");
    expect(html).not.toContain("data-problems");
  });

  it("a bid with nothing measured yet says what is missing, line by line", () => {
    const r = calcTradeBid(PAINTING, {});
    // Six lines go by a measure (3 materials, 3 labor); the two set amounts are complete.
    expect(r.problems).toHaveLength(6);
    const html = draw(React.createElement(TradePrice, { setup: PAINTING, result: r }));
    expect(html).toContain("data-problems");
    expect(html).toContain("6 lines are missing a number, so the price is not complete yet.");
    expect(html).toContain("Wall paint: type the walls");
    expect(html).toContain("Type the walls");
  });
});

// ── The two screens, drawn ─────────────────────────────────────────────────────────────────────

const TRADE_ID = "11111111-1111-4111-8111-111111111111";
const BID_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const PAINTING_TRADE: TradeType = {
  id: TRADE_ID,
  name: "Painting",
  setup: PAINTING,
  updated_at: "2026-11-16T15:00:00.000Z",
};
const SMITH_BID: TradeBid = {
  id: BID_ID,
  name: "Smith house, exterior",
  status: "submitted",
  due_date: "2026-12-01",
  lost_reason: null,
  account_id: ACCOUNT_ID,
  site_id: null,
  account: { id: ACCOUNT_ID, name: "Smith Family" },
  data: {
    ...newTradeBid(PAINTING_TRADE),
    quantities: JOB,
    scope: "Paint the outside of the house.",
    customer: { ...emptyCustomer(), name: "Smith Family", estimatorName: "Brian" },
  },
  grand_total: 3067.12,
  updated_at: "2026-11-16T15:00:00.000Z",
  updated_by_name: "Brian",
  deleted_at: null,
};
const MANAGER = { id: "u1", full_name: "Dana Manager", role: "manager" };
const OFFICE = { id: "u2", full_name: "Olive Office", role: "user" };

/**
 * A screen drawn to a string with its answers already in hand, as it stands the moment it
 * opens. Returns the cache too, so a test can see whether anything was asked for.
 */
function drawScreen(el: React.ReactElement, have: [unknown[], unknown][] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const [key, data] of have) qc.setQueryData(key, data);
  const html = renderToString(React.createElement(QueryClientProvider, { client: qc }, el));
  // Nothing that is not a word or a number ever reaches the page.
  for (const junk of ["[object Object]", "undefined", "NaN", ">null<"])
    expect(html).not.toContain(junk);
  return { html, asked: qc.getQueryCache().getAll().length };
}
const saveButton = (html: string) => html.match(/<button[^>]*data-save="true"[^>]*>/)?.[0] ?? "";

describe("setting up a trade, drawn", () => {
  it("anyone but an admin or a manager is told so, and nothing is read", () => {
    auth.profile = OFFICE;
    const { html, asked } = drawScreen(
      React.createElement(TradeSetupScreen, { tradeTypeId: TRADE_ID }),
    );
    expect(html).toContain("Only an admin or a manager sets up a trade.");
    expect(html).toContain("Trade Bids");
    expect(html).not.toContain("data-trade-name");
    expect(saveButton(html)).toBe("");
    expect(asked).toBe(0);
  });

  it("a new trade: a blank name, an empty setup, and Save off until it has a name", () => {
    auth.profile = MANAGER;
    const { html } = drawScreen(React.createElement(TradeSetupScreen, {}));
    expect(html).toContain('data-trade-setup="new"');
    expect(html).toContain("Set up a trade");
    expect(html).toMatch(/<input[^>]*data-trade-name="true"[^>]*>/);
    expect(html.match(/<input[^>]*data-trade-name="true"[^>]*>/)![0]).toContain('value=""');
    expect(html).toContain("Before you can save: Type the trade name.");
    expect(saveButton(html)).toContain('disabled=""');
    expect(html).toContain("Try it");
    expect(html).toContain("Sample numbers to check your setup. They are not saved.");
    expect(html).toContain(
      "Bids already started keep their own numbers. This changes new bids only.",
    );
    // Nothing to delete yet.
    expect(html).not.toContain("Delete this trade");
    expect(html).not.toContain('value="0"');
  });

  it("a saved trade: its name, its lines, Save on, and Delete", () => {
    auth.profile = MANAGER;
    const { html } = drawScreen(React.createElement(TradeSetupScreen, { tradeTypeId: TRADE_ID }), [
      [["trade-type", TRADE_ID], PAINTING_TRADE],
    ]);
    expect(html).toContain(`data-trade-setup="${TRADE_ID}"`);
    expect(html).toContain(">Painting</h1>");
    expect(html.match(/<input[^>]*data-trade-name="true"[^>]*>/)![0]).toContain('value="Painting"');
    expect(count(html, "data-material-row")).toBe(4);
    expect(saveButton(html)).not.toBe("");
    expect(saveButton(html)).not.toContain('disabled=""');
    expect(html).toContain("All changes are saved.");
    expect(html).toContain("Delete this trade");
    // "Try it" starts with nothing measured: one blank box per measure, and the six lines that
    // go by a measure waiting for a number.
    for (const id of ["walls", "trim", "doors"]) expect(html).toContain(`data-quantity="${id}"`);
    expect(html).toContain("6 lines are missing a number, so the price is not complete yet.");
  });
});

describe("a bid, drawn", () => {
  it("a new bid of a trade: nothing measured, the estimator filled in, and what Save needs", () => {
    auth.profile = MANAGER;
    const { html } = drawScreen(React.createElement(TradeBidScreen, { tradeTypeId: TRADE_ID }), [
      [["trade-type", TRADE_ID], PAINTING_TRADE],
    ]);
    expect(html).toContain('data-trade-bid="new"');
    expect(html).toContain("New Painting bid</h1>");
    expect(html).toContain('value="Dana Manager"');
    expect(html).toContain("Leave blank to name the bid after its customer");
    const boxes = html.match(/<input[^>]*data-quantity="[^"]*"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box).toContain('value=""');
      expect(box).toContain('type="text"');
      expect(box).toContain('inputMode="decimal"');
    }
    expect(html).toContain("6 lines are missing a number, so the price is not complete yet.");
    expect(html).toContain("Before you can save: Pick the customer. Pick the due date.");
    expect(saveButton(html)).not.toBe("");
    // The status and the documents belong to a saved bid.
    expect(html).not.toContain("data-status");
    expect(html).not.toContain("Documents");
    // The bid's own rates stay closed until asked for.
    expect(html).toContain("rates and lines");
    expect(html).not.toContain("data-material-row");
  });

  it("a saved bid: its numbers, its price, its status and its documents", () => {
    auth.profile = OFFICE;
    const { html } = drawScreen(React.createElement(TradeBidScreen, { bidId: BID_ID }), [
      [["trade-bid", BID_ID], SMITH_BID],
    ]);
    expect(html).toContain(`data-trade-bid="${BID_ID}"`);
    expect(html).toContain("Smith house, exterior</h1>");
    expect(html).toContain('data-status="submitted"');
    expect(html).toContain("Documents");
    expect(html).toContain('value="Smith Family"');
    expect(html).toContain('value="2026-12-01"');
    expect(html).toContain("Paint the outside of the house.");
    expect(html).toContain("This prints on the proposal.");
    expect(html.match(/<input[^>]*data-quantity="walls"[^>]*>/)![0]).toContain('value="3000"');
    expect(html).toContain("$3,067.12");
    expect(html).toContain("2.3 days");
    expect(html).not.toContain("data-problems");
    expect(html).toContain("All changes are saved.");
    expect(saveButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain("This bid was deleted");
  });

  it("a deleted bid can be read, not changed", () => {
    auth.profile = OFFICE;
    const { html } = drawScreen(React.createElement(TradeBidScreen, { bidId: BID_ID }), [
      [["trade-bid", BID_ID], { ...SMITH_BID, deleted_at: "2026-11-16T16:00:00.000Z" }],
    ]);
    expect(html).toContain("This bid was deleted.");
    expect(saveButton(html)).toBe("");
    for (const box of html.match(/<input[^>]*data-quantity="[^"]*"[^>]*>/g) ?? [])
      expect(box).toContain('disabled=""');
    expect(html).toContain("$3,067.12");
  });

  it("a bid that cannot be found says so, with the way back", () => {
    auth.profile = OFFICE;
    const { html } = drawScreen(React.createElement(TradeBidScreen, {}));
    expect(html).toContain("No bid to show");
    expect(html).toContain("Trade Bids");
  });
});

// ── Pins on the screens' source ────────────────────────────────────────────────────────────────

const read = (path: string) => readFileSync(path, "utf8");
const EDITOR = read("src/components/trade/trade-lines-editor.tsx");
const SETUP = read("src/components/trade/trade-setup-screen.tsx");
const BID = read("src/components/trade/trade-bid-screen.tsx");

describe("pins on the source", () => {
  it("no number box changes on a mouse wheel or starts at 0", () => {
    for (const src of [EDITOR, SETUP, BID]) {
      expect(src).not.toContain('type="number"');
      expect(src).not.toMatch(/defaultValue=\{?["']?0/);
      // No box's value falls back to 0 when there is no number.
      expect(src).not.toMatch(/value=\{[^}]*(\?\?|\|\|)\s*0\s*\}/);
    }
    // One box for every number on the three files: text, decimal keypad, read by parseAmount.
    expect(EDITOR).toMatch(/type="text"\s+inputMode="decimal"/);
    expect(EDITOR).toContain("amountText(");
    expect(EDITOR).toContain("amountValue(");
    // The screens type no number of their own: every one goes through the shared boxes.
    for (const src of [SETUP, BID]) expect(src).not.toContain("inputMode=");
    expect(SETUP).toContain("<MeasureBoxes");
    expect(BID).toContain("<MeasureBoxes");
  });

  it("both screens ask before leaving with something unsaved: three choices", () => {
    for (const src of [SETUP, BID]) {
      expect(src).toMatch(
        /const blocker = useBlocker\(\{\s*shouldBlockFn: \(\) => dirtyRef\.current,\s*withResolver: true,\s*enableBeforeUnload: \(\) => dirtyRef\.current,\s*\}\);/,
      );
      expect(src).toContain("<LeaveDialog");
      // After a save the screen moves itself: the guard is cleared by hand first.
      expect(src).toMatch(/dirtyRef\.current = false;[\s\S]*?void navigate\(/);
    }
    expect(BID).toContain("data-leave");
    expect(BID).toContain(">Stay<");
    expect(BID).toContain("Leave without saving");
    expect(BID).toContain("Save and leave");
  });

  it("setting up a trade is an admin's and a manager's", () => {
    expect(SETUP).toContain('import { seesEveryone } from "@/lib/access";');
    expect(SETUP).toContain("seesEveryone(profile)");
    expect(SETUP).toContain("Only an admin or a manager sets up a trade.");
  });

  it("the saves go through the server functions, by the router's own wrapper", () => {
    expect(SETUP).toContain("useServerFn(saveTradeType)");
    expect(SETUP).toContain("useServerFn(deleteTradeType)");
    expect(SETUP).toContain("useServerFn(getTradeType)");
    expect(BID).toContain("useServerFn(saveTradeBid)");
    expect(BID).toContain("useServerFn(getTradeBid)");
    expect(BID).toContain("useServerFn(getTradeType)");
    expect(BID).toContain("useServerFn(setBidStatus)");
    expect(SETUP).toContain("expectUpdatedAt");
    expect(BID).toContain("expectUpdatedAt");
  });

  it("the hooks a browser test holds on to", () => {
    expect(SETUP).toContain("data-trade-setup");
    expect(SETUP).toContain("data-trade-name");
    expect(SETUP).toContain("data-save");
    expect(BID).toContain("data-trade-bid");
    expect(BID).toContain("data-save");
    expect(BID).toContain("data-status");
    expect(BID).toContain("data-problems");
    expect(BID).toContain("data-total={");
    expect(EDITOR).toContain('"data-quantity": props.measure.id');
    for (const hook of [
      "data-measure-row",
      "data-material-row",
      "data-labor-row",
      "data-fixed-row",
    ])
      expect(EDITOR).toContain(hook);
  });

  it("a saved bid's Documents and a bid's words", () => {
    expect(BID).toContain("<DocumentsPanel");
    // Marking a saved bid Lost asks why, with the same question the Bids list asks.
    expect(BID).toContain("<LostReasonDialog");
    expect(BID).toContain('kind="bid"');
    expect(BID).toContain("This prints on the proposal.");
    expect(BID).toContain("Only this bid changes. The ");
    expect(SETUP).toContain(
      "Bids already started keep their own numbers. This changes new bids only.",
    );
    expect(SETUP).toContain("Sample numbers to check your setup. They are not saved.");
  });
});
