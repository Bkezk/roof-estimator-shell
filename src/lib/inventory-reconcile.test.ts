/**
 * Inventory › Reconcile (owner, Oct 9: "figure out where negative stock came from"): the pure
 * report builder — negative detection, the entry that crossed zero, the taking entries after it
 * in order and capped, "Short:" detection, a cell fixed inside the week, the empty report — the
 * Monday–Sunday week helpers, and the Set count payload (reconcileAdjustment).
 */
import { describe, expect, it } from "vitest";

import {
  buildReconciliation,
  cellName,
  CLEAN_LINE,
  CONTRIBUTOR_CAP,
  fmtQty,
  isShortNote,
  RECONCILE_NOTE,
  reconcileAdjustment,
  reconcileWindow,
  reconciliationSummary,
  shiftWeek,
  weekStartOf,
  type ReconcileMovement,
} from "@/lib/inventory-reconcile";

// The week of Monday Oct 5, 2026, office time (EDT): Oct 5 00:00 → Oct 12 00:00 Eastern.
const WEEK = reconcileWindow("2026-10-05");
const SINCE = WEEK.since;
const UNTIL = WEEK.until;
const LOCATIONS = [
  { id: "shop", name: "Shop" },
  { id: "truck-1", name: "Truck 1" },
];
const JOB = "11111111-1111-4111-8111-111111111111";
const JOB2 = "22222222-2222-4222-8222-222222222222";

let nextId = 1;
const mv = (over: Partial<ReconcileMovement> & { qty: number; created_at: string }) =>
  ({
    id: nextId++,
    location_id: "shop",
    screen_id: "duro_last:sealants",
    row_label: "Duro-Caulk Plus",
    price_col: "White",
    unit: "tube",
    reason: over.qty < 0 ? "consumed" : "leftover",
    service_job_id: null,
    service_job_name: null,
    note: null,
    created_by_name: "Ann",
    ...over,
  }) as ReconcileMovement;

const build = (movements: ReconcileMovement[]) =>
  buildReconciliation({ movements, locations: LOCATIONS, ...WEEK });

describe("weeks (office time, Monday–Sunday)", () => {
  it("reconcileWindow: Monday 00:00 Eastern to the next Monday 00:00, DST-aware", () => {
    expect(WEEK).toEqual({
      weekStart: "2026-10-05",
      since: "2026-10-05T04:00:00.000Z", // EDT
      until: "2026-10-12T04:00:00.000Z",
    });
    // Any day of the week lands on its Monday; a week in standard time is UTC−5.
    expect(reconcileWindow("2026-10-09").weekStart).toBe("2026-10-05");
    expect(reconcileWindow("2026-12-16")).toEqual({
      weekStart: "2026-12-14",
      since: "2026-12-14T05:00:00.000Z",
      until: "2026-12-21T05:00:00.000Z",
    });
    // The week the clocks fall back (Nov 1, 2026) opens in EDT and closes in EST.
    expect(reconcileWindow("2026-10-26")).toEqual({
      weekStart: "2026-10-26",
      since: "2026-10-26T04:00:00.000Z",
      until: "2026-11-02T05:00:00.000Z",
    });
  });
  it("nothing passed = the week `now` falls in, by the office's day (Sunday 11 pm Eastern is still that week)", () => {
    // 2026-10-12T03:00Z is Sunday Oct 11, 11 pm EDT.
    expect(reconcileWindow(null, new Date("2026-10-12T03:00:00Z")).weekStart).toBe("2026-10-05");
    expect(reconcileWindow(undefined, new Date("2026-10-12T05:00:00Z")).weekStart).toBe(
      "2026-10-12",
    );
  });
  it("weekStartOf / shiftWeek", () => {
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05"); // a Monday stays
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05"); // Sunday → its Monday
    expect(weekStartOf("2026-01-01")).toBe("2025-12-29"); // across a year
    expect(shiftWeek("2026-10-05", -1)).toBe("2026-09-28");
    expect(shiftWeek("2026-10-05", 1)).toBe("2026-10-12");
    expect(() => weekStartOf("not a day")).toThrow();
  });
});

