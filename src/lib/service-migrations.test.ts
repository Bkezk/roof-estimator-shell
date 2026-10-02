/**
 * Migrations (audit, Oct 2).
 *
 * 9. Replay order: a fresh `db reset` runs supabase/migrations in filename order, and a policy
 *    or a SQL function that names a helper which does not exist yet fails. 20260930091000 used
 *    public.is_manager() before 20260930093000_manager_role.sql defined it; it now defines it
 *    itself, with the body of 093000 (create or replace, so idempotent). The scan below walks
 *    every migration in order and asserts each helper is defined before it is used.
 * 10. 20261002120000_service_child_rls.sql: writes on time, repairs and photos need the ticket
 *    (works_on_ticket); the "service" bucket's insert / update / delete are guarded by path and
 *    role (service_object_writable); reads unchanged; no hard delete of a ticket with invoices;
 *    one live repair ticket per inspection; idempotent throughout.
 *
 * @electric-sql/pglite is not installed here, so the policies are not executed by this suite (no
 * dependency was added); they are checked as text.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (f: string) => readFileSync(`${DIR}/${f}`, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();

/** Every helper the policies call. */
const HELPERS = [
  "is_manager",
  "is_admin",
  "has_access",
  "is_technician",
  "is_sales_pm",
  "leads_job",
  "is_on_crew",
  "works_on_ticket",
  "service_object_writable",
] as const;

/** Uses of a helper before its definition, walking the migrations in filename order. */
function useBeforeDefinition(files: readonly { name: string; sql: string }[]): string[] {
  const defined = new Set<string>();
  const problems: string[] = [];
  for (const f of files) {
    const t = noComments(f.sql);
    type Ev = { pos: number; kind: "def" | "ref"; fn: string; end: number };
    const evs: Ev[] = [];
    for (const fn of HELPERS) {
      const def = new RegExp(
        `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${fn}\\s*\\(`,
        "gi",
      );
      for (const m of t.matchAll(def))
        evs.push({ pos: m.index, kind: "def", fn, end: m.index + m[0].length });
      const ref = new RegExp(`\\bpublic\\.${fn}\\s*\\(`, "gi");
      for (const m of t.matchAll(ref)) evs.push({ pos: m.index, kind: "ref", fn, end: m.index });
    }
    evs.sort((a, b) => a.pos - b.pos);
    for (const e of evs) {
      if (e.kind === "def") {
        defined.add(e.fn);
        continue;
      }
      // The name inside its own `create function public.x(` header is not a use.
      if (evs.some((d) => d.kind === "def" && d.fn === e.fn && e.pos >= d.pos && e.pos < d.end))
        continue;
      if (!defined.has(e.fn))
        problems.push(`${f.name}: public.${e.fn}() used before it is defined`);
    }
  }
  return [...new Set(problems)];
}

describe("9. migration replay order: every helper defined before it is used", () => {
  const all = FILES.map((name) => ({ name, sql: read(name) }));
  it("the scan finds nothing used before its definition", () => {
    expect(useBeforeDefinition(all)).toEqual([]);
  });
  it("the scan does catch it: 091000 without its own is_manager() fails (as before the fix)", () => {
    const before = all.map((f) =>
      f.name.startsWith("20260930091000_")
        ? {
            ...f,
            sql: f.sql.replace(
              /create or replace function public\.is_manager\(\)[\s\S]*?\$\$;/,
              "",
            ),
          }
        : f,
    );
    expect(useBeforeDefinition(before)).toContain(
      "20260930091000_ticket_job_number_crew_invoice_numbers.sql: public.is_manager() used before it is defined",
    );
  });
  it("091000 defines is_manager() at its top with the body of 093000_manager_role.sql", () => {
    const fn = (f: string) => {
      const m = read(f).match(/create or replace function public\.is_manager\(\)[\s\S]*?\$\$;/);
      expect(m, f).not.toBeNull();
      return m![0];
    };
    const early = "20260930091000_ticket_job_number_crew_invoice_numbers.sql";
    const late = "20260930093000_manager_role.sql";
    expect(fn(early)).toBe(fn(late));
    const sql = flat(read(early));
    expect(sql.indexOf("create or replace function public.is_manager()")).toBeLessThan(
      sql.indexOf("public.is_manager()", sql.indexOf("$$;")),
    );
    expect(sql.indexOf("create or replace function public.is_manager()")).toBe(0);
    expect(sql).toContain("revoke all on function public.is_manager() from public;");
    expect(sql).toContain("grant execute on function public.is_manager() to authenticated;");
  });
});

// ---------------------------------------------------------------------------------------------

const M10 = "20261002120000_service_child_rls.sql";
const sql10 = flat(read(M10));

