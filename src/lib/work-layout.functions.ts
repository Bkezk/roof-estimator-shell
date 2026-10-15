/**
 * The signed-in user's Work Overview layout on their profile (owner, Oct 7), so the column order
 * and hidden columns follow them to another device. The browser keeps its own copy
 * (lib/work-layout.ts); this is the cross-device record, read when the page opens (where it
 * wins) and written on every change.
 *
 * Both ends tolerate a database without migration 20261007110000_work_layout.sql: the read
 * answers "no saved layout" and the write throws (the page toasts LAYOUT_SAVE_FAILED), so
 * dragging keeps working from the browser's copy and the person knows it went no further.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Json } from "@/integrations/supabase/types";
import { isEmptyWorkLayout, normalizeWorkLayout, type WorkLayout } from "@/lib/work-layout";

/**
 * The layout as the jsonb column holds it: {"order": [...], "hidden": [...], "hiddenKinds":
 * [...]} plus, when remembered, "view" and "who" (owner, Oct 15). Oct 15 fix: hiddenKinds was
 * left out here and in the schema, so the Show menu's "remembered on every device" was false.
 */
const toJson = (l: WorkLayout): Json => ({
  order: [...l.order],
  hidden: [...l.hidden],
  hiddenKinds: [...l.hiddenKinds],
  ...(l.view ? { view: l.view } : {}),
  ...(l.who ? { who: l.who } : {}),
});

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

const names = z.array(z.string().max(32)).max(20);
const layoutSchema = z.object({
  order: names,
  hidden: names,
  hiddenKinds: names.optional(),
  view: z.enum(["list", "calendar", "owner"]).optional(),
  who: z.string().max(64).optional(),
});

/** The toast when the profile would not take the layout (the browser's copy still stands). */
export const LAYOUT_SAVE_FAILED = "Could not save your layout — kept on this device only";

/**
 * Save the caller's layout (their own row only: set_my_work_layout keys on auth.uid()). A failure
 * THROWS (Oct 15): until then it answered `{ saved: false }` and the page never looked, so a
 * layout that only lived in this browser was announced as "remembered on every device". The
 * success shape stays `{ saved: true }` for callers that read it.
 */
export const setMyWorkLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => layoutSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ saved: boolean; error?: string }> => {
    const layout = normalizeWorkLayout(data);
    const { error } = await context.supabase.rpc("set_my_work_layout", {
      p_layout: isEmptyWorkLayout(layout) ? null : toJson(layout),
    });
    if (error) throw new Error(`${LAYOUT_SAVE_FAILED}: ${error.message}`);
    return { saved: true };
  });
