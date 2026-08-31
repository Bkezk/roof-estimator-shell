import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";

function getSupabase() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const listBids = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = getSupabase();
  const { data, error } = await supabase
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
  .inputValidator((data) => createBidSchema.parse(data))
  .handler(async ({ data }) => {
    const supabase = getSupabase();
    const { data: bid, error } = await supabase
      .from("bids")
      .insert({
        name: data.name,
        status: data.status ?? "draft",
      })
      .select()
      .single();

    if (error) throw error;
    return bid;
  });
