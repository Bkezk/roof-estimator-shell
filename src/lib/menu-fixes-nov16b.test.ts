/**
 * Five leftovers of the shorter menu (owner, Nov 16; the audit's fixes 23 to 27). The menu change
 * itself is pinned in menu-shorter-nov16.test.ts.
 *
 *  23. On-screen text still named the old places ("Admin › Reminders", "Templates are under
 *      Admin"). Each now names the place as the menu has it.
 *  24. The Estimate Pricing dropdown stayed open after its pages were left, until a reload.
 *  25. On Setup's tab strip the arrow keys changed page, and on the Documents page the tabs said
 *      they controlled panels that are not there.
 *  26. /setup?tab=documents showed Service rates; and someone with Documents but not the money
 *      tabs who typed /setup was sent home.
 *  27. The Estimate Pricing chevron moved sideways when the row opened; General and Settings
 *      shared the gear; the Settings strip marked plain links as tabs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SetupTabsList } from "@/components/setup-tabs";
import { Tabs } from "@/components/ui/tabs";
import { hasDocumentsAccess, homeFor, managesTickets } from "@/lib/access";
import {
  SETTINGS_TABS,
  SETUP_DOCUMENTS_PATH,
  SETUP_STRIP_TABS,
  SETUP_TAB_PRESSED,
  SETUP_TAB_TITLES,
  cameBySetupTab,
  closedPageGoesTo,
  livePricingPress,
  pricingOpenFor,
  setupTabElsewhere,
  setupTabHasPanel,
  type PricingPress,
} from "@/lib/menu-places";
import { shouldBlockLeaving } from "@/lib/setup-forms";
import { cn } from "@/lib/utils";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const nav = flat("src/components/app-sidebar.tsx");

const admin = { role: "admin", access: [], technician: true } as const;
const manager = { role: "manager", access: [], technician: false } as const;
const office = {
  role: "user",
  access: ["customers", "service", "invoices"],
  technician: false,
} as const;
const tech = { role: "user", access: ["service"], technician: true } as const;

// ---- 23 -----------------------------------------------------------------------------------------

describe("23. on-screen text names each place as the menu has it now", () => {
  // The places, read from the menu and the tab titles rather than typed again here.
  const label = (key: (typeof SETTINGS_TABS)[number]["key"]) =>
    SETTINGS_TABS.find((t) => t.key === key)!.label;
  const USERS = `Admin › Settings › ${label("users")}`;
  const REMINDERS = `Admin › Settings › ${label("reminders")}`;
  const DOCUMENTS = `Setup › ${SETUP_TAB_TITLES.documents}`;
  const RATES = `Setup › ${SETUP_TAB_TITLES.rates}`;
  const GENERAL = "Estimate Pricing › General";
  const jsx = (s: string) => s.replace(/&/g, "&amp;");

  it("the places are real: the menu's groups, rows and tabs carry these names", () => {
    expect(USERS).toBe("Admin › Settings › Users & access");
    expect(REMINDERS).toBe("Admin › Settings › Reminders");
    expect(DOCUMENTS).toBe("Setup › Documents");
    expect(RATES).toBe("Setup › Service rates");
    expect(nav).toContain('<NavGroup label="Admin" id="admin"');
    expect(nav).toContain('{ title: "Settings", url: SETTINGS_HOME,');
    expect(nav).toContain('title: "Setup", url: "/setup",');
    // General is the first row under Estimate Pricing (/admin/settings). Setup has no such tab.
    expect(nav).toContain("<span>Estimate Pricing</span>");
    expect(nav).toMatch(
      /const adminItems: [^=]*= \[ \{ title: "General", url: "\/admin\/settings",/,
    );
    expect(Object.values(SETUP_TAB_TITLES)).not.toContain("General");
  });

  it("templates: Setup › Documents", () => {
    const page = flat("src/routes/documents.tsx");
    expect(page).toContain(`Templates are under ${DOCUMENTS}.`);
    expect(page).not.toContain("Templates are under Admin.");
    const report = read("src/lib/documents/inspection-report.ts");
    expect(report).toContain(`template (${DOCUMENTS})\`;`);
    expect(report).not.toContain("template (Admin › Documents)");
  });

  it("the unassigned timer: Admin › Settings › Reminders", () => {
    const work = read("src/lib/my-work.ts");
    expect(work).toContain(`they turn red after the number of days set on ${REMINDERS}.",`);
    expect(work).not.toContain("days set on Admin › Reminders.");
  });

  it("users: Admin › Settings › Users & access", () => {
    expect(flat("src/routes/account.tsx")).toContain(
      `An admin changes names, roles and pages under ${jsx(USERS)}.`,
    );
    expect(flat("src/components/service-rates-settings.tsx")).toContain(
      `else their default bill rate (${USERS}), else`,
    );
    expect(flat("src/components/service/board-page.tsx")).toContain(
      `An admin marks people as technicians on ${jsx(USERS)}.`,
    );
    const door = read("src/lib/restore-door.server.ts");
    expect(door).toContain(
      `"a first-admin password was already set this run; set the rest from ${USERS}",`,
    );
    expect(door).toContain(
      `"the project already has an admin: sign in as them and set passwords from ${USERS}",`,
    );
  });

  it("the rate table: Setup › Service rates", () => {
    const users = read("src/routes/admin.users.tsx");
    expect(users).toContain(`Blank here: the rate table (${RATES}; tech rate as the lead,`);
    expect(users).not.toContain("Admin › Service rates");
  });

  it("the sales tax defaults: Estimate Pricing › General", () => {
    const estimate = read("src/routes/estimate.tsx");
    expect(estimate).toContain(`? "Using ${GENERAL} defaults for this bid."`);
    expect(estimate).toContain(`: "Bid-level override (${GENERAL} is the default)."}`);
    expect(estimate).not.toContain("Admin › General");
  });

  it("no on-screen line anywhere in src still names a place straight under Admin", () => {
    // Every line that is not a comment. "Admin ›" may only be followed by "Settings ›" (the one
    // row of the Admin group that has places inside it).
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== "routeTree.gen.ts"
            ? [join(dir, e.name)]
            : [],
      );
    const stale: string[] = [];
    for (const file of files("src"))
      read(file)
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line)) return;
          if (/Admin ›(?! Settings ›)/.test(line) || /under Admin\b(?! ›)/.test(line))
            stale.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    expect(stale).toEqual([]);
  });
});

// ---- 24 -----------------------------------------------------------------------------------------

describe("24. Estimate Pricing shuts when its pages are left", () => {
  type Step = { go: "pricing" | "elsewhere" } | { press: "open" | "shut" };
  /** Walks a visit that starts off the pricing pages; says whether the row is open after each step. */
  const visit = (steps: Step[]): boolean[] => {
    let on = false;
    let press: PricingPress | undefined;
    return steps.map((s) => {
      if ("go" in s) {
        on = s.go === "pricing";
        press = livePricingPress(press, on); // what the menu keeps after the page change
      } else press = { open: s.press === "open", onPricingPage: on };
      return pricingOpenFor(press, on);
    });
  };

  it("starts shut, opens by itself on a pricing page, shuts by itself on the way out", () => {
    expect(pricingOpenFor(undefined, false)).toBe(false);
    expect(visit([{ go: "pricing" }, { go: "elsewhere" }, { go: "pricing" }])).toEqual([
      true,
      false,
      true,
    ]);
  });
  it("opened by hand, then a pricing page, then away: it shuts (it used to stay open until a reload)", () => {
    expect(
      visit([{ press: "open" }, { go: "pricing" }, { go: "elsewhere" }, { go: "elsewhere" }]),
    ).toEqual([true, true, false, false]);
  });
  it("a press still opens or shuts it by hand, and holds from page to page on the same side", () => {
    expect(visit([{ press: "open" }, { go: "elsewhere" }, { press: "shut" }])).toEqual([
      true,
      true,
      false,
    ]);
    expect(
      visit([{ go: "pricing" }, { press: "shut" }, { go: "pricing" }, { press: "open" }]),
    ).toEqual([true, false, false, true]);
  });
  it("shut by hand on a pricing page: away and back, it is open again by itself", () => {
    expect(
      visit([{ go: "pricing" }, { press: "shut" }, { go: "elsewhere" }, { go: "pricing" }]),
    ).toEqual([true, false, false, true]);
  });
  it("a press does not come back to life on a later return to its side", () => {
    // Opened by hand off the pricing pages, through a pricing page and out: shut, and it stays
    // shut on the next page too.
    const press: PricingPress = { open: true, onPricingPage: false };
    expect(livePricingPress(press, false)).toBe(press);
    expect(livePricingPress(press, true)).toBeUndefined();
    expect(livePricingPress(undefined, true)).toBeUndefined();
  });
  it("the menu uses it: the press is dropped when the visitor crosses over", () => {
    expect(nav).toContain(
      "const [pricingPress, setPricingPress] = useState<PricingPress | undefined>(undefined);",
    );
    expect(nav).toContain("const livePress = livePricingPress(pricingPress, onPricingPage);");
    expect(nav).toContain("if (pricingPress && !livePress) setPricingPress(undefined);");
    expect(nav).toContain("const pricingOpen = pricingOpenFor(livePress, onPricingPage);");
    expect(nav).toContain("onOpenChange={(open) => setPricingPress({ open, onPricingPage })}");
    expect(nav).not.toContain("pricingPressed ?? onPricingPage");
  });
});

