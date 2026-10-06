/**
 * Owner, Oct 6: "currently they are using the description to label sites within the properties
 * so properties also should have a sites form that can be added". CenterPoint: tickets 5275
 * ("CVNB Somerset") and 5458 share one property and differ only by description.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const PATH = "supabase/migrations/20261006170000_property_sites.sql";
const sql = existsSync(PATH) ? read(PATH) : "";

describe("named sites inside a property", () => {
  it("a table under the property, with the property's own access", () => {
    expect(sql).toMatch(/create table if not exists public\.property_sites/);
    expect(sql).toMatch(
      /property_id uuid not null references public\.crm_sites\(id\) on delete cascade/,
    );
    expect(sql).toMatch(
      /create policy property_sites_write[\s\S]*has_access\('customers'\) or public\.has_access\('service'\)/,
    );
  });
  it("a ticket names one, its name kept", () => {
    expect(sql).toMatch(
      /add column if not exists location_id uuid references public\.property_sites\(id\) on delete set null/,
    );
    expect(sql).toMatch(/add column if not exists location_name text/);
    const fns = read("src/lib/service.functions.ts");
    expect(fns).toContain("location_id: z.string().uuid().nullable().optional(),");
    expect(fns).toContain(
      'throw new Error("That site is not at this property — pick the site again");',
    );
    expect(fns).toContain("? { location_id: fields.location_id, location_name }");
  });
  it("saving the list hides a removed site and refuses two of one name", () => {
    const s = read("src/lib/property-sites.functions.ts");
    expect(s).toContain(".update({ deleted_at: new Date().toISOString() })");
    expect(s).toContain("throw new Error(SITE_NAME_TWICE(it.name));");
    expect(s).toContain("if (isMissingTable(error)) return [];");
  });
  it("Customers shows and edits a property's sites; the ticket picks one under its property", () => {
    expect(read("src/components/customers-page.tsx")).toContain(
      "<PropertySites propertyId={s.id} readOnly={readOnly} />",
    );
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("<PropertySiteSelect");
    expect(page).toContain(
      "location_id: draft.customer?.site_id ? draft.location_id || null : null,",
    );
    expect(page).toContain('location_id: d.customer?.site_id === site.id ? d.location_id : "",');
  });
});
