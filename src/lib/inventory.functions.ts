/**
 * Inventory phase 1 — the stock ledger. Stock is keyed by the catalog cell the estimator prices
 * (screen › product row key › price column); on-hand is the sum of signed movements.
 *
 * Owner decisions (2026-09-23): quantities only, one location; stock is kept in the priced pack
 * as a decimal and leftovers are counted in pieces of the pack (stock-units.ts); the same part
 * number can sit on more than one product (legacy 1106 = Duro-Fleece Adhesive(cartridge) AND
 * OlyBond500 SpotShot), so an item # only auto-picks when unique. Applying stock to a bid
 * (phase 2/3) NEVER changes the bid's price — a bid is priced as if it used no inventory; stock
 * only reduces what the ordering summary says to buy.
 */
import { createServerFn } from "@tanstack/react-start";
import { canAccess } from "@/lib/access";
import {
  PACK_QTY_COLS,
  stockUnitFor,
  packsFromPieces,
  pieceDefFromPack,
  pieceDefFromUnitType,
  plural,
  type PieceDef,
} from "@/lib/stock-units";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { labelColOf, rowKeys } from "@/lib/catalog-row-key";

export const MOVEMENT_REASONS = [
  "leftover",
  "adjustment",
  "damaged",
  "allocated",
  "released",
  "consumed",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];
export const REASON_LABELS: Record<MovementReason, string> = {
  leftover: "Leftover from job",
  adjustment: "Count adjustment",
  damaged: "Damaged / written off",
  allocated: "Allocated to bid",
  released: "Released from bid",
  consumed: "Used on job",
};

/**
 * The unit stock is COUNTED in per screen — the purchase unit the material physically sits in.
 * Conversions to the estimator's units (sq ft, fastener counts…) are phase 2; a movement stores
 * the unit it was recorded in so a later change never rewrites history.
 */
export { STOCK_UNIT_BY_SCREEN, stockUnitFor } from "@/lib/stock-units";
/**
 * Screens with several price columns key stock by colour / size (White, Tan, 2", …); a
 * single-price screen (Adhesives) stores the generic "price" column — shown as "—".
 */
export const SINGLE_PRICE_COL = "price";
export const priceColLabel = (col: string): string => (col === SINGLE_PRICE_COL ? "—" : col);

const cellSchema = z.object({
  screen_id: z.string().min(1),
  row_label: z.string().min(1),
  price_col: z.string().min(1),
});

export interface StockRow {
  screen_id: string;
  category: string;
  row_label: string;
  price_col: string;
  unit: string;
  on_hand: number;
  last_at: string | null;
  item_nos: string[];
}

