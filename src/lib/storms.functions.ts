/**
 * Storm call points — the client-callable side (storms.server.ts does the NOAA pull). Owner,
 * Sep 28: a rolling window of hail / wind / tornado reports; every building near one is a
 * potential call point, and old hits fall off on their own.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { assertPageAccess } from "@/lib/auth.functions";
import { countyKeyFor, countyLabelFor } from "@/lib/prospect";

export type StormSettingsRow = Database["public"]["Tables"]["storm_settings"]["Row"];
export type StormReportRow = Database["public"]["Tables"]["storm_reports"]["Row"];

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

export const KIND_LABELS: Record<string, string> = {
  hail: "Hail",
  wind: "Wind",
  tornado: "Tornado",
};

/**
 * "Hail 1.75″", "Wind 70 mph", "Tornado EF2". NOAA marks a wind report UNK when damage was
 * reported (trees, lines down) with no measured gust, so that reads "Wind (damage reported)".
 */
export function stormLabel(kind: string | null, magnitude: number | null): string {
  if (!kind) return "";
  if (kind === "hail")
    return magnitude != null ? `Hail ${magnitude.toFixed(2).replace(/\.?0+$/, "")}″` : "Hail";
  if (kind === "wind")
    return magnitude != null ? `Wind ${magnitude} mph` : "Wind (damage reported)";
  return magnitude != null ? `Tornado EF${magnitude}` : "Tornado";
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** The first day of the storm window ("2026-09-23" for 7 days on Sep 30), as the panel counts it. */
export function stormWindowFrom(windowDays: number, now = Date.now()): string {
  return new Date(now - windowDays * 86400000).toISOString().slice(0, 10);
}

type StormRule = Pick<
  StormSettingsRow,
  | "states"
  | "min_hail_in"
  | "min_wind_mph"
  | "hail_radius_mi"
  | "wind_radius_mi"
  | "tornado_radius_mi"
>;

/**
 * Does a report clear the thresholds (match_storm_reports' rule): a watched state, hail with a
 * size at or above the minimum, wind at or above the minimum or with no speed (damage reported),
 * any tornado.
 */
export function stormReportQualifies(
  s: StormRule,
  r: { kind: string; magnitude: number | null; state: string },
): boolean {
  if (!(s.states ?? []).includes(r.state)) return false;
  if (r.kind === "hail") return r.magnitude != null && r.magnitude >= Number(s.min_hail_in);
  if (r.kind === "wind") return r.magnitude == null || r.magnitude >= Number(s.min_wind_mph);
  return r.kind === "tornado";
}

/** Does a stored hit still flag its building: the report qualifies and lies within its kind's radius. */
export function stormHitQualifies(
  s: StormRule,
  r: { kind: string; magnitude: number | null; state: string },
  distanceMi: number,
): boolean {
  const radius =
    r.kind === "hail"
      ? s.hail_radius_mi
      : r.kind === "wind"
        ? s.wind_radius_mi
        : s.tornado_radius_mi;
  return stormReportQualifies(s, r) && distanceMi <= Number(radius);
}

/**
 * The lazy pass: a Prospecting user's Buildings page calls this on load; if the last pull is
 * older than six hours it refreshes. `force` (the Refresh button) skips the throttle.
 */
export const refreshStormsIfDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ force: z.boolean().optional() }).parse(d ?? {}))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ran: boolean; note: string | null; error: string | null }> => {
      await prospectAccess(context);
      const { data: s } = await context.supabase
        .from("storm_settings")
        .select("last_fetch_at, last_fetch_note")
        .eq("id", 1)
        .maybeSingle();
      const last = s?.last_fetch_at ? Date.parse(s.last_fetch_at) : 0;
      if (!data.force && Date.now() - last < SIX_HOURS)
        return { ran: false, note: s?.last_fetch_note ?? null, error: null };
      try {
        const { refreshStorms } = await import("@/lib/storms.server");
        const r = await refreshStorms(context.supabase);
        return {
          ran: true,
          note: `${r.reports_in_window} reports in the window, ${r.buildings_flagged} buildings flagged (${r.new_hits} new)`,
          error: r.failed_files.length ? `${r.failed_files.length} NOAA file(s) failed` : null,
        };
      } catch (e) {
        // Never take the Buildings page down over NOAA; the panel shows the error.
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Storm refresh failed", e);
        return { ran: false, note: s?.last_fetch_note ?? null, error: msg };
      }
    },
  );

export interface StormCountyRow {
  county: string;
  /** The reports' state (NOAA's): a county name both states use is two rows. */
  state: string;
  /** The county filter key: "Lawrence|TN" for a name both states use, else the county. */
  key: string;
  /** "Lawrence, TN" for a name both states use, else the county. */
  label: string;
  reports: number;
  hail: number;
  wind: number;
  tornado: number;
  max_hail_in: number | null;
  max_wind_mph: number | null;
  latest: string;
  buildings_hit: number;
}
export interface StormSummary {
  settings: StormSettingsRow;
  window_from: string;
  reports: StormReportRow[];
  by_county: StormCountyRow[];
  buildings_flagged: number;
  /** Flagged buildings per state ("KY" is everything not marked "TN", as the list counts). */
  flagged_by_state: Record<string, number>;
}

