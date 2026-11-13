/**
 * Owner, Nov 13: "the work overview page that opened was a tad zoomed in" (iOS zooms in when a
 * small-type box is tapped and stays zoomed: lib/ios-viewport.ts) and "it's coming through as
 * bidomatic still … 'bid-o-matic test notification from jbk portal' that's way too much" (the
 * test notice's own words; the phone adds "from JBK Portal" itself).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { IOS_MAX_SCALE, isIosDevice, lockIosFocusZoom, withMaxScale } from "@/lib/ios-viewport";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const VIEWPORT = "width=device-width, initial-scale=1, interactive-widget=resizes-content";

describe("no zoom-in when a box is tapped on an iPhone", () => {
  it("adds the stop once and keeps the rest of the tag", () => {
    expect(withMaxScale(VIEWPORT)).toBe(`${VIEWPORT}, ${IOS_MAX_SCALE}`);
    expect(withMaxScale(withMaxScale(VIEWPORT))).toBe(`${VIEWPORT}, ${IOS_MAX_SCALE}`);
    expect(withMaxScale("width=device-width, maximum-scale=5")).toBe(
      "width=device-width, maximum-scale=5",
    );
    expect(withMaxScale("")).toBe(IOS_MAX_SCALE);
    expect(withMaxScale(null)).toBe(IOS_MAX_SCALE);
  });

  it("is for iPhones and iPads only (Android keeps its pinch-zoom)", () => {
    const nav = (userAgent: string, platform = "", maxTouchPoints = 0) => ({
      userAgent,
      platform,
      maxTouchPoints,
    });
    expect(isIosDevice(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)"))).toBe(true);
    expect(isIosDevice(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5))).toBe(
      true,
    );
    expect(isIosDevice(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0))).toBe(
      false,
    );
    expect(isIosDevice(nav("Mozilla/5.0 (Linux; Android 15; Pixel 9)", "Linux armv81", 5))).toBe(
      false,
    );
  });

  it("every viewport tag on the page is set, on an iPhone only", () => {
    const run = (userAgent: string, platform: string, maxTouchPoints: number) => {
      const metas = [{ content: VIEWPORT }, { content: VIEWPORT }];
      vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints });
      vi.stubGlobal("document", { querySelectorAll: () => metas });
      try {
        lockIosFocusZoom();
        lockIosFocusZoom();
      } finally {
        vi.unstubAllGlobals();
      }
      return metas.map((m) => m.content);
    };
    expect(run("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)", "iPhone", 5)).toEqual([
      `${VIEWPORT}, ${IOS_MAX_SCALE}`,
      `${VIEWPORT}, ${IOS_MAX_SCALE}`,
    ]);
    expect(run("Mozilla/5.0 (Linux; Android 15; Pixel 9)", "Linux armv81", 5)).toEqual([
      VIEWPORT,
      VIEWPORT,
    ]);
  });

  it("the root component applies it after hydration and on each route change, with no head script", () => {
    const root = flat("src/routes/__root.tsx");
    expect(root).toContain("useEffect(() => lockIosFocusZoom(), [pathname]);");
    // A head script changed the tag before hydration, and a second, unchanged tag then won.
    expect(root).not.toContain("IOS_VIEWPORT_BOOT_SCRIPT");
    // The tag itself is unchanged for everyone else.
    expect(root).toContain(`content: "${VIEWPORT}",`);
  });
});

describe("the test notification is short and carries no old name", () => {
  const fns = flat("src/lib/followups.functions.ts");
  it('says "Test notification" and one short line', () => {
    expect(fns).toContain('title: "Test notification", body: "Notifications are working.",');
  });
  it("nothing a person reads says Bid-O-Matic any more", () => {
    expect(fns).not.toMatch(/title: "[^"]*Bid-O-Matic/);
    expect(flat("src/lib/notify.server.ts")).toContain('"JBK Portal <onboarding@resend.dev>"');
    expect(flat("src/lib/notify.server.ts")).not.toContain('"Bid-O-Matic <');
    expect(flat("public/sw.js")).toContain('? data.title : "JBK Portal"');
  });
});
