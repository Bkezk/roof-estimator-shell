/**
 * Inventory for year-end, the server side and the report shapes (owner, Nov 16: "as far as
 * reporting for EOY stuff, is it as efficient and good as it could be especially with the
 * reconciliation part" … "Go with all 6, also is it exportable?").
 *
 * One story runs through every test, the owner's own example, so each number can be checked by
 * hand:
 *
 *   2026  Mar 2   received 10 at $90          average $90.00   on hand 10   $900
 *         Jun 1   received 10 at $100         average $95.00   on hand 20   $1,900
 *         Sep 1   ticket A takes 5            5 × $95 = $475   on hand 15   $1,425
 *   2027  Feb 1   received 5 at $110          average $98.75   on hand 20   $1,975
 *         Mar 1   2 left over from ticket B, NO price typed: stands at the average, $98.75,
 *                 so $197.50                                   on hand 22   $2,172.50
 *         Mar 2   4 moved from the shop to the truck (no cost change): shop 18, truck 4
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  getYearEnd,
  MANAGERS_ONLY,
  readYearEnd,
  setEntryPrice,
} from "@/lib/inventory-cost.functions";
import {
  earlierIds,
  laterBanner,
  laterCount,
  laterLine,
  laterOf,
  lineKey,
  withEarlier,
} from "@/lib/inventory-count-sheet";
import {
  COUNT_BEFORE_NEEDS_PAST_DAY,
  COUNT_FUTURE,
  COUNT_NEEDS_ESTIMATE,
  countInstant,
  exportCountCsv,
  getCountSheet,
  listCounts,
  readCountSheet,
  saveCountWith,
} from "@/lib/inventory-count.functions";
import { buildInventoryExport, STOCK_FUTURE } from "@/lib/inventory-export.functions";
import {
  buildCountLines,
  buildCountRows,
  buildYearRows,
  countFileName,
  endOfDay,
  startOfDay,
  stockAsOf,
} from "@/lib/inventory-year-end";
import { addMovement, PRICE_IS_MANAGERS } from "@/lib/inventory.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Call = (a: { data: unknown; context: unknown }) => Promise<unknown>;
type Db = ReturnType<typeof fakeSupabase>["db"];

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TECH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const COUNT = "99999999-9999-4999-8999-999999999999";

const PLATES = { screen_id: "service", row_label: "Box of plates", price_col: "price" };
const TAPE = { screen_id: "service", row_label: "Seam tape", price_col: "price" };
/** A day in June 2027, office time: "today" for every test that needs one. */
const NOW = new Date("2027-06-01T16:00:00Z");

const material = (name: string, over: Row = {}): Row => ({
  id: `m-${name}`,
  name,
  unit: "each",
  sort: 1,
  active: true,
  stock_screen_id: null,
  stock_row_label: null,
  stock_price_col: null,
  category: null,
  stock_per_unit: null,
  piece_name: null,
  ...over,
});

const move = (id: number, day: string, qty: number, reason: string, over: Row = {}): Row => ({
  id,
  location_id: "shop",
  ...PLATES,
  qty,
  unit: "each",
  reason,
  bid_id: null,
  bid_name: null,
  service_job_id: null,
  service_job_name: null,
  note: null,
  created_by: MGR,
  created_by_name: "Mo",
  created_at: `${day}T15:00:00+00:00`,
  item_no: null,
  ...over,
});

const STORY: Row[] = [
  move(1, "2026-03-02", 10, "received"),
  move(2, "2026-06-01", 10, "received"),
  move(3, "2026-09-01", -5, "consumed", { service_job_id: JOB_A, service_job_name: "#6014 Bell" }),
  move(4, "2027-02-01", 5, "received"),
  move(5, "2027-03-01", 2, "leftover", {
    service_job_id: JOB_B,
    service_job_name: "#6015 Acme",
    created_by_name: "Tess",
  }),
  move(6, "2027-03-02", -4, "transfer_out"),
  move(7, "2027-03-02", 4, "transfer_in", { location_id: "truck" }),
];
const PRICES: Row[] = [
  { movement_id: 1, unit_cost: 90, source: "paid" },
  { movement_id: 2, unit_cost: 100, source: "paid" },
  { movement_id: 4, unit_cost: 110, source: "paid" },
];

function world(over: Record<string, Row[]> = {}, opts: Parameters<typeof fakeSupabase>[1] = {}) {
  return fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", access: [], full_name: "Ann", email: "ann@example.com" },
        { id: MGR, role: "manager", access: [], full_name: "Mo", email: "mo@example.com" },
        { id: EST, role: "user", access: ["estimate"], full_name: "Est", email: "e@example.com" },
        {
          id: TECH,
          role: "user",
          access: ["service"],
          technician: true,
          full_name: "Tess",
          email: "t@example.com",
        },
      ],
      inventory_locations: [
        { id: "shop", name: "Shop", kind: "shop", sort: 0, active: true },
        { id: "truck", name: "Truck 1", kind: "vehicle", sort: 1, active: true },
      ],
      pricing_catalog: [],
      catalog_item_numbers: [],
      // The price-free view names the items; the table carries the Setup cost ($50 a box).
      service_materials_catalog: [material("Box of plates"), material("Seam tape")],
      service_materials: [material("Box of plates", { cost: 50 })],
      inventory_movements: STORY.map((m) => ({ ...m })),
      inventory_movement_costs: PRICES.map((p) => ({ ...p })),
      inventory_counts: [],
      inventory_count_lines: [],
      service_job_purchase_orders: [
        {
          id: "po1",
          service_job_id: JOB_B,
          po_number: "PO-77",
          vendor_text: "Supply House",
          title: null,
          price: 640,
          po_date: "2027-02-20",
        },
      ],
      service_jobs: [],
      vehicle_drivers: [],
      ...over,
    },
    opts,
  );
}
const ctx = (db: Db, userId: string) => ({ supabase: db, userId });
const call = (fn: unknown, db: Db, userId: string, data: unknown) =>
  (fn as Call)({ data, context: ctx(db, userId) });

