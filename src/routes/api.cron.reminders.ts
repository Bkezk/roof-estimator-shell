/**
 * POST /api/cron/reminders — fires the due follow-up reminders (notify.server.ts) and the task
 * notices (tasks-notify.server.ts). Called on a
 * schedule with `Authorization: Bearer <LOVABLE_CRON_SECRET>` (Lovable Cloud's cron, or the
 * GitHub Actions workflow .github/workflows/reminders.yml). The app also runs the same pass,
 * throttled, whenever an office user loads it, so reminders go out even with no cron set up.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authenticateCron } from "@/lib/cron-auth";

async function run(request: Request): Promise<Response> {
  const denied = await authenticateCron(request);
  if (denied) return denied;
  try {
    const { dispatchDueReminders, hasServiceRole } = await import("@/lib/notify.server");
    if (!hasServiceRole())
      return Response.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on this server" },
        { status: 500 },
      );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const r = await dispatchDueReminders(supabaseAdmin);
    // Task notices (tasks-notify.server.ts): New task / due today / still open the day after.
    const { dispatchTaskNotices } = await import("@/lib/tasks-notify.server");
    const t = await dispatchTaskNotices(supabaseAdmin);
    return Response.json({ ok: true, ...r, ...t, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/cron/reminders")({
  server: {
    handlers: {
      POST: ({ request }) => run(request),
      GET: ({ request }) => run(request),
    },
  },
});
