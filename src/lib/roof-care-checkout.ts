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
 *
 * Put right before it is switched on (owner, Nov 20: break test, number 26). Every card payment
 * is kept as its own row (roof_care_card_payments), and a reference is taken once. A payment
 * that covers what is owed starts the plan and marks its waiting invoice final and paid by card.
 * A payment for a plan that is not waiting (paid another way already, ended, or cancelled while
 * it waited), or one that does not cover what is owed, changes nothing on the plan: it is kept
 * as money to send back, and the admins and managers are told. Anything over what was owed is
 * told the same way.
 *
 * Nov 26 (the audit of Nov 25, numbers 1 to 4 and 26; owner: "go on 1, 2, 3 (do you want to just
 * go ahead and build bank payments too?), 4"):
 *   - Every card page the site makes is kept on its plan (roof_care_plans.card_sessions) and
 *     closes by itself within 75 minutes. The site closes the open ones when the plan is paid,
 *     when a bank payment starts, and before a page is made for another amount, so a page made
 *     before a price change cannot take the old amount.
 *   - A payment from a bank account is its own thing: while it is on its way the plan is
 *     stamped (bank_pending_at) and no other payment is asked for; cleared, the plan and its
 *     invoice say bank, not card (paid_by_bank).
 *   - A payment that cannot be recorded is sent again by Stripe (the site answers 500), and
 *     money the site cannot match to a plan is told to the admins and managers.
 *   - The alarms have a kind of their own that no tick turns off (PLAN_MONEY_ALARM_KIND).
 */
import { longDay } from "@/lib/followup-rules";
import { PLAN_MONEY_ALARM_KIND } from "@/lib/notice-types";
import { planName, planNumberLabel } from "@/lib/roof-care-plan";

export const checkoutReadyKey = ["roof-care-checkout-ready"] as const;

/** Why a checkout page cannot be made, in the office's words. */
export const CHECKOUT_NOT_SET_UP =
  "Paying by card online is not set up yet. The office takes the card and marks the invoice paid.";
export const CHECKOUT_NO_SITE_ADDRESS =
  "Paying by card online needs the site's own address (APP_URL) in Lovable Cloud › Secrets.";
export const CHECKOUT_NOT_WAITING = "This plan is not waiting for a payment";
export const CHECKOUT_NOTHING_OWED = "Nothing is owed for this plan year";
/**
 * A technician opens the card page from a ticket at the property and nowhere else (Nov 26, the
 * audit's number 18): there they can measure the roof. Said when no such ticket came with it.
 */
export const CHECKOUT_FROM_TICKET =
  "The card payment page opens from a ticket at this property. Open the ticket, press Care Plan, and open it from there.";
/** Said in place of a card page while a payment from a bank account is on its way (Nov 26). */
export const BANK_PENDING_OFFICE =
  "A payment from the customer's bank account is on its way. It takes a few business days, and there is nothing more to do.";
/** A page that could not be kept on its plan is closed again and not handed out (Nov 26). */
export const CARD_PAGE_NOT_KEPT =
  "The card payment page could not be made just now. Nothing was charged. Please try again in a minute.";

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

/**
 * What the customer owes for the year: the plan's price less its renewal credit, less what its
 * invoice already holds. The invoice counts only when it is the plan's own, for that amount to
 * the cent (Nov 20): the database starts a plan on no other (roof_care_card_paid).
 */
export function checkoutAmount(
  plan: { price: number; renewal_credit: number | null },
  invoice: { status: string; total: number; paid_amount: number | null } | null,
): number {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const owed = Math.max(0, r2(plan.price - (plan.renewal_credit ?? 0)));
  const fits =
    !!invoice &&
    (invoice.status === "draft" || invoice.status === "final") &&
    r2(invoice.total) === owed;
  return fits ? Math.max(0, r2(owed - (invoice.paid_amount ?? 0))) : owed;
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
  /**
   * "link" when the page is opened from the customer's own payment link (Nov 23), which comes
   * back to a public page. Stripe keeps one page per plan, amount and hour for each of the two
   * ways in, so a page made for the office is never handed to the customer or the other way.
   */
  via?: "link";
  /**
   * When the page closes by itself, in seconds since 1970 (Nov 26). Set by the server from the
   * same quarter hour the page's key is made from (cardPageTimes).
   */
  expires_at?: number;
}

