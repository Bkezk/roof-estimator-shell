/**
 * Service phase A — service jobs (repair tickets), docs/service-module-design.md §6.
 * CenterPoint still dispatches and invoices; a job here carries the customer, the assigned
 * technician, the date, the stage and the CenterPoint ticket / invoice numbers, and is what
 * material off a vehicle is logged against (inventory.functions.ts).
 *
 * Access: Service. A technician (profiles.technician) may edit only jobs assigned to them —
 * RLS enforces the same rule; office users and admins edit any. Deleting a ticket and every rate
 * are a manager's or an admin's (`managesTickets`; owner, Oct 1), and so are the stages
 * Authorized, Invoiced and Closed (`stageProblem`, ticket-stage.ts; owner, Oct 1). Creating,
 * dispatching (the technician) and moving the date are also the office's (`dispatchesTickets`;
 * owner, Oct 9: "lets make office users able to create, dispatch, and move a tickets date but
 * make that activity logged") — the database logs every service_jobs write to audit_log (the
 * ticket's History) and a date move lands on its Timeline (logTicketDateMove).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { invoiceLabel } from "@/lib/invoice-numbering";
import { ticketDeleteProblem } from "@/lib/ticket-delete-rule";
import { shiftYmd } from "@/lib/tech-clock";
import { stopClocksForOffice } from "@/lib/clock-close.server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { readProfile } from "@/lib/profile-cache.server";
import { rosterDisplayName, technicianRoster } from "@/lib/roster.server";
import {
  CLAIM_NEEDS_TICK,
  CLAIM_TAKEN,
  TICKET_CHANGED,
  canAccess,
  canClaim,
  dispatchesTickets,
  isOffice,
  managesTickets,
} from "@/lib/access";
import { assignDateProblem, ticketDateProblem } from "@/lib/ticket-date";
import { dateMoveNote, dateMoveProblem } from "@/lib/followup-rules";
import type { SyncResult } from "@/lib/followups.server";
import type { OpportunityMove } from "@/lib/opportunities.functions";
import { siteProblem, TICKET_DESCRIPTION_MAX } from "@/lib/ticket-form";
import { siteAddressLine } from "@/lib/crm.functions";
import { MAX_HELPERS, planCrew, type CrewRow } from "@/lib/service-crew";
import {
  INSPECTION_STAGE_MESSAGE,
  reopensTicket,
  stageProblem,
  stagesForType,
  TECH_LOCKED_MESSAGE,
  techStageLocked,
} from "@/lib/ticket-stage";
import { ARRIVAL_WINDOWS } from "@/lib/arrival-window";
import { assignedStage, FINISHED_UNASSIGNED_STAGES } from "@/lib/service-schedule";
import { materialsByCell, serviceLabel } from "@/lib/service-materials";
import { loadServiceMaterialLinks } from "@/lib/service-materials.server";
import { FINISHED_STAGES } from "@/lib/ticket-stages";

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
/**
 * The ticket types (owner, Nov 2: "just call it repair, the pictures will tell the story" — Leak
 * became Repair, and Scope, which no ticket ever used and which did nothing a Repair did not,
 * went; migration 20261102230000 moved the rows).
 */
