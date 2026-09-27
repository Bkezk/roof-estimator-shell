/**
 * POST /api/cron/reminders — fires the due follow-up reminders (notify.server.ts). Called on a
 * schedule with `Authorization: Bearer <LOVABLE_CRON_SECRET>` (Lovable Cloud's cron, or the
 * GitHub Actions workflow .github/workflows/reminders.yml). The app also runs the same pass,
 * throttled, whenever an office user loads it, so reminders go out even with no cron set up.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

async function run(request: Request): Promise<Response> {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;
  try {
    const { dispatchDueReminders } = await import("@/lib/notify.server");
    const r = await dispatchDueReminders();
    return Response.json({ ok: true, ...r, at: new Date().toISOString() });
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
