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
  buildAccessoryCatalog,
  buildAccessoryLaborLookup,
  buildNonDlCatalog,
  type AccessoryCatalogItem,
  type NonDlCatalogItem,
  type EngineAdminData,
  type LaborCombo,
  type MembraneScreen,
  type RawCompanySettings,
  type TearOffTimesData,
  type RawShippingStep,
  type RawSetup,
  type RawSetupStep,
  type RawInspectionStep,
  type RawParapetRow,
  type RawCurbDeckRow,
  type RawCurbTypeRow,
  buildMetalsCatalog,
  type MetalsCatalogItem,
  type MetalsScreenData,
  type RawUnderlaymentLayoutData,
  type RawAdhesiveTimesData,
  type AdhesivesScreenData,
} from "@/lib/engine/adapters";

export type {
  EngineAdminData,
  AccessoryCatalogItem,
  NonDlCatalogItem,
  MetalsCatalogItem,
} from "@/lib/engine/adapters";

const MEMBRANE_SCREEN_ID = "duro_last:duro_last_membrane";
const UNDERLAYMENT_SCREEN_ID = "duro_last:underlayment";

export const getEngineAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EngineAdminData> => {
    const sb = context.supabase;

    const [
      membraneRes,
      combosRes,
      settingsRes,
      tearOffRes,
      underlaymentRes,
      shippingRes,
      setupRes,
      setupStepsRes,
      inspectionStepsRes,
      parapetRes,
      curbRes,
      curbDeckRes,
      curbTypeRes,
      uLayoutRes,
      adhTimesRes,
      adhScreenRes,
    ] = await Promise.all([
      sb.from("pricing_catalog").select("data").eq("id", MEMBRANE_SCREEN_ID).maybeSingle(),
      sb.from("rdl_combos").select("roof_system, attachment, data").order("sort"),
      sb.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("rdl_labor_tables").select("data").eq("id", "tearoff_times").maybeSingle(),
      sb.from("pricing_catalog").select("data").eq("id", UNDERLAYMENT_SCREEN_ID).maybeSingle(),
      sb.from("shipping_steps").select("material_threshold, shipping_cost").order("sort"),
      sb.from("labor_setup").select("minimum_hours").eq("id", 1).maybeSingle(),
      sb.from("labor_setup_steps").select("sqft, multiplier").order("sort"),
      sb.from("labor_inspection_steps").select("sqft, hours").order("sort"),
      sb
        .from("labor_parapet")
        .select(
          "deck_type, wall_height_band, no_drill_no_cant, no_drill_canted, predrill_no_cant, predrill_canted, sort",
        )
        .order("sort"),
      sb.from("labor_curb").select("setup_minutes").eq("id", 1).maybeSingle(),
      sb.from("labor_curb_deck").select("deck_type, minutes").order("sort"),
      sb.from("labor_curb_type").select("curb_type, multiplier").order("sort"),
      sb
        .from("rdl_labor_tables")
        .select("data")
        .eq("id", "underlayment_layout_mechanical")
        .maybeSingle(),
      sb
        .from("rdl_labor_tables")
        .select("data")
        .eq("id", "underlayment_adhesive_times")
        .maybeSingle(),
      sb.from("pricing_catalog").select("data").eq("id", "duro_last:adhesives").maybeSingle(),
    ]);

    if (membraneRes.error) throw membraneRes.error;
    if (combosRes.error) throw combosRes.error;
    if (settingsRes.error) throw settingsRes.error;
    if (tearOffRes.error) throw tearOffRes.error;
    if (underlaymentRes.error) throw underlaymentRes.error;
    if (shippingRes.error) throw shippingRes.error;
    if (setupRes.error) throw setupRes.error;
    if (setupStepsRes.error) throw setupStepsRes.error;
    if (inspectionStepsRes.error) throw inspectionStepsRes.error;
    if (parapetRes.error) throw parapetRes.error;
    if (curbRes.error) throw curbRes.error;
    if (curbDeckRes.error) throw curbDeckRes.error;
    if (curbTypeRes.error) throw curbTypeRes.error;
    if (uLayoutRes.error) throw uLayoutRes.error;
    if (adhTimesRes.error) throw adhTimesRes.error;
    if (adhScreenRes.error) throw adhScreenRes.error;

    const membraneScreen = (membraneRes.data?.data ?? null) as MembraneScreen | null;
    const combos = (combosRes.data ?? []).map((c) => ({
      roof_system: c.roof_system,
      attachment: c.attachment,
      data: c.data as unknown as LaborCombo,
    }));
    const settings = (settingsRes.data ?? null) as RawCompanySettings | null;
    const tearOffTimes = (tearOffRes.data?.data ?? null) as TearOffTimesData | null;
    const underlaymentScreen = (underlaymentRes.data?.data ?? null) as MembraneScreen | null;
    const shippingSteps = (shippingRes.data ?? null) as RawShippingStep[] | null;
    const setup = (setupRes.data ?? null) as RawSetup | null;
    const setupSteps = (setupStepsRes.data ?? null) as RawSetupStep[] | null;
    const inspectionSteps = (inspectionStepsRes.data ?? null) as RawInspectionStep[] | null;
    const parapetRows = (parapetRes.data ?? null) as RawParapetRow[] | null;
    const curbSetupMinutes = curbRes.data?.setup_minutes ?? null;
    const curbDeckRows = (curbDeckRes.data ?? null) as RawCurbDeckRow[] | null;
    const curbTypeRows = (curbTypeRes.data ?? null) as RawCurbTypeRow[] | null;
    const underlaymentLayout = (uLayoutRes.data?.data ?? null) as RawUnderlaymentLayoutData | null;
    const adhesiveTimes = (adhTimesRes.data?.data ?? null) as RawAdhesiveTimesData | null;
    const adhesivesScreen = (adhScreenRes.data?.data ?? null) as AdhesivesScreenData | null;

    return assembleEngineAdminData({
      membraneScreen,
      combos,
      settings,
      tearOffTimes,
      underlaymentScreen,
      shippingSteps,
      setup,
      setupSteps,
      inspectionSteps,
      parapetRows,
      curbSetupMinutes,
      curbDeckRows,
      curbTypeRows,
      underlaymentLayout,
      adhesiveTimes,
      adhesivesScreen,
    });
  });

