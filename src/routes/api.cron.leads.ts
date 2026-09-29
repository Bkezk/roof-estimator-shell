/**
 * POST /api/cron/leads — pulls the State of KY planroom and Louisville's commercial permits
 * into the leads table (leads.server.ts). Called nightly with `Authorization: Bearer
 * <LOVABLE_CRON_SECRET>` by .github/workflows/leads.yml. The app also runs the same pass,
 * throttled to every six hours, whenever a Prospecting user opens the Leads page.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

async function run(request: Request): Promise<Response> {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;
  try {
    const { hasServiceRole } = await import("@/lib/notify.server");
    if (!hasServiceRole())
      return Response.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on this server" },
        { status: 500 },
      );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshLeads } = await import("@/lib/leads.server");
    const r = await refreshLeads(supabaseAdmin as never, { readPages: 40 });
    return Response.json({ ok: true, ...r, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/cron/leads")({
  server: {
    handlers: {
      POST: ({ request }) => run(request),
      GET: ({ request }) => run(request),
    },
  },
});
