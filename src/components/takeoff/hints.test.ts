import { describe, expect, it } from "vitest";

import { HINTS, drawNotes, statusLine, toolTip, toolTips, type DrawNoteContext } from "./hints";
import { TOOL_KEYS, type Tool } from "./shapes";

const TOOLS = Object.keys(TOOL_KEYS) as Tool[];
const ctx: DrawNoteContext = {
  square: false,
  corners: false,
  plan: false,
  orthoDeg: 7,
  scaled: true,
};

describe("tool tips (owner, Oct 27: tips only on hover)", () => {
  it("every tool has a tip, and the list for the ? button names each with its key", () => {
    for (const t of TOOLS) expect(HINTS[t].length, t).toBeGreaterThan(20);
    const list = toolTips(
      TOOLS.map((tool) => ({ tool, label: tool })),
      TOOL_KEYS,
      ctx,
    );
    expect(list.map((x) => x.tool)).toEqual(TOOLS);
    expect(list.every((x) => x.key.length === 1 && x.tip.includes(HINTS[x.tool]))).toBe(true);
  });
  it("the outline tools' tips carry the snap / Shift / typed-length notes; the others do not", () => {
    const area = toolTip("area", ctx);
    expect(area.startsWith(HINTS.area)).toBe(true);
    expect(area).toContain("Square corners is off");
    expect(area).toContain("Snap to corners is off");
    expect(area).toContain("Hold Shift");
    expect(area).toContain("type a length");
    expect(toolTip("select", ctx)).toBe(HINTS.select);
    expect(toolTip("count", ctx)).toBe(HINTS.count);
    const on = drawNotes({ ...ctx, square: true, corners: true, plan: true, scaled: false });
    expect(on[0]).toContain("Square corners is on");
    expect(on[0]).toContain("7°");
    expect(on[1]).toContain("Snap to corners is on");
    expect(on.some((n) => n.includes("plan's own lines"))).toBe(true);
    expect(on.some((n) => n.includes("type a length"))).toBe(false);
  });
  it("the status chip only shows while something is in progress", () => {
    const idle = {
      tool: "area" as Tool,
      edge: false,
      stamp: null,
      draftPoints: 0,
      countSession: false,
      typing: false,
    };
    expect(statusLine(idle)).toBeNull();
    expect(statusLine({ ...idle, tool: "select" })).toBeNull();
    expect(statusLine({ ...idle, draftPoints: 2 })).toBe(
      "Click the next corner · Enter closes · Esc cancels",
    );
    expect(statusLine({ ...idle, tool: "linear", draftPoints: 1 })).toContain("finishes");
    expect(statusLine({ ...idle, edge: true })).toBe(
      "Click a side to change its role · Enter creates · Esc cancels",
    );
    expect(statusLine({ ...idle, stamp: { name: "Drain 1", count: 2 } })).toContain(
      "Drain 1 · 2 stamped",
    );
    expect(statusLine({ ...idle, tool: "count", countSession: true })).toContain("penetration");
    expect(statusLine({ ...idle, draftPoints: 1, typing: true })).toContain("Enter places");
  });
});
