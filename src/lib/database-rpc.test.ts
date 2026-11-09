import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { databaseRpc } from "./database-rpc";

describe("databaseRpc SQL contracts", () => {
  it("preserves the client's identity and explicit null arguments", async () => {
    const rpc = vi.fn(function (this: unknown, name: string, args: unknown) {
      expect(this).toBe(client);
      return Promise.resolve({ data: null, error: null, name, args });
    });
    const client = { rpc };
    await databaseRpc(client as unknown as SupabaseClient<Database>)("hold_followup", {
      p_followup: "followup-1", p_until: null, p_reason: null, p_via: "contact",
    });
    expect(rpc).toHaveBeenCalledWith("hold_followup", {
      p_followup: "followup-1", p_until: null, p_reason: null, p_via: "contact",
    });
  });

  it("returns all seven preference flags without dropping false or null inputs", async () => {
    const prefs = {
      notify_email: true, notify_push: false, notify_leads: false,
      notify_opportunities: true, notify_service: false, notify_bids: true, notify_storms: false,
    };
    const rpc = vi.fn(async () => ({ data: [prefs], error: null }));
    const args = {
      p_email: null, p_push: false, p_leads: null, p_opportunities: null,
      p_service: false, p_bids: null, p_storms: null,
    };
    const result = await databaseRpc({ rpc } as unknown as SupabaseClient<Database>)("set_my_notify_prefs", args);
    expect(rpc).toHaveBeenCalledWith("set_my_notify_prefs", args);
    expect(result.data?.[0]).toEqual(prefs);
  });
});