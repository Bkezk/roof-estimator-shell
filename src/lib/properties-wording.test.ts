/**
 * Properties wording leftovers (owner, Oct 6). Since Oct 6 a crm_sites row is a "Property" in the
 * interface; three places still said "site" for it: the Properties list's "Add site" button on the
 * customer profile, the ticket form's "Add site" button beside the property picker, and the county
 * codes settings' sentence. The inner sites of a property (property-sites.tsx, site-form.tsx's
 * "Sites" list, property-site-select.tsx) are still "Sites" and are not touched here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("a crm_sites row is a Property", () => {
  it("the customer profile's Properties list adds a property", () => {
    const src = read("src/components/customers-page.tsx");
    expect(src).toContain('<Plus className="mr-1 h-4 w-4" /> Add property');
    expect(src).not.toMatch(/>\s*Add site\s*</);
  });
  it("the ticket form's property picker adds a property", () => {
    const src = read("src/components/crm/site-select.tsx");
    expect(src).toContain('<Plus className="mr-1 h-4 w-4" /> Add property');
    expect(src).not.toMatch(/>\s*Add site\s*</);
  });
  it("the county codes settings speak of properties", () => {
    const src = read("src/components/crm/county-codes-settings.tsx").replace(/\s+/g, " ");
    expect(src).toContain(
      "JBK&apos;s county code for each property, picked on the property under Customers. A code a property still uses cannot be deleted.",
    );
    expect(src).not.toContain("for each site");
  });
  it("the customer list and the customer picker count properties, not sites (owner, Oct 7)", () => {
    const list = read("src/components/customers-page.tsx");
    // Oct 14: the card's Properties count.
    expect(list).toContain('<dt className="text-xs text-muted-foreground">Properties</dt>');
    expect(list).not.toContain('site${a.site_count === 1 ? "" : "s"}');
    const picker = read("src/components/crm/account-picker.tsx");
    expect(picker).toContain("` · ${h.site_count} properties`");
    expect(picker).not.toContain("} sites`");
  });
  it("the inner Sites of a property keep their word", () => {
    expect(read("src/components/crm/site-form.tsx")).toContain(
      '<Plus className="mr-1 h-3.5 w-3.5" /> Add site',
    );
  });
});

// This block lived in site-history.test.ts until the "Earlier at this property" fold became the
// History at this property fold (service-history.test.ts, Oct 21).
describe("Sites are called Properties (owner, Oct 6)", () => {
  it("in the interface; the data keeps its names", () => {
    const customers = read("src/components/customers-page.tsx");
    // Since Oct 15 the heading is the section's fold header (components/section-fold.tsx).
    expect(customers.replace(/\s+/g, " ")).toContain('icon={MapPin} title="Properties"');
    expect(customers).not.toMatch(/>\s*Sites\s*</);
    expect(read("src/components/crm/site-select.tsx")).toContain('"Pick the property…"');
    expect(read("src/components/service-page.tsx")).toMatch(
      /htmlFor="ticket-site"[^>]*>\s*Property\s*</,
    );
    expect(read("src/components/service/invoices-page.tsx")).not.toContain(
      'font-medium">Site</th>',
    );
    // The history fold and strip say "property" too (site-history.tsx).
    expect(read("src/components/service/site-history.tsx")).not.toMatch(/at this site/i);
  });
});
