/**
 * The one-tap "Care plan report" (owner, Nov 23: "we should also be able to add pictures to
 * checked marked good items since we can then use that to generate the care plan reports", then
 * "add a care plan report"). Made from an inspection ticket the way the Inspection report is,
 * by its own button, and it lists EVERY row of the checklist with its result, note and
 * pictures, the rows found OK included. Nothing is made, sent or attached without the press.
 *
 * Pure: what the button generates with, how it finds its template, and the lines the cover
 * prints for a Roof Care plan's inspection. The button is
 * components/documents/care-plan-report-button.tsx; the template is in defaults.ts.
 */
import {
  CLEANING_KEYS,
  CLEANING_LABEL,
  cleaningAnswerWords,
  type VisitCleaning,
} from "@/lib/roof-care-cleaning";
import { planName, type VisitKind } from "@/lib/roof-care-plan";

import { CARE_PLAN_REPORT_TEMPLATE } from "./defaults";
import { INSPECTION_REPORT_OPTIONS } from "./inspection-report";
import type { DocOptions } from "./model";

/**
 * What a care plan report is generated with: the Inspection report's own choices (pictures and
 * their marks on, no prices, not one item a page), so the two never drift apart.
 */
export const CARE_PLAN_REPORT_OPTIONS: DocOptions = { ...INSPECTION_REPORT_OPTIONS };

/** The template the button uses, by name (case does not matter), or null when the install lacks it. */
export function findCarePlanTemplate<T extends { name: string; kind: string }>(
  templates: readonly T[],
): T | null {
  const want = CARE_PLAN_REPORT_TEMPLATE.toLowerCase();
  return templates.find((t) => t.kind === "ticket" && t.name.trim().toLowerCase() === want) ?? null;
}

/** The message when an install has no such template (the office removed it). */
export const NO_CARE_PLAN_TEMPLATE = `There is no "${CARE_PLAN_REPORT_TEMPLATE}" template (Setup › Documents)`;

/** Which inspection of the plan's year this one is, in plain words. */
const WHICH_INSPECTION: Record<VisitKind, string> = {
  visit1: "inspection 1 of 2",
  visit2: "inspection 2 of 2",
  storm: "storm inspection",
  carried: "inspection owed from last plan year",
};

/**
 * The two lines the cover prints for a plan's inspection: "Roof Care plan, inspection 1 of 2",
 * and what the plan includes cleaning of at this inspection with its answer ("Drains and
 * scuppers cleaned: Yes · Gutters cleaned: No: cannot be reached without a lift"). The cleaning
 * line is blank where the plan asks for none (Roof Watch, a storm inspection). Never a price, a
 * cost or a credit: an inspection's answers carry none.
 */
export function carePlanLines(
  c: Pick<VisitCleaning, "plan" | "kind" | "asked" | "drains" | "gutters" | "note">,
): { plan: string; cleaning: string } {
  return {
    plan: `${planName(c.plan)} plan, ${WHICH_INSPECTION[c.kind]}`,
    cleaning: CLEANING_KEYS.filter((k) => c.asked[k])
      .map((k) => `${CLEANING_LABEL[k]}: ${cleaningAnswerWords(c[k], c.note)}`)
      .join(" · "),
  };
}
