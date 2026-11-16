/**
 * Inventory › Count, the server side (owner, Nov 16: "is it as efficient and good as it could be
 * especially with the reconciliation part" … "Go with all 6").
 *
 * A count is one place (the shop or one vehicle) on one day: a sheet of every item inventory has
 * ever held there with what it expects, the counts typed against it, and one save that keeps the
 * whole sheet as a dated record and corrects every item that differed. The save is one database
 * transaction (inventory_save_count, 20261116170000), so a count is never half saved, and what
 * inventory expected is read there, never taken from the browser.
 *
 * A count may be dated before today (a December 31 count typed in on January 3): the sheet then
 * shows what inventory held at the end of that day and the corrections are dated then.
 *
 * Who: counting is for people with Estimate access (the rule Set count has had since Oct 9; the
 * count tables' own policies say the same). Dollars, and the cost of opening stock, are an
 * admin's and a manager's (owner, Oct 15).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess, seesEveryone, type AccessLike } from "@/lib/access";
import { easternYmd } from "@/lib/field-day";
import { cellKeyOf, replayLedger, type EntryCost } from "@/lib/inventory-cost";
import { looseClient, readCostContext } from "@/lib/inventory-cost.functions";
import { readAllMovements } from "@/lib/inventory-reconcile.functions";
import {
  buildCountLines,
  buildCountRows,
  countFileName,
  endOfDay,
  stockAsOf,
  type CountLineIn,
  type CountReport,
} from "@/lib/inventory-year-end";
import {
  categories,
  cellUnitsForCells,
  nameStockCells,
  PRICE_IS_MANAGERS,
} from "@/lib/inventory.functions";
import { toCsv } from "@/lib/review-export";
import { materialsByCell, serviceLabel, type Cell } from "@/lib/service-materials";
import { loadServiceMaterialLinks } from "@/lib/service-materials.server";
import { variantOf, type PieceDef } from "@/lib/stock-units";

type Client = SupabaseClient<Database>;

export const COUNT_NEEDS_ESTIMATE = "Counting is for estimators and managers";
export const COUNT_FUTURE = "A count cannot be dated in the future";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function me(sb: Client, userId: string) {
  const { data } = await sb
    .from("profiles")
    .select("role, access, technician")
    .eq("id", userId)
    .maybeSingle();
  return data;
}

async function placeOf(sb: Client, id: string): Promise<{ id: string; name: string }> {
  const { data, error } = await sb
    .from("inventory_locations")
    .select("id, name")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That place is not set up");
  return data;
}

/**
 * The instant a count of a past day looks back to, as the database function does: one second
 * before the midnight after it, office time. Nothing for today (everything counts).
 */
export function countInstant(day: string, today: string): string | null {
  if (day > today) throw new Error(COUNT_FUTURE);
  if (day === today) return null;
  return new Date(Date.parse(endOfDay(day)) - 1000).toISOString();
}

export interface CountSheetLine extends Cell {
  item: string;
  colour: string;
  category: string;
  unit: string;
  piece: PieceDef | null;
  item_nos: string[];
  /** What inventory holds at this place on that day. */
  expected: number;
  /** The item's average cost per unit that day (admins and managers); null otherwise or when unknown. */
  avg: number | null;
  estimated: boolean;
}

export interface CountSheet {
  location_id: string;
  location_name: string;
  counted_on: string;
  /** The latest day a count may carry: today, office time. */
  today: string;
  lines: CountSheetLine[];
  /** The reader sees dollars (an admin or a manager). */
  dollars: boolean;
}

/** The count sheet of one place for one day: every item ever held there, with what is expected. */
export async function readCountSheet(
  sb: Client,
  input: { location_id: string; counted_on?: string | undefined },
  dollars: boolean,
  now: Date = new Date(),
): Promise<CountSheet> {
  const today = easternYmd(now);
  const day = input.counted_on ?? today;
  const at = countInstant(day, today);
  // Entries made at or before `at` count; times are compared as plain ISO text.
  const until = at == null ? "9999" : new Date(Date.parse(at) + 1).toISOString();
  const place = await placeOf(sb, input.location_id);
  const ctx = dollars
    ? await readCostContext(sb)
    : {
        movements: (await readAllMovements(sb)).map((m) => ({
          ...m,
          qty: Number(m.qty),
          created_at: new Date(m.created_at).toISOString(),
        })),
      };
  const here = stockAsOf(ctx.movements, until).filter((c) => c.location_id === place.id);
  const rows = await nameStockCells(sb, here);
  const costs = "prices" in ctx ? replayLedger({ ...ctx, until }).items : null;
  const lines: CountSheetLine[] = rows
    .map((r) => {
      const cost = costs?.get(cellKeyOf(r));
      return {
        screen_id: r.screen_id,
        row_label: r.row_label,
        price_col: r.price_col,
        item: r.label ?? r.row_label,
        colour: variantOf(r.price_col) ?? "",
        category: r.category,
        unit: r.unit,
        piece: r.piece,
        item_nos: r.item_nos,
        expected: r.on_hand,
        avg: cost?.avg ?? null,
        estimated: cost?.estimated ?? false,
      };
    })
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category, "en", { numeric: true }) ||
        a.item.localeCompare(b.item, "en", { numeric: true }) ||
        a.colour.localeCompare(b.colour, "en", { numeric: true }),
    );
  return {
    location_id: place.id,
    location_name: place.name,
    counted_on: day,
    today,
    lines,
    dollars,
  };
}

