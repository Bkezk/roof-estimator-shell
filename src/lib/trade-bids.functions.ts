/**
 * Trade Bids, the server side (owner, Nov 16: "fill it in for painting save it, fill it in for
 * siding save it, then when we click that menu item it pulls up those calculations" … "I don't
 * want that list combined with project bids, but I do want the statuses, owners page, needs
 * attention, and margin report to accurately reflect the trade bids, a saved bid should keep its
 * own numbers").
 *
 * A trade bid is a row of `bids` with kind 'trade' (20261116200000_trade_bids.sql), so its
 * status, due date, reminders, customer link, copy, delete and restore are the SAME server
 * functions a roofing bid uses (bids.functions.ts setBidStatus, setBidDueDate, duplicateBid,
 * deleteBid, restoreBid, renameBid): nothing is written twice. What is here is what differs:
 *
 *  - the trades themselves (trade_types: a job type's setup, an admin's and a manager's to
 *    change, anyone who bids may read);
 *  - the Trade Bids list (trade bids only; the Project Bids list reads roofing bids only);
 *  - opening and saving a trade bid. The price and the Margin report's figures are worked out
 *    HERE from the bid's own setup and quantities (trade-bid.ts), never taken from the browser,
 *    so what the list, the owner page and the report show is what the rules give.
 *
 * The rules a roofing bid's save has apply unchanged: a bid is linked to a customer (owner, Oct
 * 26), a new bid has a due date (Oct 12), a save from a copy older than the last save is refused
 * (Oct 6), an untitled bid is named after its customer (Nov 9).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { seesEveryone } from "@/lib/access";
import { isUntitledBid } from "@/lib/bid-name";
import { bidDeletedMessage, bidSaveIsStale, bidStaleMessage } from "@/lib/bid-stale-save";
import { bidHref } from "@/lib/bid-kind";
import { BID_WATCH_KIND, bidStepNotice } from "@/lib/work-steps";
import { bidCustomerProblem, bidDueDateProblem, bidStatusStamps } from "@/lib/bid-status";
import { nameAfterCustomer } from "@/lib/bids.functions";
import {
  asTradeBidData,
  calcTradeBid,
  emptySetup,
  tradeBidDataSchema,
  tradeFigures,
  tradeSetupSchema,
  type TradeBidData,
  type TradeSetup,
} from "@/lib/trade-bid";

type Client = SupabaseClient<Database>;

export const TRADE_SETUP_IS_MANAGERS = "Only an admin or a manager sets up a trade";
export const NOT_A_TRADE_BID = "That is a project bid. Open it from Project Bids.";

const savedBy = async (sb: Client, userId: string) => {
  const { data: me } = await sb
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", userId)
    .maybeSingle();
  return { me, name: (me?.full_name ?? "").trim() || me?.email || null };
};

/** A stored setup read back; anything malformed is an empty setup, never a crash. */
const asSetup = (x: unknown): TradeSetup => {
  const r = tradeSetupSchema.safeParse(x);
  return r.success ? r.data : emptySetup();
};

// ── The trades ─────────────────────────────────────────────────────────────────────────────────

export interface TradeTypeRow {
  id: string;
  name: string;
  updated_at: string;
  updated_by_name: string | null;
  /** How much is set up, for the list: lines of each kind. */
  measures: number;
  materials: number;
  labor: number;
}

export interface TradeType {
  id: string;
  name: string;
  setup: TradeSetup;
  updated_at: string;
}

/** Every trade, A to Z: the "New trade bid" popup's choices and the setup list. */
export const listTradeTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TradeTypeRow[]> => {
    const { data, error } = await context.supabase
      .from("trade_types")
      .select("id, name, setup, updated_at, updated_by_name")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((t) => {
      const setup = asSetup(t.setup);
      return {
        id: t.id,
        name: t.name,
        updated_at: t.updated_at,
        updated_by_name: t.updated_by_name,
        measures: setup.measures.length,
        materials: setup.materials.length,
        labor: setup.labor.length,
      };
    });
  });

async function readTradeType(sb: Client, id: string): Promise<TradeType> {
  const { data, error } = await sb
    .from("trade_types")
    .select("id, name, setup, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That trade was not found. It may have been deleted.");
  return { id: data.id, name: data.name, setup: asSetup(data.setup), updated_at: data.updated_at };
}

export const getTradeType = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(({ data, context }): Promise<TradeType> => readTradeType(context.supabase, data.id));

export const saveTradeTypeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the trade a name").max(80),
  setup: tradeSetupSchema,
  /** The trade's updated_at as this screen loaded it; a newer save by someone else is refused. */
  expectUpdatedAt: z.string().optional(),
});