export interface MovementRow {
  id: number;
  screen_id: string;
  category: string;
  row_label: string;
  price_col: string;
  item_no: string | null;
  qty: number;
  unit: string;
  reason: MovementReason;
  bid_id: string | null;
  bid_name: string | null;
  counted_note: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

async function categories(sb: SupabaseClient<Database>) {
  const { data, error } = await sb
    .from("pricing_catalog")
    .select("id, category")
    .eq("branch", "duro_last");
  if (error) throw new Error(error.message);
  const m = new Map<string, string>();
  for (const s of data ?? []) m.set(s.id, s.category);
  return m;
}

/** Stock on hand per catalog cell (only cells that have ever moved). */
export const listStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StockRow[]> => {
    const sb = context.supabase;
    const [{ data, error }, cats, { data: nums }] = await Promise.all([
      sb
        .from("inventory_movements")
        .select("screen_id, row_label, price_col, qty, unit, created_at, item_no")
        .order("created_at"),
      categories(sb),
      sb.from("catalog_item_numbers").select("screen_id, row_label, price_col, item_no"),
    ]);
    if (error) throw new Error(error.message);
    const byCell = new Map<string, StockRow>();
    for (const m of data ?? []) {
      const key = `${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
      let row = byCell.get(key);
      if (!row) {
        row = {
          screen_id: m.screen_id,
          category: cats.get(m.screen_id) ?? m.screen_id,
          row_label: m.row_label,
          price_col: m.price_col,
          unit: m.unit,
          on_hand: 0,
          last_at: null,
          item_nos: [],
        };
        byCell.set(key, row);
      }
      row.on_hand += Number(m.qty);
      row.unit = m.unit;
      row.last_at = m.created_at;
    }
    for (const n of nums ?? []) {
      const row = byCell.get(`${n.screen_id}\u0000${n.row_label}\u0000${n.price_col}`);
      if (row && !row.item_nos.includes(n.item_no)) row.item_nos.push(n.item_no);
    }
    return [...byCell.values()]
      .map((r) => ({ ...r, on_hand: Math.round(r.on_hand * 1000) / 1000 }))
      .sort(
        (a, b) => a.category.localeCompare(b.category) || a.row_label.localeCompare(b.row_label),
      );
  });

/** The ledger, newest first. */
export const listMovements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        screen_id: z.string().optional(),
        bid_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<MovementRow[]> => {
    const sb = context.supabase;
    let q = sb
      .from("inventory_movements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 300);
    if (data.screen_id) q = q.eq("screen_id", data.screen_id);
    if (data.bid_id) q = q.eq("bid_id", data.bid_id);
    const [{ data: rows, error }, cats] = await Promise.all([q, categories(sb)]);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      screen_id: r.screen_id,
      category: cats.get(r.screen_id) ?? r.screen_id,
      row_label: r.row_label,
      price_col: r.price_col,
      item_no: r.item_no,
      qty: Number(r.qty),
      unit: r.unit,
      reason: r.reason as MovementReason,
      bid_id: r.bid_id,
      bid_name: r.bid_name,
      counted_note: r.counted_note,
      note: r.note,
      created_by_name: r.created_by_name,
      created_at: r.created_at,
    }));
  });

const addSchema = cellSchema.extend({
  /** Positive as counted; the reason decides the sign (damaged always subtracts). */
  qty: z.number().finite(),
  /**
   * When set, `qty` was counted in PIECES of the pack (cartridges, fasteners, gallons) and the
   * server converts it with the catalog's pieces-per-pack (stock-units.ts).
   */
  in_pieces: z.boolean().optional(),
  /** Ignored if sent: the unit is the product screen's stock unit (STOCK_UNIT_BY_SCREEN). */
  unit: z.string().max(20).optional(),
  /** consumed = pulled from stock for a bid (subtracts); released = put back (adds). Both need bid_id. */
  reason: z.enum(["leftover", "adjustment", "damaged", "consumed", "released"]),
  bid_id: z.string().uuid().nullable().optional(),
  counted_note: z.string().max(300).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

/**
 * Record a movement. The cell must exist on its catalog screen (by row key); a field login may
 * only record leftovers (RLS enforces this too). Leftovers add, damage subtracts, adjustments
 * carry their sign.
 */
export const addMovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => addSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [{ data: me }, { data: screen, error }] = await Promise.all([
      sb
        .from("profiles")
        .select("role, access, full_name, email")
        .eq("id", context.userId)
        .maybeSingle(),
      sb.from("pricing_catalog").select("data").eq("id", data.screen_id).maybeSingle(),
    ]);
    // Inventory access records leftovers and what a crew takes for a job; Estimate access (or
    // admin) records anything (adjustments, write-offs, returns).
    if (!me || !(canAccess(me, "inventory") || canAccess(me, "estimate")))
      throw new Error("Forbidden: Inventory access required");
    if (!canAccess(me, "estimate") && data.reason !== "leftover" && data.reason !== "consumed")
      throw new Error("Only an estimator can adjust counts or write stock off");
    if (error) throw new Error(error.message);
    if (!screen) throw new Error("Catalog screen not found");
    const d = screen.data as {
      kind?: string;
      columns?: string[];
      rows?: Record<string, unknown>[];
      products?: { name: string; unit_type?: unknown }[];
    };
    // Adhesives count in the product's own unit (its catalog unit_type: "5-gal. Box Set",
    // "4-Cartridge Case", "50-Gal Drum Set"); every other screen in its per-screen unit.
    let unit = stockUnitFor(data.screen_id);
    let piece: PieceDef | null = null;
    if (d.kind === "adhesives") {
      const product = (d.products ?? []).find((p) => p.name === data.row_label);
      if (!product) throw new Error(`"${data.row_label}" is not on the Adhesives screen`);
      if (typeof product.unit_type === "string" && product.unit_type.trim()) {
        unit = product.unit_type.trim();
        piece = pieceDefFromUnitType(product.unit_type);
      }
    } else {
      const cols = d.columns ?? [];
      const keys = rowKeys(cols, d.rows ?? []);
      const rowIdx = keys.indexOf(data.row_label);
      if (rowIdx < 0) throw new Error(`"${data.row_label}" is not on this screen`);
      if (!cols.includes(data.price_col) || data.price_col === labelColOf(cols))
        throw new Error(`"${data.price_col}" is not a price column on this screen`);
      const packCol = PACK_QTY_COLS.find((c) => cols.includes(c));
      const packRaw = packCol ? (d.rows ?? [])[rowIdx]?.[packCol] : undefined;
      const packQty =
        typeof packRaw === "number" ? packRaw : packRaw != null ? Number(packRaw) : null;
      piece = pieceDefFromPack(packCol, Number.isFinite(packQty) ? packQty : null);
    }
    // Pieces convert to a decimal of the pack from the catalog's own pack size.
    let counted = data.qty;
    if (data.in_pieces) {
      if (!piece)
        throw new Error("This product has no pieces-per-pack on the catalog — count whole packs");
      counted = packsFromPieces(data.qty, piece);
    }
    let qty = Math.abs(counted);
    if (data.reason === "damaged" || data.reason === "consumed") qty = -qty;
    if (data.reason === "adjustment") qty = counted;
    if (qty === 0) throw new Error("Quantity cannot be zero");
    if ((data.reason === "consumed" || data.reason === "released") && !data.bid_id)
      throw new Error("Pick the job this material is for");
    if (data.reason === "consumed") {
      // Never pull more than the shelf holds (on hand = the sum of the cell's entries).
      const { data: prior, error: pErr } = await sb
        .from("inventory_movements")
        .select("qty")
        .eq("screen_id", data.screen_id)
        .eq("row_label", data.row_label)
        .eq("price_col", data.price_col);
      if (pErr) throw new Error(pErr.message);
      const onHand = (prior ?? []).reduce((n, r) => n + Number(r.qty), 0);
      if (-qty > onHand + 1e-9)
        throw new Error(`Only ${Math.round(onHand * 1000) / 1000} ${unit} on the shelf`);
    }
    let bidName: string | null = null;
    if (data.bid_id) {
      const { data: opts, error: bErr } = await sb.rpc("inventory_bid_options");
      if (bErr) throw new Error(bErr.message);
      const b = (opts ?? []).find((o) => o.id === data.bid_id);
      if (!b) throw new Error("Bid not found");
      bidName = b.name;
    }
    const { data: itemRows } = await sb
      .from("catalog_item_numbers")
      .select("item_no")
      .eq("screen_id", data.screen_id)
      .eq("row_label", data.row_label)
      .eq("price_col", data.price_col)
      .limit(1);
    const { data: inserted, error: insErr } = await sb
      .from("inventory_movements")
      .insert({
        screen_id: data.screen_id,
        row_label: data.row_label,
        price_col: data.price_col,
        item_no: itemRows?.[0]?.item_no ?? null,
        qty,
        // One unit per product, always: on hand is a plain sum of entries.
        unit,
        reason: data.reason,
        bid_id: data.bid_id ?? null,
        bid_name: bidName,
        counted_note:
          data.counted_note ??
          (data.in_pieces && piece ? `${data.qty} ${plural(data.qty, piece.name)}` : null),
        note: data.note ?? null,
        created_by: context.userId,
        created_by_name: me?.full_name?.trim() || me?.email || null,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    return { ok: true, id: inserted.id, qty, unit };
  });

/**
 * Undo: remove an entry you recorded in the last 24 hours (a wrong number or job); admins may
 * remove any. RLS enforces the same rule. Stock on hand and the bid's order list follow.
 */
export const undoMovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: row, error } = await sb
      .from("inventory_movements")
      .select("id, created_by, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That entry is already gone");
    const { data: me } = await sb
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    const mine = row.created_by === context.userId;
    const fresh = Date.now() - Date.parse(row.created_at) < 24 * 3600 * 1000;
    if (me?.role !== "admin" && !(mine && fresh))
      throw new Error("Only your own entries from the last 24 hours can be undone");
    const { error: delErr, count } = await sb
      .from("inventory_movements")
      .delete({ count: "exact" })
      .eq("id", data.id);
    if (delErr) throw new Error(delErr.message);
    if (!count) throw new Error("Could not undo that entry");
    return { ok: true };
  });

/** Bids a leftover can be attributed to (a field login cannot read bids directly). */
export const listBidOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("inventory_bid_options");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export type OpenedBoxRule = "half" | "full" | "ignore";
export const OPENED_BOX_LABELS: Record<OpenedBoxRule, string> = {
  half: "Count an opened box / bag as half",
  full: "Count an opened box / bag as a full one",
  ignore: "Do not count opened boxes / bags",
};

export const getInventorySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ opened_box_rule: OpenedBoxRule }> => {
    const { data, error } = await context.supabase
      .from("inventory_settings")
      .select("opened_box_rule")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { opened_box_rule: (data?.opened_box_rule as OpenedBoxRule) ?? "half" };
  });

export const setOpenedBoxRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ rule: z.enum(["half", "full", "ignore"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.role !== "admin") throw new Error("Forbidden: admin access required");
    const { error } = await context.supabase
      .from("inventory_settings")
      .update({ opened_box_rule: data.rule, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin-only: remove a mistaken entry (the ledger otherwise only grows). */
export const deleteMovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.role !== "admin") throw new Error("Forbidden: admin access required");
    const { error } = await context.supabase.from("inventory_movements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
