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
import { isFieldOnly, managesTickets, seesInvoices } from "@/lib/access";
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
  cardBackOf,
  carePlanLineSource,
  FIRST_VISIT_CHOICES,
  mapRoofSize,
  ownStormCount,
  PAY_METHOD_NEEDED,
  PAY_METHODS,
  priceChangedLine,
  readFieldPlans,
  readPriceAnswer,
  readRefundChanges,
  readsPlanTables,
  readRefundWorked,
  REFUND_CHANGE_REASON_NEEDED,
  readRenewalOffer,
  RENEWAL_CHOICE_NEEDED,
  RENEWAL_CHOICES,
  ROOF_CARE_TERMS_VERSION,
  shownPrice,
  SIZE_NEEDED,
  sizeAgainstMap,
  sizeSmallerLine,
  SKIP_REASON_NEEDED,
  TERMS_NOT_AGREED,
  VISIT_KINDS,
  type AllowanceUse,
  type FirstVisit,
  type MapRoofSize,
  type PlanCardBack,
  type PlanInvoiceRef,
  type PlanNoAccess,
  type PlanVisit,
  type PriceEstimate,
  type RefundWorked,
  type RenewalOffer,
  type RoofCarePlan,
  type ShownPrice,
  type VisitKind,
  type VisitTicket,
} from "@/lib/roof-care-plan";
import { CARE_START_FIRST_VISIT, carePrefillNote, careStartsItself } from "@/lib/public-requests";
import { NOT_PLACED_LINE, placedRoughly } from "@/lib/roof-care-locate";
import { PLAN_KEYS } from "@/lib/roof-care-price";
import { isTripLine, tripLineSource } from "@/lib/roof-care-no-access";
import { readStormOffer, type StormOffer } from "@/lib/roof-care-storm";
import { isTravelWaiverLine, travelLineSource } from "@/lib/roof-care-travel";
import { OPPORTUNITY_NEW_KIND, onSiteRequestNotice } from "@/lib/work-steps";
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
  /**
   * The roof size the map has for the property (Nov 20), which the sign-up checks the typed
   * size against; null when the map has none. Absent on an older answer.
   */
  map_sqft?: number | null;
}

// Any number: a size that cannot be right is answered in words by the handler and by the
// database (Nov 20), never by a list of what the program expected.
const sqftInput = z.number().finite();

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
    if (data.sqft != null && !(data.sqft > 0)) throw new Error(SIZE_NEEDED);
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
    const map = site.map_roof_sqft == null ? null : Number(site.map_roof_sqft);
    return {
      site: { id: site.id, name: site.name },
      placed: !!drive,
      estimate,
      price,
      map_sqft: sizeAgainstMap(1, map) === "unchecked" ? null : map,
    };
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
  "id, account_id, site_id, plan, status, pay_first, plan_number, first_visit, first_days, starts_on, signed_on, renews_on, roof_sqft, price, price_estimated, repair_allowance, free_travel_calls, storm_included, pay_method, pay_note, refund_due, refund_sent_on, refund_ref, refund_changes, closed_out_on, closed_out_reason, renewed_from, renewal_choice, renewal_credit, agreed_by, sold_by_name, notes, ended_on, ended_reason, customer_email, agreement_sent_at, agreement_error, receipt_sent_at, receipt_error, forecast_sent_on, card_paid_on, card_paid_amount, card_paid_ref, size_map_sqft, size_unchecked, size_confirmed_on, size_confirmed_by_name" as const;
const VISIT_SELECT =
  "id, plan_id, kind, due_from, due_by, first_due_by, amount, push_reason, pushed_by_name, customer_asked, lost_on, skipped_on, skip_reason, skipped_by_name, drains_cleaned, gutters_cleaned, cleaning_note, cleaning_by_name, cleaning_at" as const;
const TICKET_SELECT =
  "id, number, stage, scheduled_date, completed_at, invoice_id, roof_care_visit_id" as const;

// One owed from last plan year leads: it is the one with the clock on it.
const ORDER: Record<VisitKind, number> = { carried: -1, visit1: 0, visit2: 1, storm: 2 };

/**
 * What the plans' own lines on invoices say (Nov 19): which inspections have their share of the
 * plan on a live invoice, and what each plan's minor repairs allowance has taken. A void invoice
 * counts for nothing. Read with the caller's sign-in, so only for someone who sees invoices.
 */
