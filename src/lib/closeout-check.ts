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
  closing_notes: string;
  /**
   * Hours logged on the ticket (travel + labor). Owner, Oct 8: without the En route / On site
   * buttons the time is typed in the close-out's Time section, so Complete points out a ticket
   * with none. Absent (older callers): not checked.
   */
  time_hours?: number;
}

/** One line per thing missing, in the order the screen asks for them; [] when nothing is. */
export function missingForComplete(c: CloseoutCheckInput): string[] {
  const out: string[] = [];
  // An inspection's findings are the checklist; a repair ticket should say what was fixed.
  if (c.repairs.length === 0 && c.service_type !== "inspection") out.push("No repairs recorded");
  for (const r of c.repairs) {
    const mine = c.photos.filter((p) => p.repair_id === r.id);
    const name = r.name.trim() || "A repair";
    if (!mine.some((p) => p.role === "before")) out.push(`${name} has no Before photo`);
    if (!mine.some((p) => p.role === "after")) out.push(`${name} has no After photo`);
  }
  if (c.time_hours !== undefined && !(c.time_hours > 0)) out.push("No time logged");
  if (!c.closing_notes.trim()) out.push("No closing notes");
  if (!c.signature_path) out.push("No customer signature");
  return out;
}
