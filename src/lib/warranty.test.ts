/**
 * Roof warranties per site and their badge on tickets (service study M5, owner Oct 5).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inForce,
  monthYear,
  warrantyBadges,
  warrantyLabel,
  warrantyProblem,
  type Warranty,
} from "@/lib/warranty";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const TODAY = "2026-10-05";
const w = (over: Partial<Warranty> = {}): Warranty => ({
  id: "w1",
  site_id: "s1",
  manufacturer: "Duro-Last",
  kind: "15 NDL",
  number: "DL-123",
  start_date: "2016-03-01",
  end_date: "2031-03-01",
  notes: null,
  ...over,
});

describe("the badge", () => {
  it("'Duro-Last 15 NDL · to Mar 2031'; no end date, no 'to'", () => {
    expect(warrantyLabel(w())).toBe("Duro-Last 15 NDL · to Mar 2031");
    expect(warrantyLabel(w({ kind: null, end_date: null }))).toBe("Duro-Last");
    expect(monthYear("2031-03-01")).toBe("Mar 2031");
  });
  it("only while in force: started (or no start) and not ended (or no end), today counting", () => {
    expect(inForce(w(), TODAY)).toBe(true);
    expect(inForce(w({ end_date: "2024-01-01" }), TODAY)).toBe(false);
    expect(inForce(w({ start_date: "2027-01-01" }), TODAY)).toBe(false);
    expect(inForce(w({ end_date: TODAY }), TODAY)).toBe(true);
    expect(inForce(w({ start_date: null, end_date: null }), TODAY)).toBe(true);
  });
  it("a site's badges: the ones in force, ending last first", () => {
    expect(
      warrantyBadges(
        [
          w({ id: "a", manufacturer: "Firestone", kind: "10 yr", end_date: "2028-01-01" }),
          w({ id: "b" }),
          w({ id: "c", manufacturer: "JBK", kind: "2 yr", end_date: "2020-01-01" }),
        ],
        TODAY,
      ),
    ).toEqual(["Duro-Last 15 NDL · to Mar 2031", "Firestone 10 yr · to Jan 2028"]);
  });
  it("a warranty needs its manufacturer, and an end not before its start", () => {
    expect(warrantyProblem({ manufacturer: " ", start_date: null, end_date: null })).toBe(
      "Enter the manufacturer",
    );
    expect(
      warrantyProblem({ manufacturer: "X", start_date: "2026-01-02", end_date: "2026-01-01" }),
    ).toBe("The end date is before the start date");
    expect(warrantyProblem({ manufacturer: "X", start_date: null, end_date: null })).toBeNull();
  });
});

describe("the table", () => {
  const sql = flat(read("supabase/migrations/20261005160000_site_warranties.sql"));
  it("per site, cascades with it, replayable, with the site's own access rules", () => {
    expect(sql).toContain("create table if not exists public.site_warranties (");
    expect(sql).toContain(
      "site_id uuid not null references public.crm_sites(id) on delete cascade",
    );
    expect(sql).toContain("alter table public.site_warranties enable row level security;");
    expect(sql).toContain(
      "using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));",
    );
    expect(sql).toContain(
      "with check (public.has_access('customers') or public.has_access('service'));",
    );
  });
  it("the server checks the same rules before saving", () => {
    expect(read("src/lib/warranties.functions.ts")).toContain(
      "const problem = warrantyProblem(data);",
    );
  });
});

describe("on the screens", () => {
  // Owner, Oct 6: added and changed in the property's own form (Add property / the pencil); the
  // property's row lists them read-only.
  it("Customers › a property: the warranties listed; added and changed in the property form", () => {
    expect(read("src/components/customers-page.tsx")).toContain("<SiteWarranties siteId={s.id} />");
    expect(read("src/components/crm/site-warranties.tsx")).not.toContain("Add warranty");
    const form = read("src/components/crm/site-form.tsx");
    expect(form).toContain('<Plus className="mr-1 h-3.5 w-3.5" /> Add warranty');
    expect(form).toContain("await saveWFn({");
    expect(form).toContain("await delWFn({ data: { id } });");
  });
  it("the ticket and the technician's Today card show the badge", () => {
    expect(read("src/components/service-page.tsx")).toContain(
      "<WarrantyBadges siteId={site?.id} />",
    );
    expect(read("src/components/service/today-page.tsx")).toContain(
      "<WarrantyBadgeList badges={j.warranty_badges} />",
    );
    expect(read("src/lib/service-field.functions.ts")).toContain(
      "warranty_badges: j.site_id ? warrantyBadges(warrantiesOf.get(j.site_id) ?? [], today) : [],",
    );
  });
});
