/**
 * crm_followups_write was `for all` with a Service clause (the sixth audit, Oct 21; item 3): a
 * FOR ALL policy also grants SELECT, so a technician-only token read every follow-up (proved
 * live: 35 of 35, 2 their own). 20261021090000_followups_write_split.sql drops it and creates
 * crm_followups_insert / _update / _delete with the same rule (customers or service or
 * assignee_id = auth.uid()); reads are crm_followups_read's alone (customers or own). The app
 * twin: followups.functions.ts listFollowups scopes a caller without Customers access to
 * assignee_id = me on the server (like listMyWork).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { listFollowups } from "@/lib/followups.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const MIG = "supabase/migrations/20261021090000_followups_write_split.sql";

const TECH = "00000000-0000-4000-8000-00000000000a";
const OFFICE = "00000000-0000-4000-8000-00000000000b";
const SERVICE_ONLY = "00000000-0000-4000-8000-00000000000c";
const MANAGER = "00000000-0000-4000-8000-00000000000e";
const OTHER = "00000000-0000-4000-8000-00000000000f";

const profiles: Row[] = [
  { id: TECH, role: "user", access: ["service"], technician: true, full_name: "Tim", email: "t@x" },
  {
    id: OFFICE,
    role: "user",
    access: ["service", "customers", "estimate"],
    technician: false,
    full_name: "Olive",
    email: "o@x",
  },
  // Service without Customers: RLS gives them their own rows only (crm_followups_read).
  {
    id: SERVICE_ONLY,
    role: "user",
    access: ["service"],
    technician: false,
    full_name: "Sam",
    email: "s@x",
  },
  { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Max", email: "m@x" },
  { id: OTHER, role: "user", access: ["service"], technician: true, full_name: "Oz", email: "z@x" },
];
const followup = (id: string, assignee: string, over: Row = {}): Row => ({
  id,
  kind: "ticket",
  item_id: `item-${id}`,
  assignee_id: assignee,
  status: "open",
  due_at: `2026-10-2${id.length}T12:00:00Z`,
  ...over,
});

function world() {
  return fakeSupabase({
    profiles: profiles.map((p) => ({ ...p })),
    crm_followups: [
      followup("f1", TECH),
      followup("f2", OTHER),
      followup("f3", OFFICE),
      followup("f4", TECH, { status: "closed" }),
    ],
  });
}
const call = <T>(fn: unknown, data: unknown, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;
const ids = (rows: Row[]) => rows.map((r) => r["id"]).sort();

describe("listFollowups", () => {
  it("a technician-only user gets their own follow-ups only (the old code returned every row)", async () => {
    const rows = await call<Row[]>(listFollowups, {}, world().db, TECH);
    expect(ids(rows)).toEqual(["f1"]);
    const all = await call<Row[]>(listFollowups, { include_closed: true }, world().db, TECH);
    expect(ids(all)).toEqual(["f1", "f4"]);
  });
  it("a Service-only office user (no Customers) is scoped the same way, as crm_followups_read scopes them", async () => {
    expect(ids(await call<Row[]>(listFollowups, {}, world().db, SERVICE_ONLY))).toEqual([]);
  });
  it("Customers access and a manager read everyone's, unscoped", async () => {
    expect(ids(await call<Row[]>(listFollowups, {}, world().db, OFFICE))).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
    expect(ids(await call<Row[]>(listFollowups, {}, world().db, MANAGER))).toEqual([
      "f1",
      "f2",
      "f3",
    ]);
  });
  it("the scope is the server's own line", () => {
    const s = read("src/lib/followups.functions.ts");
    expect(s).toMatch(
      /listFollowups = createServerFn[\s\S]*?const p = await me\(context\);\s*let q = sb\.from\("crm_followups"\)[\s\S]*?if \(!canAccess\(p, "customers"\)\) q = q\.eq\("assignee_id", context\.userId\);/,
    );
  });
});

describe("the migration", () => {
  const sql = read(MIG);
  const f = flat(sql);
  const RULE =
    "public.has_access('customers') or public.has_access('service') or assignee_id = auth.uid()";
  it("drops crm_followups_write and says why (FOR ALL grants SELECT)", () => {
    expect(f).toContain("drop policy if exists crm_followups_write on public.crm_followups;");
    expect(sql).toMatch(/FOR ALL policy also grants SELECT/);
    expect(f).not.toMatch(/create policy \w+ on public\.crm_followups for all/);
  });
  it("creates insert (with check), update (using + with check) and delete (using) with the same rule", () => {
    expect(f).toContain(
      `drop policy if exists crm_followups_insert on public.crm_followups; create policy crm_followups_insert on public.crm_followups for insert to authenticated with check (${RULE});`,
    );
    expect(f).toContain(
      `drop policy if exists crm_followups_update on public.crm_followups; create policy crm_followups_update on public.crm_followups for update to authenticated using (${RULE}) with check (${RULE});`,
    );
    expect(f).toContain(
      `drop policy if exists crm_followups_delete on public.crm_followups; create policy crm_followups_delete on public.crm_followups for delete to authenticated using (${RULE});`,
    );
    // The same rule the original FOR ALL policy had (20260927100000).
    const orig = flat(read("supabase/migrations/20260927100000_crm_followups.sql"));
    expect(orig).toContain(
      `create policy crm_followups_write on public.crm_followups for all to authenticated using (${RULE}) with check (${RULE});`,
    );
  });
  it("is idempotent, touches no other table, leaves the read policy and the sync functions alone", () => {
    const code = noComments(sql);
    expect((code.match(/create policy/g) ?? []).length).toBe(3);
    expect((code.match(/drop policy if exists/g) ?? []).length).toBe(4);
    expect(code).not.toMatch(/on public\.(?!crm_followups\b)\w+/);
    expect(code).not.toContain("crm_followups_read");
    expect(code).not.toMatch(/create or replace function/);
    // What a technician keeps reading, said in the header.
    expect(sql).toContain("assignee_id = auth.uid()");
    expect(sql).toMatch(/SECURITY DEFINER/);
  });
});
