/**
 * Per-page access (owner, 2026-09-23). An admin manages users and can reach everything; every
 * other user is granted any combination of pages. Someone with Estimate access is listed as an
 * estimator on the Setup step; without Inventory they cannot open Inventory, and so on.
 *
 * Roles (owner, 2026-09-30: "users should only see their own stuff except for managers who see
 * everything"):
 * - admin: every page, plus the Admin pages (users, reminders) and Setup.
 * - manager: every page, Estimate Pricing included (owner, Oct 1), and Setup (service rates,
 *   inspection checklist), but not Users or Reminders; sees everyone's tickets, tasks and follow-ups (also when ticked
 *   Technician); creates and dispatches tickets and owns their money (`managesTickets`).
 * - user: only the pages in `access`; a Technician user sees and edits only their own tickets.
 *
 * `profiles.role` is 'admin' | 'manager' | 'user'; `profiles.access` is the granted pages (empty
 * for admins and managers). Enforcement is RLS (`public.has_access(page)`, `public.is_admin()`,
 * `public.is_manager()`) plus the checks inside every server function; the gate and the sidebar
 * only mirror it. Work Overview (/my-work) is every signed-in user's landing page.
 */
export const PAGES = [
  "estimate",
  "pricing",
  "inventory",
  "prospect",
  "takeoff",
  "service",
  "customers",
  "invoices",
] as const;
export type Page = (typeof PAGES)[number];

export const PAGE_LABELS: Record<Page, string> = {
  estimate: "Estimate",
  pricing: "Estimate Pricing",
  inventory: "Inventory",
  prospect: "Prospecting",
  takeoff: "Takeoff",
  service: "Service",
  customers: "Customers",
  invoices: "Invoices",
};

export const PAGE_HELP: Record<Page, string> = {
  estimate: "Project Bids and the estimator — and listed as an estimator on Setup",
  pricing: "Labor, Duro-Last and Non-DL pricing, price list import",
  inventory: "Stock ledger — every signed-in user has it (owner, Oct 1)",
  prospect: "Buildings, roofs and tasks — the territory roof database",
  takeoff: "Measure plan sheets and aerial screenshots; create a bid from the drawing",
  service:
    "Service tickets (repairs): create, assign and close them; log material used off a vehicle",
  customers: "The customer hub: accounts, properties and contacts that bids and tickets link to",
  invoices:
    "Sees and edits invoices (every change is logged). Lives under Service, so it brings Service with it",
};

/**
 * The four kinds of people (owner, Oct 8: "we need technician who cant see the pricing of anything
 * but can see inventory and the tickets assigned to them. we have office who has access to
 * everything as its currently set up, including the technician tick and then manager then owner.
 * those are really the only 4"). Admin › Users shows ONE picker; underneath, each kind is a
 * (role, access, technician) shape the security rules already key on:
 *   owner      → role admin
 *   manager    → role manager
 *   office     → role user with every page (Project Bids, Estimate Pricing, Customers, Service,
 *                Invoices, Prospecting, Takeoff; Inventory is everyone's)
 *   technician → role user with Service only and the Technician tick: Inventory, their own
 *                tickets, and no price anywhere (the technician price-free rules).
 * Owner, manager and office may also be ticked Technician (on the board, assignable).
 */
export const USER_KINDS = ["owner", "manager", "office", "technician"] as const;
export type UserKind = (typeof USER_KINDS)[number];

export const KIND_LABELS: Record<UserKind, string> = {
  owner: "Owner",
  manager: "Manager",
  office: "Office",
  technician: "Technician",
};

export const KIND_HELP: Record<UserKind, string> = {
  owner: "Everything, plus Users & access and Reminders",
  manager:
    "Everything but Users and Reminders; sees everyone's tickets, creates and dispatches them and sets their prices",
  office:
    "Project Bids, Estimate Pricing, Customers, Service, Invoices, Prospecting, Takeoff and Inventory; sees every ticket, runs none of their money",
  technician: "Inventory and the tickets assigned to them; no prices anywhere",
};

export const OFFICE_PAGES: readonly Page[] = [
  "estimate",
  "pricing",
  "customers",
  "service",
  "invoices",
  "prospect",
  "takeoff",
];
export const TECHNICIAN_PAGES: readonly Page[] = ["service"];

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const norm = (xs: readonly string[]) =>
    [...new Set(xs.filter((x) => !(EVERYONE_PAGES as readonly string[]).includes(x)))].sort();
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * Which kind a stored profile is; "custom" for a plain user whose pages match neither Office nor
 * Technician (rows saved under the old per-page ticks). The picker shows "Custom" for those until
 * one of the four is chosen.
 */
export function kindOf(p: AccessLike | null | undefined): UserKind | "custom" {
  if (!p) return "custom";
  if (p.role === "admin") return "owner";
  if (p.role === "manager") return "manager";
  const access = p.access ?? [];
  if (p.technician && sameSet(access, TECHNICIAN_PAGES)) return "technician";
  if (sameSet(access, OFFICE_PAGES)) return "office";
  return "custom";
}

