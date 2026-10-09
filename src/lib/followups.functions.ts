/**
 * Follow-ups, notifications and reminder settings — the client-callable side
 * (docs/service-module-design.md §11). Delivery and the timer rules live in the server-only
 * modules notify.server.ts and followups.server.ts, loaded inside handlers.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import { LOG_NOTE_METHOD } from "@/lib/contact-log.functions";
import { easternYmd } from "@/lib/field-day";
import {
  HOLD_NEEDS_MIGRATION,
  HOLD_REASON_MAX,
  holdDateProblem,
  holdNote,
  holdReasonProblem,
  holdUntilFromDays,
  isMissingRpc,
} from "@/lib/followup-holds";
import { canManageFollowup, FOLLOWUP_MANAGER_ONLY } from "@/lib/followup-rules";

export type FollowupRow = Database["public"]["Tables"]["crm_followups"]["Row"];
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type CrmSettingsRow = Database["public"]["Tables"]["crm_settings"]["Row"];

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email, notify_email, notify_push")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Profile not found");
  return data;
}
const officeLike = (p: { role: string; access: string[] }) =>
  canAccess(p, "customers") || canAccess(p, "service") || canAccess(p, "estimate");

/** A follow-up with its assignee's name (admins and Customers users see everyone's). */
export type FollowupWithName = FollowupRow & { assignee_name: string };

export const listFollowups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ include_closed: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<FollowupWithName[]> => {
    const sb = context.supabase;
    let q = sb.from("crm_followups").select("*").order("due_at").limit(1000);
    if (!data.include_closed) q = q.eq("status", "open");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return withAssigneeNames(sb, rows ?? []);
  });

/**
 * Assignee names from crm_user_options (every user, for anyone with Customers, Service or
 * Estimate access — it was technician_options, which answers Service users only), then the
 * caller's own profile row for anyone left.
 */
async function withAssigneeNames(
  sb: SupabaseClient<Database>,
  rows: FollowupRow[],
): Promise<FollowupWithName[]> {
  if (!rows.length) return [];
  const names = new Map<string, string>();
  const { data: people } = await sb.rpc("crm_user_options");
  for (const t of people ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
  const missing = [...new Set(rows.map((r) => r.assignee_id).filter((id) => !names.has(id)))];
  if (missing.length) {
    const { data: own } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .in("id", missing);
    for (const t of own ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
  }
  return rows.map((r) => ({ ...r, assignee_name: names.get(r.assignee_id) ?? "(user)" }));
}

/**
 * One item's open follow-up, or null (the opportunity page's follow-up strip). Read by item, so
 * it is found however many follow-ups there are (audit, Oct 2: the strip searched the first
 * 1,000 rows of listFollowups and said "No open follow-up" past them).
 */
export const followupForItem = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        kind: z.enum(["ticket", "opportunity", "invoice"]),
        item_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<FollowupWithName | null> => {
    const { data: rows, error } = await context.supabase
      .from("crm_followups")
      .select("*")
      .eq("kind", data.kind)
      .eq("item_id", data.item_id)
      .eq("status", "open")
      .limit(1);
    if (error) throw new Error(error.message);
    const [row] = await withAssigneeNames(context.supabase, rows ?? []);
    return row ?? null;
  });

/**
 * Close a follow-up by hand (the item itself keeps its status). Admins and managers only (owner,
 * Oct 1); the database trigger crm_followups_manager_only says the same. The automatic close
 * when an item is finished is syncFollowup's (followups.server.ts), not this.
 */
export const closeFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (!canManageFollowup(p)) throw new Error(FOLLOWUP_MANAGER_ONLY);
    const { error, count } = await context.supabase
      .from("crm_followups")
      .update(
        {
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_reason: data.reason || "closed by hand",
        },
        { count: "exact" },
      )
      .eq("id", data.id)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    if (!count) throw new Error("That follow-up is not open, or you may not close it");
  });

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const snoozeSchema = z
  .object({
    id: z.string().uuid(),
    /** The hold's last day of silence (YYYY-MM-DD): tomorrow through 180 days out. */
    until: z.string().regex(YMD).optional(),
    /** Older callers (the 1 / 3 / 7-day menu): mapped to a date. */
    days: z.number().int().min(1).max(180).optional(),
    reason: z.string().trim().min(1).max(HOLD_REASON_MAX).optional(),
  })
  .refine((d) => !!d.until || !!d.days, { message: "A snooze needs a date" });

