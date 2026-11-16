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
 *
 * Every row is read (owner, Nov 16, audit fix 21). Each read used to stop at 1,000 rows in no
 * set order, so past 1,000 live rows some went missing without a word; now each pages by id to
 * its end (read-all.ts readAll, as the Owner view's counts do). The inspections' ids used to go
 * into one request's URL; now they go 100 at a time (chunk-ids.ts readInChunks). A chunk that
 * cannot be read still stops the whole list with its error, as before: a repair ticket or bid
 * left unread would put its inspection on the list wrongly.
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
import { readInChunks } from "@/lib/chunk-ids";
import { visibleToOwner } from "@/lib/owner-view";
import { PAGE, afterId, readAll } from "@/lib/read-all";
import { OPEN_OPP_STATUSES, parseTodayInput, viewerToday } from "@/lib/work-counts";

type Sb = SupabaseClient<Database>;

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

const TICKET_COLUMNS =
  "id, number, customer_name, service_type, stage, stage_changed_at, completed_at, updated_at, created_at, scheduled_date, technician_id, inspection, inspection_outcome, inspection_outcome_at, inspection_outcome_by";

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
        readAll((after) =>
          afterId(
            sb
              .from("service_jobs")
              .select(TICKET_COLUMNS)
              .is("deleted_at", null)
              .in("stage", ["open", "scheduled", "done"])
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        // Every finished inspection past Done (the Done ones are in the read above).
        readAll((after) =>
          afterId(
            sb
              .from("service_jobs")
              .select(TICKET_COLUMNS)
              .is("deleted_at", null)
              .not("inspection", "is", null)
              .in("stage", ["authorized", "invoiced", "closed"])
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        readAll((after) =>
          afterId(
            sb
              .from("crm_opportunities")
              .select("id, title, status, assignee_id, created_at, expected_close")
              .is("deleted_at", null)
              .is("assignee_id", null)
              .in("status", [...OPEN_OPP_STATUSES])
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        // Drafts and submitted bids; the legacy statuses fold into those two (bid-status.ts), so
        // only the finished ones are left out.
        readAll((after) =>
          afterId(
            sb
              .from("bids")
              .select(
                "id, name, status, due_date, submitted_at, status_changed_at, updated_at, reminder_on, grand_total, created_by",
              )
              .is("deleted_at", null)
              .not("status", "in", "(won,accepted,lost,denied)")
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        // invoice_date: an invoice with no due date is late 30 days after it (Nov 16, fix 11).
        readAll((after) =>
          afterId(
            sb
              .from("invoices")
              .select(
                "id, number, display_number, status, total, paid_amount, due_date, invoice_date, bill_to",
              )
              .eq("status", "final")
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        readAll((after) =>
          afterId(
            sb
              .from("crm_followups")
              .select("id, kind, item_id, status, snoozed_until, assignee_id")
              .eq("status", "open")
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        sb.from("crm_settings").select("*").eq("id", 1).maybeSingle(),
        readAll((after) =>
          afterId(
            sb.from("profiles").select("id, full_name, email").order("id").limit(PAGE),
            after,
          ),
        ),
        untouchedRows(sb),
      ]);

    const tickets = [
      ...must<AttTicket[]>("tickets", work),
      ...must<AttTicket[]>("inspections", inspections),
    ];
    // What came of each finished inspection: a live repair ticket or bid made from it. The ids
    // go 100 to a request, each read to its end; an error stops the list (see the top).
    const inspectionIds = tickets.filter((t) => !!t.inspection).map((t) => t.id);
    const [repairs, bidsFrom] = await Promise.all([
      readInChunks(inspectionIds, async (chunk) => ({
        data: must(
          "repair tickets",
          await readAll((after) =>
            afterId(
              sb
                .from("service_jobs")
                .select("id, from_job_id")
                .is("deleted_at", null)
                .in("from_job_id", chunk)
                .order("id")
                .limit(PAGE),
              after,
            ),
          ),
        ),
        error: null,
      })),
      readInChunks(inspectionIds, async (chunk) => ({
        data: must(
          "bids from inspections",
          await readAll((after) =>
            afterId(
              sb
                .from("bids")
                .select("id, from_job_id")
                .is("deleted_at", null)
                .in("from_job_id", chunk)
                .order("id")
                .limit(PAGE),
              after,
            ),
          ),
        ),
        error: null,
      })),
    ]);
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
      repairFrom: fromIds(repairs),
      bidFrom: fromIds(bidsFrom),
      names,
    });
  });
