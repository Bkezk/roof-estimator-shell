/**
 * A Roof Care customer's own card payment link: the server functions (roof-care-pay-link.ts has
 * the rules and the words).
 *
 * Two of them are public: the page a link opens, and its Pay button. They carry no sign-in and
 * reach the database with the site's own key, as the two QR pages do, so nothing is ever given
 * to the anonymous role. Each takes one thing from the visitor, the token, and answers only
 * about the one plan that token belongs to: its name, its property's name and the amount. A
 * token that matches nothing, and a plan that is over, get the same answer. Every call for a
 * real plan's link is counted against the connection (public_form_take, kind "pay").
 *
 * The other two are the office's: read a plan's link to copy, and email it to the customer.
 *
 * Nov 26 (the audit of Nov 25, numbers 1, 3, 18 and 28):
 *   - The page takes no payment while the roof size is not confirmed, or while a payment from
 *     the customer's bank account is on its way. Each is a sentence and no button.
 *   - A call whose token is not a plan's reads nothing more and is not counted: it used to use
 *     up the day's count that every customer shares.
 *   - The office's two functions are the office's: a technician no longer reads the link or
 *     the customer's email through them, and cannot email the customer.
 *   - The card page is made through openPlanCardPage, which keeps it on the plan.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Client } from "@/lib/notify.server";
import { PUBLIC_NOT_READY, PUBLIC_TOO_MANY, PUBLIC_TRY_AGAIN } from "@/lib/public-forms";
import {
  BANK_PENDING_OFFICE,
  bankPendingNow,
  CHECKOUT_NO_SITE_ADDRESS,
  CHECKOUT_NOT_SET_UP,
  CHECKOUT_NOT_WAITING,
  type BankPending,
  type CheckoutAsk,
} from "@/lib/roof-care-checkout";
import {
  cleanPayToken,
  PAY_BANK_ON_ITS_WAY,
  PAY_CLOSED,
  PAY_HELD_SIZE,
  PAY_LINK_NO_EMAIL,
  PAY_LINK_OFFICE_ONLY,
  PAY_OFFLINE,
  PAY_SAMPLE_START,
  PAY_SIZE_NOT_READY,
  payLinkFor,
  payPageState,
  type PlanPayLink,
  type PublicPayFacts,
} from "@/lib/roof-care-pay-link";
import { asPlanKey, planNumberLabel, readsPlanTables } from "@/lib/roof-care-plan";
import { PLAN_NAMES } from "@/lib/roof-care-price";

/** What the two public functions need from the server, so a test can stand in for each. */
export interface PayDeps {
  /** The site's own database client; null where the server has no key. */
  admin: Client | null;
  /** The key this connection is counted under. */
  key: string;
  /** True on the local test server only. */
  sample: boolean;
  /** The site's own address (APP_URL), or "". */
  base: string;
  /** Is paying by card online set up? */
  stripe: boolean;
  owed: (admin: Client, plan: PlanRead) => Promise<number | null>;
  /** Nov 26: is a payment from the customer's bank account on its way? */
  card: (admin: Client, planId: string) => Promise<{ bank_pending: BankPending | null }>;
  makePage: (ask: CheckoutAsk) => Promise<{ id: string; url: string }>;
}

interface PlanRead {
  id: string;
  plan: string;
  plan_number: number | null;
  site_id: string;
  status: string;
  price: number | string | null;
  renewal_credit: number | string | null;
  customer_email: string | null;
  renews_on: string | null;
  pay_token: string;
  /** Nov 26: read here too. A size nobody confirmed takes no payment on this page either. */
  size_unchecked: boolean | null;
}

const PLAN_SELECT =
  "id, plan, plan_number, site_id, status, price, renewal_credit, customer_email, renews_on, pay_token, size_unchecked" as const;

const CLOSED: PublicPayFacts = {
  state: "closed",
  plan_name: "",
  plan_label: "",
  site: "",
  amount: null,
  runs_until: null,
};

