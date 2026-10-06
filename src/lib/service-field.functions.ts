/**
 * The technician's phone flow (docs/service-module-design.md §5.3): the day's tickets, the
 * stage buttons (En route → On site → Done) that stamp travel and labor time, repairs from the
 * template catalog with before / after photos, closing notes, and the customer's signature.
 * Materials used are inventory movements (inventory.functions.ts) against the ticket.
 *
 * Photos and the signature are uploaded by the browser straight into the private "service"
 * bucket at <job id>/<file> (storage RLS follows the Service page); these functions record
 * the rows. Access: Service. A technician touches only their own tickets (RLS + checks here).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, isOffice, managesTickets } from "@/lib/access";
import { fieldEditProblem } from "@/lib/field-edit-lock";
import { catalogTemplate, templatesForViewer } from "@/lib/ticket-money";
import type { ServiceJobRow } from "@/lib/service.functions";
import { MAX_HELPERS, confirmedCrew } from "@/lib/service-crew";
import { isAnnotatableRole, photoMarksSchema, serializePhotoMarks } from "@/lib/photo-annotations";
import { easternYmd, resolveFieldDay } from "@/lib/field-day";
import { warrantyBadges, type Warranty } from "@/lib/warranty";
import { SITE_HISTORY_LIMIT, type SiteHistoryRow } from "@/lib/site-history";
import { mentionedIds } from "@/lib/mentions";
import { mentionRoster } from "@/lib/auth.functions";
import { materialsByCell, serviceLabel } from "@/lib/service-materials";
import { loadServiceMaterialLinks } from "@/lib/service-materials.server";

export const SERVICE_BUCKET = "service";
export type TimeEntryRow = Database["public"]["Tables"]["service_time_entries"]["Row"];
export type RepairTemplateRow = Database["public"]["Tables"]["repair_templates"]["Row"];
export type JobRepairRow = Database["public"]["Tables"]["service_job_repairs"]["Row"];
export type JobPhotoRow = Database["public"]["Tables"]["service_job_photos"]["Row"];
export type JobEventRow = Database["public"]["Tables"]["service_job_events"]["Row"];

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data || !canAccess(data, "service")) throw new Error("Forbidden: Service access required");
  return data;
}
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;
/**
 * The phone's calendar day (YYYY-MM-DD, field-utils.ts localYmd) sent with a field action that
 * stamps a day. Optional: an older cached bundle sends none and the server uses the Eastern day
 * (field-day.ts resolveFieldDay, which also refuses a day that is not believable).
 */
const phoneDay = z.string().max(32).optional();

type Me = Awaited<ReturnType<typeof me>>;
/** A technician may only touch their own ticket; office users and admins any. */
async function ownJob(ctx: Ctx, id: string, profile?: Me): Promise<ServiceJobRow> {
  const p = profile ?? (await me(ctx));
  const { data: job, error } = await ctx.supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Ticket not found");
  if (!isOffice(p) && job.technician_id !== ctx.userId)
    throw new Error("This ticket is assigned to someone else");
  return job;
}
/**
 * ownJob, then the stage lock on time, repairs and materials (owner, Oct 6; field-edit-lock.ts):
 * a technician while the ticket is Open / Scheduled / Done, a manager before Invoiced, the office
 * never on Invoiced / Closed. The database twin is ticket_open_for_tech (20261006192000).
 */
async function editableJob(ctx: Ctx, id: string): Promise<{ job: ServiceJobRow; p: Me }> {
  const p = await me(ctx);
  const job = await ownJob(ctx, id, p);
  const problem = fieldEditProblem(p, job.stage, job.technician_id === ctx.userId);
  if (problem) throw new Error(problem);
  return { job, p };
}
/** Hours between two stamps, to the quarter hour, never under a quarter. */
export function quarterHours(from: string | Date, to: string | Date): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  const q = Math.round(ms / (15 * 60 * 1000)) / 4;
  return Math.max(0.25, q);
}
/**
 * The timeline rows the app writes. Not 'stage': the database writes those itself on every change
 * of stage (trigger service_jobs_stage_log, 20261001130000_opened_and_stage_dates.sql).
 */
export type AppEventKind = "field" | "note" | "assign" | "photo" | "signature" | "edit";
async function logEvent(
  ctx: Ctx,
  jobId: string,
  ev: {
    kind: AppEventKind;
    field_status?: string | null;
    note?: string | null;
    meta?: Record<string, unknown>;
  },
  byName: string,
) {
  await ctx.supabase.from("service_job_events").insert({
    service_job_id: jobId,
    kind: ev.kind,
    field_status: ev.field_status ?? null,
    note: ev.note ?? null,
    by_user: ctx.userId,
    by_name: byName,
    ...(ev.meta ? { meta: ev.meta as Json } : {}),
  });
}

