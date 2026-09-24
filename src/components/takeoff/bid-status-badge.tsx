/** Small tinted badge for a linked bid's status (Draft / Submitted / Won / Lost). */
import { STATUS_BADGE_CLASSES, STATUS_LABELS, asBidStatus } from "@/lib/bid-status";
import { cn } from "@/lib/utils";

export function BidStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = asBidStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none",
        STATUS_BADGE_CLASSES[s],
        className,
      )}
    >
      {STATUS_LABELS[s]}
    </span>
  );
}
