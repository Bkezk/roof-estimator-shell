/**
 * The cleaning a Roof Care plan includes, as the ticket workflow asks it (owner, Nov 19: "go" on
 * a tick on the inspection; lib/roof-care-cleaning.ts has what each plan is asked).
 *
 * The questions sit in the Checklist step of a plan's own inspection, under the checklist: that
 * is where the technician already says what the drains and the gutters look like, and it is the
 * first card of the flow, so nobody reaches Complete without having passed them. The step is not
 * done until each is answered Yes or No, which also keeps the bar at the bottom on "Finish step
 * 1" and takes the technician back to it. These are the rules; closeout.tsx and cleaning.tsx
 * draw them. A ticket that is not a plan's inspection, or whose plan asks nothing, has no gate.
 */
import type { StepId } from "@/lib/closeout-steps";
import {
  CLEANING_KEYS,
  CLEANING_NEEDS_WHY,
  CLEANING_QUESTION,
  CLEANING_UNANSWERED,
  cleaningOpen,
  type CleaningKey,
  type VisitCleaning,
} from "@/lib/roof-care-cleaning";

export const CLEANING_UNREAD = "Could not read what the plan includes at this inspection";
export const CLEANING_LOADING = "Still reading what the plan includes at this inspection";
export const CLEANING_NOT_SAVED = "The answer was not saved";
export const CLEANING_PENDING_NOTE = "Type why below. It saves with the reason.";

export type CleaningGate =
  /** Not a plan's inspection, or the plan asks nothing here: nothing is shown or waited for. */
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "unread"; message: string }
  | { kind: "asked"; cleaning: VisitCleaning; open: CleaningKey[] };

const errWords = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the ticket's read of its plan inspection means for the workflow. */
export function cleaningGate(i: {
  visitId: string | null | undefined;
  data: VisitCleaning | null | undefined;
  error: unknown;
  loading: boolean;
}): CleaningGate {
  if (!i.visitId) return { kind: "none" };
  if (i.data) {
    const asked = CLEANING_KEYS.some((k) => i.data!.asked[k]);
    return asked
      ? { kind: "asked", cleaning: i.data, open: cleaningOpen(i.data) }
      : { kind: "none" };
  }
  if (i.error) return { kind: "unread", message: errWords(i.error) };
  if (i.loading || i.data === undefined) return { kind: "loading" };
  // Read, and it is not an inspection of a plan the reader can see.
  return { kind: "none" };
}

/** Nothing of the plan's is still waiting. A finished ticket waits for nothing. */
export function cleaningHolds(g: CleaningGate, finished: boolean): boolean {
  if (finished || g.kind === "none") return true;
  return g.kind === "asked" && g.open.length === 0;
}

/** The Checklist step is done when the checklist is saved AND the plan's questions are answered. */
export const checklistStepSaved = (saved: boolean, g: CleaningGate, finished: boolean): boolean =>
  saved && cleaningHolds(g, finished);

/**
 * The line under the Checklist step's Next. The checklist's own line comes first; once that
 * holds, the plan's.
 */
export function cleaningStepMissing(
  id: StepId,
  base: string | null,
  checklistSaved: boolean,
  g: CleaningGate,
  finished: boolean,
): string | null {
  if (id !== "checklist" || cleaningHolds(g, finished) || !checklistSaved) return base;
  if (g.kind === "unread") return CLEANING_UNREAD;
  if (g.kind === "loading") return CLEANING_LOADING;
  return CLEANING_UNANSWERED;
}

/** What Complete lists under "Before you finish". `unread`: Retry can help. */
export function cleaningGaps(
  g: CleaningGate,
  finished: boolean,
): { gaps: string[]; unread: boolean } {
  if (cleaningHolds(g, finished)) return { gaps: [], unread: false };
  if (g.kind === "unread") return { gaps: [CLEANING_UNREAD], unread: true };
  if (g.kind === "loading") return { gaps: [CLEANING_LOADING], unread: true };
  if (g.kind !== "asked") return { gaps: [], unread: false };
  return { gaps: g.open.map((k) => `Not answered: ${CLEANING_QUESTION[k]}`), unread: false };
}

// ── Answering ───────────────────────────────────────────────────────────────────────────────

export interface CleaningSend {
  drains?: boolean;
  gutters?: boolean;
  note?: string;
}
export type CleaningShown = "yes" | "no" | "pending" | "none";

/** What a question shows: a No tapped and still waiting for its reason reads "pending". */
export function cleaningShown(
  c: Pick<VisitCleaning, "drains" | "gutters">,
  pendingNo: readonly CleaningKey[],
  key: CleaningKey,
): CleaningShown {
  if (pendingNo.includes(key)) return "pending";
  const v = c[key];
  return v === null ? "none" : v ? "yes" : "no";
}

/** The asked questions that are, or are about to be, a No. */
export function cleaningNos(
  c: Pick<VisitCleaning, "asked" | "drains" | "gutters">,
  pendingNo: readonly CleaningKey[],
): CleaningKey[] {
  return CLEANING_KEYS.filter((k) => c.asked[k] && (pendingNo.includes(k) || c[k] === false));
}

/**
 * A tap on Yes or No. Yes saves at once. No saves at once when a reason is already there; with
 * none it waits (`pendingNo`) for the reason box. Turning the last No into a Yes takes the
 * reason off with it.
 */
export function cleaningTap(
  c: Pick<VisitCleaning, "asked" | "drains" | "gutters" | "note">,
  pendingNo: readonly CleaningKey[],
  key: CleaningKey,
  yes: boolean,
  typed: string,
): { send: CleaningSend | null; pendingNo: CleaningKey[] } {
  const rest = pendingNo.filter((k) => k !== key);
  if (yes) {
    const send: CleaningSend = { [key]: true };
    const others = CLEANING_KEYS.filter(
      (k) => k !== key && c.asked[k] && (rest.includes(k) || c[k] === false),
    );
    if (others.length === 0 && (c.note ?? "").trim()) send.note = "";
    return { send, pendingNo: rest };
  }
  const reason = typed.trim() || (c.note ?? "").trim();
  if (!reason) return { send: null, pendingNo: [...rest, key] };
  const send: CleaningSend = { [key]: false, note: reason };
  for (const k of rest) send[k] = false;
  return { send, pendingNo: [] };
}

/**
 * The reason box, when it is left or its Save is pressed: the waiting No answers go with it. A
 * blank reason while any No stands is refused with the plain line.
 */
export function cleaningReason(
  c: Pick<VisitCleaning, "asked" | "drains" | "gutters" | "note">,
  pendingNo: readonly CleaningKey[],
  typed: string,
): { send: CleaningSend | null; problem: string | null } {
  const reason = typed.trim();
  if (!reason)
    return {
      send: null,
      problem: cleaningNos(c, pendingNo).length > 0 ? CLEANING_NEEDS_WHY : null,
    };
  if (pendingNo.length === 0 && reason === (c.note ?? "").trim())
    return { send: null, problem: null };
  const send: CleaningSend = { note: reason };
  for (const k of pendingNo) send[k] = false;
  return { send, problem: null };
}
