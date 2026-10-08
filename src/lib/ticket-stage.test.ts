/**
 * Owner, Oct 1: Invoiced and Closed are a manager's. A technician sets Open / Scheduled / Done;
 * an office user who is not a manager sets those too but not Invoiced or Closed; admins and
 * managers set any stage. Finalising an invoice still marks the ticket Invoiced (and marking it
 * paid, Closed) for a sales / project manager, through set_ticket_stage_from_invoice.
 *
 * stageProblem / stageChoices (ticket-stage.ts), source checks on the server functions, the
 * stage picker and the invoice path, and the migration 20261001080000_audit_triggers_stage_rule.sql.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SERVICE_STAGES } from "@/lib/service.functions";
import {
  DONE_VIA_CLOSEOUT_MESSAGE,
  MANAGER_STAGE_MESSAGE,
  OFFICE_STAGES,
  TECH_STAGES,
  TECH_STAGE_MESSAGE,
  stageChoices,
  stageLocked,
  stageProblem,
} from "@/lib/ticket-stage";

const read = (p: string) => readFileSync(p, "utf8");
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const admin = { role: "admin", access: [] };
const manager = { role: "manager", access: [] };
const managerTech = { role: "manager", access: [], technician: true };
const tech = { role: "user", access: ["service"], technician: true };
const office = { role: "user", access: ["service", "customers"], technician: false };
const sales = { role: "user", access: ["estimate", "service"], technician: false };

describe("stageProblem (pure)", () => {
  it("the stage sets: technician stages, office stages, together every stage in order", () => {
    expect([...TECH_STAGES]).toEqual(["open", "scheduled", "done"]);
    // Authorized (owner, Oct 5, M9): a manager's stage too.
    expect([...OFFICE_STAGES]).toEqual(["authorized", "invoiced", "closed"]);
    expect([...TECH_STAGES, ...OFFICE_STAGES]).toEqual([...SERVICE_STAGES]);
  });
  it("admins and managers (a manager ticked Technician too) set any stage", () => {
    for (const p of [admin, manager, managerTech])
      for (const s of SERVICE_STAGES) expect(stageProblem(p, s), `${p.role} ${s}`).toBeNull();
  });
  it("a technician sets only Open / Scheduled / Done", () => {
    for (const s of ["open", "scheduled"] as const) expect(stageProblem(tech, s)).toBeNull();
    // Owner, Oct 8: Done comes from the close-out's Complete, not the picker.
    expect(stageProblem(tech, "done")).toBe(DONE_VIA_CLOSEOUT_MESSAGE);
    expect(stageProblem(tech, "done", "done")).toBeNull();
    expect(stageProblem(tech, "invoiced")).toBe(TECH_STAGE_MESSAGE);
    expect(stageProblem(tech, "closed")).toBe(TECH_STAGE_MESSAGE);
  });
  it("an office user or a sales / PM who is not a manager: not Authorized, Invoiced or Closed", () => {
    for (const p of [office, sales]) {
      for (const s of ["open", "scheduled"] as const) expect(stageProblem(p, s)).toBeNull();
      expect(stageProblem(p, "done")).toBe(DONE_VIA_CLOSEOUT_MESSAGE);
      expect(stageProblem(p, "authorized")).toBe(MANAGER_STAGE_MESSAGE);
      expect(stageProblem(p, "invoiced")).toBe(
        "Only a manager authorizes, invoices or closes a ticket",
      );
      expect(stageProblem(p, "closed")).toBe(MANAGER_STAGE_MESSAGE);
    }
  });
  it("keeping the stage a ticket already has is no change (a save of an Invoiced ticket)", () => {
    expect(stageProblem(office, "invoiced", "invoiced")).toBeNull();
    expect(stageProblem(tech, "closed", "closed")).toBeNull();
    expect(stageProblem(office, "closed", "invoiced")).toBe(MANAGER_STAGE_MESSAGE);
    expect(stageProblem(office, "invoiced", null)).toBe(MANAGER_STAGE_MESSAGE);
  });
  it("nobody signed in is held to the technician rule", () => {
    expect(stageProblem(null, "scheduled")).toBeNull();
    expect(stageProblem(null, "done")).toBe(DONE_VIA_CLOSEOUT_MESSAGE);
    expect(stageProblem(null, "invoiced")).toBe(TECH_STAGE_MESSAGE);
  });
});

describe("stageChoices / stageLocked (the picker)", () => {
  it("a manager or an admin is offered every stage, never locked", () => {
    for (const p of [admin, manager, managerTech]) {
      expect(stageChoices(p, "done")).toEqual([...SERVICE_STAGES]);
      expect(stageChoices(p, "invoiced")).toEqual([...SERVICE_STAGES]);
      expect(stageLocked(p, "closed")).toBe(false);
    }
  });
  it("anyone else: Invoiced / Closed only when it is the ticket's stage, and then read-only", () => {
    for (const p of [office, sales, tech]) {
      // Done only when it already is (the close-out's Complete sets it; owner, Oct 8).
      expect(stageChoices(p, "done")).toEqual(["open", "scheduled", "done"]);
      expect(stageChoices(p, null)).toEqual(["open", "scheduled"]);
      expect(stageChoices(p, "scheduled")).toEqual(["open", "scheduled"]);
      // Owner, Oct 6: out of Authorized / Invoiced / Closed is a manager's move, so the ticket's
      // own stage is the only choice (stage-backwards-lock.test.ts).
      expect(stageChoices(p, "invoiced")).toEqual(["invoiced"]);
      expect(stageChoices(p, "closed")).toEqual(["closed"]);
      expect(stageLocked(p, "invoiced")).toBe(true);
      expect(stageLocked(p, "closed")).toBe(true);
      expect(stageLocked(p, "done")).toBe(false);
      expect(stageLocked(p, null)).toBe(false);
    }
  });
});

describe("the server functions apply stageProblem", () => {
  const svc = read("src/lib/service.functions.ts");
  it("saveServiceJob checks the stage against the ticket's current stage (create: none)", () => {
    const fn = serverFn(svc, "saveServiceJob");
    // An update sets no stage from its input (audit, Oct 2); its one move, Open → Scheduled, is
    // checked against the ticket's current stage.
    expect(fn).toMatch(
      /const problem = stageProblem\(p, "scheduled", cur\.stage\);\s*if \(problem\) throw new Error\(problem\);/,
    );
    expect(fn).toMatch(
      /const createProblem = stageProblem\(p, stage\);\s*if \(createProblem\) throw new Error\(createProblem\);/,
    );
  });
  it("setServiceStage refuses with the rule's message", () => {
    expect(serverFn(svc, "setServiceStage")).toMatch(
      /const problem = stageProblem\(p, data\.stage, prev\?\.stage\);\s*if \(problem\) throw new Error\(problem\);/,
    );
  });
  it("the old technician-only rule is gone", () => {
    expect(svc).not.toContain("techMayNotSet");
    expect(svc).not.toMatch(/!isOffice\(p\) && !TECH_STAGES\.includes/);
  });
});

describe("the stage picker offers Invoiced / Closed only to managers", () => {
  const page = read("src/components/service-page.tsx");
  it("options come from stageChoices; the select is read-only on a locked stage", () => {
    expect(page).toContain(
      "const stageOptions: readonly ServiceStage[] = stageChoices(profile, jobStage);",
    );
    expect(page).toContain("const lockedStage = stageLocked(profile, jobStage);");
    expect(page).toMatch(
      /<Select\s+value=\{asStage\(job\.stage\)\}\s+disabled=\{ro \|\| lockedStage \|\| stageMut\.isPending\}/,
    );
    // The old picker: every stage for anyone not a technician.
    expect(page).not.toContain(
      "SERVICE_STAGES.filter((s) => TECH_STAGES.includes(s) || s === jobStage)",
    );
  });
});

describe("the invoice path still sets Invoiced / Closed, through the database function", () => {
  const inv = read("src/lib/invoices.functions.ts");
  it("finalizeInvoice and sendInvoice (a draft) mark the ticket Invoiced via the rpc", () => {
    // Both finalise through the one shared routine (finalizeDraft), which calls the rpc.
    for (const fn of ["finalizeInvoice", "sendInvoice"])
      expect(serverFn(inv, fn), fn).toContain(
        "await finalizeDraft(sb, b, { id: context.userId, name: nameOf(p) });",
      );
    const draft = inv.slice(
      inv.indexOf("async function finalizeDraft("),
      inv.indexOf("export interface InvoiceWithLines"),
    );
    expect(draft).toContain(
      'await ticketStageFromInvoice(sb, b.invoice.service_job_id, "invoiced", updated.id);',
    );
    expect(inv).toMatch(
      /async function ticketStageFromInvoice[\s\S]*?sb\.rpc\("set_ticket_stage_from_invoice", \{\s*p_job: jobId,\s*p_stage: stage,\s*p_invoice: invoiceId,\s*\}\);\s*if \(error\)\s*throw new Error/,
    );
  });
  it("markInvoicePaid no longer closes the ticket (owner, Oct 5: close by hand)", () => {
    const fn = serverFn(inv, "markInvoicePaid");
    expect(fn).not.toContain("ticketStageFromInvoice(");
    expect(fn).toContain("ticket_closed: false");
  });
  it("no invoice function writes Invoiced or Closed to service_jobs directly", () => {
    expect(inv).not.toMatch(/\.update\(\{\s*stage: "(invoiced|closed)"/);
  });
  it("types.ts knows set_ticket_stage_from_invoice", () => {
    expect(read("src/integrations/supabase/types.ts")).toMatch(
      /set_ticket_stage_from_invoice: \{\s*Args: \{ p_job: string; p_stage: string; p_invoice\?: string \| null \};\s*Returns: undefined;/,
    );
  });
});

describe("migration 20261001080000: the stage rule in the database", () => {
  const sql = read("supabase/migrations/20261001080000_audit_triggers_stage_rule.sql");
  const flat = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  it("a before trigger on service_jobs refuses Invoiced / Closed unless allowed", () => {
    expect(flat).toContain(
      "drop trigger if exists service_jobs_stage_rule on public.service_jobs; create trigger service_jobs_stage_rule before insert or update of stage on public.service_jobs for each row execute function public.service_jobs_stage_rule();",
    );
    expect(flat).toContain(
      "if new.stage in ('invoiced', 'closed') and (tg_op = 'INSERT' or new.stage is distinct from old.stage) and auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() and not public.is_manager() and coalesce(current_setting('jbk.stage_from_invoice', true), '') <> 'on' then raise exception 'Only a manager invoices or closes a ticket' using errcode = '42501';",
    );
  });
  it("set_ticket_stage_from_invoice: security definer, invoice people only, needs the invoice", () => {
    expect(flat).toContain(
      "create or replace function public.set_ticket_stage_from_invoice( p_job uuid, p_stage text, p_invoice uuid default null ) returns void language plpgsql security definer set search_path = public as $$",
    );
    expect(flat).toContain(
      "if auth.uid() is not null and not (public.is_admin() or public.is_manager() or public.is_sales_pm()) then",
    );
    expect(flat).toContain("and i.status in ('final', 'sent', 'paid')");
    expect(flat).toContain("perform set_config('jbk.stage_from_invoice', 'on', true);");
    expect(flat).toContain(
      "grant execute on function public.set_ticket_stage_from_invoice(uuid, text, uuid) to authenticated;",
    );
  });
});
