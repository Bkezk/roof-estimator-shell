/**
 * Vendors (src/lib/vendors.ts has the rules). Anyone with Service, Customers or Inventory reads
 * them (a crew picks the supplier on a PO; the office picks an invoice's Bill To); admins and
 * managers add, change, archive and restore them (`canEditVendors`). RLS on public.vendors says
 * the same (migration 20261001110000_vendors.sql), and the database logs every change
 * (audit_row → audit_log, entity 'vendor'). Errors are thrown with a plain message; the screens
 * toast it (owner: bugs announced loudly).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import {
  VENDOR_NAME_MAX,
  canEditVendors,
  cleanVendorName,
  compareVendors,
  searchVendors,
  vendorNameClash,
} from "@/lib/vendors";
import { parseInput } from "@/lib/crm-account";

export type VendorRow = Database["public"]["Tables"]["vendors"]["Row"];

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

async function profileOf(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician")
    .eq("id", ctx.userId)
    .maybeSingle();
  return data;
}

/** Readers: Service, Customers or Inventory (the RLS twin). */
async function reader(ctx: Ctx) {
  const p = await profileOf(ctx);
  if (!p || !(canAccess(p, "service") || canAccess(p, "customers") || canAccess(p, "inventory")))
    throw new Error("Forbidden: Service, Customers or Inventory access required");
  return p;
}

/** Writers: admins and managers. */
async function editor(ctx: Ctx) {
  const p = await profileOf(ctx);
  if (!canEditVendors(p)) throw new Error("Vendors are changed by a manager or an admin");
  return p;
}

async function vendorRow(ctx: Ctx, id: string): Promise<VendorRow> {
  const { data, error } = await ctx.supabase.from("vendors").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Vendor not found");
  return data;
}

/** Postgres unique violation on the name index (the same name in another case). */
const nameTaken = (e: { code?: string; message: string }) =>
  e.code === "23505" && /vendors_name_key/.test(e.message);

/** The vendors by name; archived ones only when asked; `q` filters (searchVendors). */
export const listVendors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    parseInput(
      z.object({
        includeArchived: z.boolean().optional(),
        q: z.string().max(200).optional(),
      }),
      d ?? {},
    ),
  )
  .handler(async ({ data, context }): Promise<VendorRow[]> => {
    await reader(context);
    let q = context.supabase.from("vendors").select("*").order("name").limit(2000);
    if (!data.includeArchived) q = q.is("archived_at", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const all = rows ?? [];
    return data.q ? searchVendors(all, data.q) : [...all].sort(compareVendors);
  });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
export const vendorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z
    .string()
    .transform(cleanVendorName)
    .pipe(
      z
        .string()
        .min(1, "Enter the vendor's name")
        .max(VENDOR_NAME_MAX, `The name is at most ${VENDOR_NAME_MAX} characters`),
    ),
  address1: optText(200),
  address2: optText(200),
  city: optText(100),
  state: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null))
    .pipe(
      z
        .string()
        .regex(/^[A-Z]{2}$/, "The state is two letters, like KY")
        .nullable(),
    ),
  zip: optText(20),
  contact_name: optText(120),
  phone: optText(40),
  email: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email().max(200).nullable()), // "Email looks wrong" (parseInput)
  terms: optText(120),
  account_number: optText(60),
  notes: optText(10_000),
  billable: z.boolean().default(true),
});
export type VendorInput = z.input<typeof vendorSchema>;

/** Add a vendor (no id) or change one. The same name twice, in any case, is refused. */
export const saveVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(vendorSchema, d))
  .handler(async ({ data, context }): Promise<VendorRow> => {
    await editor(context);
    const sb = context.supabase;
    // Archived vendors too: a clash with one says so (the list hides it; the tab offers Restore).
    const { data: all, error: aErr } = await sb.from("vendors").select("id, name, archived_at");
    if (aErr) throw new Error(aErr.message);
    const clash = vendorNameClash(all ?? [], data.name, data.id);
    if (clash) throw new Error(clash.message);
    const { id, ...fields } = data;
    if (!id) {
      const { data: row, error } = await sb
        .from("vendors")
        .insert({ ...fields, created_by: context.userId })
        .select("*")
        .single();
      if (error)
        throw new Error(nameTaken(error) ? `${data.name} is already a vendor` : error.message);
      return row;
    }
    await vendorRow(context, id);
    const { data: row, error } = await sb
      .from("vendors")
      .update(fields)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error)
      throw new Error(nameTaken(error) ? `${data.name} is already a vendor` : error.message);
    if (!row) throw new Error("The vendor was not saved (no permission to change it)");
    return row;
  });

async function setArchived(ctx: Ctx, id: string, archived: boolean): Promise<VendorRow> {
  await editor(ctx);
  const prev = await vendorRow(ctx, id);
  if (!!prev.archived_at === archived)
    throw new Error(`${prev.name} is ${archived ? "already archived" : "not archived"}`);
  const { data: row, error } = await ctx.supabase
    .from("vendors")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("The vendor was not saved (no permission to change it)");
  return row;
}

/** Archive: off the pickers; its invoices and POs keep it. */
export const archiveVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<VendorRow> => setArchived(context, data.id, true));

/** Restore an archived vendor to the pickers. */
export const restoreVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<VendorRow> => setArchived(context, data.id, false));