describe("the year summary (getYearEnd)", () => {
  it("is an admin's and a manager's", async () => {
    const env = world();
    const range = { from: "2027-01-01", to: "2027-12-31" };
    await expect(call(getYearEnd, env.db, EST, range)).rejects.toThrow(MANAGERS_ONLY);
    await expect(call(getYearEnd, env.db, TECH, range)).rejects.toThrow(MANAGERS_ONLY);
    await expect(call(getYearEnd, env.db, MGR, range)).resolves.toBeTruthy();
    await expect(call(getYearEnd, env.db, ADMIN, range)).resolves.toBeTruthy();
    expect(env.writes).toEqual([]);
  });

  it("2027: opens at 2026's close, and every line adds up to closing", async () => {
    const y = await readYearEnd(world().db, "2027-01-01", "2027-12-31");
    // 1,425 + 550 + 197.50 = 2,172.50
    expect(y.dollars).toEqual({
      opening: 1425,
      received: 550,
      fromJobs: 197.5,
      openingStock: 0,
      used: 0,
      damaged: 0,
      counted: 0,
      other: 0,
      closing: 2172.5,
      revalued: 0,
    });
    expect(y.groups).toHaveLength(1);
    const row = y.groups[0]!.rows[0]!;
    expect(y.groups[0]!.category).toBe("Service materials");
    expect(row).toMatchObject({ item: "Box of plates", colour: "", unit: "each", avg: 98.75 });
    expect(row.qty).toMatchObject({ opening: 15, received: 5, fromJobs: 2, other: 0, closing: 22 });
    expect(row.estimated).toBe(true);
    expect(row.unknown).toBe(false);
    expect(row.below_zero).toBe(false);
    expect(y.counts).toEqual({ items: 1, estimated: 1, unknown: 0, belowZero: 0, needsPrice: 1 });
  });

  it("2026 on its own: 1,900 received, 475 used, 1,425 left", async () => {
    const y = await readYearEnd(world().db, "2026-01-01", "2026-12-31");
    expect(y.dollars).toMatchObject({ opening: 0, received: 1900, used: 475, closing: 1425 });
    expect(y.counts.needsPrice).toBe(0);
    expect(y.groups[0]!.rows[0]!.estimated).toBe(false);
  });

  it("lists the entry with no price, what stands in for it, and the ticket's purchase orders", async () => {
    const y = await readYearEnd(world().db, "2027-01-01", "2027-12-31");
    expect(y.unpriced).toHaveLength(1);
    expect(y.unpriced[0]).toMatchObject({
      id: 5,
      item: "Box of plates",
      qty: 2,
      unit: "each",
      location_name: "Shop",
      reason: "Put in from a job",
      job_name: "#6015 Acme",
      by_name: "Tess",
      unit_cost: 98.75,
      source: "average",
      setup_cost: 50,
      pos: [{ po_number: "PO-77", vendor: "Supply House", price: 640, po_date: "2027-02-20" }],
    });
  });

  it("refuses a range that is not one", async () => {
    await expect(readYearEnd(world().db, "2027-12-31", "2027-01-01")).rejects.toThrow(
      "From must be on or before To",
    );
  });

  it("as a file: one row per item, units then dollars, then the totals", async () => {
    const rows = buildYearRows(await readYearEnd(world().db, "2027-01-01", "2027-12-31"));
    expect(rows[0]!.slice(0, 6)).toEqual([
      "Category",
      "Item",
      "Colour",
      "Unit",
      "Opening (qty)",
      "Received (qty)",
    ]);
    expect(rows[0]!.slice(-4)).toEqual([
      "Revalued ($)",
      "Closing ($)",
      "Average cost at close",
      "Cost note",
    ]);
    expect(rows[1]).toEqual([
      "Service materials",
      "Box of plates",
      "",
      "each",
      // opening, received, from jobs, opening stock, used, damaged, counted, other, closing
      ...["15", "5", "2", "0", "0", "0", "0", "0", "22"],
      // the same lines in dollars (closing last, after revalued)
      ...["1425.00", "550.00", "197.50", "0.00", "0.00", "0.00", "0.00", "0.00"],
      "0.00",
      "2172.50",
      "98.75",
      "Estimate: an entry has no price",
    ]);
    expect(rows[2]![0]).toBe("Total");
    expect(rows[2]!.slice(-4, -2)).toEqual(["0.00", "2172.50"]);
    expect(rows).toHaveLength(3);
  });
});