describe("helpers", () => {
  it("isShortNote: the server's note alone, or after the user's own note", () => {
    expect(isShortNote("Short: inventory had 0 tube on the shelf; count needs fixing")).toBe(true);
    expect(
      isShortNote("Used the last one — Short: inventory had 0 tube on Truck 1; count needs fixing"),
    ).toBe(true);
    expect(isShortNote("Shortage noted by Ann")).toBe(false);
    expect(isShortNote(null)).toBe(false);
  });
  it("cellName: row · colour, or the row alone for a single-price product", () => {
    expect(cellName({ row_label: "Duro-Caulk Plus", price_col: "White" })).toBe(
      "Duro-Caulk Plus · White",
    );
    expect(cellName({ row_label: "ISO board", price_col: "price" })).toBe("ISO board");
  });
  it("fmtQty: a real minus sign, three decimals at most", () => {
    expect(fmtQty(-120)).toBe("−120");
    expect(fmtQty(3.5)).toBe("+3.5");
    expect(fmtQty(-0.33333)).toBe("−0.333");
  });
});

describe("buildReconciliation — negatives and where they came from", () => {
  it("an empty ledger is a clean report", () => {
    const r = build([]);
    expect(r.negatives).toEqual([]);
    expect(r.shortEntries).toEqual([]);
    expect(r.fixed).toEqual([]);
    expect(r.totals).toEqual({ negatives: 0, short: 0, fixed: 0, movements: 0 });
    expect(r.weekStart).toBe("2026-10-05");
    expect(r.weekLabel).toBe("Oct 5 – Oct 11");
    expect(reconciliationSummary(r)).toBe(CLEAN_LINE);
  });

  it("a cell at or above zero is not listed, whatever happened in the week", () => {
    const r = build([
      mv({ qty: 5, created_at: "2026-10-06T10:00:00Z" }),
      mv({ qty: -5, created_at: "2026-10-07T10:00:00Z", service_job_id: JOB }),
    ]);
    expect(r.negatives).toEqual([]);
    expect(r.fixed).toEqual([]);
  });

  it("the entry that crossed zero opens the list; every later taking entry follows, oldest first; adds are left out", () => {
    const r = build([
      mv({ qty: 2, created_at: "2026-09-01T10:00:00Z" }),
      mv({
        qty: -1,
        created_at: "2026-09-02T10:00:00Z",
        service_job_id: JOB,
        service_job_name: "#6001 Smith",
      }),
      // Crosses zero (2 − 1 − 3 = −2), older than the week: still the origin.
      mv({
        qty: -3,
        created_at: "2026-09-20T10:00:00Z",
        service_job_id: JOB2,
        service_job_name: "#6002 Jones",
        created_by_name: "Joe",
        note: "Short: inventory had 1 tube on the shelf; count needs fixing",
      }),
      mv({ qty: 1, created_at: "2026-10-06T10:00:00Z", reason: "released", service_job_id: JOB2 }),
      mv({ qty: -2, created_at: "2026-10-07T10:00:00Z", reason: "damaged" }),
    ]);
    expect(r.negatives).toHaveLength(1);
    const n = r.negatives[0]!;
    expect(n).toMatchObject({
      location_id: "shop",
      location_name: "Shop",
      screen_id: "duro_last:sealants",
      row_label: "Duro-Caulk Plus",
      price_col: "White",
      name: "Duro-Caulk Plus · White",
      unit: "tube",
      on_hand: -3,
      firstBelowZeroAt: "2026-09-20T10:00:00Z",
      more: 0,
    });
    expect(n.contributors.map((c) => [c.at, c.qty, c.reason, c.by_name, c.short])).toEqual([
      ["2026-09-20T10:00:00Z", -3, "consumed", "Joe", true],
      ["2026-10-07T10:00:00Z", -2, "damaged", "Ann", false],
    ]);
    expect(n.contributors[0]).toMatchObject({
      service_job_id: JOB2,
      service_job_name: "#6002 Jones",
    });
    // The −1 before the crossing is not "where it came from".
    expect(n.contributors.some((c) => c.qty === -1)).toBe(false);
    expect(reconciliationSummary(r)).toBe("1 cell below zero, 0 short entries this week.");
  });

  it("negatives are current state: the same cell is listed whichever week is picked", () => {
    const rows = [mv({ qty: -2, created_at: "2026-09-20T10:00:00Z" })];
    const a = buildReconciliation({ movements: rows, locations: LOCATIONS, ...WEEK });
    const b = buildReconciliation({
      movements: rows,
      locations: LOCATIONS,
      ...reconcileWindow("2026-08-03"),
    });
    expect(a.negatives.map((n) => n.on_hand)).toEqual([-2]);
    expect(b.negatives.map((n) => n.on_hand)).toEqual([-2]);
  });

  it("a cell that went below zero, was fixed and went below zero again is explained by the current stretch", () => {
    const r = build([
      mv({ qty: -1, created_at: "2026-09-01T10:00:00Z", created_by_name: "Old" }),
      mv({ qty: 5, created_at: "2026-09-02T10:00:00Z", reason: "adjustment" }),
      mv({ qty: -6, created_at: "2026-10-08T10:00:00Z", created_by_name: "New" }),
    ]);
    expect(r.negatives).toHaveLength(1);
    expect(r.negatives[0]!.firstBelowZeroAt).toBe("2026-10-08T10:00:00Z");
    expect(r.negatives[0]!.contributors.map((c) => c.by_name)).toEqual(["New"]);
    expect(r.fixed).toEqual([]);
  });

  it("cells are keyed per location: the shop's negative does not touch the truck's count", () => {
    const r = build([
      mv({ qty: 4, created_at: "2026-10-01T10:00:00Z", location_id: "truck-1" }),
      mv({ qty: -1, created_at: "2026-10-06T10:00:00Z" }),
    ]);
    expect(r.negatives.map((n) => [n.location_name, n.on_hand])).toEqual([["Shop", -1]]);
  });

  it("contributors are capped at 10 with the rest counted", () => {
    const rows = [mv({ qty: -1, created_at: "2026-09-01T00:00:00Z" })];
    for (let i = 0; i < 14; i++)
      rows.push(mv({ qty: -1, created_at: `2026-09-${String(2 + i).padStart(2, "0")}T00:00:00Z` }));
    const r = build(rows);
    expect(r.negatives[0]!.contributors).toHaveLength(CONTRIBUTOR_CAP);
    expect(r.negatives[0]!.more).toBe(5);
    expect(r.negatives[0]!.on_hand).toBe(-15);
  });

  it("entries out of order on input are walked by time, not by position", () => {
    const r = build([
      mv({ qty: -3, created_at: "2026-10-07T10:00:00Z", created_by_name: "Second" }),
      mv({ qty: 2, created_at: "2026-10-06T10:00:00Z" }),
    ]);
    expect(r.negatives[0]!.firstBelowZeroAt).toBe("2026-10-07T10:00:00Z");
    expect(r.negatives[0]!.on_hand).toBe(-1);
  });

  it("negatives sort by location then name", () => {
    const r = build([
      mv({ qty: -1, created_at: "2026-10-06T10:00:00Z", location_id: "truck-1", row_label: "Zed" }),
      mv({ qty: -1, created_at: "2026-10-06T10:00:00Z", row_label: "Beta" }),
      mv({ qty: -1, created_at: "2026-10-06T10:00:00Z", row_label: "Alpha" }),
    ]);
    expect(r.negatives.map((n) => `${n.location_name} ${n.row_label}`)).toEqual([
      "Shop Alpha",
      "Shop Beta",
      "Truck 1 Zed",
    ]);
  });
});

