/**
 * Owner, Nov 14, told that the sign-in service had public sign-ups switched on and that an
 * account made that way could read nine tables: "Yes go ahead with those suggestions" (switch
 * sign-ups off; make those tables require a real profile).
 *
 * Measured on the live database before and after, as each real role, as a signed-in account with
 * no profile, and as a caller with no account (docs/qa/stranger-access-2026-11-14.md). These
 * tests pin the file that was applied, so the rules cannot quietly loosen again.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261114170000_profile_required.sql", "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("a person on the Users & access list", () => {
  it("has_profile() asks exactly that, about the caller", () => {
    expect(code).toContain(
      "select exists (select 1 from public.profiles p where p.id = auth.uid());",
    );
    expect(code).toContain("revoke all on function public.has_profile() from public, anon;");
  });
});

describe('the nine tables that only asked "signed in"', () => {
  const NINE: [string, string][] = [
    ["bid_locks_read", "bid_locks"],
    ["county_codes_read", "county_codes"],
    ["data_refreshes read", "data_refreshes"],
    ["inventory_locations_read", "inventory_locations"],
    ["inventory_movements_read", "inventory_movements"],
    ["inventory_settings_read", "inventory_settings"],
    ["lead_sources_read", "lead_sources"],
    ["storm_settings_read", "storm_settings"],
    ["vehicle_drivers_read", "vehicle_drivers"],
  ];
  it.each(NINE)("%s now needs a profile", (policy, table) => {
    expect(code).toContain(
      `alter policy "${policy}" on public.${table} using ((select public.has_profile()));`,
    );
  });
  it("a task notice can be written only by a person on the list", () => {
    expect(code).toMatch(
      /alter policy "notifications_insert_tasks" on public\.notifications\s+with check \(\s+\(select public\.has_profile\(\)\)\s+and kind = any/,
    );
  });
});

describe("the functions and views that handed out names", () => {
  it.each([
    "assignable_users",
    "estimator_names",
    "inventory_bid_options",
    "inventory_job_options",
  ])("%s() needs a profile, or the server's own key", (fn) => {
    const body = new RegExp(
      `create or replace function public\\.${fn}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    ).exec(code)?.[1];
    expect(body).toBeTruthy();
    expect(body).toContain("(select public.has_profile()) or auth.role() = 'service_role'");
    // The old gate, "anyone signed in", is gone.
    expect(body).not.toContain("auth.uid() is not null");
  });
  it.each(["catalog_item_numbers_map", "company_settings_public", "pricing_catalog_units"])(
    "the %s view needs one too, with its options kept",
    (view) => {
      const def = new RegExp(`create or replace view public\\.${view} ([\\s\\S]*?);`).exec(
        code,
      )?.[1];
      expect(def).toContain("with (security_invoker = false, security_barrier = true)");
      expect(def).toContain("where (select public.has_profile()) or auth.role() = 'service_role'");
    },
  );
});

describe("a caller with no account", () => {
  it("can run nothing: EXECUTE is taken from anon and PUBLIC on every function", () => {
    expect(code).toContain(
      "execute format('revoke execute on function %s from public, anon', r.fn);",
    );
  });
  it("and what a signed-in person or the server could run, they still can", () => {
    expect(code).toContain(
      "if r.auth_had then execute format('grant execute on function %s to authenticated', r.fn); end if;",
    );
    expect(code).toContain(
      "if r.svc_had then execute format('grant execute on function %s to service_role', r.fn); end if;",
    );
  });
  it("functions made from here on start the same way", () => {
    expect(code).toContain(
      "alter default privileges for role postgres in schema public revoke execute on functions from anon;",
    );
    expect(code).toContain(
      "alter default privileges for role postgres revoke execute on functions from public;",
    );
  });
});

describe("later migrations do not hand it back", () => {
  it("no migration after this one grants a function to anon or to public", () => {
    const later = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && f > "20261114170000_profile_required.sql")
      .sort();
    const offenders: string[] = [];
    for (const f of later) {
      const text = readFileSync(`supabase/migrations/${f}`, "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      if (/grant\s+(execute|all)[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the site itself never needed it", () => {
  it("the two public share links read through the server's own key, not as a stranger", () => {
    for (const f of ["src/routes/d.$token.ts", "src/routes/i.$token.ts"]) {
      const text = readFileSync(f, "utf8");
      expect(text).toContain('await import("@/integrations/supabase/client.server")');
      expect(text).toContain("supabaseAdmin.rpc(");
    }
  });
});
