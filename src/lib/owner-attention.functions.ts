/**
 * The Owner page's "Needs attention" list — the server side (src/lib/owner-attention.ts has the
 * rules). Admins only, the same rule as listOwnerView and listOwnerBusiness: the caller's own
 * profile row decides, never a flag from the client. Every read runs under the caller's client
 * (an admin reads everything by RLS); nothing is written.
 *
 * crm_untouched() is read defensively, as the Business tab reads it: when the rpc is missing or
 * refuses, those rows are left out and the list says so (`untouchedRead` false), never a guess.
 * The settings row is read whole, so the two limits of this list's own read as their defaults
 * until their migration (20261115120000_owner_attention_limits.sql) is applied.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  attentionLimits,
  attentionList,
  type AttBid,
  type AttFollowup,
  type AttInvoice,
  type AttOpp,
  type AttTicket,
  type AttUntouched,
  type AttentionList,
} from "@/lib/owner-attention";
import { visibleToOwner } from "@/lib/owner-view";
import { OPEN_OPP_STATUSES, parseTodayInput, viewerToday } from "@/lib/work-counts";

const LIMIT = 1000;
type Sb = SupabaseClient<Database>;

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

const TICKET_COLUMNS =
  "id, number, customer_name, service_type, stage, stage_changed_at, updated_at, created_at, scheduled_date, technician_id, inspection, inspection_outcome, inspection_outcome_at, inspection_outcome_by";

async function untouchedRows(sb: Sb): Promise<AttUntouched[] | null> {
  try {
    const { data, error } = await sb.rpc("crm_untouched");
    if (error || !Array.isArray(data)) return null;
    return data as AttUntouched[];
  } catch {
    return null;
  }
}

export const listOwnerAttention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseTodayInput(d))
  .handler(async ({ data, context }): Promise<AttentionList> => {
    const sb = context.supabase;
    const { data: me, error: meErr } = await sb
      .from("profiles")
      .select("id, role")
      .eq("id", context.userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me || !visibleToOwner(me)) throw new Error("Forbidden: admin only");

    const now = new Date();
    const today = viewerToday(data.today, now);

    const [work, inspections, opps, bids, invoices, followups, settings, profiles, untouched] =
      await Promise.all([
        // The work still to be done or reviewed: Open / Scheduled / Done.
        sb
          .from("service_jobs")
          .select(TICKET_COLUMNS)
          .is("deleted_at", null)
          .in("stage", ["open", "scheduled", "done"])
          .limit(LIMIT),
        // Every finished inspection past Done (the Done ones are in the read above).
        sb
          .from("service_jobs")
          .select(TICKET_COLUMNS)
          .is("deleted_at", null)
          .not("inspection", "is", null)
          .in("stage", ["authorized", "invoiced", "closed"])
          .limit(LIMIT),
        sb
          .from("crm_opportunities")
          .select("id, title, status, assignee_id, created_at, expected_close")
          .is("deleted_at", null)
          .is("assignee_id", null)
          .in("status", [...OPEN_OPP_STATUSES])
          .limit(LIMIT),
        // Drafts and submitted bids; the legacy statuses fold into those two (bid-status.ts), so
        // only the finished ones are left out.
        sb
          .from("bids")
          .select(
            "id, name, status, due_date, submitted_at, status_changed_at, updated_at, reminder_on, grand_total, created_by",
          )
          .is("deleted_at", null)
          .not("status", "in", "(won,accepted,lost,denied)")
          .limit(LIMIT),
        sb
          .from("invoices")
          .select("id, number, display_number, status, total, paid_amount, due_date, bill_to")
          .eq("status", "final")
          .limit(LIMIT),
        sb
          .from("crm_followups")
          .select("kind, item_id, status, snoozed_until, assignee_id")
          .eq("status", "open")
          .limit(LIMIT),
        sb.from("crm_settings").select("*").eq("id", 1).maybeSingle(),
        sb.from("profiles").select("id, full_name, email").limit(LIMIT),
        untouchedRows(sb),
      ]);

    const tickets = [
      ...must<AttTicket[]>("tickets", work),
      ...must<AttTicket[]>("inspections", inspections),
    ];
    // What came of each finished inspection: a live repair ticket or bid made from it.
    const inspectionIds = tickets.filter((t) => !!t.inspection).map((t) => t.id);
    const [repairs, bidsFrom] = inspectionIds.length
      ? await Promise.all([
          sb
            .from("service_jobs")
            .select("from_job_id")
            .is("deleted_at", null)
            .in("from_job_id", inspectionIds)
            .limit(LIMIT),
          sb
            .from("bids")
            .select("from_job_id")
            .is("deleted_at", null)
            .in("from_job_id", inspectionIds)
            .limit(LIMIT),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];
    const fromIds = (rows: { from_job_id: string | null }[]) =>
      rows.map((r) => r.from_job_id).filter((id): id is string => !!id);

    if (settings.error) throw new Error(`settings: ${settings.error.message}`);
    const names: Record<string, string> = {};
    for (const p of must<{ id: string; full_name: string | null; email: string | null }[]>(
      "people",
      profiles,
    ))
      names[p.id] = (p.full_name ?? "").trim() || (p.email ?? "").trim();

    return attentionList({
      today,
      now: now.toISOString(),
      limits: attentionLimits(settings.data),
      tickets,
      untouched,
      opps: must<AttOpp[]>("opportunities", opps),
      bids: must<AttBid[]>("bids", bids),
      invoices: must<AttInvoice[]>("invoices", invoices),
      followups: must<AttFollowup[]>("follow-ups", followups),
      repairFrom: fromIds(must<{ from_job_id: string | null }[]>("repair tickets", repairs)),
      bidFrom: fromIds(must<{ from_job_id: string | null }[]>("bids from inspections", bidsFrom)),
      names,
    });
  });
