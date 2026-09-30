/**
 * Takeoff — server functions (docs/planswift-research.md §4). The underlay file itself is
 * uploaded by the browser straight into the private "takeoffs" storage bucket (RLS on
 * storage.objects follows the 'takeoff' page); these functions own the takeoffs rows.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { assertPageAccess } from "@/lib/auth.functions";
import { takeoffAccountFromBid } from "@/lib/takeoff/create-bid";
import type { TakeoffObject, TakeoffPage, TakeoffSetup } from "@/lib/takeoff/model";

export type TakeoffRow = Database["public"]["Tables"]["takeoffs"]["Row"];
/** The bid a takeoff last produced (its name and status), when the reader may see bids. */
export interface LinkedBid {
  id: string;
  name: string;
  status: string;
  /** The bid's customer profile, if any (a takeoff without one inherits it). */
  account_id: string | null;
}
/** The customer profile a takeoff belongs to (null when none, or not visible to this user). */
export interface LinkedAccount {
  id: string;
  name: string;
}
/**
 * A takeoff row with its linked bid and customer joined (null when none, or not visible to this
 * user — the row's own `account_id` still says whether a customer is linked).
 */
export type TakeoffWithBid = TakeoffRow & { bid: LinkedBid | null; account: LinkedAccount | null };
export const TAKEOFF_BUCKET = "takeoffs";
/** Soft-deleted takeoffs are kept this long, then purged (lazily, whenever the bin is listed). */
export const DELETED_TAKEOFF_RETENTION_DAYS = 30;
const WITH_BID =
  "*, bid:bids!takeoffs_bid_id_fkey(id, name, status, account_id), account:crm_accounts!takeoffs_account_id_fkey(id, name)";

const pageSchema = z.object({
  index: z.number().int().min(0),
  name: z.string().trim().max(120),
  rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  scale: z
    .object({
      ax: z.number(),
      ay: z.number(),
      bx: z.number(),
      by: z.number(),
      feet: z.number().positive(),
      // Where the scale came from: read off the sheet's own scale note, or drawn by hand. The
      // viewer keeps telling the user a sheet-read scale should be checked, so it must survive
      // a save.
      source: z.enum(["sheet", "drawn"]).optional(),
      note: z.string().max(120).optional(),
    })
    .nullable(),
});
const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const objectSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["area", "linear", "count"]),
  page: z.number().int().min(0),
  points: z.array(pointSchema).max(5000),
  color: z.string().max(32).optional(),
  attrs: z.record(z.string(), z.unknown()),
});
const setupSchema = z.record(z.string(), z.unknown());

const readAccess = async (ctx: {
  supabase: Parameters<typeof assertPageAccess>[0];
  userId: string;
}) => {
  try {
    await assertPageAccess(ctx.supabase, ctx.userId, "takeoff");
  } catch {
    await assertPageAccess(ctx.supabase, ctx.userId, "estimate");
  }
};
const writeAccess = (ctx: { supabase: Parameters<typeof assertPageAccess>[0]; userId: string }) =>
  assertPageAccess(ctx.supabase, ctx.userId, "takeoff");
/** Who is saving — shown on the list as "Last updated … by <name>". */
const meName = async (ctx: {
  supabase: Parameters<typeof assertPageAccess>[0];
  userId: string;
}): Promise<string | null> => {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  return (data?.full_name ?? "").trim() || data?.email || null;
};

/** The typed view of a row's JSON columns (the row itself keeps `Json`). */
export interface TakeoffDoc {
  pages: TakeoffPage[];
  setup: TakeoffSetup;
  objects: TakeoffObject[];
}
export function takeoffDoc(row: Pick<TakeoffRow, "pages" | "setup" | "objects">): TakeoffDoc {
  return {
    pages: (Array.isArray(row.pages) ? row.pages : []) as unknown as TakeoffPage[],
    setup: (row.setup && typeof row.setup === "object" && !Array.isArray(row.setup)
      ? row.setup
      : {}) as unknown as TakeoffSetup,
    objects: (Array.isArray(row.objects) ? row.objects : []) as unknown as TakeoffObject[],
  };
}

/** Safe storage object name: keep letters, digits, dot, dash, underscore. */
export function storageFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "underlay";
}

export const listTakeoffs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TakeoffWithBid[]> => {
    await readAccess(context);
    const { data, error } = await context.supabase
      .from("takeoffs")
      .select(WITH_BID)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as TakeoffWithBid[];
  });

/** The "Recently deleted" bin: soft-deleted takeoffs still inside the retention window. */
export const listDeletedTakeoffs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TakeoffRow[]> => {
    await readAccess(context);
    const cutoff = new Date(
      Date.now() - DELETED_TAKEOFF_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    // Purge anything past the window (the row; its file stays in the bucket until an admin
    // clears storage) before listing what is left.
    await context.supabase
      .from("takeoffs")
      .delete()
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    const { data, error } = await context.supabase
      .from("takeoffs")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const restoreTakeoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    const { error } = await context.supabase
      .from("takeoffs")
      .update({ deleted_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });

export const getTakeoff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TakeoffWithBid | null> => {
    await readAccess(context);
    const { data: row, error } = await context.supabase
      .from("takeoffs")
      .select(WITH_BID)
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row as unknown as TakeoffWithBid | null) ?? null;
  });

