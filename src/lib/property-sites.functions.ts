/**
 * Sites inside a property (owner, Oct 6: properties "should have a sites form that can be added";
 * CenterPoint told them apart by the ticket's description). Named places at one property — a
 * branch, a building — that a ticket can name (service_jobs.location_id). Customers or Service
 * access writes them, as the property itself. A removed site is hidden, never deleted: tickets
 * keep its name. Before 20261006170000_property_sites.sql is applied the list reads as empty.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import { isMissingTable } from "@/lib/warranty";

export type PropertySiteRow = Database["public"]["Tables"]["property_sites"]["Row"];
export const SITES_NOT_SET_UP =
  "Sites are not set up in the database yet (apply 20261006170000_property_sites.sql)";
export const SITE_NAME_TWICE = (n: string) => `Two sites are called "${n}" — rename one`;

/** A property's sites, in order (the hidden ones left out). */
export const listPropertySites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ property_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PropertySiteRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("property_sites")
      .select("*")
      .eq("property_id", data.property_id)
      .is("deleted_at", null)
      .order("sort")
      .order("name");
    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(error.message);
    }
    return rows ?? [];
  });

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Every site needs a name").max(120),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .transform((v) => v || null),
});
export type PropertySiteInput = z.input<typeof itemSchema>;

/** Save a property's sites: kept ones update, new ones are added, missing ones are hidden. */
export const savePropertySites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ property_id: z.string().uuid(), items: z.array(itemSchema).max(200) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PropertySiteRow[]> => {
    const sb = context.supabase;
    const { data: me } = await sb
      .from("profiles")
      .select("role, access, technician")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me || !(canAccess(me, "customers") || canAccess(me, "service")))
      throw new Error("Forbidden: Customers or Service access required");
    const seen = new Set<string>();
    for (const it of data.items) {
      const k = it.name.toLowerCase();
      if (seen.has(k)) throw new Error(SITE_NAME_TWICE(it.name));
      seen.add(k);
    }
    const { data: current, error } = await sb
      .from("property_sites")
      .select("*")
      .eq("property_id", data.property_id)
      .is("deleted_at", null);
    if (error) throw new Error(isMissingTable(error) ? SITES_NOT_SET_UP : error.message);
    const byId = new Map((current ?? []).map((r) => [r.id, r]));
    const kept = new Set<string>();
    for (const [i, it] of data.items.entries()) {
      const was = it.id ? byId.get(it.id) : undefined;
      if (it.id && !was) throw new Error("That site is no longer on the list — reload");
      if (was) {
        kept.add(was.id);
        if (was.name === it.name && (was.notes ?? null) === it.notes && was.sort === i) continue;
        const { error: uErr } = await sb
          .from("property_sites")
          .update({ name: it.name, notes: it.notes, sort: i })
          .eq("id", was.id);
        if (uErr) throw new Error(uErr.message);
      } else {
        const { error: iErr } = await sb.from("property_sites").insert({
          property_id: data.property_id,
          name: it.name,
          notes: it.notes,
          sort: i,
        });
        if (iErr) throw new Error(iErr.message);
      }
    }
    const gone = (current ?? []).filter((r) => !kept.has(r.id)).map((r) => r.id);
    if (gone.length) {
      const { error: dErr } = await sb
        .from("property_sites")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", gone);
      if (dErr) throw new Error(dErr.message);
    }
    const { data: rows, error: rErr } = await sb
      .from("property_sites")
      .select("*")
      .eq("property_id", data.property_id)
      .is("deleted_at", null)
      .order("sort");
    if (rErr) throw new Error(rErr.message);
    return rows ?? [];
  });
