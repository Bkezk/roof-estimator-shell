/**
 * Technicians are fenced from the customer book at the database (the fifth audit, Oct 20; item
 * a). 20261020122000_technician_customer_fence.sql: crm_accounts / crm_sites / crm_contacts
 * SELECT = Customers or Estimate, or Service without the technician kind, or the row linked to
 * one of the caller's live tickets (tech_sees_account / tech_sees_site / tech_sees_contact —
 * SECURITY DEFINER STABLE, mirroring is_on_crew; sites and contacts also by their account, as
 * the ticket page's Property and Property contact boxes list them). The app: listAccounts
 * refuses a technician-only token (bookAccess); the technician's own reads — myDay's id lists,
 * getAccount / listContacts on the ticket page — are unchanged and the database filters them.
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

import { getAccount, listAccounts, listContacts } from "@/lib/crm.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const MIG = "supabase/migrations/20261020122000_technician_customer_fence.sql";

const TECH = "00000000-0000-4000-8000-00000000000a";
const OFFICE_TECH = "00000000-0000-4000-8000-00000000000b";
const EST = "00000000-0000-4000-8000-00000000000c";
const MANAGER = "00000000-0000-4000-8000-00000000000e";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const profiles: Row[] = [
  { id: TECH, role: "user", access: ["service"], technician: true, full_name: "Tim", email: "t@x" },
  // An office person ticked Technician keeps full visibility (owner, Oct 8).
  {
    id: OFFICE_TECH,
    role: "user",
    access: ["service", "customers", "estimate", "pricing", "invoices", "prospect", "takeoff"],
    technician: true,
    full_name: "Olive",
    email: "o@x",
  },
  { id: EST, role: "user", access: ["estimate"], technician: false, full_name: "Ed", email: "e@x" },
  { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Max", email: "m@x" },
];

function world() {
  const env = fakeSupabase({
    profiles: profiles.map((p) => ({ ...p })),
    crm_accounts: [{ id: ACC, name: "Bell County Schools", deleted_at: null, kind: "company" }],
    crm_sites: [],
    crm_contacts: [],
    crm_site_contacts: [],
    service_jobs: [],
    tasks: [],
    crm_opportunities: [],
    bids: [],
  });
  const reads: string[] = [];
  const base = env.db as unknown as { from: (t: string) => unknown; rpc: unknown };
  const db = {
    ...base,
    from: (t: string) => {
      if (t !== "profiles") reads.push(t);
      return base.from(t);
    },
  };
  return { env, reads, db };
}
const call = <T>(fn: unknown, data: unknown, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;

describe("listAccounts (the customer book)", () => {
  it("refuses a technician-only token before any row is read", async () => {
    const { db, reads } = world();
    await expect(call(listAccounts, undefined, db, TECH)).rejects.toThrow(
      "Forbidden: Customers access required",
    );
    expect(reads).toEqual([]);
  });
  it("serves an office person ticked Technician, an estimator and a manager", async () => {
    for (const who of [OFFICE_TECH, EST, MANAGER]) {
      const { db } = world();
      const rows = await call<Row[]>(listAccounts, undefined, db, who);
      expect(rows.map((r) => r["id"])).toEqual([ACC]);
    }
  });
  it("the ticket page's reads keep readAccess (the database hands a technician only their tickets' rows)", async () => {
    const { db } = world();
    const a = await call<{ account: Row | null }>(getAccount, { id: ACC }, db, TECH);
    expect(a.account?.["id"]).toBe(ACC);
    expect(await call(listContacts, { account_id: ACC }, db, TECH)).toEqual([]);
    const s = read("src/lib/crm.functions.ts");
    expect(s).toMatch(
      /async function bookAccess\(ctx: Ctx\) \{\s*const p = await readAccess\(ctx\);\s*if \(isFieldOnly\(p\)\) throw new Error\("Forbidden: Customers access required"\);/,
    );
    expect(s).toMatch(/listAccounts = createServerFn[\s\S]*?await bookAccess\(context\);/);
    expect(s).toMatch(/getAccount = createServerFn[\s\S]*?const p = await readAccess\(context\);/);
    expect(s).toMatch(/listContacts = createServerFn[\s\S]*?await readAccess\(context\);/);
  });
});

describe("myDay still selects by the tickets' id lists (unchanged)", () => {
  const s = read("src/lib/service-field.functions.ts");
  it("sites, contacts and accounts by id, from the technician's own tickets", () => {
    expect(s).toContain('.eq("technician_id", context.userId)');
    expect(s).toContain(
      'sb.from("crm_sites").select("id, technician_instructions").in("id", siteIds)',
    );
    expect(s).toContain(
      'sb.from("crm_contacts").select("id, name, mobile, office_phone").in("id", contactIds)',
    );
    expect(s).toContain('sb.from("crm_accounts").select("id, phone").in("id", accountIds)');
    expect(s).toMatch(/\.from\("site_warranties"\)[\s\S]*?\.in\("site_id", siteIds\)/);
  });
});

describe("the migration", () => {
  const sql = read(MIG);
  const f = flat(sql);
  it("the three helpers: SECURITY DEFINER STABLE over live tickets the caller leads or crews, granted to authenticated", () => {
    for (const [fn, arg, col] of [
      ["tech_sees_account", "acct", "account_id"],
      ["tech_sees_site", "site", "site_id"],
      ["tech_sees_contact", "contact", "contact_id"],
    ]) {
      expect(f).toContain(
        `create or replace function public.${fn}(${arg} uuid) returns boolean language sql stable security definer set search_path = public as $$ select ${arg} is not null and exists ( select 1 from public.service_jobs j where j.${col} = ${arg} and j.deleted_at is null and (j.technician_id = auth.uid() or public.is_on_crew(j.id)) ); $$;`,
      );
      expect(f).toContain(`revoke all on function public.${fn}(uuid) from public;`);
      expect(f).toContain(`grant execute on function public.${fn}(uuid) to authenticated;`);
    }
  });
  it("the three read policies: customers / estimate / service-not-technician / linked rows; sites and contacts also by account", () => {
    expect(f).toContain(
      "drop policy if exists crm_accounts_read on public.crm_accounts; create policy crm_accounts_read on public.crm_accounts for select to authenticated using (public.has_access('customers') or public.has_access('estimate') or (public.has_access('service') and not public.is_technician()) or public.tech_sees_account(id));",
    );
    expect(f).toContain(
      "drop policy if exists crm_sites_read on public.crm_sites; create policy crm_sites_read on public.crm_sites for select to authenticated using (public.has_access('customers') or public.has_access('estimate') or (public.has_access('service') and not public.is_technician()) or public.tech_sees_site(id) or public.tech_sees_account(account_id));",
    );
    expect(f).toContain(
      "drop policy if exists crm_contacts_read on public.crm_contacts; create policy crm_contacts_read on public.crm_contacts for select to authenticated using (public.has_access('customers') or public.has_access('estimate') or (public.has_access('service') and not public.is_technician()) or public.tech_sees_contact(id) or public.tech_sees_account(account_id));",
    );
    // The writes and the neighbouring tables are left alone, and said so.
    expect(f).not.toContain("_write");
    expect(f).not.toMatch(
      /create policy (property_sites|site_warranties|county_codes|crm_site_contacts)_read/,
    );
    for (const name of [
      "property_sites_read",
      "site_warranties_read",
      "county_codes_read",
      "crm_site_contacts_read",
    ])
      expect(sql).toContain(name);
  });
  it("is idempotent and replayable (the helpers it names are defined earlier, or in it before use)", () => {
    const code = noComments(sql);
    expect((code.match(/create policy/g) ?? []).length).toBe(3);
    expect((code.match(/drop policy if exists/g) ?? []).length).toBe(3);
    expect(sql).not.toMatch(/^create function\b/m);
    for (const h of ["tech_sees_account", "tech_sees_site", "tech_sees_contact"])
      expect(code.indexOf(`function public.${h}(`)).toBeLessThan(code.indexOf(`public.${h}(id)`));
  });
});
