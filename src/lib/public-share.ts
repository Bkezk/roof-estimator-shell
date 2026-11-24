/**
 * What a shared or texted link to a public page shows (Nov 24, the public pages audit; the
 * owner: "Go but no need for them to be findable on Google").
 *
 * A phone or a chat app builds its preview card from the page's own tags: a title, a line under
 * it, a picture and the site's name. The public pages (/care, /request, /pay/<token>) each say
 * their own, so a customer sees the company and the page, never the staff portal's.
 *
 * How the tags meet the root's (src/routes/__root.tsx): the router lays every matched route's
 * tags end to end and keeps ONE tag for each `name` or `property`, the deepest route's. So a
 * tag written here replaces the root's of the same name. A route cannot take a root tag away,
 * though, which is why the root itself leaves its two builder credits off these routes
 * (`hasOwnSharePreview`).
 *
 * Still kept off search engines: every public route keeps its own `robots: noindex`.
 */

/** The live site. A preview card needs whole addresses, never a path. */
export const PUBLIC_SITE_URL = "https://jbkbid.com";
export const PUBLIC_SITE_NAME = "JBK Commercial Roofing";
/** The company's logo on white, square: public/jbk-icon-512.png. */
export const PUBLIC_SHARE_IMAGE = `${PUBLIC_SITE_URL}/jbk-icon-512.png`;
/** The name under the icon when a visitor adds a public page to a phone's home screen. */
export const PUBLIC_HOME_SCREEN_NAME = "JBK Roofing";

/** The routes that say their own preview card (their ids in the route tree). */
export const PUBLIC_SHARE_ROUTE_IDS: readonly string[] = ["/care", "/request", "/pay/$token"];

/** True when one of the matched routes is a public page with its own preview card. */
export function hasOwnSharePreview(matches: readonly { routeId: string }[]): boolean {
  return matches.some((m) => PUBLIC_SHARE_ROUTE_IDS.includes(m.routeId));
}

export interface ShareMeta {
  name?: string;
  property?: string;
  content: string;
}

/**
 * The preview tags of one public page. `path` is the page's own address on the site ("/care");
 * leave it out for a page whose address must not be written anywhere (a payment link).
 */
export function publicShareMeta(a: {
  title: string;
  description: string;
  path?: string;
}): ShareMeta[] {
  return [
    { name: "description", content: a.description },
    { property: "og:title", content: a.title },
    { property: "og:description", content: a.description },
    { property: "og:type", content: "website" },
    ...(a.path ? [{ property: "og:url", content: `${PUBLIC_SITE_URL}${a.path}` }] : []),
    { property: "og:site_name", content: PUBLIC_SITE_NAME },
    { property: "og:image", content: PUBLIC_SHARE_IMAGE },
    // "summary": a small square picture beside the words, which is what the logo is.
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: a.title },
    { name: "twitter:description", content: a.description },
    { name: "apple-mobile-web-app-title", content: PUBLIC_HOME_SCREEN_NAME },
  ];
}
