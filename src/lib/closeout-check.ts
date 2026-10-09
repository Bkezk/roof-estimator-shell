/**
 * What a close-out is missing when the technician presses Complete (service study M2, owner
 * Oct 5). CenterPoint will not tick a repair without problem and resolution photos ("Photo
 * Required 0 / 4"); the portal's Complete checked nothing. This is a warning, not a wall: the
 * screen lists what is missing with "Go back" and "Complete anyway". Pure, so it is tested
 * without the screen.
 */

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
  // An inspection's findings are the checklist; a repair ticket should say what was fixed.
  if (repairs.length === 0 && service_type !== "inspection") out.push("No repairs recorded");
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
  if (!c.signature_path) out.push("No customer signature");
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
  if (c.repairs.data && c.photos.data)
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
  if (!c.signature_path) gaps.push("No customer signature");
  return { gaps, unread };
}
