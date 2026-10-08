/**
 * The Owner view's Business tab — the server side (src/lib/owner-business.ts has the arithmetic).
 * Admins only, the same rule as listOwnerView: the caller's own profile row decides, never a
 * flag from the client. Reads run under the caller's client (admins read everything by RLS).
 * crm_untouched() is read defensively: if the rpc is missing or refuses, the untouched counts
 * read as "not available" rather than 0.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { businessNumbers, type BusinessNumbers } from "@/lib/owner-business";
import { visibleToOwner } from "@/lib/owner-view";
import { parseTodayInput, viewerToday } from "@/lib/work-counts";

const LIMIT = 1000;
type Sb = SupabaseClient<Database>;

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

async function untouchedCounts(sb: Sb): Promise<{ tickets: number; opps: number } | null> {
  try {
    const { data, error } = await sb.rpc("crm_untouched");
    if (error || !Array.isArray(data)) return null;
    let tickets = 0;
    let opps = 0;
    for (const r of data as { kind?: string }[]) {
      if (r.kind === "ticket") tickets += 1;
      else if (r.kind === "opportunity") opps += 1;
    }
    return { tickets, opps };
  } catch {
    return null;
  }
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

    const [tickets, invoices, pos, opps, snoozed, untouched] = await Promise.all([
      sb
        .from("service_jobs")
        .select("stage, stage_changed_at, scheduled_date, invoice_id")
        .is("deleted_at", null)
        .in("stage", ["open", "scheduled", "done"])
        .limit(LIMIT),
      sb.from("invoices").select("status, total, invoice_date").limit(LIMIT),
      sb
        .from("service_job_purchase_orders")
        .select("approved, price")
        .eq("approved", false)
        .limit(LIMIT),
      sb
        .from("crm_opportunities")
        .select("status, est_value, expected_close, updated_at")
        .is("deleted_at", null)
        .limit(LIMIT),
      sb
        .from("crm_followups")
        .select("snoozed_until")
        .eq("status", "open")
        .not("snoozed_until", "is", null)
        .limit(LIMIT),
      untouchedCounts(sb),
    ]);
    const nowIso = now.toISOString();
    return businessNumbers({
      today,
      now: nowIso,
      tickets: must("tickets", tickets),
      invoices: must("invoices", invoices),
      pos: must("purchase orders", pos),
      opps: must("opportunities", opps),
      snoozed: must<{ snoozed_until: string | null }[]>("follow-ups", snoozed).filter(
        (f) => !!f.snoozed_until && f.snoozed_until > nowIso,
      ).length,
      untouched,
    });
  });
