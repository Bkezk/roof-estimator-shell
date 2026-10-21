/**
 * The service bucket's files fenced for a technician (owner, Oct 21: "go ahead and land it"):
 * supabase/migrations/20261021120000_service_objects_fence.sql. Until then any Service or
 * Customers login could read (sign a link to) any ticket's photo or receipt, and any Service
 * login could delete any file. The pins below are the proof the text keeps those rules; the
 * lead's live check as the technician-only login is the proof on the database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20261021120000_service_objects_fence.sql";
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const sql = flat(read(MIGRATION));

describe("service_object_readable: who may read (sign) a file in the service bucket", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.service_object_readable(object_name text)"),
    sql.indexOf("revoke all on function public.service_object_readable(text) from public;"),
  );
  it("is a SECURITY DEFINER, STABLE, search_path-pinned twin of service_object_writable", () => {
    expect(fn).toContain(
      "returns boolean language sql stable security definer set search_path = public",
    );
    expect(sql).toContain(
      "revoke all on function public.service_object_readable(text) from public;",
    );
    expect(sql).toContain(
      "grant execute on function public.service_object_readable(text) to authenticated, service_role;",
    );
  });
  it("invoice PDFs: admins, managers and sales / project managers, as before", () => {
    expect(fn).toContain(
      "when object_name like 'invoices/%' then public.is_admin() or public.is_manager() or public.is_sales_pm()",
    );
  });
  it("a ticket's files: the office, the ticket's own technician or crew, or a technician with a ticket at the same property", () => {
    expect(fn).toContain(
      "public.has_access('customers') or (public.has_access('service') and not public.is_technician())",
    );
    expect(fn).toContain(
      "j.id = split_part(object_name, '/', 1)::uuid and j.deleted_at is null and (j.technician_id = auth.uid() or public.is_on_crew(j.id))",
    );
    expect(fn).toContain("join public.service_jobs mine on mine.site_id = j.site_id");
    expect(fn).toContain(
      "j.site_id is not null and mine.deleted_at is null and (mine.technician_id = auth.uid() or public.is_on_crew(mine.id))",
    );
    // Both technician clauses still require the Service page.
    expect(fn.match(/public\.has_access\('service'\) and exists \(/g)).toHaveLength(2);
  });
  it("any other path: the office only", () => {
    expect(fn).toMatch(
      /else public\.has_access\('customers'\) or \(public\.has_access\('service'\) and not public\.is_technician\(\)\) end;/,
    );
  });
});

describe("the policies", () => {
  it("read: the bucket and the helper, nothing else", () => {
    expect(sql).toContain("drop policy if exists service_objects_read on storage.objects;");
    expect(sql).toContain(
      "create policy service_objects_read on storage.objects for select to authenticated using (bucket_id = 'service' and public.service_object_readable(name));",
    );
  });
  it("delete: the write rule (the people who work that ticket) or an admin — no longer any Service login", () => {
    expect(sql).toContain("drop policy if exists service_objects_delete on storage.objects;");
    expect(sql).toContain(
      "create policy service_objects_delete on storage.objects for delete to authenticated using (bucket_id = 'service' and (public.is_admin() or public.service_object_writable(name)));",
    );
    expect(sql).not.toMatch(
      /for delete[^;]*public\.has_access\('service'\) or public\.is_admin\(\)/,
    );
  });
  it("this is the latest definition of both policies", () => {
    const later = readdirSync("supabase/migrations")
      .filter((f) => f > "20261021120000_service_objects_fence.sql")
      .filter((f) =>
        /service_objects_read|service_objects_delete/.test(read(`supabase/migrations/${f}`)),
      );
    expect(later).toEqual([]);
  });
  it("the insert and update rules are untouched (service_object_writable, 20261002120000)", () => {
    expect(sql).not.toContain("service_objects_insert");
    expect(sql).not.toContain("service_objects_update");
    expect(sql).not.toContain("create or replace function public.service_object_writable");
  });
});

describe("the app's readers still fit the rule", () => {
  it("the ticket page signs its own ticket's paths in the browser; the history signs its property's on the server", () => {
    expect(read("src/components/service/field-utils.ts")).toContain(
      ".createSignedUrl(path!, 3600)",
    );
    expect(read("src/lib/service-history.functions.ts")).toContain(
      "sb.storage.from(BUCKET).createSignedUrls(paths, SIGNED_SECONDS)",
    );
  });
});
