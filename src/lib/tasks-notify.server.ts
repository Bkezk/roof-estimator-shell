/**
 * Task email notices — SERVER ONLY (uses notify.server.ts, which may load the service-role
 * client; load this with `await import("@/lib/tasks-notify.server")` inside a handler).
 *
 * Users hear through notify(): an inbox row always, email through Resend when RESEND_API_KEY is
 * set (a failure is kept on the inbox row's email_error, as follow-up reminders do), push when
 * they turned it on. Outside attendees get a plain email of their own — one Resend call per
 * address with only that address in "to", never the internal list — and only when the address
 * is valid; a failure is kept on the task's notify_error.
 *
 * Which notice is due when is dueTaskNotices() in tasks.ts.
 */
import {
  buildTaskEmail,
  cleanEmails,
  dueTaskNotices,
  localYmd,
  noticeRecipients,
  TASK_TZ,
  type TaskNoticeKind,
  type TaskRow,
} from "@/lib/tasks";
import type { Database } from "@/integrations/supabase/types";
import { notify, sendEmail, serverClient, type Client } from "@/lib/notify.server";

const INBOX_KIND: Record<TaskNoticeKind, string> = {
  created: "task",
  morning: "task_today",
  overdue: "task_overdue",
};

/** "Name, address, city" of the map building a task was made from (the property line). */
async function buildingLabel(admin: Client, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await admin
    .from("buildings")
    .select("name, address1, city")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return [data.name, data.address1, data.city].filter((x) => x && String(x).trim()).join(", ");
}

export interface SendResult {
  users: number;
  emails: number;
  errors: string[];
  /** The inbox send (notify()) threw: nobody inside heard this notice (its error is in `errors`). */
  inboxFailed: boolean;
}

/**
 * Send one notice for a task to the given users and outside emails. Never throws for a delivery
 * failure; the failures come back in `errors`.
 */
