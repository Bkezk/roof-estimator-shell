/**
 * Roof Care plans, step 2: the server side of a property's plan (owner, Nov 18;
 * docs/roof-care-plans.md, lib/roof-care-plan.ts, 20261118240000_roof_care_plans.sql).
 *
 *  - roofCareOffer: the drive from the office to a property and, with a roof size, what each
 *    plan costs the customer there. Prices only: the database works them out
 *    (roof_care_price) and hands back no cost, so anyone who may sign a customer up can ask.
 *  - signUpRoofCare: the sign-up. The drive is worked out again here, never taken from the
 *    form, and the database works the price out again from it.
 *  - roofCareMapSize: the size of the building our map shows at a property's address, offered
 *    beside the sign-up's roof size box. Read only: it saves nothing.
 *  - listRoofCarePlans: the plans of some properties with their inspections and tickets.
 *  - pushBackRoofCareVisit, addRoofCareStorm, endRoofCarePlan.
 *  - roofCareRenewalOffer, renewRoofCarePlan: the next plan year (Nov 19).
 *
 * Every write is the database's own function, called with the caller's sign-in: who may do
 * what is decided there, and said back in its words.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { seesInvoices } from "@/lib/access";
import { chunkIds } from "@/lib/chunk-ids";
import { readProfile } from "@/lib/profile-cache.server";
import { allowanceLineSource, allowancePlanOf } from "@/lib/roof-care-allowance";
import {
  EMAIL_BAD,
  looksLikeEmail,
  readBenefits,
  type BenefitNumbers,
} from "@/lib/roof-care-benefits";
import {
  asPayMethod,
  asPlanKey,
  asPlanStatus,
  asRenewalChoice,
  carePlanLineSource,
  FIRST_VISIT_CHOICES,
  mapRoofSize,
  PAY_METHOD_NEEDED,
  PAY_METHODS,
  priceChangedLine,
  readPriceAnswer,
  readRefundWorked,
  readRenewalOffer,
  RENEWAL_CHOICE_NEEDED,
  RENEWAL_CHOICES,
  ROOF_CARE_TERMS_VERSION,
  shownPrice,
  TERMS_NOT_AGREED,
  VISIT_KINDS,
  type AllowanceUse,
  type FirstVisit,
  type MapRoofSize,
  type PlanInvoiceRef,
  type PlanVisit,
  type PriceEstimate,
  type RefundWorked,
  type RenewalOffer,
  type RoofCarePlan,
  type ShownPrice,
  type VisitKind,
  type VisitTicket,
} from "@/lib/roof-care-plan";
import { NOT_PLACED_LINE, placedRoughly } from "@/lib/roof-care-locate";
import { PLAN_KEYS } from "@/lib/roof-care-price";
import { isTravelWaiverLine, travelLineSource } from "@/lib/roof-care-travel";
import { driveTo, officeOrigin, type RoofCareDrive } from "@/lib/roof-care.functions";
import { aerialForAddress } from "@/lib/service-aerial.functions";

type Sb = SupabaseClient<Database>;
type Ctx = { supabase: Sb; userId: string };

const nameOf = (p: { full_name: string | null; email: string } | null) =>
  (p?.full_name ?? "").trim() || p?.email || null;

async function signedIn(ctx: Ctx) {
  const p = await readProfile(ctx.supabase, ctx.userId);
  if (!p) throw new Error("Sign in first");
  return p;
}

export const SITE_NOT_YOURS = "That property was not found, or it is not yours to open";
export const NO_ADDRESS_FOR_PRICE =
  "This property has no street address, so the drive cannot be worked out. Add the address first.";

const SITE_SELECT =
  "id, account_id, name, address1, address2, city, state, zip, lat, lng, map_roof_sqft" as const;

async function siteOf(sb: Sb, siteId: string) {
  const { data, error } = await sb
    .from("crm_sites")
    .select(SITE_SELECT)
    .eq("id", siteId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(SITE_NOT_YOURS);
  return data;
}
type Site = Awaited<ReturnType<typeof siteOf>>;

/**
 * The round trip from the office to a property: to the point on its record when it has one,
 * else by its address (the building, the street, the zip code, the town). Null when it cannot
 * be placed at all.
 */
