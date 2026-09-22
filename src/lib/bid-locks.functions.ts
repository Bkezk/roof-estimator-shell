import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";

/** A lock is live while its holder has heart-beaten inside this window. */
export const BID_LOCK_TTL_SECONDS = 45;

export interface BidLockState {
  /** True when THIS session holds the lock (fresh or renewed). */
  acquired: boolean;
  holderName: string;
  holderUser: string;
  holderSession: string;
  heartbeatAt: string;
}

const acquireSchema = z.object({
  bidId: z.string().uuid(),
  sessionKey: z.string().min(8).max(80),
  holderName: z.string().min(1).max(120),
});

/**
 * Take (or renew) the edit lock on a bid for this browser tab. Returns `acquired: false` with
 * the current holder when another tab has it — the caller shows read-only mode and retries.
 */
export const acquireBidLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => acquireSchema.parse(d))
  .handler(async ({ data, context }): Promise<BidLockState> => {
    const { data: rows, error } = await context.supabase.rpc("acquire_bid_lock", {
      p_bid: data.bidId,
      p_session: data.sessionKey,
      p_name: data.holderName,
      p_ttl_seconds: BID_LOCK_TTL_SECONDS,
    });
    if (error) throw new Error(error.message);
    const r = rows?.[0];
    if (!r) throw new Error("Lock call returned nothing");
    return {
      acquired: r.acquired,
      holderName: r.holder_name,
      holderUser: r.holder_user,
      holderSession: r.holder_session,
      heartbeatAt: r.heartbeat_at,
    };
  });

const releaseSchema = z.object({ bidId: z.string().uuid(), sessionKey: z.string().min(8) });

/** Drop this tab's lock (no-op when another tab holds it). */
export const releaseBidLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => releaseSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("release_bid_lock", {
      p_bid: data.bidId,
      p_session: data.sessionKey,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * The live lock on a bid held by a session OTHER than `sessionKey`, or null. Used by saveBid so
 * a stale tab (or a client that never took the lock) cannot write over the editor's work.
 */
export async function liveLockHeldElsewhere(
  supabase: SupabaseClient<Database>,
  bidId: string,
  sessionKey: string | undefined,
): Promise<{ holderName: string } | null> {
  const { data, error } = await supabase
    .from("bid_locks")
    .select("session_key, holder_name, heartbeat_at")
    .eq("bid_id", bidId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const ageMs = Date.now() - new Date(data.heartbeat_at).getTime();
  if (ageMs > BID_LOCK_TTL_SECONDS * 1000) return null;
  if (sessionKey && data.session_key === sessionKey) return null;
  return { holderName: data.holder_name };
}
