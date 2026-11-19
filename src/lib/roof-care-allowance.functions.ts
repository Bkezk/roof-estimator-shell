/**
 * The server side of a Roof Care plan's minor repairs allowance on an invoice (owner, Nov 19;
 * lib/roof-care-allowance.ts has the rule and how it is made sure of).
 *
 *  - getInvoiceAllowance: where a draft stands with its property's plan, or null when the plan
 *    has nothing to do with it.
 *  - setInvoiceAllowance: the office's answer. "applied" puts one line on the invoice that takes
 *    the covered amount off; "declined" takes any such line away and keeps the answer.
 *  - invoiceAllowanceOf, keepAllowanceInStep: for the invoice functions (finalise, save,
 *    rebuild), so the answer is asked for before Finalise and the line never outgrows the
 *    invoice.
 *
 * Every read and write is the caller's own sign-in. The database holds the two hard rules (the
 * lines of a plan never add up past its allowance; no Finalise without an answer).
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  ALLOWANCE_NOT_HERE,
  ALLOWANCE_NOTHING_TO_TAKE,
  allowanceAfterChange,
  allowanceAmount,
  allowanceLine,
  allowanceLineSource,
  allowanceTaken,
  billableBefore,
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
 * has no ticket or is billed to a vendor, the ticket is the plan's own inspection, or the
 * property has no plan in force that includes minor repairs.
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
  if (!job?.site_id || job.roof_care_visit_id) return null;
  const { data: plans, error: pErr } = await sb
    .from("roof_care_plans")
    .select("id, plan, repair_allowance")
    .eq("site_id", job.site_id)
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
  });
}

/**
 * After the invoice's other lines were written (a save, a rebuild): its allowance line is held
 * to what the invoice now bills. A line with nothing left to cover goes, and the question is
 * open again. Answers whether anything was changed, so the caller reads the lines again.
 */
export async function keepAllowanceInStep(
  sb: Sb,
  inv: Pick<InvoiceRow, "id" | "care_allowance_choice">,
  lines: readonly LineRow[],
): Promise<boolean> {
  const own = lines.filter(isAllowanceLine);
  if (!own.length) {
    // "Applied" with no line: the line was removed by hand. The answer is asked for again.
    if (inv.care_allowance_choice !== "applied") return false;
    const { error } = await sb
      .from("invoices")
      .update({ care_allowance_choice: null, care_allowance_plan_id: null })
      .eq("id", inv.id);
    if (error) throw new Error(error.message);
    return true;
  }
  const taken = allowanceTaken(lines);
  const keep = allowanceAfterChange(taken, billableBefore(lines));
  if (keep === taken && own.length === 1) return false;
  const [first, ...extra] = own;
  if (extra.length || keep <= 0) {
    const gone = keep <= 0 ? own : extra;
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
  if (keep > 0) {
    const { error } = await sb
      .from("invoice_lines")
      .update({ qty: 1, rate: -keep, total: -keep })
      .eq("id", first!.id)
      .eq("invoice_id", inv.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb
      .from("invoices")
      .update({ care_allowance_choice: null, care_allowance_plan_id: null })
      .eq("id", inv.id);
    if (error) throw new Error(error.message);
  }
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
    if (data.choice === "applied") {
      const amount = allowanceAmount(data.amount, where.cap);
      if (!(amount > 0)) throw new Error(ALLOWANCE_NOTHING_TO_TAKE);
      const sort = lines.reduce((m, l) => Math.max(m, l.sort), -1) + 1;
      const { error: iErr } = await sb.from("invoice_lines").insert({
        ...allowanceLine({ id: where.plan_id, plan: where.plan }, amount, sort),
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
        care_allowance_choice: data.choice,
        care_allowance_plan_id: where.plan_id,
        updated_by_name: nameOf(p),
      })
      .eq("id", inv.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);
    return { invoice: updated, lines, allowance: await invoiceAllowanceOf(sb, updated, lines) };
  });