/** Create or change a trade. Bids already started keep their own copy and do not change. */
export const saveTradeType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveTradeTypeSchema.parse(d))
  .handler(async ({ data, context }): Promise<TradeType> => {
    const sb = context.supabase;
    const { me, name: by } = await savedBy(sb, context.userId);
    if (!seesEveryone(me)) throw new Error(TRADE_SETUP_IS_MANAGERS);
    // One Painting, whatever the capitals (the database's unique index says the same). There
    // are a handful of trades, so every name is read and compared here: a name is never used as
    // a search pattern, where a backslash or a % in it would change what is matched.
    const { data: same, error: sErr } = await sb.from("trade_types").select("id, name");
    if (sErr) throw new Error(sErr.message);
    const clash = (same ?? []).find(
      (t) => t.id !== data.id && t.name.trim().toLowerCase() === data.name.trim().toLowerCase(),
    );
    if (clash) throw new Error(`There is already a trade called ${clash.name}`);
    const row = {
      name: data.name,
      setup: data.setup as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by_name: by,
    };
    if (data.id) {
      const cur = await readTradeType(sb, data.id);
      if (
        data.expectUpdatedAt &&
        new Date(cur.updated_at).getTime() > new Date(data.expectUpdatedAt).getTime() + 1000
      )
        throw new Error(
          "Not saved: someone else changed this trade while you had it open. Reload to see their changes.",
        );
      const { data: saved, error } = await sb
        .from("trade_types")
        .update(row)
        .eq("id", data.id)
        .select("id, name, setup, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return { ...saved, setup: asSetup(saved.setup) };
    }
    const { data: saved, error } = await sb
      .from("trade_types")
      .insert({ ...row, created_by: context.userId })
      .select("id, name, setup, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return { ...saved, setup: asSetup(saved.setup) };
  });

/** Delete a trade. Its bids stay whole: each carries its own copy of the setup. */
export const deleteTradeType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { me } = await savedBy(context.supabase, context.userId);
    if (!seesEveryone(me)) throw new Error(TRADE_SETUP_IS_MANAGERS);
    const { error } = await context.supabase.from("trade_types").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── The list ───────────────────────────────────────────────────────────────────────────────────

const LIST_COLUMNS: string =
  "id, name, status, grand_total, created_at, updated_at, updated_by_name, due_date, lost_reason, account_id, trade_type_id, trade_name:data->>trade_name, estimator_name:data->customer->>estimatorName, typed_customer:data->customer->>name, hours:figures->hours, account:crm_accounts!bids_account_id_fkey(id, name)";

export interface TradeBidListRow {
  id: string;
  name: string;
  status: string;
  grand_total: number;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  due_date: string | null;
  lost_reason: string | null;
  account_id: string | null;
  /** The linked customer profile, or null. */
  account: { id: string; name: string } | null;
  /** The customer's name as typed on the bid; "" when blank. */
  typed_customer: string;
  estimator_name: string;
  /** "Painting": the trade the bid was started from, as it was named then. */
  trade_name: string;
  trade_type_id: string | null;
  /** Labor hours of the last save; null when none were worked out. */
  hours: number | null;
}

interface RawListRow extends Omit<
  TradeBidListRow,
  "grand_total" | "typed_customer" | "estimator_name" | "trade_name" | "hours"
> {
  grand_total: number | string | null;
  typed_customer: string | null;
  estimator_name: string | null;
  trade_name: string | null;
  hours: number | string | null;
}

/** Every live trade bid, newest save first. Roofing bids are never in it. */
export const listTradeBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TradeBidListRow[]> => {
    const { data, error } = await context.supabase
      .from("bids")
      .select(LIST_COLUMNS)
      .eq("kind", "trade")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .returns<RawListRow[]>();
    if (error) throw new Error(error.message);
    return (data ?? []).map((b) => {
      const hours = b.hours == null ? NaN : Number(b.hours);
      return {
        ...b,
        grand_total: Number(b.grand_total ?? 0) || 0,
        account: b.account ? { id: b.account.id, name: b.account.name } : null,
        typed_customer: (b.typed_customer ?? "").trim(),
        estimator_name: (b.estimator_name ?? "").trim(),
        trade_name: (b.trade_name ?? "").trim(),
        hours: Number.isFinite(hours) ? hours : null,
      };
    });
  });

// ── One bid ────────────────────────────────────────────────────────────────────────────────────

export interface TradeBid {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  lost_reason: string | null;
  account_id: string | null;
  site_id: string | null;
  account: { id: string; name: string } | null;
  data: TradeBidData;
  grand_total: number;
  updated_at: string;
  updated_by_name: string | null;
  deleted_at: string | null;
}

const BID_COLUMNS =
  "id, name, status, due_date, lost_reason, account_id, site_id, data, grand_total, updated_at, updated_by_name, deleted_at, kind, account:crm_accounts!bids_account_id_fkey(id, name)";

async function readTradeBid(sb: Client, id: string): Promise<TradeBid> {
  const { data, error } = await sb.from("bids").select(BID_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That bid was not found. It may have been deleted.");
  if (data.kind !== "trade") throw new Error(NOT_A_TRADE_BID);
  const parsed = asTradeBidData(data.data);
  if (!parsed) throw new Error("This bid's saved numbers could not be read.");
  const account = data.account as { id: string; name: string } | null;
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    due_date: data.due_date,
    lost_reason: data.lost_reason,
    account_id: data.account_id,
    site_id: data.site_id,
    account: account ? { id: account.id, name: account.name } : null,
    data: parsed,
    grand_total: Number(data.grand_total ?? 0) || 0,
    updated_at: data.updated_at,
    updated_by_name: data.updated_by_name,
    deleted_at: data.deleted_at,
  };
}

export const getTradeBid = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(({ data, context }): Promise<TradeBid> => readTradeBid(context.supabase, data.id));

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The bid due date must be a day (YYYY-MM-DD)");

export const saveTradeBidSchema = z.object({
  id: z.string().uuid().optional(),
  /** Blank or "Untitled bid": the bid is named after its customer. */
  name: z.string().max(200),
  data: tradeBidDataSchema,
  /** The customer profile; absent = leave as is. A bid always ends up linked to one. */
  accountId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  /** Required on a new bid; absent = leave as is. */
  dueDate: ymd.nullable().optional(),
  /** The bid's updated_at as this screen loaded it (the stale-copy rule). */
  expectUpdatedAt: z.string().optional(),
});

/** Create or save a trade bid. A plain function so the tests call it without the wrapper. */
export async function saveTradeBidWith(
  sb: Client,
  userId: string,
  data: z.infer<typeof saveTradeBidSchema>,
): Promise<TradeBid> {
  const { name: by } = await savedBy(sb, userId);
  // The price and the report's figures: from the bid's own numbers, here.
  const result = calcTradeBid(data.data.setup, data.data.quantities);
  const now = new Date().toISOString();
  const name = isUntitledBid(data.name)
    ? await nameAfterCustomer(sb, { id: data.id, accountId: data.accountId, data: data.data })
    : data.name.trim();
  const payload = {
    name,
    data: data.data as unknown as Json,
    grand_total: result.price,
    figures: tradeFigures(result) as unknown as Json,
    updated_at: now,
    content_saved_at: now,
    updated_by_name: by,
    ...(data.accountId !== undefined ? { account_id: data.accountId } : {}),
    ...(data.siteId !== undefined ? { site_id: data.siteId } : {}),
    ...(data.dueDate !== undefined ? { due_date: data.dueDate } : {}),
  };
  if (data.id) {
    const { data: cur, error: cErr } = await sb
      .from("bids")
      .select(
        "kind, updated_at, content_saved_at, updated_by_name, status, due_date, deleted_at, account_id",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Not saved: this bid no longer exists.");
    if (cur.kind !== "trade") throw new Error(NOT_A_TRADE_BID);
    if (cur.deleted_at) throw new Error(bidDeletedMessage(cur.deleted_at));
    if (data.expectUpdatedAt && bidSaveIsStale(data.expectUpdatedAt, cur))
      throw new Error(
        bidStaleMessage(cur.updated_by_name, cur.content_saved_at ?? cur.updated_at, by),
      );
    const customerProblem = bidCustomerProblem({
      accountId: data.accountId,
      storedAccountId: cur.account_id,
    });
    if (customerProblem) throw new Error(customerProblem);
    const dueProblem = bidDueDateProblem({
      isNew: false,
      dueDate: data.dueDate,
      status: cur.status,
      hadDueDate: !!cur.due_date,
    });
    if (dueProblem) throw new Error(dueProblem);
    const { error } = await sb.from("bids").update(payload).eq("id", data.id);
    if (error) throw new Error(error.message);
    return readTradeBid(sb, data.id);
  }
  const customerProblem = bidCustomerProblem({
    accountId: data.accountId ?? null,
    storedAccountId: null,
  });
  if (customerProblem) throw new Error(customerProblem);
  const dueProblem = bidDueDateProblem({ isNew: true, dueDate: data.dueDate, status: "draft" });
  if (dueProblem) throw new Error(dueProblem);
  // The trade it was started from, when it still exists (a deleted trade leaves the pointer off).
  let tradeTypeId: string | null = null;
  if (data.data.trade_type_id) {
    const { data: t } = await sb
      .from("trade_types")
      .select("id")
      .eq("id", data.data.trade_type_id)
      .maybeSingle();
    tradeTypeId = t?.id ?? null;
  }
  const { data: made, error } = await sb
    .from("bids")
    .insert({
      ...payload,
      kind: "trade",
      trade_type_id: tradeTypeId,
      status: "draft",
      created_by: userId,
      ...bidStatusStamps(null, "draft"),
    })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  // "Each step" (owner, Nov 18; work-steps.ts): the people on the bids' line on Admin ›
  // Reminders hear a bid was started. Nobody is on it until someone picks people. Never fails
  // the save.
  {
    const { tellStep } = await import("@/lib/work-steps.server");
    await tellStep({
      key: "bid.steps",
      kind: BID_WATCH_KIND,
      notice: bidStepNotice({
        name: made.name,
        status: "draft",
        prevStatus: null,
        created: true,
        who: payload.updated_by_name ?? "Someone",
      }),
      url: bidHref({ id: made.id, kind: "trade" }),
      actorId: userId,
      sb,
    });
  }
  return readTradeBid(sb, made.id);
}

export const saveTradeBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveTradeBidSchema.parse(d))
  .handler(({ data, context }): Promise<TradeBid> =>
    saveTradeBidWith(context.supabase, context.userId, data),
  );
