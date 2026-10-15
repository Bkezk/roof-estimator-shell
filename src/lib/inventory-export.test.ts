/**
 * Inventory › Export (owner, Oct 15: "include the value in dollars for managers and admins only,
 * same for export. no on reorders, do the from and too picker, zero rows included yes"): the three
 * CSV reports' pure builders (inventory-export.ts), the server function's gate and reads through
 * the fake database (inventory-export.functions.ts), and the pins on the page and dialog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  buildMovementRows,
  buildStockRows,
  buildUsageRows,
  EXPORT_REPORT_INFO,
  EXPORT_REPORTS,
  exportFileName,
  exportRangeValid,
  exportWindow,
  fmtExportQty,
  inWindow,
  itemColumns,
  packCostOf,
  type ExportJob,
  type ExportMovement,
  type ExportStockRow,
} from "@/lib/inventory-export";
import {
  buildInventoryExport,
  exportInventoryCsv,
  FORBIDDEN,
} from "@/lib/inventory-export.functions";
import { movementLabel, readStock } from "@/lib/inventory.functions";
import { toCsv } from "@/lib/review-export";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const BID = "33333333-3333-4333-8333-333333333333";
const ACC = "44444444-4444-4444-8444-444444444444";
const SITE = "55555555-5555-4555-8555-555555555555";

// Locations given out of order on purpose: the report sorts by inventory_locations.sort.
const LOCATIONS = [
  { id: "truck-1", name: "Truck 1", sort: 2 },
  { id: "shop", name: "Shop", sort: 0 },
  { id: "truck-2", name: "Truck 2", sort: 1 },
];
const FASTENERS = {
  screen_id: "duro_last:fasteners_and_bits",
  row_label: "Plates, 2in",
  price_col: "Price/Box",
};
const CAULK = { screen_id: "duro_last:sealants", row_label: "Duro-Caulk Plus", price_col: "White" };
const ISO = { screen_id: "service", row_label: "ISO board", price_col: "price" };
const BOX = { name: "fastener", perPack: 1000 };
/** Costs per piece, as CenterPoint lists them: only the fasteners are priced. */
const costFor = (c: { screen_id: string; row_label: string; price_col: string }) =>
  c.screen_id === FASTENERS.screen_id && c.row_label === FASTENERS.row_label ? 0.091 : null;

const stockRow = (over: Partial<ExportStockRow> & { location_id: string }): ExportStockRow => ({
  category: "Fasteners",
  unit: "box",
  on_hand: 0,
  last_at: "2026-10-07T14:00:00Z",
  item_nos: [],
  piece: BOX,
  label: null,
  ...FASTENERS,
  ...over,
});

let nextId = 1;
const mv = (
  over: Partial<ExportMovement> & { qty: number; created_at: string },
): ExportMovement => ({
  id: nextId++,
  location_id: "shop",
  category: "Fasteners",
  unit: "box",
  reason: over.qty < 0 ? "consumed" : "leftover",
  service_job_id: null,
  service_job_name: null,
  bid_id: null,
  bid_name: null,
  note: null,
  created_by_name: "Ann",
  label: null,
  ...FASTENERS,
  ...over,
});

// October 2026, office time (EDT): Oct 1 00:00 → Nov 1 00:00 Eastern.
const OCT = exportWindow("2026-10-01", "2026-10-31");

