/**
 * History wording (owner, Nov 10: "fix wording"; re-check record Part 1, observations A and B).
 * A ticket's History called the property a "site" ("site name", "site address"), and a
 * property's History printed a storage path when the aerial set the cover photo. Proved live as
 * the test login, rolled back: "Ticket 6023 property name '…' → 'ZZ A'; property address …;
 * site name — → 'ZZ Roof B'" and "Property '…' cover photo set from the aerial".
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AUDIT_PROPERTY_WORDS, auditFieldLabel } from "@/lib/audit";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const fn = (flat: string, name: string) => {
  const start = flat.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : flat.slice(start, flat.indexOf("$$;", start) + 3);
};

const NOW = "supabase/migrations/20261110213000_history_property_wording.sql";
const BEFORE = "supabase/migrations/20261103210000_audit_ticket_quiet.sql";
const flat = flatSql(NOW);
const colName = fn(flat, "audit_col_name");
const auditRow = fn(flat, "audit_row");

/** audit_col_name() as the migration writes it, run in TypeScript. */
function sqlColName(col: string): string {
  const whens = [...colName.matchAll(/when p_col = '([a-z_]+)' then '([a-z_]+)'/g)];
  const direct = whens.find((w) => w[1] === col);
  if (direct) return direct[2]!.replace(/_/g, " ");
  const list = /when p_col in \(([^)]*)\) then left\(p_col, -3\)/.exec(colName);
  const ids = list ? [...list[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!) : [];
  return (ids.includes(col) ? col.slice(0, -3) : col).replace(/_/g, " ");
}

describe("20261110213000: audit_col_name()", () => {
  it("a ticket's property reads property, not site", () => {
    expect(colName).not.toBe("");
    expect(sqlColName("site_id")).toBe("property");
    expect(sqlColName("site_name")).toBe("property name");
    expect(sqlColName("site_address")).toBe("property address");
  });
  it("the named site inside the property keeps the word site", () => {
    expect(sqlColName("location_id")).toBe("site");
    expect(sqlColName("location_name")).toBe("site name");
  });
  it("every other column reads as before", () => {
    expect(sqlColName("technician_id")).toBe("technician");
    expect(sqlColName("account_id")).toBe("account");
    expect(sqlColName("opportunity_id")).toBe("opportunity");
    expect(sqlColName("signature_path")).toBe("signature");
    expect(sqlColName("due_date")).toBe("due date");
    // site_id and location_id left the "drop the _id" list: they have their own words now.
    expect(colName).not.toMatch(/'site_id', 'account_id'/);
  });
  it("the app's twin says the same", () => {
    for (const [col, word] of Object.entries(AUDIT_PROPERTY_WORDS))
      expect(sqlColName(col)).toBe(word);
    expect(auditFieldLabel("ticket", "site_id")).toBe("property");
    expect(auditFieldLabel("ticket", "site_address")).toBe("property address");
    expect(auditFieldLabel("ticket", "location_id")).toBe("site");
    expect(auditFieldLabel("opportunity", "site_id")).toBe("property");
    expect(auditFieldLabel("bid", "site_id")).toBe("property");
  });
});

describe("20261110213000: audit_row()", () => {
  const before = fn(flatSql(BEFORE), "audit_row");
  it("a cover photo is one line in words, never a storage path", () => {
    expect(auditRow).toContain(
      "when tg_table_name = 'crm_sites' and v_col = 'cover_photo_path' then case when public.audit_blank(v_to) then 'cover photo removed' when v_new ->> 'cover_photo_source' = 'aerial' then 'cover photo set from the aerial' when public.audit_blank(v_from) then 'cover photo added' else 'cover photo changed' end",
    );
  });
  it("the source rides with the path: no second line, but both stay in `changes`", () => {
    const changes =
      "v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('from', v_from, 'to', v_to));";
    const skip =
      "continue when tg_table_name = 'crm_sites' and v_col = 'cover_photo_source' and not public.audit_same(v_old -> 'cover_photo_path', v_new -> 'cover_photo_path');";
    expect(auditRow).toContain(`${changes} ${skip} v_count := v_count + 1;`);
  });
  it("a contact tied to a property says property", () => {
    expect(auditRow).toContain(
      "v_summary := 'Contact ''' || v_label || ''' property ''' || v_site || ''''",
    );
    expect(auditRow).not.toContain("''' site ''' || v_site || '''' || case when tg_op = 'INSERT'");
  });
  it("is the Nov 3 function plus exactly those three edits", () => {
    expect(before).not.toBe("");
    const undone = auditRow
      .replace(
        " continue when tg_table_name = 'crm_sites' and v_col = 'cover_photo_source' and not public.audit_same(v_old -> 'cover_photo_path', v_new -> 'cover_photo_path');",
        "",
      )
      .replace(
        " when tg_table_name = 'crm_sites' and v_col = 'cover_photo_path' then case when public.audit_blank(v_to) then 'cover photo removed' when v_new ->> 'cover_photo_source' = 'aerial' then 'cover photo set from the aerial' when public.audit_blank(v_from) then 'cover photo added' else 'cover photo changed' end",
        "",
      )
      .replace("''' property ''' || v_site || ''''", "''' site ''' || v_site || ''''");
    expect(undone).toBe(before);
  });
  it("keeps the inner site's own line: Property 'X' site 'Y'", () => {
    expect(auditRow).toContain(
      "v_label := 'Property ''' || v_site || ''' site ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';",
    );
  });
});
