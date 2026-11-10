/**
 * Speed pass, Nov 10, finding 7: the Customers list drew every customer at once — 636 cards,
 * 22,398 page elements — and read every property and every open ticket as rows just to count
 * them. Typing the first letter of a search took 420 ms on a slow computer; scrolling stuttered;
 * and it grew in a straight line with the customer count.
 *
 *  1. The list is cut into blocks and only the blocks on or near the screen are drawn
 *     (lib/list-window.ts, components/windowed-list.tsx); the rest are empty boxes of the same
 *     height. The search, the filter and the sort run on EVERY customer before the cut.
 *  2. The properties and the tickets in progress are counted by the database in the same read
 *     as the customers (LIST_SELECT): one request, not three, and no rows shipped to count.
 *  3. The list no longer carries `deleted_at` (it holds live customers only).
 *
 * Fails on the old code: no list-window module, `rows.map(` straight to cards, three reads.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { LIST_COLUMNS, LIST_SELECT, listAccounts, shapeAccountList } from "@/lib/crm.functions";
import { matchesCustomerSearch, sortCustomers } from "@/lib/customer-list-sort";
import {
  WINDOW_BLOCK,
  WINDOW_MARGIN_PX,
  applySightings,
  blocksOf,
  drawnBlocks,
  emptyBlockHeight,
  guessedBlockHeight,
  measuredRowHeight,
} from "@/lib/list-window";
import { fakeSupabase, splitCountEmbeds } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("1a. the cut into blocks", () => {
  const rows = Array.from({ length: 636 }, (_, i) => ({ id: `c${i}` }));
  it("636 customers are 32 blocks of 20, in order, none lost or repeated", () => {
    const blocks = blocksOf(rows);
    expect(WINDOW_BLOCK).toBe(20);
    expect(blocks).toHaveLength(32);
    expect(blocks.map((b) => b.index)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(blocks[31]!.rows).toHaveLength(16);
    expect(blocks.flatMap((b) => b.rows)).toEqual(rows);
  });
  it("a block's key names its rows, so another search's block never borrows its height", () => {
    const [a] = blocksOf(rows);
    expect(a!.key).toBe("c0:c19:20");
    const [b] = blocksOf(rows.slice(1));
    expect(b!.key).not.toBe(a!.key);
    expect(blocksOf([])).toEqual([]);
    expect(blocksOf(rows.slice(0, 3), 2).map((x) => x.rows.length)).toEqual([2, 1]);
  });
});

describe("1b. which blocks are drawn", () => {
  it("only the ones near the screen", () => {
    expect([...drawnBlocks(32, new Set([4, 5, 6]))]).toEqual([4, 5, 6]);
  });
  it("the first paint, before the screen has been looked at: the top of the list", () => {
    expect([...drawnBlocks(32, new Set())]).toEqual([0]);
    expect([...drawnBlocks(0, new Set())]).toEqual([]);
  });
  it("a search that shortens the list from under a far scroll: the top, not empty boxes", () => {
    // Blocks 20–22 were on screen; the search leaves 3 customers (one block).
    expect([...drawnBlocks(1, new Set([20, 21, 22]))]).toEqual([0]);
    // Some of what was on screen still exists: those.
    expect([...drawnBlocks(22, new Set([20, 21, 22]))]).toEqual([20, 21]);
  });
  it("at 636 customers three drawn blocks are 60 cards, not 636", () => {
    const blocks = blocksOf(Array.from({ length: 636 }, (_, i) => ({ id: `c${i}` })));
    const drawn = drawnBlocks(blocks.length, new Set([0, 1, 2]));
    const cards = blocks.filter((b) => drawn.has(b.index)).reduce((n, b) => n + b.rows.length, 0);
    expect(cards).toBe(60);
    expect(WINDOW_MARGIN_PX).toBeGreaterThanOrEqual(600);
  });
  it("the screen-watcher's report: added, removed, and the same set back when nothing moved", () => {
    const near: ReadonlySet<number> = new Set([1, 2]);
    const next = applySightings(near, [
      { index: 3, near: true },
      { index: 1, near: false },
    ]);
    expect([...next].sort()).toEqual([2, 3]);
    expect(near.has(1)).toBe(true); // the old set is not changed in place
    expect(applySightings(near, [{ index: 2, near: true }])).toBe(near);
    expect(applySightings(near, [{ index: Number.NaN, near: true }])).toBe(near);
  });
});

describe("1c. the empty boxes keep the page its length", () => {
  it("a block never drawn is guessed from its rows; a drawn one keeps its own measure", () => {
    expect(guessedBlockHeight(20, 104, 8)).toBe(20 * 104 + 19 * 8);
    expect(guessedBlockHeight(0, 104, 8)).toBe(0);
    const block = { key: "a:b:20", rows: Array.from({ length: 20 }) };
    expect(emptyBlockHeight(block, new Map(), 104, 8)).toBe(2232);
    expect(emptyBlockHeight(block, new Map([["a:b:20", 3410.4]]), 104, 8)).toBe(3410);
    // Another block's measure is not this one's.
    expect(emptyBlockHeight(block, new Map([["x:y:20", 9999]]), 104, 8)).toBe(2232);
  });
  it("the guess learns the real card height (a phone's cards are taller)", () => {
    // Two drawn blocks: 20 cards in 3,552 px and 16 in 2,840 px, 8 px between cards.
    const px = measuredRowHeight(
      [
        { rows: 20, height: 3552 },
        { rows: 16, height: 2840 },
      ],
      8,
      104,
    );
    expect(px).toBeCloseTo((3552 - 19 * 8 + 2840 - 15 * 8) / 36, 6);
    expect(measuredRowHeight([], 8, 104)).toBe(104);
    expect(measuredRowHeight([{ rows: 20, height: 0 }], 8, 104)).toBe(104);
  });
});

describe("1d. the search covers every customer, drawn or not", () => {
  const book = Array.from({ length: 636 }, (_, i) => ({
    id: `c${i}`,
    name: `Customer ${String(i).padStart(3, "0")}`,
    city: i === 600 ? "Zebulon" : "Corbin",
    contact_name: i === 601 ? "Pat Needle" : null,
    external_id: i === 602 ? "CP-7781" : null,
    phone: i === 603 ? "(606) 555-0199" : null,
    mobile: null,
    email: i === 604 ? "needle@example.test" : null,
    open_jobs: 0,
    updated_at: "2026-11-01T00:00:00Z",
    account_manager_id: null,
  }));
  const find = (q: string) =>
    sortCustomers(
      book.filter((a) => matchesCustomerSearch(a, q.trim().toLowerCase())),
      "name",
      () => undefined,
    ).map((a) => a.id);
  it("a customer in the last block is found by city, contact, number, phone and email", () => {
    expect(find("zebulon")).toEqual(["c600"]);
    expect(find("Pat Needle")).toEqual(["c601"]);
    expect(find("cp-7781")).toEqual(["c602"]);
    expect(find("555-0199")).toEqual(["c603"]);
    expect(find("needle@")).toEqual(["c604"]);
    expect(find("Customer 635")).toEqual(["c635"]);
  });
  it("an empty box matches everyone; nonsense matches no one", () => {
    expect(find("")).toHaveLength(636);
    expect(find("zzzz")).toEqual([]);
  });
  it("the page filters and sorts all the rows, then hands the result to the windowed list", () => {
    const page = read("src/components/customers-page.tsx");
    const list = page.slice(
      page.indexOf("function AccountList("),
      page.indexOf("function AccountDetailPane("),
    );
    expect(list).toContain(
      "(list.data ?? []).filter((a) => matchesManager(a, manager) && matchesCustomerSearch(a, q)),",
    );
    expect(list).toContain("<WindowedList");
    expect(list).toContain("rows={rows}");
    expect(list).toContain('listName="customers"');
    // The cards are no longer mapped straight onto the page.
    expect(list).not.toContain("{rows.map((a) => (");
    // The count line still says how many matched of how many.
    expect(list).toContain("{rows.length} of {list.data.length} customer");
  });
  it("the windowed list draws near blocks and holds the others open with empty boxes", () => {
    const w = read("src/components/windowed-list.tsx");
    expect(w).toContain("const draw = drawnBlocks(blocks.length, near);");
    expect(w).toContain("new IntersectionObserver(");
    expect(w).toContain("rootMargin: `${WINDOW_MARGIN_PX}px 0px`");
    expect(w).toContain("data-empty");
    expect(w).toContain("aria-hidden");
    expect(w).toContain(
      "style={{ height: emptyBlockHeight(b, heights.current, rowPx.current, gap) }}",
    );
    // The list still carries the page's own hook (data-list) and each card its own.
    expect(w).toContain("data-list={listName}");
    expect(read("src/components/customers-page.tsx")).toContain("data-customer-card={a.id}");
  });
});

describe("2. the counts come with the customers, in one read", () => {
  function world() {
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
        city: "Corbin",
        state: "KY",
        zip: "40701",
        external_id: "123",
        account_manager_id: null,
        updated_at: "2026-11-01T00:00:00Z",
        deleted_at: null,
        notes: "never on the list",
      },
      { id: id(2), name: "Bare", kind: "individual", deleted_at: null },
      { id: id(3), name: "Gone", kind: "company", deleted_at: "2026-10-01T00:00:00Z" },
    ];
    const env = fakeSupabase({
      profiles: [{ id: ME, role: "user", access: ["customers"], full_name: "P", email: "p@x" }],
      crm_accounts: accounts,
      crm_sites: [
        { id: "s1", account_id: id(1), deleted_at: null },
        { id: "s2", account_id: id(1), deleted_at: null },
        { id: "s3", account_id: id(1), deleted_at: "2026-09-01T00:00:00Z" },
        { id: "s4", account_id: id(3), deleted_at: null },
      ],
      service_jobs: [
        { id: "j1", account_id: id(1), stage: "open", deleted_at: null },
        { id: "j2", account_id: id(1), stage: "scheduled", deleted_at: null },
        { id: "j3", account_id: id(1), stage: "done", deleted_at: null },
        { id: "j4", account_id: id(1), stage: "authorized", deleted_at: null },
        { id: "j5", account_id: id(1), stage: "invoiced", deleted_at: null },
        { id: "j6", account_id: id(1), stage: "closed", deleted_at: null },
        { id: "j7", account_id: id(1), stage: "open", deleted_at: "2026-10-02T00:00:00Z" },
      ],
    });
    const reads: string[] = [];
    const inner = env.db as unknown as { from: (t: string) => unknown };
    const db = {
      ...(env.db as object),
      from: (t: string) => {
        reads.push(t);
        return inner.from(t);
      },
    };
    return { db, reads };
  }
  const call = (db: unknown) =>
    (listAccounts as unknown as (a: { context: unknown }) => Promise<Row[]>)({
      context: { supabase: db, userId: ME },
    });

  it("properties and tickets in progress are right: deleted ones and finished tickets not counted", async () => {
    const { db } = world();
    const rows = await call(db);
    expect(rows.map((r) => r["name"])).toEqual(["Acme", "Bare"]);
    expect(rows[0]).toMatchObject({ site_count: 2, open_jobs: 4 });
    expect(rows[1]).toMatchObject({ site_count: 0, open_jobs: 0 });
  });
  it("one read of the customers; the properties and the tickets are never read as rows", async () => {
    const { db, reads } = world();
    await call(db);
    expect(reads.filter((t) => t === "crm_accounts")).toHaveLength(1);
    expect(reads).not.toContain("crm_sites");
    expect(reads).not.toContain("service_jobs");
  });
  it("a row carries the card's columns and the two counts; no deleted_at, no child lists", async () => {
    const { db } = world();
    const [acme] = await call(db);
    expect(Object.keys(acme!).sort()).toEqual(
      [...LIST_COLUMNS.split(",").map((c) => c.trim()), "site_count", "open_jobs"].sort(),
    );
    expect(LIST_COLUMNS).not.toContain("deleted_at");
    for (const k of ["sites", "jobs", "notes", "deleted_at"]) expect(acme).not.toHaveProperty(k);
  });
  it("the select counts through each child's own link, narrowed to live rows and open stages", () => {
    expect(LIST_SELECT).toBe(
      `${LIST_COLUMNS}, sites:crm_sites!crm_sites_account_id_fkey(count), jobs:service_jobs!service_jobs_account_id_fkey(count)`,
    );
    const src = read("src/lib/crm.functions.ts");
    const fn = src.slice(src.indexOf("export const listAccounts"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain(".select(LIST_SELECT)");
    expect(body).toContain('.is("deleted_at", null)');
    expect(body).toContain('.is("sites.deleted_at", null)');
    expect(body).toContain('.is("jobs.deleted_at", null)');
    expect(body).toContain('.in("jobs.stage", [...OPEN_TICKET_STAGES])');
    expect(body.match(/fetchAllPages\(/g)).toHaveLength(1);
    expect(body).not.toContain('.from("crm_sites")');
    expect(body).not.toContain('.from("service_jobs")');
    // The two links exist in the generated types under those names.
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toContain('foreignKeyName: "crm_sites_account_id_fkey"');
    expect(types).toContain('foreignKeyName: "service_jobs_account_id_fkey"');
  });
  it("shapeAccountList: the database's count as a plain number, whatever its shape", () => {
    const base = { id: "a", name: "A" } as never as Parameters<typeof shapeAccountList>[0][number];
    expect(
      shapeAccountList([
        { ...base, sites: [{ count: 3 }], jobs: [{ count: "2" }] },
        { ...base, sites: [], jobs: null },
        { ...base },
      ]).map((r) => [r.site_count, r.open_jobs]),
    ).toEqual([
      [3, 2],
      [0, 0],
      [0, 0],
    ]);
  });
});

describe("the test stand-in understands a counted child list", () => {
  it("splits the counted lists out of a select", () => {
    expect(splitCountEmbeds("id, name, sites:crm_sites!crm_sites_account_id_fkey(count)")).toEqual({
      rest: "id, name",
      embeds: [{ as: "sites", table: "crm_sites", fk: "account_id" }],
    });
    expect(splitCountEmbeds("id, name")).toEqual({ rest: "id, name", embeds: [] });
    expect(splitCountEmbeds(undefined)).toEqual({ rest: undefined, embeds: [] });
  });
});

describe("3. the card on a list of live customers", () => {
  it("the no-contact badge needs no deleted check on the list; the customer's own page keeps it", () => {
    const page = read("src/components/customers-page.tsx");
    const card = page.slice(
      page.indexOf("function AccountCard("),
      page.indexOf("export function seedPropertyCaches"),
    );
    expect(card).toContain("{!hasContactMethod(a) && <NoContactInfoBadge />}");
    expect(card).not.toContain("a.deleted_at");
    const pane = page.slice(page.indexOf("function AccountDetailPane("));
    expect(pane).toContain("{!a.deleted_at && !hasContactMethod(a) && <NoContactInfoBadge />}");
  });
});
