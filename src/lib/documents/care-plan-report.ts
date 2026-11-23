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
import { type DocModule, type DocOptions, type DocPage, newModule } from "./model";
import { INSPECTION_NOT_CHECKED, type InspectionSnapshot } from "./variables";

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

// ── Nov 23, later: rows nobody answered, and the ticket's other pictures ─────────────────────

/**
 * Is this document (or template) a Care plan report? Told by what it holds, not by its name: a
 * list or a row marked `showStatus`, the mark only this report's template carries. So a
 * template seeded before today, renamed or edited by the office still counts, and a report
 * whose rows the office removed no longer does.
 */
export function isCarePlanReport(pages: readonly DocPage[] | null | undefined): boolean {
  return (pages ?? []).some((p) =>
    p.modules.some((m) => (m.type === "repairList" || m.type === "repairItem") && !!m.showStatus),
  );
}

/**
 * The Care plan report's Summary (owner, Nov 23: "go with issue 1"): the rows nobody answered
 * are counted apart, never as OK. "1 issue · 3 OK · 1 N/A · 5 not checked".
 */
export function carePlanSummary(insp: Pick<InspectionSnapshot, "items">): string {
  const count = (st: InspectionSnapshot["items"][number]["status"]) =>
    insp.items.filter((x) => x.status === st).length;
  const issues = count("issue");
  const ok = count("ok");
  const na = count("na");
  const blank = count(null);
  return [
    issues ? `${issues} ${issues === 1 ? "issue" : "issues"}` : null,
    ok ? `${ok} OK` : null,
    na ? `${na} N/A` : null,
    blank ? `${blank} ${INSPECTION_NOT_CHECKED.toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The variables a Care plan report stores: everyone's, with the Summary counted this report's
 * way. Any other document's variables come back untouched (the same object).
 */
export function carePlanVariables(
  vars: Record<string, string>,
  pages: readonly DocPage[] | null | undefined,
  insp: InspectionSnapshot | null | undefined,
): Record<string, string> {
  if (!insp || !isCarePlanReport(pages)) return vars;
  return { ...vars, "inspection.summary": carePlanSummary(insp) };
}

/** The heading over the ticket's pictures that are on no row of the checklist. */
export const OTHER_PICTURES_HEADING = "Other pictures from this visit";

/**
 * The ticket's pictures that are on no row the report lists (owner, Nov 23: "go with issue
 * 2"), in the order they were taken. `ticketPhotoIds` are the inspection's own pictures (not a
 * repair's before and after).
 */
export function loosePhotoIds(
  insp: Pick<InspectionSnapshot, "items"> | null | undefined,
  ticketPhotoIds: readonly string[],
): string[] {
  const onRow = new Set((insp?.items ?? []).flatMap((i) => i.photoIds));
  return [...new Set(ticketPhotoIds)].filter((id) => !onRow.has(id));
}

/**
 * A new Care plan report with the ticket's other pictures put in: a Photo Grid, three to a
 * line, with its own heading, after everything else on the last page. A template that already
 * holds an empty Photo Grid gets them there instead, under whatever the office put above it.
 * With no such pictures, or on any other document, the pages come back untouched: no heading,
 * no gap. The pictures are the ticket's own files, by reference: nothing is copied or made
 * smaller.
 *
 * Nov 23 (owner: "4 go"): the heading is the grid's own (PhotoGridModule.heading), not a text
 * module before it. It was a module of its own, so with Photos switched off, or once the
 * pictures were taken out of the grid, it printed over nothing. Now it prints only with a
 * picture under it (pdf-layout.ts layoutPhotoGrid; the editor draws the same).
 */
export function withOtherPictures(
  pages: readonly DocPage[],
  photoIds: readonly string[],
): DocPage[] {
  if (!photoIds.length || !pages.length || !isCarePlanReport(pages)) return [...pages];
  const images = photoIds.map((photoId) => ({
    image: { kind: "ticketPhoto" as const, photoId, marks: true },
    caption: "",
  }));
  let placed = false;
  const filled = pages.map((p) => ({
    ...p,
    modules: p.modules.map((m): DocModule => {
      if (placed || m.type !== "photoGrid" || m.images.length) return m;
      placed = true;
      return { ...m, images };
    }),
  }));
  if (placed) return filled;
  const grid = {
    ...newModule("photoGrid"),
    images,
    columns: 3,
    heading: OTHER_PICTURES_HEADING,
  } as DocModule;
  const last = pages.length - 1;
  return pages.map((p, i) => (i === last ? { ...p, modules: [...p.modules, grid] } : p));
}
