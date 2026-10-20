/**
 * Work Overview, owner's asks of Oct 12 (the Everyone screenshot: nine columns, most empty, and
 * three Done tickets with no technician sitting under Unassigned flagged "Overdue"):
 *
 * 1. Empty columns fold: a group with nothing in it is a small "Label 0" chip on an "Empty:" row
 *    above the columns, in order; columns with items stay columns. Hidden (×) columns stay out
 *    entirely and keep their own "Hidden: … Reset layout" row. The fold never touches a layout.
 * 2. A ⓘ (lucide Info) with a tooltip beside every column title, tab and chip: BUCKET_HELP.
 * 3. A Done ticket is never Unassigned: not in the unassigned query (Open / Scheduled only), never
 *    flagged overdue. Since later that day it is not listed anywhere (the Done group is gone, for
 *    everyone): the authorizer sees it once, under Needs authorization through its Authorize
 *    follow-up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  BUCKET_HELP,
  BUCKET_LABELS,
  LIST_BUCKETS,
  UNASSIGNED_TICKET_STAGES,
  WORK_TICKET_STAGES,
  bucketOf,
  flagUnassigned,
  groupWork,
  listBucketOf,
  listGroups,
  mergeWork,
  splitEmptyGroups,
  ticketItem,
  unassignedItems,
  unassignedOverdue,
  type TicketIn,
  type WorkBucket,
  type WorkGroup,
  type WorkItem,
} from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { OVERDUE_TICKET_STAGES } from "@/lib/work-counts";
import { applyWorkLayout, defaultWorkLayout, hideBucket } from "@/lib/work-layout";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const utcDay = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-10-12";

const task = (id: string, due: string | null): WorkItem => ({
  key: `task:${id}`,
  kind: "task",
  title: id,
  where: null,
  date: due,
  status: "Open",
  done: false,
  href: "/prospect",
  assigneeId: "me",
  assigneeName: "Me",
  followup: null,
});
const group = (bucket: WorkBucket, items: WorkItem[] = []): WorkGroup => ({
  bucket,
  label: BUCKET_LABELS[bucket],
  items,
});

// ── 1. The fold ─────────────────────────────────────────────────────────────────────────────

describe("1. empty columns fold into chips", () => {
  it("splitEmptyGroups: groups with items are columns, the rest chips, both in the given order", () => {
    const groups = [
      group("unassigned"),
      group("overdue", [task("late", "2026-10-01")]),
      group("week"),
      group("later", [task("far", "2026-12-01")]),
      group("waiting"),
    ];
    const { columns, empty } = splitEmptyGroups(groups);
    expect(columns.map((g) => g.bucket)).toEqual(["overdue", "later"]);
    expect(empty.map((g) => g.bucket)).toEqual(["unassigned", "week", "waiting"]);
    // The same group objects, nothing copied or re-sorted.
    expect(columns[0]).toBe(groups[1]);
    expect(empty.map((g) => g.items.length)).toEqual([0, 0, 0]);
  });
  it("everything empty: no columns, every group a chip; everything filled: no chips", () => {
    const all = listGroups([], TODAY, { authorize: true, invoice: true, unassigned: true });
    const none = splitEmptyGroups(all);
    expect(none.columns).toEqual([]);
    expect(none.empty.map((g) => g.bucket)).toEqual(LIST_BUCKETS);
    const full = splitEmptyGroups([group("week", [task("a", TODAY)])]);
    expect(full).toEqual({ columns: [group("week", [task("a", TODAY)])], empty: [] });
    expect(splitEmptyGroups([])).toEqual({ columns: [], empty: [] });
  });
  it("the ?bucket= preset's column stays a column even when empty (something to ring and open)", () => {
    const groups = [group("overdue"), group("week", [task("a", TODAY)])];
    expect(splitEmptyGroups(groups, "overdue").columns.map((g) => g.bucket)).toEqual([
      "overdue",
      "week",
    ]);
    expect(splitEmptyGroups(groups, "overdue").empty).toEqual([]);
    expect(splitEmptyGroups(groups, null).columns.map((g) => g.bucket)).toEqual(["week"]);
  });
  it("a hidden column is neither a column nor an empty chip: the layout decides first, the fold after", () => {
    const layout = hideBucket(defaultWorkLayout(), "waiting");
    const groups = listGroups([task("a", TODAY)], TODAY, { unassigned: true });
    const { shown, hidden } = applyWorkLayout(groups, layout);
    const { columns, empty } = splitEmptyGroups(shown);
    expect(hidden.map((g) => g.bucket)).toEqual(["waiting"]);
    expect(columns.map((g) => g.bucket)).toEqual(["week"]);
    expect(empty.map((g) => g.bucket)).toEqual(["unassigned", "overdue", "later"]);
    expect(empty.map((g) => g.bucket)).not.toContain("waiting");
    // The fold reads the layout and never writes it.
    expect(layout).toEqual(hideBucket(defaultWorkLayout(), "waiting"));
    const src = read("src/lib/my-work.ts");
    const fold = src.slice(src.indexOf("export function splitEmptyGroups"));
    expect(fold.slice(0, fold.indexOf("\n}\n"))).not.toMatch(/layout|hidden|order/);
  });
});

// ── 2. The help ─────────────────────────────────────────────────────────────────────────────

describe("2. BUCKET_HELP: one or two plain sentences per column", () => {
  it("every bucket has help, each a sentence or two", () => {
    const buckets: WorkBucket[] = [...LIST_BUCKETS, "today"];
    for (const b of buckets) {
      expect(BUCKET_HELP[b], b).toMatch(/^[A-Z].*\.$/);
      expect(BUCKET_HELP[b].split(/(?<=\.)\s+(?=[A-Z“])/).length, b).toBeLessThanOrEqual(2);
    }
    expect(Object.keys(BUCKET_HELP).sort()).toEqual([...buckets].sort());
  });
  it("the texts, as the owner wrote them", () => {
    expect(BUCKET_HELP).toEqual({
      // Oct 15: tasks named too (they have sat in the group since Oct 9).
      unassigned:
        "Tickets, tasks and opportunities with nobody on them yet. Claim one if you are ticked Technician, or put someone on it with Assign to; they turn red after the number of days set on Admin › Reminders.",
      // Oct 20 (audit 4): every kind bucketOf puts there; today's items sit in This week.
      overdue:
        "Tickets, tasks, follow-ups, opportunities and draft bids past their day. The assignee is reminded on the Reminders schedule.",
      today: "Due today.",
      week: "Due today or later this week: tickets, tasks, follow-ups, opportunities and draft bids.",
      // Oct 12: draft bids by due date join the groups (bid-due-date.test.ts).
      later: "Due after this week, or with no date yet (a bid without a due date too).",
      waiting:
        "Follow-ups on hold until a date — a manager's Snooze, or a logged contact with “They asked to try again on”. Reminders pause until then, and the item comes back with a “Back from hold” badge.",
      // Oct 12: managers authorize too (managers-authorize.test.ts).
      authorize:
        "Tickets the technician has completed. Any admin or manager can review the close-out and mark them Authorized; the named authorizer gets the reminders.",
      invoice:
        "Authorized tickets waiting for an invoice, with how long they have waited. Shown to the people who invoice.",
    });
  });
});

// ── The page ────────────────────────────────────────────────────────────────────────────────

describe("the page: chips above the columns, a ⓘ on every title and chip, the Hidden row untouched", () => {
  const page = read("src/components/my-work-page.tsx");
  const list = page.slice(
    page.indexOf("function BucketHelp"),
    page.indexOf("function CalendarView"),
  );
  it("BucketHelp: lucide Info (h-3.5 w-3.5, muted) in a shadcn Tooltip with the bucket's help", () => {
    expect(page).toContain(
      'import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";',
    );
    expect(page).toMatch(/import \{[^}]*\bInfo\b[^}]*\} from "lucide-react";/);
    expect(page).toMatch(/import \{[^}]*\bBUCKET_HELP\b[^}]*\} from "@\/lib\/my-work";/);
    const help = list.slice(0, list.indexOf("function ListView"));
    expect(help).toContain("<Tooltip>");
    expect(help).toContain("<TooltipTrigger asChild>");
    expect(help).toContain("aria-label={`About ${label}`}");
    expect(help).toContain('<Info className="h-3.5 w-3.5" aria-hidden="true" />');
    expect(help).toContain('className="rounded text-muted-foreground hover:text-foreground"');
    expect(help).toMatch(/<TooltipContent[^>]*>\s*\{BUCKET_HELP\[bucket\]\}\s*<\/TooltipContent>/);
    // A click on the ⓘ never starts the heading's drag or picks the tab.
    expect(help).toContain("onClick={(e) => e.stopPropagation()}");
    // The shell's TooltipProvider (ui/sidebar) wraps every authenticated page.
    expect(read("src/components/ui/sidebar.tsx")).toContain("<TooltipProvider delayDuration={0}>");
    expect(read("src/components/auth-gate.tsx")).toContain("<SidebarProvider>");
  });
  it("the columns are the groups with items (splitEmptyGroups), the chips the empty ones", () => {
    expect(list).toContain(
      "const { columns, empty } = useMemo(() => splitEmptyGroups(shown, keep), [shown, keep]);",
    );
    expect(list).toContain("listGridClass(columns.length)");
    expect(list).toContain("{columns.map((g) => (");
    expect(list).not.toContain("{shown.map(");
    // The tab to start on and the fallback group still read every shown group.
    expect(list).toContain("const bucket = activeTab(columns, picked, preset);");
    expect(list).toContain("const group = shown.find((g) => g.bucket === bucket) ??");
  });
  it('the "Empty:" row: a chip per empty group with its label, count and ⓘ, wrapping; both layouts', () => {
    const bar = list.slice(list.indexOf("const emptyBar ="), list.indexOf("const nothing ="));
    expect(bar).toContain("empty.length > 0 && (");
    expect(bar).toContain(
      'className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"',
    );
    expect(bar).toContain("<span>Empty:</span>");
    expect(bar).toContain("{empty.map((g) => (");
    expect(bar).toContain('data-chip="empty"');
    expect(bar).toContain("<span>{g.label}</span>");
    expect(bar).toContain('<span className="tabular-nums">{g.items.length}</span>');
    expect(bar).toContain("<BucketHelp bucket={g.bucket} label={g.label} />");
    // No button: a chip is not a hidden column's restore chip.
    expect(bar).not.toContain("<Button");
    expect(bar).not.toContain("onLayout(");
    // Above the columns on a desktop, above the tabs on a phone, after the Hidden row in each.
    expect(list.match(/\{layoutBar\}\s*\{emptyBar\}\s*\{nothing\}/g)?.length).toBe(2);
    // Oct 20: one line when every shown group is empty, another when every column is hidden.
    expect(list).toContain('"Nothing to do: every group is empty."');
    expect(list).toContain('"Every column is hidden — bring one back from Hidden."');
  });
  it("every column title and every phone tab carries the ⓘ", () => {
    const desktop = list.slice(list.indexOf("{columns.map((g) => ("), list.indexOf("lg:hidden"));
    expect(desktop).toContain(
      '<span className="min-w-0 break-words" title="Drag to move this column">',
    );
    expect(desktop).toContain("<BucketHelp bucket={g.bucket} label={g.label} />");
    expect(desktop).toContain("<GripVertical"); // the drag handle stays
    expect(desktop).toContain("draggable");
    expect(desktop).toContain("onLayout(moveBucket(layout, dragging, target))".slice(0, 8));
    const phone = list.slice(list.indexOf("lg:hidden"));
    expect(phone).toContain("{columns.map((g) => {");
    expect(phone).toContain('role="tab"');
    // Beside the tab button, not inside it (a button holds no button).
    expect(phone).toMatch(
      /<\/button>\s*<BucketHelp bucket=\{g\.bucket\} label=\{g\.label\} \/>\s*<\/span>/,
    );
    expect(phone).toContain(
      '<div role="tablist" aria-label="Group" className="flex flex-wrap gap-1 border-b">',
    );
  });
  it("the Hidden row keeps its wording and Reset layout; hidden buckets never become empty chips", () => {
    const bar = list.slice(list.indexOf("const layoutBar ="), list.indexOf("const emptyBar ="));
    expect(bar).toContain("{hidden.length > 0 && <span>Hidden:</span>}");
    expect(bar).toContain("{hidden.map((g) => (");
    expect(bar).toContain("onLayout(showBucket(layout, g.bucket))");
    expect(bar).toContain("Reset layout");
    expect(bar).toContain("onLayout(defaultWorkLayout())");
    expect(bar).not.toContain("emptyBar");
    expect(bar).not.toContain('data-chip="empty"');
    expect(bar).not.toContain("Empty:");
    // The fold reads applyWorkLayout's `shown` (the hidden ones already set aside).
    expect(list).toContain("applyWorkLayout(groups, layout, keep)");
    expect(list.indexOf("applyWorkLayout(groups, layout, keep)")).toBeLessThan(
      list.indexOf("splitEmptyGroups(shown, keep)"),
    );
  });
});

// ── 3. Done is never Unassigned ─────────────────────────────────────────────────────────────

const ticket = (over: Partial<TicketIn> = {}): TicketIn => ({
  id: "t6013",
  number: 6013,
  customer_name: "Bell County BOE",
  site_name: null,
  site_address: null,
  description: "Leak",
  service_type: "leak",
  stage: "done",
  scheduled_date: "2026-10-01",
  technician_id: null,
  created_at: "2026-09-20T12:00:00Z",
  ...over,
});

describe("3. a Done ticket with no technician is never Unassigned (pure rules)", () => {
  it("the unassigned stages are Open and Scheduled — the overdue stages, and (since the Done group went) the listed ones", () => {
    expect([...UNASSIGNED_TICKET_STAGES]).toEqual(["open", "scheduled"]);
    expect([...UNASSIGNED_TICKET_STAGES]).toEqual([...OVERDUE_TICKET_STAGES]);
    expect([...WORK_TICKET_STAGES]).toEqual(["open", "scheduled"]);
  });
  it("unassignedItems drops it (keeps an Open or Scheduled one)", () => {
    const items = unassignedItems(
      {
        tickets: [
          ticket(),
          ticket({ id: "open", stage: "open" }),
          ticket({ id: "sched", stage: "scheduled" }),
          ticket({ id: "auth", stage: "authorized" }),
        ],
        opportunities: [],
      },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["ticket:open", "ticket:sched"]);
  });
  it("bucketOf / listBucketOf: a finished item has no group (never Unassigned, never overdue); groupWork drops it", () => {
    const done = ticketItem(ticket(), {}, null, utcDay);
    expect(done).toMatchObject({ done: true, assigneeId: null, date: "2026-10-01" });
    expect(bucketOf(done, TODAY, utcDay)).toBeNull();
    expect(listBucketOf(done, TODAY, utcDay)).toBeNull();
    // Even marked unassigned by mistake, a done item is placed nowhere and is not flagged.
    const marked = { ...done, unassigned: true, since: "2026-09-20" };
    expect(bucketOf(marked, TODAY, utcDay)).toBeNull();
    expect(unassignedOverdue(marked, TODAY, 0)).toBe(false);
    expect(flagUnassigned([marked], TODAY, 0)[0]!.flag).toBe(false);
    expect(groupWork([marked], TODAY, utcDay)).toEqual([]);
    expect(
      listGroups([marked], TODAY, { unassigned: true, toYmd: utcDay }).every(
        (g) => g.items.length === 0,
      ),
    ).toBe(true);
    // An Open ticket nobody is on is still Unassigned and still flagged past the timer.
    const open = { ...ticketItem(ticket({ stage: "open" }), {}, null, utcDay), unassigned: true };
    expect(bucketOf(open, TODAY, utcDay)).toBe("unassigned");
    expect(unassignedOverdue(open, TODAY)).toBe(true);
    const src = read("src/lib/my-work.ts");
    const fn = src.slice(src.indexOf("export function bucketOf"));
    expect(fn.indexOf("if (item.done) return null;")).toBeLessThan(
      fn.indexOf('if (item.unassigned) return "unassigned";'),
    );
  });
});

describe("3. listMyWork, through the fake client", () => {
  const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const BRANDON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const profiles: Row[] = [
    { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Mo", email: "m@x" },
    {
      id: BRANDON,
      role: "admin",
      access: [],
      technician: false,
      full_name: "Brandon",
      email: "b@x",
    },
    {
      id: TECH,
      role: "user",
      access: ["service"],
      technician: true,
      full_name: "Ted",
      email: "t@x",
    },
  ];
  const job = (over: Row = {}): Row => ({
    id: "j-done-nobody",
    number: 6013,
    customer_name: "Bell County BOE",
    site_name: null,
    site_address: null,
    description: "Leak",
    service_type: "leak",
    stage: "done",
    scheduled_date: "2026-10-01",
    technician_id: null,
    created_at: "2026-09-20T12:00:00Z",
    stage_changed_at: "2026-10-08T12:00:00Z",
    deleted_at: null,
    ...over,
  });
  const authorizeFollowup: Row = {
    id: "f-auth",
    title: "Authorize Ticket #6013 Bell County BOE — Leak",
    url: "/service?id=j-done-nobody",
    due_at: "2026-10-09T12:00:00Z",
    status: "open",
    kind: "invoice",
    item_id: "j-done-nobody",
    assignee_id: BRANDON,
    account_id: null,
    every_days: 1,
    snoozed_until: null,
  };
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      profiles,
      service_jobs: [
        job(),
        job({
          id: "j-open-nobody",
          number: 6014,
          stage: "scheduled",
          scheduled_date: "2026-10-05",
        }),
        job({ id: "j-done-ted", number: 6002, technician_id: TECH }),
        job({
          id: "j-sched-ted",
          number: 6003,
          stage: "scheduled",
          scheduled_date: "2026-10-14",
          technician_id: TECH,
        }),
      ],
      tasks: [],
      crm_followups: [],
      crm_opportunities: [],
      crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
    };
  });
  const run = async (userId: string, who?: string) => {
    const r = await (
      listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>
    )({
      data: who ? { who } : {},
      context: {
        supabase: fakeSupabase(tables, { rpcs: { ticket_authorizers: () => [BRANDON] } }).db,
        userId,
      },
    });
    const items = flagUnassigned(mergeWork(r, utcDay), TODAY, r.unassignedOverdueDays);
    const groups = listGroups(items, TODAY, {
      authorize: r.authorizer,
      invoice: r.invoicer,
      unassigned: !!r.unassigned,
      toYmd: utcDay,
    });
    const by = Object.fromEntries(groups.map((g) => [g.bucket, g.items]));
    const where = (key: string) =>
      groups.filter((g) => g.items.some((i) => i.key === key)).map((g) => g.bucket);
    return { r, items, by, where };
  };

  it("Everyone (a manager): a Done ticket is never Unassigned or overdue — nobody's or Ted's; Unassigned holds the Scheduled one", async () => {
    const { r, by, where, items } = await run(MANAGER, "all");
    // The server: Open / Scheduled only, in the unassigned rows and in the tickets.
    expect(r.unassigned!.tickets.map((t) => t.id)).toEqual(["j-open-nobody"]);
    expect(r.tickets.map((t) => t.id)).toEqual(["j-sched-ted"]);
    // The page: the Done tickets are in no Done group (Oct 12: none) and never Unassigned; a
    // manager sees them only under Needs authorization (later that day: managers authorize too,
    // managers-authorize.test.ts). Unassigned holds the Scheduled one nobody is on, flagged (past
    // its day); Ted's Scheduled one is in This week.
    expect(where("ticket:j-done-nobody")).toEqual(["authorize"]);
    expect(where("ticket:j-done-ted")).toEqual(["authorize"]);
    expect(items.map((i) => i.key).sort()).toEqual([
      "ticket:j-done-nobody",
      "ticket:j-done-ted",
      "ticket:j-open-nobody",
      "ticket:j-sched-ted",
    ]);
    expect(by["done"]).toBeUndefined();
    expect(by["unassigned"]!.map((i) => i.key)).toEqual(["ticket:j-open-nobody"]);
    expect(by["unassigned"]![0]!.flag).toBe(true);
    expect(by["overdue"] ?? []).toEqual([]);
    expect(by["week"]!.map((i) => i.key)).toEqual(["ticket:j-sched-ted"]);
  });
  it("with its Authorize follow-up open: the authorizer sees it once, under Needs authorization", async () => {
    tables["crm_followups"] = [authorizeFollowup];
    // The authorizer's own view (Mine).
    const mine = await run(BRANDON);
    expect(mine.r.authorizer).toBe(true);
    expect(mine.where("followup:f-auth")).toEqual(["authorize"]);
    expect(mine.where("ticket:j-done-nobody")).toEqual([]);
    expect(mine.by["unassigned"]!.map((i) => i.key)).toEqual(["ticket:j-open-nobody"]);
    // Everyone: the ticket is not even in the rows; its Authorize row is the one listed.
    const all = await run(MANAGER, "all");
    expect(all.r.tickets.map((t) => t.id)).not.toContain("j-done-nobody");
    expect(all.where("followup:f-auth")).toEqual(["authorize"]);
    expect(all.where("ticket:j-done-nobody")).toEqual([]);
    expect(all.by["done"]).toBeUndefined();
    expect(all.by["unassigned"]!.map((i) => i.key)).toEqual(["ticket:j-open-nobody"]);
  });
  it("Mine and one person's view carry their own open work only; a technician gets no unassigned rows", async () => {
    const mine = await run(MANAGER);
    expect(mine.r.tickets).toEqual([]);
    expect(mine.r.unassigned!.tickets.map((t) => t.id)).toEqual(["j-open-nobody"]);
    const ted = await run(MANAGER, TECH);
    expect(ted.r.tickets.map((t) => t.id)).toEqual(["j-sched-ted"]);
    // The manager still has the Done queue (not Ted's work: the office's), nowhere else.
    expect(ted.where("ticket:j-done-ted")).toEqual(["authorize"]);
    const tech = await run(TECH);
    expect(tech.r.unassigned).toBeNull();
    expect(tech.r.tickets.map((t) => t.id)).toEqual(["j-sched-ted"]);
    expect(tech.where("ticket:j-done-nobody")).toEqual([]);
    expect(tech.where("ticket:j-done-ted")).toEqual([]);
  });
  it("the queries, pinned", () => {
    const fn = read("src/lib/my-work.functions.ts");
    const unassigned = fn.slice(fn.indexOf("const uTickets ="), fn.indexOf("const uOpps ="));
    expect(unassigned).toContain('.in("stage", [...UNASSIGNED_TICKET_STAGES])');
    expect(unassigned).toContain('.is("technician_id", null)');
    expect(unassigned).not.toContain("WORK_TICKET_STAGES");
    // The listed tickets: Open / Scheduled (WORK_TICKET_STAGES); no Done query of any kind.
    const listed = fn.slice(fn.indexOf("let tq ="), fn.indexOf("let kq ="));
    expect(listed).toContain('.in("stage", [...WORK_TICKET_STAGES])');
    expect(listed).not.toContain('.eq("stage", "done")');
    expect(fn).not.toContain("const dq =");
    expect(fn).not.toContain("doneNobody");
    expect(fn).toContain("tickets: (tickets.data ?? []) as TicketIn[],");
  });
});
