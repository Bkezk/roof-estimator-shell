/**
 * A technician who cannot see tickets (owner, Oct 6). The Technician tick puts a person on the
 * dispatch picker and the Tech Board, but reading a ticket needs Service access
 * (service_jobs_read: has_access('service')). John — Technician, access Estimate + Inventory —
 * was assigned 2 tickets and saw 0. The roster (technician_options(), migration
 * 20261006191000_dispatch_service_access.sql) now lists only people who can read tickets, and
 * Admin › Users warns on each such row with a one-click fix. Pure: tested in
 * dispatch-service-access.test.ts.
 */
import { canAccess, type AccessLike, type Page } from "@/lib/access";

/** The amber warning on Admin › Users. */
export const TECH_NEEDS_SERVICE = "Technician without Service access — cannot see tickets";

/** Ticked Technician, yet unable to read tickets (a plain user without Service access). */
export const technicianNeedsService = (u: AccessLike | null | undefined): boolean =>
  !!u?.technician && !canAccess(u, "service");

/** The same pages plus Service (once): what "Give Service access" saves. */
export const withService = (access: readonly Page[]): Page[] =>
  access.includes("service") ? [...access] : [...access, "service"];