async function planMoney(
  sb: Sb,
  visitIds: readonly string[],
  planIds: readonly string[],
  /** The no access records whose return trip may be on an invoice. */
  tripIds: readonly string[] = [],
) {
  const billed = new Set<string>();
  const uses = new Map<string, AllowanceUse[]>();
  // The invoice each charged return trip is on.
  const trips = new Map<string, { id: string; number: string }>();
  const sources = [
    ...visitIds.map(carePlanLineSource),
    ...planIds.map(allowanceLineSource),
    ...planIds.map(travelLineSource),
    ...tripIds.map(tripLineSource),
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
    if (isTripLine(l)) {
      trips.set(l.source.slice(tripLineSource("").length), { id: l.invoice_id, number });
      continue;
    }
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
  return { billed, uses, own, calls, trips };
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
  opts: {
    money?: boolean;
    /**
     * Also the times the crew could not get on the roof: for the office, who read all of them.
     * A technician reads only their own, so no list is given to one.
     */
    noAccess?: boolean;
    /**
     * The reader is not answered by the plan tables (a technician: Nov 20): the plans come
     * from roof_care_field_plans(), with no money in them, and each inspection's ticket
     * whoever it is with.
     */
    field?: boolean;
  } = {},
): Promise<RoofCarePlan[]> {
  if (!siteIds.length) return [];
  if (opts.field) {
    const { data: answer, error: fErr } = await sb.rpc("roof_care_field_plans", {
      p_sites: [...siteIds],
    });
    if (fErr) throw new Error(fErr.message);
    const raw = Array.isArray(answer) ? answer : [];
    const numbers = raw.some((r) => (r as { plan?: unknown } | null)?.plan === "guard")
      ? await readPlanBenefits(sb)
      : null;
    return readFieldPlans(answer, numbers ? { guard: numbers.guard.storm } : {});
  }
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
  const { data: missed, error: nErr } = opts.noAccess
    ? await sb
        .from("roof_care_no_access")
        .select("id, plan_id, visit_id, on_date, note, by_name, charged, amount, at")
        .in(
          "plan_id",
          plans.map((p) => p.id),
        )
        .order("at", { ascending: true })
    : { data: null, error: null };
  if (nErr) throw new Error(nErr.message);
  const money = opts.money
    ? await planMoney(
        sb,
        visitIds,
        plans.map((p) => p.id),
        (missed ?? []).filter((n) => n.charged).map((n) => n.id),
      )
    : null;
  // Card money that has to go back, sent or not (Nov 20). The office reads the table; anyone
  // else is answered with no rows.
  const cardBackOfPlan = new Map<string, PlanCardBack[]>();
  if (money) {
    const { data: cards, error: cErr } = await sb
      .from("roof_care_card_payments")
      .select(
        "id, plan_id, outcome, reason, amount, over, owed, ref, paid_on, sent_back_on, sent_back_ref, sent_back_by_name",
      )
      .in(
        "plan_id",
        plans.map((p) => p.id),
      )
      .order("paid_on", { ascending: true });
    if (cErr) throw new Error(`The plans' card payments: ${cErr.message}`);
    for (const c of cards ?? []) {
      const back = cardBackOf(c);
      if (back) cardBackOfPlan.set(c.plan_id, [...(cardBackOfPlan.get(c.plan_id) ?? []), back]);
    }
  }
  const noAccessOf = new Map<string, PlanNoAccess[]>();
  for (const n of missed ?? []) {
    const list = noAccessOf.get(n.plan_id) ?? [];
    const invoice = money ? (money.trips.get(n.id) ?? null) : null;
    list.push({
      id: n.id,
      visit_id: n.visit_id,
      on: n.on_date,
      note: n.note,
      by_name: n.by_name,
      charged: !!n.charged,
      amount: n.amount == null ? null : Number(n.amount),
      invoice,
      billed: money && n.charged ? !!invoice : null,
    });
    noAccessOf.set(n.plan_id, list);
  }
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
      skipped_on: v.skipped_on ?? null,
      skip_reason: v.skip_reason ?? null,
      skipped_by_name: v.skipped_by_name ?? null,
      ticket: ticketOf.get(v.id) ?? null,
      billed: money ? money.billed.has(v.id) : null,
      drains_cleaned: v.drains_cleaned ?? null,
      gutters_cleaned: v.gutters_cleaned ?? null,
      cleaning_note: v.cleaning_note ?? null,
      cleaning_by_name: v.cleaning_by_name ?? null,
      cleaning_at: v.cleaning_at ?? null,
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
          ? {
              due: Number(p.refund_due) || 0,
              sent_on: p.refund_sent_on,
              ref: p.refund_ref,
              changes: readRefundChanges(p.refund_changes),
            }
          : null,
      card_back: money ? (cardBackOfPlan.get(p.id) ?? []) : null,
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
      // The plan's own number, as signed (Nov 20): a change of the setting does not reach a
      // plan already sold. One from before the number was kept reads the setting.
      storm_included: ownStormCount(p.storm_included, benefits?.[plan].storm),
      no_access: opts.noAccess ? (noAccessOf.get(p.id) ?? []) : null,
      forecast_sent_on: p.forecast_sent_on ?? null,
      card_paid: p.card_paid_on
        ? {
            on: p.card_paid_on,
            amount: money ? Number(p.card_paid_amount) || 0 : null,
            ref: p.card_paid_ref ?? null,
          }
        : null,
      email: {
        to: p.customer_email ?? null,
        agreement_sent_at: p.agreement_sent_at ?? null,
        agreement_error: p.agreement_error ?? null,
        receipt_sent_at: p.receipt_sent_at ?? null,
        receipt_error: p.receipt_error ?? null,
      },
      size: {
        unchecked: !!p.size_unchecked,
        map_sqft: p.size_map_sqft == null ? null : Number(p.size_map_sqft),
        confirmed: p.size_confirmed_on
          ? { on: p.size_confirmed_on, by_name: (p.size_confirmed_by_name ?? "").trim() }
          : null,
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
    // The times we could not get on the roof: the office reads them all.
    return plansOfSites(context.supabase, data.site_ids, {
      money: seesInvoices(p),
      noAccess: !isFieldOnly(p),
      field: !readsPlanTables(p),
    });
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
  // A manager or an admin ticked that the typed size is right, though the map shows a roof
  // more than 20% larger (Nov 20). Anyone else's tick is refused by the database.
  size_ok: z.boolean().optional(),
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
  .handler(({ data, context }): Promise<RoofCarePlan> => signUpPlan(context, data));

/**
 * The sign-up itself: every rule of it, for the sign-up window and for a plan started straight
 * from a public request (startPlanFromRequest). One place, so the two cannot drift apart.
 */
async function signUpPlan(context: Ctx, data: z.infer<typeof signUpInput>): Promise<RoofCarePlan> {
  {
    const p = await signedIn(context);
    const sb = context.supabase;
    const site = await siteOf(sb, data.site_id);
    // The drive is worked out here, not sent by the form: it is what the price hangs on.
    if (!(data.sqft > 0)) throw new Error(SIZE_NEEDED);
    // The typed size against the map's (Nov 20): one more than 20% smaller is not signed,
    // unless a manager or an admin ticked that it is right. The database checks it again.
    const mapSqft = site.map_roof_sqft == null ? null : Number(site.map_roof_sqft);
    if (mapSqft != null && sizeAgainstMap(data.sqft, mapSqft) === "smaller") {
      const boss = managesTickets(p);
      if (!boss || !data.size_ok) throw new Error(sizeSmallerLine(mapSqft, data.sqft, boss));
    }
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
      ...(data.size_ok ? { p_size_ok: true } : {}),
      // The database checks it again (Nov 20): saved at the price shown, or not at all.
      p_shown_price: data.shown_price,
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
    // Nov 24 (owner: "will they get an notification when there is a sign up but no payement?
    // they should"): the admins and the managers, now. It is told again every two days while
    // it waits (roof-care-pay-notice.ts).
    await tellSignedNotPaid(sb, planId, context.userId);
    const made = (await plansOfSites(sb, [site.id], { money, field: !readsPlanTables(p) })).find(
      (x) => x.id === planId,
    );
    if (!made)
      throw new Error("The plan was saved, but it could not be read back. Reload the page.");
    return made;
  }
}

/** What starting a plan from a request answers. */
export interface StartedFromRequest {
  plan: RoofCarePlan;
  /** False when the plan is signed and the request could not be pointed at it. */
  tied: boolean;
}

/**
 * Start the plan a customer picked on the public Roof Care page, with no sign-up window (owner,
 * Nov 24: "it should just ask us to confirm the roof size, then send the payment link and once
 * paid the opp should flip to won"). The customer already picked the plan, typed the size, said
 * how they pay and ticked the terms, so the office is asked nothing again.
 *
 * Every rule of the sign-up still runs (signUpPlan): the price is read fresh, the size is
 * checked against the map, one plan to a property. The first inspection is the usual choice,
 * the inspection window. What cannot be started this way (no size typed, older terms) is
 * refused in plain words, and the sign-up window is still there for it.
 */
export const startPlanFromRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ request_id: z.string().uuid(), site_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<StartedFromRequest> => {
    await signedIn(context);
    const sb = context.supabase;
    const { readCarePrefill, handleRequest } = await import("@/lib/public-requests.functions");
    const prefill = await readCarePrefill(context, data.request_id, data.site_id);
    const can = careStartsItself(prefill, ROOF_CARE_TERMS_VERSION);
    if (!can.ok) throw new Error(can.why);
    const ask = prefill!;
    // The price today, for the size they typed: the plan is saved at it or not at all.
    const site = await siteOf(sb, data.site_id);
    const drive = await siteDrive(sb, site);
    if (!drive) throw new Error(NOT_PLACED_LINE);
    const { data: priced, error: pErr } = await sb.rpc("roof_care_price", {
      p_sqft: ask.sqft!,
      p_hours: drive.hours,
      p_miles: drive.miles,
    });
    if (pErr) throw new Error(pErr.message);
    const answer = readPriceAnswer(priced);
    const now = answer.ready ? answer.plans.find((o) => o.plan === ask.plan) : undefined;
    if (!now) throw new Error(CARE_START_NO_PRICE);
    const plan = await signUpPlan(context, {
      site_id: data.site_id,
      plan: ask.plan,
      sqft: ask.sqft!,
      first: CARE_START_FIRST_VISIT,
      pay_method: ask.pay_method,
      agreed_by: ask.agreed_by,
      notes: carePrefillNote(ask),
      email: looksLikeEmail(ask.customer_email) ? ask.customer_email : "",
      terms_agreed: true,
      shown_price: now.price,
    });
    // The request points at the plan it became, so its opportunity turns Won by itself the day
    // the plan is paid (Nov 23). The plan is signed either way.
    let tied = true;
    try {
      await handleRequest(context, {
        id: data.request_id,
        status: "matched",
        site_id: data.site_id,
        plan_id: plan.id,
      });
    } catch (e) {
      tied = false;
      console.error("Plan from a request: request", data.request_id, "was not tied —", e);
    }
    return { plan, tied };
  });

/** A roof the page priced, but the office's prices have no plain price for today. */
export const CARE_START_NO_PRICE =
  "This roof has no plain price today, so the plan was not started. Open the sign-up to see why.";

/** "Signed, not paid" to the admins and the managers. Never throws: the sign-up stands. */
async function tellSignedNotPaid(sb: Sb, planId: string, actorId: string): Promise<void> {
  try {
    const { tellPlanSignedNotPaid } = await import("@/lib/roof-care-notify.server");
    await tellPlanSignedNotPaid(sb, planId, actorId);
  } catch (e) {
    console.error("Plan not paid notice: plan", planId, "—", e instanceof Error ? e.message : e);
  }
}

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

/**
 * Where the plan stands before Storm inspection is pressed (Nov 19, late): one the plan
 * includes, or a further one that is billed, with what it costs after what is left of the minor
 * repairs. The office's; the database refuses anyone else.
 */
export const roofCareStormOffer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<StormOffer> => {
    const { data: answer, error } = await context.supabase.rpc("roof_care_storm_offer", {
      p_plan: data.plan_id,
    });
    if (error) throw new Error(error.message);
    const offer = readStormOffer(answer);
    if (!offer) throw new Error("The storm inspection's answer could not be read");
    return offer;
  });

export const addRoofCareStorm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        // The screen said this one is billed, and what it costs, before it was pressed.
        billed_ok: z.boolean().default(false),
        // One was already added today, and the box's tick says a second is wanted (Nov 20).
        again_ok: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ job_id: string | null }> => {
    const p = await signedIn(context);
    const sb = context.supabase;
    const { data: jobId, error } = await sb.rpc("roof_care_add_storm", {
      p_plan: data.plan_id,
      p_billed_ok: data.billed_ok,
      ...(data.again_ok ? { p_again_ok: true } : {}),
    });
    if (error) throw new Error(error.message);
    if (jobId) {
      const { announceCarePlanTickets } = await import("@/lib/service.functions");
      await announceCarePlanTickets(sb, [jobId], { id: context.userId, name: nameOf(p) });
    }
    return { job_id: jobId ?? null };
  });

