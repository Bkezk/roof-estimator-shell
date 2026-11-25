/**
 * POST /api/stripe/webhook — Stripe tells the site a Roof Care plan year was paid by card
 * (roof-care-checkout.ts). Nobody is signed in on this call: the message is trusted only when
 * its signature is Stripe's own, made with the endpoint's secret (STRIPE_WEBHOOK_SECRET).
 *
 * Answers:
 *   503  online card payment is not set up on this server (a secret is missing)
 *   400  the signature is missing, wrong or too old, or the body is not Stripe's
 *   200  the message is dealt with, said in the body: recorded, already recorded, nothing to
 *        do, or not ours to record. The same for a notice from the other side of Stripe (a
 *        test notice while the site's key is live, or the other way round; Nov 24): the admins
 *        are told, and Stripe is not asked to send it again.
 *   500  the site could not do its part: the database could not be reached, the payment could
 *        not be recorded, or anything else went wrong after the signature was proven. Stripe
 *        sends the message again, for up to three days.
 *
 * Nov 20 (break test, number 26). Every payment is kept as its own row by the database
 * (roof_care_card_payments). One that cannot pay for the plan (the plan was paid another way,
 * has ended, or the amount is short) changes nothing on the plan: it is money to send back, and
 * the admins and managers are told how much and why. One that is over what was owed starts the
 * plan and they are told what is over. A plan that waits with no invoice gets its invoice made
 * first, so the payment can mark it paid and the books match.
 *
 * Nov 26 (the audit of Nov 25, numbers 1 to 4 and 26; owner: "go on 1, 2, 3 ... 4"):
 *   - A payment the database could not record used to be answered 200, so Stripe never sent it
 *     again and no row existed anywhere. It is answered 500 now. A reference is taken once, so
 *     a payment sent again is recorded once. The admins are told once for a payment, not at
 *     every try.
 *   - A paid Roof Care checkout the site cannot match (the plan is gone, or it is in another
 *     currency) used to be answered and told to nobody. The admins are told now.
 *   - A bank payment is followed on the plan: stamped while it is on its way, recorded as a
 *     bank payment when it clears, the stamp taken off when it fails.
 *   - Once a payment is recorded, or a bank payment has started, the plan's other open card
 *     pages are closed, so a second page left open cannot be paid.
 *   - The alarms have a kind no tick turns off (PLAN_MONEY_ALARM_KIND).
 */
import { createFileRoute } from "@tanstack/react-router";

import { databaseRpc } from "@/lib/database-rpc";
import { PLAN_MONEY_ALARM_KIND } from "@/lib/notice-types";
import {
  bankPaymentNotice,
  bankPlanEvent,
  CARD_MODE_REFUSED,
  cardModeLogLine,
  cardModeNotice,
  cardNotRecordedNotice,
  cardPaidNotice,
  eventMode,
  eventModeFits,
  paidPlanEvent,
  stripeKeyMode,
  unmatchedMoneyNotice,
  unmatchedPaidEvent,
  type CardPaymentRow,
} from "@/lib/roof-care-checkout";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A checkout event is a few kilobytes. Anything far larger is not one. */
const MAX_BODY = 256 * 1024;
const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Stripe sends the message again when it is answered with this. */
const sendAgain = (error: string) => Response.json({ ok: false, error }, { status: 500 });

async function run(request: Request): Promise<Response> {
  const { stripeConfigured, stripeWebhookSecret, verifyStripeSignature } =
    await import("@/lib/roof-care-checkout.server");
  const notifyMod = await import("@/lib/notify.server");
  if (!stripeConfigured() || !notifyMod.hasServiceRole())
    return Response.json({ ok: false, error: "Card payment is not set up" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BODY)
    return Response.json({ ok: false, error: "Too large" }, { status: 400 });
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), stripeWebhookSecret()))
    return Response.json({ ok: false, error: "Bad signature" }, { status: 400 });
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "Not JSON" }, { status: 400 });
  }
  // Nov 26: the message is Stripe's own from here on. Whatever goes wrong below that this code
  // did not expect is answered 500, so Stripe sends it again. Before, an exception was Stripe's
  // to guess at, and a payment could be lost with it.
  try {
    return await handle(event);
  } catch (e) {
    console.error("Stripe webhook: stopped by an error, so Stripe is asked again —", errText(e));
    return sendAgain("The site could not deal with this just now");
  }
}

