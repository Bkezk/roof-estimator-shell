/**
 * Audit, Oct 2, item 9: listAccounts asked for `.limit(2000)` (Supabase's PostgREST returns at
 * most 1,000 rows per request) and counted sites and open tickets from unlimited selects that
 * the same cap cut at 1,000 rows — CenterPoint has 1,139 properties. It now reads every row
 * 1,000 at a time (fetchAllPages, `.range`).
 *
 * The stand-in caps every select at 1,000 rows like the real server (`maxRows`).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { listAccounts } from "@/lib/crm.functions";

import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIG = "b0000000-0000-4000-8000-000000000000";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  // 1,234 customers; "CenterPoint" has 1,139 live sites (+3 deleted) and 1,001 open tickets.
  const accounts: Row[] = Array.from({ length: 1233 }, (_, i) => ({
    id: id(i),
    name: `Customer ${String(i).padStart(4, "0")}`,
    deleted_at: null,
  }));
  accounts.push({ id: BIG, name: "CenterPoint", deleted_at: null });
  const sites: Row[] = Array.from({ length: 1142 }, (_, i) => ({
    id: `s${i}`,
    account_id: BIG,
    deleted_at: i < 3 ? "2026-09-01T00:00:00Z" : null,
  }));
  sites.push({ id: "s-other", account_id: id(7), deleted_at: null });
  const jobs: Row[] = Array.from({ length: 1003 }, (_, i) => ({
    id: `j${i}`,
    account_id: BIG,
    stage: i < 1001 ? "open" : "invoiced",
    deleted_at: null,
  }));
  env = fakeSupabase(
    {
      profiles: [{ id: ME, role: "user", access: ["customers"], full_name: "P", email: "p@x" }],
      crm_accounts: accounts,
      crm_sites: sites,
      service_jobs: jobs,
    },
    { maxRows: 1000 },
  );
});

describe("listAccounts reads past the 1,000-row cap", () => {
  it("every customer, and CenterPoint's 1,139 sites and 1,001 open tickets", async () => {
    const rows = await (listAccounts as unknown as (a: { context: unknown }) => Promise<Row[]>)({
      context: { supabase: env.db, userId: ME },
    } as never);
    expect(rows).toHaveLength(1234);
    const cp = rows.find((r) => r["id"] === BIG)!;
    expect(cp["site_count"]).toBe(1139);
    expect(cp["open_jobs"]).toBe(1001);
    expect(rows.find((r) => r["id"] === id(7))!["site_count"]).toBe(1);
  });
  it("pages each list with .range and a stable order", () => {
    const src = readFileSync("src/lib/crm.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("export const listAccounts"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body.match(/fetchAllPages\(/g)).toHaveLength(3);
    expect(body.match(/\.range\(from, to\)/g)).toHaveLength(3);
    expect(body).not.toContain(".limit(");
    expect(body.match(/\.order\("id"\)/g)).toHaveLength(3);
  });
});

describe("fetchAllPages / countBy (pure)", () => {
  // Imported here so the listAccounts test above still runs (and fails) against the old code.
  const load = () => import("@/lib/paging");
  it("asks 0–999, 1000–1999, … until a short page", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const asked: [number, number][] = [];
    const paging = await load();
    const out = await paging.fetchAllPages(async (from, to) => {
      asked.push([from, to]);
      return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null };
    });
    expect(out).toEqual(all);
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
  it("an exact multiple needs one empty page to stop; an error is thrown with its message", async () => {
    const asked: number[] = [];
    const paging = await load();
    const out = await paging.fetchAllPages(async (from) => {
      asked.push(from);
      return { data: from < 2000 ? Array.from({ length: 1000 }, () => 1) : [], error: null };
    });
    expect(out).toHaveLength(2000);
    expect(asked).toEqual([0, 1000, 2000]);
    await expect(
      paging.fetchAllPages(async () => ({ data: null, error: { message: "permission denied" } })),
    ).rejects.toThrow("permission denied");
  });
  it("countBy skips rows without a key", async () => {
    const paging = await load();
    const m = paging.countBy(
      [{ a: "x" }, { a: "x" }, { a: null }, { a: "y" }],
      (r: { a: string | null }) => r.a,
    );
    expect([...m]).toEqual([
      ["x", 2],
      ["y", 1],
    ]);
  });
});
