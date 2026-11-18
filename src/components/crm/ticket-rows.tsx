/**
 * A list of service tickets, one line each, as the customer's page shows them (Tickets) and the
 * property's page since Oct 15: "#1234 · Open · <property> · <description> · <day or Updated>",
 * each a link to the ticket. No money: technicians read these too.
 *
 * With `extras` (the property's page, Nov 18) a row has a second line and, where there is
 * something to say, a third: lib/property-rows.ts.
 */
import { INNER_BOX } from "@/lib/section-tints";
import { Link } from "@tanstack/react-router";

import type { Database } from "@/integrations/supabase/types";
import { partsText, ticketFacts, ticketWork, type TicketRepairIn } from "@/lib/property-rows";
import { SERVICE_STAGES, STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";
import { Badge } from "@/components/ui/badge";

type JobRow = Database["public"]["Tables"]["service_jobs"]["Row"];
export type TicketRowJob = Pick<
  JobRow,
  "id" | "number" | "stage" | "site_name" | "description" | "scheduled_date" | "updated_at"
> &
  // What the second line reads, where a page asks for it (`extras`).
  Partial<
    Pick<
      JobRow,
      "service_type" | "completed_at" | "inspection" | "inspection_outcome" | "closing_notes"
    >
  >;
/** A ticket's second line: who is on it and what was repaired (crm.functions.ts getProperty). */
export interface TicketRowExtra {
  technician_name: string | null;
  repairs: readonly TicketRepairIn[];
}

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
  extras,
}: {
  jobs: readonly TicketRowJob[];
  /** The property's name on each row (off on the property's own page: they are all its). */
  showSite?: boolean;
  /**
   * By ticket id: with it each row gets a second line (owner, Nov 18, of the property's page:
   * "can you include more detail on the tickets"): the type, the technician and the day it was
   * done, then what was found and done. Left out: one line each, as on the customer's page.
   */
  extras?: Record<string, TicketRowExtra> | undefined;
}) {
  return (
    <div className={`divide-y rounded-md border ${INNER_BOX}`}>
      {jobs.map((j) => {
        const extra = extras?.[j.id];
        const work = extras ? ticketWork(j, extra?.repairs) : [];
        return (
          <Link
            key={j.id}
            to="/service"
            search={{ id: j.id }}
            className="block px-3 py-2 text-sm hover:bg-muted/60"
            data-ticket-row={j.id}
          >
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
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
            </span>
            {extras && (
              <span className="mt-0.5 block text-xs text-muted-foreground" data-row-facts>
                {ticketFacts(j, extra?.technician_name)}
              </span>
            )}
            {work.length > 0 && (
              <span className="mt-0.5 line-clamp-2 text-xs" title={partsText(work)} data-row-work>
                {work.map((w, i) => (
                  <span key={w.label}>
                    {i > 0 && <span className="text-muted-foreground"> · </span>}
                    <span className="font-medium text-muted-foreground">{w.label}: </span>
                    {w.text}
                  </span>
                ))}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
