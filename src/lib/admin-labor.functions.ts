import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type SetupStep = Tables["labor_setup_steps"]["Row"];
export type InspectionStep = Tables["labor_inspection_steps"]["Row"];
export type CurbDeck = Tables["labor_curb_deck"]["Row"];
export type CurbType = Tables["labor_curb_type"]["Row"];
export type ParapetRow = Tables["labor_parapet"]["Row"];
export interface LaborTemplate {
  id: string;
  name: string;
  is_default: boolean;
  adjustments: { area: string; value: number }[];
}
export interface LaborEngines {
  setupMinimumHours: number;
  setupSteps: SetupStep[];
  inspectionSteps: InspectionStep[];
  templates: LaborTemplate[];
  curbSetupMinutes: number;
  curbDeck: CurbDeck[];
  curbType: CurbType[];
  parapet: ParapetRow[];
}

const NIL = "00000000-0000-0000-0000-000000000000";

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (!data || data.role !== "admin") throw new Error("Forbidden: admin access required");
}

export const getLaborEngines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LaborEngines> => {
    const sb = context.supabase;
    const [setup, steps, insp, tpls, adj, curb, cdeck, ctype, para] = await Promise.all([
      sb.from("labor_setup").select("*").eq("id", 1).maybeSingle(),
      sb.from("labor_setup_steps").select("*").order("sort"),
      sb.from("labor_inspection_steps").select("*").order("sort"),
      sb.from("labor_templates").select("*").order("sort"),
      sb.from("labor_template_adjustments").select("*").order("sort"),
      sb.from("labor_curb").select("*").eq("id", 1).maybeSingle(),
      sb.from("labor_curb_deck").select("*").order("sort"),
      sb.from("labor_curb_type").select("*").order("sort"),
      sb.from("labor_parapet").select("*").order("sort"),
    ]);
    const templates: LaborTemplate[] = (tpls.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      is_default: t.is_default,
      adjustments: (adj.data ?? [])
        .filter((a) => a.template_id === t.id)
        .map((a) => ({ area: a.area, value: a.value })),
    }));
    return {
      setupMinimumHours: setup.data?.minimum_hours ?? 16,
      setupSteps: steps.data ?? [],
      inspectionSteps: insp.data ?? [],
      templates,
      curbSetupMinutes: curb.data?.setup_minutes ?? 8,
      curbDeck: cdeck.data ?? [],
      curbType: ctype.data ?? [],
      parapet: para.data ?? [],
    };
  });

const setupSchema = z.object({
  minimum_hours: z.number(),
  steps: z.array(z.object({ sqft: z.number(), multiplier: z.number() })),
});
export const saveSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => setupSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    await sb.from("labor_setup").upsert({ id: 1, minimum_hours: data.minimum_hours });
    await sb.from("labor_setup_steps").delete().neq("id", NIL);
    if (data.steps.length)
      await sb.from("labor_setup_steps").insert(data.steps.map((s, i) => ({ ...s, sort: i })));
    return { ok: true };
  });

const inspSchema = z.object({
  steps: z.array(z.object({ sqft: z.number(), hours: z.number() })),
});
export const saveInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => inspSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    await sb.from("labor_inspection_steps").delete().neq("id", NIL);
    if (data.steps.length)
      await sb.from("labor_inspection_steps").insert(data.steps.map((s, i) => ({ ...s, sort: i })));
    return { ok: true };
  });

const templatesSchema = z.object({
  templates: z.array(
    z.object({
      name: z.string().min(1),
      is_default: z.boolean(),
      adjustments: z.array(z.object({ area: z.string().min(1), value: z.number() })),
    }),
  ),
});
export const saveTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => templatesSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    // Adjustments cascade-delete when the template rows go.
    await sb.from("labor_templates").delete().neq("id", NIL);
    let sawDefault = false;
    for (let i = 0; i < data.templates.length; i++) {
      const t = data.templates[i]!;
      const is_default = t.is_default && !sawDefault;
      if (is_default) sawDefault = true;
      const { data: ins, error } = await sb
        .from("labor_templates")
        .insert({ name: t.name, is_default, sort: i })
        .select("id")
        .single();
      if (error || !ins) throw new Error(error?.message ?? "Save failed");
      if (t.adjustments.length)
        await sb.from("labor_template_adjustments").insert(
          t.adjustments.map((a, j) => ({
            template_id: ins.id,
            area: a.area,
            value: a.value,
            sort: j,
          })),
        );
    }
    return { ok: true };
  });

const curbSchema = z.object({
  setup_minutes: z.number(),
  deck: z.array(z.object({ deck_type: z.string().min(1), minutes: z.number() })),
  types: z.array(z.object({ curb_type: z.string().min(1), multiplier: z.number() })),
});
export const saveCurb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => curbSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    await sb.from("labor_curb").upsert({ id: 1, setup_minutes: data.setup_minutes });
    await sb.from("labor_curb_deck").delete().neq("id", NIL);
    if (data.deck.length)
      await sb.from("labor_curb_deck").insert(data.deck.map((d, i) => ({ ...d, sort: i })));
    await sb.from("labor_curb_type").delete().neq("id", NIL);
    if (data.types.length)
      await sb.from("labor_curb_type").insert(data.types.map((t, i) => ({ ...t, sort: i })));
    return { ok: true };
  });

const parapetSchema = z.object({
  rows: z.array(
    z.object({
      deck_type: z.string().min(1),
      wall_height_band: z.string().min(1),
      no_drill_no_cant: z.number(),
      no_drill_canted: z.number(),
      predrill_no_cant: z.number(),
      predrill_canted: z.number(),
    }),
  ),
});
export const saveParapet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => parapetSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    await sb.from("labor_parapet").delete().neq("id", NIL);
    if (data.rows.length)
      await sb.from("labor_parapet").insert(data.rows.map((r, i) => ({ ...r, sort: i })));
    return { ok: true };
  });