/** What a hold did (the toast: "On hold until Fri, Oct 24"). */
export interface HoldResult {
  /** YYYY-MM-DD, the last day the reminders stay quiet (they fire that morning). */
  until: string;
  hold_count: number;
}

/**
 * Snooze with a date and a reason (owner, Oct 9; it was "push out by N days"): the follow-up's
 * reminders pause until 08:00 Eastern on `until`, Work Overview moves the item to Waiting and
 * says why and who. Admins and managers only (owner, Oct 1; canManageFollowup, and the database
 * function refuses a 'snooze' by anyone else). `days` is still accepted for older callers and
 * becomes a date; without a reason it reads "Snoozed N days". The write is hold_followup, the
 * one path for every hold (holdFollowup below).
 */
export const snoozeFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => snoozeSchema.parse(d))
  .handler(async ({ data, context }): Promise<HoldResult> => {
    const p = await me(context);
    if (!canManageFollowup(p)) throw new Error(FOLLOWUP_MANAGER_ONLY);
    const { data: f, error: fErr } = await context.supabase
      .from("crm_followups")
      .select("id, kind, item_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!f || f.status !== "open")
      throw new Error("That follow-up is not open, or you may not snooze it");
    // A deleted opportunity's follow-up is not pushed out (deleting closes it; closing stays
    // allowed).
    if (f.kind === "opportunity") {
      const { assertLiveOpportunity } = await import("@/lib/opportunities.functions");
      await assertLiveOpportunity(context.supabase, f.item_id);
    }
    const today = easternYmd();
    const until = data.until ?? holdUntilFromDays(data.days ?? 1, today);
    const reason =
      data.reason ?? `Snoozed ${data.days ?? 1} day${(data.days ?? 1) === 1 ? "" : "s"}`;
    return holdFollowup(context.supabase, {
      followupId: f.id,
      kind: f.kind,
      itemId: f.item_id,
      until,
      reason,
      via: "snooze",
      today,
      actor: { id: context.userId, name: (p.full_name ?? "").trim() || p.email },
    });
  });

export interface HoldInput {
  followupId: string;
  /** The follow-up's kind and item: where the Timeline line goes. */
  kind: string;
  itemId: string;
  /** YYYY-MM-DD. */
  until: string;
  reason: string;
  /** 'snooze': the Snooze popover (managers); 'contact': a logged contact with a date (also the assignee). */
  via: "snooze" | "contact";
  /** The office's day (easternYmd), for the date check. */
  today: string;
  actor: { id: string; name: string | null };
}

/** hold_followup's answer (20261009150000_followup_holds.sql). */
interface HoldOut {
  id: string;
  cleared: boolean;
  until?: string;
  next_remind_at?: string;
  hold_count: number;
  held_by_name?: string | null;
}

/**
 * The one hold path (owner, Oct 9): check the date and the reason, call hold_followup with the
 * CALLER's client (the database function checks who: an admin or a manager, or for 'contact'
 * the follow-up's assignee — auth.uid(), so never the service role here), then put the hold on
 * the item's record: a ticket's Timeline (service_job_events, kind "note", as a date move) or an
 * opportunity's contact log (a plain note, method "note", as its "Expected close moved" line).
 * The line is best effort, like logTicketDateMove: the hold itself is already saved.
 */
export async function holdFollowup(
  sb: SupabaseClient<Database>,
  input: HoldInput,
): Promise<HoldResult> {
  const dateProblem = holdDateProblem(input.until, input.today);
  if (dateProblem) throw new Error(dateProblem);
  const reasonProblem = holdReasonProblem(input.reason);
  if (reasonProblem) throw new Error(reasonProblem);
  const reason = input.reason.trim();
  const r = await sb.rpc("hold_followup", {
    p_followup: input.followupId,
    p_until: input.until,
    p_reason: reason,
    p_via: input.via,
  });
  if (r.error) {
    if (isMissingRpc(r.error)) throw new Error(HOLD_NEEDS_MIGRATION);
    throw new Error(r.error.message);
  }
  const out = r.data as unknown as HoldOut;
  const note = holdNote(input.until, input.actor.name, reason);
  // The hold history (owner's #6): one line per hold, where the item keeps its record.
  const log =
    input.kind === "opportunity"
      ? await sb.from("crm_contact_log").insert({
          kind: "opportunity",
          item_id: input.itemId,
          method: LOG_NOTE_METHOD,
          note,
          by_user: input.actor.id,
          by_name: input.actor.name,
        })
      : await sb.from("service_job_events").insert({
          service_job_id: input.itemId,
          kind: "note",
          note,
          by_user: input.actor.id,
          by_name: input.actor.name,
          meta: { hold_until: input.until, hold_via: input.via, hold_reason: reason },
        });
  if (log.error) console.error("Could not log the hold", log.error.message);
  return { until: input.until, hold_count: out.hold_count };
}

/**
 * End a hold's record (hold_reason, hold_via, held_by, held_by_name, held_at) once a contact is
 * logged without a new date after the hold ended (owner's #5: the "Back from hold" badge shows
 * until then). The dates are left alone. Same callers as holdFollowup; same function.
 */
export async function clearFollowupHold(
  sb: SupabaseClient<Database>,
  followupId: string,
): Promise<void> {
  const r = await sb.rpc("hold_followup", {
    p_followup: followupId,
    p_until: null,
    p_reason: null,
    p_via: "contact",
  });
  if (r.error) {
    if (isMissingRpc(r.error)) throw new Error(HOLD_NEEDS_MIGRATION);
    throw new Error(r.error.message);
  }
}

/** The signed-in user's inbox, newest first. */
export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<NotificationRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("notifications")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ ids: z.array(z.number().int()).max(500).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<void> => {
    let q = context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("read_at", null);
    if (data.ids?.length) q = q.in("id", data.ids);
    const { error } = await q;
    if (error) throw new Error(error.message);
  });