/** Made-up facts for the local test server, which keeps nothing and charges nothing. */
export const SAMPLE_PAY_FACTS: PublicPayFacts = {
  state: "pay",
  plan_name: "Roof Care",
  plan_label: "RC-0000",
  site: "Sample building",
  amount: 1234,
  runs_until: null,
  sample: true,
};

async function withinLimit(admin: Client, key: string): Promise<void> {
  // The counter is the site's own server's alone, so it is not in the signed-in types.
  const { data, error } = await (
    admin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc("public_form_take", { p_kind: "pay", p_key: key });
  if (error) {
    console.error("Payment link: the limit could not be read —", error.message);
    throw new Error(PUBLIC_TRY_AGAIN);
  }
  if (data !== true) throw new Error(PUBLIC_TOO_MANY);
}

async function planByToken(admin: Client, token: string): Promise<PlanRead | null> {
  const { data, error } = await admin
    .from("roof_care_plans")
    .select(PLAN_SELECT)
    .eq("pay_token", token)
    .maybeSingle();
  if (error) {
    console.error("Payment link: the plan could not be read —", error.message);
    throw new Error(PUBLIC_TRY_AGAIN);
  }
  return (data as PlanRead | null) ?? null;
}

async function siteName(admin: Client, siteId: string): Promise<string> {
  const { data } = await admin.from("crm_sites").select("name").eq("id", siteId).maybeSingle();
  return (data?.name ?? "").trim();
}

/** Is a payment from the bank on its way for this plan? A read that fails is "try again". */
async function bankOnItsWay(d: PayDeps, admin: Client, planId: string): Promise<boolean> {
  try {
    return bankPendingNow((await d.card(admin, planId)).bank_pending?.at);
  } catch (e) {
    console.error("Payment link: the plan's payments could not be read —", e);
    throw new Error(PUBLIC_TRY_AGAIN);
  }
}

/** What a payment link's page shows. */
export async function payPageFor(tokenIn: unknown, d: PayDeps): Promise<PublicPayFacts> {
  const token = cleanPayToken(tokenIn);
  if (!d.admin) {
    if (d.sample) return token ? SAMPLE_PAY_FACTS : CLOSED;
    throw new Error(PUBLIC_NOT_READY);
  }
  // Nov 26 (the audit's number 28): a call with no whole token, or with one that is no plan's,
  // is answered at once and not counted. Counted, anybody could use up the day's count that
  // every customer shares, and the real links would stop opening. Only a real plan's page is.
  if (!token) return CLOSED;
  const plan = await planByToken(d.admin, token);
  const key = plan ? asPlanKey(plan.plan) : null;
  if (!plan || !key) return CLOSED;
  await withinLimit(d.admin, d.key);
  const waiting = plan.status === "awaiting_payment";
  const pending = waiting ? await bankOnItsWay(d, d.admin, plan.id) : false;
  const held = waiting && plan.size_unchecked === true;
  // The amount is shown only where it can be paid: a size not confirmed may still change it.
  const cents = waiting && !pending && !held ? await d.owed(d.admin, plan) : null;
  const state = payPageState(plan.status, cents, d.stripe && !!d.base, {
    bank_pending: pending,
    size_unchecked: held,
  });
  if (state === "closed") return CLOSED;
  return {
    state,
    plan_name: PLAN_NAMES[key],
    plan_label: plan.plan_number != null ? planNumberLabel(plan.plan_number) : "",
    site: await siteName(d.admin, plan.site_id),
    amount: cents != null ? cents / 100 : null,
    runs_until: state === "paid" ? plan.renews_on : null,
  };
}

/** The Pay button: the card payment page for this link's plan. */
export async function payStartFor(tokenIn: unknown, d: PayDeps): Promise<{ url: string }> {
  const token = cleanPayToken(tokenIn);
  if (!d.admin) {
    if (d.sample) throw new Error(PAY_SAMPLE_START);
    throw new Error(PUBLIC_NOT_READY);
  }
  if (!token) throw new Error(PAY_CLOSED);
  const plan = await planByToken(d.admin, token);
  if (!plan) throw new Error(PAY_CLOSED);
  await withinLimit(d.admin, d.key);
  if (plan.status !== "awaiting_payment") throw new Error(PAY_CLOSED);
  // Nov 26: the page says these two and shows no button. The server holds the same line for a
  // page left open from before, and for anyone who calls it by hand.
  if (await bankOnItsWay(d, d.admin, plan.id)) throw new Error(PAY_BANK_ON_ITS_WAY);
  if (plan.size_unchecked === true) throw new Error(PAY_SIZE_NOT_READY);
  if (!d.stripe || !d.base) throw new Error(PAY_OFFLINE);
  const cents = await d.owed(d.admin, plan);
  if (cents == null) throw new Error(PAY_CLOSED);
  const link = payLinkFor(d.base, plan.pay_token);
  try {
    const made = await d.makePage({
      plan_id: plan.id,
      plan: plan.plan,
      plan_number: plan.plan_number,
      site_name: await siteName(d.admin, plan.site_id),
      cents,
      email: plan.customer_email ?? null,
      // Back to the same link either way: paid, it says thank you; not paid, it offers Pay again.
      success_url: `${link}?paid=1`,
      cancel_url: link,
      via: "link",
    });
    return { url: made.url };
  } catch (e) {
    // The payment company's own words are for the office's log, never for a visitor.
    console.error("Payment link: the card page could not be made —", e);
    throw new Error(PAY_OFFLINE);
  }
}

/** The real doors, made from the request that came in. SERVER ONLY. */
async function realDeps(): Promise<PayDeps> {
  const [{ getRequest }, server, checkout, notify] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/lib/public-forms.server"),
    import("@/lib/roof-care-checkout.server"),
    import("@/lib/notify.server"),
  ]);
  const admin = await server.publicAdmin();
  return {
    admin,
    key: server.connectionKey(getRequest().headers),
    sample: server.publicSampleMode(),
    base: notify.appUrl(),
    stripe: checkout.stripeConfigured(),
    owed: checkout.planOwedCents,
    card: checkout.planCardState,
    // Nov 26: through the one door that keeps the page on its plan, so it can be closed when
    // the plan's price changes. With no server key no page is ever asked for.
    makePage: (ask) => {
      if (!admin) throw new Error(PAY_OFFLINE);
      return checkout.openPlanCardPage(admin, ask);
    },
  };
}

