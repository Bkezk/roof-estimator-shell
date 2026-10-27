/**
 * Deficiency pictures in the browser (owner, Oct 27): picking (camera or camera roll on a phone:
 * a plain file input with accept="image/*" and no `capture`), shrinking (`shrinkPhoto`, the
 * ticket photos' helper), converting to JPEG / PNG (the "takeoffs" bucket and pdf-lib take only
 * those), uploading straight into the bucket at the path the server hands out, and the attrs
 * bookkeeping (never an empty `photos` list or an `undefined` key in the saved JSON).
 *
 * Pure parts (tested): `photoKindOf`, `withPhotos`, `addPhotos`, `removePhoto`, `withNote`;
 * `useDeficiencyPhotoUrls` signs the read URLs.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { shrinkPhoto } from "@/components/service/field-utils";
import { TAKEOFF_BUCKET } from "@/lib/takeoff.functions";
import { signTakeoffPhotos, type PhotoKind } from "@/lib/takeoff-photos.functions";
import type { CountAttrs, DeficiencyPhoto } from "@/lib/takeoff/model";

/** The bucket's picture kind for a MIME type; null for anything else (HEIC, WebP, GIF…). */
export function photoKindOf(type: string): PhotoKind | null {
  const t = (type.split(";")[0] ?? "").trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return "jpeg";
  if (t === "image/png") return "png";
  return null;
}

/** `attrs` with `photos` set, or the key dropped when the list is empty. */
export function withPhotos(attrs: CountAttrs, photos: readonly DeficiencyPhoto[]): CountAttrs {
  const nx: CountAttrs = { ...attrs };
  if (photos.length) nx.photos = photos.map((p) => (p.name ? { ...p } : { path: p.path }));
  else delete nx.photos;
  return nx;
}

/** `attrs` with `added` appended (a path already there is not added twice). */
export function addPhotos(attrs: CountAttrs, added: readonly DeficiencyPhoto[]): CountAttrs {
  const cur = attrs.photos ?? [];
  const have = new Set(cur.map((p) => p.path));
  const next = [...cur];
  for (const p of added)
    if (!have.has(p.path)) {
      have.add(p.path);
      next.push(p);
    }
  return withPhotos(attrs, next);
}

/** `attrs` without the picture at `path`. */
export function removePhoto(attrs: CountAttrs, path: string): CountAttrs {
  return withPhotos(
    attrs,
    (attrs.photos ?? []).filter((p) => p.path !== path),
  );
}

/** `attrs` with the note set, or the key dropped when blank. */
export function withNote(attrs: CountAttrs, note: string): CountAttrs {
  const nx: CountAttrs = { ...attrs };
  if (note.trim()) nx.note = note;
  else delete nx.note;
  return nx;
}

/**
 * A picked picture as the bucket takes it: shrunk (to 2048 px JPEG when big), and re-encoded to
 * JPEG when it is neither JPEG nor PNG (a phone's HEIC, a WebP). Throws when the browser cannot
 * decode it (then it cannot be shown to the customer either).
 */
export async function preparePhoto(
  file: File,
): Promise<{ blob: Blob; kind: PhotoKind; name: string }> {
  const shrunk = await shrinkPhoto(file);
  const kind = photoKindOf(shrunk.type);
  if (kind) return { blob: shrunk.blob, kind, name: shrunk.name };
  if (typeof createImageBitmap === "undefined")
    throw new Error(`${file.name || "the picture"} is not a JPEG or PNG`);
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(shrunk.blob);
  } catch {
    throw new Error(
      `${file.name || "the picture"} could not be read by this browser — take it again as JPEG`,
    );
  }
  const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not convert the picture (no 2D canvas)");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("This browser could not convert the picture to JPEG");
  return { blob, kind: "jpeg", name: (shrunk.name || "picture").replace(/\.[^.]+$/, "") + ".jpg" };
}

/** Upload a prepared picture straight into the "takeoffs" bucket at `path`. */
export async function uploadTakeoffPhoto(path: string, blob: Blob, kind: PhotoKind): Promise<void> {
  const { error } = await supabase.storage.from(TAKEOFF_BUCKET).upload(path, blob, {
    contentType: kind === "png" ? "image/png" : "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`upload failed (${error.message})`);
}

/** The image files among what was picked (anything else is left out). */
export function imageFilesOf(list: ArrayLike<File> | null | undefined): File[] {
  return Array.from(list ?? []).filter(
    (f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name),
  );
}

/**
 * Signed read URLs (an hour) for a deficiency's pictures, through the server function
 * `signTakeoffPhotos`; null for a picture the bucket no longer has. The Objects card's thumbnail
 * strip and the lightbox share it (and its cache, keyed by the paths).
 */
export function useDeficiencyPhotoUrls(takeoffId: string, paths: readonly string[]) {
  const signFn = useServerFn(signTakeoffPhotos);
  const key = paths.join("\n");
  return useQuery({
    queryKey: ["takeoff-photo-urls", takeoffId, key],
    queryFn: () => signFn({ data: { takeoff_id: takeoffId, paths: [...paths] } }),
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    retry: 1,
  });
}
