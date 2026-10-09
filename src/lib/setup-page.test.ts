/**
 * Setup (owner, Oct 5): "change service rates to Setup and move it under the opportunities tab,
 * and also add the vehicles and drivers there and remove it from inventory". One page at /setup
 * with three tabs — Service rates, Inspection checklist, Vehicles & drivers (admins; managers too
 * since Oct 9) — the old
 * /admin/service-rates redirecting to it, the sidebar entry right under Opportunities, the Admin
 * group left to admins, and the Vehicles & drivers card gone from the Inventory page.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pageForPath } from "./access";
import { canOpenPath } from "./work-tile-access";

const read = (p: string) => readFileSync(p, "utf8");
const setup = read("src/routes/setup.tsx");
const old = read("src/routes/admin.service-rates.tsx");
const nav = read("src/components/app-sidebar.tsx");
const inventory = read("src/components/inventory-page.tsx");
const tree = read("src/routeTree.gen.ts");

const admin = { role: "admin", access: [], technician: false } as const;
const manager = { role: "manager", access: [], technician: false } as const;
const rep = { role: "user", access: ["customers", "service"], technician: false } as const;
const tech = { role: "user", access: ["service"], technician: true } as const;

describe("the /setup page", () => {
  it("is a registered route with its tabs, Service rates first", () => {
    expect(tree).toContain("import { Route as SetupRouteImport } from './routes/setup'");
    expect(setup).toContain('createFileRoute("/setup")');
    expect(setup).toMatch(
      /SETUP_TABS = \["rates", "materials", "inspection", "vehicles"\] as const/,
    );
    expect(setup).toContain('<TabsTrigger value="rates"');
    expect(setup).toContain('<TabsTrigger value="materials"');
    expect(setup).toContain('<TabsTrigger value="inspection"');
    expect(setup).toContain('<TabsTrigger value="vehicles"');
    expect(setup).toMatch(/const active: SetupTab = [\s\S]*?\(tab \?\? "rates"\)/);
  });
  it("hosts the three existing cards unchanged — nothing was rewritten", () => {
    expect(setup).toContain("<ServiceRatesSettings />");
    expect(setup).toContain("<InspectionChecklistSettings />");
    expect(setup).toContain("<VehicleDriversCard locations={locationsQ.data ?? []} />");
    // The same cache key as Inventory, so the vehicle list is shared.
    expect(setup).toContain('queryKey: ["inventory-locations"]');
  });
  it("shows Vehicles & drivers to admins and managers (owner, Oct 9; setVehicleDrivers takes both)", () => {
    expect(setup).toMatch(/\{canSetDrivers && \(\s*<TabsTrigger value="vehicles"/);
    expect(setup).toMatch(/\{canSetDrivers && \(\s*<TabsContent value="vehicles"/);
    expect(setup).toContain("const canSetDrivers = seesEveryone(profile);");
    expect(setup).not.toContain("isAdmin");
    // Someone else following an old ?tab=vehicles link lands on the rates, not a blank tab.
    expect(setup).toContain('tab === "vehicles" && !canSetDrivers ? "rates"');
    expect(read("src/lib/inventory.functions.ts")).toMatch(
      /export const setVehicleDrivers[\s\S]*?if \(!seesEveryone\(me\)\) throw new Error\("Forbidden: admins and managers only"\);/,
    );
  });
  it("deep-links its tab with ?tab= and is titled Setup", () => {
    expect(setup).toMatch(
      /validateSearch: \(search: Record<string, unknown>\): \{ tab\?: SetupTab \}/,
    );
    expect(setup).toContain('title: "Setup — JBK Portal"');
    expect(setup).toMatch(/<h1[^>]*>\s*<Settings2[^>]*\/> Setup\s*<\/h1>/);
  });
});

describe("the old address", () => {
  it("/admin/service-rates redirects to /setup and renders nothing of its own", () => {
    expect(old).toContain('createFileRoute("/admin/service-rates")');
    expect(old).toMatch(
      /beforeLoad: \(\) => \{\s*throw redirect\(\{ to: "\/setup", replace: true \}\);/,
    );
    expect(old).not.toContain("component:");
    expect(old).not.toContain("ServiceRatesSettings");
  });
});

describe("who may open it", () => {
  it("admins and managers, as Service Rates was; not reps or technicians", () => {
    expect(pageForPath("/setup")).toBe("manager");
    expect(pageForPath("/setup?tab=vehicles")).toBe("manager");
    expect(canOpenPath(admin, "/setup")).toBe(true);
    expect(canOpenPath(manager, "/setup")).toBe(true);
    expect(canOpenPath(rep, "/setup")).toBe(false);
    expect(canOpenPath(tech, "/setup")).toBe(false);
  });
});

describe("the sidebar", () => {
  it("lists Setup right under Opportunities in the Customers group, for managers and admins", () => {
    const items = nav.slice(
      nav.indexOf("const customerItems"),
      nav.indexOf("const inventoryItems"),
    );
    const opps = items.indexOf('title: "Opportunities"');
    const setupAt = items.indexOf('title: "Setup"');
    expect(opps).toBeGreaterThan(0);
    expect(setupAt).toBeGreaterThan(opps);
    expect(items).toMatch(
      /\{ title: "Setup", url: "\/setup", icon: Settings2, page: null, visible: managesTickets \}/,
    );
    // Nothing follows Setup in that group.
    expect(items.slice(setupAt).match(/title: "/g)).toHaveLength(1);
  });
  it("no longer lists Service Rates, and the Admin group is admins only", () => {
    expect(nav).not.toMatch(/title: "Service Rates"/);
    expect(nav).not.toContain("/admin/service-rates");
    expect(nav).toMatch(/\{role === "admin" && \(\s*<NavGroup label="Admin"/);
    const adminItems = nav.slice(
      nav.indexOf("const adminGroupItems"),
      nav.indexOf("// Admin pages with"),
    );
    expect(adminItems.match(/title: "/g)).toHaveLength(2);
  });
});

describe("the Inventory page", () => {
  it("no longer shows Vehicles & drivers (nor, since Oct 9, the opened-box rule — inventory-tabs.test.ts)", () => {
    expect(inventory).not.toContain("VehicleDriversCard");
    expect(inventory).not.toContain("vehicle-drivers-card");
    expect(inventory).not.toContain("SettingsCard");
  });
});

describe("no user-facing text still says Admin › Service Rates", () => {
  it("the empty-checklist hint points at Setup", () => {
    const section = read("src/components/service/inspection-section.tsx");
    expect(section).not.toContain("Admin › Service Rates");
    expect(section).toContain("Setup › Inspection checklist");
    expect(read("src/lib/access.ts")).not.toContain("(Service Rates)");
  });
});