export async function siteDrive(
  sb: Sb,
  site: Site,
  fetcher?: (url: string, timeoutMs: number) => Promise<unknown>,
): Promise<RoofCareDrive | null> {
  const known = site.lat != null && site.lng != null ? { lat: site.lat, lng: site.lng } : null;
  const street = (site.address1 ?? "").trim();
  if (!known && !street) throw new Error(NO_ADDRESS_FOR_PRICE);
  return driveTo(
    sb,
    await officeOrigin(sb),
    {
      address: street,
      ...(site.city ? { city: site.city } : {}),
      ...(site.state ? { state: site.state } : {}),
      ...(site.zip ? { zip: site.zip } : {}),
    },
    fetcher,
    known,
  );
}

/**
 * What the sign-up screen is told. The drive, the list price and what the distance adds stay on
 * the server (owner, Nov 19: "they shouldn't know they're paying more for distance neither the
 * customer or tech"): the screen gets the price of each plan and nothing of how it was made.
 */
export interface RoofCareOffer {
  site: { id: string; name: string | null };
  /** False when neither the address nor its town is on the map: no price then. */
  placed: boolean;
  /** Why the price is an estimate: placed by its town, or the road route was not read just now. */
  estimate: PriceEstimate;
  /** Null until a roof size is given and the property is placed. */
  price: ShownPrice | null;
}

const sqftInput = z.number().positive().max(5_000_000);

export const roofCareOffer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ site_id: z.string().uuid(), sqft: sqftInput.nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<RoofCareOffer> => {
    await signedIn(context);
    const sb = context.supabase;
    const site = await siteOf(sb, data.site_id);
    const drive = await siteDrive(sb, site);
    let price: ShownPrice | null = null;
    if (drive && data.sqft != null) {
      const { data: answer, error } = await sb.rpc("roof_care_price", {
        p_sqft: data.sqft,
        p_hours: drive.hours,
        p_miles: drive.miles,
      });
      if (error) throw new Error(error.message);
      price = shownPrice(readPriceAnswer(answer));
    }
    const estimate: PriceEstimate = !drive
      ? null
      : placedRoughly(drive.placed_by)
        ? "rough"
        : drive.source === "estimated"
          ? "just-now"
          : null;
    return { site: { id: site.id, name: site.name }, placed: !!drive, estimate, price };
  });

/** How long the sign-up waits for the map before it goes on without a size to offer. */
export const MAP_SIZE_WAIT_MS = 10_000;

/**
 * The building our map shows at a property's address, as a roof size to offer: the size kept on
 * the property when there is one, else a lookup now. Null when the
 * map has no outline there, the state's map server is slow or down, or the address cannot be
 * read: the sign-up then simply has nothing to offer, and the size is typed as before.
 */