/** A ticket on the Today page: the row plus what the tech needs at a glance. */
export interface TodayJob extends ServiceJobRow {
  technician_instructions: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  account_phone: string | null;
  /** The other technicians of the named crew (not the lead), in order. */
  crew_names: string[];
  /** The site's roof warranties in force today ("Duro-Last 15 NDL · to Mar 2031"; M5). */
  warranty_badges: string[];
}

/** My tickets that still need me: not Done yet, soonest first (today's on top). */
export const myDay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodayJob[]> => {
    const p = await me(context);
    const sb = context.supabase;
    let q = sb
      .from("service_jobs")
      .select("*")
      .is("deleted_at", null)
      .in("stage", ["open", "scheduled"])
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .limit(100);
    // Office users see the whole board here; a technician their own (RLS also filters).
    if (!isOffice(p)) q = q.eq("technician_id", context.userId);
    const { data: jobs, error } = await q;
    if (error) throw new Error(error.message);
    const siteIds = [
      ...new Set((jobs ?? []).map((j) => j.site_id).filter((x): x is string => !!x)),
    ];
    const contactIds = [
      ...new Set((jobs ?? []).map((j) => j.contact_id).filter((x): x is string => !!x)),
    ];
    const accountIds = [
      ...new Set((jobs ?? []).map((j) => j.account_id).filter((x): x is string => !!x)),
    ];
    const jobIds = (jobs ?? []).map((j) => j.id);
    const [
      { data: sites },
      { data: contacts },
      { data: accounts },
      { data: crewRows },
      { data: techs },
      warrantyRes,
    ] = await Promise.all([
      siteIds.length
        ? sb.from("crm_sites").select("id, technician_instructions").in("id", siteIds)
        : Promise.resolve({ data: [] as { id: string; technician_instructions: string | null }[] }),
      contactIds.length
        ? sb.from("crm_contacts").select("id, name, mobile, office_phone").in("id", contactIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              name: string;
              mobile: string | null;
              office_phone: string | null;
            }[],
          }),
      accountIds.length
        ? sb.from("crm_accounts").select("id, phone").in("id", accountIds)
        : Promise.resolve({ data: [] as { id: string; phone: string | null }[] }),
      // Who is on each crew: the price-free view (a technician reads no rates).
      jobIds.length
        ? sb
            .from("service_job_crew")
            .select("service_job_id, technician_id, sort")
            .in("service_job_id", jobIds)
            .gt("sort", 0)
            .order("sort")
        : Promise.resolve({
            data: [] as {
              service_job_id: string | null;
              technician_id: string | null;
              sort: number | null;
            }[],
          }),
      sb.rpc("technician_options"),
      // M5: before 20261005160000_site_warranties.sql is applied this errors; no badges then.
      siteIds.length
        ? sb
            .from("site_warranties")
            .select("id, site_id, manufacturer, kind, number, start_date, end_date, notes")
            .in("site_id", siteIds)
        : Promise.resolve({ data: [] as Warranty[], error: null }),
    ]);
    const today = easternYmd();
    const warrantiesOf = new Map<string, Warranty[]>();
    for (const w of warrantyRes.error ? [] : (warrantyRes.data ?? []))
      warrantiesOf.set(w.site_id, [...(warrantiesOf.get(w.site_id) ?? []), w]);
    const techName = new Map<string, string>();
    for (const t of techs ?? []) techName.set(t.id, (t.full_name ?? "").trim() || t.email);
    const crewOf = new Map<string, string[]>();
    for (const r of crewRows ?? []) {
      if (!r.service_job_id || !r.technician_id) continue;
      const list = crewOf.get(r.service_job_id) ?? [];
      list.push(techName.get(r.technician_id) ?? "Former technician");
      crewOf.set(r.service_job_id, list);
    }
    const siteMap = new Map((sites ?? []).map((s) => [s.id, s.technician_instructions]));
    const contactMap = new Map((contacts ?? []).map((c) => [c.id, c]));
    const accountMap = new Map((accounts ?? []).map((a) => [a.id, a.phone]));
    return (jobs ?? []).map((j) => {
      const c = j.contact_id ? contactMap.get(j.contact_id) : undefined;
      return {
        ...j,
        technician_instructions: j.site_id ? (siteMap.get(j.site_id) ?? null) : null,
        contact_name: c?.name ?? null,
        contact_phone: c?.mobile || c?.office_phone || null,
        account_phone: j.account_id ? (accountMap.get(j.account_id) ?? null) : null,
        crew_names: crewOf.get(j.id) ?? [],
        warranty_badges: j.site_id ? warrantyBadges(warrantiesOf.get(j.site_id) ?? [], today) : [],
      };
    });
  });

