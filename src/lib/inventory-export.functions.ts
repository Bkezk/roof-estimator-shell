/**
 * Inventory › Export (owner, Oct 15): the server side of the Export dialog — one call, one CSV.
 * Admins and managers only (seesEveryone, the gate of the History and Reconcile tabs); the rules
 * and the row builders are inventory-export.ts. Everything is read under the caller's own RLS:
 * the ledger (every signed-in user may read it), the locations, the tickets with their customer
 * and site (office and managers read service_jobs / crm_accounts / crm_sites), and — only when
 * "Include value in dollars" is ticked — what the cost rules read (inventory-cost.functions.ts
 * readCostContext, Nov 16: the prices paid, which only admins and managers read, and
 * service_materials.cost as the stand-in for an entry with no price). Stock on hand as of today
 * is readStock, the same aggregation the Inventory page shows; as of a past day it is the ledger
 * summed up to the end of that day.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { seesEveryone } from "@/lib/access";
import { easternYmd } from "@/lib/field-day";
import {
  buildMovementRows,
  buildStockRows,
  buildUsageRows,
  EXPORT_REPORTS,
  exportFileName,
  exportWindow,
  type ExportJob,
  type ExportLocation,
  type ExportMovement,
  type ExportReport,
} from "@/lib/inventory-export";
import { cellKeyOf, replayLedger } from "@/lib/inventory-cost";
import { readCostContext, readYearEnd } from "@/lib/inventory-cost.functions";
import { readAllMovements } from "@/lib/inventory-reconcile.functions";
import { buildYearRows, endOfDay, stockAsOf } from "@/lib/inventory-year-end";
import { categories, nameStockCells, readStock } from "@/lib/inventory.functions";
import { toCsv } from "@/lib/review-export";
import { materialsByCell, serviceLabel } from "@/lib/service-materials";
import { loadServiceMaterialLinks } from "@/lib/service-materials.server";

type Client = SupabaseClient<Database>;

export const FORBIDDEN = "Admins and managers only";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const exportSchema = z.object({
  report: z.enum(EXPORT_REPORTS as [ExportReport, ...ExportReport[]]),
  from: ymd.optional(),
  to: ymd.optional(),
  /** Stock on hand: the day it is as of (office time); today when left out. Never the future. */
  as_of: ymd.optional(),
  with_value: z.boolean(),
});

export const STOCK_FUTURE = "Stock cannot be dated in the future";

export interface InventoryExport {
  csv: string;
  /** Data rows (the header not counted). */
  count: number;
  file_name: string;
}

/** Every location, active or not: an entry on a retired vehicle still needs its name. */
async function readLocations(sb: Client): Promise<ExportLocation[]> {
  const { data, error } = await sb.from("inventory_locations").select("id, name, sort");
  if (error) throw new Error(error.message);
  return (data ?? []).map((l) => ({ id: l.id, name: l.name, sort: Number(l.sort ?? 0) }));
}