/** Channels for the signed-in user. */
export const getNotifyPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ notify_email: boolean; notify_push: boolean; devices: number }> => {
      const p = await me(context);
      const { count } = await context.supabase
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .is("failed_at", null);
      return { notify_email: p.notify_email, notify_push: p.notify_push, devices: count ?? 0 };
    },
  );

const PREFS_NOT_SAVED = "Your notification settings were not saved. Please try again.";

/**
 * Save the caller's channels through set_my_notify_prefs (their own row only, keyed on
 * auth.uid(); migration 20261002180000_notify_prefs.sql). Not a direct profiles update: only
 * admins may update profiles, so for anyone else that matched 0 rows and looked like success.
 * The function returns the row after the write; anything but the values asked for is an error.
 */
export const setNotifyPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({ notify_email: z.boolean().optional(), notify_push: z.boolean().optional() })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ notify_email: boolean; notify_push: boolean }> => {
    const { data: rows, error } = await context.supabase.rpc("set_my_notify_prefs", {
      p_email: data.notify_email ?? null,
      p_push: data.notify_push ?? null,
    });
    if (error) throw new Error(PREFS_NOT_SAVED);
    const saved = Array.isArray(rows) ? rows[0] : undefined;
    if (
      !saved ||
      (data.notify_email !== undefined && saved.notify_email !== data.notify_email) ||
      (data.notify_push !== undefined && saved.notify_push !== data.notify_push)
    )
      throw new Error(PREFS_NOT_SAVED);
    return { notify_email: saved.notify_email, notify_push: saved.notify_push };
  });

/** The public VAPID key the browser needs to subscribe (generated on first call). */
export const getPushPublicKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ publicKey: string }> => {
    const { vapidKeys } = await import("@/lib/notify.server");
    const k = await vapidKeys();
    return { publicKey: k.publicKey };
  });

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(200) }),
  user_agent: z.string().max(300).optional(),
});
/** Register (or refresh) this browser's push subscription for the signed-in user. */
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => subSchema.parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const { error } = await context.supabase.from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        user_agent: data.user_agent ?? null,
        failed_at: null,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ endpoint: z.string().max(2000) }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId)
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
  });

/** Send the signed-in user a test through every channel they have on. */
export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ email_configured: boolean; app_url: string }> => {
    const { notify, emailConfigured, appUrl } = await import("@/lib/notify.server");
    await notify(
      [context.userId],
      {
        kind: "test",
        title: "Bid-O-Matic test notification",
        body: "If you can read this, reminders will reach you here.",
        url: "/account",
      },
      context.supabase,
    );
    return { email_configured: emailConfigured(), app_url: appUrl() };
  });