export async function siteMapSize(
  sb: Sb,
  site: Site,
  find: typeof aerialForAddress = aerialForAddress,
  waitMs: number = MAP_SIZE_WAIT_MS,
): Promise<MapRoofSize | null> {
  // The size kept on the property by an earlier lookup: said at once, with no wait on the map.
  const kept = mapRoofSize({ areaSqFt: site.map_roof_sqft }, null);
  if (kept) return kept;
  const street = (site.address1 ?? "").trim();
  if (!street) return null;
  const tail = [site.city, [site.state, site.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const line = [street, tail].filter(Boolean).join(", ");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const a = await Promise.race([
      find(sb, line, { stateHint: site.state, propertyName: site.name }),
      new Promise<null>((done) => {
        timer = setTimeout(() => done(null), waitMs);
      }),
    ]);
    return a ? mapRoofSize(a.found, a.note) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const roofCareMapSize = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ site_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<MapRoofSize | null> => {
    await signedIn(context);
    const sb = context.supabase;
    return siteMapSize(sb, await siteOf(sb, data.site_id));
  });

const PLAN_SELECT =
  "id, account_id, site_id, plan, status, pay_first, plan_number, first_visit, first_days, starts_on, signed_on, renews_on, roof_sqft, price, price_estimated, repair_allowance, free_travel_calls, pay_method, pay_note, refund_due, refund_sent_on, refund_ref, closed_out_on, closed_out_reason, renewed_from, renewal_choice, renewal_credit, agreed_by, sold_by_name, notes, ended_on, ended_reason, customer_email, agreement_sent_at, agreement_error, receipt_sent_at, receipt_error" as const;
const VISIT_SELECT =
  "id, plan_id, kind, due_from, due_by, first_due_by, amount, push_reason, pushed_by_name, customer_asked, lost_on" as const;
const TICKET_SELECT =
  "id, number, stage, scheduled_date, completed_at, invoice_id, roof_care_visit_id" as const;

// One owed from last plan year leads: it is the one with the clock on it.
const ORDER: Record<VisitKind, number> = { carried: -1, visit1: 0, visit2: 1, storm: 2 };

/**
 * What the plans' own lines on invoices say (Nov 19): which inspections have their share of the
 * plan on a live invoice, and what each plan's minor repairs allowance has taken. A void invoice
 * counts for nothing. Read with the caller's sign-in, so only for someone who sees invoices.
 */
async function planMoney(sb: Sb, visitIds: readonly string[], planIds: readonly string[]) {
  const billed = new Set<string>();
  const uses = new Map<string, AllowanceUse[]>();
  const sources = [
    ...visitIds.map(carePlanLineSource),
    ...planIds.map(allowanceLineSource),
    ...planIds.map(travelLineSource),
  ];
  const lines: { source: string | null; total: number; invoice_id: string }[] = [];
  for (const chunk of chunkIds(sources)) {
    const { data, error } = await sb
      .from("invoice_lines")
      .select("source, total, invoice_id")
      .in("source", chunk);
    if (error) throw new Error(`The plans' invoices: ${error.message}`);
    lines.push(...(data ?? []));
  }
  const live = new Map<string, string>();
  for (const chunk of chunkIds([...new Set(lines.map((l) => l.invoice_id))])) {
    const { data, error } = await sb
      .from("invoices")
      .select("id, status, display_number")
      .in("id", chunk);
    if (error) throw new Error(`The plans' invoices: ${error.message}`);
    for (const i of data ?? []) if (i.status !== "void") live.set(i.id, i.display_number ?? "");
  }
  // The invoices that hold one of each plan's leak calls with no travel charge.
  const calls = new Map<string, Set<string>>();
  for (const l of lines) {
    const number = live.get(l.invoice_id);
    if (number === undefined || !l.source) continue;
    if (isTravelWaiverLine(l)) {
      const id = l.source.slice(travelLineSource("").length);
      calls.set(id, (calls.get(id) ?? new Set()).add(l.invoice_id));
      continue;
    }
    const planId = allowancePlanOf(l);
    if (!planId) {
      billed.add(l.source.slice(carePlanLineSource("").length));
      continue;
    }
    const list = uses.get(planId) ?? [];
    const amount = -Number(l.total) || 0;
    const same = list.find((u) => u.invoice_id === l.invoice_id);
    if (same) same.amount = Math.round((same.amount + amount) * 100) / 100;
    else list.push({ invoice_id: l.invoice_id, number, amount });
    uses.set(planId, list);
  }
  // Each plan's own invoice for the year (Nov 19): the newest that is not void.
  const own = new Map<string, PlanInvoiceRef>();
  for (const chunk of chunkIds([...planIds])) {
    const { data, error } = await sb
      .from("invoices")
      .select("id, roof_care_plan_id, display_number, status, total, paid_amount, created_at")
      .in("roof_care_plan_id", chunk)
      .neq("status", "void")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`The plans' invoices: ${error.message}`);
    for (const i of data ?? []) {
      if (!i.roof_care_plan_id || own.has(i.roof_care_plan_id)) continue;
      own.set(i.roof_care_plan_id, {
        id: i.id,
        number: i.display_number ?? "",
        status: i.status,
        total: Number(i.total) || 0,
        paid_amount: Number(i.paid_amount) || 0,
      });
    }
  }
  return { billed, uses, own, calls };
}

/**
 * What each plan includes, in numbers (roof_care_benefits() in the database): the minor repairs
 * each year, the leak calls with no trip charge, the storm inspections. Null when they cannot
 * be read: the descriptions then say it without the numbers.
 */
export async function readPlanBenefits(sb: Sb): Promise<BenefitNumbers | null> {
  try {
    const { data, error } = await sb.rpc("roof_care_benefits");
    return error ? null : readBenefits(data);
  } catch {
    return null;
  }
}

export const roofCareBenefits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BenefitNumbers | null> => {
    await signedIn(context);
    return readPlanBenefits(context.supabase);
  });

