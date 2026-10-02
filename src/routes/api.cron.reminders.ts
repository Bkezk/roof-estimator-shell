/**
 * POST /api/cron/reminders — fires the due follow-up reminders (notify.server.ts) and the task
 * notices (tasks-notify.server.ts). Called on a
 * schedule with `Authorization: Bearer <LOVABLE_CRON_SECRET>` (Lovable Cloud's cron, or the
 * GitHub Actions workflow .github/workflows/reminders.yml). The app also runs the same pass,
 * throttled, whenever an office user loads it, so reminders go out even with no cron set up.
 *
 * The two passes are independent: the task notices run whatever happened to the follow-ups.
 * The answer reports both ({ followups: {...} | { error }, tasks: {...} | { error } }). `ok` is
 * false when anything failed (a whole pass, or single sends, which are logged and recorded on
 * their rows); the status is 500 only when a whole pass could not run.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authenticateCron } from "@/lib/cron-auth";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function run(request: Request): Promise<Response> {
  const denied = await authenticateCron(request);
  if (denied) return denied;
  let notifyMod: typeof import("@/lib/notify.server");
  let supabaseAdmin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
  try {
    notifyMod = await import("@/lib/notify.server");
    if (!notifyMod.hasServiceRole())
      return Response.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on this server" },
        { status: 500 },
      );
    ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
  } catch (e) {
    return Response.json({ ok: false, error: errText(e) }, { status: 500 });
  }
  const { dispatchDueReminders } = notifyMod;
  let passFailed = false;
  let sendsFailed = 0;

  let followups: Awaited<ReturnType<typeof dispatchDueReminders>> | { error: string };
  try {
    followups = await dispatchDueReminders(supabaseAdmin);
    sendsFailed += followups.failed;
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the follow-up pass failed", e);
    followups = { error: errText(e) };
  }

  // Task notices (tasks-notify.server.ts): New task / due today / still open the day after.
  let tasks: Record<string, number> | { error: string };
  try {
    const { dispatchTaskNotices } = await import("@/lib/tasks-notify.server");
    const t = await dispatchTaskNotices(supabaseAdmin);
    sendsFailed += t.tasks_errors;
    tasks = t;
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the task notice pass failed", e);
    tasks = { error: errText(e) };
  }

  return Response.json(
    { ok: !passFailed && sendsFailed === 0, followups, tasks, at: new Date().toISOString() },
    { status: passFailed ? 500 : 200 },
  );
}

export const Route = createFileRoute("/api/cron/reminders")({
  server: {
    handlers: {
      POST: ({ request }) => run(request),
      GET: ({ request }) => run(request),
    },
  },
});
