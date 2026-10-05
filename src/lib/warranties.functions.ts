/**
 * Warranties on a site (service study M5, owner Oct 5; rules and badge in src/lib/warranty.ts).
 * Customers or Service users read and write them; RLS site_warranties_read / _write say the same
 * (migration 20261005160000_site_warranties.sql). Errors are plain messages (the screens toast
 * them).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import {
  isMissingTable,
  WARRANTIES_NOT_SET_UP,
  WARRANTY_MAX,
  warrantyProblem,
  type Warranty,
} from "@/lib/warranty";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const day = z.string().regex(YMD).nullable();
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

const COLS = "id, site_id, manufacturer, kind, number, start_date, end_date, notes";

/** A site's warranties, the one ending last first (no end = last of all). */
export const listSiteWarranties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ site_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<Warranty[]> => {
    const { data: rows, error } = await context.supabase
      .from("site_warranties")
      .select(COLS)
      .eq("site_id", data.site_id)
      .order("end_date", { ascending: false, nullsFirst: true });
    // Before the migration: no warranties yet, not an error (it blanked the page, Oct 5).
    if (error && isMissingTable(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  site_id: z.string().uuid(),
  manufacturer: z.string().trim().max(WARRANTY_MAX.manufacturer),
  kind: opt(WARRANTY_MAX.kind),
  number: opt(WARRANTY_MAX.number),
  start_date: day,
  end_date: day,
  notes: opt(WARRANTY_MAX.notes),
});
export type WarrantyInput = z.input<typeof saveSchema>;

/** Add (no id) or change a warranty. */
export const saveSiteWarranty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<Warranty> => {
    const problem = warrantyProblem(data);
    if (problem) throw new Error(problem);
    const { id, ...fields } = data;
    const q = id
      ? context.supabase.from("site_warranties").update(fields).eq("id", id)
      : context.supabase.from("site_warranties").insert(fields);
    const { data: row, error } = await q.select(COLS).maybeSingle();
    if (error) throw new Error(isMissingTable(error) ? WARRANTIES_NOT_SET_UP : error.message);
    if (!row) throw new Error("Warranty not found");
    return row;
  });

export const deleteSiteWarranty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const { error } = await context.supabase.from("site_warranties").delete().eq("id", data.id);
    if (error) throw new Error(isMissingTable(error) ? WARRANTIES_NOT_SET_UP : error.message);
  });
