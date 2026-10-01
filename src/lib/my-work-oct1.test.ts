/**
 * My Work, owner's asks of Oct 1: a smooth expand on the Owner view, Everyone by default for
 * admins and managers, a bigger Calendar, and all six List headings always.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUCKET_EMPTY,
  CALENDAR_CELL_MAX,
  cellItems,
  defaultWho,
  initials,
  listGroups,
  mergeWork,
  resolveWho,
  whoParam,
} from "./my-work";

const read = (p: string) => readFileSync(p, "utf8");

const admin = { role: "admin" };
const manager = { role: "manager" };
const user = { role: "user" };

describe("defaultWho: Everyone for admins and managers, Mine for anyone else", () => {
  it("by role", () => {
    expect(defaultWho(admin)).toBe("all");
    expect(defaultWho(manager)).toBe("all");
    expect(defaultWho({ role: "manager", technician: true } as { role: string })).toBe("all");
    expect(defaultWho(user)).toBe("mine");
    expect(defaultWho({ role: "something-else" })).toBe("mine");
    expect(defaultWho({ role: null })).toBe("mine");
    expect(defaultWho(null)).toBe("mine");
    expect(defaultWho(undefined)).toBe("mine");
  });
  it("a missing ?who means the default; an explicit one wins", () => {
    expect(resolveWho(undefined, admin)).toBe("all");
    expect(resolveWho(undefined, manager)).toBe("all");
    expect(resolveWho("", manager)).toBe("all");
    expect(resolveWho(undefined, user)).toBe("mine");
    expect(resolveWho("mine", admin)).toBe("mine");
    expect(resolveWho("all", user)).toBe("all"); // the server ignores it for a plain user
    expect(resolveWho("11111111-1111-4111-8111-111111111111", manager)).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });
  it("the URL leaves out only the caller's default, so ?who=mine survives for a manager", () => {
    expect(whoParam("all", admin)).toBeUndefined();
    expect(whoParam("all", manager)).toBeUndefined();
    expect(whoParam("mine", manager)).toBe("mine");
    expect(whoParam("mine", admin)).toBe("mine");
    expect(whoParam("mine", user)).toBeUndefined();
    expect(whoParam("all", user)).toBe("all");
    expect(whoParam("id1", admin)).toBe("id1");
    expect(whoParam("", admin)).toBeUndefined();
  });
  it("the route resolves ?who through the signed-in profile and keeps an explicit mine", () => {
    const route = read("src/routes/my-work.tsx");
    expect(route).toContain('import { useAuth } from "@/lib/auth-store";');
    expect(route).toContain("const { profile } = useAuth();");
    expect(route).toContain("const curWho = resolveWho(who, profile);");
    expect(route).toContain("const wp = whoParam(w, profile);");
    // validateSearch no longer drops ?who=mine (it would turn back into Everyone).
    expect(route).not.toContain('who !== "mine"');
    expect(route).not.toContain('who ?? "mine"');
    expect(route).toContain(
      '...(typeof who === "string" && who ? { who: who.slice(0, 64) } : {}),',
    );
  });
  it("the picker shows the resolved value (Everyone selected by default)", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain("<Select value={props.who} onValueChange={props.onWho}>");
    expect(page).toContain('<SelectItem value="all">Everyone</SelectItem>');
  });
});

describe("List: all six headings, always, in the same order", () => {
  const today = "2026-10-01";
  it("an empty list still has the six groups, each with (0) and its empty line", () => {
    const groups = listGroups([], today);
    expect(groups.map((g) => g.label)).toEqual([
      "Overdue",
      "Today",
      "This week",
      "Later",
      "No date",
      "Done — waiting on the office",
    ]);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
    for (const g of groups) expect(BUCKET_EMPTY[g.bucket]).toMatch(/\.$/);
  });
  it("only Later and No date filled: the other four are still there, empty", () => {
    const items = mergeWork({
      tickets: [],
      tasks: [
        {
          id: "a",
          title: "Later one",
          due_date: "2026-11-20",
          status: "open",
          building_id: null,
          assignee: "me",
          assignee_name: null,
        },
        {
          id: "b",
          title: "Undated",
          due_date: null,
          status: "open",
          building_id: null,
          assignee: "me",
          assignee_name: null,
        },
      ],
      followups: [],
    });
    const groups = listGroups(items, today);
    expect(groups.map((g) => [g.bucket, g.items.length])).toEqual([
      ["overdue", 0],
      ["today", 0],
      ["week", 0],
      ["later", 1],
      ["nodate", 1],
      ["done", 0],
    ]);
  });
  it("the page renders listGroups, the (count) and the muted empty line for every group", () => {
    const page = read("src/components/my-work-page.tsx");
    const list = page.slice(
      page.indexOf("function ListView"),
      page.indexOf("function CalendarView"),
    );
    expect(list).toContain("presetGroups(listGroups(items, today), preset)");
    expect(list).not.toContain("groupWork(");
    expect(list).toContain("({g.items.length})");
    expect(list).toContain(
      '<p className="text-sm text-muted-foreground">{BUCKET_EMPTY[g.bucket]}</p>',
    );
    // No "Nothing assigned" box in place of the headings.
    expect(page).not.toContain("Nothing assigned");
  });
});

describe("Calendar: whole width, fills the viewport, five items per day", () => {
  it("caps a day at five, then +N more", () => {
    expect(CALENDAR_CELL_MAX).toBe(5);
    const seven = [1, 2, 3, 4, 5, 6, 7];
    expect(cellItems(seven)).toEqual({ shown: [1, 2, 3, 4, 5], more: 2 });
    expect(cellItems([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3, 4, 5], more: 0 });
    expect(cellItems([1, 2])).toEqual({ shown: [1, 2], more: 0 });
    expect(cellItems([])).toEqual({ shown: [], more: 0 });
  });
  it("initials for the Everyone chip", () => {
    expect(initials("Bob Smith")).toBe("BS");
    expect(initials("  mary jo van dyke ")).toBe("MD");
    expect(initials("Cher")).toBe("C");
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
  });
  it("the page: max-w-none outside the List; the grid's sizing classes; bars and chips", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain('view === "list" ? "max-w-5xl" : "max-w-none"');
    const cal = page.slice(page.indexOf("function CalendarView"), page.indexOf("export function"));
    expect(cal).toContain("lg:h-[calc(100vh-14rem)]");
    expect(cal).toContain("grid min-h-0 flex-1 auto-rows-[1fr] overflow-y-auto");
    expect(cal).toContain("min-h-28");
    expect(cal).toContain("lg:min-h-36");
    expect(cal).not.toContain("sm:min-h-24");
    expect(cal).toContain("const { shown, more } = cellItems(list);");
    expect(cal).not.toMatch(/list\.slice\(0, [0-9]\)/);
    expect(cal).toContain("+{more} more");
    expect(cal).toContain("border-l-4");
    expect(cal).toContain("${KIND_BAR[i.kind]}");
    expect(cal).toContain('<span className="min-w-0 flex-1 truncate">{i.title}</span>');
    expect(cal).toMatch(/\{showWho && \(\s*<span[^>]*>\s*\{initials\(i\.assigneeName\)\}/);
    // Today stays highlighted; the day list under the grid stays.
    expect(cal).toContain('d === today ? "bg-primary font-semibold text-primary-foreground" : ""');
    expect(cal).toContain("Nothing on this day.");
  });
});

describe("Owner view: the detail row animates open and closed", () => {
  const view = read("src/components/owner-view.tsx");
  const row = view.slice(view.indexOf("function DetailRow"), view.indexOf("const DETAIL_TITLES"));
  it("a grid-rows 0fr → 1fr transition with opacity, 200 ms ease-out", () => {
    expect(row).toContain("transition-[grid-template-rows,opacity] duration-200 ease-out");
    expect(row).toContain('open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"');
    expect(row).toContain('<div className="min-h-0 overflow-hidden">');
    expect(view).toContain("const EXPAND_MS = 200;");
  });
  it("honours prefers-reduced-motion: no transition, and no delayed unmount", () => {
    expect(row).toContain("motion-reduce:transition-none");
    expect(view).toContain('const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";');
    expect(row).toContain("const reduce = usePrefersReducedMotion();");
    expect(row).toContain("setCollapsing(!open && !reduce);");
  });
  it("the row is always mounted (so collapse animates); the content only while open or collapsing", () => {
    expect(view).not.toContain("{isOpen && (");
    expect(view).toContain("<DetailRow id={detailId} open={isOpen}>");
    expect(row).toContain("{(open || collapsing) && (");
    expect(row).toContain("inert={!open}");
  });
  it("a fixed-height skeleton, three placeholder lines per card, while the detail loads", () => {
    const skel = view.slice(view.indexOf("function DetailSkeleton"));
    expect(skel).toContain("{[0, 1, 2].map((i) => (");
    expect(skel).toContain("DETAIL_TITLES.map(");
    expect(view).toContain("<DetailSkeleton />");
    expect(view).not.toContain('<p className="text-sm text-muted-foreground">Loading…</p>');
    // The skeleton's cards and the loaded cards share the same minimum height.
    expect(view.match(/min-h-48 min-w-0 overflow-hidden rounded-md border/g)?.length).toBe(3);
  });
  it("Expand all opens every row at once (no stagger)", () => {
    expect(view).toContain("setOpen(allOpen ? new Set() : new Set(data.rows.map((r) => r.id)))");
    expect(view).not.toMatch(/transition-delay|delay-\d|stagger/);
  });
});
