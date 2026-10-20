/**
 * Show on Work Overview (owner, Oct 14: "an option to check which things you want to see, like
 * if you don't want to see bids on there or tickets or etc so you can be focused on your scope
 * of work"). The unticked kinds ride on the saved layout (browser copy and profile copy, so they
 * follow the user to another device) and are left out of the List and the Calendar. Fails on
 * the old code: no hiddenKinds, no menu, both views drew every item.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { WorkKind } from "@/lib/my-work";
import {
  applyKinds,
  defaultWorkLayout,
  isDefaultWorkLayout,
  KIND_PLURALS,
  kindsSummary,
  normalizeWorkLayout,
  toggleKind,
  WORK_KINDS,
} from "@/lib/work-layout";

const item = (kind: WorkKind, key = kind) => ({ kind, key });

describe("hiddenKinds on the layout", () => {
  it("default: none hidden; a stored layout without the field reads as none", () => {
    expect(defaultWorkLayout().hiddenKinds).toEqual([]);
    expect(normalizeWorkLayout({ order: [], hidden: [] }).hiddenKinds).toEqual([]);
    expect(isDefaultWorkLayout(defaultWorkLayout())).toBe(true);
  });
  it("stored kinds come back, unknown names dropped, duplicates once; all six hidden reads as none", () => {
    expect(
      normalizeWorkLayout({ hiddenKinds: ["bid", "zzz", "bid", "ticket"] }).hiddenKinds,
    ).toEqual(["bid", "ticket"]);
    expect(normalizeWorkLayout({ hiddenKinds: [...WORK_KINDS] }).hiddenKinds).toEqual([]);
  });
  it("a hidden kind makes the layout non-default (so it is saved and cached)", () => {
    const l = toggleKind(defaultWorkLayout(), "bid");
    expect(l.hiddenKinds).toEqual(["bid"]);
    expect(isDefaultWorkLayout(l)).toBe(false);
    expect(isDefaultWorkLayout(toggleKind(l, "bid"))).toBe(true);
  });
  it("the last kind showing cannot be unticked", () => {
    let l = defaultWorkLayout();
    for (const k of WORK_KINDS.slice(1)) l = toggleKind(l, k);
    expect(l.hiddenKinds).toHaveLength(WORK_KINDS.length - 1);
    expect(toggleKind(l, "ticket")).toBe(l);
  });
});

describe("applyKinds and the button's wording", () => {
  const items = [item("ticket"), item("bid"), item("task"), item("opportunity")];
  it("nothing unticked: every item, the same array", () => {
    expect(applyKinds(items, defaultWorkLayout())).toBe(items);
    expect(kindsSummary(defaultWorkLayout())).toBe("all");
  });
  it("bids and opportunities unticked: tickets and tasks stay; 'Show: 4 of 6'", () => {
    const l = toggleKind(toggleKind(defaultWorkLayout(), "bid"), "opportunity");
    expect(applyKinds(items, l).map((i) => i.kind)).toEqual(["ticket", "task"]);
    expect(kindsSummary(l)).toBe("4 of 6");
  });
  it("every kind has a plural for the menu", () => {
    for (const k of WORK_KINDS) expect(KIND_PLURALS[k]).toMatch(/s$/);
  });
});

describe("the page", () => {
  const page = readFileSync("src/components/my-work-page.tsx", "utf8");
  it("a Show menu of tick boxes on List and Calendar, saved through the layout", () => {
    expect(page).toContain('<Eye className="h-4 w-4" /> Show: {kindsSummary(layout)}');
    expect(page).toContain("{WORK_KINDS.map((k) => {");
    expect(page).toContain("onCheckedChange={() => onLayout(toggleKind(layout, k))}");
    expect(page).toContain(
      "const last = on && layout.hiddenKinds.length >= WORK_KINDS.length - 1;",
    );
    expect(page).toContain("{KIND_PLURALS[k]}");
  });
  it("both views draw the ticked kinds only", () => {
    // Oct 20 (audit 4): through kindsForLanding — an Owner-view link's landing shows every kind
    // (work-overview-oct20-audit4.test.ts); otherwise the same layout.
    expect(page).toMatch(
      /const visibleItems = useMemo\(\s*\(\) => applyKinds\(items, landingKinds\.layout\),\s*\[items, landingKinds\.layout\],\s*\);/,
    );
    expect(page).toMatch(/<CalendarView\s+items=\{visibleItems\}/);
    expect(page).toMatch(/<ListView\s+items=\{visibleItems\}/);
    expect(page).not.toMatch(/<CalendarView\s+items=\{items\}/);
    expect(page).not.toMatch(/<ListView\s+items=\{items\}/);
  });
});
