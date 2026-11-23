/**
 * Sends a Roof Care customer their agreement and their receipt — SERVER ONLY (uses
 * notify.server.ts; load it with `await import("@/lib/roof-care-email.server")` in a handler).
 *
 * The owner, Nov 19: "the terms need to be emailed to the customer at signup as well as a
 * receipt ideally". The agreement goes when the plan is signed and has an email address; the
 * receipt when its payment is received (the plan has started). Both are tried at once where
 * they are made, and again by the scheduled run until they have gone: a plan signed while email
 * was not set up gets its agreement once it is.
 *
 * Each email is claimed before it is sent (one conditional update stamps the sent time only
 * where it is still empty), so two runs at once send one between them. A send that fails puts
 * the stamp back and keeps why, for the plan to say. Nothing older than a month is sent: an
 * agreement that arrives weeks late is worse than none.
 */
import {
  appUrl,
  emailConfigured,
  hasServiceRole,
  sendEmail,
  serverClient,
  type Client,
} from "@/lib/notify.server";
import { readBenefits, type BenefitNumbers } from "@/lib/roof-care-benefits";
import {
  agreementEmail,
  receiptEmail,
  TERMS_NOT_ON_FILE,
  type Email,
  type PlanEmailFacts,
} from "@/lib/roof-care-email";
import { asPayMethod, FIRST_VISIT_CHOICES, type FirstVisit } from "@/lib/roof-care-plan";
import { asPlanKey } from "@/lib/roof-care-plan";
import { payLinkFor } from "@/lib/roof-care-pay-link";
import { localYmd, TASK_TZ } from "@/lib/tasks";
import { plusDays } from "@/lib/working-days";

/** Nothing signed or paid longer ago than this is emailed. */
export const PLAN_EMAIL_MAX_AGE_DAYS = 30;
export const EMAIL_NOT_SET_UP = "Email is not set up yet (RESEND_API_KEY)";
export const EMAIL_NO_SENDER =
  "Email is not set up yet: NOTIFY_FROM_EMAIL is not set, so mail would only reach the email account's owner";