/** The window's reports, rolled up by county, plus how many buildings are flagged. */
export const stormSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StormSummary> => {
    await readAccess(context);
    const sb = context.supabase;
    const { data: settings, error: sErr } = await sb
      .from("storm_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (sErr) throw new Error(sErr.message);
    const from = stormWindowFrom(settings.window_days);
    const [{ data: reports, error }, { count, error: cErr }] = await Promise.all([
      sb
        .from("storm_reports")
        .select("*")
        .gte("report_date", from)
        .order("report_date", { ascending: false })
        .order("magnitude", { ascending: false, nullsFirst: false })
        .limit(2000),
      sb
        .from("buildings")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .not("last_storm_at", "is", null),
    ]);
    if (error) throw new Error(error.message);
    if (cErr) throw new Error(cErr.message);
    const rows = reports ?? [];
    // Buildings hit per county and state come from the flagged buildings themselves; a failure
    // is an error, not a row of zeros.
    const { data: hitCounties, error: hErr } = await sb.rpc("building_county_counts_storm");
    if (hErr) throw new Error(hErr.message);
    const hitBy = new Map<string, number>();
    const flaggedByState: Record<string, number> = {};
    for (const r of hitCounties ?? []) {
      const st = r.state === "TN" ? "TN" : "KY";
      hitBy.set(`${r.county}|${st}`, Number(r.n));
      flaggedByState[st] = (flaggedByState[st] ?? 0) + Number(r.n);
    }
    // Grouped by county AND state: Lawrence County, KY and Lawrence County, TN are two chips.
    const by = new Map<string, StormCountyRow>();
    for (const r of rows) {
      const c = r.county ?? "(unknown)";
      const st = r.state === "TN" ? "TN" : "KY";
      const id = `${c}|${st}`;
      const row = by.get(id) ?? {
        county: c,
        state: st,
        key: countyKeyFor(c, st),
        label: countyLabelFor(c, st),
        reports: 0,
        hail: 0,
        wind: 0,
        tornado: 0,
        max_hail_in: null,
        max_wind_mph: null,
        latest: r.report_date,
        buildings_hit: hitBy.get(id) ?? 0,
      };
      row.reports++;
      if (r.kind === "hail") {
        row.hail++;
        if (r.magnitude != null && (row.max_hail_in ?? 0) < r.magnitude)
          row.max_hail_in = r.magnitude;
      } else if (r.kind === "wind") {
        row.wind++;
        if (r.magnitude != null && (row.max_wind_mph ?? 0) < r.magnitude)
          row.max_wind_mph = r.magnitude;
      } else row.tornado++;
      if (r.report_date > row.latest) row.latest = r.report_date;
      by.set(id, row);
    }
    return {
      settings,
      window_from: from,
      reports: rows,
      by_county: [...by.values()].sort(
        (a, b) => b.buildings_hit - a.buildings_hit || b.reports - a.reports,
      ),
      buildings_flagged: count ?? 0,
      flagged_by_state: flaggedByState,
    };
  });

/**
 * The reports that flag one building now, nearest first: in the window (the panel's first day)
 * and still clearing today's thresholds and radius. Older hits stay stored until the 30-day
 * prune, and a tightened setting leaves hits that no longer count.
 */
export const buildingStormHits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ building_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<(StormReportRow & { distance_mi: number })[]> => {
    await readAccess(context);
    const { data: settings, error: sErr } = await context.supabase
      .from("storm_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (sErr) throw new Error(sErr.message);
    const from = stormWindowFrom(settings.window_days);
    const { data: hits, error } = await context.supabase
      .from("building_storm_hits")
      .select("distance_mi, storm_reports!inner(*)")
      .eq("building_id", data.building_id)
      .gte("storm_reports.report_date", from)
      .order("distance_mi")
      .limit(50);
    if (error) throw new Error(error.message);
    return (hits ?? [])
      .filter((h) => h.storm_reports)
      .map((h) => ({ ...(h.storm_reports as StormReportRow), distance_mi: Number(h.distance_mi) }))
      .filter((h) => h.report_date >= from && stormHitQualifies(settings, h, h.distance_mi));
  });

export const getStormSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StormSettingsRow> => {
    await readAccess(context);
    const { data, error } = await context.supabase
      .from("storm_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

const settingsSchema = z.object({
  window_days: z.number().int().min(1).max(30),
  min_hail_in: z.number().min(0).max(10),
  min_wind_mph: z.number().min(0).max(200),
  hail_radius_mi: z.number().min(0.25).max(25),
  wind_radius_mi: z.number().min(0.25).max(25),
  tornado_radius_mi: z.number().min(0.25).max(25),
});
export type StormSettingsInput = z.input<typeof settingsSchema>;
export const setStormSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await adminOnly(context);
    const { error } = await context.supabase
      .from("storm_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
  });