/** The (role, access, technician) a kind saves as; `technician` is the extra tick on the other three. */
export function shapeForKind(
  kind: UserKind,
  technician: boolean,
): { role: Role; access: Page[]; technician: boolean } {
  switch (kind) {
    case "owner":
      return { role: "admin", access: [], technician };
    case "manager":
      return { role: "manager", access: [], technician };
    case "office":
      return { role: "user", access: [...OFFICE_PAGES], technician };
    case "technician":
      return { role: "user", access: [...TECHNICIAN_PAGES], technician: true };
  }
}

/**
 * The pages a tick brings with it: a Technician needs Service to see the tickets they are
 * assigned (dispatch-access.ts), and Invoices sits under Service. Applied on every change on
 * Admin › Users, so neither "technician without Service" nor "invoices without Service" can be
 * saved from the screen (the Oct 6 amber warning stays for rows saved before this).
 */
export function impliedAccess(access: readonly Page[], technician: boolean): Page[] {
  const out = [...access];
  if ((technician || out.includes("invoices")) && !out.includes("service")) out.push("service");
  return out;
}

export const ROLES = ["admin", "manager", "user"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  user: "User",
};

export const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, plus Users & access",
  manager:
    "Sees everyone's tickets, tasks and customers; creates and dispatches tickets and sets their prices (Setup); Estimate Pricing; no Users or Reminders pages",
  user: "Only the pages ticked below; a technician sees only their own tickets",
};

/** A stored role string as a Role (anything unknown is a plain user). */
export const normalizeRole = (v: unknown): Role => (v === "admin" || v === "manager" ? v : "user");

export interface AccessLike {
  role: string | null | undefined;
  access?: readonly string[] | null | undefined;
  /** Marked as a technician: appears on the board, can be assigned tickets and vehicles. */
  technician?: boolean | null | undefined;
}

/**
 * Admins and managers reach every page; others only the pages granted (Estimate Pricing is one
 * of them: anyone with the tick sees it — owner, Oct 1). The twin of `public.has_access(page)`.
 */
/** Pages every signed-in user has without a tick (owner, Oct 1: "all should have access to inventory"). */
export const EVERYONE_PAGES: readonly Page[] = ["inventory"];

export const canAccess = (p: AccessLike | null | undefined, page: Page): boolean =>
  !!p &&
  (p.role === "admin" ||
    p.role === "manager" ||
    EVERYONE_PAGES.includes(page) ||
    (p.access ?? []).includes(page));

export const isAdmin = (p: AccessLike | null | undefined): boolean => p?.role === "admin";

export const isManager = (p: AccessLike | null | undefined): boolean => p?.role === "manager";

/** Admins and managers see everyone's tickets, tasks and follow-ups (Work Overview's "Show" picker). */
export const seesEveryone = (p: AccessLike | null | undefined): boolean =>
  isAdmin(p) || isManager(p);

/**
 * The office: sees every ticket (visibility only — creating, dispatching and money are
 * `managesTickets`). Everyone except a technician-only user (`isFieldOnly`: that technician
 * sees and edits only their own tickets). The twin of RLS
 * `not is_technician() or is_admin() or is_manager()`.
 */
export const isOffice = (p: AccessLike | null | undefined): boolean => !!p && !isFieldOnly(p);

/** The pages a technician-only user may hold: Service, and Inventory (everyone's). */
const FIELD_PAGES: readonly string[] = ["service", "inventory"];

/**
 * A technician-only user (owner, Oct 8: "can office keep full visibility even when ticked
 * technician"): a plain user ticked Technician whose pages go no further than Service and
 * Inventory. An office person, a manager or an owner ticked Technician is on the board and can
 * be assigned, but sees and reads everything their kind does. The twin of
 * `public.is_technician()` (20261008190000).
 */
export const isFieldOnly = (p: AccessLike | null | undefined): boolean =>
  !!p &&
  p.role === "user" &&
  !!p.technician &&
  (p.access ?? []).every((a) => FIELD_PAGES.includes(a));

/**
 * Who can take unassigned work for themselves (owner, Oct 8: "they should be able to go in and
 * claim it if need be"): anyone ticked Technician who is not technician-only (an office person,
 * a manager or an owner on the board) with Service access — the people who see the unassigned
 * list. A technician-only user never sees an unassigned ticket, so there is nothing to claim.
 */
export const canClaim = (p: AccessLike | null | undefined): boolean =>
  !!p && !!p.technician && isOffice(p) && canAccess(p, "service");

export const CLAIM_NEEDS_TICK = "Claiming is for people ticked Technician who see every ticket";
export const CLAIM_TAKEN = "Someone already has it";