describe("10. the child-table RLS migration", () => {
  it("works_on_ticket: Service access and (admin, manager, office, the lead or the crew)", () => {
    expect(sql10).toContain(
      "create or replace function public.works_on_ticket(job uuid) returns boolean language sql stable security definer set search_path = public as $$ select public.has_access('service') and (public.is_admin() or public.is_manager() or not public.is_technician() or public.leads_job(job) or public.is_on_crew(job)); $$;",
    );
    expect(sql10).toContain("revoke all on function public.works_on_ticket(uuid) from public;");
    expect(sql10).toContain(
      "grant execute on function public.works_on_ticket(uuid) to authenticated;",
    );
  });
  for (const t of ["service_time_entries", "service_job_repairs", "service_job_photos"]) {
    it(`${t}: the write policy is replaced by the ticket rule (using and with check)`, () => {
      expect(sql10).toContain(
        `drop policy if exists ${t}_write on public.${t}; create policy ${t}_write on public.${t} for all to authenticated using (public.works_on_ticket(service_job_id)) with check (public.works_on_ticket(service_job_id));`,
      );
      // Reads unchanged: the read policy is not touched.
      expect(sql10).not.toContain(`${t}_read`);
      // No write policy of the old shape is left anywhere after this file for the table.
      expect(sql10).not.toMatch(
        new RegExp(`create policy ${t}_write[^;]*using \\(public\\.has_access\\('service'\\)\\)`),
      );
    });
  }
  it("service_object_writable: invoices/ for admin / manager / sales; a ticket's files by the ticket rule; else admin / manager", () => {
    expect(sql10).toContain(
      "create or replace function public.service_object_writable(object_name text) returns boolean language sql stable security definer set search_path = public as $$ select case when object_name like 'invoices/%' then public.is_admin() or public.is_manager() or public.is_sales_pm() when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.works_on_ticket(split_part(object_name, '/', 1)::uuid) else public.is_admin() or public.is_manager() end; $$;",
    );
    // The cast runs only in the branch the regex guards.
    const guard = sql10.indexOf("~* '^[0-9a-f]{8}");
    const cast = sql10.indexOf("split_part(object_name, '/', 1)::uuid");
    expect(guard).toBeGreaterThan(0);
    expect(cast).toBeGreaterThan(guard);
    expect(sql10.match(/::uuid/g)).toHaveLength(1);
  });
  it("storage: insert, update and delete on bucket 'service' go through it; read untouched", () => {
    expect(sql10).toContain(
      "drop policy if exists service_objects_insert on storage.objects; create policy service_objects_insert on storage.objects for insert to authenticated with check (bucket_id = 'service' and public.service_object_writable(name));",
    );
    expect(sql10).toContain(
      "drop policy if exists service_objects_update on storage.objects; create policy service_objects_update on storage.objects for update to authenticated using (bucket_id = 'service' and public.service_object_writable(name)) with check (bucket_id = 'service' and public.service_object_writable(name));",
    );
    expect(sql10).toContain(
      "drop policy if exists service_objects_delete on storage.objects; create policy service_objects_delete on storage.objects for delete to authenticated using (bucket_id = 'service' and public.service_object_writable(name));",
    );
    expect(sql10).not.toContain("service_objects_read");
  });
  it("a ticket with invoices is not hard-deleted: 'Void or delete the invoices first'", () => {
    expect(sql10).toContain(
      "create or replace function public.service_jobs_delete_guard() returns trigger language plpgsql security definer set search_path = public as $$ begin if exists (select 1 from public.invoices i where i.service_job_id = old.id) then raise exception 'Void or delete the invoices first' using errcode = '23503'; end if; return old; end; $$;",
    );
    expect(sql10).toContain(
      "drop trigger if exists service_jobs_delete_guard on public.service_jobs; create trigger service_jobs_delete_guard before delete on public.service_jobs for each row execute function public.service_jobs_delete_guard();",
    );
  });
  it("one live repair ticket per inspection, the index made only when the data allows it", () => {
    expect(sql10).toContain(
      "if exists ( select 1 from public.service_jobs where from_job_id is not null and deleted_at is null group by from_job_id having count(*) > 1 ) then raise notice",
    );
    expect(sql10).toContain(
      "else create unique index if not exists service_jobs_from_job_live_idx on public.service_jobs (from_job_id) where from_job_id is not null and deleted_at is null; end if;",
    );
  });
  it("idempotent: every policy dropped before it is made, every function create or replace, every trigger dropped first", () => {
    const policies = [...sql10.matchAll(/create policy (\w+) on ([\w.]+)/g)];
    expect(policies.map((m) => m[1])).toEqual([
      "service_time_entries_write",
      "service_job_repairs_write",
      "service_job_photos_write",
      "service_objects_insert",
      "service_objects_update",
      "service_objects_delete",
    ]);
    for (const [, name, table] of policies)
      expect(sql10.indexOf(`drop policy if exists ${name} on ${table};`), name).toBeGreaterThan(-1);
    expect(sql10.indexOf(`drop policy if exists`)).toBeLessThan(sql10.indexOf("create policy"));
    expect(sql10).not.toMatch(/create function/);
    expect(sql10.match(/create or replace function/g)).toHaveLength(3);
    expect(sql10).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(sql10).not.toMatch(/create table (?!if not exists)/);
    expect(sql10.match(/create trigger/g)).toHaveLength(1);
  });
  it("the helpers it calls exist before it (and nothing is called before its definition)", () => {
    const upTo = FILES.filter((f) => f <= M10).map((name) => ({ name, sql: read(name) }));
    expect(useBeforeDefinition(upTo)).toEqual([]);
    const earlier = FILES.filter((f) => f < M10)
      .map((f) => flat(read(f)))
      .join(" ");
    for (const fn of ["leads_job(job uuid)", "is_on_crew(job uuid)", "is_sales_pm()"])
      expect(earlier).toContain(`create or replace function public.${fn}`);
  });
});
