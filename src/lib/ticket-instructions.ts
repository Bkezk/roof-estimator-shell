/**
 * A ticket's Special instructions and who sees them (owner, Nov 18: "can we have the special
 * instructions be at the top of the timeline when techs are looking at history at this property
 * as well as add a viewable to technicians check box next to special instructions for the
 * office". Chosen: this ticket's instructions sit above the timeline; the box starts ticked;
 * unticked hides the instructions from technicians everywhere).
 *
 * Where the text lives (20261118200000_special_instructions_office_only.sql):
 *
 *   box ticked     service_jobs.notes, as always. Everyone who reads the ticket reads it.
 *   box unticked   service_job_office_notes, a table a technician-only login cannot read.
 *                  service_jobs.notes is then empty, so no screen, list or pop-up a technician
 *                  opens can carry the text: it is not in what the database gives them.
 *
 * The office's reads put the two back together (`mergedInstructions`), and its save moves the
 * text when the box changes (`instructionsWrite`, `saveInstructions`). A technician-only login
 * never changes the box, and its save leaves hidden instructions alone (the database refuses
 * both as well).
 *
 * The rules are pure; the two helpers at the bottom take the caller's own database client, so
 * the database's rules decide what comes back.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { isFieldOnly, type AccessLike } from "@/lib/access";

type Client = SupabaseClient<Database>;

export const INSTRUCTIONS_TECH_LABEL = "Viewable to technicians";
/** Under the box while it is unticked. */
export const INSTRUCTIONS_OFFICE_ONLY = "Office only. Technicians do not see these instructions.";
/** The heading of the box above the history's timeline. */
export const INSTRUCTIONS_HISTORY_TITLE = "Special instructions for this ticket";

const clean = (s: string | null | undefined): string | null => (s ?? "").trim() || null;

/** Who is shown the tick box and may change it: the office (not a technician-only login). */
export const choosesInstructionsVisible = (p: AccessLike | null | undefined): boolean =>
  !!p && !isFieldOnly(p);

/**
 * The instructions as the office reads them: the ticket's own, and the office-only ones. Both
 * are kept when both hold text (a save from an older copy of the site while the box was
 * unticked), the office-only ones first, so nothing typed is ever dropped.
 */
export function mergedInstructions(
  jobNotes: string | null | undefined,
  officeNotes: string | null | undefined,
): string | null {
  const a = clean(officeNotes);
  const b = clean(jobNotes);
  if (a && b && a !== b) return `${a}\n${b}`;
  return a ?? b;
}

export type InstructionsWrite =
  /** Nothing about the instructions is written: a technician's save while they are hidden. */
  | { kind: "leave" }
  /** Ticked: the text is the ticket's own, and no office-only copy is kept. */
  | { kind: "shown"; jobNotes: string | null }
  /** Unticked: the text is the office's alone, and the ticket's own is emptied. */
  | { kind: "hidden"; officeNotes: string | null };

/**
 * What a save does with the instructions.
 *  - `ticked` undefined: the box is left as it is (`currentVisible`; a new ticket is ticked).
 *  - A technician-only login never changes the box. While it is unticked their save leaves the
 *    instructions alone (they were never shown them, so the blank they send is not an edit).
 */
export function instructionsWrite(input: {
  fieldOnly: boolean;
  text: string | null | undefined;
  ticked: boolean | null | undefined;
  /** The stored box; null / undefined on a new ticket. */
  currentVisible: boolean | null | undefined;
}): InstructionsWrite {
  const current = input.currentVisible !== false;
  if (input.fieldOnly)
    return current ? { kind: "shown", jobNotes: clean(input.text) } : { kind: "leave" };
  const visible = input.ticked == null ? current : input.ticked;
  return visible
    ? { kind: "shown", jobNotes: clean(input.text) }
    : { kind: "hidden", officeNotes: clean(input.text) };
}

/** The columns of service_jobs a write sets (none for "leave"). */
export function instructionsPatch(w: InstructionsWrite): {
  notes?: string | null;
  notes_tech_visible?: boolean;
} {
  if (w.kind === "leave") return {};
  return w.kind === "shown"
    ? { notes: w.jobNotes, notes_tech_visible: true }
    : { notes: null, notes_tech_visible: false };
}

/**
 * The office-only instructions of a ticket; null when there are none, when the box is ticked, or
 * for a reader the database gives none to (a technician-only login). A failed read is an error,
 * never an empty box: the office would save over text it was not shown.
 */
export async function readOfficeInstructions(sb: Client, jobId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("service_job_office_notes")
    .select("notes")
    .eq("service_job_id", jobId)
    .maybeSingle();
  if (error) throw new Error(`The office-only instructions could not be read: ${error.message}`);
  return clean(data?.notes);
}

/** A ticket row as its reader should have it: for the office, `notes` is the whole text. */
export async function withInstructions<
  T extends { id: string; notes: string | null; notes_tech_visible?: boolean | null },
>(sb: Client, profile: AccessLike | null | undefined, row: T): Promise<T> {
  if (row.notes_tech_visible !== false || isFieldOnly(profile)) return row;
  return { ...row, notes: mergedInstructions(row.notes, await readOfficeInstructions(sb, row.id)) };
}

/**
 * The office-only half of a save, done BEFORE the ticket's own row is written when hiding and
 * AFTER it when showing, so a failure in between leaves the text in both places, never in none:
 *
 *   hiding    `before` keeps the text in the office table; then the ticket's notes are emptied.
 *   showing   the ticket's notes are written; then `after` removes the office copy.
 */
export async function saveOfficeInstructions(
  sb: Client,
  jobId: string,
  w: InstructionsWrite,
  step: "before" | "after",
  by: { id: string; name: string | null },
  /**
   * Whether an office-only copy can exist: the stored box was unticked. A ticket whose box was
   * ticked all along has none, and its save asks the database nothing more.
   */
  hadCopy: boolean,
): Promise<void> {
  if (w.kind === "leave") return;
  if (w.kind === "hidden" && step === "before" && w.officeNotes) {
    const { error } = await sb.from("service_job_office_notes").upsert(
      {
        service_job_id: jobId,
        notes: w.officeNotes,
        updated_at: new Date().toISOString(),
        updated_by: by.id,
        updated_by_name: by.name,
      },
      { onConflict: "service_job_id" },
    );
    if (error) throw new Error(`The instructions were not saved: ${error.message}`);
    return;
  }
  // Shown again, or hidden with nothing typed: no office copy is kept.
  const remove =
    hadCopy && step === "after" && (w.kind === "shown" || (w.kind === "hidden" && !w.officeNotes));
  if (!remove) return;
  const { error } = await sb.from("service_job_office_notes").delete().eq("service_job_id", jobId);
  if (error)
    throw new Error(`The office-only copy of the instructions was not removed: ${error.message}`);
}
