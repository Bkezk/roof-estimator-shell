/**
 * Arriving from an Owner-view link, the Show ticks did nothing (the fifth audit, Oct 20; item c):
 * kindsForLanding shows every kind while ?bucket= is in the URL, and desktop never cleared it.
 * Toggling a kind with a preset set now clears the preset (kindToggleClearsPreset →
 * props.onBucket(null)), so the person's ticks apply again.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  defaultWorkLayout,
  kindsForLanding,
  kindToggleClearsPreset,
  toggleKind,
} from "@/lib/work-layout";

describe("kindToggleClearsPreset", () => {
  it("a tick under a preset clears it; without one there is nothing to clear", () => {
    expect(kindToggleClearsPreset("today")).toBe(true);
    expect(kindToggleClearsPreset("overdue")).toBe(true);
    expect(kindToggleClearsPreset(null)).toBe(false);
    expect(kindToggleClearsPreset(undefined)).toBe(false);
    expect(kindToggleClearsPreset("")).toBe(false);
  });
  it("why: with the preset gone the toggled layout applies; while it is set every kind shows", () => {
    const l = toggleKind(defaultWorkLayout(), "task");
    expect(kindsForLanding(l, "today").layout.hiddenKinds).toEqual([]);
    expect(kindsForLanding(l, kindToggleClearsPreset("today") ? null : "today").layout).toBe(l);
  });
});

describe("the page", () => {
  const page = readFileSync("src/components/my-work-page.tsx", "utf8");
  it("the Show menu's tick saves the layout and clears the preset when one is set", () => {
    expect(page).toMatch(
      /import \{[^}]*\bkindToggleClearsPreset\b[^}]*\} from "@\/lib\/work-layout";/,
    );
    expect(page).toMatch(
      /onCheckedChange=\{\(\) => \{\s*onLayout\(toggleKind\(layout, k\)\);[\s\S]*?if \(kindToggleClearsPreset\(props\.bucket\)\) props\.onBucket\(null\);\s*\}\}/,
    );
    // The landing rule itself is untouched.
    expect(page).toContain(
      "const landingKinds = useMemo(() => kindsForLanding(layout, props.bucket), [layout, props.bucket]);",
    );
  });
});
