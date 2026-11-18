/**
 * One set of alert lines for every kind of work (owner, Nov 18: "its still a bit confusing. can
 * you make a standardized version for each type opp, bid, service ticket etc. where you can
 * select multiple people from a dropdown on who gets alerted and the frequency in days"; then, of
 * the drawing with one card per type: "i like idea 1, and yes skip working days and make a note
 * that shows that, nobody on it should send alerts too. each step line should be able to be
 * turned on for opps and bids too but defaulted off for now").
 *
 * What is checked here:
 *  - the rules (alert-rules.ts): the lines each type has, who each line tells before anyone
 *    edits it, how a saved list is read, which line a reminder belongs to, when it waits for
 *    Monday, and the "nobody is on it" clock;
 *  - the real reminder pass (notify.server.ts) against an in-memory stand-in for the database: a
 *    reminder goes to everyone its line lists, says whose work it is to the others, and nobody
 *    is told twice in one day about one item; opportunities and the review timer count working
 *    days; the new "nobody is on it" alerts with their claim;
 *  - the bid notices going to their lines' lists;
 *  - "Each step" for opportunities and bids: silent until someone picks people;
 *  - the page, the save, the bell's labels and the database change.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readGeneratedTypes } from "@/test/generated-types";

import {
  ALERT_KEYS,
  ALERT_LINES,
  ALERT_NUMBER_DEFAULTS,
  LINE_LABELS,
  TYPE_TITLES,
  WHO_MAX,
  WORKING_DAYS_NOTE,
  alertKey,
  alertNumbers,
  assigneeLabel,
  defaultWho,
  isPersonToken,
  lineHasAssignee,
  nobodyAlertDue,
  nobodyFlagged,
  nobodyNotice,
  opportunityUntouchedNotice,
  parseAlertWho,
  reminderKey,
  reminderWaits,
  resolveWho,
  reviewReminderNotice,
  whoSummary,
} from "@/lib/alert-rules";
import { settingsSchema } from "@/lib/followups.functions";
import { flagUnassigned, type WorkItem } from "@/lib/my-work";
import { KIND_CATEGORIES, noticeCategory } from "@/lib/notice-categories";
import { KIND_LABEL_ORDER, kindLabel } from "@/lib/notifications.functions";
import {
  BID_WATCH_KIND,
  OPPORTUNITY_WATCH_KIND,
  bidStepNotice,
  opportunityStepNotice,
} from "@/lib/work-steps";
import { reminderMorning } from "@/lib/working-days";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Tables = Record<string, Row[]>;
interface FakeOpts {
  rpc?: (name: string, args: Row | undefined) => Result | undefined;
  /** A table whose reads and writes throw. */
  broken?: string;
  /** Runs after a select on `table` has read its rows and before the caller gets them. */
  afterRead?: (table: string) => void;
}

/** A small in-memory PostgREST: select / insert / update with eq, lte, in, is, order, limit. */
function fakeSupabase(db: Tables, opts: FakeOpts = {}) {
  let nextId = 1;
  const from = (table: string) => {
    if (opts.broken === table) throw new Error(`${table} is down`);
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    let returning = false;
    let orderBy: string | null = null;
    let max = Infinity;
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (db[table] ??= []);
    const exec = async (): Promise<Result> => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const added = list.map((r) => ({
          id: nextId++,
          created_at: new Date().toISOString(),
          ...r,
        }));
        rows().push(...added);
        return { data: returning ? added.map((r) => ({ ...r })) : null, error: null };
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      let out = hit.map((r) => ({ ...r }));
      if (orderBy) {
        const k = orderBy;
        out.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      }
      out = out.slice(0, max);
      opts.afterRead?.(table);
      return { data: out, error: null };
    };
    const q = {
      select: () => {
        if (op !== "select") returning = true;
        return q;
      },
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      lte: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) <= v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      order: (c: string) => ((orderBy = c), q),
      limit: (n: number) => ((max = n), q),
      maybeSingle: async () => {
        const r = await exec();
        return { data: ((r.data as Row[] | null) ?? [])[0] ?? null, error: r.error };
      },
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return q;
  };
  const rpc = async (name: string, args?: Row): Promise<Result> => {
    const custom = opts.rpc?.(name, args);
    if (custom) return custom;
    if (name === "notify_recipients") {
      const ids = (args?.["ids"] ?? []) as string[];
      return {
        data: ids.map((id) => ({
          id,
          email: `${id}@example.test`,
          full_name: id,
          notify_email: false,
          notify_push: false,
        })),
        error: null,
      };
    }
    if (name === "crm_untouched") return { data: [], error: null };
    return { data: null, error: null };
  };
  return { from, rpc };
}

// The server-key client the pass and notify() load: a stand-in that forwards to the fake of the
// test in progress.
const holder = vi.hoisted(() => ({ current: null as null | ReturnType<typeof fakeSupabase> }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => holder.current!.from(t),
    rpc: (n: string, a?: Row) => holder.current!.rpc(n, a),
  },
}));

import { alertContext, notToldToday, watchersFor } from "@/lib/alert-who.server";
import { dispatchBidDueNotices } from "@/lib/bids-notify.server";
import { dispatchDueReminders, type Client } from "@/lib/notify.server";
import { tellStep } from "@/lib/work-steps.server";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

// November 2026: Fri 13, Mon 16, Tue 17, Wed 18, Thu 19, Fri 20, Sat 21, Sun 22, Mon 23.
const at8 = (ymd: string) => reminderMorning(ymd).toISOString();
/** 9 am in the office (America/New_York) on that day, winter time. */
const morning = (ymd: string) => new Date(`${ymd}T14:00:00Z`);

const BOSS = "boss-1";
const MGR = "mgr-1";
const TECH = "tech-1";
/** A person picked by name on a line: lists hold people's ids. */
const ANN = "11111111-2222-4333-8444-555555555555";
const JOB = "job-1";
const OPP = "opp-1";
const people = (): Row[] => [
  { id: BOSS, role: "admin", full_name: "Boss One", email: "" },
  { id: MGR, role: "manager", full_name: "Mia Manager", email: "" },
  { id: TECH, role: "user", full_name: "Tech One", email: "" },
  { id: ANN, role: "user", full_name: "Ann Office", email: "" },
];
const settings = (over: Row = {}): Row => ({
  id: 1,
  ticket_every_days: 3,
  opportunity_every_days: 7,
  ticket_before_every_days: 3,
  ticket_due_notice_days: 1,
  ticket_untouched_days: 2,
  opportunity_untouched_days: 3,
  unassigned_overdue_days: 1,
  ...over,
});
const timer = (over: Row = {}): Row => ({
  id: "f1",
  kind: "ticket",
  item_id: JOB,
  account_id: null,
  assignee_id: TECH,
  title: "Ticket #6090 Acme",
  url: `/service?id=${JOB}`,
  due_at: at8("2026-11-10"),
  next_remind_at: at8("2026-11-18"),
  created_at: "2026-11-06T15:00:00.000Z",
  every_days: 3,
  reminders_sent: 1,
  last_reminded_at: at8("2026-11-13"),
  status: "open",
  snoozed_until: null,
  hold_reason: null,
  dispatch_errors: 0,
  last_dispatch_error: null,
  ...over,
});

function connect(db: Tables, opts?: FakeOpts): Client {
  holder.current = fakeSupabase(db, opts);
  return holder.current as unknown as Client;
}
const inbox = (db: Tables, kind?: string) =>
  (db["notifications"] ?? []).filter((n) => !kind || n["kind"] === kind);
const toldTo = (db: Tables, kind?: string) =>
  inbox(db, kind)
    .map((n) => String(n["user_id"]))
    .sort();

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("RESEND_API_KEY", "");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

// ---------------------------------------------------------------------------------------------

