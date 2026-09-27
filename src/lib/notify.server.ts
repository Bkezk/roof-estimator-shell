/**
 * Notification delivery — SERVER ONLY (imports the service-role client and web-push). Load it
 * inside a handler with `await import("@/lib/notify.server")`; never from a *.functions.ts
 * top level, which ships to the browser.
 *
 * Channels (owner, Sep 27): in-app inbox always; email through Resend when RESEND_API_KEY is
 * set; web push when the user has enabled it on a device. The push signing keys (VAPID) are
 * generated once and kept in app_secrets, a table no client can read.
 */
import webpush from "web-push";

import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Admin = typeof supabaseAdmin;
export type PushSubRow = Database["public"]["Tables"]["push_subscriptions"]["Row"];

export interface Outgoing {
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  followup_id?: string | null;
}

/** Where email comes from. Resend's onboarding sender only delivers to the account owner. */
export const fromAddress = () =>
  process.env["NOTIFY_FROM_EMAIL"] || "Bid-O-Matic <onboarding@resend.dev>";
const contactSubject = () =>
  `mailto:${process.env["NOTIFY_CONTACT_EMAIL"] || "sales@flatroofonline.com"}`;
/** The app's public origin for links in emails and push (set APP_URL in Lovable Cloud). */
export const appUrl = () => (process.env["APP_URL"] || "").replace(/\/+$/, "");

export const emailConfigured = () => !!process.env["RESEND_API_KEY"];

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set (Lovable Cloud › secrets)" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The VAPID pair, generated on first use and kept in app_secrets. */
export async function vapidKeys(admin: Admin = supabaseAdmin): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const { data, error } = await admin
    .from("app_secrets")
    .select("key, value")
    .in("key", ["vapid_public", "vapid_private"]);
  if (error) throw new Error(error.message);
  const pub = data?.find((r) => r.key === "vapid_public")?.value;
  const priv = data?.find((r) => r.key === "vapid_private")?.value;
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const fresh = webpush.generateVAPIDKeys();
  const { error: upErr } = await admin.from("app_secrets").upsert([
    { key: "vapid_public", value: fresh.publicKey },
    { key: "vapid_private", value: fresh.privateKey },
  ]);
  if (upErr) throw new Error(upErr.message);
  return fresh;
}

export async function sendPush(
  sub: Pick<PushSubRow, "endpoint" | "p256dh" | "auth">,
  payload: { title: string; body?: string | null; url?: string | null; tag?: string },
  admin: Admin = supabaseAdmin,
): Promise<{ ok: true } | { ok: false; gone: boolean; error: string }> {
  try {
    const keys = await vapidKeys(admin);
    webpush.setVapidDetails(contactSubject(), keys.publicKey, keys.privateKey);
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: payload.title,
        body: payload.body ?? "",
        url: payload.url ? `${appUrl()}${payload.url}` : appUrl() || "/",
        tag: payload.tag ?? "bid-o-matic",
      }),
      { TTL: 60 * 60 * 24 },
    );
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return {
      ok: false,
      gone: status === 404 || status === 410,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Write one inbox row per recipient and deliver it by email and push according to each
 * user's channels. Never throws for a delivery failure: the row records the error and the
 * admin screen shows it. Returns how many rows were written.
 */
export async function notify(
  userIds: string[],
  msg: Outgoing,
  admin: Admin = supabaseAdmin,
): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const { data: people, error } = await admin
    .from("profiles")
    .select("id, email, full_name, notify_email, notify_push")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const { data: rows, error: insErr } = await admin
    .from("notifications")
    .insert(
      (people ?? []).map((p) => ({
        user_id: p.id,
        kind: msg.kind,
        title: msg.title,
        body: msg.body ?? null,
        url: msg.url ?? null,
        followup_id: msg.followup_id ?? null,
      })),
    )
    .select("id, user_id");
  if (insErr) throw new Error(insErr.message);
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", ids)
    .is("failed_at", null);
  const link = msg.url ? `${appUrl()}${msg.url}` : "";
  for (const row of rows ?? []) {
    const p = (people ?? []).find((x) => x.id === row.user_id);
    if (!p) continue;
    const patch: Database["public"]["Tables"]["notifications"]["Update"] = {};
    if (p.notify_email) {
      const text = `${msg.title}\n\n${msg.body ?? ""}${link ? `\n\nOpen: ${link}` : ""}\n\n— Bid-O-Matic`;
      const r = await sendEmail({ to: p.email, subject: msg.title, text });
      if (r.ok) patch.email_sent_at = new Date().toISOString();
      else patch.email_error = r.error;
    }
    if (p.notify_push) {
      const mine = (subs ?? []).filter((s) => s.user_id === p.id);
      if (!mine.length) patch.push_error = "no device has push turned on";
      let sent = 0;
      for (const s of mine) {
        const r = await sendPush(
          s,
          { title: msg.title, body: msg.body ?? null, url: msg.url ?? null },
          admin,
        );
        if (r.ok) {
          sent++;
          await admin
            .from("push_subscriptions")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", s.id);
        } else {
          await admin
            .from("push_subscriptions")
            .update(r.gone ? { failed_at: new Date().toISOString() } : {})
            .eq("id", s.id);
          patch.push_error = r.error;
        }
      }
      if (sent) {
        patch.push_sent_at = new Date().toISOString();
        patch.push_error = null;
      }
    }
    if (Object.keys(patch).length) await admin.from("notifications").update(patch).eq("id", row.id);
  }
  return rows?.length ?? 0;
}

/**
 * Fire every due follow-up reminder: one inbox row (+ email / push) per open follow-up whose
 * next_remind_at has passed, then push its next reminder out by every_days. Runs from the cron
 * route and, throttled, from the app (followups.functions.ts). Returns what it did.
 */
export async function dispatchDueReminders(
  admin: Admin = supabaseAdmin,
): Promise<{ reminded: number; checked: number }> {
  const now = new Date();
  const { data: due, error } = await admin
    .from("crm_followups")
    .select("*")
    .eq("status", "open")
    .lte("next_remind_at", now.toISOString())
    .order("next_remind_at")
    .limit(200);
  if (error) throw new Error(error.message);
  let reminded = 0;
  for (const f of due ?? []) {
    const dueDate = new Date(f.due_at);
    const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
    const when =
      overdueDays > 0
        ? `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`
        : overdueDays === 0
          ? "due today"
          : `due ${dueDate.toLocaleDateString("en-US")}`;
    await notify(
      [f.assignee_id],
      {
        kind: "followup",
        title: `Follow up: ${f.title}`,
        body: `${when}. Reminder ${f.reminders_sent + 1}; it repeats every ${f.every_days} day${f.every_days === 1 ? "" : "s"} until you close it.`,
        url: f.url,
        followup_id: f.id,
      },
      admin,
    );
    const next = new Date(now.getTime() + f.every_days * 86400000);
    await admin
      .from("crm_followups")
      .update({
        next_remind_at: next.toISOString(),
        reminders_sent: f.reminders_sent + 1,
        last_reminded_at: now.toISOString(),
      })
      .eq("id", f.id);
    reminded++;
  }
  await admin.from("crm_settings").update({ last_dispatch_at: now.toISOString() }).eq("id", 1);
  return { reminded, checked: due?.length ?? 0 };
}
