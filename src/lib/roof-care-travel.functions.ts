/**
 * The server side of Roof Guard's leak calls with no travel charge (owner, Nov 19;
 * lib/roof-care-travel.ts has the rule and how it is made sure of).
 *
 *  - invoiceTravelOf: where a repair invoice stands with its property's plan, or null when the
 *    plan has no say.
 *  - syncTravel: after an invoice is made or its lines change, its one leak call line is put
 *    where the rule says, and the totals with it.
 *  - syncPlanLines: the leak call's travel first, then the minor repairs credit over what the
 *    invoice still charges. The invoice functions call this one (new draft, save, rebuild).
 *  - getInvoiceTravel, setInvoiceTravel: the plan box on the invoice.
 *
 * Every read and write is the caller's own sign-in.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  asTravelChoice,
  isTravelWaiverLine,
  travelBilled,
  travelLineSource,
  travelStep,
  travelWaived,
  travelWaiverLine,
  type InvoiceTravel,
} from "@/lib/roof-care-travel";

type Sb = SupabaseClient<Database>;
type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type LineRow = Database["public"]["Tables"]["invoice_lines"]["Row"];
type TravelInvoice = Pick<
  InvoiceRow,
  "id" | "service_job_id" | "bill_to_vendor_id" | "care_travel_choice"
>;

export const TRAVEL_NOT_HERE =
  "This invoice has no Roof Care plan leak call to use. The property needs a plan in force that includes them, and the invoice has to be the customer's.";

/**
 * Where an invoice stands with its property's plan. Null when the plan has no say: the invoice
 * has no ticket or is billed to a vendor, the ticket is the plan's own inspection, or the
 * property has no plan in force with leak calls.
 */
export async function invoiceTravelOf(
  sb: Sb,
  inv: TravelInvoice,
  lines: readonly Pick<LineRow, "kind" | "source" | "total">[],
): Promise<InvoiceTravel | null> {
  if (!inv.service_job_id || inv.bill_to_vendor_id) return null;
  const { data: job, error } = await sb
    .from("service_jobs")
    .select("site_id, roof_care_visit_id")
    .eq("id", inv.service_job_id)
    .maybeSingle();
  if (error) throw new Error(`The invoice's ticket: ${error.message}`);
  if (!job?.site_id || job.roof_care_visit_id) return null;
  const { data: plans, error: pErr } = await sb
    .from("roof_care_plans")
    .select("id, plan, free_travel_calls")
    .eq("site_id", job.site_id)
    .eq("status", "active")
    .limit(1);
  if (pErr) throw new Error(`The property's Roof Care plan: ${pErr.message}`);
  const plan = plans?.[0];
  const calls = Number(plan?.free_travel_calls) || 0;
  if (!plan || !(calls > 0)) return null;
  // The plan's other invoices that hold a leak call. A void one gives its call back.
  const { data: held, error: hErr } = await sb
    .from("invoice_lines")
    .select("invoice_id")
    .eq("source", travelLineSource(plan.id))
    .neq("invoice_id", inv.id);
  if (hErr) throw new Error(`The plan's invoices: ${hErr.message}`);
  const otherIds = [...new Set((held ?? []).map((l) => l.invoice_id))];
  let usedElsewhere = 0;
  if (otherIds.length) {
    const { data: invs, error: iErr } = await sb
      .from("invoices")
      .select("id, status")
      .in("id", otherIds);
    if (iErr) throw new Error(`The plan's invoices: ${iErr.message}`);
    usedElsewhere = (invs ?? []).filter((i) => i.status !== "void").length;
  }
  return {
    plan_id: plan.id,
    plan: plan.plan,
    calls,
    usedElsewhere,
    travel: travelBilled(lines),
    waived: travelWaived(lines),
    choice: asTravelChoice(inv.care_travel_choice),
  };
}

/**
 * The invoice's leak call line put where the rule says (roof-care-travel.ts travelStep), with
 * the totals. Answers whether anything was changed and the lines as they now stand.
 */
