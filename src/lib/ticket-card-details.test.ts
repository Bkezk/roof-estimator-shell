/**
 * Owner, Oct 6: "on the ticket menu we should have more details on the tickets so before you click
 * one at a glance you can see most pertinent info, none of the cost needs to be there but the job
 * number, technician, type, property, city, state, description (site for our app), stage date,
 * purchase order (of the main ticket not on materials used) and ticket ID".
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/service-page.tsx");
const card = page.slice(
  page.indexOf("function TicketListRow("),
  page.indexOf("function TicketLoader("),
);

describe("the ticket list card", () => {
  it("shows ticket #, type, stage and the day it entered that stage", () => {
    expect(card).toContain("#{j.number} {j.customer_name}");
    expect(card).toContain("{typeLabel(j.service_type)}");
    expect(card).toContain("<StageBadge stage={stage} fieldStatus={j.field_status} />");
    expect(card).toContain("since {since}");
    expect(card).toContain("const since = shortDate(j.stage_changed_at);");
  });
  it("shows the property › site and its city, state, then the description", () => {
    expect(card).toContain(
      'const place = [j.site_name, j.location_name].filter(Boolean).join(" › ");',
    );
    expect(card).toContain("const cityState = [j.site_city, j.site_state]");
    expect(card).toContain('{j.description && <p className="text-sm">{j.description}</p>}');
  });
  it("shows technician, day, Job #, the ticket's own PO #, CenterPoint # — and no money", () => {
    expect(card).toContain("j.job_number ? `Job # ${j.job_number}` : null,");
    expect(card).toContain("j.po_number ? `PO # ${j.po_number}` : null,");
    expect(card).toContain('j.technician_name ?? "Unassigned",');
    expect(card).not.toMatch(/total|amount|\$\{.*cost|grand_total/i);
  });
  it("the list attaches each property's city and state", () => {
    expect(read("src/lib/service.functions.ts")).toContain(
      "return withPlaces(context.supabase, await withTechNames(context.supabase, data ?? []));",
    );
  });
  it("the stage date is the database's, filled in for existing tickets", () => {
    const p = "supabase/migrations/20261006180000_ticket_stage_date.sql";
    const sql = existsSync(p) ? read(p) : "";
    expect(sql).toMatch(/add column if not exists stage_changed_at timestamptz/);
    expect(sql).toMatch(
      /elsif new\.stage is distinct from old\.stage then\s+new\.stage_changed_at := now\(\);/,
    );
    expect(sql).toMatch(/e\.kind = 'stage' and e\.stage = j\.stage/);
  });
});
