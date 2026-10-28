/**
 * The phone's menu drawer closes after a tap on a page link (owner, Oct 28: "if you click a page
 * on the nav bar it doesnt auto collapse the nav bar and it should. that should only effect
 * mobile"). One click handler on the menu's body and footer, not one per link: it closes the
 * drawer when the thing tapped sits inside a link with an address — so a tap on a group heading,
 * a chevron, Sign out or the theme toggle leaves the drawer alone, and a new link added later is
 * covered. Desktop never calls it: the sidebar there is the fixed rail, nothing to close.
 */
export type Tapped = { closest?: (selector: string) => unknown } | null | undefined;

/** Whether the tapped element is a page link (or inside one). */
export const tappedPageLink = (target: Tapped): boolean => !!target?.closest?.("a[href]");

/**
 * The handler: on a phone, a tap on a page link closes the drawer. Returns what it did so the
 * test can see it.
 */
export function closeDrawerAfterLink(
  isMobile: boolean,
  target: Tapped,
  setOpenMobile: (open: boolean) => void,
): boolean {
  if (!isMobile || !tappedPageLink(target)) return false;
  setOpenMobile(false);
  return true;
}
