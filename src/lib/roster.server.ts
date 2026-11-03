/**
 * The technician roster (the technician_options rpc), read once per request (owner, Nov 3,
 * service review item 44): a ticket save used to call it up to three times — for the saved
 * row's technician name, for the office users a stage notice goes to, and for the new
 * technician's name in a reassignment notice. Keyed by the client object: every server
 * request has its own, so nothing leaks between requests or users.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export interface RosterUser {
  id: string;
  full_name: string | null;
  email: string;
  technician: boolean;
}

const perClient = new WeakMap<object, Promise<RosterUser[]>>();

/** The roster through the per-request memo; a failed read is logged and answers []. */
export function technicianRoster(sb: SupabaseClient<Database>): Promise<RosterUser[]> {
  const hit = perClient.get(sb);
  if (hit) return hit;
  const p = (async () => {
    const { data, error } = await sb.rpc("technician_options");
    if (error) {
      console.error(`technician_options failed — ${error.message}`);
      return [];
    }
    return (data ?? []).map((u) => ({
      id: u.id,
      full_name: u.full_name ?? null,
      email: u.email,
      technician: !!u.technician,
    }));
  })();
  perClient.set(sb, p);
  return p;
}

/** A roster user's display name: the name, else the email. */
export const rosterDisplayName = (u: Pick<RosterUser, "full_name" | "email">) =>
  (u.full_name ?? "").trim() || u.email;
