/**
 * Inspection tickets (owner, Sep 30; src/lib/inspection.ts has the rules): the checklist the
 * admin keeps (inspection_checklist_items, Admin › Service Rates), the answers saved on the
 * ticket (service_jobs.inspection), and — from a completed inspection, at the office's choice —
 * a repair ticket linked back to it (service_jobs.from_job_id). "Create bid" is a link to the
 * estimator with the customer prefilled (bidPrefillFromInspection), so nothing is written here
 * for it. Nothing is created automatically.
 *
 * Access: Service. A technician saves only their own ticket's inspection, not once the office
 * has invoiced or closed it; only the office creates the repair ticket.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, isOffice, managesTickets } from "@/lib/access";
import { ticketDateProblem } from "@/lib/ticket-date";
import {
  inspectionComplete,
  inspectionSchema,
  parseInspection,
  repairTicketText,
  type ChecklistItem,
  type Inspection,
} from "@/lib/inspection";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
type JobRow = Database["public"]["Tables"]["service_jobs"]["Row"];

async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data || !(canAccess(data, "service") || canAccess(data, "customers")))
    throw new Error("Forbidden: Service access required");
  return data;
}
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;
const isTech = (p: { technician: boolean; role: string }) => !isOffice(p);

// ── The checklist ─────────────────────────────────────────────────────────────────────────

export const listChecklistItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChecklistItem[]> => {
    const { data: p } = await context.supabase
      .from("profiles")
      .select("role, access")
      .eq("id", context.userId)
      .maybeSingle();
    if (!p || !(canAccess(p, "service") || canAccess(p, "customers") || p.role === "admin"))
      throw new Error("Forbidden: Service access required");
    const { data, error } = await context.supabase
      .from("inspection_checklist_items")
      .select("id, label, sort")
      .order("sort")
      .order("label");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/**
 * Replace the checklist with this list, in this order (admins and Estimate Pricing, as the other
 * service settings). Items left out are removed; inspections already done keep their answers
 * and labels (they are stored on the ticket).
 */
