/**
 * Reading the service material list (src/lib/service-materials.ts has the rules). The names and
 * stock links come from the price-free view, so a technician's truck list can name its rows;
 * the costs from the table, which only the office reads (RLS service_materials_read). Before
 * 20261006130000_service_materials.sql is applied both read as empty, so nothing breaks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { ServiceMaterial, ServiceMaterialLink } from "@/lib/service-materials";
import { isMissingTable } from "@/lib/warranty";

type Client = SupabaseClient<Database>;

export async function loadServiceMaterialLinks(
  sb: Client,
): Promise<(ServiceMaterialLink & { id: string; sort: number })[]> {
  const { data, error } = await sb
    .from("service_materials_catalog")
    .select(
      "id, name, unit, sort, active, stock_screen_id, stock_row_label, stock_price_col, category, stock_per_unit, piece_name",
    )
    .order("sort");
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? [])
    .filter((m): m is typeof m & { id: string; name: string; unit: string } =>
      Boolean(m.id && m.name && m.unit),
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      sort: m.sort ?? 0,
      active: m.active ?? true,
      stock_screen_id: m.stock_screen_id,
      stock_row_label: m.stock_row_label,
      stock_price_col: m.stock_price_col,
      category: m.category,
      stock_per_unit: m.stock_per_unit == null ? null : Number(m.stock_per_unit),
      piece_name: m.piece_name,
    }));
}

export async function loadServiceMaterials(sb: Client): Promise<ServiceMaterial[]> {
  const { data, error } = await sb
    .from("service_materials")
    .select("*")
    .order("sort")
    .order("name");
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((m) => ({
    ...m,
    cost: Number(m.cost),
    stock_per_unit: m.stock_per_unit == null ? null : Number(m.stock_per_unit),
  }));
}
