/**
 * History noise and labels (owner, Oct 6). The ticket History showed a bare
 * "Ticket 6012 stage changed at Oct 5, 2026 → Oct 6, 2026" row for every stage change (the
 * database writes stage_changed_at itself, 20261006180000) and nine backfill rows that carried
 * nothing else; a property's row still said "Site 'X'" after the interface started saying
 * Property; a property's inner sites (property_sites) and its warranties (site_warranties) left
 * no History at all; and a ticket's "location id" printed the raw uuid. 20261006200000 fixes the
 * function, 20261006201000 attaches the two triggers (the function must exist first).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIT_ENTITIES } from "@/lib/audit";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const fn = (flat: string, name: string) => {
  const start = flat.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : flat.slice(start, flat.indexOf("$$;", start) + 3);
};

const FUNCTIONS = "supabase/migrations/20261006200000_audit_ticket_readable.sql";
const TRIGGERS = "supabase/migrations/20261006201000_audit_property_children.sql";
const PREVIOUS = "supabase/migrations/20261005130000_ticket_audit.sql";
const flat = flatSql(FUNCTIONS);
const auditRow = fn(flat, "audit_row");

describe("20261006200000: audit_row()", () => {
  it("exists, and the triggers' migration comes after it", () => {
    expect(existsSync(FUNCTIONS)).toBe(true);
    expect(existsSync(TRIGGERS)).toBe(true);
    expect(auditRow).not.toBe("");
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
  it("skips stage_changed_at (the database's own stamp, 20261006180000), keeping the old skips", () => {
    expect(auditRow).toContain(
      "v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort', 'approved_by', 'approved_at', 'stage_changed_at'];",
    );
  });
  it("names a crm_sites row Property, the interface word since Oct 6", () => {
    expect(auditRow).toContain(
      "when 'crm_sites' then v_entity := 'site'; v_entity_id := (v_row ->> 'id')::uuid; v_parent := 'account_id'; v_label := 'Property ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';",
    );
    expect(auditRow).not.toContain("v_label := 'Site '''");
  });
  it("logs a property's inner sites as entity 'site' under the property, so the customer's History fold (listAudit: entity.eq.site, entity_id in the customer's crm_sites) shows them", () => {
    expect(auditRow).toContain(
      "when 'property_sites' then v_entity := 'site'; v_entity_id := (v_row ->> 'property_id')::uuid; v_parent := 'property_id'; select s.name into v_site from public.crm_sites s where s.id = v_entity_id; if not found then if tg_op = 'DELETE' then return null; end if; v_site := ''; end if; v_label := 'Property ''' || v_site || ''' site ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';",
    );
  });
  it("logs a property's warranties the same way, named by manufacturer and kind", () => {
    expect(auditRow).toContain(
      "when 'site_warranties' then v_entity := 'site'; v_entity_id := (v_row ->> 'site_id')::uuid; v_parent := 'site_id'; select s.name into v_site from public.crm_sites s where s.id = v_entity_id; if not found then if tg_op = 'DELETE' then return null; end if; v_site := ''; end if; v_label := 'Property ''' || v_site || ''' warranty ''' || btrim(coalesce(v_old ->> 'manufacturer', v_new ->> 'manufacturer', '') || ' ' || coalesce(v_old ->> 'kind', v_new ->> 'kind', '')) || '''';",
    );
  });
  it("is otherwise 20261005130000's exactly (the ticket branches included)", () => {
    const before = fn(flatSql(PREVIOUS), "audit_row");
    const stripped = auditRow
      .replace(", 'stage_changed_at'];", "];")
      .replace(
        "v_label := 'Property ''' || coalesce(v_old",
        "v_label := 'Site ''' || coalesce(v_old",
      )
      .replace(/when 'property_sites' then .*?(?=when 'crm_site_contacts')/, "")
      .replace(/when 'site_warranties' then .*?(?=when 'crm_site_contacts')/, "");
    expect(stripped).toBe(before);
  });
  it("leaves the entity check alone: both new kinds of row are entity 'site' (AUDIT_ENTITIES is unchanged)", () => {
    expect(flat).not.toContain("audit_log_entity_check");
    expect(AUDIT_ENTITIES).not.toContain("property_site");
    expect(AUDIT_ENTITIES).not.toContain("warranty");
  });
  it("deletes the nine backfill rows that changed nothing but stage_changed_at", () => {
    expect(flat).toContain(
      "delete from public.audit_log where entity = 'ticket' and action = 'update' and by_user is null and changes ?& array['stage_changed_at'] and (select count(*) from jsonb_object_keys(changes)) = 1;",
    );
  });
});

describe("20261006200000: audit_col_name() and audit_label() know location_id", () => {
  const colName = fn(flat, "audit_col_name");
  const label = fn(flat, "audit_label");
  const before = flatSql("supabase/migrations/20261002130000_audit_readable.sql");
  it("'location id' loses its _id like technician_id", () => {
    expect(colName).toContain(
      "when p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id', 'vendor_id', 'bill_to_vendor_id', 'site_id', 'account_id', 'contact_id', 'location_id') then left(p_col, -3)",
    );
    expect(colName.replace(", 'location_id')", ")")).toBe(fn(before, "audit_col_name"));
  });
  it("a location_id is shown as the inner site's name (property_sites)", () => {
    expect(label).toContain(
      "if p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id', 'approved_by', 'created_by', 'vendor_id', 'bill_to_vendor_id', 'site_id', 'account_id', 'contact_id', 'location_id') then",
    );
    const CASE =
      "elsif p_col = 'location_id' then select l.name into v_out from public.property_sites l where l.id = v_id; ";
    expect(label).toContain(CASE);
    expect(label.replace(", 'location_id') then", ") then").replace(CASE, "")).toBe(
      fn(before, "audit_label"),
    );
  });
  it("keeps the functions private, as before", () => {
    expect(flat).toContain(
      "revoke all on function public.audit_col_name(text) from public, anon, authenticated;",
    );
    expect(flat).toContain(
      "revoke all on function public.audit_label(text, text, jsonb) from public, anon, authenticated;",
    );
  });
});

describe("20261006201000: the triggers", () => {
  const t = flatSql(TRIGGERS);
  it("fire audit_row on a property's inner sites and warranties, replayable", () => {
    expect(t).toContain(
      "drop trigger if exists property_sites_audit on public.property_sites; create trigger property_sites_audit after insert or update or delete on public.property_sites for each row execute function public.audit_row();",
    );
    expect(t).toContain(
      "drop trigger if exists site_warranties_audit on public.site_warranties; create trigger site_warranties_audit after insert or update or delete on public.site_warranties for each row execute function public.audit_row();",
    );
  });
  it("comes after the function's migration (the branches must exist before the triggers fire)", () => {
    expect("20261006201000" > "20261006200000").toBe(true);
    expect(fn(t, "audit_row")).toBe("");
  });
});