export const saveChecklistItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              label: z.string().trim().min(1, "Every item needs a label").max(80),
            }),
          )
          .max(60),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ChecklistItem[]> => {
    const sb = context.supabase;
    const { data: p } = await sb
      .from("profiles")
      .select("role, access")
      .eq("id", context.userId)
      .maybeSingle();
    if (!p || !(p.role === "admin" || canAccess(p, "pricing")))
      throw new Error("Forbidden: only an admin (or Estimate Pricing) edits the checklist");
    const labels = data.items.map((i) => i.label.toLowerCase());
    const dup = labels.find((l, i) => labels.indexOf(l) !== i);
    if (dup) throw new Error(`"${data.items[labels.indexOf(dup)]!.label}" is on the list twice`);
    const { data: cur, error: cErr } = await sb.from("inspection_checklist_items").select("id");
    if (cErr) throw new Error(cErr.message);
    const keep = new Set(data.items.map((i) => i.id).filter(Boolean));
    const gone = (cur ?? []).map((r) => r.id).filter((id) => !keep.has(id));
    if (gone.length) {
      const { error } = await sb.from("inspection_checklist_items").delete().in("id", gone);
      if (error) throw new Error(error.message);
    }
    for (const [i, item] of data.items.entries()) {
      const row = { label: item.label, sort: (i + 1) * 10 };
      const { error } = item.id
        ? await sb.from("inspection_checklist_items").update(row).eq("id", item.id)
        : await sb.from("inspection_checklist_items").insert(row);
      if (error) throw new Error(error.message);
    }
    const { data: rows, error } = await sb
      .from("inspection_checklist_items")
      .select("id, label, sort")
      .order("sort")
      .order("label");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── A ticket's inspection ─────────────────────────────────────────────────────────────────

export interface LinkedTicket {
  id: string;
  number: number;
  service_type: string;
  stage: string;
}
export interface TicketInspection {
  inspection: Inspection | null;
  checklist: ChecklistItem[];
  /** Tickets created from this inspection (repair tickets). */
  created: LinkedTicket[];
  /** The site's address parts, for "Create bid". */
  site: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
}

export const getTicketInspection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TicketInspection> => {
    await me(context);
    const sb = context.supabase;
    const { data: job, error } = await sb
      .from("service_jobs")
      .select("id, site_id, inspection")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Ticket not found");
    const [items, created, site] = await Promise.all([
      sb.from("inspection_checklist_items").select("id, label, sort").order("sort").order("label"),
      sb
        .from("service_jobs")
        .select("id, number, service_type, stage")
        .eq("from_job_id", job.id)
        .is("deleted_at", null)
        .order("created_at"),
      job.site_id
        ? sb
            .from("crm_sites")
            .select("address1, address2, city, state, zip")
            .eq("id", job.site_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (items.error) throw new Error(items.error.message);
    if (created.error) throw new Error(created.error.message);
    return {
      inspection: parseInspection(job.inspection),
      checklist: items.data ?? [],
      created: created.data ?? [],
      site: site.data ?? null,
    };
  });

/** Save the checklist answers and notes (the tech on their own ticket, or the office). */
export const saveTicketInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        inspection: inspectionSchema.pick({ items: true, notes: true }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<Inspection> => {
    const p = await me(context);
    if (!canAccess(p, "service")) throw new Error("Forbidden: Service access required");
    const sb = context.supabase;
    const { data: job, error: jErr } = await sb
      .from("service_jobs")
      .select("id, technician_id, stage, service_type")
      .eq("id", data.id)
      .maybeSingle();
    if (jErr) throw new Error(jErr.message);
    if (!job) throw new Error("Ticket not found");
    if (job.service_type !== "inspection")
      throw new Error("Only an Inspection ticket has an inspection checklist");
    if (isTech(p)) {
      if (job.technician_id !== context.userId)
        throw new Error("This ticket is assigned to someone else");
      if (job.stage === "invoiced" || job.stage === "closed")
        throw new Error(
          "The office has invoiced or closed this ticket; ask the office to change it",
        );
    }
    const ins: Inspection = {
      v: 1,
      items: data.inspection.items,
      notes: data.inspection.notes,
      saved_at: new Date().toISOString(),
      saved_by: nameOf(p),
    };
    const { data: row, error } = await sb
      .from("service_jobs")
      .update({ inspection: ins as unknown as Json, updated_by_name: nameOf(p) })
      .eq("id", job.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row)
      throw new Error("Only the assigned technician, the office or an admin can edit this ticket");
    return ins;
  });

/**
 * "Create repair ticket" from a completed inspection: a new Open ticket for the same customer,
 * site and contact (PO #, labor rate as on the inspection), its description and notes prefilled
 * from the Issue items, linked back (from_job_id). Managers and admins only (owner, Oct 1: "The
 * manager creates the tickets"); unassigned.
 */
export const createRepairFromInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        service_type: z.enum(["leak", "other"]),
        /** The repair ticket's date (every ticket has one — owner, Oct 1). */
        scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string; number: number }> => {
    const p = await me(context);
    if (!canAccess(p, "service") || !managesTickets(p))
      throw new Error("Only a manager creates a repair ticket");
    const sb = context.supabase;
    const { data: src, error } = await sb
      .from("service_jobs")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!src) throw new Error("Ticket not found");
    const job = src as JobRow;
    if (job.service_type !== "inspection") throw new Error("This ticket is not an inspection");
    if (!inspectionComplete(job.stage))
      throw new Error("The inspection is not done yet; mark it Done first");
    const ins = parseInspection(job.inspection);
    if (!ins) throw new Error("The inspection checklist has not been saved on this ticket");
    const dateProblem = ticketDateProblem({ scheduled_date: data.scheduled_date });
    if (dateProblem) throw new Error(dateProblem);
    const text = repairTicketText(job.number, ins);
    const { data: row, error: iErr } = await sb
      .from("service_jobs")
      .insert({
        account_id: job.account_id,
        site_id: job.site_id,
        contact_id: job.contact_id,
        customer_name: job.customer_name,
        site_name: job.site_name,
        site_address: job.site_address,
        labor_rate_kind: job.labor_rate_kind,
        po_number: job.po_number,
        description: text.description,
        notes: text.notes || null,
        service_type: data.service_type,
        scheduled_date: data.scheduled_date,
        stage: "open",
        from_job_id: job.id,
        created_by: context.userId,
        updated_by_name: nameOf(p),
      })
      .select("id, number")
      .single();
    if (iErr) throw new Error(iErr.message);
    await sb.from("service_job_events").insert({
      service_job_id: job.id,
      kind: "note",
      note: `Repair ticket #${row.number} created from this inspection`,
      by_user: context.userId,
      by_name: nameOf(p),
      meta: { created_job_id: row.id } as Json,
    });
    return row;
  });

/** The inspection a ticket came from ("From inspection #6012"). */
export const getSourceInspection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<LinkedTicket | null> => {
    await me(context);
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .select("id, number, service_type, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? null;
  });
