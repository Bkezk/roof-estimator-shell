/**
 * The public pages' server side: SERVER ONLY (never imported by a page).
 *
 * The public pages (/care, /request) have no sign-in. Their server functions
 * (public-forms.functions.ts) reach the database with the site's own key, as the two share
 * links do, so nothing is ever given to the anonymous role. This file holds what those
 * functions share: the key a connection is counted under, the database calls, and the notice
 * that tells the office a request came in.
 */
import { createHmac } from "node:crypto";

import { notify, hasServiceRole, type Client } from "@/lib/notify.server";
import { publicRequestNotice, type PublicRequestRow } from "@/lib/public-requests";

/**
 * The key one connection's requests are counted under: a keyed hash of where the request came
 * from. The address itself is never kept, and without the server's own key the hash cannot be
 * turned back into one.
 */
export function connectionKey(
  headers: { get(name: string): string | null },
  secret: string | undefined = process.env["SUPABASE_SERVICE_ROLE_KEY"],
): string {
  const from =
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown";
  return createHmac("sha256", secret || "no-server-key")
    .update(`public-forms|${from}`)
    .digest("hex")
    .slice(0, 40);
}

/** The site's own database client, or null where the server has no key (the local test server). */
export async function publicAdmin(): Promise<Client | null> {
  if (!hasServiceRole()) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}

/** True only on the local test server: no server key and not a production build. */
export const publicSampleMode = (): boolean =>
  !hasServiceRole() && process.env["NODE_ENV"] !== "production";

export interface PublicNoticeResult {
  requests_checked: number;
  requests_notified: number;
  requests_skipped: number;
  requests_errors: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Tell the admins and managers about each request nobody has been told of yet, once. A request
 * is claimed first (its told_at stamped where it is still empty), so two runs cannot tell
 * twice; a send that fails puts it back for the next run (the 8:00 run also calls this).
 */
export async function dispatchPublicRequestNotices(
  admin: Client,
  now: Date = new Date(),
): Promise<PublicNoticeResult> {
  const out: PublicNoticeResult = {
    requests_checked: 0,
    requests_notified: 0,
    requests_skipped: 0,
    requests_errors: 0,
  };
  const { data: rows, error } = await admin
    .from("public_requests")
    .select(
      "id, reference, kind, created_at, status, contact_name, company, city, state, plan, services, shown_price, several_buildings, opportunity_id",
    )
    .eq("status", "new")
    .is("told_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  out.requests_checked = rows?.length ?? 0;
  if (!rows?.length) return out;
  const { data: people, error: pErr } = await admin
    .from("profiles")
    .select("id, role")
    .in("role", ["admin", "manager"]);
  if (pErr) throw new Error(pErr.message);
  const to = (people ?? []).map((p) => p.id);
  const stamp = now.toISOString();
  for (const r of rows) {
    const { data: won, error: cErr } = await admin
      .from("public_requests")
      .update({ told_at: stamp })
      .eq("id", r.id)
      .is("told_at", null)
      .select("id");
    if (cErr) {
      out.requests_errors++;
      console.error(`Public request notice: ${r.reference} could not be claimed —`, cErr.message);
      continue;
    }
    if (!won?.length) {
      out.requests_skipped++;
      continue;
    }
    try {
      if (to.length) await notify(to, publicRequestNotice(r as PublicRequestRow), admin);
      out.requests_notified++;
    } catch (e) {
      out.requests_errors++;
      console.error(`Public request notice: ${r.reference} —`, errText(e));
      await admin
        .from("public_requests")
        .update({ told_at: null })
        .eq("id", r.id)
        .eq("told_at", stamp);
    }
  }
  return out;
}