// ── A card page's own life (Nov 26, the audit's number 1) ───────────────────────────────────
//
// Stripe keeps a page open for 24 hours unless it is told otherwise, and nothing could close
// one: a page opened before the roof size was corrected still charged the old price a day
// later. Now every page closes by itself, and the site keeps each one on its plan so it can
// close it sooner.
//
// Stripe hands back the same page when the same ask comes twice with the same key, and refuses
// a key that comes back with a different ask. So the key and the closing time are made from
// the same quarter hour: a page asked for twice within it is one page with one closing time.

/** A page's key holds the quarter hour it was asked in. */
export const CARD_PAGE_BUCKET_S = 15 * 60;
/** A page closes this long after its quarter hour began: between 60 and 75 minutes are left. */
export const CARD_PAGE_LIFE_S = 75 * 60;

/** The quarter hour `nowS` falls in, and when a page asked for in it closes by itself. */
export function cardPageTimes(nowS: number): { bucket: number; expires_at: number } {
  const bucket = Math.floor(nowS / CARD_PAGE_BUCKET_S);
  return { bucket, expires_at: bucket * CARD_PAGE_BUCKET_S + CARD_PAGE_LIFE_S };
}

/**
 * The key Stripe knows one ask by: the plan, the way in, the amount, the quarter hour, and a
 * short mark of everything the ask says (`formMark`: the customer's email, the property's
 * name, the plan's number). Until Nov 26 the key left those out, so an email corrected within
 * the hour made Stripe refuse the page. `again`: set when the page Stripe handed back is one
 * the site has already closed, so a new one is made.
 */
export function cardPageKey(
  a: Pick<CheckoutAsk, "plan_id" | "cents" | "via">,
  bucket: number,
  formMark: string,
  again = "",
): string {
  return `roof-care-${a.via === "link" ? "link-" : ""}${a.plan_id}-${a.cents}-${bucket}-${formMark}${again ? `-${again}` : ""}`;
}

/** One card page kept on a plan (roof_care_plans.card_sessions). */
export interface CardSession {
  /** Stripe's own name of the page. */
  id: string;
  cents: number;
  via: "link" | "office";
  /** When it closes by itself, in seconds since 1970. 0 when that was not kept. */
  expires: number;
  /** True once the site has closed it, or found it over. */
  closed: boolean;
}

const SESSION_ID = /^cs_[A-Za-z0-9_]{6,250}$/;

/** The pages kept on a plan, read strictly: anything that is not one is left out. */
export function readCardSessions(v: unknown): CardSession[] {
  if (!Array.isArray(v)) return [];
  const out: CardSession[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const id = typeof o["id"] === "string" ? o["id"] : "";
    const cents = Number(o["cents"]);
    if (!SESSION_ID.test(id) || !Number.isFinite(cents) || cents <= 0) continue;
    const expires = Number(o["expires"]);
    out.push({
      id,
      cents: Math.round(cents),
      via: o["via"] === "link" ? "link" : "office",
      expires: Number.isFinite(expires) && expires > 0 ? Math.floor(expires) : 0,
      closed: typeof o["closed_at"] === "string" && o["closed_at"] !== "",
    });
  }
  return out;
}

/** The kept pages a customer could still pay on: not closed, and not over by themselves. */
export const openCardSessions = (list: readonly CardSession[], nowS: number): CardSession[] =>
  list.filter((s) => !s.closed && (s.expires === 0 || s.expires > nowS));

// ── A bank payment on its way (Nov 26, the audit's number 3) ────────────────────────────────

/** A plan's bank payment that has started and not cleared (roof_care_plans.bank_pending_*). */
export interface BankPending {
  ref: string;
  amount: number | null;
  at: string;
}