describe("buildReconciliation — short entries and fixes follow the picked week", () => {
  const short = "Short: inventory had 0 tube on the shelf; count needs fixing";
  const rows = () => [
    mv({ qty: -1, created_at: "2026-09-30T10:00:00Z", note: short }),
    mv({
      qty: -2,
      created_at: "2026-10-08T10:00:00Z",
      note: `Last one — ${short}`,
      service_job_id: JOB,
      service_job_name: "#6001 Smith",
    }),
    mv({
      qty: -1,
      created_at: "2026-10-06T10:00:00Z",
      note: short,
      location_id: "truck-1",
      created_by_name: "Joe",
    }),
    mv({ qty: -1, created_at: "2026-10-07T10:00:00Z", note: "a plain note" }),
    mv({ qty: 9, created_at: "2026-10-09T10:00:00Z", reason: "adjustment" }),
  ];

  it("every 'Short:' entry inside the week is listed, oldest first; older ones are not", () => {
    const r = build(rows());
    expect(r.shortEntries.map((s) => [s.at, s.location_name, s.qty, s.by_name])).toEqual([
      ["2026-10-06T10:00:00Z", "Truck 1", -1, "Joe"],
      ["2026-10-08T10:00:00Z", "Shop", -2, "Ann"],
    ]);
    expect(r.shortEntries[1]).toMatchObject({
      service_job_id: JOB,
      service_job_name: "#6001 Smith",
      name: "Duro-Caulk Plus · White",
      unit: "tube",
    });
    expect(r.totals.short).toBe(2);
    // The shop was already below zero when the week opened (the Sep 30 short) and its count was
    // corrected on Oct 9: it is in "Fixed" from the window's start, not in "Below zero".
    expect(r.negatives.map((n) => n.location_name)).toEqual(["Truck 1"]);
    expect(r.fixed).toHaveLength(1);
    expect(r.fixed[0]).toMatchObject({
      location_name: "Shop",
      wentBelowAt: SINCE,
      fixedAt: "2026-10-09T10:00:00Z",
      on_hand: 5,
    });
    expect(reconciliationSummary(r)).toBe(
      "1 cell below zero, 2 short entries this week, 1 fixed this week.",
    );
  });

  it("the previous week shows its own short entry and no fix; the truck's negative is still there", () => {
    const r = buildReconciliation({
      movements: rows(),
      locations: LOCATIONS,
      ...reconcileWindow("2026-09-28"),
    });
    expect(r.weekLabel).toBe("Sep 28 – Oct 4");
    expect(r.shortEntries.map((s) => s.at)).toEqual(["2026-09-30T10:00:00Z"]);
    expect(r.fixed).toEqual([]);
    expect(r.negatives.map((n) => n.location_name)).toEqual(["Truck 1"]);
  });

  it("a cell already below zero when the week opened and fixed in it is 'fixed this week' from the window's start", () => {
    const r = build([
      mv({ qty: -2, created_at: "2026-09-20T10:00:00Z" }),
      mv({ qty: 2, created_at: "2026-10-06T10:00:00Z", reason: "adjustment" }),
    ]);
    expect(r.negatives).toEqual([]);
    expect(r.fixed).toEqual([
      expect.objectContaining({ wentBelowAt: SINCE, fixedAt: "2026-10-06T10:00:00Z", on_hand: 0 }),
    ]);
  });

  it("a fix older than the week is not news", () => {
    const r = build([
      mv({ qty: -2, created_at: "2026-09-20T10:00:00Z" }),
      mv({ qty: 2, created_at: "2026-09-21T10:00:00Z", reason: "adjustment" }),
    ]);
    expect(r.fixed).toEqual([]);
    expect(r.negatives).toEqual([]);
  });

  it("totals count the week's movements; the next Monday's midnight belongs to the next week", () => {
    const r = build([
      mv({ qty: 1, created_at: "2026-09-01T10:00:00Z" }),
      mv({ qty: 1, created_at: "2026-10-06T10:00:00Z" }),
      mv({ qty: 1, created_at: UNTIL }),
    ]);
    expect(r.totals.movements).toBe(1);
  });
});