export const SERVICE_TYPES = ["repair", "warranty", "inspection", "other"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const TYPE_LABELS: Record<ServiceType, string> = {
  repair: "Repair",
  warranty: "Warranty",
  inspection: "Inspection",
  other: "Other",
};

/** A job row with the technician's display name joined. */
export type ServiceJobWithTech = ServiceJobRow & {
  technician_name: string | null;
  /**
   * The signature image's signed link, when the row came from getTicketBundle (the Nov 4 check,
   * finding 6: the browser signed it on its own, one more round trip on every ticket page). A
   * signature saved since has a new path, so the screens use this only while it names
   * `signature_path`; otherwise they sign their own, as before.
   */
  signature_url?: string | null;
  /** A new ticket's move of its opportunity (saveServiceJob's create; owner, Nov 13). */
  opportunity_move?: OpportunityMove;
  /** The ticket is saved but its opportunity did not move: why, said out loud by the page. */
  opportunity_move_error?: string;
};

/**
 * The columns the ticket LIST, the Tech Board and the Awaiting invoice queue read (Nov 3, review
 * item 39): what their cards, chips and filters show — not the checklist JSON, the notes, the
 * closing notes or the signature, which only the ticket page needs (`getServiceJob` still reads
 * the whole row). The property's city and state are the ticket's own columns since
 * 20261103170000 (item 41: they used to be a second query on every read).
 */
export const LIST_JOB_COLUMNS =
  "id, number, stage, service_type, scheduled_date, arrival_window, technician_id, account_id, site_id, customer_name, site_name, site_address, site_city, site_state, location_id, location_name, description, po_number, job_number, centerpoint_ticket, centerpoint_invoice, labor_rate_kind, field_status, stage_changed_at, completed_at, created_at, updated_at, updated_by_name, deleted_at, helper_count" as const;
type ListJobColumn =
  | "id"
  | "number"
  | "stage"
  | "service_type"
  | "scheduled_date"
  | "arrival_window"
  | "technician_id"
  | "account_id"
  | "site_id"
  | "customer_name"
  | "site_name"
  | "site_address"
  | "site_city"
  | "site_state"
  | "location_id"
  | "location_name"
  | "description"
  | "po_number"
  | "job_number"
  | "centerpoint_ticket"
  | "centerpoint_invoice"
  | "labor_rate_kind"
  | "field_status"
  | "stage_changed_at"
  | "completed_at"
  | "created_at"
  | "updated_at"
  | "updated_by_name"
  | "deleted_at"
  | "helper_count";
/** One ticket as the lists read it (LIST_JOB_COLUMNS), with its technician's name. */
export type ServiceJobListRow = Pick<ServiceJobRow, ListJobColumn> & {
  technician_name: string | null;
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

// The caller's profile, once a minute per user rather than once per call (Nov 3, review item 36;
// lib/profile-cache.server.ts).
async function me(ctx: Ctx) {
  return readProfile(ctx.supabase, ctx.userId);
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
async function withTechNames<T extends { technician_id: string | null }>(
  sb: SupabaseClient<Database>,
  rows: T[],
): Promise<(T & { technician_name: string | null })[]> {
  // Once per request (Nov 3, review item 44; roster.server.ts).
  const techs = await technicianRoster(sb);
  const names = new Map<string, string>();
  for (const t of techs) names.set(t.id, rosterDisplayName(t));
  return rows.map((r) => ({
    ...r,
    technician_name: r.technician_id ? (names.get(r.technician_id) ?? null) : null,
  }));
}

/** Every ticket for the office; a technician's own tickets only (RLS filters the rows). */
export const listServiceJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceJobListRow[]> => {
    await serviceAccess(context);
    const { data, error } = await context.supabase
      .from("service_jobs")
      .select(LIST_JOB_COLUMNS)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return withTechNames(context.supabase, data ?? []);
  });

/**
 * The Tech Board's tickets for one Monday–Sunday week (owner, Oct 14: "once assigned a day and
 * tech it should really stay on the board regardless of step or time"). listServiceJobs stops at
 * the 1,000 most recently updated tickets, so a ticket assigned to a day in the viewed week could
 * fall off the board once a thousand others had been touched since — after the CenterPoint ticket
 * import, most weeks. This reads exactly what the board draws, with no cap that matters:
 *   - every ticket with a technician and a date inside the week, at any stage (Open through
 *     Closed: the chip stays in its cell and takes the stage's colour as the work progresses);
 *   - every Open / Scheduled ticket with no technician or no date (the Unassigned rail).
 * Each read is capped only as a guard (a week holds far fewer than 1,000 cells' worth).
 */
export const BOARD_WEEK_LIMIT = 1000;
export const listBoardJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobListRow[]> => {
    await serviceAccess(context);
    const sb = context.supabase;
    // A finished ticket is filed by its completed day (boardDay), which may fall in this week
    // while its scheduled date does not (owner, Oct 15): read those too, a day wide each side
    // so the viewer's calendar day never falls outside the UTC bounds. The fourth read (Nov 3,
    // review item 9): finished tickets with no technician — Done, Authorized or Invoiced without
    // anyone's name on them — which sat in no cell and not in the rail, so the board hid them.
    const [week, finished, rail, finishedUnassigned] = await Promise.all([
      sb
        .from("service_jobs")
        .select(LIST_JOB_COLUMNS)
        .is("deleted_at", null)
        .not("technician_id", "is", null)
        .gte("scheduled_date", data.from)
        .lte("scheduled_date", data.to)
        .order("number", { ascending: true })
        .limit(BOARD_WEEK_LIMIT),
      sb
        .from("service_jobs")
        .select(LIST_JOB_COLUMNS)
        .is("deleted_at", null)
        .not("technician_id", "is", null)
        .in("stage", [...FINISHED_STAGES])
        .gte("completed_at", `${shiftYmd(data.from, -1)}T00:00:00Z`)
        .lte("completed_at", `${shiftYmd(data.to, 1)}T23:59:59Z`)
        .order("number", { ascending: true })
        .limit(BOARD_WEEK_LIMIT),
      sb
        .from("service_jobs")
        .select(LIST_JOB_COLUMNS)
        .is("deleted_at", null)
        .in("stage", ["open", "scheduled"])
        .or("technician_id.is.null,scheduled_date.is.null")
        .order("created_at", { ascending: true })
        .limit(BOARD_WEEK_LIMIT),
      sb
        .from("service_jobs")
        .select(LIST_JOB_COLUMNS)
        .is("deleted_at", null)
        .is("technician_id", null)
        .in("stage", [...FINISHED_UNASSIGNED_STAGES])
        .order("stage_changed_at", { ascending: true, nullsFirst: false })
        .limit(BOARD_WEEK_LIMIT),
    ]);
    if (week.error) throw new Error(week.error.message);
    if (finished.error) throw new Error(finished.error.message);
    if (rail.error) throw new Error(rail.error.message);
    if (finishedUnassigned.error) throw new Error(finishedUnassigned.error.message);
    const seen = new Set<string>();
    const rows = [
      ...(week.data ?? []),
      ...(finished.data ?? []),
      ...(rail.data ?? []),
      ...(finishedUnassigned.data ?? []),
    ].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    return withTechNames(sb, rows);
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
  rows: ServiceJobListRow[];
}
export const AWAITING_INVOICE_LIMIT = 1000;
/** Its query key: under "service-jobs", so invalidating the ticket list refreshes it too. */
export const AWAITING_INVOICE_KEY = ["service-jobs", "awaiting-invoice"] as const;
export const listAwaitingInvoice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AwaitingInvoice> => {
    await serviceAccess(context);
    const sb = context.supabase;
    // One read (Nov 3): the rows and the database's exact count together.
    const { data, count, error } = await sb
      .from("service_jobs")
      .select(LIST_JOB_COLUMNS, { count: "exact" })
      .eq("stage", "authorized")
      .is("deleted_at", null)
      .order("completed_at", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: true })
      .limit(AWAITING_INVOICE_LIMIT);
    if (error) throw new Error(error.message);
    return {
      count: count ?? data?.length ?? 0,
      rows: await withTechNames(sb, data ?? []),
    };
  });

