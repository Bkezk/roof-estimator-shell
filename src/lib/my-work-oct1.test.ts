/**
 * My Work, owner's asks of Oct 1: Everyone by default for admins and managers, all six List
 * headings always — then, later the same day: the headings as a row of tabs across the top, a
 * Calendar that fits one screen (the day's items beside it), and an Owner table that is always
 * its full size (every person's detail shown, nothing expanding or contracting).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUCKET_EMPTY,
  CALENDAR_CELL_MAX,
  cellItems,
  defaultBucket,
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
  it("the tab to start on: the preset, else the first group with anything, else Today", () => {
    const empty = listGroups([], today);
    expect(defaultBucket(empty, null)).toBe("today");
    expect(defaultBucket(empty, "overdue")).toBe("overdue");
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
      ],
      followups: [],
    });
    expect(defaultBucket(listGroups(items, today), null)).toBe("later");
    expect(defaultBucket(listGroups(items, today), "today")).toBe("today");
    const late = mergeWork({
      tickets: [],
      tasks: [
        {
          id: "b",
          title: "Late",
          due_date: "2026-09-20",
          status: "open",
          building_id: null,
          assignee: "me",
          assignee_name: null,
        },
        {
          id: "c",
          title: "Now",
          due_date: today,
          status: "open",
          building_id: null,
          assignee: "me",
          assignee_name: null,
        },
      ],
      followups: [],
    });
    expect(defaultBucket(listGroups(late, today), null)).toBe("overdue");
  });
  it("the page: six columns across on a desktop, a row of tabs on a phone", () => {
    const page = read("src/components/my-work-page.tsx");
    const list = page.slice(
      page.indexOf("function ListView"),
      page.indexOf("function CalendarView"),
    );
    expect(list).toContain("listGroups(items, today)");
    expect(list).not.toContain("groupWork(");
    expect(list).not.toContain("presetGroups(");
    // Desktop (lg+): every group a column, all in view at once — no clicking between them.
    expect(list).toContain('<div className="hidden gap-3 lg:grid lg:grid-cols-3 xl:grid-cols-6">');
    expect(list).toContain("aria-labelledby={`work-col-${g.bucket}`}");
    expect(list).toContain('preset === g.bucket ? "ring-2 ring-primary" : ""');
    // Phone: tabs, the picked one's items below.
    expect(list).toContain('<div className="space-y-4 lg:hidden">');
    expect(list).toContain(
      '<div role="tablist" aria-label="Group" className="flex flex-wrap gap-1 border-b">',
    );
    expect(list).toContain('role="tab"');
    expect(list).toContain("aria-selected={selected}");
    expect(list).toContain("({g.items.length})");
    expect(list).toContain("const bucket = picked ?? defaultBucket(groups, preset);");
    expect(list).toContain('role="tabpanel"');
    // Each group's items, or its muted empty line, come from one place for both layouts.
    expect(list).toContain(
      '<p className="text-sm text-muted-foreground">{BUCKET_EMPTY[g.bucket]}</p>',
    );
    expect(list).toContain("{rows(g)}");
    expect(list).toContain("{rows(group)}");
    // Overdue reads red when there is anything in it.
    expect(list).toContain(
      'const isAlert = (g: WorkGroup) => g.bucket === "overdue" && g.items.length > 0;',
    );
    // Picking another tab drops a ?bucket= preset; a new preset wins over an earlier pick.
    expect(list).toContain("if (preset && b !== preset) onClearPreset();");
    expect(list).toContain("if (prevPreset !== preset) {");
    // The List uses the whole width like the other views; no "Nothing assigned" or "Show all".
    expect(page).toContain('<div className="mx-auto max-w-none space-y-5">');
    expect(page).not.toContain("max-w-5xl");
    expect(page).not.toContain("Nothing assigned");
    expect(page).not.toContain("Show all");
  });
});

describe("Calendar: whole width, one screen, the day's items beside it, five items per day", () => {
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
  it("the page: the whole width; sized to the viewport on xl; bars and chips", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain('<div className="mx-auto max-w-none space-y-5">');
    const cal = page.slice(page.indexOf("function CalendarView"), page.indexOf("export function"));
    // The whole thing (month buttons, grid, the day's items) is one viewport tall on xl and up,
    // the weeks dividing the grid's height; nothing to scroll to. Below xl it flows as before.
    expect(cal).toContain(
      '<div className="flex flex-col gap-4 xl:h-[calc(100vh-15rem)] xl:min-h-[30rem] xl:flex-row">',
    );
    expect(cal).not.toContain("lg:h-[calc(100vh-14rem)]");
    expect(cal).toContain("grid min-h-0 flex-1 auto-rows-[1fr] overflow-y-auto");
    expect(cal).toContain("min-h-24");
    expect(cal).toContain("xl:min-h-0");
    expect(cal).not.toContain("lg:min-h-36");
    expect(cal).not.toContain("min-h-28");
    // A day clips past its lines rather than pushing the week taller.
    expect(cal).toMatch(
      /flex min-h-24 min-w-0 flex-col items-stretch gap-1 overflow-hidden border-r/,
    );
    // The day's items: a 20rem column beside the grid on xl, scrolling inside; under it below xl.
    expect(cal).toContain('<section className="flex min-h-0 flex-col gap-2 xl:w-80 xl:shrink-0">');
    expect(cal).toContain("xl:overflow-y-auto");
    expect(cal).toContain('<div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-1">');
    expect(cal).toContain("const { shown, more } = cellItems(list);");
    expect(cal).not.toMatch(/list\.slice\(0, [0-9]\)/);
    expect(cal).toContain("+{more} more");
    expect(cal).toContain("border-l-4");
    expect(cal).toContain("${KIND_BAR[i.kind]}");
    expect(cal).toContain('<span className="min-w-0 flex-1 truncate">{i.title}</span>');
    expect(cal).toMatch(/\{showWho && \(\s*<span[^>]*>\s*\{initials\(i\.assigneeName\)\}/);
    // Today stays highlighted; the day list stays.
    expect(cal).toContain('d === today ? "bg-primary font-semibold text-primary-foreground" : ""');
    expect(cal).toContain("Nothing on this day.");
  });
});

describe("Owner view: one size, every person's detail always shown", () => {
  const view = read("src/components/owner-view.tsx");
  it("no expand / collapse: no open state, chevron, Expand all, animation or reduced-motion hook", () => {
    for (const gone of [
      "useState",
      "ChevronRight",
      "Expand all",
      "Collapse all",
      "aria-expanded",
      "DetailRow",
      "grid-rows-[",
      "EXPAND_MS",
      "prefers-reduced-motion",
      "usePrefersReducedMotion",
      "onRowClick",
      "cursor-pointer",
      "inert=",
    ])
      expect(view, gone).not.toContain(gone);
  });
  it("each summary row is followed by its detail row, the detail always mounted", () => {
    expect(view).toContain('<TableCell className="font-medium">{r.name}</TableCell>');
    expect(view).toContain("<PersonDetail userId={r.id} name={r.name} />");
    expect(view).toContain('<TableRow className="hover:bg-transparent">');
    expect(view).toContain('<TableCell colSpan={7} className="p-0">');
    expect(view).toContain('<div className="bg-muted/30 p-3 align-top">');
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
});
