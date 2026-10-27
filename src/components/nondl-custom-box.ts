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
