import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";

export type PricingRow = Database["public"]["Tables"]["pricing_catalog"]["Row"];

export interface CatalogScreenData {
  columns: string[];
  // Rows may carry a reserved `_locked: true` marker on pre-loaded (seeded) items — its name
  // can't be edited and it can't be deleted, but its prices stay editable. User-added rows omit it.
  rows: Record<string, string | number | boolean>[];
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
    // Exclude master-detail screens (they carry a "kind" discriminator and have
    // their own editors); the flat CatalogEditor only handles columns/rows screens.
    return (rows ?? []).filter((r) => {
      const d = r.data as { kind?: string } | null;
      return !(d && typeof d === "object" && d.kind);
    });
  });

const idSchema = z.object({ id: z.string() });

export const getPricingScreen = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d) => idSchema.parse(d))
  .handler(async ({ data, context }): Promise<PricingRow | null> => {
    const { data: row, error } = await context.supabase
      .from("pricing_catalog")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    return row ?? null;
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
