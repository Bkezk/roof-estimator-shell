/**
 * Dark mode (owner, Oct 2): a light / dark toggle in the sidebar footer, a charcoal grey rather
 * than black so the JBK logo stays legible. Pure logic only — no React — so it is unit-tested
 * directly (theme.test.ts); the provider is lib/theme-context.tsx.
 *
 * - A preference is "light", "dark" or "system" (follow the OS). "system" is only the default
 *   before anyone toggles; the toggle flips between light and dark.
 * - The choice is cached in localStorage (THEME_STORAGE_KEY) so THEME_BOOT_SCRIPT, inlined in the
 *   root document's <head>, sets the `dark` class on <html> before the first paint (no white
 *   flash). After sign-in the profile's value (profiles.theme) wins and is written back here.
 * - Paper surfaces are always light: printing drops the class for the print (theme-context.tsx)
 *   and the bid summary screenshots run inside withLightTheme.
 */

export const THEME_PREFS = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export type ResolvedTheme = "light" | "dark";

/** Where the browser caches the choice (read by the boot script before React loads). */
export const THEME_STORAGE_KEY = "jbk-portal:theme";
/** The class Tailwind's `dark:` variant keys on (styles.css: `@custom-variant dark`). */
export const DARK_CLASS = "dark";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePref(v: unknown): v is ThemePref {
  return typeof v === "string" && (THEME_PREFS as readonly string[]).includes(v);
}

/** What the screen shows for a preference: "system" follows the OS. */
export function resolveTheme(
  pref: ThemePref | null | undefined,
  systemDark: boolean,
): ResolvedTheme {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}

/** The toggle: from what is showing now to the other one (never back to "system"). */
export function nextTheme(current: ResolvedTheme): "light" | "dark" {
  return current === "dark" ? "light" : "dark";
}

/** The toggle's label (aria-label and tooltip) for what is showing now. */
export function toggleLabel(current: ResolvedTheme): string {
  return current === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The cached preference; "system" when none, unreadable or not one of the three. */
export function readStoredTheme(storage: StorageLike | null | undefined): ThemePref {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePref(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function writeStoredTheme(storage: StorageLike | null | undefined, pref: ThemePref): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage blocked (private mode): the choice still holds for this visit.
  }
}

type RootLike = { classList: Pick<DOMTokenList, "add" | "remove" | "contains" | "toggle"> };

/** Put the resolved theme on <html>. */
export function applyTheme(root: RootLike, theme: ResolvedTheme): void {
  root.classList.toggle(DARK_CLASS, theme === "dark");
}

/**
 * Run `fn` with the page in light mode, then put dark back if it was on. For DOM screenshots
 * that become paper (the bid summary PDF captures the estimator panels on a white page): the
 * captured styles must be the light ones whatever the viewer picked.
 */
export async function withLightTheme<T>(root: RootLike, fn: () => Promise<T>): Promise<T> {
  const wasDark = root.classList.contains(DARK_CLASS);
  if (wasDark) root.classList.remove(DARK_CLASS);
  try {
    return await fn();
  } finally {
    if (wasDark) root.classList.add(DARK_CLASS);
  }
}

/**
 * Inlined at the top of <head> (routes/__root.tsx RootShell), before the stylesheet and the
 * body: the cached choice, else the OS setting, becomes the `dark` class on <html> before
 * anything paints. Plain ES5, no imports; any failure leaves the page light.
 */
export const THEME_BOOT_SCRIPT =
  "(function(){try{" +
  `var p=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  'if(p!=="light"&&p!=="dark")p="system";' +
  'var d=p==="dark"||(p==="system"&&!!window.matchMedia&&' +
  `window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);` +
  `if(d)document.documentElement.classList.add(${JSON.stringify(DARK_CLASS)});` +
  "}catch(e){}})();";
