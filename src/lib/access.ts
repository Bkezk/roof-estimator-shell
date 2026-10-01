/**
 * Per-page access (owner, 2026-09-23). An admin manages users and can reach everything; every
 * other user is granted any combination of pages. Someone with Estimate access is listed as an
 * estimator on the Setup step; without Inventory they cannot open Inventory, and so on.
 *
 * Roles (owner, 2026-09-30: "users should only see their own stuff except for managers who see
 * everything"):
 * - admin: every page, plus the Admin pages (users, reminders, service rates).
 * - manager: every page including Estimate Pricing (owner, Oct 1: "managers and admins can edit
 *   pricing"), but not the Admin pages (users, reminders); sees everyone's tickets, tasks and
 *   follow-ups (also when ticked Technician), may dispatch, move dates and snooze / close
 *   follow-ups.
 * - user: only the pages in `access`, never Estimate Pricing ("reps cannot edit pricing nor do
 *   they need to see it"); a Technician user sees and edits only their own tickets.
 *
 * `profiles.role` is 'admin' | 'manager' | 'user'; `profiles.access` is the granted pages (empty
 * for admins and managers). Enforcement is RLS (`public.has_access(page)`, `public.is_admin()`,
 * `public.is_manager()`) plus the checks inside every server function; the gate and the sidebar
 * only mirror it. My Work (/my-work) is every signed-in user's landing page.
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
  estimate: "Bids and the estimator — and listed as an estimator on Setup",
  pricing:
    "Labor, Duro-Last and Non-DL pricing, service rates, price list import — managers and admins only",
  inventory: "Stock ledger (leftovers only, unless Estimate is granted too)",
  prospect: "Buildings, roofs and tasks — the territory roof database",
  takeoff: "Measure plan sheets and aerial screenshots; create a bid from the drawing",
  service:
    "Service tickets (repairs): create, assign and close them; log material used off a vehicle",
  customers: "The customer hub: accounts, sites and contacts that bids and tickets link to",
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
    "Sees everyone's tickets, tasks and customers; edits pricing; no Users or Reminders pages",
  user: "Only the pages ticked below (never pricing); a technician sees only their own tickets",
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
 * Admins and managers reach every page; others only the pages granted, and Estimate Pricing is
 * never granted to a plain user (owner, Oct 1). The twin of `public.has_access(page)`.
 */
export const canAccess = (p: AccessLike | null | undefined, page: Page): boolean =>
  !!p &&
  (p.role === "admin" ||
    p.role === "manager" ||
    (page !== "pricing" && (p.access ?? []).includes(page)));

/** The pages Admin › Users may tick for a plain user: everything but Estimate Pricing. */
export const GRANTABLE_PAGES: readonly Page[] = PAGES.filter((p) => p !== "pricing");

export const isAdmin = (p: AccessLike | null | undefined): boolean => p?.role === "admin";

export const isManager = (p: AccessLike | null | undefined): boolean => p?.role === "manager";

/** Admins and managers see everyone's tickets, tasks and follow-ups (My Work's "Show" picker). */
export const seesEveryone = (p: AccessLike | null | undefined): boolean =>
  isAdmin(p) || isManager(p);

/**
 * The office: sees every ticket and may dispatch. Everyone except a technician who is neither an
 * admin nor a manager (that technician sees and edits only their own tickets). The twin of RLS
 * `not is_technician() or is_admin() or is_manager()`.
 */
export const isOffice = (p: AccessLike | null | undefined): boolean =>
  !!p && (!p.technician || seesEveryone(p));

/** The page a route belongs to; null for routes every signed-in user may open (/account). */
export function pageForPath(pathname: string): Page | "admin" | null {
  if (pathname === "/account" || pathname === "/login") return null;
  // Follow-ups and My Work: every signed-in user (the server returns only what they may see).
  if (pathname.startsWith("/followups")) return null;
  if (pathname.startsWith("/my-work")) return null;
  // "/" only redirects to My Work.
  if (pathname === "/") return null;
  if (pathname.startsWith("/admin/users") || pathname.startsWith("/admin/reminders"))
    return "admin";
  // Service rates are pricing (managers edit them too).
  if (pathname.startsWith("/admin")) return "pricing";
  if (pathname.startsWith("/inventory")) return "inventory";
  if (pathname.startsWith("/prospect")) return "prospect";
  if (pathname.startsWith("/takeoff")) return "takeoff";
  if (pathname.startsWith("/service")) return "service";
  if (pathname.startsWith("/customers")) return "customers";
  if (pathname.startsWith("/opportunities")) return "customers";
  if (
    pathname.startsWith("/bids") ||
    pathname.startsWith("/estimate") ||
    pathname.startsWith("/proposal")
  )
    return "estimate";
  return null;
}

/**
 * Where a signed-in user lands: My Work, for everyone (owner, Sep 30) — every signed-in user may
 * open it (it replaced "a technician lands on Service, others on their first page").
 */
export function homeFor(_p?: AccessLike | null): string {
  return "/my-work";
}

export const normalizeAccess = (v: unknown): Page[] =>
  Array.isArray(v) ? (GRANTABLE_PAGES.filter((p) => v.includes(p)) as Page[]) : [];