/**
 * The plans of `siteIds`, newest first, each with its inspections and their tickets. `money`:
 * also what is billed and what the allowance has taken, for a reader who sees invoices.
 */
export async function plansOfSites(
  sb: Sb,
  siteIds: readonly string[],
  opts: { money?: boolean } = {},
): Promise<RoofCarePlan[]> {
  if (!siteIds.length) return [];
  const { data: plans, error } = await sb
    .from("roof_care_plans")
    .select(PLAN_SELECT)
    .in("site_id", [...siteIds])
    .order("signed_on", { ascending: false });
  if (error) throw new Error(error.message);
  if (!plans?.length) return [];
  const { data: visits, error: vErr } = await sb
    .from("roof_care_visits")
    .select(VISIT_SELECT)
    .in(
      "plan_id",
      plans.map((p) => p.id),
    );
  if (vErr) throw new Error(vErr.message);
  const visitIds = (visits ?? []).map((v) => v.id);
  const { data: jobs, error: jErr } = visitIds.length
    ? await sb
        .from("service_jobs")
        .select(TICKET_SELECT)
        .in("roof_care_visit_id", visitIds)
        .is("deleted_at", null)
    : { data: [], error: null };
  if (jErr) throw new Error(jErr.message);
  const ticketOf = new Map<string, VisitTicket>();
  for (const j of jobs ?? []) {
    if (!j.roof_care_visit_id) continue;
    ticketOf.set(j.roof_care_visit_id, {
      id: j.id,
      number: j.number,
      stage: j.stage,
      scheduled_date: j.scheduled_date,
      completed_at: j.completed_at,
      invoice_id: j.invoice_id,
    });
  }
  const money = opts.money
    ? await planMoney(
        sb,
        visitIds,
        plans.map((p) => p.id),
      )
    : null;
  const byPlan = new Map<string, PlanVisit[]>();
  for (const v of visits ?? []) {
    const kind = (VISIT_KINDS as readonly string[]).includes(v.kind) ? (v.kind as VisitKind) : null;
    if (!kind) continue;
    const list = byPlan.get(v.plan_id) ?? [];
    list.push({
      id: v.id,
      kind,
      due_from: v.due_from,
      due_by: v.due_by,
      first_due_by: v.first_due_by,
      amount: Number(v.amount),
      push_reason: v.push_reason,
      pushed_by_name: v.pushed_by_name,
      customer_asked: !!v.customer_asked,
      lost_on: v.lost_on,
      ticket: ticketOf.get(v.id) ?? null,
      billed: money ? money.billed.has(v.id) : null,
    });
    byPlan.set(v.plan_id, list);
  }
  // The storm inspections a plan includes are not kept on the plan: the settings say.
  const benefits = plans.some((p) => p.plan === "guard") ? await readPlanBenefits(sb) : null;
  const out: RoofCarePlan[] = [];
  for (const p of plans) {
    const plan = asPlanKey(p.plan);
    if (!plan) continue;
    out.push({
      id: p.id,
      account_id: p.account_id,
      site_id: p.site_id,
      plan,
      status: asPlanStatus(p.status),
      pay_first: !!p.pay_first,
      plan_number: p.plan_number,
      first_visit: (FIRST_VISIT_CHOICES as readonly string[]).includes(p.first_visit)
        ? (p.first_visit as FirstVisit)
        : "window",
      first_days: p.first_days,
      starts_on: p.starts_on,
      invoice: money ? (money.own.get(p.id) ?? null) : null,
      pay_method: asPayMethod(p.pay_method),
      pay_note: p.pay_note,
      free_travel_calls: Number(p.free_travel_calls) || 0,
      free_travel_used: money ? (money.calls.get(p.id)?.size ?? 0) : null,
      refund:
        money && p.refund_due != null
          ? { due: Number(p.refund_due) || 0, sent_on: p.refund_sent_on, ref: p.refund_ref }
          : null,
      closed_out: p.closed_out_on
        ? { on: p.closed_out_on, reason: (p.closed_out_reason ?? "").trim() }
        : null,
      renewed_from: p.renewed_from,
      renewal_choice: asRenewalChoice(p.renewal_choice),
      renewal_credit: Number(p.renewal_credit) || 0,
      signed_on: p.signed_on,
      renews_on: p.renews_on,
      roof_sqft: Number(p.roof_sqft),
      price: Number(p.price),
      price_estimated: !!p.price_estimated,
      repair_allowance: Number(p.repair_allowance) || 0,
      allowance_used: money
        ? Math.round((money.uses.get(p.id) ?? []).reduce((n, u) => n + u.amount, 0) * 100) / 100
        : null,
      allowance_uses: money ? (money.uses.get(p.id) ?? []) : [],
      agreed_by: p.agreed_by,
      sold_by_name: p.sold_by_name,
      notes: p.notes,
      ended_on: p.ended_on,
      ended_reason: p.ended_reason,
      visits: (byPlan.get(p.id) ?? []).sort(
        (a, b) => ORDER[a.kind] - ORDER[b.kind] || a.due_from.localeCompare(b.due_from),
      ),
      storm_included: benefits?.[plan].storm ?? 0,
      email: {
        to: p.customer_email ?? null,
        agreement_sent_at: p.agreement_sent_at ?? null,
        agreement_error: p.agreement_error ?? null,
        receipt_sent_at: p.receipt_sent_at ?? null,
        receipt_error: p.receipt_error ?? null,
      },
    });
  }
  return out;
}