describe("typing the price paid on an entry (setEntryPrice)", () => {
  it("only an admin or a manager, and nothing is written for anyone else", async () => {
    const env = world();
    const data = { movement_id: 5, unit_cost: 80 };
    await expect(call(setEntryPrice, env.db, EST, data)).rejects.toThrow(PRICE_IS_MANAGERS);
    await expect(call(setEntryPrice, env.db, TECH, data)).rejects.toThrow(PRICE_IS_MANAGERS);
    expect(env.writes).toEqual([]);
  });

  it("$80 on the leftover: (1,975 + 160) / 22, closing $2,135, nothing left to price", async () => {
    const env = world();
    await call(setEntryPrice, env.db, MGR, { movement_id: 5, unit_cost: 80 });
    expect(
      env.tables["inventory_movement_costs"]!.find((r) => r["movement_id"] === 5),
    ).toMatchObject({ unit_cost: 80, source: "set", set_by: MGR, set_by_name: "Mo" });
    const y = await readYearEnd(env.db, "2027-01-01", "2027-12-31");
    expect(y.dollars).toMatchObject({ fromJobs: 160, closing: 2135 });
    expect(y.counts).toMatchObject({ needsPrice: 0, estimated: 0 });
    expect(y.unpriced).toEqual([]);
    expect(y.groups[0]!.rows[0]!.avg).toBeCloseTo(2135 / 22, 9);
  });

  it("typing it again replaces it, and null takes it off", async () => {
    const env = world();
    await call(setEntryPrice, env.db, ADMIN, { movement_id: 5, unit_cost: 80 });
    await call(setEntryPrice, env.db, ADMIN, { movement_id: 5, unit_cost: 70 });
    const rows = () =>
      env.tables["inventory_movement_costs"]!.filter((r) => r["movement_id"] === 5);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!["unit_cost"]).toBe(70);
    await call(setEntryPrice, env.db, ADMIN, { movement_id: 5, unit_cost: null });
    expect(rows()).toHaveLength(0);
    expect((await readYearEnd(env.db, "2027-01-01", "2027-12-31")).counts.needsPrice).toBe(1);
  });

  it("refuses an entry that took stock, a move between places, and one that is not there", async () => {
    const env = world();
    await expect(
      call(setEntryPrice, env.db, MGR, { movement_id: 3, unit_cost: 9 }),
    ).rejects.toThrow("A price paid goes on stock coming in");
    await expect(
      call(setEntryPrice, env.db, MGR, { movement_id: 7, unit_cost: 9 }),
    ).rejects.toThrow("A move between places keeps the cost the stock already had");
    await expect(
      call(setEntryPrice, env.db, MGR, { movement_id: 404, unit_cost: 9 }),
    ).rejects.toThrow("That entry was not found");
    expect(() => call(setEntryPrice, env.db, MGR, { movement_id: 5, unit_cost: -1 })).toThrow();
    expect(env.writes).toEqual([]);
  });
});

describe("a Received entry with the price paid (addMovement)", () => {
  const received = { ...PLATES, qty: 3, reason: "received", unit_cost: 12.5 };

  it("a manager's entry stores the price beside it, never on the entry everyone reads", async () => {
    const env = world();
    const r = (await call(addMovement, env.db, MGR, received)) as { id: number; qty: number };
    expect(r.qty).toBe(3);
    const entry = env.tables["inventory_movements"]!.find((m) => m["id"] === r.id)!;
    expect(entry).toMatchObject({ reason: "received", qty: 3, unit: "each", location_id: "shop" });
    expect(Object.keys(entry)).not.toContain("unit_cost");
    expect(
      env.tables["inventory_movement_costs"]!.find((c) => c["movement_id"] === r.id),
    ).toMatchObject({ unit_cost: 12.5, source: "paid", set_by: MGR });
  });

  it("an estimator records stock coming in, but not a price", async () => {
    const env = world();
    await expect(call(addMovement, env.db, EST, received)).rejects.toThrow(PRICE_IS_MANAGERS);
    expect(env.writes).toEqual([]);
    const plain = { ...PLATES, qty: 3, reason: "received" };
    await expect(call(addMovement, env.db, EST, plain)).resolves.toMatchObject({ qty: 3 });
    expect(env.writes.map((w) => w.table)).toEqual(["inventory_movements"]);
  });

  it("a technician records what was bought, as on the same form they record a leftover, never a price", async () => {
    const env = world();
    await expect(call(addMovement, env.db, TECH, received)).rejects.toThrow(PRICE_IS_MANAGERS);
    expect(env.writes).toEqual([]);
    await expect(
      call(addMovement, env.db, TECH, { ...PLATES, qty: 3, reason: "received" }),
    ).resolves.toMatchObject({ qty: 3 });
    // Counts and write-offs stay an estimator's.
    await expect(
      call(addMovement, env.db, TECH, { ...PLATES, qty: 3, reason: "adjustment" }),
    ).rejects.toThrow("Only an estimator can adjust counts or write stock off");
  });

  it("a price is refused on anything that is not stock coming in", async () => {
    const env = world();
    await expect(
      call(addMovement, env.db, MGR, { ...PLATES, qty: 1, reason: "damaged", unit_cost: 5 }),
    ).rejects.toThrow("A price paid goes on stock coming in");
    expect(env.writes).toEqual([]);
  });
});

