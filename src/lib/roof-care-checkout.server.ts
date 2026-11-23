/**
 * Paying a Roof Care plan year by card at Stripe — SERVER ONLY (roof-care-checkout.ts has the
 * rules). No Stripe library: one call to make the checkout page, one check of a signed message.
 * Both secrets live in Lovable Cloud › Secrets and are read here only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { Client } from "@/lib/notify.server";
import {
  checkoutAmount,
  parseSignatureHeader,
  SIGNATURE_TOLERANCE_S,
  toCents,
  type CheckoutAsk,
  checkoutForm,
} from "@/lib/roof-care-checkout";

export const stripeConfigured = () =>
  !!process.env["STRIPE_SECRET_KEY"] && !!process.env["STRIPE_WEBHOOK_SECRET"];

/**
 * What a plan waiting for its payment still owes, in cents, or null when nothing is payable.
 * The invoice decides the amount when it is final. Read with the server's own key (`admin`): a
 * technician cannot read invoices, and the customer's own payment link has no sign-in at all.
 * The amount is the customer's price and nothing more. One place for the office's card page
 * and the customer's link (Nov 23), so the two can never ask for different amounts.
 */
export async function planOwedCents(
  admin: Client,
  plan: { id: string; price: number | string | null; renewal_credit: number | string | null },
): Promise<number | null> {
  const { data: inv, error } = await admin
    .from("invoices")
    .select("status, total, paid_amount")
    .eq("roof_care_plan_id", plan.id)
    .neq("status", "void")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const first = inv?.[0];
  return toCents(
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
}

/** Make the checkout page. `fetcher`: for tests. Throws with Stripe's own words on a refusal. */
export async function createCheckoutSession(
  ask: CheckoutAsk,
  fetcher: typeof fetch = fetch,
): Promise<{ id: string; url: string }> {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetcher("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // One checkout page for one plan and amount, however often the button is pressed in a row.
      "Idempotency-Key": `roof-care-${ask.via === "link" ? "link-" : ""}${ask.plan_id}-${ask.cents}-${new Date().toISOString().slice(0, 13)}`,
    },
    body: checkoutForm(ask).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.id || !body.url)
    throw new Error(
      body.error?.message || `The card payment page could not be made (${res.status})`,
    );
  return { id: body.id, url: body.url };
}

/**
 * Is this message Stripe's own? The header's v1 signature must be the HMAC-SHA256 of
 * "<time>.<body>" under the endpoint's secret, and the time must be recent. `nowS`: for tests.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowS: number = Math.floor(Date.now() / 1000),
): boolean {
  const sig = parseSignatureHeader(header);
  if (!sig || !secret) return false;
  if (Math.abs(nowS - sig.t) > SIGNATURE_TOLERANCE_S) return false;
  const want = createHmac("sha256", secret).update(`${sig.t}.${rawBody}`, "utf8").digest();
  return sig.v1.some((hex) => {
    const got = Buffer.from(hex, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