describe("the rules: the same lines for every kind of work", () => {
  it("each type's lines, in the order its card shows them", () => {
    expect(ALERT_LINES).toEqual({
      ticket: ["coming_up", "past_due", "not_started", "nobody", "review", "steps"],
      opportunity: ["coming_up", "past_due", "not_started", "nobody", "steps"],
      bid: ["coming_up", "past_due", "steps"],
    });
    // Every line of every card has a key, and there are no others.
    const fromCards = (Object.keys(ALERT_LINES) as (keyof typeof ALERT_LINES)[]).flatMap((t) =>
      ALERT_LINES[t].map((l) => alertKey(t, l)),
    );
    expect([...fromCards].sort()).toEqual([...ALERT_KEYS].sort());
    expect(ALERT_KEYS).toHaveLength(14);
    expect(TYPE_TITLES).toEqual({
      ticket: "Service tickets",
      opportunity: "Opportunities",
      bid: "Bids",
    });
    expect(LINE_LABELS).toEqual({
      coming_up: "Coming up",
      past_due: "Past due",
      not_started: "Not started",
      nobody: "Nobody on it",
      review: "Done, waiting",
      steps: "Each step",
    });
  });
  it("the note says working days, in plain words", () => {
    expect(WORKING_DAYS_NOTE).toBe(
      "Days are working days. Saturdays and Sundays are not counted, and no alert is sent on one, except a reminder on the item's own date.",
    );
  });
  it("before anyone edits a line it tells exactly who was told before, plus the two new lines", () => {
    const who = defaultWho(null);
    // The reminders: the person assigned.
    for (const k of [
      "ticket.coming_up",
      "ticket.past_due",
      "ticket.review",
      "opportunity.coming_up",
      "opportunity.past_due",
      "bid.coming_up",
      "bid.past_due",
    ] as const)
      expect(who[k]).toEqual(["assignee"]);
    // Not started: the old "Also tell" list (every admin and manager).
    expect(who["ticket.not_started"]).toEqual(["admins", "managers"]);
    expect(who["opportunity.not_started"]).toEqual(["admins", "managers"]);
    // New and on (owner: "nobody on it should send alerts too").
    expect(who["ticket.nobody"]).toEqual(["admins", "managers"]);
    expect(who["opportunity.nobody"]).toEqual(["admins", "managers"]);
    // Ticket steps as since Nov 17; opportunities and bids off (owner: "defaulted off for now").
    expect(who["ticket.steps"]).toEqual(["admins", "managers"]);
    expect(who["opportunity.steps"]).toEqual([]);
    expect(who["bid.steps"]).toEqual([]);
  });
  it("the old single list carries over to Not started: the admins switched off, people named", () => {
    const who = defaultWho({ escalate_to_admins: false, escalate_user_ids: [ANN] });
    expect(who["ticket.not_started"]).toEqual([ANN]);
    expect(who["opportunity.not_started"]).toEqual([ANN]);
    // Nothing else follows that list.
    expect(who["ticket.nobody"]).toEqual(["admins", "managers"]);
    const both = defaultWho({ escalate_to_admins: true, escalate_user_ids: [ANN, "not-an-id"] });
    expect(both["ticket.not_started"]).toEqual(["admins", "managers", ANN]);
  });
  it("a saved list is read whole: a line never saved keeps its default, a line saved empty is off", () => {
    const who = parseAlertWho({
      "ticket.past_due": ["assignee", "managers", ANN.toUpperCase(), ANN, "assignee"],
      "ticket.nobody": [],
      "bid.steps": ["admins", "assignee", "everyone", 7, null],
      "ticket.made_up": ["admins"],
    });
    // Once each; a person's id in lower case.
    expect(who["ticket.past_due"]).toEqual(["assignee", "managers", ANN]);
    // Saved empty: off, not back to the default.
    expect(who["ticket.nobody"]).toEqual([]);
    // "The person assigned" means nothing on a step line; junk is dropped.
    expect(who["bid.steps"]).toEqual(["admins"]);
    // Untouched lines: their defaults.
    expect(who["ticket.coming_up"]).toEqual(["assignee"]);
    expect(who["opportunity.steps"]).toEqual([]);
    expect(Object.keys(who).sort()).toEqual([...ALERT_KEYS].sort());
    // Nothing saved at all, or something that is not a set of lists: the defaults.
    for (const raw of [null, undefined, "admins", ["admins"], 4])
      expect(parseAlertWho(raw)).toEqual(defaultWho(null));
    // No list is longer than the limit.
    const many = Array.from(
      { length: WHO_MAX + 20 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(parseAlertWho({ "ticket.steps": many })["ticket.steps"]).toHaveLength(WHO_MAX);
  });
  it("who a line may name, and what the person assigned is called on it", () => {
    expect(lineHasAssignee("coming_up")).toBe(true);
    expect(lineHasAssignee("review")).toBe(true);
    expect(lineHasAssignee("nobody")).toBe(false);
    expect(lineHasAssignee("steps")).toBe(false);
    expect(assigneeLabel("ticket", "past_due")).toBe("The assigned technician");
    expect(assigneeLabel("ticket", "review")).toBe("The authorizer");
    expect(assigneeLabel("opportunity", "coming_up")).toBe("The person assigned");
    expect(assigneeLabel("bid", "coming_up")).toBe("Whoever started the bid");
    expect(isPersonToken(ANN)).toBe(true);
    expect(isPersonToken("admins")).toBe(false);
    expect(isPersonToken("boss-1")).toBe(false);
  });
  it("a list opens out into people, each once", () => {
    const all = people().map((p) => ({ id: String(p["id"]), role: String(p["role"]) }));
    expect(resolveWho(["assignee"], all, TECH)).toEqual([TECH]);
    expect(resolveWho(["assignee"], all, null)).toEqual([]);
    expect(resolveWho(["admins", "managers"], all, TECH).sort()).toEqual([BOSS, MGR]);
    // The manager is also named, and is the person on the work: still once.
    expect(resolveWho(["assignee", "managers", MGR], all, MGR)).toEqual([MGR]);
    // Someone picked who has since been removed is told nothing.
    expect(resolveWho([ANN, "99999999-2222-4333-8444-555555555555"], all, null)).toEqual([ANN]);
    expect(resolveWho([], all, TECH)).toEqual([]);
  });
  it("the dropdown's button says who, or that the line is off", () => {
    const names = new Map([[ANN, "Ann Office"]]);
    expect(whoSummary([], "ticket", "past_due", names)).toBe("Nobody (off)");
    expect(whoSummary(["assignee", "admins", "managers", ANN], "ticket", "past_due", names)).toBe(
      "The assigned technician, Every admin, Every manager, Ann Office",
    );
    expect(whoSummary(["assignee"], "bid", "coming_up", names)).toBe("Whoever started the bid");
    expect(whoSummary(["99999999-2222-4333-8444-555555555555"], "bid", "steps", names)).toBe(
      "Someone removed",
    );
  });
  it("the new day boxes: a missing column takes what the old page did; blank is off", () => {
    expect(ALERT_NUMBER_DEFAULTS).toEqual({
      opportunity_before_every_days: 7,
      opportunity_due_notice_days: null,
      ticket_review_every_days: 3,
      ticket_unassigned_every_days: 3,
      opportunity_unassigned_days: 1,
      opportunity_unassigned_every_days: 3,
    });
    // A database from before the change: opportunities at their one "every" number, the review
    // timer at the tickets' past-due number, both nobody-on-it limits at the one old limit.
    expect(
      alertNumbers({ opportunity_every_days: 5, ticket_every_days: 2, unassigned_overdue_days: 4 }),
    ).toEqual({
      opportunity_before_every_days: 5,
      opportunity_due_notice_days: null,
      ticket_review_every_days: 2,
      ticket_unassigned_every_days: 3,
      opportunity_unassigned_days: 4,
      opportunity_unassigned_every_days: 3,
    });
    expect(alertNumbers(null)).toEqual(ALERT_NUMBER_DEFAULTS);
    // Saved: a number stands; null (a blank box) is off; a bad number is off or the default.
    expect(
      alertNumbers({
        opportunity_before_every_days: null,
        opportunity_due_notice_days: 2,
        ticket_review_every_days: 5,
        ticket_unassigned_every_days: null,
        opportunity_unassigned_days: 0,
        opportunity_unassigned_every_days: 400,
      }),
    ).toEqual({
      opportunity_before_every_days: null,
      opportunity_due_notice_days: 2,
      ticket_review_every_days: 5,
      ticket_unassigned_every_days: null,
      opportunity_unassigned_days: 0,
      opportunity_unassigned_every_days: null,
    });
  });
  it("a reminder's line: Coming up on or before the date, Past due after it, Done waiting for the review timer", () => {
    expect(reminderKey("ticket", "2026-11-18", "2026-11-17")).toBe("ticket.coming_up");
    expect(reminderKey("ticket", "2026-11-18", "2026-11-18")).toBe("ticket.coming_up");
    expect(reminderKey("ticket", "2026-11-18", "2026-11-19")).toBe("ticket.past_due");
    expect(reminderKey("opportunity", "2026-11-18", "2026-11-17")).toBe("opportunity.coming_up");
    expect(reminderKey("opportunity", "2026-11-18", "2026-11-19")).toBe("opportunity.past_due");
    expect(reminderKey("invoice", "2026-11-18", "2026-11-30")).toBe("ticket.review");
  });
  it("nothing is sent on a Saturday or Sunday, except a reminder on the item's own date", () => {
    // A weekday: never waits.
    expect(reminderWaits("ticket", "2026-11-10", "2026-11-20")).toBe(false);
    for (const weekend of ["2026-11-21", "2026-11-22"]) {
      expect(reminderWaits("ticket", "2026-11-10", weekend)).toBe(true);
      expect(reminderWaits("opportunity", "2026-11-10", weekend)).toBe(true);
      // Its own date: it goes.
      expect(reminderWaits("ticket", weekend, weekend)).toBe(false);
      expect(reminderWaits("opportunity", weekend, weekend)).toBe(false);
      // The review timer has no date of its own.
      expect(reminderWaits("invoice", weekend, weekend)).toBe(true);
    }
  });
});

describe("nobody is on it: the clock", () => {
  const since = "2026-11-16"; // Monday
  it("the first alert after N working days, never on a weekend", () => {
    const first = (today: string, after: number) =>
      nobodyAlertDue({ since, last: null, today, after, every: 3 });
    expect(first("2026-11-16", 0)).toBe(true); // 0 = the same day
    expect(first("2026-11-16", 1)).toBe(false);
    expect(first("2026-11-17", 1)).toBe(true);
    expect(first("2026-11-18", 1)).toBe(true); // a missed day catches up
    // Left with nobody on Friday, limit 1: not Saturday, not Sunday, Monday.
    const fri = (today: string) =>
      nobodyAlertDue({ since: "2026-11-20", last: null, today, after: 1, every: 3 });
    expect(fri("2026-11-21")).toBe(false);
    expect(fri("2026-11-22")).toBe(false);
    expect(fri("2026-11-23")).toBe(true);
    // Limit 0 on a Saturday still waits for Monday.
    expect(
      nobodyAlertDue({ since: "2026-11-21", last: null, today: "2026-11-21", after: 0, every: 3 }),
    ).toBe(false);
  });
  it("then every N working days after the last one; a blank box means once", () => {
    const again = (today: string, every: number | null) =>
      nobodyAlertDue({ since, last: "2026-11-17", today, after: 1, every });
    expect(again("2026-11-18", 3)).toBe(false);
    expect(again("2026-11-19", 3)).toBe(false);
    expect(again("2026-11-20", 3)).toBe(true);
    expect(again("2026-11-18", 1)).toBe(true);
    expect(again("2026-11-30", null)).toBe(false);
    expect(again("2026-11-30", 0)).toBe(false);
  });
  it("Work Overview's red flag runs on the same clock, from the day it LOST its person", () => {
    // The owner's ticket (Nov 17): entered days before, its technician taken off today. It
    // turned red at once because the count began the day it was entered.
    expect(nobodyFlagged({ since: "2026-11-17", date: null, today: "2026-11-17", after: 1 })).toBe(
      false,
    );
    expect(nobodyFlagged({ since: "2026-11-17", date: null, today: "2026-11-18", after: 1 })).toBe(
      true,
    );
    // Friday to Monday is one working day, not three.
    expect(nobodyFlagged({ since: "2026-11-20", date: null, today: "2026-11-22", after: 1 })).toBe(
      false,
    );
    expect(nobodyFlagged({ since: "2026-11-20", date: null, today: "2026-11-23", after: 1 })).toBe(
      true,
    );
    // Its own date has passed: red whatever the limit.
    expect(
      nobodyFlagged({ since: "2026-11-17", date: "2026-11-16", today: "2026-11-17", after: 9 }),
    ).toBe(true);
    // No stamp (a row from before the change) and no date: not flagged.
    expect(nobodyFlagged({ since: null, date: null, today: "2026-11-30", after: 0 })).toBe(false);
  });
  it("the list uses each type's own limit", () => {
    const item = (kind: WorkItem["kind"], over: Partial<WorkItem> = {}): WorkItem =>
      ({
        key: `${kind}:1`,
        kind,
        title: "x",
        where: null,
        date: null,
        status: "open",
        done: false,
        href: "/",
        assigneeId: null,
        assigneeName: null,
        followup: null,
        unassigned: true,
        since: "2026-11-16",
        ...over,
      }) as WorkItem;
    const flags = (limits: Parameters<typeof flagUnassigned>[2]) =>
      flagUnassigned([item("ticket"), item("opportunity")], "2026-11-18", limits).map(
        (i) => i.flag,
      );
    // Two working days with nobody: past a limit of 2, not past 3.
    expect(flags({ ticket: 2, opportunity: 3 })).toEqual([true, false]);
    expect(flags({ ticket: 3, opportunity: 2 })).toEqual([false, true]);
    // One number is one limit for all (an answer from before the change).
    expect(flags(2)).toEqual([true, true]);
    // Someone is on it: no flag is set.
    expect(
      flagUnassigned([item("ticket", { unassigned: false })], "2026-11-30", 0)[0]!.flag,
    ).toBeUndefined();
  });
  it("the words", () => {
    expect(
      nobodyNotice({
        type: "ticket",
        title: "Ticket #6070 Acme — leak at the dock",
        since: "2026-11-16",
        today: "2026-11-18",
        dateText: "Tue, Nov 24",
      }),
    ).toEqual({
      title: "Nobody is on it: Ticket #6070 Acme — leak at the dock",
      body: "No technician for 2 working days. It is set for Tue, Nov 24. Assign it on the Tech Board or Work Overview.",
    });
    expect(
      nobodyNotice({
        type: "opportunity",
        title: "Gym reroof",
        since: "2026-11-17",
        today: "2026-11-18",
        dateText: null,
      }),
    ).toEqual({
      title: "Nobody is on it: Gym reroof",
      body: "Nobody assigned for 1 working day. Assign it on Work Overview or the opportunity.",
    });
    expect(
      nobodyNotice({
        type: "opportunity",
        title: "Gym reroof",
        since: "2026-11-18",
        today: "2026-11-18",
        dateText: "Tue, Dec 15",
      }).body,
    ).toBe(
      "Nobody assigned since today. Expected close Tue, Dec 15. Assign it on Work Overview or the opportunity.",
    );
  });
  it("the review timer and the untouched opportunity say working days", () => {
    expect(
      reviewReminderNotice({
        title: "Authorize Ticket #6090 Acme",
        since: "2026-11-13",
        today: "2026-11-18",
        remindersSent: 0,
        every: 3,
      }),
    ).toEqual({
      title: "Follow up: Authorize Ticket #6090 Acme",
      body: "Waiting 3 working days to be authorized. Reminder 1; it repeats every 3 working days until it is authorized.",
    });
    expect(
      reviewReminderNotice({
        title: "Authorize Ticket #1 A",
        since: "2026-11-18",
        today: "2026-11-18",
        remindersSent: 2,
        every: 1,
      }).body,
    ).toBe(
      "Waiting since today to be authorized. Reminder 3; it repeats every 1 working day until it is authorized.",
    );
    expect(
      opportunityUntouchedNotice({
        title: "Gym reroof",
        assigneeName: "Tech One",
        days: 4,
        limit: 3,
      }),
    ).toEqual({
      title: "Untouched opportunity: Gym reroof",
      body: "Assigned to Tech One 4 working days ago; no contact logged. Limit is 3 working days.",
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("who a line tells, from the settings row", () => {
  const ppl = people().map((p) => ({
    id: String(p["id"]),
    role: String(p["role"]),
    name: String(p["full_name"]),
  }));
  it("the row's numbers and lists, with the old page's values where a column is missing", () => {
    const ctx = alertContext(
      settings({ alert_who: { "ticket.past_due": ["managers"] }, ticket_review_every_days: 5 }),
      ppl,
    );
    expect(ctx.who["ticket.past_due"]).toEqual(["managers"]);
    expect(ctx.who["ticket.coming_up"]).toEqual(["assignee"]);
    expect(ctx.every).toEqual({ ticket: 3, opportunity: 7 });
    expect(ctx.untouched).toEqual({ ticket: 2, opportunity: 3 });
    expect(ctx.nobodyAfter).toEqual({ ticket: 1, opportunity: 1 });
    expect(ctx.numbers.ticket_review_every_days).toBe(5);
    // An opportunity runs on the same rule as a ticket, with its own two numbers.
    expect(ctx.opportunity).toEqual({ ticket_before_every_days: 7, ticket_due_notice_days: null });
    expect(ctx.ticket).toEqual({ ticket_before_every_days: 3, ticket_due_notice_days: 1 });
    // No row at all (the preview, where the signed-in person may not read it): the defaults.
    const bare = alertContext(null, ppl);
    expect(bare.who).toEqual(defaultWho(null));
    expect(bare.every).toEqual({ ticket: 3, opportunity: 7 });
  });
  it("Not started: the person on the work is told only when the line names them", () => {
    // The manager is on the ticket. As "every manager" they are not told about their own work…
    const ctx = alertContext(settings(), ppl);
    expect(watchersFor(ctx, "ticket.not_started", MGR)).toEqual([BOSS]);
    expect(watchersFor(ctx, "ticket.not_started", TECH).sort()).toEqual([BOSS, MGR]);
    // …but they are when the line lists "the assigned technician".
    const named = alertContext(
      settings({ alert_who: { "ticket.not_started": ["assignee", "managers"] } }),
      ppl,
    );
    expect(watchersFor(named, "ticket.not_started", MGR)).toEqual([MGR]);
  });
  it("told once a day: someone already told about this item today by a reminder line is left out", async () => {
    vi.setSystemTime(morning("2026-11-18"));
    const url = `/service?id=${JOB}`;
    const db: Tables = {
      notifications: [
        // Today, this item, a reminder line: told.
        { user_id: MGR, kind: "followup", url, created_at: "2026-11-18T13:05:00.000Z" },
        // Yesterday evening in the office: not today.
        { user_id: BOSS, kind: "untouched", url, created_at: "2026-11-18T03:00:00.000Z" },
        // Today, but another item.
        {
          user_id: TECH,
          kind: "followup",
          url: "/service?id=other",
          created_at: at8("2026-11-18"),
        },
        // Today, this item, but a step notice: that is not a reminder.
        { user_id: ANN, kind: "ticket_watch", url, created_at: at8("2026-11-18") },
      ],
    };
    const client = connect(db);
    expect(await notToldToday(client, [MGR, BOSS, TECH, ANN], url, new Date())).toEqual([
      BOSS,
      TECH,
      ANN,
    ]);
    // The inbox cannot be read: everyone stays in (better told twice than not at all).
    const down = connect(db, { broken: "notifications" });
    expect(await notToldToday(down, [MGR, BOSS], url, new Date())).toEqual([MGR, BOSS]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the reminder pass sends each reminder to everyone its line lists", () => {
  const overdue =
    "6 working days overdue. Reminder 2; it repeats every 3 working days until the item is finished or closed.";
  it("the person on the work gets it as before; the others are told whose it is", async () => {
    const db: Tables = {
      crm_followups: [timer()],
      crm_settings: [settings({ alert_who: { "ticket.past_due": ["assignee", "managers", ANN] } })],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-18"));
    const r = await dispatchDueReminders(connect(db));
    expect(r).toMatchObject({ checked: 1, reminded: 1, failed: 0 });
    const sent = inbox(db, "followup");
    expect(toldTo(db, "followup")).toEqual([ANN, MGR, TECH].sort());
    const body = (id: string) => sent.find((n) => n["user_id"] === id)!["body"];
    expect(body(TECH)).toBe(overdue);
    expect(body(MGR)).toBe(`${overdue} Assigned to Tech One.`);
    expect(body(ANN)).toBe(`${overdue} Assigned to Tech One.`);
    // The same title and link for everyone; the admin is not on the line.
    for (const n of sent)
      expect(n).toMatchObject({
        title: "Follow up: Ticket #6090 Acme",
        url: `/service?id=${JOB}`,
        followup_id: "f1",
      });
    // One reminder, however many people: counted once on the timer.
    expect(db["crm_followups"]![0]).toMatchObject({
      reminders_sent: 2,
      next_remind_at: at8("2026-11-23"),
    });
  });
  it("Coming up and Past due are separate lists", async () => {
    const who = { "ticket.past_due": ["managers"] };
    // Before its date: the Coming up list (the technician, by default).
    let db: Tables = {
      crm_followups: [timer({ due_at: at8("2026-11-30"), reminders_sent: 0 })],
      crm_settings: [settings({ alert_who: who })],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-18"));
    await dispatchDueReminders(connect(db));
    expect(toldTo(db, "followup")).toEqual([TECH]);
    // After it: the Past due list, which here leaves the technician out.
    db = {
      crm_followups: [timer()],
      crm_settings: [settings({ alert_who: who })],
      profiles: people(),
    };
    await dispatchDueReminders(connect(db));
    expect(toldTo(db, "followup")).toEqual([MGR]);
    expect(inbox(db)[0]!["body"]).toBe(`${overdue} Assigned to Tech One.`);
  });
  it("a line with nobody on it is off: nothing is sent", async () => {
    const db: Tables = {
      crm_followups: [timer()],
      crm_settings: [settings({ alert_who: { "ticket.past_due": [] } })],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-18"));
    const r = await dispatchDueReminders(connect(db));
    expect(r).toMatchObject({ reminded: 0, failed: 0 });
    expect(inbox(db)).toEqual([]);
  });
  it("with nothing saved it is as it was: the person assigned, alone", async () => {
    const db: Tables = {
      crm_followups: [timer()],
      crm_settings: [settings()],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-18"));
    await dispatchDueReminders(connect(db));
    expect(toldTo(db)).toEqual([TECH]);
    expect(inbox(db)[0]!["body"]).toBe(overdue);
  });
  it("someone on both Past due and Not started is told once that day", async () => {
    const db: Tables = {
      crm_followups: [timer()],
      crm_settings: [settings({ alert_who: { "ticket.past_due": ["assignee", "managers"] } })],
      profiles: people(),
      service_jobs: [
        {
          id: JOB,
          escalated_at: null,
          scheduled_date: "2026-11-10",
          assigned_at: "2026-11-06T15:00:00.000Z",
        },
      ],
    };
    vi.setSystemTime(morning("2026-11-18"));
    const untouched = {
      kind: "ticket",
      item_id: JOB,
      title: "#6090 Acme",
      url: `/service?id=${JOB}`,
      account_name: "Acme",
      assignee_id: TECH,
      assignee_name: "Tech One",
      assigned_at: "2026-11-06T15:00:00.000Z",
      limit_days: 2,
    };
    const r = await dispatchDueReminders(
      connect(db, {
        rpc: (name) => (name === "crm_untouched" ? { data: [untouched], error: null } : undefined),
      }),
    );
    expect(r).toMatchObject({ reminded: 1, escalated: 1, failed: 0 });
    // The manager got the reminder; the "not started" alert went to the admin alone.
    expect(toldTo(db, "followup")).toEqual([MGR, TECH].sort());
    expect(toldTo(db, "untouched")).toEqual([BOSS]);
    expect(inbox(db).filter((n) => n["user_id"] === MGR)).toHaveLength(1);
  });
});

describe("opportunities and the review timer count working days", () => {
  const opp = (over: Row = {}) =>
    timer({
      kind: "opportunity",
      item_id: OPP,
      title: "Gym reroof",
      url: `/opportunities?id=${OPP}`,
      due_at: at8("2026-12-15"),
      next_remind_at: at8("2026-11-24"),
      created_at: "2026-11-13T15:00:00.000Z",
      every_days: 7,
      reminders_sent: 0,
      last_reminded_at: null,
      ...over,
    });
  it("an opportunity is walked to its date like a ticket: every 7 working days, at 8:00", async () => {
    const db: Tables = {
      crm_followups: [opp()],
      crm_settings: [settings()],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-24"));
    const r = await dispatchDueReminders(connect(db));
    expect(r.reminded).toBe(1);
    expect(inbox(db)[0]).toMatchObject({
      user_id: TECH,
      kind: "followup",
      title: "Follow up: Gym reroof",
      body: "due Tuesday 12/15/2026. Reminder 1; it repeats every 7 working days until the date.",
    });
    // Seven working days after Tuesday Nov 24 is Thursday Dec 3 (it was seven calendar days).
    expect(db["crm_followups"]![0]!["next_remind_at"]).toBe(at8("2026-12-03"));
  });
  it("its own boxes decide: a notice two working days before, no cadence", async () => {
    const db: Tables = {
      crm_followups: [opp({ next_remind_at: at8("2026-12-11") })],
      crm_settings: [
        settings({ opportunity_before_every_days: null, opportunity_due_notice_days: 2 }),
      ],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-12-11")); // Friday: two working days before Tuesday
    await dispatchDueReminders(connect(db));
    expect(inbox(db)[0]).toMatchObject({
      title: "Due Tuesday: Gym reroof",
      body: "due Tuesday 12/15/2026. Reminder 1; the next one is that morning.",
    });
    expect(db["crm_followups"]![0]!["next_remind_at"]).toBe(at8("2026-12-15"));
  });
  it("an overdue opportunity that comes due on Saturday waits for Monday", async () => {
    const db: Tables = {
      crm_followups: [
        opp({
          due_at: at8("2026-11-10"),
          next_remind_at: "2026-11-14T02:00:00.000Z",
          reminders_sent: 1,
        }),
      ],
      crm_settings: [settings()],
      profiles: people(),
    };
    const client = connect(db);
    for (const weekend of ["2026-11-14", "2026-11-15"]) {
      vi.setSystemTime(morning(weekend));
      expect((await dispatchDueReminders(client)).reminded).toBe(0);
    }
    expect(inbox(db)).toEqual([]);
    expect(db["crm_followups"]![0]!["reminders_sent"]).toBe(1); // never claimed
    vi.setSystemTime(morning("2026-11-16"));
    expect((await dispatchDueReminders(client)).reminded).toBe(1);
    expect(inbox(db)[0]!["body"]).toBe(
      "4 working days overdue. Reminder 2; it repeats every 7 working days until the item is finished or closed.",
    );
    expect(db["crm_followups"]![0]!["next_remind_at"]).toBe(at8("2026-11-25"));
  });
  it("an opportunity whose expected close is a Saturday is reminded that Saturday", async () => {
    const db: Tables = {
      crm_followups: [opp({ due_at: at8("2026-11-21"), next_remind_at: at8("2026-11-21") })],
      crm_settings: [settings()],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-21"));
    expect((await dispatchDueReminders(connect(db))).reminded).toBe(1);
    expect(inbox(db)[0]!["body"]).toMatch(/^due today\. Reminder 1;/);
  });
  const review = (over: Row = {}) =>
    timer({
      kind: "invoice",
      title: "Authorize Ticket #6090 Acme",
      assignee_id: MGR,
      due_at: at8("2026-11-13"),
      next_remind_at: at8("2026-11-18"),
      created_at: "2026-11-13T15:00:00.000Z",
      reminders_sent: 0,
      last_reminded_at: null,
      ...over,
    });
  it("a Done ticket waiting to be authorized: its own number, its own words, the authorizer", async () => {
    const db: Tables = {
      crm_followups: [review()],
      crm_settings: [settings({ ticket_review_every_days: 5 })],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-18"));
    await dispatchDueReminders(connect(db));
    expect(inbox(db)).toHaveLength(1);
    expect(inbox(db)[0]).toMatchObject({
      user_id: MGR,
      title: "Follow up: Authorize Ticket #6090 Acme",
      body: "Waiting 3 working days to be authorized. Reminder 1; it repeats every 5 working days until it is authorized.",
    });
    // Five working days after Wednesday Nov 18: Wednesday Nov 25, at 8:00.
    expect(db["crm_followups"]![0]!["next_remind_at"]).toBe(at8("2026-11-25"));
  });
  it("the review timer's list is the ticket card's Done, waiting line", async () => {
    const db: Tables = {
      crm_followups: [review()],
      crm_settings: [settings({ alert_who: { "ticket.review": ["assignee", "admins"] } })],
      profiles: people(),
    };
    vi.setSystemTime(morning("2026-11-18"));
    await dispatchDueReminders(connect(db));
    expect(toldTo(db)).toEqual([BOSS, MGR]);
    expect(inbox(db).find((n) => n["user_id"] === BOSS)!["body"]).toBe(
      "Waiting 3 working days to be authorized. Reminder 1; it repeats every 3 working days until it is authorized. Assigned to Mia Manager.",
    );
  });
  it("the review timer never goes on a weekend, even one that starts on it", async () => {
    const db: Tables = {
      crm_followups: [
        review({
          due_at: at8("2026-11-21"),
          next_remind_at: at8("2026-11-21"),
          created_at: "2026-11-21T15:00:00.000Z",
        }),
      ],
      crm_settings: [settings()],
      profiles: people(),
    };
    const client = connect(db);
    vi.setSystemTime(morning("2026-11-21"));
    expect((await dispatchDueReminders(client)).reminded).toBe(0);
    vi.setSystemTime(morning("2026-11-23"));
    expect((await dispatchDueReminders(client)).reminded).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe("nobody is on it: the alerts (owner: “nobody on it should send alerts too”)", () => {
  const job = (over: Row = {}): Row => ({
    id: JOB,
    number: 6070,
    customer_name: "Acme",
    description: "leak at the dock",
    scheduled_date: "2026-11-24",
    technician_id: null,
    deleted_at: null,
    stage: "open",
    ...over,
  });
  const mark = (over: Row = {}): Row => ({
    kind: "ticket",
    item_id: JOB,
    since: "2026-11-16T15:00:00.000Z", // Monday, 10 am in the office
    alerted_at: null,
    ...over,
  });
  const world = (over: Tables = {}): Tables => ({
    crm_followups: [],
    crm_settings: [settings({ ticket_unassigned_every_days: 3 })],
    profiles: people(),
    unassigned_marks: [mark()],
    service_jobs: [job()],
    ...over,
  });
  /** Run the pass at 9 am on each day; the days an alert of `kind` went. */
  const walk = async (db: Tables, from: string, to: string, kind = "ticket_unassigned") => {
    const client = connect(db);
    const days: string[] = [];
    for (let d = morning(from); d <= morning(to); d = new Date(d.getTime() + 86400000)) {
      vi.setSystemTime(d);
      const before = inbox(db, kind).length;
      await dispatchDueReminders(client);
      if (inbox(db, kind).length > before) days.push(d.toISOString().slice(0, 10));
    }
    return days;
  };
  it("a ticket left with no technician on Monday: Tuesday, then every 3 working days, never on a weekend", async () => {
    const db = world();
    const days = await walk(db, "2026-11-16", "2026-11-27");
    // Tue 17 (one working day), Fri 20, then Sat / Sun skipped: Wed 25.
    expect(days).toEqual(["2026-11-17", "2026-11-20", "2026-11-25"]);
    // Every admin and manager, each time; nobody else.
    expect(toldTo(db, "ticket_unassigned")).toEqual([BOSS, BOSS, BOSS, MGR, MGR, MGR]);
    const first = inbox(db, "ticket_unassigned")[0]!;
    expect(first).toMatchObject({
      title: "Nobody is on it: Ticket #6070 Acme — leak at the dock",
      body: "No technician for 1 working day. It is set for Tue, Nov 24. Assign it on the Tech Board or Work Overview.",
      url: `/service?id=${JOB}`,
    });
    expect(inbox(db, "ticket_unassigned")[2]!["body"]).toMatch(
      /^No technician for 4 working days\./,
    );
    // The last alert is stamped on the mark.
    expect(db["unassigned_marks"]![0]!["alerted_at"]).toBe(morning("2026-11-25").toISOString());
  });
  it("it counts in the pass's result, and a second pass the same day sends nothing", async () => {
    const db = world();
    const client = connect(db);
    vi.setSystemTime(morning("2026-11-17"));
    expect(await dispatchDueReminders(client)).toMatchObject({ escalated: 1, failed: 0 });
    vi.setSystemTime(new Date("2026-11-17T20:00:00Z"));
    expect(await dispatchDueReminders(client)).toMatchObject({ escalated: 0 });
    expect(inbox(db)).toHaveLength(2);
  });
  it("not before 8:00 in the office", async () => {
    const db = world();
    const client = connect(db);
    vi.setSystemTime(new Date("2026-11-17T12:30:00Z")); // 7:30 am
    await dispatchDueReminders(client);
    expect(inbox(db)).toEqual([]);
    expect(db["unassigned_marks"]![0]!["alerted_at"]).toBeNull();
    vi.setSystemTime(new Date("2026-11-17T13:02:00Z")); // 8:02 am
    await dispatchDueReminders(client);
    expect(inbox(db)).toHaveLength(2);
  });
  it("a blank “then every” box means once", async () => {
    const db = world({ crm_settings: [settings({ ticket_unassigned_every_days: null })] });
    expect(await walk(db, "2026-11-16", "2026-11-30")).toEqual(["2026-11-17"]);
  });
  it("0 days means the same day", async () => {
    const db = world({ crm_settings: [settings({ unassigned_overdue_days: 0 })] });
    expect((await walk(db, "2026-11-16", "2026-11-16"))[0]).toBe("2026-11-16");
    expect(inbox(db)[0]!["body"]).toMatch(/^No technician since today\./);
  });
  it("the line's own list decides who; an empty list turns it off and claims nothing", async () => {
    const named = world({
      crm_settings: [settings({ alert_who: { "ticket.nobody": [ANN] } })],
    });
    await walk(named, "2026-11-17", "2026-11-17");
    expect(toldTo(named)).toEqual([ANN]);
    const off = world({ crm_settings: [settings({ alert_who: { "ticket.nobody": [] } })] });
    expect(await walk(off, "2026-11-16", "2026-11-27")).toEqual([]);
    expect(off["unassigned_marks"]![0]!["alerted_at"]).toBeNull();
  });
  it("only work that is still open with nobody on it", async () => {
    for (const over of [
      { technician_id: TECH }, // someone took it
      { stage: "done" }, // finished
      { deleted_at: "2026-11-16T20:00:00.000Z" }, // deleted
    ]) {
      const db = world({ service_jobs: [job(over)] });
      expect(await walk(db, "2026-11-16", "2026-11-27")).toEqual([]);
      expect(db["unassigned_marks"]![0]!["alerted_at"]).toBeNull();
    }
  });
  it("an opportunity has its own limit, pace, list and words", async () => {
    const db = world({
      crm_settings: [
        settings({
          opportunity_unassigned_days: 2,
          opportunity_unassigned_every_days: 1,
          alert_who: { "opportunity.nobody": ["managers"] },
        }),
      ],
      unassigned_marks: [mark({ kind: "opportunity", item_id: OPP })],
      service_jobs: [],
      crm_opportunities: [
        {
          id: OPP,
          title: "Gym reroof",
          expected_close: "2026-12-15",
          status: "open",
          assignee_id: null,
          deleted_at: null,
        },
      ],
    });
    // Two working days after Monday is Wednesday; then every working day.
    expect(await walk(db, "2026-11-16", "2026-11-23", "opportunity_unassigned")).toEqual([
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-23",
    ]);
    expect(toldTo(db, "opportunity_unassigned")).toEqual([MGR, MGR, MGR, MGR]);
    expect(inbox(db)[0]).toMatchObject({
      kind: "opportunity_unassigned",
      title: "Nobody is on it: Gym reroof",
      body: "Nobody assigned for 2 working days. Expected close Tue, Dec 15. Assign it on Work Overview or the opportunity.",
      url: `/opportunities?id=${OPP}`,
    });
    // A closed one is left alone, mark or no mark.
    for (const status of ["won", "lost", "no_response"]) {
      const closed = world({
        unassigned_marks: [mark({ kind: "opportunity", item_id: OPP })],
        service_jobs: [],
        crm_opportunities: [
          {
            id: OPP,
            title: "x",
            expected_close: null,
            status,
            assignee_id: null,
            deleted_at: null,
          },
        ],
      });
      expect(await walk(closed, "2026-11-16", "2026-11-20", "opportunity_unassigned")).toEqual([]);
    }
  });
  it("two passes at once alert once: the claim only wins where the stamp is still what was read", async () => {
    // Another pass stamps the mark between this pass's read and its claim.
    const db = world();
    const other = "2026-11-17T13:59:59.000Z";
    const client = connect(db, {
      afterRead: (table) => {
        if (table === "unassigned_marks") db["unassigned_marks"]![0]!["alerted_at"] = other;
      },
    });
    vi.setSystemTime(morning("2026-11-17"));
    expect(await dispatchDueReminders(client)).toMatchObject({ escalated: 0, skipped: 1 });
    expect(inbox(db)).toEqual([]);
    expect(db["unassigned_marks"]![0]!["alerted_at"]).toBe(other);
  });
  it("a send that fails puts the mark back, so the next pass tries again", async () => {
    const db = world();
    let down = true;
    const client = connect(db, {
      rpc: (name) =>
        name === "notify_recipients" && down
          ? { data: null, error: { message: "boom" } }
          : undefined,
    });
    vi.setSystemTime(morning("2026-11-17"));
    expect(await dispatchDueReminders(client)).toMatchObject({ escalated: 0, failed: 1 });
    expect(db["unassigned_marks"]![0]!["alerted_at"]).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "nobody-on-it alert failed for Ticket #6070 Acme — leak at the dock: boom",
      ),
    );
    down = false;
    vi.setSystemTime(new Date("2026-11-17T14:30:00Z"));
    expect(await dispatchDueReminders(client)).toMatchObject({ escalated: 1, failed: 0 });
  });
  it("only the scheduled job and the published site send them: the preview has no key to stamp the mark", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const db = world();
    expect(await walk(db, "2026-11-16", "2026-11-27")).toEqual([]);
    expect(db["unassigned_marks"]![0]!["alerted_at"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

describe("bid notices go to their lines' lists", () => {
  const EST = "est-1";
  const bid = (over: Row = {}): Row => ({
    id: "b1",
    name: "Gym reroof bid",
    kind: "roof",
    status: "draft",
    due_date: "2026-11-23", // Monday
    notified_due_at: null,
    notified_overdue_at: null,
    reminder_on: null,
    reminder_note: null,
    reminded_at: null,
    created_by: EST,
    account_id: null,
    deleted_at: null,
    ...over,
  });
  const world = (bids: Row[], over: Row = {}): Tables => ({
    bids,
    crm_settings: [{ id: 1, bid_due_notice_days: 1, bid_overdue_every_days: 1, ...over }],
    profiles: [...people(), { id: EST, role: "user", full_name: "Eve Estimator", email: "" }],
    crm_accounts: [],
  });
  it("Coming up: one working day before a Monday is the Friday, to everyone on the line", async () => {
    const db = world([bid()], { alert_who: { "bid.coming_up": ["assignee", "managers"] } });
    const client = connect(db);
    // Thursday: not yet.
    expect(await dispatchBidDueNotices(client, morning("2026-11-19"))).toMatchObject({
      bids_notified: 0,
    });
    expect(await dispatchBidDueNotices(client, morning("2026-11-20"))).toMatchObject({
      bids_notified: 1,
      bids_due: 1,
    });
    expect(toldTo(db, "bid_due")).toEqual([EST, MGR].sort());
    expect(inbox(db)[0]!["title"]).toBe("Bid due in 3 days: Gym reroof bid");
  });
  it("with nothing saved it goes to whoever started the bid, as before", async () => {
    const db = world([bid()]);
    await dispatchBidDueNotices(connect(db), morning("2026-11-20"));
    expect(toldTo(db)).toEqual([EST]);
  });
  it("Past due has its own list; an empty line sends nothing", async () => {
    const late = () => bid({ due_date: "2026-11-17", notified_due_at: at8("2026-11-16") });
    const db = world([late()], { alert_who: { "bid.past_due": ["admins"] } });
    expect(await dispatchBidDueNotices(connect(db), morning("2026-11-18"))).toMatchObject({
      bids_overdue: 1,
    });
    expect(toldTo(db, "bid_overdue")).toEqual([BOSS]);
    const off = world([late()], { alert_who: { "bid.past_due": [] } });
    expect(await dispatchBidDueNotices(connect(off), morning("2026-11-18"))).toMatchObject({
      bids_overdue: 0,
      bids_notified: 0,
      bids_silent: 1,
    });
    expect(inbox(off)).toEqual([]);
  });
  it("nothing about a due date on a weekend; the estimator's own “Remind me on” day still goes", async () => {
    const db = world([
      bid({ id: "late", due_date: "2026-11-19", notified_due_at: at8("2026-11-18") }),
      bid({ id: "soon", due_date: "2026-11-23" }),
      bid({ id: "mine", due_date: "2026-12-30", reminder_on: "2026-11-21" }),
    ]);
    const client = connect(db);
    // Friday: the past-due one and Monday's notice go.
    expect(await dispatchBidDueNotices(client, morning("2026-11-20"))).toMatchObject({
      bids_due: 1,
      bids_overdue: 1,
      bids_reminders: 0,
    });
    // Saturday: only the estimator's own reminder.
    expect(await dispatchBidDueNotices(client, morning("2026-11-21"))).toMatchObject({
      bids_due: 0,
      bids_overdue: 0,
      bids_reminders: 1,
    });
    expect(await dispatchBidDueNotices(client, morning("2026-11-22"))).toMatchObject({
      bids_notified: 0,
    });
    // Monday: past due again (every 1 working day after Friday).
    expect(await dispatchBidDueNotices(client, morning("2026-11-23"))).toMatchObject({
      bids_overdue: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("Each step: opportunities and bids, off until someone picks people", () => {
  it("an opportunity's steps, in order of importance", () => {
    const base = {
      title: "Gym reroof",
      status: "open",
      prevStatus: null,
      who: "Mia Manager",
      assigneeName: "Tech One" as string | null,
    };
    expect(opportunityStepNotice({ ...base, created: true })).toEqual({
      title: "Opened: Gym reroof",
      body: "Mia Manager opened it. Assigned to Tech One.",
    });
    expect(opportunityStepNotice({ ...base, created: true, assigneeName: null })!.body).toBe(
      "Mia Manager opened it. Nobody is assigned yet.",
    );
    expect(opportunityStepNotice({ ...base, status: "won", prevStatus: "quoted" })).toEqual({
      title: "Won: Gym reroof",
      body: "Mia Manager moved it from Quoted to Won.",
    });
    expect(
      opportunityStepNotice({ ...base, status: "no_response", prevStatus: "contacted" })!.title,
    ).toBe("No response: Gym reroof");
    expect(opportunityStepNotice({ ...base, person: "started" })).toEqual({
      title: "Assigned: Gym reroof",
      body: "Mia Manager assigned it to Tech One.",
    });
    expect(opportunityStepNotice({ ...base, person: "reassigned" })!.body).toBe(
      "Mia Manager gave it to Tech One.",
    );
    expect(opportunityStepNotice({ ...base, person: "closed", assigneeName: null })).toEqual({
      title: "Unassigned: Gym reroof",
      body: "Mia Manager took the person off it. Nobody is assigned now.",
    });
    expect(
      opportunityStepNotice({ ...base, deleted: true, status: "won", prevStatus: "open" }),
    ).toEqual({
      title: "Deleted: Gym reroof",
      body: "Mia Manager deleted it.",
    });
    // Not a step: a note edited, a date moved, the same status saved again.
    expect(opportunityStepNotice({ ...base, person: "unchanged" })).toBeNull();
    expect(opportunityStepNotice({ ...base, prevStatus: "open" })).toBeNull();
    expect(opportunityStepNotice(base)).toBeNull();
  });
  it("a bid's steps", () => {
    const base = { name: "Gym reroof bid", status: "draft", prevStatus: null, who: "Eve" };
    expect(bidStepNotice({ ...base, created: true })).toEqual({
      title: "Started: Bid Gym reroof bid",
      body: "Eve started it.",
    });
    expect(bidStepNotice({ ...base, status: "submitted", prevStatus: "draft" })).toEqual({
      title: "Submitted: Bid Gym reroof bid",
      body: "Eve marked it Submitted. It was Draft.",
    });
    expect(bidStepNotice({ ...base, status: "won", prevStatus: "submitted" })!.title).toBe(
      "Won: Bid Gym reroof bid",
    );
    expect(bidStepNotice({ ...base, deleted: true })).toEqual({
      title: "Deleted: Bid Gym reroof bid",
      body: "Eve deleted it.",
    });
    expect(bidStepNotice({ ...base, prevStatus: "draft" })).toBeNull();
    expect(bidStepNotice(base)).toBeNull();
    expect(OPPORTUNITY_WATCH_KIND).toBe("opportunity_watch");
    expect(BID_WATCH_KIND).toBe("bid_watch");
  });
  const step = (
    key: "ticket.steps" | "opportunity.steps" | "bid.steps",
    sb: Client,
    actorId = TECH,
  ) =>
    tellStep({
      key,
      kind: key === "bid.steps" ? BID_WATCH_KIND : OPPORTUNITY_WATCH_KIND,
      notice: { title: "Won: Gym reroof", body: "Mia Manager moved it from Quoted to Won." },
      url: `/opportunities?id=${OPP}`,
      actorId,
      sb,
    });
  it("with nothing saved, an opportunity's or a bid's step tells nobody; a ticket's tells every admin and manager", async () => {
    const db: Tables = { crm_settings: [settings()], profiles: people() };
    const client = connect(db);
    await step("opportunity.steps", client);
    await step("bid.steps", client);
    expect(inbox(db)).toEqual([]);
    await step("ticket.steps", client);
    expect(toldTo(db)).toEqual([BOSS, MGR]);
  });
  it("once people are picked they are told, one notice per change", async () => {
    const db: Tables = {
      crm_settings: [
        settings({ alert_who: { "opportunity.steps": ["managers", ANN], "bid.steps": [ANN] } }),
      ],
      profiles: people(),
    };
    const client = connect(db);
    await step("opportunity.steps", client);
    expect(toldTo(db, "opportunity_watch")).toEqual([ANN, MGR].sort());
    expect(inbox(db)[0]).toMatchObject({
      title: "Won: Gym reroof",
      body: "Mia Manager moved it from Quoted to Won.",
      url: `/opportunities?id=${OPP}`,
    });
    await step("bid.steps", client);
    expect(toldTo(db, "bid_watch")).toEqual([ANN]);
  });
  it("the person who made the change is told only with “My own changes” on", async () => {
    const who = { "opportunity.steps": ["managers", ANN] };
    let db: Tables = { crm_settings: [settings({ alert_who: who })], profiles: people() };
    await step("opportunity.steps", connect(db), MGR);
    expect(toldTo(db)).toEqual([ANN]);
    db = {
      crm_settings: [settings({ alert_who: who })],
      profiles: people().map((p) => (p["id"] === MGR ? { ...p, notify_own: true } : p)),
    };
    await step("opportunity.steps", connect(db), MGR);
    expect(toldTo(db)).toEqual([ANN, MGR].sort());
  });
  it("the words can wait for the people's names; people the change already tells are left out", async () => {
    const db: Tables = {
      crm_settings: [settings({ alert_who: { "opportunity.steps": ["managers", "admins"] } })],
      profiles: people(),
    };
    await tellStep({
      key: "opportunity.steps",
      kind: OPPORTUNITY_WATCH_KIND,
      notice: (nameOf) => ({ title: "Assigned: Gym reroof", body: `To ${nameOf(TECH)}.` }),
      url: `/opportunities?id=${OPP}`,
      actorId: TECH,
      skip: [BOSS],
      sb: connect(db),
    });
    expect(toldTo(db)).toEqual([MGR]);
    expect(inbox(db)[0]!["body"]).toBe("To Tech One.");
  });
  it("a notice that cannot be sent never fails the save: it is logged", async () => {
    const db: Tables = {
      crm_settings: [settings({ alert_who: { "bid.steps": [ANN] } })],
      profiles: people(),
    };
    const client = connect(db, {
      rpc: (name) =>
        name === "notify_recipients" ? { data: null, error: { message: "boom" } } : undefined,
    });
    await expect(step("bid.steps", client)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      'tellStep: the bid.steps notice "Won: Gym reroof" was not sent: boom',
    );
    // Nothing to say (not a step): nothing is read at all.
    await expect(
      tellStep({
        key: "bid.steps",
        kind: BID_WATCH_KIND,
        notice: null,
        url: "/",
        actorId: TECH,
        sb: connect({}, { broken: "crm_settings" }),
      }),
    ).resolves.toBeUndefined();
  });
  it("the saves call it: opportunities on open, status, person and delete; bids on start, status and delete", () => {
    const opps = flat(read("src/lib/opportunities.functions.ts"));
    expect(opps).toContain(
      'await tellStep({ key: "opportunity.steps", kind: OPPORTUNITY_WATCH_KIND, notice: (nameOf) => opportunityStepNotice({',
    );
    expect(opps).toContain(
      "const synced = await syncOppFollowup(row, oldStatus, context, nameOf(p), !id);",
    );
    expect(opps).toContain("deleted: true,");
    const bids = flat(read("src/lib/bids.functions.ts"));
    expect(bids).toContain(
      "await tellBidStep(context, bid, { created: true }, payload.updated_by_name);",
    );
    expect(bids).toContain(
      "await tellBidStep(context, bid, { prevStatus: cur.status }, bid.updated_by_name);",
    );
    expect(bids).toMatch(/await tellBidStep\( context, [^)]*\{ deleted: true \}/);
    expect(bids).toContain('key: "bid.steps", kind: BID_WATCH_KIND,');
    const trade = flat(read("src/lib/trade-bids.functions.ts"));
    expect(trade).toContain('key: "bid.steps", kind: BID_WATCH_KIND, notice: bidStepNotice({');
    // A ticket's steps go through the same sender, from the tickets' own list.
    expect(flat(read("src/lib/ticket-events.server.ts"))).toContain('key: "ticket.steps",');
  });
});

// ---------------------------------------------------------------------------------------------

describe("the page, the save, the bell and the database", () => {
  const page = read("src/components/reminders-settings.tsx");
  const p = flat(page);
  it("one card per kind of work, a who dropdown on every alert line, and the working-days note", () => {
    for (const type of ["ticket", "opportunity", "bid"] as const) {
      expect(p).toContain(`<TypeCard type="${type}"`);
      for (const line of ALERT_LINES[type])
        expect(p).toContain(
          `<Line label={LINE_LABELS.${line}} who={picker("${type}", "${line}")}>`,
        );
    }
    expect(p).toContain('data-note="working-days"');
    expect(p).toContain('<span className="font-medium">{WORKING_DAYS_NOTE}</span>');
    // The dropdown: tick boxes, the roles first, then everyone by name; several can be ticked.
    expect(p).toContain("data-who={alertKey(type, line)}");
    expect(p).toContain("data-who-option={token}");
    expect(p).toContain(
      "props.onChange(value.includes(token) ? value.filter((t) => t !== token) : [...value, token]);",
    );
    expect(p).toContain(
      '{ token: WHO_ADMINS, label: "Every admin" }, { token: WHO_MANAGERS, label: "Every manager" },',
    );
    expect(p).toContain(
      "...(lineHasAssignee(line) ? [{ token: WHO_ASSIGNEE, label: assigneeLabel(type, line) }] : []),",
    );
    expect(p).toContain("{props.people.map((u) => row(u.id, u.name))}");
    expect(p).toContain("Tick everyone who should be told. Nobody ticked turns this line off.");
    // The button names the line for a screen reader and says who is on it.
    expect(p).toContain("aria-label={`Who is told: ${LINE_LABELS[line]}, ${TYPE_TITLES[type]}`}");
    expect(p).toContain("{whoSummary(value, type, line, names)}");
  });
  it("the page shows a line never saved as who it tells today, and saves the lists with the numbers", () => {
    expect(p).toContain("alert_who: parseAlertWho(s.alert_who, s),");
    expect(p).toContain(
      "setDraft((d) => ({ ...d, alert_who: { ...(d.alert_who as AlertWho), [key]: list } }))",
    );
    expect(p).toContain("mutationFn: () => setFn({ data: draft }),");
    expect(p).toContain("<p>The numbers and the people are saved when you press Save.</p>");
    const fn = flat(read("src/lib/followups.functions.ts"));
    // Only real lines and real entries reach the database, whatever the page sent.
    expect(fn).toContain("alert_who: parseAlertWho(data.alert_who) as unknown as Json,");
    expect(fn).toContain(
      'if (p.role !== "admin") throw new Error("Forbidden: admin access required");',
    );
  });
  const saved = {
    opportunity_close_days: 30,
    opportunity_every_days: 7,
    opportunity_before_every_days: 7 as number | null,
    opportunity_due_notice_days: null as number | null,
    opportunity_untouched_days: 3,
    opportunity_unassigned_days: 1,
    opportunity_unassigned_every_days: 3 as number | null,
    ticket_first_days: 1,
    ticket_every_days: 3,
    ticket_before_every_days: 3 as number | null,
    ticket_due_notice_days: 1 as number | null,
    ticket_untouched_days: 2,
    ticket_review_every_days: 3,
    ticket_unassigned_every_days: 3 as number | null,
    unassigned_overdue_days: 1,
    bid_due_notice_days: 1,
    bid_overdue_every_days: null as number | null,
    attention_bid_days: 7,
    attention_authorize_days: 3,
    alert_who: { "ticket.nobody": ["admins", ANN], "bid.steps": [] } as Record<string, unknown>,
  };
  it("the save takes the new boxes and the lists", () => {
    expect(settingsSchema.safeParse(saved).success).toBe(true);
    expect(
      settingsSchema.safeParse({
        ...saved,
        opportunity_before_every_days: null,
        opportunity_unassigned_every_days: null,
        ticket_unassigned_every_days: null,
        opportunity_unassigned_days: 0,
        alert_who: {},
      }).success,
    ).toBe(true);
  });
  it.each([
    [
      "no lists at all (an older page cannot wipe them by leaving them out)",
      { alert_who: undefined },
    ],
    ["a list that is not a list", { alert_who: { "ticket.nobody": "admins" } }],
    ["a list of more than 60", { alert_who: { "ticket.nobody": Array(61).fill("admins") } }],
    ["a review pace of 0", { ticket_review_every_days: 0 }],
    ["a blank review pace", { ticket_review_every_days: null }],
    ["a negative nobody-on-it limit", { opportunity_unassigned_days: -1 }],
    ["half a day", { opportunity_before_every_days: 2.5 }],
    ["more than a year", { ticket_unassigned_every_days: 366 }],
    ["a notice 0 days before (the date has its own reminder)", { opportunity_due_notice_days: 0 }],
  ])("the save refuses %s", (_what, over) => {
    expect(settingsSchema.safeParse({ ...saved, ...over }).success).toBe(false);
  });
  it("the bell: the new notices have plain labels and sit under the right switch on My account", () => {
    expect(kindLabel("ticket_unassigned")).toBe("Nobody on it");
    expect(kindLabel("opportunity_unassigned")).toBe("Nobody on it");
    expect(kindLabel("opportunity_watch")).toBe("Opportunity update");
    expect(kindLabel("bid_watch")).toBe("Bid update");
    for (const l of ["Nobody on it", "Opportunity update", "Bid update"])
      expect(KIND_LABEL_ORDER).toContain(l);
    expect(KIND_CATEGORIES["ticket_unassigned"]).toBe("service");
    expect(KIND_CATEGORIES["opportunity_unassigned"]).toBe("opportunities");
    expect(KIND_CATEGORIES["opportunity_watch"]).toBe("opportunities");
    expect(KIND_CATEGORIES["bid_watch"]).toBe("bids");
    expect(noticeCategory("ticket_unassigned", `/service?id=${JOB}`)).toBe("service");
    expect(noticeCategory("bid_watch", "/estimate?bid=b1")).toBe("bids");
  });
  it("Work Overview reads each type's limit and when each item lost its person", () => {
    const fn = flat(read("src/lib/my-work.functions.ts"));
    expect(fn).toContain('"unassigned_limits"');
    expect(fn).toContain('.from("unassigned_marks")');
    expect(flat(read("src/components/my-work-page.tsx"))).toContain(
      "flagUnassigned( mergeWork(q.data), today, q.data.unassignedLimits ?? q.data.unassignedOverdueDays, )",
    );
  });
  it("the database change: the boxes, the lists, the marks and the working-day rule for every timer", () => {
    const sql = flat(read("supabase/migrations/20261118120000_standard_alerts.sql"));
    for (const col of [
      "opportunity_before_every_days",
      "opportunity_due_notice_days",
      "ticket_review_every_days",
      "ticket_unassigned_every_days",
      "opportunity_unassigned_days",
      "opportunity_unassigned_every_days",
      "alert_who",
    ])
      expect(sql).toContain(col);
    expect(sql).toContain("crm_settings_alert_days_check");
    // The marks: kept by the database, read by the office, written by nobody signed in.
    expect(sql).toContain("create table if not exists public.unassigned_marks (");
    expect(sql).toContain("alter table public.unassigned_marks enable row level security;");
    expect(sql).toContain("revoke all on public.unassigned_marks from anon;");
    expect(sql).toContain(
      "revoke insert, update, delete, truncate on public.unassigned_marks from authenticated;",
    );
    expect(sql).toContain(
      "create policy unassigned_marks_read on public.unassigned_marks for select to authenticated",
    );
    expect(sql).toContain(
      "insert into public.unassigned_marks (kind, item_id) values ('ticket', new.id)",
    );
    expect(sql).toContain(
      "insert into public.unassigned_marks (kind, item_id) values ('opportunity', new.id)",
    );
    // Every timer's next reminder is set by the one trigger, in working days.
    expect(sql).toContain("create or replace function public.crm_followups_ticket_next()");
    expect(sql).toContain("create or replace function public.unassigned_limits()");
    expect(sql).toContain("revoke all on function public.unassigned_limits() from public, anon;");
    const types = readGeneratedTypes();
    expect(types).toContain("unassigned_marks: {");
    expect(types).toContain("unassigned_limits: { Args: never; Returns: Json }");
    expect(types).toContain("alert_who: Json");
  });
});
