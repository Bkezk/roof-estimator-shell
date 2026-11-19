/**
 * Paying a Roof Care plan year by card, online (owner, Nov 19: "if the pay by card is selected
 * at the end it needs to reroute to the stripe checkout once that's set up", and that night:
 * "build the infrastructure for this and I'll add the stripe backend when I get that done").
 *
 * The rules and the words only; roof-care-checkout.server.ts talks to Stripe. Nothing here runs
 * until the two secrets are in Lovable Cloud (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET): until
 * then Card means the office takes the card, as before.
 *
 * How it goes once they are in:
 *   1. Signing with Card makes a checkout page at Stripe for the plan year's amount and sends
 *      the browser to it.
 *   2. Stripe tells the site the payment is in (a signed message to /api/stripe/webhook).
 *   3. The site checks the signature and the amount, records the payment on the plan, and the
 *      plan starts (roof_care_card_paid() in the database).
 */
import { longDay } from "@/lib/followup-rules";
import { planName, planNumberLabel } from "@/lib/roof-care-plan";

export const checkoutReadyKey = ["roof-care-checkout-ready"] as const;

/** Why a checkout page cannot be made, in the office's words. */
export const CHECKOUT_NOT_SET_UP =
  "Paying by card online is not set up yet. The office takes the card and marks the invoice paid.";
export const CHECKOUT_NO_SITE_ADDRESS =
  "Paying by card online needs the site's own address (APP_URL) in Lovable Cloud › Secrets.";
export const CHECKOUT_NOT_WAITING = "This plan is not waiting for a payment";
export const CHECKOUT_NOTHING_OWED = "Nothing is owed for this plan year";

/** Under Card on the sign-up, once online payment is set up. */
export const PAY_CARD_NOTE_ONLINE =
  "After you agree, you go to our secure card payment page. Your plan starts the day the payment is received.";
export const CHECKOUT_BUTTON = "Open the card payment page";

/** Dollars to the cents Stripe counts in. Null for an amount that is not a payable one. */
export function toCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const c = Math.round(Number((amount * 100).toFixed(4)));
  // Stripe's smallest charge is 50 cents and its largest eight digits.
  return c >= 50 && c <= 99_999_999 ? c : null;
}

/** What the customer owes for the year: the final invoice's balance, else the plan's price. */
export function checkoutAmount(
  plan: { price: number; renewal_credit: number | null },
  invoice: { status: string; total: number; paid_amount: number | null } | null,
): number {
  if (invoice && invoice.status === "final")
    return Math.max(0, Math.round((invoice.total - (invoice.paid_amount ?? 0)) * 100) / 100);
  return Math.max(0, Math.round((plan.price - (plan.renewal_credit ?? 0)) * 100) / 100);
}

export interface CheckoutAsk {
  plan_id: string;
  plan: unknown;
  plan_number: number | null;
  site_name: string;
  cents: number;
  email: string | null;
  success_url: string;
  cancel_url: string;
}

/** The form Stripe's "create a Checkout Session" takes, one payment for the year. */
export function checkoutForm(a: CheckoutAsk): URLSearchParams {
  const f = new URLSearchParams();
  const label = a.plan_number != null ? ` (${planNumberLabel(a.plan_number)})` : "";
  f.set("mode", "payment");
  f.set("success_url", a.success_url);
  f.set("cancel_url", a.cancel_url);
  f.set("client_reference_id", a.plan_id);
  f.set("metadata[kind]", "roof_care_plan");
  f.set("metadata[plan_id]", a.plan_id);
  f.set("payment_intent_data[metadata][plan_id]", a.plan_id);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", "usd");
  f.set("line_items[0][price_data][unit_amount]", String(a.cents));
  f.set(
    "line_items[0][price_data][product_data][name]",
    `${planName(a.plan)} plan, one year${label}${a.site_name.trim() ? `: ${a.site_name.trim()}` : ""}`.slice(
      0,
      240,
    ),
  );
  if (a.email) f.set("customer_email", a.email);
  return f;
}

/** "t=1700000000,v1=abc,v1=def" → the time and every v1 signature. Null when it is not one. */
export function parseSignatureHeader(header: string | null): { t: number; v1: string[] } | null {
  if (!header) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  return t != null && v1.length ? { t, v1 } : null;
}

/** How old a signed message may be, in seconds: older is refused (a replay). */
export const SIGNATURE_TOLERANCE_S = 300;

export interface PaidEvent {
  plan_id: string;
  amount: number;
  ref: string;
  email: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A paid Roof Care checkout out of Stripe's event, or null for anything else (another kind of
 * event, a checkout of something that is not a plan, one not paid yet, another currency).
 */
export function paidPlanEvent(event: unknown): PaidEvent | null {
  const e = (event ?? {}) as Record<string, unknown>;
  if (
    e["type"] !== "checkout.session.completed" &&
    e["type"] !== "checkout.session.async_payment_succeeded"
  )
    return null;
  const o = ((e["data"] as Record<string, unknown> | undefined)?.["object"] ?? {}) as Record<
    string,
    unknown
  >;
  if (o["payment_status"] !== "paid") return null;
  if (String(o["currency"] ?? "").toLowerCase() !== "usd") return null;
  const meta = (o["metadata"] ?? {}) as Record<string, unknown>;
  if (meta["kind"] !== "roof_care_plan") return null;
  const planId = String(meta["plan_id"] ?? "");
  const cents = Number(o["amount_total"]);
  const ref = String(o["payment_intent"] ?? o["id"] ?? "");
  if (!UUID.test(planId) || !Number.isFinite(cents) || cents <= 0 || !ref) return null;
  const email =
    typeof o["customer_email"] === "string" && o["customer_email"]
      ? (o["customer_email"] as string)
      : (((o["customer_details"] as Record<string, unknown> | undefined)?.["email"] as
          string | undefined) ?? null);
  return { plan_id: planId, amount: Math.round(cents) / 100, ref, email };
}

/** "Paid by card online Nov 19, 2026 ($1,234.00, ref pi_…)." */
export function cardPaidWords(c: {
  on: string;
  amount: number | null;
  ref: string | null;
}): string {
  const bits = [
    c.amount != null
      ? "$" +
        c.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "",
    c.ref ? `ref ${c.ref}` : "",
  ].filter(Boolean);
  return `Paid by card online ${longDay(c.on)}${bits.length ? ` (${bits.join(", ")})` : ""}.`;
}
export const CARD_PAID_INVOICE_OPEN =
  "Its invoice still has to be finalised and marked paid, so the books match.";

/** What the office is told when a card payment comes in. */
export function cardPaidNotice(a: {
  plan: unknown;
  site_id: string;
  site: string | null;
  result: string;
}) {
  const place = (a.site ?? "").trim() || "a property";
  const body =
    a.result === "invoice_paid"
      ? "The customer paid the year by card online. Its invoice is marked paid and the plan has started."
      : a.result === "started"
        ? "The customer paid the year by card online and the plan has started. Its invoice still has to be finalised and marked paid."
        : a.result === "not_waiting"
          ? "A card payment came in online for a plan that was not waiting for one. Check whether it was paid twice."
          : "A card payment came in online.";
  return {
    kind: "plan_card_paid",
    title: `${planName(a.plan)} plan paid by card: ${place}`,
    body,
    url: `/properties/${a.site_id}`,
  };
}