/**
 * The Invoices tab's badge (Nov 3, review item 40): the count alone. Every page with the Service
 * tabs used to read the whole Authorized queue (up to 1,000 rows with names) to show a number.
 * Under the same key family as the queue, so a stage change refreshes both.
 */
export const AWAITING_INVOICE_COUNT_KEY = ["service-jobs", "awaiting-invoice", "count"] as const;
export const countAwaitingInvoice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ count: number }> => {
    await serviceAccess(context);
    const { count, error } = await context.supabase
      .from("service_jobs")
      .select("id", { count: "exact", head: true })
      .eq("stage", "authorized")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
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
  /** The site inside the property (property_sites; owner, Oct 6). Left out: as it is. */
  location_id: z.string().uuid().nullable().optional(),
  /** The site contact (crm_contacts of the account). */
  contact_id: z.string().uuid().nullable().optional(),
  /** Labor rate kind for the invoice (service_rates): standard | urgent | emergency. */
  labor_rate_kind: z.enum(["standard", "urgent", "emergency"]).optional(),
  /** Used only when no account is linked (a one-off caller). */
  customer_name: z.string().trim().max(200).optional(),
  description: z.string().trim().max(TICKET_DESCRIPTION_MAX).default(""),
  service_type: z.enum(SERVICE_TYPES).default("repair"),
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
    // Money (crew, rates): a manager's (owner, Oct 1). Creating and dispatching: the office too
    // (owner, Oct 9: "lets make office users able to create, dispatch, and move a tickets date
    // but make that activity logged"; a technician-only user still neither).
    const manager = managesTickets(p);
    const dispatcher = dispatchesTickets(p);
    if (!data.id && !dispatcher) throw new Error("Only the office or a manager creates tickets");
    const sb = context.supabase;
    const { id, ...fields } = data;
    let customer_name = fields.customer_name ?? "";
    let site_name: string | null = null;
    let site_address: string | null = null;
    let site_city: string | null = null;
    let site_state: string | null = null;
    let location_name: string | null = null;
    if (!fields.account_id) fields.site_id = null;
    // The customer, the property (or the property count) and the site are read together (Nov 3,
    // review item 44): they were one after another, three round trips before the write.
    const [accountRead, siteRead, siteCountRead, locationRead] = await Promise.all([
      fields.account_id
        ? sb.from("crm_accounts").select("name").eq("id", fields.account_id).maybeSingle()
        : null,
      fields.account_id && fields.site_id
        ? sb
            .from("crm_sites")
            .select("name, address1, address2, city, state, zip, account_id")
            .eq("id", fields.site_id)
            .maybeSingle()
        : null,
      fields.account_id && !fields.site_id
        ? sb
            .from("crm_sites")
            .select("id", { count: "exact", head: true })
            .eq("account_id", fields.account_id)
            .is("deleted_at", null)
        : null,
      // The site inside the property (owner, Oct 6): one of that property's, its name kept.
      fields.location_id
        ? sb
            .from("property_sites")
            .select("name, property_id")
            .eq("id", fields.location_id)
            .maybeSingle()
        : null,
    ]);
    if (accountRead) {
      if (accountRead.error) throw new Error(accountRead.error.message);
      const a = accountRead.data;
      if (!a) throw new Error("Customer not found");
      customer_name = a.name;
      if (siteRead) {
        const s = siteRead.data;
        if (!s || s.account_id !== fields.account_id)
          throw new Error("That property does not belong to the customer");
        site_name = s.name;
        site_address = siteAddressLine(s) || null;
        site_city = s.city;
        site_state = s.state;
      } else if (siteCountRead) {
        // A customer with more than one site: the ticket names which (owner, Oct 1).
        if (siteCountRead.error) throw new Error(siteCountRead.error.message);
        const problem = siteProblem({ siteCount: siteCountRead.count ?? 0, site_id: null });
        if (problem) throw new Error(problem);
      }
    }
    if (fields.location_id) {
      const loc = locationRead?.data;
      if (!loc || loc.property_id !== fields.site_id)
        throw new Error("That site is not at this property — pick the site again");
      location_name = loc.name;
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
      site_city,
      site_state,
      ...(fields.location_id !== undefined
        ? { location_id: fields.location_id, location_name }
        : {}),
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
      // (technician_id and scheduled_date also feed the technician's reassigned / date-moved
      // notices after the save — ticket-events.server.ts afterTicketDispatch.)
      if (cErr) throw new Error(cErr.message);
      if (!cur) throw new Error("Ticket not found");
      // A technician edits only their own ticket (RLS says the same; this gives a clear message).
      if (!isOffice(p) && cur.technician_id !== context.userId)
        throw new Error(
          "Only the assigned technician, the office or an admin can edit this ticket",
        );
      // Owner, Oct 6: a technician cannot change a ticket once it is Authorized, Invoiced or
      // Closed (RLS service_jobs_update says the same, 20261006190000); the office still may.
      if (techStageLocked(p, cur.stage)) throw new Error(TECH_LOCKED_MESSAGE);
      // Owner, Oct 1: once a ticket has a date, a technician does not move it; Oct 9: the office
      // and managers do (logged on the Timeline below and in History by the database).
      const moveProblem = dateMoveProblem({
        profile: p,
        oldYmd: cur.scheduled_date,
        newYmd: fields.scheduled_date,
        kind: "ticket",
      });
      if (moveProblem) throw new Error(moveProblem);
      // Dispatch is the office's and a manager's: anyone else's save keeps the technician.
      if (!dispatcher) patch.technician_id = cur.technician_id;
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
      // The crew: a manager's save writes what the form sent; anyone else's save (the office
      // dispatching — Nov 4, bug 1 of the Nov 3 review) still moves the lead row to the new
      // technician through set_job_crew, so the crew, is_on_crew and the invoice follow.
      const saved = await saveCrew(sb, row, manager ? crew : undefined);
      await syncTicketFollowup(saved, { id: context.userId, name: nameOf(p) }, sb, cur.stage, cur);
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
    const out = await withTechName(sb, saved);
    // A ticket moves its opportunity (owner, Nov 13): an inspection started from an open one makes
    // it Contacted, a repair ticket makes it Won — by the database's rule, whoever creates the
    // ticket (opportunities.functions.ts moveOpportunityFromTicket). The ticket is saved either
    // way; what happened to the opportunity goes back with it so the page says it out loud.
    if (!saved.from_opportunity_id) return out;
    const { movedByTicket } = await import("@/lib/opportunities.functions");
    return { ...out, ...(await movedByTicket(context, saved.id)) };
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
const TICKET_CLOSING: readonly ServiceStage[] = FINISHED_STAGES;
/**
 * Keep the ticket's follow-up timer in step with its technician and stage (design §11). With
 * `before` (the technician and day as they were, from the paths that may change them: the save,
 * the Board's drop) the technician hears of a reassignment or a moved day (owner, Oct 12, item
 * 9; ticket-events.server.ts afterTicketDispatch) — once, from here, whichever path it was.
 * `quiet` (followups.server.ts SyncArgs): a timer started here sends the technician no "assigned"
 * notice — the restore of a deleted ticket (owner, Oct 12, item 5), which is not a new assignment.
 * `reopened` (Oct 21, the eighth audit): the ticket is back at Open / Scheduled from Done or an
 * office stage, so the timer started here says "Reopened: Ticket #…", not "assigned to you" (the
 * wording opportunities have had since Oct 2; setServiceStage never asked for it).
 * Answers what the sync did (SyncResult; Oct 20: "snooze_cleared" when a date move ended the
 * follow-up's hold, which assignServiceJob passes on for Work Overview's toast).
 */
async function syncTicketFollowup(
  row: ServiceJobRow,
  actor: { id: string; name: string | null },
  sb: SupabaseClient<Database>,
  prevStage: string | null,
  before?: { technician_id: string | null; scheduled_date: string | null },
  opts: { quiet?: boolean; reopened?: boolean } = {},
): Promise<SyncResult> {
  const { syncFollowup } = await import("@/lib/followups.server");
  const { afterTicketStage, afterTicketDispatch } = await import("@/lib/ticket-events.server");
  // The stage notices and the Authorize timer (afterTicketStage) only when the stage moved, the
  // ticket was deleted, or it came back (a restore re-syncs, `quiet`) — Nov 3, review item 44:
  // it ran on every save and dispatch, three or four round trips for nothing.
  if (prevStage !== row.stage || !!row.deleted_at || opts.quiet)
    await afterTicketStage(row, prevStage, actor, sb);
  if (before) await afterTicketDispatch(row, before, actor, sb);
  return syncFollowup(
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
      ...(opts.quiet ? { quiet: true } : {}),
      ...(opts.reopened ? { reopened: true } : {}),
    },
    sb,
  );
}

/**
 * Stage-only change (the header select and the tech's buttons). An office stage (Authorized /
 * Invoiced / Closed) first stops any technician's clock still running on the ticket and writes
 * its time (clock-close.server.ts; owner, Oct 28: "if the office closes it shouldn't it just
 * close the time?") — before the stage write, and the move is refused when that fails, so no
 * clock is left that its owner can no longer close.
 */
export const setServiceStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), stage: z.enum(SERVICE_STAGES) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const p = await serviceWrite(context);
    // A failed read is an error, not a stage write with the clock and the reopen rules skipped
    // (Nov 4, bug 15 of the Nov 3 review).
    const { data: prev, error: prevErr } = await context.supabase
      .from("service_jobs")
      .select("stage, number, service_type")
      .eq("id", data.id)
      .maybeSingle();
    if (prevErr) throw new Error(prevErr.message);
    if (!prev) throw new Error("Ticket not found");
    // A technician: Open / Scheduled / Done; Invoiced and Closed: a manager's (ticket-stage.ts;
    // the database trigger service_jobs_stage_rule says the same).
    const problem = stageProblem(p, data.stage, prev.stage);
    if (problem) throw new Error(problem);
    // An inspection ends at Authorized (ticket-stage.ts stagesForType) — the picker knew, the
    // server did not (Nov 4, bug 16).
    if (!stagesForType(prev.service_type).includes(data.stage))
      throw new Error(INSPECTION_STAGE_MESSAGE);
    const { stopped } =
      prev.stage !== data.stage
        ? await stopClocksForOffice(
            context.supabase,
            { id: data.id, number: prev.number },
            data.stage,
            { id: context.userId, name: nameOf(p) },
          )
        : { stopped: 0 };
    // Back to Open / Scheduled from Done (or an office stage): the ticket is reopened, so the
    // first visit's close-out stamp goes with the move (ticket-stage.ts reopensTicket, Oct 21).
    const reopened = reopensTicket(prev.stage, data.stage);
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .update({
        stage: data.stage,
        updated_by_name: nameOf(p),
        ...(reopened ? { completed_at: null } : {}),
        // A stopped clock's technician is no longer en route / on site here.
        ...(stopped ? { field_status: null } : {}),
      })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row)
      throw new Error(
        "Only the assigned technician, the office or an admin can change this ticket",
      );
    // A reopen tells the technician "reopened", not "assigned to you" (Oct 21, the eighth audit):
    // the timer closed at Done starts again here, and the notice should say why.
    await syncTicketFollowup(
      row,
      { id: context.userId, name: nameOf(p) },
      context.supabase,
      prev.stage,
      undefined,
      { reopened },
    );
  });

