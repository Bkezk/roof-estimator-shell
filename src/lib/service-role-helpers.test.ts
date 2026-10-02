/**
 * 20261002090000_service_role_helpers.sql: technician_options() and stamp_dispatch() let the
 * system (the service role; SQL with no request) through, keep a signed-in user's checks as
 * they were, and refuse anon. The behaviour was proved in an embedded Postgres (PGlite) outside
 * this suite (no new dependency); these pin the migration text so the fix cannot be dropped or
 * overridden by a later migration.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const FILE = "20261002090000_service_role_helpers.sql";
const sql = readFileSync(`${DIR}/${FILE}`, "utf8");

/** The `create or replace function public.<name>(…) … $$;` statement. */
function fn(src: string, name: string): string {
  const start = src.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf("$$", start);
  return src.slice(start, src.indexOf("$$;", open + 2) + 3);
}
const squash = (s: string) => s.replace(/\s+/g, " ");
const SERVICE = "coalesce(auth.role(), '') = 'service_role'";
const NO_REQUEST =
  "(auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))";

describe("technician_options(): the system sees the roster, users as before", () => {
  const body = squash(fn(sql, "technician_options"));
  it("lets the service role and no-request SQL through", () => {
    expect(body).toContain(`where (${SERVICE} or ${NO_REQUEST} or public.has_access('service'))`);
  });
  it("keeps the signed-in rule and the roster filter unchanged", () => {
    expect(body).toContain("public.has_access('service')");
    expect(body).toContain(
      "and (p.technician or p.role in ('admin','manager') or 'service' = any(p.access))",
    );
    expect(body).toContain("security definer set search_path = public");
  });
  it("is executable by authenticated and service_role, not by anon or public", () => {
    expect(sql).toContain("revoke all on function public.technician_options() from public;");
    expect(sql).toContain("revoke all on function public.technician_options() from anon;");
    expect(sql).toContain(
      "grant execute on function public.technician_options() to authenticated, service_role;",
    );
  });
});

describe("stamp_dispatch(): the system stamps, users as before", () => {
  const body = squash(fn(sql, "stamp_dispatch"));
  it("lets the service role and no-request SQL through", () => {
    expect(body).toContain(`and (${SERVICE} or ${NO_REQUEST} or public.has_access('customers')`);
  });
  it("keeps the signed-in rule unchanged", () => {
    expect(body).toContain(
      "public.has_access('customers') or public.has_access('service') or public.has_access('estimate'))",
    );
    expect(body).toContain("update public.crm_settings set last_dispatch_at = now() where id = 1");
    expect(body).toContain("security definer set search_path = public");
  });
  it("is executable by authenticated and service_role, not by anon or public", () => {
    expect(sql).toContain("revoke all on function public.stamp_dispatch() from public;");
    expect(sql).toContain("revoke all on function public.stamp_dispatch() from anon;");
    expect(sql).toContain(
      "grant execute on function public.stamp_dispatch() to authenticated, service_role;",
    );
  });
});

describe("the migration", () => {
  it("is the last word on both functions (no later migration redefines them)", () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const name of ["technician_options", "stamp_dispatch"]) {
      const defs = files.filter((f) =>
        readFileSync(`${DIR}/${f}`, "utf8").includes(`create or replace function public.${name}(`),
      );
      expect(defs.at(-1), name).toBe(FILE);
    }
  });
  it("adds the failure record columns idempotently", () => {
    for (const col of [
      "dispatch_errors integer not null default 0",
      "last_dispatch_error text",
      "last_dispatch_error_at timestamptz",
    ])
      expect(sql).toContain(`alter table public.crm_followups add column if not exists ${col};`);
  });
  it("is idempotent (create or replace / if not exists only)", () => {
    expect(sql).not.toMatch(
      /create function|create table (?!if not exists)|add column (?!if not exists)/i,
    );
  });
});
