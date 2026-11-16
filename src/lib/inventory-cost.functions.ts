/**
 * Inventory › cost, the server side (owner, Nov 16: "Go with all 6"): what the cost rules
 * (inventory-cost.ts) are fed, the year summary, and a manager typing the price paid on an entry.
 *
 * Dollars in inventory are an admin's and a manager's (owner, Oct 15): every function here that
 * answers with money checks seesEveryone first, and the price table (inventory_movement_costs)
 * refuses everyone else by its own policy, whatever this file does. Everything is read under the
 * caller's own rights. The price table and the count tables are not in the generated database
 * types (Lovable's to regenerate), so they are read through a loose client and checked here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { seesEveryone } from "@/lib/access";
import type { StoredPrice } from "@/lib/inventory-cost";
import { readAllMovements } from "@/lib/inventory-reconcile.functions";
import { buildYearEnd, type NamedMovement, type YearEnd } from "@/lib/inventory-year-end";
import { categories, pieceDefsForCells, PRICE_IS_MANAGERS } from "@/lib/inventory.functions";
import {
  materialForCell,
  materialsByCell,
  packCostFor,
  serviceLabel,
  type Cell,
} from "@/lib/service-materials";
import { loadServiceMaterialLinks, loadServiceMaterials } from "@/lib/service-materials.server";

type Client = SupabaseClient<Database>;
/** The tables the generated types do not know yet. */
export const looseClient = (sb: Client): SupabaseClient => sb as unknown as SupabaseClient;

export const MANAGERS_ONLY = "Admins and managers only";

const PAGE = 1000;

/** Every stored price, by entry (PostgREST answers 1,000 rows a request, so by page). */
export async function readPrices(sb: Client): Promise<Map<number, StoredPrice>> {
  const out = new Map<number, StoredPrice>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await looseClient(sb)
      .from("inventory_movement_costs")
      .select("movement_id, unit_cost, source")
      .order("movement_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      const id = Number(r["movement_id"]);
      const cost = Number(r["unit_cost"]);
      if (Number.isFinite(id) && Number.isFinite(cost) && cost >= 0)
        out.set(id, { unit_cost: cost, source: String(r["source"] ?? "paid") });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * The Setup cost of ONE STOCK UNIT of a cell: the service material's cost (per piece, as
 * CenterPoint lists it) times the pieces in a pack, the Export dialog's rule since Oct 15. Null
 * when no service material prices the cell.
 */
export async function readSetupCost(
  sb: Client,
  cells: readonly Cell[],
): Promise<(cell: Cell) => number | null> {
  const [materials, pieceFor] = await Promise.all([
    loadServiceMaterials(sb),
    pieceDefsForCells(sb, cells),
  ]);
  const byCell = materialsByCell(materials);
  return (cell) => {
    const m = materialForCell(byCell, cell);
    return m && Number.isFinite(m.cost) ? packCostFor(m.cost, pieceFor(cell)) : null;
  };
}

export interface CostContext {
  movements: NamedMovement[];
  prices: Map<number, StoredPrice>;
  setupCost: (cell: Cell) => number | null;
  locations: { id: string; name: string; sort: number }[];
}

/**
 * Everything the cost rules read: the whole ledger (named and categorised as the History tab
 * names it, each time as a plain ISO instant so two of them compare as text), the stored prices,
 * the Setup costs and the places.
 */
export async function readCostContext(sb: Client): Promise<CostContext> {
  const [all, cats, links, prices, { data: locs, error: lErr }] = await Promise.all([
    readAllMovements(sb),
    categories(sb),
    loadServiceMaterialLinks(sb),
    readPrices(sb),
    // Every place, active or not: an entry on a retired vehicle still needs its name.
    sb.from("inventory_locations").select("id, name, sort"),
  ]);
  if (lErr) throw new Error(lErr.message);
  const byMaterial = materialsByCell(links);
  const movements: NamedMovement[] = all.map((m) => ({
    ...m,
    qty: Number(m.qty),
    created_at: new Date(m.created_at).toISOString(),
    category: cats(m.screen_id, m.row_label),
    label: serviceLabel(byMaterial, m),
  }));
  return {
    movements,
    prices,
    setupCost: await readSetupCost(sb, movements),
    locations: (locs ?? []).map((l) => ({ id: l.id, name: l.name, sort: Number(l.sort ?? 0) })),
  };
}

/** Is the caller an admin or a manager? */
export async function isManagerOrAdmin(sb: Client, userId: string): Promise<boolean> {
  const { data: me } = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
  return seesEveryone(me);
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** PostgREST `in` lists go in the URL; a few hundred ids per request keeps it short. */
const CHUNK = 200;

/** The year summary with the purchase orders of each unpriced entry's ticket beside it. */
export async function readYearEnd(sb: Client, from: string, to: string): Promise<YearEnd> {
  const ctx = await readCostContext(sb);
  const year = buildYearEnd({ ...ctx, from, to });
  const jobIds = [
    ...new Set(year.unpriced.map((u) => u.service_job_id).filter((x): x is string => !!x)),
  ];
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const { data, error } = await sb
      .from("service_job_purchase_orders")
      .select("service_job_id, po_number, vendor_text, title, price, po_date")
      .in("service_job_id", jobIds.slice(i, i + CHUNK))
      .order("po_date");
    if (error) throw new Error(error.message);
    for (const po of data ?? [])
      for (const u of year.unpriced)
        if (u.service_job_id === po.service_job_id)
          u.pos.push({
            po_number: po.po_number,
            vendor: po.vendor_text ?? po.title ?? "",
            price: Number(po.price),
            po_date: po.po_date,
          });
  }
  return year;
}

/** Inventory › Year end: the summary for a From..To of office days. Admins and managers. */
export const getYearEnd = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ from: ymd, to: ymd }).parse(d))
  .handler(async ({ data, context }): Promise<YearEnd> => {
    if (!(await isManagerOrAdmin(context.supabase, context.userId))) throw new Error(MANAGERS_ONLY);
    return readYearEnd(context.supabase, data.from, data.to);
  });

export const priceSchema = z.object({
  movement_id: z.number().int().positive(),
  /** Per stock unit; null takes the price off again. */
  unit_cost: z.number().finite().min(0).max(1_000_000).nullable(),
});

/**
 * Type (or take off) the price paid on an entry that brought stock in. Every number that
 * followed from the entry is worked out again from the ledger, so nothing else is written.
 */
export const setEntryPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => priceSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sb = context.supabase;
    const { data: me } = await sb
      .from("profiles")
      .select("role, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    if (!seesEveryone(me)) throw new Error(PRICE_IS_MANAGERS);
    const { data: entry, error } = await sb
      .from("inventory_movements")
      .select("id, qty, reason")
      .eq("id", data.movement_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!entry) throw new Error("That entry was not found");
    if (!(Number(entry.qty) > 0)) throw new Error("A price paid goes on stock coming in");
    if (entry.reason === "transfer_in")
      throw new Error("A move between places keeps the cost the stock already had");
    const costs = looseClient(sb).from("inventory_movement_costs");
    if (data.unit_cost == null) {
      const { error: dErr } = await costs.delete().eq("movement_id", data.movement_id);
      if (dErr) throw new Error(dErr.message);
      return { ok: true };
    }
    const { error: uErr } = await costs.upsert(
      {
        movement_id: data.movement_id,
        unit_cost: data.unit_cost,
        source: "set",
        set_by: context.userId,
        set_by_name: me?.full_name?.trim() || me?.email || null,
        set_at: new Date().toISOString(),
      },
      { onConflict: "movement_id" },
    );
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });
