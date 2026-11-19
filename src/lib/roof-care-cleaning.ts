/**
 * The cleaning a Roof Care plan includes at each inspection, and the yearly budget forecast
 * (owner, Nov 19: "go" on recording them. Until then the site kept neither: the plan sheet
 * promises "Drains and scuppers cleaned at both inspections" and "Gutters cleaned at both
 * inspections", and nothing said they were).
 *
 * Roof Care and Roof Guard: the drains and scuppers. Roof Guard: the gutters too. Asked at the
 * year's two inspections and at one carried from last plan year, never at a storm inspection.
 * Each is answered Yes or No; a No says why (a gutter that cannot be reached without a lift).
 */
import type { VisitKind } from "@/lib/roof-care-plan";
import type { PlanKey } from "@/lib/roof-care-price";

export type CleaningKey = "drains" | "gutters";
export const CLEANING_KEYS: readonly CleaningKey[] = ["drains", "gutters"];
export const CLEANING_LABEL: Record<CleaningKey, string> = {
  drains: "Drains and scuppers cleaned",
  gutters: "Gutters cleaned",
};
export const CLEANING_QUESTION: Record<CleaningKey, string> = {
  drains: "Were the drains and scuppers cleaned?",
  gutters: "Were the gutters cleaned?",
};
export const CLEANING_WHY_LABEL = "Why it was not cleaned";
export const CLEANING_NEEDS_WHY = "Type why it was not cleaned";
export const CLEANING_UNANSWERED = "Answer what the plan includes at this inspection";

export const roofCareCleaningKey = (visitId: string) => ["roof-care-cleaning", visitId] as const;

/** Which of the two this plan's inspection is asked. */
export function cleaningAsked(plan: PlanKey, kind: VisitKind): Record<CleaningKey, boolean> {
  const visit = kind !== "storm";
  return { drains: visit && plan !== "watch", gutters: visit && plan === "guard" };
}

/** What one inspection has answered. `null`: not answered yet. */
export interface VisitCleaning {
  visit_id: string;
  plan: PlanKey;
  kind: VisitKind;
  asked: Record<CleaningKey, boolean>;
  drains: boolean | null;
  gutters: boolean | null;
  note: string | null;
  by_name: string | null;
  at: string | null;
}

/** The questions still open: the inspection is not finished until there are none. */
export function cleaningOpen(
  c: Pick<VisitCleaning, "asked" | "drains" | "gutters">,
): CleaningKey[] {
  return CLEANING_KEYS.filter((k) => c.asked[k] && c[k] === null);
}

/** A No needs its reason before it is saved. */
export function cleaningProblem(
  c: Pick<VisitCleaning, "asked">,
  answer: {
    drains?: boolean | null | undefined;
    gutters?: boolean | null | undefined;
    note?: string | null | undefined;
  },
): string | null {
  const no = CLEANING_KEYS.some((k) => c.asked[k] && answer[k] === false);
  return no && !(answer.note ?? "").trim() ? CLEANING_NEEDS_WHY : null;
}

/** "Yes", "No: cannot be reached without a lift", or "Not answered". */
export function cleaningAnswerWords(done: boolean | null, note: string | null): string {
  if (done === null) return "Not answered";
  if (done) return "Yes";
  const why = (note ?? "").trim();
  return why ? `No: ${why}` : "No";
}

/** For the plan's tally: "Done at 1 of 2 inspections", counting only what was answered Yes. */
export function cleaningTally(
  visits: readonly {
    kind: VisitKind;
    drains_cleaned?: boolean | null;
    gutters_cleaned?: boolean | null;
  }[],
  key: CleaningKey,
): { done: number; of: number; words: string } {
  const year = visits.filter((v) => v.kind === "visit1" || v.kind === "visit2");
  const done = year.filter(
    (v) => (key === "drains" ? v.drains_cleaned : v.gutters_cleaned) === true,
  ).length;
  const of = 2;
  return { done, of, words: `Done at ${done} of ${of} inspections` };
}
