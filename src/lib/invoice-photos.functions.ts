/**
 * The invoice editor's Photos fold (owner, Oct 1: "the pictures should be able to be added to
 * the invoice"): the ticket's photos with their marks, and which of them this invoice prints
 * (invoices.photo_ids; null = the default, src/lib/invoice-photos.ts). Who: whoever sees
 * invoices (`seesInvoices`, as invoices.functions.ts); the write goes through the invoice's own
 * policy (invoices_office) and is logged with the rest of the invoice (audit_row). Only a draft
 * changes: a final invoice's PDF is frozen.
 *
 * invoices.photo_ids is newer than the generated Supabase types (types.ts is regenerated after
 * the migration is applied), so the invoice's own row is read and written through an untyped
 * view of the client and checked with zod here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess, seesInvoices } from "@/lib/access";
import { chosenPhotoIds, isInvoicePhoto, storedPhotoIds } from "@/lib/invoice-photos";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
type JobPhotoRow = Database["public"]["Tables"]["service_job_photos"]["Row"];

/** The same gate as the invoice functions (invoices.functions.ts `office`). */
async function invoiceViewer(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data || !(canAccess(data, "service") || canAccess(data, "customers")))
    throw new Error("Forbidden: Service access required");
  if (!seesInvoices(data)) throw new Error("Invoices are a manager's or sales'");
  return data;
}

const invoiceHead = z.object({
  id: z.string().uuid(),
  status: z.string(),
  service_job_id: z.string().uuid(),
  photo_ids: z.array(z.string()).nullable().optional(),
});

/** The invoice's id, status, ticket and stored choice (photo_ids is not in the types yet). */
async function readInvoice(sb: SupabaseClient<Database>, id: string) {
  const loose = sb as unknown as SupabaseClient;
  const { data, error } = await loose
    .from("invoices")
    .select("id, status, service_job_id, photo_ids")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Invoice not found");
  return invoiceHead.parse(data);
}

export interface InvoicePhotos {
  invoice_id: string;
  status: string;
  /** The stored choice; null = the default. */
  photo_ids: string[] | null;
  /** What prints now (the stored choice still on the ticket, or the default). */
  chosen: string[];
  /** The ticket's photos that can print (no signature), oldest first. */
  photos: JobPhotoRow[];
  repairs: { id: string; name: string; print_on_invoice: boolean }[];
}

async function invoicePhotos(
  sb: SupabaseClient<Database>,
  inv: z.output<typeof invoiceHead>,
): Promise<InvoicePhotos> {
  const [{ data: photos, error: pErr }, { data: repairs, error: rErr }] = await Promise.all([
    sb
      .from("service_job_photos")
      .select("*")
      .eq("service_job_id", inv.service_job_id)
      .order("created_at"),
    sb
      .from("service_job_repairs")
      .select("id, name, print_on_invoice")
      .eq("service_job_id", inv.service_job_id)
      .order("sort"),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (rErr) throw new Error(rErr.message);
  const list = (photos ?? []).filter(isInvoicePhoto);
  const stored = storedPhotoIds(inv);
  return {
    invoice_id: inv.id,
    status: inv.status,
    photo_ids: stored,
    chosen: chosenPhotoIds(stored, repairs ?? [], list),
    photos: list,
    repairs: repairs ?? [],
  };
}

export const getInvoicePhotos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoicePhotos> => {
    await invoiceViewer(context);
    return invoicePhotos(context.supabase, await readInvoice(context.supabase, data.id));
  });

/** The photos to print, or null to go back to the default. */
export const setInvoicePhotosInput = z.object({
  id: z.string().uuid(),
  photo_ids: z.array(z.string().uuid()).max(200).nullable(),
});

/** Choose the photos this draft invoice prints (every id must be a photo of its ticket). */
export const setInvoicePhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => setInvoicePhotosInput.parse(d))
  .handler(async ({ data, context }): Promise<InvoicePhotos> => {
    await invoiceViewer(context);
    const sb = context.supabase;
    const inv = await readInvoice(sb, data.id);
    if (inv.status !== "draft") throw new Error("This invoice is final; void it to change it");
    let ids: string[] | null = null;
    if (data.photo_ids) {
      ids = [...new Set(data.photo_ids)];
      if (ids.length) {
        const { data: found, error } = await sb
          .from("service_job_photos")
          .select("id, role")
          .eq("service_job_id", inv.service_job_id)
          .in("id", ids);
        if (error) throw new Error(error.message);
        const ok = new Set((found ?? []).filter(isInvoicePhoto).map((p) => p.id));
        if (ids.some((id) => !ok.has(id)))
          throw new Error(
            "A chosen photo is not on this invoice's ticket (it may have been deleted)",
          );
      }
    }
    const loose = sb as unknown as SupabaseClient;
    const { data: saved, error: uErr } = await loose
      .from("invoices")
      .update({ photo_ids: ids })
      .eq("id", inv.id)
      .eq("status", "draft")
      .select("id, status, service_job_id, photo_ids")
      .maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!saved) throw new Error("The invoice was finalised meanwhile; reload it");
    return invoicePhotos(sb, invoiceHead.parse(saved));
  });
