/**
 * Bid status — four states (owner, Sep 24): Draft (ours), Submitted (with the customer), Won,
 * Lost. The legacy Bid-Advantage pipeline (In Progress → Finished → Submitted → Review → Final →
 * Accepted / Denied) folds into these when an old value is read.
 */
import { localYmd, TASK_TZ } from "@/lib/tasks";

export const BID_STATUSES = ["draft", "submitted", "won", "lost"] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const STATUS_LABELS: Record<BidStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
};

/** Badge tint per status. */
export const STATUS_BADGE_CLASSES: Record<BidStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  lost: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const LEGACY: Record<string, BidStatus> = {
  in_progress: "draft",
  finished: "draft",
  review: "draft",
  final: "draft",
  accepted: "won",
  denied: "lost",
};

/** Coerce a stored status string to a known status (legacy and unknown values fold in). */
export const asBidStatus = (s: string | null | undefined): BidStatus =>
  (BID_STATUSES as readonly string[]).includes(s ?? "")
    ? (s as BidStatus)
    : (LEGACY[s ?? ""] ?? "draft");

/** Seeded reasons a bid was lost; "Other" takes free text. */
export const LOST_REASONS = [
  "Price",
  "Chose another contractor",
  "Postponed / no budget this year",
  "Repaired instead of replaced",
  "Went with a different roof system",
  "Scope or specification changed",
  "No response from customer",
  "Other",
] as const;

/**
 * The bid drives the opportunity it was started from, one direction only (owner, Oct 12). The
 * opportunity's new status for a bid status, or null when it should not move: Submitted makes an
 * Open / Contacted opportunity Quoted (never backwards from Won / Lost / No response); Won makes
 * it Won; Lost makes it Lost; Draft moves nothing. Changing the opportunity never changes the bid
 * (someone may close an opportunity to clear their board while the bid is still being worked).
 * The twin of the database's opportunity_status_from_bid (20261012100000).
 */
export function oppStatusFromBid(
  bidStatus: string | null | undefined,
  oppStatus: string | null | undefined,
): "quoted" | "won" | "lost" | null {
  const b = asBidStatus(bidStatus);
  if (b === "submitted") return oppStatus === "open" || oppStatus === "contacted" ? "quoted" : null;
  if (b === "won") return oppStatus === "won" ? null : "won";
  if (b === "lost") return oppStatus === "lost" ? null : "lost";
  return null;
}

/**
 * The stamps a status write carries (owner, Oct 12): status_changed_at when the status changes;
 * submitted_at the first time it becomes submitted, never overwritten after (an older stamp
 * stays). Nothing when the status is the same.
 */
export function bidStatusStamps(
  cur: { status: string | null | undefined; submitted_at: string | null | undefined } | null,
  next: string,
  nowIso: string = new Date().toISOString(),
): { status_changed_at?: string; submitted_at?: string } {
  const prev = cur ? asBidStatus(cur.status) : null;
  const to = asBidStatus(next);
  if (prev === to) return {};
  const out: { status_changed_at?: string; submitted_at?: string } = {};
  if (cur) out.status_changed_at = nowIso;
  if (to === "submitted" && !cur?.submitted_at) out.submitted_at = nowIso;
  return out;
}

/** Today as the office's calendar day (YYYY-MM-DD, TASK_TZ) — the day a bid is marked Won on. */
export const bidOfficeToday = (): string => localYmd(new Date(), TASK_TZ);

/**
 * The day a bid was won (bids.won_on; owner, Oct 21: "there also needs to be a way to adjust the
 * date the bid was won to ensure the data appears correctly … go with the bid won on day add").
 * The Margin report counts a won bid on this day. The one rule, applied by saveBid and
 * setBidStatus alike: when the bid is (or becomes) won, won_on is the day given (`next.wonOn`,
 * YYYY-MM-DD; anything else counts as not given), else the day already stored, else — for a bid
 * that was ALREADY won before the column existed — the office's day of its status_changed_at
 * (the day it was marked Won; the day the Margin report was already dating it by, so saving it
 * once to store its figures does not move it to today), else `today` (the office's day,
 * bidOfficeToday). So a won bid never has a blank won_on, and a day picked in the estimator or
 * the Bids list wins over the stored one. Any other status clears it, whatever day came with it:
 * a draft or a lost bid has no won day.
 */
