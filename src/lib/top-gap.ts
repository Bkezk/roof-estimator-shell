/**
 * Space above the top bar in the iPhone Home Screen app (owner, Nov 13: "the reason the top is
 * blurry is the words, search etc are too close to the time and battery; when I pull down it goes
 * away"). iOS softens whatever sits right under the status bar, and the bar's row (menu, JBK
 * Portal, search, bell) was inside that zone. The row is pushed down by `--jbk-top-gap`:
 * styles.css gives the Home Screen app TOP_GAP_DEFAULT, and My account has a Less / More control
 * that keeps a person's own number on that phone (no test machine here runs the Home Screen app,
 * so the right amount is found on the phone itself).
 *
 * Browser-only where it touches the page; every function is safe to call during SSR.
 */
import { isIos } from "@/lib/push-client";

export const TOP_GAP_KEY = "jbk:top-gap";
/** styles.css sets the same number for the Home Screen app. */
export const TOP_GAP_DEFAULT = 20;
export const TOP_GAP_MAX = 80;
export const TOP_GAP_STEP = 4;
export const TOP_GAP_VAR = "--jbk-top-gap";

/** A whole number of pixels from 0 to TOP_GAP_MAX. */
export const clampTopGap = (n: number): number =>
  Number.isFinite(n) ? Math.min(TOP_GAP_MAX, Math.max(0, Math.round(n))) : TOP_GAP_DEFAULT;

/** The kept number, or null when nothing (or nothing usable) is kept. */
export function parseTopGap(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampTopGap(n) : null;
}

/** One press of Less (-1) or More (+1). */
export const stepTopGap = (now: number, dir: -1 | 1): number =>
  clampTopGap(now + dir * TOP_GAP_STEP);

/** An iPhone or iPad running the portal from its Home Screen icon. */
export function iosHomeScreenApp(): boolean {
  if (typeof window === "undefined" || !isIos()) return false;
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const storageOrNull = (): StorageLike | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function readTopGap(storage: StorageLike | null = storageOrNull()): number | null {
  try {
    return parseTopGap(storage?.getItem(TOP_GAP_KEY));
  } catch {
    return null;
  }
}

export function saveTopGap(px: number, storage: StorageLike | null = storageOrNull()): void {
  try {
    storage?.setItem(TOP_GAP_KEY, String(clampTopGap(px)));
  } catch {
    /* storage is off: the number holds for this visit only */
  }
}

/** Put the number on the page (styles.css reads it). */
export function applyTopGap(px: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(TOP_GAP_VAR, `${clampTopGap(px)}px`);
}

/** On arrival: a number kept on this phone replaces the stylesheet's own. */
export function applyKeptTopGap(): void {
  if (!iosHomeScreenApp()) return;
  const kept = readTopGap();
  if (kept !== null) applyTopGap(kept);
}