export const getCountSheet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z.object({ location_id: z.string().min(1).max(60), counted_on: ymd.optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CountSheet> => {
    const who = await me(context.supabase, context.userId);
    if (!canAccess(who, "estimate")) throw new Error(COUNT_NEEDS_ESTIMATE);
    return readCountSheet(context.supabase, data, seesEveryone(who));
  });

export const saveCountSchema = z.object({
  location_id: z.string().min(1).max(60),
  counted_on: ymd,
  /** The opening count: stock found is "Opening stock" and may carry its cost. */
  opening: z.boolean(),
  note: z.string().max(500).nullable().optional(),
  lines: z
    .array(
      z.object({
        screen_id: z.string().min(1),
        row_label: z.string().min(1),
        price_col: z.string().min(1),
        /** In the stock unit (packs, as a decimal when a pack is part used). */
        counted: z.number().finite().min(0).max(10_000_000),
        /** How it was counted, in the counter's words ("2 boxes + 150 fasteners"). */
        counted_note: z.string().max(300).nullable().optional(),
        /** The cost of one stock unit of stock this line brings in (admins and managers). */
        unit_cost: z.number().finite().min(0).max(1_000_000).nullable().optional(),
      }),
    )
    .min(1, "Type at least one count")
    .max(2000),
});

export interface SavedCount {
  id: string;
  lines: number;
  /** Lines that differed and were corrected. */
  differences: number;
}

/** Save a whole count. A plain function so the tests call it without the server wrapper. */
export async function saveCountWith(
  sb: Client,
  data: z.infer<typeof saveCountSchema>,
  who: AccessLike | null | undefined,
  now: Date = new Date(),
): Promise<SavedCount> {
  if (!canAccess(who, "estimate")) throw new Error(COUNT_NEEDS_ESTIMATE);
  if (!seesEveryone(who) && data.lines.some((l) => l.unit_cost != null))
    throw new Error(PRICE_IS_MANAGERS);
  if (data.counted_on > easternYmd(now)) throw new Error(COUNT_FUTURE);
  const seen = new Set<string>();
  for (const l of data.lines) {
    const k = cellKeyOf(l);
    if (seen.has(k)) throw new Error(`"${l.row_label}" is on the count twice`);
    seen.add(k);
  }
  const place = await placeOf(sb, data.location_id);
  // Each item's unit is the catalog's (or the service material's) own; an item that has left
  // the catalog keeps the unit its entries were recorded in.
  const [unitsOf, { data: nums, error: nErr }, all] = await Promise.all([
    cellUnitsForCells(sb, data.lines),
    sb.from("catalog_item_numbers_map").select("screen_id, row_label, price_col, item_no"),
    readAllMovements(sb),
  ]);
  if (nErr) throw new Error(nErr.message);
  const ledgerUnit = new Map<string, string>();
  for (const m of all) ledgerUnit.set(cellKeyOf(m), m.unit);
  const itemNo = new Map<string, string>();
  for (const n of nums ?? [])
    if (n.item_no && n.screen_id && n.row_label && n.price_col) {
      const k = cellKeyOf({
        screen_id: n.screen_id,
        row_label: n.row_label,
        price_col: n.price_col,
      });
      if (!itemNo.has(k)) itemNo.set(k, n.item_no);
    }
  const lines = data.lines.map((l) => {
    const k = cellKeyOf(l);
    const unit = unitsOf(l)?.unit ?? ledgerUnit.get(k);
    if (!unit) throw new Error(`"${l.row_label}" is not on the catalog, so it cannot be counted`);
    return {
      screen_id: l.screen_id,
      row_label: l.row_label,
      price_col: l.price_col,
      unit,
      item_no: itemNo.get(k) ?? "",
      counted: String(Math.round(l.counted * 1000) / 1000),
      counted_note: l.counted_note ?? "",
      unit_cost: l.unit_cost == null ? "" : String(l.unit_cost),
    };
  });
  const { data: id, error } = await looseClient(sb).rpc("inventory_save_count", {
    p_location: place.id,
    p_counted_on: data.counted_on,
    p_opening: data.opening,
    p_note: data.note ?? null,
    p_lines: lines,
  });
  if (error) throw new Error(error.message);
  if (typeof id !== "string") throw new Error("The count was not saved");
  const saved = await readCountLines(sb, [id]);
  return {
    id,
    lines: saved.length,
    differences: saved.filter((l) => l.movement_id != null).length,
  };
}

export const saveCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveCountSchema.parse(d))
  .handler(async ({ data, context }): Promise<SavedCount> =>
    saveCountWith(context.supabase, data, await me(context.supabase, context.userId)),
  );