/**
 * The one-button stage flow. en_route stamps the start of travel; on_site ends travel (a
 * travel time entry) and starts labor; done ends labor (a labor entry), sets the ticket Done
 * and closes the tech's follow-up. Pressing a button twice is harmless; going back ("undo")
 * clears the last stamp and its entry.
 */
export const setFieldStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        to: z.enum(["en_route", "on_site", "done", "undo"]),
        day: phoneDay,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobRow> => {
    // The day the time entries belong to: the phone's, not UTC's (field-day.ts). Checked first,
    // so a refused day changes nothing.
    const at = new Date();
    const onDate = resolveFieldDay(data.day, at);
    const p = await me(context);
    const job = await ownJob(context, data.id);
    const sb = context.supabase;
    const now = at.toISOString();
    const who = nameOf(p);
    let patch: Database["public"]["Tables"]["service_jobs"]["Update"] = {};
    if (data.to === "en_route") {
      if (job.field_status) return job;
      patch = {
        field_status: "en_route",
        en_route_at: now,
        stage: job.stage === "open" ? "scheduled" : job.stage,
      };
      await logEvent(context, job.id, { kind: "field", field_status: "en_route" }, who);
    } else if (data.to === "on_site") {
      if (job.field_status === "on_site") return job;
      patch = {
        field_status: "on_site",
        on_site_at: now,
        stage: job.stage === "open" ? "scheduled" : job.stage,
      };
      if (job.en_route_at) {
        await sb.from("service_time_entries").insert({
          service_job_id: job.id,
          technician_id: job.technician_id ?? context.userId,
          kind: "travel",
          started_at: job.en_route_at,
          ended_at: now,
          hours: quarterHours(job.en_route_at, now),
          helper_count: job.helper_count,
          source: "buttons",
          on_date: onDate,
          created_by: context.userId,
        });
      }
      await logEvent(context, job.id, { kind: "field", field_status: "on_site" }, who);
    } else if (data.to === "done") {
      const finished = ["done", "authorized", "invoiced", "closed"].includes(job.stage);
      // Owner, Oct 5 (RoAnna closed #6004 from the stage picker, then completed its close-out and
      // "the status didn't move"): a ticket the office already set Done / Invoiced / Closed keeps
      // that stage, but its close-out is still recorded — completed_at is stamped once, so the
      // ticket page's Close-out fold says "Done <date>" instead of "not closed out yet".
      if (finished && job.completed_at) return job;
      patch = finished
        ? { field_status: null, completed_at: now }
        : { field_status: null, completed_at: now, stage: "done" };
      if (job.on_site_at) {
        await sb.from("service_time_entries").insert({
          service_job_id: job.id,
          technician_id: job.technician_id ?? context.userId,
          kind: "labor",
          started_at: job.on_site_at,
          ended_at: now,
          hours: quarterHours(job.on_site_at, now),
          helper_count: job.helper_count,
          source: "buttons",
          on_date: onDate,
          created_by: context.userId,
        });
      }
      // The timeline's 'stage' row is the database's (trigger service_jobs_stage_log,
      // 20261001130000_opened_and_stage_dates.sql): every change of stage, logged once.
    } else {
      // undo: step back one stamp and drop the entry it created.
      if (job.stage === "done" && job.completed_at) {
        patch = { stage: "scheduled", field_status: "on_site", completed_at: null };
        await sb
          .from("service_time_entries")
          .delete()
          .eq("service_job_id", job.id)
          .eq("kind", "labor")
          .eq("source", "buttons")
          .eq("ended_at", job.completed_at);
      } else if (job.field_status === "on_site" && job.on_site_at) {
        patch = { field_status: job.en_route_at ? "en_route" : null, on_site_at: null };
        await sb
          .from("service_time_entries")
          .delete()
          .eq("service_job_id", job.id)
          .eq("kind", "travel")
          .eq("source", "buttons")
          .eq("ended_at", job.on_site_at);
      } else if (job.field_status === "en_route") {
        patch = { field_status: null, en_route_at: null };
      } else return job;
      await logEvent(context, job.id, { kind: "field", note: "undo" }, who);
    }
    const { data: row, error } = await sb
      .from("service_jobs")
      .update({ ...patch, updated_by_name: who })
      .eq("id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    if (row.stage !== job.stage) {
      const { afterTicketStage } = await import("@/lib/ticket-events.server");
      await afterTicketStage(row, job.stage, { id: context.userId, name: who }, context.supabase);
      const { syncFollowup } = await import("@/lib/followups.server");
      await syncFollowup(
        {
          kind: "ticket",
          itemId: row.id,
          accountId: row.account_id,
          assigneeId: row.technician_id,
          title: `Ticket #${row.number} ${row.customer_name}${row.description ? ` — ${row.description}` : ""}`,
          url: `/service?id=${row.id}`,
          closing: ["done", "authorized", "invoiced", "closed"].includes(row.stage),
          closeReason: `stage ${row.stage}`,
          dueDate: row.scheduled_date,
          actorId: context.userId,
          actorName: who,
        },
        context.supabase,
      );
    }
    return row;
  });

