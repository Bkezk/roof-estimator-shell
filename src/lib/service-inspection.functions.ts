/**
 * Inspection tickets (owner, Sep 30; src/lib/inspection.ts has the rules): the checklist the
 * admin keeps (inspection_checklist_items, Setup › Inspection checklist), the answers saved on the
 * ticket (service_jobs.inspection), and — from a completed inspection, at the office's choice —
 * a repair ticket linked back to it (service_jobs.from_job_id). "Create bid" is a link to the
 * estimator with the customer prefilled (bidPrefillFromInspection), so nothing is written here
 * for it. Nothing is created automatically.
 *
 * Access: Service. A technician saves only their own ticket's inspection, not once the office
 * has invoiced or closed it; only the office creates the repair ticket.
 *
 * Owner, Oct 12 (the inspection close-out flow): the checklist saves as it is answered (the
 * close-out and the ticket page autosave through saveTicketInspection; no Save button), the
 * "Recommend repairs" switch rides in the same JSON, and what the office chose afterwards is
 * recorded on the ticket (inspection_outcome: repair_ticket by createRepairFromInspection, bid or
 * none by setInspectionOutcome) with who and when, for the "Outcome: …" line.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, dispatchesTickets, isOffice, managesTickets } from "@/lib/access";
import { INSPECTION_OUTCOMES, type InspectionOutcome } from "@/lib/inspection";
import { officeStageMessage } from "@/lib/office-stage-message";
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
/** What the office chose after the inspection, as the panel shows it. */
export interface OutcomeRecord {
  outcome: InspectionOutcome;
  at: string | null;
  /** The chooser's name (profiles), or null when unknown. */
  by: string | null;
}
export interface TicketInspection {
  inspection: Inspection | null;
  checklist: ChecklistItem[];
  /** Tickets created from this inspection (repair tickets). */
  created: LinkedTicket[];
  /** The recorded outcome (service_jobs.inspection_outcome*), null until chosen. */
  outcome: OutcomeRecord | null;
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
      .select(
        "id, site_id, inspection, inspection_outcome, inspection_outcome_at, inspection_outcome_by",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Ticket not found");
    const [items, created, site, chooser] = await Promise.all([
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
      job.inspection_outcome_by
        ? sb
            .from("profiles")
            .select("full_name, email")
            .eq("id", job.inspection_outcome_by)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (items.error) throw new Error(items.error.message);
    if (created.error) throw new Error(created.error.message);
    const outcome = asOutcome(job.inspection_outcome);
    return {
      inspection: parseInspection(job.inspection),
      checklist: items.data ?? [],
      created: created.data ?? [],
      outcome: outcome
        ? {
            outcome,
            at: job.inspection_outcome_at ?? null,
            by: chooser.data ? nameOf(chooser.data) : null,
          }
        : null,
      site: site.data ?? null,
    };
  });

const asOutcome = (v: string | null | undefined): InspectionOutcome | null =>
  (INSPECTION_OUTCOMES as readonly string[]).includes(v ?? "") ? (v as InspectionOutcome) : null;

/**
 * Save the checklist answers, the "Recommend repairs" switch and the (legacy) notes — the tech on
 * their own ticket, or the office. The close-out and the ticket page autosave here as the
 * answers change (owner, Oct 12: no Save button); a field left out keeps its saved value.
 */
export const saveTicketInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        inspection: inspectionSchema
          .pick({
            items: true,
            notes: true,
            recommend_repairs: true,
            inspected_on: true,
            grade: true,
          })
          .partial({ notes: true, recommend_repairs: true, inspected_on: true, grade: true }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<Inspection> => {
    const p = await me(context);
    if (!canAccess(p, "service")) throw new Error("Forbidden: Service access required");
    const sb = context.supabase;
    const { data: job, error: jErr } = await sb
      .from("service_jobs")
      .select("id, technician_id, stage, service_type, inspection")
      .eq("id", data.id)
      .maybeSingle();
    if (jErr) throw new Error(jErr.message);
    if (!job) throw new Error("Ticket not found");
    if (job.service_type !== "inspection")
      throw new Error("Only an Inspection ticket has an inspection checklist");
    const before = parseInspection(job.inspection);
    if (isTech(p)) {
      if (job.technician_id !== context.userId)
        throw new Error("This ticket is assigned to someone else");
      // Authorized is still under review (owner, Oct 6): the message says which it is.
      if (["authorized", "invoiced", "closed"].includes(job.stage))
        throw new Error(`${officeStageMessage(job.stage)}; ask the office to change it`);
    }
    const ins: Inspection = {
      v: 1,
      items: data.inspection.items,
      notes: data.inspection.notes ?? before?.notes ?? "",
      recommend_repairs: data.inspection.recommend_repairs ?? before?.recommend_repairs ?? false,
      // Property Inspected / Property Grade (phase 2): kept when a save leaves them out.
      inspected_on: data.inspection.inspected_on ?? before?.inspected_on ?? null,
      grade: data.inspection.grade ?? before?.grade ?? null,
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
 * manager creates the tickets"); unassigned. One per inspection: a second call returns the
 * first one (`existing: true`) instead of making another.
 */
export const createRepairFromInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        /** Leak, Warranty (owner, Oct 12) or Other: the repair ticket's type. */
        service_type: z.enum(["leak", "warranty", "other"]),
        /** The repair ticket's date (every ticket has one — owner, Oct 1). */
        scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(
    async ({ data, context }): Promise<{ id: string; number: number; existing: boolean }> => {
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
      // Idempotent (audit, Oct 2: a double click made two repair tickets): the inspection's live
      // repair ticket, when there is one, is returned instead of inserting another.
      const already = await repairTicketOf(sb, job.id);
      if (already) return { ...already, existing: true };
      if (!inspectionComplete(job.stage))
        throw new Error("The inspection is not done yet; mark it Done first");
      const ins = parseInspection(job.inspection);
      if (!ins) throw new Error("The inspection checklist has not been saved on this ticket");
      const dateProblem = ticketDateProblem({ scheduled_date: data.scheduled_date });
      if (dateProblem) throw new Error(dateProblem);
      // The findings note is the ticket's closing_notes since Oct 12 (one notes box); an older
      // inspection's own notes still win when it has them.
      const text = repairTicketText(job.number, {
        items: ins.items,
        notes: ins.notes.trim() || (job.closing_notes ?? ""),
      });
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
      if (iErr) {
        // Two requests at once: the second trips service_jobs_from_job_live_idx (migration
        // 20261002120000) and gets the first one's ticket.
        if (iErr.code === "23505") {
          const made = await repairTicketOf(sb, job.id);
          if (made) return { ...made, existing: true };
        }
        throw new Error(iErr.message);
      }
      await sb.from("service_job_events").insert({
        service_job_id: job.id,
        kind: "note",
        note: `Repair ticket #${row.number} created from this inspection`,
        by_user: context.userId,
        by_name: nameOf(p),
        meta: { created_job_id: row.id } as Json,
      });
      // The outcome (owner, Oct 12): a repair ticket came of this inspection.
      await recordOutcome(sb, job.id, "repair_ticket", context.userId, nameOf(p));
      return { ...row, existing: false };
    },
  );

/** Stamp what came of the inspection: the choice, who, when (service_jobs.inspection_outcome*). */
async function recordOutcome(
  sb: SupabaseClient<Database>,
  jobId: string,
  outcome: InspectionOutcome,
  userId: string,
  name: string,
): Promise<{ at: string }> {
  const at = new Date().toISOString();
  const { error } = await sb
    .from("service_jobs")
    .update({
      inspection_outcome: outcome,
      inspection_outcome_at: at,
      inspection_outcome_by: userId,
      updated_by_name: name,
    })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
  return { at };
}

/**
 * "No action needed" or "Create bid" pressed on a completed inspection (owner, Oct 12): records
 * the outcome on the ticket — the office or a manager (dispatchesTickets: anyone with Service
 * access who is not technician-only, the people the After the inspection panel shows to). A
 * repair ticket records itself (createRepairFromInspection). The choice can be changed: the
 * latest press wins, and the timeline keeps each.
 */
export const setInspectionOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), outcome: z.enum(["bid", "none"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<OutcomeRecord> => {
    const p = await me(context);
    if (!dispatchesTickets(p))
      throw new Error("Only the office or a manager records the inspection's outcome");
    const sb = context.supabase;
    const { data: job, error } = await sb
      .from("service_jobs")
      .select("id, number, service_type, stage")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Ticket not found");
    if (job.service_type !== "inspection") throw new Error("This ticket is not an inspection");
    if (!inspectionComplete(job.stage))
      throw new Error("The inspection is not done yet; mark it Done first");
    const name = nameOf(p);
    const { at } = await recordOutcome(sb, job.id, data.outcome, context.userId, name);
    await sb.from("service_job_events").insert({
      service_job_id: job.id,
      kind: "note",
      note:
        data.outcome === "none"
          ? "Inspection outcome: no action needed"
          : "Inspection outcome: a bid was started from this inspection",
      by_user: context.userId,
      by_name: name,
      meta: { inspection_outcome: data.outcome } as Json,
    });
    return { outcome: data.outcome, at, by: name };
  });

/** The inspection's live (not deleted) repair ticket, the first made; null when none. */
async function repairTicketOf(
  sb: SupabaseClient<Database>,
  inspectionId: string,
): Promise<{ id: string; number: number } | null> {
  const { data, error } = await sb
    .from("service_jobs")
    .select("id, number")
    .eq("from_job_id", inspectionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

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
