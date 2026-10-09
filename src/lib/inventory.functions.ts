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
import { canAccess, managesTickets } from "@/lib/access";
import { fieldEditProblem } from "@/lib/field-edit-lock";
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
import { easternYmd } from "@/lib/field-day";
import {
  serviceCategoryOf,
  servicePiece,
  materialForCell,
  SERVICE_STOCK_SCREEN,
  materialsByCell,
  serviceLabel,
  unitWord,
} from "@/lib/service-materials";
import { loadServiceMaterialLinks } from "@/lib/service-materials.server";
import { readCrew } from "@/lib/service-crew.server";

export const MOVEMENT_REASONS = [
  "leftover",
  "adjustment",
  "damaged",
  "allocated",
  "released",
  "consumed",
  "transfer_out",
  "transfer_in",
  "vehicle_used",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];
export const REASON_LABELS: Record<MovementReason, string> = {
  leftover: "Put in inventory",
  adjustment: "Count adjustment",
  damaged: "Damaged / written off",
  allocated: "Allocated to bid",
  released: "Released from bid",
  consumed: "Used on job",
  transfer_out: "Moved out",
  transfer_in: "Moved in",
  vehicle_used: "Used from the vehicle",
};

/**
 * Where stock sits (owner, Sep 24): the shop is the hub; each service vehicle is a location of
 * its own. Stock checked out to a vehicle is assumed there until it comes back to the shop
 * (transfer) or is written off as used on the vehicle. Jobs draw from the shop.
 */
export const SHOP_LOCATION_ID = "shop";
export interface InventoryLocation {
  id: string;
  name: string;
  kind: "shop" | "vehicle";
  sort: number;
}
export const listLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InventoryLocation[]> => {
    const { data, error } = await context.supabase
      .from("inventory_locations")
      .select("id, name, kind, sort")
      .eq("active", true)
      .order("sort");
    if (error) throw new Error(error.message);
    return (data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind === "vehicle" ? "vehicle" : "shop",
      sort: l.sort,
    }));
  });

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
  /** Where it sits: "shop" or a service vehicle (inventory_locations.id). */
  location_id: string;
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
  /** Where the entry happened (inventory_locations.id). */
  location_id: string;
  /** Links the two halves of a transfer (out of one location, into another). */
  pair_id: string | null;
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
  /** Set when the material was used on a service job (repair ticket) instead of a bid. */
  service_job_id: string | null;
  service_job_name: string | null;
  counted_note: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
  /** May the caller undo this entry now (own entry within 24 h, or admin)? */
  can_undo?: boolean;
}

/** A stock row's category: its catalog screen's, or a service material's own group. */
async function categories(sb: SupabaseClient<Database>) {
  const [{ data, error }, materials] = await Promise.all([
    sb.from("pricing_catalog").select("id, category").eq("branch", "duro_last"),
    loadServiceMaterialLinks(sb),
  ]);
  if (error) throw new Error(error.message);
  const m = new Map<string, string>();
  for (const s of data ?? []) m.set(s.id, s.category);
  // Service materials with no bid-catalog twin (owner, Oct 6: ISO is Underlayment, Acetone is
  // Cleaning Supplies …; service-materials.ts).
  return (screenId: string, rowLabel: string): string =>
    screenId === SERVICE_STOCK_SCREEN
      ? serviceCategoryOf(materials, rowLabel)
      : (m.get(screenId) ?? screenId);
}