async function handle(event: unknown): Promise<Response> {
  const { stripeSecretKey, expirePlanCardPages } = await import("@/lib/roof-care-checkout.server");
  const notifyMod = await import("@/lib/notify.server");
  const paid = paidPlanEvent(event);
  // Nov 24: a payment from a bank account says two more things before or instead of "paid":
  // it was started and has not cleared, or it did not go through.
  const bank = paid ? null : bankPlanEvent(event);
  // Nov 26: paid on one of our pages, and not readable as a plan's payment (another currency).
  const odd = paid || bank ? null : unmatchedPaidEvent(event);
  const about = paid ?? bank ?? odd;
  if (!about) return Response.json({ ok: true, handled: false });

  // Nov 24: a notice counts only when it is from the same side of Stripe, test or live, as the
  // site's own key (roof-care-checkout.ts). One from the other side records nothing. Said once
  // in the server log here, and to the admins below once the property is known.
  const keyMode = stripeKeyMode(stripeSecretKey());
  const wrongMode = !eventModeFits(event, keyMode);
  const refusedMode = () => Response.json({ ok: false, handled: true, error: CARD_MODE_REFUSED });
  if (wrongMode)
    console.error(
      `Stripe webhook: ${cardModeLogLine(eventMode(event), keyMode)} Plan ${about.plan_id ?? "not named"}, reference ${about.ref}. Nothing was recorded.`,
    );

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: plan, error: pErr } = about.plan_id
    ? await supabaseAdmin
        .from("roof_care_plans")
        .select("id, plan, site_id, customer_email, status, sold_by")
        .eq("id", about.plan_id)
        .maybeSingle()
    : { data: null, error: null };
  if (pErr) return sendAgain(pErr.message);

  const admins = async () => {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .in("role", ["admin", "manager"]);
    return (data ?? []).map((p) => p.id);
  };
  type Notice = { kind: string; title: string; body: string; url: string | null };
  /**
   * An alarm about one payment, told once however often Stripe sends its message again: an
   * earlier notice of the same kind of news that carries the reference means it was said.
   * False when it could not be said.
   */
  const alarmOnce = async (ref: string, notice: Notice): Promise<boolean> => {
    try {
      const news = notice.title.split(":")[0] ?? notice.title;
      const { data: before, error } = await supabaseAdmin
        .from("notifications")
        .select("id")
        .eq("kind", PLAN_MONEY_ALARM_KIND)
        .ilike("title", `${news}%`)
        .ilike("body", `%Reference ${ref}.%`)
        .limit(1);
      if (error) throw new Error(error.message);
      if (before?.length) return true;
      await notifyMod.notify(await admins(), notice, supabaseAdmin);
      return true;
    } catch (e) {
      console.error("Stripe webhook: could not tell the admins —", errText(e));
      return false;
    }
  };

  if (!plan) {
    if (wrongMode) return refusedMode();
    // Nov 26: money was taken and there is no plan to put it on. It used to be answered and
    // told to nobody. A bank step for a plan that is gone has taken nothing: left as it was.
    if (paid || odd) {
      const told = await alarmOnce(
        about.ref,
        unmatchedMoneyNotice({
          site_id: null,
          site: null,
          amount_words: paid ? usd(paid.amount) : (odd?.amount_words ?? ""),
          ref: about.ref,
          why: odd && !odd.usd ? "currency" : "no_plan",
        }),
      );
      // The notice is the only record of it: when it could not be said, Stripe is asked again.
      if (!told) return sendAgain("The admins could not be told");
      return Response.json({ ok: true, handled: true, result: "unmatched" });
    }
    return Response.json({ ok: true, handled: false, reason: "No such plan" });
  }

  const { data: site } = await supabaseAdmin
    .from("crm_sites")
    .select("name")
    .eq("id", plan.site_id)
    .maybeSingle();

  if (wrongMode) {
    // Told, not retried, like any other payment the site refuses.
    try {
      await notifyMod.notify(
        await admins(),
        cardModeNotice({
          site_id: plan.site_id,
          site: site?.name ?? null,
          event: eventMode(event),
          key: keyMode,
          ref: about.ref,
        }),
        supabaseAdmin,
      );
    } catch (e) {
      console.error("Stripe webhook: could not tell the admins —", errText(e));
    }
    return refusedMode();
  }

  // Nov 26: paid, ours, and in another currency. Nothing can be recorded from it.
  if (odd) {
    const told = await alarmOnce(
      odd.ref,
      unmatchedMoneyNotice({
        site_id: plan.site_id,
        site: site?.name ?? null,
        amount_words: odd.amount_words,
        ref: odd.ref,
        why: odd.usd ? "no_plan" : "currency",
      }),
    );
    if (!told) return sendAgain("The admins could not be told");
    return Response.json({ ok: true, handled: true, result: "unmatched" });
  }

  // A bank payment that has not cleared, or did not go through: nothing is recorded as paid.
  // Nov 26: the plan is stamped while the money is on its way (and as told just now, so the
  // "signed, not paid" notice does not follow), and the stamp is taken off when it fails. The
  // database decides whether the plan is waiting, in the same step.
  if (bank) {
    const { data: step, error: bErr } = await databaseRpc(supabaseAdmin)("roof_care_bank_pending", {
      p_plan: plan.id,
      p_ref: bank.ref,
      p_amount: bank.amount,
      p_step: bank.step,
    });
    if (bErr) {
      console.error("Stripe webhook: the bank payment was not followed —", bErr.message);
      return sendAgain("The bank payment could not be followed on the plan");
    }
    const facts = {
      plan: plan.plan,
      site_id: plan.site_id,
      site: site?.name ?? null,
      step: bank.step,
      amount: bank.amount,
      ref: bank.ref,
    };
    if (bank.step === "started" && step === "started") {
      // Money is on its way: any other page still open for this plan is closed.
      await expirePlanCardPages(supabaseAdmin, plan.id);
      try {
        await notifyMod.notify(await admins(), bankPaymentNotice(facts), supabaseAdmin);
      } catch (e) {
        console.error("Stripe webhook: could not tell the admins —", errText(e));
      }
    } else if (bank.step === "started" && step === "not_waiting") {
      // Nov 26: "The plan starts when it clears" was said of a plan that could not start.
      await alarmOnce(bank.ref, bankPaymentNotice({ ...facts, waiting: false }));
    } else if (bank.step === "failed") {
      await alarmOnce(
        bank.ref,
        bankPaymentNotice({ ...facts, waiting: plan.status === "awaiting_payment" }),
      );
    }
    return Response.json({ ok: true, handled: true, result: `bank_${bank.step}` });
  }
  if (!paid) return Response.json({ ok: true, handled: false });

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

  const { data: result, error } = await databaseRpc(supabaseAdmin)("roof_care_card_paid", {
    p_plan: paid.plan_id,
    p_amount: paid.amount,
    p_ref: paid.ref,
    // Nov 26: a bank payment is recorded as one. It used to be recorded as a card payment.
    p_bank: paid.bank,
  });
  if (error) {
    // Nov 26: the money is with Stripe and the site holds no row of it. Answered 500, so
    // Stripe sends it again: a reference is taken once, so a later try records it once. The
    // admins are told once, not at every try.
    console.error("Stripe webhook: plan", paid.plan_id, "—", error.message);
    await alarmOnce(
      paid.ref,
      cardNotRecordedNotice({
        site_id: plan.site_id,
        site: site?.name ?? null,
        amount: paid.amount,
        ref: paid.ref,
        bank: paid.bank,
      }),
    );
    return sendAgain("The payment could not be recorded");
  }
  if (result !== "already") {
    // Nov 26: the payment is in. Every other page still open for this plan is closed, so a
    // second one cannot be paid. After a payment that was short, too: its own page is over.
    await expirePlanCardPages(supabaseAdmin, plan.id);
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
          bank: paid.bank,
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
