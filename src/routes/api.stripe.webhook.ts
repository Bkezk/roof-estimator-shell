/**
 * POST /api/stripe/webhook — Stripe tells the site a Roof Care plan year was paid by card
 * (roof-care-checkout.ts). Nobody is signed in on this call: the message is trusted only when
 * its signature is Stripe's own, made with the endpoint's secret (STRIPE_WEBHOOK_SECRET).
 *
 * Answers:
 *   503  online card payment is not set up on this server (a secret is missing)
 *   400  the signature is missing, wrong or too old, or the body is not Stripe's
 *   200  everything else, said in the body: recorded, nothing to do, or refused with why.
 *        A refusal of the payment itself is a 200 so Stripe does not send it again for days;
 *        the admins are told instead.
 *   500  the database could not be reached: Stripe sends it again.
 *
 * Nov 20 (break test, number 26). Every payment is kept as its own row by the database
 * (roof_care_card_payments). One that cannot pay for the plan (the plan was paid another way,
 * has ended, or the amount is short) changes nothing on the plan: it is money to send back, and
 * the admins and managers are told how much and why. One that is over what was owed starts the
 * plan and they are told what is over. A plan that waits with no invoice gets its invoice made
 * first, so the payment can mark it paid and the books match.
 */
import { createFileRoute } from "@tanstack/react-router";

import { cardPaidNotice, paidPlanEvent, type CardPaymentRow } from "@/lib/roof-care-checkout";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A checkout event is a few kilobytes. Anything far larger is not one. */
const MAX_BODY = 256 * 1024;

async function run(request: Request): Promise<Response> {
  const { stripeConfigured, verifyStripeSignature } =
    await import("@/lib/roof-care-checkout.server");
  const notifyMod = await import("@/lib/notify.server");
  if (!stripeConfigured() || !notifyMod.hasServiceRole())
    return Response.json({ ok: false, error: "Card payment is not set up" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BODY)
    return Response.json({ ok: false, error: "Too large" }, { status: 400 });
  if (
    !verifyStripeSignature(
      raw,
      request.headers.get("stripe-signature"),
      process.env["STRIPE_WEBHOOK_SECRET"] ?? "",
    )
  )
    return Response.json({ ok: false, error: "Bad signature" }, { status: 400 });
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "Not JSON" }, { status: 400 });
  }
  const paid = paidPlanEvent(event);
  if (!paid) return Response.json({ ok: true, handled: false });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: plan, error: pErr } = await supabaseAdmin
    .from("roof_care_plans")
    .select("id, plan, site_id, customer_email, status, sold_by")
    .eq("id", paid.plan_id)
    .maybeSingle();
  if (pErr) return Response.json({ ok: false, error: pErr.message }, { status: 500 });
  if (!plan) return Response.json({ ok: true, handled: false, reason: "No such plan" });

  const admins = async () => {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .in("role", ["admin", "manager"]);
    return (data ?? []).map((p) => p.id);
  };
  const { data: site } = await supabaseAdmin
    .from("crm_sites")
    .select("name")
    .eq("id", plan.site_id)
    .maybeSingle();

  // A plan that waits with no invoice (signed by a technician, who cannot make one): its invoice
  // is made now, so the payment marks it paid. Best effort: without it the plan still starts.
  if (plan.status === "awaiting_payment" && plan.sold_by) {
    try {
      const { makePlanInvoice } = await import("@/lib/roof-care-plan-invoice.functions");
      await makePlanInvoice(supabaseAdmin, plan.id, { id: plan.sold_by, name: "Card payment" });
    } catch (e) {
      console.error("Stripe webhook: the plan's invoice was not made —", errText(e));
    }
  }

  const { data: result, error } = await supabaseAdmin.rpc("roof_care_card_paid", {
    p_plan: paid.plan_id,
    p_amount: paid.amount,
    p_ref: paid.ref,
  });
  if (error) {
    // The payment itself was refused by the rule (too little, no reference): told, not retried.
    console.error("Stripe webhook: plan", paid.plan_id, "—", error.message);
    try {
      await notifyMod.notify(
        await admins(),
        {
          kind: "plan_card_paid",
          title: `A card payment could not be recorded: ${(site?.name ?? "").trim() || "a property"}`,
          body: `${error.message}. Reference ${paid.ref}. Check it in Stripe and on the plan.`,
          url: `/properties/${plan.site_id}`,
        },
        supabaseAdmin,
      );
    } catch (e) {
      console.error("Stripe webhook: could not tell the admins —", errText(e));
    }
    return Response.json({ ok: false, handled: true, error: error.message });
  }
  if (result !== "already") {
    // The payment as the database kept it: what it was for, what was owed, what is over.
    let payment: CardPaymentRow | null = null;
    try {
      const { data: row } = await supabaseAdmin
        .from("roof_care_card_payments")
        .select("amount, outcome, reason, owed, over, ref")
        .eq("ref", paid.ref)
        .maybeSingle();
      if (row)
        payment = {
          amount: Number(row.amount) || 0,
          outcome: row.outcome,
          reason: row.reason,
          owed: row.owed == null ? null : Number(row.owed) || 0,
          over: Number(row.over) || 0,
          ref: row.ref,
        };
    } catch (e) {
      console.error("Stripe webhook: could not read the payment back —", errText(e));
    }
    const started = result === "started" || result === "invoice_paid";
    try {
      // The email typed at Stripe, when the plan has none. Only for a payment that was kept.
      if (started && !plan.customer_email && paid.email)
        await supabaseAdmin
          .from("roof_care_plans")
          .update({ customer_email: paid.email.trim().toLowerCase() })
          .eq("id", plan.id)
          .is("customer_email", null);
      await notifyMod.notify(
        await admins(),
        cardPaidNotice({
          plan: plan.plan,
          site_id: plan.site_id,
          site: site?.name ?? null,
          result: String(result),
          payment,
        }),
        supabaseAdmin,
      );
      if (started) {
        const { dispatchPlanEmails } = await import("@/lib/roof-care-email.server");
        await dispatchPlanEmails(supabaseAdmin, { planId: plan.id });
      }
    } catch (e) {
      // The payment is recorded either way.
      console.error("Stripe webhook: after the payment —", errText(e));
    }
  }
  return Response.json({ ok: true, handled: true, result });
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: { handlers: { POST: ({ request }) => run(request) } },
});