export function wonOnColumns(
  prev: {
    status: string | null | undefined;
    won_on: string | null | undefined;
    status_changed_at?: string | null | undefined;
  } | null,
  next: { status: string | null | undefined; wonOn?: string | null | undefined },
  today: string,
): { won_on: string | null } {
  if (asBidStatus(next.status) !== "won") return { won_on: null };
  const given = next.wonOn && YMD.test(next.wonOn) ? next.wonOn : null;
  if (given) return { won_on: given };
  if (prev?.won_on) return { won_on: prev.won_on };
  if (prev && asBidStatus(prev.status) === "won" && prev.status_changed_at)
    return { won_on: stampDay(prev.status_changed_at) };
  return { won_on: today };
}

/** The line on the opportunity's bid card and beside the estimator's Status select. */
export const BID_DRIVES_OPP_NOTE =
  "Won/Lost on the bid updates this opportunity; closing the opportunity leaves the bid alone.";
/** "From opportunity: <title>" on the Bids page and in the estimator (bids.opportunity_id). */
export const fromOpportunityLine = (title: string) => `From opportunity: ${title}`;

// ---- the bid due date (owner, Oct 12) --------------------------------------------------------

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The message a first save without a due date gets, in the estimator and from the server. */
export const BID_DUE_REQUIRED = "Give the bid a due date before saving";
/** Clearing the date on a bid still in play (draft / submitted) is refused with this. */
export const BID_DUE_KEEP =
  "A draft or submitted bid keeps its due date; clear it only on a won or lost bid";
/** The amber hint on a bid saved before due dates existed (the estimator's Bid due box). */
export const BID_NO_DUE_HINT = "No due date — it will not show on Work Overview until one is set";

/**
 * The one due-date rule (owner, Oct 12: "at the origination of bids we should have a bid due
 * date required"): a NEW bid (the first save, the one that inserts the row) must carry a day;
 * after that it can be changed any time and cleared only on a won / lost bid. A bid from before
 * due dates existed (`hadDueDate` false) is never blocked — it saves without one and the
 * estimator shows BID_NO_DUE_HINT instead. The estimator and saveBid both call this, so the
 * message is the same on both sides. Null when the save may go ahead.
 */
export function bidDueDateProblem(input: {
  /** No row yet: the save that inserts it. */
  isNew: boolean;
  /** The day the save carries (YYYY-MM-DD), null / "" for none, undefined for "leave as is". */
  dueDate: string | null | undefined;
  /** The status the bid is saved with. */
  status: string | null | undefined;
  /** Did the stored row already have a due date? (Clearing one is the case this guards.) */
  hadDueDate?: boolean;
}): string | null {
  const day = input.dueDate ? input.dueDate : null;
  if (day && !YMD.test(day)) return "The bid due date must be a day (YYYY-MM-DD)";
  if (input.isNew) return day ? null : BID_DUE_REQUIRED;
  if (input.dueDate === undefined) return null;
  const st = asBidStatus(input.status);
  if (!day && input.hadDueDate && st !== "won" && st !== "lost") return BID_DUE_KEEP;
  return null;
}

// ---- the "Bid due tomorrow" notice (owner, Oct 12) and the bid reminders (owner, Oct 13) ----

/** The inbox kind of the notice (notifications.functions.ts KIND_LABELS: "Bid due"). */
export const BID_DUE_NOTICE_KIND = "bid_due";
/** The past-due repeat's kind (KIND_LABELS: "Bid past due"). */
export const BID_OVERDUE_NOTICE_KIND = "bid_overdue";
/** The estimator's own "Remind me on" notice (KIND_LABELS: "Bid reminder"). */
export const BID_REMINDER_KIND = "bid_reminder";

/**
 * The Bids group on Admin › Reminders (crm_settings; 20261013160000_bid_reminders.sql):
 * bid_due_notice_days — the "Bid due" notice goes this many days before the due date (0 = on the
 * due day; was fixed at 1); bid_overdue_every_days — while a draft is past due, remind again
 * every N days, null = never (the owner's rule: nothing unless asked).
 */
export interface BidReminderSettings {
  bid_due_notice_days: number;
  bid_overdue_every_days: number | null;
}
export const BID_REMINDER_DEFAULTS: Readonly<BidReminderSettings> = {
  bid_due_notice_days: 1,
  bid_overdue_every_days: null,
};
export const BID_DUE_NOTICE_DAYS_MAX = 30;
export const BID_OVERDUE_EVERY_DAYS_MAX = 365;
/** The "About" box on Setup › Bid Info (bids.reminder_note): at most this many characters. */
export const BID_REMINDER_NOTE_MAX = 200;
export const BID_REMINDER_NOTE_PLACEHOLDER = "e.g. call Mark about the addendum";
/**
 * The settings row as the pass reads it (missing columns — the migration not applied yet — or
 * no row: the defaults); an out-of-range value is brought back to the defaults' range.
 */