export const listTimeEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TimeEntryRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_time_entries")
      .select("*")
      .eq("service_job_id", data.id)
      .order("on_date")
      .order("id");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const timeSchema = z.object({
  id: z.number().int().optional(),
  service_job_id: z.string().uuid(),
  kind: z.enum(["travel", "labor"]),
  hours: z.number().finite().min(0).max(24),
  helper_count: z.number().int().min(0).max(9).default(0),
  on_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).nullable().optional(),
});
/** Add or correct a time entry by hand (a forgotten button press). */
export const saveTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => timeSchema.parse(d))
  .handler(async ({ data, context }): Promise<TimeEntryRow> => {
    const { job } = await editableJob(context, data.service_job_id);
    const sb = context.supabase;
    const { id, ...fields } = data;
    const row = { ...fields, note: fields.note ?? null, source: "manual" as const };
    if (id) {
      const { data: r, error } = await sb
        .from("service_time_entries")
        .update(row)
        .eq("id", id)
        .eq("service_job_id", job.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return r;
    }
    const { data: r, error } = await sb
      .from("service_time_entries")
      .insert({
        ...row,
        technician_id: job.technician_id ?? context.userId,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return r;
  });

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), service_job_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    await editableJob(context, data.service_job_id);
    const { error } = await context.supabase
      .from("service_time_entries")
      .delete()
      .eq("id", data.id)
      .eq("service_job_id", data.service_job_id);
    if (error) throw new Error(error.message);
  });

/** Repair templates: favourites and the most used first, then a name search. */
export const listRepairTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<RepairTemplateRow[]> => {
    const p = await me(context);
    const manager = managesTickets(p);
    const sb = context.supabase;
    const limit = data.limit ?? 60;
    const like = data.q ? `%${data.q.replace(/[%_,]/g, " ")}%` : null;
    // Prices are a manager's (owner, Oct 1): a manager reads the table (unit_price), anyone
    // else the price-free catalog view (RLS repair_templates_read no longer shows a technician
    // the table). Same filters and order on both.
    let rows: RepairTemplateRow[];
    if (manager) {
      let q = sb
        .from("repair_templates")
        .select("*")
        .eq("active", true)
        .order("favorite", { ascending: false })
        .order("usage_count", { ascending: false })
        .order("name")
        .limit(limit);
      if (like) q = q.ilike("name", like);
      const { data: r, error } = await q;
      if (error) throw new Error(error.message);
      rows = r ?? [];
    } else {
      let q = sb
        .from("repair_templates_catalog")
        .select("*")
        .eq("active", true)
        .order("favorite", { ascending: false })
        .order("usage_count", { ascending: false })
        .order("name")
        .limit(limit);
      if (like) q = q.ilike("name", like);
      const { data: r, error } = await q;
      if (error) throw new Error(error.message);
      rows = (r ?? []).map(catalogTemplate);
    }
    return templatesForViewer(rows, manager);
  });

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).nullable().optional(),
  unit: z.string().trim().min(1).max(20).default("EA"),
  description: z.string().trim().max(2000).nullable().optional(),
  work_completed: z.string().trim().max(2000).nullable().optional(),
  unit_price: z.number().finite().nonnegative().nullable().optional(),
  favorite: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type RepairTemplateInput = z.input<typeof templateSchema>;