/**
 * How long a bank payment is waited for. Stripe says within four business days whether it
 * cleared or failed; a stamp older than this is one whose answer never reached the site, and
 * the customer is no longer held by it.
 */
export const BANK_PENDING_MAX_DAYS = 10;

/** Is a bank payment on its way just now? `at`: roof_care_plans.bank_pending_at. */
export function bankPendingNow(at: unknown, nowMs: number = Date.now()): boolean {
  if (typeof at !== "string" || !at) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && nowMs - t < BANK_PENDING_MAX_DAYS * 86_400_000;
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
  // Nov 26: the page closes by itself (cardPageTimes).
  if (a.expires_at != null) f.set("expires_at", String(a.expires_at));
  // Nov 26 (the audit's number 4): the price is in US dollars for everyone. Left on, Stripe
  // can charge a customer abroad in their own money, and the site would not know the payment.
  f.set("adaptive_pricing[enabled]", "false");
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
  /** Paid from a bank account: it cleared some days after the checkout (Nov 24). */
  bank: boolean;
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
  return {
    plan_id: planId,
    amount: Math.round(cents) / 100,
    ref,
    email,
    // A payment that succeeds later than its checkout came from a bank account (ACH).
    bank: e["type"] === "checkout.session.async_payment_succeeded",
  };
}

/**
 * Money Stripe says was paid on one of our Roof Care pages that `paidPlanEvent` cannot read as
 * a plan's payment (Nov 26, the audit's number 4): it is in another currency, or it names no
 * plan the site can read. It used to be answered "nothing to do" and nobody was told. Null for
 * a payment that reads fine, and for anything that is not a paid Roof Care checkout.
 */
export interface UnmatchedPaid {
  /** The plan it names, when it names one. */
  plan_id: string | null;
  /** "1,234.00 CAD", as Stripe gave it, or "" when it gave no amount. */
  amount_words: string;
  ref: string;
  /** True when the payment is in US dollars: then it is the plan that could not be read. */
  usd: boolean;
}

