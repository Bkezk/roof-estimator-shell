/**
 * Who may set a ticket's stage (owner, Sep 27 and Oct 1). A technician sets Open / Scheduled /
 * Done (TECH_STAGES); Authorized, Invoiced and Closed (OFFICE_STAGES) are a manager's or an admin's
 * (`managesTickets`): "Only a manager invoices or closes a ticket". An office user or a sales /
 * project manager who is neither sets the technician's stages too. Keeping the stage a ticket
 * already has is no change (a save of an Invoiced ticket by someone else is fine).
 *
 * Finalising an invoice still marks the ticket Invoiced (marking it paid, Closed) for whoever
 * may finalise: that goes through `public.set_ticket_stage_from_invoice` (SECURITY DEFINER,
 * checks the invoice), not through this rule. The database twin of this rule is the trigger
 * `service_jobs_stage_rule` (migration 20261001080000_audit_triggers_stage_rule.sql; since
 * 20261006190000_stage_backwards_lock.sql it guards the way out too).
 *
 * Both ways (owner, Oct 6): once a ticket is Authorized, Invoiced or Closed, only a manager or an
 * admin moves it anywhere else — a technician had moved their own Authorized ticket back to Done
 * and their Closed ticket back to Open. The ticket's current stage decides, so `stageProblem`
 * needs it (`current`) wherever a ticket already exists.
 *
 * Pure: no database, no server imports (unit tested in ticket-stage.test.ts).
 */
import { isOffice, managesTickets, type AccessLike } from "@/lib/access";
import type { ServiceStage } from "@/lib/service.functions";

/** The stages a technician may set. */
export const TECH_STAGES: readonly ServiceStage[] = ["open", "scheduled", "done"];
/**
 * The stages only a manager or an admin sets (an invoice sets Invoiced through its own path).
 * Authorized (owner, Oct 5): the owner reviews a Done ticket; "the manager can move it past
 * authorize if need be".
 */
export const OFFICE_STAGES: readonly ServiceStage[] = ["authorized", "invoiced", "closed"];

/** The stages a ticket may be invoiced at: Authorized and after (a Done ticket is reviewed first). */
export const INVOICE_STAGES: readonly string[] = ["authorized", "invoiced", "closed"];
export const INVOICE_NEEDS_AUTH =
  "Authorize the ticket first: a Done ticket is reviewed before it is invoiced";
/** Every stage, in board order (the same as SERVICE_STAGES). */
const ALL_STAGES: readonly ServiceStage[] = [...TECH_STAGES, ...OFFICE_STAGES];

export const TECH_STAGE_MESSAGE =
  "A technician can mark a ticket Done; the office invoices and closes it";
export const MANAGER_STAGE_MESSAGE = "Only a manager authorizes, invoices or closes a ticket";
/**
 * A technician's edit of a ticket at an office stage (owner, Oct 6): the office changes it now
 * (saveServiceJob; the twin of RLS service_jobs_update, 20261006190000_stage_backwards_lock.sql).
 */
export const TECH_LOCKED_MESSAGE =
  "A technician cannot change a ticket once it is Authorized, Invoiced or Closed";

/**
 * Why `p` may not move a ticket to `stage` (null = they may). `current` is the ticket's stage
 * now (undefined / null for a new ticket); keeping it is never refused. Out of Authorized,
 * Invoiced or Closed (owner, Oct 6): a manager's or an admin's, whatever the target.
 */
export function stageProblem(
  p: AccessLike | null | undefined,
  stage: ServiceStage,
  current?: string | null,
): string | null {
  if (current != null && stage === current) return null;
  if (managesTickets(p)) return null;
  if (current != null && OFFICE_STAGES.includes(current as ServiceStage))
    return MANAGER_STAGE_MESSAGE;
  if (!isOffice(p)) return TECH_STAGES.includes(stage) ? null : TECH_STAGE_MESSAGE;
  return OFFICE_STAGES.includes(stage) ? MANAGER_STAGE_MESSAGE : null;
}

/**
 * A technician's edit of a ticket at an office stage is refused (owner, Oct 6): a plain user
 * ticked Technician (the office — anyone else — still saves it, as before). saveServiceJob's
 * check; RLS service_jobs_update says the same (20261006190000_stage_backwards_lock.sql).
 */
export const techStageLocked = (
  p: AccessLike | null | undefined,
  stage: string | null | undefined,
): boolean =>
  !!p?.technician && !managesTickets(p) && OFFICE_STAGES.includes(stage as ServiceStage);

/**
 * The stages the picker offers: those `p` may set from the ticket's current stage, plus that
 * stage itself (a non-manager on an Authorized / Invoiced / Closed ticket sees it alone).
 */
export function stageChoices(
  p: AccessLike | null | undefined,
  current: ServiceStage | null,
): ServiceStage[] {
  return ALL_STAGES.filter((s) => s === current || !stageProblem(p, s, current));
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
