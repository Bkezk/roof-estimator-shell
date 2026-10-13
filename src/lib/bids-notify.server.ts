/**
 * The bid notices (owner, Oct 12 / 13) — SERVER ONLY (uses notify.server.ts, which may load the
 * service-role client; load this with `await import("@/lib/bids-notify.server")` inside a
 * handler, as the task notices are). Three rules, one module, one entry (dispatchBidDueNotices),
 * run from /api/cron/reminders and from the app's own pass (followups.functions.ts
 * dispatchRemindersIfDue), beside the task notices, with the admin client as they use
 * (hasServiceRole guard: skipped on the preview with the same reason). Each goes to whoever
 * started the bid (created_by), through notify() like every other notice (an inbox row always;
 * email / push by the recipient's own settings), and each is stamped on the row so it fires
 * once (the owner's rule: one notice per rule per day at most):
 *
 *  1. "Bid due" (kind bid_due; Oct 12): a draft, once today is crm_settings.bid_due_notice_days
 *     before its due date or later (Admin › Reminders › Bids; was fixed at the day before);
 *     stamp bids.notified_due_at. Rule: bid-status.ts bidDueNoticeDue.
 *  2. "Bid past due" (kind bid_overdue; Oct 13): a draft past its due date, the day after it and
 *     then every crm_settings.bid_overdue_every_days — null = never, the default; stamp
 *     bids.notified_overdue_at (the last one). Rule: bidOverdueNoticeDue.
 *  3. "Bid reminder" (kind bid_reminder; Oct 13): the estimator's own "Remind me on" date
 *     (bids.reminder_on, with its note), on that day, ANY status — the user asked for it; stamp
 *     bids.reminded_at. Rule: bidReminderDue.
 * Moving the due date clears the first two stamps, changing reminder_on clears the third (the
 * trigger bids_due_notice_reset, 20261013160000_bid_reminders.sql), so a new day is noticed once.
 *
 * Each bid is CLAIMED before anything is sent (owner, Oct 12, B2; as the follow-up reminders and
 * the escalations are): one conditional update stamps the rule's column only where it still
 * holds the value this pass read (null for the first two notices and the reminder; the last
 * stamp for a past-due repeat). Two passes at once (the cron and an office user's page load)
 * both read the bid, but only one update matches; the other affects no row and sends nothing
 * (`bids_skipped`). When the send then fails the stamp is put back to what it was — only where
 * the row still carries this pass's stamp (the claim's own optimistic lock, the other way round;
 * notify.server.ts unclaimReminder) — and the failure is kept on bids.notify_error
 * (20261012180000; Admin › Reminders lists them), so the next pass retries it. A claim clears
 * notify_error; a send that lands leaves it clear.
 *
 * The three passes run one after the other, each inside its own try/catch: one that throws as a
 * whole (a missing column before its migration is applied, say) is logged, counted in
 * `bids_errors` and named in `pass_errors`, and the other two still run.
 */
import type { Database } from "@/integrations/supabase/types";
import {
  bidDayPlus,
  bidDueNotice,
  bidDueNoticeDue,
  bidOverdueNotice,
  bidOverdueNoticeDue,
  bidReminderDue,
  bidReminderNotice,
  bidReminderSettings,
  type BidReminderSettings,
} from "@/lib/bid-status";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import { localYmd, TASK_TZ } from "@/lib/tasks";