export function bidReminderSettings(row: Partial<BidReminderSettings> | null | undefined) {
  const n = row?.bid_due_notice_days;
  const e = row?.bid_overdue_every_days;
  return {
    bid_due_notice_days:
      Number.isInteger(n) && (n as number) >= 0 && (n as number) <= BID_DUE_NOTICE_DAYS_MAX
        ? (n as number)
        : BID_REMINDER_DEFAULTS.bid_due_notice_days,
    bid_overdue_every_days:
      Number.isInteger(e) && (e as number) >= 1 && (e as number) <= BID_OVERDUE_EVERY_DAYS_MAX
        ? (e as number)
        : null,
  } satisfies BidReminderSettings;
}

const utcDay = (ymd: string) => {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
/** YYYY-MM-DD plus `n` days (calendar arithmetic). */
export const bidDayPlus = (ymd: string, n: number) =>
  new Date(utcDay(ymd) + n * 86400000).toISOString().slice(0, 10);
/** Whole days from `from` to `to` (both YYYY-MM-DD; negative when `to` is earlier). */
export const bidDaysBetween = (from: string, to: string) =>
  Math.round((utcDay(to) - utcDay(from)) / 86400000);
const fmtDay = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(utcDay(ymd)).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const longDay = (ymd: string) =>
  fmtDay(ymd, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
/** The office's calendar day (YYYY-MM-DD) of a stamp (an ISO instant), in TASK_TZ. */
const stampDay = (iso: string) => localYmd(new Date(iso), TASK_TZ);

/**
 * Is a bid's notice due on `today` (the office's day, YYYY-MM-DD)? A draft with a due date, not
 * yet noticed (`notified_due_at` null), once today is `daysBefore` days before the due date or
 * later (Admin › Reminders › Bids, "Notice N days before a bid is due"; 0 = on the due day; the
 * default 1 is the Oct 12 "day before" rule) — so a bid made late, on the due day or after it,
 * still gets its one notice, and never a second (the stamp; moving the date clears it, so the
 * new day is noticed once).
 */
export function bidDueNoticeDue(
  bid: {
    status: string | null;
    due_date: string | null | undefined;
    notified_due_at: string | null | undefined;
  },
  today: string,
  daysBefore: number = BID_REMINDER_DEFAULTS.bid_due_notice_days,
): boolean {
  if (asBidStatus(bid.status) !== "draft") return false;
  if (!bid.due_date || !YMD.test(bid.due_date) || bid.notified_due_at) return false;
  const n = Number.isInteger(daysBefore) && daysBefore >= 0 ? daysBefore : 1;
  return today >= bidDayPlus(bid.due_date, -n);
}

/**
 * The notice's words: "Bid due tomorrow: <name>" the day before ("Bid due in N days" further
 * out, when the setting says so); "Bid due today: <name>" on the day; "Bid was due Oct 13:
 * <name>" when first seen after it. Body: "<account> · due Tuesday, October 13, 2026. Open the
 * estimator to finish and submit it." (no account: "Due …").
 */
export function bidDueNotice(
  bid: { id: string; name: string; due_date: string },
  accountName: string | null | undefined,
  today: string,
): { kind: string; title: string; body: string; url: string } {
  const due = bid.due_date;
  const ahead = bidDaysBetween(today, due);
  const head =
    ahead > 1
      ? `Bid due in ${ahead} days`
      : ahead === 1
        ? "Bid due tomorrow"
        : ahead === 0
          ? "Bid due today"
          : `Bid was due ${fmtDay(due, { month: "short", day: "numeric" })}`;
  const who = (accountName ?? "").trim();
  return {
    kind: BID_DUE_NOTICE_KIND,
    title: `${head}: ${bid.name}`,
    body: `${who ? `${who} · due` : "Due"} ${longDay(due)}. Open the estimator to finish and submit it.`,
    url: `/estimate?bid=${bid.id}`,
  };
}

/**
 * The past-due repeat (owner, Oct 13; Admin › Reminders › Bids, "Then every N days while a
 * draft is past due"): a draft whose due date has passed, when the setting is on (`everyDays`
 * 1–365; null / 0 = never), on the day after the due date when it has never been noticed past
 * due, then again once `everyDays` days have passed since the last past-due notice (its stamp's
 * office day). Never for a submitted / won / lost bid; moving the due date clears the stamp
 * (the trigger), so the count starts over from the new day.
 */
export function bidOverdueNoticeDue(
  bid: {
    status: string | null;
    due_date: string | null | undefined;
    notified_overdue_at: string | null | undefined;
  },
  today: string,
  everyDays: number | null | undefined,
): boolean {
  if (!Number.isInteger(everyDays) || (everyDays as number) < 1) return false;
  if (asBidStatus(bid.status) !== "draft") return false;
  if (!bid.due_date || !YMD.test(bid.due_date) || !YMD.test(today)) return false;
  if (!(bid.due_date < today)) return false;
  if (!bid.notified_overdue_at) return today >= bidDayPlus(bid.due_date, 1);
  return today >= bidDayPlus(stampDay(bid.notified_overdue_at), everyDays as number);
}

/**
 * "Bid past due: <name>" — body: "3 days past due (due Tuesday, October 13, 2026) · <account>.
 * Open the estimator to submit it, or mark it won or lost." (one day: "1 day past due").
 */
export function bidOverdueNotice(
  bid: { id: string; name: string; due_date: string },
  accountName: string | null | undefined,
  today: string,
): { kind: string; title: string; body: string; url: string } {
  const days = Math.max(1, bidDaysBetween(bid.due_date, today));
  const who = (accountName ?? "").trim();
  return {
    kind: BID_OVERDUE_NOTICE_KIND,
    title: `Bid past due: ${bid.name}`,
    body: `${days} day${days === 1 ? "" : "s"} past due (due ${longDay(bid.due_date)})${who ? ` · ${who}` : ""}. Open the estimator to submit it, or mark it won or lost.`,
    url: `/estimate?bid=${bid.id}`,
  };
}

/**
 * The estimator's own reminder (owner, Oct 13: "can we have users who set a bid set up a custom
 * reminder on there as well on setup?"): on the day the user picked (bids.reminder_on) or the
 * first pass after it, once (reminded_at; changing the date clears it), whatever the bid's
 * status — the user asked for it. A deleted bid is never reminded (the pass filters deleted_at).
 */
export function bidReminderDue(
  bid: { reminder_on: string | null | undefined; reminded_at: string | null | undefined },
  today: string,
): boolean {
  if (!bid.reminder_on || !YMD.test(bid.reminder_on) || bid.reminded_at) return false;
  return today >= bid.reminder_on;
}

/**
 * "Bid reminder: <name>" with the user's note as the body (none: "You asked to be reminded about
 * this bid today." — with the account's name when there is one), linking to the estimator.
 */
export function bidReminderNotice(
  bid: { id: string; name: string; reminder_note: string | null | undefined },
  accountName: string | null | undefined,
): { kind: string; title: string; body: string; url: string } {
  const note = (bid.reminder_note ?? "").trim();
  const who = (accountName ?? "").trim();
  return {
    kind: BID_REMINDER_KIND,
    title: `Bid reminder: ${bid.name}`,
    body: note || `You asked to be reminded about this bid today.${who ? ` ${who}.` : ""}`,
    url: `/estimate?bid=${bid.id}`,
  };
}

/**
 * The row columns a save carries for the reminder (saveBid; the estimator sends both on every
 * save). `reminderOn` undefined = leave as is; null / "" clears the date AND the note; a day
 * keeps the note as given (trimmed, cut to BID_REMINDER_NOTE_MAX, blank → null; undefined =
 * leave the note as is).
 */
export function bidReminderColumns(
  reminderOn: string | null | undefined,
  reminderNote: string | null | undefined,
): { reminder_on?: string | null; reminder_note?: string | null } {
  if (reminderOn === undefined) return {};
  if (!reminderOn) return { reminder_on: null, reminder_note: null };
  if (reminderNote === undefined) return { reminder_on: reminderOn };
  const note = (reminderNote ?? "").trim().slice(0, BID_REMINDER_NOTE_MAX);
  return { reminder_on: reminderOn, reminder_note: note || null };
}

/** "Reminded Oct 13" beside the box once the reminder went (bids.reminded_at, the office's day). */
export const bidRemindedLine = (remindedAt: string) =>
  `Reminded ${fmtDay(stampDay(remindedAt), { month: "short", day: "numeric" })}`;
