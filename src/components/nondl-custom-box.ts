/** The Non-DL screens' "Add a custom … item" box — pure, no I/O. */
/**
 * Whether a key in the "Add a custom … item" box adds the item and moves to its Quantity box:
 * Enter always; Tab only with something typed (so Tab out of an empty box still moves on);
 * Shift+Tab never (it is "go back").
 */
export function customBoxAdds(key: string, shiftKey: boolean, draft: string): boolean {
  if (key === "Enter") return true;
  return key === "Tab" && !shiftKey && draft.trim().length > 0;
}

/**
 * The custom items as the screen draws them: right under the add box, the newest first, each
 * with its place in the saved list (owner, Nov 19: "adding several custom items means scrolling
 * back up"). The saved list itself stays in the order the items were added (a new one joins the
 * end), so nothing of the bid's totals or the proposal's order moves.
 */
export function customRowsShown<T>(rows: readonly T[]): Array<{ row: T; index: number }> {
  return rows.map((row, index) => ({ row, index })).reverse();
}
