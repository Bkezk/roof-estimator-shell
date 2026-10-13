/**
 * "Bid due tomorrow" (owner, Oct 12): one notice per draft bid to whoever started it, the day
 * before its due date (or on first sight when the bid is made on / after that day), never two;
 * moving the due date re-arms it. Sent by the reminder pass — the cron route and the app's own
 * pass, beside the task notices — through notify() with the admin client; skipped without the
 * server key, with the task notices' reason. Inbox kind bid_due, labelled "Bid due".
 *
 * Owner, Oct 12 (B2): the bid is CLAIMED before the send (notified_due_at = now where still
 * null); a send that fails puts the stamp back where it is still this pass's and keeps the error
 * on bids.notify_error (20261012180000), so the next pass retries; two passes at once send once.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { marker: "admin" } }));

import { BID_DUE_NOTICE_KIND, bidDayPlus, bidDueNotice, bidDueNoticeDue } from "@/lib/bid-status";
import { dispatchBidDueNotices } from "@/lib/bids-notify.server";
import { kindLabel } from "@/lib/notifications.functions";
import { type Client } from "@/lib/notify.server";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

const EST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC = "55555555-5555-4555-8555-555555555555";
// 15:00 UTC = 11:00 Eastern on Mon Oct 12, 2026 (the office's day, TASK_TZ).
const NOW = new Date("2026-10-12T15:00:00Z");
const TODAY = "2026-10-12";

describe("the column and the trigger", () => {
  const sql = flatSql("supabase/migrations/20261012140000_bid_due_date.sql");
  it("bids.notified_due_at (timestamptz), its comment, and a trigger that clears it when due_date changes", () => {
    expect(sql).toContain(
      "alter table public.bids add column if not exists notified_due_at timestamptz;",
    );
    expect(sql).toContain("comment on column public.bids.notified_due_at is");
    expect(sql).toContain(
      "if new.due_date is distinct from old.due_date then new.notified_due_at := null; end if;",
    );
    expect(sql).toContain(
      "drop trigger if exists bids_due_notice_reset on public.bids; create trigger bids_due_notice_reset before update of due_date on public.bids for each row execute function public.bids_due_notice_reset();",
    );
    expect(sql).toContain("revoke all on function public.bids_due_notice_reset() from public;");
    const types = read("src/integrations/supabase/types.ts");
    const bids = types.slice(types.indexOf("      bids: {\n        Row: {"));
    expect(bids.slice(0, bids.indexOf("        Relationships: ["))).toContain(
      "notified_due_at: string | null;",
    );
  });
});

describe("the rule (bidDueNoticeDue) and the words (bidDueNotice)", () => {
  const bid = (over: Row = {}) => ({
    status: "draft",
    due_date: "2026-10-13",
    notified_due_at: null,
    ...over,
  });
  it("a draft with a date, not yet noticed, from the day before its due date on", () => {
    expect(bidDayPlus("2026-10-31", 1)).toBe("2026-11-01");
    expect(bidDueNoticeDue(bid(), "2026-10-11")).toBe(false); // two days ahead: not yet
    expect(bidDueNoticeDue(bid(), "2026-10-12")).toBe(true); // the day before
    expect(bidDueNoticeDue(bid(), "2026-10-13")).toBe(true); // the day itself (made late)
    expect(bidDueNoticeDue(bid(), "2026-10-20")).toBe(true); // already past on first sight
    expect(bidDueNoticeDue(bid({ notified_due_at: "2026-10-12T12:00:00Z" }), "2026-10-13")).toBe(
      false,
    );
    expect(bidDueNoticeDue(bid({ due_date: null }), TODAY)).toBe(false);
    for (const status of ["submitted", "won", "lost"])
      expect(bidDueNoticeDue(bid({ status }), TODAY)).toBe(false);
  });
  it("tomorrow / today / was due, the account and the long day, the estimator link", () => {
    const b = { id: "b1", name: "Gym reroof bid", due_date: "2026-10-13" };
    expect(bidDueNotice(b, "Bell County Schools", "2026-10-12")).toEqual({
      kind: "bid_due",
      title: "Bid due tomorrow: Gym reroof bid",
      body: "Bell County Schools · due Tuesday, October 13, 2026. Open the estimator to finish and submit it.",
      url: "/estimate?bid=b1",
    });
    expect(bidDueNotice(b, null, "2026-10-13").title).toBe("Bid due today: Gym reroof bid");
    expect(bidDueNotice(b, "  ", "2026-10-13").body).toBe(
      "Due Tuesday, October 13, 2026. Open the estimator to finish and submit it.",
    );
    expect(bidDueNotice(b, "Acme", "2026-10-20").title).toBe("Bid was due Oct 13: Gym reroof bid");
    expect(BID_DUE_NOTICE_KIND).toBe("bid_due");
    expect(kindLabel("bid_due")).toBe("Bid due");
  });
});

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
    created_by: EST,
    account_id: ACC,
    deleted_at: null,
    ...over,
  });
  let env: ReturnType<typeof fakeSupabase>;
  const world = (bids: Row[]) => {
    env = fakeSupabase(
      {
        profiles: [{ id: EST, full_name: "Eve Estimator", email: "eve@example.com" }],
        bids,
        crm_accounts: [{ id: ACC, name: "Bell County Schools" }],
        notifications: [],
        push_subscriptions: [],
      },
      { rpcs: { notify_recipients: recipients } },
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

  it("fires once for a draft due tomorrow — to its maker, through notify(), stamped — and not again", async () => {
    const client = world([bid()]);
    // Oct 13: the counts carry the three rules' own numbers and a list of passes that threw.
    expect(await run(client)).toEqual({
      bids_checked: 1,
      bids_notified: 1,
      bids_silent: 0,
      bids_errors: 0,
      bids_skipped: 0,
      bids_due: 1,
      bids_overdue: 0,
      bids_reminders: 0,
      pass_errors: [],
    });
    expect(inbox()).toHaveLength(1);
    expect(inbox()[0]).toMatchObject({
      user_id: EST,
      kind: "bid_due",
      title: "Bid due tomorrow: Gym reroof bid",
      body: "Bell County Schools · due Tuesday, October 13, 2026. Open the estimator to finish and submit it.",
      url: "/estimate?bid=b1",
    });
    expect(row()["notified_due_at"]).toBe(NOW.toISOString());
    // The next pass, the due day itself: nothing more.
    expect(await run(client, new Date("2026-10-13T15:00:00Z"))).toMatchObject({
      bids_checked: 0,
      bids_notified: 0,
    });
    expect(inbox()).toHaveLength(1);
  });
  it("not yet two days ahead; not for a submitted / won / lost or deleted bid; nothing without a date", async () => {
    const client = world([
      bid({ id: "later", due_date: "2026-10-14" }),
      bid({ id: "sub", status: "submitted" }),
      bid({ id: "won", status: "won" }),
      bid({ id: "lost", status: "lost" }),
      bid({ id: "gone", deleted_at: "2026-10-11T00:00:00Z" }),
      bid({ id: "undated", due_date: null }),
    ]);
    expect(await run(client)).toEqual({
      bids_checked: 0,
      bids_notified: 0,
      bids_silent: 0,
      bids_errors: 0,
      bids_skipped: 0,
      bids_due: 0,
      bids_overdue: 0,
      bids_reminders: 0,
      pass_errors: [],
    });
    expect(inbox()).toEqual([]);
    for (const id of ["later", "sub", "won", "lost", "gone", "undated"])
      expect(row(id)["notified_due_at"]).toBeNull();
  });
  it("the wording follows the day: today on the due day, was due when first seen after it", async () => {
    const client = world([
      bid({ id: "today", due_date: TODAY }),
      bid({ id: "past", due_date: "2026-10-01" }),
    ]);
    expect((await run(client)).bids_notified).toBe(2);
    const titles = inbox().map((n) => n["title"]);
    expect(titles).toContain("Bid due today: Gym reroof bid");
    expect(titles).toContain("Bid was due Oct 1: Gym reroof bid");
  });
  it("a due-date change re-arms it (the trigger nulls the stamp): the new day is noticed once more", async () => {
    const client = world([bid()]);
    await run(client);
    expect(inbox()).toHaveLength(1);
    // The estimator moves the date; the database trigger clears notified_due_at.
    Object.assign(row(), { due_date: "2026-10-20", notified_due_at: null });
    expect((await run(client, new Date("2026-10-15T15:00:00Z"))).bids_checked).toBe(0);
    expect((await run(client, new Date("2026-10-19T15:00:00Z"))).bids_notified).toBe(1);
    expect(inbox()).toHaveLength(2);
    expect(inbox()[1]).toMatchObject({ title: "Bid due tomorrow: Gym reroof bid" });
  });
  it("a bid nobody started (an import) is stamped silently; a failed send is not stamped and retries", async () => {
    const client = world([bid({ id: "nobody", created_by: null })]);
    expect(await run(client)).toMatchObject({ bids_silent: 1, bids_notified: 0 });
    expect(row("nobody")["notified_due_at"]).toBe(NOW.toISOString());
    expect(inbox()).toEqual([]);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    env = fakeSupabase(
      {
        profiles: [{ id: EST, email: "eve@example.com" }],
        bids: [bid()],
        crm_accounts: [],
        notifications: [],
      },
      {
        rpc: (fn) =>
          fn === "notify_recipients" ? { data: null, error: { message: "down" } } : undefined,
      },
    );
    expect(await run(env.db as unknown as Client)).toMatchObject({
      bids_checked: 1,
      bids_notified: 0,
      bids_errors: 1,
    });
    expect(row()["notified_due_at"]).toBeNull();
    expect(row()["notify_error"]).toBe("down");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("bid b1"), "down");
    log.mockRestore();
  });
  it("B2: the claim is a conditional update before the send; a failed send puts the stamp back and keeps the error; the next pass retries and clears it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let down = true;
    env = fakeSupabase(
      {
        profiles: [{ id: EST, email: "eve@example.com" }],
        bids: [bid({ notify_error: null })],
        crm_accounts: [],
        notifications: [],
        push_subscriptions: [],
      },
      {
        rpc: (fn) =>
          fn === "notify_recipients" && down
            ? { data: null, error: { message: "down" } }
            : undefined,
        rpcs: { notify_recipients: recipients },
      },
    );
    const client = env.db as unknown as Client;
    expect(await run(client)).toMatchObject({ bids_errors: 1, bids_notified: 0, bids_skipped: 0 });
    // 1. The claim: the stamp, only where it is still null, clearing the last error.
    const writes = env.writes.filter((w) => w.table === "bids");
    expect(writes[0]).toMatchObject({
      op: "update",
      payload: { notified_due_at: NOW.toISOString(), notify_error: null },
      filters: ["eq id=b1", "is notified_due_at=null"],
      rows: 1,
    });
    // 2. Put back after the failure, only where the row still carries this pass's stamp.
    expect(writes[1]).toMatchObject({
      op: "update",
      payload: { notified_due_at: null, notify_error: "down" },
      filters: ["eq id=b1", `eq notified_due_at=${NOW.toISOString()}`],
      rows: 1,
    });
    expect(writes).toHaveLength(2);
    expect(inbox()).toEqual([]);
    // 3. The next pass sends it, stamps it, and the error is gone.
    down = false;
    expect(await run(client, new Date("2026-10-12T16:00:00Z"))).toMatchObject({
      bids_notified: 1,
      bids_errors: 0,
    });
    expect(inbox()).toHaveLength(1);
    expect(row()).toMatchObject({
      notified_due_at: "2026-10-12T16:00:00.000Z",
      notify_error: null,
    });
    log.mockRestore();
  });
  it("B2: two passes at once (the cron and a page load) claim once: one notice, the other skipped", async () => {
    const client = world([bid()]);
    const [a, b] = await Promise.all([run(client), run(client)]);
    expect(a.bids_checked + b.bids_checked).toBe(2);
    expect(a.bids_notified + b.bids_notified).toBe(1);
    expect(a.bids_skipped + b.bids_skipped).toBe(1);
    expect(a.bids_errors + b.bids_errors).toBe(0);
    expect(inbox()).toHaveLength(1);
    expect(env.writes.filter((w) => w.table === "bids")).toHaveLength(1);
  });
  it("B2: a stamp that moved during the send (a due-date change) is left alone, and said", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    env = fakeSupabase(
      {
        profiles: [{ id: EST, email: "eve@example.com" }],
        bids: [bid()],
        crm_accounts: [],
        notifications: [],
      },
      {
        rpcs: {
          notify_recipients: (_args, tables) => {
            // The estimator moved the due date mid-send: the trigger cleared the stamp.
            Object.assign(tables["bids"]![0]!, { due_date: "2026-10-30", notified_due_at: null });
            throw new Error("down");
          },
        },
      },
    );
    expect(await run(env.db as unknown as Client)).toMatchObject({ bids_errors: 1 });
    // Left as the trigger left it; the error is not written over a row that is no longer ours
    // (the claim had cleared notify_error).
    expect(row()).toMatchObject({ due_date: "2026-10-30", notified_due_at: null });
    expect(row()["notify_error"]).toBeNull();
    expect(env.writes.filter((w) => w.table === "bids")).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("stamp had already moved"));
    log.mockRestore();
  });
  it("reads with the admin client as the task notices do, and selects drafts due within the setting's days (Oct 13: was fixed at tomorrow)", () => {
    const src = read("src/lib/bids-notify.server.ts");
    expect(src).toContain("const admin = await serverClient(sb);");
    expect(src).toContain("const today = localYmd(now, TASK_TZ);");
    expect(src).toContain('.eq("status", "draft")');
    expect(src).toContain('.is("notified_due_at", null)');
    expect(src).toContain("const daysBefore = settings.bid_due_notice_days;");
    expect(src).toContain('.lte("due_date", bidDayPlus(today, daysBefore))');
    expect(src).not.toContain("bidDayPlus(today, 1)");
    expect(src).toContain("bidDueNoticeDue(b, today, daysBefore)");
    expect(src).toContain("await notify([b.created_by], msg, admin);");
    // B2: the claim before the send, the put-back after a failure, both conditional — on the
    // rule's own stamp column, where it still holds what this pass read (null, or the last stamp).
    const claim = src.indexOf("async function claimBidNotice");
    const unclaim = src.indexOf("async function unclaimBidNotice");
    expect(src.slice(claim, unclaim)).toContain(
      '(prev === null ? q.is(col, null) : q.eq(col, prev)).select("id")',
    );
    expect(src.slice(unclaim)).toContain(".eq(col, stamp)");
    expect(src.indexOf("if (!(await claimBidNotice(admin, b.id, col, was, stamp)))")).toBeLessThan(
      src.indexOf("await notify([b.created_by], msg, admin);"),
    );
    expect(src).toContain("await unclaimBidNotice(admin, b.id, col, was, stamp, errText(e));");
    expect(src).toContain("bids_skipped: number;");
  });
});

describe("where it runs", () => {
  it("the cron route: a third pass beside the task notices, reported as `bids`, its failures in `ok`", () => {
    const src = read("src/routes/api.cron.reminders.ts");
    const tasks = src.indexOf('await import("@/lib/tasks-notify.server")');
    const bids = src.indexOf('await import("@/lib/bids-notify.server")');
    expect(tasks).toBeGreaterThan(-1);
    expect(bids).toBeGreaterThan(tasks);
    expect(src).toContain("const b = await dispatchBidDueNotices(supabaseAdmin);");
    expect(src).toContain("sendsFailed += b.bids_errors;");
    expect(src).toContain('console.error("Cron reminders: the bid due notice pass failed", e);');
    expect(src).toMatch(/followups,\s*tasks,\s*bids,\s*cron_stamped: cronStamped,/);
  });
  it("the app's own pass: after the task notices, the same admin client, under the same server-key guard", () => {
    const src = read("src/lib/followups.functions.ts");
    const guard = src.indexOf("if (!hasServiceRole()) out.taskProblem = TASK_NOTICES_NEED_KEY;");
    const tasks = src.indexOf("const t = await dispatchTaskNotices(");
    const bids = src.indexOf("const b = await dispatchBidDueNotices(");
    expect(guard).toBeGreaterThan(-1);
    expect(tasks).toBeGreaterThan(guard);
    expect(bids).toBeGreaterThan(tasks);
    expect(src).toContain("out.bidNotices = b.bids_notified;");
    expect(src).toContain("out.failed += b.bids_errors;");
    expect(src).toContain("bidNotices: number;");
  });
  it("the Admin toast counts them", () => {
    const src = read("src/lib/followups.functions.ts");
    expect(src).toContain(
      "${r.taskNotices} task notices · ${r.bidNotices} bid notices · ${r.failed} failed",
    );
  });
});
