import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIEW_FLAGS,
  objectVisible,
  parseViewFlags,
  toggleViewFlag,
  viewKeyAction,
} from "./view-prefs";

const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...over,
});

describe("View menu flags (owner, Oct 27)", () => {
  it("fills, labels and lines default on, Only selected off; saved JSON read tolerantly", () => {
    expect(DEFAULT_VIEW_FLAGS).toEqual({
      fills: true,
      labels: true,
      lines: true,
      onlySelected: false,
    });
    expect(parseViewFlags(null)).toEqual(DEFAULT_VIEW_FLAGS);
    expect(parseViewFlags("{")).toEqual(DEFAULT_VIEW_FLAGS);
    expect(parseViewFlags('{"fills":false,"onlySelected":true,"lines":"no"}')).toEqual({
      fills: false,
      labels: true,
      lines: true,
      onlySelected: true,
    });
  });
  it("toggling flips one flag", () => {
    const f = toggleViewFlag(DEFAULT_VIEW_FLAGS, "fills");
    expect(f.fills).toBe(false);
    expect(f.labels).toBe(true);
    expect(toggleViewFlag(f, "fills")).toEqual(DEFAULT_VIEW_FLAGS);
  });
  it("F toggles fills and Shift+L labels; a plain L stays the Linear tool; text fields and modifiers are left alone", () => {
    expect(viewKeyAction(key("f"), false)).toBe("fills");
    expect(viewKeyAction(key("F", { shiftKey: true }), false)).toBe("fills");
    expect(viewKeyAction(key("L", { shiftKey: true }), false)).toBe("labels");
    expect(viewKeyAction(key("l"), false)).toBeNull();
    expect(viewKeyAction(key("f"), true)).toBeNull();
    expect(viewKeyAction(key("f", { ctrlKey: true }), false)).toBeNull();
    expect(viewKeyAction(key("a"), false)).toBeNull();
  });
  it("Only selected hides every object but the selected one; with nothing selected all show", () => {
    const only = { ...DEFAULT_VIEW_FLAGS, onlySelected: true };
    expect(objectVisible(only, "a", "a")).toBe(true);
    expect(objectVisible(only, "b", "a")).toBe(false);
    expect(objectVisible(only, "b", null)).toBe(true);
    expect(objectVisible(DEFAULT_VIEW_FLAGS, "b", "a")).toBe(true);
  });
});
