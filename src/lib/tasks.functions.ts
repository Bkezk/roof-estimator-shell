/**
 * Tasks on a calendar (owner, Sep 30, item 11) — server functions. The rules are in tasks.ts;
 * the emails in tasks-notify.server.ts.
 *
 * Any signed-in user may make a task. A task is visible to (and editable by) its creator, its
 * assignee and its attendees; admins and managers see all. RLS (tasks_read / tasks_write,
 * migration 20260930094000) enforces the same; the checks here give a readable error.
 *
 * The older task functions in prospect.functions.ts (saveTask / setTaskDone / listOpenTasks)
 * still work: they write due_date only and the tasks_sync trigger fills due_at.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { CLAIM_NEEDS_TICK, CLAIM_TAKEN, canClaim } from "@/lib/access";
import {
  addedAttendees,
  attendeeList,
  canSeeTask,
  cleanEmails,
  dueAtFor,
  isAllDay,
  localHm,
  noticeRecipients,
  seesAllTasks,
  taskDueAt,
  taskInputSchema,
  type TaskRow,
} from "@/lib/tasks";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

export interface TaskUser {
  id: string;
  full_name: string | null;
  email: string;
}
export const userLabel = (u: Pick<TaskUser, "full_name" | "email"> | null | undefined) =>
  (u?.full_name ?? "").trim() || u?.email || "";

async function me(ctx: Ctx) {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("id, role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: no profile for this login");
  return data;
}

async function users(ctx: Ctx): Promise<TaskUser[]> {
  const { data, error } = await ctx.supabase.rpc("assignable_users");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadVisible(ctx: Ctx, id: string, profile: { id: string; role: string }) {
  const { data, error } = await ctx.supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !canSeeTask(profile, data))
    throw new Error("Task not found — it was deleted, or you are not on it");
  return data;
}

/** Everyone a task can be assigned to or include: id, name, email. */
export const listAssignableUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskUser[]> => users(context));

/** The sites (properties) of one company, for the task's Property select. */
export const listTaskSites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ account_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("crm_sites")
      .select("id, name, address1, city, state")
      .eq("account_id", data.account_id)
      .is("deleted_at", null)
      .order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const listSchema = z.object({
  /** Due on or after this date (YYYY-MM-DD). */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  /** Due on or before this date. */
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  /** Only tasks I made, am assigned or attend (admins and managers otherwise see all). */
  mine: z.boolean().optional(),
  openOnly: z.boolean().optional(),
  buildingId: z.string().uuid().nullable().optional(),
});

/**
 * Tasks in a date range (the calendar) or all open ones (the list), soonest first, undated
 * last. The range reads due_date, which the trigger keeps equal to due_at's Eastern date, so
 * rows written by the older functions (due_date only) are included.
 */
export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<TaskRow[]> => {
    const profile = await me(context);
    const uid = context.userId;
    let q = context.supabase.from("tasks").select("*");
    if (data.from) q = q.gte("due_date", data.from);
    if (data.to) q = q.lte("due_date", data.to);
    if (data.openOnly) q = q.eq("status", "open");
    if (data.buildingId) q = q.eq("building_id", data.buildingId);
    if (data.mine || !seesAllTasks(profile))
      q = q.or(`created_by.eq.${uid},assignee.eq.${uid},attendees.cs.{${uid}}`);
    const { data: rows, error } = await q
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (rows ?? []).filter((t) => canSeeTask(profile, t));
  });

/**
 * done_at / done_by / done_by_name for a save (owner, Oct 9: tasks carry the done stamp like a
 * ticket). Becoming done stamps the caller and now; staying done keeps the stamp it has (an
 * edit to a done task is not a second completion); open clears all three.
 */
export function doneFields(
  status: "open" | "done",
  before: Pick<TaskRow, "status" | "done_at" | "done_by" | "done_by_name"> | null,
  userId: string,
  userName: string | null,
): Pick<Database["public"]["Tables"]["tasks"]["Update"], "done_at" | "done_by" | "done_by_name"> {
  if (status !== "done") return { done_at: null, done_by: null, done_by_name: null };
  if (before?.status === "done")
    return { done_at: before.done_at, done_by: before.done_by, done_by_name: before.done_by_name };
  return { done_at: new Date().toISOString(), done_by: userId, done_by_name: userName };
}

export interface SaveTaskResult {
  task: TaskRow;
  /** Users and outside emails a "New task" notice went to on this save. */
  notified: number;
  /** Delivery problems (the save itself went through). */
  notifyErrors: string[];
}

