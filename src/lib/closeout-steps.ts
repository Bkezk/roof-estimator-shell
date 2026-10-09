/**
 * The close-out as seven steps that unlock in order (owner, Oct 9: "i like the gate because
 * questions have to be answered to proceed. so maybe the ticket steps should be logically what
 * they can answer before then what they can answer after in that order, unlocking each step
 * after the last is complete"). The order the owner approved:
 *
 *   1 Who is here · 2 Before (the repairs and their Before photos) · 3 The work (what was done,
 *   the After photos) · 4 Materials · 5 Time · 6 Notes · 7 Signature, then Complete.
 *
 * A step is DONE when the ticket's data satisfies its rule (the same rules Complete's list
 * checks, closeout-check.ts), CURRENT when it is the first step not done, and LOCKED when it is
 * not done and sits after the current one. A done step stays open and editable (a tech goes
 * back to retake a Before photo), and a step the data already satisfies — the office typed the
 * notes on the ticket, the signature is from an earlier visit — is done wherever it sits:
 * hiding filled boxes would hide what the tech must be able to fix. Pure, so the rules and the
 * order are tested without the screen.
 */

export type StepId = "crew" | "before" | "work" | "materials" | "time" | "notes" | "signature";
export type StepStatus = "done" | "current" | "locked";

export interface CloseoutStep {
  id: StepId;
  /** 1-based, as the screen says it ("Step 3 of 7"). */
  n: number;
  title: string;
  /** What has to be true for this step to open (the strip's line under a locked step). */
  unlocks: string;
}

export const CLOSEOUT_STEPS: readonly CloseoutStep[] = [
  { id: "crew", n: 1, title: "Who is here", unlocks: "Open from the start" },
  { id: "before", n: 2, title: "Before", unlocks: "Answer who is on the job" },
  { id: "work", n: 3, title: "The work", unlocks: "A repair added, each with its Before photo" },
  {
    id: "materials",
    n: 4,
    title: "Materials",
    unlocks: "Work completed and an After photo on every repair",
  },
  { id: "time", n: 5, title: "Time", unlocks: "Materials logged, or Nothing used" },
  { id: "notes", n: 6, title: "Notes", unlocks: "Time on the ticket" },
  { id: "signature", n: 7, title: "Signature", unlocks: "Closing notes written" },
];

export const STEP_COUNT = CLOSEOUT_STEPS.length;

export interface StepRepair {
  id: string;
  resolution_text: string | null;
}
export interface StepPhoto {
  repair_id: string | null;
  role: string;
}

/** What the screen derives from the ticket, its reads and the phone's marks. */
export interface StepState {
  /** Already Done / Invoiced / Closed: every step is done (Complete checks nothing either). */
  finished: boolean;
  crewAnswered: boolean;
  /** "inspection" needs no repair (closeout-check.ts: the checklist is its findings). */
  serviceType: string;
  repairs: readonly StepRepair[];
  photos: readonly StepPhoto[];
  /** A material logged on the ticket, or the tech pressed "Nothing used on this ticket". */
  materialsTouched: boolean;
  /** Travel + labor hours on the ticket. */
  timeHours: number;
  /** An older ticket's On site stamp: Complete adds its labor itself, so time is not required. */
  onSiteAt: string | null;
  closingNotes: string;
  signaturePath: string | null;
}

export function stepOf(id: StepId): CloseoutStep {
  const s = CLOSEOUT_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown close-out step: ${id}`);
  return s;
}
export const stepIndex = (id: StepId) => stepOf(id).n - 1;

const hasPhoto = (photos: readonly StepPhoto[], repairId: string, role: string) =>
  photos.some((p) => p.repair_id === repairId && p.role === role);

/** Repairs are required unless the ticket is an inspection (mirrors missingForComplete). */
const repairsSuffice = (s: StepState) => s.serviceType === "inspection" || s.repairs.length > 0;

/** Whether the ticket's data satisfies the step's rule. */
export function stepDone(id: StepId, s: StepState): boolean {
  if (s.finished) return true;
  switch (id) {
    case "crew":
      return s.crewAnswered;
    case "before":
      return repairsSuffice(s) && s.repairs.every((r) => hasPhoto(s.photos, r.id, "before"));
    case "work":
      return (
        repairsSuffice(s) &&
        s.repairs.every(
          (r) => !!(r.resolution_text ?? "").trim() && hasPhoto(s.photos, r.id, "after"),
        )
      );
    case "materials":
      return s.materialsTouched;
    case "time":
      return !!s.onSiteAt || s.timeHours > 0;
    case "notes":
      return s.closingNotes.trim().length > 0;
    case "signature":
      return !!s.signaturePath;
  }
}

/** The first step not done, in order; null when all seven are (Complete is ready). */
export function firstOpenStep(s: StepState): StepId | null {
  for (const step of CLOSEOUT_STEPS) if (!stepDone(step.id, s)) return step.id;
  return null;
}

/**
 * done: the rule holds. current: the first step that does not. locked: not done, after the
 * current one. A done step is never locked, whatever sits before it (see the header).
 */
export function stepStatus(id: StepId, s: StepState): StepStatus {
  if (stepDone(id, s)) return "done";
  return firstOpenStep(s) === id ? "current" : "locked";
}

/** Every step's status, in order (the strip). */
export function stepStatuses(s: StepState): { step: CloseoutStep; status: StepStatus }[] {
  return CLOSEOUT_STEPS.map((step) => ({ step, status: stepStatus(step.id, s) }));
}

/** The strip's header: "Step 3 of 7 · The work", or that all are done. */
export function stepHeadline(open: StepId | null): string {
  if (open === null) return `All ${STEP_COUNT} steps done — press Complete`;
  const s = stepOf(open);
  return `Step ${s.n} of ${STEP_COUNT} · ${s.title}`;
}

/** The muted line in a locked step's place: what to finish first (the step open now). */
export function lockedLine(open: StepId | null): string {
  if (open === null) return "Locked";
  const s = stepOf(open);
  return `Locked — finish step ${s.n}: ${s.title} first`;
}

/**
 * The toast when the open step moves forward: "Step 2 done — next: The work". null when the
 * step moved back (a Before photo deleted reopens step 2) or did not move; the last step done
 * says Complete is ready.
 */
export function unlockToast(prev: StepId | null, next: StepId | null): string | null {
  if (prev === null || prev === next) return null;
  if (next !== null && stepIndex(next) <= stepIndex(prev)) return null;
  const done = stepOf(prev);
  return next === null
    ? `Step ${done.n} done — Complete is ready`
    : `Step ${done.n} done — next: ${stepOf(next).title}`;
}

/** The sticky bar's label while a step before Signature is still open. */
export function finishStepLabel(open: StepId): string {
  const s = stepOf(open);
  return `Finish step ${s.n}: ${s.title}`;
}

/**
 * Where the "Nothing used on this ticket" mark lives: localStorage per ticket, like the text
 * draft (bid-o-matic:closeout:<id>), because the ticket has no column for it — it records
 * nothing on the server and only marks step 4 done on this phone (owner, Oct 9).
 */
export const nothingUsedKey = (jobId: string) => `bid-o-matic:closeout-nothing-used:${jobId}`;
