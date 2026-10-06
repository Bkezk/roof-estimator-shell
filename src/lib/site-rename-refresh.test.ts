/**
 * Renaming an inner site refreshes its tickets' snapshot (owner, Oct 6). A ticket keeps the
 * site's name in service_jobs.location_name (snapshotted on the ticket's save, as site_name is
 * for the property); savePropertySites rewrote property_sites.name only, so a renamed site kept
 * its old name on every ticket until someone saved each one. Now the save also rewrites
 * location_name on the live tickets at that site — only for the sites whose name changed.
 */
import { describe, expect, it, vi } from "vitest";

// createServerFn reduced to "validate, then call the handler" (as closeout-finished-ticket.test.ts).
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

import { renamedSites, savePropertySites } from "@/lib/property-sites.functions";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

/** A small PostgREST stand-in: select / insert / update with eq / in / is, recording updates. */
function fakeDb(tables: Record<string, Row[]>) {
  let nextId = 1;
  const updates: { table: string; patch: Row; hit: number }[] = [];
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    const preds: ((r: Row) => boolean)[] = [];
    const run = (): Result => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const made = list.map((r) => ({ id: `row-${nextId++}`, ...r }));
        rows().push(...made);
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        updates.push({ table, patch: payload as Row, hit: hit.length });
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const one = (): Result => ({ data: ((run().data ?? []) as Row[])[0] ?? null, error: null });
    const q = {
      select: () => q,
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      order: () => q,
      single: async () => one(),
      maybeSingle: async () => one(),
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from, updates };
}

const PROPERTY = "11111111-1111-4111-8111-111111111111";
const FRONT = "22222222-2222-4222-8222-222222222222";
const BACK = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";

function world() {
  const tables: Record<string, Row[]> = {
    profiles: [{ id: MANAGER, role: "manager", access: [], technician: false }],
    property_sites: [
      { id: FRONT, property_id: PROPERTY, name: "Front", notes: null, sort: 0, deleted_at: null },
      { id: BACK, property_id: PROPERTY, name: "Back", notes: null, sort: 1, deleted_at: null },
    ],
    service_jobs: [
      { id: "j1", location_id: FRONT, location_name: "Front", deleted_at: null },
      { id: "j2", location_id: FRONT, location_name: "Front", deleted_at: "2026-10-01T00:00:00Z" },
      { id: "j3", location_id: BACK, location_name: "Back", deleted_at: null },
      { id: "j4", location_id: null, location_name: null, deleted_at: null },
    ],
  };
  const db = fakeDb(tables);
  return { tables, db, context: { supabase: db, userId: MANAGER } };
}
const call = (data: Row, context: unknown) =>
  (savePropertySites as unknown as (a: { data: Row; context: unknown }) => Promise<Row[]>)({
    data,
    context,
  });

describe("renamedSites (pure)", () => {
  it("names the kept sites whose name changed, with the new name", () => {
    const current = [
      { id: FRONT, name: "Front" },
      { id: BACK, name: "Back" },
    ];
    expect(
      renamedSites(current, [
        { id: FRONT, name: "Front Lobby" },
        { id: BACK, name: "Back", notes: "changed notes only" },
        { name: "New one" },
      ]),
    ).toEqual([{ id: FRONT, name: "Front Lobby" }]);
    expect(renamedSites(current, [{ id: FRONT, name: "Front" }])).toEqual([]);
  });
});

describe("savePropertySites after a rename", () => {
  it("rewrites location_name on the live tickets at the renamed site only", async () => {
    const { tables, db, context } = world();
    await call(
      {
        property_id: PROPERTY,
        items: [
          { id: FRONT, name: "Front Lobby" },
          { id: BACK, name: "Back", notes: "Loading dock door" },
        ],
      },
      context,
    );
    const job = (id: string) => tables["service_jobs"]!.find((j) => j["id"] === id)!;
    expect(job("j1")["location_name"]).toBe("Front Lobby"); // live, at Front
    expect(job("j2")["location_name"]).toBe("Front"); // deleted ticket: left alone
    expect(job("j3")["location_name"]).toBe("Back"); // Back was not renamed
    expect(job("j4")["location_name"]).toBeNull();
    const jobUpdates = db.updates.filter((u) => u.table === "service_jobs");
    expect(jobUpdates).toEqual([
      { table: "service_jobs", patch: { location_name: "Front Lobby" }, hit: 1 },
    ]);
    // The site itself is renamed as before.
    expect(tables["property_sites"]!.find((s) => s["id"] === FRONT)!["name"]).toBe("Front Lobby");
  });
  it("issues no ticket update when no name changed", async () => {
    const { db, context } = world();
    await call(
      {
        property_id: PROPERTY,
        items: [
          { id: FRONT, name: "Front" },
          { id: BACK, name: "Back", notes: "notes only" },
        ],
      },
      context,
    );
    expect(db.updates.filter((u) => u.table === "service_jobs")).toEqual([]);
  });
});