/**
 * Take off a storm inspection added by mistake (Nov 20): a manager's or an admin's, while its
 * ticket is not started and nothing of it is invoiced. `made_included`: a billed one that
 * became the one the plan includes, with its ticket's number when it has one.
 */
export const removeRoofCareStorm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ visit_id: z.string().uuid() }).parse(d))
  .handler(
    async ({ data, context }): Promise<{ made_included: boolean; number: number | null }> => {
      const { data: res, error } = await context.supabase.rpc("roof_care_remove_storm", {
        p_visit: data.visit_id,
      });
      if (error) throw new Error(error.message);
      const r = (res ?? {}) as Record<string, unknown>;
      const n = Number(r["made_included_number"]);
      return {
        made_included: r["made_included"] === true,
        number: Number.isFinite(n) && n > 0 ? n : null,
      };
    },
  );

/**
 * Skip an inspection (Nov 20): a manager or an admin says we will not do it, with a reason.
 * Its ticket comes off the board and is not made again; it still counts as an inspection owed.
 */
export const skipRoofCareVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        visit_id: z.string().uuid(),
        reason: z.string().trim().min(1, SKIP_REASON_NEEDED).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ticket: number | null }> => {
    const { data: res, error } = await context.supabase.rpc("roof_care_skip_visit", {
      p_visit: data.visit_id,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    const n = Number((res as { number?: unknown } | null)?.number);
    return { ticket: Number.isFinite(n) && n > 0 ? n : null };
  });

/** A manager or an admin confirms a roof size that was not checked against the map (Nov 20). */
export const confirmRoofCareSize = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ plan_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("roof_care_confirm_size", {
      p_plan: data.plan_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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
 * A manager changes a refund that is owed (owner, Nov 20). The database decides who may, checks
 * the amount against what was paid, and keeps the change (roof_care_change_refund).
 */
export const changeRoofCareRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        plan_id: z.string().uuid(),
        amount: z.number().finite().min(0, "Type the refund: 0 or more").max(100_000_000),
        reason: z.string().trim().min(1, REFUND_CHANGE_REASON_NEEDED).max(300),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await signedIn(context);
    const { error } = await context.supabase.rpc("roof_care_change_refund", {
      p_plan: data.plan_id,
      p_amount: data.amount,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Card money that had to go back was sent back (owner, Nov 20). A manager's or an admin's. */
export const markRoofCareCardSentBack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        payment_id: z.string().uuid(),
        on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        ref: z.string().trim().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await signedIn(context);
    const { error } = await context.supabase.rpc("roof_care_card_sent_back", {
      p_payment: data.payment_id,
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
      // Nov 24: a renewal that waits for its payment is told like a sign-up.
      await tellSignedNotPaid(sb, planId, context.userId);
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
    const p = await signedIn(context);
    const { data: id, error } = await context.supabase.rpc("request_additional_service", {
      p_site: data.site_id,
      p_services: data.services,
      p_details: data.details ?? "",
    });
    if (error) throw new Error(error.message);
    // Nov 24 (owner: "we also need notifications for a new opportunity"): this made an
    // opportunity and told nobody. The people on the "New opportunity" line on Admin ›
    // Reminders are told now, and anyone on "Each step", once. Never fails the request.
    const { tellStep } = await import("@/lib/work-steps.server");
    const step = {
      kind: OPPORTUNITY_NEW_KIND,
      notice: onSiteRequestNotice({ services: data.services, who: nameOf(p) ?? "Someone" }),
      url: `/opportunities?id=${id}`,
      actorId: context.userId,
      sb: context.supabase,
    };
    const told = await tellStep({ ...step, key: "opportunity.opened" });
    await tellStep({ ...step, key: "opportunity.steps", skip: told });
    return { id };
  });
