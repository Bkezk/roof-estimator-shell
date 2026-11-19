/**
 * What an estimator tab does when the edit lock on its bid comes BACK to it (it was read-only
 * because another tab or person held the bid, and that holder has left). Pure, no I/O.
 *
 * Until Nov 19 the tab always threw its page away and read the saved bid again, without a word.
 * Whatever had been typed here and not saved went with it, and nobody was asked (owner, Nov 19:
 * an estimator "doesnt believe he was asked to save before leaving and lost work"). Now:
 *
 *   - unsaved changes here are KEPT, and the person is told to save. A save can never write over
 *     somebody else's: the server refuses a save from a copy older than the saved bid
 *     (lib/bid-stale-save.ts) and says who saved and when;
 *   - nothing unsaved here: the saved bid is read again, and the page is replaced only when the
 *     bid really changed meanwhile.
 */
export type LockReturn = "nothing" | "keep" | "reload";

/** `firstTime`: this tab never held the lock before (it has just opened the bid). */
export function lockReturnAction(firstTime: boolean, unsaved: boolean): LockReturn {
  if (firstTime) return "nothing";
  return unsaved ? "keep" : "reload";
}

/** Was the bid saved since this tab read it? Unknown on either side counts as changed. */
export function bidChangedSince(
  loadedUpdatedAt: string | null | undefined,
  rowUpdatedAt: string | null | undefined,
): boolean {
  if (!loadedUpdatedAt || !rowUpdatedAt) return true;
  return new Date(loadedUpdatedAt).getTime() !== new Date(rowUpdatedAt).getTime();
}

/** Said when the lock comes back to a tab that holds unsaved changes. */
export const LOCK_BACK_UNSAVED =
  "You can edit this bid again. Your unsaved changes are still on this page: press Save now. If someone saved this bid while you could not edit it, Save will say so and nothing of theirs is written over.";