describe("stock as of a day", () => {
  it("sums each place up to the end of that day, zero rows included", () => {
    const cells = stockAsOf(
      STORY.map((m) => ({
        ...(m as never as Parameters<typeof stockAsOf>[0][number]),
        created_at: new Date(String(m["created_at"])).toISOString(),
      })),
      endOfDay("2027-03-01"),
    );
    // Mar 1, 2027: the move to the truck (Mar 2) has not happened yet.
    expect(cells).toEqual([
      {
        location_id: "shop",
        ...PLATES,
        on_hand: 22,
        last_at: "2027-03-01T15:00:00.000Z",
        unit: "each",
      },
    ]);
  });

  it("a day is the office's: Dec 31 ends at midnight in New York, 5 am UTC", () => {
    expect(startOfDay("2026-12-31")).toBe("2026-12-31T05:00:00.000Z");
    expect(endOfDay("2026-12-31")).toBe("2027-01-01T05:00:00.000Z");
    // In summer the office is four hours behind.
    expect(endOfDay("2027-06-30")).toBe("2027-07-01T04:00:00.000Z");
    expect(() => endOfDay("Dec 31")).toThrow("Pick a date");
  });

  it("the export for Dec 31, 2026, run in June 2027: 15 on hand at $95 = $1,425", async () => {
    const r = await buildInventoryExport(
      world().db,
      { report: "stock", as_of: "2026-12-31", with_value: true },
      NOW,
    );
    expect(r.file_name).toBe("inventory-stock-2026-12-31.csv");
    const lines = r.csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "Shop,Service materials,Box of plates,,each,15,,2026-09-01 11:00 AM,,95.00,1425.00,",
    );
  });

  it("the export for today: the shop 18 and the truck 4 at $98.75, marked as an estimate", async () => {
    const r = await buildInventoryExport(world().db, { report: "stock", with_value: true }, NOW);
    expect(r.file_name).toBe("inventory-stock-2027-06-01.csv");
    const lines = r.csv.trimEnd().split("\r\n");
    // 18 × 98.75 = 1,777.50 and 4 × 98.75 = 395.00: together the 2,172.50 the year closes at.
    expect(
      lines.slice(1).map((l) => l.split(",").filter((_, i) => [0, 5, 9, 10, 11].includes(i))),
    ).toEqual([
      ["Shop", "18", "98.75", "1777.50", "Estimate: an entry has no price"],
      ["Truck 1", "4", "98.75", "395.00", "Estimate: an entry has no price"],
    ]);
  });

  it("never a day that has not happened", async () => {
    await expect(
      buildInventoryExport(
        world().db,
        { report: "stock", as_of: "2027-06-02", with_value: true },
        NOW,
      ),
    ).rejects.toThrow(STOCK_FUTURE);
  });

  it("the movements file carries each entry's cost when dollars are ticked", async () => {
    const r = await buildInventoryExport(
      world().db,
      { report: "movements", from: "2026-01-01", to: "2027-12-31", with_value: true },
      NOW,
    );
    const lines = r.csv.trimEnd().split("\r\n");
    expect(lines[0]!.endsWith(",Unit cost,Amount,Cost from")).toBe(true);
    const tail = (i: number) => lines[i]!.split(",").slice(-3);
    expect(tail(1)).toEqual(["90.00", "900.00", "Price paid"]);
    expect(tail(3)).toEqual(["95.00", "-475.00", "Average cost"]);
    expect(tail(5)).toEqual(["98.75", "197.50", "Average cost — needs a price"]);
    const plain = await buildInventoryExport(
      world().db,
      { report: "movements", from: "2026-01-01", to: "2027-12-31", with_value: false },
      NOW,
    );
    expect(plain.csv.split("\r\n")[0]).not.toContain("Unit cost");
  });

  it("the year summary is an export too", async () => {
    const r = await buildInventoryExport(
      world().db,
      { report: "year", from: "2027-01-01", to: "2027-12-31", with_value: true },
      NOW,
    );
    expect(r.file_name).toBe("inventory-year-2027-01-01-to-2027-12-31.csv");
    expect(r.count).toBe(2);
    expect(r.csv).toContain("Box of plates");
    expect(r.csv).toContain("2172.50");
  });
});

