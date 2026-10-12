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
