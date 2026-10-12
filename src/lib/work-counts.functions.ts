/**
 * Work counts for the Customers page strip (src/lib/work-counts.ts has the rules). The queries
 * run in parallel under the caller's own client, so RLS decides what is counted: a technician
 * counts only their own tickets, managers and admins everything they may read — the same rows
 * the Service / Opportunities lists would show them.
 *
 * Tickets in progress, open opportunities and overdue opportunities are `count: "exact", head:
 * true` queries. Overdue tickets (owner, Oct 12, item 6) reads the candidate rows instead — Open /
 * Scheduled, with a technician, past their day — and leaves out those whose follow-up is on hold
 * (crm_followups snoozed_until on a later day; work-counts.ts heldTicketIds), the rule Work
 * Overview's Overdue group follows. The follow-up read is best effort: if it fails, nothing is
 * treated as held (the count is then the candidates), never an error for the strip.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import {
  OPEN_OPP_STATUSES,
  OPEN_TICKET_STAGES,
  OVERDUE_TICKET_STAGES,
  countsAsOverdueTicket,
  heldTicketIds,
  parseTodayInput,
  viewerToday,
  type WorkCounts,
} from "@/lib/work-counts";

/** PostgREST caps a request at 1,000 rows; more overdue tickets than that is not a real case. */
const LIMIT = 1000;

export const getWorkCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  // The viewer's day (the browser's, as Work Overview); without one, the office's (Eastern).
  .validator((d: unknown) => parseTodayInput(d))
  .handler(async ({ data, context }): Promise<WorkCounts & { today: string }> => {
    const sb = context.supabase;
    const today = viewerToday(data.today);
    const opps = () =>
      sb
        .from("crm_opportunities")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("status", [...OPEN_OPP_STATUSES]);
    // `lt` leaves out rows with no date (never overdue). Overdue tickets: Open / Scheduled only
    // (owner, Oct 12: a Done ticket waits to be invoiced; it is not overdue), with a technician
    // (one without is Unassigned on Work Overview, not overdue).
    const [openT, overdueT, held, openO, overdueO] = await Promise.all([
      sb
        .from("service_jobs")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("stage", [...OPEN_TICKET_STAGES]),
      sb
        .from("service_jobs")
        .select("id, stage, scheduled_date, technician_id")
        .is("deleted_at", null)
        .in("stage", [...OVERDUE_TICKET_STAGES])
        .not("technician_id", "is", null)
        .lt("scheduled_date", today)
        .limit(LIMIT),
      sb
        .from("crm_followups")
        .select("kind, item_id, status, snoozed_until")
        .eq("kind", "ticket")
        .eq("status", "open")
        .not("snoozed_until", "is", null)
        .limit(LIMIT),
      opps(),
      opps().lt("expected_close", today),
    ]);
    if (openT.error) throw new Error(`Tickets in progress: ${openT.error.message}`);
    if (overdueT.error) throw new Error(`Overdue tickets: ${overdueT.error.message}`);
    if (openO.error) throw new Error(`Open opportunities: ${openO.error.message}`);
    if (overdueO.error) throw new Error(`Overdue opportunities: ${overdueO.error.message}`);
    if (held.error)
      console.error(`Overdue tickets: follow-up holds not read — ${held.error.message}`);
    const onHold = heldTicketIds(held.error ? [] : (held.data ?? []), today);
    return {
      openTickets: openT.count ?? 0,
      overdueTickets: (overdueT.data ?? []).filter((j) => countsAsOverdueTicket(j, today, onHold))
        .length,
      openOpps: openO.count ?? 0,
      overdueOpps: overdueO.count ?? 0,
      today,
    };
  });