export async function syncTravel(
  sb: Sb,
  inv: TravelInvoice & Pick<InvoiceRow, "tax_rate">,
  lines: readonly LineRow[],
): Promise<{ changed: boolean; lines: LineRow[] }> {
  const same = { changed: false, lines: [...lines] };
  const own = lines.filter(isTravelWaiverLine);
  const where = await invoiceTravelOf(sb, inv, lines);
  let amount = 0;
  let choice: InvoiceTravel["choice"] = null;
  if (where) {
    ({ amount, choice } = travelStep({
      choice: where.choice,
      travel: where.travel,
      calls: where.calls,
      usedElsewhere: where.usedElsewhere,
    }));
    if (amount === where.waived && choice === where.choice && own.length <= 1) return same;
  } else {
    // The plan has no say. Only a vendor's invoice is certain enough to take the line away:
    // "no plan" can also mean the reader may not see the property's plan.
    if (!inv.bill_to_vendor_id || (!own.length && !inv.care_travel_choice)) return same;
  }
  const [first, ...extra] = own;
  const gone = amount > 0 ? extra : own;
  if (gone.length) {
    const { error } = await sb
      .from("invoice_lines")
      .delete()
      .in(
        "id",
        gone.map((l) => l.id),
      )
      .eq("invoice_id", inv.id);
    if (error) throw new Error(error.message);
  }
  if (amount > 0 && where) {
    if (first) {
      const { error } = await sb
        .from("invoice_lines")
        .update({ qty: 1, rate: -amount, total: -amount })
        .eq("id", first.id)
        .eq("invoice_id", inv.id);
      if (error) throw new Error(error.message);
    } else {
      const sort = lines.reduce((m, l) => Math.max(m, l.sort), -1) + 1;
      const { error } = await sb.from("invoice_lines").insert({
        ...travelWaiverLine({ id: where.plan_id, plan: where.plan }, amount, sort),
        invoice_id: inv.id,
      });
      if (error) throw new Error(error.message);
    }
  }
  const { data: now, error: lErr } = await sb
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", inv.id)
    .order("sort");
  if (lErr) throw new Error(lErr.message);
  const { totals } = await import("@/lib/invoices.server");
  const { error: uErr } = await sb
    .from("invoices")
    .update({ ...totals(now ?? [], Number(inv.tax_rate)), care_travel_choice: choice })
    .eq("id", inv.id);
  if (uErr) throw new Error(uErr.message);
  return { changed: true, lines: now ?? [] };
}

/**
 * Both of a plan's lines kept in step, in the order that matters: the leak call's travel comes
 * off first, and the minor repairs credit then covers what the invoice still charges.
 */
export async function syncPlanLines(
  sb: Sb,
  inv: Pick<
    InvoiceRow,
    | "id"
    | "service_job_id"
    | "bill_to_vendor_id"
    | "care_allowance_choice"
    | "care_travel_choice"
    | "tax_rate"
  >,
  lines: readonly LineRow[],
): Promise<boolean> {
  const travel = await syncTravel(sb, inv, lines);
  const { syncAllowance } = await import("@/lib/roof-care-allowance.functions");
  const credit = await syncAllowance(sb, inv, travel.lines);
  return travel.changed || credit;
}

const readInvoice = async (sb: Sb, id: string) => {
  const { data: inv, error } = await sb.from("invoices").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) throw new Error("Invoice not found");
  const { data: lines, error: lErr } = await sb
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", id)
    .order("sort");
  if (lErr) throw new Error(lErr.message);
  return { inv, lines: lines ?? [] };
};

export const getInvoiceTravel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceTravel | null> => {
    const { office } = await import("@/lib/invoices.functions");
    await office(context);
    const { inv, lines } = await readInvoice(context.supabase, data.id);
    return invoiceTravelOf(context.supabase, inv, lines);
  });

export interface SetTravelResult {
  invoice: InvoiceRow;
  lines: LineRow[];
  travel: InvoiceTravel | null;
}

/**
 * The office's answer on a draft: `use` false charges the travel (the visit was not a leak
 * call) and keeps that; `use` true lets the plan take it off again while it has a call. The
 * minor repairs credit is put in step with what the invoice then charges.
 */
export const setInvoiceTravel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), use: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<SetTravelResult> => {
    const { nameOf, office } = await import("@/lib/invoices.functions");
    const p = await office(context);
    const sb = context.supabase;
    const { inv, lines } = await readInvoice(sb, data.id);
    if (inv.status !== "draft") throw new Error("Only a draft invoice can be changed");
    if (!(await invoiceTravelOf(sb, inv, lines))) throw new Error(TRAVEL_NOT_HERE);
    const choice = data.use ? null : "declined";
    const { error } = await sb
      .from("invoices")
      .update({ care_travel_choice: choice, updated_by_name: nameOf(p) })
      .eq("id", inv.id);
    if (error) throw new Error(error.message);
    await syncPlanLines(sb, { ...inv, care_travel_choice: choice }, lines);
    const after = await readInvoice(sb, inv.id);
    return {
      invoice: after.inv,
      lines: after.lines,
      travel: await invoiceTravelOf(sb, after.inv, after.lines),
    };
  });
