/**
 * Whether a counts-strip tile (components/work-counts-strip.tsx) may be a link (audit, Oct 2):
 * the ticket tiles link to /service, which needs Service; a Customers-only user who clicked one
 * was bounced by the gate to My Work. A tile links only when the user may open its page — the
 * gate's own rule (components/auth-gate.tsx), from `pageForPath` — and otherwise shows its number
 * without a link, titled "Needs Service access".
 *
 * Pure (no I/O), unit-tested in work-tile-access.test.ts.
 */
import {
  PAGE_LABELS,
  canAccess,
  isAdmin,
  managesTickets,
  pageForPath,
  type AccessLike,
} from "@/lib/access";
import { tileHref, type TileKind } from "@/lib/work-counts";

/** May this user open `pathname`? The AuthGate's rule; false while the profile is unknown. */
export function canOpenPath(p: AccessLike | null | undefined, pathname: string): boolean {
  if (!p) return false;
  const page = pageForPath(pathname);
  if (page === null) return true;
  if (page === "admin") return isAdmin(p);
  if (page === "manager") return managesTickets(p);
  return canAccess(p, page);
}

/** Null when the tile may link; otherwise its title: "Needs Service access". */
export function tileBlockedTitle(p: AccessLike | null | undefined, kind: TileKind): string | null {
  const to = tileHref(kind).to;
  if (canOpenPath(p, to)) return null;
  const page = pageForPath(to);
  const what =
    page === "admin" ? "admin" : page === "manager" ? "manager" : page ? PAGE_LABELS[page] : "page";
  return `Needs ${what} access`;
}
