/**
 * The property card's server functions for its aerial cover (owner, Nov 2; the rules are in
 * aerial-cover.ts, the work in site-aerial-cover.server.ts). This file is what the browser
 * imports, so it carries nothing of Node's: the handlers import the server module when they run.
 * Whoever may edit a property may make its aerial (site-photo.functions.ts siteWriteAccess).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { AerialCoverResult } from "@/lib/aerial-cover";

const siteInput = (d: unknown) => z.object({ siteId: z.string().uuid() }).parse(d);

/** The property card: its cover picture, the aerial made now when it has none. */
export const ensureSiteAerialCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(siteInput)
  .handler(async ({ data, context }): Promise<AerialCoverResult> => {
    const { siteWriteAccess } = await import("@/lib/site-photo.functions");
    await siteWriteAccess(context);
    const { ensureAerialCover } = await import("@/lib/site-aerial-cover.server");
    return ensureAerialCover(context.supabase, data.siteId);
  });

/** "Try the aerial again": forget the last miss (or removal) and look the address up now. */
export const retrySiteAerialCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(siteInput)
  .handler(async ({ data, context }): Promise<AerialCoverResult> => {
    const { siteWriteAccess } = await import("@/lib/site-photo.functions");
    await siteWriteAccess(context);
    const { error } = await context.supabase
      .from("crm_sites")
      .update({ aerial_tried_at: null, aerial_note: null })
      .eq("id", data.siteId)
      .is("cover_photo_path", null);
    if (error) throw new Error(error.message);
    const { ensureAerialCover } = await import("@/lib/site-aerial-cover.server");
    return ensureAerialCover(context.supabase, data.siteId);
  });
