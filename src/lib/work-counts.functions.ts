/**
 * Work counts for the Customers page strip (src/lib/work-counts.ts has the rules). Four
 * `count: "exact", head: true` queries run in parallel under the caller's own client, so RLS
 * decides what is counted: a technician counts only their own tickets, managers and admins
 * everything they may read — the same rows the Service / Opportunities lists would show them.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { localYmd } from "@/lib/tasks";
import { OPEN_OPP_STATUSES, OPEN_TICKET_STAGES, type WorkCounts } from "@/lib/work-counts";

export const getWorkCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkCounts & { today: string }> => {
    const sb = context.supabase;
    // The office's calendar day (America/New_York): a date before it is overdue.
    const today = localYmd(new Date());
    const tickets = () =>
      sb
        .from("service_jobs")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("stage", [...OPEN_TICKET_STAGES]);
    const opps = () =>
      sb
        .from("crm_opportunities")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("status", [...OPEN_OPP_STATUSES]);
    // `lt` leaves out rows with no date (never overdue).
    const [openT, overdueT, openO, overdueO] = await Promise.all([
      tickets(),
      tickets().lt("scheduled_date", today),
      opps(),
      opps().lt("expected_close", today),
    ]);
    if (openT.error) throw new Error(`Open tickets: ${openT.error.message}`);
    if (overdueT.error) throw new Error(`Overdue tickets: ${overdueT.error.message}`);
    if (openO.error) throw new Error(`Open opportunities: ${openO.error.message}`);
    if (overdueO.error) throw new Error(`Overdue opportunities: ${overdueO.error.message}`);
    return {
      openTickets: openT.count ?? 0,
      overdueTickets: overdueT.count ?? 0,
      openOpps: openO.count ?? 0,
      overdueOpps: overdueO.count ?? 0,
      today,
    };
  });
