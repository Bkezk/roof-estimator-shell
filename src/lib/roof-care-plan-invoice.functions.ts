/**
 * The invoice of a Roof Care plan year (owner, Nov 19: "we are going to do payment up front
 * rather than at time of service", "they can pay up front by check").
 *
 * A plan that is signed waits for its payment. One invoice for the year belongs to the plan
 * itself (invoices.roof_care_plan_id), numbered after the plan: plan 1001 is invoice RC-1001.
 * It is made as a draft, as a trade bid's is, with one line at the plan's price. The office
 * finalises it and sends it like any invoice. The day it is marked paid in full, the database
 * starts the plan (20261119600000_roof_care_pay_first.sql).
 *
 * Only someone who makes invoices can make it: the rule on invoices is the database's. A
 * technician who signs a customer up on site leaves the plan waiting, and the office makes the
 * invoice from the plan.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { longDay } from "@/lib/followup-rules";
import {
  PLAN_INVOICE_NOT_AWAITING,
  planInvoiceLineWords,
  planName,
  planNumberLabel,
  renewalCreditSource,
  renewalStartsOn,
  renewalCreditWords,
} from "@/lib/roof-care-plan";
import { accountBillTo } from "@/lib/vendors";

type Sb = SupabaseClient<Database>;

/** The one line of a plan year's invoice. A service, as labor is: not taxed. */
export function planInvoiceLine(plan: unknown, price: number) {
  const amount = Math.max(0, Number(price) || 0);
  return {
    sort: 1,
    kind: "other",
    description: planInvoiceLineWords(plan),
    qty: 1,
    unit: "ea",
    rate: amount,
    total: amount,
    // The year's cost is on the inspections' own invoices, which bill nothing.
    cost_rate: 0,
    cost_total: 0,
    on_date: null,
    source: null,
    taxable: false,
    // It prints on the customer's invoice in its own words.
    show_on_invoice: true,
  };
}

/**
 * The second line of a renewal's invoice (Nov 19): what is taken off for the inspections of
 * last plan year we did not get to. Null when nothing is.
 */
export function renewalCreditLine(planId: string, credit: number, owed: number) {
  const amount = Math.round((Number(credit) || 0) * 100) / 100;
  if (!(amount > 0)) return null;
  return {
    sort: 2,
    kind: "other",
    description: renewalCreditWords(owed),
    qty: 1,
    unit: "ea",
    rate: -amount,
    total: -amount,
    cost_rate: 0,
    cost_total: 0,
    on_date: null,
    source: renewalCreditSource(planId),
    taxable: false,
    show_on_invoice: true,
  };
}

/** "Roof Care plan RC-1001 for Main Office, about 22,000 sq ft of roof. …" */
export function planInvoiceDescription(p: {
  plan: unknown;
  plan_number: number;
  roof_sqft: number;
  /** For a renewal: the first day of the new plan year, the day after the old year's last. */
  renews_from?: string | null;
}): string {
  const size = Math.round(Number(p.roof_sqft) || 0).toLocaleString("en-US");
  const what = `${planName(p.plan)} plan ${planNumberLabel(p.plan_number)}`;
  if (p.renews_from)
    return `${what}, renewed for one year, on about ${size} sq ft of roof. The new plan year starts ${longDay(p.renews_from)}, or the day this invoice is paid when that is later.`;
  return `${what}, for one year, on about ${size} sq ft of roof. The plan year starts the day this invoice is paid.`;
}

/**
 * The plan's invoice, made if it has none: `made` says which. Refused in plain words for a plan
 * that is not waiting for its payment. Called with the caller's sign-in.
 */