export interface PlanEmailResult {
  agreements_sent: number;
  receipts_sent: number;
  email_errors: number;
  /** Why nothing was tried, when nothing was. */
  held: string | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SELECT =
  "id, plan, plan_number, site_id, agreed_by, signed_on, price, pay_method, first_visit, first_days, terms_version, status, pay_first, paid_on, starts_on, renews_on, customer_email, agreement_sent_at, agreement_error, receipt_sent_at, receipt_error, card_paid_amount, pay_token" as const;

/** Why email cannot go from this server at all, or null. */
export function planEmailHeld(): string | null {
  if (!hasServiceRole()) return "This server has no service key";
  if (!emailConfigured()) return EMAIL_NOT_SET_UP;
  if (!process.env["NOTIFY_FROM_EMAIL"]) return EMAIL_NO_SENDER;
  return null;
}

/**
 * Send what is waiting: every plan's, or one plan's (`planId`, right after it is signed or its
 * address is changed). `send`: the sender, for tests.
 */
export async function dispatchPlanEmails(
  sb: Client,
  opts: { planId?: string } = {},
  now: Date = new Date(),
  send: typeof sendEmail = sendEmail,
): Promise<PlanEmailResult> {
  const out: PlanEmailResult = {
    agreements_sent: 0,
    receipts_sent: 0,
    email_errors: 0,
    held: null,
  };
  const held = planEmailHeld();
  const admin = await serverClient(sb);
  const today = localYmd(now, TASK_TZ);
  const since = plusDays(today, -PLAN_EMAIL_MAX_AGE_DAYS);
  let q = admin
    .from("roof_care_plans")
    .select(SELECT)
    .not("customer_email", "is", null)
    .eq("pay_first", true)
    .gte("signed_on", plusDays(since, -366))
    .or("agreement_sent_at.is.null,receipt_sent_at.is.null")
    .limit(200);
  if (opts.planId) q = q.eq("id", opts.planId);
  const { data: plans, error } = await q;
  if (error) throw new Error(error.message);
  const due = (plans ?? []).filter(
    (p) =>
      (!p.agreement_sent_at && p.status !== "ended" && p.signed_on >= since) ||
      (!p.receipt_sent_at && !!p.paid_on && p.paid_on >= since),
  );
  if (!due.length) return out;
  if (held) {
    out.held = held;
    // Said on the plan, once: why its email has not gone.
    if (hasServiceRole()) {
      for (const p of due) {
        const patch: { agreement_error?: string; receipt_error?: string } = {};
        if (!p.agreement_sent_at && p.status !== "ended" && p.agreement_error !== held)
          patch.agreement_error = held;
        if (!p.receipt_sent_at && p.paid_on && p.receipt_error !== held) patch.receipt_error = held;
        if (Object.keys(patch).length)
          await admin.from("roof_care_plans").update(patch).eq("id", p.id);
      }
    }
    return out;
  }
  const [{ data: sites }, { data: company }, benefitsAnswer] = await Promise.all([
    admin
      .from("crm_sites")
      .select("id, name, address1, city, state, zip")
      .in("id", [...new Set(due.map((p) => p.site_id))]),
    admin.from("company_settings").select("company_name, phone, email").limit(1),
    admin
      .from("roof_care_settings")
      .select("data")
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);
  const siteOf = new Map((sites ?? []).map((s) => [s.id, s]));
  const co = company?.[0];
  const companyName = (co?.company_name ?? "").trim() || "JBK Commercial Roofing";
  const contact = [co?.phone, co?.email]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" or ");
  const benefits = benefitsFromSettings(benefitsAnswer.data?.[0]?.data);
  const stamp = now.toISOString();
  // The customer's own card payment link goes in the agreement (Nov 23) when paying by card
  // online is set up. Without it the agreement reads as it always did.
  const { stripeConfigured } = await import("@/lib/roof-care-checkout.server");
  const payBase = stripeConfigured() ? appUrl() : "";

  for (const p of due) {
    const plan = asPlanKey(p.plan);
    const to = (p.customer_email ?? "").trim();
    if (!plan || !to) continue;
    const s = siteOf.get(p.site_id);
    const facts: PlanEmailFacts = {
      plan,
      plan_number: p.plan_number,
      site: (s?.name ?? "").trim(),
      address: [s?.address1, s?.city, [s?.state, s?.zip].filter(Boolean).join(" ")]
        .map((x) => (x ?? "").trim())
        .filter(Boolean)
        .join(", "),
      agreed_by: p.agreed_by ?? "",
      signed_on: p.signed_on,
      price: Number(p.price) || 0,
      pay_method: asPayMethod(p.pay_method),
      first_visit: (FIRST_VISIT_CHOICES as readonly string[]).includes(p.first_visit)
        ? (p.first_visit as FirstVisit)
        : "window",
      first_days: p.first_days,
      terms_version: p.terms_version ?? "",
      benefits: benefits?.[plan] ?? null,
      company: companyName,
      contact,
      pay_link:
        payBase && p.pay_method === "card" && p.status === "awaiting_payment" && p.pay_token
          ? payLinkFor(payBase, p.pay_token)
          : null,
    };

    if (!p.agreement_sent_at && p.status !== "ended" && p.signed_on >= since) {
      const mail = agreementEmail(facts);
      if (!mail) {
        if (p.agreement_error !== TERMS_NOT_ON_FILE)
          await admin
            .from("roof_care_plans")
            .update({ agreement_error: TERMS_NOT_ON_FILE })
            .eq("id", p.id);
        out.email_errors++;
      } else if (await sendClaimed(admin, p.id, "agreement", to, mail, stamp, send)) {
        out.agreements_sent++;
        // The plan says when the link went, so the office knows the customer has it.
        if (facts.pay_link)
          await admin.from("roof_care_plans").update({ pay_link_sent_at: stamp }).eq("id", p.id);
      } else out.email_errors++;
    }

    if (!p.receipt_sent_at && p.paid_on && p.paid_on >= since && p.starts_on) {
      const { data: inv } = await admin
        .from("invoices")
        .select("display_number, paid_amount, status")
        .eq("roof_care_plan_id", p.id)
        .neq("status", "void");
      // What the invoices say was paid; else a card payment taken online whose invoice is
      // not marked paid yet.
      const paid =
        (inv ?? []).reduce((n, i) => n + (Number(i.paid_amount) || 0), 0) ||
        Number(p.card_paid_amount) ||
        0;
      // A renewal at no charge has nothing to receipt.
      if (paid <= 0) continue;
      const mail = receiptEmail({
        ...facts,
        paid,
        paid_on: p.paid_on,
        starts_on: p.starts_on,
        renews_on: p.renews_on,
        invoice_number: inv?.[0]?.display_number ?? null,
      });
      if (await sendClaimed(admin, p.id, "receipt", to, mail, stamp, send)) out.receipts_sent++;
      else out.email_errors++;
    }
  }
  return out;
}

/** The numbers a plan's description needs, straight from the settings (this pass is not signed in). */
function benefitsFromSettings(d: unknown): BenefitNumbers | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const plans = (o["plans"] ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const n = (v: unknown) => Math.max(0, Number(v) || 0);
  return readBenefits({
    watch: { allowance: n(plans["watch"]?.["allowance"]), leak_calls: 0, storm: 0 },
    care: { allowance: n(plans["care"]?.["allowance"]), leak_calls: 0, storm: 0 },
    guard: {
      allowance: n(plans["guard"]?.["allowance"]),
      leak_calls: Math.round(n(o["guard_leak_calls"])),
      storm: Math.round(n(o["guard_storm_inspections"])),
    },
  });
}

/** Claim, send, and on a failure put the claim back with why. True when it went. */
async function sendClaimed(
  admin: Client,
  planId: string,
  what: "agreement" | "receipt",
  to: string,
  mail: Email,
  stamp: string,
  send: typeof sendEmail,
): Promise<boolean> {
  const sentCol = what === "agreement" ? "agreement_sent_at" : "receipt_sent_at";
  const { data: won, error } = await admin
    .from("roof_care_plans")
    .update(
      what === "agreement"
        ? { agreement_sent_at: stamp, agreement_error: null }
        : { receipt_sent_at: stamp, receipt_error: null },
    )
    .eq("id", planId)
    .is(sentCol, null)
    .select("id");
  if (error) {
    console.error(`Roof Care ${what} email: plan ${planId} could not be claimed —`, error.message);
    return false;
  }
  // Another run has it.
  if (!won?.length) return true;
  let failure: string | null = null;
  try {
    const r = await send({ to, subject: mail.subject, text: mail.text, html: mail.html });
    if (!r.ok) failure = r.error;
  } catch (e) {
    failure = errText(e);
  }
  if (!failure) return true;
  console.error(`Roof Care ${what} email: plan ${planId} —`, failure);
  await admin
    .from("roof_care_plans")
    .update(
      what === "agreement"
        ? { agreement_sent_at: null, agreement_error: failure.slice(0, 300) }
        : { receipt_sent_at: null, receipt_error: failure.slice(0, 300) },
    )
    .eq("id", planId)
    .eq(sentCol, stamp);
  return false;
}
