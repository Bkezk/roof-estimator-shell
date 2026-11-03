/**
 * The ticket stage sets, once (owner, Nov 3, service review item 52): the same three lists were
 * written out by hand in fifteen places — the close-out, the materials screen, the board read,
 * the clock, the crew rule, the owner's view, the schedule, the inspection — and each new stage
 * (Authorized, Oct 5) had to be added to every copy. Pure, no imports but the type.
 *
 *   WORK_STAGES      open, scheduled, done — a technician's stages; the ticket is still being
 *                    worked (the clock runs, materials log, the field edit lock is open).
 *   OFFICE_STAGES    authorized, invoiced, closed — a manager's; the way back is a manager's too
 *                    (20261006190000_stage_backwards_lock.sql).
 *   FINISHED_STAGES  done and after — the work is over (the close-out shows its Done banner, the
 *                    crew question is moot, the board's finished group, the review timer).
 *
 * The database's twins: `('authorized', 'invoiced', 'closed')` and `('open', 'scheduled',
 * 'done')` in 20261006190000_stage_backwards_lock.sql and 20261006192000_field_edit_lock.sql
 * (ticket-stages.test.ts checks they still match).
 */
import type { ServiceStage } from "@/lib/service.functions";

export const WORK_STAGES: readonly ServiceStage[] = ["open", "scheduled", "done"];
export const OFFICE_STAGES: readonly ServiceStage[] = ["authorized", "invoiced", "closed"];
export const FINISHED_STAGES: readonly ServiceStage[] = ["done", ...OFFICE_STAGES];

const has = (set: readonly ServiceStage[], stage: string | null | undefined) =>
  !!stage && (set as readonly string[]).includes(stage);

/** Open, Scheduled or Done: the ticket is still the technician's to work. */
export const isWorkStage = (stage: string | null | undefined) => has(WORK_STAGES, stage);
/** Authorized, Invoiced or Closed: the office has it. */
export const isOfficeStage = (stage: string | null | undefined) => has(OFFICE_STAGES, stage);
/** Done or after: the work is over. */
export const isFinishedStage = (stage: string | null | undefined) => has(FINISHED_STAGES, stage);
