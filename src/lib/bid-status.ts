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
