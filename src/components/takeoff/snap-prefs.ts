/**
 * The snap toggles (owner, Oct 27: "on an aerial picture it wont let me turn snap off so if
 * something is almost straight it snaps to straight") — pure, no React:
 *  - "Square corners": the ORTHO_DEG lock to square / level / plumb (typed lengths too);
 *  - "Snap to corners": snapping to other objects' corners, the scale line's ends and a
 *    drag-a-box's corners.
 * Both DEFAULT OFF, on every underlay kind (PDF and image), remembered per browser under
 * `takeoff:snap`. Shift is the temporary override: it INVERTS both (toggle off + Shift held =
 * on, toggle on + Shift held = off). "Snap to plan" (PDF only) is a separate toggle; Shift still
 * turns it off for the moment, as before.
 */

export interface SnapPrefs {
  square: boolean;
  corners: boolean;
}
export type SnapPrefKey = keyof SnapPrefs;

export const SNAP_PREFS_KEY = "takeoff:snap";
export const DEFAULT_SNAP_PREFS: SnapPrefs = { square: false, corners: false };

/** The saved JSON (`{"square":true,"corners":false}`) as preferences; anything else = defaults. */
export function parseSnapPrefs(raw: string | null | undefined): SnapPrefs {
  if (!raw) return { ...DEFAULT_SNAP_PREFS };
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return { ...DEFAULT_SNAP_PREFS };
    const o = v as Record<string, unknown>;
    const flag = (k: SnapPrefKey) =>
      typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_SNAP_PREFS[k];
    return { square: flag("square"), corners: flag("corners") };
  } catch {
    return { ...DEFAULT_SNAP_PREFS };
  }
}

/** One toggle flipped. */
export function toggleSnapPref(prefs: SnapPrefs, key: SnapPrefKey): SnapPrefs {
  return { ...prefs, [key]: !prefs[key] };
}

export interface EffectiveSnap {
  square: boolean;
  corners: boolean;
  /** Snap to the plan's own lines: its toggle (and a PDF with lines read) and no Shift. */
  plan: boolean;
}

/**
 * What applies right now: each toggle XOR Shift; the plan lines when their toggle applies and
 * Shift is not held.
 */
export function effectiveSnap(prefs: SnapPrefs, shift: boolean, planOn: boolean): EffectiveSnap {
  return {
    square: prefs.square !== shift,
    corners: prefs.corners !== shift,
    plan: planOn && !shift,
  };
}

/** Read the saved toggles (defaults when storage is unavailable or empty). */
export function readSnapPrefs(): SnapPrefs {
  try {
    return parseSnapPrefs(window.localStorage.getItem(SNAP_PREFS_KEY));
  } catch {
    return { ...DEFAULT_SNAP_PREFS };
  }
}
export function writeSnapPrefs(prefs: SnapPrefs): void {
  try {
    window.localStorage.setItem(SNAP_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: the toggles still work for this visit.
  }
}

/**
 * The angle of a side from level, in whole degrees 0–90 (0 = level, 90 = plumb), for the live
 * label by the cursor while Square corners is off; null for a side with no length.
 */
export function sideAngleDeg(
  a: readonly [number, number],
  b: readonly [number, number],
): number | null {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (dx < 1e-9 && dy < 1e-9) return null;
  return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}
