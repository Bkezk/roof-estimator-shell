/**
 * Every row of a Roof Care plan's checklist is answered before its inspection is finished
 * (owner, Nov 23: "3 go"). Pure.
 *
 * Since Oct 26 a checklist row may be left blank and reads as OK. On the customer's Care plan
 * report a blank row prints "Not checked" (Nov 23), so a row a technician looked at and did not
 * mark told the customer nobody checked it. On a plan's own inspection each row now needs its
 * answer: OK, Issue or N/A.
 *
 * The rule, in three places that say the same words, as the plan's cleaning questions do
 * (cleaning-required.ts):
 *  - the database (trigger service_jobs_checklist_rule): no ticket that is a plan's inspection
 *    moves into Done or later from a stage before it while a checklist row has no answer. It
 *    binds everybody, and every way a stage is written.
 *  - the two server functions that move a ticket (Complete, and the stage picker): they check
 *    first, so a refused move stops no clock and writes no time.
 *  - the workflow: the Checklist step waits for the rows, and "Complete anyway" is not offered
 *    while one is open.
 *
 * Only the MOVE is checked, and only on a plan's inspection. An ordinary inspection keeps the
 * Oct 26 rule: its rows may be left blank.
 */
import {
  mergeChecklist,
  visibleChecklist,
  type ChecklistItem,
  type Inspection,
  type InspectionStatus,
} from "@/lib/inspection";

/** A Roof Care plan's own inspection: an inspection ticket made for one of the plan's visits. */
export const isPlanInspection = (job: {
  service_type?: string | null | undefined;
  roof_care_visit_id?: string | null | undefined;
}): boolean => job.service_type === "inspection" && !!job.roof_care_visit_id;

type Row = { label: string; status: InspectionStatus | null };

/** The rows shown that have no answer yet, by their labels, in the order they are shown. */
export const rowsToAnswer = (items: readonly Row[]): string[] =>
  visibleChecklist(items)
    .filter((i) => i.status === null)
    .map((i) => i.label);

/**
 * The same for what the server holds: the saved answers merged with the live checklist. A
 * checklist never saved has every row open.
 */
export const planRowsOpen = (
  saved: Inspection | null,
  checklist: readonly ChecklistItem[],
): string[] => rowsToAnswer(mergeChecklist(saved, checklist));

export const PLAN_ROWS_HEAD = "Not answered yet on the checklist:";
export const PLAN_ROWS_TAIL =
  'This is a Roof Care plan inspection, and the customer\'s Care plan report prints "Not checked" for a row left blank. Press Open ticket, mark each row OK, Issue or N/A in the Checklist step, then finish the ticket.';

/**
 * The refusal, or null when every row is answered: "Not answered yet on the checklist: Seams,
 * Ponding. This is a Roof Care plan inspection, …". The database's trigger says the same
 * sentence.
 */
export function planRowsRefusal(open: readonly string[]): string | null {
  if (!open.length) return null;
  return `${PLAN_ROWS_HEAD} ${open.join(", ")}. ${PLAN_ROWS_TAIL}`;
}

/** The checklist could not be read: said plainly, and the move waits for a second try. */
export const planRowsUnchecked = (why: string): string =>
  `Could not check the checklist of this Roof Care plan inspection (${why}). Nothing was changed. Try again.`;

// ── What the screens say ────────────────────────────────────────────────────────────────────

/** Over the checklist of a plan's inspection: what is asked, and why. */
export const PLAN_ROWS_WHY =
  'This is a Roof Care plan inspection: mark every row OK, Issue or N/A. The customer\'s Care plan report prints "Not checked" for a row left blank.';
/** On a row with no answer yet. */
export const ROW_NEEDS_ANSWER = "Needs an answer";
/** The button that takes the person to the first row with no answer. */
export const PLAN_ROWS_GO_FIRST = "Go to the first one";
/** Under the list in "Before you finish" while a row is open. */
export const PLAN_ROWS_REQUIRED_NOTE =
  "Every checklist row of a Roof Care plan inspection needs an answer. Go back and mark each one OK, Issue or N/A in the Checklist step.";

/** "3 rows still need an answer: Seams, Ponding, Debris." Null when none does. */
export function planRowsLine(open: readonly string[]): string | null {
  if (!open.length) return null;
  return `${open.length} ${open.length === 1 ? "row still needs" : "rows still need"} an answer: ${open.join(", ")}.`;
}

/** What Complete lists under "Before you finish": one line a row. */
export const planRowsGaps = (open: readonly string[]): string[] =>
  open.map((label) => `Checklist row not answered: ${label}`);

/**
 * The rows the workflow waits for: on a plan's inspection that is not finished yet, the rows
 * on the screen with no answer. Every other ticket, and a finished one, waits for none.
 */
export function planRowsWaiting(
  job: Parameters<typeof isPlanInspection>[0],
  items: readonly Row[],
  finished: boolean,
): string[] {
  return finished || !isPlanInspection(job) ? [] : rowsToAnswer(items);
}

/**
 * The line under the Checklist step's Next. While a row of a plan's inspection has no answer
 * the line says which; answering a row saves the checklist, so that line stands in for "Save
 * the checklist" too. Otherwise the line the step had (`fallback`).
 */
export function planRowsStepMissing(
  stepId: string,
  fallback: string | null,
  open: readonly string[],
): string | null {
  return stepId === "checklist" && open.length ? planRowsLine(open) : fallback;
}
