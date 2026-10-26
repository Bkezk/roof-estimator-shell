/**
 * The one-tap "Inspection report" (phase 2; owner, Oct 26): what the button generates with, and
 * how it finds its template. Pure; the button is components/documents/inspection-report-button.tsx.
 */
import { INSPECTION_REPORT_TEMPLATE } from "./defaults";
import { DEFAULT_OPTIONS, type DocOptions } from "./model";

/** What an inspection report is generated with: pictures and their marks, no prices. */
export const INSPECTION_REPORT_OPTIONS: DocOptions = {
  ...DEFAULT_OPTIONS,
  prices: "none",
  photos: true,
  marks: true,
};

/** The template the button uses, by name (case does not matter), or null when the install lacks it. */
export function findInspectionTemplate<T extends { name: string; kind: string }>(
  templates: readonly T[],
): T | null {
  const want = INSPECTION_REPORT_TEMPLATE.toLowerCase();
  return templates.find((t) => t.kind === "ticket" && t.name.trim().toLowerCase() === want) ?? null;
}

/** The message when an install has no such template (Admin › Documents seeds it on the next list). */
export const NO_INSPECTION_TEMPLATE = `There is no "${INSPECTION_REPORT_TEMPLATE}" template (Admin › Documents)`;
