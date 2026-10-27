/**
 * The View menu (owner, Oct 27: "a way to toggle the lines/fills of an area to help view it
 * cleaner") — pure, no React: Fills, Labels and Lines (default on) and "Only selected" (default
 * off: hides every object but the selected one and its cut-outs; with nothing selected the
 * whole drawing stays visible). Keys F (fills) and Shift+L (labels; a plain L is the Linear
 * tool) toggle when focus is not in a text field. Remembered per browser under `takeoff:view`.
 * The selected object always draws with its outline, whatever the flags say.
 */

export interface ViewFlags {
  fills: boolean;
  labels: boolean;
  lines: boolean;
  onlySelected: boolean;
}
export type ViewFlagKey = keyof ViewFlags;

export const VIEW_PREFS_KEY = "takeoff:view";
export const DEFAULT_VIEW_FLAGS: ViewFlags = {
  fills: true,
  labels: true,
  lines: true,
  onlySelected: false,
};
export const VIEW_FLAG_LABELS: Record<ViewFlagKey, string> = {
  fills: "Fills",
  labels: "Labels",
  lines: "Lines",
  onlySelected: "Only selected",
};
/** The key shown beside each item in the View menu ("" = none). */
export const VIEW_FLAG_KEYS: Record<ViewFlagKey, string> = {
  fills: "F",
  labels: "Shift+L",
  lines: "",
  onlySelected: "",
};

/** The saved JSON as flags; a missing or bad key keeps its default. */
export function parseViewFlags(raw: string | null | undefined): ViewFlags {
  const out = { ...DEFAULT_VIEW_FLAGS };
  if (!raw) return out;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return out;
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(out) as ViewFlagKey[])
      if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
    return out;
  } catch {
    return out;
  }
}

export function toggleViewFlag(flags: ViewFlags, key: ViewFlagKey): ViewFlags {
  return { ...flags, [key]: !flags[key] };
}

/**
 * The flag a key press toggles: F → fills, Shift+L → labels; null for anything else, for a key
 * with Ctrl / Alt / Meta, or while typing in a text field (`typing`).
 */
export function viewKeyAction(
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  typing: boolean,
): ViewFlagKey | null {
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "f") return "fills";
  if (k === "l" && e.shiftKey) return "labels";
  return null;
}

/** Whether object `id` is drawn at all: everything, or only the selection with "Only selected". */
export function objectVisible(
  flags: ViewFlags,
  id: string,
  selectedId: string | null | undefined,
): boolean {
  return !flags.onlySelected || !selectedId || id === selectedId;
}

export function readViewFlags(): ViewFlags {
  try {
    return parseViewFlags(window.localStorage.getItem(VIEW_PREFS_KEY));
  } catch {
    return { ...DEFAULT_VIEW_FLAGS };
  }
}
export function writeViewFlags(flags: ViewFlags): void {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(flags));
  } catch {
    // Storage unavailable: the menu still works for this visit.
  }
}
