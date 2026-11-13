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