export const listRoofCarePlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ site_ids: z.array(z.string().uuid()).max(300) }).parse(d))
  .handler(async ({ data, context }): Promise<RoofCarePlan[]> => {
    const p = await signedIn(context);
    // What is billed and what the allowance has taken: for those who see invoices.
    return plansOfSites(context.supabase, data.site_ids, { money: seesInvoices(p) });
  });

const signUpInput = z.object({
  site_id: z.string().uuid(),
  plan: z.enum(PLAN_KEYS),
  sqft: sqftInput,
  first: z.enum(FIRST_VISIT_CHOICES),
  days: z.number().int().min(1).max(365).nullable().optional(),
  // How they pay for the year (owner, Nov 19: "by check or card either one during sign up"),
  // and a note with it: the number of a check handed over.
  pay_method: z.enum(PAY_METHODS, { errorMap: () => ({ message: PAY_METHOD_NEEDED }) }),
  pay_note: z.string().trim().max(120).optional(),
  agreed_by: z
    .string()
    .trim()
    .min(1, "Type the name of the person who agreed to the plan")
    .max(120),
  notes: z.string().trim().max(2000).optional(),
  // Where the agreement and the receipt are emailed (owner, Nov 19); blank when they gave none.
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || looksLikeEmail(v), EMAIL_BAD)
    .optional(),
  // The customer agreed to the plan's terms (owner, Nov 18): the form's tick, and no plan
  // without it. The database refuses it too.
  terms_agreed: z.literal(true, { errorMap: () => ({ message: TERMS_NOT_AGREED }) }),
  // The yearly price the form showed for this plan (Nov 19): the plan is saved at that price
  // or not at all.
  shown_price: z.number().finite().positive(),
});

/**
 * The tickets a plan's inspections have, to announce the ones made when it is paid. Not the
 * ticket of an inspection carried in from last plan year: that one was announced when it was made.
 */
export async function ticketIdsOfPlan(sb: Sb, planId: string): Promise<string[]> {
  const { data: visits } = await sb
    .from("roof_care_visits")
    .select("id")
    .eq("plan_id", planId)
    .neq("kind", "carried");
  const ids = (visits ?? []).map((v) => v.id);
  if (!ids.length) return [];
  const { data: jobs } = await sb
    .from("service_jobs")
    .select("id")
    .in("roof_care_visit_id", ids)
    .is("deleted_at", null);
  return (jobs ?? []).map((j) => j.id);
}

