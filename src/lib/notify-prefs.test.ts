/**
 * Owner, Oct 2: notification preferences saved silently did nothing for non-admins.
 *
 * setNotifyPrefs updated profiles directly, through row security; profiles has only an admin
 * UPDATE policy, so a manager's, sales / PM's or technician's save matched 0 rows and came back
 * as success. Now it saves through set_my_notify_prefs(p_email, p_push) (migration
 * 20261002180000_notify_prefs.sql: SECURITY DEFINER, the caller's own row, the two columns),
 * and checks the values the function hands back, so a no-op can never pass as a save again.
 *
 * The real server function runs against the stand-in client (src/test/fake-supabase.ts); the
 * migration and the types are checked as text.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { setNotifyPrefs } from "@/lib/followups.functions";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

const TECH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOT_SAVED = "Your notification settings were not saved. Please try again.";

/** The database function as the fake sees it: the caller's row, a null keeps the column. */
const setMyNotifyPrefs =
  (uid: string): FakeRpc =>
  (args, tables) => {
    const row = (tables["profiles"] ?? []).find((p) => p["id"] === uid);
    if (!row) return [];
    if (args["p_email"] !== null) row["notify_email"] = args["p_email"];
    if (args["p_push"] !== null) row["notify_push"] = args["p_push"];
    return [{ notify_email: row["notify_email"], notify_push: row["notify_push"] }];
  };

function env(rpcs: Record<string, FakeRpc> = { set_my_notify_prefs: setMyNotifyPrefs(TECH) }) {
  const e = fakeSupabase(
    { profiles: [{ id: TECH, role: "technician", notify_email: true, notify_push: true }] },
    { rpcs },
  );
  const call = (data: unknown) =>
    (setNotifyPrefs as unknown as (a: unknown) => Promise<unknown>)({
      data,
      context: { supabase: e.db, userId: TECH },
    });
  return { ...e, call };
}

describe("setNotifyPrefs saves through set_my_notify_prefs", () => {
  it("calls the rpc and never updates profiles directly", async () => {
    const e = env();
    await e.call({ notify_email: false });
    expect(e.rpcCalls).toEqual([
      { fn: "set_my_notify_prefs", args: { p_email: false, p_push: null } },
    ]);
    expect(e.writes.filter((w) => w.table === "profiles")).toEqual([]);
    expect(e.tables["profiles"]![0]).toMatchObject({ notify_email: false, notify_push: true });
  });

  it("saves the push switch alone, and both together", async () => {
    const e = env();
    await e.call({ notify_push: false });
    await e.call({ notify_email: false, notify_push: true });
    expect(e.rpcCalls.map((c) => c.args)).toEqual([
      { p_email: null, p_push: false },
      { p_email: false, p_push: true },
    ]);
    expect(e.tables["profiles"]![0]).toMatchObject({ notify_email: false, notify_push: true });
  });

  it("a database error is a plain message the page can toast", async () => {
    const e = env({
      set_my_notify_prefs: () => {
        throw new Error("function public.set_my_notify_prefs(boolean, boolean) does not exist");
      },
    });
    await expect(e.call({ notify_email: false })).rejects.toThrow(NOT_SAVED);
  });

  it("a save that changed nothing is an error, not a silent success", async () => {
    // No row came back (the old failure: 0 rows updated, no error).
    await expect(
      env({ set_my_notify_prefs: () => [] }).call({ notify_push: false }),
    ).rejects.toThrow(NOT_SAVED);
    // A row came back, but not with the value asked for.
    await expect(
      env({ set_my_notify_prefs: () => [{ notify_email: true, notify_push: true }] }).call({
        notify_push: false,
      }),
    ).rejects.toThrow(NOT_SAVED);
  });

  it("returns the saved values", async () => {
    await expect(env().call({ notify_email: false })).resolves.toEqual({
      notify_email: false,
      notify_push: true,
    });
  });
});

const flatSql = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

describe("migration 20261002180000_notify_prefs.sql", () => {
  const sql = flatSql("supabase/migrations/20261002180000_notify_prefs.sql");
  const fn = sql.slice(
    sql.indexOf("create or replace function public.set_my_notify_prefs("),
    sql.indexOf("$$;") + 3,
  );

  it("is a SECURITY DEFINER function returning the saved values", () => {
    expect(fn).toMatch(
      /^create or replace function public\.set_my_notify_prefs\(p_email boolean, p_push boolean\) returns table \(notify_email boolean, notify_push boolean\) language plpgsql security definer set search_path = public as \$\$/,
    );
  });

  it("writes only the caller's own row, the two columns, and refuses the signed-out", () => {
    expect(fn).toContain("if auth.uid() is null then raise exception 'Not signed in'");
    expect(fn).toContain("where p.id = auth.uid()");
    expect(fn).toContain(
      "set notify_email = coalesce(p_email, p.notify_email), notify_push = coalesce(p_push, p.notify_push) where",
    );
    expect(fn).not.toMatch(/\b(role|access|technician)\s*=/);
    expect(fn.match(/\bupdate\b/g)).toHaveLength(1);
    expect(fn).toContain("if not found then raise exception");
  });

  it("is callable by signed-in users only", () => {
    const sig = "public.set_my_notify_prefs(boolean, boolean)";
    expect(sql).toContain(`revoke all on function ${sig} from public;`);
    expect(sql).toContain(`revoke all on function ${sig} from anon;`);
    expect(sql).toContain(`grant execute on function ${sig} to authenticated;`);
  });

  it("is idempotent and additive", () => {
    expect(sql).not.toMatch(/\bdrop\b|\balter table\b|\bcreate policy\b/i);
    expect(sql).not.toMatch(/create function/);
  });

  it("is typed", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types).toContain(
      "set_my_notify_prefs: {\n        Args: { p_email: boolean | null; p_push: boolean | null };\n        Returns: { notify_email: boolean; notify_push: boolean }[];\n      };",
    );
  });
});