export const saveRepairTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => templateSchema.parse(d))
  .handler(async ({ data, context }): Promise<RepairTemplateRow> => {
    const p = await me(context);
    // A template carries a price: a manager's (owner, Oct 1; RLS repair_templates_write).
    if (!managesTickets(p)) throw new Error("Only a manager edits repair templates");
    const { id, ...fields } = data;
    const row = {
      name: fields.name,
      unit: fields.unit,
      category: fields.category ?? null,
      description: fields.description ?? null,
      work_completed: fields.work_completed ?? null,
      unit_price: fields.unit_price ?? null,
      ...(fields.favorite === undefined ? {} : { favorite: fields.favorite }),
      ...(fields.active === undefined ? {} : { active: fields.active }),
    };
    const q = id
      ? context.supabase.from("repair_templates").update(row).eq("id", id)
      : context.supabase.from("repair_templates").insert(row);
    const { data: r, error } = await q.select("*").single();
    if (error) throw new Error(error.message);
    return r;
  });

export const listJobRepairs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<JobRepairRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_job_repairs")
      .select("*")
      .eq("service_job_id", data.id)
      .order("sort")
      .order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const repairSchema = z.object({
  id: z.string().uuid().optional(),
  service_job_id: z.string().uuid(),
  repair_template_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().min(0).default(1),
  unit: z.string().trim().min(1).max(20).default("EA"),
  problem_text: z.string().trim().max(2000).nullable().optional(),
  resolution_text: z.string().trim().max(2000).nullable().optional(),
  completed_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  print_on_invoice: z.boolean().optional(),
  /** Today on the phone: the completed_on of a repair saved without one (one just added). */
  day: phoneDay,
});
export type JobRepairInput = z.input<typeof repairSchema>;
/** Add or edit a repair on a ticket; a template fills the name and texts when given. */
export const saveJobRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => repairSchema.parse(d))
  .handler(async ({ data, context }): Promise<JobRepairRow> => {
    const { id, day, ...fields } = data;
    // The phone's day (field-day.ts), checked first so a refused day changes nothing.
    const completedOn = fields.completed_on ?? resolveFieldDay(day);
    const { job } = await editableJob(context, data.service_job_id);
    const sb = context.supabase;
    const row = {
      ...fields,
      repair_template_id: fields.repair_template_id ?? null,
      problem_text: fields.problem_text ?? null,
      resolution_text: fields.resolution_text ?? null,
      completed_on: completedOn,
      print_on_invoice: fields.print_on_invoice ?? true,
    };
    if (id) {
      const { data: r, error } = await sb
        .from("service_job_repairs")
        .update(row)
        .eq("id", id)
        .eq("service_job_id", job.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return r;
    }
    const { count } = await sb
      .from("service_job_repairs")
      .select("id", { count: "exact", head: true })
      .eq("service_job_id", job.id);
    const { data: r, error } = await sb
      .from("service_job_repairs")
      .insert({ ...row, sort: count ?? 0, created_by: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return r;
  });

export const deleteJobRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), service_job_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    await editableJob(context, data.service_job_id);
    const { error } = await context.supabase
      .from("service_job_repairs")
      .delete()
      .eq("id", data.id)
      .eq("service_job_id", data.service_job_id);
    if (error) throw new Error(error.message);
  });

