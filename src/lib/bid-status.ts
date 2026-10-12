/**
 * Bid status — four states (owner, Sep 24): Draft (ours), Submitted (with the customer), Won,
 * Lost. The legacy Bid-Advantage pipeline (In Progress → Finished → Submitted → Review → Final →
 * Accepted / Denied) folds into these when an old value is read.
 */
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

// ---- the "Bid due tomorrow" notice (owner, Oct 12) ------------------------------------------

/** The inbox kind of the notice (notifications.functions.ts KIND_LABELS: "Bid due"). */
export const BID_DUE_NOTICE_KIND = "bid_due";

const utcDay = (ymd: string) => {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
/** YYYY-MM-DD plus `n` days (calendar arithmetic). */
export const bidDayPlus = (ymd: string, n: number) =>
  new Date(utcDay(ymd) + n * 86400000).toISOString().slice(0, 10);
const fmtDay = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(utcDay(ymd)).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

/**
 * Is a bid's notice due on `today` (the office's day, YYYY-MM-DD)? A draft with a due date, not
 * yet noticed (`notified_due_at` null), once today is the day before the due date or later — so
 * a bid made the day before, on the due day or after it still gets its one notice, and never a
 * second (the stamp; moving the date clears it, so the new day is noticed once).
 */
export function bidDueNoticeDue(
  bid: {
    status: string | null;
    due_date: string | null | undefined;
    notified_due_at: string | null | undefined;
  },
  today: string,
): boolean {
  if (asBidStatus(bid.status) !== "draft") return false;
  if (!bid.due_date || !YMD.test(bid.due_date) || bid.notified_due_at) return false;
  return today >= bidDayPlus(bid.due_date, -1);
}

/**
 * The notice's words: "Bid due tomorrow: <name>" the day before; "Bid due today: <name>" on the
 * day; "Bid was due Oct 13: <name>" when first seen after it. Body: "<account> · due Tuesday,
 * October 13, 2026. Open the estimator to finish and submit it." (no account: "Due …").
 */
export function bidDueNotice(
  bid: { id: string; name: string; due_date: string },
  accountName: string | null | undefined,
  today: string,
): { kind: string; title: string; body: string; url: string } {
  const due = bid.due_date;
  const head =
    today < due
      ? "Bid due tomorrow"
      : today === due
        ? "Bid due today"
        : `Bid was due ${fmtDay(due, { month: "short", day: "numeric" })}`;
  const longDay = fmtDay(due, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const who = (accountName ?? "").trim();
  return {
    kind: BID_DUE_NOTICE_KIND,
    title: `${head}: ${bid.name}`,
    body: `${who ? `${who} · due` : "Due"} ${longDay}. Open the estimator to finish and submit it.`,
    url: `/estimate?bid=${bid.id}`,
  };
}
