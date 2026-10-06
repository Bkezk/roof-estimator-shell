/**
 * Stage colours for service tickets (owner, Oct 6: "color coded the same colors as centerpoint
 * … it doesnt have to be exact just make it match the palette of the current colors but same
 * base color as centerpoint"; "once the tech completes it id like it to be green with a check
 * mark"). CenterPoint's Tech Board (read Oct 6): New Service Pink, Scheduled Deep Orange,
 * Completed Green; its ticket page: Authorized teal, Invoiced indigo. Ours are the soft
 * light/dark pairs the board already used, in those families. En route and on site are not
 * stages here (a Scheduled ticket's field_status) but colour the card as the tech moves along,
 * as CenterPoint's En Route / In Progress do. One table for the board, the ticket list and the
 * stage strip; whole class strings so Tailwind keeps them.
 */
import type { ServiceStage } from "@/lib/service.functions";

export type StageToneKey = ServiceStage | "en_route" | "on_site";

export interface StageTone {
  /** A card / chip / badge: border, fill and text. */
  chip: string;
  /** A dot (legend swatch, the stage strip's step). */
  dot: string;
}

const tone = (c: string, dot: string): StageTone => ({ chip: c, dot });

export const STAGE_TONES: Record<StageToneKey, StageTone> = {
  open: tone(
    "border-pink-300 bg-pink-100 text-pink-950 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-100",
    "bg-pink-600",
  ),
  scheduled: tone(
    "border-orange-300 bg-orange-100 text-orange-950 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100",
    "bg-orange-600",
  ),
  en_route: tone(
    "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
    "bg-amber-500",
  ),
  on_site: tone(
    "border-violet-300 bg-violet-100 text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100",
    "bg-violet-600",
  ),
  done: tone(
    "border-green-300 bg-green-100 text-green-950 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
    "bg-green-600",
  ),
  authorized: tone(
    "border-teal-300 bg-teal-100 text-teal-950 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-100",
    "bg-teal-600",
  ),
  invoiced: tone(
    "border-indigo-300 bg-indigo-100 text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100",
    "bg-indigo-600",
  ),
  closed: tone(
    "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
    "bg-slate-500",
  ),
};

export const FIELD_TONE_LABELS: Record<"en_route" | "on_site", string> = {
  en_route: "En route",
  on_site: "On site",
};

/** The colour a ticket shows now: its stage, or — Scheduled — where the tech is. */
export function ticketToneKey(j: {
  stage: ServiceStage;
  field_status?: string | null | undefined;
}): StageToneKey {
  if (j.stage === "scheduled" && (j.field_status === "en_route" || j.field_status === "on_site"))
    return j.field_status;
  return j.stage;
}

/** The mark a finished ticket carries: Done ✓ (owner, Oct 6), Authorized ✓✓ (as CenterPoint). */
export function stageMark(stage: ServiceStage): "check" | "double-check" | null {
  return stage === "done" ? "check" : stage === "authorized" ? "double-check" : null;
}
