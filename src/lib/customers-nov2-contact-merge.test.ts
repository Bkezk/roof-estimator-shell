/**
 * The customer's contact is one Primary contact row, look-alike warning, admin merge, and the
 * properties' warranties and named sites with the customer (owner, Nov 2, from the Customers
 * page suggestions). Migration 20261102190000_primary_contact_and_merge.sql; the live proof is
 * in the commit's notes.
 *
 *  2. crm_contacts.is_primary: one per customer; the customer's Contact / Cell phone / Office
 *     phone / Email mirror that row (trigger). quickCreateAccount makes the row from the dialog's
 *     contact fields; saveAccount drops the four fields when the customer has a primary;
 *     listContacts puts the primary first; the Edit form no longer has the four inputs; the
 *     header reads "Primary contact".
 *  3. The New customer dialog warns of customers whose name looks like the one typed
 *     (customer-lookalike.ts, similarAccounts) with "Use this customer"; an admin merges one
 *     customer into another (mergeAccounts → merge_accounts, every table with an account_id).
 *  6. getAccount `detail` returns every property's warranties and named sites in two reads, and
 *     the page seeds the property cards' caches from them (seedPropertyCaches).
 *
 * Fails on the old code: no column, no functions, select per property, the old dialog.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/mention-notify", () => ({ sendMentions: vi.fn(async () => ({})) }));

import {
  getAccount,
  listContacts,
  mergeAccounts,
  primaryContactFromAccount,
  quickCreateAccount,
  saveAccount,
  similarAccounts,
  type AccountDetail,
} from "@/lib/crm.functions";
import { compactName, lookalikeCustomers, looksLikeCustomer } from "@/lib/customer-lookalike";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const MIG = "supabase/migrations/20261102190000_primary_contact_and_merge.sql";
const sql = (() => {
  try {
    return flat(MIG);
  } catch {
    return "";
  }
})();
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const S1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4444-8444-444444444444";
const call = <T>(fn: unknown, data: Row | undefined, userId: string, db: unknown) =>
  (fn as (a: { data?: Row; context: unknown }) => Promise<T>)({
    ...(data ? { data } : {}),
    context: { supabase: db, userId },
  });
const profiles = [
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ada", email: "a@x" },
  {
    id: OFFICE,
    role: "user",
    access: ["customers", "service"],
    technician: false,
    full_name: "Olive",
    email: "o@x",
  },
];

describe("2. the primary contact (migration)", () => {
  it("the column, one live primary per customer, the two triggers", () => {
    expect(sql).toContain(
      "alter table public.crm_contacts add column if not exists is_primary boolean not null default false;",
    );
    expect(sql).toContain(
      "create unique index if not exists crm_contacts_one_primary on public.crm_contacts (account_id) where is_primary and deleted_at is null;",
    );
    expect(sql).toContain(
      "create trigger crm_contacts_primary_before before insert or update on public.crm_contacts for each row execute function public.crm_contact_primary_before();",
    );
    expect(sql).toContain(
      "create trigger crm_contacts_primary_after after insert or update on public.crm_contacts for each row execute function public.crm_contact_primary_after();",
    );
  });
  it("before: a deleted contact is never primary; marking one unmarks the others; a primary must be reachable when the customer is", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.crm_contact_primary_before()"),
      sql.indexOf("create or replace function public.crm_contact_primary_after()"),
    );
    expect(fn).toContain("if new.deleted_at is not null then new.is_primary := false; end if;");
    expect(fn).toContain(
      "update public.crm_contacts c set is_primary = false where c.account_id = new.account_id and c.id <> new.id and c.is_primary;",
    );
    expect(fn).toContain("raise exception 'The primary contact needs an email or a phone number';");
  });
  it("after: the customer's four fields mirror the primary row, only when something differs", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.crm_contact_primary_after()"),
      sql.indexOf("drop trigger if exists crm_contacts_primary_before"),
    );
    expect(fn).toContain(
      "update public.crm_accounts a set contact_name = new.name, mobile = new.mobile, phone = new.office_phone, email = new.email where a.id = new.account_id and (a.contact_name is distinct from new.name or a.mobile is distinct from new.mobile or a.phone is distinct from new.office_phone or a.email is distinct from new.email);",
    );
  });
  it("backfill: the matching row by name is marked with its blanks filled; a customer with info and no row gets one; history triggers off meanwhile", () => {
    expect(sql).toContain("alter table public.crm_contacts disable trigger crm_contacts_audit;");
    expect(sql).toContain("alter table public.crm_accounts disable trigger crm_accounts_audit;");
    expect(sql).toContain("and lower(btrim(c.name)) = lower(btrim(a.contact_name))");
    expect(sql).toContain("mobile = coalesce(nullif(btrim(c.mobile), ''), m.a_mobile)");
    expect(sql).toContain("'The customer also had: ' || concat_ws(', ',");
    expect(sql).toContain(
      "insert into public.crm_contacts (account_id, name, mobile, office_phone, email, is_primary) select a.id, coalesce(nullif(btrim(a.contact_name), ''), a.name),",
    );
    expect(sql).toContain("alter table public.crm_contacts enable trigger crm_contacts_audit;");
    expect(sql).toContain(
      "alter table public.crm_accounts enable trigger crm_accounts_updated_at;",
    );
  });
  it("save_contact_with_sites takes is_primary on insert and update", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.save_contact_with_sites("),
      sql.indexOf("create or replace function public.merge_accounts("),
    );
    expect(fn).toContain(
      "insert into public.crm_contacts (account_id, name, position, email, mobile, office_phone, is_billing, is_primary, notes)",
    );
    expect(fn).toContain(
      "is_primary = case when p_contact ? 'is_primary' then coalesce((p_contact ->> 'is_primary')::boolean, false) else c.is_primary end",
    );
    expect(fn).toContain("security invoker");
  });
});

describe("2. the primary contact (server and page)", () => {
  let env: ReturnType<typeof fakeSupabase>;
  beforeEach(() => {
    env = fakeSupabase({
      profiles,
      crm_accounts: [
        {
          id: A,
          name: "Acme",
          kind: "company",
          contact_name: "Pat",
          phone: "(606) 555-0100",
          mobile: null,
          email: "pat@acme.test",
          deleted_at: null,
          notes: null,
        },
      ],
      crm_contacts: [
        {
          id: S1,
          account_id: A,
          name: "Pat",
          office_phone: "(606) 555-0100",
          is_primary: true,
          is_billing: false,
          deleted_at: null,
        },
        {
          id: S2,
          account_id: A,
          name: "Al",
          office_phone: null,
          is_primary: false,
          is_billing: true,
          deleted_at: null,
        },
      ],
      crm_site_contacts: [],
    });
  });
  it("primaryContactFromAccount: the typed person; the customer's own name when only a number; nothing without any", () => {
    expect(
      primaryContactFromAccount({
        id: A,
        name: "Acme",
        contact_name: " Pat ",
        phone: "1",
        mobile: null,
        email: "",
      }),
    ).toEqual({
      account_id: A,
      name: "Pat",
      mobile: null,
      office_phone: "1",
      email: null,
      is_primary: true,
    });
    expect(
      primaryContactFromAccount({
        id: A,
        name: "Acme",
        contact_name: null,
        phone: null,
        mobile: "2",
        email: null,
      }),
    ).toMatchObject({ name: "Acme", mobile: "2", is_primary: true });
    expect(
      primaryContactFromAccount({
        id: A,
        name: "Acme",
        contact_name: "",
        phone: "",
        mobile: null,
        email: " ",
      }),
    ).toBeNull();
  });
  it("quickCreateAccount writes the customer and its primary contact row", async () => {
    const hit = await call<Row>(
      quickCreateAccount,
      { name: "Boyd Cat", kind: "company", contact_name: "Lee", phone: "(606) 555-0199" },
      OFFICE,
      env.db,
    );
    const contact = env.tables["crm_contacts"]!.find((c) => c["account_id"] === hit["account_id"]);
    expect(contact).toMatchObject({
      name: "Lee",
      office_phone: "(606) 555-0199",
      is_primary: true,
    });
    expect(hit).toMatchObject({ account_name: "Boyd Cat", contact_name: "Lee" });
  });
  it("saveAccount: with a primary contact the four fields are dropped from the save; the rest saves", async () => {
    const row = await call<Row>(
      saveAccount,
      { id: A, name: "Acme Inc", contact_name: "Someone else", phone: "000", email: "x@y.test" },
      OFFICE,
      env.db,
    );
    expect(row).toMatchObject({
      name: "Acme Inc",
      contact_name: "Pat",
      phone: "(606) 555-0100",
      email: "pat@acme.test",
    });
    const w = env.writes.find((x) => x.table === "crm_accounts" && x.op === "update")!;
    expect(Object.keys(w.payload!)).not.toContain("contact_name");
    expect(Object.keys(w.payload!)).not.toContain("phone");
  });
  it("listContacts: the primary first, then billing, then the name", async () => {
    const rows = await call<Row[]>(listContacts, { account_id: A }, OFFICE, env.db);
    expect(rows.map((r) => r["name"])).toEqual(["Pat", "Al"]);
  });
  it("the page: Primary badge, the form's switch, the header's line, the Edit form without the four inputs", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain('data-badge="primary"');
    expect(page).toContain("is_primary: f.is_primary,");
    expect(page).toContain('row(\n            "Primary contact",');
    expect(page).not.toContain('{field("contact_name", "Contact")}');
    expect(page).not.toContain('{field("email", "Email", { type: "email" })}');
    expect(page).toContain(
      "const { contact_name: _cn, phone: _ph, mobile: _mo, email: _em, ...rest } = f;",
    );
    expect(page).toContain('data-note="primary-contact"');
  });
  it("primaryContactLine: the row's name and position; the nudge without one", async () => {
    const { primaryContactLine } = await import("@/components/customers-page");
    expect(primaryContactLine({ name: "Pat", position: "Facilities" }, "Pat")).toEqual({
      text: "Pat · Facilities",
      muted: false,
    });
    expect(primaryContactLine(null, "Pat")).toEqual({
      text: "Pat — no primary contact marked; mark one under Contacts",
      muted: true,
    });
    expect(primaryContactLine(null, null).text).toBe(
      "None — add one under Contacts and mark it primary",
    );
    expect(primaryContactLine(undefined, "Pat")).toEqual({ text: "…", muted: true });
  });
});

describe("3. look-alike names", () => {
  it("the same letters whatever the punctuation; one typo on six+; the bids' word likeness; never under three characters", () => {
    expect(compactName("D.D Roberts")).toBe("ddroberts");
    expect(looksLikeCustomer("DD Roberts", "D.D Roberts")).toBe(true);
    expect(looksLikeCustomer("boyd cat", "Boyd Cat")).toBe(true);
    expect(looksLikeCustomer("Pikevile Medical", "Pikeville Medical Center")).toBe(true);
    expect(looksLikeCustomer("Knox County BOE", "Knox County Board of Education")).toBe(true);
    expect(looksLikeCustomer("Acme", "Acme Roofing Supply")).toBe(false);
    expect(looksLikeCustomer("5K", "5K, Inc")).toBe(false);
    expect(looksLikeCustomer("Adair Mark LLC", "Adam Richardson")).toBe(false);
  });
  it("lookalikeCustomers: exact first, at most five", () => {
    const rows = [
      { id: "1", name: "Boyd Cat" },
      { id: "2", name: "Boyd Cat" },
      { id: "3", name: "Boyd Catering" },
      { id: "4", name: "Adair Mark LLC" },
    ];
    expect(lookalikeCustomers("boyd cat", rows).map((r) => r.id)).toEqual(["1", "2"]);
    expect(lookalikeCustomers("bo", rows)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: "Boyd Cat" }));
    expect(lookalikeCustomers("Boyd Cat", many)).toHaveLength(5);
  });
  it("similarAccounts reads the live names and sifts them; blank or short = none", async () => {
    const env = fakeSupabase({
      profiles,
      crm_accounts: [
        { id: A, name: "D.D Roberts", kind: "company", deleted_at: null, city: "Corbin" },
        { id: B, name: "Boyd Cat", kind: "company", deleted_at: null, city: null },
        { id: S1, name: "DD Roberts", kind: "company", deleted_at: "2026-01-01T00:00:00Z" },
      ],
    });
    const rows = await call<Row[]>(similarAccounts, { name: "DD Roberts" }, OFFICE, env.db);
    expect(rows.map((r) => r["name"])).toEqual(["D.D Roberts"]);
    expect(await call<Row[]>(similarAccounts, { name: "dd" }, OFFICE, env.db)).toEqual([]);
  });
  it("the dialog: the warning with Use this customer, from similarAccounts", () => {
    const src = read("src/components/crm/account-picker.tsx");
    expect(src).toContain('queryKey: ["similar-accounts", nameDebounced],');
    expect(src).toContain("data-lookalikes={lookalikes.length}");
    expect(src).toContain("Use this customer");
    expect(src).toContain("Save anyway if this really is a different customer.");
  });
});

describe("3. merge", () => {
  const tables = () => ({
    profiles,
    crm_accounts: [
      { id: A, name: "D.D Roberts", deleted_at: null },
      { id: B, name: "DD Roberts", deleted_at: null },
    ],
  });
  it("the migration: merge_accounts moves every table with an account_id, admins only, one record", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.merge_accounts("));
    expect(fn).toContain("security definer");
    expect(fn).toContain(
      "if not public.is_admin() then raise exception 'Only an admin can merge customers'; end if;",
    );
    for (const t of [
      "crm_sites",
      "crm_contacts",
      "service_jobs",
      "bids",
      "crm_opportunities",
      "tasks",
      "takeoffs",
      "documents",
      "crm_followups",
    ])
      expect(fn).toContain(`update public.${t} set account_id = p_keep`);
    expect(fn).toContain("customer_name = v_keep.name where account_id = p_drop");
    expect(fn).toContain("account_name = v_keep.name where account_id = p_drop");
    // A primary on both: the kept customer's stays.
    expect(fn).toContain(
      "update public.crm_contacts set is_primary = false where account_id = p_drop and is_primary;",
    );
    expect(fn).toContain("'Merged into ' || v_keep.name || ' on '");
    expect(fn).toContain(
      "insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes)",
    );
    expect(fn).toContain(
      "grant execute on function public.merge_accounts(uuid, uuid) to authenticated;",
    );
  });
  it("mergeAccounts: an admin calls merge_accounts(keep, drop) and gets the counts back", async () => {
    const env = fakeSupabase(tables(), {
      rpcs: {
        merge_accounts: (a) => ({
          kept: a["p_keep"],
          kept_name: "D.D Roberts",
          merged_from: "DD Roberts",
          properties: 2,
          contacts: 1,
          tickets: 0,
          bids: 0,
          opportunities: 0,
          tasks: 0,
          takeoffs: 0,
          documents: 0,
          followups: 0,
        }),
      },
    });
    const r = await call<Row>(mergeAccounts, { keep_id: A, drop_id: B }, ADMIN, env.db);
    expect(r).toMatchObject({ kept: A, kept_name: "D.D Roberts", properties: 2 });
    expect(env.rpcCalls).toEqual([{ fn: "merge_accounts", args: { p_keep: A, p_drop: B } }]);
  });
  it("not an admin, or the same customer twice: refused before the database", async () => {
    const env = fakeSupabase(tables(), { rpcs: { merge_accounts: () => ({}) } });
    await expect(call(mergeAccounts, { keep_id: A, drop_id: B }, OFFICE, env.db)).rejects.toThrow(
      "Only an admin can merge customers",
    );
    await expect(call(mergeAccounts, { keep_id: A, drop_id: A }, ADMIN, env.db)).rejects.toThrow(
      "Pick a different customer to merge into",
    );
    expect(env.rpcCalls).toEqual([]);
  });
  it("the page: Merge into… for admins, the dialog's picker and its red button", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain(
      "onMerge={isAdmin(profile) && !deleted ? () => setMerging(true) : undefined}",
    );
    expect(page).toContain('<Merge className="mr-1 h-4 w-4" /> Merge into…');
    expect(page).toContain("function MergeCustomerDialog({");
    expect(page).toContain('data-action="merge"');
    expect(page).toContain("mergeFn({ data: { keep_id: keep!.account_id, drop_id: account.id } })");
  });
});

describe("6. warranties and named sites with the customer", () => {
  let env: ReturnType<typeof fakeSupabase>;
  beforeEach(() => {
    env = fakeSupabase({
      profiles,
      crm_accounts: [{ id: A, name: "Acme", deleted_at: null }],
      crm_sites: [
        { id: S1, account_id: A, name: "Main", deleted_at: null },
        { id: S2, account_id: A, name: "Annex", deleted_at: null },
      ],
      service_jobs: [],
      tasks: [],
      crm_opportunities: [],
      bids: [],
      site_warranties: [
        {
          id: "w1",
          site_id: S1,
          manufacturer: "Duro-Last",
          kind: "15 NDL",
          number: null,
          start_date: "2020-01-01",
          end_date: "2035-01-01",
          notes: null,
        },
      ],
      property_sites: [
        { id: "p1", property_id: S2, name: "Gym", notes: null, sort: 1, deleted_at: null },
        { id: "p2", property_id: S2, name: "Cafeteria", notes: null, sort: 2, deleted_at: null },
        { id: "p3", property_id: S2, name: "Old", notes: null, sort: 3, deleted_at: "2026-01-01" },
      ],
    });
  });
  it("detail: both, by property id; a property with none is simply absent", async () => {
    const d = await call<AccountDetail>(getAccount, { id: A, detail: true }, OFFICE, env.db);
    expect(d.warranties).toEqual({
      [S1]: [expect.objectContaining({ manufacturer: "Duro-Last" })],
    });
    expect(d.property_sites![S2]!.map((p) => p.name)).toEqual(["Gym", "Cafeteria"]);
    expect(d.property_sites![S1]).toBeUndefined();
  });
  it("without detail (a ticket's customer): neither is read", async () => {
    const d = await call<AccountDetail>(getAccount, { id: A }, OFFICE, env.db);
    expect(d.warranties).toBeUndefined();
    expect(d.property_sites).toBeUndefined();
  });
  it("seedPropertyCaches fills every property's key, [] for the ones with none", async () => {
    const { seedPropertyCaches } = await import("@/components/customers-page");
    const set: [unknown, unknown][] = [];
    seedPropertyCaches({ setQueryData: (k: unknown, v: unknown) => set.push([k, v]) } as never, {
      sites: [{ id: S1 }, { id: S2 }] as never,
      warranties: { [S1]: [{ id: "w1" } as never] },
      property_sites: { [S2]: [{ id: "p1" } as never] },
    });
    expect(set).toEqual([
      [["site-warranties", S1], [{ id: "w1" }]],
      [["property-sites", S1], []],
      [["site-warranties", S2], []],
      [["property-sites", S2], [{ id: "p1" }]],
    ]);
  });
  it("the page asks for detail and seeds; the cards keep a stale time so they read nothing more", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain("const d = await getFn({ data: { id, detail: true } });");
    expect(page).toContain("seedPropertyCaches(qc, d);");
    expect(read("src/components/crm/site-warranties.tsx")).toContain(
      "staleTime: WARRANTIES_STALE_MS,",
    );
    expect(read("src/components/crm/property-sites.tsx")).toContain(
      "staleTime: PROPERTY_SITES_STALE_MS,",
    );
  });
});