/**
 * The Tech Board's drop: assign (or unassign) a technician and a day in one call. Stage moves
 * Open ↔ Scheduled with it (assignedStage); Done and later are left alone, and a date-only move
 * of a Scheduled ticket stays Scheduled — one write, no bounce through Open, so the follow-up
 * keeps its timer and only "Date moved …" is logged (owner, Oct 9: cross-week reschedule in one
 * drag). Managers, admins and the office (`dispatchesTickets`; owner, Oct 9).
 *
 * Oct 21 (the seventh audit): Work Overview's drag sends `expect_technician_id`, the technician
 * its row showed. The row can be five minutes old; until now a drop wrote that technician back
 * unconditionally, so a ticket somebody had reassigned in between went back to its old person
 * (who was told "reassigned", and whose follow-up timer came back), and one marked Done in
 * between had its date moved. With the flag the ticket must still be that technician's and still
 * Open / Scheduled, both before and in the write — else TICKET_CHANGED and nothing is written.
 *
 * Oct 21 (the eighth audit): the guard covered the technician and the stage but not the day. A
 * moves a ticket Oct 22 → Oct 25; B's page still shows Oct 22 and drags it to Oct 23: the guard
 * passed, Oct 23 was written over A's Oct 25, "Date moved from Oct 25 to Oct 23" went on the
 * timeline and the technician heard of a move nobody meant. The drag now also sends
 * `expect_scheduled_date`, the day its row showed (null: none), checked the same two ways. A
 * move that names the technician but not the day comes from a page built before this check and
 * is told to reload (MOVE_NEEDS_DAY) rather than guessed at.
 */
