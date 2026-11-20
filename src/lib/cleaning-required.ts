/**
 * The cleaning a Roof Care plan includes is answered before its inspection is finished (owner,
 * Nov 20: "those questions should be required"). Pure.
 *
 * Until now only the ticket workflow asked (components/service/cleaning-gate.ts): the server
 * behind Complete checked nothing of it, and a manager who set Done or Authorized from the
 * ticket page's stage picker went straight past the questions.
 *
 * The rule, in three places that say the same words:
 *  - the database (trigger service_jobs_cleaning_rule): no ticket that is a plan's inspection
 *    moves into Done or later from a stage before it while a question the plan asks there is
 *    unanswered. It binds everybody, and every way a stage is written.
 *  - the two server functions that move a ticket (Complete, and the stage picker): they check
 *    first, so a refused move stops no clock and writes no time.
 *  - the workflow: "Complete anyway" is not offered while a question is open.
 *
 * Only the MOVE is checked. A ticket already Done or later, a storm inspection, a Roof Watch
 * inspection and every ticket that is not a plan's inspection are untouched.
 */
import {
  CLEANING_KEYS,
  CLEANING_QUESTION,
  cleaningOpen,
  type CleaningKey,
  type VisitCleaning,
} from "@/lib/roof-care-cleaning";
import { isFinishedStage } from "@/lib/ticket-stages";

/** The move the rule watches: from a stage before Done into Done or later. */
export const completesTicket = (
  from: string | null | undefined,
  to: string | null | undefined,
): boolean => isFinishedStage(to) && !isFinishedStage(from);

export const CLEANING_REQUIRED_HEAD = "Not answered yet:";
export const CLEANING_REQUIRED_TAIL =
  "This is a Roof Care plan inspection. Press Open ticket, answer Yes or No in the Checklist step, then finish the ticket.";

/**
 * The refusal, or null when nothing is open: "Not answered yet: Were the drains and scuppers
 * cleaned? Were the gutters cleaned? This is a Roof Care plan inspection. …". The database's
 * trigger says the same sentence.
 */
export function cleaningRefusal(open: readonly CleaningKey[]): string | null {
  const asked = CLEANING_KEYS.filter((k) => open.includes(k));
  if (!asked.length) return null;
  return `${CLEANING_REQUIRED_HEAD} ${asked.map((k) => CLEANING_QUESTION[k]).join(" ")} ${CLEANING_REQUIRED_TAIL}`;
}

/** The refusal for one inspection's answers as they stand; null when it may be finished. */
export const cleaningRefusalOf = (
  c: Pick<VisitCleaning, "asked" | "drains" | "gutters"> | null | undefined,
): string | null => (c ? cleaningRefusal(cleaningOpen(c)) : null);

/** The plan's answers could not be read: said plainly, and the move waits for a second try. */
export const cleaningUnchecked = (why: string): string =>
  `Could not check what the Roof Care plan includes at this inspection (${why}). Nothing was changed. Try again.`;
