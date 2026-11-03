/**
 * Owner, Nov 3: "when you copy a bid can we have a popup that allows you to edit the job name of
 * the newly copied bid." The Bids page's Duplicate button opens a popup with the job name filled
 * in as "<name> (copy)"; what is typed becomes the copy's name (blank = the default), then the
 * copy is made and opened. Fails on the old code (the copy was made at once, always "(copy)").
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
import { copyBidName, duplicateBidRow } from "./duplicate-bid";

type Row = Record<string, unknown>;

/** The smallest PostgREST stand-in the copy needs: select … maybeSingle, insert … single. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let inserted: Row | null = null;
    const preds: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q,
      insert: (p: Row) => ((inserted = p), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      single: async () => {
        const made = { id: "copy-1", ...inserted };
        rows().push(made);
        return { data: made, error: null };
      },
      maybeSingle: async () => ({
        data: rows().find((r) => preds.every((p) => p(r))) ?? null,
        error: null,
      }),
    };
    return q;
  };
  return { from };
}
const BID = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const source: Row = {
  id: BID,
  name: "Somerset Career Center",
  status: "sent",
  data: { sections: [] },
  grand_total: 100,
  account_id: null,
  site_id: null,
  building_id: null,
  roof_id: null,
  takeoff_id: null,
  opportunity_id: null,
  deleted_at: null,
};
const call = (data: Row) => {
  const tables: Record<string, Row[]> = {
    bids: [{ ...source }],
    profiles: [{ id: ME, full_name: "Braden Keck", email: "b@example.test" }],
  };
  return (duplicateBid as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context: { supabase: fakeDb(tables), userId: ME },
  });
};

describe("copyBidName", () => {
  it("the typed name, trimmed and cut at 200; blank or absent = '<name> (copy)'", () => {
    expect(copyBidName("Somerset Career Center", " Somerset Career Center 2027 ")).toBe(
      "Somerset Career Center 2027",
    );
    expect(copyBidName("Somerset Career Center", "")).toBe("Somerset Career Center (copy)");
    expect(copyBidName("Somerset Career Center", "   ")).toBe("Somerset Career Center (copy)");
    expect(copyBidName("Somerset Career Center")).toBe("Somerset Career Center (copy)");
    expect(copyBidName("Somerset Career Center", null)).toBe("Somerset Career Center (copy)");
    expect(copyBidName("x", "y".repeat(260))).toHaveLength(200);
  });
  it("duplicateBidRow takes the typed name; the rest is as before", () => {
    const row = duplicateBidRow(source as never, "Braden Keck", "2026-11-03T15:00:00Z", "Gym 2");
    expect(row.name).toBe("Gym 2");
    expect(row.status).toBe("draft");
    expect(duplicateBidRow(source as never, null, "2026-11-03T15:00:00Z").name).toBe(
      "Somerset Career Center (copy)",
    );
  });
});

describe("duplicateBid (the server function) takes the popup's name", () => {
  it("inserts the copy under the typed name", async () => {
    const copy = await call({ id: BID, name: "Somerset Career Center — option B" });
    expect(copy["name"]).toBe("Somerset Career Center — option B");
    expect(copy["status"]).toBe("draft");
  });
  it("blank or no name = the (copy) default; a name over 200 is refused by the schema", async () => {
    expect((await call({ id: BID, name: "  " }))["name"]).toBe("Somerset Career Center (copy)");
    expect((await call({ id: BID }))["name"]).toBe("Somerset Career Center (copy)");
    await expect(
      Promise.resolve().then(() => call({ id: BID, name: "z".repeat(201) })),
    ).rejects.toThrow();
  });
});

describe("the Bids page", () => {
  const page = readFileSync("src/routes/bids.tsx", "utf8");
  it("Duplicate opens the popup with '<name> (copy)' filled in instead of copying at once", () => {
    expect(page).toContain(
      "setCopyFor({ id: bid.id, name: bid.name, newName: duplicateBidName(bid.name) });",
    );
    expect(page).not.toContain("duplicate.mutate(bid.id)");
  });
  it("the popup: a Job name box, Cancel, Make the copy; the typed name goes to the server", () => {
    const dlg = page.slice(page.indexOf('data-dialog="copy-bid"'));
    expect(dlg).toContain("<DialogTitle>Copy this bid</DialogTitle>");
    expect(dlg).toContain('<Label htmlFor="copy-bid-name">Job name</Label>');
    expect(dlg).toContain("name: copyFor.newName.trim() || duplicateBidName(copyFor.name),");
    expect(dlg).toContain("Make the copy");
    expect(dlg).toContain("onFocus={(e) => e.currentTarget.select()}");
    expect(page).toContain(
      "mutationFn: (v: { id: string; name: string }) => duplicateFn({ data: v }),",
    );
  });
});
