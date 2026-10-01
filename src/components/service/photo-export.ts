/**
 * Taking a ticket photo away (owner, Oct 1: "those pictures need to be able to be exported if
 * so desired"): the marks flattened onto the photo in the browser — a canvas at the picture's
 * natural size, the photo, then the marks (paintPhotoMarks, the same geometry as on screen and
 * on the invoice) — saved as a PNG named "<ticket>-<role>-<n>.png". A photo without marks is
 * saved as the original file. The stored photo is never changed.
 */
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  paintPhotoMarks,
  parsePhotoMarks,
  photoExt,
  photoFileName,
  type PhotoMark,
} from "@/lib/photo-annotations";
import { SERVICE_BUCKET, type JobPhotoRow } from "@/lib/service-field.functions";

/** The picture's natural size once it has loaded (null until then, or when it cannot load). */
export function useNaturalSize(url: string | null | undefined) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live && img.naturalWidth > 0) setSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return size;
}

/** The stored photo itself (private bucket, the signed-in user's own access). */
async function photoBlob(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(SERVICE_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "the photo could not be read");
  return data;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("this browser cannot open the photo"));
    img.src = src;
  });
}

/** The photo with its marks drawn in, as a PNG at the picture's natural size. */
export async function flattenPhoto(blob: Blob, marks: PhotoMark[]): Promise<Blob> {
  const src = URL.createObjectURL(blob);
  try {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw the picture");
    ctx.drawImage(img, 0, 0);
    paintPhotoMarks(ctx, marks, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The picture could not be made"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(src);
  }
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Download one photo as "<ticket>-<role>-<n>.png" with its marks drawn in (`marks`: the
 * editor's current ones; else the stored ones), or the original file when it has none.
 */
export async function downloadPhoto(
  photo: JobPhotoRow,
  ticket: string | number | null | undefined,
  n: number,
  marks: PhotoMark[] = parsePhotoMarks(photo.annotations),
) {
  const blob = await photoBlob(photo.storage_path);
  if (marks.length)
    saveBlob(await flattenPhoto(blob, marks), photoFileName(ticket, photo.role, n, "png"));
  else saveBlob(blob, photoFileName(ticket, photo.role, n, photoExt(photo.storage_path)));
}