const MOVABLE_STAGES: readonly string[] = ["open", "scheduled"];
export const MOVE_NEEDS_DAY = "Your page is out of date — reload it and try again";
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
        // Work Overview's "Assign to…" on an Unassigned row (Oct 15): the ticket must still
        // have nobody on it, or the call fails with CLAIM_TAKEN — two dispatchers handing out
        // the same ticket cannot both succeed. A plain reassignment (the Board, the ticket page)
        // leaves it out and overwrites as before.
        expect_unassigned: z.boolean().optional(),
        // Work Overview's drag onto another day (Oct 21): the technician the row showed, who
        // must still be on the ticket (see above). The Board and the ticket page leave it out.
        expect_technician_id: z.string().uuid().optional(),
        // And the day the row showed (Oct 21, the eighth audit): null for a row without one.
        // Required with expect_technician_id (see above); meaningless without it.
        expect_scheduled_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobWithTech & { snooze_cleared: boolean }> => {
    const p = await serviceWrite(context);
    if (!dispatchesTickets(p)) throw new Error("Only the office or a manager dispatches tickets");
    const dateProblem = assignDateProblem(data.scheduled_date);
    if (dateProblem) throw new Error(dateProblem);
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("service_jobs")
      .select("stage, scheduled_date, technician_id")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Ticket not found");
    if (data.expect_unassigned && cur.technician_id) throw new Error(CLAIM_TAKEN);
    // A move from a stale row (Oct 21): the ticket was reassigned or finished since the page
    // loaded — refused, so the drop cannot hand it back or move finished work.
    if (data.expect_technician_id) {
      if (cur.technician_id !== data.expect_technician_id) throw new Error(TICKET_CHANGED);
      if (!MOVABLE_STAGES.includes(cur.stage)) throw new Error(TICKET_CHANGED);
      // And still on the day the row showed (the eighth audit) — a move that does not say which
      // day it saw comes from a page built before this check.
      if (data.expect_scheduled_date === undefined) throw new Error(MOVE_NEEDS_DAY);
      if ((cur.scheduled_date ?? null) !== data.expect_scheduled_date)
        throw new Error(TICKET_CHANGED);
    }
    // A drop onto another day moves the date: the office's or a manager's (owner, Oct 1 / Oct 9;
    // logged below). A drop that only changes the technician on the same day needs no more than
    // dispatching.
    const moveProblem = dateMoveProblem({
      profile: p,
      oldYmd: cur.scheduled_date,
      newYmd: data.scheduled_date,
      kind: "ticket",
    });
    if (moveProblem) throw new Error(moveProblem);
    const stage = assignedStage(cur.stage, data.technician_id, data.scheduled_date);
    let uq = sb
      .from("service_jobs")
      .update({
        technician_id: data.technician_id,
        scheduled_date: data.scheduled_date,
        stage,
        updated_by_name: nameOf(p),
      })
      .eq("id", data.id);
    // The guard against the race (Oct 15): the row must still be nobody's at the write.
    if (data.expect_unassigned) uq = uq.is("technician_id", null);
    // And the move's guard (Oct 21): still that technician's, still Open / Scheduled, and (the
    // eighth audit) still on the day the row showed — on no day, when it showed none.
    if (data.expect_technician_id) {
      uq = uq.eq("technician_id", data.expect_technician_id).in("stage", [...MOVABLE_STAGES]);
      uq =
        typeof data.expect_scheduled_date === "string"
          ? uq.eq("scheduled_date", data.expect_scheduled_date)
          : uq.is("scheduled_date", null);
    }
    const { data: row, error } = await uq.select("*").maybeSingle();
    if (error) throw new Error(error.message);
    const notFound = data.expect_unassigned
      ? CLAIM_TAKEN
      : data.expect_technician_id
        ? TICKET_CHANGED
        : "Ticket not found";
    if (!row) throw new Error(notFound);
    await logTicketDateMove(sb, row.id, cur.scheduled_date, row.scheduled_date, {
      id: context.userId,
      name: nameOf(p),
    });
    // Row 0 of a named crew mirrors the technician (the board shows and moves the lead).
    const { syncCrewLead } = await import("@/lib/service-crew.server");
    await syncCrewLead(sb, row.id, row.technician_id);
    // The technician's reassigned / date-moved notice rides on `cur` (owner, Oct 12). Oct 20: a
    // held follow-up loses its hold when its day moves (followup_sync_upsert clears
    // snoozed_until), and the drop said nothing — the answer now carries `snooze_cleared` so
    // Work Overview's toast can ("Moved to Oct 22 — its hold was ended"). The move is not blocked.
    const synced = await syncTicketFollowup(
      row,
      { id: context.userId, name: nameOf(p) },
      sb,
      cur.stage,
      cur,
    );
    return { ...(await withTechName(sb, row)), snooze_cleared: synced === "snooze_cleared" };
  });

