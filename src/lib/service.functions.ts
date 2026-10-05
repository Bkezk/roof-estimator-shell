/**
 * Service phase A — service jobs (repair tickets), docs/service-module-design.md §6.
 * CenterPoint still dispatches and invoices; a job here carries the customer, the assigned
 * technician, the date, the stage and the CenterPoint ticket / invoice numbers, and is what
 * material off a vehicle is logged against (inventory.functions.ts).
 *
 * Access: Service. A technician (profiles.technician) may edit only jobs assigned to them —
 * RLS enforces the same rule; office users and admins edit any. Creating, dispatching, deleting
 * and every rate are a manager's or an admin's (`managesTickets`; owner, Oct 1), and so are the
 * stages Invoiced and Closed (`stageProblem`, ticket-stage.ts; owner, Oct 1).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess, isOffice, managesTickets } from "@/lib/access";
import { assignDateProblem, ticketDateProblem } from "@/lib/ticket-date";
import { dateMoveNote, dateMoveProblem } from "@/lib/followup-rules";
import { siteProblem, TICKET_DESCRIPTION_MAX } from "@/lib/ticket-form";
import { siteAddressLine } from "@/lib/crm.functions";
import { MAX_HELPERS, planCrew, type CrewRow } from "@/lib/service-crew";
import { stageProblem } from "@/lib/ticket-stage";
import { ARRIVAL_WINDOWS } from "@/lib/arrival-window";

/** The stages a technician may set (ticket-stage.ts; Invoiced and Closed are a manager's). */
export { TECH_STAGES } from "@/lib/ticket-stage";

export type ServiceJobRow = Database["public"]["Tables"]["service_jobs"]["Row"];

// Authorized (owner, Oct 5, service study M9): the owner reviews a Done ticket before the
// manager invoices it. A manager's stage, like Invoiced and Closed (ticket-stage.ts).
export const SERVICE_STAGES = [
  "open",
  "scheduled",
  "done",
  "authorized",
  "invoiced",
  "closed",
] as const;
export type ServiceStage = (typeof SERVICE_STAGES)[number];
export const STAGE_LABELS: Record<ServiceStage, string> = {
  open: "Open",
  scheduled: "Scheduled",
  done: "Done",
  authorized: "Authorized",
  invoiced: "Invoiced",
  closed: "Closed",
};
export const SERVICE_TYPES = ["leak", "scope", "warranty", "inspection", "other"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const TYPE_LABELS: Record<ServiceType, string> = {
  leak: "Leak",
  scope: "Scope",
  warranty: "Warranty",
  inspection: "Inspection",
  other: "Other",
};

/** A job row with the technician's display name joined. */
export type ServiceJobWithTech = ServiceJobRow & { technician_name: string | null };

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  return data;
}
async function serviceAccess(ctx: Ctx) {
  const p = await me(ctx);
  if (!p || !(canAccess(p, "service") || canAccess(p, "customers")))
    throw new Error("Forbidden: Service access required");
  return p;
}
async function serviceWrite(ctx: Ctx) {
  const p = await me(ctx);
  if (!p || !canAccess(p, "service")) throw new Error("Forbidden: Service access required");
  return p;
}
const nameOf = (p: { full_name: string | null; email: string } | null) =>
  (p?.full_name ?? "").trim() || p?.email || null;

async function withTechName(
  sb: SupabaseClient<Database>,
  row: ServiceJobRow,
): Promise<ServiceJobWithTech> {
  const [r] = await withTechNames(sb, [row]);
  return r as ServiceJobWithTech;
}
async function withTechNames(
  sb: SupabaseClient<Database>,
  rows: ServiceJobRow[],
): Promise<ServiceJobWithTech[]> {
  const { data: techs } = await sb.rpc("technician_options");
  const names = new Map<string, string>();
  for (const t of techs ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
  return rows.map((r) => ({
    ...r,
    technician_name: r.technician_id ? (names.get(r.technician_id) ?? null) : null,
  }));
}

/** Every ticket for the office; a technician's own tickets only (RLS filters the rows). */
export const listServiceJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceJobWithTech[]> => {
    await serviceAccess(context);
    const { data, error } = await context.supabase
      .from("service_jobs")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return withTechNames(context.supabase, data ?? []);
  });

