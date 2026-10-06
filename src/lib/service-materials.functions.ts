/**
 * Setup › Material pricing (owner, Oct 6): the service material price list — name, unit and cost
 * a repair ticket bills from (cost × (1 + markup)); src/lib/service-materials.ts has the rules.
 * Money, so an admin's or a manager's, like Service rates. A material is hidden, never deleted
 * (tickets and stock may name it). The stock link is set by the import, not here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess, managesTickets } from "@/lib/access";
import type { ServiceMaterial } from "@/lib/service-materials";
import { loadServiceMaterialLinks, loadServiceMaterials } from "@/lib/service-materials.server";

export const MATERIALS_NOT_SET_UP =
  "Material pricing is not set up in the database yet (apply 20261006130000_service_materials.sql)";
export const NAME_TAKEN = (name: string) => `Two materials are called "${name}" — rename one`;

async function pricingManager(ctx: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!managesTickets(data)) throw new Error("Material pricing is a manager's");
  return data;
}

/** The list with costs and the markup (Setup › Material pricing). */
export const listServiceMaterials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ items: ServiceMaterial[]; markup: number }> => {
    await pricingManager(context);
    const [items, { data: settings }] = await Promise.all([
      loadServiceMaterials(context.supabase),
      context.supabase.from("service_settings").select("material_markup").eq("id", 1).maybeSingle(),
    ]);
    return { items, markup: Number(settings?.material_markup ?? 0.75) };
  });

/**
 * The names only (no cost): what the Inventory page adds to its product search so a service
 * material without a bid-catalog twin can be put on the shelf or a truck. Inventory, Service or
 * Estimate access.
 */
export const listServiceMaterialNames = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("role, access, technician")
      .eq("id", context.userId)
      .maybeSingle();
    if (
      !me ||
      !(canAccess(me, "inventory") || canAccess(me, "service") || canAccess(me, "estimate"))
    )
      return [];
    return loadServiceMaterialLinks(context.supabase);
  });

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  unit: z.string().trim().min(1).max(30),
  cost: z.number().finite().min(0).max(1_000_000),
  active: z.boolean(),
  /** Inventory group for a material with no bid-catalog twin (Underlayment, Sealants …). */
  category: z.string().trim().max(80).nullable().optional(),
});
export type ServiceMaterialInput = z.input<typeof itemSchema>;

/** Save the list: changed rows update, rows without an id are added (at the end). */
export const saveServiceMaterials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ items: z.array(itemSchema).max(2000) }).parse(d))
  .handler(async ({ data, context }): Promise<ServiceMaterial[]> => {
    await pricingManager(context);
    const sb = context.supabase;
    const current = await loadServiceMaterials(sb);
    const { error: probe } = await sb.from("service_materials").select("id").limit(1);
    if (probe) throw new Error(MATERIALS_NOT_SET_UP);
    const byId = new Map(current.map((m) => [m.id, m]));
    // A material with no bid-catalog twin is stocked under its name: one per name.
    const own = new Map<string, number>();
    for (const it of data.items) {
      const linked = it.id ? !!byId.get(it.id)?.stock_screen_id : false;
      if (linked) continue;
      own.set(it.name, (own.get(it.name) ?? 0) + 1);
    }
    for (const [name, n] of own) if (n > 1) throw new Error(NAME_TAKEN(name));
    let sort = current.reduce((m, r) => Math.max(m, r.sort), -1) + 1;
    for (const it of data.items) {
      const was = it.id ? byId.get(it.id) : undefined;
      if (it.id && !was) throw new Error("That material is no longer on the list — reload");
      if (was) {
        if (
          was.name === it.name &&
          was.unit === it.unit &&
          Number(was.cost) === it.cost &&
          was.active === it.active &&
          (was.category ?? null) === (it.category ?? null)
        )
          continue;
        const { error } = await sb
          .from("service_materials")
          .update({
            name: it.name,
            unit: it.unit,
            cost: it.cost,
            active: it.active,
            category: it.category ?? null,
          })
          .eq("id", was.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await sb.from("service_materials").insert({
          name: it.name,
          unit: it.unit,
          cost: it.cost,
          active: it.active,
          category: it.category ?? null,
          sort: sort++,
        });
        if (error) throw new Error(error.message);
      }
    }
    return loadServiceMaterials(sb);
  });
