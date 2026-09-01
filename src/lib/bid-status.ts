/**
 * Bid status pipeline — the legacy Bid-Advantage workflow states (Home > Status dropdown:
 * In Progress → Finished → Submitted → Review → Final → Accepted / Denied), plus the web app's
 * pre-existing "draft" for bids saved before a status was ever picked.
 */
export const BID_STATUSES = [
  "draft",
  "in_progress",
  "finished",
  "submitted",
  "review",
  "final",
  "accepted",
  "denied",
] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const STATUS_LABELS: Record<BidStatus, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  finished: "Finished",
  submitted: "Submitted",
  review: "Review",
  final: "Final",
  accepted: "Accepted",
  denied: "Denied",
};

/** Badge tint per status (neutral → in-flight blues/ambers → green/red outcomes). */
export const STATUS_BADGE_CLASSES: Record<BidStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  finished: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  review: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  final: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  denied: "bg-red-500/15 text-red-700 dark:text-red-400",
};

/** Coerce a stored status string to a known status (unknown/legacy values read as draft). */
export const asBidStatus = (s: string | null | undefined): BidStatus =>
  (BID_STATUSES as readonly string[]).includes(s ?? "") ? (s as BidStatus) : "draft";
