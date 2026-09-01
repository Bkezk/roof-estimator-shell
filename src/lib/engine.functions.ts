/**
 * Engine data server functions — the thin I/O layer between Supabase and the pure engine.
 * Fetches the seeded admin rows (membrane price matrix, Roof Deck Labor combos, company settings)
 * and runs the pure `assembleEngineAdminData` adapter. All transform logic lives in (and is tested
 * in) src/lib/engine/adapters.ts; this file only does the fetch.
 *
 * Authenticated read (any signed-in user) — an estimator needs the admin data to compute a bid.
 */

import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assembleEngineAdminData,
  type EngineAdminData,
  type LaborCombo,
  type MembraneScreen,
  type RawCompanySettings,
  type TearOffTimesData,
} from "@/lib/engine/adapters";

export type { EngineAdminData } from "@/lib/engine/adapters";

const MEMBRANE_SCREEN_ID = "duro_last:duro_last_membrane";

export const getEngineAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EngineAdminData> => {
    const sb = context.supabase;

    const [membraneRes, combosRes, settingsRes, tearOffRes] = await Promise.all([
      sb.from("pricing_catalog").select("data").eq("id", MEMBRANE_SCREEN_ID).maybeSingle(),
      sb.from("rdl_combos").select("roof_system, attachment, data").order("sort"),
      sb.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("rdl_labor_tables").select("data").eq("id", "tearoff_times").maybeSingle(),
    ]);

    if (membraneRes.error) throw membraneRes.error;
    if (combosRes.error) throw combosRes.error;
    if (settingsRes.error) throw settingsRes.error;
    if (tearOffRes.error) throw tearOffRes.error;

    const membraneScreen = (membraneRes.data?.data ?? null) as MembraneScreen | null;
    const combos = (combosRes.data ?? []).map((c) => ({
      roof_system: c.roof_system,
      attachment: c.attachment,
      data: c.data as unknown as LaborCombo,
    }));
    const settings = (settingsRes.data ?? null) as RawCompanySettings | null;
    const tearOffTimes = (tearOffRes.data?.data ?? null) as TearOffTimesData | null;

    return assembleEngineAdminData({ membraneScreen, combos, settings, tearOffTimes });
  });
