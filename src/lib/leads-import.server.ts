/**
 * The handler behind POST /api/cron/leads-import (src/routes/api.cron.leads-import.ts), kept
 * here so the tests can call it: cron authentication, the zod check of the browser job's
 * payload (src/lib/leads-browser.ts), then importBrowserBids (leads.server.ts).
 */
import { authenticateCron } from "@/lib/cron-auth";
import { browserImportSchema } from "@/lib/leads-browser";

/** A body this large is not a bid list (500 rows of bounded fields stay well under it). */
const MAX_BODY_BYTES = 4_000_000;

export async function importRequest(request: Request): Promise<Response> {
  const denied = await authenticateCron(request);
  if (denied) return denied;
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES)
    return Response.json({ ok: false, error: "body too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ ok: false, error: "body is not JSON" }, { status: 400 });
  }
  const parsed = browserImportSchema.safeParse(json);
  if (!parsed.success)
    return Response.json(
      {
        ok: false,
        error: "payload rejected",
        issues: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  try {
    const { hasServiceRole } = await import("@/lib/notify.server");
    if (!hasServiceRole())
      return Response.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on this server" },
        { status: 500 },
      );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { importBrowserBids } = await import("@/lib/leads.server");
    const r = await importBrowserBids(supabaseAdmin as never, parsed.data);
    return Response.json({ ok: true, ...r, at: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
