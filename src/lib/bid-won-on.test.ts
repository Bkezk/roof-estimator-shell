/**
 * The day a bid was won (owner, Oct 21: "there also needs to be a way to adjust the date the bid
 * was won to ensure the data appears correctly … go with the bid won on day add"): bids.won_on,
 * the business day the Margin report counts a won bid on.
 *
 *  rule      lib/bid-status.ts wonOnColumns — won: the day given, else the stored one, else
 *            today (the office's day); any other status clears it. A won bid never has a blank
 *            won_on; a day given with a non-won status is ignored.
 *  server    saveBid and setBidStatus write it by the rule; setBidWonOn (admins and managers)
 *            changes it on a won bid only, writing won_on and nothing else.
 *  source    the estimator shows a "Won on" box when the status is Won and sends wonOn; the
 *            Bids list asks for the day when a bid is marked Won; the migration and the types.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { bidOfficeToday, wonOnColumns } from "@/lib/bid-status";
import { saveBid, setBidStatus, setBidWonOn } from "@/lib/bids.functions";
import { TASK_TZ, localYmd } from "@/lib/tasks";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const TODAY = "2026-10-21";

describe("wonOnColumns: the one rule", () => {
  it("won without a day given: the stored day, else today", () => {
    expect(wonOnColumns(null, { status: "won" }, TODAY)).toEqual({ won_on: TODAY });
    expect(wonOnColumns({ status: "draft", won_on: null }, { status: "won" }, TODAY)).toEqual({
      won_on: TODAY,
    });
    expect(wonOnColumns({ status: "won", won_on: "2026-10-10" }, { status: "won" }, TODAY)).toEqual(
      { won_on: "2026-10-10" },
    );
    // A bid won before the column existed: filled on its next save with the office's day it was
    // marked Won (status_changed_at; the day the report was already counting it on), so saving
    // it once for its figures does not move it to today; with no stamp either, today.
    expect(
      wonOnColumns(
        { status: "won", won_on: null, status_changed_at: "2026-10-13T02:30:00Z" },
        { status: "won" },
        TODAY,
      ),
    ).toEqual({ won_on: "2026-10-12" });
    expect(wonOnColumns({ status: "won", won_on: null }, { status: "won" }, TODAY)).toEqual({
      won_on: TODAY,
    });
    // A draft's status_changed_at is not a won day: becoming won now is today.
    expect(
      wonOnColumns(
        { status: "draft", won_on: null, status_changed_at: "2026-10-13T02:30:00Z" },
        { status: "won" },
        TODAY,
      ),
    ).toEqual({ won_on: TODAY });
  });
  it("won with a day given: that day, over the stored one; a malformed or null day counts as not given", () => {
    expect(wonOnColumns(null, { status: "won", wonOn: "2026-10-15" }, TODAY)).toEqual({
      won_on: "2026-10-15",
    });
    expect(
      wonOnColumns(
        { status: "won", won_on: "2026-10-10" },
        { status: "won", wonOn: "2026-10-12" },
        TODAY,
      ),
    ).toEqual({ won_on: "2026-10-12" });
    expect(
      wonOnColumns({ status: "won", won_on: "2026-10-10" }, { status: "won", wonOn: null }, TODAY),
    ).toEqual({ won_on: "2026-10-10" });
    expect(wonOnColumns(null, { status: "won", wonOn: "10/15/2026" }, TODAY)).toEqual({
      won_on: TODAY,
    });
    // The legacy "accepted" is won.
    expect(wonOnColumns(null, { status: "accepted" }, TODAY)).toEqual({ won_on: TODAY });
  });
  it("any other status clears it, whatever day is given", () => {
    for (const status of ["draft", "submitted", "lost", "denied", null, undefined])
      expect(
        wonOnColumns(
          { status: "won", won_on: "2026-10-10" },
          { status, wonOn: "2026-10-12" },
          TODAY,
        ),
      ).toEqual({ won_on: null });
  });
  it("bidOfficeToday is the office's day (TASK_TZ), not the server's", () => {
    expect(bidOfficeToday()).toBe(localYmd(new Date(), TASK_TZ));
    expect(bidOfficeToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---- the server -----------------------------------------------------------------------------

const ANN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // admin
const MIKE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // manager
const EVE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // estimator (Estimate access)
const BID = "33333333-3333-4333-8333-333333333333";
const LOST = "44444444-4444-4444-8444-444444444444";

let env: ReturnType<typeof fakeSupabase>;
const bidRow = (over: Row = {}): Row => ({
  id: BID,
  name: "Gym reroof bid",
  status: "draft",
  grand_total: 48250,
  data: {},
  lost_reason: null,
  opportunity_id: null,
  submitted_at: null,
  status_changed_at: null,
  due_date: "2026-10-30",
  won_on: null,
  deleted_at: null,
  account_id: null,
  updated_at: "2026-10-10T12:00:00Z",
  created_at: "2026-10-01T12:00:00Z",
  ...over,
});
beforeEach(() => {
  env = fakeSupabase(
    {
      profiles: [
        { id: ANN, role: "admin", access: [], full_name: "Ann Admin", email: "ann@x" },
        { id: MIKE, role: "manager", access: [], full_name: "Mike Manager", email: "mike@x" },
        { id: EVE, role: "user", access: ["estimate"], full_name: "Eve Estimator", email: "eve@x" },
      ],
      bids: [bidRow(), bidRow({ id: LOST, name: "Lost one", status: "lost" })],
      bid_locks: [],
      crm_opportunities: [],
    },
    { rpcs: { sync_opportunity_from_bid: () => ({ action: "none", reason: "no opportunity" }) } },
  );
});
const call = <T = unknown>(fn: unknown, data: Row, userId: string) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const row = (id = BID) => env.tables["bids"]!.find((r) => r["id"] === id)!;
const save = (over: Row) =>
  call(saveBid, { id: BID, name: "Gym reroof bid", data: {}, grandTotal: 48250, ...over }, EVE);
const today = () => bidOfficeToday();

describe("saveBid writes won_on by the rule", () => {
  it("saved as Won without a day: today; with a day: that day; saved again without one: kept", async () => {
    await save({ status: "won" });
    expect(row()["won_on"]).toBe(today());
    await save({ status: "won", wonOn: "2026-10-15" });
    expect(row()["won_on"]).toBe("2026-10-15");
    await save({ status: "won" });
    expect(row()["won_on"]).toBe("2026-10-15");
  });
  it("a bid won before the column existed, saved again as Won: the office's day it was marked Won, not today", async () => {
    Object.assign(row(), { status: "won", status_changed_at: "2026-10-13T02:30:00Z" });
    await save({ status: "won" });
    expect(row()["won_on"]).toBe("2026-10-12");
    // The same through the Bids list's status change.
    Object.assign(row(), { won_on: null });
    await call(setBidStatus, { id: BID, status: "won" }, EVE);
    expect(row()["won_on"]).toBe("2026-10-12");
  });
  it("saved as anything else: cleared, even with a day given", async () => {
    await save({ status: "won", wonOn: "2026-10-15" });
    await save({ status: "lost", lostReason: "Price", wonOn: "2026-10-15" });
    expect(row()["won_on"]).toBeNull();
    await save({ status: "submitted" });
    expect(row()["won_on"]).toBeNull();
  });
  it("a new bid inserted as Won carries the day (given, else today)", async () => {
    const made = await call<{ id: string; won_on: string | null }>(
      saveBid,
      {
        name: "New won bid",
        data: {},
        grandTotal: 100,
        status: "won",
        dueDate: "2026-10-30",
        wonOn: "2026-10-18",
      },
      EVE,
    );
    expect(made.won_on).toBe("2026-10-18");
    const made2 = await call<{ id: string; won_on: string | null }>(
      saveBid,
      { name: "New won bid 2", data: {}, grandTotal: 100, status: "won", dueDate: "2026-10-30" },
      EVE,
    );
    expect(made2.won_on).toBe(today());
    const draft = await call<{ id: string; won_on: string | null }>(
      saveBid,
      { name: "New draft", data: {}, grandTotal: 100, dueDate: "2026-10-30", wonOn: "2026-10-18" },
      EVE,
    );
    expect(draft.won_on).toBeNull();
  });
  it("the schema takes YYYY-MM-DD only", () => {
    expect(() => save({ status: "won", wonOn: "10/15/2026" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("setBidStatus (the Bids list) writes won_on the same way", () => {
  it("Won: the day given, else today; another status clears it", async () => {
    await call(setBidStatus, { id: BID, status: "won" }, EVE);
    expect(row()["won_on"]).toBe(today());
    await call(setBidStatus, { id: BID, status: "won", wonOn: "2026-10-16" }, EVE);
    expect(row()["won_on"]).toBe("2026-10-16");
    await call(setBidStatus, { id: BID, status: "submitted" }, EVE);
    expect(row()["won_on"]).toBeNull();
  });
});

describe("setBidWonOn (the report's inline edit)", () => {
  it("an admin or a manager moves the day of a won bid; only won_on is written", async () => {
    await call(setBidStatus, { id: BID, status: "won", wonOn: "2026-10-16" }, EVE);
    env.writes.length = 0;
    const r = await call<{ id: string; won_on: string }>(
      setBidWonOn,
      { id: BID, wonOn: "2026-10-09" },
      ANN,
    );
    expect(r).toEqual({ id: BID, won_on: "2026-10-09" });
    expect(row()["won_on"]).toBe("2026-10-09");
    expect(env.writes.map((w) => [w.table, w.op, Object.keys(w.payload ?? {})])).toEqual([
      ["bids", "update", ["won_on"]],
    ]);
    await call(setBidWonOn, { id: BID, wonOn: "2026-10-11" }, MIKE);
    expect(row()["won_on"]).toBe("2026-10-11");
  });
  it("refuses anyone else, a bid that is not won, a deleted or unknown bid, and a malformed day", async () => {
    await call(setBidStatus, { id: BID, status: "won" }, EVE);
    await expect(call(setBidWonOn, { id: BID, wonOn: "2026-10-09" }, EVE)).rejects.toThrow(
      "Forbidden: admins and managers only",
    );
    await expect(call(setBidWonOn, { id: LOST, wonOn: "2026-10-09" }, ANN)).rejects.toThrow(
      "Only a won bid has a Won-on day",
    );
    row()["deleted_at"] = "2026-10-20T00:00:00Z";
    await expect(call(setBidWonOn, { id: BID, wonOn: "2026-10-09" }, ANN)).rejects.toThrow(
      /not found/i,
    );
    await expect(
      call(setBidWonOn, { id: "99999999-9999-4999-8999-999999999999", wonOn: "2026-10-09" }, ANN),
    ).rejects.toThrow(/not found/i);
    expect(() => call(setBidWonOn, { id: BID, wonOn: "Oct 9" }, ANN)).toThrow(/YYYY-MM-DD/);
  });
});

// ---- pinned to the source -------------------------------------------------------------------

describe("the column", () => {
  it("the migration adds bids.won_on (date) with a comment; the types carry it", () => {
    const sql = read("supabase/migrations/20261021140000_bid_figures.sql");
    expect(sql).toContain("alter table public.bids add column if not exists won_on date;");
    expect(sql).toMatch(/comment on column public\.bids\.won_on is/);
    const types = read("src/integrations/supabase/types.ts");
    const bids = types.slice(types.indexOf("      bids: {\n        Row: {"));
    const row = bids.slice(0, bids.indexOf("Insert: {"));
    const insert = bids.slice(bids.indexOf("Insert: {"), bids.indexOf("Update: {"));
    const update = bids.slice(bids.indexOf("Update: {"), bids.indexOf("Relationships:"));
    expect(row).toContain("won_on: string | null;");
    expect(insert).toContain("won_on?: string | null;");
    expect(update).toContain("won_on?: string | null;");
  });
});

describe("the estimator", () => {
  const src = read("src/routes/estimate.tsx");
  it("a Won on date box beside Status, only when the status is Won, seeded from the row and today's office day", () => {
    expect(src).toContain('id="bid-won-on"');
    expect(src).toMatch(/<Label htmlFor="bid-won-on"[^>]*>\s*Won on\s*<\/Label>/);
    expect(src).toContain('bidStatus === "won" && (');
    expect(src).toContain('setWonOnDay(loadedBid.won_on ?? "");');
    expect(src).toContain('if (st === "won" && !wonOnDay) setWonOnDay(bidOfficeToday());');
  });
  it("sends wonOn with the save when the status or the day changed in the tab (bidHeaderPatch: null unless Won)", () => {
    const save = src.indexOf("const tabHeader: BidHeader = {");
    const call = src.indexOf("const row = await saveBidFn({", save);
    const payload = src.slice(save, src.indexOf("});", call));
    expect(payload).toContain("wonOn: wonOnDay,");
    expect(payload).toContain("...bidHeaderPatch(bidId ? loadedHeader.current : null, tabHeader),");
  });
});

describe("the Bids list", () => {
  const src = read("src/routes/bids.tsx");
  it("marking Won asks for the day in a dialog (today's office day to start) and sends wonOn", () => {
    expect(src).toContain('id="bid-won-on-list"');
    expect(src).toMatch(/<Label htmlFor="bid-won-on-list"[^>]*>\s*Won on\s*<\/Label>/);
    expect(src).toContain("bidOfficeToday()");
    expect(src).toContain(
      'setStatus.mutate({ id: wonFor.id, status: "won", wonOn: wonFor.day || null });',
    );
    expect(src).toMatch(/v === "won"\s*\?\s*setWonFor\(/);
  });
});
