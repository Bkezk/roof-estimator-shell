/**
 * Audit, Oct 2, item 8: searchAccounts built `.or(name.ilike.%q%,address1.ilike.%q%)` and only
 * stripped `% _ ,`: a typed "(" or ")" or a quote reached PostgREST's or=(…) parser as syntax
 * ("Smith (" broke the request) and "a,b" searched "a b". Each reserved character now becomes
 * LIKE's "_" (any one character): nothing typed is syntax, and the search still finds the name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { searchAccounts } from "@/lib/crm.functions";
import * as search from "@/lib/account-search";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A1 = "a1111111-1111-4111-8111-111111111111";
const A2 = "a2222222-2222-4222-8222-222222222222";
const A3 = "a3333333-3333-4333-8333-333333333333";
const A4 = "a4444444-4444-4444-8444-444444444444";

let env: ReturnType<typeof fakeSupabase>;
let ors: string[];
beforeEach(() => {
  env = fakeSupabase({
    profiles: [{ id: ME, role: "user", access: ["customers"], full_name: "P", email: "p@x" }],
    crm_accounts: [
      { id: A1, name: "Smith (Main Office)", kind: "company", deleted_at: null },
      { id: A2, name: "O'Brien Roofing", kind: "company", deleted_at: null },
      { id: A3, name: "a,b Supply", kind: "company", deleted_at: null },
      { id: A4, name: "Zed Corp", kind: "company", deleted_at: null },
    ],
    crm_sites: [
      {
        id: "s4",
        account_id: A4,
        name: "Plant (North)",
        address1: "1 Elm, Unit 2",
        deleted_at: null,
      },
    ],
  });
  // Record every .or() expression the function sends, as PostgREST would receive it.
  ors = [];
  const from = (env.db as unknown as { from: (t: string) => Record<string, unknown> }).from;
  (env.db as unknown as { from: unknown }).from = (t: string) => {
    const b = from(t);
    const or = b["or"] as (e: string) => unknown;
    b["or"] = (e: string) => {
      ors.push(e);
      return or(e);
    };
    return b;
  };
});
const find = async (q: string) =>
  (
    await (searchAccounts as unknown as (a: { data: Row; context: unknown }) => Promise<Row[]>)({
      data: { q },
      context: { supabase: env.db, userId: ME },
    })
  ).map((h) => h["account_name"]);

/** One `col.ilike.<value>` per column, and no PostgREST syntax inside a value. */
const safeOr = (e: string) => {
  const parts = e.split(",");
  expect(parts).toHaveLength(2);
  for (const p of parts) expect(p).toMatch(/^(name|address1)\.ilike\.%[^,.:()"'\\*]*%$/);
};

describe("searchAccounts with PostgREST-reserved characters", () => {
  it("'Smith (' finds Smith (Main Office); the or() carries no parenthesis", async () => {
    expect(await find("Smith (")).toEqual(["Smith (Main Office)"]);
    expect(ors).toHaveLength(1);
    safeOr(ors[0]!);
  });
  it("O'Brien finds O'Brien Roofing; no quote is sent", async () => {
    expect(await find("O'Brien")).toEqual(["O'Brien Roofing"]);
    safeOr(ors[0]!);
  });
  it("'a,b' finds 'a,b Supply' (it searched 'a b' before); no comma inside a value", async () => {
    expect(await find("a,b")).toEqual(["a,b Supply"]);
    safeOr(ors[0]!);
  });
  it("through a site: 'Plant (North)' and '1 Elm, Unit' still find the customer", async () => {
    expect(await find("Plant (North)")).toEqual(["Zed Corp"]);
    expect(await find("1 Elm, Unit")).toEqual(["Zed Corp"]);
    for (const e of ors) safeOr(e);
  });
});

describe("ilikePattern / orIlike (pure)", () => {
  it("every reserved character becomes _; blank is %", () => {
    expect(search.ilikePattern("Smith (")).toBe("%Smith _%");
    expect(search.ilikePattern("O'Brien")).toBe("%O_Brien%");
    expect(search.ilikePattern("a,b")).toBe("%a_b%");
    expect(search.ilikePattern('x"y.z:w)*%_\\')).toBe("%x_y_z_w_____%");
    expect(search.ilikePattern("  ")).toBe("%");
    expect(search.orIlike(["name", "address1"], "%a_b%")).toBe(
      "name.ilike.%a_b%,address1.ilike.%a_b%",
    );
  });
});
