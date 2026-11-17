/**
 * Owner, Nov 17 (with a picture of the Kind choice on the new-customer form): "so on any of the
 * customer menus we dont need to differentiate between company and individual".
 *
 * The Company / Individual choice and its labels are gone from every customer screen. The
 * column stays in the database: a new customer takes its default ("company"), and saving an
 * existing customer leaves whatever it holds, so nothing that reads it changes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { accountSchema } from "@/lib/crm-account";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\s+/g, " ");
const picker = read("../components/crm/account-picker.tsx");
const page = read("../components/customers-page.tsx");

describe("the new-customer popup (every customer box opens it)", () => {
  const dialog = picker.slice(picker.indexOf("export function QuickAddCustomerDialog("));
  it("has no Kind choice", () => {
    expect(dialog).not.toContain("<Label>Kind</Label>");
    expect(dialog).not.toContain("ToggleGroup");
    expect(dialog).not.toContain(">Individual<");
    expect(dialog).not.toContain(">Company<");
  });
  it("a new customer is saved with the default kind", () => {
    expect(dialog).toContain('const kind = "company" as const;');
    expect(dialog).not.toContain("setKind");
  });
});

describe("the customer search list (the box on tickets, bids and opportunities)", () => {
  it("shows the name and the property count, with no (company) or (individual) beside it", () => {
    expect(picker).not.toContain("({h.kind})");
    expect(picker).not.toContain('h.kind === "individual"');
    expect(picker).toContain("· {h.site_count} properties</span>");
  });
});

describe("the Customers page", () => {
  it("the list card and the customer's own page carry no Company / Individual badge", () => {
    expect(page).not.toContain('{a.kind === "individual" ? "Individual" : "Company"}');
    expect(page).not.toContain('a.kind === "individual" ? ( <User');
  });
  it("the edit form has no Kind choice", () => {
    expect(page).not.toContain("<Label>Kind</Label>");
    expect(page).not.toContain('<ToggleGroupItem value="individual">');
  });
  it("the form still carries the customer's stored kind, so a save leaves it as it was", () => {
    expect(page).toContain('kind: a.kind === "individual" ? "individual" : "company",');
  });
});

describe("the server's rule is unchanged", () => {
  it("a customer saved with no kind is a company; a stored individual stays one", () => {
    const base = { name: "Acme Hardware", phone: "(606) 555-0100" };
    const made = accountSchema.safeParse(base);
    const kept = accountSchema.safeParse({ ...base, kind: "individual" });
    expect(made.success && made.data.kind).toBe("company");
    expect(kept.success && kept.data.kind).toBe("individual");
  });
});