// ---- 25 -----------------------------------------------------------------------------------------

describe("25. Setup's tab strip: arrow keys only move the highlight", () => {
  const setup = flat("src/routes/setup.tsx");
  const docs = flat("src/routes/admin.documents.tsx");
  const strip = flat("src/components/setup-tabs.tsx");
  const draw = (page: "setup" | "documents", value: string) =>
    renderToStaticMarkup(
      createElement(
        Tabs,
        { value, activationMode: "manual" },
        createElement(SetupTabsList, { money: true, documents: true, page }),
      ),
    );
  const tabs = (html: string) => html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];

  it("both pages turn off open-on-arrow: Enter, Space or a click opens a tab", () => {
    expect(setup).toContain('<Tabs value={active} activationMode="manual"');
    expect(docs).toContain('<Tabs value="documents" activationMode="manual"');
  });
  it("only the four service tabs have a panel, and only on /setup", () => {
    expect(SETUP_STRIP_TABS.filter((t) => setupTabHasPanel(t, "setup"))).toEqual([
      "rates",
      "materials",
      "inspection",
      "vehicles",
    ]);
    expect(SETUP_STRIP_TABS.filter((t) => setupTabHasPanel(t, "documents"))).toEqual([]);
  });
  it("on the Documents page no tab says it controls a panel", () => {
    const html = draw("documents", "documents");
    // Six since Nov 23: QR pages is the sixth tab, on a page of its own like Documents.
    expect(tabs(html)).toHaveLength(6);
    expect(html).not.toContain("aria-controls");
    expect(html).toMatch(/<button[^>]*aria-selected="true"[^>]*>(<svg.*?<\/svg>)? ?Documents/);
  });
  it("on /setup the four service tabs do, and Documents (another page) does not", () => {
    const drawn = tabs(draw("setup", "rates"));
    expect(drawn).toHaveLength(6);
    expect(drawn.filter((t) => t.includes("aria-controls="))).toHaveLength(4);
    expect(drawn[5]).not.toContain("aria-controls");
    expect(drawn[5]).toContain("-trigger-qr");
    expect(drawn[4]).not.toContain("aria-controls");
    expect(drawn[4]).toContain("-trigger-documents");
  });
  it("a tab opened on the other page takes the keyboard focus there", () => {
    expect(SETUP_TAB_PRESSED).toEqual({ setupTabPressed: true });
    expect(cameBySetupTab(SETUP_TAB_PRESSED)).toBe(true);
    expect(cameBySetupTab({ ...SETUP_TAB_PRESSED, __TSR_index: 3, key: "k" })).toBe(true);
    for (const s of [undefined, null, {}, { __TSR_index: 0 }, { setupTabPressed: "yes" }, "x"])
      expect(cameBySetupTab(s)).toBe(false);
    // Each page says so when it opens the other from the strip, and reads it on arrival.
    expect(setup).toContain(
      "void router.navigate({ to: SETUP_DOCUMENTS_PATH, state: SETUP_TAB_PRESSED })",
    );
    expect(docs).toContain(
      "void router.navigate({ href: setupTabHref(v as SetupStripTab), state: SETUP_TAB_PRESSED, });",
    );
    for (const page of [setup, docs]) {
      expect(page).toContain("useRouterState({ select: (s) => cameBySetupTab(s.location.state) })");
      expect(page).toContain("takeFocus={arrivedByTab}");
    }
    expect(strip).toContain("if (!takeFocus) return;");
    expect(strip).toContain(
      `list.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();`,
    );
  });
  it("leaving /setup for Documents with unsaved edits still asks first", () => {
    // Still a page change through the router, which the blocker hears.
    expect(setup).toContain('v === "documents" ? void router.navigate({ to: SETUP_DOCUMENTS_PATH,');
    expect(setup).toContain(
      "shouldBlockFn: ({ next }) => shouldBlockLeaving(next.pathname, dirtyRef.current),",
    );
    expect(shouldBlockLeaving(SETUP_DOCUMENTS_PATH, true)).toBe(true);
    expect(shouldBlockLeaving(SETUP_DOCUMENTS_PATH, false)).toBe(false);
    expect(shouldBlockLeaving("/setup", true)).toBe(false);
  });
});