export function unmatchedPaidEvent(event: unknown): UnmatchedPaid | null {
  if (paidPlanEvent(event)) return null;
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
  const meta = (o["metadata"] ?? {}) as Record<string, unknown>;
  if (meta["kind"] !== "roof_care_plan") return null;
  const planId = String(meta["plan_id"] ?? "");
  const cents = Number(o["amount_total"]);
  const currency = String(o["currency"] ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 5);
  const amount =
    Number.isFinite(cents) && cents > 0
      ? (Math.round(cents) / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";
  return {
    plan_id: UUID.test(planId) ? planId.toLowerCase() : null,
    amount_words: amount ? `${amount}${currency ? ` ${currency}` : ""}` : "",
    ref: String(o["payment_intent"] ?? o["id"] ?? "").slice(0, 200) || "not given",
    usd: currency === "USD",
  };
}

// ── A payment from a bank account (owner, Nov 24: "handle the rest of the solutions") ────────
//
// With bank payments (ACH) turned on in Stripe, a customer can pay from a bank account on the
// same payment page. It costs far less than a card, and it is slow: the checkout is finished at
// once, but the money takes up to four business days to clear, and it can fail. Stripe says so
// in three steps: the checkout completed and not yet paid, then paid (above), or failed.

/** The two steps of a bank payment that are not "paid". */
export type BankStep = "started" | "failed";
export interface BankEvent {
  step: BankStep;
  plan_id: string;
  /** Dollars. */
  amount: number;
  ref: string;
}

/**
 * A Roof Care checkout paid from a bank account that has not cleared (`started`) or did not go
 * through (`failed`), or null for anything else.
 */
export function bankPlanEvent(event: unknown): BankEvent | null {
  const e = (event ?? {}) as Record<string, unknown>;
  const o = ((e["data"] as Record<string, unknown> | undefined)?.["object"] ?? {}) as Record<
    string,
    unknown
  >;
  const step: BankStep | null =
    e["type"] === "checkout.session.async_payment_failed"
      ? "failed"
      : e["type"] === "checkout.session.completed" && o["payment_status"] === "unpaid"
        ? "started"
        : null;
  if (!step) return null;
  if (String(o["currency"] ?? "").toLowerCase() !== "usd") return null;
  const meta = (o["metadata"] ?? {}) as Record<string, unknown>;
  if (meta["kind"] !== "roof_care_plan") return null;
  const planId = String(meta["plan_id"] ?? "");
  const cents = Number(o["amount_total"]);
  const ref = String(o["payment_intent"] ?? o["id"] ?? "");
  if (!UUID.test(planId) || !Number.isFinite(cents) || cents <= 0 || !ref) return null;
  return { step, plan_id: planId, amount: Math.round(cents) / 100, ref };
}

/**
 * Test and live are kept apart (Nov 24, the public pages audit). Stripe has two sides, test
 * and live, each with its own keys, and every message it sends says which side it is from
 * (`livemode`). A payment notice counts only when it is from the same side as the site's own
 * key: a live key takes live notices only, a test key takes test notices only. A notice from
 * the other side records nothing; the server log and the admins are told.
 */
export type StripeMode = "live" | "test";

/** Which side a Stripe key is from, read from how it starts. Null when it cannot be told. */
export function stripeKeyMode(key: string | null | undefined): StripeMode | null {
  const m = /^(?:sk|rk)_(live|test)_/.exec((key ?? "").trim());
  return m ? (m[1] as StripeMode) : null;
}

/** Which side an event says it is from. Null when it does not say. */
export function eventMode(event: unknown): StripeMode | null {
  const live = ((event ?? {}) as Record<string, unknown>)["livemode"];
  return live === true ? "live" : live === false ? "test" : null;
}

/** True only when the event says its side and it is the key's own. */
export function eventModeFits(event: unknown, keyMode: StripeMode | null): boolean {
  return keyMode !== null && eventMode(event) === keyMode;
}

/** What Stripe is answered when a notice is from the other side. */
export const CARD_MODE_REFUSED =
  "Refused: this notice and the site's Stripe key are not both test or both live. Nothing was recorded.";

const modeWord = (m: StripeMode | null) => (m === "live" ? "live" : m === "test" ? "test" : "");

/** The one line the server log gets. */
export function cardModeLogLine(event: StripeMode | null, key: StripeMode | null): string {
  const notice = event ? `a ${modeWord(event)} payment notice` : "a payment notice with no mode";
  const site = key
    ? `the site's Stripe key is a ${modeWord(key)} key`
    : "the site's Stripe key does not start like a test or a live key";
  return `refused ${notice}: ${site}.`;
}

/** What the admins and managers are told. */
export function cardModeNotice(a: {
  site_id: string | null;
  site: string | null;
  event: StripeMode | null;
  key: StripeMode | null;
  ref: string;
}) {
  const place = (a.site ?? "").trim() || "a property";
  const sent = a.event ? `a ${modeWord(a.event)} payment notice` : "a payment notice";
  const set = a.key
    ? `the site is set up with a ${modeWord(a.key)} Stripe key`
    : "the site's Stripe key is not a test key or a live key";
  return {
    kind: PLAN_MONEY_ALARM_KIND,
    title: `A card payment notice was refused: ${place}`,
    body: `Stripe sent ${sent}, but ${set}. Nothing was recorded and the plan is not changed. Reference ${a.ref}. In Lovable Cloud › Secrets, the Stripe key and the Stripe webhook secret must both come from the same side of Stripe: both test, or both live.`,
    url: a.site_id ? `/properties/${a.site_id}` : null,
  };
}

/**
 * "Paid by card online Nov 19, 2026 ($1,234.00, ref pi_…)." With `bank` (Nov 26): "Paid from a
 * bank account online …".
 */
export function cardPaidWords(c: {
  on: string;
  amount: number | null;
  ref: string | null;
  bank?: boolean | null;
}): string {
  const bits = [
    c.amount != null
      ? "$" +
        c.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "",
    c.ref ? `ref ${c.ref}` : "",
  ].filter(Boolean);
  const how = c.bank ? "Paid from a bank account online" : "Paid by card online";
  return `${how} ${longDay(c.on)}${bits.length ? ` (${bits.join(", ")})` : ""}.`;
}
export const CARD_PAID_INVOICE_OPEN =
  "Its invoice still has to be finalised and marked paid, so the books match.";

/** A row of roof_care_card_payments, as the notice reads it. */
export interface CardPaymentRow {
  amount: number;
  /** "started": it paid for the plan year. "send_back": it is owed back to the customer. */
  outcome: string;
  /** Why it is owed back: "paid_already", "ended" or "short". */
  reason: string | null;
  /** What was owed for the plan year when it came in. */
  owed: number | null;
  /** How much of it is over what was owed. */
  over: number;
  ref: string;
}

const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What the office is told at the two steps of a bank payment that are not "paid".
 *
 * Nov 26: "started" is news and keeps the ordinary kind and its tick. "Failed" is an alarm.
 * `waiting` false: the plan was not waiting for a payment when the step came in (it was paid
 * another way, or has ended), so the words do not promise that it starts.
 */
export function bankPaymentNotice(a: {
  plan: unknown;
  site_id: string;
  site: string | null;
  step: BankStep;
  amount: number;
  ref: string;
  waiting?: boolean;
}) {
  const place = (a.site ?? "").trim() || "a property";
  const url = `/properties/${a.site_id}`;
  const waiting = a.waiting !== false;
  if (a.step === "failed")
    return {
      kind: PLAN_MONEY_ALARM_KIND,
      title: `Bank payment failed: ${place}`,
      body: waiting
        ? `The customer's bank payment of ${usd(a.amount)} for the ${planName(a.plan)} plan did not go through, so the plan has not started. Reach out to the customer: the payment link on the plan still works, or take a check. Reference ${a.ref}.`
        : `A bank payment of ${usd(a.amount)} for the ${planName(a.plan)} plan did not go through. The plan was not waiting for it, so nothing changes and nothing is owed back. Reference ${a.ref}.`,
      url,
    };
  if (!waiting)
    return {
      kind: PLAN_MONEY_ALARM_KIND,
      title: `Bank payment started for a plan that is not waiting: ${place}`,
      body: `A customer started a bank payment of ${usd(a.amount)} for the ${planName(a.plan)} plan, and that plan is not waiting for a payment: it was paid another way, or it has ended. Nothing was recorded. If the payment clears in the next few business days, you will be told to send it back. Reference ${a.ref}.`,
      url,
    };
  return {
    kind: "plan_card_paid",
    title: `Bank payment started: ${place}`,
    body: `The customer paid ${usd(a.amount)} for the ${planName(a.plan)} plan from a bank account online. A bank payment takes up to 4 business days to clear. The plan starts when it clears, and you will be told then. Nothing to do until it does.`,
    url,
  };
}

/**
 * A payment came in and the site could not record it (Nov 26, the audit's number 2). The site
 * answers Stripe with an error, so Stripe sends the payment again by itself, for up to three
 * days. Told once for a payment, however often it is sent again.
 */
export function cardNotRecordedNotice(a: {
  site_id: string;
  site: string | null;
  amount: number;
  ref: string;
  bank?: boolean;
}) {
  const place = (a.site ?? "").trim() || "a property";
  return {
    kind: PLAN_MONEY_ALARM_KIND,
    title: `A ${a.bank ? "bank" : "card"} payment could not be recorded: ${place}`,
    body: `A payment of ${usd(a.amount)} came in online and the site could not record it just now, so the plan has not started. The payment company sends it again by itself for up to three days. If the plan still shows as not paid tomorrow, look the payment up in Stripe. Reference ${a.ref}.`,
    url: `/properties/${a.site_id}`,
  };
}

/**
 * Money was taken on one of our Roof Care payment pages and the site cannot match it to a plan
 * (Nov 26, the audit's number 4): the plan is gone, or the payment is in another currency.
 * Nothing was recorded anywhere, so a person has to look.
 */
export function unmatchedMoneyNotice(a: {
  site_id: string | null;
  site: string | null;
  amount_words: string;
  ref: string;
  why: "no_plan" | "currency";
}) {
  const place = (a.site ?? "").trim();
  const took = a.amount_words ? `A payment of ${a.amount_words}` : "A payment";
  const cause =
    a.why === "currency"
      ? "it is not in US dollars, so the site cannot tell whether it covers the plan"
      : "the plan it was for is no longer on the site";
  return {
    kind: PLAN_MONEY_ALARM_KIND,
    title: `Money was taken and could not be matched${place ? `: ${place}` : ""}`,
    body: `${took} was taken online for a Roof Care plan, and ${cause}. Nothing was recorded and no plan was started. Look the payment up in Stripe by its reference, then send it back or record it by hand. Reference ${a.ref}.`,
    url: a.site_id ? `/properties/${a.site_id}` : null,
  };
}

/** What the office is told when a card payment comes in. */
export function cardPaidNotice(a: {
  plan: unknown;
  site_id: string;
  site: string | null;
  result: string;
  /** The payment as it was kept; absent on an older read. */
  payment?: CardPaymentRow | null;
  /** It came from a bank account and has cleared (Nov 24). */
  bank?: boolean;
}) {
  const place = (a.site ?? "").trim() || "a property";
  const pay = a.payment ?? null;
  const url = `/properties/${a.site_id}`;
  // Nov 26: money to send back is an alarm, under no tick. The ordinary "paid" keeps its kind.
  const paidHow = a.bank ? "bank payment" : "card payment";
  if (a.result === "send_back") {
    const amount = pay ? usd(pay.amount) : `A ${paidHow}`;
    const ref = pay ? ` Reference ${pay.ref}.` : "";
    const lead = pay ? `A ${paidHow} of ${amount} came in online` : `A ${paidHow} came in online`;
    const back = pay ? `Send the ${amount} back to the customer.` : "Send it back to the customer.";
    const body =
      pay?.reason === "ended"
        ? `${lead} for a ${planName(a.plan)} plan that has ended. Nothing was started. ${back}${ref}`
        : pay?.reason === "short"
          ? `${lead}, and ${usd(pay.owed ?? 0)} is owed for the ${planName(a.plan)} plan. The plan has not started. ${back} Then take the full payment.${ref}`
          : `${lead} for a ${planName(a.plan)} plan that was already paid. The plan is not changed. ${back}${ref}`;
    return {
      kind: PLAN_MONEY_ALARM_KIND,
      title: `${a.bank ? "Bank" : "Card"} payment to send back: ${place}`,
      body,
      url,
    };
  }
  const isOver = !!pay && pay.over >= 0.01;
  const over =
    pay && isOver
      ? ` The ${a.bank ? "customer paid" : "card was charged"} ${usd(pay.amount)}, which is ${usd(pay.over)} more than the ${usd(pay.owed ?? 0)} owed. Send the ${usd(pay.over)} back to the customer. Reference ${pay.ref}.`
      : "";
  // A bank payment that cleared is the same news, in its own words.
  const how = a.bank ? "from a bank account online" : "by card online";
  const body =
    a.result === "invoice_paid"
      ? `The customer paid the year ${how}. Its invoice is marked paid and the plan has started.${over}`
      : a.result === "started"
        ? `The customer paid the year ${how} and the plan has started. Its invoice still has to be put right and marked paid, so the books match.${over}`
        : a.bank
          ? "A bank payment came in online."
          : "A card payment came in online.";
  return {
    // Part of it has to go back: that is an alarm too.
    kind: isOver ? PLAN_MONEY_ALARM_KIND : "plan_card_paid",
    title: `${planName(a.plan)} plan paid by ${a.bank ? "bank payment" : "card"}: ${place}`,
    body,
    url,
  };
}
