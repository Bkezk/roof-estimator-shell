/**
 * The server side of a Roof Care plan's minor repairs allowance on an invoice (owner, Nov 19;
 * lib/roof-care-allowance.ts has the rule and how it is made sure of).
 *
 *  - getInvoiceAllowance: where a draft stands with its property's plan, or null when the plan
 *    has nothing to do with it.
 *  - setInvoiceAllowance: the office's answer. "applied" puts one line on the invoice that takes
 *    the covered amount off; "declined" takes any such line away and keeps the answer.
 *  - invoiceAllowanceOf, syncAllowance: for the invoice functions (new draft, save, rebuild,
 *    finalise), so the plan is used by itself while it has allowance left, the line never
 *    outgrows the invoice, and Finalise is refused if nothing was ever chosen.
 *
 * Every read and write is the caller's own sign-in. The database holds the two hard rules (the
 * lines of a plan never add up past its allowance; no Finalise without an answer).
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { carePlanLineSource } from "@/lib/roof-care-plan";
import {
  ALLOWANCE_NOT_HERE,
  ALLOWANCE_NOTHING_TO_TAKE,
  allowanceAmount,
  allowanceLine,
  allowanceLineSource,
  allowanceStep,
  invoiceAllowance,
  isAllowanceLine,
  type InvoiceAllowance,
} from "@/lib/roof-care-allowance";

type Sb = SupabaseClient<Database>;
type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type LineRow = Database["public"]["Tables"]["invoice_lines"]["Row"];
type AllowanceInvoice = Pick<
  InvoiceRow,
  "id" | "service_job_id" | "bill_to_vendor_id" | "care_allowance_choice"
>;

/**
 * Where an invoice stands with its property's plan. Null when the plan has no say: the invoice
 * has no ticket or is billed to a vendor, the ticket is the plan's own inspection (other than a
 * billed storm inspection), or the property has no plan in force that includes minor repairs.
 */
export async function invoiceAllowanceOf(
  sb: Sb,
  inv: AllowanceInvoice,
  lines: readonly Pick<LineRow, "source" | "total">[],
): Promise<InvoiceAllowance | null> {
  if (!inv.service_job_id || inv.bill_to_vendor_id) return null;
  const { data: job, error } = await sb
    .from("service_jobs")
    .select("site_id, roof_care_visit_id")
    .eq("id", inv.service_job_id)
    .maybeSingle();
  if (error) throw new Error(`The invoice's ticket: ${error.message}`);
  if (!job?.site_id) return null;
  // The plan's own inspection takes nothing from the allowance. The one exception (owner, Nov
  // 19: "their repair allocation contributes to the price if they have any left"): a storm
  // inspection beyond the ones the plan includes is billed, and what is left of the minor
  // repairs goes toward its price first.
  let storm: { plan_id: string; source: string } | null = null;
  if (job.roof_care_visit_id) {
    const { data: v, error: vErr } = await sb
      .from("roof_care_visits")
      .select("id, kind, amount, plan_id")
      .eq("id", job.roof_care_visit_id)
      .maybeSingle();
    if (vErr) throw new Error(`The invoice's inspection: ${vErr.message}`);
    if (!v || v.kind !== "storm" || !(Number(v.amount) > 0)) return null;
    storm = { plan_id: v.plan_id, source: carePlanLineSource(v.id) };
  }
  const active = sb.from("roof_care_plans").select("id, plan, repair_allowance");
  const { data: plans, error: pErr } = await (
    storm ? active.eq("id", storm.plan_id) : active.eq("site_id", job.site_id)
  )
    .eq("status", "active")
    .limit(1);
  if (pErr) throw new Error(`The property's Roof Care plan: ${pErr.message}`);
  const plan = plans?.[0];
  if (!plan || !(Number(plan.repair_allowance) > 0)) return null;
  // What the plan's other invoices took. A void one gives its amount back.
  const { data: taken, error: tErr } = await sb
    .from("invoice_lines")
    .select("invoice_id, total")
    .eq("source", allowanceLineSource(plan.id))
    .neq("invoice_id", inv.id);
  if (tErr) throw new Error(`The plan's invoices: ${tErr.message}`);
  const otherIds = [...new Set((taken ?? []).map((l) => l.invoice_id))];
  const live = new Set<string>();
  if (otherIds.length) {
    const { data: invs, error: iErr } = await sb
      .from("invoices")
      .select("id, status")
      .in("id", otherIds);
    if (iErr) throw new Error(`The plan's invoices: ${iErr.message}`);
    for (const i of invs ?? []) if (i.status !== "void") live.add(i.id);
  }
  let usedElsewhere = 0;
  for (const l of taken ?? []) if (live.has(l.invoice_id)) usedElsewhere += -Number(l.total) || 0;
  return invoiceAllowance({
    plan_id: plan.id,
    plan: plan.plan,
    allowance: Number(plan.repair_allowance),
    usedElsewhere,
    lines,
    choice: inv.care_allowance_choice,
    ...(storm ? { towardSource: storm.source } : {}),
  });
}

/**
 * After an invoice is made or its lines change (a new draft, a save, a rebuild): its allowance
 * line is put where the rule says (roof-care-allowance.ts allowanceStep). Nobody has chosen:
 * the plan covers all it can, ticked by itself (owner, Nov 19). A typed amount is held and only
 * ever cut to what the invoice still bills. A "no" stays. An invoice billed to a vendor takes
 * nothing from the customer's plan. Answers whether anything was changed, so the caller reads
 * the invoice again; the totals are written here with the line.
 */