describe("the From..To window (office time, inclusive, DST-safe)", () => {
  it("From 00:00 Eastern up to the midnight after To", () => {
    expect(OCT).toEqual({ since: "2026-10-01T04:00:00.000Z", until: "2026-11-01T04:00:00.000Z" });
    // One day in standard time is UTC−5 at both ends.
    expect(exportWindow("2026-12-16", "2026-12-16")).toEqual({
      since: "2026-12-16T05:00:00.000Z",
      until: "2026-12-17T05:00:00.000Z",
    });
  });
  it("the day the clocks fall back (Nov 1, 2026) opens in EDT and closes in EST: 25 hours", () => {
    const w = exportWindow("2026-11-01", "2026-11-01");
    expect(w).toEqual({ since: "2026-11-01T04:00:00.000Z", until: "2026-11-02T05:00:00.000Z" });
    expect(Date.parse(w.until) - Date.parse(w.since)).toBe(25 * 3600 * 1000);
    // 11:30 pm EST on Nov 1 is in; 12:30 am on Nov 2 is out.
    expect(inWindow("2026-11-02T04:30:00Z", w)).toBe(true);
    expect(inWindow("2026-11-02T05:30:00Z", w)).toBe(false);
  });
  it("23:30 Eastern on the To day is in, 00:30 the next day is out", () => {
    expect(inWindow("2026-11-01T03:30:00Z", OCT)).toBe(true); // Oct 31, 11:30 pm EDT
    expect(inWindow("2026-11-01T04:30:00Z", OCT)).toBe(false); // Nov 1, 12:30 am EDT
    expect(inWindow("2026-10-01T04:00:00Z", OCT)).toBe(true); // the first instant
    expect(inWindow("2026-10-01T03:59:59Z", OCT)).toBe(false); // Sep 30, 11:59:59 pm
  });
  it("refuses a missing or malformed day and From after To", () => {
    expect(() => exportWindow("", "2026-10-31")).toThrow("Pick a from and to date");
    expect(() => exportWindow("2026-10-01", "Oct 31")).toThrow("Pick a from and to date");
    expect(() => exportWindow("2026-10-31", "2026-10-01")).toThrow("From must be on or before To");
  });
});

describe("report 1 · Stock on hand", () => {
  const stock: ExportStockRow[] = [
    // Truck 1 is below zero; the shop has a zero row (a cell that has moved and is empty now).
    stockRow({ location_id: "truck-1", on_hand: -2, item_nos: ["1106"] }),
    stockRow({ location_id: "shop", on_hand: 3, item_nos: ["1106", "1107"] }),
    stockRow({
      location_id: "shop",
      ...CAULK,
      category: "Sealants",
      unit: "tube",
      on_hand: 0,
      piece: null,
      last_at: "2026-10-02T18:05:00Z",
    }),
    stockRow({
      location_id: "truck-2",
      ...ISO,
      category: "Underlayment",
      unit: "sq ft",
      on_hand: 64.5,
      piece: null,
      label: 'ISO Board 2"',
    }),
  ];
  it("one row per item per location, every location in sort order, zero and negative rows included", () => {
    const rows = buildStockRows({ stock, locations: LOCATIONS, withValue: false });
    expect(rows[0]).toEqual([
      "Location",
      "Category",
      "Item",
      "Colour",
      "Unit",
      "On hand",
      "Pieces per pack",
      "Last movement",
      "Item numbers",
    ]);
    expect(rows.slice(1).map((r) => [r[0], r[2], r[5]])).toEqual([
      ["Shop", "Plates, 2in", "3"],
      ["Shop", "Duro-Caulk Plus", "0"],
      ["Truck 2", 'ISO Board 2"', "64.5"],
      ["Truck 1", "Plates, 2in", "-2"],
    ]);
    // Colour is blank for a price column; the service name is the item; pieces per pack only
    // when the catalog knows the pack; item numbers space-separated; last movement office time.
    expect(rows[1]).toEqual([
      "Shop",
      "Fasteners",
      "Plates, 2in",
      "",
      "box",
      "3",
      "1000",
      "2026-10-07 10:00 AM",
      "1106 1107",
    ]);
    expect(rows[2]!.slice(3, 7)).toEqual(["White", "tube", "0", ""]);
    // No internal id anywhere.
    expect(rows.flat().join("\n")).not.toMatch(/duro_last:|service\b|[0-9a-f]{8}-[0-9a-f]{4}/);
  });
  it("value in dollars: pack cost = piece cost × pieces per pack; blank, never 0, with no cost", () => {
    const rows = buildStockRows({ stock, locations: LOCATIONS, costFor, withValue: true });
    expect(rows[0]!.slice(-2)).toEqual(["Unit cost", "Value"]);
    // A box of 1,000 at $0.091 is $91 a box; 3 boxes are $273; −2 boxes are −$182.
    expect(rows[1]!.slice(-2)).toEqual(["91.00", "273.00"]);
    expect(rows[4]!.slice(-2)).toEqual(["91.00", "-182.00"]);
    expect(rows[2]!.slice(-2)).toEqual(["", ""]);
    expect(rows[3]!.slice(-2)).toEqual(["", ""]);
    expect(packCostOf(costFor, FASTENERS, BOX)).toBe(91);
    expect(packCostOf(costFor, FASTENERS, null)).toBe(0.091);
    expect(packCostOf(costFor, CAULK, null)).toBeNull();
    expect(packCostOf(null, FASTENERS, BOX)).toBeNull();
  });
  it("a location missing from the list (never happens: every location is read) sorts last under its id", () => {
    const rows = buildStockRows({
      stock: [stockRow({ location_id: "gone" }), stockRow({ location_id: "shop" })],
      locations: LOCATIONS,
      withValue: false,
    });
    expect(rows.slice(1).map((r) => r[0])).toEqual(["Shop", "gone"]);
  });
});