export const getCrmSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmSettingsRow> => {
    const { data, error } = await context.supabase
      .from("crm_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

const settingsSchema = z.object({
  opportunity_close_days: z.number().int().min(1).max(365),
  opportunity_first_days: z.number().int().min(0).max(365),
  opportunity_every_days: z.number().int().min(1).max(365),
  ticket_first_days: z.number().int().min(0).max(365),
  ticket_every_days: z.number().int().min(1).max(365),
  // Untouched limits and escalation (owner, Sep 28).
  ticket_untouched_days: z.number().int().min(0).max(365),
  opportunity_untouched_days: z.number().int().min(0).max(365),
  // Owner, Oct 7: nobody's work is flagged Overdue on Work Overview after this many days.
  unassigned_overdue_days: z.number().int().min(0).max(365),
  escalate_to_admins: z.boolean(),
  escalate_user_ids: z.array(z.string().uuid()).max(50),
});
export type CrmSettingsInput = z.input<typeof settingsSchema>;
export const setCrmSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (p.role !== "admin") throw new Error("Forbidden: admin access required");
    const { error } = await context.supabase
      .from("crm_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
  });

/**
 * The lazy dispatcher: an office user's app calls this on load; if the last pass is older than
 * ten minutes it fires the due reminders. The cron route does the same on a schedule.
 */
export const dispatchRemindersIfDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ran: boolean; reminded: number; escalated: number }> => {
    const p = await me(context);
    if (!officeLike(p)) return { ran: false, reminded: 0, escalated: 0 };
    const { data: s } = await context.supabase
      .from("crm_settings")
      .select("last_dispatch_at")
      .eq("id", 1)
      .maybeSingle();
    const last = s?.last_dispatch_at ? Date.parse(s.last_dispatch_at) : 0;
    if (Date.now() - last < 10 * 60 * 1000) return { ran: false, reminded: 0, escalated: 0 };
    try {
      const { dispatchDueReminders } = await import("@/lib/notify.server");
      const r = await dispatchDueReminders(context.supabase);
      return { ran: true, reminded: r.reminded, escalated: r.escalated };
    } catch (e) {
      // Never take the app down over a reminder pass; the Reminders settings page shows it.
      console.error("Reminder dispatch failed", e);
      return { ran: false, reminded: 0, escalated: 0 };
    }
  });

/** Admin: delivery health — the last pass, the email key, recent failures. */
export const notificationHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      last_dispatch_at: string | null;
      email_configured: boolean;
      /** "APP_URL not set" / "NOTIFY_FROM_EMAIL not set": reminder emails are held back. */
      email_problem: string | null;
      app_url: string;
      from: string;
      recent_failures: {
        id: number;
        created_at: string;
        title: string;
        email_error: string | null;
        push_error: string | null;
      }[];
      /** Tasks whose notice (created / morning / overdue) failed: tasks.notify_error. */
      task_failures: TaskNoticeFailure[];
    }> => {
      const p = await me(context);
      if (p.role !== "admin") throw new Error("Forbidden: admin access required");
      const { emailConfigured, emailConfigProblem, appUrl, fromAddress } =
        await import("@/lib/notify.server");
      const [{ data: s }, { data: fails }, { data: taskFails }] = await Promise.all([
        context.supabase.from("crm_settings").select("last_dispatch_at").eq("id", 1).maybeSingle(),
        context.supabase
          .from("notifications")
          .select("id, created_at, title, email_error, push_error")
          .or("email_error.not.is.null,push_error.not.is.null")
          .order("created_at", { ascending: false })
          .limit(20),
        context.supabase
          .from("tasks")
          .select("id, title, notify_error, updated_at, assignee_name")
          .not("notify_error", "is", null)
          .order("updated_at", { ascending: false })
          .limit(20),
      ]);
      return {
        last_dispatch_at: s?.last_dispatch_at ?? null,
        email_configured: emailConfigured(),
        email_problem: emailConfigProblem(),
        app_url: appUrl(),
        from: fromAddress(),
        recent_failures: fails ?? [],
        task_failures: (taskFails ?? []).filter((t): t is TaskNoticeFailure => !!t.notify_error),
      };
    },
  );

/** A task whose notice failed (Admin › Reminders, audit Oct 2: it showed only on the task). */
export interface TaskNoticeFailure {
  id: string;
  title: string;
  notify_error: string;
  updated_at: string;
  assignee_name: string | null;
}
