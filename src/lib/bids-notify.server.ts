/**
 * "Bid due tomorrow" (owner, Oct 12) — SERVER ONLY (uses notify.server.ts, which may load the
 * service-role client; load this with `await import("@/lib/bids-notify.server")` inside a
 * handler, as the task notices are).
 *
 * One notice per draft bid to whoever started it (created_by), through notify() like every other
 * notice (an inbox row always; email / push by the recipient's own settings), once today is the
 * day before the due date or later (bid-status.ts bidDueNoticeDue), stamped on the row
 * (bids.notified_due_at) so it fires once; moving the due date clears the stamp (the trigger
 * bids_due_notice_reset), so the new day gets its own. Runs from /api/cron/reminders and from the
 * app's own pass (followups.functions.ts dispatchRemindersIfDue), beside the task notices, with
 * the admin client as they use (hasServiceRole guard: skipped on the preview with the same
 * reason).
 *
 * Each bid is CLAIMED before anything is sent (owner, Oct 12, B2; as the follow-up reminders and
 * the escalations are): one conditional update stamps notified_due_at only where it is still
 * null. Two passes at once (the cron and an office user's page load) both read the bid, but only
 * one update matches; the other affects no row and sends nothing (`bids_skipped`). When the send
 * then fails the stamp is put back to null — only where the row still carries this pass's stamp
 * (the claim's own optimistic lock, the other way round; notify.server.ts unclaimReminder) — and
 * the failure is kept on bids.notify_error (20261012180000; Admin › Reminders lists them), so the
 * next pass retries it. A claim clears notify_error; a send that lands leaves it clear.
 */
import type { Database } from "@/integrations/supabase/types";
import { bidDayPlus, bidDueNotice, bidDueNoticeDue } from "@/lib/bid-status";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import { localYmd, TASK_TZ } from "@/lib/tasks";

export interface BidNoticeResult {
  /** Draft bids due by tomorrow with no notice yet. */
  bids_checked: number;
  /** Notices sent (one per bid). */
  bids_notified: number;
  /** Bids with nobody to tell (no created_by): stamped, nothing sent. */
  bids_silent: number;
  /** Sends that failed; the stamp is put back, so the next pass tries again. */
  bids_errors: number;
  /** Bids another pass claimed first (the cron and a page load at once): nothing sent. */
  bids_skipped: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * bids.notify_error arrives with 20261012180000_bid_notice_claim.sql; the generated types
 * (another agent's file to regenerate) do not list it yet, so the patch is asserted to the
 * row's Update type. Before that migration is applied PostgREST refuses the unknown column
 * (PGRST204): the write is made again without it, so the stamp still lands.
 */
type BidPatch = Database["public"]["Tables"]["bids"]["Update"];
const isMissingColumn = (e: { code?: string; message?: string }, col: string) =>
  e.code === "PGRST204" || (e.message ?? "").includes(`'${col}' column`);

/**
 * Claim the bid: notified_due_at = now where it is still null (and notify_error cleared).
 * True when this pass got it.
 */
async function claimBidNotice(admin: Client, id: string, stamp: string): Promise<boolean> {
  const claim = (withError: boolean) =>
    admin
      .from("bids")
      .update(
        (withError
          ? { notified_due_at: stamp, notify_error: null }
          : { notified_due_at: stamp }) as BidPatch,
      )
      .eq("id", id)
      .is("notified_due_at", null)
      .select("id");
  let { data: won, error } = await claim(true);
  if (error && isMissingColumn(error, "notify_error")) ({ data: won, error } = await claim(false));
  if (error) throw new Error(error.message);
  return !!won?.length;
}

/**
 * Put a claimed bid back after its send failed, so the next pass retries it: notified_due_at
 * returns to null and the failure is kept on notify_error — only where the row still holds this
 * pass's stamp (a due-date change, or another pass, has moved it otherwise: left alone). Never
 * throws: a restore that could not be made is logged, and the bid waits (stamped, as before Oct
 * 12) rather than risk a second notice.
 */
async function unclaimBidNotice(admin: Client, id: string, stamp: string, problem: string) {
  try {
    const back = (withError: boolean) =>
      admin
        .from("bids")
        .update(
          (withError
            ? { notified_due_at: null, notify_error: problem.slice(0, 1000) }
            : { notified_due_at: null }) as BidPatch,
        )
        .eq("id", id)
        .eq("notified_due_at", stamp)
        .select("id");
    let { data: rows, error } = await back(true);
    if (error && isMissingColumn(error, "notify_error"))
      ({ data: rows, error } = await back(false));
    if (error) throw new Error(error.message);
    if (!rows?.length)
      console.error(`Bid due notice: bid ${id} failed to send and its stamp had already moved`);
  } catch (e) {
    console.error(
      `Bid due notice: bid ${id} failed to send and could not be put back for a retry — ${errText(e)}`,
    );
  }
}

export async function dispatchBidDueNotices(
  sb: Client,
  now: Date = new Date(),
): Promise<BidNoticeResult> {
  const admin = await serverClient(sb);
  const today = localYmd(now, TASK_TZ);
  // Draft, dated, not yet noticed, due by tomorrow (the day-before rule; an older due day is
  // noticed on first sight too). notified_due_at arrives with 20261012140000_bid_due_date.sql.
  const { data, error } = await admin
    .from("bids")
    .select("id, name, status, due_date, notified_due_at, created_by, account_id")
    .is("deleted_at", null)
    .eq("status", "draft")
    .is("notified_due_at", null)
    // (A null due_date never satisfies lte, so undated drafts are out without a second filter.)
    .lte("due_date", bidDayPlus(today, 1))
    .order("due_date", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((b) => bidDueNoticeDue(b, today));
  const out: BidNoticeResult = {
    bids_checked: rows.length,
    bids_notified: 0,
    bids_silent: 0,
    bids_errors: 0,
    bids_skipped: 0,
  };
  if (!rows.length) return out;
  const accountIds = [...new Set(rows.map((b) => b.account_id).filter((x): x is string => !!x))];
  const accountName = new Map<string, string>();
  if (accountIds.length) {
    const { data: accounts } = await admin
      .from("crm_accounts")
      .select("id, name")
      .in("id", accountIds);
    for (const a of accounts ?? []) accountName.set(a.id, a.name);
  }
  const stamp = now.toISOString();
  for (const b of rows) {
    // 1. Claim (see above). Lost to another pass: skip.
    if (!(await claimBidNotice(admin, b.id, stamp))) {
      out.bids_skipped++;
      continue;
    }
    // 2. Nobody to tell: the stamp stands, nothing goes out.
    if (!b.created_by) {
      out.bids_silent++;
      continue;
    }
    // 3. The notice; a failure puts the stamp back and is kept on the row for the next pass.
    const msg = bidDueNotice(
      { id: b.id, name: b.name, due_date: b.due_date! },
      b.account_id ? accountName.get(b.account_id) : null,
      today,
    );
    try {
      await notify([b.created_by], msg, admin);
      out.bids_notified++;
    } catch (e) {
      out.bids_errors++;
      console.error(`Bid due notice: bid ${b.id} —`, errText(e));
      await unclaimBidNotice(admin, b.id, stamp, errText(e));
    }
  }
  return out;
}
