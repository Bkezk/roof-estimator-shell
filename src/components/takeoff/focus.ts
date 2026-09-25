/**
 * Keep the drawing's keyboard shortcuts working after a mouse pick in the side panel: a Radix
 * select normally hands focus back to its trigger when it closes, and a focused trigger takes
 * letter keys as typeahead (so they cannot also be tool keys). After a MOUSE pick the focus is
 * dropped instead; after a keyboard pick it returns to the trigger as usual.
 */
let pointerLast = false;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => (pointerLast = true), true);
  window.addEventListener("keydown", () => (pointerLast = false), true);
}

/** Pass as `onCloseAutoFocus` on a takeoff panel's <SelectContent>. */
export function pointerCloseAutoFocus(e: Event): void {
  if (pointerLast) e.preventDefault();
}
