/**
 * One card on the screen in the ticket workflow (owner, Nov 19, with a picture of his phone:
 * "let's keep the numbers and the dropdown that shows you each step but let's only show the card
 * we are currently on rather than all steps minimized in the list except for the one your on,
 * this changes it from a scroll down workflow to a scroll left to right maximizing the viewing
 * window").
 *
 * Until then every step was in the page at once: locked ones as one muted line, done ones folded
 * to a summary with Edit, the one being worked open. Now the page holds the step being worked,
 * or a done step picked from the numbers (or the step list), and nothing else. These are the
 * rules; closeout.tsx draws them.
 */
import type { StepId, StepStatus } from "@/lib/closeout-steps";

/**
 * The step whose card is on the screen: a picked step unless it is locked (a step can lock again
 * when its Before photo is deleted), else the step being worked, else (every step done) the last
 * one, so a finished ticket still shows a card above Complete.
 */
export function shownCardStep(
  picked: StepId | null,
  statusOf: (id: StepId) => StepStatus,
  working: StepId | null,
  lastStep: StepId | null,
): StepId | null {
  if (picked !== null && statusOf(picked) !== "locked") return picked;
  return working ?? lastStep;
}

/**
 * What a tap on a number (or a line of the step list) picks. A locked step: nothing changes. The
 * step being worked: back to it (no pick). A done step: that step.
 */
export function pickStep(
  id: StepId,
  statusOf: (id: StepId) => StepStatus,
  working: StepId | null,
  picked: StepId | null,
): StepId | null {
  if (statusOf(id) === "locked") return picked;
  return id === working ? null : id;
}

/**
 * Whether a step's card is in the page at all. The one on the screen is; and the step being
 * worked STAYS in the page, hidden, while a done step is looked at, so hours half typed or a row
 * left open on it are still there on the way back. Every other step draws nothing.
 */
export function cardInPage(shown: boolean, status: StepStatus): boolean {
  return shown || status === "current";
}

/**
 * The step "Back to step N" goes to, on a done step that is on the screen: the step being
 * worked. None on the step being worked itself, and none once every step is done.
 */
export function backToStep(id: StepId, status: StepStatus, working: StepId | null): StepId | null {
  return status === "done" && working !== null && working !== id ? working : null;
}