describe("reconcileAdjustment — what Set count records", () => {
  const cell = {
    location_id: "truck-1",
    screen_id: "duro_last:sealants",
    row_label: "Duro-Caulk Plus",
    price_col: "White",
    on_hand: -3,
  };
  it("one adjustment at the cell's location whose signed qty makes on hand the typed count", () => {
    expect(reconcileAdjustment(cell, 4)).toEqual({
      screen_id: "duro_last:sealants",
      row_label: "Duro-Caulk Plus",
      price_col: "White",
      location_id: "truck-1",
      qty: 7,
      reason: "adjustment",
      note: RECONCILE_NOTE,
    });
    expect(RECONCILE_NOTE).toBe("Reconciled on Inventory › Reconcile");
    // Counting 0 is a real count: it lifts the cell back to zero.
    expect(reconcileAdjustment(cell, 0)?.qty).toBe(3);
    // Decimal packs stay decimal (three places), e.g. 2.5 pails against −0.25.
    expect(reconcileAdjustment({ ...cell, on_hand: -0.25 }, 2.5)?.qty).toBe(2.75);
  });
  it("null when nothing would change or the count is not a count (the server refuses a zero qty)", () => {
    expect(reconcileAdjustment({ ...cell, on_hand: 4 }, 4)).toBeNull();
    expect(reconcileAdjustment(cell, Number.NaN)).toBeNull();
    expect(reconcileAdjustment(cell, -1)).toBeNull();
  });
});
