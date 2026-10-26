/**
 * The property's cover photo (phase 2 of the document generator; owner, Oct 26): one picture of
 * the building on the property record (crm_sites.cover_photo_path, migration 20261026190000),
 * kept in the private "documents" bucket under sites/<site id>/<file>, shown on the property card
 * and printed as the "Property photo" a document's cover page starts with (ImageRef siteCover).
 * Pure: the path, its check, the size cap and the caption helper. The server half is
 * site-photo.functions.ts; the card is components/crm/property-sites.tsx.
 */
import { IMAGE_MIME, type ImageType } from "@/lib/documents/server-pure";

/** Where a site's cover photo lives in the documents bucket. */
export const siteCoverPath = (siteId: string, fileId: string, type: ImageType) =>
  `sites/${siteId}/${fileId}.${type === "jpeg" ? "jpg" : type}`;

/** A path siteCoverUrl may sign: under sites/<uuid>/, one file, no dot-segments. */
export const isSiteCoverPath = (path: string) =>
  /^sites\/[0-9a-f-]{36}\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(path);

/** The site a cover path belongs to, or null when the path is not one. */
export function siteIdOfCoverPath(path: string): string | null {
  const m = /^sites\/([0-9a-f-]{36})\//.exec(path);
  return m ? m[1]! : null;
}

/** After the client's shrink (field-utils.ts shrinkPhoto, 2048 px JPEG) a cover is at most 4 MB. */
export const MAX_SITE_COVER_BYTES = 4 * 1024 * 1024;

/** The content type an upload declares, from the sniffed bytes (never the browser's file name). */
export const siteCoverContentType = (type: ImageType) => IMAGE_MIME[type];

/** The TanStack Query key the card caches the signed link under. */
export const siteCoverKey = (siteId: string) => ["site-cover", siteId] as const;

/** What the Replace / Set button reads: there is a photo or there is not. */
export const coverButtonLabel = (hasPhoto: boolean) => (hasPhoto ? "Replace" : "Set cover photo");
