import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";

export interface RdlData {
  base?: {
    tab_or_width_label?: string;
    tab_value?: number;
    tab_multiplier?: number;
    sheet_layout_hours?: number;
  } | null;
  deck_multipliers?: Record<string, number> | null;
  fastener_spacing_multipliers?: { spacing_in: number; multiplier: number }[] | null;
  complexity_factors?: { label: string; value: number }[] | null;
  sheet_size_multipliers?:
    { label: string; roof_section: number | null; underlayment: number | null }[] | null;
  thickness_multipliers?: { mil: number | string; multiplier: number }[] | null;
  sheet_size_label?: string;
  duro_bond_base_labor?: {
    sheet_layout_hr: number;
    single_fastener_time_min_per_fastener_by_deck: Record<string, number>;
    deck_column_order?: string[];
  } | null;
  adhesive?: {
    base_hours_per_1000_sqft_by_substrate: {
      substrate: string;
      labor_per_1000_sqft: number;
    }[];
  } | null;
  notes?: string;
  [k: string]: unknown;
}

export type RdlComboRow = Database["public"]["Tables"]["rdl_combos"]["Row"];

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (!data || data.role !== "admin") throw new Error("Forbidden: admin access required");
}

export const getRdlCombos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RdlComboRow[]> => {
    const { data, error } = await context.supabase.from("rdl_combos").select("*").order("sort");
    if (error) throw error;
    return data ?? [];
  });

const saveSchema = z.object({
  id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()),
});

export const saveRdlCombo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("rdl_combos")
      .update({ data: data.data as Json })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type RdlLaborTableRow = Database["public"]["Tables"]["rdl_labor_tables"]["Row"];

export const getLaborTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RdlLaborTableRow[]> => {
    const { data, error } = await context.supabase
      .from("rdl_labor_tables")
      .select("*")
      .order("sort");
    if (error) throw error;
    return data ?? [];
  });

const saveTableSchema = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const saveLaborTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveTableSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("rdl_labor_tables")
      .update({ data: data.data as Json })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type AccessoryLaborRow = Database["public"]["Tables"]["accessory_labor"]["Row"];

export const getAccessoryLabor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessoryLaborRow[]> => {
    const { data, error } = await context.supabase
      .from("accessory_labor")
      .select("*")
      .order("sort");
    if (error) throw error;
    return data ?? [];
  });

const saveAccessorySchema = z.object({
  id: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const saveAccessoryCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => saveAccessorySchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("accessory_labor")
      .update({ data: data.data as Json })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
