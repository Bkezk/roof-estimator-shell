import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// All bid operations require a signed-in user. The user-scoped Supabase client
// from the auth middleware runs under RLS, so the database is the final guard.
export const listBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bids")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const createBidSchema = z.object({
  name: z.string().min(1).max(200),
  status: z.enum(["draft", "sent", "won", "lost"]).optional(),
});

export const createBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => createBidSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: bid, error } = await context.supabase
      .from("bids")
      .insert({ name: data.name, status: data.status ?? "draft" })
      .select()
      .single();
    if (error) throw error;
    return bid;
  });
