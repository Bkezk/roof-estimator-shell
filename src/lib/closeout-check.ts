/**
 * What a close-out is missing when the technician presses Complete (service study M2, owner
 * Oct 5). CenterPoint will not tick a repair without problem and resolution photos ("Photo
 * Required 0 / 4"); the portal's Complete checked nothing. The screen lists what is missing
 * with "Go back" and, for a manager, "Complete anyway". Since Oct 12 (owner item 7) the server
 * runs the same rules (`closeoutGaps`, service-field.functions.ts setFieldStatus "done"): a
 * technician's Complete is refused while anything is missing (the list comes back in the
 * message, `closeoutRefusal`); a manager's goes through. Pure, so it is tested without the screen.
 *
 * An INSPECTION (owner, Oct 12; closeout-steps.ts closeoutSteps): no repair or photo is ever a
 * gap and the signature is optional, so its list is the checklist — every visible item answered
 * ("N checklist items unanswered") and saved on the server — and the time. The server merges
 * the saved answers (service_jobs.inspection) with the live checklist (inspection_checklist_items)
 * the way the screen does (inspection.ts unansweredCount), so an item added since counts.
 */
import {
  mergeChecklist,
  parseInspection,
  unansweredGap,
  unansweredItems,
  type ChecklistItem,
  type InspectionStatus,
} from "@/lib/inspection";

const isInspection = (service_type: string) => service_type === "inspection";

export interface CheckRepair {
  id: string;
  name: string;
}
export interface CheckPhoto {
  repair_id: string | null;
  role: string;
}

export interface CloseoutCheckInput {
  service_type: string;
  repairs: CheckRepair[];
  photos: CheckPhoto[];
  signature_path: string | null;
  /**
   * Hours logged on the ticket (travel + labor). Owner, Oct 8: without the En route / On site
   * buttons the time is typed in the close-out's Time section, so Complete points out a ticket
   * with none. Absent (older callers): not checked.
   */
  time_hours?: number;
}
// No closing-notes line (owner, Oct 9: step 6 is skippable, "kind of redundant" after each
// repair's What was wrong / What you did); the notes stay a box, not a gap.

/** The repair lines: none recorded (repair tickets), then each repair's missing photos. */
function repairGaps(service_type: string, repairs: CheckRepair[], photos: CheckPhoto[]) {
  const out: string[] = [];
  // An inspection's findings are the checklist (its own flow since Oct 12): no repair or photo
  // is ever a gap on one. A repair ticket should say what was fixed.
  if (isInspection(service_type)) return out;
  if (repairs.length === 0) out.push("No repairs recorded");
  for (const r of repairs) {
    const mine = photos.filter((p) => p.repair_id === r.id);
    const name = r.name.trim() || "A repair";
    if (!mine.some((p) => p.role === "before")) out.push(`${name} has no Before photo`);
    if (!mine.some((p) => p.role === "after")) out.push(`${name} has no After photo`);
  }
  return out;
}

/** One line per thing missing, in the order the screen asks for them; [] when nothing is. */
export function missingForComplete(c: CloseoutCheckInput): string[] {
  const out = repairGaps(c.service_type, c.repairs, c.photos);
  if (c.time_hours !== undefined && !(c.time_hours > 0)) out.push("No time logged");
  if (!c.signature_path && !isInspection(c.service_type)) out.push("No customer signature");
  return out;
}

/** A checklist row as the gap check needs it (the screen's draft, or the server's merge). */
export interface CheckItem {
  label: string;
  status: InspectionStatus | null;
}

/** The inspection lines: the unanswered rows, then an unsaved draft. [] on a repair ticket. */
function checklistGaps(items: readonly CheckItem[], saved: boolean): string[] {
  const out: string[] = [];
  const open = unansweredItems(items).length;
  if (open > 0) out.push(unansweredGap(open));
  if (!saved) out.push("The checklist is not saved yet");
  return out;
}

/** A read the screen holds: its rows when it answered, else its error (or still loading). */
export interface CheckRead<T> {
  data: T | undefined;
  error: unknown;
}

export interface CompleteGapsInput {
  /** Already Done / Invoiced / Closed (the button says Finish): nothing is checked. */
  finished: boolean;
  service_type: string;
  signature_path: string | null;
  /** An older ticket's On site stamp: Complete adds its labor itself, so no time check. */
  on_site_at: string | null;
  repairs: CheckRead<CheckRepair[]>;
  photos: CheckRead<CheckPhoto[]>;
  time: CheckRead<{ hours: number | string }[]>;
  /**
   * An inspection (owner, Oct 12): the checklist rows as the screen holds them (visible, with
   * the draft's answers) and whether that draft is what the server has. Ignored on a repair
   * ticket; an inspection without them (an older caller) checks only the time.
   */
  checklist?: CheckRead<CheckItem[]> | undefined;
  checklist_saved?: boolean | undefined;
}

