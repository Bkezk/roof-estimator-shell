/**
 * The Customers list, Nov 2 (the owner, from the page's suggestions):
 *
 *  1. Sort choices (lib/customer-list-sort.ts): Name A–Z, Most tickets in progress, Recently
 *     updated, Account manager — a Sort select beside the account-manager filter.
 *  4. The list downloads only the card's columns (LIST_COLUMNS), not every column: with 635
 *     customers the request was about 800 KB.
 *  5. The list keeps for two minutes (ACCOUNTS_STALE_MS) instead of fetching again on every
 *     visit; a save still refreshes it at once.
 *  7. A phone number and an email on a card are real tel: / mailto: links; the card is a div
 *     that opens the customer, the name the link. The customer header's phones dial the digits.
 *  8. The customer's physical address has "Open in maps" (lib/maps-link.ts).
 *
 * Fails on the old code: no sort module, select("*"), no stale time, the card one <Link>, a
 * plain `tel:${n}`, no map link.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { LIST_COLUMNS, listAccounts } from "@/lib/crm.functions";
import { CUSTOMER_SORTS, isCustomerSort, sortCustomers } from "@/lib/customer-list-sort";
import { mapsUrl, telHref } from "@/lib/maps-link";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("1. sort choices", () => {
  const rows = [
    {
      name: "Boyd Cat",
      open_jobs: 0,
      updated_at: "2026-10-01T00:00:00Z",
      account_manager_id: "u2",
    },
    {
      name: "Adair Mark",
      open_jobs: 2,
      updated_at: "2026-11-01T00:00:00Z",
      account_manager_id: null,
    },
    { name: "5K, Inc", open_jobs: 6, updated_at: "2026-09-01T00:00:00Z", account_manager_id: "u1" },
    { name: "acme", open_jobs: 2, updated_at: "2026-11-01T00:00:00Z", account_manager_id: "u1" },
  ];
  const manager = (u: string) => ({ u1: "RoAnna Sims", u2: "Brandon Keck" })[u];
  const names = (sort: Parameters<typeof sortCustomers>[1]) =>
    sortCustomers(rows, sort, manager).map((r) => r.name);
  it("the four choices, name first", () => {
    expect(CUSTOMER_SORTS.map((s) => s.id)).toEqual(["name", "tickets", "updated", "manager"]);
    expect(isCustomerSort("tickets")).toBe(true);
    expect(isCustomerSort("money")).toBe(false);
  });
  it("name: A–Z, case-insensitive", () => {
    expect(names("name")).toEqual(["5K, Inc", "acme", "Adair Mark", "Boyd Cat"]);
  });
  it("tickets: most in progress first, then the name", () => {
    expect(names("tickets")).toEqual(["5K, Inc", "acme", "Adair Mark", "Boyd Cat"]);
  });
  it("updated: newest change first, then the name", () => {
    expect(names("updated")).toEqual(["acme", "Adair Mark", "Boyd Cat", "5K, Inc"]);
  });
  it("manager: by the manager's name, the unassigned last, the name within", () => {
    expect(names("manager")).toEqual(["Boyd Cat", "5K, Inc", "acme", "Adair Mark"]);
    // The caller's rows are not reordered in place.
    expect(rows[0]!.name).toBe("Boyd Cat");
  });
  it("the page: a Sort select with the choices, feeding sortCustomers", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain('<SelectTrigger aria-label="Sort customers">');
    expect(page).toContain("{CUSTOMER_SORTS.map((s) => (");
    expect(page).toContain("const rows = sortCustomers(");
  });
});

describe("4. the list reads only the card's columns", () => {
  let env: ReturnType<typeof fakeSupabase>;
  beforeEach(() => {
    const accounts: Row[] = [
      {
        id: id(1),
        name: "Acme",
        kind: "company",
        contact_name: "Pat",
        phone: "(606) 555-0100",
        mobile: null,
        email: "pat@acme.test",
        address1: "1 Main St",
        address2: "Suite 2",
        city: "Corbin",
        state: "KY",
        zip: "40701",
        external_id: "123",
        account_manager_id: null,
        updated_at: "2026-11-01T00:00:00Z",
        deleted_at: null,
        notes: "the long notes",
        billing_instructions: "PO needed",
        mailing_address1: "PO Box 1",
        centerpoint_company_id: "cp1",
      },
    ];
    env = fakeSupabase({
      profiles: [{ id: ME, role: "user", access: ["customers"], full_name: "P", email: "p@x" }],
      crm_accounts: accounts,
      crm_sites: [{ id: "s1", account_id: id(1), deleted_at: null }],
      service_jobs: [{ id: "j1", account_id: id(1), stage: "open", deleted_at: null }],
    });
  });
  it("the row carries the card's fields and the counts; not notes, billing, mailing, CenterPoint ids", async () => {
    const rows = await (listAccounts as unknown as (a: { context: unknown }) => Promise<Row[]>)({
      context: { supabase: env.db, userId: ME },
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r).toMatchObject({
      id: id(1),
      name: "Acme",
      contact_name: "Pat",
      email: "pat@acme.test",
      city: "Corbin",
      external_id: "123",
      updated_at: "2026-11-01T00:00:00Z",
      site_count: 1,
      open_jobs: 1,
    });
    for (const k of [
      "notes",
      "billing_instructions",
      "mailing_address1",
      "centerpoint_company_id",
      "address2",
    ])
      expect(r).not.toHaveProperty(k);
    expect(Object.keys(r).sort()).toEqual(
      [...LIST_COLUMNS.split(",").map((c) => c.trim()), "site_count", "open_jobs"].sort(),
    );
  });
  it("the server selects LIST_COLUMNS for the list, never *", () => {
    const src = read("src/lib/crm.functions.ts");
    const fn = src.slice(
      src.indexOf("export const listAccounts"),
      src.indexOf("export const LIST_COLUMNS") > 0 ? src.indexOf("export const getAccount") : 0,
    );
    // LIST_SELECT since Nov 10: LIST_COLUMNS and the two counted child lists, in one read.
    expect(fn).toMatch(/\.from\("crm_accounts"\)\s*\.select\(LIST_SELECT\)/);
    expect(src).toContain("export const LIST_SELECT: string = `${LIST_COLUMNS}, sites:");
    expect(fn).not.toMatch(/\.from\("crm_accounts"\)\s*\.select\("\*"\)/);
  });
});

describe("5. the list keeps two minutes", () => {
  it("the accounts query has the stale time; saves still invalidate it", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain("export const ACCOUNTS_STALE_MS = 2 * 60_000;");
    const list = page.slice(
      page.indexOf("function AccountList("),
      page.indexOf("function AccountDetailPane("),
    );
    expect(list).toContain(
      'queryKey: ["accounts"],\n    queryFn: () => listFn(),\n    enabled: !!session,',
    );
    expect(list).toContain("staleTime: ACCOUNTS_STALE_MS,");
    expect(
      page.match(/invalidateQueries\(\{ queryKey: \["accounts"\] \}\)/g)!.length,
    ).toBeGreaterThanOrEqual(4);
  });
});

describe("7. phones and emails are links", () => {
  it("telHref dials the digits", () => {
    expect(telHref("(606) 772-7217")).toBe("tel:6067727217");
    expect(telHref("+1 606-772-7217 ext 2")).toBe("tel:+16067727217 2".replace(" ", ""));
  });
  it("the card: a div that opens the customer, the name a Link, tel: and mailto: links that do not open it", () => {
    const page = read("src/components/customers-page.tsx");
    const card = page.slice(
      page.indexOf("function AccountCard("),
      page.indexOf("export function CustomerPage("),
    );
    expect(card).not.toContain(
      '<Link\n      to="/customers/$id"\n      params={{ id: a.id }}\n      className="block rounded-lg',
    );
    expect(card).toContain("data-customer-card={a.id}\n      onClick={open}");
    expect(card).toContain(
      'const open = () => void navigate({ to: "/customers/$id", params: { id: a.id } });',
    );
    expect(card).toContain("href={telHref((a.mobile || a.phone)!)}");
    expect(card).toContain("href={telHref(a.phone)}");
    expect(card).toContain("href={`mailto:${a.email}`}");
    expect(card.match(/onClick=\{stop\}/g)!.length).toBeGreaterThanOrEqual(4);
  });
  it("the customer header dials the digits too", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain('<a href={telHref(n)} className="underline-offset-2 hover:underline">');
    expect(page).not.toContain("href={`tel:${n}`}");
  });
});

describe("8. the physical address opens in maps", () => {
  it("mapsUrl: the address as a maps search; nothing for a blank", () => {
    expect(mapsUrl("300 Refinery Road, Somerset, KY 42501")).toBe(
      "https://maps.google.com/?q=300%20Refinery%20Road%2C%20Somerset%2C%20KY%2042501",
    );
    expect(mapsUrl("  ")).toBeNull();
    expect(mapsUrl(null)).toBeNull();
  });
  it("the header's Physical address row carries the link in a new tab", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain('const mapHref = mapsUrl(physical.join(", "));');
    expect(page).toContain('data-link="map"');
    expect(page).toContain('<MapIcon className="h-3.5 w-3.5" aria-hidden /> Open in maps');
  });
});
