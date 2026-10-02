/**
 * Purchase orders on a service ticket (purchase-orders.ts has the rules; owner, Oct 1: the
 * CenterPoint close-out's "PO Information"). The receipt is uploaded by the browser straight
 * into the private "service" bucket at <job id>/po-<time>-<random>.<ext> (receiptObjectName,
 * like the photos); these functions record the rows.
 *
 * Who (RLS on service_job_purchase_orders says the same; the guard trigger enforces approval):
 * - read: whoever reads the ticket;
 * - add: Service access and working the ticket (the office, its lead technician, a crew member);
 * - edit / delete: admins and managers any PO; anyone else their own while it is not approved;
 * - approve: admins and managers only.
 * A PO names the supplier it was bought from as typed (vendor_text, free text — owner, Oct 2:
 * "type Lowes and it just saves"); vendor_id is set too only when the text matches a saved,
 * unarchived vendor (vendorLink). Nothing here adds to public.vendors.
 * Errors are thrown with a plain message; the screens toast it (owner: bugs announced loudly).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import {
  PO_NUMBER_MAX,
  canAddPo,
  canApprovePo,
  canEditPo,
  isReceiptPathFor,
  receiptObjectName,
} from "@/lib/purchase-orders";

export { receiptObjectName };

export type PurchaseOrderRow = Database["public"]["Tables"]["service_job_purchase_orders"]["Row"];
/** A PO as the screens show it: the row, who made / approved it, and whether I may change it. */
export interface PurchaseOrderView extends PurchaseOrderRow {
  /** The vendor's name (vendor_id), archived or not; null when none is picked. */
  vendor_name: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  can_edit: boolean;
}
export interface PurchaseOrderList {
  pos: PurchaseOrderView[];
  /** The ticket's number — a new PO's number starts as "<number>.A" (nextPoNumber). */
  ticketNumber: number | null;
  /** May I add a PO to this ticket? */
  canAdd: boolean;
  /** May I approve (admins and managers)? */
  canApprove: boolean;
}

const BUCKET = "service";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
type Me = { role: string; access: string[] | null; technician: boolean };

async function me(ctx: Ctx): Promise<Me> {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data || !(canAccess(data, "service") || canAccess(data, "customers")))
    throw new Error("Forbidden: Service or Customers access required");
  return data;
}

/** The ticket (RLS: only one I may read) and whether I lead it or am on its crew. */
async function ticketFor(ctx: Ctx, jobId: string) {
  const sb = ctx.supabase;
  const [{ data: job, error }, { data: crew, error: cErr }] = await Promise.all([
    sb.from("service_jobs").select("id, number, technician_id").eq("id", jobId).maybeSingle(),
    // Crew membership from the price-free view (no bill_rate; a technician reads nothing else).
    sb
      .from("service_job_crew")
      .select("id")
      .eq("service_job_id", jobId)
      .eq("technician_id", ctx.userId)
      .limit(1),
  ]);
  if (error) throw new Error(error.message);
  if (cErr) throw new Error(cErr.message);
  if (!job) throw new Error("Ticket not found");
  return {
    job,
    works: { lead: job.technician_id === ctx.userId, crew: (crew ?? []).length > 0 },
  };
}

async function poRow(ctx: Ctx, id: string): Promise<PurchaseOrderRow> {
  const { data, error } = await ctx.supabase
    .from("service_job_purchase_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Purchase order not found");
  return data;
}

/** A vendor a PO may newly name: one that exists and is not archived. */
async function pickableVendor(ctx: Ctx, vendorId: string) {
  const { data: v, error } = await ctx.supabase
    .from("vendors")
    .select("id, name, archived_at")
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!v) throw new Error("That vendor was not found");
  if (v.archived_at) throw new Error(`${v.name} is archived; pick another vendor`);
}

async function viewsOf(
  ctx: Ctx,
  p: Me,
  rows: PurchaseOrderRow[],
  works: { lead: boolean; crew: boolean },
): Promise<PurchaseOrderView[]> {
  const ids = [
    ...new Set(rows.flatMap((r) => [r.created_by, r.approved_by]).filter((x): x is string => !!x)),
  ];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await ctx.supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    for (const x of people ?? []) names.set(x.id, (x.full_name ?? "").trim() || x.email);
  }
  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((x): x is string => !!x))];
  const vendors = new Map<string, string>();
  if (vendorIds.length) {
    const { data: vs, error } = await ctx.supabase
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);
    if (error) throw new Error(`Could not read the POs' vendors: ${error.message}`);
    for (const v of vs ?? []) vendors.set(v.id, v.name);
  }
  return rows.map((r) => ({
    ...r,
    price: Number(r.price),
    // What was typed wins for display; a linked vendor's current name backs it up.
    vendor_name: r.vendor_text ?? (r.vendor_id ? (vendors.get(r.vendor_id) ?? null) : null),
    created_by_name: r.created_by ? (names.get(r.created_by) ?? null) : null,
    approved_by_name: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
    can_edit: canEditPo(p, ctx.userId, r, works),
  }));
}