/**
 * "Awaiting invoice": the tickets at Authorized (owner, Oct 5: the owner reviews a Done ticket,
 * then the manager invoices it; finalising moves it to Invoiced). The count is
 * the database's own (`count: "exact"`, `head: true`), not the length of a loaded list — the
 * ticket list stops at 1,000 rows, so the count and the queue built from it stopped there too
 * (audit, Oct 2). The rows are the Authorized tickets themselves, longest waiting first.
 */
export interface AwaitingInvoice {
  count: number;
  rows: ServiceJobWithTech[];
}
export const AWAITING_INVOICE_LIMIT = 1000;
/** Its query key: under "service-jobs", so invalidating the ticket list refreshes it too. */
export const AWAITING_INVOICE_KEY = ["service-jobs", "awaiting-invoice"] as const;
export const listAwaitingInvoice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AwaitingInvoice> => {
    await serviceAccess(context);
    const sb = context.supabase;
    const [counted, listed] = await Promise.all([
      sb
        .from("service_jobs")
        .select("id", { count: "exact", head: true })
        .eq("stage", "authorized")
        .is("deleted_at", null),
      sb
        .from("service_jobs")
        .select("*")
        .eq("stage", "authorized")
        .is("deleted_at", null)
        .order("completed_at", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: true })
        .limit(AWAITING_INVOICE_LIMIT),
    ]);
    if (counted.error) throw new Error(counted.error.message);
    if (listed.error) throw new Error(listed.error.message);
    return {
      count: counted.count ?? 0,
      rows: await withTechNames(sb, listed.data ?? []),
    };
  });

export const getServiceJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ServiceJobWithTech> => {
    await serviceAccess(context);
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Ticket not found");
    return withTechName(context.supabase, row);
  });

/** Optional text: missing, null or blank all become null (the DB column's "not set"). */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === "" ? null : v));

const jobSchema = z.object({
  id: z.string().uuid().optional(),
  account_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  /** The site contact (crm_contacts of the account). */
  contact_id: z.string().uuid().nullable().optional(),
  /** Labor rate kind for the invoice (service_rates): standard | urgent | emergency. */
  labor_rate_kind: z.enum(["standard", "urgent", "emergency"]).optional(),
  /** Used only when no account is linked (a one-off caller). */
  customer_name: z.string().trim().max(200).optional(),
  description: z.string().trim().max(TICKET_DESCRIPTION_MAX).default(""),
  service_type: z.enum(SERVICE_TYPES).default("leak"),
  po_number: optText(60),
  /** The job number (owner, Sep 30), next to PO #; carried to the invoice as job_code. */
  job_number: z.string().trim().max(60).nullable().optional(),
  technician_id: z.string().uuid().nullable().optional(),
  /** Old-style unnamed helpers; left as it is when not sent (a named crew keeps it in step). */
  helper_count: z.number().int().min(0).max(9).optional(),
  /**
   * The named crew (office): the lead's $ (null = default) and the other technicians with
   * theirs. Not sent = the crew is left as it is (row 0 still follows technician_id).
   */
  crew: z
    .object({
      lead_rate: z.number().finite().min(0).max(100000).nullable(),
      others: z
        .array(
          z.object({
            technician_id: z.string().uuid(),
            bill_rate: z.number().finite().min(0).max(100000).nullable(),
          }),
        )
        .max(MAX_HELPERS),
    })
    .optional(),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  /**
   * The arrival window on that day (M1, owner Oct 5): null = any time. Not sent = left as it
   * is, so a save from a screen that does not show it never clears it.
   */
  arrival_window: z.enum(ARRIVAL_WINDOWS).nullable().optional(),
  // No stage (audit, Oct 2): a stale tab's save sent the stage it had loaded and moved an
  // Invoiced ticket back to Done. setServiceStage (the header's picker) is the one way to set
  // it; a `stage` key sent here is dropped by the schema.
  notes: optText(10000),
  centerpoint_ticket: optText(40),
  centerpoint_invoice: optText(40),
  /**
   * The opportunity a new ticket was started from ("Start a ticket", owner Oct 2). Written on
   * create only; an update never changes it.
   */
  from_opportunity_id: z.string().uuid().nullable().optional(),
});
export type ServiceJobInput = z.input<typeof jobSchema>;

