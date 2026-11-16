/**
 * Where the shorter menu's merged entries live (owner, Nov 16: "I like B but I want to keep
 * estimate pricing by the project bids … takeoffs, projects bids, estimate pricing (with the
 * dropdown …), inventory. I think documents may should fall under the setup page as another tab
 * option"). Pure: names, addresses and who sees which tab. The strips that draw them are
 * components/setup-tabs.tsx and components/settings-tabs.tsx; the menu is app-sidebar.tsx.
 *
 * Nothing moved to a new address. Setup's four service tabs are on /setup; Documents keeps
 * /admin/documents and shows Setup's heading and strip, so it is Setup's fifth tab. Users &
 * access and Reminders keep /admin/users and /admin/reminders and are the two tabs of Settings.
 * No access rule changed: the gate (access.ts pageForPath) is as it was.
 */

// ---- Setup ------------------------------------------------------------------------------------

export const SETUP_TAB_TITLES = {
  rates: "Service rates",
  materials: "Material pricing",
  inspection: "Inspection checklist",
  vehicles: "Vehicles & drivers",
  documents: "Documents",
} as const;
export type SetupStripTab = keyof typeof SETUP_TAB_TITLES;
/** The five, in the strip's order. */
export const SETUP_STRIP_TABS = Object.keys(SETUP_TAB_TITLES) as SetupStripTab[];

/** Documents' own address: Setup's fifth tab is this page. */
export const SETUP_DOCUMENTS_PATH = "/admin/documents";

/** Where a tab of the strip lives: the four service tabs on /setup, Documents on its own page. */
export function setupTabHref(tab: SetupStripTab): string {
  if (tab === "documents") return SETUP_DOCUMENTS_PATH;
  return tab === "rates" ? "/setup" : `/setup?tab=${tab}`;
}

/**
 * An address that names a tab which is not on /setup: `/setup?tab=documents` is Documents' own
 * page (Nov 16 audit, fix 26: it showed Service rates). Nothing for the four tabs /setup holds.
 */
export const setupTabElsewhere = (tab: unknown): typeof SETUP_DOCUMENTS_PATH | undefined =>
  tab === "documents" ? SETUP_DOCUMENTS_PATH : undefined;

/** Which of Setup's two pages a strip is drawn on. */
export type SetupStripPage = "setup" | "documents";

/**
 * Does this tab have a panel on that page? Only the four service tabs, and only on /setup. A tab
 * that opens the other page controls nothing here, and must not tell a screen reader it does
 * (Nov 16 audit, fix 25).
 */
export const setupTabHasPanel = (tab: SetupStripTab, page: SetupStripPage): boolean =>
  page === "setup" && tab !== "documents";

/**
 * What a press on the strip leaves in the browser's history entry when it opens Setup's other
 * page. The strip drawn there reads it and puts the keyboard focus on its lit tab: the strip that
 * was pressed is gone with its page, and the focus would be lost (Nov 16 audit, fix 25).
 */
export const SETUP_TAB_PRESSED = { setupTabPressed: true } as const;
declare module "@tanstack/react-router" {
  // What a history entry of this app may carry (the router's own way to type it).
  interface HistoryState {
    setupTabPressed?: boolean;
  }
}
export const cameBySetupTab = (state: unknown): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as Record<string, unknown>)["setupTabPressed"] === true;

/**
 * The tabs a person is shown, in order. The four service tabs are ticket money, an admin's and
 * a manager's (`money`: access.ts managesTickets). Documents is for everyone with Documents
 * access (owner, Nov 10: "Allow office users to have access"), so an office user sees Setup with
 * the Documents tab alone.
 */
export function setupTabsFor(who: { money: boolean; documents: boolean }): SetupStripTab[] {
  return [
    ...(who.money ? (["rates", "materials", "inspection", "vehicles"] as const) : []),
    ...(who.documents ? (["documents"] as const) : []),
  ];
}

/** Where the menu's Setup row goes: /setup for whoever may open it, else straight to Documents. */
export const setupHomeFor = (who: { money: boolean }): string =>
  who.money ? "/setup" : SETUP_DOCUMENTS_PATH;

/**
 * Where someone goes from a page that is closed to them. /setup is an admin's and a manager's,
 * but Setup's Documents tab is for everyone with Documents access: such a person who types
 * /setup belongs on Documents, not on the home page with no word why (Nov 16 audit, fix 26).
 * Every other closed page sends home, as before.
 *
 * The gate that sends people on (components/auth-gate.tsx) calls this.
 */
export function closedPageGoesTo(
  pathname: string,
  who: { documents: boolean },
  home: string,
): string {
  const onSetup = pathname === "/setup" || pathname.startsWith("/setup/");
  return onSetup && who.documents ? SETUP_DOCUMENTS_PATH : home;
}

/** Setup's sentence under the heading, for what this person can open. */
export function setupBlurb(who: { money: boolean; documents: boolean }): string {
  const docs = "the templates documents start from";
  if (!who.money)
    return `What documents are built from: ${docs}, saved snippets and the PDF library.`;
  return (
    "How service work is priced and run: the rates and material prices invoices are built from, " +
    "what an inspection asks about, and who drives each vehicle" +
    (who.documents ? `; and ${docs}.` : ".")
  );
}

// ---- Settings ---------------------------------------------------------------------------------

export const SETTINGS_TABS = [
  { key: "users", label: "Users & access", to: "/admin/users" },
  { key: "reminders", label: "Reminders", to: "/admin/reminders" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** The menu's Settings row opens the first tab and stays lit on every Settings page. */
export const SETTINGS_HOME = SETTINGS_TABS[0].to;
export const isSettingsPath = (pathname: string): boolean =>
  SETTINGS_TABS.some((t) => pathname === t.to || pathname.startsWith(`${t.to}/`));

// ---- Estimate Pricing ---------------------------------------------------------------------------

/**
 * A press on the menu's Estimate Pricing row: what it asked for, and whether a pricing page was
 * showing when it was made.
 */
export type PricingPress = { open: boolean; onPricingPage: boolean };

/**
 * The press that still counts. One made on this side of the pricing pages holds from page to
 * page; walking onto a pricing page, or off them, ends it (Nov 16 audit, fix 24: once pressed,
 * the row stayed open after its pages were left, until a reload). The menu drops an ended press
 * for good, so it cannot come back on a later return.
 */
export const livePricingPress = (
  press: PricingPress | undefined,
  onPricingPage: boolean,
): PricingPress | undefined => (press && press.onPricingPage === onPricingPage ? press : undefined);

/** Is the row open? As last pressed while that press counts; else open on a pricing page only. */
export const pricingOpenFor = (press: PricingPress | undefined, onPricingPage: boolean): boolean =>
  livePricingPress(press, onPricingPage)?.open ?? onPricingPage;
