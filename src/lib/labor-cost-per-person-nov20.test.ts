/**
 * What an hour of each person costs, on the cost side of a service invoice (owner, Nov 20: "go"
 * on an hourly cost on each person; of the labor cost on the Service rates page he said "it
 * depends on the tech"; docs/qa/labor-cost-per-person-2026-11-20.md).
 *
 * Before this the cost of every labor and travel line came from the Service rates page, one
 * figure for a technician and one for a helper, whoever did the work.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { listUsers, setHourlyCost } from "@/lib/auth.functions";
import { timeLines } from "@/lib/invoice-labor";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = flat(read("supabase/migrations/20261120500000_profile_labor_costs.sql"));
const SERVER = flat(read("src/lib/invoices.server.ts"));
const PAGE = flat(read("src/routes/admin.users.tsx"));
const run = <T>(fn: unknown, db: unknown, data: unknown, userId = ADMIN) =>
  (fn as (a: unknown) => Promise<T>)({ data, context: { supabase: db, userId } });

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AMY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NAMES = new Map([
  [LEAD, "Dale Lead"],
  [AMY, "Amy Tech"],
  [BOB, "Bob Tech"],
]);
// The rate table: a technician bills 90 and costs 90, a helper 60 and 60 (cost typed as price).
const RATES = {
  "tech:labor": { bill: 90, cost: 90 },
  "tech:travel": { bill: 50, cost: 90 },
  "helper:labor": { bill: 60, cost: 60 },
  "helper:travel": { bill: 40, cost: 60 },
};
const time = (id: number, kind: string, hours: number, over: Record<string, unknown> = {}) => ({
  id,
  kind,
  hours,
  helper_count: 0,
  technician_id: LEAD,
  on_date: "2027-03-02",
  ...over,
});

describe("the cost of a line is the cost of whoever did the work", () => {
  const crew = [
    { technician_id: LEAD, sort: 0, bill_rate: null },
    { technician_id: AMY, sort: 1, bill_rate: null },
    { technician_id: BOB, sort: 2, bill_rate: null },
  ];
  const costs = new Map([
    [LEAD, 38],
    [AMY, 24.5],
  ]);

  it("labor: each named person at their own hourly cost, and the price is not touched", () => {
    const lines = timeLines({
      times: [time(8, "labor", 2)],
      rates: RATES,
      crew,
      techName: NAMES,
      profileRates: new Map(),
      profileCosts: costs,
    });
    expect(lines.map((l) => [l.description, l.rate, l.total, l.cost_rate, l.cost_total])).toEqual([
      ["Dale Lead — Labor", 90, 180, 38, 76],
      ["Amy Tech — Labor", 60, 120, 24.5, 49],
      // Nobody has typed Bob's: the rate table's cost, as before.
      ["Bob Tech — Labor", 60, 120, 60, 120],
    ]);
  });
  it("travel too: an hour on the road is paid as an hour on the roof", () => {
    const lines = timeLines({
      times: [time(7, "travel", 1.5)],
      rates: RATES,
      crew,
      techName: NAMES,
      profileRates: new Map(),
      profileCosts: costs,
    });
    expect(lines.map((l) => [l.description, l.rate, l.cost_rate, l.cost_total])).toEqual([
      ["Dale Lead — Travel", 50, 38, 57],
      ["Amy Tech — Travel", 40, 24.5, 36.75],
      ["Bob Tech — Travel", 40, 60, 90],
    ]);
  });
  it("an old-style ticket: the technician at their own cost, an unnamed helper at the table's", () => {
    const lines = timeLines({
      times: [time(9, "labor", 3, { helper_count: 1 })],
      rates: RATES,
      crew: [],
      techName: NAMES,
      profileRates: new Map(),
      profileCosts: costs,
    });
    expect(lines.map((l) => [l.description, l.cost_rate, l.cost_total])).toEqual([
      ["Dale Lead — Labor", 38, 114],
      ["Helper — Labor", 60, 180],
    ]);
  });
  it("with no cost typed for anyone, every line is as it was", () => {
    const base = { times: [time(8, "labor", 2)], rates: RATES, crew, techName: NAMES };
    const before = timeLines({ ...base, profileRates: new Map() });
    const after = timeLines({ ...base, profileRates: new Map(), profileCosts: new Map() });
    expect(after).toEqual(before);
    expect(before.map((l) => l.cost_rate)).toEqual([90, 60, 60]);
  });
  it("a cost of nothing is a cost, typed on purpose: it is not read as blank", () => {
    const [l] = timeLines({
      times: [time(8, "labor", 2)],
      rates: RATES,
      crew: [crew[0]!],
      techName: NAMES,
      profileRates: new Map(),
      profileCosts: new Map([[LEAD, 0]]),
    });
    expect([l?.cost_rate, l?.cost_total]).toEqual([0, 0]);
  });
  it("the invoice builder reads the costs with the invoice's own client and hands them on", () => {
    expect(SERVER).toContain('sb.rpc("technician_cost_rates"),');
    expect(SERVER).toContain(
      "if (r.hourly_cost != null) profileCost.set(r.id, Number(r.hourly_cost));",
    );
    expect(SERVER).toContain("profileCosts: profileCost,");
    expect(SERVER).toContain(
      "if (costErr) throw new Error(`What an hour of each person costs: ${costErr.message}`);",
    );
  });
});

describe("pay is the admins' alone", () => {
  it("its own table, not a column of the person's own row, readable and writable by admins", () => {
    expect(SQL).toContain(
      "profile_id uuid primary key references public.profiles (id) on delete cascade,",
    );
    expect(SQL).toContain("updated_by uuid references public.profiles (id) on delete set null");
    expect(SQL).toContain("alter table public.profile_labor_costs enable row level security;");
    expect(SQL).toMatch(
      /for all to authenticated using \(\(select public\.is_admin\(\)\)\) with check \(\(select public\.is_admin\(\)\)\);/,
    );
    expect(SQL).toContain("revoke all on public.profile_labor_costs from anon, authenticated;");
    // No figure is typed into the repository.
    expect(SQL).not.toMatch(/insert into public\.profile_labor_costs/);
  });
  it("whoever builds an invoice gets the figures through one function, and nobody else", () => {
    expect(SQL).toContain(
      "where (public.is_admin() or public.is_manager() or public.is_sales_pm());",
    );
    expect(SQL).toContain(
      "revoke all on function public.technician_cost_rates() from public, anon;",
    );
  });

  const world = () => ({
    profiles: [
      {
        id: ADMIN,
        email: "a@x",
        full_name: "Ann Admin",
        role: "admin",
        access: [],
        technician: false,
      },
      {
        id: LEAD,
        email: "d@x",
        full_name: "Dale Lead",
        role: "user",
        access: ["service"],
        technician: true,
      },
      {
        id: AMY,
        email: "m@x",
        full_name: "Amy Tech",
        role: "user",
        access: ["service"],
        technician: true,
      },
    ],
    profile_labor_costs: [{ profile_id: LEAD, hourly_cost: 38 }],
  });

  it("the Users list carries each person's cost for an admin, blank where none is typed", async () => {
    const env = fakeSupabase(world());
    const users = await run<{ id: string; hourly_cost?: number | null }[]>(listUsers, env.db, {});
    expect(users.map((u) => [u.id, u.hourly_cost])).toEqual([
      [ADMIN, null],
      [LEAD, 38],
      [AMY, null],
    ]);
  });
  it("anyone who is not an admin is refused, to read and to set", async () => {
    const env = fakeSupabase(world());
    await expect(run(listUsers, env.db, {}, LEAD)).rejects.toThrow();
    await expect(run(setHourlyCost, env.db, { id: AMY, hourly_cost: 20 }, LEAD)).rejects.toThrow();
    expect(env.tables["profile_labor_costs"]).toHaveLength(1);
  });
  it("an admin types one, changes it and takes it away", async () => {
    const env = fakeSupabase(world());
    expect(await run(setHourlyCost, env.db, { id: AMY, hourly_cost: 24.456 })).toEqual({
      id: AMY,
      hourly_cost: 24.46,
    });
    expect(env.tables["profile_labor_costs"]!.find((r) => r["profile_id"] === AMY)).toMatchObject({
      hourly_cost: 24.46,
      updated_by: ADMIN,
    });
    await run(setHourlyCost, env.db, { id: AMY, hourly_cost: 26 });
    expect(
      env.tables["profile_labor_costs"]!.filter((r) => r["profile_id"] === AMY).map(
        (r) => r["hourly_cost"],
      ),
    ).toEqual([26]);
    expect(await run(setHourlyCost, env.db, { id: AMY, hourly_cost: null })).toEqual({
      id: AMY,
      hourly_cost: null,
    });
    expect(env.tables["profile_labor_costs"]!.some((r) => r["profile_id"] === AMY)).toBe(false);
  });
  it("a figure below nothing, or not a number, is refused", () => {
    expect(() => run(setHourlyCost, {}, { id: AMY, hourly_cost: -1 })).toThrow();
    expect(() => run(setHourlyCost, {}, { id: AMY, hourly_cost: "40" })).toThrow();
    expect(() => run(setHourlyCost, {}, { id: "nobody", hourly_cost: 40 })).toThrow();
  });
});

describe("the Users & access page", () => {
  it("has an Hourly cost box beside the bill rate, blank until typed", () => {
    expect(PAGE).toContain("<TableHead title={HOURLY_COST_HELP}>Hourly cost</TableHead>");
    expect(PAGE).toContain("value={u.hourly_cost ?? null}");
    expect(PAGE).toContain("onCommit={(v) => costMut.mutate({ id: u.id, hourly_cost: v })}");
    expect(PAGE).toContain("Only admins see it here.");
  });
});
