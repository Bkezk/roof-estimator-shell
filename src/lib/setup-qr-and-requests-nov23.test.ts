/**
 * Nov 23, the owner: "currently the QR pages are not located under the setup tab and we need to
 * find somewhere else for the public requests."
 *
 *  - QR pages is Setup's sixth tab, on a page of its own as Documents is the fifth. Its address
 *    did not change, /setup?tab=qr goes there, and its menu row is gone.
 *  - The list of requests from the public pages moved to /opportunities/requests. Its menu row
 *    is gone too: a "Public requests" button on the Opportunities page opens it and carries the
 *    number waiting. The old address sends people on. Who may open it has not changed.
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

import { fakeSupabase } from "@/test/fake-supabase";
import { canAccess, pageForPath } from "@/lib/access";
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
  publicRequestsButtonWords,
} from "@/lib/public-requests";
import { countWaitingPublicRequests, PUBLIC_REQUESTS_NEED } from "@/lib/public-requests.functions";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const run = (fn: unknown, db: unknown, userId: string) =>
  (fn as (a: unknown) => Promise<unknown>)({ data: undefined, context: { supabase: db, userId } });

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

describe("Public requests live with Opportunities", () => {
  it("the new address, and the old one sends people on", () => {
    expect(PUBLIC_REQUESTS_PATH).toBe("/opportunities/requests");
    expect(PUBLIC_REQUESTS_OLD_PATH).toBe("/customers/requests");
    expect(flat("src/routes/opportunities_.requests.tsx")).toContain(
      'createFileRoute("/opportunities_/requests")',
    );
    const old = flat("src/routes/customers_.requests.tsx");
    expect(old).toContain('createFileRoute("/customers_/requests")');
    expect(old).toContain("throw redirect({ to: PUBLIC_REQUESTS_PATH, replace: true });");
    const tree = read("src/routeTree.gen.ts");
    expect(tree).toContain("'/opportunities/requests'");
    expect(tree).toContain("'/customers/requests'");
    // Never an address a rule could take for the public /request page.
    expect(PUBLIC_REQUESTS_PATH.startsWith(PUBLIC_REQUEST_PATH)).toBe(false);
  });
  it("who may open it has not changed: Customers access, though Opportunities is open to all", () => {
    expect(pageForPath("/opportunities")).toBeNull();
    expect(pageForPath("/opportunities/requests")).toBe("customers");
    expect(pageForPath("/opportunities/requests/")).toBe("customers");
    // Only that address: an opportunity whose address merely starts the same is not caught.
    expect(pageForPath("/opportunities/requests-old")).toBeNull();
    expect(pageForPath("/customers/requests")).toBe("customers");
  });
  it("the menu has no Public requests row; Opportunities is lit on the new address", () => {
    const side = read("src/components/app-sidebar.tsx");
    expect(side).not.toContain('title: "Public requests"');
    expect(side).not.toContain("PUBLIC_REQUESTS_PATH");
    expect(side).toContain(
      '{ title: "Customers", url: "/customers", icon: Contact, page: "customers" },',
    );
    expect(side).toContain('url: "/opportunities"');
    expect(PUBLIC_REQUESTS_PATH.startsWith("/opportunities/")).toBe(true);
  });
  it("the button's words carry the number waiting", () => {
    expect(publicRequestsButtonWords(0)).toBe("Public requests");
    expect(publicRequestsButtonWords(2)).toBe("Public requests (2)");
    expect(publicRequestsButtonWords(null)).toBe("Public requests");
    expect(publicRequestsButtonWords(undefined)).toBe("Public requests");
    expect(publicRequestsButtonWords(-3)).toBe("Public requests");
    expect(publicRequestsButtonWords(2.9)).toBe("Public requests (2)");
  });
  it("the Opportunities page always draws it for those who may handle requests, and for nobody else", () => {
    const opps = flat("src/components/opportunities-page.tsx");
    // Not inside the New opportunity rule: it shows whether or not the person may add one.
    expect(opps).toContain(
      '<div className="flex flex-wrap items-center gap-2"> <PublicRequestsButton /> {canCreate && (',
    );
    const btn = flat("src/components/public-requests-page.tsx");
    expect(btn).toContain('const may = canAccess(profile, "customers");');
    // No call is made for anyone else, so nobody sees an error for a page that is not theirs.
    expect(btn).toContain("enabled: !!session && may,");
    expect(btn).toContain("if (!may) return null;");
    expect(btn).toContain("to={PUBLIC_REQUESTS_PATH}");
    expect(btn).toContain("{publicRequestsButtonWords(waiting)}");
    // Coloured only when something waits.
    expect(btn).toMatch(/waiting > 0 \? "border-amber-500 bg-amber-400 text-black/);
  });
  it("the list page's own links follow", () => {
    const page = flat("src/routes/opportunities_.requests.tsx");
    expect(page).toContain('to="/opportunities"');
    expect(page).toContain("to={PUBLIC_SETUP_PATH}");
    expect(page).toContain("{managesTickets(profile) && (");
  });
});

describe("the number on the button", () => {
  const people = [
    { id: "u1", role: "user", access: ["customers"], technician: false, full_name: "Olga Office" },
    { id: "u3", role: "user", access: ["service"], technician: true, full_name: "Tom Tech" },
    { id: "a1", role: "admin", access: [], technician: false, full_name: "Ann Admin" },
  ];
  const rows = [
    { id: "r1", reference: "R-4010", status: "new" },
    { id: "r2", reference: "R-4011", status: "new" },
    { id: "r3", reference: "R-4009", status: "matched" },
    { id: "r4", reference: "R-4008", status: "dismissed" },
  ];
  it("counts the requests still waiting, and writes nothing", async () => {
    const env = fakeSupabase({ public_requests: rows, profiles: people });
    expect(await run(countWaitingPublicRequests, env.db, "u1")).toEqual({ waiting: 2 });
    expect(await run(countWaitingPublicRequests, env.db, "a1")).toEqual({ waiting: 2 });
    expect(env.writes).toEqual([]);
  });
  it("none waiting is 0", async () => {
    const env = fakeSupabase({ public_requests: rows.slice(2), profiles: people });
    expect(await run(countWaitingPublicRequests, env.db, "u1")).toEqual({ waiting: 0 });
  });
  it("someone without Customers access is told no number", async () => {
    const env = fakeSupabase({ public_requests: rows, profiles: people });
    expect(canAccess(people[1] as never, "customers")).toBe(false);
    expect(canAccess(people[0] as never, "customers")).toBe(true);
    expect(PUBLIC_REQUESTS_NEED).toBe("Requests from the public pages need Customers access");
    await expect(run(countWaitingPublicRequests, env.db, "u3")).rejects.toThrow(
      PUBLIC_REQUESTS_NEED,
    );
    expect(env.writes).toEqual([]);
  });
});

describe("the words on paper follow the move", () => {
  it("the records say Opportunities › Public requests, and Setup › QR pages", () => {
    for (const p of ["docs/qa/public-forms-2026-11-21.md", "docs/roof-care-plans.md"]) {
      const doc = read(p);
      expect(doc, p).not.toContain("Customers › Public requests");
      expect(doc, p).toContain("Opportunities › Public requests");
    }
  });
});