describe("the count sheet (getCountSheet)", () => {
  it("is for people with Estimate access", async () => {
    const env = world();
    await expect(call(getCountSheet, env.db, TECH, { location_id: "shop" })).rejects.toThrow(
      COUNT_NEEDS_ESTIMATE,
    );
    await expect(call(getCountSheet, env.db, EST, { location_id: "shop" })).resolves.toBeTruthy();
  });

  it("today: what the shop holds now, with the average for a manager", async () => {
    const sheet = await readCountSheet(world().db, { location_id: "shop" }, true, NOW);
    expect(sheet).toMatchObject({
      location_id: "shop",
      location_name: "Shop",
      counted_on: "2027-06-01",
      today: "2027-06-01",
      dollars: true,
    });
    expect(sheet.lines).toHaveLength(1);
    expect(sheet.lines[0]).toMatchObject({
      item: "Box of plates",
      category: "Service materials",
      unit: "each",
      expected: 18,
      avg: 98.75,
      estimated: true,
    });
  });

  it("Dec 31, 2026, typed in the next June: what the shop held that night, at that night's average", async () => {
    const sheet = await readCountSheet(
      world().db,
      { location_id: "shop", counted_on: "2026-12-31" },
      true,
      NOW,
    );
    expect(sheet.counted_on).toBe("2026-12-31");
    expect(sheet.lines[0]).toMatchObject({ expected: 15, avg: 95, estimated: false });
  });

  it("the truck's sheet lists only what the truck has held", async () => {
    const sheet = await readCountSheet(world().db, { location_id: "truck" }, true, NOW);
    expect(sheet.lines.map((l) => [l.item, l.expected])).toEqual([["Box of plates", 4]]);
    const before = await readCountSheet(
      world().db,
      { location_id: "truck", counted_on: "2026-12-31" },
      true,
      NOW,
    );
    // Nov 18 (the audit): the truck held none that night, and what was typed in since is shown
    // on the line so the office can say whether it happened on or before the count day.
    expect(before.lines.map((l) => [l.item, l.expected])).toEqual([["Box of plates", 0]]);
    expect(before.lines[0]!.later).toHaveLength(1);
  });

  it("no dollars for anyone but an admin or a manager", async () => {
    const env = world();
    const sheet = await readCountSheet(env.db, { location_id: "shop" }, false, NOW);
    expect(sheet.dollars).toBe(false);
    expect(sheet.lines[0]).toMatchObject({ expected: 18, avg: null, estimated: false });
  });

  it("never a future day, never a place that is not set up", async () => {
    await expect(
      readCountSheet(world().db, { location_id: "shop", counted_on: "2027-06-02" }, true, NOW),
    ).rejects.toThrow(COUNT_FUTURE);
    await expect(readCountSheet(world().db, { location_id: "nowhere" }, true, NOW)).rejects.toThrow(
      "That place is not set up",
    );
  });

  it("a past day looks back to one second before the next midnight, as the database does", () => {
    expect(countInstant("2026-12-31", "2027-06-01")).toBe("2027-01-01T04:59:59.000Z");
    expect(countInstant("2027-06-01", "2027-06-01")).toBeNull();
    expect(() => countInstant("2027-06-02", "2027-06-01")).toThrow(COUNT_FUTURE);
  });
});

describe("saving a count (saveCount)", () => {
  const admin = { role: "admin", access: [], technician: false };
  const estimator = { role: "user", access: ["estimate"], technician: false };
  const tech = { role: "user", access: ["service"], technician: true };
  const base = { location_id: "shop", counted_on: "2027-06-01", opening: false };
  /** The database function is the one that writes; here it answers with an id and two lines. */
  const saving = () =>
    world(
      {
        inventory_count_lines: [
          {
            id: 1,
            count_id: COUNT,
            ...PLATES,
            unit: "each",
            expected: 18,
            counted: 17,
            movement_id: 8,
          },
          {
            id: 2,
            count_id: COUNT,
            ...TAPE,
            unit: "each",
            expected: 0,
            counted: 0,
            movement_id: null,
          },
        ],
      },
      { rpcs: { inventory_save_count: () => COUNT } },
    );

  it("hands the whole sheet to one database call, each item in its own unit", async () => {
    const env = saving();
    const saved = await saveCountWith(
      env.db,
      {
        ...base,
        note: "Year-end count",
        lines: [
          { ...PLATES, counted: 17 },
          { ...TAPE, counted: 0, counted_note: null },
        ],
      },
      admin,
      NOW,
    );
    expect(saved).toEqual({ id: COUNT, lines: 2, differences: 1 });
    expect(env.rpcCalls).toEqual([
      {
        fn: "inventory_save_count",
        args: {
          p_location: "shop",
          p_counted_on: "2027-06-01",
          p_opening: false,
          p_note: "Year-end count",
          p_lines: [
            {
              ...PLATES,
              unit: "each",
              item_no: "",
              counted: "17",
              counted_note: "",
              unit_cost: "",
            },
            { ...TAPE, unit: "each", item_no: "", counted: "0", counted_note: "", unit_cost: "" },
          ],
        },
      },
    ]);
    // Nothing is written from here: the count is one transaction in the database.
    expect(env.writes).toEqual([]);
  });

  it("an opening count carries the cost a manager typed", async () => {
    const env = saving();
    await saveCountWith(
      env.db,
      { ...base, opening: true, lines: [{ ...TAPE, counted: 6, unit_cost: 12.5 }] },
      admin,
      NOW,
    );
    expect(env.rpcCalls[0]!.args).toMatchObject({
      p_opening: true,
      p_lines: [{ ...TAPE, counted: "6", unit_cost: "12.5" }],
    });
  });

  it("counting needs Estimate access, and a cost needs an admin or a manager", async () => {
    const env = saving();
    const lines = [{ ...PLATES, counted: 17 }];
    await expect(saveCountWith(env.db, { ...base, lines }, tech, NOW)).rejects.toThrow(
      COUNT_NEEDS_ESTIMATE,
    );
    await expect(
      saveCountWith(
        env.db,
        { ...base, lines: [{ ...PLATES, counted: 19, unit_cost: 3 }] },
        estimator,
        NOW,
      ),
    ).rejects.toThrow(PRICE_IS_MANAGERS);
    expect(env.rpcCalls).toEqual([]);
    await expect(saveCountWith(env.db, { ...base, lines }, estimator, NOW)).resolves.toMatchObject({
      id: COUNT,
    });
  });

  it("refuses a future day, an item listed twice and an item that is not on the catalog", async () => {
    const env = saving();
    await expect(
      saveCountWith(
        env.db,
        { ...base, counted_on: "2027-06-02", lines: [{ ...PLATES, counted: 1 }] },
        admin,
        NOW,
      ),
    ).rejects.toThrow(COUNT_FUTURE);
    await expect(
      saveCountWith(
        env.db,
        {
          ...base,
          lines: [
            { ...PLATES, counted: 1 },
            { ...PLATES, counted: 2 },
          ],
        },
        admin,
        NOW,
      ),
    ).rejects.toThrow('"Box of plates" is on the count twice');
    await expect(
      saveCountWith(
        env.db,
        {
          ...base,
          lines: [{ screen_id: "service", row_label: "Made up", price_col: "price", counted: 1 }],
        },
        admin,
        NOW,
      ),
    ).rejects.toThrow('"Made up" is not on the catalog, so it cannot be counted');
    expect(env.rpcCalls).toEqual([]);
  });

  it("an item that has left the catalog keeps the unit its entries were recorded in", async () => {
    const env = world(
      {
        service_materials_catalog: [],
        inventory_count_lines: [],
      },
      { rpcs: { inventory_save_count: () => COUNT } },
    );
    await saveCountWith(env.db, { ...base, lines: [{ ...PLATES, counted: 17 }] }, admin, NOW);
    expect(env.rpcCalls[0]!.args["p_lines"]).toEqual([
      { ...PLATES, unit: "each", item_no: "", counted: "17", counted_note: "", unit_cost: "" },
    ]);
  });

  it("says so when the database does not answer with the count", async () => {
    const env = world({}, { rpcs: { inventory_save_count: () => null } });
    await expect(
      saveCountWith(env.db, { ...base, lines: [{ ...PLATES, counted: 17 }] }, admin, NOW),
    ).rejects.toThrow("The count was not saved");
  });
});

