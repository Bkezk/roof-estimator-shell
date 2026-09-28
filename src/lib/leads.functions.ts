/**
 * Construction leads — the client-callable side (leads.server.ts does the fetching). Owner,
 * Sep 28: state planroom jobs and Louisville commercial permits, surfaced before the roof
 * goes on so there is time to bid. Nothing here touches bids.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { assertPageAccess } from "@/lib/auth.functions";

export type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
export type LeadSettingsRow = Database["public"]["Tables"]["lead_settings"]["Row"];
export type LeadStatus = "new" | "watching" | "dismissed" | "added";

export const SOURCE_LABELS: Record<string, string> = {
  ky_planroom: "State planroom",
  louisville_permits: "Louisville permit",
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function prospectAccess(ctx: Ctx) {
  await assertPageAccess(ctx.supabase, ctx.userId, "prospect");
}
async function readAccess(ctx: Ctx) {
  try {
    await assertPageAccess(ctx.supabase, ctx.userId, "prospect");
  } catch {
    await assertPageAccess(ctx.supabase, ctx.userId, "estimate");
  }
}
async function adminOnly(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (data?.role !== "admin") throw new Error("Forbidden: admin access required");
}
const meName = async (ctx: Ctx) => {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  return (data?.full_name ?? "").trim() || data?.email || null;
};

const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * The lazy pass: the Leads page calls this on load; if the last pull is older than six hours
 * it refreshes. `force` (the Refresh button) skips the throttle.
 */
export const refreshLeadsIfDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ force: z.boolean().optional() }).parse(d ?? {}))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ran: boolean; note: string | null; error: string | null }> => {
      await prospectAccess(context);
      const { data: s } = await context.supabase
        .from("lead_settings")
        .select("last_fetch_at, last_fetch_note")
        .eq("id", 1)
        .maybeSingle();
      const last = s?.last_fetch_at ? Date.parse(s.last_fetch_at) : 0;
      if (!data.force && Date.now() - last < SIX_HOURS)
        return { ran: false, note: s?.last_fetch_note ?? null, error: null };
      try {
        const { refreshLeads } = await import("@/lib/leads.server");
        const r = await refreshLeads(context.supabase);
        return {
          ran: true,
          note: `${r.planroom} planroom jobs, ${r.louisville} Louisville permits; ${r.new_leads} new (${r.new_roof_leads} roof)`,
          error: r.failed.length ? r.failed.join("; ") : null,
        };
      } catch (e) {
        // Never take the page down over a source; the panel shows the error.
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Lead refresh failed", e);
        return { ran: false, note: s?.last_fetch_note ?? null, error: msg };
      }
    },
  );

const listSchema = z.object({
  /** Only leads the keyword match (or a new commercial building) flagged as roof work. */
  roofOnly: z.boolean().optional(),
  source: z.enum(["ky_planroom", "louisville_permits"]).optional(),
  /** open = new + watching (default); otherwise that status; all = everything. */
  status: z.enum(["open", "new", "watching", "dismissed", "added", "all"]).optional(),
  /** Include leads that dropped off their source. */
  includeGone: z.boolean().optional(),
});
export type ListLeadsInput = z.input<typeof listSchema>;

