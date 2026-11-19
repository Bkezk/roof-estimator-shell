/**
 * Roof Care plans, step 2: the server side of a property's plan (owner, Nov 18;
 * docs/roof-care-plans.md, lib/roof-care-plan.ts, 20261118240000_roof_care_plans.sql).
 *
 *  - roofCareOffer: the drive from the office to a property and, with a roof size, what each
 *    plan costs the customer there. Prices only: the database works them out
 *    (roof_care_price) and hands back no cost, so anyone who may sign a customer up can ask.
 *  - signUpRoofCare: the sign-up. The drive is worked out again here, never taken from the
 *    form, and the database works the price out again from it.
 *  - listRoofCarePlans: the plans of some properties with their inspections and tickets.
 *  - pushBackRoofCareVisit, addRoofCareStorm, endRoofCarePlan.
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
  asPlanKey,
  carePlanLineSource,
  FIRST_VISIT_CHOICES,
  priceChangedLine,
  readPriceAnswer,
  ROOF_CARE_TERMS_VERSION,
  shownPrice,
  TERMS_NOT_AGREED,
  VISIT_KINDS,
  type AllowanceUse,
  type PlanVisit,
  type PriceEstimate,
  type RoofCarePlan,
  type ShownPrice,
  type VisitKind,
  type VisitTicket,
} from "@/lib/roof-care-plan";
import { NOT_PLACED_LINE, placedRoughly } from "@/lib/roof-care-locate";
import { PLAN_KEYS } from "@/lib/roof-care-price";
import { driveTo, officeOrigin, type RoofCareDrive } from "@/lib/roof-care.functions";

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

const SITE_SELECT = "id, account_id, name, address1, address2, city, state, zip, lat, lng" as const;

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

const PLAN_SELECT =
  "id, account_id, site_id, plan, status, signed_on, renews_on, roof_sqft, price, price_estimated, repair_allowance, agreed_by, sold_by_name, notes, ended_on, ended_reason" as const;
const VISIT_SELECT =
  "id, plan_id, kind, due_from, due_by, first_due_by, amount, push_reason, pushed_by_name" as const;
const TICKET_SELECT =
  "id, number, stage, scheduled_date, completed_at, invoice_id, roof_care_visit_id" as const;

const ORDER: Record<VisitKind, number> = { visit1: 0, visit2: 1, storm: 2 };

/**
 * What the plans' own lines on invoices say (Nov 19): which inspections have their share of the
 * plan on a live invoice, and what each plan's minor repairs allowance has taken. A void invoice
 * counts for nothing. Read with the caller's sign-in, so only for someone who sees invoices.
 */
async function planMoney(sb: Sb, visitIds: readonly string[], planIds: readonly string[]) {
  const billed = new Set<string>();
  const uses = new Map<string, AllowanceUse[]>();
  const sources = [...visitIds.map(carePlanLineSource), ...planIds.map(allowanceLineSource)];
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
  for (const l of lines) {
    const number = live.get(l.invoice_id);
    if (number === undefined || !l.source) continue;
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
  return { billed, uses };
}

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
      ticket: ticketOf.get(v.id) ?? null,
      billed: money ? money.billed.has(v.id) : null,
    });
    byPlan.set(v.plan_id, list);
  }
  const out: RoofCarePlan[] = [];
  for (const p of plans) {
    const plan = asPlanKey(p.plan);
    if (!plan) continue;
    out.push({
      id: p.id,
      account_id: p.account_id,
      site_id: p.site_id,
      plan,
      status: p.status === "ended" ? "ended" : "active",
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
  agreed_by: z
    .string()
    .trim()
    .min(1, "Type the name of the person who agreed to the plan")
    .max(120),
  notes: z.string().trim().max(2000).optional(),
  // The customer agreed to the plan's terms (owner, Nov 18): the form's tick, and no plan
  // without it. The database refuses it too.
  terms_agreed: z.literal(true, { errorMap: () => ({ message: TERMS_NOT_AGREED }) }),
  // The yearly price the form showed for this plan (Nov 19): the plan is saved at that price
  // or not at all.
  shown_price: z.number().finite().positive(),
});

/** The tickets a plan's inspections have, to announce the ones just made. */
async function ticketIdsOfPlan(sb: Sb, planId: string): Promise<string[]> {
  const { data: visits } = await sb.from("roof_care_visits").select("id").eq("plan_id", planId);
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
    const { data: planId, error } = await sb.rpc("roof_care_sign_up", {
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
    });
    if (error) throw new Error(error.message);
    const { announceCarePlanTickets } = await import("@/lib/service.functions");
    await announceCarePlanTickets(sb, await ticketIdsOfPlan(sb, planId), {
      id: context.userId,
      name: nameOf(p),
    });
    const made = (await plansOfSites(sb, [site.id])).find((x) => x.id === planId);
    if (!made)
      throw new Error("The plan was saved, but it could not be read back. Reload the page.");
    return made;
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
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await signedIn(context);
    const { error } = await context.supabase.rpc("roof_care_end", {
      p_plan: data.plan_id,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

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
