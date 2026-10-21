/**
 * A list of service tickets, one line each, as the customer's page shows them (Tickets) and the
 * property's page since Oct 15: "#1234 · Open · <property> · <description> · <day or Updated>",
 * each a link to the ticket. No money: technicians read these too.
 */
import { INNER_BOX } from "@/lib/section-tints";
import { Link } from "@tanstack/react-router";

import type { Database } from "@/integrations/supabase/types";
import { SERVICE_STAGES, STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";
import { Badge } from "@/components/ui/badge";

export type TicketRowJob = Pick<
  Database["public"]["Tables"]["service_jobs"]["Row"],
  "id" | "number" | "stage" | "site_name" | "description" | "scheduled_date" | "updated_at"
>;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const day = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
const stageLabel = (s: string) =>
  (SERVICE_STAGES as readonly string[]).includes(s) ? STAGE_LABELS[s as ServiceStage] : s;

export function TicketRows({
  jobs,
  showSite = true,
}: {
  jobs: readonly TicketRowJob[];
  /** The property's name on each row (off on the property's own page: they are all its). */
  showSite?: boolean;
}) {
  return (
    <div className={`divide-y rounded-md border ${INNER_BOX}`}>
      {jobs.map((j) => (
        <Link
          key={j.id}
          to="/service"
          search={{ id: j.id }}
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm hover:bg-muted/60"
        >
          <span className="font-medium">#{j.number}</span>
          <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
            {stageLabel(j.stage)}
          </Badge>
          <span className="min-w-0 flex-1 truncate">
            {showSite && j.site_name ? `${j.site_name} · ` : ""}
            {j.description || "No description"}
          </span>
          <span className="text-xs text-muted-foreground">
            {j.scheduled_date ? day(j.scheduled_date) : `Updated ${shortDate(j.updated_at)}`}
          </span>
        </Link>
      ))}
    </div>
  );
}
