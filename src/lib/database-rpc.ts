import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { CareTicketToAnnounce } from "@/lib/roof-care-ticket-announce";

// Generated RPC metadata omits SQL nullability and selects the oldest overload.
// Keep the application contracts aligned with the checked-in SQL migrations.
type Functions = Database["public"]["Functions"];
type NullableArgs<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: T[P] | null;
};
type NotifyFlags = {
  notify_email: boolean;
  notify_push: boolean;
  notify_leads: boolean;
  notify_opportunities: boolean;
  notify_service: boolean;
  notify_bids: boolean;
  notify_storms: boolean;
};
type RpcContracts = {
  save_contact_with_sites: {
    Args: { p_contact: Json; p_site_ids?: string[] | null };
    Returns: Json;
  };
  hold_followup: {
    Args: NullableArgs<Functions["hold_followup"]["Args"], "p_until" | "p_reason">;
    Returns: Json;
  };
  followup_sync_upsert: {
    Args: NullableArgs<Functions["followup_sync_upsert"]["Args"], "p_account_id" | "p_due_date">;
    Returns: Json;
  };
  set_ticket_stage_from_invoice: {
    Args: NullableArgs<Functions["set_ticket_stage_from_invoice"]["Args"], "p_invoice">;
    Returns: undefined;
  };
  set_my_notify_prefs: {
    Args: {
      p_email: boolean | null;
      p_push: boolean | null;
      p_leads: boolean | null;
      p_opportunities: boolean | null;
      p_service: boolean | null;
      p_bids: boolean | null;
      p_storms: boolean | null;
    };
    Returns: NotifyFlags[];
  };
  // 20261120700000_roof_care_ticket_notices.sql: a ticket with nobody on it, no date, or whose
  // plan inspection could not be read comes back with those columns null.
  roof_care_ticket_announce_claim: {
    Args: { p_ids?: string[] | null };
    Returns: CareTicketToAnnounce[];
  };
  // 20261124700000_notice_fine_choices.sql (owner, Nov 24: which notices, one by one;
  // notice-types.ts). The recipients read hands back each person's off list next to their
  // switches: absent until that migration is applied, and then nothing is off.
  notify_recipients: {
    Args: Functions["notify_recipients"]["Args"];
    Returns: (Functions["notify_recipients"]["Returns"][number] & {
      notify_off?: string[] | null;
    })[];
  };
  // The save of a person's own off list: the list goes in whole and comes back as kept.
  set_my_notify_off: {
    Args: { p_off: string[] };
    Returns: string[];
  };
};
type RpcDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Omit<Functions, keyof RpcContracts> & RpcContracts;
  };
};

/** Same client and credentials; only SQL RPC metadata is corrected. */
export function databaseRpc(client: SupabaseClient<Database>) {
  return (client as unknown as SupabaseClient<RpcDatabase>).rpc.bind(client);
}

/**
 * `buildings_search` (20261110211000_building_search_and_fk_indexes.sql): the read-only twin of
 * `buildings` that the Roofs & Storms text search reads, so the trigram index can be used (under
 * row security an `ilike` cannot be an index condition on the table itself). Same columns and
 * the same access rule, so it is typed as the table; the generated types do not list it.
 */
export function buildingsSearchTable(client: SupabaseClient<Database>) {
  return client.from("buildings_search" as "buildings");
}

type Tables = Database["public"]["Tables"];
type Profiles = Tables["profiles"];
type NoticeChoicesDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Tables, "profiles"> & {
      profiles: Omit<Profiles, "Row"> & { Row: Profiles["Row"] & { notify_off: string[] } };
    };
  };
};

/**
 * `profiles.notify_off` (20261124700000_notice_fine_choices.sql): the notice types a person
 * turned off, which the generated types do not list yet. The same table, client and row rules;
 * only the one column is added to what a select may name. Until the migration is applied a
 * select that names it comes back as an error, which every caller reads as "nothing is off".
 */
export function profilesWithNotifyOff(client: SupabaseClient<Database>) {
  return (client as unknown as SupabaseClient<NoticeChoicesDatabase>).from("profiles");
}