export interface CompleteGaps {
  /** The "Before you finish" lines, in the screen's order. */
  gaps: string[];
  /** A read had no answer (failed or still loading): the dialog offers Retry beside Complete anyway. */
  unread: boolean;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The line for a read with no rows: it failed, or it is still on its way. */
function readGap(what: string, read: CheckRead<unknown>): string {
  return read.error
    ? `Could not check the ${what} — no signal (${errMsg(read.error)})`
    : `Still loading the ${what}`;
}

/** The close-out's rows as the server reads them (closeoutGaps). */
export interface CloseoutRows {
  service_type: string;
  signature_path: string | null;
  /** An older ticket's On site stamp: Complete adds its labor itself, so no time check. */
  on_site_at: string | null;
  repairs: CheckRepair[];
  photos: CheckPhoto[];
  time: { hours: number | string }[];
  /** An inspection: the saved answers (service_jobs.inspection, raw) and the live checklist. */
  inspection?: unknown;
  checklist?: ChecklistItem[] | undefined;
}

/**
 * The same gap list from rows already in hand (the server's check, Oct 12): exactly what
 * `completeGaps` gives the screen once its reads have answered. On an inspection the saved
 * answers are merged with the live checklist (an item added since is unanswered); what the
 * server holds is by definition saved.
 */
export function closeoutGaps(rows: CloseoutRows): string[] {
  const inspection = isInspection(rows.service_type)
    ? {
        checklist: {
          data: mergeChecklist(parseInspection(rows.inspection ?? null), rows.checklist ?? []),
          error: null,
        },
        checklist_saved: true,
      }
    : {};
  return completeGaps({
    finished: false,
    service_type: rows.service_type,
    signature_path: rows.signature_path,
    on_site_at: rows.on_site_at,
    repairs: { data: rows.repairs, error: null },
    photos: { data: rows.photos, error: null },
    time: { data: rows.time, error: null },
    ...inspection,
  }).gaps;
}

export const CLOSEOUT_INCOMPLETE = "The close-out is not complete";
/** The server's refusal of a technician's Complete: the gaps, and what to do (no wall of text). */
export const closeoutRefusal = (gaps: readonly string[]): string =>
  `${CLOSEOUT_INCOMPLETE}: ${gaps.join("; ")}. Add what is missing, then press Complete again.`;
/** The screen's line under the list for a technician (a manager sees Complete anyway instead). */
export const CLOSEOUT_ADD_MISSING = "Add what is missing, then press Complete again.";

/**
 * Complete's list from the screen's three reads (owner, Oct 9: Complete passed with no checks
 * when a read had failed or was still loading — the old code treated "no rows yet" as "nothing
 * missing"). A read without rows is itself a line, so the dialog shows with "Complete anyway"
 * instead of finishing silently; it never blocks (loading is a line too, with Retry).
 */
export function completeGaps(c: CompleteGapsInput): CompleteGaps {
  if (c.finished) return { gaps: [], unread: false };
  const gaps: string[] = [];
  let unread = false;
  const inspection = isInspection(c.service_type);
  if (inspection) {
    // The checklist stands where the repairs do; the repairs and photos reads are not judged.
    if (c.checklist) {
      if (c.checklist.data)
        gaps.push(...checklistGaps(c.checklist.data, c.checklist_saved !== false));
      else {
        unread = true;
        gaps.push(readGap("checklist", c.checklist));
      }
    }
  } else if (c.repairs.data && c.photos.data)
    gaps.push(...repairGaps(c.service_type, c.repairs.data, c.photos.data));
  else {
    unread = true;
    if (!c.repairs.data) gaps.push(readGap("repairs", c.repairs));
    if (!c.photos.data) gaps.push(readGap("photos", c.photos));
  }
  if (!c.on_site_at) {
    if (c.time.data) {
      const hours = c.time.data.reduce((sum, r) => sum + Number(r.hours), 0);
      if (!(hours > 0)) gaps.push("No time logged");
    } else {
      unread = true;
      gaps.push(readGap("time", c.time));
    }
  }
  // The signature is optional on an inspection (owner, Oct 12).
  if (!c.signature_path && !inspection) gaps.push("No customer signature");
  return { gaps, unread };
}
