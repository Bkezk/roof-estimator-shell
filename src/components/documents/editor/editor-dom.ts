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

/** How long a module added with a + stays marked on the canvas, in milliseconds. */
export const JUST_ADDED_MS = 1600;
/** The mark a just-added module carries for that long (styled in src/styles.css). */
export const JUST_ADDED_ATTR = "data-just-added";

/**
 * Show the module a + just added (owner, Nov 15: "if you click the plus to add a module the
 * preview jumps to where the module is added"). The canvas went to the top of the page, so on a
 * long page the new module at the bottom was out of sight.
 *
 * The module is drawn a moment after the click, so this looks for it for about a second. Then
 * it brings it to the middle of the canvas and marks it briefly so the eye finds it. A long
 * page is laid out again around a new module and may move it to the next sheet: one later look
 * follows it there.
 */
export function revealModule(moduleId: string, tries = 12) {
  const find = () => document.querySelector<HTMLElement>(`[data-module-id="${moduleId}"]`);
  const show = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.setAttribute(JUST_ADDED_ATTR, "");
    window.setTimeout(() => el.removeAttribute(JUST_ADDED_ATTR), JUST_ADDED_MS);
  };
  const el = find();
  if (!el) {
    if (tries > 0) window.setTimeout(() => revealModule(moduleId, tries - 1), 80);
    return;
  }
  show(el);
  window.setTimeout(() => {
    const again = find();
    if (again && again !== el) show(again);
  }, 350);
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
