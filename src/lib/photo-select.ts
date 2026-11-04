/**
 * Picking several ticket photos at once (owner, Oct 28: fewer taps). A long press on a thumbnail
 * (a finger) or Shift / Ctrl / ⌘ + click (a mouse) enters the select mode with that photo; while
 * it is on, a tap toggles a photo and an action bar offers Remove, Attach to inspection item (only
 * when every picked photo is a loose "other" photo — the server's rule, setJobPhotoItem) and
 * Download. Letting go of the last photo leaves the mode. Pure; the thumbs and the bar
 * (field-shared.tsx PhotoThumb, photo-select-bar.tsx) call these.
 */

export interface SelectState {
  on: boolean;
  ids: readonly string[];
}

export const NO_SELECTION: SelectState = { on: false, ids: [] };

/** How long a finger rests on a thumbnail before it is a long press (ms). */
/**
 * How long after a long press entered the select mode the "swallow the next click" flag is let
 * go on its own (Nov 4, bug 17 of the Nov 3 review): iOS can end a long press with no click, and
 * the flag used to wait for the next tap — which it then swallowed.
 */
export const LONG_PRESS_RESET_MS = 600;
export const LONG_PRESS_MS = 500;

export const enterSelect = (id: string): SelectState => ({ on: true, ids: [id] });

/** Toggle one photo; dropping the last one leaves the mode. */
export function toggleSelect(s: SelectState, id: string): SelectState {
  const ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id];
  return ids.length === 0 ? NO_SELECTION : { on: true, ids };
}

/** Keep only the photos that still exist (one was deleted elsewhere); none left leaves the mode. */
export function pruneSelect(s: SelectState, existing: readonly string[]): SelectState {
  if (!s.on) return s;
  const ids = s.ids.filter((id) => existing.includes(id));
  if (ids.length === s.ids.length) return s;
  return ids.length === 0 ? NO_SELECTION : { on: true, ids };
}

export type ThumbPress = "open" | "toggle" | "enter";

/**
 * What a press on a thumbnail means: in the mode, toggle; a long press or a modifier click
 * enters the mode with this photo; a plain tap opens the lightbox.
 */
export function thumbPress(
  on: boolean,
  mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  longPress: boolean,
): ThumbPress {
  if (on) return "toggle";
  if (longPress || mods.shiftKey || mods.ctrlKey || mods.metaKey) return "enter";
  return "open";
}

/** Only loose ticket photos (role "other", on no repair) can go onto a checklist item. */
export function attachable(photos: readonly { role: string; repair_id: string | null }[]): boolean {
  return photos.length > 0 && photos.every((p) => p.role === "other" && !p.repair_id);
}

/** "3 selected" */
export const selectedLabel = (n: number) => `${n} selected`;

/** "Remove 3 photos?" */
export const removeQuestion = (n: number) => `Remove ${n === 1 ? "this photo" : `${n} photos`}?`;
