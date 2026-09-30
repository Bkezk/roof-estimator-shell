/**
 * The takeoff lock on the SERVER (saveTakeoffImpl / copyTakeoffImpl in takeoff.functions.ts),
 * against an in-memory stand-in for the caller's Supabase client: a takeoff that built a bid
 * refuses drawing changes whatever the client sends, and "Edit a copy" makes an unlocked twin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Page access: 'takeoff' always passes; 'estimate' (seeing bids) is switchable per test.
const access = { estimate: true };
vi.mock("@/lib/auth.functions", () => ({
  assertPageAccess: (_db: unknown, _user: string, page: string) =>
    page === "estimate" && !access.estimate
      ? Promise.reject(new Error("Forbidden: Estimate access required"))
      : Promise.resolve(),
}));

import {
  copyTakeoffImpl,
  saveTakeoffImpl,
  type TakeoffCtx,
  type TakeoffRow,
} from "@/lib/takeoff.functions";

type Row = {
  id?: unknown;
  objects?: unknown;
  bid_id?: unknown;
  account_id?: unknown;
  deleted_at?: unknown;
  [k: string]: unknown;
};

/** A tiny PostgREST-like fake: filters eq / is / not-null, update / insert / select. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; payload: Row; filters: string[] }> = [];
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "update" | "insert" = "select";
    let payload: Row = {};
    const preds: Array<(r: Row) => boolean> = [];
    const filters: string[] = [];
    const run = (): { data: Row[]; error: null } => {
      if (op === "insert") {
        const r = { id: `new-${rows().length + 1}`, deleted_at: null, ...payload };
        rows().push(r);
        writes.push({ table, op, payload, filters });
        return { data: [r], error: null };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        writes.push({ table, op, payload, filters });
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        filters.push(`eq ${c}`);
        preds.push((r) => r[c] === v);
        return b;
      },
      is: (c: string, v: unknown) => {
        filters.push(`is ${c}`);
        preds.push((r) => (r[c] ?? null) === v);
        return b;
      },
      update: (p: Row) => {
        op = "update";
        payload = p;
        return b;
      },
      insert: (p: Row) => {
        op = "insert";
        payload = p;
        return b;
      },
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      single: async () => {
        const d = run().data[0];
        return d ? { data: d, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve(run()).then(res),
    };
    return b;
  };
  return { db: { from } as unknown as TakeoffCtx["supabase"], writes, tables };
}

const T = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_BID = "16fd2706-8baf-433b-82eb-8c7fada847da";
const pages = [{ index: 0, name: "A1", rotation: 0 as const, scale: null }];
const objects = [
  {
    id: "a",
    kind: "area" as const,
    page: 0,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ] as Array<[number, number]>,
    attrs: { name: "Section 1" },
  },
];
const takeoff = (over: Row = {}): Row => ({
  id: T,
  name: "Acme · Sep 30, 2026",
  status: "done",
  underlay_kind: "pdf",
  file_path: `${T}/plans.pdf`,
  file_name: "plans.pdf",
  file_size: 1234,
  pages,
  objects,
  setup: { roofSystem: "Duro-Last", lockedAt: "2026-09-29T10:00:00.000Z" },
  building_id: null,
  account_id: null,
  bid_id: BID,
  deleted_at: null,
  ...over,
});

let env: ReturnType<typeof fakeDb>;
const ctx = (): TakeoffCtx => ({ supabase: env.db, userId: "user-1" });
beforeEach(() => {
  access.estimate = true;
  env = fakeDb({
    takeoffs: [takeoff()],
    profiles: [{ id: "user-1", full_name: "Braden", email: "b@example.com" }],
    bids: [{ id: BID, account_id: null, deleted_at: null }],
  });
});
const stored = () => env.tables["takeoffs"]!.find((r) => r["id"] === T)!;

describe("saveTakeoff on a locked takeoff (bid_id set)", () => {
  it("refuses an autosave of objects / pages / setup and changes nothing", async () => {
    const moved = [
      {
        ...objects[0]!,
        points: [
          [0, 0],
          [99, 0],
          [99, 99],
        ] as Array<[number, number]>,
      },
    ];
    await expect(
      saveTakeoffImpl(ctx(), { id: T, name: "x", pages, setup: {}, objects: moved }),
    ).rejects.toThrow(/This takeoff is locked: it built a bid.*pages, setup, objects/);
    await expect(saveTakeoffImpl(ctx(), { id: T, objects: moved })).rejects.toThrow(/locked/);
    await expect(saveTakeoffImpl(ctx(), { id: T, setup: { color: "Tan" } })).rejects.toThrow(
      /locked/,
    );
    expect(stored().objects).toEqual(objects);
    expect(env.writes.filter((w) => w.table === "takeoffs")).toEqual([]);
  });

  it("still allows a rename, the status and the customer", async () => {
    const r = await saveTakeoffImpl(ctx(), { id: T, name: "Renamed", status: "draft" });
    expect(r.name).toBe("Renamed");
    expect(r.status).toBe("draft");
    const acct = "11111111-1111-4111-8111-111111111111";
    expect((await saveTakeoffImpl(ctx(), { id: T, account_id: acct })).account_id).toBe(acct);
    expect(stored().bid_id).toBe(BID);
    expect(stored().objects).toEqual(objects);
  });

  it("refuses pointing it at another bid", async () => {
    await expect(saveTakeoffImpl(ctx(), { id: T, bid_id: OTHER_BID })).rejects.toThrow(
      /already built another bid/,
    );
    expect(stored().bid_id).toBe(BID);
  });

  it("clears the bid link only when that bid is gone (and the user can see bids)", async () => {
    await expect(saveTakeoffImpl(ctx(), { id: T, bid_id: null })).rejects.toThrow(/still exists/);
    env.tables["bids"]![0]!.deleted_at = "2026-09-30T00:00:00.000Z";
    access.estimate = false;
    await expect(saveTakeoffImpl(ctx(), { id: T, bid_id: null })).rejects.toThrow(
      /only someone who can see bids/,
    );
    access.estimate = true;
    const r = await saveTakeoffImpl(ctx(), { id: T, bid_id: null });
    expect(r.bid_id).toBeNull();
    expect(r.setup).toEqual({ roofSystem: "Duro-Last" }); // the lock stamp goes with it
    // Unlocked now: the drawing may change again.
    await expect(saveTakeoffImpl(ctx(), { id: T, objects: [] })).resolves.toMatchObject({
      objects: [],
    });
  });

  it("the update is conditioned on the bid link it checked (no race past the lock)", async () => {
    await saveTakeoffImpl(ctx(), { id: T, name: "Renamed" });
    const w = env.writes.find((x) => x.table === "takeoffs" && x.op === "update")!;
    expect(w.filters).toContain("eq bid_id");
  });
});

describe("saveTakeoff on an unlocked takeoff", () => {
  beforeEach(() => {
    Object.assign(stored(), { bid_id: null, setup: { roofSystem: "Duro-Last" } });
  });

  it("saves the drawing as before", async () => {
    const r = await saveTakeoffImpl(ctx(), { id: T, objects: [], pages });
    expect(r.objects).toEqual([]);
    const w = env.writes.find((x) => x.table === "takeoffs" && x.op === "update")!;
    expect(w.filters).toContain("is bid_id");
  });

  it("linking the bid it built locks it and stamps when", async () => {
    const r = await saveTakeoffImpl(ctx(), { id: T, bid_id: BID });
    expect(r.bid_id).toBe(BID);
    expect(typeof (r.setup as { lockedAt?: unknown }).lockedAt).toBe("string");
    expect((r.setup as { roofSystem?: unknown }).roofSystem).toBe("Duro-Last");
    await expect(saveTakeoffImpl(ctx(), { id: T, objects: [] })).rejects.toThrow(/locked/);
  });

  it("a save that lost the race to the lock is refused, not applied", async () => {
    // Another tab's bid save locks the row between this save's check and its update.
    const realFrom = (env.db as unknown as { from: (t: string) => unknown }).from;
    let reads = 0;
    (env.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = realFrom(t) as { maybeSingle: () => Promise<unknown> };
      if (t === "takeoffs") {
        const orig = b.maybeSingle;
        b.maybeSingle = () => {
          reads += 1;
          if (reads === 2) stored().bid_id = BID; // just before the update runs
          return orig();
        };
      }
      return b;
    };
    await expect(saveTakeoffImpl(ctx(), { id: T, objects: [] })).rejects.toThrow(/locked/);
    expect(stored().objects).toEqual(objects);
  });
});

describe("copyTakeoff", () => {
  it("makes an unlocked copy with the same drawing, file and customer", async () => {
    const acct = "11111111-1111-4111-8111-111111111111";
    stored().account_id = acct;
    const copy: TakeoffRow = await copyTakeoffImpl(ctx(), { id: T });
    expect(copy.id).not.toBe(T);
    expect(copy.bid_id).toBeNull();
    expect(copy.status).toBe("draft");
    expect(copy.name).toBe("Acme · Sep 30, 2026 (copy)");
    expect(copy.pages).toEqual(pages);
    expect(copy.objects).toEqual(objects);
    expect(copy.file_path).toBe(`${T}/plans.pdf`);
    expect(copy.account_id).toBe(acct);
    const setup = copy.setup as Record<string, unknown>;
    expect(setup["roofSystem"]).toBe("Duro-Last");
    expect(setup["lockedAt"]).toBeUndefined();
    expect(setup["copiedFrom"]).toMatchObject({ takeoffId: T, bidId: BID });
    // A deep copy: editing the copy's objects never touches the original's.
    expect(copy.objects).not.toBe(stored().objects);
    // The original is untouched and still locked.
    expect(stored().bid_id).toBe(BID);
  });

  it("names a second copy (copy 2), and the copy saves freely", async () => {
    const first = await copyTakeoffImpl(ctx(), { id: T });
    const second = await copyTakeoffImpl(ctx(), { id: T });
    expect(second.name).toBe("Acme · Sep 30, 2026 (copy 2)");
    const saved = await saveTakeoffImpl(ctx(), { id: first.id, objects: [] });
    expect(saved.objects).toEqual([]);
  });

  it("refuses a deleted takeoff", async () => {
    stored().deleted_at = "2026-09-30T00:00:00.000Z";
    await expect(copyTakeoffImpl(ctx(), { id: T })).rejects.toThrow(/not found/);
  });
});
