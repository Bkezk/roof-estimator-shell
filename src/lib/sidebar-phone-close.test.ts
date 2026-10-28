/**
 * Owner, Oct 28: "on mobile if you click a page on the nav bar it doesnt auto collapse the nav
 * bar and it should. that should only effect mobile". The drawer (ui/sidebar.tsx: a Sheet when
 * useIsMobile) closes after a tap on a page link; desktop is untouched.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { closeDrawerAfterLink, tappedPageLink } from "@/lib/sidebar-phone-close";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/** A fake element: `closest` answers whether it sits inside a link with an address. */
const el = (insideLink: boolean) => ({
  closest: (sel: string) => (sel === "a[href]" && insideLink ? {} : null),
});

describe("tappedPageLink", () => {
  it("true inside a link with an address, false elsewhere", () => {
    expect(tappedPageLink(el(true))).toBe(true);
    expect(tappedPageLink(el(false))).toBe(false);
    expect(tappedPageLink(null)).toBe(false);
    expect(tappedPageLink(undefined)).toBe(false);
    expect(tappedPageLink({})).toBe(false);
  });
});

describe("closeDrawerAfterLink", () => {
  it("on a phone, a tap on a page link closes the drawer", () => {
    const set = vi.fn();
    expect(closeDrawerAfterLink(true, el(true), set)).toBe(true);
    expect(set).toHaveBeenCalledWith(false);
  });
  it("on a phone, a tap on anything else (a heading, a chevron, Sign out, the theme toggle) leaves it open", () => {
    const set = vi.fn();
    expect(closeDrawerAfterLink(true, el(false), set)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
  it("on a desktop nothing happens — only the phone's drawer is affected", () => {
    const set = vi.fn();
    expect(closeDrawerAfterLink(false, el(true), set)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("the sidebar wires it on the menu body and the footer (one handler, every link)", () => {
  const sidebar = read("src/components/app-sidebar.tsx");
  it("reads isMobile and setOpenMobile from the sidebar hook and hands the tapped element over", () => {
    expect(sidebar).toContain(
      "const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();",
    );
    expect(sidebar).toContain("closeDrawerAfterLink(isMobile, e.target as Tapped, setOpenMobile)");
    expect(sidebar).toContain("<SidebarContent onClick={onMenuClick}>");
    expect(sidebar).toContain("<SidebarFooter onClick={onMenuClick}>");
  });
  it("the phone drawer is the Sheet driven by openMobile (ui/sidebar.tsx), so setOpenMobile(false) closes it", () => {
    const ui = read("src/components/ui/sidebar.tsx");
    expect(ui).toContain("<Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>");
  });
});