/**
 * Create (no id) or update a ticket. The customer / site names and the site address are
 * snapshotted from the linked account so the list reads without joins. The save never sets the
 * stage from its input: a new ticket is Scheduled when a tech and a date are set, else Open; an
 * existing ticket keeps its stage, except that an Open one that now has a technician and a day
 * becomes Scheduled. A customer with more than one live site needs the site picked
 * (lib/ticket-form.ts siteProblem). A new ticket may carry the opportunity it was started from
 * (from_opportunity_id; the caller must be able to read it).
 */
export const saveServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => jobSchema.parse(d))
  .handler(async ({ data, context }): Promise<ServiceJobWithTech> => {
    const p = await serviceWrite(context);
    // Owner, Oct 1: "The manager creates the tickets; reps do not create tickets".
    const manager = managesTickets(p);
    if (!data.id && !manager) throw new Error("Only a manager creates tickets");
    const sb = context.supabase;
    const { id, ...fields } = data;
    let customer_name = fields.customer_name ?? "";
    let site_name: string | null = null;
    let site_address: string | null = null;
    if (fields.account_id) {
      const { data: a, error } = await sb
        .from("crm_accounts")
        .select("name")
        .eq("id", fields.account_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!a) throw new Error("Customer not found");
      customer_name = a.name;
      if (fields.site_id) {
        const { data: s } = await sb
          .from("crm_sites")
          .select("name, address1, address2, city, state, zip, account_id")
          .eq("id", fields.site_id)
          .maybeSingle();
        if (!s || s.account_id !== fields.account_id)
          throw new Error("That site does not belong to the customer");
        site_name = s.name;
        site_address = siteAddressLine(s) || null;
      } else {
        // A customer with more than one site: the ticket names which (owner, Oct 1).
        const { count, error: cErr } = await sb
          .from("crm_sites")
          .select("id", { count: "exact", head: true })
          .eq("account_id", fields.account_id)
          .is("deleted_at", null);
        if (cErr) throw new Error(cErr.message);
        const problem = siteProblem({ siteCount: count ?? 0, site_id: null });
        if (problem) throw new Error(problem);
      }
    } else {
      fields.site_id = null;
    }
    if (!customer_name.trim()) throw new Error("Pick or add the customer");
    // Every ticket has a date (owner, Oct 1); a technician's save leaves it as it is.
    const dateProblem = ticketDateProblem({ id, scheduled_date: fields.scheduled_date });
    if (dateProblem) throw new Error(dateProblem);
    // A new ticket's stage; an existing ticket keeps its own (below).
    const stage: ServiceStage =
      fields.technician_id && fields.scheduled_date ? "scheduled" : "open";
    // The crew and its rates are dispatch and money: a manager's (owner, Oct 1). A technician
    // answers "who is on this job" on the close-out (setJobCrew) instead; anyone else's save
    // leaves the crew, the technician and the labor rate as they are.
    const crew = manager ? fields.crew : undefined;
    const patch = {
      account_id: fields.account_id ?? null,
      site_id: fields.site_id ?? null,
      contact_id: fields.account_id ? (fields.contact_id ?? null) : null,
      ...(fields.labor_rate_kind && manager ? { labor_rate_kind: fields.labor_rate_kind } : {}),
      customer_name,
      site_name,
      site_address,
      description: fields.description,
      service_type: fields.service_type,
      po_number: fields.po_number ?? null,
      ...(fields.job_number !== undefined ? { job_number: fields.job_number || null } : {}),
      technician_id: fields.technician_id ?? null,
      ...(fields.helper_count !== undefined ? { helper_count: fields.helper_count } : {}),
      // An update that leaves the date out keeps it (ticketDateProblem: never cleared).
      ...(fields.scheduled_date !== undefined || !id
        ? { scheduled_date: fields.scheduled_date ?? null }
        : {}),
      ...(fields.arrival_window !== undefined ? { arrival_window: fields.arrival_window } : {}),
      notes: fields.notes ?? null,
      centerpoint_ticket: fields.centerpoint_ticket ?? null,
      centerpoint_invoice: fields.centerpoint_invoice ?? null,
      updated_by_name: nameOf(p),
    };
    if (id) {
      const { data: cur, error: cErr } = await sb
        .from("service_jobs")
        .select("technician_id, stage, scheduled_date")
        .eq("id", id)
        .maybeSingle();
      if (cErr) throw new Error(cErr.message);
      if (!cur) throw new Error("Ticket not found");
      // A technician edits only their own ticket (RLS says the same; this gives a clear message).
      if (!isOffice(p) && cur.technician_id !== context.userId)
        throw new Error(
          "Only the assigned technician, the office or an admin can edit this ticket",
        );
      // Owner, Oct 1: once a ticket has a date, only an admin or a manager moves it.
      const moveProblem = dateMoveProblem({
        profile: p,
        oldYmd: cur.scheduled_date,
        newYmd: fields.scheduled_date,
      });
      if (moveProblem) throw new Error(moveProblem);
      // Dispatch is a manager's: anyone else's save keeps the assigned technician.
      if (!manager) patch.technician_id = cur.technician_id;
      // The stage is not the form's to send: the ticket keeps the one it has now. An Open ticket
      // that now has a technician and a day becomes Scheduled (nothing else moves it here).
      const scheduledNow =
        cur.stage === "open" &&
        !!patch.technician_id &&
        !!(fields.scheduled_date !== undefined ? fields.scheduled_date : cur.scheduled_date);
      if (scheduledNow) {
        const problem = stageProblem(p, "scheduled", cur.stage);
        if (problem) throw new Error(problem);
      }
      const { data: row, error } = await sb
        .from("service_jobs")
        .update(scheduledNow ? { ...patch, stage: "scheduled" } : patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await logTicketDateMove(sb, row.id, cur?.scheduled_date, row.scheduled_date, {
        id: context.userId,
        name: nameOf(p),
      });
      // Crew rows are a manager's to write (RLS service_job_techs_manage); nobody else's save
      // touches them (the technician did not change either).
      const saved = manager ? await saveCrew(sb, row, crew) : row;
      await syncTicketFollowup(saved, { id: context.userId, name: nameOf(p) }, sb, cur.stage);
      return withTechName(sb, saved);
    }
    const createProblem = stageProblem(p, stage);
    if (createProblem) throw new Error(createProblem);
    // "Start a ticket": the opportunity it came from, when the caller can read it.
    const from_opportunity_id = fields.from_opportunity_id ?? null;
    if (from_opportunity_id) {
      const { data: o, error: oErr } = await sb
        .from("crm_opportunities")
        .select("id")
        .eq("id", from_opportunity_id)
        .maybeSingle();
      if (oErr) throw new Error(oErr.message);
      if (!o) throw new Error("Opportunity not found");
    }
    const { data: row, error } = await sb
      .from("service_jobs")
      .insert({
        ...patch,
        stage,
        created_by: context.userId,
        ...(from_opportunity_id ? { from_opportunity_id } : {}),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const saved = await saveCrew(sb, row, crew);
    await syncTicketFollowup(saved, { id: context.userId, name: nameOf(p) }, sb, null);
    return withTechName(sb, saved);
  });

/**
 * After a ticket save: write the crew the office sent (the lead at row 0 = technician_id), or
 * make row 0 follow a changed technician. Returns the row as it now is (helper_count in step).
 */
async function saveCrew(
  sb: SupabaseClient<Database>,
  row: ServiceJobRow,
  crew:
    | { lead_rate: number | null; others: { technician_id: string; bill_rate: number | null }[] }
    | undefined,
): Promise<ServiceJobRow> {
  const { writeCrew, syncCrewLead } = await import("@/lib/service-crew.server");
  if (!crew) {
    await syncCrewLead(sb, row.id, row.technician_id);
    return row;
  }
  const rows = planCrew(row.technician_id, crew.lead_rate, crew.others);
  const helper_count = await writeCrew(sb, row.id, rows);
  return { ...row, helper_count };
}

/**
 * A moved date goes on the ticket's timeline ("Date moved from Oct 3, 2026 to Oct 10, 2026"), so
 * every push is on record (owner, Oct 1). Best effort: the move itself is already saved.
 */
async function logTicketDateMove(
  sb: SupabaseClient<Database>,
  jobId: string,
  oldYmd: string | null | undefined,
  newYmd: string | null | undefined,
  actor: { id: string; name: string | null },
): Promise<void> {
  const note = dateMoveNote("Date", oldYmd, newYmd);
  if (!note) return;
  const { error } = await sb.from("service_job_events").insert({
    service_job_id: jobId,
    kind: "note",
    note,
    by_user: actor.id,
    by_name: actor.name,
    meta: { date_from: oldYmd ?? null, date_to: newYmd ?? null },
  });
  if (error) console.error("Could not log the date move", error.message);
}

/** Stages at which the assignee's follow-up timer ends (Done: the tech's part is finished). */
const TICKET_CLOSING: readonly ServiceStage[] = ["done", "authorized", "invoiced", "closed"];
/** Keep the ticket's follow-up timer in step with its technician and stage (design §11). */
async function syncTicketFollowup(
  row: ServiceJobRow,
  actor: { id: string; name: string | null },
  sb: SupabaseClient<Database>,
  prevStage: string | null,
): Promise<void> {
  const { syncFollowup } = await import("@/lib/followups.server");
  const { afterTicketStage } = await import("@/lib/ticket-events.server");
  await afterTicketStage(row, prevStage, actor, sb);
  await syncFollowup(
    {
      kind: "ticket",
      itemId: row.id,
      accountId: row.account_id,
      assigneeId: row.technician_id,
      title: `Ticket #${row.number} ${row.customer_name}${row.description ? ` — ${row.description}` : ""}`,
      url: `/service?id=${row.id}`,
      closing: TICKET_CLOSING.includes(row.stage as ServiceStage) || !!row.deleted_at,
      closeReason: row.deleted_at ? "deleted" : `stage ${row.stage}`,
      dueDate: row.scheduled_date,
      actorId: actor.id,
      actorName: actor.name,
    },
    sb,
  );
}

/** Stage-only change (the header select and the tech's buttons). */
export const setServiceStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), stage: z.enum(SERVICE_STAGES) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const p = await serviceWrite(context);
    const { data: prev } = await context.supabase
      .from("service_jobs")
      .select("stage")
      .eq("id", data.id)
      .maybeSingle();
    // A technician: Open / Scheduled / Done; Invoiced and Closed: a manager's (ticket-stage.ts;
    // the database trigger service_jobs_stage_rule says the same).
    const problem = stageProblem(p, data.stage, prev?.stage);
    if (problem) throw new Error(problem);
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .update({ stage: data.stage, updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row)
      throw new Error(
        "Only the assigned technician, the office or an admin can change this ticket",
      );
    await syncTicketFollowup(
      row,
      { id: context.userId, name: nameOf(p) },
      context.supabase,
      prev?.stage ?? null,
    );
  });

/**
 * The Tech Board's drop: assign (or unassign) a technician and a day in one call. Stage moves
 * Open ↔ Scheduled with it; Done and later are left alone. Managers and admins only.
 */
export const assignServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        technician_id: z.string().uuid().nullable(),
        scheduled_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobWithTech> => {
    const p = await serviceWrite(context);
    if (!managesTickets(p)) throw new Error("Only a manager dispatches tickets");
    const dateProblem = assignDateProblem(data.scheduled_date);
    if (dateProblem) throw new Error(dateProblem);
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("service_jobs")
      .select("stage, scheduled_date")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Ticket not found");
    // A drop onto another day moves the date: an admin's or a manager's (owner, Oct 1). A drop
    // that only changes the technician on the same day needs no more than dispatching.
    const moveProblem = dateMoveProblem({
      profile: p,
      oldYmd: cur.scheduled_date,
      newYmd: data.scheduled_date,
    });
    if (moveProblem) throw new Error(moveProblem);
    const stage =
      cur.stage === "open" || cur.stage === "scheduled"
        ? data.technician_id && data.scheduled_date
          ? "scheduled"
          : "open"
        : cur.stage;
    const { data: row, error } = await sb
      .from("service_jobs")
      .update({
        technician_id: data.technician_id,
        scheduled_date: data.scheduled_date,
        stage,
        updated_by_name: nameOf(p),
      })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logTicketDateMove(sb, row.id, cur.scheduled_date, row.scheduled_date, {
      id: context.userId,
      name: nameOf(p),
    });
    // Row 0 of a named crew mirrors the technician (the board shows and moves the lead).
    const { syncCrewLead } = await import("@/lib/service-crew.server");
    await syncCrewLead(sb, row.id, row.technician_id);
    await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, sb, cur.stage);
    return withTechName(sb, row);
  });

