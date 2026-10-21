/**
 * The Owner section (owner, Oct 21: "owner should be its own tab"): a sidebar item of its own,
 * admins only, with two tabs — Team (the Owner view that lived on Work Overview until today, moved
 * as it was) and Margin (the margin report; a placeholder until it lands). Work Overview keeps the
 * List and the Calendar; an old link to /my-work?view=owner is sent on to /owner, and a
 * remembered "owner" view on a profile or in the browser reads as the List. The same day the
 * Admin group of the sidebar lost its CenterPoint import entry (the page stays, by address).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pageForPath } from "@/lib/access";
import { parseViewParam } from "@/lib/my-work";
import { OWNER_TABS, parseOwnerTab } from "@/lib/owner-page";
import { myWorkHref } from "@/lib/owner-view";
import { defaultWorkLayout, landingSearch, normalizeWorkLayout } from "@/lib/work-layout";

// A file the move adds reads as empty until it exists, so every pin reports on its own.
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("access: /owner is an admin page, like Admin › Users", () => {
  it("pageForPath", () => {
    expect(pageForPath("/owner")).toBe("admin");
    expect(pageForPath("/owner?tab=margin")).toBe("admin");
    expect(pageForPath("/admin/users")).toBe("admin");
    // The CenterPoint import left the menu, not the address book (owner, Oct 21: "keep the code").
    expect(pageForPath("/admin/centerpoint-import")).toBe("admin");
    // Work Overview stays everyone's.
    expect(pageForPath("/my-work")).toBeNull();
  });
});

describe("the ?tab= of /owner", () => {
  it("people and business; the old names land; anything else, or nothing, is People (Oct 21)", () => {
    expect(OWNER_TABS).toEqual(["people", "business"]);
    expect(parseOwnerTab("people")).toBe("people");
    expect(parseOwnerTab("business")).toBe("business");
    // The first cut's names (Team | Margin), kept as aliases for bookmarks.
    expect(parseOwnerTab("team")).toBe("people");
    expect(parseOwnerTab("margin")).toBe("business");
    expect(parseOwnerTab(undefined)).toBe("people");
    expect(parseOwnerTab(1)).toBe("people");
  });
});

describe("a remembered or linked 'owner' view on Work Overview reads as the List", () => {
  it("normalizeWorkLayout drops it (profiles.work_layout / localStorage from before Oct 21)", () => {
    expect(normalizeWorkLayout({ view: "owner" })).not.toHaveProperty("view");
    expect(normalizeWorkLayout({ view: "owner", who: "mine" })).toEqual({
      ...defaultWorkLayout(),
      who: "mine",
    });
    // The two views still work.
    expect(normalizeWorkLayout({ view: "calendar" }).view).toBe("calendar");
    expect(normalizeWorkLayout({ view: "list" })).not.toHaveProperty("view");
  });
  it("landingSearch: ?view=owner is not a view of Work Overview — the remembered one applies", () => {
    expect(landingSearch(null, { view: "owner" })).toEqual({ view: "list", who: null });
    expect(landingSearch({ view: "calendar" }, { view: "owner" }).view).toBe("calendar");
    expect(landingSearch(normalizeWorkLayout({ view: "owner" }), {}).view).toBe("list");
  });
  it("parseViewParam still reads 'owner' off the URL, so the route can send the old link on", () => {
    expect(parseViewParam("owner")).toBe("owner");
    expect(parseViewParam("list")).toBe("list");
    expect(parseViewParam("calendar")).toBe("calendar");
    expect(parseViewParam("kanban")).toBeUndefined();
  });
});

describe("source: the /owner route", () => {
  const path = "src/routes/owner.tsx";
  it("exists, takes ?tab=, and sends a signed-in non-admin to Work Overview", () => {
    expect(existsSync(path)).toBe(true);
    const route = read(path);
    expect(route).toContain('createFileRoute("/owner")');
    expect(route).toContain('parseOwnerTab(s["tab"])');
    expect(route).toContain("tab?: OwnerTab;");
    expect(route).toMatch(
      /if \(profile && !isAdmin\(profile\)\) return <Navigate to="\/my-work" replace \/>;/,
    );
    expect(route).toContain("component: OwnerRoute");
    expect(route).toContain("<OwnerPage");
  });
  it("is in the generated route tree", () => {
    expect(read("src/routeTree.gen.ts")).toContain("'/owner'");
  });
});

describe("source: the Owner page", () => {
  const page = read("src/components/owner-page.tsx");
  it("h1 Owner with an icon, the People | Business strip (Oct 21: no Team wrapper, no Margin tab), the tab in the URL", () => {
    expect(page).toMatch(/<Crown className="h-6 w-6" \/> Owner\s*<\/h1>/);
    expect(page).toMatch(/aria-pressed=\{tab === "people"\}/);
    expect(page).toMatch(/aria-pressed=\{tab === "business"\}/);
    expect(page).toContain('onClick={() => props.onTab("people")}');
    expect(page).toContain('onClick={() => props.onTab("business")}');
    expect(page).toMatch(/>\s*People\s*<\/Button>/);
    expect(page).toMatch(/>\s*Business\s*<\/Button>/);
    expect(page.match(/aria-pressed=/g)).toHaveLength(2);
    expect(page).not.toMatch(/>\s*Team\s*<\/Button>/);
    expect(page).not.toMatch(/>\s*Margin\s*<\/Button>/);
  });
  it("People renders the Owner view under its line; Business the tiles with the margin report under them", () => {
    expect(page).toContain('import { OwnerView } from "@/components/owner-view";');
    expect(page).toContain('import { OwnerBusiness } from "@/components/owner-business";');
    expect(page).toContain('import { MarginReport } from "@/components/margin-report";');
    expect(page).toMatch(
      /tab === "people" \? \(\s*<>\s*<p className="text-sm text-muted-foreground">\s*Everyone: what is due today, what is overdue, what got done this week\.\s*<\/p>\s*<OwnerView \/>\s*<\/>\s*\) : \(/,
    );
    const biz = page.slice(page.indexOf('tab === "people" ? ('));
    expect(biz.indexOf("<OwnerBusiness />")).toBeGreaterThan(0);
    expect(biz.indexOf("<MarginReport />")).toBeGreaterThan(biz.indexOf("<OwnerBusiness />"));
    // The Owner view no longer carries its own People / Business toggle.
    const view = read("src/components/owner-view.tsx");
    expect(view).not.toContain('useState<"people" | "business">');
    expect(view).not.toContain("<OwnerBusiness />");
  });
});

describe("source: the sidebar", () => {
  const nav = read("src/components/app-sidebar.tsx");
  const adminItems = nav.slice(
    nav.indexOf("const adminGroupItems"),
    nav.indexOf("// Admin pages with"),
  );
  it("the Admin group reads Owner, Users & access, Reminders — admins only", () => {
    expect(adminItems).toMatch(
      /\{ title: "Owner", url: "\/owner", icon: Crown, adminOnly: true \},\s*\{ title: "Users & access", url: "\/admin\/users", icon: Users, adminOnly: true \},\s*\{ title: "Reminders", url: "\/admin\/reminders", icon: BellRing, adminOnly: true \},/,
    );
    expect(adminItems.match(/title: "/g)).toHaveLength(3);
    // The group itself renders for admins only, and so does every item in it.
    expect(nav).toMatch(/\{role === "admin" && \(\s*<NavGroup label="Admin"/);
    expect(nav).toContain('.filter((item) => !item.adminOnly || role === "admin")');
    // Owner is not a second item under Work Overview.
    expect(nav.match(/"\/owner"/g)).toHaveLength(1);
  });
  it("no CenterPoint import entry in the nav; its route and access rule stay", () => {
    expect(nav).not.toContain("/admin/centerpoint-import");
    expect(nav).not.toContain("Import from CenterPoint");
    expect(existsSync("src/routes/admin.centerpoint-import.tsx")).toBe(true);
    expect(read("src/lib/access.ts")).toContain('pathname.startsWith("/admin/centerpoint-import")');
  });
});

describe("source: Work Overview without the Owner view", () => {
  const page = read("src/components/my-work-page.tsx");
  const route = read("src/routes/my-work.tsx");
  it("the page has no Owner toggle, no owner branches, no OwnerView", () => {
    expect(page).not.toContain('"owner"');
    expect(page).not.toContain("> Owner");
    expect(page).not.toContain("ownerToggle");
    expect(page).not.toContain("OwnerView");
    expect(page).not.toContain("effectiveView");
    expect(page).not.toContain("Everyone: what is due today");
    // List and Calendar stay.
    expect(page).toContain('onClick={() => changeView("list")}');
    expect(page).toContain('onClick={() => changeView("calendar")}');
    expect(page.match(/changeView\("/g)).toHaveLength(2);
  });
  it("the route sends ?view=owner on: /owner (People) for an admin, the List for anyone else", () => {
    // Once the profile is here (an admin's bookmark must not be dropped before the role is known).
    expect(route).toMatch(
      /if \(view === "owner" && profile\)\s*return isAdmin\(profile\) \? \(\s*<Navigate to="\/owner" search=\{\{\}\} replace \/>\s*\) : \(\s*<Navigate\s+to="\/my-work"\s+search=\{\{[\s\S]*?\}\}\s+replace\s*\/>\s*\);/,
    );
    // Meanwhile the page never sees "owner": the List (or the remembered Calendar).
    expect(route).toContain(
      'const pageView: WorkViewParam | null = view === "owner" ? null : (view ?? null);',
    );
    expect(route).toContain("view={pageView}");
  });
  it("the work-layout view type is list | calendar", () => {
    const wl = read("src/lib/work-layout.ts");
    expect(wl).toContain('export type WorkViewName = "list" | "calendar";');
    expect(wl).toContain(
      'const isView = (v: unknown): v is WorkViewName => v === "list" || v === "calendar";',
    );
    const mw = read("src/lib/my-work.ts");
    expect(mw).toContain('export type WorkViewParam = "list" | "calendar";');
    expect(mw).toContain('export type WorkViewUrl = WorkViewParam | "owner";');
  });
});

describe("the Owner view's own links back into Work Overview are untouched", () => {
  it("myWorkHref stays /my-work?view=list&who=…&bucket=…", () => {
    expect(myWorkHref("id1", "today")).toEqual({
      to: "/my-work",
      search: { view: "list", who: "id1", bucket: "today" },
    });
    expect(myWorkHref("all", "overdue").search).toEqual({
      view: "list",
      who: "all",
      bucket: "overdue",
    });
  });
});