/**
 * Claim an unassigned ticket for yourself (owner, Oct 8: an office person ticked Technician
 * "should be able to go in and claim it if need be"; the Work Overview calendar drops one onto
 * a day). Anyone `canClaim` — ticked Technician, not technician-only, with Service. The ticket
 * must have no technician and be open or scheduled; a dropped day becomes its date (the same
 * date rule as dispatch), no day keeps whatever it had. The update is the office's own under
 * the row rules (no new grant): crew lead, follow-up and date log as dispatch does.
 */
export const claimServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobWithTech> => {
    const p = await serviceWrite(context);
    if (!canClaim(p)) throw new Error(CLAIM_NEEDS_TICK);
    if (data.date) {
      const dateProblem = assignDateProblem(data.date);
      if (dateProblem) throw new Error(dateProblem);
    }
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("service_jobs")
      .select("stage, scheduled_date, technician_id")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Ticket not found");
    if (cur.technician_id) throw new Error(CLAIM_TAKEN);
    if (cur.stage !== "open" && cur.stage !== "scheduled")
      throw new Error("Only an open ticket can be claimed");
    const scheduled_date = data.date ?? cur.scheduled_date;
    const { data: row, error } = await sb
      .from("service_jobs")
      .update({
        technician_id: context.userId,
        scheduled_date,
        stage: scheduled_date ? "scheduled" : "open",
        updated_by_name: nameOf(p),
      })
      .eq("id", data.id)
      .is("technician_id", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(CLAIM_TAKEN);
    await logTicketDateMove(sb, row.id, cur.scheduled_date, row.scheduled_date, {
      id: context.userId,
      name: nameOf(p),
    });
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
    // A ticket with a live invoice stays (owner, Nov 10; ticket-delete-rule.ts): its invoices
    // would otherwise keep counting on the Invoices page and the Owner view with no ticket.
    const [{ data: tk, error: tErr }, { data: invs, error: iErr }] = await Promise.all([
      context.supabase.from("service_jobs").select("number").eq("id", data.id).maybeSingle(),
      context.supabase
        .from("invoices")
        .select("number, display_number, status, paid_amount, paid_on")
        .eq("service_job_id", data.id)
        .neq("status", "void"),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (iErr) throw new Error(iErr.message);
    const problem = ticketDeleteProblem(
      tk?.number ?? "",
      (invs ?? []).map((i) => ({ ...i, label: invoiceLabel(i) })),
    );
    if (problem) throw new Error(problem);
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

/**
 * Undo a soft delete. The delete closed the ticket's follow-ups ("deleted"); the restore runs the
 * same sync a save does (owner, Oct 12, item 5), so an Open / Scheduled ticket with a technician
 * gets its timer back — quietly: the technician never heard of the delete, so no second
 * "assigned" notice (SyncArgs.quiet) — a Done ticket gets its Authorize timer back through
 * afterTicketStage (the stage is passed as unchanged, so no fresh "ready for your review"
 * broadcast; the one authorizer the timer lands on hears of it as its assignee), and a ticket
 * with no technician gets nothing.
 */
export const restoreServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await serviceWrite(context);
    if (!managesTickets(p)) throw new Error("Ask a manager to restore a ticket");
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .update({ deleted_at: null, updated_by_name: nameOf(p) })
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
        undefined,
        { quiet: true },
      );
  });

export const listDeletedServiceJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceJobListRow[]> => {
    await serviceAccess(context);
    const { data, error } = await context.supabase
      .from("service_jobs")
      .select(LIST_JOB_COLUMNS)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return withTechNames(context.supabase, data ?? []);
  });

