/**
 * A Roof Care customer's own card payment link: the server functions (roof-care-pay-link.ts has
 * the rules and the words).
 *
 * Two of them are public: the page a link opens, and its Pay button. They carry no sign-in and
 * reach the database with the site's own key, as the two QR pages do, so nothing is ever given
 * to the anonymous role. Each takes one thing from the visitor, the token, and answers only
 * about the one plan that token belongs to: its name, its property's name and the amount. A
 * token that matches nothing, and a plan that is over, get the same answer. Every call is
 * counted against the connection (public_form_take, kind "pay").
 *
 * The other two are the office's: read a plan's link to copy, and email it to the customer.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Client } from "@/lib/notify.server";
import { PUBLIC_NOT_READY, PUBLIC_TOO_MANY, PUBLIC_TRY_AGAIN } from "@/lib/public-forms";
import {
  CHECKOUT_NO_SITE_ADDRESS,
  CHECKOUT_NOT_SET_UP,
  CHECKOUT_NOT_WAITING,
  type CheckoutAsk,
} from "@/lib/roof-care-checkout";
import {
  cleanPayToken,
  PAY_CLOSED,
  PAY_LINK_NO_EMAIL,
  PAY_OFFLINE,
  PAY_SAMPLE_START,
  payLinkFor,
  payPageState,
  type PlanPayLink,
  type PublicPayFacts,
} from "@/lib/roof-care-pay-link";
import { asPlanKey, planNumberLabel } from "@/lib/roof-care-plan";
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
}

const PLAN_SELECT =
  "id, plan, plan_number, site_id, status, price, renewal_credit, customer_email, renews_on, pay_token" as const;

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

/** What a payment link's page shows. */
export async function payPageFor(tokenIn: unknown, d: PayDeps): Promise<PublicPayFacts> {
  const token = cleanPayToken(tokenIn);
  if (!d.admin) {
    if (d.sample) return token ? SAMPLE_PAY_FACTS : CLOSED;
    throw new Error(PUBLIC_NOT_READY);
  }
  await withinLimit(d.admin, d.key);
  if (!token) return CLOSED;
  const plan = await planByToken(d.admin, token);
  const key = plan ? asPlanKey(plan.plan) : null;
  if (!plan || !key) return CLOSED;
  const waiting = plan.status === "awaiting_payment";
  const cents = waiting ? await d.owed(d.admin, plan) : null;
  const state = payPageState(plan.status, cents, d.stripe && !!d.base);
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
  await withinLimit(d.admin, d.key);
  if (!token) throw new Error(PAY_CLOSED);
  const plan = await planByToken(d.admin, token);
  if (!plan || plan.status !== "awaiting_payment") throw new Error(PAY_CLOSED);
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
  return {
    admin: await server.publicAdmin(),
    key: server.connectionKey(getRequest().headers),
    sample: server.publicSampleMode(),
    base: notify.appUrl(),
    stripe: checkout.stripeConfigured(),
    owed: checkout.planOwedCents,
    makePage: (ask) => checkout.createCheckoutSession(ask),
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
  "id, plan, plan_number, site_id, status, price, renewal_credit, customer_email, pay_method, pay_token, pay_link_sent_at, agreed_by" as const;

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

/** Why there is no link to give for this plan just now, or null. */
async function linkHeld(status: string): Promise<{ reason: string | null; base: string }> {
  const { stripeConfigured } = await import("@/lib/roof-care-checkout.server");
  const { appUrl } = await import("@/lib/notify.server");
  const base = appUrl();
  if (status !== "awaiting_payment") return { reason: CHECKOUT_NOT_WAITING, base };
  if (!stripeConfigured()) return { reason: CHECKOUT_NOT_SET_UP, base };
  if (!base) return { reason: CHECKOUT_NO_SITE_ADDRESS, base };
  return { reason: null, base };
}

/** A plan's card payment link, to copy, and whether the site can email it. */
export const planPayLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PlanPayLink> => {
    const { plan } = await seenPlan(context, data.plan_id);
    const { reason, base } = await linkHeld(plan.status);
    const to = (plan.customer_email ?? "").trim() || null;
    const { planEmailHeld } = await import("@/lib/roof-care-email.server");
    return {
      url: reason ? null : payLinkFor(base, plan.pay_token),
      reason,
      to,
      sent_at: plan.pay_link_sent_at,
      email_reason: planEmailHeld() ?? (to ? null : PAY_LINK_NO_EMAIL),
    };
  });

/** Email the plan's card payment link to the customer on the plan. Refused in plain words. */
export const emailPlanPayLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ to: string; sent_at: string }> => {
    const { admin, plan } = await seenPlan(context, data.plan_id);
    const { reason, base } = await linkHeld(plan.status);
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
    const r = await sendEmail({ to, subject: mail.subject, text: mail.text, html: mail.html });
    if (!r.ok) throw new Error(`The email did not go: ${r.error}`);
    const sent_at = new Date().toISOString();
    await admin.from("roof_care_plans").update({ pay_link_sent_at: sent_at }).eq("id", plan.id);
    return { to, sent_at };
  });
