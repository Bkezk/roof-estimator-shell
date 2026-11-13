/**
 * A ticket moves its opportunity (owner, Nov 13: "I like all the steps"). The rule lives in the
 * database (move_opportunity_from_ticket, 20261113100000), where every way of making a ticket
 * reaches it; this is its pure twin, for the pages and the tests:
 *
 *   an inspection (or a warranty visit) started from an opportunity   Open → Contacted
 *   a repair ticket (repair, other) started from it, or made from
 *   an inspection that came from it                                    → Won
 *   "No action needed" on its inspection, when the office says so     → Lost or No response
 *
 * Never backwards (a Quoted opportunity is not Contacted again), never out of Won / Lost / No
 * response, never on a deleted opportunity. "No action needed" alone closes nothing: the office is
 * asked, and "leave it open" is an answer.
 *
 * Pure: no database, no React (unit tested in ticket-moves-nov13.test.ts).
 */
import { OPP_CLOSING, OPP_STATUS_LABELS, type OppStatus } from "@/lib/opportunities.functions";

/** What the office can answer after "No action needed" on an inspection with an open opportunity. */
export const NO_ACTION_ANSWERS = ["lost", "no_response", "open"] as const;
export type NoActionAnswer = (typeof NO_ACTION_ANSWERS)[number];
export const NO_ACTION_ANSWER_LABELS: Record<NoActionAnswer, string> = {
  lost: "Mark it Lost",
  no_response: "Mark it No response",
  open: "Leave it open",
};
/** The question, in the office's words. */
export const noActionQuestion = (title: string) =>
  `This inspection came from the opportunity “${title.trim() || "Untitled"}”, which is still open. Nothing is being done, so what should happen to it?`;

/**
 * The status a ticket moves its opportunity to, or null when it stays as it is. `answer` is the
 * office's answer after "No action needed" (inspections only; "open" moves nothing).
 */
export function oppStatusFromTicket(
  serviceType: string,
  oppStatus: string,
  answer?: NoActionAnswer | null,
): OppStatus | null {
  if (OPP_CLOSING.includes(oppStatus as OppStatus)) return null;
  if (answer) {
    if (serviceType !== "inspection" || answer === "open") return null;
    return answer;
  }
  if (serviceType === "inspection" || serviceType === "warranty")
    return oppStatus === "open" ? "contacted" : null;
  return "won";
}

/** Is the opportunity still open (so "No action needed" has a question to ask)? */
export const oppStillOpen = (status: string | null | undefined): boolean =>
  !!status && !OPP_CLOSING.includes(status as OppStatus);

/** The toast: "Opportunity “Leak at the dock” is now Won". */
export function opportunityMoveText(move: { title: string; to: string }): string {
  const label = OPP_STATUS_LABELS[move.to as OppStatus] ?? move.to;
  return `Opportunity “${move.title.trim() || "Untitled"}” is now ${label}`;
}

/** The timeline note for the office's answer on the inspection ticket. */
export function noActionAnswerNote(answer: NoActionAnswer, title: string): string {
  const t = `“${title.trim() || "Untitled"}”`;
  if (answer === "lost") return `Opportunity ${t} marked Lost: no action needed`;
  if (answer === "no_response") return `Opportunity ${t} marked No response: no action needed`;
  return `Opportunity ${t} left open after "No action needed"`;
}