/** Material logged against a ticket (the inventory ledger rows that name it). */
export interface JobMaterialRow {
  id: number;
  location_id: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  /** The service material name for the cell, or null (the catalog label stands). */
  label: string | null;
  qty: number;
  unit: string;
  counted_note: string | null;
  /** Who logged it (the "−" undoes your own entries by id, not by name — Nov 3). */
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}
export const listServiceJobMaterials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(({ data, context }): Promise<JobMaterialRow[]> => readJobMaterials(context, data.id));

/**
 * listServiceJobMaterials' read as a plain function (Nov 10, speed finding 4): the ticket's one
 * bundle read (service-field.functions.ts getTicketBundle) runs it too, under the same rule.
 * (Exported below it, so the server function and its rule still read as one block.)
 */
async function readJobMaterials(context: Ctx, id: string): Promise<JobMaterialRow[]> {
  await serviceAccess(context);
  const { data: rows, error } = await context.supabase
    .from("inventory_movements")
    .select(
      "id, location_id, screen_id, row_label, price_col, qty, unit, counted_note, created_by, created_by_name, created_at",
    )
    .eq("service_job_id", id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const byMaterial = materialsByCell(await loadServiceMaterialLinks(context.supabase));
  return (rows ?? []).map((r) => ({ ...r, label: serviceLabel(byMaterial, r) }));
}
export { readJobMaterials };

/** A crew member as the ticket shows it. `bill_rate` is null for anyone but a manager (no money). */
export interface CrewMemberView extends CrewRow {
  name: string;
}
/** The ticket's named crew, the lead first. Empty: an old-style ticket (helper_count). */
export const listJobCrew = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(({ data, context }): Promise<CrewMemberView[]> => readJobCrew(context, data.id));

/**
 * listJobCrew's read as a plain function: the ticket's bundle read runs it too (Nov 10).
 * (Exported below it, so the server function and its money rule still read as one block.)
 */
async function readJobCrew(context: Ctx, id: string): Promise<CrewMemberView[]> {
  const p = await serviceAccess(context);
  const sb = context.supabase;
  const { readCrew } = await import("@/lib/service-crew.server");
  const [rows, { data: techs }] = await Promise.all([
    readCrew(sb, id),
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
}
export { readJobCrew };

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
