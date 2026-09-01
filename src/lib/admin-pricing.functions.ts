import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";

export type PricingRow = Database["public"]["Tables"]["pricing_catalog"]["Row"];

export interface CatalogScreenData {
  columns: string[];
  rows: Record<string, string | number>[];
  help?: string;
  extras?: Record<string, string | number> | null;
}

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (!data || data.role !== "admin") throw new Error("Forbidden: admin access required");
}

const branchSchema = z.object({ branch: z.string() });

export const getPricingCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => branchSchema.parse(d))
  .handler(async ({ data, context }): Promise<PricingRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("pricing_catalog")
      .select("*")
      .eq("branch", data.branch)
      .order("sort");
    if (error) throw error;
    return rows ?? [];
  });

const saveSchema = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const savePricingScreen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("pricing_catalog")
      .update({ data: data.data as Json })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