describe("saved counts (listCounts, the count file)", () => {
  /** A count of the shop on Mar 5, 2027 found 17 of the 18 plates, and the tape as expected. */
  const counted = () =>
    world({
      inventory_movements: [
        ...STORY.map((m) => ({ ...m })),
        move(8, "2027-03-05", -1, "adjustment", { note: "Counted on Inventory", count_id: COUNT }),
      ],
      inventory_counts: [
        {
          id: COUNT,
          location_id: "shop",
          counted_on: "2027-03-05",
          opening: false,
          note: "Spring count",
          created_by_name: "Mo",
          created_at: "2027-03-05T15:00:00+00:00",
        },
      ],
      inventory_count_lines: [
        {
          id: 1,
          count_id: COUNT,
          ...PLATES,
          unit: "each",
          expected: 18,
          counted: 17,
          movement_id: 8,
        },
        {
          id: 2,
          count_id: COUNT,
          ...TAPE,
          unit: "each",
          expected: 3,
          counted: 3,
          movement_id: null,
        },
      ],
    });

  it("a manager sees what the difference was worth: one plate at $98.75", async () => {
    const list = (await call(listCounts, counted().db, MGR, undefined)) as Row[];
    expect(list).toEqual([
      {
        id: COUNT,
        location_id: "shop",
        location_name: "Shop",
        counted_on: "2027-03-05",
        opening: false,
        note: "Spring count",
        by_name: "Mo",
        created_at: "2027-03-05T15:00:00+00:00",
        dollars: true,
        lines: 2,
        differences: 1,
        value: -98.75,
      },
    ]);
  });

  it("an estimator sees the count and no dollars; a technician sees nothing", async () => {
    const list = (await call(listCounts, counted().db, EST, undefined)) as Row[];
    expect(list[0]).toMatchObject({ lines: 2, differences: 1, dollars: false, value: null });
    await expect(call(listCounts, counted().db, TECH, undefined)).rejects.toThrow(
      COUNT_NEEDS_ESTIMATE,
    );
  });

  it("the count as a file, with the dollar column only for those who see dollars", async () => {
    const mgr = (await call(exportCountCsv, counted().db, MGR, { id: COUNT })) as {
      csv: string;
      count: number;
      file_name: string;
    };
    expect(mgr.file_name).toBe("inventory-count-shop-2027-03-05.csv");
    expect(mgr.count).toBe(2);
    expect(mgr.csv.trimEnd().split("\r\n")).toEqual([
      "Place,Counted on,Category,Item,Colour,Unit,Expected,Counted,Difference,Difference ($)",
      "Shop,2027-03-05,Service materials,Box of plates,,each,18,17,-1,-98.75",
      "Shop,2027-03-05,Service materials,Seam tape,,each,3,3,0,0.00",
    ]);
    const est = (await call(exportCountCsv, counted().db, EST, { id: COUNT })) as { csv: string };
    expect(est.csv.split("\r\n")[0]).toBe(
      "Place,Counted on,Category,Item,Colour,Unit,Expected,Counted,Difference",
    );
    expect(est.csv).not.toContain("98.75");
  });

  it("a count that is not there says so", async () => {
    await expect(
      call(exportCountCsv, counted().db, MGR, { id: "88888888-8888-4888-8888-888888888888" }),
    ).rejects.toThrow("That count was not found");
  });
});

