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
import { OFFICE_STAGES as ALL_OFFICE_STAGES, WORK_STAGES } from "@/lib/ticket-stages";

/** The stages a technician may set. */
export const TECH_STAGES: readonly ServiceStage[] = WORK_STAGES;
/**
 * The stages only a manager or an admin sets (an invoice sets Invoiced through its own path).
 * Authorized (owner, Oct 5): the owner reviews a Done ticket; "the manager can move it past
 * authorize if need be".
 */
export const OFFICE_STAGES: readonly ServiceStage[] = ALL_OFFICE_STAGES;

/** The stages a ticket may be invoiced at: Authorized and after (a Done ticket is reviewed first). */
export const INVOICE_STAGES: readonly string[] = ALL_OFFICE_STAGES;
export const INVOICE_NEEDS_AUTH =
  "Authorize the ticket first: a Done ticket is reviewed before it is invoiced";
/** Every stage, in board order (the same as SERVICE_STAGES). */
const ALL_STAGES: readonly ServiceStage[] = [...TECH_STAGES, ...OFFICE_STAGES];

/**
 * An inspection's stages (owner, Nov 3: "inspections just need the steps open, scheduled, and
 * done", then "we may need the authorized step just so the owner can see it was completed and
 * signed off on it"): Open, Scheduled, Done, Authorized — the sign-off is the end. No invoice,
 * no Closed. Everything else has them all.
 *
 * The rare paid inspection (owner, Nov 16: "occasionally they do charge for those although
 * rarely" … "yes build it that way"): a manager presses "Invoice this inspection" on the
 * authorized ticket, which makes its draft invoice. An inspection WITH an invoice (the ticket's
 * invoice_id; a deleted draft clears it) has every stage, as a repair does, and goes on to
 * Invoiced and Closed. One nobody bills still ends at Authorized. Every rule below takes the
 * ticket's invoice for that reason (`hasInvoice`).
 */
export const INSPECTION_STAGES: readonly ServiceStage[] = [
  "open",
  "scheduled",
  "done",
  "authorized",
];
/** The server's refusal when an unbilled inspection is pushed past Authorized (Nov 4, bug 16). */
export const INSPECTION_STAGE_MESSAGE =
  "An inspection ends at Authorized. To bill it, press Invoice this inspection on the ticket first";
/** The button on an authorized inspection, and who it is for (Nov 16). */
export const INSPECTION_BILL_LABEL = "Invoice this inspection";
export const INSPECTION_BILL_MANAGER = "Only a manager can bill an inspection";
/** The same button on a Roof Care plan inspection, which is billed as a matter of course. */
export const CARE_PLAN_BILL_LABEL = "Invoice this care plan inspection";
/**
 * What the Needs authorization card says on a Roof Care plan inspection (Nov 19). It used to
 * say nothing is invoiced, as for any inspection, while the invoice is made at that press.
 */
export const CARE_PLAN_AUTHORIZE_NOTE =
  "The inspection is done. Once it is reviewed and authorized, its draft invoice is made by itself. A visit bills its half of the plan. A storm inspection is included: its invoice is for nothing and keeps what the trip cost.";
/** The toast after that press. */
export const carePlanAuthorizedToast = (number: number | string) =>
  `Inspection #${number} authorized. Its draft invoice is on the ticket.`;
/**
 * How the server's message starts when the ticket was authorized and its invoice was not made.
 * The screen shows it whole and reads the ticket again: the ticket is authorized.
 */
export const AUTHORIZED_BUT = "The ticket is authorized, but";
export const authorizedAnyway = (e: unknown): string | null => {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return m.includes(AUTHORIZED_BUT) ? m.slice(m.indexOf(AUTHORIZED_BUT)) : null;
};
export const isInspectionType = (serviceType: string | null | undefined): boolean =>
  serviceType === "inspection";
/** Does the ticket end at its sign-off? An inspection, unless it has been billed. */
export const endsAtAuthorized = (
  serviceType: string | null | undefined,
  hasInvoice = false,
): boolean => isInspectionType(serviceType) && !hasInvoice;
export const stagesForType = (
  serviceType: string | null | undefined,
  hasInvoice = false,
): readonly ServiceStage[] =>
  endsAtAuthorized(serviceType, hasInvoice) ? INSPECTION_STAGES : ALL_STAGES;

/**
 * Is the ticket waiting for an invoice (the Invoices page's Awaiting invoice queue and badge,
 * Work Overview's "Authorized — to invoice", the Owner page's tile)? Authorized, and not an
 * inspection that ends there: until Nov 16 an authorized inspection sat in those lists for good,
 * though it could never be invoiced.
 */
export const awaitsInvoice = (j: {
  stage: string;
  service_type: string | null | undefined;
  invoice_id?: string | null | undefined;
}): boolean => j.stage === "authorized" && !endsAtAuthorized(j.service_type, !!j.invoice_id);
/** The same rule as a database filter (PostgREST `or`), beside `.eq("stage", "authorized")`. */
export const AWAITS_INVOICE_OR = "service_type.neq.inspection,invoice_id.not.is.null";

