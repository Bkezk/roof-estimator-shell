/**
 * A phone's unsaved draft against a ticket the office changed meanwhile (Nov 4, bug 4 of the
 * Nov 3 review). The close-out's notes and the inspection checklist keep a copy of what was
 * typed in localStorage until the server has it, and used to restore and save that copy on the
 * next open with no look at the server — so a tech who answered with no signal, while the office
 * edited the same ticket at the desk, replaced the office's text with an "info" toast.
 *
 * Now the draft carries the server stamp it was typed against (the ticket's updated_at; the
 * checklist's saved_at). On restore, a draft whose stamp no longer matches the server's is a
 * conflict: the server's text stays on the screen and a toast offers "Use mine" (the draft is
 * put back and saved) or "Keep theirs" (the draft is dropped). A draft with no stamp (typed
 * before this) or one typed against the current server row restores as before. Pure.
 */
export function draftConflict(
  draftBase: string | null | undefined,
  serverStamp: string | null | undefined,
  differs: boolean,
): boolean {
  if (!differs || !draftBase || !serverStamp) return false;
  return draftBase !== serverStamp;
}

export const DRAFT_CONFLICT_NOTES =
  "Someone at the office changed this ticket's notes after you typed here. Keeping theirs — Use mine puts yours back.";
export const DRAFT_CONFLICT_CHECKLIST =
  "Someone changed this checklist after you answered here. Keeping theirs — Use mine puts your answers back.";
/** How long the choice stays on the screen. */
export const DRAFT_CONFLICT_MS = 20_000;