describe("the count report's shape (pure)", () => {
  const names = () => ({ item: "Plates", colour: "", category: "Fasteners" });
  it("a line with no cost known makes the total unknown, never zero", () => {
    const built = buildCountLines(
      [{ ...PLATES, unit: "each", expected: 2, counted: 5, movement_id: 1 }],
      names,
      new Map(),
    );
    expect(built).toMatchObject({ differences: 1, value: null });
    expect(built.lines[0]).toMatchObject({ diff: 3, value: null });
  });
  it("no costs given means no dollars at all", () => {
    const built = buildCountLines(
      [{ ...PLATES, unit: "each", expected: 2, counted: 2, movement_id: null }],
      names,
      null,
    );
    expect(built).toMatchObject({ differences: 0, value: null });
    expect(built.lines[0]!.value).toBeNull();
  });
  it("names the file after the place and the day", () => {
    expect(
      countFileName({ location_name: "Service vehicle - N2X384", counted_on: "2026-12-31" }),
    ).toBe("inventory-count-service-vehicle-n2x384-2026-12-31.csv");
    expect(countFileName({ location_name: "···", counted_on: "2026-12-31" })).toBe(
      "inventory-count-place-2026-12-31.csv",
    );
    expect(
      buildCountRows({
        id: COUNT,
        location_id: "shop",
        location_name: "Shop",
        counted_on: "2026-12-31",
        opening: false,
        note: null,
        by_name: null,
        created_at: "",
        lines: [],
        differences: 0,
        value: null,
        dollars: false,
      }),
    ).toEqual([
      [
        "Place",
        "Counted on",
        "Category",
        "Item",
        "Colour",
        "Unit",
        "Expected",
        "Counted",
        "Difference",
      ],
    ]);
  });
});