// ---- 26 -----------------------------------------------------------------------------------------

describe("26. the Documents tab by address", () => {
  const setup = flat("src/routes/setup.tsx");

  it("/setup?tab=documents opens Documents' own page", () => {
    expect(setupTabElsewhere("documents")).toBe("/admin/documents");
    for (const t of ["rates", "materials", "inspection", "vehicles", undefined, "bogus", 5])
      expect(setupTabElsewhere(t)).toBeUndefined();
    // The route keeps the value long enough to send it on, before the page is drawn.
    expect(setup).toContain('const tab = knownTab(search["tab"], SETUP_STRIP_TABS);');
    expect(setup).toContain(
      "beforeLoad: ({ search }) => { const elsewhere = setupTabElsewhere(search.tab); if (elsewhere) throw redirect({ to: elsewhere, replace: true }); },",
    );
    // Nov 23: QR pages joined the strip, with an address of its own as Documents has.
    expect(setupTabElsewhere("qr")).toBe("/setup/qr");
    expect(SETUP_STRIP_TABS).toEqual([
      "rates",
      "materials",
      "inspection",
      "vehicles",
      "documents",
      "qr",
    ]);
  });

  it("someone with Documents but not the money tabs goes from /setup to Documents, not home", () => {
    const who = (p: Parameters<typeof hasDocumentsAccess>[0]) => ({
      documents: hasDocumentsAccess(p),
    });
    expect(managesTickets(office)).toBe(false);
    expect(closedPageGoesTo("/setup", who(office), homeFor(office))).toBe("/admin/documents");
    // A technician has neither: home, as before. So has anyone whose profile did not load.
    expect(closedPageGoesTo("/setup", who(tech), homeFor(tech))).toBe("/service/today");
    expect(closedPageGoesTo("/setup", who(null), homeFor(null))).toBe("/my-work");
    // Every other closed page still sends home.
    for (const path of ["/admin/users", "/owner", "/admin/settings", "/setup-old", "/customers"])
      expect(closedPageGoesTo(path, who(office), homeFor(office))).toBe("/my-work");
    // (An admin or a manager is never blocked there; were they, Documents is theirs too.)
    for (const p of [admin, manager]) expect(who(p).documents).toBe(true);
  });
  it("the gate sends a blocked visitor to closedPageGoesTo(pathname, …, home)", () => {
    const gate = readFileSync("src/components/auth-gate.tsx", "utf8");
    expect(gate).toContain(
      "const closedTo = closedPageGoesTo(pathname, { documents: hasDocumentsAccess(profile) }, home);",
    );
    expect(gate).toMatch(/else if \(session && blocked\) \{[^}]*navigate\(\{ to: closedTo \}\);/);
    expect(gate).not.toMatch(/blocked\) \{\s*navigate\(\{ to: home \}\)/);
  });
});

