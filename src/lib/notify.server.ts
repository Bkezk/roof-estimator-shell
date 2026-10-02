/**
 * Notification delivery — SERVER ONLY (imports the service-role client and web-push). Load it
 * inside a handler with `await import("@/lib/notify.server")`; never from a *.functions.ts
 * top level, which ships to the browser.
 *
 * Channels (owner, Sep 27): in-app inbox always; email through Resend when RESEND_API_KEY is
 * set; web push when the user has enabled it on a device. The push signing keys (VAPID) are
 * generated once and kept in app_secrets, a table no client can read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { generateVapidKeys, sendWebPush } from "@/lib/webpush";

/**
 * Which client writes: the service-role client when Lovable Cloud provides its key (the
 * published app), else the signed-in user's own client under RLS (the preview has no service
 * key — owner's Sep 27 blank-screen report). Everything here works either way; only the push
 * signing keys need the service role (they live in app_secrets, which no user can read).
 */
export type Client = SupabaseClient<Database>;
export const hasServiceRole = () => !!process.env["SUPABASE_SERVICE_ROLE_KEY"];
export async function serverClient(fallback: Client): Promise<Client> {
  if (!hasServiceRole()) return fallback;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}
async function adminOrNull(): Promise<Client | null> {
  if (!hasServiceRole()) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}
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
export async function vapidKeys(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const admin = await adminOrNull();
  if (!admin)
    throw new Error(
      "Push needs the server key (SUPABASE_SERVICE_ROLE_KEY); it is set on the published app, not the preview",
    );
  const { data, error } = await admin
    .from("app_secrets")
    .select("key, value")
    .in("key", ["vapid_public", "vapid_private"]);
  if (error) throw new Error(error.message);
  const pub = data?.find((r) => r.key === "vapid_public")?.value;
  const priv = data?.find((r) => r.key === "vapid_private")?.value;
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const fresh = await generateVapidKeys();
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
): Promise<{ ok: true } | { ok: false; gone: boolean; error: string }> {
  try {
    const keys = await vapidKeys();
    const r = await sendWebPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      JSON.stringify({
        title: payload.title,
        body: payload.body ?? "",
        url: payload.url ? `${appUrl()}${payload.url}` : appUrl() || "/",
        tag: payload.tag ?? "bid-o-matic",
      }),
      { keys, subject: contactSubject(), ttlSeconds: 60 * 60 * 24 },
    );
    if (r.ok) return { ok: true };
    return { ok: false, gone: r.gone, error: r.error ?? `push service answered ${r.status}` };
  } catch (e) {
    return { ok: false, gone: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Write one inbox row per recipient and deliver it by email and push according to each
 * user's channels. Never throws for a delivery failure: the row records the error and the
 * admin screen shows it. Returns how many rows were written.
 */
export async function notify(userIds: string[], msg: Outgoing, sb: Client): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const admin = await serverClient(sb);
  // Recipients' channels: a SECURITY DEFINER read (profiles RLS hides other users' rows).
  const { data: people, error } = await admin.rpc("notify_recipients", { ids });
  if (error) throw new Error(error.message);
  const inserts = (people ?? []).map((p) => ({
    user_id: p.id,
    kind: msg.kind,
    title: msg.title,
    body: msg.body ?? null,
    url: msg.url ?? null,
    followup_id: msg.followup_id ?? null,
  }));
  if (!inserts.length) return 0;
  // Under RLS a user may insert another user's row but not read it back, so the ids come back
  // only with the service role; the delivery marks are skipped otherwise.
  let rows: { id: number; user_id: string }[] = [];
  if (hasServiceRole()) {
    const { data, error: insErr } = await admin
      .from("notifications")
      .insert(inserts)
      .select("id, user_id");
    if (insErr) throw new Error(insErr.message);
    rows = data ?? [];
  } else {
    const { error: insErr } = await admin.from("notifications").insert(inserts);
    if (insErr) throw new Error(insErr.message);
    rows = inserts.map((r) => ({ id: 0, user_id: r.user_id }));
  }
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
        const r = await sendPush(s, {
          title: msg.title,
          body: msg.body ?? null,
          url: msg.url ?? null,
        });
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
    if (Object.keys(patch).length && row.id)
      await admin.from("notifications").update(patch).eq("id", row.id);
  }
  return rows.length;
}