// ── Nov 18 (the audit; owner: "fix please") ──────────────────────────────────────────────────
// A count dated to an earlier day was compared with what inventory held that night. Something
// typed in since that really happened before the count (a use logged late) was then taken off
// twice: by the count, which saw the shelf without it, and by the late entry. The past day's
// sheet now lists what was typed in since, and a ticked entry is moved into the count day.
describe("a count dated to an earlier day: the entries typed in since", () => {
  const admin = { role: "admin", access: [], technician: false };
  const past = { location_id: "shop", counted_on: "2026-12-31", opening: false };

  it("the past day's sheet lists them under their item, oldest first; today's sheet has none", async () => {
    const sheet = await readCountSheet(world().db, past, true, NOW);
    expect(sheet.lines).toHaveLength(1);
    expect(sheet.lines[0]!.expected).toBe(15);
    expect(laterOf(sheet.lines[0]!)).toEqual([
      { id: 4, at: "2027-02-01T15:00:00.000Z", qty: 5, what: "Received", who: "Mo", job: null },
      {
        id: 5,
        at: "2027-03-01T15:00:00.000Z",
        qty: 2,
        what: "Put in inventory",
        who: "Tess",
        job: "#6015 Acme",
      },
      { id: 6, at: "2027-03-02T15:00:00.000Z", qty: -4, what: "Moved out", who: "Mo", job: null },
    ]);
    expect(laterCount(sheet.lines)).toBe(3);
    const today = await readCountSheet(world().db, { location_id: "shop" }, true, NOW);
    expect(laterCount(today.lines)).toBe(0);
  });
  it("a count's own correction is never offered as a late entry", async () => {
    const env = world({
      inventory_movements: [...STORY, move(8, "2027-01-05", -1, "adjustment", { count_id: COUNT })],
    });
    const sheet = await readCountSheet(env.db, past, true, NOW);
    expect(laterOf(sheet.lines[0]!).map((e) => e.id)).toEqual([4, 5, 6]);
  });
  it("a ticked entry counts as before the count: Expected takes it in, so the difference is the true one", () => {
    const line = {
      ...PLATES,
      expected: 10,
      later: [
        {
          id: 21,
          at: "2027-01-03T15:00:00.000Z",
          qty: -2,
          what: "Used on job",
          who: "T",
          job: null,
        },
        { id: 22, at: "2027-01-04T15:00:00.000Z", qty: 5, what: "Received", who: "M", job: null },
      ],
    };
    // Nothing ticked: as the sheet came.
    expect(withEarlier(line, new Set())).toBe(line);
    // The late "2 used" was before the count: 8 expected, so a count of 8 is no difference
    // (it was a difference of -2 on top of the late entry's own -2).
    expect(withEarlier(line, new Set([21])).expected).toBe(8);
    expect(withEarlier(line, new Set([21, 22])).expected).toBe(13);
    // An id of another line changes nothing.
    expect(withEarlier(line, new Set([99]))).toBe(line);
    // No float dust.
    expect(
      withEarlier({ expected: 0.1, later: [{ ...line.later[0]!, qty: 0.2 }] }, new Set([21])),
    ).toMatchObject({ expected: 0.3 });
  });
  it("only the ticked entries of the lines that are counted are sent", () => {
    const a = { ...PLATES, unit: "each", expected: 10, later: [{ id: 21 }, { id: 22 }] };
    const b = { ...TAPE, unit: "each", expected: 3, later: [{ id: 31 }] };
    const lines = [a, b] as unknown as Parameters<typeof earlierIds>[0];
    const opts = { opening: false, dollars: false };
    const typed = { [lineKey(PLATES)]: { packs: "8", pieces: "", cost: "" } };
    // Seam tape was left blank (not counted): its ticked entry is not moved.
    expect(earlierIds(lines, typed, opts, new Set([21, 31]))).toEqual([21]);
    expect(earlierIds(lines, typed, opts, new Set())).toEqual([]);
    expect(earlierIds(lines, {}, opts, new Set([21, 22, 31]))).toEqual([]);
  });
  it("the words above the sheet and on each entry", () => {
    expect(laterBanner(0, "2026-12-31")).toBeNull();
    expect(laterBanner(1, "2026-12-31")).toBe(
      "1 entry was typed in after Dec 31, 2026 for items on this sheet. It is shown under its item. Tick it if it happened on or before Dec 31, 2026, so the count does not take it off twice. Leave it unticked if it happened after.",
    );
    expect(laterBanner(3, "2026-12-31")).toBe(
      "3 entries were typed in after Dec 31, 2026 for items on this sheet. They are shown under their item. Tick each one that happened on or before Dec 31, 2026, so the count does not take it off twice. Leave it unticked if it happened after.",
    );
    expect(
      laterLine(
        {
          id: 1,
          at: "2027-01-03T15:00:00.000Z",
          qty: -2,
          what: "Used on job",
          who: "Tess",
          job: "#6015 Acme",
        },
        "each",
      ),
    ).toBe("Jan 3 · Tess · −2 each · Used on job · #6015 Acme");
    expect(
      laterLine(
        { id: 2, at: "2027-02-01T15:00:00.000Z", qty: 5, what: "Received", who: null, job: null },
        "box",
      ),
    ).toBe("Feb 1 · +5 boxes · Received");
  });
  it("the save hands the ticked entries to the database, each once; none on today's count", async () => {
    const env = world({}, { rpcs: { inventory_save_count: () => COUNT } });
    await saveCountWith(
      env.db,
      { ...past, lines: [{ ...PLATES, counted: 13 }], before_ids: [6, 6, 5] },
      admin,
      NOW,
    );
    expect(env.rpcCalls[0]!.args).toMatchObject({
      p_counted_on: "2026-12-31",
      p_before: [6, 5],
    });
    // Nothing ticked: the call is the one it always was (no p_before at all).
    const plain = world({}, { rpcs: { inventory_save_count: () => COUNT } });
    await saveCountWith(plain.db, { ...past, lines: [{ ...PLATES, counted: 15 }] }, admin, NOW);
    expect(Object.keys(plain.rpcCalls[0]!.args)).not.toContain("p_before");
    // Today's count takes everything typed so far already.
    const today = world({}, { rpcs: { inventory_save_count: () => COUNT } });
    await expect(
      saveCountWith(
        today.db,
        {
          location_id: "shop",
          counted_on: "2027-06-01",
          opening: false,
          lines: [{ ...PLATES, counted: 18 }],
          before_ids: [6],
        },
        admin,
        NOW,
      ),
    ).rejects.toThrow(COUNT_BEFORE_NEEDS_PAST_DAY);
    expect(today.rpcCalls).toEqual([]);
  });
  it("the database moves a ticked entry into the count day, and only an entry it should", () => {
    const sql = readFileSync(
      "supabase/migrations/20261118190000_count_takes_entries_typed_since.sql",
      "utf8",
    );
    const flat = sql.replace(/\s+/g, " ");
    // The ledger has no update rule for people: the move is the database's own, and only
    // while a count is being saved.
    expect(flat).toContain("create or replace function public.inventory_move_into_count(");
    expect(flat).toContain("current_setting('jbk.count_save', true)");
    expect(flat).toContain("raise exception 'Only saving a count moves an entry'");
    expect(flat).toContain(
      "revoke all on function public.inventory_move_into_count(bigint[], timestamptz, date) from public, anon;",
    );
    // Each entry is checked: this place, typed after the count day, not a count's own line.
    expect(flat).toContain("p_before bigint[] default null");
    expect(flat).toMatch(/m\.location_id (=|is distinct from) p_location/);
    expect(flat).toMatch(/m\.created_at (>|<=) v_at/);
    expect(flat).toContain("count_id is null");
    // The old five-argument form goes, so one name has one meaning.
    expect(flat).toContain(
      "drop function if exists public.inventory_save_count(text, date, boolean, text, jsonb)",
    );
    // The entry keeps a note of when it was really typed.
    expect(flat).toContain("Typed in ");
  });
  it("the screen: the banner, each entry with its tick box, and the ticked ids in the save", () => {
    const tab = readFileSync("src/components/inventory-count-tab.tsx", "utf8");
    expect(tab).toContain("data-count-later-banner");
    expect(tab).toContain("data-count-later-tick={e.id}");
    expect(tab).toContain("withEarlier(l, before)");
    expect(tab).toContain("before_ids: earlierIds(allLines, typed, { opening, dollars }, before)");
    // Clearing the sheet clears the ticks.
    expect(tab).toMatch(/const clearSheet = \(\) => \{[\s\S]*?setBefore\(new Set\(\)\);\s*\};/);
  });
});
