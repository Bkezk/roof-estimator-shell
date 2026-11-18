/**
 * No zoom-in when a box is tapped on an iPhone or iPad (owner, Nov 13: "the work overview page
 * that opened was a tad zoomed in which is a bit annoying"). iOS zooms the page in when a text
 * box with small type takes the focus (the portal's root type is 13 px) and leaves it zoomed, so
 * signing in left the next page a little too big. `maximum-scale=1` in the viewport stops that
 * focus zoom. It is added on iOS only: Android honours it for pinch-zoom too, and people there
 * keep theirs.
 *
 * Applied by the root component once the page has hydrated and again on each route change.
 */
export const IOS_MAX_SCALE = "maximum-scale=1";

/** The viewport content with the focus-zoom stop added once. */
export function withMaxScale(content: string | null | undefined): string {
  const c = (content ?? "").trim();
  if (/maximum-scale\s*=/.test(c)) return c;
  return c ? `${c}, ${IOS_MAX_SCALE}` : IOS_MAX_SCALE;
}

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIosDevice(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">) {
  return (
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
  );
}

/**
 * Add the stop to this page's viewport tag, on iOS only. Safe to call often, and during SSR.
 * Every viewport tag on the page is set (the last one is the one a browser obeys). It runs after
 * the page has hydrated and not from a script in the head: a tag changed before hydration no
 * longer matches the one the head renders, so a second, unchanged tag was added after it and
 * won.
 */
export function lockIosFocusZoom(): void {
  if (typeof document === "undefined" || typeof navigator === "undefined") return;
  if (!isIosDevice(navigator)) return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="viewport"]')) {
    const next = withMaxScale(meta.content);
    if (next !== meta.content) meta.content = next;
  }
}

// ── A pinned bar left floating (owner, Nov 18) ─────────────────────────────────────────────
//
// "I had this bug the other day after drawing on the takeoff where step 2 stayed in the middle of
// my screen", with a picture from his iPhone: the workflow's bottom bar a quarter of the way up
// the screen, the page showing under it. The bar is pinned to the bottom of the screen by the
// browser. On iOS 26 the part of the page the screen shows can be left out of step with the page
// after the keyboard closes (typing a tag on the aerial, a search) or the screen changes size,
// and everything pinned is then drawn in the wrong place until the page next moves. This cannot
// be made to happen off an iPhone, so the guard below is the remedy others report for it: once
// the keyboard is away, move the page by a pixel and back and have the pinned bars placed again.

/** How long after the keyboard closes or the screen changes size the page is set straight. */
export const IOS_RESYNC_DELAYS_MS = [250, 700] as const;

/** The bars pinned to the bottom: the workflow's two and the office pages' save bar. */
export const PINNED_BARS = "[data-pinned-bar], [data-save-bar]";

/** A box the keyboard is up for. */
export function isTypingElement(el: unknown): boolean {
  const e = el as { tagName?: string; isContentEditable?: boolean; type?: string } | null;
  if (!e || typeof e.tagName !== "string") return false;
  if (e.isContentEditable) return true;
  const tag = e.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "file", "submit", "reset", "color"].includes(
    (e.type ?? "text").toLowerCase(),
  );
}

/**
 * Set the page straight: a pixel down and back (up and back at the very bottom), and each pinned
 * bar placed again. Nothing while a box has the keyboard, and the page ends where it was.
 */
export function resyncPinned(win: Window = window): boolean {
  const doc = win.document;
  if (isTypingElement(doc.activeElement)) return false;
  const x = win.scrollX;
  const y = win.scrollY;
  const max = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
  win.scrollTo(x, y < max ? y + 1 : Math.max(0, y - 1));
  win.scrollTo(x, y);
  for (const bar of doc.querySelectorAll<HTMLElement>(PINNED_BARS)) {
    const before = bar.style.bottom;
    bar.style.bottom = "0.5px";
    void bar.offsetHeight; // the browser lays the bar out again
    bar.style.bottom = before;
  }
  return true;
}

/**
 * On iOS only: set the page straight shortly after the keyboard closes and after the visible
 * part of the page changes size. Returns the way to stop. Safe to call during SSR.
 */
export function watchIosPinned(): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return () => {};
  if (!isIosDevice(navigator)) return () => {};
  let timers: ReturnType<typeof setTimeout>[] = [];
  const later = () => {
    for (const t of timers) clearTimeout(t);
    timers = IOS_RESYNC_DELAYS_MS.map((ms) => setTimeout(() => resyncPinned(window), ms));
  };
  const onFocusOut = (e: FocusEvent) => {
    if (isTypingElement(e.target)) later();
  };
  document.addEventListener("focusout", onFocusOut);
  window.visualViewport?.addEventListener("resize", later);
  window.addEventListener("orientationchange", later);
  return () => {
    for (const t of timers) clearTimeout(t);
    document.removeEventListener("focusout", onFocusOut);
    window.visualViewport?.removeEventListener("resize", later);
    window.removeEventListener("orientationchange", later);
  };
}
