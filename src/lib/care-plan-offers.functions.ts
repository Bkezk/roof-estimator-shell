/**
 * "Was the Roof Care plan offered?" — the server side (care-plan-offers.ts has the counting).
 * Pressing Care Plan on a ticket is written by the database's roof_care_mark_offered(), under
 * the signed-in person's own access. The report is the admins', the same rule as the rest of
 * the Owner page.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import {
  OFFER_DAYS,
  offerReport,
  type OfferReport,
  type TicketOffer,
} from "@/lib/care-plan-offers";
import { chunkIds } from "@/lib/chunk-ids";
import { visibleToOwner } from "@/lib/owner-view";
import { parseTodayInput, viewerToday } from "@/lib/work-counts";
import { plusDays } from "@/lib/working-days";

const LIMIT = 2000;

/** Care Plan was pressed on this ticket. Kept once for each person. */
export const markCarePlanOffered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("roof_care_mark_offered", { p_job: data.job_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Who pressed Care Plan on a ticket, earliest first. The office's; a technician sees their own. */
export const carePlanOffered = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TicketOffer[]> => {
    const { data: rows, error } = await context.supabase
      .from("roof_care_offers")
      .select("by_name, at")
      .eq("job_id", data.job_id)
      .order("at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({ by_name: r.by_name, at: r.at }));
  });

/** The Owner page's count, by technician, for the last 30 days. Admins only. */
export const listCarePlanOffers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseTodayInput(d))
  .handler(async ({ data, context }): Promise<OfferReport> => {
    const sb = context.supabase;
    const { data: me, error: meErr } = await sb
      .from("profiles")
      .select("id, role")
      .eq("id", context.userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me || !visibleToOwner(me)) throw new Error("Forbidden: admin only");
    const today = viewerToday(data.today, new Date());
    // A day early: the days are the office's, the stamps are UTC. The counting trims it.
    const from = `${plusDays(today, -OFFER_DAYS - 1)}T00:00:00Z`;
    const { data: tickets, error: tErr } = await sb
      .from("service_jobs")
      .select("id, number, site_id, technician_id, completed_at, roof_care_visit_id")
      .is("deleted_at", null)
      .gte("completed_at", from)
      .limit(LIMIT);
    if (tErr) throw new Error(`tickets: ${tErr.message}`);
    const list = tickets ?? [];
    const ids = list.map((t) => t.id);
    const sites = [...new Set(list.map((t) => t.site_id).filter((s): s is string => !!s))];
    const techs = [...new Set(list.map((t) => t.technician_id).filter((s): s is string => !!s))];
    const offered = new Set<string>();
    for (const chunk of chunkIds(ids)) {
      const { data: rows, error } = await sb
        .from("roof_care_offers")
        .select("job_id")
        .in("job_id", chunk);
      if (error) throw new Error(`offers: ${error.message}`);
      for (const r of rows ?? []) offered.add(r.job_id);
    }
    const plans: { site_id: string; signed_on: string; status: string; ended_on: string | null }[] =
      [];
    for (const chunk of chunkIds(sites)) {
      const { data: rows, error } = await sb
        .from("roof_care_plans")
        .select("site_id, signed_on, status, ended_on")
        .in("site_id", chunk);
      if (error) throw new Error(`plans: ${error.message}`);
      plans.push(...(rows ?? []));
    }
    const names = new Map<string, string>();
    for (const chunk of chunkIds(techs)) {
      const { data: rows, error } = await sb
        .from("profiles")
        .select("id, full_name, email")
        .in("id", chunk);
      if (error) throw new Error(`people: ${error.message}`);
      for (const p of rows ?? []) names.set(p.id, (p.full_name ?? "").trim() || p.email);
    }
    return offerReport({ today, tickets: list, offered, plans, names });
  });