/** The leads, soonest bid date first (undated after, newest first), 500 at most. */
export const listLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<LeadRow[]> => {
    await readAccess(context);
    let q = context.supabase.from("leads").select("*").limit(500);
    if (data.roofOnly) q = q.eq("is_roof", true);
    if (data.source) q = q.eq("source", data.source);
    const st = data.status ?? "open";
    if (st === "open") q = q.in("status", ["new", "watching"]);
    else if (st !== "all") q = q.eq("status", st);
    if (!data.includeGone) q = q.is("gone_at", null);
    const { data: rows, error } = await q
      .order("bid_at", { ascending: true, nullsFirst: false })
      .order("first_seen_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export interface LeadCounts {
  open: number;
  open_roof: number;
  new_roof: number;
  settings: LeadSettingsRow;
}
/** The tab counts and the fetch stamp. */
export const leadCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeadCounts> => {
    await readAccess(context);
    const sb = context.supabase;
    const count = (f: (q: ReturnType<typeof base>) => ReturnType<typeof base>) =>
      f(base()).then(({ count: n, error }) => {
        if (error) throw new Error(error.message);
        return n ?? 0;
      });
    const base = () =>
      sb.from("leads").select("id", { count: "exact", head: true }).is("gone_at", null);
    const [open, openRoof, newRoof, { data: settings, error }] = await Promise.all([
      count((q) => q.in("status", ["new", "watching"])),
      count((q) => q.in("status", ["new", "watching"]).eq("is_roof", true)),
      count((q) => q.eq("status", "new").eq("is_roof", true)),
      sb.from("lead_settings").select("*").eq("id", 1).single(),
    ]);
    if (error) throw new Error(error.message);
    return { open, open_roof: openRoof, new_roof: newRoof, settings };
  });

export const setLeadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["new", "watching", "dismissed", "added"]),
        note: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LeadRow> => {
    await prospectAccess(context);
    const patch: Database["public"]["Tables"]["leads"]["Update"] = {
      status: data.status,
      status_by_name: await meName(context),
      status_at: new Date().toISOString(),
    };
    if (data.note !== undefined) patch.note = data.note;
    const { data: row, error } = await context.supabase
      .from("leads")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Add the lead to My prospects as a building typed in by hand (source "manual"), linked back
 * to the lead. A permit carries its address and point; a planroom job carries its name and
 * town. Returns the building so the page can open it.
 */
export const addLeadToProspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ building_id: string; existed: boolean }> => {
    await prospectAccess(context);
    const sb = context.supabase;
    const { data: lead, error } = await sb.from("leads").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    if (lead.building_id) return { building_id: lead.building_id, existed: true };
    const who = await meName(context);
    const now = new Date().toISOString();
    const sourceLabel = SOURCE_LABELS[lead.source] ?? lead.source;
    const { data: b, error: bErr } = await sb
      .from("buildings")
      .insert({
        source: "manual",
        name: lead.source === "louisville_permits" ? (lead.project_type ?? lead.title) : lead.title,
        address1: lead.address ?? "",
        city: lead.city ?? lead.location ?? null,
        state: "KY",
        county: lead.county,
        building_sqft: lead.sqft,
        centroid_lat: lead.lat,
        centroid_lng: lead.lng,
        notes: `${sourceLabel}${lead.agency ? ` — ${lead.agency}` : ""}${lead.contractor ? ` — contractor ${lead.contractor}` : ""}${lead.url ? `\n${lead.url}` : ""}`,
        created_by: context.userId,
        created_by_name: who,
        prospect_stage: "prospect",
        prospected_at: now,
        prospect_owner_name: who,
      })
      .select("id")
      .single();
    if (bErr) throw new Error(bErr.message);
    const { error: lErr } = await sb
      .from("leads")
      .update({ building_id: b.id, status: "added", status_by_name: who, status_at: now })
      .eq("id", lead.id);
    if (lErr) throw new Error(lErr.message);
    return { building_id: b.id, existed: false };
  });

export const getLeadSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeadSettingsRow> => {
    await readAccess(context);
    const { data, error } = await context.supabase
      .from("lead_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

const settingsSchema = z.object({
  roof_keywords: z.array(z.string().trim().min(1).max(40)).max(50),
  louisville_types: z.array(z.string().trim().min(1).max(60)).max(20),
  louisville_min_sqft: z.number().min(0).max(1000000),
  louisville_days: z.number().int().min(7).max(365),
});
export type LeadSettingsInput = z.input<typeof settingsSchema>;
export const setLeadSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await adminOnly(context);
    const { error } = await context.supabase
      .from("lead_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
  });