/**
 * Who runs the tickets and their money: admins and managers only (owner, Oct 1: "only the
 * managers / admins can see and edit the prices on invoices / repairs / inspections etc."; "The
 * manager creates the tickets; reps do not create tickets, the reps are just responding to what
 * is assigned to them."; "the per-technician charge is separate from estimate pricing and can be
 * edited per job"). Creating a ticket, dispatching it (technician, crew, the Board), every price
 * on a ticket (crew $/hour, invoices, repair template prices, the Setup page) and
 * deleting a ticket. `isOffice` stays for visibility only (who sees every ticket). Estimate
 * Pricing is not this: it stays `canAccess(p, "pricing")`. The twin of RLS
 * `public.is_admin() or public.is_manager()`.
 */
export const managesTickets = (p: AccessLike | null | undefined): boolean => seesEveryone(p);

/**
 * A plain user with the Invoices tick (owner, Oct 8: "we dont really have PM or sales roles").
 * Until then this was a hidden rule — a plain user, not ticked Technician, with Estimate access
 * counted as "sales / PM" and got invoices without anyone ticking anything (owner, Oct 1). Now it
 * is the Invoices page on Admin › Users, visible and changeable; the one user that rule covered
 * (Brian) was given the tick by 20261008180000_invoices_access.sql. A manager or an admin is not
 * this (they are more). The twin of `public.is_sales_pm()`, which keeps its name for the RLS
 * policies that call it.
 */
export const isSalesPm = (p: AccessLike | null | undefined): boolean =>
  !!p && p.role === "user" && (p.access ?? []).includes("invoices");

/**
 * Who sees and edits invoices (owner, Oct 1: "Sales and PMs should be able to see customers and
 * invoices. However whatever is changed needs to be logged somewhere showing what they did,
 * when, and who."): admins, managers and sales / project managers. The Invoice block on a
 * ticket, the Invoices page, invoice PDFs and every invoice server function; every write is
 * logged (audit_log). Creating and dispatching tickets, crew rates, repair prices and Service
 * Rates stay `managesTickets`. The twin of RLS
 * `public.is_admin() or public.is_manager() or public.is_sales_pm()`.
 */
export const seesInvoices = (p: AccessLike | null | undefined): boolean =>
  managesTickets(p) || isSalesPm(p);

/**
 * Who works the whole Opportunities list (the sidebar entry, New opportunity): Customers or
 * Estimate access — the twin of crm_opportunities_read. Anyone else still opens /opportunities
 * (pageForPath: null) and sees only the opportunities assigned to them.
 */
export const seesOpportunitiesList = (p: AccessLike | null | undefined): boolean =>
  canAccess(p, "customers") || canAccess(p, "estimate");

/**
 * The page a route belongs to; null for routes every signed-in user may open (/account).
 * "admin": admins only; "manager": admins and managers (`managesTickets`).
 */
export function pageForPath(pathname: string): Page | "admin" | "manager" | null {
  if (pathname === "/account" || pathname === "/login") return null;
  // Follow-ups and Work Overview: every signed-in user (the server returns only what they may see).
  if (pathname.startsWith("/followups")) return null;
  if (pathname.startsWith("/my-work")) return null;
  // "/" only redirects to Work Overview.
  if (pathname === "/") return null;
  if (pathname.startsWith("/admin/users") || pathname.startsWith("/admin/reminders"))
    return "admin";
  // Setup (service rates, inspection checklist, vehicles) is ticket money: a manager's too
  // (owner, Oct 1); /admin/service-rates is its old address and redirects there.
  if (pathname.startsWith("/setup") || pathname.startsWith("/admin/service-rates"))
    return "manager";
  if (pathname.startsWith("/admin")) return "pricing";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/prospect")) return "prospect";
  if (pathname.startsWith("/takeoff")) return "takeoff";
  // The Invoices tab under Service is the Invoices page's (seesInvoices gates the screen too).
  if (pathname.startsWith("/service/invoices")) return "invoices";
  if (pathname.startsWith("/service")) return "service";
  if (pathname.startsWith("/customers")) return "customers";
  // Opportunities: every signed-in user (audit, Oct 2: a rep without Customers access was
  // bounced from their own opportunity's Work Overview link). What they see is the server's: RLS
  // gives Customers / Estimate users every opportunity and anyone else only their own
  // assignments (crm_opportunities_read). The sidebar lists the page for Customers / Estimate
  // (seesOpportunitiesList).
  if (pathname.startsWith("/opportunities")) return null;
  if (
    pathname.startsWith("/bids") ||
    pathname.startsWith("/estimate") ||
    pathname.startsWith("/proposal")
  )
    return "estimate";
  return null;
}

/**
 * Where a signed-in user lands: Work Overview, for everyone (owner, Sep 30) — every signed-in user may
 * open it (it replaced "a technician lands on Service, others on their first page").
 */
export function homeFor(_p?: AccessLike | null): string {
  return "/my-work";
}

export const normalizeAccess = (v: unknown): Page[] =>
  Array.isArray(v) ? (PAGES.filter((p) => v.includes(p)) as Page[]) : [];
