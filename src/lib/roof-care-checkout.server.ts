/**
 * Paying a Roof Care plan year by card at Stripe — SERVER ONLY (roof-care-checkout.ts has the
 * rules). No Stripe library: one call to make the checkout page, one to close one, one check of
 * a signed message. Both secrets live in Lovable Cloud › Secrets and are read here only.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Client } from "@/lib/notify.server";
import {
  CARD_PAGE_NOT_KEPT,
  cardPageKey,
  cardPageTimes,
  checkoutAmount,
  openCardSessions,
  parseSignatureHeader,
  readCardSessions,
  SIGNATURE_TOLERANCE_S,
  toCents,
  type BankPending,
  type CardSession,
  type CheckoutAsk,
  checkoutForm,
} from "@/lib/roof-care-checkout";

/**
 * The two secrets as they are used (Nov 24): with any space or line end that came along when
 * the value was pasted taken off. "" when one is not set, or is only spaces.
 */
export const stripeSecretKey = () => (process.env["STRIPE_SECRET_KEY"] ?? "").trim();
export const stripeWebhookSecret = () => (process.env["STRIPE_WEBHOOK_SECRET"] ?? "").trim();

export const stripeConfigured = () => !!stripeSecretKey() && !!stripeWebhookSecret();

const STRIPE_SESSIONS = "https://api.stripe.com/v1/checkout/sessions";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nowSeconds = () => Math.floor(Date.now() / 1000);

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

/**
 * Make the checkout page. `fetcher`, `nowS`: for tests. Throws with Stripe's own words on a
 * refusal.
 *
 * Nov 26 (the audit's numbers 1 and 28): the page closes by itself, between 60 and 75 minutes
 * from now, and its key holds a mark of the whole ask, so an ask that changed within the
 * quarter hour (a corrected email) is a new page and never a refusal. `again`: makes a page
 * anew when the one Stripe handed back is one the site has closed.
 */
export async function createCheckoutSession(
  ask: CheckoutAsk,
  fetcher: typeof fetch = fetch,
  nowS: number = nowSeconds(),
  again = "",
): Promise<{ id: string; url: string }> {
  const key = stripeSecretKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const { bucket, expires_at } = cardPageTimes(nowS);
  const body = checkoutForm({ ...ask, expires_at }).toString();
  const mark = createHash("sha256").update(body, "utf8").digest("hex").slice(0, 16);
  const res = await fetcher(STRIPE_SESSIONS, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // One checkout page for one ask, however often the button is pressed in a row.
      "Idempotency-Key": cardPageKey(ask, bucket, mark, again),
    },
    body,
  });
  const answer = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !answer.id || !answer.url)
    throw new Error(
      answer.error?.message || `The card payment page could not be made (${res.status})`,
    );
  return { id: answer.id, url: answer.url };
}

// ── The pages kept on a plan, and a bank payment on its way (Nov 26) ────────────────────────
//
// The columns and the functions are newer than the generated types: read and called loose, as
// the roof size's are.

type LooseAnswer<T> = Promise<{ data: T | null; error: { message: string } | null }>;
interface Loose {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => LooseAnswer<Record<string, unknown>[]>;
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => LooseAnswer<unknown>;
}
const loose = (admin: Client) => admin as unknown as Loose;

/** What a plan holds about paying online, beyond what the generated types know. */
export interface PlanCardState {
  /** Every card page the site made for it, the newest twenty. */
  sessions: CardSession[];
  /** A bank payment that has started and not cleared, or null. */
  bank_pending: BankPending | null;
  /** The plan year was paid from a bank account, not by card. */
  paid_by_bank: boolean;
}

/**
 * Read it with the server's own key. Throws when it cannot be read: a caller that is about to
 * take money must not go on as if no bank payment were on its way.
 */
export async function planCardState(admin: Client, planId: string): Promise<PlanCardState> {
  const { data, error } = await loose(admin)
    .from("roof_care_plans")
    .select(
      "id, card_sessions, bank_pending_ref, bank_pending_amount, bank_pending_at, paid_by_bank",
    )
    .eq("id", planId);
  if (error) throw new Error(error.message);
  const p = data?.[0] ?? {};
  const at = typeof p["bank_pending_at"] === "string" ? p["bank_pending_at"] : "";
  const amount = p["bank_pending_amount"] == null ? null : Number(p["bank_pending_amount"]);
  return {
    sessions: readCardSessions(p["card_sessions"]),
    bank_pending: at
      ? {
          ref: String(p["bank_pending_ref"] ?? ""),
          amount: amount != null && Number.isFinite(amount) ? amount : null,
          at,
        }
      : null,
    paid_by_bank: p["paid_by_bank"] === true,
  };
}

/** Was this plan year paid from a bank account? False when that cannot be read. */
export async function planPaidByBank(admin: Client, planId: string): Promise<boolean> {
  try {
    return (await planCardState(admin, planId)).paid_by_bank;
  } catch (e) {
    console.error("Roof Care: how the plan was paid could not be read —", errText(e));
    return false;
  }
}

type Closing = "closed" | "over" | "failed";

