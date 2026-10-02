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
    const [{ data: rows, error }, { data: techs }] = await Promise.all([
      q,
      sb.rpc("technician_options"),
    ]);
    if (error) throw new Error(error.message);
    const names = new Map<string, string>();
    for (const t of techs ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
    return (rows ?? []).map((r) => ({
      ...r,
      assignee_name: names.get(r.assignee_id) ?? "(user)",
    }));
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

/**
 * Push the next reminder out by N days (the item stays open; My Work shows "Snoozed until …").
 * Admins and managers only (owner, Oct 1), like closeFollowup.
 */
export const snoozeFollowup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), days: z.number().int().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (!canManageFollowup(p)) throw new Error(FOLLOWUP_MANAGER_ONLY);
    // A deleted opportunity's follow-up is not pushed out (deleting closes it; closing stays
    // allowed).
    const { data: f, error: fErr } = await context.supabase
      .from("crm_followups")
      .select("kind, item_id")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (f?.kind === "opportunity") {
      const { assertLiveOpportunity } = await import("@/lib/opportunities.functions");
      await assertLiveOpportunity(context.supabase, f.item_id);
    }
    const next = new Date(Date.now() + data.days * 86400000).toISOString();
    const snooze = (patch: { next_remind_at: string; snoozed_until?: string }) =>
      context.supabase
        .from("crm_followups")
        .update(patch, { count: "exact" })
        .eq("id", data.id)
        .eq("status", "open");
    let { error, count } = await snooze({ next_remind_at: next, snoozed_until: next });
    // Before 20261001030000_followups_manager_only.sql is applied there is no snoozed_until.
    if (error && (error.code === "PGRST204" || /snoozed_until/.test(error.message)))
      ({ error, count } = await snooze({ next_remind_at: next }));
    if (error) throw new Error(error.message);
    if (!count) throw new Error("That follow-up is not open, or you may not snooze it");
  });

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

export const setNotifyPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({ notify_email: z.boolean().optional(), notify_push: z.boolean().optional() })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
        ...(data.notify_email === undefined ? {} : { notify_email: data.notify_email }),
        ...(data.notify_push === undefined ? {} : { notify_push: data.notify_push }),
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
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
      app_url: string;
      from: string;
      recent_failures: {
        id: number;
        created_at: string;
        title: string;
        email_error: string | null;
        push_error: string | null;
      }[];
    }> => {
      const p = await me(context);
      if (p.role !== "admin") throw new Error("Forbidden: admin access required");
      const { emailConfigured, appUrl, fromAddress } = await import("@/lib/notify.server");
      const [{ data: s }, { data: fails }] = await Promise.all([
        context.supabase.from("crm_settings").select("last_dispatch_at").eq("id", 1).maybeSingle(),
        context.supabase
          .from("notifications")
          .select("id, created_at, title, email_error, push_error")
          .or("email_error.not.is.null,push_error.not.is.null")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      return {
        last_dispatch_at: s?.last_dispatch_at ?? null,
        email_configured: emailConfigured(),
        app_url: appUrl(),
        from: fromAddress(),
        recent_failures: fails ?? [],
      };
    },
  );