export type FollowupRow = Database["public"]["Tables"]["crm_followups"]["Row"];
export interface DispatchResult {
  /** Follow-ups whose reminder was due (read at the start of the pass). */
  checked: number;
  /** Assignee reminders delivered (inbox row written). */
  reminded: number;
  /** Untouched-item escalations delivered. */
  escalated: number;
  /** Steps that failed (claim, reminder or escalation); each is logged and recorded on its row. */
  failed: number;
  /** Due follow-ups another pass claimed first (the cron and a page load at once). */
  skipped: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Record a failed step on the follow-up (dispatch_errors / last_dispatch_error, migration
 * 20261002090000) and in the server log. Never throws: before that migration is applied the
 * columns are missing and only the log line remains.
 */
async function recordFailure(admin: Client, f: FollowupRow, step: string, e: unknown) {
  const message = `${step}: ${errText(e)}`;
  console.error(`Reminder pass: follow-up ${f.id} (${f.title}) failed at ${message}`);
  try {
    const { error } = await admin
      .from("crm_followups")
      .update({
        dispatch_errors: (f.dispatch_errors ?? 0) + 1,
        last_dispatch_error: message.slice(0, 1000),
        last_dispatch_error_at: new Date().toISOString(),
      })
      .eq("id", f.id);
    if (error) throw new Error(error.message);
  } catch (e2) {
    console.error(`Reminder pass: could not record the failure on follow-up ${f.id}`, e2);
  }
}

/**
 * Fire every due follow-up reminder: one inbox row (+ email / push) per open follow-up whose
 * next_remind_at has passed, and push its next reminder out by every_days. Runs from the cron
 * route and, throttled, from the app (followups.functions.ts dispatchRemindersIfDue). Returns
 * what it did.
 *
 * Each follow-up is CLAIMED before anything is sent: one conditional update moves
 * next_remind_at on (and stamps last_reminded_at / reminders_sent) only where it still holds the
 * value this pass read. Two passes at once (the cron and an office user's page load) both read
 * the item, but only one update matches; the other affects no row and sends nothing. The claim
 * is never rolled back: if a send then fails, the failure is recorded on the row and logged,
 * and the item waits for its next reminder. A missed reminder is better than a duplicate, and an
 * escalation failure can no longer make the assignee hear the same reminder twice.
 *
 * Each follow-up is handled on its own: an error on one is recorded and the pass goes on.
 */
export async function dispatchDueReminders(sb: Client): Promise<DispatchResult> {
  const admin = await serverClient(sb);
  const now = new Date();
  const { data: due, error } = await admin
    .from("crm_followups")
    .select("*")
    .eq("status", "open")
    .lte("next_remind_at", now.toISOString())
    .order("next_remind_at")
    .limit(200);
  if (error) throw new Error(error.message);
  // Untouched past the limit (owner, Sep 28): assigned, never contacted, never started. When
  // such an item's reminder fires, admins (and any named users) hear about it too, on the
  // same cadence, until someone logs a contact or starts it. crm_untouched() applies the
  // caller's read rules: the cron's service role and office users see everything.
  const [{ data: untouched, error: untouchedErr }, { data: escalateTo, error: escalateErr }] =
    await Promise.all([admin.rpc("crm_untouched"), admin.rpc("escalation_recipients")]);
  const lookupErr = untouchedErr ?? escalateErr;
  if (lookupErr) console.error("Reminder pass: no escalations this pass —", lookupErr.message);
  const untouchedByItem = new Map<string, NonNullable<typeof untouched>[number]>();
  for (const u of untouched ?? []) {
    const since = u.assigned_at
      ? Math.floor((now.getTime() - Date.parse(u.assigned_at)) / 86400000)
      : 0;
    if (since >= u.limit_days) untouchedByItem.set(`${u.kind}:${u.item_id}`, u);
  }
  const out: DispatchResult = {
    checked: due?.length ?? 0,
    reminded: 0,
    escalated: 0,
    failed: 0,
    skipped: 0,
  };
  for (const f of due ?? []) {
    // 1. Claim (see above). Lost to another pass: skip. Could not claim: record, skip.
    const next = new Date(now.getTime() + f.every_days * 86400000);
    try {
      const { data: won, error: claimErr } = await admin
        .from("crm_followups")
        .update({
          next_remind_at: next.toISOString(),
          reminders_sent: f.reminders_sent + 1,
          last_reminded_at: now.toISOString(),
        })
        .eq("id", f.id)
        .eq("status", "open")
        .eq("next_remind_at", f.next_remind_at)
        .select("id");
      if (claimErr) throw new Error(claimErr.message);
      if (!won?.length) {
        out.skipped++;
        continue;
      }
    } catch (e) {
      out.failed++;
      await recordFailure(admin, f, "claim", e);
      continue;
    }

    // 2. The assignee's reminder.
    const dueDate = new Date(f.due_at);
    const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
    const when =
      overdueDays > 0
        ? `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`
        : overdueDays === 0
          ? "due today"
          : `due ${dueDate.toLocaleDateString("en-US")}`;
    try {
      await notify(
        [f.assignee_id],
        {
          kind: "followup",
          title: `Follow up: ${f.title}`,
          body: `${when}. Reminder ${f.reminders_sent + 1}; it repeats every ${f.every_days} day${f.every_days === 1 ? "" : "s"} until the item is finished or closed.`,
          url: f.url,
          followup_id: f.id,
        },
        admin,
      );
      out.reminded++;
    } catch (e) {
      out.failed++;
      await recordFailure(admin, f, "reminder", e);
    }

    // 3. The escalation, under the same claim (it never re-sends the assignee's reminder).
    const u = untouchedByItem.get(`${f.kind}:${f.item_id}`);
    if (!u) continue;
    const recipients = (escalateTo ?? []).filter((id) => id !== f.assignee_id);
    if (!recipients.length) continue;
    const since = u.assigned_at
      ? Math.floor((now.getTime() - Date.parse(u.assigned_at)) / 86400000)
      : 0;
    try {
      await notify(
        recipients,
        {
          kind: "untouched",
          title: `Untouched ${f.kind === "opportunity" ? "opportunity" : "ticket"}: ${u.title}`,
          body: `Assigned to ${u.assignee_name ?? "someone"} ${since} day${since === 1 ? "" : "s"} ago; no contact logged and not started. Limit is ${u.limit_days} day${u.limit_days === 1 ? "" : "s"}.`,
          url: f.url,
          followup_id: f.id,
        },
        admin,
      );
      out.escalated++;
    } catch (e) {
      out.failed++;
      await recordFailure(admin, f, "escalation", e);
    }
  }
  // SECURITY DEFINER stamp (it arms the app's ten-minute throttle): the pass may run as an
  // office user who cannot edit settings, or as the service role (20261002090000).
  const { error: stampErr } = await admin.rpc("stamp_dispatch");
  if (stampErr)
    console.error("Reminder pass: could not stamp last_dispatch_at —", stampErr.message);
  return out;
}
