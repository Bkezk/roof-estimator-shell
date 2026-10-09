/**
 * Audit, Oct 2: a deleted customer still opened, could be edited and "deleted" again (the second
 * Delete re-stamped deleted_at: the History read "deleted at X → Y"); nothing blocked deleting a
 * customer with open tickets or opportunities; its sites and contacts stayed live.
 *
 * The real server functions (crm.functions.ts) run against an in-memory stand-in for the
 * caller's Supabase client (src/test/fake-supabase.ts); createServerFn is reduced to "validate,
 * then call the handler". The page is checked from its source.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  deleteAccount,
  getAccount,
  restoreAccount,
  saveAccount,
  saveContact,
  saveSite,
  searchAccounts,
} from "@/lib/crm.functions";
import { deleteBlockedMessage, deletedLine } from "@/lib/crm-account";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const C2 = "44444444-4444-4444-8444-444444444444";
const OLD = "2026-09-01T10:00:00.000Z";

const office = {
  id: ME,
  role: "user",
  access: ["customers", "service"],
  technician: false,
  full_name: "Pat Office",
  email: "pat@example.com",
};
const manager = { ...office, id: MGR, role: "manager", access: [], full_name: "Mo Manager" };

let env: ReturnType<typeof fakeSupabase>;
function setup(opts: { tickets?: Row[]; opps?: Row[]; account?: Row; audit?: Row[] } = {}) {
  env = fakeSupabase({
    profiles: [office, manager],
    crm_accounts: [
      {
        id: ACC,
        name: "Acme Roofing",
        kind: "company",
        contact_name: "Al",
        phone: "555",
        email: "al@acme.example",
        deleted_at: null,
        ...opts.account,
      },
      { id: OTHER, name: "Acme Two", kind: "company", contact_name: null, phone: "1" },
    ],
    crm_sites: [
      { id: S1, account_id: ACC, name: "Main St", address1: "1 Main St", deleted_at: null },
      // Deleted on its own a month ago: stays deleted through a delete and a restore.
      { id: S2, account_id: ACC, name: "Old shed", address1: "9 Elm", deleted_at: OLD },
    ],
    crm_contacts: [
      { id: C1, account_id: ACC, name: "Al", deleted_at: null },
      { id: C2, account_id: ACC, name: "Gone", deleted_at: OLD },
    ],
    service_jobs: opts.tickets ?? [],
    crm_opportunities: opts.opps ?? [],
    audit_log: opts.audit ?? [],
  });
}
const ctx = (userId = ME) => ({ supabase: env.db, userId });
const call = <T = void>(fn: unknown, data: Row, userId = ME) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({ data, context: ctx(userId) });
const row = (table: string, id: string) => env.tables[table]!.find((r) => r["id"] === id)!;

const ticket = (id: string, stage: string, over: Row = {}): Row => ({
  id,
  account_id: ACC,
  stage,
  deleted_at: null,
  ...over,
});
const opp = (id: string, status: string, over: Row = {}): Row => ({
  id,
  account_id: ACC,
  status,
  deleted_at: null,
  ...over,
});

beforeEach(() => setup());

describe("deleteBlockedMessage / deletedLine (pure)", () => {
  it("names the counts in words; null when nothing is open", () => {
    expect(deleteBlockedMessage(2, 1)).toBe(
      "This customer has 2 open tickets and 1 open opportunity; close or move them first",
    );
    expect(deleteBlockedMessage(1, 0)).toBe(
      "This customer has 1 open ticket; close or move them first",
    );
    expect(deleteBlockedMessage(0, 3)).toBe(
      "This customer has 3 open opportunities; close or move them first",
    );
    expect(deleteBlockedMessage(0, 0)).toBeNull();
  });
  it("the banner line: date and who, or the date alone", () => {
    expect(deletedLine("2026-10-02T15:00:00Z", "Mo Manager")).toBe(
      "Deleted on Oct 2, 2026 by Mo Manager",
    );
    expect(deletedLine("2026-10-02T15:00:00Z", null)).toBe("Deleted on Oct 2, 2026");
    expect(deletedLine("2026-10-02T15:00:00Z", "  ")).toBe("Deleted on Oct 2, 2026");
  });
});

describe("deleteAccount", () => {
  it("is refused while the customer has open tickets / opportunities, naming the counts; nothing written", async () => {
    setup({
      tickets: [
        ticket("j1", "open"),
        ticket("j2", "scheduled"),
        ticket("j3", "invoiced"), // finished: does not block
        ticket("j4", "open", { deleted_at: OLD }), // deleted: does not block
        ticket("j5", "open", { account_id: OTHER }), // another customer's
      ],
      opps: [
        opp("o1", "quoted"),
        opp("o2", "won"), // closed: does not block
        opp("o3", "open", { deleted_at: OLD }),
      ],
    });
    await expect(call(deleteAccount, { id: ACC })).rejects.toThrow(
      "This customer has 2 open tickets and 1 open opportunity; close or move them first",
    );
    expect(env.writes).toEqual([]);
    expect(row("crm_accounts", ACC)["deleted_at"]).toBeNull();
  });
  it("a Done ticket (not yet invoiced) still blocks", async () => {
    setup({ tickets: [ticket("j1", "done")] });
    await expect(call(deleteAccount, { id: ACC })).rejects.toThrow(
      "This customer has 1 open ticket; close or move them first",
    );
    expect(env.writes).toEqual([]);
  });
  it("deletes the customer and its live sites and contacts with one stamp", async () => {
    setup({ tickets: [ticket("j3", "closed")], opps: [opp("o2", "lost")] });
    await call(deleteAccount, { id: ACC });
    const stamp = row("crm_accounts", ACC)["deleted_at"];
    expect(typeof stamp).toBe("string");
    expect(row("crm_sites", S1)["deleted_at"]).toBe(stamp);
    expect(row("crm_contacts", C1)["deleted_at"]).toBe(stamp);
    // Rows deleted before keep their own stamp.
    expect(row("crm_sites", S2)["deleted_at"]).toBe(OLD);
    expect(row("crm_contacts", C2)["deleted_at"]).toBe(OLD);
    expect(env.writes.map((w) => [w.table, w.op, w.rows])).toEqual([
      ["crm_accounts", "update", 1],
      ["crm_sites", "update", 1],
      ["crm_contacts", "update", 1],
    ]);
  });
  it("a second Delete is refused and changes nothing (no re-stamp)", async () => {
    await call(deleteAccount, { id: ACC });
    const stamp = row("crm_accounts", ACC)["deleted_at"];
    env.writes.length = 0;
    await expect(call(deleteAccount, { id: ACC })).rejects.toThrow(
      "This customer was already deleted",
    );
    expect(env.writes).toEqual([]);
    expect(row("crm_accounts", ACC)["deleted_at"]).toBe(stamp);
  });
  it("the deleted customer's sites and contacts leave the search (they are deleted)", async () => {
    expect((await call<{ account_id: string }[]>(searchAccounts, { q: "Main" })).length).toBe(1);
    await call(deleteAccount, { id: ACC });
    expect(await call(searchAccounts, { q: "Main" })).toEqual([]);
    expect(
      (await call<{ account_id: string }[]>(searchAccounts, { q: "Acme" })).map(
        (h) => h.account_id,
      ),
    ).toEqual([OTHER]);
  });
});

describe("restoreAccount", () => {
  it("is an admin's or a manager's", async () => {
    await call(deleteAccount, { id: ACC });
    env.writes.length = 0;
    await expect(call(restoreAccount, { id: ACC })).rejects.toThrow(
      "Only an admin or a manager can restore a customer",
    );
    expect(env.writes).toEqual([]);
  });
  it("clears deleted_at on the customer and the sites / contacts deleted with it", async () => {
    await call(deleteAccount, { id: ACC });
    await call(restoreAccount, { id: ACC }, MGR);
    expect(row("crm_accounts", ACC)["deleted_at"]).toBeNull();
    expect(row("crm_sites", S1)["deleted_at"]).toBeNull();
    expect(row("crm_contacts", C1)["deleted_at"]).toBeNull();
    // Deleted on their own before: still deleted.
    expect(row("crm_sites", S2)["deleted_at"]).toBe(OLD);
    expect(row("crm_contacts", C2)["deleted_at"]).toBe(OLD);
  });
  it("refuses a customer that is not deleted", async () => {
    await expect(call(restoreAccount, { id: ACC }, MGR)).rejects.toThrow(
      "This customer is not deleted",
    );
    expect(env.writes).toEqual([]);
  });
});

describe("a deleted customer takes no change", () => {
  const DELETED = "This customer was deleted; an admin or a manager can restore it";
  beforeEach(() => setup({ account: { deleted_at: OLD } }));
  it("saveAccount (an edit) is refused; nothing written", async () => {
    await expect(
      call(saveAccount, { id: ACC, name: "Acme Roofing Inc", kind: "company", phone: "555" }),
    ).rejects.toThrow(DELETED);
    expect(env.writes).toEqual([]);
  });
  it("saveSite and saveContact under it are refused; nothing written", async () => {
    await expect(call(saveSite, { account_id: ACC, name: "New site" })).rejects.toThrow(DELETED);
    await expect(call(saveSite, { id: S1, account_id: ACC, name: "Renamed" })).rejects.toThrow(
      DELETED,
    );
    await expect(call(saveContact, { account_id: ACC, name: "Bo" })).rejects.toThrow(DELETED);
    expect(env.writes).toEqual([]);
  });
});

describe("getAccount still opens a deleted customer (links must not 404)", () => {
  it("returns it with who deleted it from the audit log", async () => {
    setup({
      account: { deleted_at: "2026-10-02T15:00:00Z" },
      audit: [
        {
          id: 7,
          entity: "account",
          entity_id: ACC,
          action: "delete",
          by_name: "Mo Manager",
          at: "2026-10-02T15:00:00Z",
        },
      ],
    });
    const d = await call<{ account: Row; deleted_by: string | null }>(getAccount, { id: ACC }, MGR);
    expect(d.account["id"]).toBe(ACC);
    expect(d.account["deleted_at"]).toBe("2026-10-02T15:00:00Z");
    expect(d.deleted_by).toBe("Mo Manager");
  });
  it("who is null when the log has nothing for the reader (the banner shows the date alone)", async () => {
    setup({ account: { deleted_at: "2026-10-02T15:00:00Z" } });
    const d = await call<{ account: Row; deleted_by: string | null }>(getAccount, { id: ACC });
    expect(d.account["deleted_at"]).toBe("2026-10-02T15:00:00Z");
    expect(d.deleted_by).toBeNull();
  });
});

describe("searches and pickers leave deleted customers out", () => {
  it("searchAccounts: a deleted customer is not found by name, nor through a live site", async () => {
    // A legacy delete (before the cascade): the customer is deleted, its site is not.
    setup({ account: { deleted_at: OLD } });
    expect(await call(searchAccounts, { q: "Acme Roofing" })).toEqual([]);
    expect(await call(searchAccounts, { q: "1 Main" })).toEqual([]);
    expect(
      (await call<{ account_id: string }[]>(searchAccounts, { q: "" })).map((h) => h.account_id),
    ).toEqual([OTHER]);
  });
  it("searchAccounts and listAccounts filter deleted_at; the pickers read searchAccounts only", () => {
    const src = read("src/lib/crm.functions.ts");
    const search = src.slice(src.indexOf("export const searchAccounts"));
    expect(
      search.slice(0, search.indexOf("\nexport ")).match(/\.is\("deleted_at", null\)/g),
    ).toHaveLength(4);
    const list = src.slice(src.indexOf("export const listAccounts"));
    // Paged since Oct 2 (crm-list-paging.test.ts): the same filter, one page at a time.
    expect(list.slice(0, list.indexOf("\nexport "))).toMatch(
      /\.from\("crm_accounts"\)\s*\.select\("\*"\)\s*\.is\("deleted_at", null\)/,
    );
    const picker = read("src/components/crm/account-picker.tsx");
    expect(picker).toContain("useServerFn(searchAccounts)");
    expect(picker).not.toMatch(/listAccounts|from\("crm_accounts"\)/);
    // The ticket's and the opportunity's customer box are that picker.
    expect(read("src/components/opportunities-page.tsx")).toContain("<AccountPicker");
  });
});

describe("the Customers page on a deleted customer (source)", () => {
  const page = read("src/components/customers-page.tsx");
  it("shows a 'Deleted on <date> by …' banner", () => {
    expect(page).toContain('data-banner="deleted"');
    expect(page).toContain("{deletedLine(d.account.deleted_at, d.deleted_by)}");
  });
  it("passes read-only to every block when deleted", () => {
    expect(page).toContain("const deleted = !!d.account.deleted_at;");
    expect(page).toMatch(/<AccountBlock\s+account=\{d\.account\}\s+readOnly=\{deleted\}/);
    expect(page).toContain("<ContactsSection accountId={id} sites={d.sites} readOnly={deleted} />");
    expect(page).toContain("<SitesSection accountId={id} sites={d.sites} readOnly={deleted} />");
    expect(page).toContain("<BidsSection accountId={id} bids={d.bids} readOnly={deleted} />");
  });
  it("hides Edit / Delete / New ticket and never opens the form when read-only", () => {
    expect(page).toMatch(/\{!props\.readOnly && \(\s*<>\s*<Button[^]*?<Pencil[^]*?Delete customer/);
    expect(page).toContain(
      'const canNewTicket = can("service") && dispatchesTickets(profile) && !props.readOnly;',
    );
    expect(page).toContain("if (editing && !readOnly)");
  });
  it("hides the site, contact and bid-link actions when read-only", () => {
    expect(page).toContain('{!readOnly && editing !== "new" && (');
    expect(page.match(/\{!readOnly && editing !== "new" && \(/g)).toHaveLength(2); // Add contact, Add site
    expect(page.match(/\{!readOnly && editing === "new" && \(/g)).toHaveLength(2);
    expect(page).toContain("!readOnly && editing === c.id ? (");
    expect(page).toContain("!readOnly && editing === s.id ? (");
    expect(page).toContain(
      'const canNewTicket = can("service") && dispatchesTickets(profile) && !readOnly;',
    );
    expect(page).toContain("{!readOnly && !linking && (");
    expect(page).toContain("{!readOnly && !!suggested.data?.length && (");
    expect(page).toContain("{!readOnly && linking && (");
  });
  it("offers Restore to admins and managers only", () => {
    expect(page).toContain("const canRestore = seesEveryone(profile);");
    expect(page).toMatch(/\{canRestore && \(\s*<Button[^]*?restore\.mutate\(\)[^]*?Restore/);
    expect(page).toContain("useServerFn(restoreAccount)");
  });
});
