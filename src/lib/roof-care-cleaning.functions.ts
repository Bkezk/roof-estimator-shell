/**
 * The cleaning at a plan's inspection, and the budget forecast — the server side
 * (roof-care-cleaning.ts has the rules). The database decides who may answer:
 * roof_care_set_cleaning() and roof_care_forecast_sent().
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { cleaningAsked, cleaningProblem, type VisitCleaning } from "@/lib/roof-care-cleaning";
import { asPlanKey, VISIT_KINDS, type VisitKind } from "@/lib/roof-care-plan";

type Sb = SupabaseClient<Database>;

type CleaningRow = {
  id: string;
  kind: string;
  plan: unknown;
  drains_cleaned: boolean | null;
  gutters_cleaned: boolean | null;
  cleaning_note: string | null;
  cleaning_by_name: string | null;
  cleaning_at: string | null;
};

/**
 * An inspection the plan tables did not answer for (Nov 20: they no longer answer a
 * technician). The database's own function gives its answers to whoever may work at the
 * property, and nothing of the plan's money.
 */
async function fieldCleaning(sb: Sb, visitId: string): Promise<CleaningRow | null> {
  const { data, error } = await sb.rpc("roof_care_field_cleaning", { p_visit: visitId });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  if (typeof r["id"] !== "string" || typeof r["kind"] !== "string") return null;
  const yesNo = (v: unknown) => (typeof v === "boolean" ? v : null);
  const words = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: r["id"],
    kind: r["kind"],
    plan: r["plan"],
    drains_cleaned: yesNo(r["drains_cleaned"]),
    gutters_cleaned: yesNo(r["gutters_cleaned"]),
    cleaning_note: words(r["cleaning_note"]),
    cleaning_by_name: words(r["cleaning_by_name"]),
    cleaning_at: words(r["cleaning_at"]),
  };
}

/** One inspection's answers; null when it is not a plan's inspection the reader can see. */
export async function readVisitCleaning(sb: Sb, visitId: string): Promise<VisitCleaning | null> {
  const { data: own, error } = await sb
    .from("roof_care_visits")
    .select(
      "id, plan_id, kind, drains_cleaned, gutters_cleaned, cleaning_note, cleaning_by_name, cleaning_at",
    )
    .eq("id", visitId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  let v: CleaningRow | null = null;
  if (own) {
    const { data: p, error: pErr } = await sb
      .from("roof_care_plans")
      .select("plan")
      .eq("id", own.plan_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    v = { ...own, plan: p?.plan };
  } else v = await fieldCleaning(sb, visitId);
  if (!v) return null;
  const plan = asPlanKey(v.plan);
  const kind = (VISIT_KINDS as readonly string[]).includes(v.kind) ? (v.kind as VisitKind) : null;
  if (!plan || !kind) return null;
  return {
    visit_id: v.id,
    plan,
    kind,
    asked: cleaningAsked(plan, kind),
    drains: v.drains_cleaned ?? null,
    gutters: v.gutters_cleaned ?? null,
    note: v.cleaning_note ?? null,
    by_name: v.cleaning_by_name ?? null,
    at: v.cleaning_at ?? null,
  };
}

export const roofCareCleaning = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ visit_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VisitCleaning | null> =>
    readVisitCleaning(context.supabase, data.visit_id),
  );

/**
 * Answer one or both. A key left out is left as it is. A No needs `note`. Returns the
 * inspection's answers as they now stand.
 */
export const setRoofCareCleaning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        visit_id: z.string().uuid(),
        drains: z.boolean().nullable().optional(),
        gutters: z.boolean().nullable().optional(),
        note: z.string().trim().max(300).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<VisitCleaning> => {
    const sb = context.supabase;
    const now = await readVisitCleaning(sb, data.visit_id);
    if (!now) throw new Error("That inspection was not found");
    const problem = cleaningProblem(now, data);
    if (problem) throw new Error(problem);
    const { error } = await sb.rpc("roof_care_set_cleaning", {
      p_visit: data.visit_id,
      ...(typeof data.drains === "boolean" ? { p_drains: data.drains } : {}),
      ...(typeof data.gutters === "boolean" ? { p_gutters: data.gutters } : {}),
      ...(data.note != null ? { p_note: data.note } : {}),
    });
    if (error) throw new Error(error.message);
    const after = await readVisitCleaning(sb, data.visit_id);
    if (!after) throw new Error("The answer was saved, but it could not be read back");
    return after;
  });

/** The office marks Roof Guard's yearly budget forecast sent, or takes the mark off. */
export const markRoofCareForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ plan_id: z.string().uuid(), sent: z.boolean().default(true) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("roof_care_forecast_sent", {
      p_plan: data.plan_id,
      p_sent: data.sent,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
