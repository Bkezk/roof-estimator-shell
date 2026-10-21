/**
 * History at this property, the database half (owner, Oct 21). A technician-only login reads
 * only the tickets assigned to them (service_jobs_read), so the earlier tickets at a property —
 * other technicians' — come through one SECURITY DEFINER read, site_history, that first checks
 * the caller may see the ticket it starts from; site_history_summary is the strip's cheap twin.
 * The same migration narrows service_job_photos_read and service_job_repairs_read, which let a
 * technician-only login read every ticket's photos and repairs directly (the lead's finding).
 * 20261021110000_site_history.sql. RLS and SECURITY DEFINER are not modelled by the test fake,
 * so this reads the migration text itself (comment-stripped, as sites-warranties-fence.test.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const DIR = "supabase/migrations";
const FILE = "20261021110000_site_history.sql";
const sql = read(`${DIR}/${FILE}`);
const code = noComments(sql);
const f = flat(sql);
const count = (s: string, needle: string) => s.split(needle).length - 1;

const ACCESS =
  "public.has_access('customers') or (public.has_access('service') and not public.is_technician()) or exists ( select 1 from public.service_jobs j where j.id = p_job_id and j.deleted_at is null and (j.technician_id = auth.uid() or public.is_on_crew(j.id)) )";

describe("the access check", () => {
  it("site_history_allowed: customers, or service without the technician kind, or a live ticket the caller leads or crews — SECURITY DEFINER STABLE, search_path public", () => {
    expect(f).toContain(
      `create or replace function public.site_history_allowed(p_job_id uuid) returns boolean language sql stable security definer set search_path = public as $$ select ${ACCESS}; $$;`,
    );
  });
  it("both readers refuse through it, in plain English, as 42501", () => {
    expect(count(f, "if not public.site_history_allowed(p_job_id) then")).toBe(2);
    expect(
      count(
        f,
        "raise exception 'You can see the history of a property only from a ticket assigned to you' using errcode = '42501';",
      ),
    ).toBe(2);
    // The ticket itself must exist and be live first.
    expect(
      count(
        f,
        "if not exists (select 1 from public.service_jobs where id = p_job_id and deleted_at is null) then raise exception 'That ticket was not found' using errcode = 'P0002'; end if;",
      ),
    ).toBe(2);
  });
});

describe("the three functions", () => {
  it("SECURITY DEFINER, STABLE, search_path = public; revoked from public, granted to authenticated and service_role", () => {
    for (const fn of ["site_history", "site_history_summary"])
      expect(f).toContain(
        `create or replace function public.${fn}(p_job_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$`,
      );
    for (const fn of ["site_history_allowed", "site_history", "site_history_summary"]) {
      expect(f).toContain(`revoke all on function public.${fn}(uuid) from public;`);
      expect(f).toContain(
        `grant execute on function public.${fn}(uuid) to authenticated, service_role;`,
      );
    }
    expect(count(code, "create or replace function")).toBe(3);
    expect(code).not.toMatch(/security invoker/i);
  });
  it("site_history: the earlier tickets at the same site, not this one, not deleted, newest first, with repairs and every photo but the signature", () => {
    expect(f).toContain(
      "where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null ) t; return v_out;",
    );
    expect(f).toContain("if v_site is null then return '[]'::jsonb; end if;");
    expect(f).toContain("jsonb_agg(t.doc order by t.sort_at desc, t.number desc)");
    expect(f).toContain(
      "coalesce(j.completed_at, j.scheduled_date::timestamptz, j.created_at) as sort_at",
    );
    for (const key of [
      "'id', j.id",
      "'number', j.number",
      "'service_type', j.service_type",
      "'description', j.description",
      "'scheduled_date', j.scheduled_date",
      "'completed_at', j.completed_at",
      "'stage', j.stage",
      "'location_id', j.location_id",
      "'location_name', j.location_name",
      "'closing_notes', j.closing_notes",
      "'inspection_outcome', j.inspection_outcome",
      "'technician_name', ( select coalesce(nullif(trim(p.full_name), ''), p.email) from public.profiles p where p.id = j.technician_id)",
      "'repairs', coalesce(( select jsonb_agg(jsonb_build_object( 'id', r.id, 'name', r.name, 'problem_text', r.problem_text, 'resolution_text', r.resolution_text, 'completed_on', r.completed_on) order by r.sort, r.created_at) from public.service_job_repairs r where r.service_job_id = j.id), '[]'::jsonb)",
      "'photos', coalesce(( select jsonb_agg(jsonb_build_object( 'id', ph.id, 'storage_path', ph.storage_path, 'file_name', ph.file_name, 'role', ph.role, 'repair_id', ph.repair_id, 'item_key', ph.item_key, 'taken_at', ph.taken_at, 'created_at', ph.created_at, 'annotations', ph.annotations) order by ph.created_at) from public.service_job_photos ph where ph.service_job_id = j.id and ph.role <> 'signature'), '[]'::jsonb)",
    ])
      expect(f).toContain(key);
    // No limit: the fold lists every earlier ticket, the owner's "every picture" included.
    const body = code.slice(
      code.indexOf("create or replace function public.site_history("),
      code.indexOf("create or replace function public.site_history_summary("),
    );
    expect(body).not.toMatch(/\blimit\s+\d/i);
  });
  it("site_history_summary: count, photo count and the last ticket's day and gist — three small reads", () => {
    expect(f).toContain(
      "return jsonb_build_object('count', v_count, 'photo_count', v_photos, 'last', v_last);",
    );
    expect(f).toContain(
      "if v_count = 0 then return jsonb_build_object('count', 0, 'photo_count', 0, 'last', null); end if;",
    );
    expect(f).toContain("'description', left(j.description, 200)");
    expect(f).toContain("and ph.role <> 'signature'; select jsonb_build_object(");
    expect(f).toContain(
      "order by coalesce(j.completed_at, j.scheduled_date::timestamptz, j.created_at) desc, j.number desc limit 1;",
    );
  });
  it("hands back no prices, invoices, crew rates or customer contact details", () => {
    expect(code).not.toMatch(
      /\b(price|unit_price|rate|rates|labor_rate|invoice|invoices|total|amount|phone|mobile|office_phone|crm_contacts|crm_accounts|crm_sites|service_job_techs|service_time_entries)\b/i,
    );
    // The only profile columns read are the technician's name.
    expect(code.match(/from public\.profiles p/g)).toHaveLength(1);
    expect(code).toContain("coalesce(nullif(trim(p.full_name), ''), p.email)");
  });
});

describe("the two narrowed read policies", () => {
  const CLAUSE =
    "public.has_access('customers') or (public.has_access('service') and not public.is_technician()) or exists ( select 1 from public.service_jobs j where j.id = service_job_id and j.deleted_at is null and (j.technician_id = auth.uid() or public.is_on_crew(j.id)))";
  it("service_job_photos_read and service_job_repairs_read: customers, or service without the technician kind, or the row's ticket is a live one the caller leads or crews", () => {
    for (const t of ["service_job_photos", "service_job_repairs"])
      expect(f).toContain(
        `drop policy if exists ${t}_read on public.${t}; create policy ${t}_read on public.${t} for select to authenticated using (${CLAUSE});`,
      );
    expect(code).not.toMatch(/has_access\('service'\) or public\.has_access\('customers'\)/);
  });
  it("is based on the latest definition: no migration after 20260927130000 re-created either policy, and none after this one does", () => {
    const files = readdirSync(DIR)
      .filter((n) => n.endsWith(".sql"))
      .sort();
    const defining = files.filter((n) => {
      const c = noComments(read(`${DIR}/${n}`));
      return /create policy service_job_(photos|repairs)_read/.test(c);
    });
    expect(defining).toEqual(["20260927130000_service_field.sql", FILE]);
    expect(files[files.length - 1]).toBe(FILE);
  });
  it("the FOR ALL write policies open nothing wider for a technician: works_on_ticket is their own tickets already", () => {
    const lock = flat(read(`${DIR}/20261006192000_field_edit_lock.sql`));
    for (const t of ["service_job_photos", "service_job_repairs"])
      expect(lock).toContain(
        `create policy ${t}_write on public.${t} for all to authenticated using (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id))`,
      );
    expect(flat(read(`${DIR}/20261002120000_service_child_rls.sql`))).toContain(
      "select public.has_access('service') and (public.is_admin() or public.is_manager() or not public.is_technician() or public.leads_job(job) or public.is_on_crew(job));",
    );
  });
  it("is idempotent and touches only those two tables' read policies", () => {
    expect(count(code, "drop policy if exists")).toBe(2);
    expect(count(code, "create policy")).toBe(2);
    expect(code).not.toMatch(/_write on public/);
    expect(code).not.toMatch(/alter table/i);
  });
});

describe("the app's twin", () => {
  it("the server functions call exactly these two functions by name and sign the photo paths from the private bucket", () => {
    const src = read("src/lib/service-history.functions.ts");
    expect(src).toContain('rawRpc(context.supabase, "site_history", { p_job_id: data.id })');
    expect(src).toContain(
      'rawRpc(context.supabase, "site_history_summary", { p_job_id: data.id })',
    );
    expect(src).toContain(".createSignedUrls(paths, SIGNED_SECONDS)");
    expect(src).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
    expect(src).not.toMatch(/\.from\("service_job_(photos|repairs)"\)/);
  });
});
