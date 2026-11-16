/**
 * The shorter menu (owner, Nov 16). Measured before: 29 rows for an admin, and on a laptop
 * screen about 300 px of the menu sat below the bottom edge — the whole Admin group. The owner
 * picked option B with changes: "I like B but I want to keep estimate pricing by the project
 * bids because those are closely related. I'd like to to be takeoffs, projects bids, estimate
 * pricing (with the dropdown as proposed in option B), inventory. I think documents may should
 * fall under the setup page as another tab option".
 *
 * So: Estimate = Takeoffs, Project Bids, Estimate Pricing (opens in place), Inventory. Admin =
 * Owner, Settings (Users & access and Reminders are its two tabs). Documents is Setup's fifth
 * tab. Sign out sits beside My account. No page changed its address and no access rule changed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canOpenPage, hasDocumentsAccess, managesTickets, pageForPath } from "@/lib/access";
import {
  SETTINGS_HOME,
  SETTINGS_TABS,
  SETUP_DOCUMENTS_PATH,
  SETUP_TAB_TITLES,
  isSettingsPath,
  setupBlurb,
  setupHomeFor,
  setupTabHref,
  setupTabsFor,
} from "@/lib/menu-places";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const nav = flat("src/components/app-sidebar.tsx");

const admin = { role: "admin", access: [], technician: true } as const;
const manager = { role: "manager", access: [], technician: false } as const;
const office = {
  role: "user",
  access: ["customers", "service", "invoices"],
  technician: false,
} as const;
const estimator = {
  role: "user",
  access: ["estimate", "pricing", "takeoff"],
  technician: false,
} as const;
const tech = { role: "user", access: ["service"], technician: true } as const;

describe("Estimate: Takeoffs, Project Bids, Estimate Pricing, Inventory", () => {
  const group = nav.slice(
    nav.indexOf('<NavGroup label="Estimate"'),
    nav.indexOf("{/* Admins only (Nov 16)"),
  );
  it("holds the four in the owner's order, each behind its own access", () => {
    const takeoffs = nav.indexOf('title: "Takeoffs"');
    const bids = nav.indexOf('title: "Project Bids"');
    expect(takeoffs).toBeGreaterThan(0);
    expect(bids).toBeGreaterThan(takeoffs);
    const rows = group.indexOf("{estimatorItems");
    const pricing = group.indexOf('{can("pricing") &&');
    const inventory = group.indexOf('{can("inventory") && inventoryRows}');
    expect(rows).toBeGreaterThan(0);
    expect(pricing).toBeGreaterThan(rows);
    expect(inventory).toBeGreaterThan(pricing);
    expect(group).toContain(".filter((item) => can(item.page))");
  });
  it("has no Estimate Pricing group and no Inventory group of their own any more", () => {
    expect(nav).not.toContain('<NavGroup label="Estimate Pricing"');
    expect(nav).not.toContain('<NavGroup label="Inventory"');
    expect(nav.match(/<NavGroup /g)).toHaveLength(4); // Customers, Prospecting, Estimate, Admin
  });
  it("Estimate Pricing is one row that opens in place to the five pages, with their own lists", () => {
    expect(group).toContain('<SidebarMenuItem data-nav="estimate-pricing">');
    expect(group).toContain(
      "<Collapsible asChild open={pricingOpen} onOpenChange={setPricingOpen}>",
    );
    expect(group).toContain("<span>Estimate Pricing</span>");
    expect(group).toContain("{pricingRows}");
    // The five rows are the ones the group held, sub-lists and all.
    for (const t of [
      "General",
      "Advanced Labor",
      "Duro-Last Pricing",
      "Non Duro-Last Pricing",
      "Price List Import",
    ])
      expect(nav).toContain(`title: "${t}"`);
    expect(nav).toContain("const pricingRows = ( <> {adminItems.map((item) =>");
    expect(nav).toContain("<SidebarMenuSub>");
  });
  it("starts shut, opens on a pricing page, and a press wins for the rest of the visit", () => {
    expect(nav).toContain("const onPricingPage = isPricingPath(pathname);");
    expect(nav).toContain("const pricingOpen = pricingPressed ?? onPricingPage;");
    expect(nav).toContain("useState<boolean | undefined>(undefined)");
    // Shut on a pricing page, the row itself is lit so the place is not lost.
    expect(group).toContain("isActive={onPricingPage && !pricingOpen}");
  });
  it("the icon-only menu shows the five pricing pages as icons (no room for a dropdown)", () => {
    expect(group).toMatch(/\{can\("pricing"\) && \(collapsed \? \( \/\/[^<]*pricingRows \) : \(/);
  });
  it("someone with Inventory and none of the estimate pages gets it as a plain row", () => {
    expect(nav).toContain('{can("estimate") || can("takeoff") || can("pricing") ? (');
    expect(group).toMatch(
      /\) : \( can\("inventory"\) && \( <SidebarGroup> <SidebarMenu>\{inventoryRows\}<\/SidebarMenu> <\/SidebarGroup> \) \)\}/,
    );
  });
});

describe("Admin: Owner and Settings", () => {
  it("Settings is one row for Users & access and Reminders, lit on both", () => {
    expect(SETTINGS_TABS.map((t) => [t.label, t.to])).toEqual([
      ["Users & access", "/admin/users"],
      ["Reminders", "/admin/reminders"],
    ]);
    expect(SETTINGS_HOME).toBe("/admin/users");
    expect(isSettingsPath("/admin/users")).toBe(true);
    expect(isSettingsPath("/admin/reminders")).toBe(true);
    for (const p of ["/admin/settings", "/admin/documents", "/owner", "/admin/users-old", "/setup"])
      expect(isSettingsPath(p)).toBe(false);
  });
  it("each of the two pages shows the Settings strip with its own tab lit", () => {
    expect(flat("src/routes/admin.users.tsx")).toContain('<SettingsTabs active="users" />');
    expect(flat("src/routes/admin.reminders.tsx")).toContain('<SettingsTabs active="reminders" />');
    const strip = flat("src/components/settings-tabs.tsx");
    expect(strip).toContain("{SETTINGS_TABS.map((t) => {");
    expect(strip).toContain("aria-selected={on}");
    expect(strip).toContain("to={t.to}");
  });
  it("both pages are still an admin's alone at the gate", () => {
    expect(pageForPath("/admin/users")).toBe("admin");
    expect(pageForPath("/admin/reminders")).toBe("admin");
    expect(pageForPath("/owner")).toBe("admin");
    for (const p of [manager, office, estimator, tech]) expect(canOpenPage(p, "admin")).toBe(false);
    expect(canOpenPage(admin, "admin")).toBe(true);
  });
});

describe("Documents is Setup's fifth tab", () => {
  it("the strip: four service tabs for an admin or a manager, Documents for everyone with Documents access", () => {
    expect(setupTabsFor({ money: true, documents: true })).toEqual([
      "rates",
      "materials",
      "inspection",
      "vehicles",
      "documents",
    ]);
    expect(setupTabsFor({ money: false, documents: true })).toEqual(["documents"]);
    expect(setupTabsFor({ money: false, documents: false })).toEqual([]);
    expect(SETUP_TAB_TITLES.documents).toBe("Documents");
  });
  it("every tab keeps the address it had", () => {
    expect(SETUP_DOCUMENTS_PATH).toBe("/admin/documents");
    expect(setupTabHref("rates")).toBe("/setup");
    expect(setupTabHref("materials")).toBe("/setup?tab=materials");
    expect(setupTabHref("vehicles")).toBe("/setup?tab=vehicles");
    expect(setupTabHref("documents")).toBe("/admin/documents");
  });
  it("the menu's Setup row sends a manager to /setup and an office user straight to Documents", () => {
    expect(setupHomeFor({ money: managesTickets(admin) })).toBe("/setup");
    expect(setupHomeFor({ money: managesTickets(manager) })).toBe("/setup");
    expect(setupHomeFor({ money: managesTickets(office) })).toBe("/admin/documents");
    expect(setupHomeFor({ money: managesTickets(estimator) })).toBe("/admin/documents");
    // The row shows to exactly the people who may open Documents; a technician never sees it.
    for (const p of [admin, manager, office, estimator]) expect(hasDocumentsAccess(p)).toBe(true);
    expect(hasDocumentsAccess(tech)).toBe(false);
  });
  it("no access rule moved: /setup is a manager's, Documents is Documents access", () => {
    expect(pageForPath("/setup")).toBe("manager");
    expect(pageForPath("/admin/documents")).toBe("documents");
    expect(canOpenPage(office, "manager")).toBe(false);
    expect(canOpenPage(estimator, "manager")).toBe(false);
    expect(canOpenPage(tech, "manager")).toBe(false);
    expect(canOpenPage(office, "documents")).toBe(true);
    expect(canOpenPage(tech, "documents")).toBe(false);
  });
  it("the Documents page wears Setup's heading and strip, Documents lit; a service tab opens /setup", () => {
    const docs = flat("src/routes/admin.documents.tsx");
    expect(docs).toContain("<SetupHeading money={money} documents />");
    expect(docs).toContain('<Tabs value="documents"');
    expect(docs).toContain("<SetupTabsList money={money} documents />");
    expect(docs).toContain("const money = managesTickets(profile);");
    expect(docs).toContain("router.navigate({ href: setupTabHref(v as SetupStripTab) })");
    // Its own three tabs are as they were.
    expect(docs).toContain('<TabsTrigger value="templates">Templates</TabsTrigger>');
    expect(docs).toContain('createFileRoute("/admin/documents")');
  });
  it("on /setup, the Documents tab leaves for the Documents page (and so asks about unsaved edits)", () => {
    const setup = flat("src/routes/setup.tsx");
    expect(setup).toContain(
      'v === "documents" ? void router.navigate({ to: SETUP_DOCUMENTS_PATH })',
    );
    expect(setup).toContain("const canDocuments = hasDocumentsAccess(profile);");
  });
  it("says what the person can open under the heading", () => {
    expect(setupBlurb({ money: true, documents: true })).toBe(
      "How service work is priced and run: the rates and material prices invoices are built from, what an inspection asks about, and who drives each vehicle; and the templates documents start from.",
    );
    expect(setupBlurb({ money: false, documents: true })).toBe(
      "What documents are built from: the templates documents start from, saved snippets and the PDF library.",
    );
  });
});

describe("the bottom of the menu", () => {
  const foot = nav.slice(nav.indexOf("<SidebarFooter"));
  it("Sign out sits beside My account, as words", () => {
    expect(foot).toContain('data-nav="sign-out"');
    expect(foot).toMatch(/<LogOut className="h-4 w-4" aria-hidden \/> Sign out <\/button>/);
    expect(foot.indexOf('data-nav="sign-out"')).toBeGreaterThan(foot.indexOf('to="/account"'));
    expect(foot.indexOf('data-nav="sign-out"')).toBeLessThan(foot.indexOf("Collapse menu"));
    expect(foot).toContain("onClick={handleSignOut}");
  });
  it("the icon-only menu keeps Sign out as its own icon", () => {
    expect(foot).toMatch(
      /\{collapsed && \( <SidebarMenuItem> <SidebarMenuButton onClick=\{handleSignOut\} tooltip="Sign out">/,
    );
  });
});