/** Pickable accessory catalog (flattened single-Price Duro-Last screens). Authenticated read. */
export const getAccessoryCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessoryCatalogItem[]> => {
    const { data, error } = await context.supabase
      .from("pricing_catalog")
      .select("id, category, data")
      .eq("branch", "duro_last")
      .order("sort");
    if (error) throw error;
    const rows = (data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      data: r.data as unknown as MembraneScreen,
    }));
    return buildAccessoryCatalog(rows);
  });

/**
 * Best-effort accessory install-labor prefill (description → hours/unit) from the accessory_labor
 * screens. Partial by design (single-"Labor(Hrs)" screens only); the estimator can edit any value.
 * Authenticated read.
 */
export const getAccessoryLaborLookup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, number>> => {
    const { data, error } = await context.supabase
      .from("accessory_labor")
      .select("id, category, data")
      .order("sort");
    if (error) throw error;
    const rows = (data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      data: r.data as unknown as MembraneScreen,
    }));
    return buildAccessoryLaborLookup(rows);
  });

/** Pickable non-Duro-Last catalog (blocking, sheet metal, subs, services, …). Authenticated read. */
export const getNonDlCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NonDlCatalogItem[]> => {
    const { data, error } = await context.supabase
      .from("pricing_catalog")
      .select("id, category, data")
      .eq("branch", "non_dl")
      .order("sort");
    if (error) throw error;
    const rows = (data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      data: r.data as unknown as MembraneScreen,
    }));
    return buildNonDlCatalog(rows);
  });

/** Pickable Exceptional Metals catalog (gutters, downspouts, pitch pans, boxes, two-piece). */
export const getMetalsCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MetalsCatalogItem[]> => {
    const { data, error } = await context.supabase
      .from("pricing_catalog")
      .select("data")
      .eq("id", "duro_last:exceptional_metals")
      .maybeSingle();
    if (error) throw error;
    return buildMetalsCatalog((data?.data ?? null) as MetalsScreenData | null);
  });
