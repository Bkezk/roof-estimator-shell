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
 */
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
  /** Sends that failed; the bid is not stamped, so the next pass tries again. */
  bids_errors: number;
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
  for (const b of rows) {
    if (b.created_by) {
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
        console.error(`Bid due notice: bid ${b.id} —`, e instanceof Error ? e.message : e);
        continue; // not stamped: the next pass tries again
      }
    } else out.bids_silent++;
    const { error: upErr } = await admin
      .from("bids")
      .update({ notified_due_at: now.toISOString() })
      .eq("id", b.id);
    if (upErr) throw new Error(upErr.message);
  }
  return out;
}
