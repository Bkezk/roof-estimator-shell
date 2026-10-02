/**
 * Who may set a ticket's stage (owner, Sep 27 and Oct 1). A technician sets Open / Scheduled /
 * Done (TECH_STAGES); Invoiced and Closed (OFFICE_STAGES) are a manager's or an admin's
 * (`managesTickets`): "Only a manager invoices or closes a ticket". An office user or a sales /
 * project manager who is neither sets the technician's stages too. Keeping the stage a ticket
 * already has is no change (a save of an Invoiced ticket by someone else is fine).
 *
 * Finalising an invoice still marks the ticket Invoiced (marking it paid, Closed) for whoever
 * may finalise: that goes through `public.set_ticket_stage_from_invoice` (SECURITY DEFINER,
 * checks the invoice), not through this rule. The database twin of this rule is the trigger
 * `service_jobs_stage_rule` (migration 20261001080000_audit_triggers_stage_rule.sql).
 *
 * Pure: no database, no server imports (unit tested in ticket-stage.test.ts).
 */
import { isOffice, managesTickets, type AccessLike } from "@/lib/access";
import type { ServiceStage } from "@/lib/service.functions";

/** The stages a technician may set. */
export const TECH_STAGES: readonly ServiceStage[] = ["open", "scheduled", "done"];
/** The stages only a manager or an admin sets (an invoice sets them through its own path). */
export const OFFICE_STAGES: readonly ServiceStage[] = ["invoiced", "closed"];
/** Every stage, in board order (the same as SERVICE_STAGES). */
const ALL_STAGES: readonly ServiceStage[] = [...TECH_STAGES, ...OFFICE_STAGES];

export const TECH_STAGE_MESSAGE =
  "A technician can mark a ticket Done; the office invoices and closes it";
export const MANAGER_STAGE_MESSAGE = "Only a manager invoices or closes a ticket";

/**
 * Why `p` may not move a ticket to `stage` (null = they may). `current` is the ticket's stage
 * now (undefined / null for a new ticket); keeping it is never refused.
 */
export function stageProblem(
  p: AccessLike | null | undefined,
  stage: ServiceStage,
  current?: string | null,
): string | null {
  if (current != null && stage === current) return null;
  if (managesTickets(p)) return null;
  if (!isOffice(p)) return TECH_STAGES.includes(stage) ? null : TECH_STAGE_MESSAGE;
  return OFFICE_STAGES.includes(stage) ? MANAGER_STAGE_MESSAGE : null;
}

/** The stages the picker offers: those `p` may set, plus the ticket's own stage. */
export function stageChoices(
  p: AccessLike | null | undefined,
  current: ServiceStage | null,
): ServiceStage[] {
  return ALL_STAGES.filter((s) => s === current || !stageProblem(p, s));
}

/** The ticket sits at a stage `p` may not set (Invoiced / Closed for a non-manager): read-only. */
export const stageLocked = (
  p: AccessLike | null | undefined,
  current: ServiceStage | null,
): boolean => !!current && !!stageProblem(p, current);

/**
 * Who is offered Close out on a ticket (audit, Oct 2): the ticket's lead technician — not once
 * the office has invoiced or closed it, unless they are office — and managers / admins
 * (`managesTickets`). The twin of the server: the close-out's crew question (setJobCrew) and
 * its field writes (ownJob) refuse anyone else, so an office user who is not a manager, or a
 * crew member who is not the lead, used to get stuck there. They see no button now.
 */
export function canCloseOut(
  p: (AccessLike & { id?: string | null }) | null | undefined,
  job: { technician_id: string | null; stage: string } | null | undefined,
): boolean {
  if (!p || !job) return false;
  if (managesTickets(p)) return true;
  if (!p.id || job.technician_id !== p.id) return false;
  return isOffice(p) || TECH_STAGES.includes(job.stage as ServiceStage);
}
