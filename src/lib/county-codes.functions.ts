/**
 * JBK county codes (src/lib/county-codes.ts). Any signed-in user reads the list (the site form,
 * the ticket); admins and Estimate Pricing add, edit and delete codes (Settings › General ›
 * County codes). RLS enforces the same (migration 20261001010000_county_codes.sql).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { assertPageAccess } from "@/lib/auth.functions";
import { compareCountyCodes, countyCodeLabel } from "@/lib/county-codes";

export type CountyCode = Database["public"]["Tables"]["county_codes"]["Row"];

/** Every code, sorted state, then county, then code. */
export const listCountyCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CountyCode[]> => {
    const { data, error } = await context.supabase
      .from("county_codes")
      .select("*")
      .order("state")
      .order("county")
      .order("code");
    if (error) throw new Error(error.message);
    return [...(data ?? [])].sort(compareCountyCodes);
  });

export const countyCodeSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, "The code is required").max(20),
  county: z.string().trim().min(1, "The county is required").max(80),
  state: z.enum(["KY", "TN"], { message: "The state is KY or TN" }),
});
export type CountyCodeInput = z.input<typeof countyCodeSchema>;

/** Add (no id) or edit a code. The same code, county and state twice is refused. */
export const saveCountyCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => countyCodeSchema.parse(d))
  .handler(async ({ data, context }): Promise<CountyCode> => {
    await assertPageAccess(context.supabase, context.userId, "pricing");
    const sb = context.supabase;
    const { id, ...fields } = data;
    const { data: same, error: sameErr } = await sb
      .from("county_codes")
      .select("id, county")
      .eq("code", fields.code)
      .eq("state", fields.state);
    if (sameErr) throw new Error(sameErr.message);
    if (
      (same ?? []).some(
        (r) => r.id !== id && r.county.toLowerCase() === fields.county.toLowerCase(),
      )
    )
      throw new Error(`${countyCodeLabel(fields)} is already on the list`);
    if (id) {
      const { data: row, error } = await sb
        .from("county_codes")
        .update(fields)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await sb.from("county_codes").insert(fields).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Delete a code no site uses. A code in use is refused with the count of sites. */
export const deleteCountyCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPageAccess(context.supabase, context.userId, "pricing");
    const sb = context.supabase;
    // Every site, removed ones too, whatever the caller may read (the foreign key would clear
    // their code all the same).
    const { data: count, error: countErr } = await sb.rpc("county_code_site_count", {
      p_id: data.id,
    });
    if (countErr) throw new Error(countErr.message);
    const message = countyCodeInUseMessage(count ?? 0);
    if (message) throw new Error(message);
    const { error } = await sb.from("county_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Why a code cannot be deleted, or null when no site uses it. */
export function countyCodeInUseMessage(siteCount: number): string | null {
  if (siteCount <= 0) return null;
  return `In use on ${siteCount} site${siteCount === 1 ? "" : "s"} — change those sites first`;
}
