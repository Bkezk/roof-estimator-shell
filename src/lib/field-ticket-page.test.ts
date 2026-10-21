/**
 * The technician-only user's ticket page is a field page (owner, Oct 21, after testing as the
 * "Test tech" login): the stage as text with no picker, the office's fields as plain text, Notes
 * still editable, every field section as before, Back to My tickets; the Tickets list and the Tech
 * Board send them to My tickets, the Service tabs row is not theirs, and "History at this
 * property" offers no Open link until the profile is known. The office, managers, admins and a
 * technician who also holds office pages see no change (owner, Oct 8).
 *
 * Fails on the old code: the stage picker rendered (disabled) for them, the form was the
 * technician's editable form, Back went to the Tickets list, the list and the board rendered,
 * the tabs row showed, and canOpen was true while the profile was still loading.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FIELD_BACK_TO,
  FIELD_DETAILS_NOTE,
  fieldNotesInput,
  isFieldTicketPage,
} from "@/lib/field-ticket-page";

const read = (p: string) => readFileSync(p, "utf8");

const techOnly = { role: "user", access: ["service", "inventory"], technician: true };
const officeTech = { role: "user", access: ["service", "customers"], technician: true };
const office = { role: "user", access: ["service", "customers"], technician: false };
const manager = { role: "manager", access: [], technician: true };
const admin = { role: "admin", access: [], technician: false };
const job = { id: "11111111-1111-4111-8111-111111111111" };

describe("isFieldTicketPage", () => {
  it("a saved ticket read by a technician-only user", () => {
    expect(isFieldTicketPage(techOnly, job)).toBe(true);
  });
  it("closed until the profile is known: no profile is the field page, never the office's controls", () => {
    expect(isFieldTicketPage(null, job)).toBe(true);
    expect(isFieldTicketPage(undefined, job)).toBe(true);
  });
  it("the office, a manager, an admin and an office person ticked Technician see no change (Oct 8)", () => {
    expect(isFieldTicketPage(officeTech, job)).toBe(false);
    expect(isFieldTicketPage(office, job)).toBe(false);
    expect(isFieldTicketPage(manager, job)).toBe(false);
    expect(isFieldTicketPage(admin, job)).toBe(false);
  });
  it("never on a new ticket (a technician-only user does not create one)", () => {
    expect(isFieldTicketPage(techOnly, null)).toBe(false);
    expect(isFieldTicketPage(null, null)).toBe(false);
  });
  it("Back goes to My tickets", () => {
    expect(FIELD_BACK_TO).toBe("/service/today");
  });
  it("the note under the details is in the technician's words", () => {
    expect(FIELD_DETAILS_NOTE).not.toMatch(/office fixes|the app\b/i);
    expect(FIELD_DETAILS_NOTE).toContain("notes");
  });
});

describe("fieldNotesInput: the notes, and the rest exactly as the ticket has it", () => {
  const row = {
    id: job.id,
    account_id: "22222222-2222-4222-8222-222222222222",
    site_id: "33333333-3333-4333-8333-333333333333",
    contact_id: "44444444-4444-4444-8444-444444444444",
    customer_name: "Bell County",
    description: "Leak over the gym",
    service_type: "leak",
    po_number: "PO-9",
    centerpoint_ticket: "CP1",
    centerpoint_invoice: null,
  };
  it("sends the fields saveServiceJob always writes, from the saved ticket, and the new notes", () => {
    const input = fieldNotesInput(row, "Checked the north wall");
    expect(input).toEqual({
      id: row.id,
      account_id: row.account_id,
      site_id: row.site_id,
      contact_id: row.contact_id,
      description: "Leak over the gym",
      service_type: "leak",
      po_number: "PO-9",
      notes: "Checked the north wall",
      centerpoint_ticket: "CP1",
      centerpoint_invoice: null,
    });
  });
  it("never the day, arrival window, Job #, technician, crew or labor rate (the server keeps each when not sent)", () => {
    const input = fieldNotesInput(row, "x") as Record<string, unknown>;
    for (const k of [
      "scheduled_date",
      "arrival_window",
      "job_number",
      "technician_id",
      "crew",
      "helper_count",
      "labor_rate_kind",
      "location_id",
      "stage",
    ])
      expect(k in input).toBe(false);
  });
  it("a ticket with no customer profile keeps its typed name; an unknown type reads as other", () => {
    const input = fieldNotesInput(
      { ...row, account_id: null, site_id: null, service_type: "weird" },
      "",
    );
    expect(input.customer_name).toBe("Bell County");
    expect(input.contact_id).toBeNull();
    expect(input.service_type).toBe("other");
  });
});

describe("the ticket page (components/service-page.tsx)", () => {
  const page = read("src/components/service-page.tsx");
  const editor = page.slice(page.indexOf("function TicketEditor("));
  it("derives the one flag from the pure helper", () => {
    expect(editor).toContain("const fieldPage = isFieldTicketPage(profile, job);");
  });
  it("the header: the stage as text (the picker's wording) for the field page; the picker, Repeat, Delete and the layout toggle only otherwise", () => {
    const header = editor.slice(
      editor.indexOf("{showCloseOut && ("),
      editor.indexOf('data-line="tags"'),
    );
    expect(header).toMatch(
      /\{fieldPage \? \([\s\S]*?aria-label="Stage"[\s\S]*?\{STAGE_LABELS\[asStage\(job\.stage\)\]\}[\s\S]*?\) : \(/,
    );
    // The office's controls sit in the other branch, after the field text.
    const split = header.indexOf(") : (", header.indexOf("{fieldPage ? ("));
    const field = header.slice(header.indexOf("{fieldPage ? ("), split);
    const officeSide = header.slice(split);
    expect(field).not.toContain("<Select");
    expect(field).not.toContain("Delete");
    expect(field).not.toContain("setLayout(");
    expect(officeSide).toMatch(
      /<Select\s+value=\{asStage\(job\.stage\)\}\s+disabled=\{ro \|\| lockedStage \|\| stageMut\.isPending\}/,
    );
    expect(officeSide).toContain('<Trash2 className="mr-1 h-4 w-4" /> Delete');
    expect(officeSide).toContain('onClick={() => setLayout(stacked ? "side" : "stacked")}');
  });
  it("the form: the read-only details block, the Timeline and the editable Notes — no inputs for the office's fields", () => {
    const form = editor.slice(editor.indexOf("<form"), editor.indexOf("</form>"));
    const at = form.indexOf("{fieldPage ? (");
    expect(at).toBeGreaterThan(0);
    const field = form.slice(at, form.indexOf(") : isTech ? (", at));
    expect(field).toContain("{fieldDetails}");
    expect(field).toContain("{customerContact}");
    expect(field).toContain("{notesField}");
    for (const piece of ["{customerField}", "{descriptionAndNumbers}", "{whatAndWhen}"])
      expect(field).not.toContain(piece);
    // The block itself: plain text, with the strip that opens History at this property.
    const block = editor.slice(
      editor.indexOf("const fieldDetails = "),
      editor.indexOf("const notesField = "),
    );
    expect(block).toContain('aria-label="Ticket details"');
    expect(block).not.toContain("<Input");
    expect(block).not.toContain("<Select");
    expect(block).toContain("<HistoryStrip jobId={job.id} onOpen={openHistory} />");
    expect(block).toContain("{FIELD_DETAILS_NOTE}");
    for (const label of ["Description", "Type", "Day", "Technician", "Crew"])
      expect(block).toContain(`<dt>${label}</dt>`);
    // Notes stay an editable box, saved through the notes-only input.
    expect(editor).toMatch(/<AutoTextarea\s+id="ticket-notes"[\s\S]*?disabled=\{ro\}/);
    expect(editor).toMatch(
      /const input: ServiceJobInput = fieldPage\s*\? fieldNotesInput\(job!, draft\.notes\)\s*: \{/,
    );
    // The Save button needs only a change (no customer / site / day checks on the field page).
    expect(editor).toMatch(/fieldPage\s*\? save\.isPending \|\| !dirty\s*:/);
  });
  it("Back goes to My tickets for the field page; the Tech Board / Awaiting invoice / Tickets rule stays for everyone else", () => {
    const back = page.slice(
      page.indexOf("function BackToList("),
      page.indexOf("interface Draft {"),
    );
    expect(back).toMatch(
      /\{fieldPage \? \(\s*<Link to="\/service\/today">\s*<ArrowLeft className="mr-1 h-4 w-4" \/> My tickets/,
    );
    expect(back).toMatch(/from === "board" \? \(\s*<Link to="\/service\/board"/);
    expect(back).toMatch(/from === "invoices" \? \(\s*<Link to="\/service\/invoices"/);
    expect(back).toMatch(/<Link to="\/service" search=\{\{\}\}>\s*<ArrowLeft[^\n]*\/> Tickets/);
    expect(editor).toContain("<BackToList fieldPage={fieldPage} />");
  });
  it("the customer is the office's: no change / add until the profile is known", () => {
    expect(editor).toContain("const ownsCustomer = !!profile && !isFieldOnly(profile);");
  });
  it("the field sections stay: clock line, Timeline, extras, materials, purchase orders, field sections, History fold", () => {
    for (const piece of [
      "{job && <JobClockLine jobId={job.id} />}",
      "<TicketExtras job={job} canEdit={canEdit} />",
      "<PurchaseOrdersSection jobId={job.id} />",
      "<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} />",
      "<HistoryFold job={job} open={historyOpen} onOpenChange={setHistoryOpen} />",
    ])
      expect(editor).toContain(piece);
  });
});

describe("the office's list and board send a technician-only user to My tickets", () => {
  it("the Tickets list (routes/service.tsx), when no ticket is named", () => {
    const route = read("src/routes/service.tsx");
    expect(route).toMatch(
      /if \(!search\.id && isFieldOnly\(profile\)\) return <Navigate to="\/service\/today" replace \/>;/,
    );
  });
  it("the Tech Board (routes/service.board.tsx)", () => {
    const route = read("src/routes/service.board.tsx");
    expect(route).toContain(
      'if (isFieldOnly(profile)) return <Navigate to="/service/today" replace />;',
    );
  });
  it("the Service tabs row is not shown to them", () => {
    const tabs = read("src/components/service/service-tabs.tsx");
    expect(tabs).toContain("if (isFieldOnly(profile)) return null;");
    // After the hooks (the awaiting count's query), before the row.
    expect(tabs.indexOf("if (isFieldOnly(profile)) return null;")).toBeGreaterThan(
      tabs.indexOf("const toInvoice = awaiting.data?.count ?? 0;"),
    );
  });
  it("the sidebar: My tickets for the Technician tick, Service for the office only, Inventory for everyone", () => {
    const side = read("src/components/app-sidebar.tsx");
    expect(side).toMatch(/title: "My tickets",\s*url: "\/service\/today",[\s\S]*?techOnly: true,/);
    expect(side).toContain(".filter((item) => !item.techOnly || !!profile?.technician)");
    expect(side).toContain("const isTech = !!profile && !isOffice(profile);");
    expect(side).toContain(".filter((item) => !(item.office && isTech))");
  });
});

describe("History at this property: no Open link until the profile is known", () => {
  it("canOpen needs a profile that is not technician-only", () => {
    const comp = read("src/components/service/site-history.tsx");
    expect(comp).toContain("const canOpen = !!profile && !isFieldOnly(profile);");
    expect(comp).not.toContain("const canOpen = !isFieldOnly(profile);");
  });
});
