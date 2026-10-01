/**
 * Lead sources (src/lib/lead-sources.ts). Any signed-in user reads the list; anyone who saves
 * opportunities (Customers access) adds a name from the opportunity form; admins and Estimate
 * Pricing rename, reorder and delete (Settings › General › Lead sources). RLS enforces the same
 * (migration 20261001020000_opportunity_site_lead_sources.sql).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import { assertPageAccess } from "@/lib/auth.functions";
import {
  cleanLeadSourceName,
  compareLeadSources,
  findLeadSource,
  leadSourceInUseMessage,
  nextLeadSourceSort,
} from "@/lib/lead-sources";

export type LeadSource = Database["public"]["Tables"]["lead_sources"]["Row"];

const nameField = z
  .string()
  .transform(cleanLeadSourceName)
  .pipe(z.string().min(1, "The lead source needs a name").max(120));

export const leadSourceSchema = z.object({
  id: z.string().uuid().optional(),
  name: nameField,
  sort: z.number().int().min(0).max(100000).optional(),
});
export type LeadSourceInput = z.input<typeof leadSourceSchema>;

async function readAll(sb: Parameters<typeof assertPageAccess>[0]): Promise<LeadSource[]> {
  const { data, error } = await sb.from("lead_sources").select("*").order("sort").order("name");
  if (error) throw new Error(error.message);
  return [...(data ?? [])].sort(compareLeadSources);
}

/** Every lead source, in list order (sort, then name). */
export const listLeadSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeadSource[]> => readAll(context.supabase));

/**
 * Type-to-add from the opportunity form: the same access that saves an opportunity (Customers;
 * admins and Estimate Pricing too). A name already on the list in any case comes back as it is.
 */
export const addLeadSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ name: nameField }).parse(d))
  .handler(async ({ data, context }): Promise<LeadSource> => {
    const sb = context.supabase;
    const { data: p } = await sb
      .from("profiles")
      .select("role, access")
      .eq("id", context.userId)
      .maybeSingle();
    if (!canAccess(p, "customers") && !canAccess(p, "pricing"))
      throw new Error("Forbidden: Customers access required");
    const all = await readAll(sb);
    const existing = findLeadSource(all, data.name);
    if (existing) return existing;
    const { data: row, error } = await sb
      .from("lead_sources")
      .insert({ name: data.name, sort: nextLeadSourceSort(all) })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Settings: add (no id) or rename / reorder. A rename also changes the opportunities that carry
 * the old name (rename_lead_source). The same name twice, in any case, is refused.
 */
export const saveLeadSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => leadSourceSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ row: LeadSource; renamed: number }> => {
    await assertPageAccess(context.supabase, context.userId, "pricing");
    const sb = context.supabase;
    const all = await readAll(sb);
    const clash = findLeadSource(all, data.name);
    if (clash && clash.id !== data.id) throw new Error(`${clash.name} is already on the list`);
    if (!data.id) {
      const { data: row, error } = await sb
        .from("lead_sources")
        .insert({ name: data.name, sort: data.sort ?? nextLeadSourceSort(all) })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { row, renamed: 0 };
    }
    const before = all.find((r) => r.id === data.id);
    if (!before) throw new Error("Lead source not found");
    let renamed = 0;
    if (before.name !== data.name) {
      const { data: n, error } = await sb.rpc("rename_lead_source", {
        p_id: data.id,
        p_name: data.name,
      });
      if (error) throw new Error(error.message);
      renamed = n ?? 0;
    }
    const { data: row, error } = await sb
      .from("lead_sources")
      .update({ sort: data.sort ?? before.sort })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { row, renamed };
  });

/** Delete a lead source no opportunity uses. One in use is refused with the count. */
export const deleteLeadSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPageAccess(context.supabase, context.userId, "pricing");
    const sb = context.supabase;
    const { data: row, error: rowErr } = await sb
      .from("lead_sources")
      .select("name")
      .eq("id", data.id)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row) throw new Error("Lead source not found");
    // Every live opportunity, whatever the caller may read.
    const { data: count, error: countErr } = await sb.rpc("lead_source_use_count", {
      p_name: row.name,
    });
    if (countErr) throw new Error(countErr.message);
    const message = leadSourceInUseMessage(count ?? 0);
    if (message) throw new Error(message);
    const { error } = await sb.from("lead_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
