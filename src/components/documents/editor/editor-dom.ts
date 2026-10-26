/**
 * DOM helpers for the Documents editor (no React): scrolling the canvas to a page, and reading a
 * picture file for upload.
 */
import { pageDomId } from "@/lib/documents/editor-helpers";

export function scrollToPage(pageId: string) {
  document
    .getElementById(pageDomId(pageId))
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Read a picture file: its data URL and pixel size. */
export function readImageFile(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("That file is not a picture the browser can show"));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
