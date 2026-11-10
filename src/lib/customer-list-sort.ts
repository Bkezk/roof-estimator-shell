/**
 * The Customers list's sort choices (owner, Nov 2: "sort choices"). The list was alphabetical
 * only; the office also reaches for the customers with work on, the ones touched last, and the
 * book by account manager. Pure, so the order is tested without the page.
 */

export const CUSTOMER_SORTS = [
  { id: "name", label: "Name A–Z" },
  { id: "tickets", label: "Most tickets in progress" },
  { id: "updated", label: "Recently updated" },
  { id: "manager", label: "Account manager" },
] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number]["id"];
export const DEFAULT_CUSTOMER_SORT: CustomerSort = "name";

export const isCustomerSort = (v: unknown): v is CustomerSort =>
  CUSTOMER_SORTS.some((s) => s.id === v);

/** What the list's search box reads on a customer. */
export interface SearchableCustomer {
  name: string;
  city: string | null;
  contact_name: string | null;
  external_id: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
}

/**
 * Does the customer match the search box? `q` is the typed text, trimmed and lower-cased; empty
 * matches everyone. Name, city, contact, customer #, phone, mobile and email, as one line (so
 * "acme corbin" finds Acme in Corbin only when typed in that order, as before). The page runs
 * this over EVERY customer before it cuts the list into screenfuls (lib/list-window.ts).
 */
export function matchesCustomerSearch(a: SearchableCustomer, q: string): boolean {
  if (!q) return true;
  return [a.name, a.city, a.contact_name, a.external_id, a.phone, a.mobile, a.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export interface SortableCustomer {
  name: string;
  open_jobs: number;
  updated_at: string;
  account_manager_id: string | null;
}

const byName = <T extends SortableCustomer>(a: T, b: T) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * A new array in the chosen order. Ties fall back to the name, so the order is stable and
 * readable: tickets most first; updated newest first; account manager by the manager's name
 * with the unassigned customers last.
 */
export function sortCustomers<T extends SortableCustomer>(
  rows: readonly T[],
  sort: CustomerSort,
  managerName: (id: string) => string | undefined,
): T[] {
  const out = [...rows];
  switch (sort) {
    case "tickets":
      return out.sort((a, b) => b.open_jobs - a.open_jobs || byName(a, b));
    case "updated":
      return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || byName(a, b));
    case "manager": {
      const key = (r: T) =>
        r.account_manager_id ? (managerName(r.account_manager_id) ?? "~") : null;
      return out.sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (ka === null && kb !== null) return 1;
        if (kb === null && ka !== null) return -1;
        return (ka ?? "").localeCompare(kb ?? "", "en", { sensitivity: "base" }) || byName(a, b);
      });
    }
    default:
      return out.sort(byName);
  }
}
