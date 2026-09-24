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
import type { TakeoffObject, TakeoffPage, TakeoffSetup } from "@/lib/takeoff/model";

export type TakeoffRow = Database["public"]["Tables"]["takeoffs"]["Row"];
export const TAKEOFF_BUCKET = "takeoffs";

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
  .handler(async ({ context }): Promise<TakeoffRow[]> => {
    await readAccess(context);
    const { data, error } = await context.supabase
      .from("takeoffs")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getTakeoff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TakeoffRow | null> => {
    await readAccess(context);
    const { data: row, error } = await context.supabase
      .from("takeoffs")
      .select("*")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
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
        created_by: context.userId,
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

/** Save any subset of the editable fields (the page autosaves pages / setup / objects). */
export const saveTakeoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        status: z.enum(["draft", "done"]).optional(),
        pages: z.array(pageSchema).max(500).optional(),
        setup: setupSchema.optional(),
        objects: z.array(objectSchema).max(5000).optional(),
        building_id: z.string().uuid().nullable().optional(),
        bid_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<TakeoffRow> => {
    await writeAccess(context);
    const { id, ...rest } = data;
    const patch: Database["public"]["Tables"]["takeoffs"]["Update"] = {};
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.status !== undefined) patch.status = rest.status;
    if (rest.pages !== undefined) patch.pages = rest.pages as unknown as Json;
    if (rest.setup !== undefined) patch.setup = rest.setup as unknown as Json;
    if (rest.objects !== undefined) patch.objects = rest.objects as unknown as Json;
    if (rest.building_id !== undefined) patch.building_id = rest.building_id;
    if (rest.bid_id !== undefined) patch.bid_id = rest.bid_id;
    const { data: row, error } = await context.supabase
      .from("takeoffs")
      .update(patch)
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
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
