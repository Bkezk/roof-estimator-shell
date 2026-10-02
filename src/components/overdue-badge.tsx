/**
 * The red "Overdue" tag (owner, Oct 2) on service tickets and opportunities — on each list row and
 * beside the "Opened …" line of the open item. Whether something is overdue, and by how many
 * days, comes from lib/work-counts.ts (ticketOverdueDays / oppOverdueDays), the same rule as the
 * lists' Overdue filter and the Customers page counts.
 */
import { Badge } from "@/components/ui/badge";

export function OverdueBadge({ days, what }: { days: number | null; what: string }) {
  if (days === null) return null;
  return (
    <Badge
      variant="destructive"
      className="px-1.5 py-0 text-[11px]"
      data-tag="overdue"
      title={`${what} ${days} day${days === 1 ? "" : "s"} ago`}
    >
      Overdue {days}d
    </Badge>
  );
}
