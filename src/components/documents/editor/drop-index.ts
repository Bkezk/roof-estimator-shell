/**
 * Where a module dragged over a sheet lands (owner, Oct 28: "drop where you point" — a tile or a
 * saved snippet dragged from the Modules tab goes into the gap under the pointer, not to the
 * bottom). Pure: the canvas passes the pointer's Y and the module wrappers' boxes, in the same
 * coordinate space (both from the screen: clientY and getBoundingClientRect).
 */

export interface DropBox {
  top: number;
  bottom: number;
}

/**
 * The index to insert at, by the midpoint rule: above the midpoint of module i → before i (i);
 * below the last module's midpoint → the end (boxes.length); an empty page → 0. A pointer exactly
 * on a midpoint counts as below it (the gap after that module), so dragging down over a module
 * flips the line at its centre, never before.
 */
export function dropIndexFromY(y: number, boxes: readonly DropBox[]): number {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (y < (b.top + b.bottom) / 2) return i;
  }
  return boxes.length;
}
