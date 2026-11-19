/**
 * The card payment page of a Roof Care plan year — the server functions
 * (roof-care-checkout.ts, roof-care-checkout.server.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import {
  CHECKOUT_NO_SITE_ADDRESS,
  CHECKOUT_NOT_SET_UP,
  CHECKOUT_NOT_WAITING,
  CHECKOUT_NOTHING_OWED,
  checkoutAmount,
  toCents,
} from "@/lib/roof-care-checkout";

/** Is paying by card online set up on this server? */
export const roofCareCheckoutReady = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<boolean> => {
    const { stripeConfigured } = await import("@/lib/roof-care-checkout.server");
    const { appUrl } = await import("@/lib/notify.server");
    return stripeConfigured() && !!appUrl();
  });

/**
 * Make the plan's card payment page and hand back its address. `url` null with why when it
 * cannot be made: online payment not set up, nothing owed, the plan not waiting.
 */
export const startPlanCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ url: string | null; reason: string | null }> => {
    const { stripeConfigured, createCheckoutSession } =
      await import("@/lib/roof-care-checkout.server");
    const { appUrl, serverClient } = await import("@/lib/notify.server");
    if (!stripeConfigured()) return { url: null, reason: CHECKOUT_NOT_SET_UP };
    const base = appUrl();
    if (!base) return { url: null, reason: CHECKOUT_NO_SITE_ADDRESS };
    // The signed-in person has to be able to see the plan: read under their own access.
    const { data: plan, error } = await context.supabase
      .from("roof_care_plans")
      .select("id, plan, plan_number, site_id, status, price, renewal_credit, customer_email")
      .eq("id", data.plan_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!plan) throw new Error("That plan was not found");
    if (plan.status !== "awaiting_payment") return { url: null, reason: CHECKOUT_NOT_WAITING };
    // The invoice decides the amount when it is final; a technician cannot read invoices, so
    // it is read with the server's own key (the amount is the customer's price, nothing more).
    const admin = await serverClient(context.supabase);
    const [{ data: inv }, { data: site }] = await Promise.all([
      admin
        .from("invoices")
        .select("status, total, paid_amount")
        .eq("roof_care_plan_id", plan.id)
        .neq("status", "void")
        .order("created_at", { ascending: false })
        .limit(1),
      admin.from("crm_sites").select("name").eq("id", plan.site_id).maybeSingle(),
    ]);
    const first = inv?.[0];
    const cents = toCents(
      checkoutAmount(
        { price: Number(plan.price) || 0, renewal_credit: Number(plan.renewal_credit) || 0 },
        first
          ? {
              status: first.status,
              total: Number(first.total) || 0,
              paid_amount: Number(first.paid_amount) || 0,
            }
          : null,
      ),
    );
    if (cents == null) return { url: null, reason: CHECKOUT_NOTHING_OWED };
    const back = `${base}/properties/${plan.site_id}`;
    const made = await createCheckoutSession({
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