export const publicPayPage = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }): Promise<PublicPayFacts> =>
    payPageFor((data as { token?: unknown } | null)?.token, await realDeps()),
  );

export const publicPayStart = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }): Promise<{ url: string }> =>
    payStartFor((data as { token?: unknown } | null)?.token, await realDeps()),
  );

// ── The office's side ────────────────────────────────────────────────────────────────────────

type Ctx = { supabase: Client; userId: string };

const OFFICE_SELECT =
  "id, plan, plan_number, site_id, status, price, renewal_credit, customer_email, pay_method, pay_token, pay_link_sent_at, agreed_by, size_unchecked" as const;

/** The plan, for someone the database says may see it. Read with the server's own key. */
async function seenPlan(ctx: Ctx, planId: string) {
  const { data: seen, error: sErr } = await ctx.supabase.rpc("roof_care_plan_seen", {
    p_plan: planId,
  });
  if (sErr) throw new Error(sErr.message);
  if (seen !== true) throw new Error("That plan was not found");
  const { serverClient } = await import("@/lib/notify.server");
  const admin = await serverClient(ctx.supabase);
  const { data: plan, error } = await admin
    .from("roof_care_plans")
    .select(OFFICE_SELECT)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!plan) throw new Error("That plan was not found");
  return { admin, plan };
}

/**
 * Why there is no link to give for this plan just now, or null. `bankPending` (Nov 26): a
 * payment from the customer's bank account is on its way, so no other is asked for.
 */