export const listJobPhotos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<JobPhotoRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_job_photos")
      .select("*")
      .eq("service_job_id", data.id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Safe object name inside the bucket: <job id>/<time>-<random>.<ext>. */
export function photoObjectPath(jobId: string, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

const photoSchema = z.object({
  service_job_id: z.string().uuid(),
  repair_id: z.string().uuid().nullable().optional(),
  role: z.enum(["before", "after", "other", "signature"]).default("other"),
  storage_path: z.string().min(1).max(300),
  file_name: z.string().max(200).nullable().optional(),
  file_size: z.number().int().nonnegative().nullable().optional(),
  taken_at: z.string().datetime({ offset: true }).nullable().optional(),
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
});
/** Record an uploaded photo (the browser uploaded it to the "service" bucket already). */
export const registerJobPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => photoSchema.parse(d))
  .handler(async ({ data, context }): Promise<JobPhotoRow> => {
    const p = await me(context);
    const job = await ownJob(context, data.service_job_id);
    if (!data.storage_path.startsWith(`${job.id}/`))
      throw new Error("The photo must be stored under the ticket's own folder");
    const { data: r, error } = await context.supabase
      .from("service_job_photos")
      .insert({
        service_job_id: job.id,
        repair_id: data.repair_id ?? null,
        role: data.role,
        storage_path: data.storage_path,
        file_name: data.file_name ?? null,
        file_size: data.file_size ?? null,
        taken_at: data.taken_at ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        by_user: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    if (data.role === "signature") {
      await context.supabase
        .from("service_jobs")
        .update({ signature_path: data.storage_path, signed_at: new Date().toISOString() })
        .eq("id", job.id);
      await logEvent(context, job.id, { kind: "signature" }, nameOf(p));
    } else {
      await logEvent(
        context,
        job.id,
        { kind: "photo", meta: { role: data.role, repair_id: data.repair_id ?? null } },
        nameOf(p),
      );
    }
    return r;
  });

export const deleteJobPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), service_job_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    await ownJob(context, data.service_job_id);
    const { data: row } = await context.supabase
      .from("service_job_photos")
      .select("storage_path")
      .eq("id", data.id)
      .eq("service_job_id", data.service_job_id)
      .maybeSingle();
    if (!row) return;
    await context.supabase.storage.from(SERVICE_BUCKET).remove([row.storage_path]);
    const { error } = await context.supabase.from("service_job_photos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
  });

/** The save of a photo's marks: the photo, its ticket, and the marks (null = none). */
export const savePhotoAnnotationsInput = z.object({
  id: z.string().uuid(),
  service_job_id: z.string().uuid(),
  annotations: photoMarksSchema.nullable(),
});
/**
 * Save the marks drawn over a ticket photo (owner, Oct 1: "issues circled, text added etc").
 * The same rules as recording a photo: Service access, and a technician only on their own
 * ticket (ownJob). Only a Before / After / other photo of this ticket takes marks (a signature
 * never; an aerial keeps its own markup). The image is never touched: the marks are JSON on the
 * row, rounded, and null when the last one is removed. The close-out and the ticket page
 * auto-save here as the marks change.
 */
export const savePhotoAnnotations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => savePhotoAnnotationsInput.parse(d))
  .handler(async ({ data, context }): Promise<JobPhotoRow> => {
    const job = await ownJob(context, data.service_job_id);
    const sb = context.supabase;
    const { data: photo, error: pErr } = await sb
      .from("service_job_photos")
      .select("id, role")
      .eq("id", data.id)
      .eq("service_job_id", job.id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!photo) throw new Error("That photo is not on this ticket (it may have been deleted)");
    if (!isAnnotatableRole(photo.role))
      throw new Error("Only a Before, After or other photo can be marked up");
    const value = serializePhotoMarks(data.annotations?.marks ?? []);
    const { data: row, error } = await sb
      .from("service_job_photos")
      .update({ annotations: value as unknown as Json })
      .eq("id", photo.id)
      .eq("service_job_id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const closeoutSchema = z.object({
  id: z.string().uuid(),
  closing_notes: z.string().trim().max(10000).nullable().optional(),
  checked_in_with: z.string().trim().max(200).nullable().optional(),
  checked_out_with: z.string().trim().max(200).nullable().optional(),
  recommend_new_roof: z.boolean().optional(),
  helper_count: z.number().int().min(0).max(9).optional(),
  signed_by: z.string().trim().max(200).nullable().optional(),
});
/** The close-out screen's text fields (repairs, photos, materials and time are their own calls). */
export const saveCloseout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => closeoutSchema.parse(d))
  .handler(async ({ data, context }): Promise<ServiceJobRow> => {
    const p = await me(context);
    const job = await ownJob(context, data.id);
    const { id, ...fields } = data;
    const patch: Database["public"]["Tables"]["service_jobs"]["Update"] = {
      updated_by_name: nameOf(p),
    };
    if (fields.closing_notes !== undefined) patch.closing_notes = fields.closing_notes;
    if (fields.checked_in_with !== undefined) patch.checked_in_with = fields.checked_in_with;
    if (fields.checked_out_with !== undefined) patch.checked_out_with = fields.checked_out_with;
    if (fields.recommend_new_roof !== undefined)
      patch.recommend_new_roof = fields.recommend_new_roof;
    if (fields.helper_count !== undefined) patch.helper_count = fields.helper_count;
    if (fields.signed_by !== undefined) patch.signed_by = fields.signed_by;
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .update(patch)
      .eq("id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * The technician's answer to "Who is on this job with you?" (owner, Sep 30): alone, or the
 * other technicians picked. Writes the crew rows (the lead stays row 0; rates the office set on
 * kept members stay) and stamps crew_confirmed_at the first time; the answer stays editable
 * (before photos now, after photos later). Auto-saved by the close-out, no Save button.
 */
export const setJobCrew = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        others: z.array(z.string().uuid()).max(MAX_HELPERS),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobRow> => {
    const p = await me(context);
    const job = await ownJob(context, data.id);
    // The lead technician answers; a manager may too. Anyone else in the office asks a manager
    // (RLS service_job_techs_lead lets only the lead write besides a manager).
    if (!managesTickets(p) && job.technician_id !== context.userId)
      throw new Error("Only the technician on this ticket or a manager says who is on the job");
    const sb = context.supabase;
    // Kept members keep the rate a manager set; new ones get none. A manager reads the rates
    // and sends them back; the lead cannot read them (RLS service_job_techs_read) and sends
    // none, and set_job_crew keeps the stored ones (it and the trigger
    // service_job_techs_rate_guard refuse a rate from a non-manager).
    const { readCrew, writeCrew } = await import("@/lib/service-crew.server");
    const rows = confirmedCrew(
      await readCrew(sb, job.id, { rates: managesTickets(p) }),
      job.technician_id,
      data.others,
    );
    const helper_count = await writeCrew(sb, job.id, rows);
    const { data: row, error } = await sb
      .from("service_jobs")
      .update({
        helper_count,
        crew_confirmed_at: job.crew_confirmed_at ?? new Date().toISOString(),
        updated_by_name: nameOf(p),
      })
      .eq("id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logEvent(
      context,
      job.id,
      {
        kind: "edit",
        note: data.others.length
          ? `Crew: ${data.others.length} other technician${data.others.length > 1 ? "s" : ""} on the job`
          : "Crew: alone on the job",
        meta: { crew: data.others },
      },
      nameOf(p),
    );
    return row;
  });

export const listJobEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<JobEventRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_job_events")
      .select("*")
      .eq("service_job_id", data.id)
      .order("at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Add a note to the ticket's timeline. */
export const addJobNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), note: z.string().trim().min(1).max(5000) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ mentioned: number }> => {
    const p = await me(context);
    const job = await ownJob(context, data.id);
    await logEvent(context, data.id, { kind: "note", note: data.note }, nameOf(p));
    // @mentions (M3, owner Oct 5): everyone named after an "@" hears about it, not the writer.
    // The roster is everyone with Service or Customers access (owner, Oct 6: mention_options,
    // the same list the note box offers), not the dispatch roster.
    if (!data.note.includes("@")) return { mentioned: 0 };
    let people: { id: string; name: string }[];
    try {
      people = await mentionRoster(context.supabase);
    } catch (e) {
      throw new Error(
        `Note added, but the mentions were not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const ids = mentionedIds(data.note, people).filter((id) => id !== context.userId);
    if (!ids.length) return { mentioned: 0 };
    const { notify } = await import("@/lib/notify.server");
    try {
      await notify(
        ids,
        {
          kind: "mention",
          title: `${nameOf(p)} mentioned you on Ticket #${job.number} ${job.customer_name}`,
          body: data.note,
          url: `/service?id=${job.id}`,
        },
        context.supabase,
      );
    } catch (e) {
      throw new Error(
        `Note added, but the mentions were not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { mentioned: ids.length };
  });

/** Templates used before on this site (or account), most recent first — the "usual" chips. */
export const recentRepairsForJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RepairTemplateRow[]> => {
    const p = await me(context);
    const manager = managesTickets(p);
    const sb = context.supabase;
    const { data: job } = await sb
      .from("service_jobs")
      .select("site_id, account_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!job || (!job.site_id && !job.account_id)) return [];
    let jobsQ = sb
      .from("service_jobs")
      .select("id")
      .is("deleted_at", null)
      .neq("id", data.id)
      .limit(50);
    jobsQ = job.site_id
      ? jobsQ.eq("site_id", job.site_id)
      : jobsQ.eq("account_id", job.account_id!);
    const { data: jobs } = await jobsQ;
    const ids = (jobs ?? []).map((j) => j.id);
    if (!ids.length) return [];
    const { data: reps } = await sb
      .from("service_job_repairs")
      .select("repair_template_id, created_at")
      .in("service_job_id", ids)
      .not("repair_template_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);
    const seen: string[] = [];
    for (const r of reps ?? [])
      if (r.repair_template_id && !seen.includes(r.repair_template_id))
        seen.push(r.repair_template_id);
    if (!seen.length) return [];
    // Prices are a manager's (owner, Oct 1): the table for a manager, the price-free catalog
    // view for anyone else (as listRepairTemplates).
    const picked = seen.slice(0, 12);
    let templates: RepairTemplateRow[];
    if (manager) {
      const { data: r } = await sb
        .from("repair_templates")
        .select("*")
        .in("id", picked)
        .eq("active", true);
      templates = r ?? [];
    } else {
      const { data: r } = await sb
        .from("repair_templates_catalog")
        .select("*")
        .in("id", picked)
        .eq("active", true);
      templates = (r ?? []).map(catalogTemplate);
    }
    const order = new Map(seen.map((id, i) => [id, i]));
    const sorted = templates.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    return templatesForViewer(sorted, manager);
  });

/**
 * What a tech usually uses on a repair template (owner, Sep 27): the materials logged on
 * earlier tickets that carried this template, averaged per ticket, so the close-out can
 * prefill them. Cells with the tech's own history first.
 */
export interface UsualMaterial {
  screen_id: string;
  row_label: string;
  price_col: string;
  /** The service material name for the cell, or null (the catalog label stands). */
  label: string | null;
  unit: string;
  /** Average quantity per ticket, in the stock unit (packs). */
  avg_qty: number;
  tickets: number;
}
export const usualMaterialsForTemplate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ template_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<UsualMaterial[]> => {
    await me(context);
    const sb = context.supabase;
    const { data: reps } = await sb
      .from("service_job_repairs")
      .select("service_job_id")
      .eq("repair_template_id", data.template_id)
      .order("created_at", { ascending: false })
      .limit(200);
    const jobIds = [...new Set((reps ?? []).map((r) => r.service_job_id))];
    if (!jobIds.length) return [];
    const { data: moves } = await sb
      .from("inventory_movements")
      .select("service_job_id, screen_id, row_label, price_col, qty, unit")
      .in("service_job_id", jobIds)
      .in("reason", ["consumed", "released"]);
    const perJob = new Map<string, Map<string, { qty: number; unit: string }>>();
    for (const m of moves ?? []) {
      if (!m.service_job_id) continue;
      const cell = `${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
      const j = perJob.get(m.service_job_id) ?? new Map();
      const cur = j.get(cell) ?? { qty: 0, unit: m.unit };
      cur.qty += -Number(m.qty);
      j.set(cell, cur);
      perJob.set(m.service_job_id, j);
    }
    const agg = new Map<string, { sum: number; n: number; unit: string }>();
    for (const j of perJob.values())
      for (const [cell, v] of j) {
        if (!(v.qty > 0)) continue;
        const a = agg.get(cell) ?? { sum: 0, n: 0, unit: v.unit };
        a.sum += v.qty;
        a.n += 1;
        agg.set(cell, a);
      }
    const byMaterial = materialsByCell(await loadServiceMaterialLinks(sb));
    return [...agg.entries()]
      .map(([cell, a]) => {
        const [screen_id, row_label, price_col] = cell.split("\u0000") as [string, string, string];
        return {
          screen_id,
          row_label,
          price_col,
          label: serviceLabel(byMaterial, { screen_id, row_label, price_col }),
          unit: a.unit,
          avg_qty: Math.round((a.sum / a.n) * 100) / 100,
          tickets: a.n,
        };
      })
      .sort((x, y) => y.tickets - x.tickets)
      .slice(0, 12);
  });

/**
 * "Earlier at this site" (service study M4, owner Oct 5): the last tickets at the same site as
 * this one, newest first, not counting this ticket or deleted ones. A ticket with no site has
 * none. A technician sees only their own earlier tickets (row-level security on service_jobs).
 */
export const listSiteHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SiteHistoryRow[]> => {
    await me(context);
    const sb = context.supabase;
    const { data: job, error: jobErr } = await sb
      .from("service_jobs")
      .select("site_id")
      .eq("id", data.id)
      .maybeSingle();
    if (jobErr) throw new Error(jobErr.message);
    if (!job?.site_id) return [];
    const { data: rows, error } = await sb
      .from("service_jobs")
      .select(
        "id, number, stage, service_type, scheduled_date, completed_at, created_at, closing_notes, description, technician_id",
      )
      .eq("site_id", job.site_id)
      .neq("id", data.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(SITE_HISTORY_LIMIT);
    if (error) throw new Error(error.message);
    const { data: techs } = await sb.rpc("technician_options");
    const names = new Map<string, string>();
    for (const t of techs ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
    return (rows ?? []).map(({ technician_id, ...r }) => ({
      ...r,
      technician_name: technician_id ? (names.get(technician_id) ?? null) : null,
    }));
  });
