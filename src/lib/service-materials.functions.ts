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

export const MATERIALS_NOT_SET_UP = "Material pricing is not set up yet. Ask an admin.";
export const NAME_TAKEN = (name: string) => `Two materials are called "${name}" — rename one`;

async function pricingManager(ctx: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!managesTickets(data)) throw new Error("Only a manager changes material pricing");
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

/**
 * The sort of the first of `adding` materials added now: above the first row (min − adding; the
 * column is a plain integer, negatives are fine), the rest counting up to min − 1, so the rows
 * the screen put at the top stay at the top, in their order, after the save (owner, Oct 6, QA
 * audit: it was max + 1 and the new material jumped to the bottom). An empty list starts at 0.
 * Pure: tested in material-add-top.test.ts.
 */
export function newMaterialSort(current: readonly { sort: number }[], adding = 1): number {
  if (!current.length) return 0;
  return current.reduce((m, r) => Math.min(m, r.sort), Infinity) - Math.max(1, adding);
}

/** Save the list: changed rows update, rows without an id are added (at the top, in order). */
/** A row save_service_materials writes (an update names its id; an insert carries its sort). */
interface MaterialWrite {
  id?: string;
  name: string;
  unit: string;
  cost: number;
  active: boolean;
  category: string | null;
}

export const saveServiceMaterials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        items: z.array(itemSchema).max(2000),
        /** The default material markup (0.75 = 75 %), moved here from Service rates (Oct 6). */
        markup: z.number().min(0).max(10).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceMaterial[]> => {
    await pricingManager(context);
    const sb = context.supabase;
    const current = await loadServiceMaterials(sb);
    const { error: probe } = await sb.from("service_materials").select("id").limit(1);
    if (probe) throw new Error(MATERIALS_NOT_SET_UP);
    const byId = new Map(current.map((m) => [m.id, m]));
    // A material with no bid-catalog twin is stocked under its name: one per name. The page
    // sends only the rows that changed (Nov 4), so the rows it left out count too.
    const sent = new Set(data.items.map((it) => it.id).filter((id): id is string => !!id));
    const own = new Map<string, number>();
    for (const m of current)
      if (!m.stock_screen_id && !sent.has(m.id)) own.set(m.name, (own.get(m.name) ?? 0) + 1);
    for (const it of data.items) {
      const linked = it.id ? !!byId.get(it.id)?.stock_screen_id : false;
      if (linked) continue;
      own.set(it.name, (own.get(it.name) ?? 0) + 1);
    }
    for (const [name, n] of own) if (n > 1) throw new Error(NAME_TAKEN(name));
    let sort = newMaterialSort(current, data.items.filter((it) => !it.id).length);
    const updates: MaterialWrite[] = [];
    const inserts: (MaterialWrite & { sort: number })[] = [];
    for (const it of data.items) {
      const was = it.id ? byId.get(it.id) : undefined;
      if (it.id && !was) throw new Error("That material is no longer on the list — reload");
      const row = {
        name: it.name,
        unit: it.unit,
        cost: it.cost,
        active: it.active,
        category: it.category ?? null,
      };
      if (was) {
        if (
          was.name === it.name &&
          was.unit === it.unit &&
          Number(was.cost) === it.cost &&
          was.active === it.active &&
          (was.category ?? null) === (it.category ?? null)
        )
          continue;
        updates.push({ id: was.id, ...row });
      } else {
        inserts.push({ ...row, sort: sort++ });
      }
    }
    // One transaction for the whole list and the markup (Nov 4, bug 12 of the Nov 3 review):
    // row-by-row writes left half the list saved when one failed. save_service_materials
    // (20261104120000) is not in the generated types yet, so the call is through a loose client.
    if (updates.length || inserts.length || data.markup !== undefined) {
      const { error } = await (sb as unknown as SupabaseClient).rpc("save_service_materials", {
        p_updates: updates,
        p_inserts: inserts,
        p_markup: data.markup ?? null,
      });
      if (error) throw new Error(error.message);
    }
    return loadServiceMaterials(sb);
  });
