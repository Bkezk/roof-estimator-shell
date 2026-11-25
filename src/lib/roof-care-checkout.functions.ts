/**
 * The card payment page of a Roof Care plan year — the server functions
 * (roof-care-checkout.ts, roof-care-checkout.server.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Client } from "@/lib/notify.server";
import {
  BANK_PENDING_OFFICE,
  bankPendingNow,
  CHECKOUT_FROM_TICKET,
  CHECKOUT_NO_SITE_ADDRESS,
  CHECKOUT_NOT_SET_UP,
  CHECKOUT_NOT_WAITING,
  CHECKOUT_NOTHING_OWED,
} from "@/lib/roof-care-checkout";
import { PAY_HELD_SIZE } from "@/lib/roof-care-pay-link";
import { readsPlanTables } from "@/lib/roof-care-plan";

/** Is paying by card online set up on this server? */
export const roofCareCheckoutReady = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<boolean> => {
    const { stripeConfigured } = await import("@/lib/roof-care-checkout.server");
    const { appUrl } = await import("@/lib/notify.server");
    return stripeConfigured() && !!appUrl();
  });

/**
 * Is this a ticket the signed-in person can open, not deleted and not closed, at this property?
 * Asked with their own sign-in, so a technician passes only with a ticket of their own (Nov 26,
 * the audit's number 18). Until then the browser said "on a ticket" and nothing checked it.
 */
export async function liveTicketAt(sb: Client, jobId: string, siteId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("service_jobs")
    .select("id, site_id, stage, deleted_at")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data && data.site_id === siteId && data.stage !== "closed";
}

/**
 * Make the plan's card payment page and hand back its address. `url` null with why when it
 * cannot be made: online payment not set up, nothing owed, the plan not waiting.
 */
export const startPlanCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        // Opened on a ticket: the technician is on the roof and can measure it (owner, Nov 24),
        // so the card page opens though the roof size is not confirmed yet. Nov 26: the ticket
        // itself is named and checked here. The browser's own word for it is no longer taken.
        job_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ url: string | null; reason: string | null }> => {
    const { stripeConfigured, openPlanCardPage, planOwedCents, planCardState } =
      await import("@/lib/roof-care-checkout.server");
    const { appUrl, serverClient } = await import("@/lib/notify.server");
    const { readProfile } = await import("@/lib/profile-cache.server");
    if (!stripeConfigured()) return { url: null, reason: CHECKOUT_NOT_SET_UP };
    const base = appUrl();
    if (!base) return { url: null, reason: CHECKOUT_NO_SITE_ADDRESS };
    // The signed-in person has to be able to see the plan. A technician no longer reads the
    // plans table (Nov 20, it holds money), so the database is asked whether they see this
    // plan, and the plan is then read with the server's own key. Before, a technician's card
    // sign-up found no plan here.
    const { data: seen, error: sErr } = await context.supabase.rpc("roof_care_plan_seen", {
      p_plan: data.plan_id,
    });
    if (sErr) throw new Error(sErr.message);
    if (seen !== true) throw new Error("That plan was not found");
    const admin = await serverClient(context.supabase);
    const { data: plan, error } = await admin
      .from("roof_care_plans")
      .select(
        "id, plan, plan_number, site_id, status, price, renewal_credit, customer_email, size_unchecked",
      )
      .eq("id", data.plan_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!plan) throw new Error("That plan was not found");
    // Nov 26 (the audit's number 18): the office opens the card page from the plan. A
    // technician opens it only from a ticket of theirs at the plan's property.
    const [me, onSite] = await Promise.all([
      readProfile(context.supabase, context.userId),
      data.job_id ? liveTicketAt(context.supabase, data.job_id, plan.site_id) : false,
    ]);
    if (!readsPlanTables(me) && !onSite) throw new Error(CHECKOUT_FROM_TICKET);
    if (plan.status !== "awaiting_payment") return { url: null, reason: CHECKOUT_NOT_WAITING };
    // No payment is taken until the roof size is confirmed (owner, Nov 24), except on a ticket.
    if (plan.size_unchecked === true && !onSite) return { url: null, reason: PAY_HELD_SIZE };
    // Nov 26: a payment from the customer's bank account is on its way. No second one is asked.
    const state = await planCardState(admin, plan.id);
    if (bankPendingNow(state.bank_pending?.at)) return { url: null, reason: BANK_PENDING_OFFICE };
    // The invoice decides the amount when it is final (planOwedCents, shared with the
    // customer's own payment link since Nov 23).
    const [cents, { data: site }] = await Promise.all([
      planOwedCents(admin, plan),
      admin.from("crm_sites").select("name").eq("id", plan.site_id).maybeSingle(),
    ]);
    if (cents == null) return { url: null, reason: CHECKOUT_NOTHING_OWED };
    const back = `${base}/properties/${plan.site_id}`;
    // Nov 26: made through the one door that keeps the page on its plan, so it can be closed.
    const made = await openPlanCardPage(admin, {
      plan_id: plan.id,
      plan: plan.plan,
      plan_number: plan.plan_number,
      site_name: site?.name ?? "",
      cents,
      email: plan.customer_email ?? null,
      success_url: back,
      cancel_url: back,
    });
    return { url: made.url, reason: null };
  });