async function linkHeld(
  plan: {
    status: string;
    size_unchecked?: boolean | null;
  },
  bankPending = false,
): Promise<{ reason: string | null; base: string }> {
  const { stripeConfigured } = await import("@/lib/roof-care-checkout.server");
  const { appUrl } = await import("@/lib/notify.server");
  const base = appUrl();
  if (plan.status !== "awaiting_payment") return { reason: CHECKOUT_NOT_WAITING, base };
  if (bankPending) return { reason: BANK_PENDING_OFFICE, base };
  // Nov 24 (owner): no payment is asked for until the roof size is confirmed.
  if (plan.size_unchecked === true) return { reason: PAY_HELD_SIZE, base };
  if (!stripeConfigured()) return { reason: CHECKOUT_NOT_SET_UP, base };
  if (!base) return { reason: CHECKOUT_NO_SITE_ADDRESS, base };
  return { reason: null, base };
}

/**
 * The link is the office's to read and to send (Nov 26, the audit's number 18). Until then
 * anyone the database let see the plan passed, and a technician with a ticket at the property
 * does: they read the customer's email and a link whose page shows the plan's price, and could
 * email the customer.
 */
async function officeOnly(ctx: Ctx): Promise<void> {
  const { readProfile } = await import("@/lib/profile-cache.server");
  if (!readsPlanTables(await readProfile(ctx.supabase, ctx.userId)))
    throw new Error(PAY_LINK_OFFICE_ONLY);
}

/** Is a payment from the bank on its way for a plan that waits? Read with the server's key. */
async function planBankPending(admin: Client, plan: { id: string; status: string }) {
  if (plan.status !== "awaiting_payment") return false;
  const { planCardState } = await import("@/lib/roof-care-checkout.server");
  return bankPendingNow((await planCardState(admin, plan.id)).bank_pending?.at);
}

/** A plan's card payment link, to copy, and whether the site can email it. */
export const planPayLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PlanPayLink> => {
    await officeOnly(context);
    const { admin, plan } = await seenPlan(context, data.plan_id);
    const bank_pending = await planBankPending(admin, plan);
    const { reason, base } = await linkHeld(plan, bank_pending);
    const to = (plan.customer_email ?? "").trim() || null;
    const { planEmailHeld } = await import("@/lib/roof-care-email.server");
    return {
      url: reason ? null : payLinkFor(base, plan.pay_token),
      reason,
      to,
      sent_at: plan.pay_link_sent_at,
      email_reason: planEmailHeld() ?? (to ? null : PAY_LINK_NO_EMAIL),
      bank_pending,
    };
  });

/**
 * "We measured your roof", to the customer on the plan, after a manager corrected its size
 * (Nov 24). It holds the new price and, for a card plan with online payment set up, the payment
 * link: the plan is then marked as sent its link. Refused in plain words, never half done.
 */
export async function emailSizeCorrected(
  context: Ctx,
  planId: string,
  change: {
    from_sqft: number;
    to_sqft: number;
    from_price: number;
    to_price: number;
    /** A plan year already paid: the difference the correction left to settle. */
    paid?: boolean;
    owed?: number;
  },
): Promise<{ to: string; with_link: boolean }> {
  const { admin, plan } = await seenPlan(context, planId);
  const key = asPlanKey(plan.plan);
  if (!key) throw new Error("That plan was not found");
  // A plan year already paid is told the difference: no payment link, the invoice or the
  // refund follows from the office.
  const settled = change.paid === true && plan.status === "active";
  if (!settled && plan.status !== "awaiting_payment") throw new Error(CHECKOUT_NOT_WAITING);
  const to = (plan.customer_email ?? "").trim();
  if (!to) throw new Error(PAY_LINK_NO_EMAIL);
  const [{ planEmailHeld }, { planOwedCents }, { sendEmail }, { sizeCorrectedEmail }] =
    await Promise.all([
      import("@/lib/roof-care-email.server"),
      import("@/lib/roof-care-checkout.server"),
      import("@/lib/notify.server"),
      import("@/lib/roof-care-email"),
    ]);
  const held = planEmailHeld();
  if (held) throw new Error(held);
  const cents = settled ? 0 : await planOwedCents(admin, plan);
  if (cents == null) throw new Error("Nothing is owed for this plan year");
  // The link goes with it only for a card plan, and only when the link could be given at all.
  const { reason, base } = settled ? { reason: "paid", base: "" } : await linkHeld(plan);
  const link = plan.pay_method === "card" && !reason ? payLinkFor(base, plan.pay_token) : null;
  const [{ data: site }, { data: company }] = await Promise.all([
    admin
      .from("crm_sites")
      .select("name, address1, city, state, zip")
      .eq("id", plan.site_id)
      .maybeSingle(),
    admin.from("company_settings").select("company_name, phone, email").limit(1),
  ]);
  const co = company?.[0];
  const mail = sizeCorrectedEmail({
    plan: key,
    plan_number: plan.plan_number,
    site: (site?.name ?? "").trim(),
    address: [site?.address1, site?.city, [site?.state, site?.zip].filter(Boolean).join(" ")]
      .map((x) => (x ?? "").trim())
      .filter(Boolean)
      .join(", "),
    agreed_by: plan.agreed_by ?? "",
    from_sqft: change.from_sqft,
    to_sqft: change.to_sqft,
    from_price: change.from_price,
    to_price: change.to_price,
    owed: cents / 100,
    pay_method: plan.pay_method === "card" || plan.pay_method === "check" ? plan.pay_method : null,
    pay_link: link,
    ...(settled ? { settle: change.owed ?? 0 } : {}),
    company: (co?.company_name ?? "").trim() || "JBK Commercial Roofing",
    contact: [co?.phone, co?.email]
      .map((x) => (x ?? "").trim())
      .filter(Boolean)
      .join(" or "),
  });
  const r = await sendEmail({
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    kind: "customer",
  });
  if (!r.ok) throw new Error(`The email did not go: ${r.error}`);
  if (link)
    await admin
      .from("roof_care_plans")
      .update({ pay_link_sent_at: new Date().toISOString() })
      .eq("id", plan.id);
  return { to, with_link: !!link };
}

