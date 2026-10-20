/**
 * Named sites and warranties fenced for technicians (the sixth audit, Oct 21; item b).
 * property_sites_read and site_warranties_read admitted has_access('service') outright, and
 * their `_write` policies were FOR ALL (which also grants SELECT), so a technician-only token
 * read every property's named sites and every roof warranty.
 * 20261021091000_sites_warranties_fence.sql: the read policies become customers / estimate /
 * service-not-technician / tech_sees_site(property_id | site_id), and the writes are split into
 * insert / update / delete (customers or service) so they grant no read. The technician's ticket
 * page reads by the ticket's site id, which tech_sees_site admits.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const MIG = "supabase/migrations/20261021091000_sites_warranties_fence.sql";
const sql = read(MIG);
const f = flat(sql);
const OFFICE =
  "public.has_access('customers') or public.has_access('estimate') or (public.has_access('service') and not public.is_technician())";

describe("the read policies", () => {
  it("property_sites_read: the office rule or tech_sees_site(property_id)", () => {
    expect(f).toContain(
      `drop policy if exists property_sites_read on public.property_sites; create policy property_sites_read on public.property_sites for select to authenticated using (${OFFICE} or public.tech_sees_site(property_id));`,
    );
  });
  it("site_warranties_read: the same with tech_sees_site(site_id)", () => {
    expect(f).toContain(
      `drop policy if exists site_warranties_read on public.site_warranties; create policy site_warranties_read on public.site_warranties for select to authenticated using (${OFFICE} or public.tech_sees_site(site_id));`,
    );
  });
  it("relies on tech_sees_site from 20261020122000 (an earlier migration), defining nothing itself", () => {
    expect(noComments(sql)).not.toMatch(/create (or replace )?function/);
    const fence = flat(read("supabase/migrations/20261020122000_technician_customer_fence.sql"));
    expect(fence).toContain("create or replace function public.tech_sees_site(site uuid)");
    expect("20261020122000" < "20261021091000").toBe(true);
  });
});

describe("the write policies are split so they grant no read", () => {
  it("drops property_sites_write and site_warranties_write and creates insert / update / delete with customers or service", () => {
    expect(f).toContain("foreach t in array array['property_sites', 'site_warranties'] loop");
    expect(f).toContain(
      "execute format('drop policy if exists %I on public.%I;', t || '_write', t);",
    );
    for (const op of ["insert", "update", "delete"])
      expect(f).toContain(
        `execute format('drop policy if exists %I on public.%I;', t || '_${op}', t);`,
      );
    expect(f).toContain(
      "'create policy %I on public.%I for insert to authenticated with check (public.has_access(''customers'') or public.has_access(''service''));', t || '_insert', t);",
    );
    expect(f).toContain(
      "'create policy %I on public.%I for update to authenticated using (public.has_access(''customers'') or public.has_access(''service'')) with check (public.has_access(''customers'') or public.has_access(''service''));', t || '_update', t);",
    );
    expect(f).toContain(
      "'create policy %I on public.%I for delete to authenticated using (public.has_access(''customers'') or public.has_access(''service''));', t || '_delete', t);",
    );
    expect(f).not.toMatch(/for all to authenticated/);
  });
  it("is idempotent and touches only the two tables", () => {
    const code = noComments(sql);
    expect((code.match(/drop policy if exists property_sites_read/g) ?? []).length).toBe(1);
    expect((code.match(/drop policy if exists site_warranties_read/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/on public\.(?!property_sites\b|site_warranties\b|%I)\w+/);
    expect(code).not.toContain("county_codes");
    expect(code).not.toContain("crm_site_contacts");
  });
});

describe("the technician's ticket page reads by the ticket's site (admitted by tech_sees_site)", () => {
  it("WarrantyBadges and PropertySiteSelect take the ticket's site id", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("<WarrantyBadges siteId={site?.id} />");
    expect(page).toMatch(
      /<PropertySiteSelect\s+id="ticket-property-site"\s+propertyId=\{props\.siteId\}/,
    );
    // `site` is the ticket's own site among the account's.
    expect(page).toContain(
      "const site = props.siteId ? detail.data?.sites.find((s) => s.id === props.siteId) : undefined;",
    );
  });
  it("the server functions filter by that id, and the database admits the row through it", () => {
    expect(read("src/lib/warranties.functions.ts")).toMatch(
      /listSiteWarranties = createServerFn[\s\S]*?\.from\("site_warranties"\)[\s\S]*?\.eq\("site_id", data\.site_id\)/,
    );
    expect(read("src/lib/property-sites.functions.ts")).toMatch(
      /listPropertySites = createServerFn[\s\S]*?\.from\("property_sites"\)[\s\S]*?\.eq\("property_id", data\.property_id\)/,
    );
    // saveServiceJob's location check: the named site's property must be the ticket's site.
    const svc = read("src/lib/service.functions.ts");
    expect(svc).toMatch(
      /\.from\("property_sites"\)\s*\.select\("name, property_id"\)\s*\.eq\("id", fields\.location_id\)/,
    );
    expect(svc).toContain("if (!loc || loc.property_id !== fields.site_id)");
    // My tickets: warranties by the technician's own tickets' sites.
    expect(read("src/lib/service-field.functions.ts")).toMatch(
      /\.from\("site_warranties"\)[\s\S]*?\.in\("site_id", siteIds\)/,
    );
  });
});