describe("report 2 · Movements", () => {
  const moves: ExportMovement[] = [
    mv({
      qty: -2,
      created_at: "2026-10-07T14:00:00Z",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
    }),
    mv({
      qty: 1,
      created_at: "2026-10-07T15:00:00Z",
      reason: "released",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
    }),
    mv({ qty: -1, created_at: "2026-10-06T12:00:00Z", bid_id: BID, bid_name: "Acme Roof 2026" }),
    mv({
      qty: 5,
      created_at: "2026-10-05T12:00:00Z",
      reason: "leftover",
      bid_id: BID,
      bid_name: "Acme Roof 2026",
      note: "Left over from Acme",
    }),
    mv({
      qty: -3,
      created_at: "2026-10-09T12:00:00Z",
      reason: "adjustment",
      note: "Counted on Inventory",
      created_by_name: null,
    }),
    mv({
      qty: 1,
      created_at: "2026-10-08T12:00:00Z",
      reason: "transfer_in",
      location_id: "truck-1",
      ...CAULK,
      category: "Sealants",
      unit: "tube",
    }),
    // Edges: 11:30 pm EDT on Oct 31 is in; 12:30 am on Nov 1 and Sep 30 are out.
    mv({ qty: 1, created_at: "2026-11-01T03:30:00Z", note: "last of October" }),
    mv({ qty: 1, created_at: "2026-11-01T04:30:00Z", note: "November" }),
    mv({ qty: 1, created_at: "2026-10-01T03:59:00Z", note: "September" }),
  ];
  const rows = buildMovementRows({ movements: moves, locations: LOCATIONS, ...OCT });
  it("one row per entry in the window, oldest first, office date and time", () => {
    expect(rows[0]).toEqual([
      "Date",
      "Time",
      "Location",
      "Category",
      "Item",
      "Colour",
      "Change",
      "Unit",
      "What happened",
      "Ticket or bid",
      "Who",
      "Note",
    ]);
    expect(rows.slice(1).map((r) => `${r[0]} ${r[1]}`)).toEqual([
      "2026-10-05 8:00 AM",
      "2026-10-06 8:00 AM",
      "2026-10-07 10:00 AM",
      "2026-10-07 11:00 AM",
      "2026-10-08 8:00 AM",
      "2026-10-09 8:00 AM",
      "2026-10-31 11:30 PM",
    ]);
    const notes = rows.slice(1).map((r) => r[11]);
    expect(notes).toContain("last of October");
    expect(notes).not.toContain("November");
    expect(notes).not.toContain("September");
  });
  it("'What happened' is movementLabel's words — the History tab's — and 'Ticket or bid' names the ticket, else the bid", () => {
    const what = rows.slice(1).map((r) => [r[8], r[9]]);
    expect(what).toEqual([
      ["Put in inventory", "Acme Roof 2026"],
      ["Used on bid", "Acme Roof 2026"],
      ["Used on ticket", "#6014 Bell County"],
      ["Put back from ticket", "#6014 Bell County"],
      ["Moved in", ""],
      ["Count adjustment", ""],
      ["Put in inventory", ""],
    ]);
    expect(movementLabel({ reason: "released", service_job_id: JOB_A })).toBe(
      "Put back from ticket",
    );
    expect(movementLabel({ reason: "released", bid_id: BID })).toBe("Released from bid");
  });
  it("Change keeps the ledger's sign; Who is blank for nobody; the location is its name", () => {
    expect(rows[3]!.slice(2, 8)).toEqual(["Shop", "Fasteners", "Plates, 2in", "", "-2", "box"]);
    expect(rows[5]!.slice(2, 6)).toEqual(["Truck 1", "Sealants", "Duro-Caulk Plus", "White"]);
    expect(rows[6]![10]).toBe("");
    expect(rows[6]![11]).toBe("Counted on Inventory");
    expect(rows.flat().join("\n")).not.toContain(JOB_A);
    expect(rows.flat().join("\n")).not.toContain(BID);
  });
});

