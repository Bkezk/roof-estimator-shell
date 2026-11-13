/**
 * Owner, Nov 13: "can we change labor rate to urgency on the front end".
 *
 * A ticket's Standard / Urgent / Emergency choice was labelled "Labor rate" on the ticket,
 * "Rate kind" on Setup, and "labor rate kind" in the ticket's History. Every one of those reads
 * "Urgency" now. Wording only: the column keeps its name and still picks the invoice's rates.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditFieldLabel } from "@/lib/audit";

const read = (p: string) => readFileSync(p, "utf8");

describe("the ticket page", () => {
  const page = read("src/components/service-page.tsx");
  it("labels the choice Urgency, and no longer Labor rate", () => {
    expect(page).toContain('<Label htmlFor="ticket-rate">Urgency</Label>');
    expect(page).not.toContain(">Labor rate</Label>");
  });
  it("its hint says both things it does: first on the Tech Board, and the invoice's rates", () => {
    expect(page).toContain(
      "Urgent and Emergency tickets go first on the Tech Board. Also sets the hourly rates on the invoice",
    );
  });
  it("the copied-ticket notes say urgency", () => {
    expect(page).toContain("contact, PO #, urgency and type.");
    expect(page).toContain("PO #, urgency and type are copied.");
    expect(page).not.toMatch(/PO #, labor rate and type/);
  });
  it("still saves the same field, a manager's only", () => {
    expect(page).toContain("...(manager ? { labor_rate_kind: draft.labor_rate_kind } : {}),");
  });
});

describe("Setup, Service rates", () => {
  const setup = read("src/components/service-rates-settings.tsx");
  it("the sentence and the table's first column say Urgency", () => {
    expect(setup).toContain("The ticket's Urgency");
    expect(setup).not.toContain("The ticket's Labor rate");
    expect(setup).not.toContain("Rate kind");
    expect(setup).toMatch(/<th scope="col" className="py-1 pr-4 font-medium">\s*Urgency\s*<\/th>/);
  });
  it("the hourly Tech / Helper labor rate keeps its name: that one is dollars", () => {
    expect(setup).toContain("Tech / Helper labor rate below.");
  });
});

describe("a ticket's History", () => {
  const sql = read("supabase/migrations/20261113160000_history_urgency_wording.sql");
  it("the database names the field urgency for new lines", () => {
    expect(sql).toContain("when p_col = 'labor_rate_kind' then 'urgency'");
    // Everything the Nov 10 wording set is still there.
    const before = read("supabase/migrations/20261110213000_history_property_wording.sql");
    const body = (s: string) => {
      const from = s.indexOf("create or replace function public.audit_col_name");
      return s.slice(from, s.indexOf("$$;", from));
    };
    for (const line of body(before).split("\n")) {
      expect(body(sql)).toContain(line);
    }
  });
  it("renames nothing in the database and rewrites no old History", () => {
    expect(sql).not.toMatch(/alter table|rename column|update public\.audit_log|delete from/i);
  });
  it("the app's twin says the same", () => {
    expect(auditFieldLabel("service_job", "labor_rate_kind")).toBe("urgency");
    expect(auditFieldLabel("service_job", "site_id")).toBe("property");
    expect(auditFieldLabel("service_job", "po_number")).toBe("po number");
  });
});
