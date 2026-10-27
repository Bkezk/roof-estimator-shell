import { describe, expect, it } from "vitest";

import {
  DEFAULT_SNAP_PREFS,
  effectiveSnap,
  parseSnapPrefs,
  sideAngleDeg,
  toggleSnapPref,
} from "./snap-prefs";

describe("snap toggles (owner, Oct 27: snap off by default, Shift inverts)", () => {
  it("both toggles default OFF; the saved JSON is read tolerantly", () => {
    expect(DEFAULT_SNAP_PREFS).toEqual({ square: false, corners: false });
    expect(parseSnapPrefs(null)).toEqual({ square: false, corners: false });
    expect(parseSnapPrefs("not json")).toEqual({ square: false, corners: false });
    expect(parseSnapPrefs('{"square":true}')).toEqual({ square: true, corners: false });
    expect(parseSnapPrefs('{"square":"yes","corners":true}')).toEqual({
      square: false,
      corners: true,
    });
  });
  it("the reducer flips one toggle and leaves the other", () => {
    const a = toggleSnapPref(DEFAULT_SNAP_PREFS, "square");
    expect(a).toEqual({ square: true, corners: false });
    expect(toggleSnapPref(a, "corners")).toEqual({ square: true, corners: true });
    expect(toggleSnapPref(a, "square")).toEqual(DEFAULT_SNAP_PREFS);
  });
  it("effective flags = toggle XOR Shift; the plan lines need their toggle and no Shift", () => {
    const off = DEFAULT_SNAP_PREFS;
    expect(effectiveSnap(off, false, true)).toEqual({ square: false, corners: false, plan: true });
    // Toggle off + Shift held = on (the temporary override).
    expect(effectiveSnap(off, true, true)).toEqual({ square: true, corners: true, plan: false });
    const on = { square: true, corners: true };
    expect(effectiveSnap(on, false, false)).toEqual({ square: true, corners: true, plan: false });
    expect(effectiveSnap(on, true, true)).toEqual({ square: false, corners: false, plan: false });
    expect(effectiveSnap({ square: true, corners: false }, true, false)).toEqual({
      square: false,
      corners: true,
      plan: false,
    });
  });
  it("the live angle label: whole degrees from level, 0–90; null for no length", () => {
    expect(sideAngleDeg([0, 0], [100, 0])).toBe(0);
    expect(sideAngleDeg([0, 0], [0, 50])).toBe(90);
    expect(sideAngleDeg([0, 0], [100, 100])).toBe(45);
    expect(sideAngleDeg([0, 0], [-100, 3])).toBe(2); // nearly level, drawn leftwards
    expect(sideAngleDeg([5, 5], [5, 5])).toBeNull();
  });
});