interface CountRow {
  id: string;
  location_id: string;
  counted_on: string;
  opening: boolean;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}
type StoredLine = CountLineIn & { count_id: string };

const PAGE = 1000;
const CHUNK = 50;

/** The lines of some counts (1,000 rows a request, so by page). */
async function readCountLines(sb: Client, ids: string[]): Promise<StoredLine[]> {
  const out: StoredLine[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await looseClient(sb)
        .from("inventory_count_lines")
        .select(
          "id, count_id, screen_id, row_label, price_col, unit, expected, counted, movement_id",
        )
        .in("count_id", part)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Record<string, unknown>[];
      for (const r of rows)
        out.push({
          count_id: String(r["count_id"]),
          screen_id: String(r["screen_id"]),
          row_label: String(r["row_label"]),
          price_col: String(r["price_col"]),
          unit: String(r["unit"] ?? ""),
          expected: Number(r["expected"] ?? 0),
          counted: Number(r["counted"] ?? 0),
          movement_id: r["movement_id"] == null ? null : Number(r["movement_id"]),
        });
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

const asCount = (r: Record<string, unknown>): CountRow => ({
  id: String(r["id"]),
  location_id: String(r["location_id"]),
  counted_on: String(r["counted_on"]),
  opening: r["opening"] === true,
  note: typeof r["note"] === "string" ? r["note"] : null,
  created_by_name: typeof r["created_by_name"] === "string" ? r["created_by_name"] : null,
  created_at: String(r["created_at"]),
});

/** A saved count without its lines, for the list of past counts. */
export type CountSummary = Omit<CountReport, "lines"> & { lines: number };

/** Saved counts as reports, newest first; one count when an id is given. */
export async function readCounts(
  sb: Client,
  dollars: boolean,
  only?: string,
): Promise<CountReport[]> {
  let q = looseClient(sb)
    .from("inventory_counts")
    .select("id, location_id, counted_on, opening, note, created_by_name, created_at")
    .order("counted_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (only) q = q.eq("id", only);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const counts = ((data ?? []) as Record<string, unknown>[]).map(asCount);
  if (!counts.length) return [];
  const [lines, cats, links, { data: locs, error: lErr }, costs] = await Promise.all([
    readCountLines(
      sb,
      counts.map((c) => c.id),
    ),
    categories(sb),
    loadServiceMaterialLinks(sb),
    sb.from("inventory_locations").select("id, name"),
    dollars
      ? readCostContext(sb).then((ctx): Map<number, EntryCost> => replayLedger(ctx).entries)
      : null,
  ]);
  if (lErr) throw new Error(lErr.message);
  const place = new Map((locs ?? []).map((l) => [l.id, l.name]));
  const byMaterial = materialsByCell(links);
  const names = (cell: Cell) => ({
    item: serviceLabel(byMaterial, cell) ?? cell.row_label,
    colour: variantOf(cell.price_col) ?? "",
    category: cats(cell.screen_id, cell.row_label),
  });
  return counts.map((c) => {
    const built = buildCountLines(
      lines.filter((l) => l.count_id === c.id),
      names,
      costs,
    );
    return {
      id: c.id,
      location_id: c.location_id,
      location_name: place.get(c.location_id) ?? c.location_id,
      counted_on: c.counted_on,
      opening: c.opening,
      note: c.note,
      by_name: c.created_by_name,
      created_at: c.created_at,
      dollars,
      ...built,
    };
  });
}

export const listCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CountSummary[]> => {
    const who = await me(context.supabase, context.userId);
    if (!canAccess(who, "estimate")) throw new Error(COUNT_NEEDS_ESTIMATE);
    const counts = await readCounts(context.supabase, seesEveryone(who));
    return counts.map((c) => ({ ...c, lines: c.lines.length }));
  });

async function oneCount(sb: Client, userId: string, id: string): Promise<CountReport> {
  const who = await me(sb, userId);
  if (!canAccess(who, "estimate")) throw new Error(COUNT_NEEDS_ESTIMATE);
  const [count] = await readCounts(sb, seesEveryone(who), id);
  if (!count) throw new Error("That count was not found");
  return count;
}

export const getCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(({ data, context }): Promise<CountReport> =>
    oneCount(context.supabase, context.userId, data.id),
  );

/** A saved count as a spreadsheet file. */
export const exportCountCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const count = await oneCount(context.supabase, context.userId, data.id);
    const rows = buildCountRows(count);
    return { csv: toCsv(rows), count: rows.length - 1, file_name: countFileName(count) };
  });
