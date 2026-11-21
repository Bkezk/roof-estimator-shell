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
 *  - reworkDraftPlanLines, reworkInvoicePlanLines (Nov 20): a draft's plan lines worked out
 *    again from what is true now, when the draft is opened and when it is finalised, with what
 *    changed said in plain words. Until then a draft kept the credit it was first given, also
 *    after another invoice of the plan was deleted and its credit came free.
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
  allowanceTaken,
  allowanceToward,
  invoiceAllowance,
  isAllowanceLine,
  allowancePlanOf,
  officeDay,
  planAllowanceNow,
  planCoversDay,
  planForWork,
  planLinesChangeWords,
  workDay,
  type InvoiceAllowance,
  type PlanLinesStand,
} from "@/lib/roof-care-allowance";
import { isTripLine, TRIP_SOURCE_PREFIX, tripLineSource } from "@/lib/roof-care-no-access";
import { travelWaived } from "@/lib/roof-care-travel";

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
    .select("site_id, roof_care_visit_id, completed_at, on_site_at, scheduled_date")
    .eq("id", inv.service_job_id)
    .maybeSingle();
  if (error) throw new Error(`The invoice's ticket: ${error.message}`);
  if (!job?.site_id) return null;
  // The plan's own inspection takes nothing from the allowance, with two exceptions. A storm
  // inspection beyond the ones the plan includes is billed, and what is left of the minor
  // repairs goes toward its price first (owner, Nov 19: "their repair allocation contributes to
  // the price if they have any left"). And a return trip charged after a visit we could not do
  // takes what is left first too (owner, Nov 20: "it comes out of the allocation if there is
  // allocation left").
  let storm: { plan_id: string; source: string } | null = null;
  let ownPlan: string | null = null;
  const tripSources = lines.filter(isTripLine).map((l) => l.source!);
  if (job.roof_care_visit_id) {
    const { data: v, error: vErr } = await sb
      .from("roof_care_visits")
      .select("id, kind, amount, plan_id")
      .eq("id", job.roof_care_visit_id)
      .maybeSingle();
    if (vErr) throw new Error(`The invoice's inspection: ${vErr.message}`);
    if (!v) return null;
    if (v.kind === "storm" && Number(v.amount) > 0)
      storm = { plan_id: v.plan_id, source: carePlanLineSource(v.id) };
    if (!storm && !tripSources.length) return null;
    ownPlan = v.plan_id;
  }
  // The plan the work belongs to (owner, Nov 20: break test, number 3): the one whose year
  // holds the day the work was done, also when it has ended since. Work dated after a plan's
  // last day gets nothing of it. Until now only a plan in force on the day the invoice was
  // opened was looked at.
  const plan = await planOfWork(sb, job, ownPlan);
  if (!plan) return null;
  // A plan whose refund was sent gives no more than the refund counted.
  const allowance = planAllowanceNow(plan);
  if (!(Number(plan.repair_allowance) > 0)) return null;
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
  // What each return trip was worked out at (owner, Nov 20: break test, number 5): the plan
  // pays toward a trip no more than that, whatever price is typed on its line.
  const ownTrips = ownPlan ? tripSources : [];
  let tripCaps: Record<string, number> = {};
  if (ownTrips.length) tripCaps = await tripChargesOf(sb, ownTrips);
  return invoiceAllowance({
    plan_id: plan.id,
    plan: plan.plan,
    allowance,
    usedElsewhere,
    lines,
    choice: inv.care_allowance_choice,
    ...(storm ? { towardSource: storm.source } : {}),
    // A return trip is the plan's own inspection's: never on a repair's invoice.
    ...(ownTrips.length ? { tripSources: ownTrips, tripCaps } : {}),
  });
}

/** What of a plan the invoice rules read. */
export const PLAN_OF_WORK_COLUMNS =
  "id, plan, status, site_id, repair_allowance, free_travel_calls, starts_on, signed_on, renews_on, ended_on, refund_due, refund_sent_on, refund_worked" as const;
export type PlanOfWork = Pick<
  Database["public"]["Tables"]["roof_care_plans"]["Row"],
  | "id"
  | "plan"
  | "status"
  | "site_id"
  | "repair_allowance"
  | "free_travel_calls"
  | "starts_on"
  | "signed_on"
  | "renews_on"
  | "ended_on"
  | "refund_due"
  | "refund_sent_on"
  | "refund_worked"
