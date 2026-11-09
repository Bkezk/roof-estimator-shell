/**
 * The phone drawer shows every page's name (owner, Nov 9: "the names don't show on the nav
 * bar"). The desktop menu's collapsed flag lives in a cookie and used to hide the names in the
 * phone drawer too, once "Collapse menu" had been pressed on a computer.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the phone drawer ignores the desktop collapsed flag", () => {
  const src = readFileSync("src/components/app-sidebar.tsx", "utf8");
  it("collapsed is false on a phone whatever the cookie says", () => {
    expect(src).toContain('const collapsed = !isMobile && state === "collapsed";');
    expect(src).not.toContain('const collapsed = state === "collapsed";');
  });
  it("the names and the group labels still read that one flag", () => {
    expect(src).toContain("{!collapsed && <span>{item.title}</span>}");
    expect(src).toContain("iconMode={collapsed}");
  });
});
