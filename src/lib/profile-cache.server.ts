/**
 * The caller's profile, read once a minute per user instead of once per server call (Nov 3,
 * review item 36): every field and ticket server function started with `select … from profiles
 * where id = me`, so opening a ticket read the same row fifteen times. The cache lives in the
 * worker's memory (one per isolate, so it is only ever a little stale — at most TTL_MS after an
 * admin changes someone's access, and row security still decides what the data layer returns
 * whatever the cache says). Pure enough to test: the clock and the reader are injected.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export const PROFILE_COLUMNS = "role, access, technician, full_name, email" as const;
export type CachedProfile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "role" | "access" | "technician" | "full_name" | "email"
>;

/** How long a read profile serves later calls. */
export const PROFILE_TTL_MS = 60_000;

interface Entry {
  at: number;
  profile: CachedProfile | null;
}

export function createProfileCache(opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttl = opts.ttlMs ?? PROFILE_TTL_MS;
  const now = opts.now ?? Date.now;
  const map = new Map<string, Entry>();
  return {
    async read(
      load: (userId: string) => Promise<CachedProfile | null>,
      userId: string,
    ): Promise<CachedProfile | null> {
      const hit = map.get(userId);
      if (hit && now() - hit.at < ttl) return hit.profile;
      const profile = await load(userId);
      map.set(userId, { at: now(), profile });
      return profile;
    },
    /** After a change to someone's access or name (auth.functions): their next call re-reads. */
    forget(userId: string) {
      map.delete(userId);
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

const cache = createProfileCache();

/**
 * Under vitest every test fakes its own profiles table for the same user id, so the cache is
 * off there (each test reads what it set up); the cache itself is tested above with its own
 * clock. Everywhere else (the worker) it is on.
 */
const CACHE_ON = typeof process === "undefined" || !process.env["VITEST"];

const load = (sb: SupabaseClient<Database>) => async (id: string) => {
  const { data } = await sb.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
  return data ?? null;
};

/** The caller's profile through the cache. */
export function readProfile(
  sb: SupabaseClient<Database>,
  userId: string,
): Promise<CachedProfile | null> {
  return CACHE_ON ? cache.read(load(sb), userId) : load(sb)(userId);
}

export const forgetProfile = (userId: string) => cache.forget(userId);