// ---- 27 -----------------------------------------------------------------------------------------

describe("27. three tidy-ups", () => {
  it("a. the Estimate Pricing chevron keeps its place, open or shut", () => {
    // Open, the row holds the five pages' own carets, and the menu's button then keeps 32 px
    // free on its right for a caret of its own. This row has none there: it keeps the 8 px.
    const base = /sidebarMenuButtonVariants = cva\(\s*"([^"]+)"/.exec(
      read("src/components/ui/sidebar.tsx"),
    )![1]!;
    expect(base).toContain("group-has-[[data-sidebar=menu-action]]/menu-item:pr-8");
    expect(base.split(" ")).toContain("p-2");
    const row = nav.slice(
      nav.indexOf('<SidebarMenuItem data-nav="estimate-pricing">'),
      nav.indexOf("<span>Estimate Pricing</span>"),
    );
    const own = /<SidebarMenuButton [^>]*className="([^"]+)"/.exec(row)?.[1] ?? "";
    const classes = cn(base, own).split(" ");
    expect(classes).not.toContain("group-has-[[data-sidebar=menu-action]]/menu-item:pr-8");
    expect(classes).toContain("group-has-[[data-sidebar=menu-action]]/menu-item:pr-2");
    // The chevron itself is as it was: pushed to the right edge, turning when open.
    expect(nav).toContain(
      'className={`ml-auto h-4 w-4 transition-transform ${pricingOpen ? "rotate-90" : ""}`}',
    );
  });

  it("b. General has its own icon; Settings keeps the gear", () => {
    const icon = (title: string) =>
      new RegExp(`title: "${title}", url: [^,]+, icon: (\\w+)`).exec(nav)![1];
    expect(icon("Settings")).toBe("Settings");
    expect(icon("General")).not.toBe("Settings");
    expect(icon("General")).toBe("SlidersVertical");
    // No other row of the menu wears General's icon, nor the gear.
    for (const name of ["SlidersVertical", "Settings"])
      expect(nav.match(new RegExp(`icon: ${name}[, ]`, "g"))).toHaveLength(1);
  });

  it("c. the Settings strip is navigation: links, the current one marked as the page", () => {
    const strip = flat("src/components/settings-tabs.tsx");
    expect(strip).toContain(
      '<nav className="inline-flex flex-wrap rounded-md border p-0.5" aria-label="Settings">',
    );
    expect(strip).toContain('aria-current={on ? "page" : undefined}');
    expect(strip).not.toContain("role=");
    expect(strip).not.toContain("aria-selected");
    // The look and the hook are as they were.
    expect(strip).toContain('<div className="space-y-2" data-settings-tabs>');
    expect(strip).toContain('on ? "bg-primary text-primary-foreground" : "hover:bg-muted"');
    expect(strip).toContain("to={t.to}");
  });
});
