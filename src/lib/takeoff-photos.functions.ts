/**
 * Deficiency pictures (owner, Oct 27: "have a deficiencies label that you can tag a spot and
 * attach a picture too … this is also kind of becoming a selling tool") — server functions.
 *
 * The pictures live in the private "takeoffs" storage bucket next to the plan file, under
 * `<takeoffId>/photos/<uuid>.<ext>`; the browser uploads them straight into the bucket (as the
 * underlay is uploaded) and keeps each one's path on the deficiency's attrs (`photos`). These
 * functions follow the takeoff's access rules: Takeoff access to get an upload path or remove a
 * picture (the write rule), Takeoff or Estimate access to sign read URLs (the read rule) — the
 * same pairs saveTakeoff / getTakeoff use. The bucket's storage RLS is by bucket (any object
 * path), so no migration is needed for the photos/ folder; the bucket accepts PDF, PNG and JPEG
 * only, so the browser side converts every picture to JPEG / PNG first.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { assertPageAccess } from "@/lib/auth.functions";
import { TAKEOFF_BUCKET } from "@/lib/takeoff.functions";

type Ctx = { supabase: Parameters<typeof assertPageAccess>[0]; userId: string };

const readAccess = async (ctx: Ctx) => {
  try {
    await assertPageAccess(ctx.supabase, ctx.userId, "takeoff");
  } catch {
    await assertPageAccess(ctx.supabase, ctx.userId, "estimate");
  }
};
const writeAccess = (ctx: Ctx) => assertPageAccess(ctx.supabase, ctx.userId, "takeoff");

/** The picture kinds the bucket (and pdf-lib) take. */
export const PHOTO_KINDS = ["jpeg", "png"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** `<takeoffId>/photos/<id>.<ext>` — where a deficiency picture goes (pure, for tests). */
export function takeoffPhotoPath(takeoffId: string, kind: PhotoKind, id: string): string {
  return `${takeoffId}/photos/${id}.${kind === "png" ? "png" : "jpg"}`;
}

/** True when `path` is a picture of takeoff `takeoffId` (and nothing else in the bucket). */
export function isTakeoffPhotoPath(takeoffId: string, path: string): boolean {
  return (
    path.startsWith(`${takeoffId}/photos/`) &&
    !path.includes("..") &&
    /^[^/]+\/photos\/[A-Za-z0-9._-]+$/.test(path)
  );
}

/** How long a signed read URL lives (an hour, like ticket photos). */
export const PHOTO_URL_SECONDS = 3600;

const takeoffExists = async (ctx: Ctx, id: string) => {
  const { data, error } = await ctx.supabase
    .from("takeoffs")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This takeoff was not found (it may have been deleted).");
};

/**
 * Where the browser should upload the next picture of a deficiency on this takeoff: a fresh
 * `<takeoffId>/photos/<uuid>.<ext>`. Takeoff (write) access; the takeoff must exist.
 */
export const takeoffPhotoUploadPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ takeoff_id: z.string().uuid(), kind: z.enum(PHOTO_KINDS) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ path: string }> => {
    await writeAccess(context);
    await takeoffExists(context, data.takeoff_id);
    return { path: takeoffPhotoPath(data.takeoff_id, data.kind, crypto.randomUUID()) };
  });

/**
 * One-hour signed read URLs for a deficiency's pictures (Takeoff or Estimate access). Paths
 * outside the takeoff's photos/ folder are refused; a path the bucket no longer has comes back
 * without a URL (the card shows it as missing rather than failing the whole strip).
 */
export const signTakeoffPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        takeoff_id: z.string().uuid(),
        paths: z.array(z.string().min(1).max(300)).min(1).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<Record<string, string | null>> => {
    await readAccess(context);
    for (const p of data.paths)
      if (!isTakeoffPhotoPath(data.takeoff_id, p))
        throw new Error("A picture path is not under this takeoff's photos folder");
    const { data: signed, error } = await context.supabase.storage
      .from(TAKEOFF_BUCKET)
      .createSignedUrls(data.paths, PHOTO_URL_SECONDS);
    if (error) throw new Error(error.message);
    const out: Record<string, string | null> = {};
    for (const p of data.paths) out[p] = null;
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) out[s.path] = s.signedUrl;
    return out;
  });

/**
 * Remove a deficiency picture's file from the bucket (Takeoff access; the path must be under
 * this takeoff's photos/ folder). The caller drops it from the object's attrs first; a failure
 * here leaves an orphaned object, which is harmless (nothing lists it).
 */
export const removeTakeoffPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ takeoff_id: z.string().uuid(), path: z.string().min(1).max(300) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    if (!isTakeoffPhotoPath(data.takeoff_id, data.path))
      throw new Error("The picture path is not under this takeoff's photos folder");
    const { error } = await context.supabase.storage.from(TAKEOFF_BUCKET).remove([data.path]);
    if (error) throw new Error(error.message);
  });
