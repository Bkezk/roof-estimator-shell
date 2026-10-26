/**
 * Bid reminders (owner, Oct 13): "Where are the bid reminders set? Is it in Reminders like opps
 * and service, now that bids have due dates?" → a Bids group on Admin › Reminders — the "Bid due"
 * notice's lead time (was fixed at the day before) and a past-due repeat (every N days, blank =
 * never); and "can we have users who set a bid set up a custom reminder on there as well on
 * setup?" → a "Remind me on" date with a short note on the estimator's Setup › Bid Info, sent on
 * that day whatever the bid's status. All three run inside dispatchBidDueNotices, each claimed
 * with a conditional update on its own stamp and put back on a failed send, like the Oct 12
 * notice. Owner's rule: one notice per rule per day at most.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { marker: "admin" } }));

import {
  BID_DUE_NOTICE_DAYS_MAX,
  BID_OVERDUE_EVERY_DAYS_MAX,
  BID_OVERDUE_NOTICE_KIND,
  BID_REMINDER_DEFAULTS,
  BID_REMINDER_KIND,
  BID_REMINDER_NOTE_MAX,
  BID_REMINDER_NOTE_PLACEHOLDER,
  bidDaysBetween,
  bidDueNotice,
  bidDueNoticeDue,
  bidOverdueNotice,
  bidOverdueNoticeDue,
  bidRemindedLine,
  bidReminderColumns,
  bidReminderDue,
  bidReminderNotice,
  bidReminderSettings,
} from "@/lib/bid-status";
import { dispatchBidDueNotices, readBidReminderSettings } from "@/lib/bids-notify.server";
import { KIND_LABEL_ORDER, KIND_LABELS, kindLabel } from "@/lib/notifications.functions";
import { type Client } from "@/lib/notify.server";
import { blankOrNumber } from "@/lib/number-field-view";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

const MIGRATION = "supabase/migrations/20261013160000_bid_reminders.sql";
const EST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC = "55555555-5555-4555-8555-555555555555";
// 15:00 UTC = 11:00 Eastern on Mon Oct 12, 2026 (the office's day, TASK_TZ).
const NOW = new Date("2026-10-12T15:00:00Z");
const TODAY = "2026-10-12";
const at = (ymd: string) => new Date(`${ymd}T15:00:00Z`);

// ---------------------------------------------------------------------------------------------

describe("the migration, 20261013160000_bid_reminders.sql", () => {
  const flat = flatSql(MIGRATION);
  it("exists; the two crm_settings columns with their bounds (0–30 default 1; null or 1–365) and comments", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(flat).toContain(
      "alter table public.crm_settings add column if not exists bid_due_notice_days integer not null default 1;",
    );
    expect(flat).toContain("check (bid_due_notice_days between 0 and 30);");
    expect(flat).toContain(
      "alter table public.crm_settings add column if not exists bid_overdue_every_days integer;",
    );
    expect(flat).toContain(
      "check (bid_overdue_every_days is null or bid_overdue_every_days between 1 and 365);",
    );
    expect(flat).toContain("comment on column public.crm_settings.bid_due_notice_days is");
    expect(flat).toContain("comment on column public.crm_settings.bid_overdue_every_days is");
    // Idempotent: the constraints are dropped before they are added.
    expect(flat).toContain(
      "alter table public.crm_settings drop constraint if exists crm_settings_bid_due_notice_days_check;",
    );
    expect(flat).toContain(
      "alter table public.crm_settings drop constraint if exists crm_settings_bid_overdue_every_days_check;",
    );
  });
  it("the four bid columns: notified_overdue_at, reminder_on (date), reminder_note (≤ 200), reminded_at; the partial index", () => {
    expect(flat).toContain(
      "alter table public.bids add column if not exists notified_overdue_at timestamptz;",
    );
    expect(flat).toContain("alter table public.bids add column if not exists reminder_on date;");
    expect(flat).toContain("alter table public.bids add column if not exists reminder_note text;");
    expect(flat).toContain(
      "alter table public.bids add column if not exists reminded_at timestamptz;",
    );
    expect(flat).toContain("check (reminder_note is null or char_length(reminder_note) <= 200);");
    for (const c of ["notified_overdue_at", "reminder_on", "reminder_note", "reminded_at"])
      expect(flat).toContain(`comment on column public.bids.${c} is`);
    expect(flat).toContain(
      "create index if not exists bids_reminder_on_idx on public.bids (reminder_on) where reminder_on is not null and reminded_at is null and deleted_at is null;",
    );
  });
  it("one trigger function for the three stamps: due_date clears both due stamps, reminder_on clears reminded_at; before update of both", () => {
    const fn = flat.slice(
      flat.indexOf("create or replace function public.bids_due_notice_reset()"),
      flat.indexOf("revoke all on function public.bids_due_notice_reset() from public;"),
    );
    expect(fn).toContain(
      "if new.due_date is distinct from old.due_date then new.notified_due_at := null; new.notified_overdue_at := null; end if;",
    );
    expect(fn).toContain(
      "if new.reminder_on is distinct from old.reminder_on then new.reminded_at := null; end if;",
    );
    // The reminder stamp is NOT cleared by a due-date change, nor the due stamps by a reminder.
    expect(fn.indexOf("new.reminded_at := null")).toBeGreaterThan(
      fn.indexOf("new.reminder_on is distinct from old.reminder_on"),
    );
    expect(flat).toContain(
      "drop trigger if exists bids_due_notice_reset on public.bids; create trigger bids_due_notice_reset before update of due_date, reminder_on on public.bids for each row execute function public.bids_due_notice_reset();",
    );
  });
  it("audit_row() skips reminded_at: the body is 20261013150000's with that one entry added", () => {
    const body = (p: string) => {
      const sql = read(p);
      const start = sql.indexOf("create or replace function public.audit_row()");
      const end = sql.indexOf("revoke all on function public.audit_row() from public;", start);
      return sql.slice(start, end);
    };
    const prev = body("supabase/migrations/20261013150000_audit_skip_share_views.sql");
    const next = body(MIGRATION);
    expect(next).toContain("'share_views', 'share_last_viewed_at', 'reminded_at'];");
    expect(prev).not.toContain("'reminded_at'");
    expect(
      next.replace(
        "'share_views', 'share_last_viewed_at', 'reminded_at'];",
        "'share_views', 'share_last_viewed_at'];",
      ),
    ).toBe(prev);
    // notified_overdue_at was already skipped (the tasks' column of the same name).
    expect(next).toContain("'notified_overdue_at'");
  });
  it("the generated types carry the new columns", () => {
    const types = read("src/integrations/supabase/types.ts");
    const settings = types.slice(types.indexOf("      crm_settings: {\n        Row: {"));
    const settingsRow = settings.slice(0, settings.indexOf("        Insert: {"));
    expect(settingsRow).toContain("bid_due_notice_days: number;");
    expect(settingsRow).toContain("bid_overdue_every_days: number | null;");
    const bids = types.slice(types.indexOf("      bids: {\n        Row: {"));
    const bidsRow = bids.slice(0, bids.indexOf("        Insert: {"));
    for (const c of ["notified_overdue_at", "reminder_on", "reminder_note", "reminded_at"])
      expect(bidsRow).toContain(`${c}: string | null;`);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the rules (bid-status.ts)", () => {
  const bid = (over: Row = {}) => ({
    status: "draft",
    due_date: "2026-10-13",
    notified_due_at: null,
    notified_overdue_at: null,
    ...over,
  });
  it("bidDueNoticeDue honours the lead time: 0 = on the due day, 3 = three days before; the default is still the day before", () => {
    expect(BID_REMINDER_DEFAULTS).toEqual({ bid_due_notice_days: 1, bid_overdue_every_days: null });
    // Default (1): as Oct 12 — two days ahead not yet, the day before yes.
    expect(bidDueNoticeDue(bid(), "2026-10-11")).toBe(false);
    expect(bidDueNoticeDue(bid(), "2026-10-12")).toBe(true);
    // 0: only from the due day.
    expect(bidDueNoticeDue(bid(), "2026-10-12", 0)).toBe(false);
    expect(bidDueNoticeDue(bid(), "2026-10-13", 0)).toBe(true);
    expect(bidDueNoticeDue(bid(), "2026-10-14", 0)).toBe(true); // first seen late: still once
    // 3: from three days before.
    expect(bidDueNoticeDue(bid(), "2026-10-09", 3)).toBe(false);
    expect(bidDueNoticeDue(bid(), "2026-10-10", 3)).toBe(true);
    expect(bidDueNoticeDue(bid(), "2026-10-13", 3)).toBe(true);
    // A bad lead time falls back to the day before.
    expect(bidDueNoticeDue(bid(), "2026-10-11", -2)).toBe(false);
    expect(bidDueNoticeDue(bid(), "2026-10-12", 1.5)).toBe(true);
    // Never twice, never a non-draft, never undated.
    expect(bidDueNoticeDue(bid({ notified_due_at: "2026-10-10T12:00:00Z" }), "2026-10-13", 3)).toBe(
      false,
    );
    for (const status of ["submitted", "won", "lost"])
      expect(bidDueNoticeDue(bid({ status }), "2026-10-13", 3)).toBe(false);
    expect(bidDueNoticeDue(bid({ due_date: null }), "2026-10-13", 3)).toBe(false);
  });
  it("bidDueNotice says how far off: in N days, tomorrow, today, was due", () => {
    const b = { id: "b1", name: "Gym reroof bid", due_date: "2026-10-13" };
    expect(bidDaysBetween("2026-10-10", "2026-10-13")).toBe(3);
    expect(bidDaysBetween("2026-10-13", "2026-10-10")).toBe(-3);
    expect(bidDueNotice(b, "Acme", "2026-10-10").title).toBe("Bid due in 3 days: Gym reroof bid");
    expect(bidDueNotice(b, "Acme", "2026-10-11").title).toBe("Bid due in 2 days: Gym reroof bid");
    expect(bidDueNotice(b, "Acme", "2026-10-12").title).toBe("Bid due tomorrow: Gym reroof bid");
    expect(bidDueNotice(b, "Acme", "2026-10-13").title).toBe("Bid due today: Gym reroof bid");
    expect(bidDueNotice(b, "Acme", "2026-10-20").title).toBe("Bid was due Oct 13: Gym reroof bid");
  });
  it("bidOverdueNoticeDue: a draft past due, the day after, then every N days from the last notice's office day; null / 0 = never", () => {
    const due = "2026-10-13";
    // Never noticed past due: the day after the due date, not the due day itself.
    expect(bidOverdueNoticeDue(bid({ due_date: due }), "2026-10-13", 3)).toBe(false);
    expect(bidOverdueNoticeDue(bid({ due_date: due }), "2026-10-14", 3)).toBe(true);
    expect(bidOverdueNoticeDue(bid({ due_date: due }), "2026-10-30", 3)).toBe(true); // first seen late
    // Off: null, 0, a fraction.
    expect(bidOverdueNoticeDue(bid({ due_date: due }), "2026-10-20", null)).toBe(false);
    expect(bidOverdueNoticeDue(bid({ due_date: due }), "2026-10-20", undefined)).toBe(false);
    expect(bidOverdueNoticeDue(bid({ due_date: due }), "2026-10-20", 0)).toBe(false);
    expect(bidOverdueNoticeDue(bid({ due_date: due }), "2026-10-20", 1.5)).toBe(false);
    // Noticed on Oct 14 (15:00Z = 11:00 Eastern): again Oct 17 with every 3, not before.
    const last = { due_date: due, notified_overdue_at: "2026-10-14T15:00:00Z" };
    expect(bidOverdueNoticeDue(bid(last), "2026-10-15", 3)).toBe(false);
    expect(bidOverdueNoticeDue(bid(last), "2026-10-16", 3)).toBe(false);
    expect(bidOverdueNoticeDue(bid(last), "2026-10-17", 3)).toBe(true);
    expect(bidOverdueNoticeDue(bid(last), "2026-10-18", 3)).toBe(true); // a missed day catches up
    expect(bidOverdueNoticeDue(bid(last), "2026-10-15", 1)).toBe(true); // every day: tomorrow
    // The stamp's day is the office's: 02:00Z on Oct 15 is still Oct 14 Eastern.
    expect(
      bidOverdueNoticeDue(
        bid({ due_date: due, notified_overdue_at: "2026-10-15T02:00:00Z" }),
        "2026-10-17",
        3,
      ),
    ).toBe(true);
    // Never a non-draft, never undated or future-dated.
    for (const status of ["submitted", "won", "lost"])
      expect(bidOverdueNoticeDue(bid({ due_date: due, status }), "2026-10-20", 3)).toBe(false);
    expect(bidOverdueNoticeDue(bid({ due_date: null }), "2026-10-20", 3)).toBe(false);
    expect(bidOverdueNoticeDue(bid({ due_date: "2026-10-25" }), "2026-10-20", 3)).toBe(false);
  });
  it("bidOverdueNotice: 'Bid past due: <name>', the days and the due date in the body, the estimator link", () => {
    const b = { id: "b1", name: "Gym reroof bid", due_date: "2026-10-13" };
    expect(bidOverdueNotice(b, "Bell County Schools", "2026-10-16")).toEqual({
      kind: "bid_overdue",
      title: "Bid past due: Gym reroof bid",
      body: "3 days past due (due Tuesday, October 13, 2026) · Bell County Schools. Open the estimator to submit it, or mark it won or lost.",
      url: "/estimate?bid=b1",
    });
    expect(bidOverdueNotice(b, null, "2026-10-14").body).toBe(
      "1 day past due (due Tuesday, October 13, 2026). Open the estimator to submit it, or mark it won or lost.",
    );
    expect(BID_OVERDUE_NOTICE_KIND).toBe("bid_overdue");
  });
  it("bidReminderDue: on the day or after, once, ANY status; bidReminderNotice carries the note", () => {
    const r = (over: Row = {}) => ({ reminder_on: "2026-10-13", reminded_at: null, ...over });
    expect(bidReminderDue(r(), "2026-10-12")).toBe(false);
    expect(bidReminderDue(r(), "2026-10-13")).toBe(true);
    expect(bidReminderDue(r(), "2026-10-20")).toBe(true);
    expect(bidReminderDue(r({ reminded_at: "2026-10-13T15:00:00Z" }), "2026-10-20")).toBe(false);
    expect(bidReminderDue(r({ reminder_on: null }), "2026-10-20")).toBe(false);
    expect(bidReminderDue(r({ reminder_on: "soon" }), "2026-10-20")).toBe(false);
    const b = { id: "b1", name: "Gym reroof bid", reminder_note: " call Mark about the addendum " };
    expect(bidReminderNotice(b, "Bell County Schools")).toEqual({
      kind: "bid_reminder",
      title: "Bid reminder: Gym reroof bid",
      body: "call Mark about the addendum",
      url: "/estimate?bid=b1",
    });
    expect(bidReminderNotice({ ...b, reminder_note: null }, "Acme").body).toBe(
      "You asked to be reminded about this bid today. Acme.",
    );
    expect(bidReminderNotice({ ...b, reminder_note: "" }, null).body).toBe(
      "You asked to be reminded about this bid today.",
    );
    expect(BID_REMINDER_KIND).toBe("bid_reminder");
  });
  it("bidReminderColumns: undefined leaves both; null / blank clears both; a day keeps the trimmed, cut note", () => {
    expect(bidReminderColumns(undefined, "x")).toEqual({});
    expect(bidReminderColumns(null, "x")).toEqual({ reminder_on: null, reminder_note: null });
    expect(bidReminderColumns("", "x")).toEqual({ reminder_on: null, reminder_note: null });
    expect(bidReminderColumns("2026-10-20", undefined)).toEqual({ reminder_on: "2026-10-20" });
    expect(bidReminderColumns("2026-10-20", "  call Mark ")).toEqual({
      reminder_on: "2026-10-20",
      reminder_note: "call Mark",
    });
    expect(bidReminderColumns("2026-10-20", "   ")).toEqual({
      reminder_on: "2026-10-20",
      reminder_note: null,
    });
    expect(bidReminderColumns("2026-10-20", "x".repeat(300)).reminder_note).toHaveLength(
      BID_REMINDER_NOTE_MAX,
    );
    expect(BID_REMINDER_NOTE_MAX).toBe(200);
    expect(BID_REMINDER_NOTE_PLACEHOLDER).toBe("e.g. call Mark about the addendum");
  });
  it("bidReminderSettings: the row's numbers within bounds, else the defaults; bidRemindedLine; blankOrNumber", () => {
    expect(BID_DUE_NOTICE_DAYS_MAX).toBe(30);
    expect(BID_OVERDUE_EVERY_DAYS_MAX).toBe(365);
    expect(bidReminderSettings(null)).toEqual({
      bid_due_notice_days: 1,
      bid_overdue_every_days: null,
    });
    expect(bidReminderSettings({})).toEqual({
      bid_due_notice_days: 1,
      bid_overdue_every_days: null,
    });
    expect(bidReminderSettings({ bid_due_notice_days: 0, bid_overdue_every_days: 7 })).toEqual({
      bid_due_notice_days: 0,
      bid_overdue_every_days: 7,
    });
    expect(bidReminderSettings({ bid_due_notice_days: 31, bid_overdue_every_days: 0 })).toEqual({
      bid_due_notice_days: 1,
      bid_overdue_every_days: null,
    });
    expect(bidRemindedLine("2026-10-13T15:00:00Z")).toBe("Reminded Oct 13");
    expect(bidRemindedLine("2026-10-14T02:00:00Z")).toBe("Reminded Oct 13"); // 22:00 Eastern
    // The Reminders page's "blank = never" box.
    expect(blankOrNumber("")).toBeNull();
    expect(blankOrNumber("   ")).toBeNull();
    expect(blankOrNumber("7")).toBe(7);
    expect(blankOrNumber("7.6")).toBe(8);
    expect(blankOrNumber("0")).toBe(0);
    expect(blankOrNumber("abc")).toBeNull();
  });
  it("the inbox labels: Bid past due and Bid reminder, in the filter's order after Bid due", () => {
    expect(kindLabel("bid_overdue")).toBe("Bid past due");
    expect(kindLabel("bid_reminder")).toBe("Bid reminder");
    expect(KIND_LABELS["bid_overdue"]).toBe("Bid past due");
    expect(KIND_LABELS["bid_reminder"]).toBe("Bid reminder");
    const i = KIND_LABEL_ORDER.indexOf("Bid due");
    expect(KIND_LABEL_ORDER.slice(i, i + 3)).toEqual(["Bid due", "Bid past due", "Bid reminder"]);
    // No check constraint on notifications.kind to extend (kind is free text).
    expect(read("supabase/migrations/20260927100000_crm_followups.sql")).toContain(
      "kind text not null,\n  title text not null,",
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("the pass (dispatchBidDueNotices, the stand-in client)", () => {
  const recipients: FakeRpc = (args, tables) =>
    (tables["profiles"] ?? [])
      .filter((p) => (args["ids"] as string[]).includes(p["id"] as string))
      .map((p) => ({
        id: p["id"],
        email: p["email"],
        full_name: p["full_name"],
        notify_email: false,
        notify_push: false,
      }));
  const bid = (over: Row = {}): Row => ({
    id: "b1",
    name: "Gym reroof bid",
    status: "draft",
    due_date: "2026-10-13",
    notified_due_at: null,
    notified_overdue_at: null,
    reminder_on: null,
    reminder_note: null,
    reminded_at: null,
    created_by: EST,
    account_id: ACC,
    deleted_at: null,
    ...over,
  });
  let env: ReturnType<typeof fakeSupabase>;
  const world = (
    bids: Row[],
    settings: Row | null = { id: 1 },
    rpc?: Parameters<typeof fakeSupabase>[1],
  ) => {
    env = fakeSupabase(
      {
        profiles: [{ id: EST, full_name: "Eve Estimator", email: "eve@example.com" }],
        bids,
        crm_settings: settings ? [settings] : [],
        crm_accounts: [{ id: ACC, name: "Bell County Schools" }],
        notifications: [],
        push_subscriptions: [],
      },
      { rpcs: { notify_recipients: recipients }, ...rpc },
    );
    return env.db as unknown as Client;
  };
  const inbox = () => env.tables["notifications"] ?? [];
  const row = (id = "b1") => env.tables["bids"]!.find((r) => r["id"] === id)!;
  const run = (client: Client, now = NOW) => dispatchBidDueNotices(client, now);

  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads the Bids settings from crm_settings; no row or missing columns = the defaults", async () => {
    world([], { id: 1, bid_due_notice_days: 3, bid_overdue_every_days: 7 });
    expect(await readBidReminderSettings(env.db as unknown as Client)).toEqual({
      bid_due_notice_days: 3,
      bid_overdue_every_days: 7,
    });
    world([], null);
    expect(await readBidReminderSettings(env.db as unknown as Client)).toEqual({
      bid_due_notice_days: 1,
      bid_overdue_every_days: null,
    });
    world([], { id: 1 });
    expect(await readBidReminderSettings(env.db as unknown as Client)).toEqual({
      bid_due_notice_days: 1,
      bid_overdue_every_days: null,
    });
    const src = read("src/lib/bids-notify.server.ts");
    expect(src).toContain('.select("bid_due_notice_days, bid_overdue_every_days")');
    expect(src).toContain("const settings = await readBidReminderSettings(admin);");
    // Plain select / eq / limit and lte, as the Oct 12 module: no maybeSingle, no lt (the
    // reminder passes' stand-ins speak no more than that).
    expect(src).not.toContain("maybeSingle");
    expect(src).not.toContain(".lt(");
  });
  it("the due notice honours the lead time: 3 days before notices a bid due Oct 15 on Oct 12; 0 waits for the due day", async () => {
    let client = world(
      [bid({ id: "in3", due_date: "2026-10-15" }), bid({ id: "in4", due_date: "2026-10-16" })],
      { id: 1, bid_due_notice_days: 3 },
    );
    expect(await run(client)).toMatchObject({ bids_checked: 1, bids_notified: 1, bids_due: 1 });
    expect(inbox()[0]).toMatchObject({
      kind: "bid_due",
      title: "Bid due in 3 days: Gym reroof bid",
    });
    expect(row("in3")["notified_due_at"]).toBe(NOW.toISOString());
    expect(row("in4")["notified_due_at"]).toBeNull();

    client = world([bid({ id: "tmrw", due_date: "2026-10-13" })], {
      id: 1,
      bid_due_notice_days: 0,
    });
    expect(await run(client)).toMatchObject({ bids_checked: 0, bids_notified: 0 });
    expect(await run(client, at("2026-10-13"))).toMatchObject({ bids_notified: 1, bids_due: 1 });
    expect(inbox()[0]).toMatchObject({ title: "Bid due today: Gym reroof bid" });
  });
  it("past due: nothing while the setting is blank (null); with every 3 days — the day after, then every third day, stamped on the row each time", async () => {
    // (The due notice already went for these — its own rule, tested above; stamped so this one
    // is seen alone.)
    const noticed = "2026-10-09T15:00:00Z";
    const past = bid({ id: "late", due_date: "2026-10-10", notified_due_at: noticed });
    let client = world([past], { id: 1, bid_overdue_every_days: null });
    expect(await run(client)).toMatchObject({ bids_overdue: 0, bids_notified: 0 });
    expect(row("late")["notified_overdue_at"]).toBeNull();

    client = world([bid({ id: "late", due_date: "2026-10-11", notified_due_at: noticed })], {
      id: 1,
      bid_overdue_every_days: 3,
    });
    // Oct 11 (the due day): not yet past due.
    expect(await run(client, at("2026-10-11"))).toMatchObject({ bids_overdue: 0 });
    // Oct 12: the day after — the first past-due notice.
    const r1 = await run(client, at("2026-10-12"));
    expect(r1).toMatchObject({ bids_overdue: 1 });
    expect(row("late")["notified_overdue_at"]).toBe(at("2026-10-12").toISOString());
    const overdue = () => inbox().filter((n) => n["kind"] === "bid_overdue");
    expect(overdue()).toHaveLength(1);
    expect(overdue()[0]).toMatchObject({
      user_id: EST,
      title: "Bid past due: Gym reroof bid",
      body: "1 day past due (due Sunday, October 11, 2026) · Bell County Schools. Open the estimator to submit it, or mark it won or lost.",
      url: "/estimate?bid=late",
    });
    // Oct 13, 14: quiet. Oct 15: again (4 days past due). Oct 16, 17: quiet. Oct 18: again.
    expect((await run(client, at("2026-10-13"))).bids_overdue).toBe(0);
    expect((await run(client, at("2026-10-14"))).bids_overdue).toBe(0);
    expect((await run(client, at("2026-10-15"))).bids_overdue).toBe(1);
    expect(overdue()[1]).toMatchObject({ body: expect.stringContaining("4 days past due") });
    expect(row("late")["notified_overdue_at"]).toBe(at("2026-10-15").toISOString());
    expect((await run(client, at("2026-10-16"))).bids_overdue).toBe(0);
    expect((await run(client, at("2026-10-17"))).bids_overdue).toBe(0);
    expect((await run(client, at("2026-10-18"))).bids_overdue).toBe(1);
    expect(overdue()).toHaveLength(3);
    // Twice on one day: never (the stamp).
    expect((await run(client, new Date("2026-10-18T20:00:00Z"))).bids_overdue).toBe(0);
    expect(overdue()).toHaveLength(3);
  });
  it("the past-due repeat's claim is a conditional update on the LAST stamp; a failed send puts that stamp back and keeps the error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const earlier = at("2026-10-12").toISOString();
    let down = true;
    world(
      [
        bid({
          id: "late",
          due_date: "2026-10-11",
          notified_overdue_at: earlier,
          notified_due_at: earlier,
        }),
      ],
      { id: 1, bid_overdue_every_days: 3 },
      {
        rpc: (fn) =>
          fn === "notify_recipients" && down
            ? { data: null, error: { message: "down" } }
            : undefined,
      },
    );
    const client = env.db as unknown as Client;
    const now = at("2026-10-15");
    expect(await run(client, now)).toMatchObject({ bids_errors: 1, bids_overdue: 0 });
    const writes = env.writes.filter((w) => w.table === "bids");
    expect(writes[0]).toMatchObject({
      op: "update",
      payload: { notified_overdue_at: now.toISOString(), notify_error: null },
      filters: ["eq id=late", `eq notified_overdue_at=${earlier}`],
      rows: 1,
    });
    expect(writes[1]).toMatchObject({
      op: "update",
      payload: { notified_overdue_at: earlier, notify_error: "down" },
      filters: ["eq id=late", `eq notified_overdue_at=${now.toISOString()}`],
      rows: 1,
    });
    expect(writes).toHaveLength(2);
    expect(row("late")).toMatchObject({ notified_overdue_at: earlier, notify_error: "down" });
    expect(inbox()).toEqual([]);
    // The next pass sends it and clears the error.
    down = false;
    expect(await run(client, new Date("2026-10-15T16:00:00Z"))).toMatchObject({
      bids_overdue: 1,
      bids_errors: 0,
    });
    expect(row("late")).toMatchObject({
      notified_overdue_at: "2026-10-15T16:00:00.000Z",
      notify_error: null,
    });
    log.mockRestore();
  });
  it("never a past-due notice for a submitted / won / lost or deleted bid", async () => {
    const client = world(
      [
        bid({ id: "sub", status: "submitted", due_date: "2026-10-01" }),
        bid({ id: "won", status: "won", due_date: "2026-10-01" }),
        bid({ id: "lost", status: "lost", due_date: "2026-10-01" }),
        bid({ id: "gone", due_date: "2026-10-01", deleted_at: "2026-10-05T00:00:00Z" }),
      ],
      { id: 1, bid_overdue_every_days: 1 },
    );
    expect(await run(client)).toMatchObject({ bids_checked: 0, bids_notified: 0 });
    for (const id of ["sub", "won", "lost", "gone"])
      expect(row(id)["notified_overdue_at"]).toBeNull();
  });
  it("the custom reminder goes on its day — to the maker, with the note, whatever the status — once; not before; not for a deleted bid", async () => {
    const client = world([
      bid({
        id: "sub",
        status: "submitted",
        reminder_on: "2026-10-12",
        reminder_note: "call Mark about the addendum",
        due_date: "2026-10-01",
      }),
      bid({
        id: "won",
        status: "won",
        reminder_on: "2026-10-10",
        reminder_note: null,
        due_date: "2026-10-01",
      }),
      bid({
        id: "later",
        reminder_on: "2026-10-13",
        reminder_note: "later",
        due_date: "2026-10-30",
      }),
      bid({
        id: "done",
        reminder_on: "2026-10-12",
        reminded_at: "2026-10-12T13:00:00Z",
        due_date: "2026-10-30",
      }),
      bid({
        id: "gone",
        reminder_on: "2026-10-12",
        deleted_at: "2026-10-05T00:00:00Z",
        due_date: "2026-10-30",
      }),
    ]);
    const r = await run(client);
    expect(r).toMatchObject({ bids_reminders: 2, bids_due: 0, bids_overdue: 0, bids_notified: 2 });
    const reminders = inbox().filter((n) => n["kind"] === "bid_reminder");
    expect(reminders).toHaveLength(2);
    expect(reminders.find((n) => n["url"] === "/estimate?bid=sub")).toMatchObject({
      user_id: EST,
      title: "Bid reminder: Gym reroof bid",
      body: "call Mark about the addendum",
    });
    expect(reminders.find((n) => n["url"] === "/estimate?bid=won")).toMatchObject({
      body: "You asked to be reminded about this bid today. Bell County Schools.",
    });
    expect(row("sub")["reminded_at"]).toBe(NOW.toISOString());
    expect(row("won")["reminded_at"]).toBe(NOW.toISOString());
    expect(row("later")["reminded_at"]).toBeNull();
    expect(row("done")["reminded_at"]).toBe("2026-10-12T13:00:00Z");
    expect(row("gone")["reminded_at"]).toBeNull();
    // The next pass: nothing more today; "later" fires tomorrow.
    expect((await run(client, new Date("2026-10-12T20:00:00Z"))).bids_reminders).toBe(0);
    expect((await run(client, at("2026-10-13"))).bids_reminders).toBe(1);
    expect(inbox().filter((n) => n["kind"] === "bid_reminder")).toHaveLength(3);
    // Re-armed: the estimator picks a new day (the trigger clears reminded_at) — once more.
    Object.assign(row("sub"), { reminder_on: "2026-10-20", reminded_at: null });
    expect((await run(client, at("2026-10-19"))).bids_reminders).toBe(0);
    expect((await run(client, at("2026-10-20"))).bids_reminders).toBe(1);
  });
  it("the custom reminder is claimed first (reminded_at where null) and put back on a failed send", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    world(
      [
        bid({
          id: "r",
          status: "won",
          reminder_on: "2026-10-12",
          reminder_note: "n",
          due_date: "2026-10-01",
        }),
      ],
      { id: 1 },
      {
        rpc: (fn) =>
          fn === "notify_recipients" ? { data: null, error: { message: "down" } } : undefined,
      },
    );
    expect(await run(env.db as unknown as Client)).toMatchObject({
      bids_errors: 1,
      bids_reminders: 0,
    });
    const writes = env.writes.filter((w) => w.table === "bids");
    expect(writes[0]).toMatchObject({
      payload: { reminded_at: NOW.toISOString(), notify_error: null },
      filters: ["eq id=r", "is reminded_at=null"],
    });
    expect(writes[1]).toMatchObject({
      payload: { reminded_at: null, notify_error: "down" },
      filters: ["eq id=r", `eq reminded_at=${NOW.toISOString()}`],
    });
    expect(row("r")).toMatchObject({ reminded_at: null, notify_error: "down" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("bid r"), "down");
    log.mockRestore();
  });
  it("two passes at once claim each rule once: one notice per rule, the other pass skipped", async () => {
    const client = world(
      [
        bid({ id: "due" }),
        bid({ id: "late", due_date: "2026-10-01", notified_due_at: "2026-10-01T15:00:00Z" }),
        bid({ id: "rem", status: "won", due_date: "2026-10-01", reminder_on: "2026-10-12" }),
      ],
      { id: 1, bid_overdue_every_days: 5 },
    );
    const [a, b] = await Promise.all([run(client), run(client)]);
    // Three notices in all, never four. A pass that read a bid at the same moment as the other
    // loses the claim and skips it; one that read it after the other's stamp landed sees nothing
    // due — either way no second notice.
    expect(a.bids_notified + b.bids_notified).toBe(3);
    expect(a.bids_skipped + b.bids_skipped).toBeGreaterThanOrEqual(1);
    expect(a.bids_checked + b.bids_checked).toBe(3 + a.bids_skipped + b.bids_skipped);
    expect(a.bids_errors + b.bids_errors).toBe(0);
    expect(inbox()).toHaveLength(3);
    expect(new Set(inbox().map((n) => n["kind"]))).toEqual(
      new Set(["bid_due", "bid_overdue", "bid_reminder"]),
    );
    expect(env.writes.filter((w) => w.table === "bids")).toHaveLength(3);
  });
  it("a bid nobody started is stamped silently for every rule", async () => {
    const client = world(
      [
        bid({ id: "due", created_by: null }),
        bid({
          id: "late",
          created_by: null,
          due_date: "2026-10-01",
          notified_due_at: "2026-10-01T15:00:00Z",
        }),
        bid({ id: "rem", created_by: null, due_date: "2026-10-30", reminder_on: "2026-10-01" }),
      ],
      { id: 1, bid_overdue_every_days: 2 },
    );
    expect(await run(client)).toMatchObject({ bids_checked: 3, bids_silent: 3, bids_notified: 0 });
    expect(row("due")["notified_due_at"]).toBe(NOW.toISOString());
    expect(row("late")["notified_overdue_at"]).toBe(NOW.toISOString());
    expect(row("rem")["reminded_at"]).toBe(NOW.toISOString());
    expect(inbox()).toEqual([]);
  });
  it("one rule's pass throwing as a whole is counted and named; the other two still run", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = world(
      [
        bid({ id: "due" }),
        bid({ id: "rem", status: "won", due_date: "2026-10-01", reminder_on: "2026-10-12" }),
      ],
      { id: 1, bid_overdue_every_days: 2 },
    );
    // Only the past-due pass selects drafts due by yesterday: make that read throw.
    const db = client as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = db.from;
    db.from = (t: string) => {
      const b = realFrom(t);
      if (t === "bids") {
        const lte = b["lte"] as (c: string, v: string) => unknown;
        b["lte"] = (c: string, v: string) => {
          if (c === "due_date" && v === "2026-10-11") throw new Error("relation is being vacuumed");
          return lte(c, v);
        };
      }
      return b;
    };
    const r = await run(client);
    expect(r).toMatchObject({
      bids_due: 1,
      bids_overdue: 0,
      bids_reminders: 1,
      bids_notified: 2,
      bids_errors: 1,
      pass_errors: ["Bid past due: relation is being vacuumed"],
    });
    expect(log).toHaveBeenCalledWith("Bid past due pass failed", expect.any(Error));
    log.mockRestore();
  });
  it("the module: three passes in their own try/catch inside dispatchBidDueNotices, still run from the cron route and the app's pass", () => {
    const src = read("src/lib/bids-notify.server.ts");
    for (const t of [
      '["Bid due", () => dueNotices(admin, today, stamp, settings, out)]',
      '["Bid past due", () => overdueNotices(admin, today, stamp, settings, out)]',
      '["Bid reminder", () => reminderNotices(admin, today, stamp, out)]',
      "out.pass_errors.push(`${label}: ${errText(e)}`);",
      "if (every === null) return;",
      '.lte("due_date", bidDayPlus(today, -1))',
      '.is("reminded_at", null)',
      '.lte("reminder_on", today)',
      "bidOverdueNoticeDue(b, today, every)",
      "bidReminderDue(b, today)",
    ])
      expect(src).toContain(t);
    // The due / past-due selects are draft-only; the reminder's is not (any status).
    const reminder = src.slice(
      src.indexOf("async function reminderNotices"),
      src.indexOf("export async function dispatchBidDueNotices"),
    );
    expect(reminder).not.toContain('.eq("status", "draft")');
    expect(reminder).toContain('.is("deleted_at", null)');
    expect(read("src/routes/api.cron.reminders.ts")).toContain(
      "const b = await dispatchBidDueNotices(supabaseAdmin);",
    );
    expect(read("src/lib/followups.functions.ts")).toContain("out.bidNotices = b.bids_notified;");
  });
});

// ---------------------------------------------------------------------------------------------

describe("the settings (zod, defaults, Admin › Reminders › Bids)", () => {
  it("setCrmSettings takes the two: 0–30, and 1–365 or null", () => {
    const fn = read("src/lib/followups.functions.ts");
    expect(fn).toContain(
      "bid_due_notice_days: z.number().int().min(0).max(BID_DUE_NOTICE_DAYS_MAX),",
    );
    expect(fn).toContain(
      "bid_overdue_every_days: z.number().int().min(1).max(BID_OVERDUE_EVERY_DAYS_MAX).nullable(),",
    );
    const server = read("src/lib/followups.server.ts");
    expect(server).toContain("bid_due_notice_days: number;");
    expect(server).toContain("bid_overdue_every_days: number | null;");
    expect(server).toContain("...BID_REMINDER_DEFAULTS,");
  });
  it("the page: a Bids group after Tickets with the two rows and the help line", () => {
    const page = read("src/components/reminders-settings.tsx");
    const tickets = page.indexOf('title="Tickets"');
    const bids = page.indexOf('title="Bids"');
    const needs = page.indexOf('title="Needs assignment"');
    expect(tickets).toBeGreaterThan(-1);
    expect(bids).toBeGreaterThan(tickets);
    expect(needs).toBeGreaterThan(bids);
    expect(page).toContain(
      'help="Sent to whoever started the bid. A submitted, won or lost bid is never reminded."',
    );
    expect(page).toMatch(
      /<Line label="Notice">\s+\{field\("bid_due_notice_days"\)\} days before a bid is due \(0 = on the due day\)\./,
    );
    expect(page).toMatch(
      /<Line label="Past due">\s+Then every \{field\("bid_overdue_every_days"\)\} days while a draft is past due\.\s+Leave\s+the box blank to never remind past due\./,
    );
    expect(page).toContain('label: "Notice N days before a bid is due"');
    expect(page).toContain('label: "Then every N days while a draft is past due (blank = never)"');
    expect(page).toMatch(
      /key: "bid_due_notice_days",\s+label: [^\n]+\n\s+min: 0,\s+max: BID_DUE_NOTICE_DAYS_MAX,\s+group: "bids",/,
    );
    expect(page).toMatch(
      /key: "bid_overdue_every_days",\s+label: [^\n]+\n\s+min: 1,\s+max: BID_OVERDUE_EVERY_DAYS_MAX,\s+never: true,\s+group: "bids",/,
    );
  });
  it("blank = never: the box starts blank when null (no 0 stands in), typing sets a number, clearing saves null; the draft starts null and hydrates `?? null`", () => {
    const page = read("src/components/reminders-settings.tsx");
    // EMPTY and the hydration from the row.
    expect(page).toContain("bid_due_notice_days: 1,\n  bid_overdue_every_days: null,");
    expect(page).toContain("bid_due_notice_days: s.bid_due_notice_days ?? 1,");
    expect(page).toContain("bid_overdue_every_days: s.bid_overdue_every_days ?? null,");
    // The nullable variant: a plain number input bound to "" when null, through blankOrNumber.
    const comp = page.slice(page.indexOf("function DaysOrNever("), page.indexOf("function Days("));
    expect(comp).toContain('value={props.value ?? ""}');
    expect(comp).toContain("onChange={(e) => props.onChange(blankOrNumber(e.target.value))}");
    expect(comp).toContain("title={props.field.label}");
    expect(comp).toContain("data-field={props.field.key}");
    expect(comp).not.toContain("placeholder");
    expect(page).toContain('import { blankOrNumber } from "@/lib/number-field-view";');
    // field() picks it for a `never` field; the others keep NumberField (blankZero off, their max).
    expect(page).toMatch(/if \(f\.never\)\s+return \(\s+<DaysOrNever/);
    expect(page).toContain("max={props.field.max ?? 365}");
    // Validation: null is fine only where blank means never; a number must be within min..max.
    expect(page).toContain("if (v === null) return !f.never;");
    expect(page).toContain("return !Number.isInteger(v) || v < f.min || v > (f.max ?? 365);");
  });
});

// ---------------------------------------------------------------------------------------------

describe("Setup › Bid Info: the custom reminder", () => {
  const src = read("src/routes/estimate.tsx");
  it("a 'Remind me on' date box and an 'About' box (max 200, the placeholder) under Bid due, blank by default", () => {
    const panel = src.slice(src.indexOf('<div id="bid-total-panel"'));
    const due = panel.indexOf('data-field="bid-due"');
    const rem = panel.indexOf('data-field="bid-reminder"');
    expect(due).toBeGreaterThan(-1);
    expect(rem).toBeGreaterThan(due);
    const box = panel.slice(rem, panel.indexOf('data-line="bid-reminded"'));
    expect(box).toContain(">\n                Remind me on\n              </Label>");
    expect(box).toContain('id="bid-reminder-on"');
    expect(box).toContain('type="date"');
    expect(box).toContain("value={bidReminderOn}");
    expect(box).toContain(">\n                About\n              </Label>");
    expect(box).toContain('id="bid-reminder-note"');
    expect(box).toContain("value={bidReminderNote}");
    expect(box).toContain("maxLength={BID_REMINDER_NOTE_MAX}");
    expect(box).toContain("placeholder={BID_REMINDER_NOTE_PLACEHOLDER}");
    expect(box).toContain("disabled={readOnly || !bidReminderOn}");
    // Clearing the date clears the note.
    expect(box).toContain('if (!e.target.value) setBidReminderNote("");');
    expect(src).toContain('const [bidReminderOn, setBidReminderOn] = useState("");');
    expect(src).toContain('const [bidReminderNote, setBidReminderNote] = useState("");');
  });
  it("loaded from the row, saved with the bid (reminderOn / reminderNote; null clears both), counted as unsaved changes, reset on a fresh start", () => {
    expect(src).toContain('setBidReminderOn(loadedBid.reminder_on ?? "");');
    expect(src).toContain('setBidReminderNote(loadedBid.reminder_note ?? "");');
    // Sent through bidHeaderPatch when changed in the tab (owner, Oct 26: a header field changed
    // elsewhere while the tab was open is kept).
    expect(src).toContain("reminderOn: bidReminderOn,");
    expect(src).toContain("reminderNote: bidReminderNote,");
    expect(src).toContain("...bidHeaderPatch(bidId ? loadedHeader.current : null, tabHeader),");
    expect(src).toContain(
      '|${normalizeFolder(folder) ?? ""}|${reminderOn}|${reminderOn ? reminderNote.trim() : ""}`;',
    );
    expect(src).toContain("savedJsonOf(bidFolder, bidReminderOn, bidReminderNote)");
    expect(src.match(/setBidReminderOn\(""\);/g)).toHaveLength(3);
    expect(src.match(/setBidReminderNote\(""\);/g)).toHaveLength(4); // the three resets + clearing the date
    expect(src).not.toMatch(/reminderOn:\s*saved\./);
  });
  it("after it fires: 'Reminded <day>' beside the box while the saved day is still the one shown; a new day re-arms it", () => {
    expect(src).toContain(
      '{loadedBid?.reminded_at && (loadedBid.reminder_on ?? "") === bidReminderOn && (',
    );
    expect(src).toContain(
      "{bidRemindedLine(loadedBid.reminded_at)} — pick a new day for another reminder.",
    );
    expect(src).toContain('data-line="bid-reminded"');
  });
  it("the server: saveBid takes reminderOn (a day or null) and reminderNote, through bidReminderColumns", () => {
    const fn = read("src/lib/bids.functions.ts");
    expect(fn).toContain("reminderOn: z");
    expect(fn).toContain(
      '.regex(/^\\d{4}-\\d{2}-\\d{2}$/, "The reminder day must be a day (YYYY-MM-DD)")',
    );
    expect(fn).toContain("reminderNote: z.string().max(400).nullable().optional(),");
    expect(fn).toContain("...bidReminderColumns(data.reminderOn, data.reminderNote),");
    expect(fn).toContain("bidReminderColumns,");
  });
});