/** Soft delete (a manager or an admin; owner, Oct 1: the manager runs the tickets). */
export const deleteServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await serviceWrite(context);
    if (!managesTickets(p)) throw new Error("Ask a manager to delete a ticket");
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .update({ deleted_at: new Date().toISOString(), updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (row)
      await syncTicketFollowup(
        row,
        { id: context.userId, name: nameOf(p) },
        context.supabase,
        row.stage,
      );
  });

export const restoreServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await serviceWrite(context);
    if (!managesTickets(p)) throw new Error("Ask a manager to restore a ticket");
    const { error } = await context.supabase
      .from("service_jobs")
      .update({ deleted_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });

export const listDeletedServiceJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceJobRow[]> => {
    await serviceAccess(context);
    const { data, error } = await context.supabase
      .from("service_jobs")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Material logged against a ticket (the inventory ledger rows that name it). */
export interface JobMaterialRow {
  id: number;
  location_id: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  qty: number;
  unit: string;
  counted_note: string | null;
  created_by_name: string | null;
  created_at: string;
}
export const listServiceJobMaterials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<JobMaterialRow[]> => {
    await serviceAccess(context);
    const { data: rows, error } = await context.supabase
      .from("inventory_movements")
      .select(
        "id, location_id, screen_id, row_label, price_col, qty, unit, counted_note, created_by_name, created_at",
      )
      .eq("service_job_id", data.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** A crew member as the ticket shows it. `bill_rate` is null for anyone but a manager (no money). */
export interface CrewMemberView extends CrewRow {
  name: string;
}
/** The ticket's named crew, the lead first. Empty: an old-style ticket (helper_count). */
export const listJobCrew = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CrewMemberView[]> => {
    const p = await serviceAccess(context);
    const sb = context.supabase;
    const { readCrew } = await import("@/lib/service-crew.server");
    const [rows, { data: techs }] = await Promise.all([
      readCrew(sb, data.id),
      sb.rpc("technician_options"),
    ]);
    const names = new Map<string, string>();
    for (const t of techs ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
    const noMoney = !managesTickets(p);
    return rows.map((r) => ({
      ...r,
      bill_rate: noMoney ? null : r.bill_rate,
      name: names.get(r.technician_id) ?? "Former technician",
    }));
  });

/**
 * What a blank $ box beside a name bills (managers only): the rate table's labor bill rates at a
 * rate kind, and the technicians' profile rates (Admin › Users).
 */
export interface CrewRateDefaults {
  table: { tech: number; helper: number };
  profiles: Record<string, number>;
}
export const getCrewRateDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ rate_kind: z.enum(["standard", "urgent", "emergency"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CrewRateDefaults> => {
    const p = await serviceAccess(context);
    if (!managesTickets(p)) throw new Error("Rates are a manager's");
    const sb = context.supabase;
    const [{ data: rates, error }, { data: prof, error: pErr }] = await Promise.all([
      sb
        .from("service_rates")
        .select("role, time_kind, bill_rate")
        .eq("rate_kind", data.rate_kind)
        .eq("time_kind", "labor"),
      sb.rpc("technician_bill_rates"),
    ]);
    if (error) throw new Error(error.message);
    if (pErr) throw new Error(pErr.message);
    const table = { tech: 0, helper: 0 };
    for (const r of rates ?? [])
      if (r.role === "tech" || r.role === "helper") table[r.role] = Number(r.bill_rate);
    const profiles: Record<string, number> = {};
    for (const r of prof ?? [])
      if (r.default_bill_rate != null) profiles[r.id] = Number(r.default_bill_rate);
    return { table, profiles };
  });