/** Stock on hand per catalog cell (only cells that have ever moved). */
export const listStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StockRow[]> => {
    const sb = context.supabase;
    const [{ data, error }, cats, { data: nums }] = await Promise.all([
      sb
        .from("inventory_movements")
        .select("location_id, screen_id, row_label, price_col, qty, unit, created_at, item_no")
        .order("created_at"),
      categories(sb),
      sb.from("catalog_item_numbers").select("screen_id, row_label, price_col, item_no"),
    ]);
    if (error) throw new Error(error.message);
    const byCell = new Map<string, StockRow>();
    for (const m of data ?? []) {
      const key = `${m.location_id}\u0000${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
      let row = byCell.get(key);
      if (!row) {
        row = {
          location_id: m.location_id,
          screen_id: m.screen_id,
          category: cats(m.screen_id, m.row_label),
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
    const numsByCell = new Map<string, string[]>();
    for (const n of nums ?? []) {
      const k = `${n.screen_id}\u0000${n.row_label}\u0000${n.price_col}`;
      const list = numsByCell.get(k) ?? [];
      if (!list.includes(n.item_no)) list.push(n.item_no);
      numsByCell.set(k, list);
    }
    for (const row of byCell.values())
      row.item_nos =
        numsByCell.get(`${row.screen_id}\u0000${row.row_label}\u0000${row.price_col}`) ?? [];
    return [...byCell.values()]
      .map((r) => ({ ...r, on_hand: Math.round(r.on_hand * 1000) / 1000 }))
      .sort(
        (a, b) =>
          a.location_id.localeCompare(b.location_id) ||
          a.category.localeCompare(b.category) ||
          a.row_label.localeCompare(b.row_label),
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
    const [{ data: rows, error }, cats, { data: me }] = await Promise.all([
      q,
      categories(sb),
      sb.from("profiles").select("role").eq("id", context.userId).maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (rows ?? []).map((r) => ({
      id: r.id,
      location_id: r.location_id,
      pair_id: r.pair_id,
      can_undo:
        me?.role === "admin" ||
        (r.created_by === context.userId && now - Date.parse(r.created_at) < 24 * 3600 * 1000),
      screen_id: r.screen_id,
      category: cats(r.screen_id, r.row_label),
      row_label: r.row_label,
      price_col: r.price_col,
      item_no: r.item_no,
      qty: Number(r.qty),
      unit: r.unit,
      reason: r.reason as MovementReason,
      bid_id: r.bid_id,
      bid_name: r.bid_name,
      service_job_id: r.service_job_id,
      service_job_name: r.service_job_name,
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
  /**
   * consumed = pulled from stock for a job (subtracts); released = put back (adds). Both name
   * the job: a bid (bid_id) or a service job (service_job_id). The old vehicle write-off is gone
   * (owner, Sep 26): material off a truck is always against a job.
   */
  reason: z.enum(["leftover", "adjustment", "damaged", "consumed", "released"]),
  /** Where: "shop" (default) or a service vehicle's inventory_locations.id. */
  location_id: z.string().min(1).max(60).optional(),
  bid_id: z.string().uuid().nullable().optional(),
  service_job_id: z.string().uuid().nullable().optional(),
  counted_note: z.string().max(300).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  /**
   * A ticket's material logged although the place shows too little of it in the app (owner,
   * Oct 9: "add materials … from our catalog even if there is not stock of that item in the
   * shop or vehicle"). The count there goes below zero and the entry's note says so, for the
   * office to fix the count; only with a service_job_id.
   */
  short_ok: z.boolean().optional(),
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
    const { data: me } = await sb
      .from("profiles")
      .select("role, access, technician, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    // Inventory or Service access records leftovers and what a crew takes for a job; Estimate
    // access (or admin) records anything (adjustments, write-offs, returns).
    if (
      !me ||
      !(canAccess(me, "inventory") || canAccess(me, "estimate") || canAccess(me, "service"))
    )
      throw new Error("Forbidden: Inventory access required");
    // Material against a ticket follows the ticket's lock (owner, Oct 6; field-edit-lock.ts): a
    // technician only on a ticket they are on (lead or crew) while it is Open / Scheduled / Done,
    // a manager before Invoiced, nobody on an Invoiced / Closed ticket. A manager's entry on
    // someone else's ticket is a correction and goes on the ticket's timeline (below).
    let correction = false;
    if (data.service_job_id) {
      const { data: job, error: jErr } = await sb
        .from("service_jobs")
        .select("id, stage, technician_id")
        .eq("id", data.service_job_id)
        .maybeSingle();
      if (jErr) throw new Error(jErr.message);
      if (!job) throw new Error("Service job not found");
      const onTicket =
        job.technician_id === context.userId ||
        (await readCrew(sb, job.id, { rates: false })).some(
          (c) => c.technician_id === context.userId,
        );
      const problem = fieldEditProblem(me, job.stage, onTicket);
      if (problem) throw new Error(problem);
      correction = managesTickets(me) && !onTicket;
    }
    // A service job's "released" (a tech putting a piece back on the truck) is allowed for
    // everyone who may log material; it may never exceed what that ticket took from the cell.
    const jobRelease = data.reason === "released" && !!data.service_job_id;
    if (
      !canAccess(me, "estimate") &&
      data.reason !== "leftover" &&
      data.reason !== "consumed" &&
      !jobRelease
    )
      throw new Error("Only an estimator can adjust counts or write stock off");
    const locationId = data.location_id ?? SHOP_LOCATION_ID;
    const location = await locationOf(sb, locationId);
    if (data.bid_id && data.service_job_id) throw new Error("Pick one job, not both");
    // The cell's unit and pack: a catalog cell's per-screen unit (Adhesives: the product's own
    // unit type), or a service material's own unit (cellUnit).
    const { unit, piece } = await cellUnit(sb, data);
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
    if (
      (data.reason === "consumed" || data.reason === "released") &&
      !data.bid_id &&
      !data.service_job_id
    )
      throw new Error("Pick the job this material is for");
    if (jobRelease) {
      const { data: taken } = await sb
        .from("inventory_movements")
        .select("qty")
        .eq("service_job_id", data.service_job_id!)
        .eq("location_id", locationId)
        .eq("screen_id", data.screen_id)
        .eq("row_label", data.row_label)
        .eq("price_col", data.price_col)
        .in("reason", ["consumed", "released"]);
      const net = (taken ?? []).reduce((n, r) => n - Number(r.qty), 0);
      if (qty > net + 1e-9)
        throw new Error(
          `This ticket only took ${Math.round(net * 1000) / 1000} ${unit} from ${location.name}`,
        );
    }
    let shortNote: string | null = null;
    if (data.reason === "consumed") {
      // Never take more than the location holds (on hand = the sum of the cell's entries there)
      // — unless a ticket says it did anyway (short_ok): the count goes below zero and the
      // entry says so, so the office sees what to fix.
      const onHand = await onHandAt(sb, locationId, data);
      if (-qty > onHand + 1e-9) {
        const had = `${Math.round(Math.max(0, onHand) * 1000) / 1000} ${unit}`;
        if (!(data.short_ok && data.service_job_id))
          throw new Error(
            `Only ${Math.round(onHand * 1000) / 1000} ${unit} ${location.kind === "shop" ? "on the shelf" : `on ${location.name}`}`,
          );
        shortNote = `Short: the app had ${had} ${location.kind === "shop" ? "on the shelf" : `on ${location.name}`}; count needs fixing`;
      }
    }
    let bidName: string | null = null;
    let jobName: string | null = null;
    if (data.bid_id || data.service_job_id) {
      const { data: opts, error: bErr } = await sb.rpc("inventory_job_options");
      if (bErr) throw new Error(bErr.message);
      if (data.bid_id) {
        const b = (opts ?? []).find((o) => o.kind === "bid" && o.id === data.bid_id);
        if (!b) throw new Error("Bid not found");
        bidName = b.name;
      } else {
        const j = (opts ?? []).find((o) => o.kind === "service" && o.id === data.service_job_id);
        if (!j) throw new Error("Service job not found");
        jobName = j.name;
      }
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
        location_id: locationId,
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
        service_job_id: data.service_job_id ?? null,
        service_job_name: jobName,
        counted_note:
          data.counted_note ??
          (data.in_pieces && piece ? `${data.qty} ${plural(data.qty, piece.name)}` : null),
        note: [data.note, shortNote].filter(Boolean).join(" — ") || null,
        created_by: context.userId,
        created_by_name: me?.full_name?.trim() || me?.email || null,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    if (correction && data.service_job_id) {
      // The same row shape as service-field.functions.ts logEvent (kind "edit" on the Timeline).
      const signed = `${qty < 0 ? "−" : "+"}${Math.round(Math.abs(qty) * 1000) / 1000}`;
      const { error: evErr } = await sb.from("service_job_events").insert({
        service_job_id: data.service_job_id,
        kind: "edit",
        note: `Materials corrected: ${data.row_label} ${signed} ${unit}`,
        by_user: context.userId,
        by_name: me.full_name?.trim() || me.email,
        meta: { reason: data.reason, qty, unit, location_id: locationId, movement_id: inserted.id },
      });
      if (evErr) throw new Error(`Material recorded, but not on the timeline: ${evErr.message}`);
    }
    return { ok: true, id: inserted.id, qty, unit };
  });

async function locationOf(sb: SupabaseClient<Database>, id: string): Promise<InventoryLocation> {
  const { data, error } = await sb
    .from("inventory_locations")
    .select("id, name, kind, sort")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That location is not set up");
  return {
    id: data.id,
    name: data.name,
    kind: data.kind === "vehicle" ? "vehicle" : "shop",
    sort: data.sort,
  };
}

/** On hand for one cell at one location: the sum of its entries there. */
async function onHandAt(
  sb: SupabaseClient<Database>,
  locationId: string,
  cell: { screen_id: string; row_label: string; price_col: string },
): Promise<number> {
  const { data, error } = await sb
    .from("inventory_movements")
    .select("qty")
    .eq("location_id", locationId)
    .eq("screen_id", cell.screen_id)
    .eq("row_label", cell.row_label)
    .eq("price_col", cell.price_col);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((n, r) => n + Number(r.qty), 0);
}

/** The stock unit and pieces-per-pack of a catalog cell (the same rules addMovement applies). */
async function cellUnit(
  sb: SupabaseClient<Database>,
  cell: { screen_id: string; row_label: string; price_col: string },
): Promise<{ unit: string; piece: PieceDef | null }> {
  // A service material with no bid-catalog twin: stocked in its own unit, whole units only.
  if (cell.screen_id === SERVICE_STOCK_SCREEN) {
    const m = (await loadServiceMaterialLinks(sb)).find(
      (x) => !x.stock_screen_id && x.name === cell.row_label,
    );
    if (!m) throw new Error(`"${cell.row_label}" is not on the service material list`);
    return { unit: unitWord(m.unit), piece: null };
  }
  const { data: screen, error } = await sb
    .from("pricing_catalog")
    .select("data")
    .eq("id", cell.screen_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!screen) throw new Error("Catalog screen not found");
  const d = screen.data as {
    kind?: string;
    columns?: string[];
    rows?: Record<string, unknown>[];
    products?: { name: string; unit_type?: unknown }[];
  };
  let unit = stockUnitFor(cell.screen_id);
  let piece: PieceDef | null = null;
  if (d.kind === "adhesives") {
    const product = (d.products ?? []).find((p) => p.name === cell.row_label);
    if (!product) throw new Error(`"${cell.row_label}" is not on the Adhesives screen`);
    if (typeof product.unit_type === "string" && product.unit_type.trim()) {
      unit = product.unit_type.trim();
      piece = pieceDefFromUnitType(product.unit_type);
    }
  } else {
    const cols = d.columns ?? [];
    const keys = rowKeys(cols, d.rows ?? []);
    const rowIdx = keys.indexOf(cell.row_label);
    if (rowIdx < 0) throw new Error(`"${cell.row_label}" is not on this screen`);
    if (!cols.includes(cell.price_col) || cell.price_col === labelColOf(cols))
      throw new Error(`"${cell.price_col}" is not a price column on this screen`);
    const packCol = PACK_QTY_COLS.find((c) => cols.includes(c));
    const packRaw = packCol ? (d.rows ?? [])[rowIdx]?.[packCol] : undefined;
    const packQty =
      typeof packRaw === "number" ? packRaw : packRaw != null ? Number(packRaw) : null;
    piece = pieceDefFromPack(packCol, Number.isFinite(packQty) ? packQty : null);
  }
  // A service material counted in its own unit against this stock (an ISO board = 32 sq ft):
  // the truck and ticket count it in that unit (owner, Oct 6).
  const own = servicePiece(
    materialForCell(materialsByCell(await loadServiceMaterialLinks(sb)), cell),
  );
  return { unit, piece: own ?? piece };
}

const transferSchema = cellSchema.extend({
  from_location_id: z.string().min(1).max(60),
  to_location_id: z.string().min(1).max(60),
  /** Positive, as counted (pieces when in_pieces; else whole packs). */
  qty: z.number().finite().min(0),
  in_pieces: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
});

/**
 * Move stock between locations: a pair of entries sharing pair_id (−qty where it left, +qty
 * where it arrived). Loading a service vehicle is shop → vehicle; a return is vehicle → shop.
 * What a truck used goes against a service job (addMovement, consumed), never a write-off.
 * Never moves more than the source location holds. Inventory or Service access is enough.
 */
export const transferStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => transferSchema.parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: me } = await sb
      .from("profiles")
      .select("role, access, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    if (
      !me ||
      !(canAccess(me, "inventory") || canAccess(me, "estimate") || canAccess(me, "service"))
    )
      throw new Error("Forbidden: Inventory access required");
    if (data.from_location_id === data.to_location_id)
      throw new Error("Pick two different locations");
    const [from, to, { unit, piece }] = await Promise.all([
      locationOf(sb, data.from_location_id),
      locationOf(sb, data.to_location_id),
      cellUnit(sb, data),
    ]);
    const toPacks = (n: number) => {
      if (!data.in_pieces) return n;
      if (!piece)
        throw new Error("This product has no pieces-per-pack on the catalog — count whole packs");
      return packsFromPieces(n, piece);
    };
    const moved = toPacks(data.qty);
    if (moved <= 0) throw new Error("Quantity cannot be zero");
    const onHand = await onHandAt(sb, from.id, data);
    if (moved > onHand + 1e-9)
      throw new Error(
        `Only ${Math.round(onHand * 1000) / 1000} ${unit} ${from.kind === "shop" ? "on the shelf" : `on ${from.name}`}`,
      );
    const { data: itemRows } = await sb
      .from("catalog_item_numbers")
      .select("item_no")
      .eq("screen_id", data.screen_id)
      .eq("row_label", data.row_label)
      .eq("price_col", data.price_col)
      .limit(1);
    const base = {
      screen_id: data.screen_id,
      row_label: data.row_label,
      price_col: data.price_col,
      item_no: itemRows?.[0]?.item_no ?? null,
      unit,
      note: data.note ?? null,
      created_by: context.userId,
      created_by_name: me.full_name?.trim() || me.email || null,
    };
    const pairId = crypto.randomUUID();
    const counted = data.in_pieces && piece ? `${data.qty} ${plural(data.qty, piece.name)}` : null;
    const rows: Database["public"]["Tables"]["inventory_movements"]["Insert"][] = [
      {
        ...base,
        location_id: from.id,
        qty: -moved,
        reason: "transfer_out",
        pair_id: pairId,
        counted_note: counted ? `${counted} → ${to.name}` : `→ ${to.name}`,
      },
      {
        ...base,
        location_id: to.id,
        qty: moved,
        reason: "transfer_in",
        pair_id: pairId,
        counted_note: counted ? `${counted} ← ${from.name}` : `← ${from.name}`,
      },
    ];
    const { data: inserted, error: insErr } = await sb
      .from("inventory_movements")
      .insert(rows)
      .select("id");
    if (insErr) throw new Error(insErr.message);
    return { ok: true, ids: (inserted ?? []).map((r) => r.id), moved, unit, pair_id: pairId };
  });

/**
 * Undo: remove an entry you recorded in the last 24 hours (a wrong number or job); admins may
 * remove any. RLS enforces the same rule. Stock on hand and the bid's order list follow. A
 * transfer's two halves go together.
 */
export const undoMovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.number().int() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: row, error } = await sb
      .from("inventory_movements")
      .select("id, created_by, created_at, pair_id")
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
    const del = sb.from("inventory_movements").delete({ count: "exact" });
    const { error: delErr, count } = await (row.pair_id
      ? del.eq("pair_id", row.pair_id)
      : del.eq("id", data.id));
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

/** A job material can be logged against: a bid or a service job (repair ticket). */
export interface JobOption {
  kind: "bid" | "service";
  id: string;
  name: string;
  status: string;
  updated_at: string;
}
/** Bids and service jobs together, newest first (SECURITY DEFINER: a field login reads neither). */
export const listJobOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JobOption[]> => {
    const { data, error } = await context.supabase.rpc("inventory_job_options");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      kind: r.kind === "service" ? "service" : "bid",
      id: r.id,
      name: r.name,
      status: r.status,
      updated_at: r.updated_at,
    }));
  });

/**
 * Vehicle drivers (owner, Sep 26): up to two users per vehicle, a user may be on two vehicles,
 * admins change it, history is kept (a closed row has to_date). Current = to_date is null.
 */
export interface VehicleDriverRow {
  id: number;
  location_id: string;
  user_id: string;
  user_name: string;
  from_date: string;
  to_date: string | null;
}
export const listVehicleDrivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ history: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<VehicleDriverRow[]> => {
    const sb = context.supabase;
    let q = sb
      .from("vehicle_drivers")
      .select("id, location_id, user_id, from_date, to_date")
      .order("from_date", { ascending: false });
    if (!data.history) q = q.is("to_date", null);
    const [{ data: rows, error }, { data: techs }] = await Promise.all([
      q,
      sb.rpc("technician_options"),
    ]);
    if (error) throw new Error(error.message);
    const names = new Map<string, string>();
    for (const t of techs ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
    return (rows ?? []).map((r) => ({
      ...r,
      user_name: names.get(r.user_id) ?? "(no longer a user)",
    }));
  });

/** Admin: set who drives a vehicle from today. Closes anyone no longer listed, keeps history. */
export const setVehicleDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) =>
    z
      .object({
        location_id: z.string().min(1).max(60),
        user_ids: z.array(z.string().uuid()).max(2),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: me } = await sb
      .from("profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.role !== "admin") throw new Error("Forbidden: admin access required");
    const location = await locationOf(sb, data.location_id);
    if (location.kind !== "vehicle") throw new Error("Drivers are set on service vehicles only");
    // The office's day (America/New_York), not UTC's: after 8 pm Eastern UTC is tomorrow.
    const today = easternYmd();
    const { data: current, error } = await sb
      .from("vehicle_drivers")
      .select("id, user_id")
      .eq("location_id", location.id)
      .is("to_date", null);
    if (error) throw new Error(error.message);
    const keep = new Set(data.user_ids);
    const closeIds = (current ?? []).filter((r) => !keep.has(r.user_id)).map((r) => r.id);
    const have = new Set((current ?? []).map((r) => r.user_id));
    const add = data.user_ids.filter((u) => !have.has(u));
    if (closeIds.length) {
      const { error: cErr } = await sb
        .from("vehicle_drivers")
        .update({ to_date: today })
        .in("id", closeIds);
      if (cErr) throw new Error(cErr.message);
    }
    if (add.length) {
      const { error: aErr } = await sb.from("vehicle_drivers").insert(
        add.map((user_id) => ({
          location_id: location.id,
          user_id,
          from_date: today,
          created_by: context.userId,
        })),
      );
      if (aErr) throw new Error(aErr.message);
    }
    return { ok: true, closed: closeIds.length, added: add.length };
  });

/**
 * What the signed-in user's "Take from my vehicle" defaults to: the vehicles they drive today
 * and their service jobs that are still open, so material used on a call is two taps.
 */
export interface MyServiceDefaults {
  vehicle_ids: string[];
  jobs: { id: string; name: string; stage: string }[];
}
export const myServiceDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyServiceDefaults> => {
    const sb = context.supabase;
    const [{ data: drives }, { data: jobs }] = await Promise.all([
      sb
        .from("vehicle_drivers")
        .select("location_id")
        .eq("user_id", context.userId)
        .is("to_date", null),
      sb
        .from("service_jobs")
        .select("id, number, customer_name, description, stage")
        .eq("technician_id", context.userId)
        .is("deleted_at", null)
        .in("stage", ["open", "scheduled", "done"])
        .order("scheduled_date", { ascending: false })
        .limit(50),
    ]);
    return {
      vehicle_ids: [...new Set((drives ?? []).map((d) => d.location_id))],
      jobs: (jobs ?? []).map((j) => ({
        id: j.id,
        name: `#${j.number} ${j.customer_name}${j.description ? ` — ${j.description}` : ""}`,
        stage: j.stage,
      })),
    };
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
    const { data: row } = await context.supabase
      .from("inventory_movements")
      .select("pair_id")
      .eq("id", data.id)
      .maybeSingle();
    const del = context.supabase.from("inventory_movements").delete();
    const { error } = await (row?.pair_id ? del.eq("pair_id", row.pair_id) : del.eq("id", data.id));
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * The signed-in technician's truck stock for the close-out (owner, Sep 27: log material with
 * one tap, no Inventory screen). One row per cell on each vehicle they drive, with the piece
 * definition so the tap counts tubes / cartridges / fasteners, not packs.
 */