/**
 * A finished inspection (audit, Nov 16, fix 6): Authorized, and it ends there — nobody billed
 * it. It is not open work. Until now the Tickets in progress tile, the Open work filter, the
 * Customers list count, the Tech Board's "Finished, no technician" group and the rule that
 * stops a customer being deleted all counted it for good (one live ticket on Nov 16, whose
 * customer could not be deleted: "close or move them first", which the server refuses).
 */
export const isFinishedInspection = (j: {
  stage: string;
  service_type?: string | null | undefined;
  invoice_id?: string | null | undefined;
}): boolean => j.stage === "authorized" && endsAtAuthorized(j.service_type, !!j.invoice_id);
/**
 * "Not a finished inspection" as a database filter (PostgREST `or`), beside a stage filter that
 * lets Authorized through: not Authorized, or not an inspection, or billed.
 */
export const NOT_FINISHED_INSPECTION_OR =
  "stage.neq.authorized,service_type.neq.inspection,invoice_id.not.is.null";

/**
 * The Type lock (audit, Nov 16, fix 1). Only a manager starts an inspection's first invoice, but
 * anyone in the office could change an authorized inspection's Type to Repair, make the invoice
 * and change it back (proven in the browser as a Sales login). And an authorized repair retyped
 * as Inspection dropped out of every waiting-for-invoice list. So once a ticket is Authorized or
 * later, or has an invoice, its Type moves to or from Inspection only by a manager's hand.
 * Between the other types (Repair, Warranty, …) anyone who may edit the ticket still changes it.
 * The database says the same (trigger service_jobs_type_rule, 20261116150000).
 */
export const TYPE_LOCK_MESSAGE =
  "Only a manager changes a ticket to or from Inspection once it is Authorized or has an invoice";
export const TYPE_LOCK_NOTE = "Only a manager changes the type of an authorized inspection.";
/** Is the ticket's Type locked for `p` where Inspection is concerned? */
export const typeLockedFor = (
  p: AccessLike | null | undefined,
  t: { stage: string | null | undefined; invoice_id?: string | null | undefined },
): boolean =>
  !managesTickets(p) && (OFFICE_STAGES.includes(t.stage as ServiceStage) || !!t.invoice_id);
/** Why `p` may not change the ticket's type from what it is to `next` (null = they may). */
export function typeChangeProblem(
  p: AccessLike | null | undefined,
  prev: {
    service_type: string | null | undefined;
    stage: string | null | undefined;
    invoice_id?: string | null | undefined;
  },
  next: string | null | undefined,
): string | null {
  if (isInspectionType(prev.service_type) === isInspectionType(next)) return null;
  return typeLockedFor(p, prev) ? TYPE_LOCK_MESSAGE : null;
}

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
/**
 * Owner, Oct 8: "the step should mark done once all the details are in there" — Done is set by
 * the close-out's Complete (setFieldStatus), never picked by hand by the person on the ticket.
 */
export const DONE_VIA_CLOSEOUT_MESSAGE =
  "Done is marked when the close-out is completed — open the ticket and finish it there";

export function stageProblem(
  p: AccessLike | null | undefined,
  stage: ServiceStage,
  current?: string | null,
): string | null {
  if (current != null && stage === current) return null;
  if (managesTickets(p)) return null;
  if (current != null && OFFICE_STAGES.includes(current as ServiceStage))
    return MANAGER_STAGE_MESSAGE;
  if (stage === "done") return DONE_VIA_CLOSEOUT_MESSAGE;
  if (!isOffice(p)) return TECH_STAGES.includes(stage) ? null : TECH_STAGE_MESSAGE;
  return OFFICE_STAGES.includes(stage) ? MANAGER_STAGE_MESSAGE : null;
}

/**
 * A move back to the technician's working stages from Done (or an office stage) REOPENS the
 * ticket (owner, Oct 21: "if managers move a ticket back to scheduled from done does it
 * reappear on the tech's list?" — it does, and the first visit's close-out stamp must not stay
 * on it: the Close-out fold said "Done <date>" on a Scheduled ticket, and the second Complete
 * never logged "Service done" again because the stamp looked already set). setServiceStage
 * clears completed_at on such a move — what the technician's own Undo already did
 * (service-field.functions.ts setFieldStatus "undo"). A move between office stages, or Done
 * set from the picker, leaves the stamp alone.
 */
export const reopensTicket = (from: string | null | undefined, to: ServiceStage): boolean =>
  (from === "done" || OFFICE_STAGES.includes(from as ServiceStage)) &&
  (to === "open" || to === "scheduled");

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
  serviceType?: string | null,
  hasInvoice = false,
): ServiceStage[] {
  return stagesForType(serviceType, hasInvoice).filter(
    (s) => s === current || !stageProblem(p, s, current),
  );
}

/** The ticket sits at a stage `p` may not set (Invoiced / Closed for a non-manager): read-only. */
export const stageLocked = (
  p: AccessLike | null | undefined,
  current: ServiceStage | null,
): boolean => !!current && current !== "done" && !!stageProblem(p, current);

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