export const signUpRoofCare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => signUpInput.parse(d))
  .handler(async ({ data, context }): Promise<RoofCarePlan> => {
    const p = await signedIn(context);
    const sb = context.supabase;
    const site = await siteOf(sb, data.site_id);
    // The drive is worked out here, not sent by the form: it is what the price hangs on.
    const drive = await siteDrive(sb, site);
    if (!drive) throw new Error(NOT_PLACED_LINE);
    // The price the plan would be saved at, against the one the customer was shown.
    const { data: priced, error: pErr } = await sb.rpc("roof_care_price", {
      p_sqft: data.sqft,
      p_hours: drive.hours,
      p_miles: drive.miles,
    });
    if (pErr) throw new Error(pErr.message);
    const answer = readPriceAnswer(priced);
    const now = answer.ready ? answer.plans.find((o) => o.plan === data.plan) : undefined;
    if (now && now.price !== Math.round(data.shown_price))
      throw new Error(priceChangedLine(data.shown_price, now.price));
    // Signed, and waiting for its payment (Nov 19): no inspection is made until the plan's
    // invoice is paid. The older roof_care_sign_up is left for a page published before this.
    const { data: planId, error } = await sb.rpc("roof_care_sign_up_await_payment", {
      p_site: site.id,
      p_plan: data.plan,
      p_sqft: data.sqft,
      p_hours: drive.hours,
      p_miles: drive.miles,
      // An estimate when the address was placed by its zip or town, or the road router did not
      // answer and the straight line was used.
      p_estimated: placedRoughly(drive.placed_by) || drive.source === "estimated",
      p_first: data.first,
      p_days: data.first === "days" ? (data.days ?? 0) : 0,
      p_agreed_by: data.agreed_by,
      p_notes: data.notes ?? "",
      p_terms: ROOF_CARE_TERMS_VERSION,
      p_pay_method: data.pay_method,
      p_pay_note: data.pay_note ?? "",
    });
    if (error) throw new Error(error.message);
    // Where the agreement and the receipt go. A failure here does not undo the sign-up: the
    // plan then says it has no email address, and the office adds it.
    const email = (data.email ?? "").trim();
    if (email) {
      try {
        await sb.rpc("roof_care_set_email", { p_plan: planId, p_email: email });
      } catch {
        // Said on the plan.
      }
    }
    // Its invoice for the year, at once when the person signing may make invoices. A technician
    // may not: the plan then waits for the office, which makes it from the plan. A failure here
    // does not undo the sign-up; the plan says it has no invoice yet.
    const money = seesInvoices(p);
    if (money) {
      try {
        const { makePlanInvoice } = await import("@/lib/roof-care-plan-invoice.functions");
        await makePlanInvoice(sb, planId, { id: context.userId, name: nameOf(p) });
      } catch {
        // Said on the plan: "No invoice has been made for this plan yet."
      }
    }
    // The agreement, to the customer, now: they are standing there. What cannot go now (email
    // not set up, no service key on this server) goes with the scheduled run.
    if (email) await sendPlanEmailsNow(sb, planId);
    const made = (await plansOfSites(sb, [site.id], { money })).find((x) => x.id === planId);
    if (!made)
      throw new Error("The plan was saved, but it could not be read back. Reload the page.");
    return made;
  });

/** The agreement and the receipt of one plan, sent at once when they can be. Never throws. */
async function sendPlanEmailsNow(sb: Sb, planId: string): Promise<void> {
  try {
    const { dispatchPlanEmails } = await import("@/lib/roof-care-email.server");
    await dispatchPlanEmails(sb, { planId });
  } catch (e) {
    console.error("Roof Care plan email: plan", planId, "—", e instanceof Error ? e.message : e);
  }
}

/** Give or correct the email on a plan. A changed address gets the agreement (and receipt) again. */
export const setRoofCareEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        email: z
          .string()
          .trim()
          .max(254)
          .refine((v) => v === "" || looksLikeEmail(v), EMAIL_BAD),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await signedIn(context);
    const sb = context.supabase;
    const { error } = await sb.rpc("roof_care_set_email", {
      p_plan: data.plan_id,
      p_email: data.email,
    });
    if (error) throw new Error(error.message);
    if (data.email) await sendPlanEmailsNow(sb, data.plan_id);
    return { ok: true };
  });