export async function syncAllowance(
  sb: Sb,
  inv: Pick<
    InvoiceRow,
    "id" | "service_job_id" | "bill_to_vendor_id" | "care_allowance_choice" | "tax_rate"
  >,
  lines: readonly LineRow[],
): Promise<boolean> {
  const own = lines.filter(isAllowanceLine);
  const where = await invoiceAllowanceOf(sb, inv, lines);
  let amount = 0;
  let choice: InvoiceAllowance["choice"] = null;
  if (where) {
    ({ amount, choice } = allowanceStep({
      choice: where.choice,
      taken: where.applied,
      cap: where.cap,
    }));
    if (amount === where.applied && choice === where.choice && own.length <= 1) return false;
  } else {
    // The plan has no say. Only a vendor's invoice is certain enough to take the line away:
    // "no plan" can also mean the reader may not see the property's plan.
    if (!inv.bill_to_vendor_id || (!own.length && !inv.care_allowance_choice)) return false;
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
        ...allowanceLine({ id: where.plan_id, plan: where.plan }, amount, sort, !!where.storm),
        invoice_id: inv.id,
      });
      if (error) throw new Error(error.message);
    }
  }
  const { data: now, error: lErr } = await sb
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", inv.id);
  if (lErr) throw new Error(lErr.message);
  const { totals } = await import("@/lib/invoices.server");
  const { error: uErr } = await sb
    .from("invoices")
    .update({
      ...totals(now ?? [], Number(inv.tax_rate)),
      care_allowance_choice: choice,
      care_allowance_plan_id: choice && where ? where.plan_id : null,
    })
    .eq("id", inv.id);
  if (uErr) throw new Error(uErr.message);
  return true;
}

export const getInvoiceAllowance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceAllowance | null> => {
    const { office } = await import("@/lib/invoices.functions");
    await office(context);
    const sb = context.supabase;
    const { data: inv, error } = await sb
      .from("invoices")
      .select("id, status, service_job_id, bill_to_vendor_id, care_allowance_choice")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found");
    const { data: lines, error: lErr } = await sb
      .from("invoice_lines")
      .select("source, total")
      .eq("invoice_id", inv.id);
    if (lErr) throw new Error(lErr.message);
    return invoiceAllowanceOf(sb, inv, lines ?? []);
  });

export interface SetAllowanceResult {
  invoice: InvoiceRow;
  lines: LineRow[];
  allowance: InvoiceAllowance | null;
}

export const setInvoiceAllowance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        choice: z.enum(["applied", "declined"]),
        /** How much to take; left out, all that can be taken. */
        amount: z.number().finite().positive().max(10_000_000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<SetAllowanceResult> => {
    const { office, nameOf } = await import("@/lib/invoices.functions");
    const p = await office(context);
    const sb = context.supabase;
    const { data: inv, error } = await sb
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "draft") throw new Error("This invoice is final; void it to change it");
    const readLines = async () => {
      const { data: rows, error: lErr } = await sb
        .from("invoice_lines")
        .select("*")
        .eq("invoice_id", inv.id)
        .order("sort");
      if (lErr) throw new Error(lErr.message);
      return rows ?? [];
    };
    let lines = await readLines();
    const where = await invoiceAllowanceOf(sb, inv, lines);
    if (!where) throw new Error(ALLOWANCE_NOT_HERE);
    if (data.choice === "applied" && !(where.cap > 0)) throw new Error(ALLOWANCE_NOTHING_TO_TAKE);
    // Whatever line it had goes first: there is one, at the amount now chosen, or none.
    const old = lines.filter(isAllowanceLine);
    if (old.length) {
      const { error: dErr } = await sb
        .from("invoice_lines")
        .delete()
        .in(
          "id",
          old.map((l) => l.id),
        )
        .eq("invoice_id", inv.id);
      if (dErr) throw new Error(dErr.message);
    }
    // "Use the plan" with no amount typed: all it can take, and it follows the invoice from
    // here on ("auto"). A typed amount is the office's own and is held.
    const choice =
      data.choice === "declined" ? "declined" : data.amount == null ? "auto" : "applied";
    if (data.choice === "applied") {
      const amount = allowanceAmount(data.amount, where.cap);
      if (!(amount > 0)) throw new Error(ALLOWANCE_NOTHING_TO_TAKE);
      const sort = lines.reduce((m, l) => Math.max(m, l.sort), -1) + 1;
      const { error: iErr } = await sb.from("invoice_lines").insert({
        ...allowanceLine({ id: where.plan_id, plan: where.plan }, amount, sort, !!where.storm),
        invoice_id: inv.id,
      });
      // The database's own words when the plan has less left than was read a moment ago.
      if (iErr) throw new Error(iErr.message);
    }
    lines = await readLines();
    const { totals } = await import("@/lib/invoices.server");
    const { data: updated, error: uErr } = await sb
      .from("invoices")
      .update({
        ...totals(lines, Number(inv.tax_rate)),
        care_allowance_choice: choice,
        care_allowance_plan_id: where.plan_id,
        updated_by_name: nameOf(p),
      })
      .eq("id", inv.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);
    return { invoice: updated, lines, allowance: await invoiceAllowanceOf(sb, updated, lines) };
  });