>;
type WorkJob = {
  site_id: string | null;
  completed_at?: string | null;
  on_site_at?: string | null;
  scheduled_date?: string | null;
};

/**
 * The plan a ticket's work belongs to (roof-care-allowance.ts planForWork): of the plans at the
 * ticket's property, or the one plan of the ticket's own inspection (`ownPlan`). Null when no
 * plan covers the day the work was done. The minor repairs credit and the leak call's travel
 * both ask here, so the two follow one rule.
 */
export async function planOfWork(
  sb: Sb,
  job: WorkJob,
  ownPlan: string | null = null,
  today: string = officeDay(new Date()) ?? "",
): Promise<PlanOfWork | null> {
  if (!ownPlan && !job.site_id) return null;
  const q = sb.from("roof_care_plans").select(PLAN_OF_WORK_COLUMNS);
  const { data: plans, error } = await (
    ownPlan ? q.eq("id", ownPlan) : q.eq("site_id", job.site_id!)
  ).in("status", ["active", "ended"]);
  if (error) throw new Error(`The property's Roof Care plan: ${error.message}`);
  return planForWork((plans ?? []) as PlanOfWork[], workDay(job, today).day);
}

/**
 * Is this plan one that is read and does not cover the day the ticket's work was done? Then a
 * line of it on the ticket's invoice comes off. False when the plan cannot be read (it may be
 * hidden from this person), so nothing is taken away on a guess.
 */
export async function planLineOutside(
  sb: Sb,
  jobId: string | null,
  planId: string | null,
  today: string = officeDay(new Date()) ?? "",
): Promise<boolean> {
  if (!jobId || !planId) return false;
  const { data: plan, error } = await sb
    .from("roof_care_plans")
    .select(PLAN_OF_WORK_COLUMNS)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(`The property's Roof Care plan: ${error.message}`);
  if (!plan?.status) return false;
  const { data: job, error: jErr } = await sb
    .from("service_jobs")
    .select("site_id, completed_at, on_site_at, scheduled_date")
    .eq("id", jobId)
    .maybeSingle();
  if (jErr) throw new Error(`The invoice's ticket: ${jErr.message}`);
  if (!job) return false;
  return !planCoversDay(plan, workDay(job, today).day);
}

