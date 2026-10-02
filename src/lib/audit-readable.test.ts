/**
 * Audit, Oct 2, items 5 and 7: migration 20261002130000_audit_readable.sql.
 *  5. The History printed raw uuids and timestamps ("county code id '6f1c…' → 'a2b3…'",
 *     "archived at — → '2026-10-01T14:03…'"). audit_row() is 20261001110000_vendors.sql's
 *     exactly but for the changed-column expression, which now names the referenced row
 *     (audit_label) without the "_id", prints dates, and reads archived / deleted / restored.
 *  7. save_contact_with_sites: the contact and its site links in one transaction, SECURITY
 *     INVOKER (the caller's RLS), called by saveContact.
 * The migration was also run in PGlite (Postgres in WASM) over sample rows; see the commit's
 * report. These tests pin the text.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PATH = "supabase/migrations/20261002130000_audit_readable.sql";
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const flat = flatSql(PATH);
const auditRow = (sql: string) =>
  sql.slice(
    sql.indexOf("create or replace function public.audit_row()"),
    sql.indexOf("revoke all on function public.audit_row() from public;"),
  );
const fnBody = (name: string) => {
  const a = flat.indexOf(`create or replace function public.${name}(`);
  const b = flat.indexOf("$$;", a);
  return a < 0 ? "" : flat.slice(a, b + 3);
};

describe("the migration file", () => {
  it("exists and is idempotent (create or replace; no bare create table / trigger)", () => {
    expect(flat.length).toBeGreaterThan(3000);
    expect(flat).not.toMatch(/create table /);
    expect(flat).not.toMatch(/create function /);
    expect(flat).not.toMatch(/create trigger /);
    expect(flat.match(/create or replace function public\.(\w+)\(/g)).toEqual([
      "create or replace function public.audit_col_name(",
      "create or replace function public.audit_label(",
      "create or replace function public.audit_row(",
      "create or replace function public.save_contact_with_sites(",
    ]);
  });
});

describe("5. audit_row: every branch kept, only the changed-column expression replaced", () => {
  const OLD_PART =
    "v_parts := v_parts || ( replace(v_col, '_', ' ') || ' ' || case when public.audit_blank(v_from) and v_action <> 'update' then public.audit_fmt(v_to) else public.audit_fmt(v_from) || ' → ' || public.audit_fmt(v_to) end);";
  const NEW_PART =
    "v_parts := v_parts || ( case when v_col in ('archived_at', 'deleted_at') and public.audit_blank(v_from) then case when v_col = 'archived_at' then 'archived' else 'deleted' end when v_col in ('archived_at', 'deleted_at') and public.audit_blank(v_to) then 'restored' else public.audit_col_name(v_col) || ' ' || case when public.audit_blank(v_from) and v_action <> 'update' then public.audit_label(tg_table_name, v_col, v_to) else public.audit_label(tg_table_name, v_col, v_from) || ' → ' || public.audit_label(tg_table_name, v_col, v_to) end end);";
  it("is 20261001110000_vendors.sql's audit_row() with the one expression swapped", () => {
    const before = auditRow(flatSql("supabase/migrations/20261001110000_vendors.sql"));
    const after = auditRow(flat);
    expect(before).toContain(OLD_PART);
    expect(after).toContain(NEW_PART);
    expect(after.replace(NEW_PART, OLD_PART)).toBe(before);
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
  it("keeps the delete / restore actions and every entity branch", () => {
    const after = auditRow(flat);
    for (const t of [
      "invoices",
      "invoice_lines",
      "crm_accounts",
      "crm_sites",
      "crm_contacts",
      "service_job_purchase_orders",
      "vendors",
      "crm_site_contacts",
    ])
      expect(after).toContain(`when '${t}' then`);
    expect(after).toContain("v_summary := v_label || ' restored';");
    expect(after).toContain(
      "when 'delete' then case when v_entity = 'invoice_line' then 'removed' else 'deleted' end",
    );
  });
});

describe("5. audit_label / audit_col_name", () => {
  const label = fnBody("audit_label");
  const col = fnBody("audit_col_name");
  it("county code → '0073 Bath, KY' (code, county, state)", () => {
    expect(label).toContain(
      "if p_col = 'county_code_id' then select c.code || ' ' || c.county || ', ' || c.state into v_out from public.county_codes c where c.id = v_id;",
    );
  });
  it("people → the profile's name, else email", () => {
    expect(label).toContain(
      "elsif p_col in ('account_manager_id', 'assignee_id', 'technician_id', 'approved_by', 'created_by') then select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), '')) into v_out from public.profiles p where p.id = v_id;",
    );
  });
  it("vendor, site, customer and contact ids → their names", () => {
    expect(label).toContain(
      "elsif p_col in ('vendor_id', 'bill_to_vendor_id') then select v.name into v_out from public.vendors v where v.id = v_id;",
    );
    expect(label).toContain(
      "elsif p_col = 'site_id' then select s.name into v_out from public.crm_sites s where s.id = v_id;",
    );
    expect(label).toContain(
      "elsif p_col = 'account_id' then select a.name into v_out from public.crm_accounts a where a.id = v_id;",
    );
    expect(label).toContain(
      "else select c.name into v_out from public.crm_contacts c where c.id = v_id;",
    );
  });
  it("unknown row or unreadable value → the raw value (audit_fmt); blank → —", () => {
    expect(label).toContain(
      "return coalesce(nullif(btrim(v_out), ''), public.audit_fmt(p_value));",
    );
    expect(label).toContain("exception when others then return public.audit_fmt(p_value);");
    expect(label).toContain("if public.audit_blank(p_value) then return '—';");
  });
  it("a *_at column → 'Oct 1, 2026' (office time)", () => {
    expect(label).toContain(
      "if right(p_col, 3) = '_at' and jsonb_typeof(p_value) = 'string' then return to_char((v_text::timestamptz) at time zone 'America/New_York', 'Mon FMDD, YYYY');",
    );
  });
  it("the column name loses _id for the references only (external_id keeps its name)", () => {
    expect(col).toContain(
      "when p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id', 'vendor_id', 'bill_to_vendor_id', 'site_id', 'account_id', 'contact_id') then left(p_col, -3)",
    );
    expect(col).not.toContain("external_id");
    expect(col).toContain("replace(");
  });
  it("neither helper is callable by app users (only from the SECURITY DEFINER trigger)", () => {
    expect(flat).toContain(
      "revoke all on function public.audit_col_name(text) from public, anon, authenticated;",
    );
    expect(flat).toContain(
      "revoke all on function public.audit_label(text, text, jsonb) from public, anon, authenticated;",
    );
    expect(label).not.toMatch(/security definer/);
  });
});

describe("7. save_contact_with_sites", () => {
  const fn = fnBody("save_contact_with_sites");
  it("SECURITY INVOKER (the caller's RLS), never definer; authenticated may call it", () => {
    expect(fn).toContain(
      "create or replace function public.save_contact_with_sites(p_contact jsonb, p_site_ids uuid[] default null) returns jsonb language plpgsql security invoker set search_path = public as $$",
    );
    expect(fn).not.toMatch(/security definer/);
    expect(flat).toContain(
      "revoke all on function public.save_contact_with_sites(jsonb, uuid[]) from public, anon;",
    );
    expect(flat).toContain(
      "grant execute on function public.save_contact_with_sites(jsonb, uuid[]) to authenticated;",
    );
  });
  it("a key left out keeps the column; insert when no id; update only the customer's live contact", () => {
    for (const c of ["name", "position", "email", "mobile", "office_phone", "notes"])
      expect(fn).toContain(
        `${c} = case when p_contact ? '${c}' then p_contact ->> '${c}' else c.${c} end`,
      );
    expect(fn).toContain(
      "is_billing = case when p_contact ? 'is_billing' then coalesce((p_contact ->> 'is_billing')::boolean, false) else c.is_billing end",
    );
    expect(fn).toContain(
      "where c.id = v_id and c.account_id = v_account and c.deleted_at is null returning * into v_row;",
    );
    expect(fn).toContain(
      "if v_id is null then insert into public.crm_contacts (account_id, name, position, email, mobile, office_phone, is_billing, notes)",
    );
  });
  it("the links: only the changed ones, only the customer's live sites, null keeps them", () => {
    expect(fn).toContain(
      "if p_site_ids is not null then delete from public.crm_site_contacts sc where sc.contact_id = v_row.id and not (sc.site_id = any (p_site_ids));",
    );
    expect(fn).toContain("on conflict (site_id, contact_id) do nothing;");
    expect(fn).toContain(
      "where s.id = t.site_id and s.account_id = v_account and s.deleted_at is null)",
    );
    expect(fn).toContain(
      "raise exception 'This customer was deleted; an admin or a manager can restore it';",
    );
  });
  it("returns the row plus site_ids; types.ts knows the function", () => {
    expect(fn).toContain(
      "return to_jsonb(v_row) || jsonb_build_object('site_ids', to_jsonb(v_sites));",
    );
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toContain(
      "save_contact_with_sites: {\n        Args: { p_contact: Json; p_site_ids?: string[] | null };\n        Returns: Json;\n      };",
    );
  });
});
