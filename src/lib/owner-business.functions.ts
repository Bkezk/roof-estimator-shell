/**
 * The Owner view's Business tab — the server side (src/lib/owner-business.ts has the arithmetic).
 * Admins only, the same rule as listOwnerView: the caller's own profile row decides, never a
 * flag from the client. Reads run under the caller's client (admins read everything by RLS).
 *
 * Since Nov 16 it reads less: the owner took off this tab what the Needs attention list already
 * shows (owner-business.ts), so no invoice, no Open / Scheduled / Done ticket and no
 * crm_untouched() is read here any more.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { businessNumbers, type BusinessNumbers } from "@/lib/owner-business";
import { visibleToOwner } from "@/lib/owner-view";
import { AWAITS_INVOICE_OR } from "@/lib/ticket-stage";
import { parseTodayInput, viewerToday } from "@/lib/work-counts";

const LIMIT = 1000;
type Sb = SupabaseClient<Database>;

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

export const listOwnerBusiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseTodayInput(d))
  .handler(async ({ data, context }): Promise<BusinessNumbers> => {
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

    const [tickets, opps, bids, snoozed] = await Promise.all([
      // The Authorized tickets, for the "Authorized, not invoiced" tile (owner, Oct 12, item 6:
      // the queue as Work Overview and the Invoices badge count it). Since Nov 16 this is the
      // only ticket number on the tab: Past due and the Done line left it (owner: "i dont want
      // double info"; the Needs attention list has them), and no invoice is read (the Unpaid
      // tile went the same way).
      sb
        .from("service_jobs")
        .select("id, stage, stage_changed_at, invoice_id, service_type")
        .is("deleted_at", null)
        .eq("stage", "authorized")
        // Filtered here, not after the row limit (audit, Nov 16, fix 9): finished inspections
        // stay at Authorized for good.
        .or(AWAITS_INVOICE_OR)
        .limit(LIMIT),
      sb
        .from("crm_opportunities")
        .select("status, est_value, expected_close, updated_at")
        .is("deleted_at", null)
        .limit(LIMIT),
      // Won / Lost this month counts bids (owner, Oct 21), by the Won-on day / status change.
      sb
        .from("bids")
        .select("status, won_on, status_changed_at, updated_at")
        .is("deleted_at", null)
        .in("status", ["won", "accepted", "lost", "denied"])
        .limit(LIMIT),
      // Every open follow-up with a hold: the "snoozed right now" count.
      sb
        .from("crm_followups")
        .select("snoozed_until")
        .eq("status", "open")
        .not("snoozed_until", "is", null)
        .limit(LIMIT),
    ]);
    const nowIso = now.toISOString();
    const holds = must<{ snoozed_until: string | null }[]>("follow-ups", snoozed);
    return businessNumbers({
      today,
      now: nowIso,
      tickets: must("tickets", tickets),
      opps: must("opportunities", opps),
      bids: must("bids", bids),
      snoozed: holds.filter((f) => !!f.snoozed_until && f.snoozed_until > nowIso).length,
    });
  });