/** What each of these return trip lines was worked out at, by the line's source. */
export async function tripChargesOf(
  sb: Sb,
  sources: readonly string[],
): Promise<Record<string, number>> {
  const ids = sources.map((s) => s.slice(TRIP_SOURCE_PREFIX.length)).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await sb.from("roof_care_no_access").select("id, amount").in("id", ids);
  if (error) throw new Error(`The return trips of this invoice: ${error.message}`);
  const out: Record<string, number> = {};
  for (const n of data ?? [])
    if (n.amount != null && Number.isFinite(Number(n.amount)))
      out[tripLineSource(n.id)] = Number(n.amount);
  return out;
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
    // The plan has no say. A vendor's invoice is certain enough to take the line away, and so
    // is a line whose plan is read and does not cover the day this work was done (Nov 20:
    // work dated after the plan's last day gets nothing). Otherwise the line is left: "no
    // plan" can also mean the reader may not see the property's plan.
    const outside = own.length
      ? await planLineOutside(sb, inv.service_job_id, allowancePlanOf(own[0]!))
      : false;
    if (!outside && (!inv.bill_to_vendor_id || (!own.length && !inv.care_allowance_choice)))
      return false;
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
        ...allowanceLine(
          { id: where.plan_id, plan: where.plan },
          amount,
          sort,
          allowanceToward(where),
        ),
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

/** Where a draft's plan lines stand: what each takes off, and the invoice's total. */
export const planLinesStand = (
  inv: Pick<InvoiceRow, "total">,
  lines: readonly Pick<LineRow, "kind" | "source" | "total">[],
): PlanLinesStand => ({
  credit: allowanceTaken(lines),
  travel: travelWaived(lines),
  total: Number(inv.total) || 0,
});

/** A draft after its plan lines were worked out again. */
export interface PlanLinesRework {
  invoice: InvoiceRow;
  lines: LineRow[];
  /** What changed, for the office; null when the rows were tidied and no amount moved. */
  note: string | null;
}

/**
 * A draft's Roof Care lines worked out again from what is true now (owner, Nov 20: break test,
 * number 2: "re-run the plan's lines when a draft opens and at Finalise"): the minor repairs
 * credit, the credit toward a charged return trip or a billed storm inspection, and the leak
 * call's travel. The same step a save takes (syncPlanLines), so what a person chose by hand is
 * kept: a "no" stays, a typed amount is held and never raised, "charge the travel" stays.
 *
 * Null when nothing was changed, and always for an invoice that is not a draft or has no
 * ticket: a final, paid or void invoice is never worked out again.
 */
export async function reworkDraftPlanLines(
  sb: Sb,
  inv: InvoiceRow,
  lines: readonly LineRow[],
): Promise<PlanLinesRework | null> {
  if (inv.status !== "draft" || !inv.service_job_id) return null;
  const before = planLinesStand(inv, lines);
  const { syncPlanLines } = await import("@/lib/roof-care-travel.functions");
  if (!(await syncPlanLines(sb, inv, lines))) return null;
  const { data: invoice, error } = await sb.from("invoices").select("*").eq("id", inv.id).single();
  if (error) throw new Error(error.message);
  const { data: rows, error: lErr } = await sb
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", inv.id)
    .order("sort");
  if (lErr) throw new Error(lErr.message);
  const now = rows ?? [];
  const where = await invoiceAllowanceOf(sb, invoice, now);
  return {
    invoice,
    lines: now,
    note: planLinesChangeWords(before, planLinesStand(invoice, now), {
      left: where?.left ?? null,
      billable: where?.billable ?? null,
    }),
  };
}

/**
 * The invoice page's own call when a draft is opened, and again before it asks for Finalise.
 * Null when the draft stands as it was. Final, paid and void invoices answer null: nothing of
 * theirs is ever worked out again.
 */
export const reworkInvoicePlanLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PlanLinesRework | null> => {
    const { office } = await import("@/lib/invoices.functions");
    await office(context);
    const sb = context.supabase;
    const { data: inv, error } = await sb
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "draft" || !inv.service_job_id) return null;
    const { data: lines, error: lErr } = await sb
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", inv.id)
      .order("sort");
    if (lErr) throw new Error(lErr.message);
    return reworkDraftPlanLines(sb, inv, lines ?? []);
  });

/**
 * What each return trip on an invoice was worked out at, by its line's source: for the invoice
 * page, which says so under a trip line whose price was typed to something else (owner, Nov 20:
 * break test, number 5: the line stays editable, and a typo has to stand out).
 */
export const getInvoiceTripCharges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<Record<string, number>> => {
    const { office } = await import("@/lib/invoices.functions");
    await office(context);
    const sb = context.supabase;
    const { data: lines, error } = await sb
      .from("invoice_lines")
      .select("source")
      .eq("invoice_id", data.id);
    if (error) throw new Error(error.message);
    return tripChargesOf(
      sb,
      (lines ?? []).filter(isTripLine).map((l) => l.source!),
    );
  });

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
    // Whatever line it had goes first: there is one, at the amount now chosen, or none.
    const old = lines.filter(isAllowanceLine);
    // "Does not use the plan" is always the office's to say while the invoice holds a line of
    // a plan (Nov 20: break test, number 3; after a plan ended the box was gone and the answer
    // was refused). Using the plan needs a plan that covers this work.
    if (!where && !(data.choice === "declined" && old.length)) throw new Error(ALLOWANCE_NOT_HERE);
    if (data.choice === "applied" && !(where && where.cap > 0))
      throw new Error(ALLOWANCE_NOTHING_TO_TAKE);
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
    if (data.choice === "applied" && where) {
      const amount = allowanceAmount(data.amount, where.cap);
      if (!(amount > 0)) throw new Error(ALLOWANCE_NOTHING_TO_TAKE);
      const sort = lines.reduce((m, l) => Math.max(m, l.sort), -1) + 1;
      const { error: iErr } = await sb.from("invoice_lines").insert({
        ...allowanceLine(
          { id: where.plan_id, plan: where.plan },
          amount,
          sort,
          allowanceToward(where),
        ),
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
        care_allowance_plan_id: where?.plan_id ?? allowancePlanOf(old[0] ?? {}),
        updated_by_name: nameOf(p),
      })
      .eq("id", inv.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);
    return { invoice: updated, lines, allowance: await invoiceAllowanceOf(sb, updated, lines) };
  });