describe("report 3 · Usage by ticket", () => {
  const jobs = new Map<string, ExportJob>([
    [
      JOB_A,
      { id: JOB_A, number: 6014, customer: "Bell County Schools", site: "Gym", day: "2026-10-07" },
    ],
    [JOB_B, { id: JOB_B, number: 6015, customer: "Acme", site: "Plant 2", day: "2026-10-08" }],
  ]);
  const moves: ExportMovement[] = [
    // Ticket A took 3 boxes and put 1 back: net 2.
    mv({
      qty: -3,
      created_at: "2026-10-07T14:00:00Z",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
    }),
    mv({
      qty: 1,
      created_at: "2026-10-07T15:00:00Z",
      reason: "released",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
    }),
    // Ticket A took 2 tubes and put both back: nets to zero, dropped.
    mv({
      qty: -2,
      created_at: "2026-10-07T14:10:00Z",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
      ...CAULK,
      category: "Sealants",
      unit: "tube",
    }),
    mv({
      qty: 2,
      created_at: "2026-10-07T16:00:00Z",
      reason: "released",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
      ...CAULK,
      category: "Sealants",
      unit: "tube",
    }),
    // Ticket B, half a box, with no stored name: the ticket number from the join.
    mv({ qty: -0.5, created_at: "2026-10-08T14:00:00Z", service_job_id: JOB_B }),
    // Not usage: a bid's take, a put-in, and a ticket take outside the range.
    mv({ qty: -1, created_at: "2026-10-06T12:00:00Z", bid_id: BID, bid_name: "Acme Roof 2026" }),
    mv({ qty: 4, created_at: "2026-10-06T12:00:00Z", reason: "leftover" }),
    mv({
      qty: -9,
      created_at: "2026-09-30T12:00:00Z",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
    }),
  ];
  const pieceFor = (c: { screen_id: string }) => (c.screen_id === FASTENERS.screen_id ? BOX : null);
  it("nets consumed minus released per ticket + item, drops zero, groups by ticket then item", () => {
    const rows = buildUsageRows({ movements: moves, ...OCT, jobs, pieceFor, withValue: false });
    expect(rows).toEqual([
      ["Ticket", "Customer", "Site", "Ticket date", "Item", "Colour", "Quantity", "Unit"],
      [
        "#6014 Bell County",
        "Bell County Schools",
        "Gym",
        "2026-10-07",
        "Plates, 2in",
        "",
        "2",
        "box",
      ],
      ["#6015", "Acme", "Plant 2", "2026-10-08", "Plates, 2in", "", "0.5", "box"],
    ]);
  });
  it("with value: unit cost is the pack cost, cost = quantity × that; blank without a cost", () => {
    const rows = buildUsageRows({
      movements: moves,
      ...OCT,
      jobs,
      pieceFor,
      costFor,
      withValue: true,
    });
    expect(rows[0]!.slice(-2)).toEqual(["Unit cost", "Cost"]);
    expect(rows[1]!.slice(-2)).toEqual(["91.00", "182.00"]);
    expect(rows[2]!.slice(-2)).toEqual(["91.00", "45.50"]);
    const noCost = buildUsageRows({
      movements: moves,
      ...OCT,
      jobs,
      pieceFor,
      costFor: null,
      withValue: true,
    });
    expect(noCost[1]!.slice(-2)).toEqual(["", ""]);
  });
  it("a ticket the join does not know keeps its stored name with blank customer, site and date", () => {
    const rows = buildUsageRows({
      movements: [
        mv({
          qty: -1,
          created_at: "2026-10-07T14:00:00Z",
          service_job_id: JOB_B,
          service_job_name: "#6015 Acme",
        }),
      ],
      ...OCT,
      jobs: new Map(),
      pieceFor,
      withValue: false,
    });
    expect(rows[1]).toEqual(["#6015 Acme", "", "", "", "Plates, 2in", "", "1", "box"]);
  });
});