export async function sendTaskNotice(
  task: TaskRow,
  kind: TaskNoticeKind,
  to: { users: readonly string[]; emails: readonly string[] },
  sb: Client,
): Promise<SendResult> {
  const admin = await serverClient(sb);
  const errors: string[] = [];
  const label = await buildingLabel(admin, task.building_id);
  let users = 0;
  let inboxFailed = false;
  if (to.users.length) {
    const msg = buildTaskEmail(task, kind, { audience: "user", buildingLabel: label });
    try {
      users = await notify(
        [...to.users],
        { kind: INBOX_KIND[kind], title: msg.subject, body: msg.body, url: msg.url },
        admin,
      );
    } catch (e) {
      inboxFailed = true;
      errors.push(`inbox: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let emails = 0;
  const outside = cleanEmails(to.emails);
  if (outside.length) {
    const msg = buildTaskEmail(task, kind, { audience: "outside", buildingLabel: label });
    for (const addr of outside) {
      const r = await sendEmail({ to: addr, subject: msg.subject, text: msg.text });
      if (r.ok) emails++;
      else errors.push(`email to ${addr}: ${r.error}`);
    }
  }
  return { users, emails, errors, inboxFailed };
}

const STAMP: Record<
  TaskNoticeKind,
  "notified_created_at" | "notified_morning_at" | "notified_overdue_at"
> = {
  created: "notified_created_at",
  morning: "notified_morning_at",
  overdue: "notified_overdue_at",
};

/**
 * A notice whose inbox send threw is retried on the next pass (its stamp is left unset) this many
 * times in all; on the last failure it is stamped anyway, so a task that can never be told stops
 * (owner, Oct 12, B3). The count is tasks.notify_failures (20261012180000_bid_notice_claim.sql),
 * one per failing pass, reset by a pass with no failure.
 */
export const TASK_NOTICE_MAX_TRIES = 3;

type TaskPatch = Database["public"]["Tables"]["tasks"]["Update"];
/** PostgREST's "unknown column" (PGRST204): the Oct 12 migration is not applied yet. */
const isMissingColumn = (e: { code?: string; message?: string }) =>
  e.code === "PGRST204" || /Could not find the '.*' column/i.test(e.message ?? "");

/**
 * The reminder pass for tasks: every open task with a notice due now (dueTaskNotices) gets it,
 * and the notice is stamped so it fires once. Runs from /api/cron/reminders right after the
 * follow-up reminders, and from the app's own pass. Returns counts for the route's JSON.
 *
 * Failures (owner, Oct 12, B3): a notice whose inbox send threw is NOT stamped — nobody inside
 * heard it — so the next pass sends it again; the failure is kept on tasks.notify_error (Admin ›
 * Reminders lists them) and counted on tasks.notify_failures, and on the third failing pass the
 * notice is stamped so it stops (TASK_NOTICE_MAX_TRIES). A pass that sends clean clears both.
 * An outside email (Resend) that failed is recorded the same way but the notice is stamped as
 * before: the inbox notice went, and sending it again would tell the same people twice.
 */
export async function dispatchTaskNotices(
  sb: Client,
  now: Date = new Date(),
): Promise<{
  tasks_checked: number;
  tasks_created: number;
  tasks_morning: number;
  tasks_overdue: number;
  tasks_silent: number;
  tasks_errors: number;
}> {
  const admin = await serverClient(sb);
  const today = localYmd(now, TASK_TZ);
  const { data, error } = await admin
    .from("tasks")
    .select("*")
    .eq("status", "open")
    .or(
      `notified_created_at.is.null,and(due_date.lte.${today},or(notified_morning_at.is.null,notified_overdue_at.is.null))`,
    )
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) throw new Error(error.message);
  const out = {
    tasks_checked: data?.length ?? 0,
    tasks_created: 0,
    tasks_morning: 0,
    tasks_overdue: 0,
    tasks_silent: 0,
    tasks_errors: 0,
  };
  for (const task of data ?? []) {
    const due = dueTaskNotices(task, now, TASK_TZ);
    if (!due.length) continue;
    const patch: Partial<Record<(typeof STAMP)[TaskNoticeKind], string>> & {
      notify_error?: string | null;
      notify_failures?: number;
    } = {};
    // Failing passes so far (0 before the Oct 12 migration, or on a task that never failed).
    const failures =
      Number((task as { notify_failures?: number | null }).notify_failures ?? 0) || 0;
    const lastTry = failures + 1 >= TASK_NOTICE_MAX_TRIES;
    const errors: string[] = [];
    for (const n of due) {
      if (n.silent) {
        patch[STAMP[n.kind]] = now.toISOString();
        out.tasks_silent++;
        continue;
      }
      const r = await sendTaskNotice(
        task,
        n.kind,
        noticeRecipients(task, n.kind, task.created_by),
        admin,
      );
      errors.push(...r.errors);
      // Nobody inside heard it: no stamp, so the next pass sends it again — until the last try.
      if (r.inboxFailed && !lastTry) continue;
      patch[STAMP[n.kind]] = now.toISOString();
      if (r.inboxFailed) continue; // stamped to stop, not sent: not counted as a notice
      if (n.kind === "created") out.tasks_created++;
      else if (n.kind === "morning") out.tasks_morning++;
      else out.tasks_overdue++;
    }
    if (errors.length) {
      out.tasks_errors += errors.length;
      patch.notify_error = errors.join("; ").slice(0, 1000);
      patch.notify_failures = failures + 1;
    } else if (failures || task.notify_error) {
      patch.notify_error = null;
      patch.notify_failures = 0;
    }
    let { error: upErr } = await admin
      .from("tasks")
      .update(patch as TaskPatch)
      .eq("id", task.id);
    if (upErr && patch.notify_failures !== undefined && isMissingColumn(upErr)) {
      // Before 20261012180000 is applied: the stamps and notify_error alone, as before.
      const { notify_failures: _skip, ...rest } = patch;
      ({ error: upErr } = await admin.from("tasks").update(rest).eq("id", task.id));
    }
    if (upErr) throw new Error(upErr.message);
  }
  return out;
}
