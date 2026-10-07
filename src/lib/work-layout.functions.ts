/**
 * The signed-in user's Work Overview layout on their profile (owner, Oct 7), so the column order
 * and hidden columns follow them to another device. The browser keeps its own copy
 * (lib/work-layout.ts); this is the cross-device record, read when the page opens (where it
 * wins) and written on every change.
 *
 * Both ends tolerate a database without migration 20261007110000_work_layout.sql: the read
 * answers "no saved layout" and the write reports `saved: false`, so dragging keeps working from
 * the browser's copy.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Json } from "@/integrations/supabase/types";
import { isDefaultWorkLayout, normalizeWorkLayout, type WorkLayout } from "@/lib/work-layout";

/** The layout as the jsonb column holds it: {"order": [...], "hidden": [...]}. */
const toJson = (l: WorkLayout): Json => ({ order: [...l.order], hidden: [...l.hidden] });

/** The caller's saved layout, or null when there is none (the default applies). */
export const getMyWorkLayout = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ layout: WorkLayout | null }> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("work_layout")
      .eq("id", context.userId)
      .maybeSingle();
    if (error || !data?.work_layout) return { layout: null };
    return { layout: normalizeWorkLayout(data.work_layout) };
  });

const layoutSchema = z.object({
  order: z.array(z.string().max(32)).max(20),
  hidden: z.array(z.string().max(32)).max(20),
});

/** Save the caller's layout (their own row only: set_my_work_layout keys on auth.uid()). */
export const setMyWorkLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => layoutSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ saved: boolean; error?: string }> => {
    const layout = normalizeWorkLayout(data);
    const { error } = await context.supabase.rpc("set_my_work_layout", {
      p_layout: isDefaultWorkLayout(layout) ? null : toJson(layout),
    });
    return error ? { saved: false, error: error.message } : { saved: true };
  });
