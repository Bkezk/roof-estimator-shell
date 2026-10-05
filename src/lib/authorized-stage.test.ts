/**
 * The Authorized stage (service study M9, owner Oct 5): "manager/owner move through the steps to
 * scheduled; it appears on the techs side; the tech moves it to completed; the owner then moves
 * it to authorized once reviewed, and then the manager moves it to invoiced and closed." "The
 * manager can move it past authorize if need be." "Close by hand."
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVICE_STAGES, STAGE_LABELS } from "@/lib/service.functions";
import {
  INVOICE_NEEDS_AUTH,
  INVOICE_STAGES,
  MANAGER_STAGE_MESSAGE,
  OFFICE_STAGES,
  TECH_STAGES,
  TECH_STAGE_MESSAGE,
  stageProblem,
} from "@/lib/ticket-stage";
import { STAGE_VALUES } from "@/lib/service-search";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

const admin = { role: "admin", access: [], technician: false };
const manager = { role: "manager", access: [], technician: false };
const office = { role: "user", access: ["service"], technician: false };
const tech = { role: "user", access: ["service"], technician: true };

describe("the stages", () => {
  it("Open → Scheduled → Done → Authorized → Invoiced → Closed", () => {
    expect([...SERVICE_STAGES]).toEqual([
      "open",
      "scheduled",
      "done",
      "authorized",
      "invoiced",
      "closed",
    ]);
    expect(STAGE_LABELS.authorized).toBe("Authorized");
    expect([...STAGE_VALUES]).toEqual([...SERVICE_STAGES]);
  });
  it("Authorized is a manager's stage; the owner (admin) and managers set it, nobody else", () => {
    expect(OFFICE_STAGES).toContain("authorized");
    expect(TECH_STAGES).not.toContain("authorized");
    expect(stageProblem(admin, "authorized", "done")).toBeNull();
    expect(stageProblem(manager, "authorized", "done")).toBeNull();
    expect(stageProblem(office, "authorized", "done")).toBe(MANAGER_STAGE_MESSAGE);
    expect(stageProblem(tech, "authorized", "done")).toBe(TECH_STAGE_MESSAGE);
  });
  it("a manager may skip it (Done straight to Invoiced or Closed)", () => {
    expect(stageProblem(manager, "invoiced", "done")).toBeNull();
    expect(stageProblem(manager, "closed", "done")).toBeNull();
  });
});

describe("the migration", () => {
  const sql = flat(read("supabase/migrations/20261005140000_authorized_stage.sql"));
  it("adds the stage to the check, replayable", () => {
    expect(sql).toContain(
      "alter table public.service_jobs drop constraint if exists service_jobs_stage_check; alter table public.service_jobs add constraint service_jobs_stage_check check (stage in ('open', 'scheduled', 'done', 'authorized', 'invoiced', 'closed'));",
    );
  });
  it("the stage rule: authorized, invoiced, closed are a manager's", () => {
    expect(sql).toContain("if new.stage in ('authorized', 'invoiced', 'closed')");
    expect(sql).toContain(
      "raise exception 'Only a manager authorizes, invoices or closes a ticket'",
    );
    expect(sql).toContain(
      "create trigger service_jobs_stage_rule before insert or update of stage on public.service_jobs",
    );
  });
  it("the invoice path may send a ticket back to Authorized once no live invoice is left", () => {
    expect(sql).toContain("elsif p_stage = 'authorized' then");
    expect(sql).toContain("j.stage in ('invoiced', 'closed')");
    expect(sql).toContain(
      "not exists ( select 1 from public.invoices i where i.service_job_id = p_job and i.status in ('final', 'sent', 'paid') )",
    );
  });
});

describe("invoicing waits for Authorized", () => {
  const inv = read("src/lib/invoices.functions.ts");
  it("a new invoice is refused before Authorized, with a plain message", () => {
    expect([...INVOICE_STAGES]).toEqual(["authorized", "invoiced", "closed"]);
    expect(INVOICE_NEEDS_AUTH).toBe(
      "Authorize the ticket first: a Done ticket is reviewed before it is invoiced",
    );
    expect(inv).toContain(
      "if (!INVOICE_STAGES.includes(job.stage)) throw new Error(INVOICE_NEEDS_AUTH);",
    );
  });
  it("To invoice lists the Authorized tickets", () => {
    const svc = read("src/lib/service.functions.ts");
    const fn = svc.slice(svc.indexOf("export const listAwaitingInvoice"));
    expect(fn.slice(0, 900)).toContain('.eq("stage", "authorized")');
    expect(fn.slice(0, 900)).not.toContain('.eq("stage", "done")');
  });
  it("voiding the last invoice sends the ticket back to Authorized; paid never closes it", () => {
    expect(inv).toContain('p_stage: "authorized",');
    expect(inv).not.toContain('{ stage: "done" }');
    const paid = inv.slice(inv.indexOf("export const markInvoicePaid"));
    expect(paid.slice(0, 2500)).not.toContain("ticketStageFromInvoice(");
  });
});

describe("the ticket page at Done", () => {
  const block = read("src/components/service/invoice-block.tsx");
  it("shows Needs authorization instead of Make the invoice", () => {
    expect(block).toContain(
      'if (job.stage === "done" && !job.invoice_id) return <AuthorizeCard job={job} />;',
    );
    expect(block).toContain("Needs authorization");
  });
  it("a manager marks it authorized there; anyone else sees that it waits", () => {
    expect(block).toContain('stageFn({ data: { id: job.id, stage: "authorized" } })');
    expect(block).toContain("{managesTickets(profile) ? (");
    expect(block).toContain("Mark authorized");
    expect(block).toContain("Waiting for a manager to authorize it.");
  });
  it("the board and the list give Authorized its own look", () => {
    expect(read("src/components/service/board-page.tsx")).toMatch(
      /\n {2}authorized:\s*\n?\s*"border-teal-300/,
    );
    expect(read("src/components/service-page.tsx")).toContain('authorized: "secondary",');
  });
});