/** Email the plan's card payment link to the customer on the plan. Refused in plain words. */
export const emailPlanPayLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ to: string; sent_at: string }> => {
    await officeOnly(context);
    const { admin, plan } = await seenPlan(context, data.plan_id);
    const { reason, base } = await linkHeld(plan, await planBankPending(admin, plan));
    if (reason) throw new Error(reason);
    const key = asPlanKey(plan.plan);
    if (!key) throw new Error("That plan was not found");
    const to = (plan.customer_email ?? "").trim();
    if (!to) throw new Error(PAY_LINK_NO_EMAIL);
    const [{ planEmailHeld }, { planOwedCents }, { sendEmail }, { payLinkEmail }] =
      await Promise.all([
        import("@/lib/roof-care-email.server"),
        import("@/lib/roof-care-checkout.server"),
        import("@/lib/notify.server"),
        import("@/lib/roof-care-email"),
      ]);
    const held = planEmailHeld();
    if (held) throw new Error(held);
    const cents = await planOwedCents(admin, plan);
    if (cents == null) throw new Error("Nothing is owed for this plan year");
    const [{ data: site }, { data: company }] = await Promise.all([
      admin
        .from("crm_sites")
        .select("name, address1, city, state, zip")
        .eq("id", plan.site_id)
        .maybeSingle(),
      admin.from("company_settings").select("company_name, phone, email").limit(1),
    ]);
    const co = company?.[0];
    const mail = payLinkEmail({
      plan: key,
      plan_number: plan.plan_number,
      site: (site?.name ?? "").trim(),
      address: [site?.address1, site?.city, [site?.state, site?.zip].filter(Boolean).join(" ")]
        .map((x) => (x ?? "").trim())
        .filter(Boolean)
        .join(", "),
      agreed_by: plan.agreed_by ?? "",
      owed: cents / 100,
      pay_link: payLinkFor(base, plan.pay_token),
      company: (co?.company_name ?? "").trim() || "JBK Commercial Roofing",
      contact: [co?.phone, co?.email]
        .map((x) => (x ?? "").trim())
        .filter(Boolean)
        .join(" or "),
    });
    const r = await sendEmail({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      kind: "customer",
    });
    if (!r.ok) throw new Error(`The email did not go: ${r.error}`);
    const sent_at = new Date().toISOString();
    await admin.from("roof_care_plans").update({ pay_link_sent_at: sent_at }).eq("id", plan.id);
    return { to, sent_at };
  });
