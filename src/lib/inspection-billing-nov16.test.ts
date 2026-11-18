/**
 * The rare paid inspection (owner, Nov 16: "can you make an invoice for an inspection?
 * occasionally they do charge for those although rarely" … "yes build it that way").
 *
 * Since Nov 3 an inspection ends at Authorized and nothing is invoiced. That stays the default.
 * Now an authorized inspection carries one button for a manager, "Invoice this inspection": it
 * makes the draft invoice, and an inspection WITH an invoice is billed like any ticket — every
 * stage, on to Invoiced and Closed. The same change takes authorized inspections that end there
 * out of the four waiting-to-invoice lists, where one had sat with no way to ever be invoiced.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { businessNumbers } from "@/lib/owner-business";
import {
  AWAITS_INVOICE_OR,
  INSPECTION_BILL_LABEL,
  INSPECTION_BILL_MANAGER,
  INSPECTION_STAGE_MESSAGE,
  INSPECTION_STAGES,
  awaitsInvoice,
  endsAtAuthorized,
  isInspectionType,
  stageChoices,
  stagesForType,
} from "@/lib/ticket-stage";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const manager = { role: "manager", access: [], technician: false } as const;
const sales = {
  role: "user",
  access: ["customers", "service", "invoices"],
  technician: false,
} as const;
const ALL = ["open", "scheduled", "done", "authorized", "invoiced", "closed"];

describe("the rule: an inspection ends at Authorized unless it has been billed", () => {
  it("an unbilled inspection ends at its sign-off, as since Nov 3", () => {
    expect(endsAtAuthorized("inspection")).toBe(true);
    expect(endsAtAuthorized("inspection", false)).toBe(true);
    expect(stagesForType("inspection")).toEqual(INSPECTION_STAGES);
    expect([...INSPECTION_STAGES]).toEqual(["open", "scheduled", "done", "authorized"]);
  });
  it("an inspection with an invoice has every stage, like a repair", () => {
    expect(endsAtAuthorized("inspection", true)).toBe(false);
    expect([...stagesForType("inspection", true)]).toEqual(ALL);
    expect(stageChoices(manager, "authorized", "inspection", true)).toEqual(ALL);
    expect(stageChoices(manager, "authorized", "inspection", false)).toEqual([
      "open",
      "scheduled",
      "done",
      "authorized",
    ]);
  });
  it("nothing changes for the other ticket types", () => {
    for (const type of ["repair", "warranty", "other", null, undefined]) {
      expect(endsAtAuthorized(type)).toBe(false);
      expect(endsAtAuthorized(type, true)).toBe(false);
      expect([...stagesForType(type)]).toEqual(ALL);
      expect(isInspectionType(type)).toBe(false);
    }
    expect(isInspectionType("inspection")).toBe(true);
  });
  it("the words say how to bill one", () => {
    expect(INSPECTION_BILL_LABEL).toBe("Invoice this inspection");
    expect(INSPECTION_STAGE_MESSAGE).toBe(
      "An inspection ends at Authorized. To bill it, press Invoice this inspection on the ticket first",
    );
    expect(INSPECTION_BILL_MANAGER).toBe("Only a manager can bill an inspection");
  });
});

describe("waiting for an invoice", () => {
  const t = (over: Record<string, unknown>) => ({
    stage: "authorized",
    service_type: "repair",
    invoice_id: null,
    ...over,
  });
  it("an authorized repair waits; an authorized inspection does not, until it is billed", () => {
    expect(awaitsInvoice(t({}))).toBe(true);
    expect(awaitsInvoice(t({ service_type: "inspection" }))).toBe(false);
    expect(awaitsInvoice(t({ service_type: "inspection", invoice_id: "inv-1" }))).toBe(true);
    expect(awaitsInvoice(t({ invoice_id: "inv-1" }))).toBe(true);
    for (const stage of ["open", "scheduled", "done", "invoiced", "closed"])
      expect(awaitsInvoice(t({ stage }))).toBe(false);
  });
  it("the database filter says the same", () => {
    expect(AWAITS_INVOICE_OR).toBe("service_type.neq.inspection,invoice_id.not.is.null");
  });
  it("the Invoices page's queue and its badge both use it", () => {
    const fn = flat("src/lib/service.functions.ts");
    const queue = fn.slice(
      fn.indexOf("export const listAwaitingInvoice"),
      fn.indexOf("export const AWAITING_INVOICE_COUNT_KEY"),
    );
    const badge = fn.slice(
      fn.indexOf("export const countAwaitingInvoice"),
      fn.indexOf("export const getServiceJob"),
    );
    for (const src of [queue, badge]) {
      expect(src).toContain('.eq("stage", "authorized")');
      expect(src).toContain(".or(AWAITS_INVOICE_OR)");
    }
  });
  it("Work Overview's Authorized — to invoice group uses it", () => {
    // In code, after the read: the rows carry the ticket's type and its invoice. Since the
    // Nov 16 audit (fix 9) the read itself filters too, so finished inspections never fill it.
    const work = flat("src/lib/my-work.functions.ts");
    expect(work).toContain(
      'import { AWAITS_INVOICE_OR, awaitsInvoice } from "@/lib/ticket-stage";',
    );
    expect(work).toMatch(/\.eq\("stage", TO_INVOICE_STAGE\)[^;]*\.or\(AWAITS_INVOICE_OR\)/);
    expect(work).toMatch(
      /toInvoice: \(\(toInvoice\.data \?\? \[\]\) as [^)]*\)\[\]\)\.filter\( awaitsInvoice, \),/,
    );
    expect(work).toMatch(
      /service_type, stage, scheduled_date, technician_id, stage_changed_at, invoice_id",/,
    );
  });
  it("the Owner page's Authorized, not invoiced tile leaves inspections out", () => {
    const base = {
      today: "2026-11-16",
      now: "2026-11-16T15:00:00Z",
      opps: [],
      snoozed: 0,
    };
    const ticket = (over: Record<string, unknown>) => ({
      id: "t",
      stage: "authorized",
      stage_changed_at: "2026-11-10T15:00:00Z",
      scheduled_date: "2026-11-01",
      invoice_id: null,
      technician_id: null,
      service_type: "repair",
      ...over,
    });
    expect(businessNumbers({ ...base, tickets: [ticket({})] }).toInvoice.count).toBe(1);
    expect(
      businessNumbers({
        ...base,
        tickets: [ticket({}), ticket({ id: "i", service_type: "inspection" })],
      }).toInvoice.count,
    ).toBe(1);
    // Later on Nov 16 the tab kept only this tile's read (the Authorized tickets).
    expect(flat("src/lib/owner-business.functions.ts")).toContain(
      '.select("id, stage, stage_changed_at, invoice_id, service_type")',
    );
  });
});

describe("the server", () => {
  const stage = flat("src/lib/service.functions.ts");
  const inv = flat("src/lib/invoices.functions.ts");
  it("a stage move reads the ticket's invoice, so a billed inspection may go on", () => {
    expect(stage).toContain('.select("stage, number, service_type, invoice_id")');
    expect(stage).toContain(
      "if (!stagesForType(prev.service_type, !!prev.invoice_id).includes(data.stage)) throw new Error(INSPECTION_STAGE_MESSAGE);",
    );
  });
  it("only a manager starts an inspection's first invoice; after that it is billed like any ticket", () => {
    // Nov 16 audit fix 4: "has an invoice" is read from the invoices, not from the ticket's
    // pointer (inspection-billing-rules-nov16b.test.ts runs it).
    expect(inv).toContain(
      // Nov 18: a Roof Care plan inspection is billed as a matter of course, so it is exempt
      // (roof-care-plan-nov18.test.ts). Every other inspection is a manager's, as here.
      "if (isInspectionType(job.service_type) && !job.roof_care_visit_id && !actor.manages) { const live = await liveInvoices(sb, job.id); if (!live.length) throw new Error(INSPECTION_BILL_MANAGER); }",
    );
    // After the stage check (a Done inspection is still reviewed first), before anything is made.
    const make = inv.slice(inv.indexOf("async function createInvoiceFor("));
    expect(make.indexOf("INVOICE_NEEDS_AUTH")).toBeLessThan(
      make.indexOf("INSPECTION_BILL_MANAGER"),
    );
    expect(make.indexOf("INSPECTION_BILL_MANAGER")).toBeLessThan(make.indexOf('.from("invoices")'));
    expect((inv.match(/manages: managesTickets\(p\)/g) ?? []).length).toBe(2);
  });
});

describe("the ticket", () => {
  const block = flat("src/components/service/invoice-block.tsx");
  it("an authorized, unbilled inspection shows the card; a billed one shows its invoice", () => {
    expect(block).toContain(
      "const signOff = endsAtAuthorized(job.service_type, !!job.invoice_id);",
    );
    expect(block).toContain(
      'if (signOff) return job.stage === "authorized" ? <BillInspectionCard job={job} /> : null;',
    );
    expect(block.indexOf("if (signOff) return")).toBeLessThan(
      block.indexOf("return <InvoiceCard job={job} />;"),
    );
  });
  it("the button is a manager's, makes the draft from the ticket and opens it", () => {
    const card = block.slice(
      block.indexOf("function BillInspectionCard("),
      block.indexOf("function AuthorizeCard("),
    );
    // Nov 18: the same card serves a Roof Care plan inspection, whose button is for everyone who
    // makes invoices. On any other inspection it is a manager's, as before.
    expect(card).toContain("{(carePlan || managesTickets(profile)) && ( <Button");
    expect(card).toContain("{carePlan ? CARE_PLAN_BILL_LABEL : INSPECTION_BILL_LABEL}");
    expect(card).toContain("mutationFn: () => makeFn({ data: { job_id: job.id } })");
    expect(card).toContain(
      'void navigate({ to: "/service/invoices", search: { id: r.invoice.id } });',
    );
    expect(card).toContain("This inspection is complete and nothing is invoiced.");
  });
  it("the stage picker and the stage strip follow the ticket's invoice", () => {
    const page = flat("src/components/service-page.tsx");
    expect(page).toMatch(
      /stageChoices\( profile, jobStage, job\?\.service_type, \/\/[^!]*!!job\?\.invoice_id, \)/,
    );
    expect(page).toContain("stagesForType(job.service_type, !!job.invoice_id)");
  });
  it("the sales role is offered no stage past its own on an inspection either way", () => {
    expect(stageChoices(sales, "authorized", "inspection", true)).toEqual(["authorized"]);
  });
});