/** Close one page at Stripe. "over": it was not open any more (paid, expired, or not there). */
async function expireOne(id: string, key: string, fetcher: typeof fetch): Promise<Closing> {
  const headers = { Authorization: `Bearer ${key}` };
  const at = `${STRIPE_SESSIONS}/${encodeURIComponent(id)}`;
  // Stripe is given a few seconds: whoever waits on this (Stripe's own message, a manager's
  // Save) is not held up by a call that hangs. A page not closed still closes by itself.
  const wait = () => AbortSignal.timeout(8000);
  try {
    const res = await fetcher(`${at}/expire`, { method: "POST", headers, signal: wait() });
    if (res.ok) return "closed";
    // Stripe refuses to close a page that is not open. Ask it what the page is, so nothing
    // hangs on the wording of its refusal.
    const look = await fetcher(at, { method: "GET", headers, signal: wait() });
    if (look.status === 404) return "over";
    if (!look.ok) return "failed";
    const status = ((await look.json().catch(() => ({}))) as { status?: unknown }).status;
    return status === "expired" || status === "complete" ? "over" : "failed";
  } catch (e) {
    console.error("Roof Care: a card payment page could not be closed —", errText(e));
    return "failed";
  }
}

/**
 * Close every card page the site made for this plan that could still be paid on (Nov 26, the
 * audit's number 1), so none takes an amount the plan no longer owes. Called when the plan's
 * payment is recorded, when a bank payment starts, before a page is made for another amount,
 * and by whatever changes what a plan owes (a roof size corrected, a plan ended).
 *
 * Never throws. `closed`: how many were open and are closed now. `failed`: the pages that
 * could not be closed; each still closes by itself within 75 minutes of when it was made.
 * A page that is closed, or found paid or expired, is marked on the plan and not asked about
 * again; the marks are what tells a page Stripe hands back a second time from a new one.
 */
export async function expirePlanCardPages(
  admin: Client,
  planId: string,
  opts: { fetcher?: typeof fetch; nowS?: number } = {},
): Promise<{ closed: number; failed: string[] }> {
  const out = { closed: 0, failed: [] as string[] };
  try {
    const nowS = opts.nowS ?? nowSeconds();
    const fetcher = opts.fetcher ?? fetch;
    const open = (await planCardState(admin, planId)).sessions.filter((s) => !s.closed);
    if (!open.length) return out;
    const key = stripeSecretKey();
    const done: string[] = [];
    for (const s of open) {
      // Over by itself: nothing to ask Stripe.
      if (s.expires > 0 && s.expires <= nowS) {
        done.push(s.id);
        continue;
      }
      const r: Closing = key ? await expireOne(s.id, key, fetcher) : "failed";
      if (r === "failed") out.failed.push(s.id);
      else {
        done.push(s.id);
        if (r === "closed") out.closed += 1;
      }
    }
    if (done.length) {
      const { error } = await loose(admin).rpc("roof_care_card_sessions_closed", {
        p_plan: planId,
        p_ids: done,
      });
      if (error) console.error("Roof Care: the closed card pages were not marked —", error.message);
    }
    if (out.failed.length)
      console.error(
        `Roof Care: plan ${planId}: ${out.failed.length} card payment page(s) could not be closed. Each closes by itself within 75 minutes of when it was made.`,
      );
  } catch (e) {
    console.error("Roof Care: the plan's card pages could not be closed —", errText(e));
    out.failed.push("unread");
  }
  return out;
}

/**
 * The card page for a plan, kept on the plan (Nov 26, the audit's number 1): the one door for
 * the office's button and the customer's link.
 *
 *   1. Pages still open for another amount are closed first.
 *   2. The page is made. When Stripe hands back a page the site has already closed (the same
 *      ask, the same quarter hour), a new one is made, so nobody is left on a dead page.
 *   3. It is kept on the plan. A page that could not be kept is closed again and not handed
 *      out: one the site does not know of is one it could never close.
 */
export async function openPlanCardPage(
  admin: Client,
  ask: CheckoutAsk,
  opts: { fetcher?: typeof fetch; nowS?: number } = {},
): Promise<{ id: string; url: string }> {
  const fetcher = opts.fetcher ?? fetch;
  const nowS = opts.nowS ?? nowSeconds();
  let sessions = (await planCardState(admin, ask.plan_id)).sessions;
  if (openCardSessions(sessions, nowS).some((s) => s.cents !== ask.cents)) {
    await expirePlanCardPages(admin, ask.plan_id, { fetcher, nowS });
    sessions = (await planCardState(admin, ask.plan_id)).sessions;
  }
  let made = await createCheckoutSession(ask, fetcher, nowS);
  if (sessions.some((s) => s.id === made.id && s.closed))
    made = await createCheckoutSession(ask, fetcher, nowS, `again-${nowS}`);
  const { error } = await loose(admin).rpc("roof_care_card_session_keep", {
    p_plan: ask.plan_id,
    p_id: made.id,
    p_cents: ask.cents,
    p_via: ask.via === "link" ? "link" : "office",
    p_expires: cardPageTimes(nowS).expires_at,
  });
  if (error) {
    console.error("Roof Care: a card payment page could not be kept on its plan —", error.message);
    const key = stripeSecretKey();
    if (key) await expireOne(made.id, key, fetcher);
    throw new Error(CARD_PAGE_NOT_KEPT);
  }
  return made;
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