/** Create or edit a task; a new task (or newly added attendees) get the "New task" notice. */
export const saveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => taskInputSchema.parse(d))
  .handler(async ({ data, context }): Promise<SaveTaskResult> => {
    const profile = await me(context);
    const sb = context.supabase;
    const before = data.id ? await loadVisible(context, data.id, profile) : null;
    const roster = await users(context);
    const known = new Set(roster.map((u) => u.id));
    const assignee = data.assignee ?? (before ? null : context.userId);
    if (assignee && !known.has(assignee)) throw new Error("The assignee is not a user of the app");
    const unknown = data.attendees.filter((id) => !known.has(id));
    if (unknown.length) throw new Error("An attendee is not a user of the app");
    const nameOf = (id: string | null) =>
      id ? userLabel(roster.find((u) => u.id === id)) || null : null;
    const status = data.status ?? (before?.status === "done" ? "done" : "open");
    const fields: Database["public"]["Tables"]["tasks"]["Update"] = {
      title: data.title,
      details: data.details?.trim() || null,
      account_id: data.account_id,
      account_name: data.account_id ? data.account_name?.trim() || null : null,
      // The property is one of the company's sites.
      site_id: data.account_id ? data.site_id : null,
      site_name: data.account_id && data.site_id ? data.site_name?.trim() || null : null,
      building_id: data.building_id,
      due_at: dueAtFor(data),
      due_date: data.date,
      all_day: data.date ? data.all_day || !data.time : true,
      assignee,
      assignee_name: nameOf(assignee),
      attendees: attendeeList(assignee, data.attendees),
      external_emails: cleanEmails(data.external_emails),
      status,
      // The done stamp (owner, Oct 9: "the done by and done at stamp"): who and when, set once
      // when the task becomes done, kept while it stays done, cleared when it is reopened.
      ...doneFields(status, before, context.userId, userLabel(profile) || null),
    };
    let row: TaskRow;
    if (before) {
      const { data: saved, error } = await sb
        .from("tasks")
        .update(fields)
        .eq("id", before.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      row = saved;
    } else {
      const { data: saved, error } = await sb
        .from("tasks")
        .insert({
          ...fields,
          title: data.title,
          source: "manual",
          created_by: context.userId,
          created_by_name: userLabel(profile) || null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      row = saved;
    }
    if (row.status === "done") return { task: row, notified: 0, notifyErrors: [] };

    // The "New task" notice: everyone on a new task, only the added ones on an edit.
    const to = before
      ? (() => {
          const added = addedAttendees(before, row);
          return { users: added.users.filter((u) => u !== context.userId), emails: added.emails };
        })()
      : noticeRecipients(row, "created", context.userId);
    try {
      const { sendTaskNotice } = await import("@/lib/tasks-notify.server");
      const r =
        to.users.length || to.emails.length
          ? await sendTaskNotice(row, "created", to, sb)
          : { users: 0, emails: 0, errors: [] as string[] };
      if (!before || r.errors.length) {
        const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
        if (!before) patch.notified_created_at = new Date().toISOString();
        patch.notify_error = r.errors.length ? r.errors.join("; ").slice(0, 1000) : null;
        const { data: stamped } = await sb
          .from("tasks")
          .update(patch)
          .eq("id", row.id)
          .select()
          .maybeSingle();
        if (stamped) row = stamped;
      }
      return { task: row, notified: r.users + r.emails, notifyErrors: r.errors };
    } catch (e) {
      // Saved, but the notice did not go: the reminder pass sends it (notified_created_at
      // stays empty on a new task).
      return {
        task: row,
        notified: 0,
        notifyErrors: [e instanceof Error ? e.message : String(e)],
      };
    }
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["open", "done"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<TaskRow> => {
    const profile = await me(context);
    const before = await loadVisible(context, data.id, profile);
    const { data: row, error } = await context.supabase
      .from("tasks")
      .update({
        status: data.status,
        ...doneFields(data.status, before, context.userId, userLabel(profile) || null),
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Take a task nobody is on for yourself (owner, Oct 9: tasks on Work Overview behave like
 * services — the Unassigned group and Claim, as claimServiceJob / claimOpportunity). Who:
 * `canClaim` (ticked Technician, not technician-only, with Service). Under RLS the row is
 * nobody's, so the claimer is not its creator, assignee or attendee: 20261009100000 adds
 * tasks_read_unassigned (read an open task with no assignee) and tasks_claim (update it, only
 * into one assigned to yourself) on can_claim(), the SQL twin of `canClaim`. `.is("assignee",
 * null)` on the update means two people cannot both take it. A date (a drop on a calendar day)
 * moves the task to that day, keeping its time of day; without one it keeps its date.
 */
export const claimTask = createServerFn({ method: "POST" })
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
  .handler(async ({ data, context }): Promise<TaskRow> => {
    const p = await me(context);
    if (!canClaim(p)) throw new Error(CLAIM_NEEDS_TICK);
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("tasks")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Task not found");
    if (cur.assignee) throw new Error(CLAIM_TAKEN);
    if (cur.status !== "open") throw new Error("Only an open task can be claimed");
    const at = taskDueAt(cur);
    const allDay = isAllDay(cur);
    const moved = data.date
      ? { date: data.date, time: at && !allDay ? localHm(at) : null, all_day: allDay }
      : null;
    const { data: row, error } = await sb
      .from("tasks")
      .update({
        assignee: context.userId,
        assignee_name: userLabel(p) || null,
        attendees: attendeeList(context.userId, cur.attendees ?? []),
        ...(moved ? { due_date: moved.date, due_at: dueAtFor(moved) } : {}),
      })
      .eq("id", data.id)
      .is("assignee", null)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(CLAIM_TAKEN);
    return row;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const profile = await me(context);
    await loadVisible(context, data.id, profile);
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
