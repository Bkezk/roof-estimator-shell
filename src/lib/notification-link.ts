/**
 * Where a notification may lead (security audit, Nov 14).
 *
 * A notification's link was followed as written. A signed-in person could write a notification
 * to anyone, so a link that was a script ran in the reader's page, and a link to another site
 * took the reader there. Proven on the published site on Nov 14.
 *
 * The rule, in three places that agree: the database refuses the row
 * (migration 20261114190000), the screens show no link for it, and a click never leaves the
 * site. A link is a page of this site and nothing else: one "/" first, never "//" or "/\"
 * (browsers read both as another site), and no backslash or control character anywhere
 * (browsers drop tabs and line breaks from an address, so "/<tab>/evil" is "//evil").
 *
 * Pure. Tested in notification-link-nov14b.test.ts.
 */
/** Is `url` a page of this site, by the rule above? */
export function isNotificationPath(url: string): boolean {
  if (url[0] !== "/") return false;
  if (url[1] === "/") return false;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    // A backslash, or a control character (0 to 31, and 127).
    if (c === 92 || c < 32 || c === 127) return false;
  }
  return true;
}

/** The same rule as the database's check, as its regular expression source. */
export const NOTIFICATION_LINK_SQL = "^/([^/\\\\[:cntrl:]][^\\\\[:cntrl:]]*)?$";

/** The link to follow, or null when the notification has none or it is not a page of this site. */
export function notificationPath(url: string | null | undefined): string | null {
  return typeof url === "string" && isNotificationPath(url) ? url : null;
}