export interface TruckStockRow extends StockRow {
  location_name: string;
  piece: PieceDef | null;
  /** Catalog item number when there is exactly one for the cell. */
  item_no: string | null;
  /**
   * The service material name for the cell (owner, Oct 6: CenterPoint's names on repair tickets),
   * or null: the row keeps the catalog's label.
   */
  label: string | null;
}
export const myTruckStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ location_id: z.string().max(60).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<TruckStockRow[]> => {
    const sb = context.supabase;
    const { data: drives } = await sb
      .from("vehicle_drivers")
      .select("location_id")
      .eq("user_id", context.userId)
      .is("to_date", null);
    let vehicles = [...new Set((drives ?? []).map((d) => d.location_id))];
    if (data.location_id) vehicles = [data.location_id];
    if (!vehicles.length) return [];
    const { data: locs } = await sb
      .from("inventory_locations")
      .select("id, name")
      .in("id", vehicles);
    const names = new Map((locs ?? []).map((l) => [l.id, l.name]));
    const [{ data: moves, error }, cats, materials] = await Promise.all([
      sb
        .from("inventory_movements")
        .select("location_id, screen_id, row_label, price_col, qty, unit, created_at, item_no")
        .in("location_id", vehicles),
      categories(sb),
      loadServiceMaterialLinks(sb),
    ]);
    const byMaterial = materialsByCell(materials);
    if (error) throw new Error(error.message);
    const byCell = new Map<string, TruckStockRow>();
    for (const m of moves ?? []) {
      const key = `${m.location_id}\u0000${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
      let row = byCell.get(key);
      if (!row) {
        row = {
          location_id: m.location_id,
          location_name: names.get(m.location_id) ?? m.location_id,
          screen_id: m.screen_id,
          category: cats(m.screen_id, m.row_label),
          row_label: m.row_label,
          price_col: m.price_col,
          unit: m.unit,
          on_hand: 0,
          last_at: null,
          item_nos: [],
          item_no: m.item_no,
          piece: null,
          label: serviceLabel(byMaterial, m),
        };
        byCell.set(key, row);
      }
      row.on_hand += Number(m.qty);
      row.last_at = m.created_at;
    }
    const rows = [...byCell.values()].filter((r) => r.on_hand > 1e-9);
    // Piece definitions per distinct cell (a handful of catalog reads).
    const pieceCache = new Map<string, PieceDef | null>();
    for (const r of rows) {
      const k = `${r.screen_id}\u0000${r.row_label}\u0000${r.price_col}`;
      if (!pieceCache.has(k)) {
        try {
          pieceCache.set(k, (await cellUnit(sb, r)).piece);
        } catch {
          pieceCache.set(k, null);
        }
      }
      r.piece = pieceCache.get(k) ?? null;
      r.on_hand = Math.round(r.on_hand * 1000) / 1000;
    }
    return rows.sort(
      (a, b) =>
        a.location_name.localeCompare(b.location_name) ||
        a.category.localeCompare(b.category) ||
        a.row_label.localeCompare(b.row_label),
    );
  });
