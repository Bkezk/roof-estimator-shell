/**
 * Dark mode (owner, Oct 2): the per-user theme on profiles. Migration
 * 20261002170000_theme.sql adds profiles.theme ('light' | 'dark' | 'system', default 'system')
 * and set_my_theme(p_theme), the SECURITY DEFINER write of the caller's own theme (profiles has
 * no self-update policy, and a per-row one would let a user rewrite their own role). The types
 * carry both; the server functions read and write through them and tolerate a database that
 * has not had the migration yet.
 *
 * Source checks of the migration and the types, plus the real server functions run against a
 * stand-in Supabase client (createServerFn reduced to "validate, then call the handler").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

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
        (arg: { data?: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { getMyTheme, setMyTheme } from "@/lib/theme.functions";

const MIGRATION = "supabase/migrations/20261002170000_theme.sql";
const flatSql = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

describe("5. migration 20261002170000_theme.sql", () => {
  const sql = flatSql(MIGRATION);

  it("adds profiles.theme, default system, never null, three values only (idempotent)", () => {
    expect(sql).toContain(
      "alter table public.profiles add column if not exists theme text default 'system';",
    );
    expect(sql).toContain("update public.profiles set theme = 'system' where theme is null;");
    expect(sql).toContain("alter table public.profiles alter column theme set not null;");
    expect(sql).toContain(
      "alter table public.profiles drop constraint if exists profiles_theme_check;",
    );
    expect(sql).toContain(
      "add constraint profiles_theme_check check (theme in ('light', 'dark', 'system'));",
    );
  });

  it("set_my_theme writes the caller's own row, that one column, nothing else", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.set_my_theme(p_theme text)"),
    );
    expect(fn).toMatch(
      /^create or replace function public\.set_my_theme\(p_theme text\) returns void language plpgsql security definer set search_path = public as \$\$/,
    );
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).toContain(
      "if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501';",
    );
    expect(body).toContain("if p_theme is null or p_theme not in ('light', 'dark', 'system') then");
    expect(body).toContain("update public.profiles set theme = p_theme where id = auth.uid();");
    // One update, of one column, of the caller's row.
    expect(body.match(/update /g)?.length).toBe(1);
    expect(body).not.toMatch(/\b(role|access|technician)\b/);
  });

  it("only signed-in users may call it", () => {
    expect(sql).toContain("revoke all on function public.set_my_theme(text) from public;");
    expect(sql).toContain("revoke all on function public.set_my_theme(text) from anon;");
    expect(sql).toContain("grant execute on function public.set_my_theme(text) to authenticated;");
  });

  it("adds no profiles policy (a self-update policy would let users change their own role)", () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant update/i);
  });
});

describe("5. types", () => {
  const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const profiles = types.slice(
    types.indexOf("      profiles: {\n        Row: {"),
    types.indexOf("      push_subscriptions: {"),
  );
  it("profiles Row / Insert / Update carry theme", () => {
    const row = profiles.slice(profiles.indexOf("Row: {"), profiles.indexOf("Insert: {"));
    const ins = profiles.slice(profiles.indexOf("Insert: {"), profiles.indexOf("Update: {"));
    const upd = profiles.slice(profiles.indexOf("Update: {"));
    expect(row).toContain("          theme: string;");
    expect(ins).toContain("          theme?: string;");
    expect(upd).toContain("          theme?: string;");
  });
  it("set_my_theme is a typed function", () => {
    expect(types).toContain("set_my_theme: { Args: { p_theme: string }; Returns: undefined };");
  });
});

type Call = { op: string; args: unknown[] };
function fakeClient(opts: { row?: unknown; selectError?: string; rpcError?: string } = {}) {
  const calls: Call[] = [];
  const chain = {
    select: (...args: unknown[]) => (calls.push({ op: "select", args }), chain),
    eq: (...args: unknown[]) => (calls.push({ op: "eq", args }), chain),
    maybeSingle: async () =>
      opts.selectError
        ? { data: null, error: { message: opts.selectError } }
        : { data: opts.row ?? null, error: null },
    update: (...args: unknown[]) => (calls.push({ op: "update", args }), chain),
  };
  const client = {
    from: (t: string) => (calls.push({ op: "from", args: [t] }), chain),
    rpc: async (name: string, args: unknown) => {
      calls.push({ op: "rpc", args: [name, args] });
      return { data: null, error: opts.rpcError ? { message: opts.rpcError } : null };
    },
  };
  return { client, calls };
}

describe("5. the server functions", () => {
  const ctx = (client: unknown) => ({ context: { supabase: client, userId: "u-1" } });

  it("getMyTheme reads the caller's own row", async () => {
    const { client, calls } = fakeClient({ row: { theme: "dark" } });
    await expect(getMyTheme(ctx(client) as never)).resolves.toEqual({ theme: "dark" });
    expect(calls).toEqual([
      { op: "from", args: ["profiles"] },
      { op: "select", args: ["theme"] },
      { op: "eq", args: ["id", "u-1"] },
    ]);
  });
  it("getMyTheme: no row, an unknown value, or no column yet is 'no saved choice'", async () => {
    await expect(getMyTheme(ctx(fakeClient().client) as never)).resolves.toEqual({ theme: null });
    await expect(
      getMyTheme(ctx(fakeClient({ row: { theme: "sepia" } }).client) as never),
    ).resolves.toEqual({ theme: null });
    await expect(
      getMyTheme(
        ctx(fakeClient({ selectError: "column profiles.theme does not exist" }).client) as never,
      ),
    ).resolves.toEqual({ theme: null });
  });
  it("setMyTheme writes only through set_my_theme, never a profiles update", async () => {
    const { client, calls } = fakeClient();
    await expect(setMyTheme({ data: { theme: "dark" }, ...ctx(client) } as never)).resolves.toEqual(
      { saved: true },
    );
    expect(calls).toEqual([{ op: "rpc", args: ["set_my_theme", { p_theme: "dark" }] }]);
  });
  it("setMyTheme refuses anything but the three values", async () => {
    const { client, calls } = fakeClient();
    expect(() => setMyTheme({ data: { theme: "black" }, ...ctx(client) } as never)).toThrow();
    expect(() => setMyTheme({ data: {}, ...ctx(client) } as never)).toThrow();
    expect(calls).toEqual([]);
  });
  it("setMyTheme before the migration: not saved, no throw (the browser copy stands)", async () => {
    const { client } = fakeClient({
      rpcError: "function public.set_my_theme(text) does not exist",
    });
    await expect(
      setMyTheme({ data: { theme: "light" }, ...ctx(client) } as never),
    ).resolves.toEqual({
      saved: false,
      error: "function public.set_my_theme(text) does not exist",
    });
  });
  it("sign-in never depends on the column: getMyProfile does not select theme", () => {
    const auth = readFileSync("src/lib/auth.functions.ts", "utf8");
    const cols = /const PROFILE_COLS = "([^"]+)";/.exec(auth)![1]!;
    expect(cols.split(/,\s*/)).not.toContain("theme");
  });
});
