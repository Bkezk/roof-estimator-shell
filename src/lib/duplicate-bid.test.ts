/**
 * Owner, Oct 6: "We also need the ability to duplicate a bid." A Duplicate button on each Bids
 * row makes a new DRAFT copy — same payload, total, customer, site, building — named
 * "<name> (copy)", and opens it. Status, lost reason and the takeoff / opportunity links are
 * not copied.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/bid-locks.functions", () => ({ liveLockHeldElsewhere: vi.fn(async () => null) }));

import { duplicateBid } from "./bids.functions";
import { duplicateBidName, duplicateBidRow } from "./duplicate-bid";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number };

/** A small PostgREST stand-in: select / insert with eq / is / not, single / maybeSingle. */
function fakeDb(tables: Record<string, Row[]>) {
  let nextId = 1;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "insert" = "select";
    let payload: Row | null = null;
    const preds: ((r: Row) => boolean)[] = [];
    const run = (): Result => {
      if (op === "insert") {
        const made = { id: `new-${nextId++}`, created_at: "2026-10-06T15:00:00Z", ...payload };
        rows().push(made);
        return { data: [made], error: null };
      }
      return { data: rows().filter((r) => preds.every((p) => p(r))), error: null };
    };
    const one = (strict: boolean): Result => {
      const list = (run().data ?? []) as Row[];
      if (strict && list.length !== 1) return { data: null, error: { message: "not one row" } };
      return { data: list[0] ?? null, error: null };
    };
    const q = {
      select: () => q,
      insert: (p: Row) => ((op = "insert"), (payload = p), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, _op: string, v: unknown) => (preds.push((r) => (r[c] ?? null) !== v), q),
      order: () => q,
      single: async () => one(true),
      maybeSingle: async () => one(false),
    };
    return q;
  };
  return { from };
}

const BID = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const source: Row = {
  id: BID,
  name: "Monicello Banking Company 2026",
  status: "sent",
  lost_reason: null,
  data: { sections: [{ name: "Roof Type 1" }], importInfo: { source: "planswift" } },
  grand_total: 12548.82,
  account_id: "acct-1",
  site_id: "site-1",
  building_id: "bldg-1",
  roof_id: "roof-1",
  takeoff_id: "takeoff-1",
  opportunity_id: "opp-1",
  deleted_at: null,
  created_by: "someone-else",
  updated_by_name: "Brian Folden",
};
const world = (bids: Row[]) => {
  const tables: Record<string, Row[]> = {
    bids,
    profiles: [{ id: ME, full_name: "Braden Keck", email: "b@example.test" }],
  };
  return { tables, context: { supabase: fakeDb(tables), userId: ME } };
};
const call = (data: Row, context: unknown) =>
  (duplicateBid as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context,
  });

describe("duplicateBidName", () => {
  it("adds (copy), then counts up", () => {
    expect(duplicateBidName("Gym reroof")).toBe("Gym reroof (copy)");
    expect(duplicateBidName("Gym reroof (copy)")).toBe("Gym reroof (copy 2)");
    expect(duplicateBidName("Gym reroof (copy 2)")).toBe("Gym reroof (copy 3)");
    expect(duplicateBidName("  ")).toBe("Untitled bid (copy)");
    expect(duplicateBidName("x".repeat(200)).length).toBeLessThanOrEqual(200);
    expect(duplicateBidName("x".repeat(200))).toMatch(/ \(copy\)$/);
  });
});

describe("duplicateBid (the server function, against a fake database)", () => {
  it("inserts a draft copy with the payload, total, customer, site and building; not the links or status", async () => {
    const { tables, context } = world([{ ...source }]);
    const copy = await call({ id: BID }, context);
    expect(tables["bids"]).toHaveLength(2);
    expect(copy["id"]).toBe("new-1");
    expect(copy["name"]).toBe("Monicello Banking Company 2026 (copy)");
    expect(copy["status"]).toBe("draft");
    expect(copy["lost_reason"]).toBeNull();
    expect(copy["data"]).toEqual(source["data"]);
    expect(copy["grand_total"]).toBe(12548.82);
    expect(copy["account_id"]).toBe("acct-1");
    expect(copy["site_id"]).toBe("site-1");
    expect(copy["building_id"]).toBe("bldg-1");
    expect(copy["roof_id"]).toBe("roof-1");
    expect(copy["takeoff_id"]).toBeNull();
    expect(copy["opportunity_id"]).toBeNull();
    expect(copy["updated_by_name"]).toBe("Braden Keck");
    // The source is untouched.
    expect(tables["bids"]![0]).toEqual(source);
  });
  it("refuses a deleted or unknown bid", async () => {
    const { context } = world([{ ...source, deleted_at: "2026-10-01T00:00:00Z" }]);
    await expect(call({ id: BID }, context)).rejects.toThrow("Bid not found");
    await expect(
      Promise.resolve().then(() => call({ id: "not-a-uuid" }, context)),
    ).rejects.toThrow();
  });
  it("duplicateBidRow never copies created_by, deleted_at or the id", () => {
    const row = duplicateBidRow(source as never, "Braden Keck", "2026-10-06T15:00:00Z");
    expect(Object.keys(row).sort()).toEqual(
      [
        "account_id",
        "building_id",
        "data",
        "grand_total",
        "lost_reason",
        "name",
        "opportunity_id",
        "roof_id",
        "site_id",
        "status",
        "takeoff_id",
        "updated_at",
        "updated_by_name",
      ].sort(),
    );
  });
});

describe("the Bids page", () => {
  const src = readFileSync("src/routes/bids.tsx", "utf8");
  it("has a Duplicate button beside Delete on each row, which opens the copy", () => {
    expect(src).toContain('title="Duplicate this bid (a new draft copy)"');
    expect(src).toMatch(
      /<Copy className="h-4 w-4" \/>\s*<span className="sr-only">Duplicate<\/span>/,
    );
    expect(src.indexOf('title="Duplicate this bid')).toBeLessThan(
      src.indexOf('title="Delete this bid"'),
    );
    expect(src).toContain('void navigate({ to: "/estimate", search: { bid: copy.id } });');
    expect(src).toContain("duplicate.mutate(bid.id);");
    // The row itself opens the bid on click; the button must not also do that.
    expect(src).toMatch(
      /duplicate\.mutate\(bid\.id\);[\s\S]{0,80}onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/,
    );
  });
});
