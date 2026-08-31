import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type CompanySettings = Tables["company_settings"]["Row"];
export type ShippingStep = Tables["shipping_steps"]["Row"];
export type MarkupOption = Tables["markup_options"]["Row"];
export type Warranty = Tables["warranties"]["Row"];
export type HighWindUpcharge = Tables["high_wind_upcharges"]["Row"];

export interface GeneralSettings {
  company: CompanySettings | null;
  shippingSteps: ShippingStep[];
  markupOptions: MarkupOption[];
  warranties: Warranty[];
  highWind: HighWindUpcharge[];
}

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (!data || data.role !== "admin") {
    throw new Error("Forbidden: admin access required");
  }
}

// Whole General group in one round trip. Any signed-in user may read (estimators
// need these values to price a bid); RLS enforces that.
export const getGeneralSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GeneralSettings> => {
    const sb = context.supabase;
    const [company, steps, markup, warr, wind] = await Promise.all([
      sb.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("shipping_steps").select("*").order("sort"),
      sb.from("markup_options").select("*").order("sort"),
      sb.from("warranties").select("*").order("sort"),
      sb.from("high_wind_upcharges").select("*").order("sort"),
    ]);
    return {
      company: company.data ?? null,
      shippingSteps: steps.data ?? [],
      markupOptions: markup.data ?? [],
      warranties: warr.data ?? [],
      highWind: wind.data ?? [],
    };
  });

const companySchema = z.object({
  company_name: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  phone: z.string().nullable(),
  dl_account: z.string().nullable(),
  master_elite: z.boolean(),
  sales_tax_rate: z.number(),
  only_tax_material: z.boolean(),
  labor_display: z.enum(["man_hours", "man_days"]),
  hours_per_man_day: z.number(),
  shipping_method: z.enum(["stepped", "percent"]),
  shipping_percent: z.number(),
});

export const saveCompanySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => companySchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("company_settings").upsert({ id: 1, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const shippingSchema = z.object({
  steps: z.array(
    z.object({
      material_threshold: z.number(),
      shipping_cost: z.number(),
    }),
  ),
});

export const saveShippingSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => shippingSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const { error: delErr } = await sb
      .from("shipping_steps")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr) throw new Error(delErr.message);
    if (data.steps.length) {
      const rows = data.steps.map((s, i) => ({
        material_threshold: s.material_threshold,
        shipping_cost: s.shipping_cost,
        sort: i,
      }));
      const { error } = await sb.from("shipping_steps").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const markupSchema = z.object({
  options: z.array(
    z.object({
      name: z.string().min(1),
      hourly_rate: z.number(),
      markup_amount: z.number(),
      markup_type: z.enum(["dollar_manday", "percent_cost", "gross_profit"]),
      include_per_diem: z.boolean(),
      include_commission: z.boolean(),
      is_default: z.boolean(),
    }),
  ),
});

export const saveMarkupOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => markupSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    // Exactly one default.
    let sawDefault = false;
    const options = data.options.map((o) => {
      const is_default = o.is_default && !sawDefault;
      if (is_default) sawDefault = true;
      return { ...o, is_default };
    });
    if (!sawDefault && options.length) options[0]!.is_default = true;

    const { error: delErr } = await sb
      .from("markup_options")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr) throw new Error(delErr.message);
    if (options.length) {
      const { error } = await sb
        .from("markup_options")
        .insert(options.map((o, i) => ({ ...o, sort: i })));
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const warrantySchema = z.object({
  warranties: z.array(
    z.object({
      name: z.string().min(1),
      price_per_sqft: z.number(),
      non_master_elite_surcharge: z.number(),
    }),
  ),
});

export const saveWarranties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => warrantySchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const { error: delErr } = await sb
      .from("warranties")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr) throw new Error(delErr.message);
    if (data.warranties.length) {
      const { error } = await sb
        .from("warranties")
        .insert(data.warranties.map((w, i) => ({ ...w, sort: i })));
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const highWindSchema = z.object({
  rows: z.array(
    z.object({
      term_years: z.number(),
      wind_band: z.string().min(1),
      mech_per_sqft: z.number(),
      adhered_per_sqft: z.number(),
    }),
  ),
});

export const saveHighWind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => highWindSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const { error: delErr } = await sb
      .from("high_wind_upcharges")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr) throw new Error(delErr.message);
    if (data.rows.length) {
      const { error } = await sb
        .from("high_wind_upcharges")
        .insert(data.rows.map((r, i) => ({ ...r, sort: i })));
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
