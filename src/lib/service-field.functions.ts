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
import { canAccess } from "@/lib/access";
import type { ServiceJobRow } from "@/lib/service.functions";

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
/** A technician may only touch their own ticket; office users and admins any. */
async function ownJob(ctx: Ctx, id: string): Promise<ServiceJobRow> {
  const p = await me(ctx);
  const { data: job, error } = await ctx.supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Ticket not found");
  if (p.technician && p.role !== "admin" && job.technician_id !== ctx.userId)
    throw new Error("This ticket is assigned to someone else");
  return job;
}
/** Hours between two stamps, to the quarter hour, never under a quarter. */
export function quarterHours(from: string | Date, to: string | Date): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  const q = Math.round(ms / (15 * 60 * 1000)) / 4;
  return Math.max(0.25, q);
}
async function logEvent(
  ctx: Ctx,
  jobId: string,
  ev: {
    kind: JobEventRow["kind"];
    stage?: string | null;
    field_status?: string | null;
    note?: string | null;
    meta?: Record<string, unknown>;
  },
  byName: string,
) {
  await ctx.supabase.from("service_job_events").insert({
    service_job_id: jobId,
    kind: ev.kind,
    stage: ev.stage ?? null,
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
    if (p.technician && p.role !== "admin") q = q.eq("technician_id", context.userId);
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
    const [{ data: sites }, { data: contacts }, { data: accounts }] = await Promise.all([
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
    ]);
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
      .object({ id: z.string().uuid(), to: z.enum(["en_route", "on_site", "done", "undo"]) })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobRow> => {
    const p = await me(context);
    const job = await ownJob(context, data.id);
    const sb = context.supabase;
    const now = new Date().toISOString();
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
          on_date: now.slice(0, 10),
          created_by: context.userId,
        });
      }
      await logEvent(context, job.id, { kind: "field", field_status: "on_site" }, who);
    } else if (data.to === "done") {
      if (job.stage === "done" || job.stage === "invoiced" || job.stage === "closed") return job;
      patch = { field_status: null, completed_at: now, stage: "done" };
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
          on_date: now.slice(0, 10),
          created_by: context.userId,
        });
      }
      await logEvent(context, job.id, { kind: "stage", stage: "done" }, who);
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
          closing: row.stage === "done" || row.stage === "invoiced" || row.stage === "closed",
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
    const job = await ownJob(context, data.service_job_id);
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
    await ownJob(context, data.service_job_id);
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
    await me(context);
    let q = context.supabase
      .from("repair_templates")
      .select("*")
      .eq("active", true)
      .order("favorite", { ascending: false })
      .order("usage_count", { ascending: false })
      .order("name")
      .limit(data.limit ?? 60);
    if (data.q) q = q.ilike("name", `%${data.q.replace(/[%_,]/g, " ")}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
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
    if (!(canAccess(p, "customers") || p.role === "admin"))
      throw new Error("Forbidden: Customers access required to edit templates");
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
});
export type JobRepairInput = z.input<typeof repairSchema>;
/** Add or edit a repair on a ticket; a template fills the name and texts when given. */
export const saveJobRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => repairSchema.parse(d))
  .handler(async ({ data, context }): Promise<JobRepairRow> => {
    const job = await ownJob(context, data.service_job_id);
    const sb = context.supabase;
    const { id, ...fields } = data;
    const row = {
      ...fields,
      repair_template_id: fields.repair_template_id ?? null,
      problem_text: fields.problem_text ?? null,
      resolution_text: fields.resolution_text ?? null,
      completed_on: fields.completed_on ?? new Date().toISOString().slice(0, 10),
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
    await ownJob(context, data.service_job_id);
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
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    await ownJob(context, data.id);
    await logEvent(context, data.id, { kind: "note", note: data.note }, nameOf(p));
  });

/** Templates used before on this site (or account), most recent first — the "usual" chips. */
export const recentRepairsForJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RepairTemplateRow[]> => {
    await me(context);
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
    const { data: templates } = await sb
      .from("repair_templates")
      .select("*")
      .in("id", seen.slice(0, 12))
      .eq("active", true);
    const order = new Map(seen.map((id, i) => [id, i]));
    return (templates ?? []).sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  });
