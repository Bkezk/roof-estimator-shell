/**
 * The signed-in user's light / dark choice on their profile (dark mode, owner Oct 2), so it
 * follows them to another device. The browser keeps its own copy (lib/theme.ts); this is the
 * cross-device record, read after sign-in (where it wins) and written on every toggle.
 *
 * Both ends tolerate a database without migration 20261002170000_theme.sql yet: the read
 * answers "no saved choice" and the write reports `saved: false`, so the toggle keeps working
 * from the browser's copy. Nothing else in the app reads profiles.theme (getMyProfile does not
 * select it), so the sign-in path never depends on the column existing.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { THEME_PREFS, isThemePref, type ThemePref } from "@/lib/theme";

/** The caller's saved choice, or null when there is none to read. */
export const getMyTheme = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ theme: ThemePref | null }> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("theme")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) return { theme: null };
    return { theme: isThemePref(data?.theme) ? data.theme : null };
  });

/** Save the caller's choice (their own row only: set_my_theme keys on auth.uid()). */
export const setMyTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ theme: z.enum(THEME_PREFS) }).parse(d))
  .handler(async ({ data, context }): Promise<{ saved: boolean; error?: string }> => {
    const { error } = await context.supabase.rpc("set_my_theme", { p_theme: data.theme });
    return error ? { saved: false, error: error.message } : { saved: true };
  });
