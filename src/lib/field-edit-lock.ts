/**
 * Who may change a ticket's time, repairs and materials, by role and stage (owner, Oct 6):
 * - a technician: only on a ticket they are on (the lead or a crew member), while it is Open /
 *   Scheduled / Done;
 * - a manager or an admin: any ticket at any stage before Invoiced (Authorized included — the
 *   owner's review may correct a repair or a quantity);
 * - anyone else (an office user, a sales / project manager): as before for their role — any
 *   ticket — but never once it is Invoiced or Closed. An Invoiced ticket changes from its invoice
 *   (void, re-make); a Closed one is reopened by a manager first.
 *
 * Called by saveTimeEntry / deleteTimeEntry / saveJobRepair / deleteJobRepair
 * (service-field.functions.ts) and by addMovement when the movement names a ticket
 * (inventory.functions.ts). The database twin for technicians is `ticket_open_for_tech(job)` on
 * the child tables' write policies (20261006192000_field_edit_lock.sql). Pure: no database, no
 * server imports (field-edit-lock.test.ts).
 */
import { isOffice, managesTickets, type AccessLike } from "@/lib/access";

export const INVOICED_LOCK = "This ticket is Invoiced — the office changes it from the invoice";
export const CLOSED_LOCK = "This ticket is Closed — a manager reopens it first";
export const AUTHORIZED_LOCK = "Only a manager changes a ticket after it is Authorized";
export const NOT_ON_TICKET = "This ticket is assigned to someone else";

/**
 * Why `p` may not change time, repairs or materials on a ticket at `stage` (null = they may).
 * `onTicket`: `p` is the ticket's lead technician or on its crew.
 */
export function fieldEditProblem(
  p: AccessLike | null | undefined,
  stage: string,
  onTicket: boolean,
): string | null {
  if (stage === "invoiced") return INVOICED_LOCK;
  if (stage === "closed") return CLOSED_LOCK;
  if (managesTickets(p)) return null;
  if (isOffice(p)) return null;
  // A technician (or nobody signed in: held to the strictest rule).
  if (!onTicket) return NOT_ON_TICKET;
  return stage === "authorized" ? AUTHORIZED_LOCK : null;
}
