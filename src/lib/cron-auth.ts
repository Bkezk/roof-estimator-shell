/**
 * Who may call the app's scheduled endpoints (/api/cron/*). Two secrets are accepted, sent as
 * `Authorization: Bearer <secret>`:
 *
 *   - CRON_SECRET, a value the owner makes up and sets in BOTH Lovable Cloud › Secrets and the
 *     GitHub repository's Actions secrets (owner, Sep 29: Lovable manages LOVABLE_CRON_SECRET
 *     itself and does not show its value, so the GitHub jobs could never be given it);
 *   - LOVABLE_CRON_SECRET (and its previous value), checked by Lovable's generated
 *     authenticateCronRequest, kept for Lovable's own scheduling.
 *
 * Comparison is constant-time on SHA-256 digests, like the generated check. Returns null when
 * the caller is allowed, else the response to send (401, or 500 when nothing is configured).
 */
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export async function authenticateCron(request: Request): Promise<Response | null> {
  const own = process.env["CRON_SECRET"]?.trim();
  if (own) {
    const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
    const token = match?.[1];
    if (token) {
      const { createHash, timingSafeEqual } = await import("node:crypto");
      const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
      if (timingSafeEqual(digest(token), digest(own))) return null;
    }
    // Not the owner's secret: Lovable's own may still match. Without a Lovable secret the
    // generated check answers 500 ("Server configuration error"); the owner's secret being
    // set means the server IS configured, so that case is a plain 401 here.
    if (!process.env["LOVABLE_CRON_SECRET"]) return new Response("Unauthorized", { status: 401 });
  }
  return authenticateCronRequest(request);
}