/** A customer's takeoffs, for the Customers page's Takeoffs section (newest update first). */
export interface AccountTakeoffRow {
  id: string;
  name: string;
  status: string;
  page_count: number;
  updated_at: string;
  updated_by_name: string | null;
}
export const listAccountTakeoffs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ account_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AccountTakeoffRow[]> => {
    await readAccess(context);
    const { data: rows, error } = await context.supabase
      .from("takeoffs")
      .select("id, name, status, pages, updated_at, updated_by_name")
      .eq("account_id", data.account_id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      page_count: Array.isArray(r.pages) ? r.pages.length : 0,
      updated_at: r.updated_at,
      updated_by_name: r.updated_by_name,
    }));
  });

/**
 * Create the row for a new takeoff. Returns the row with `file_path` = "<id>/<file name>" —
 * the browser then uploads the file to that path in the "takeoffs" bucket.
 */
export const createTakeoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        underlay_kind: z.enum(["pdf", "image"]),
        file_name: z.string().trim().min(1).max(255),
        file_size: z.number().int().nonnegative().max(104857600),
        pages: z.array(pageSchema).max(500),
        building_id: z.string().uuid().nullable().optional(),
        account_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<TakeoffRow> => {
    await writeAccess(context);
    const { data: inserted, error } = await context.supabase
      .from("takeoffs")
      .insert({
        name: data.name,
        underlay_kind: data.underlay_kind,
        file_name: data.file_name,
        file_size: data.file_size,
        pages: data.pages as unknown as Json,
        building_id: data.building_id ?? null,
        account_id: data.account_id ?? null,
        created_by: context.userId,
        updated_by_name: await meName(context),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const file_path = `${inserted.id}/${storageFileName(data.file_name)}`;
    const { data: row, error: e2 } = await context.supabase
      .from("takeoffs")
      .update({ file_path })
      .eq("id", inserted.id)
      .select("*")
      .single();
    if (e2) throw new Error(e2.message);
    return row;
  });

/** saveTakeoff's input: any subset of the editable fields (exported for its tests). */
export const saveTakeoffInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["draft", "done"]).optional(),
  pages: z.array(pageSchema).max(500).optional(),
  setup: setupSchema.optional(),
  objects: z.array(objectSchema).max(5000).optional(),
  building_id: z.string().uuid().nullable().optional(),
  bid_id: z.string().uuid().nullable().optional(),
  /** The customer profile (null unlinks). */
  account_id: z.string().uuid().nullable().optional(),
});

/** A saved takeoff; `inherited_account_id` is set when linking a bid gave it the bid's customer. */
export type SavedTakeoff = TakeoffRow & { inherited_account_id: string | null };

/**
 * Save any subset of the editable fields (the page autosaves pages / setup / objects). Linking a
 * bid (`bid_id`) to a takeoff that has no customer gives it the bid's customer, if the bid has
 * one (owner, Sep 30: the takeoff with the building plans belongs to the customer too).
 */
export const saveTakeoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => saveTakeoffInput.parse(d))
  .handler(async ({ data, context }): Promise<SavedTakeoff> => {
    await writeAccess(context);
    const { id, ...rest } = data;
    const patch: Database["public"]["Tables"]["takeoffs"]["Update"] = {
      updated_by_name: await meName(context),
    };
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.status !== undefined) patch.status = rest.status;
    if (rest.pages !== undefined) patch.pages = rest.pages as unknown as Json;
    if (rest.setup !== undefined) patch.setup = rest.setup as unknown as Json;
    if (rest.objects !== undefined) patch.objects = rest.objects as unknown as Json;
    if (rest.building_id !== undefined) patch.building_id = rest.building_id;
    if (rest.bid_id !== undefined) patch.bid_id = rest.bid_id;
    if (rest.account_id !== undefined) patch.account_id = rest.account_id;
    let inherited: string | null = null;
    if (rest.bid_id && rest.account_id === undefined) {
      const [{ data: cur }, { data: bid }] = await Promise.all([
        context.supabase.from("takeoffs").select("account_id").eq("id", id).maybeSingle(),
        // Null when the bid is not visible to this user (no Estimate access): nothing inherited.
        context.supabase.from("bids").select("account_id").eq("id", rest.bid_id).maybeSingle(),
      ]);
      inherited = takeoffAccountFromBid(cur?.account_id, bid?.account_id);
      if (inherited) patch.account_id = inherited;
    }
    const { data: row, error } = await context.supabase
      .from("takeoffs")
      .update(patch)
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { ...row, inherited_account_id: inherited };
  });

/**
 * Link a takeoff to a customer profile, or unlink it (null). Takeoff write access only; the
 * customer is checked to exist (and be readable) first so a bad id fails with a clear message.
 */
export const setTakeoffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), account_id: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<TakeoffWithBid> => {
    await writeAccess(context);
    if (data.account_id) {
      const { data: acct, error: aErr } = await context.supabase
        .from("crm_accounts")
        .select("id")
        .eq("id", data.account_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (aErr) throw new Error(aErr.message);
      if (!acct) throw new Error("That customer was not found (or you cannot read customers).");
    }
    const { data: row, error } = await context.supabase
      .from("takeoffs")
      .update({ account_id: data.account_id, updated_by_name: await meName(context) })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select(WITH_BID)
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as TakeoffWithBid;
  });

/** Soft delete (the row and its file stay recoverable by an admin). */
export const deleteTakeoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    const { error } = await context.supabase
      .from("takeoffs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });
