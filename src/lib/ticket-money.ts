/**
 * Ticket money is a manager's (owner, Oct 1: "only the managers / admins can see and edit the
 * prices on invoices / repairs / inspections etc."; "the per-technician charge is separate from
 * estimate pricing and can be edited per job"). The pure rules the server functions and the
 * migration 20261001050000_ticket_money_managers.sql share. No I/O.
 */

/**
 * Repair templates as a viewer receives them: a non-manager gets every template with its
 * `unit_price` blanked (names, units and texts stay — reps still pick and complete repairs).
 * RLS cannot hide one column, so the server functions that list templates call this.
 */
export function templatesForViewer<T extends { unit_price: number | null }>(
  rows: readonly T[],
  manager: boolean,
): T[] {
  return manager ? [...rows] : rows.map((r) => ({ ...r, unit_price: null }));
}

/**
 * May this write to a crew row (service_job_techs) go through? The twin of the trigger
 * `service_job_techs_rate_guard`: an admin or a manager (or the server's service role) writes
 * anything; anyone else (the lead technician answering "who is on this job", setJobCrew) may add
 * a member only without a rate, and may keep an existing member only with the rate it already
 * has — never set or change a rate, nor move a row to another technician or ticket.
 *
 * `existing` is the row already stored for the same ticket and technician (an upsert's insert
 * attempt meets it before the conflict turns it into an update), or null.
 */
export function crewRowWriteAllowed(w: {
  manager: boolean;
  op: "insert" | "update";
  next: { service_job_id: string; technician_id: string; bill_rate: number | null };
  existing: { service_job_id: string; technician_id: string; bill_rate: number | null } | null;
}): boolean {
  if (w.manager) return true;
  const sameRate = (a: number | null, b: number | null) =>
    a == null ? b == null : b != null && Number(a) === Number(b);
  if (w.op === "insert")
    return (
      w.next.bill_rate == null || (!!w.existing && sameRate(w.existing.bill_rate, w.next.bill_rate))
    );
  if (!w.existing) return false;
  return (
    w.existing.service_job_id === w.next.service_job_id &&
    w.existing.technician_id === w.next.technician_id &&
    sameRate(w.existing.bill_rate, w.next.bill_rate)
  );
}