/** PostgREST `in` lists go in the URL; a few hundred ids per request keeps it short. */
const CHUNK = 200;
async function inChunks<T>(ids: string[], read: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

/** The tickets the usage rows name, with their customer and site names (myDay's join by ids). */
async function readJobs(sb: Client, ids: string[]): Promise<Map<string, ExportJob>> {
  const out = new Map<string, ExportJob>();
  if (!ids.length) return out;
  const jobs = await inChunks(ids, async (part) => {
    const { data, error } = await sb
      .from("service_jobs")
      .select(
        "id, number, customer_name, site_name, account_id, site_id, scheduled_date, created_at",
      )
      .in("id", part);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const accountIds = [...new Set(jobs.map((j) => j.account_id).filter((x): x is string => !!x))];
  const siteIds = [...new Set(jobs.map((j) => j.site_id).filter((x): x is string => !!x))];
  const [accounts, sites] = await Promise.all([
    inChunks(accountIds, async (part) => {
      const { data, error } = await sb.from("crm_accounts").select("id, name").in("id", part);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
    inChunks(siteIds, async (part) => {
      const { data, error } = await sb.from("crm_sites").select("id, name").in("id", part);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  for (const j of jobs)
    out.set(j.id, {
      id: j.id,
      number: j.number ?? null,
      customer: (j.account_id ? accountName.get(j.account_id) : null) ?? j.customer_name ?? "",
      site: (j.site_id ? siteName.get(j.site_id) : null) ?? j.site_name ?? "",
      day: j.scheduled_date ?? easternYmd(new Date(j.created_at)),
    });
  return out;
}

/** The ledger in the window, named and categorised as the History tab names its rows. */
async function readWindowMovements(
  sb: Client,
  window: { since: string; until: string },
): Promise<ExportMovement[]> {
  const [all, cats, links] = await Promise.all([
    readAllMovements(sb),
    categories(sb),
    loadServiceMaterialLinks(sb),
  ]);
  const byMaterial = materialsByCell(links);
  return all
    .filter((m) => m.created_at >= window.since && m.created_at < window.until)
    .map((m) => ({
      ...m,
      category: cats(m.screen_id, m.row_label),
      label: serviceLabel(byMaterial, m),
    }));
}

/**
 * The export as a plain function (the server function below wraps it): the report's rows through
 * inventory-export.ts, then toCsv. `with_value` is the only reason service_materials is read.
 */
export async function buildInventoryExport(
  sb: Client,
  data: z.infer<typeof exportSchema>,
  now: Date = new Date(),
): Promise<InventoryExport> {
  let rows: string[][];
  if (data.report === "stock") {
    // As of a day (Nov 16): today reads the page's own sums; a past day sums the ledger up to
    // the end of it. Dollars are the item's average cost on that day (inventory-cost.ts).
    const today = easternYmd(now);
    const asOf = data.as_of ?? today;
    if (asOf > today) throw new Error(STOCK_FUTURE);
    const past = asOf < today;
    const ctx = data.with_value || past ? await readCostContext(sb) : null;
    const until = past ? endOfDay(asOf) : undefined;
    const [stock, locations] = await Promise.all([
      past && ctx ? nameStockCells(sb, stockAsOf(ctx.movements, endOfDay(asOf))) : readStock(sb),
      ctx ? ctx.locations : readLocations(sb),
    ]);
    const items = data.with_value && ctx ? replayLedger({ ...ctx, until }).items : null;
    rows = buildStockRows({
      stock,
      locations,
      avgFor: items ? (cell) => items.get(cellKeyOf(cell)) : null,
      withValue: data.with_value,
    });
  } else if (data.report === "year") {
    exportWindow(data.from ?? "", data.to ?? "");
    rows = buildYearRows(await readYearEnd(sb, data.from!, data.to!));
  } else {
    const window = exportWindow(data.from ?? "", data.to ?? "");
    // With dollars, every entry's cost comes from replaying the whole ledger (a take in the
    // window is costed by what came in before it).
    const ctx = data.with_value ? await readCostContext(sb) : null;
    const costs = ctx ? replayLedger(ctx).entries : null;
    const movements: ExportMovement[] = ctx
      ? ctx.movements
          .filter((m) => m.created_at >= window.since && m.created_at < window.until)
          .map((m) => ({
            ...m,
            service_job_id: m.service_job_id ?? null,
            service_job_name: m.service_job_name ?? null,
            note: m.note ?? null,
            created_by_name: m.created_by_name ?? null,
          }))
      : await readWindowMovements(sb, window);
    if (data.report === "movements") {
      const locations = ctx ? ctx.locations : await readLocations(sb);
      rows = buildMovementRows({ movements, locations, ...window, costs });
    } else {
      const used = movements.filter(
        (m) => m.service_job_id && (m.reason === "consumed" || m.reason === "released"),
      );
      const jobIds = [...new Set(used.map((m) => m.service_job_id!))];
      const jobs = await readJobs(sb, jobIds);
      rows = buildUsageRows({
        movements: used,
        ...window,
        jobs,
        costs,
        withValue: data.with_value,
      });
    }
  }
  return {
    csv: toCsv(rows),
    count: rows.length - 1,
    file_name: exportFileName(data.report, data.from, data.to, now, data.as_of),
  };
}

export const exportInventoryCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => exportSchema.parse(d))
  .handler(async ({ data, context }): Promise<InventoryExport> => {
    const sb = context.supabase;
    const { data: me } = await sb
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!seesEveryone(me)) throw new Error(FORBIDDEN);
    return buildInventoryExport(sb, data);
  });
