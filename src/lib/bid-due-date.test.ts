/**
 * The bid due date (owner, Oct 12): "at the origination of bids we should have a bid due date
 * required so we can also have those show on this week, overdue, etc" on Work Overview.
 *
 *  1. bids.due_date (20261012140000_bid_due_date.sql): nullable in the database, required by the
 *     app on a NEW bid (the estimator's first save, the one that inserts the row), changeable any
 *     time after, cleared only on a won / lost bid; a bid from before due dates existed saves
 *     without one. One rule (bid-status.ts bidDueDateProblem) for the estimator and saveBid.
 *  2. The estimator: a "Bid due" date box beside Status in the bid-total panel; the first save
 *     without it refuses with "Give the bid a due date before saving", rings and focuses the box;
 *     an older bid without one shows the amber hint.
 *  3. The Bids page: the Due day on every row, red "Overdue N days" on a draft past it, a
 *     "Due date, soonest first" sort.
 *  4. Work Overview: draft bids as kind "bid" by due date — Overdue / This week / Later, never
 *     Unassigned / Needs authorization / to-invoice; a submitted / won / lost bid never listed;
 *     only for callers with Estimate access; Mine / one person = the drafts they started, Everyone
 *     = every draft. The Owner view counts them too (owner, later Oct 12): a draft due today is a
 *     Due today bid, one past its due date is Overdue, one with no due date is nowhere.
 *
 * The real server functions run against the in-memory stand-in (src/test/fake-supabase.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import {
  BID_DUE_KEEP,
  BID_DUE_REQUIRED,
  BID_NO_DUE_HINT,
  bidDueDateProblem,
} from "@/lib/bid-status";
import { saveBid } from "@/lib/bids.functions";
import {
  BUCKET_HELP,
  KIND_LABELS,
  bidItem,
  bidItems,
  bucketOf,
  compareWork,
  groupWork,
  itemsByDay,
  listBucketOf,
  mergeWork,
  opportunityItem,
  taskItem,
  type BidIn,
  type WorkItem,
} from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { bucketCounts, detailGroups } from "@/lib/owner-view";
import { bidOverdueDays, isOverdueBid } from "@/lib/work-counts";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

const TODAY = "2026-10-12"; // a Monday; the week ends Saturday Oct 17
const EST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // Estimate only
const EST2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // another estimator
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // technician-only: no Estimate
const BID = "33333333-3333-4333-8333-333333333333";
const ACC = "55555555-5555-4555-8555-555555555555";

const estimator = {
  id: EST,
  role: "user",
  access: ["estimate"],
  technician: false,
  full_name: "Eve Estimator",
  email: "eve@example.com",
};
const estimator2 = { ...estimator, id: EST2, full_name: "Ed Estimator", email: "ed@example.com" };
const manager = { ...estimator, id: MGR, role: "manager", access: [], full_name: "Mo Manager" };
const tech = {
  ...estimator,
  id: TECH,
  access: ["service"],
  technician: true,
  full_name: "Tim Tech",
  email: "tim@example.com",
};

// ---------------------------------------------------------------------------------------------

describe("1. the column", () => {
  const sql = flatSql("supabase/migrations/20261012140000_bid_due_date.sql");
  it("the migration adds bids.due_date (date, nullable), its comment and the (status, due_date) index, idempotently", () => {
    expect(sql).toContain("alter table public.bids add column if not exists due_date date;");
    expect(sql).toContain(
      "comment on column public.bids.due_date is 'When the bid must go out (owner, Oct 12): required by the app on a new bid; draft bids show on Work Overview by this day';",
    );
    expect(sql).toContain(
      "create index if not exists bids_status_due_date_idx on public.bids (status, due_date);",
    );
    expect(sql).not.toMatch(/due_date date not null/);
  });
  it("the generated types carry it on the bids Row / Insert / Update", () => {
    const types = read("src/integrations/supabase/types.ts");
    const bids = types.slice(types.indexOf("      bids: {\n        Row: {"));
    const block = bids.slice(0, bids.indexOf("        Relationships: ["));
    expect(block).toContain("due_date: string | null;");
    expect(block.match(/due_date\?: string \| null;/g)).toHaveLength(2);
  });
});

describe("1. the rule (bidDueDateProblem)", () => {
  it("a new bid needs a day; with one it may go", () => {
    expect(bidDueDateProblem({ isNew: true, dueDate: null, status: "draft" })).toBe(
      BID_DUE_REQUIRED,
    );
    expect(bidDueDateProblem({ isNew: true, dueDate: "", status: "draft" })).toBe(BID_DUE_REQUIRED);
    expect(bidDueDateProblem({ isNew: true, dueDate: undefined, status: "draft" })).toBe(
      BID_DUE_REQUIRED,
    );
    expect(bidDueDateProblem({ isNew: true, dueDate: "2026-10-20", status: "draft" })).toBeNull();
    expect(BID_DUE_REQUIRED).toBe("Give the bid a due date before saving");
  });
  it("an existing bid: leave as is, change any time; a bid that never had one is not held up", () => {
    expect(bidDueDateProblem({ isNew: false, dueDate: undefined, status: "draft" })).toBeNull();
    expect(
      bidDueDateProblem({ isNew: false, dueDate: "2026-11-01", status: "draft", hadDueDate: true }),
    ).toBeNull();
    expect(
      bidDueDateProblem({ isNew: false, dueDate: null, status: "draft", hadDueDate: false }),
    ).toBeNull();
    expect(
      bidDueDateProblem({ isNew: false, dueDate: null, status: "submitted", hadDueDate: false }),
    ).toBeNull();
  });
  it("clearing a date is only for a won / lost bid", () => {
    for (const status of ["draft", "submitted"])
      expect(bidDueDateProblem({ isNew: false, dueDate: null, status, hadDueDate: true })).toBe(
        BID_DUE_KEEP,
      );
    for (const status of ["won", "lost"])
      expect(
        bidDueDateProblem({ isNew: false, dueDate: null, status, hadDueDate: true }),
      ).toBeNull();
  });
  it("a day must be YYYY-MM-DD", () => {
    expect(bidDueDateProblem({ isNew: true, dueDate: "10/20/2026", status: "draft" })).toMatch(
      /YYYY-MM-DD/,
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("1. saveBid (the server)", () => {
  let env: ReturnType<typeof fakeSupabase>;
  const existing = (over: Row = {}): Row => ({
    id: BID,
    name: "Gym reroof bid",
    status: "draft",
    grand_total: 48250,
    data: {},
    lost_reason: null,
    opportunity_id: null,
    submitted_at: null,
    status_changed_at: null,
    deleted_at: null,
    due_date: null,
    account_id: ACC,
    created_by: EST,
    updated_at: "2026-10-10T12:00:00Z",
    created_at: "2026-10-01T12:00:00Z",
    ...over,
  });
  const setup = (bid: Row = {}) => {
    env = fakeSupabase({
      profiles: [estimator, manager],
      bids: [existing(bid)],
      bid_locks: [],
      crm_opportunities: [],
      crm_followups: [],
      crm_accounts: [{ id: ACC, name: "Bell County Schools" }],
    });
  };
  const save = (data: Row, userId = EST) =>
    (saveBid as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
      data,
      context: { supabase: env.db, userId },
    });
  const base = { name: "New bid", data: {}, grandTotal: 100, status: "draft" };
  const bidWrites = () => env.writes.filter((w) => w.table === "bids");
  const row = () => env.tables["bids"]!.find((r) => r["id"] === BID)!;

  beforeEach(() => setup());

  it("refuses a NEW bid without a due date, writing nothing; one with it is inserted with the day", async () => {
    await expect(save(base)).rejects.toThrow(BID_DUE_REQUIRED);
    await expect(save({ ...base, dueDate: null })).rejects.toThrow(BID_DUE_REQUIRED);
    expect(bidWrites()).toEqual([]);
    const made = await save({ ...base, dueDate: "2026-10-20" });
    expect(made["due_date"]).toBe("2026-10-20");
    expect(made["status"]).toBe("draft");
    expect(bidWrites()).toHaveLength(1);
    expect(bidWrites()[0]!.payload!["due_date"]).toBe("2026-10-20");
  });
  it("the schema takes YYYY-MM-DD only", () => {
    // The validator runs before the handler (synchronously in the stand-in).
    expect(() => save({ ...base, dueDate: "Oct 20" })).toThrow(/YYYY-MM-DD/);
    expect(bidWrites()).toEqual([]);
  });
  it("an existing bid from before due dates saves without one (absent or null); a day sets it", async () => {
    await save({ ...base, id: BID });
    expect(row()["due_date"]).toBeNull();
    await save({ ...base, id: BID, dueDate: null });
    expect(row()["due_date"]).toBeNull();
    await save({ ...base, id: BID, dueDate: "2026-10-25" });
    expect(row()["due_date"]).toBe("2026-10-25");
    // Changed again any time.
    await save({ ...base, id: BID, dueDate: "2026-10-30" });
    expect(row()["due_date"]).toBe("2026-10-30");
  });
  it("clearing the date is refused on a draft / submitted bid and allowed once won / lost", async () => {
    setup({ due_date: "2026-10-20" });
    await expect(save({ ...base, id: BID, dueDate: null })).rejects.toThrow(BID_DUE_KEEP);
    await expect(save({ ...base, id: BID, status: "submitted", dueDate: null })).rejects.toThrow(
      BID_DUE_KEEP,
    );
    expect(row()["due_date"]).toBe("2026-10-20");
    // Leaving it out leaves it alone.
    await save({ ...base, id: BID });
    expect(row()["due_date"]).toBe("2026-10-20");
    setup({ due_date: "2026-10-20", status: "won" });
    await save({ ...base, id: BID, status: "won", dueDate: null });
    expect(row()["due_date"]).toBeNull();
    setup({ due_date: "2026-10-20", status: "lost" });
    await save({ ...base, id: BID, status: "lost", lostReason: "Price", dueDate: null });
    expect(row()["due_date"]).toBeNull();
  });
  it("the server reads the row's due_date for the rule and keeps the other save behaviour", () => {
    const fn = read("src/lib/bids.functions.ts");
    expect(fn).toContain('.select("updated_at, updated_by_name, status, submitted_at, due_date")');
    expect(fn).toMatch(/dueDate: z\s*\.string\(\)\s*\.regex\(/);
    expect(fn).toContain("...(data.dueDate !== undefined ? { due_date: data.dueDate } : {}),");
    expect(fn.match(/bidDueDateProblem\(\{/g)).toHaveLength(2);
    // The status sync to the opportunity is untouched.
    expect(fn).toContain("if (statusChanged) await syncOpportunityFromBid(context, bid.id);");
  });
});

// ---------------------------------------------------------------------------------------------

describe("2. the estimator", () => {
  const src = read("src/routes/estimate.tsx");
  it("a Bid due date box sits in the bid-total panel, right before Status, bound to the row's due_date", () => {
    const panel = src.slice(src.indexOf('<div id="bid-total-panel"'));
    const box = panel.indexOf('data-field="bid-due"');
    const status = panel.indexOf('<Label className="text-xs">Status</Label>');
    expect(box).toBeGreaterThan(-1);
    expect(box).toBeLessThan(status);
    const boxSrc = panel.slice(box, status);
    expect(boxSrc).toContain(">\n              Bid due\n            </Label>");
    expect(boxSrc).toContain('id="bid-due-date"');
    expect(boxSrc).toContain("ref={dueDateRef}");
    expect(boxSrc).toContain('type="date"');
    expect(boxSrc).toContain("value={bidDueDate}");
    expect(boxSrc).toContain("disabled={readOnly}");
    // Not the data blob: the row's column, loaded with the bid and sent on every save.
    expect(src).toContain('setBidDueDate(loadedBid.due_date ?? "");');
    expect(src).toContain("dueDate: bidDueDate || null,");
    expect(src).not.toMatch(/dueDate:\s*saved\./);
  });
  it("the first save without one is refused with the plain message, the box ringed and focused", () => {
    const save = src.slice(
      src.indexOf("const handleSave = async"),
      src.indexOf("setSaving(true);"),
    );
    expect(save).toContain("isNew: !bidId,");
    expect(save).toContain("dueDate: bidDueDate || null,");
    expect(save).toContain("hadDueDate: !!loadedBid?.due_date,");
    expect(save).toContain("setDueDateMissing(true);");
    expect(save).toContain("toast.error(dueProblem);");
    expect(save).toContain("dueDateRef.current?.focus();");
    expect(save).toContain("return false;");
    expect(src).toContain(
      'className={`h-9 w-[9.5rem] ${dueDateMissing ? "border-destructive ring-2 ring-destructive/40" : ""}`}',
    );
    expect(src).toContain("Give the bid a due date before saving");
    expect(src).toContain("aria-invalid={dueDateMissing || undefined}");
  });
  it("an existing bid without a date gets the amber hint (token-paired for dark mode), not a block", () => {
    expect(BID_NO_DUE_HINT).toBe(
      "No due date — it will not show on Work Overview until one is set",
    );
    expect(src).toMatch(
      /bidId &&\s*!bidDueDate && \(\s*<p id="bid-due-hint" className="text-\[11px\] text-amber-700 dark:text-amber-400">\s*\{BID_NO_DUE_HINT\}/,
    );
  });
  it("a bid started fresh (combine, takeoff, PlanSwift) starts with no due date", () => {
    expect(src.match(/setBidDueDate\(""\);/g)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------

describe("3. the Bids page", () => {
  it("isOverdueBid / bidOverdueDays: a draft past its due date, never any other status", () => {
    expect(isOverdueBid({ status: "draft", due_date: "2026-10-10" }, TODAY)).toBe(true);
    expect(bidOverdueDays({ status: "draft", due_date: "2026-10-10" }, TODAY)).toBe(2);
    expect(bidOverdueDays({ status: "draft", due_date: TODAY }, TODAY)).toBeNull();
    expect(bidOverdueDays({ status: "draft", due_date: null }, TODAY)).toBeNull();
    for (const status of ["submitted", "won", "lost"])
      expect(bidOverdueDays({ status, due_date: "2026-10-01" }, TODAY)).toBeNull();
    // A legacy status folds in (in_progress → draft).
    expect(bidOverdueDays({ status: "in_progress", due_date: "2026-10-11" }, TODAY)).toBe(1);
  });
  it("every row shows its Due day, red Overdue N days on a late draft, and the list sorts by due date", () => {
    const src = read("src/routes/bids.tsx");
    expect(src).toContain('import { bidOverdueDays } from "@/lib/work-counts";');
    expect(src).toContain("const overdueDays = bidOverdueDays(bid, today);");
    expect(src).toContain('data-col="due"');
    expect(src).toContain("Due {dueLabel(bid.due_date)}");
    expect(src).toContain('"No due date"');
    expect(src).toMatch(
      /className="mt-0.5 block font-semibold text-destructive" data-line="overdue">\s*Overdue \{overdueDays\} day\{overdueDays === 1 \? "" : "s"\}/,
    );
    expect(src).toContain('due: "Due date, soonest first",');
    expect(src).toContain('case "due": {');
    // The day is the viewer's, as on Work Overview.
    expect(src).toContain("const today = localYmd(new Date());");
  });
});

// ---------------------------------------------------------------------------------------------

const bid = (over: Partial<BidIn> = {}): BidIn => ({
  id: BID,
  name: "Gym reroof bid",
  status: "draft",
  due_date: "2026-10-15",
  account_name: "Bell County Schools",
  created_by: EST,
  ...over,
});

describe("4. Work Overview — the item (pure)", () => {
  it("a draft bid is a Bid row: its name, customer, due day, Draft, the estimator link, its maker", () => {
    expect(KIND_LABELS.bid).toBe("Bid");
    expect(bidItem(bid(), { [EST]: "Eve Estimator" })).toEqual<WorkItem>({
      key: `bid:${BID}`,
      kind: "bid",
      title: "Gym reroof bid",
      where: "Bell County Schools",
      date: "2026-10-15",
      status: "Draft",
      done: false,
      href: `/estimate?bid=${BID}`,
      assigneeId: EST,
      assigneeName: "Eve Estimator",
      followup: null,
    });
    expect(bidItem(bid({ account_name: null, created_by: null }))).toMatchObject({
      where: null,
      assigneeId: null,
      assigneeName: null,
    });
  });
  it("sits under Overdue / This week / Later by its due day; no day → Later; never the other groups", () => {
    const at = (due: string | null) => bucketOf(bidItem(bid({ due_date: due }))!, TODAY);
    expect(at("2026-10-11")).toBe("overdue");
    expect(at(TODAY)).toBe("today");
    expect(listBucketOf(bidItem(bid({ due_date: TODAY }))!, TODAY)).toBe("week");
    expect(at("2026-10-17")).toBe("week");
    expect(at("2026-10-18")).toBe("later");
    expect(at(null)).toBe("later");
    const item = bidItem(bid())!;
    expect(item.unassigned).toBeUndefined();
    expect(item.needsAuth).toBeUndefined();
    expect(item.toInvoice).toBeUndefined();
    const buckets = groupWork(
      [bidItem(bid({ due_date: "2026-10-01" }))!, bidItem(bid({ id: "b2", due_date: null }))!],
      TODAY,
    ).map((g) => g.bucket);
    expect(buckets).toEqual(["overdue", "later"]);
  });
  it("only a draft: a submitted / won / lost bid is no item at all", () => {
    for (const status of ["submitted", "won", "lost"]) expect(bidItem(bid({ status }))).toBeNull();
    expect(
      bidItems([bid(), bid({ id: "b2", status: "won" }), bid({ id: "b3", status: "lost" })]),
    ).toHaveLength(1);
    expect(bidItems(null)).toEqual([]);
  });
  it("mergeWork lists the server's bids with everything else, dated order, bids last on a day", () => {
    const rows = mergeWork({
      tickets: [],
      tasks: [
        {
          id: "k1",
          title: "Call back",
          due_date: "2026-10-15",
          status: "open",
          building_id: null,
          assignee: EST,
          assignee_name: "Eve",
        },
      ],
      followups: [],
      names: { [EST]: "Eve Estimator" },
      bids: [bid(), bid({ id: "b2", status: "submitted" })],
    });
    expect(rows.map((r) => r.key)).toEqual(["task:k1", `bid:${BID}`]);
    expect(rows[1]!.assigneeName).toBe("Eve Estimator");
    expect(compareWork(bidItem(bid())!, taskItem(rows[0]! as never))).toBeGreaterThan(0);
    expect(
      compareWork(
        bidItem(bid())!,
        opportunityItem({ id: "o", title: "x", status: "open", expected_close: "2026-10-15" }),
      ),
    ).toBeGreaterThan(0);
    // Without the rows (a caller without Estimate access) nothing changes.
    expect(mergeWork({ tickets: [], tasks: [], followups: [] })).toEqual([]);
  });
  it("the calendar maps a bid onto its due day like any dated item", () => {
    const by = itemsByDay([bidItem(bid())!, bidItem(bid({ id: "b2", due_date: null }))!]);
    expect(by.get("2026-10-15")?.map((i) => i.key)).toEqual([`bid:${BID}`]);
    expect([...by.keys()]).toEqual(["2026-10-15"]);
  });
  it("the column help names draft bids where it lists what sits in a group", () => {
    expect(BUCKET_HELP.overdue).toBe(
      "Scheduled tickets whose day has passed, opportunities past their expected close, and draft bids past their due date. The assignee is reminded on the Reminders schedule.",
    );
    expect(BUCKET_HELP.week).toBe("Tickets, tasks, follow-ups and draft bids due later this week.");
    expect(BUCKET_HELP.later).toBe(
      "Due after this week, or with no date yet (a bid without a due date too).",
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("4. Work Overview — listMyWork (the server)", () => {
  const bidRow = (over: Row = {}): Row => ({
    id: BID,
    name: "Gym reroof bid",
    status: "draft",
    due_date: "2026-10-15",
    account_id: ACC,
    created_by: EST,
    deleted_at: null,
    ...over,
  });
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      profiles: [estimator, estimator2, manager, tech],
      service_jobs: [],
      tasks: [],
      crm_followups: [],
      crm_opportunities: [],
      crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
      crm_accounts: [{ id: ACC, name: "Bell County Schools" }],
      bids: [
        bidRow(),
        bidRow({ id: "b-ed", name: "Ed's bid", created_by: EST2, due_date: "2026-10-01" }),
        bidRow({ id: "b-nobody", name: "Imported bid", created_by: null, due_date: null }),
        bidRow({ id: "b-sub", name: "Submitted bid", status: "submitted" }),
        bidRow({ id: "b-won", name: "Won bid", status: "won" }),
        bidRow({ id: "b-gone", name: "Deleted bid", deleted_at: "2026-10-11T00:00:00Z" }),
      ],
    };
  });
  const run = (userId: string, who?: string) =>
    (listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>)({
      data: who ? { who } : {},
      context: { supabase: fakeSupabase(tables).db, userId },
    });

  it("Mine: an estimator gets the drafts they started, with the customer's name; nothing else", async () => {
    const r = await run(EST);
    expect(r.bids).toEqual([
      {
        id: BID,
        name: "Gym reroof bid",
        status: "draft",
        due_date: "2026-10-15",
        account_name: "Bell County Schools",
        created_by: EST,
      },
    ]);
    // Their `who` is ignored (a plain user sees their own): still theirs.
    expect((await run(EST, "all")).bids.map((b) => b.id)).toEqual([BID]);
    expect((await run(EST, EST2)).bids.map((b) => b.id)).toEqual([BID]);
  });
  it("Everyone: a manager gets every draft (a maker-less one too); one person: that person's", async () => {
    // The page asks "all" for a manager by default (resolveWho); bare `who` is their own.
    const all = await run(MGR, "all");
    expect(all.bids.map((b) => b.id).sort()).toEqual(["b-ed", "b-nobody", BID].sort());
    expect(all.bids.map((b) => b.status)).toEqual(["draft", "draft", "draft"]);
    expect((await run(MGR, EST2)).bids.map((b) => b.id)).toEqual(["b-ed"]);
    expect((await run(MGR, "mine")).bids).toEqual([]);
  });
  it("no Estimate access, no bids (a technician gets [])", async () => {
    const r = await run(TECH);
    expect(r.bids).toEqual([]);
    const mine = await run(TECH, "all");
    expect(mine.bids).toEqual([]);
  });
  it("rows become Bid items that open the estimator; names come from the roster", async () => {
    const r = await run(MGR, "all");
    const items = mergeWork(r);
    const mine = items.find((i) => i.key === `bid:${BID}`)!;
    expect(mine).toMatchObject({
      kind: "bid",
      title: "Gym reroof bid",
      where: "Bell County Schools",
      href: `/estimate?bid=${BID}`,
      status: "Draft",
      assigneeName: "Eve Estimator",
    });
    expect(
      bucketOf(
        items.find((i) => i.key === "bid:b-ed")!,
        TODAY,
      ),
    ).toBe("overdue");
    expect(
      bucketOf(
        items.find((i) => i.key === "bid:b-nobody")!,
        TODAY,
      ),
    ).toBe("later");
    expect(items.map((i) => i.key)).not.toContain("bid:b-sub");
  });
  it("the query: drafts, not deleted, by due date, gated on Estimate access", () => {
    const fn = read("src/lib/my-work.functions.ts");
    expect(fn).toContain('const estimator = canAccess(me, "estimate");');
    const q = fn.slice(fn.indexOf("const estimator = canAccess"), fn.indexOf("const bRows ="));
    expect(q).toContain('.from("bids")');
    expect(q).toContain('.select("id, name, status, due_date, account_id, created_by")');
    expect(q).toContain('.is("deleted_at", null)');
    expect(q).toContain('.eq("status", "draft")');
    expect(q).toContain('.order("due_date", { ascending: true, nullsFirst: false })');
    expect(fn).toContain('if (bq && scope !== "all") bq = bq.in("created_by", scope);');
  });
});

// ---------------------------------------------------------------------------------------------

describe("4. the page and the Owner view", () => {
  it("the Bid chip has its own colour (sky) in the kind palette, dot and calendar bar, dark-paired", () => {
    const page = read("src/components/my-work-page.tsx");
    const cls = page.slice(page.indexOf("const KIND_CLASS"), page.indexOf("const KIND_DOT"));
    expect(cls).toContain(
      'bid: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",',
    );
    expect(cls).not.toMatch(/bid:[^\n]*rose/);
    const dot = page.slice(page.indexOf("const KIND_DOT"), page.indexOf("const KIND_BAR"));
    expect(dot).toContain('bid: "bg-sky-500",');
    const bar = page.slice(page.indexOf("const KIND_BAR"), page.indexOf("const GRID_COLS"));
    expect(bar).toContain('bid: "border-l-sky-500",');
    // The row's chip reads the label table, so "Bid" shows without a special case.
    expect(page).toContain("{KIND_LABELS[item.kind]}");
    expect(read("src/components/owner-view.tsx")).toMatch(/bid:\s*"border-sky-300[^"]*dark:/);
  });
  it("the Owner view counts draft bids (owner, later Oct 12): Due today / Overdue and the detail groups", () => {
    const late = bidItem(bid({ due_date: "2026-10-01" }))!;
    const due = bidItem(bid({ id: "b2", due_date: TODAY }))!;
    const undated = bidItem(bid({ id: "b3", due_date: null }))!;
    expect(bucketCounts([late, due, undated], TODAY)).toEqual({
      [EST]: { today: { tickets: 0, tasks: 0, followups: 0, bids: 1 }, overdue: 1 },
    });
    const task = taskItem({
      id: "k1",
      title: "Call",
      due_date: TODAY,
      status: "open",
      building_id: null,
      assignee: EST,
      assignee_name: null,
    });
    expect(bucketCounts([late, due, undated, task], TODAY)[EST]).toEqual({
      today: { tickets: 0, tasks: 1, followups: 0, bids: 1 },
      overdue: 1,
    });
    // The detail lists the same items, tasks before bids on a day; the undated one is nowhere.
    const groups = detailGroups(EST, [late, due, undated, task], [], TODAY);
    expect(groups.today.map((i) => i.key)).toEqual(["task:k1", "bid:b2"]);
    expect(groups.today[1]).toMatchObject({ kind: "bid", href: "/estimate?bid=b2" });
    expect(groups.overdue.map((i) => i.key)).toEqual([`bid:${BID}`]);
    // And its server function loads them (owner-view.test.ts runs it against the fake client).
    expect(read("src/lib/owner-view.functions.ts")).toContain('from("bids")');
  });
});
