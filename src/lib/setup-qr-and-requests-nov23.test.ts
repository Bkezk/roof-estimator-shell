/**
 * Nov 23, the owner: "currently the QR pages are not located under the setup tab and we need to
 * find somewhere else for the public requests."
 *
 *  - QR pages is Setup's sixth tab, on a page of its own as Documents is the fifth. Its address
 *    did not change, /setup?tab=qr goes there, and its menu row is gone.
 *  - The list of requests from the public pages moved to /opportunities/requests, behind a
 *    "Public requests" button on the Opportunities page.
 *
 * Later on Nov 23, the owner chose "option A": every request becomes an opportunity the moment
 * it is sent. So the list, its button and the number on it are gone, and both of the list's
 * addresses send people on to Opportunities (public-requests-opportunities-nov23.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  notify: async () => 1,
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
  appUrl: () => "",
}));

import { pageForPath } from "@/lib/access";
import {
  SETUP_QR_PATH,
  SETUP_STRIP_TABS,
  SETUP_TAB_TITLES,
  setupTabElsewhere,
  setupTabHasPanel,
  setupTabHref,
  setupTabsFor,
} from "@/lib/menu-places";
import { PUBLIC_REQUEST_PATH } from "@/lib/public-forms";
import {
  PUBLIC_REQUESTS_OLD_PATH,
  PUBLIC_REQUESTS_PATH,
  PUBLIC_SETUP_PATH,
} from "@/lib/public-requests";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

describe("QR pages is a tab of Setup", () => {
  it("the strip ends with QR pages, for the people who see the four service tabs", () => {
    expect(SETUP_TAB_TITLES.qr).toBe("QR pages");
    expect(SETUP_STRIP_TABS[SETUP_STRIP_TABS.length - 1]).toBe("qr");
    expect(setupTabsFor({ money: true, documents: true })).toEqual([
      "rates",
      "materials",
      "inspection",
      "vehicles",
      "documents",
      "qr",
    ]);
    // Office staff with Documents only still see one tab, and it is not this one.
    expect(setupTabsFor({ money: false, documents: true })).toEqual(["documents"]);
    expect(setupTabsFor({ money: true, documents: false })).toEqual([
      "rates",
      "materials",
      "inspection",
      "vehicles",
      "qr",
    ]);
  });
  it("it keeps its address, and /setup?tab=qr goes there", () => {
    expect(SETUP_QR_PATH).toBe("/setup/qr");
    expect(setupTabHref("qr")).toBe("/setup/qr");
    expect(setupTabElsewhere("qr")).toBe("/setup/qr");
    expect(PUBLIC_SETUP_PATH).toBe("/setup/qr");
    // A page of its own: on /setup the tab opens no panel, and on its own page no tab does.
    expect(setupTabHasPanel("qr", "setup")).toBe(false);
    expect(SETUP_STRIP_TABS.filter((t) => setupTabHasPanel(t, "qr"))).toEqual([]);
    // Still a manager's and an admin's page.
    expect(pageForPath("/setup/qr")).toBe("manager");
  });
  it("its page draws Setup's heading and strip with QR pages lit", () => {
    const page = flat("src/routes/setup_.qr.tsx");
    expect(page).toContain('createFileRoute("/setup_/qr")');
    expect(page).toContain("<SetupHeading money documents={documents} />");
    expect(page).toContain('value="qr"');
    expect(page).toContain(
      '<SetupTabsList money documents={documents} page="qr" takeFocus={arrivedByTab} />',
    );
    expect(page).toContain(
      'if (v !== "qr") void router.navigate({ href: setupTabHref(v as SetupStripTab), state: SETUP_TAB_PRESSED, });',
    );
    expect(page).toContain("<PublicFormsSetup />");
  });
  it("on /setup a press on the tab opens that page, and it carries no unsaved dot", () => {
    const setup = flat("src/routes/setup.tsx");
    expect(setup).toContain(
      "void router.navigate({ to: SETUP_QR_PATH, state: SETUP_TAB_PRESSED })",
    );
    expect(setup).toContain('dot={(t) => (t === "documents" || t === "qr" ? null : dot(t))}');
    expect(read("src/components/setup-tabs.tsx")).toContain("qr: QrCode,");
  });
  it("the menu has no QR pages row: Setup is lit on it, since its address starts with /setup", () => {
    const side = read("src/components/app-sidebar.tsx");
    expect(side).not.toContain('title: "QR pages"');
    expect(side).not.toContain("PUBLIC_SETUP_PATH");
    expect(SETUP_QR_PATH.startsWith("/setup/")).toBe(true);
    // The Setup row no longer steps aside for it.
    expect(side).not.toMatch(/title: "Setup",[^}]*except:/);
  });
});

describe("the list of public requests is gone: every request is an opportunity", () => {
  it("both of the list's addresses send people on to Opportunities", () => {
    expect(PUBLIC_REQUESTS_PATH).toBe("/opportunities/requests");
    expect(PUBLIC_REQUESTS_OLD_PATH).toBe("/customers/requests");
    for (const [file, route] of [
      ["src/routes/opportunities_.requests.tsx", "/opportunities_/requests"],
      ["src/routes/customers_.requests.tsx", "/customers_/requests"],
    ] as const) {
      const page = flat(file);
      expect(page, file).toContain(`createFileRoute("${route}")`);
      expect(page, file).toContain('throw redirect({ to: "/opportunities", replace: true });');
      // No list is drawn at either address any more.
      expect(page, file).not.toContain("PublicRequestsPage");
    }
    const tree = read("src/routeTree.gen.ts");
    expect(tree).toContain("'/opportunities/requests'");
    expect(tree).toContain("'/customers/requests'");
    // Never an address a rule could take for the public /request page.
    expect(PUBLIC_REQUESTS_PATH.startsWith(PUBLIC_REQUEST_PATH)).toBe(false);
  });
  it("Opportunities is open to every signed-in person, the old list's address with it", () => {
    expect(pageForPath("/opportunities")).toBeNull();
    // It only sends people on now. What the customer typed is shown on the opportunity to
    // Customers access alone, by the server (getOpportunityRequest).
    expect(pageForPath("/opportunities/requests")).toBeNull();
    expect(pageForPath("/customers/requests")).toBe("customers");
  });
  it("the menu has no Public requests row, and the Opportunities page no button for a list", () => {
    const side = read("src/components/app-sidebar.tsx");
    expect(side).not.toContain('title: "Public requests"');
    expect(side).not.toContain("PUBLIC_REQUESTS_PATH");
    expect(side).toContain(
      '{ title: "Customers", url: "/customers", icon: Contact, page: "customers" },',
    );
    expect(side).toContain('url: "/opportunities"');
    const opps = read("src/components/opportunities-page.tsx");
    expect(opps).not.toContain("PublicRequestsButton");
    expect(opps).not.toContain("public-requests-page");
    const lib = read("src/lib/public-requests.functions.ts");
    expect(lib).not.toContain("countWaitingPublicRequests");
    expect(lib).not.toContain("listPublicRequests");
  });
  it("the QR page's link to Setup is still a manager's", () => {
    expect(PUBLIC_SETUP_PATH).toBe(SETUP_QR_PATH);
  });
});

describe("the words on paper follow the move", () => {
  it("the records say requests are opportunities, and Setup › QR pages", () => {
    for (const p of ["docs/qa/public-forms-2026-11-21.md", "docs/roof-care-plans.md"]) {
      const doc = flat(p);
      expect(doc, p).not.toContain("Customers › Public requests");
      expect(doc, p).toContain("becomes an opportunity");
      expect(doc, p).toContain("Setup › QR pages");
    }
  });
});
