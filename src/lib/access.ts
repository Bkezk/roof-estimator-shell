/**
 * Per-page access (owner, 2026-09-23). An admin manages users and can reach everything; every
 * other user is granted any combination of pages. Someone with Estimate access is listed as an
 * estimator on the Setup step; without Inventory they cannot open Inventory, and so on.
 *
 * `profiles.role` is 'admin' | 'user'; `profiles.access` is the granted pages. Enforcement is
 * RLS (`public.has_access(page)`) plus the checks inside every server function; the gate and the
 * sidebar only mirror it.
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
  pricing: "Labor, Duro-Last and Non-DL pricing, price list import",
  inventory: "Stock ledger (leftovers only, unless Estimate is granted too)",
  prospect: "Buildings, roofs and tasks — the territory roof database",
  takeoff: "Measure plan sheets and aerial screenshots; create a bid from the drawing",
  service:
    "Service tickets (repairs): create, assign and close them; log material used off a vehicle",
  customers: "The customer hub: accounts, sites and contacts that bids and tickets link to",
};

export type Role = "admin" | "user";

export interface AccessLike {
  role: string | null | undefined;
  access?: readonly string[] | null | undefined;
  /** Marked as a technician: appears on the board, can be assigned tickets and vehicles. */
  technician?: boolean | null | undefined;
}

/** Admins reach every page; others only the pages granted. */
export const canAccess = (p: AccessLike | null | undefined, page: Page): boolean =>
  !!p && (p.role === "admin" || (p.access ?? []).includes(page));

export const isAdmin = (p: AccessLike | null | undefined): boolean => p?.role === "admin";

/** The page a route belongs to; null for routes every signed-in user may open (/account). */
export function pageForPath(pathname: string): Page | "admin" | null {
  if (pathname === "/account" || pathname === "/login") return null;
  // Follow-ups: every signed-in user (the server returns only what they may see).
  if (pathname.startsWith("/followups")) return null;
  if (
    pathname.startsWith("/admin/users") ||
    pathname.startsWith("/admin/reminders") ||
    pathname.startsWith("/admin/service-rates")
  )
    return "admin";
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
    pathname.startsWith("/proposal") ||
    pathname === "/"
  )
    return "estimate";
  return null;
}

/** Where a signed-in user lands: the first page they may open. */
export function homeFor(p: AccessLike | null | undefined): string {
  // A technician lands on their tickets.
  if (p?.technician && canAccess(p, "service")) return "/service";
  if (canAccess(p, "estimate")) return "/bids";
  if (canAccess(p, "inventory")) return "/inventory";
  if (canAccess(p, "prospect")) return "/prospect";
  if (canAccess(p, "takeoff")) return "/takeoff";
  if (canAccess(p, "service")) return "/service";
  if (canAccess(p, "customers")) return "/customers";
  if (canAccess(p, "pricing")) return "/admin/settings";
  if (isAdmin(p)) return "/admin/users";
  return "/account";
}

export const normalizeAccess = (v: unknown): Page[] =>
  Array.isArray(v) ? (PAGES.filter((p) => v.includes(p)) as Page[]) : [];