export async function makePlanInvoice(
  sb: Sb,
  planId: string,
  who: { id: string; name: string | null },
): Promise<{ id: string; made: boolean }> {
  const { data: plan, error } = await sb
    .from("roof_care_plans")
    .select(
      "id, plan, status, pay_first, plan_number, price, roof_sqft, account_id, site_id, renewed_from, renewal_credit, renewal_owed",
    )
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!plan) throw new Error("That plan was not found");
  if (plan.status !== "awaiting_payment" || !plan.pay_first || plan.plan_number == null)
    throw new Error(PLAN_INVOICE_NOT_AWAITING);
  const live = async () => {
    const { data, error: lErr } = await sb
      .from("invoices")
      .select("id")
      .eq("roof_care_plan_id", plan.id)
      .neq("status", "void")
      .limit(1);
    if (lErr) throw new Error(lErr.message);
    return data?.[0]?.id ?? null;
  };
  const already = await live();
  if (already) return { id: already, made: false };

  const [{ data: account, error: aErr }, { data: site, error: sErr }] = await Promise.all([
    sb.from("crm_accounts").select("*").eq("id", plan.account_id).maybeSingle(),
    sb.from("crm_sites").select("*").eq("id", plan.site_id).maybeSingle(),
  ]);
  if (aErr) throw new Error(aErr.message);
  if (sErr) throw new Error(sErr.message);
  const { loadSettings, totals } = await import("@/lib/invoices.server");
  const { siteAddressLine } = await import("@/lib/crm.functions");
  const settings = await loadSettings(sb);
  const line = planInvoiceLine(plan.plan, Number(plan.price));
  // A renewal (Nov 19): what is taken off for last year's inspections not done, and the day
  // the year it renews runs out.
  const credit = plan.renewed_from
    ? renewalCreditLine(plan.id, Number(plan.renewal_credit), Number(plan.renewal_owed))
    : null;
  const lines = credit ? [line, credit] : [line];
  let renewsFrom: string | null = null;
  if (plan.renewed_from) {
    const { data: old } = await sb
      .from("roof_care_plans")
      .select("renews_on")
      .eq("id", plan.renewed_from)
      .maybeSingle();
    renewsFrom = old?.renews_on ? renewalStartsOn(old.renews_on) : null;
  }
  // A plan is a service: no sales tax. The Tax % box on the draft is still the office's.
  const taxRate = 0;
  const { data: made, error: insErr } = await sb
    .from("invoices")
    .insert({
      roof_care_plan_id: plan.id,
      service_job_id: null,
      bid_id: null,
      number: null,
      display_number: planNumberLabel(plan.plan_number),
      status: "draft",
      bill_to: accountBillTo(account, null) as unknown as Json,
      bill_to_vendor_id: null,
      property: { name: site?.name ?? "", address: siteAddressLine(site) } as unknown as Json,
      description: planInvoiceDescription({
        plan: plan.plan,
        plan_number: plan.plan_number,
        roof_sqft: Number(plan.roof_sqft),
        renews_from: renewsFrom,
      }),
      payment_terms: settings.payment_terms,
      tax_rate: taxRate,
      ...totals(lines, taxRate),
      created_by: who.id,
      updated_by_name: who.name,
    })
    .select("id")
    .single();
  if (insErr || !made) {
    // Two made at once: the database keeps one invoice for a plan. The other one's is the answer.
    const other = insErr?.code === "23505" ? await live() : null;
    if (other) return { id: other, made: false };
    throw new Error(insErr?.message ?? "The invoice was not created");
  }
  const { error: lErr } = await sb
    .from("invoice_lines")
    .insert(lines.map((l) => ({ ...l, invoice_id: made.id })));
  if (lErr) {
    // No draft is left without its line: it would hold the plan's number at no amount.
    await sb.from("invoices").delete().eq("id", made.id);
    throw new Error(lErr.message);
  }
  return { id: made.id, made: true };
}

export const createRoofCarePlanInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ id: string; made: boolean }> => {
    const { nameOf, office } = await import("@/lib/invoices.functions");
    const p = await office(context);
    return makePlanInvoice(context.supabase, data.plan_id, {
      id: context.userId,
      name: nameOf(p),
    });
  });
