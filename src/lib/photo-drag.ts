/**
 * Dragging a ticket photo out of the browser onto the desktop (owner, Oct 7: "on a service call
 * can you drag pictures from the call report onto the desktop?"). Chrome and Edge save a file
 * dropped on the desktop or a folder when the drag carries a `DownloadURL` item —
 * "<mime>:<file name>:<url>"; other browsers get the plain image / URL drag they already do, and
 * the lightbox's Download button stays for them. The file is the stored photo as uploaded; a
 * marked-up photo is flattened only by Download (photo-export.ts).
 */
import { photoExt, photoFileName } from "@/lib/photo-annotations";

export const PHOTO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

export interface PhotoDragData {
  fileName: string;
  mime: string;
  /** The Chrome / Edge "DownloadURL" item. */
  downloadUrl: string;
}

export function photoDragData(
  url: string,
  ticket: string | number | null | undefined,
  role: string,
  n: number,
  storagePath: string,
): PhotoDragData {
  const ext = photoExt(storagePath);
  const fileName = photoFileName(ticket, role, n, ext);
  const mime = PHOTO_MIME[ext] ?? "image/jpeg";
  return { fileName, mime, downloadUrl: `${mime}:${fileName}:${url}` };
}

/** Put the photo on a drag so a drop on the desktop saves it. */
export function setPhotoDrag(dt: DataTransfer, d: PhotoDragData, url: string): void {
  dt.setData("DownloadURL", d.downloadUrl);
  dt.setData("text/uri-list", url);
  dt.setData("text/plain", url);
  dt.effectAllowed = "copy";
}
