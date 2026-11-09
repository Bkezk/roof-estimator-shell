/**
 * Owner, Nov 3: "a way to edit the job name of a bid on the project bid menu without having to
 * open the bid" (option A: a pencil by the name opens a Rename popup). The server function
 * renames a live bid, stamps "Last saved … by", leaves content_saved_at alone, and refuses while
 * someone has the bid open in the estimator. Fails on the old code.
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
const lock = vi.fn(async (): Promise<{ holderName: string } | null> => null);
vi.mock("@/lib/bid-locks.functions", () => ({
  liveLockHeldElsewhere: (...a: unknown[]) => lock(...(a as [])),
}));

import { renameBid } from "./bids.functions";

type Row = Record<string, unknown>;

/** select … maybeSingle and update … eq / is … select … maybeSingle, over rows in memory. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let patch: Row | null = null;
    const preds: ((r: Row) => boolean)[] = [];
    const q = {
      select: () => q,
      update: (p: Row) => ((patch = p), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      maybeSingle: async () => {
        const hit = rows().find((r) => preds.every((p) => p(r))) ?? null;
        if (hit && patch) Object.assign(hit, patch);
        return { data: hit, error: null };
      },
    };
    return q;
  };
  return { from };
}
const BID = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const world = (bid: Row) => {
  const tables: Record<string, Row[]> = {
    bids: [bid],
    profiles: [{ id: ME, full_name: "Braden Keck", email: "b@example.test" }],
  };
  return { tables, context: { supabase: fakeDb(tables), userId: ME } };
};
const call = (data: Row, context: unknown) =>
  (renameBid as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context,
  });
const live = () => ({
  id: BID,
  name: "Somerset Career Center",
  content_saved_at: "2026-10-30T13:23:00Z",
  updated_at: "2026-10-30T13:23:00Z",
  updated_by_name: "Brian Folden",
  deleted_at: null,
});

describe("renameBid (the server function)", () => {
  it("renames a live bid, stamps Last saved … by, and leaves content_saved_at alone", async () => {
    lock.mockResolvedValueOnce(null);
    const { tables, context } = world(live());
    const out = await call({ id: BID, name: "  Somerset Career Center — reroof 2027  " }, context);
    expect(out["name"]).toBe("Somerset Career Center — reroof 2027");
    const row = tables["bids"]![0]!;
    expect(row["name"]).toBe("Somerset Career Center — reroof 2027");
    expect(row["updated_by_name"]).toBe("Braden Keck");
    expect(row["updated_at"]).not.toBe("2026-10-30T13:23:00Z");
    expect(row["content_saved_at"]).toBe("2026-10-30T13:23:00Z");
  });
  it("refuses while someone has the bid open in the estimator, naming them", async () => {
    lock.mockResolvedValueOnce({ holderName: "Brian Folden" });
    const { tables, context } = world(live());
    await expect(call({ id: BID, name: "New name" }, context)).rejects.toThrow(
      "Read only: Brian Folden is currently editing this bid",
    );
    expect(tables["bids"]![0]!["name"]).toBe("Somerset Career Center");
  });
  it("refuses a blank name, a name over 200, and a deleted bid", async () => {
    lock.mockResolvedValue(null);
    const { context } = world(live());
    await expect(
      Promise.resolve().then(() => call({ id: BID, name: "   " }, context)),
    ).rejects.toThrow();
    await expect(
      Promise.resolve().then(() => call({ id: BID, name: "x".repeat(201) }, context)),
    ).rejects.toThrow();
    const gone = world({ ...live(), deleted_at: "2026-11-01T00:00:00Z" });
    await expect(call({ id: BID, name: "New name" }, gone.context)).rejects.toThrow(
      "Bid not found",
    );
  });
});

describe("the Bids page", () => {
  const page = readFileSync("src/routes/bids.tsx", "utf8");
  it("a pencil by the bid's name opens the Rename popup; the row still opens the bid", () => {
    expect(page).toContain('data-action="rename-bid"');
    expect(page).toMatch(
      /data-action="rename-bid"[\s\S]{0,200}setRenameFor\(\{ id: bid\.id, name: bid\.name, newName: bid\.name \}\);[\s\S]{0,80}onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/,
    );
    expect(page.indexOf('data-action="rename-bid"')).toBeLessThan(
      page.indexOf("Customer: {customerOf(bid)"),
    );
  });
  it("the popup: a Job name box, Cancel, Save name; an unchanged name just closes; the list refreshes", () => {
    const dlg = page.slice(page.indexOf('data-dialog="rename-bid"'));
    expect(dlg).toContain("<DialogTitle>Rename bid</DialogTitle>");
    expect(dlg).toContain('<Label htmlFor="rename-bid-name">Job name</Label>');
    expect(dlg).toContain("if (name === renameFor.name) {");
    expect(dlg).toContain("renameName.mutate({ id: renameFor.id, name });");
    expect(dlg).toContain("Save name");
    // Nov 6: the one row is patched in the cache instead of the list being fetched again.
    expect(page).toMatch(/const renameName = useMutation\(\{[\s\S]{0,400}patchRows\(/);
  });
});
