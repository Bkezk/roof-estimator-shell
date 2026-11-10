/**
 * Building search under a second (owner, Nov 10: speed pass finding 2), and the eight foreign
 * keys that had no index. A trigram index answers `ilike '%text%'`, but under row security
 * Postgres will not use it through the table, so the search reads `buildings_search`: the same
 * rows behind the same access rule. Measured live as an office user: 2.3 s to 3–111 ms, the same
 * 500 ids in the same order.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bareHelperCalls } from "@/lib/rls-check-once";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const MIGRATION = "supabase/migrations/20261110211000_building_search_and_fk_indexes.sql";
const sql = flat(read(MIGRATION));
const prospect = read("src/lib/prospect.ts");
const fns = read("src/lib/prospect.functions.ts");
const rpc = read("src/lib/database-rpc.ts");

/** The columns the search box matches (prospect.ts SEARCH_COLUMNS). */
const searchColumns = (() => {
  const m = /const SEARCH_COLUMNS = \[([^\]]*)\]/.exec(prospect);
  return m ? [...m[1]!.matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]!) : [];
})();

describe("20261110211000: the trigram index", () => {
  it("covers every column the search box matches, live rows only", () => {
    expect(searchColumns).toEqual([
      "name",
      "address1",
      "city",
      "owner_name",
      "parcel_id",
      "county",
      "state",
      "zip",
    ]);
    expect(sql).toContain("create extension if not exists pg_trgm with schema extensions;");
    const idx =
      /create index if not exists buildings_search_trgm_idx on public\.buildings using gin \(([^)]*)\) where deleted_at is null;/.exec(
        sql,
      );
    expect(idx).not.toBeNull();
    expect(
      idx![1]!
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    ).toEqual(searchColumns.map((c) => `${c} extensions.gin_trgm_ops`));
  });
});

describe("20261110211000: buildings_search", () => {
  it("is the table's rows behind the buildings_read rule, checked once", () => {
    expect(sql).toContain(
      "create or replace view public.buildings_search as select b.* from public.buildings b where (select public.has_access('prospect')) or (select public.has_access('estimate'));",
    );
    const view = sql.slice(
      sql.indexOf("create or replace view"),
      sql.indexOf("revoke all on public.buildings_search"),
    );
    expect(bareHelperCalls(view)).toEqual([]);
    // Not a security barrier: the search text must reach the index.
    expect(sql).not.toMatch(/security_barrier/);
  });
  it("is for signed-in users to read, nobody else, and never to write", () => {
    // `authenticated` too: Supabase's default privileges give it every right on a new view, and
    // this view runs as its owner, so a write through it would skip the table's own rules.
    expect(sql).toContain(
      "revoke all on public.buildings_search from public, anon, authenticated;",
    );
    expect(sql.indexOf("revoke all on public.buildings_search")).toBeLessThan(
      sql.indexOf("grant select on public.buildings_search"),
    );
    expect(sql).toContain(
      "grant select on public.buildings_search to authenticated, service_role;",
    );
    expect(sql).not.toMatch(/grant (?:all|insert|update|delete)[^;]*buildings_search/);
  });
});

describe("listBuildings reads the view only when there is search text", () => {
  it("picks the table or its twin, then builds the same query", () => {
    expect(fns).toContain('import { buildingsSearchTable } from "@/lib/database-rpc";');
    expect(fns.replace(/\s+/g, " ")).toContain(
      'const table = data.q ? buildingsSearchTable(context.supabase) : context.supabase.from("buildings");',
    );
    expect(fns).toMatch(/let q = table\s*\.select\(/);
    // Every other read and every write still names the table.
    expect(fns.match(/buildingsSearchTable\(/g)).toHaveLength(1);
  });
  it("the twin is typed as the table (the generated types do not list it)", () => {
    expect(rpc).toContain(
      "export function buildingsSearchTable(client: SupabaseClient<Database>) {",
    );
    expect(rpc).toContain('return client.from("buildings_search" as "buildings");');
    expect(read("src/integrations/supabase/types.ts")).not.toContain("buildings_search");
  });
});

describe("20261110211000: the eight foreign keys get an index", () => {
  it.each([
    ["service_job_photos_repair_idx", "service_job_photos (repair_id)"],
    ["notifications_followup_idx", "notifications (followup_id)"],
    ["service_time_entries_technician_idx", "service_time_entries (technician_id)"],
    ["crm_followups_account_idx", "crm_followups (account_id)"],
    ["service_jobs_contact_idx", "service_jobs (contact_id)"],
    ["service_jobs_location_idx", "service_jobs (location_id)"],
    ["documents_template_idx", "documents (template_id)"],
    ["leads_building_idx", "leads (building_id)"],
  ])("%s", (name, on) => {
    expect(sql).toContain(`create index if not exists ${name} on public.${on};`);
  });
  it("drops nothing (the owner kept the three little-used building indexes)", () => {
    expect(sql).not.toMatch(/drop index/i);
  });
});
