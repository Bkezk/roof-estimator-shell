import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

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
