/**
 * The pure parts of the ticket page's "Work" fold (owner, Oct 27: Close-out and Time as two tabs
 * of one fold, for a shorter column; the Activity log tab it had for a day moved into the form's
 * Activity block, lib/ticket-timeline.ts): the fold's one line, the close-out's state, the
 * remembered tab. A .ts module so ticket-field-sections.tsx exports components only (fast
 * refresh); tested in ticket-work-fold.test.ts.
 */
import { STAGE_LABELS, type ServiceJobWithTech, type ServiceStage } from "@/lib/service.functions";
import { whenShort } from "@/components/service/field-utils";

/** "3.5 h" — hours to two decimals, no trailing zeros (the Time line's wording). */
export const hoursText = (h: number) => `${Number(h.toFixed(2))} h`;

export const WORK_TAB_KEY = "bid-o-matic:ticket-work-tab";
export type WorkTab = "closeout" | "time";
const WORK_TABS: readonly WorkTab[] = ["closeout", "time"];

/**
 * A remembered tab name, or Close-out for anything else (nothing stored, an old value — a device
 * that remembered the "timeline" tab of Oct 27 morning lands on Close-out).
 */
export function readWorkTab(raw: string | null | undefined): WorkTab {
  return WORK_TABS.includes(raw as WorkTab) ? (raw as WorkTab) : "closeout";
}

/**
 * The Work fold's one line from what its two tabs know: the close-out's state ("Closed out
 * Oct 12, 3:04 PM" / "Close-out in progress") and the hours logged, joined with " · "; "none
 * yet" when there is nothing. The activity count left with the Activity log tab (the form's
 * Activity block counts its own rows).
 */
export function workSummary(parts: { closeout: string | null; hours: number }): string {
  const out: string[] = [];
  if (parts.closeout) out.push(parts.closeout);
  if (parts.hours > 0) out.push(hoursText(parts.hours));
  return out.length ? out.join(" · ") : "none yet";
}

/**
 * The close-out's state: whether anything was recorded (`any`), whether the office set an
 * office stage with no close-out behind it (owner, Oct 5), and the Work fold's line for it —
 * "Closed out Oct 12, 3:04 PM", "Close-out in progress", "Invoiced by the office — no close-out"
 * (Oct 5: said instead of "not closed out yet"), or null when nothing at all.
 */
export function closeoutInfo(
  job: Pick<
    ServiceJobWithTech,
    | "closing_notes"
    | "checked_in_with"
    | "checked_out_with"
    | "recommend_new_roof"
    | "signature_path"
    | "completed_at"
    | "stage"
  >,
) {
  const any = !!(
    job.closing_notes ||
    job.checked_in_with ||
    job.checked_out_with ||
    job.recommend_new_roof ||
    job.signature_path ||
    job.completed_at
  );
  const officeStage = ["authorized", "invoiced", "closed"].includes(job.stage);
  const line = job.completed_at
    ? `Closed out ${whenShort(job.completed_at)}`
    : any
      ? "Close-out in progress"
      : officeStage
        ? `${STAGE_LABELS[job.stage as ServiceStage]} by the office — no close-out`
        : null;
  return { any, officeStage, line };
}
