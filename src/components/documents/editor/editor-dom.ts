/**
 * DOM helpers for the Documents editor (no React): scrolling the canvas to a page or a module,
 * and reading a picture file for upload.
 */
import { pageDomId, SHEET_OF_ATTR } from "@/lib/documents/editor-helpers";

export function scrollToPage(pageId: string) {
  document
    .getElementById(pageDomId(pageId))
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Scroll the canvas to the k-th sheet of a page (0 = the page's first sheet). */
export function scrollToSheet(pageId: string, index: number) {
  document
    .querySelectorAll(`[${SHEET_OF_ATTR}="${pageId}"]`)
    [index]?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Scroll a module's wrapper on the canvas into view (one just dropped where the pointer was). */
export function scrollToModule(moduleId: string) {
  document
    .querySelector(`[data-module-id="${moduleId}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
