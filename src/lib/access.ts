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
};

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
 * `managesTickets`). Everyone except a technician who is neither an admin nor a manager (that
 * technician sees and edits only their own tickets). The twin of RLS
 * `not is_technician() or is_admin() or is_manager()`.
 */
export const isOffice = (p: AccessLike | null | undefined): boolean =>
  !!p && (!p.technician || seesEveryone(p));

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
 * A sales / project manager (owner, Oct 1): a plain user, not ticked Technician, with Estimate
 * access — they build bids, know costs and oversee jobs. A technician with Estimate is not one;
 * a manager or an admin is not one either (they are more). The twin of `public.is_sales_pm()`.
 */
export const isSalesPm = (p: AccessLike | null | undefined): boolean =>
  !!p && p.role === "user" && !p.technician && canAccess(p, "estimate");

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
