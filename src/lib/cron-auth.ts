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
 * A third caller, only where a route asks for it (`opts.timer`; the reminders endpoint, Nov 13):
 * the database's own reminder timer. It signs its calls with a token the database made and
 * keeps (see cron-timer.ts); the route's `timer` asks the database whether a token of that shape
 * is the one. A "no", or a check that could not run, changes nothing: the request goes on to the
 * two secrets above exactly as before.
 *
 * Comparison is constant-time on SHA-256 digests, like the generated check. Returns null when
 * the caller is allowed, else the response to send.
 *
 * Nov 24 (the public pages audit). A caller without the right secret gets one answer, a plain
 * 401 "Unauthorized", whether a secret is missing on this server, too short, or just not the
 * one sent. Which of those it was is written to the server log and never to the caller. A
 * CRON_SECRET shorter than MIN_CRON_SECRET_LENGTH characters is treated as not set. (The GitHub
 * jobs call with `curl -f`, which fails on any 4xx or 5xx, so they fail as before.)
 */
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

import { type TimerCheck, timerTokenOf } from "./cron-timer";

/** A CRON_SECRET shorter than this is treated as not set. */
export const MIN_CRON_SECRET_LENGTH = 16;

const refused = () => new Response("Unauthorized", { status: 401 });

export async function authenticateCron(
  request: Request,
  opts: { timer?: TimerCheck } = {},
): Promise<Response | null> {
  if (opts.timer) {
    const timerToken = timerTokenOf(request);
    if (timerToken) {
      try {
        if ((await opts.timer(timerToken)) === true) return null;
      } catch (e) {
        console.error(
          "Cron: the reminder timer's token could not be checked —",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }
  const typed = process.env["CRON_SECRET"]?.trim();
  // A secret under the shortest length is treated as not set at all.
  const own = typed && typed.length >= MIN_CRON_SECRET_LENGTH ? typed : undefined;
  if (typed && !own)
    console.error(
      `Cron: CRON_SECRET is shorter than ${MIN_CRON_SECRET_LENGTH} characters, so it is treated as not set. Set a longer one in Lovable Cloud › Secrets and in the GitHub repository's Actions secrets.`,
    );
  if (own) {
    const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
    const token = match?.[1];
    if (token) {
      const { createHash, timingSafeEqual } = await import("node:crypto");
      const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
      if (timingSafeEqual(digest(token), digest(own))) return null;
    }
  }
  // Not the owner's secret: Lovable's own may still match. Without a Lovable secret the
  // generated check would answer 500 ("Server configuration error"), which is a different
  // answer from a wrong secret's. So that case is the same plain 401 here, and when no usable
  // secret is set at all the reason goes to the server log.
  if (!process.env["LOVABLE_CRON_SECRET"]) {
    if (!own)
      console.error(
        "Cron: refused. No usable CRON_SECRET or LOVABLE_CRON_SECRET is set on this server (Lovable Cloud › Secrets), so no scheduled run can start.",
      );
    return refused();
  }
  return authenticateCronRequest(request);
}