export interface BidNoticeResult {
  /** Bids whose notice was due this pass (the three rules together). */
  bids_checked: number;
  /** Notices sent (one per bid per rule). */
  bids_notified: number;
  /** Bids with nobody to tell (no created_by): stamped, nothing sent. */
  bids_silent: number;
  /**
   * Sends that failed (the stamp is put back, so the next pass tries again), plus one for each
   * rule's pass that threw as a whole (named in `pass_errors`).
   */
  bids_errors: number;
  /** Bids another pass claimed first (the cron and a page load at once): nothing sent. */
  bids_skipped: number;
  /** "Bid due" notices sent (Oct 12). */
  bids_due: number;
  /** "Bid past due" notices sent (Oct 13). */
  bids_overdue: number;
  /** "Bid reminder" notices sent — the estimator's own date (Oct 13). */
  bids_reminders: number;
  /** A rule's pass that threw as a whole: "<rule>: <why>". */
  pass_errors: string[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * bids.notify_error arrives with 20261012180000_bid_notice_claim.sql; the generated types
 * (another agent's file to regenerate) may not list it, so the patch is asserted to the row's
 * Update type. Before that migration is applied PostgREST refuses the unknown column (PGRST204):
 * the write is made again without it, so the stamp still lands.
 */
type BidPatch = Database["public"]["Tables"]["bids"]["Update"];
const isMissingColumn = (e: { code?: string; message?: string }, col: string) =>
  e.code === "PGRST204" || (e.message ?? "").includes(`'${col}' column`);

/** The stamp column each rule claims. */
type StampColumn = "notified_due_at" | "notified_overdue_at" | "reminded_at";

/**
 * Claim the bid for one rule: `col` = now where it still holds `prev` — null for a first notice
 * (`.is(col, null)`), the last stamp for a past-due repeat (`.eq(col, prev)`) — and notify_error
 * cleared. True when this pass got it.
 */
async function claimBidNotice(
  admin: Client,
  id: string,
  col: StampColumn,
  prev: string | null,
  stamp: string,
): Promise<boolean> {
  const claim = (withError: boolean) => {
    const q = admin
      .from("bids")
      .update((withError ? { [col]: stamp, notify_error: null } : { [col]: stamp }) as BidPatch)
      .eq("id", id);
    return (prev === null ? q.is(col, null) : q.eq(col, prev)).select("id");
  };
  let { data: won, error } = await claim(true);
  if (error && isMissingColumn(error, "notify_error")) ({ data: won, error } = await claim(false));
  if (error) throw new Error(error.message);
  return !!won?.length;
}

/**
 * Put a claimed bid back after its send failed, so the next pass retries it: `col` returns to
 * `prev` (null, or the last stamp) and the failure is kept on notify_error — only where the row
 * still holds this pass's stamp (a due-date change, or another pass, has moved it otherwise:
 * left alone). Never throws: a restore that could not be made is logged, and the bid waits
 * (stamped, as before Oct 12) rather than risk a second notice.
 */
async function unclaimBidNotice(
  admin: Client,
  id: string,
  col: StampColumn,
  prev: string | null,
  stamp: string,
  problem: string,
) {
  try {
    const back = (withError: boolean) =>
      admin
        .from("bids")
        .update(
          (withError
            ? { [col]: prev, notify_error: problem.slice(0, 1000) }
            : { [col]: prev }) as BidPatch,
        )
        .eq("id", id)
        .eq(col, stamp)
        .select("id");
    let { data: rows, error } = await back(true);
    if (error && isMissingColumn(error, "notify_error"))
      ({ data: rows, error } = await back(false));
    if (error) throw new Error(error.message);
    if (!rows?.length)
      console.error(`Bid notice: bid ${id} failed to send and its stamp had already moved`);
  } catch (e) {
    console.error(
      `Bid notice: bid ${id} failed to send and could not be put back for a retry — ${errText(e)}`,
    );
  }
}

/**
 * The Bids settings (crm_settings, one row). No row, or the columns missing before
 * 20261013160000 is applied (PostgREST 42703 / PGRST204): the defaults (the day before; never
 * past due), so the Oct 12 notice keeps going as it did. (Plain select / eq / limit, as the rest
 * of this module: the stand-ins the reminder passes are tested with speak no more than that.)
 */
export async function readBidReminderSettings(admin: Client): Promise<BidReminderSettings> {
  const { data, error } = await admin
    .from("crm_settings")
    .select("bid_due_notice_days, bid_overdue_every_days")
    .eq("id", 1)
    .limit(1);
  if (error) {
    if (/bid_due_notice_days|bid_overdue_every_days|schema cache/i.test(error.message))
      return bidReminderSettings(null);
    throw new Error(error.message);
  }
  return bidReminderSettings(data?.[0]);
}

type BidRow = {
  id: string;
  name: string;
  status: string | null;
  due_date: string | null;
  created_by: string | null;
  account_id: string | null;
  notified_due_at: string | null;
  notified_overdue_at: string | null;
  reminder_on: string | null;
  reminder_note: string | null;
  reminded_at: string | null;
};

/** The account names of a set of bids, for the notices' bodies (one read). */
async function accountNames(admin: Client, rows: BidRow[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((b) => b.account_id).filter((x): x is string => !!x))];
  if (!ids.length) return names;
  const { data } = await admin.from("crm_accounts").select("id, name").in("id", ids);
  for (const a of data ?? []) names.set(a.id, a.name);
  return names;
}

interface Outgoing {
  kind: string;
  title: string;
  body: string;
  url: string;
}

/**
 * One rule's pass over its due bids: claim, send, stamp (or put back). `prev` is what the rule's
 * stamp column held when the bid was read (its optimistic lock).
 */
async function sendBidNotices(
  admin: Client,
  label: string,
  rows: BidRow[],
  col: StampColumn,
  prev: (b: BidRow) => string | null,
  words: (b: BidRow, accountName: string | null) => Outgoing,
  stamp: string,
  out: BidNoticeResult,
  counter: "bids_due" | "bids_overdue" | "bids_reminders",
) {
  out.bids_checked += rows.length;
  if (!rows.length) return;
  const names = await accountNames(admin, rows);
  for (const b of rows) {
    const was = prev(b);
    // 1. Claim (see above). Lost to another pass: skip.
    if (!(await claimBidNotice(admin, b.id, col, was, stamp))) {
      out.bids_skipped++;
      continue;
    }
    // 2. Nobody to tell: the stamp stands, nothing goes out.
    if (!b.created_by) {
      out.bids_silent++;
      continue;
    }
    // 3. The notice; a failure puts the stamp back and is kept on the row for the next pass.
    const msg = words(b, b.account_id ? (names.get(b.account_id) ?? null) : null);
    try {
      await notify([b.created_by], msg, admin);
      out.bids_notified++;
      out[counter]++;
    } catch (e) {
      out.bids_errors++;
      console.error(`${label}: bid ${b.id} —`, errText(e));
      await unclaimBidNotice(admin, b.id, col, was, stamp, errText(e));
    }
  }
}

const BID_COLUMNS =
  "id, name, status, due_date, created_by, account_id, notified_due_at, notified_overdue_at, reminder_on, reminder_note, reminded_at";

/** 1. "Bid due": draft, dated, not yet noticed, due within `daysBefore` days (or already past). */
async function dueNotices(
  admin: Client,
  today: string,
  stamp: string,
  settings: BidReminderSettings,
  out: BidNoticeResult,
) {
  const daysBefore = settings.bid_due_notice_days;
  // (A null due_date never satisfies lte, so undated drafts are out without a second filter.)
  const { data, error } = await admin
    .from("bids")
    .select(BID_COLUMNS)
    .is("deleted_at", null)
    .eq("status", "draft")
    .is("notified_due_at", null)
    .lte("due_date", bidDayPlus(today, daysBefore))
    .order("due_date", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as BidRow[]).filter((b) => bidDueNoticeDue(b, today, daysBefore));
  await sendBidNotices(
    admin,
    "Bid due notice",
    rows,
    "notified_due_at",
    () => null,
    (b, who) => bidDueNotice({ id: b.id, name: b.name, due_date: b.due_date! }, who, today),
    stamp,
    out,
    "bids_due",
  );
}

/** 2. "Bid past due": draft, due before today, every `bid_overdue_every_days` (null: nothing). */
async function overdueNotices(
  admin: Client,
  today: string,
  stamp: string,
  settings: BidReminderSettings,
  out: BidNoticeResult,
) {
  const every = settings.bid_overdue_every_days;
  if (every === null) return;
  // Due before today = due by yesterday (whole days).
  const { data, error } = await admin
    .from("bids")
    .select(BID_COLUMNS)
    .is("deleted_at", null)
    .eq("status", "draft")
    .lte("due_date", bidDayPlus(today, -1))
    .order("due_date", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as BidRow[]).filter((b) => bidOverdueNoticeDue(b, today, every));
  await sendBidNotices(
    admin,
    "Bid past due notice",
    rows,
    "notified_overdue_at",
    (b) => b.notified_overdue_at ?? null,
    (b, who) => bidOverdueNotice({ id: b.id, name: b.name, due_date: b.due_date! }, who, today),
    stamp,
    out,
    "bids_overdue",
  );
}

/** 3. "Bid reminder": the estimator's own date, by today, not yet sent — any status. */
async function reminderNotices(admin: Client, today: string, stamp: string, out: BidNoticeResult) {
  const { data, error } = await admin
    .from("bids")
    .select(BID_COLUMNS)
    .is("deleted_at", null)
    .is("reminded_at", null)
    .lte("reminder_on", today)
    .order("reminder_on", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as BidRow[]).filter((b) => bidReminderDue(b, today));
  await sendBidNotices(
    admin,
    "Bid reminder",
    rows,
    "reminded_at",
    () => null,
    (b, who) => bidReminderNotice({ id: b.id, name: b.name, reminder_note: b.reminder_note }, who),
    stamp,
    out,
    "bids_reminders",
  );
}

export async function dispatchBidDueNotices(
  sb: Client,
  now: Date = new Date(),
): Promise<BidNoticeResult> {
  const admin = await serverClient(sb);
  const today = localYmd(now, TASK_TZ);
  const stamp = now.toISOString();
  const out: BidNoticeResult = {
    bids_checked: 0,
    bids_notified: 0,
    bids_silent: 0,
    bids_errors: 0,
    bids_skipped: 0,
    bids_due: 0,
    bids_overdue: 0,
    bids_reminders: 0,
    pass_errors: [],
  };
  const settings = await readBidReminderSettings(admin);
  const passes: [string, () => Promise<void>][] = [
    ["Bid due", () => dueNotices(admin, today, stamp, settings, out)],
    ["Bid past due", () => overdueNotices(admin, today, stamp, settings, out)],
    ["Bid reminder", () => reminderNotices(admin, today, stamp, out)],
  ];
  for (const [label, pass] of passes) {
    try {
      await pass();
    } catch (e) {
      // One rule's pass failing as a whole never stops the other two.
      console.error(`${label} pass failed`, e);
      out.bids_errors++;
      out.pass_errors.push(`${label}: ${errText(e)}`);
    }
  }
  return out;
}