describe("CSV, names, file names", () => {
  it("an item with a comma is quoted (review-export.ts toCsv), CRLF line ends", () => {
    const csv = toCsv(
      buildStockRows({
        stock: [stockRow({ location_id: "shop", on_hand: 3 })],
        locations: LOCATIONS,
        withValue: false,
      }),
    );
    expect(csv).toContain('Shop,Fasteners,"Plates, 2in",,box,3,1000,');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("Item = service name else the row; Colour = the price column unless it is only a price", () => {
    expect(itemColumns({ label: null, row_label: "Membrane", price_col: "White" })).toEqual({
      item: "Membrane",
      colour: "White",
    });
    expect(
      itemColumns({ label: "Duro-Caulk White", row_label: "Duro-Caulk Plus", price_col: "White" }),
    ).toEqual({ item: "Duro-Caulk White", colour: "White" });
    expect(itemColumns({ row_label: "Plates", price_col: "Price/Box" })).toEqual({
      item: "Plates",
      colour: "",
    });
    expect(itemColumns({ row_label: "Acetone", price_col: "price" })).toEqual({
      item: "Acetone",
      colour: "",
    });
  });
  it("quantities as the ledger stores them: three decimals at most, no trailing zeros", () => {
    expect(fmtExportQty(3)).toBe("3");
    expect(fmtExportQty(-2.5)).toBe("-2.5");
    expect(fmtExportQty(0.1 + 0.2)).toBe("0.3");
    expect(fmtExportQty(1.23456)).toBe("1.235");
    expect(fmtExportQty(0)).toBe("0");
  });
  it("file names", () => {
    const now = new Date("2026-10-15T23:30:00Z"); // 7:30 pm Eastern, still Oct 15
    expect(exportFileName("stock", undefined, undefined, now)).toBe(
      "inventory-stock-2026-10-15.csv",
    );
    expect(exportFileName("movements", "2026-10-01", "2026-10-31", now)).toBe(
      "inventory-movements-2026-10-01-to-2026-10-31.csv",
    );
    expect(exportFileName("usage", "2026-10-01", "2026-10-31", now)).toBe(
      "inventory-usage-2026-10-01-to-2026-10-31.csv",
    );
  });
  it("the dialog's rule: dated reports need From ≤ To; the stock report needs no range", () => {
    expect(EXPORT_REPORTS).toEqual(["stock", "movements", "usage"]);
    expect(EXPORT_REPORT_INFO.stock.dated).toBe(false);
    expect(exportRangeValid("stock", "", "")).toBe(true);
    expect(exportRangeValid("movements", "", "2026-10-31")).toBe(false);
    expect(exportRangeValid("movements", "2026-10-31", "2026-10-01")).toBe(false);
    expect(exportRangeValid("usage", "2026-10-01", "2026-10-31")).toBe(true);
    // Plain words: "inventory", never "the app".
    for (const r of EXPORT_REPORTS) {
      expect(EXPORT_REPORT_INFO[r].blurb).not.toMatch(/the app/i);
      expect(EXPORT_REPORT_INFO[r].title.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Call = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const call = (env: ReturnType<typeof fakeSupabase>, userId: string, data: unknown) =>
  (exportInventoryCsv as unknown as Call)({ data, context: { supabase: env.db, userId } });

const dbMove = (id: number, over: Row): Row => ({
  id,
  location_id: "shop",
  ...FASTENERS,
  qty: -1,
  unit: "box",
  reason: "consumed",
  bid_id: null,
  bid_name: null,
  service_job_id: null,
  service_job_name: null,
  note: null,
  created_by_name: "Joe",
  created_at: "2026-10-07T14:00:00Z",
  item_no: null,
  ...over,
});

function world(movements: Row[], opts: { maxRows?: number } = {}) {
  return fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", access: [], full_name: "Ann", email: "ann@example.com" },
        { id: MGR, role: "manager", access: [], full_name: "Mo", email: "mo@example.com" },
        {
          id: USER,
          role: "user",
          access: ["estimate", "inventory"],
          full_name: "Est",
          email: "e@x.com",
        },
      ],
      inventory_locations: [
        { id: "shop", name: "Shop", kind: "shop", sort: 0, active: true },
        { id: "truck-1", name: "Truck 1", kind: "vehicle", sort: 1, active: false },
      ],
      inventory_movements: movements,
      pricing_catalog: [
        { id: FASTENERS.screen_id, branch: "duro_last", category: "Fasteners", data: {} },
      ],
      catalog_item_numbers: [{ ...FASTENERS, item_no: "1106" }],
      // The price-free view names the cells; the table carries the cost (office reads only).
      service_materials_catalog: [
        {
          id: "m1",
          name: "Plates 2in (box of 1000)",
          unit: "each",
          sort: 1,
          active: true,
          stock_screen_id: FASTENERS.screen_id,
          stock_row_label: FASTENERS.row_label,
          stock_price_col: FASTENERS.price_col,
          category: null,
          stock_per_unit: null,
          piece_name: null,
        },
      ],
      service_materials: [
        {
          id: "m1",
          name: "Plates 2in (box of 1000)",
          unit: "each",
          sort: 1,
          active: true,
          cost: 0.091,
          stock_screen_id: FASTENERS.screen_id,
          stock_row_label: FASTENERS.row_label,
          stock_price_col: FASTENERS.price_col,
          category: null,
          stock_per_unit: null,
          piece_name: null,
        },
      ],
      service_jobs: [
        {
          id: JOB_A,
          number: 6014,
          customer_name: "Bell County (as typed)",
          site_name: null,
          account_id: ACC,
          site_id: SITE,
          scheduled_date: "2026-10-07",
          created_at: "2026-10-01T12:00:00Z",
        },
        {
          id: JOB_B,
          number: 6015,
          customer_name: "Walk-in",
          site_name: "Their roof",
          account_id: null,
          site_id: null,
          scheduled_date: null,
          created_at: "2026-10-08T23:30:00Z",
        },
      ],
      crm_accounts: [{ id: ACC, name: "Bell County Schools" }],
      crm_sites: [{ id: SITE, name: "Bell County Gym" }],
    },
    opts,
  );
}

describe("exportInventoryCsv (the fake database)", () => {
  const ledger = [
    dbMove(1, { qty: 5, reason: "leftover", created_at: "2026-10-01T12:00:00Z" }),
    dbMove(2, {
      qty: -3,
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
      created_at: "2026-10-07T14:00:00Z",
    }),
    dbMove(3, {
      qty: 1,
      reason: "released",
      service_job_id: JOB_A,
      service_job_name: "#6014 Bell County",
      created_at: "2026-10-07T15:00:00Z",
    }),
    dbMove(4, { qty: -0.5, service_job_id: JOB_B, created_at: "2026-10-09T03:30:00Z" }),
    dbMove(5, {
      qty: -2.5,
      location_id: "truck-1",
      created_at: "2026-10-09T12:00:00Z",
      note: "Short: inventory had 0 box on Truck 1; count needs fixing",
    }),
  ];
  it("admins and managers only: an estimator with Inventory access is refused with a plain message", async () => {
    await expect(call(world(ledger), USER, { report: "stock", with_value: false })).rejects.toThrow(
      FORBIDDEN,
    );
    expect(FORBIDDEN).toBe("Admins and managers only");
    await expect(
      call(world(ledger), MGR, { report: "stock", with_value: false }),
    ).resolves.toBeTruthy();
  });
  it("the input is checked: an unknown report or a malformed day is refused before anything is read", () => {
    expect(() => call(world(ledger), ADMIN, { report: "reorders", with_value: false })).toThrow();
    expect(() =>
      call(world(ledger), ADMIN, {
        report: "movements",
        from: "Oct 1",
        to: "2026-10-31",
        with_value: false,
      }),
    ).toThrow();
  });
  it("stock: the page's readStock rows, every location, with the service name, cost and value", async () => {
    const r = (await call(world(ledger), ADMIN, { report: "stock", with_value: true })) as {
      csv: string;
      count: number;
      file_name: string;
    };
    expect(r.count).toBe(2);
    expect(r.file_name).toMatch(/^inventory-stock-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = r.csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Location,Category,Item,Colour,Unit,On hand,Pieces per pack,Last movement,Item numbers,Unit cost,Value",
    );
    // 5 − 3 + 1 − 0.5 = 2.5 at the shop; −2.5 on the truck. No pack is known (the catalog screen
    // data is empty here), so the unit cost is the piece cost itself.
    expect(lines[1]).toBe(
      "Shop,Fasteners,Plates 2in (box of 1000),,box,2.5,,2026-10-08 11:30 PM,1106,0.09,0.23",
    );
    expect(lines[2]).toBe(
      "Truck 1,Fasteners,Plates 2in (box of 1000),,box,-2.5,,2026-10-09 8:00 AM,1106,0.09,-0.23",
    );
    const plain = (await call(world(ledger), ADMIN, { report: "stock", with_value: false })) as {
      csv: string;
    };
    expect(plain.csv.split("\r\n")[0]).not.toContain("Unit cost");
  });
  it("stock reads the ledger whole past PostgREST's 1,000-row page (readStock)", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 1005; i++)
      rows.push(
        dbMove(i + 1, {
          qty: i < 1000 ? 1 : -201,
          reason: i < 1000 ? "leftover" : "adjustment",
          created_at: new Date(1700000000000 + i * 1000).toISOString(),
        }),
      );
    const env = world(rows, { maxRows: 1000 });
    expect((await readStock(env.db)).map((s) => s.on_hand)).toEqual([-5]);
    const r = (await call(env, ADMIN, { report: "stock", with_value: false })) as { csv: string };
    expect(r.csv.split("\r\n")[1]).toContain(",-5,");
  });
  it("movements: the window's entries, oldest first, History's words; a dated report needs its range", async () => {
    const r = (await call(world(ledger), MGR, {
      report: "movements",
      from: "2026-10-07",
      to: "2026-10-08",
      with_value: true,
    })) as { csv: string; count: number; file_name: string };
    expect(r.file_name).toBe("inventory-movements-2026-10-07-to-2026-10-08.csv");
    expect(r.count).toBe(3);
    const lines = r.csv.trimEnd().split("\r\n").slice(1);
    // Oct 9 03:30Z is Oct 8, 11:30 pm Eastern: inside; Oct 9 noon is outside.
    expect(lines.map((l) => l.split(",").slice(0, 2).join(" "))).toEqual([
      "2026-10-07 10:00 AM",
      "2026-10-07 11:00 AM",
      "2026-10-08 11:30 PM",
    ]);
    expect(lines[0]).toContain(",Used on ticket,#6014 Bell County,Joe,");
    expect(lines[1]).toContain(",Put back from ticket,#6014 Bell County,Joe,");
    expect(r.csv).not.toContain(JOB_A);
    await expect(
      call(world(ledger), MGR, { report: "movements", with_value: false }),
    ).rejects.toThrow("Pick a from and to date");
  });
  it("usage: net per ticket + item with the customer and site names joined by id, the ticket's day, cost", async () => {
    const r = (await call(world(ledger), MGR, {
      report: "usage",
      from: "2026-10-01",
      to: "2026-10-31",
      with_value: true,
    })) as { csv: string; count: number; file_name: string };
    expect(r.file_name).toBe("inventory-usage-2026-10-01-to-2026-10-31.csv");
    const lines = r.csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Ticket,Customer,Site,Ticket date,Item,Colour,Quantity,Unit,Unit cost,Cost",
    );
    // Ticket A: 3 taken, 1 put back = 2; its customer and site come from crm_accounts / crm_sites.
    // Ticket B has no stored name (its number stands in), no account or site (the ticket's own
    // words), no scheduled date (the day it was opened, office time: Oct 8, 7:30 pm).
    expect(lines.slice(1)).toEqual([
      "#6014 Bell County,Bell County Schools,Bell County Gym,2026-10-07,Plates 2in (box of 1000),,2,box,0.09,0.18",
      "#6015,Walk-in,Their roof,2026-10-08,Plates 2in (box of 1000),,0.5,box,0.09,0.05",
    ]);
    expect(r.count).toBe(2);
  });
  it("buildInventoryExport is the server function's plain core (an empty range is zero rows, not an error)", async () => {
    const r = await buildInventoryExport(world(ledger).db, {
      report: "usage",
      from: "2026-11-01",
      to: "2026-11-30",
      with_value: false,
    });
    expect(r.count).toBe(0);
    expect(r.csv).toBe("Ticket,Customer,Site,Ticket date,Item,Colour,Quantity,Unit\r\n");
  });
});

describe("wiring: the page, the dialog, the server function", () => {
  const page = read("src/components/inventory-page.tsx");
  const dialog = read("src/components/inventory-export-dialog.tsx");
  const fns = read("src/lib/inventory-export.functions.ts");
  it("one Export button on the Inventory page, inside the tab row that renders only under canSeeAll", () => {
    const nav = /\{canSeeAll && \(\s*<nav aria-label="Inventory views"[\s\S]*?<\/nav>\s*\)\}/.exec(
      page,
    );
    expect(nav).not.toBeNull();
    expect(nav![0]).toContain('<FileDown className="mr-1 h-4 w-4" /> Export');
    expect(nav![0]).toMatch(
      /<Button\s+variant="outline"\s+size="sm"[\s\S]*?onClick=\{\(\) => setExporting\(true\)\}/,
    );
    expect(page.match(/Export\n/g) ?? page.match(/> Export</g)).toHaveLength(1);
    expect(page).toContain(
      "{canSeeAll && exporting && <InventoryExportDialog onClose={() => setExporting(false)} />}",
    );
    expect(page).toContain(
      'import { InventoryExportDialog } from "@/components/inventory-export-dialog";',
    );
  });
  it("the dialog: three reports with plain helper text, From/To only for the dated ones, value ticked by default, Export disabled until the range is valid", () => {
    expect(dialog).toContain("EXPORT_REPORTS.map((id) =>");
    expect(dialog).toContain("{EXPORT_REPORT_INFO[id].blurb}");
    expect(dialog).toContain("{dated && (");
    expect(dialog).toContain('type="date"');
    expect(dialog).toContain("const [withValue, setWithValue] = useState(true);");
    expect(dialog).toContain("Include value in dollars");
    expect(dialog).toContain("const valid = exportRangeValid(report, from, to);");
    expect(dialog).toContain("disabled={run.isPending || !valid}");
    expect(dialog).toContain(
      'downloadBlob(new Blob([r.csv], { type: "text/csv;charset=utf-8" }), r.file_name);',
    );
    expect(dialog).toContain("onError: (e) => toast.error(`Could not export: ${errText(e)}`),");
    expect(dialog).not.toMatch(/the app/i);
  });
  it("the server function: POST, requireSupabaseAuth, the seesEveryone gate, cost only when asked, toCsv reused", () => {
    expect(fns).toContain('export const exportInventoryCsv = createServerFn({ method: "POST" })');
    expect(fns).toContain(".middleware([requireSupabaseAuth])");
    expect(fns).toContain("if (!seesEveryone(me)) throw new Error(FORBIDDEN);");
    expect(fns).toContain("data.with_value ? readCosts(sb) : null");
    expect(fns).toContain('import { toCsv } from "@/lib/review-export";');
    expect(fns).not.toContain("function toCsv");
    // Stock on hand is the page's own aggregation, not a copy.
    expect(fns).toContain("readStock(sb)");
    const inv = read("src/lib/inventory.functions.ts");
    expect(inv).toContain(
      "export async function readStock(sb: SupabaseClient<Database>): Promise<StockRow[]>",
    );
    expect(inv).toMatch(/export const listStock[\s\S]*?readStock\(context\.supabase\)/);
  });
});
