/**
 * Service phase A — service jobs (repair tickets), docs/service-module-design.md §6.
 * CenterPoint still dispatches and invoices; a job here carries the customer, the assigned
 * technician, the date, the stage and the CenterPoint ticket / invoice numbers, and is what
 * material off a vehicle is logged against (inventory.functions.ts).
 *
 * Access: Service. A technician (profiles.technician) may edit only jobs assigned to them —
 * RLS enforces the same rule; office users and admins edit any.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import { siteAddressLine } from "@/lib/crm.functions";

export type ServiceJobRow = Database["public"]["Tables"]["service_jobs"]["Row"];

export const SERVICE_STAGES = ["open", "scheduled", "done", "invoiced", "closed"] as const;
export type ServiceStage = (typeof SERVICE_STAGES)[number];
export const STAGE_LABELS: Record<ServiceStage, string> = {
  open: "Open",
  scheduled: "Scheduled",
  done: "Done",
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
  description: z.string().trim().max(500).default(""),
  service_type: z.enum(SERVICE_TYPES).default("leak"),
  po_number: optText(60),
  technician_id: z.string().uuid().nullable().optional(),
  helper_count: z.number().int().min(0).max(9).default(0),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  stage: z.enum(SERVICE_STAGES).optional(),
  notes: optText(10000),
  centerpoint_ticket: optText(40),
  centerpoint_invoice: optText(40),
});
export type ServiceJobInput = z.input<typeof jobSchema>;

/**
 * Create (no id) or update a ticket. The customer / site names and the site address are
 * snapshotted from the linked account so the list reads without joins. A missing stage on
 * create is Scheduled when a tech and a date are set, else Open.
 */
export const saveServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => jobSchema.parse(d))
  .handler(async ({ data, context }): Promise<ServiceJobWithTech> => {
    const p = await serviceWrite(context);
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
      }
    } else {
      fields.site_id = null;
    }
    if (!customer_name.trim()) throw new Error("Pick or add the customer");
    const stage =
      fields.stage ?? (fields.technician_id && fields.scheduled_date ? "scheduled" : "open");
    if (techMayNotSet(p, stage))
      throw new Error("A technician can mark a ticket Done; the office invoices and closes it");
    const patch = {
      account_id: fields.account_id ?? null,
      site_id: fields.site_id ?? null,
      contact_id: fields.account_id ? (fields.contact_id ?? null) : null,
      ...(fields.labor_rate_kind ? { labor_rate_kind: fields.labor_rate_kind } : {}),
      customer_name,
      site_name,
      site_address,
      description: fields.description,
      service_type: fields.service_type,
      po_number: fields.po_number ?? null,
      technician_id: fields.technician_id ?? null,
      helper_count: fields.helper_count,
      scheduled_date: fields.scheduled_date ?? null,
      stage,
      notes: fields.notes ?? null,
      centerpoint_ticket: fields.centerpoint_ticket ?? null,
      centerpoint_invoice: fields.centerpoint_invoice ?? null,
      updated_by_name: nameOf(p),
    };
    if (id) {
      // A technician edits only their own ticket (RLS says the same; this gives a clear message).
      if (p.technician && p.role !== "admin") {
        const { data: cur } = await sb
          .from("service_jobs")
          .select("technician_id")
          .eq("id", id)
          .maybeSingle();
        if (cur && cur.technician_id !== context.userId)
          throw new Error(
            "Only the assigned technician, the office or an admin can edit this ticket",
          );
      }
      const { data: row, error } = await sb
        .from("service_jobs")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, sb);
      return withTechName(sb, row);
    }
    const { data: row, error } = await sb
      .from("service_jobs")
      .insert({ ...patch, created_by: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, sb);
    return withTechName(sb, row);
  });

/** The stages a technician may set; Invoiced and Closed belong to the office (owner, Sep 27). */
export const TECH_STAGES: readonly ServiceStage[] = ["open", "scheduled", "done"];
const techMayNotSet = (p: { technician: boolean; role: string }, stage: ServiceStage) =>
  p.technician && p.role !== "admin" && !TECH_STAGES.includes(stage);

/** Stages at which the assignee's follow-up timer ends (Done: the tech's part is finished). */
const TICKET_CLOSING: readonly ServiceStage[] = ["done", "invoiced", "closed"];
/** Keep the ticket's follow-up timer in step with its technician and stage (design §11). */
async function syncTicketFollowup(
  row: ServiceJobRow,
  actor: { id: string; name: string | null },
  sb: SupabaseClient<Database>,
): Promise<void> {
  const { syncFollowup } = await import("@/lib/followups.server");
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
    if (techMayNotSet(p, data.stage))
      throw new Error("A technician can mark a ticket Done; the office invoices and closes it");
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
    await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, context.supabase);
  });

/**
 * The Tech Board's drop: assign (or unassign) a technician and a day in one call. Stage moves
 * Open ↔ Scheduled with it; Done and later are left alone. Office / admin only.
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
    if (p.technician && p.role !== "admin") throw new Error("Only the office can dispatch tickets");
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("service_jobs")
      .select("stage")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Ticket not found");
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
    await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, sb);
    return withTechName(sb, row);
  });

/** Soft delete (office / admin). A technician cannot delete tickets. */
export const deleteServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await serviceWrite(context);
    if (p.technician && p.role !== "admin") throw new Error("Ask the office to delete a ticket");
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .update({ deleted_at: new Date().toISOString(), updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (row)
      await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, context.supabase);
  });

export const restoreServiceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await serviceWrite(context);
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
