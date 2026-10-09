/**
 * Inventory › Reconcile (owner, Oct 9): the report behind the managers' card — which cells are
 * below zero and where that came from, the picked week's "Short:" entries and fixes
 * (inventory-reconcile.ts) — for admins and managers only, the people who fix counts. The ledger
 * and the locations are read under the caller's own RLS (every signed-in user may read the ledger:
 * listStock sums it for the page). Setting a count is not here: the card records an ordinary
 * `adjustment` through addMovement (inventory.functions.ts), which keeps its own rule.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { seesEveryone } from "@/lib/access";
import {
  buildReconciliation,
  reconcileWindow,
  type ReconcileMovement,
  type Reconciliation,
} from "@/lib/inventory-reconcile";

/**
 * The whole ledger, oldest first: a cell's first-below-zero may be older than any week, and
 * PostgREST answers at most 1,000 rows per request whatever .limit() asks, so read by page.
 */
const PAGE = 1000;
export async function readAllMovements(sb: SupabaseClient<Database>): Promise<ReconcileMovement[]> {
  const out: ReconcileMovement[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("inventory_movements")
      .select(
        "id, location_id, screen_id, row_label, price_col, qty, unit, reason, service_job_id, service_job_name, note, created_by_name, created_at",
      )
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows.map((r) => ({ ...r, qty: Number(r.qty) })));
    if (rows.length < PAGE) break;
  }
  return out;
}

export const getReconciliation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        /** Any day (YYYY-MM-DD) of the week wanted; its Monday–Sunday is used. Default: this week. */
        weekStart: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<Reconciliation> => {
    const sb = context.supabase;
    const { data: me } = await sb
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!seesEveryone(me)) throw new Error("Forbidden: admins and managers only");
    const [movements, { data: locs, error: lErr }] = await Promise.all([
      readAllMovements(sb),
      // Every location, active or not: an entry on a retired vehicle still needs its name.
      sb.from("inventory_locations").select("id, name"),
    ]);
    if (lErr) throw new Error(lErr.message);
    return buildReconciliation({
      movements,
      locations: (locs ?? []).map((l) => ({ id: l.id, name: l.name })),
      ...reconcileWindow(data.weekStart ?? null),
    });
  });
