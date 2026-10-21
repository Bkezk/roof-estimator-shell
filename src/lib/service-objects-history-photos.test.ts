/**
 * Owner, Oct 21 ("go with d"): the service bucket's same-property clause admits only the photos
 * a service_job_photos row names (never the signature), not every file under that ticket.
 * supabase/migrations/20261021130000_service_objects_history_photos.sql.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "20261021130000_service_objects_history_photos.sql";
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const sql = flat(read(`supabase/migrations/${FILE}`));
const fn = sql.slice(
  sql.indexOf("create or replace function public.service_object_readable(object_name text)"),
  sql.indexOf("revoke all on function public.service_object_readable(text) from public;"),
);

describe("the same-property clause: photos only", () => {
  it("joins the ticket's photo rows and requires the row to name the file and not be the signature", () => {
    expect(fn).toContain("join public.service_job_photos ph on ph.service_job_id = j.id");
    expect(fn).toContain("ph.storage_path = object_name and ph.role <> 'signature'");
    expect(fn).toContain("and (mine.technician_id = auth.uid() or public.is_on_crew(mine.id))");
  });
  it("the caller's own ticket's files are untouched (photos, signature, receipts)", () => {
    expect(fn).toContain(
      "j.id = split_part(object_name, '/', 1)::uuid and j.deleted_at is null and (j.technician_id = auth.uid() or public.is_on_crew(j.id))",
    );
  });
  it("invoice PDFs, the office and the fallback branch read as before; still SECURITY DEFINER", () => {
    expect(fn).toContain(
      "when object_name like 'invoices/%' then public.is_admin() or public.is_manager() or public.is_sales_pm()",
    );
    expect(fn).toContain(
      "public.has_access('customers') or (public.has_access('service') and not public.is_technician())",
    );
    expect(fn).toContain(
      "returns boolean language sql stable security definer set search_path = public",
    );
    expect(sql).toContain(
      "grant execute on function public.service_object_readable(text) to authenticated, service_role;",
    );
  });
  it("redefines the helper only — the read and delete policies stay those of 20261021120000", () => {
    expect(sql).not.toContain("create policy");
    expect(sql).not.toContain("drop policy");
    const later = readdirSync("supabase/migrations").filter(
      (f) => f > FILE && /service_object_readable/.test(read(`supabase/migrations/${f}`)),
    );
    expect(later).toEqual([]);
  });
});