/** A ticket's purchase orders, oldest first, with what I may do. */
export const listPurchaseOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PurchaseOrderList> => {
    const p = await me(context);
    const { job, works } = await ticketFor(context, data.jobId);
    const { data: rows, error } = await context.supabase
      .from("service_job_purchase_orders")
      .select("*")
      .eq("service_job_id", data.jobId)
      .order("po_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      pos: await viewsOf(context, p, rows ?? [], works),
      ticketNumber: job.number ?? null,
      canAdd: canAddPo(p, works),
      canApprove: canApprovePo(p),
    };
  });

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The date is YYYY-MM-DD");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const saveSchema = z.object({
  id: z.string().uuid().optional(),
  jobId: z.string().uuid(),
  po_date: ymd,
  po_number: z
    .string()
    .trim()
    .min(1, "Enter the PO #")
    .max(PO_NUMBER_MAX, `The PO # is at most ${PO_NUMBER_MAX} characters`),
  title: optText(200),
  price: z
    .number({ invalid_type_error: "Enter the price" })
    .finite()
    .min(0, "The price cannot be negative")
    .max(9_999_999_999.99, "The price is too large"),
  notes: optText(10_000),
  /** The supplier (public.vendors); null = none; undefined keeps the stored one. */
  vendor_id: z.string().uuid().nullable().optional(),
  /** The supplier as typed ("Lowes"); free text, never a new vendor; undefined keeps it. */
  vendor_text: z.string().trim().max(120).nullable().optional(),
  receipt_path: z.string().min(1).max(300).nullable().optional(),
  receipt_name: z.string().max(200).nullable().optional(),
  receipt_size: z.number().int().nonnegative().nullable().optional(),
});
export type PurchaseOrderInput = z.input<typeof saveSchema>;

/**
 * Add a PO (no id) or change one. The receipt fields: undefined keeps the stored receipt, null
 * removes it, a path (uploaded already, under the ticket's own folder) replaces it; a replaced
 * or removed receipt's object is deleted from the bucket after the row is saved.
 */
export const savePurchaseOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<PurchaseOrderView> => {
    const p = await me(context);
    const { job, works } = await ticketFor(context, data.jobId);
    if (data.receipt_path && !isReceiptPathFor(job.id, data.receipt_path))
      throw new Error("The receipt must be stored under the ticket's own folder");
    const sb = context.supabase;
    const fields = {
      po_date: data.po_date,
      po_number: data.po_number,
      title: data.title,
      price: Math.round(data.price * 100) / 100,
      notes: data.notes,
      ...(data.vendor_id === undefined ? {} : { vendor_id: data.vendor_id }),
      ...(data.vendor_text === undefined ? {} : { vendor_text: data.vendor_text || null }),
    };
    const receipt =
      data.receipt_path === undefined
        ? {}
        : {
            receipt_path: data.receipt_path,
            receipt_name: data.receipt_path ? (data.receipt_name ?? null) : null,
            receipt_size: data.receipt_path ? (data.receipt_size ?? null) : null,
          };

    let saved: PurchaseOrderRow;
    let oldReceipt: string | null = null;
    if (!data.id) {
      if (!canAddPo(p, works))
        throw new Error("Only the office or the technicians on this ticket add a PO");
      if (data.vendor_id) await pickableVendor(context, data.vendor_id);
      const { data: row, error } = await sb
        .from("service_job_purchase_orders")
        .insert({ service_job_id: job.id, ...fields, ...receipt, created_by: context.userId })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      saved = row;
    } else {
      const prev = await poRow(context, data.id);
      if (prev.service_job_id !== job.id) throw new Error("That PO is on another ticket");
      if (data.vendor_id && data.vendor_id !== prev.vendor_id)
        await pickableVendor(context, data.vendor_id);
      if (!canEditPo(p, context.userId, prev, works))
        throw new Error(
          prev.approved
            ? "An approved PO is locked; ask a manager"
            : "Only the person who added this PO or a manager changes it",
        );
      const { data: row, error } = await sb
        .from("service_job_purchase_orders")
        .update({ ...fields, ...receipt })
        .eq("id", prev.id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("The PO was not saved (no permission to change it)");
      saved = row;
      if (prev.receipt_path && prev.receipt_path !== saved.receipt_path)
        oldReceipt = prev.receipt_path;
    }
    if (oldReceipt) await sb.storage.from(BUCKET).remove([oldReceipt]);
    const [view] = await viewsOf(context, p, [saved], works);
    return view!;
  });

/** Approve or un-approve a PO: admins and managers (the guard trigger refuses anyone else). */
export const setPurchaseOrderApproved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), approved: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<PurchaseOrderView> => {
    const p = await me(context);
    if (!canApprovePo(p)) throw new Error("Only a manager approves a PO");
    const prev = await poRow(context, data.id);
    const { works } = await ticketFor(context, prev.service_job_id);
    const { data: row, error } = await context.supabase
      .from("service_job_purchase_orders")
      .update({ approved: data.approved })
      .eq("id", prev.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("The PO was not saved (no permission to change it)");
    const [view] = await viewsOf(context, p, [row], works);
    return view!;
  });

/** Delete a PO and its receipt (like deleteJobPhoto removes the photo's object). */
export const deletePurchaseOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    const prev = await poRow(context, data.id);
    const { works } = await ticketFor(context, prev.service_job_id);
    if (!canEditPo(p, context.userId, prev, works))
      throw new Error(
        prev.approved
          ? "An approved PO is locked; ask a manager"
          : "Only the person who added this PO or a manager deletes it",
      );
    const { data: gone, error } = await context.supabase
      .from("service_job_purchase_orders")
      .delete()
      .eq("id", prev.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!gone?.length) throw new Error("The PO was not deleted (no permission to delete it)");
    if (prev.receipt_path) {
      const { error: sErr } = await context.supabase.storage
        .from(BUCKET)
        .remove([prev.receipt_path]);
      if (sErr) throw new Error(`The PO is deleted but its receipt was not: ${sErr.message}`);
    }
  });
