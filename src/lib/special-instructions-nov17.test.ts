/**
 * Owner, Nov 17: "can we also changes notes on service tickets to special instructions as we
 * already have the activity log". A ticket had two places called notes: the box on the ticket
 * and the notes written in its Activity. The box is now "Special instructions"; Activity keeps
 * its notes. Wording only: the column (service_jobs.notes) and who may type in the box are as
 * they were.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { auditFieldLabel } from "@/lib/audit";
import { FIELD_DETAILS_NOTE, TICKET_NOTES_LABEL } from "@/lib/field-ticket-page";

const read = (p: string) => readFileSync(p, "utf8");

describe("the ticket's box", () => {
  const page = read("src/components/service-page.tsx");

  it("is labelled Special instructions, for the office and the technician alike", () => {
    expect(TICKET_NOTES_LABEL).toBe("Special instructions");
    expect(page).toContain('<Label htmlFor="ticket-notes">{TICKET_NOTES_LABEL}</Label>');
    expect(page).not.toContain('<Label htmlFor="ticket-notes">Notes</Label>');
    // One box, one label: the form has no other.
    expect(page.split('htmlFor="ticket-notes"').length - 1).toBe(1);
  });

  it("still saves to the same place, and the technician may still type in it", () => {
    expect(page).toContain('onChange={(e) => set("notes", e.target.value)}');
    expect(page).toContain("? fieldNotesInput(job!, draft.notes)");
    expect(page).toMatch(/id="ticket-notes"[\s\S]{0,120}disabled=\{ro\}/);
  });

  it("the technician's line under the details names it", () => {
    expect(FIELD_DETAILS_NOTE).toBe(
      "The office sets these. Special instructions are below; the close-out marks the ticket Done.",
    );
  });
});

describe("History", () => {
  it("names the box on a ticket, and leaves every other notes alone", () => {
    expect(auditFieldLabel("ticket", "notes")).toBe("special instructions");
    expect(auditFieldLabel("opportunity", "notes")).toBe("notes");
    expect(auditFieldLabel("account", "notes")).toBe("notes");
    expect(auditFieldLabel("purchase_order", "notes")).toBe("notes");
    // The ticket's other words are as they were.
    expect(auditFieldLabel("ticket", "labor_rate_kind")).toBe("urgency");
    expect(auditFieldLabel("ticket", "site_id")).toBe("property");
  });

  it("the database writes the same word, for tickets only, without restating the function", () => {
    const sql = read("supabase/migrations/20261117150000_history_special_instructions.sql");
    expect(sql).toContain("pg_get_functiondef('public.audit_row()'::regprocedure)");
    expect(sql).toContain(
      "'case when tg_table_name = ''service_jobs'' and v_col = ''notes'' then ''special instructions'' '",
    );
    expect(sql).toContain("'else public.audit_col_name(v_col) end || '' '' ||'");
    // A second run does nothing; a function that no longer matches stops it.
    expect(sql).toContain("if position(v_new in v_def) > 0 then\n    return;");
    expect(sql).toContain("raise exception 'audit_row: expected the column name in one place");
    // The shared wording function is not touched: other tables' notes stay "notes".
    expect(sql).not.toContain("create or replace function public.audit_col_name");
  });
});
