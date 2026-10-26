/**
 * The property's cover photo — the server half (phase 2 of the document generator; owner,
 * Oct 26). One picture per property, in the private "documents" bucket at
 * sites/<site id>/<uuid>.<ext>, its path on crm_sites.cover_photo_path (20261026190000). Setting
 * a new one removes the old file; clearing removes it and nulls the column; the editor and the
 * card read it through a signed link (an hour). The picture is shrunk on the client first
 * (field-utils.ts shrinkPhoto) and capped at 4 MB here.
 *
 * Access: whoever may edit a property (crm.functions.ts saveSite: Customers or Service access,
 * not a technician-only user); reading the link needs the same. Every call runs as the signed-in
 * user, so the bucket's documents_access() policy decides too. Pure helpers: site-photo.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess, isFieldOnly } from "@/lib/access";
import { bytesFromBase64, DOCUMENTS_BUCKET, sniffImageType } from "@/lib/documents/server-pure";
import {
  isSiteCoverPath,
  MAX_SITE_COVER_BYTES,
  siteCoverContentType,
  siteCoverPath,
} from "@/lib/site-photo";

type Client = SupabaseClient<Database>;
type Ctx = { supabase: Client; userId: string };

const SIGNED_SECONDS = 3600;
const siteInput = (d: unknown) => z.object({ siteId: z.string().uuid() }).parse(d);

/** The property's editors: Customers or Service access, never a technician-only user. */
async function siteWriteAccess(ctx: Ctx) {
  const { data: p } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!p || !(canAccess(p, "customers") || canAccess(p, "service")) || isFieldOnly(p))
    throw new Error("Forbidden: Customers access required");
  return p;
}

async function siteRow(sb: Client, siteId: string) {
  const { data, error } = await sb
    .from("crm_sites")
    .select("id, cover_photo_path, deleted_at")
    .eq("id", siteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Property not found");
  if (data.deleted_at) throw new Error("This property was deleted");
  return data;
}

/** Best effort: the old file goes; a failure is logged, never thrown (the row is already right). */
async function removeFile(sb: Client, path: string | null) {
  if (!path || !isSiteCoverPath(path)) return;
  const { error } = await sb.storage.from(DOCUMENTS_BUCKET).remove([path]);
  if (error)
    console.warn(`Site cover photo: the old file ${path} was not removed (${error.message})`);
}

/** Set (or replace) the property's cover photo: jpeg / png / webp by its bytes, 4 MB at most. */
export const setSiteCoverPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        siteId: z.string().uuid(),
        bytesBase64: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_SITE_COVER_BYTES * 4) / 3) + 1024),
        contentType: z.string().max(60).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ path: string; url: string }> => {
    await siteWriteAccess(context);
    const sb = context.supabase;
    const site = await siteRow(sb, data.siteId);
    const bytes = bytesFromBase64(data.bytesBase64);
    if (bytes.length > MAX_SITE_COVER_BYTES) throw new Error("The picture is over 4 MB");
    const type = sniffImageType(bytes);
    if (!type) throw new Error("Pictures must be JPEG, PNG or WebP");
    const { randomUUID } = await import("node:crypto");
    const path = siteCoverPath(site.id, randomUUID(), type);
    const { error: upErr } = await sb.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, bytes, { contentType: siteCoverContentType(type), upsert: false });
    if (upErr) throw new Error(`Could not store the picture: ${upErr.message}`);
    const { error } = await sb
      .from("crm_sites")
      .update({ cover_photo_path: path })
      .eq("id", site.id);
    if (error) {
      await removeFile(sb, path);
      throw new Error(error.message);
    }
    await removeFile(sb, site.cover_photo_path);
    const { data: signed } = await sb.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(path, SIGNED_SECONDS);
    return { path, url: signed?.signedUrl ?? "" };
  });

/** Take the cover photo off the property (the file goes too). */
export const clearSiteCoverPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(siteInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await siteWriteAccess(context);
    const sb = context.supabase;
    const site = await siteRow(sb, data.siteId);
    const { error } = await sb
      .from("crm_sites")
      .update({ cover_photo_path: null })
      .eq("id", site.id);
    if (error) throw new Error(error.message);
    await removeFile(sb, site.cover_photo_path);
    return { ok: true };
  });

/** A signed link (an hour) to the property's cover photo; null when it has none. */
export const siteCoverUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(siteInput)
  .handler(async ({ data, context }): Promise<{ path: string | null; url: string | null }> => {
    await siteWriteAccess(context);
    const sb = context.supabase;
    const site = await siteRow(sb, data.siteId);
    if (!site.cover_photo_path || !isSiteCoverPath(site.cover_photo_path))
      return { path: null, url: null };
    const { data: signed, error } = await sb.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(site.cover_photo_path, SIGNED_SECONDS);
    if (error || !signed) throw new Error(error?.message ?? "Could not sign the picture");
    return { path: site.cover_photo_path, url: signed.signedUrl };
  });