export interface PushBackResult {
  due_by: string;
  days_past_first: number;
  /** The ticket's day moved with it, when it had one. */
  ticket_moved_to: string | null;
}

export const pushBackRoofCareVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        visit_id: z.string().uuid(),
        days: z.number().int().min(1).max(365),
        reason: z.string().trim().max(500).optional(),
        // The customer asked for it (Nov 19): it decides the renewal when the year closes
        // with this inspection still owed.
        customer: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<PushBackResult> => {
    const p = await signedIn(context);
    const sb = context.supabase;
    const { data: res, error } = await sb.rpc("roof_care_push_back", {
      p_visit: data.visit_id,
      p_days: data.days,
      p_reason: data.reason ?? "",
      ...(data.customer ? { p_customer: true } : {}),
    });
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as Record<string, unknown>;
    const jobId = typeof r["job_id"] === "string" ? r["job_id"] : null;
    const dateTo = typeof r["date_to"] === "string" ? r["date_to"] : null;
    if (jobId && dateTo) {
      const { moveCarePlanTicketDate } = await import("@/lib/service.functions");
      try {
        await moveCarePlanTicketDate(sb, jobId, dateTo, { id: context.userId, name: nameOf(p) });
      } catch (e) {
        throw new Error(
          `The inspection was pushed back, but its ticket's day was not moved: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return {
      due_by: String(r["due_by"] ?? ""),
      days_past_first: Number(r["days_past_first"] ?? 0),
      ticket_moved_to: jobId && dateTo ? dateTo : null,
    };
  });

export const addRoofCareStorm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ job_id: string | null }> => {
    const p = await signedIn(context);
    const sb = context.supabase;
    const { data: jobId, error } = await sb.rpc("roof_care_add_storm", { p_plan: data.plan_id });
    if (error) throw new Error(error.message);
    if (jobId) {
      const { announceCarePlanTickets } = await import("@/lib/service.functions");
      await announceCarePlanTickets(sb, [jobId], { id: context.userId, name: nameOf(p) });
    }
    return { job_id: jobId ?? null };
  });

export const endRoofCarePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        reason: z.string().trim().min(1, "Type why the plan is ending").max(500),
        refund: z.number().finite().min(0).max(10_000_000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; refund: number }> => {
    await signedIn(context);
    // Ended with its refund (Nov 19): the database works the sum and keeps the amount the
    // manager confirmed. Left out, the worked amount is taken.
    const { data: worked, error } = await context.supabase.rpc("roof_care_end_refund", {
      p_plan: data.plan_id,
      p_reason: data.reason,
      ...(data.refund == null ? {} : { p_refund: data.refund }),
    });
    if (error) throw new Error(error.message);
    const confirmed = Number((worked as { confirmed?: unknown } | null)?.confirmed);
    return { ok: true, refund: Number.isFinite(confirmed) ? confirmed : 0 };
  });

/** What ending the plan today would refund, for the End plan box. The office's alone. */
export const roofCareRefund = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RefundWorked> => {
    await signedIn(context);
    const { data: worked, error } = await context.supabase.rpc("roof_care_refund", {
      p_plan: data.plan_id,
    });
    if (error) throw new Error(error.message);
    const w = readRefundWorked(worked);
    if (!w) throw new Error("The refund could not be worked out");
    return w;
  });

/** The refund was sent to the customer. */
export const markRoofCareRefundSent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        ref: z.string().trim().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await signedIn(context);
    const { error } = await context.supabase.rpc("roof_care_refund_sent", {
      p_plan: data.plan_id,
      p_on: data.on,
      p_ref: data.ref ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Close out an expired plan that will not be renewed (owner, Nov 19: "do we ever have the
 * ability to dismiss that? say its owed and been 6 months and they just dont seem interested").
 * A manager's. `dropped`: how many inspections still owed were dropped with it.
 */
export const closeOutRoofCarePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        reason: z.string().trim().min(1, "Type why it is closed out").max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; dropped: number }> => {
    await signedIn(context);
    const { data: n, error } = await context.supabase.rpc("roof_care_close_out", {
      p_plan: data.plan_id,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true, dropped: Number(n) || 0 };
  });

// ── Renewal (owner, Nov 19) ─────────────────────────────────────────────────────────────────

/** What renewing the plan today would be, for the Renew box. The office's alone. */
export const roofCareRenewalOffer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RenewalOffer> => {
    await signedIn(context);
    const { data: answer, error } = await context.supabase.rpc("roof_care_renewal_offer", {
      p_plan: data.plan_id,
    });
    if (error) throw new Error(error.message);
    const offer = readRenewalOffer(answer);
    if (!offer) throw new Error("The renewal could not be worked out");
    return offer;
  });

/**
 * Renew the plan: the database makes next year's plan, waiting for its payment, and this makes
 * its invoice when the person renewing may make invoices. `invoice_id`: the invoice to open;
 * null when there is none (nobody here makes invoices, or the renewal is at no charge and
 * started by itself: `started`).
 */
export const renewRoofCarePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        // What happens with an inspection still owed; left out when none is.
        choice: z
          .enum(RENEWAL_CHOICES, { errorMap: () => ({ message: RENEWAL_CHOICE_NEEDED }) })
          .nullable()
          .optional(),
        pay_method: z.enum(PAY_METHODS, { errorMap: () => ({ message: PAY_METHOD_NEEDED }) }),
        pay_note: z.string().trim().max(120).optional(),
        // The yearly price the box showed: the renewal is saved at that price or not at all.
        shown_price: z.number().finite().positive(),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ plan_id: string; invoice_id: string | null; started: boolean }> => {
      const p = await signedIn(context);
      const sb = context.supabase;
      const { data: planId, error } = await sb.rpc("roof_care_renew", {
        p_plan: data.plan_id,
        ...(data.choice ? { p_choice: data.choice } : {}),
        p_pay_method: data.pay_method,
        p_pay_note: data.pay_note ?? "",
        p_shown_price: data.shown_price,
      });
      if (error) throw new Error(error.message);
      // The renewal's agreement and receipt go where last year's went.
      try {
        const { data: old } = await sb
          .from("roof_care_plans")
          .select("customer_email")
          .eq("id", data.plan_id)
          .maybeSingle();
        if (old?.customer_email) {
          await sb.rpc("roof_care_set_email", { p_plan: planId, p_email: old.customer_email });
          await sendPlanEmailsNow(sb, planId);
        }
      } catch {
        // The office adds the address on the plan.
      }
      const { data: made } = await sb
        .from("roof_care_plans")
        .select("status")
        .eq("id", planId)
        .maybeSingle();
      // At no charge (neither inspection was done): the database started the year by itself.
      if (made?.status === "active") {
        const { announceCarePlanTickets } = await import("@/lib/service.functions");
        await announceCarePlanTickets(sb, await ticketIdsOfPlan(sb, planId), {
          id: context.userId,
          name: nameOf(p),
        });
        return { plan_id: planId, invoice_id: null, started: true };
      }
      let invoiceId: string | null = null;
      if (seesInvoices(p)) {
        try {
          const { makePlanInvoice } = await import("@/lib/roof-care-plan-invoice.functions");
          invoiceId = (await makePlanInvoice(sb, planId, { id: context.userId, name: nameOf(p) }))
            .id;
        } catch {
          // Said on the plan: "No invoice has been made for this plan yet."
        }
      }
      return { plan_id: planId, invoice_id: invoiceId, started: false };
    },
  );

/**
 * An additional service asked for on site (owner, Nov 18: "they should be able to sign others up
 * for a plan or additional service and get credit"; the credit "is just a name"). Typed in
 * words until the list of services is settled. The database makes the opportunity, with nobody
 * on it yet and the signed-in person's name as who took it down: a technician cannot write
 * opportunities themselves.
 */
export const requestAdditionalService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        site_id: z.string().uuid(),
        services: z.string().trim().min(1, "Type what the customer is asking for").max(180),
        details: z.string().trim().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await signedIn(context);
    const { data: id, error } = await context.supabase.rpc("request_additional_service", {
      p_site: data.site_id,
      p_services: data.services,
      p_details: data.details ?? "",
    });
    if (error) throw new Error(error.message);
    return { id };
  });
