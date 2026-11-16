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

/** Documents' own address: Setup's fifth tab is this page. */
export const SETUP_DOCUMENTS_PATH = "/admin/documents";

/** Where a tab of the strip lives: the four service tabs on /setup, Documents on its own page. */
export function setupTabHref(tab: SetupStripTab): string {
  if (tab === "documents") return SETUP_DOCUMENTS_PATH;
  return tab === "rates" ? "/setup" : `/setup?tab=${tab}`;
}

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
