/**
 * Project Bids' folder view (owner, Oct 7: "a toggle similar to the service ticket view toggle
 * that changes the view … to folders with the years; once you click it, it opens, you can click
 * on and then sort further from there"). Pure: the view toggle's storage, the year folders, and
 * the groups inside a year (month, customer, status, estimator, roof system).
 */
export type BidsView = "list" | "folders";
export const BIDS_VIEW_KEY = "bid-o-matic:bids-view";
export const BIDS_FOLDER_GROUP_KEY = "bid-o-matic:bids-folder-group";

export const FOLDER_GROUPS = ["month", "customer", "status", "estimator", "system"] as const;
export type FolderGroup = (typeof FOLDER_GROUPS)[number];
export const FOLDER_GROUP_LABELS: Record<FolderGroup, string> = {
  month: "Month",
  customer: "Customer",
  status: "Status",
  estimator: "Estimator",
  system: "Roof system",
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readBidsView(storage: StorageLike | null | undefined): BidsView {
  try {
    return storage?.getItem(BIDS_VIEW_KEY) === "folders" ? "folders" : "list";
  } catch {
    return "list";
  }
}
export function writeBidsView(storage: StorageLike | null | undefined, view: BidsView): void {
  try {
    storage?.setItem(BIDS_VIEW_KEY, view);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}
export function readFolderGroup(storage: StorageLike | null | undefined): FolderGroup {
  try {
    const v = storage?.getItem(BIDS_FOLDER_GROUP_KEY);
    return (FOLDER_GROUPS as readonly string[]).includes(v ?? "") ? (v as FolderGroup) : "month";
  } catch {
    return "month";
  }
}
export function writeFolderGroup(storage: StorageLike | null | undefined, g: FolderGroup): void {
  try {
    storage?.setItem(BIDS_FOLDER_GROUP_KEY, g);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

export interface FolderBid {
  created_at: string;
  grand_total: number | string | null;
}

/** The bid's year, from the day it was created (the list's "Created" date). */
export const bidYear = (createdAt: string): number => new Date(createdAt).getFullYear();

const totalOf = (b: FolderBid) => Number(b.grand_total ?? 0) || 0;

/** One folder per year with bids, newest year first: how many and their total. */
export function yearFolders<T extends FolderBid>(
  rows: readonly T[],
): Array<{ year: number; count: number; total: number }> {
  const by = new Map<number, { count: number; total: number }>();
  for (const b of rows) {
    const y = bidYear(b.created_at);
    const f = by.get(y) ?? { count: 0, total: 0 };
    f.count += 1;
    f.total += totalOf(b);
    by.set(y, f);
  }
  return [...by.entries()].map(([year, f]) => ({ year, ...f })).sort((a, b) => b.year - a.year);
}

export const bidsInYear = <T extends FolderBid>(rows: readonly T[], year: number): T[] =>
  rows.filter((b) => bidYear(b.created_at) === year);

/** What the folder view needs to know about a bid beyond its row. */
export interface FolderFacts {
  customer: string;
  estimator: string;
  systems: readonly string[];
  status: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The folders inside a year for a grouping. Months newest first; the others A–Z with the
 * blanks ("No customer", "No estimator", "No roof system") last. A bid with two roof systems
 * sits in both system folders.
 */
export function foldersFor<T extends FolderBid>(
  rows: readonly T[],
  by: FolderGroup,
  facts: (bid: T) => FolderFacts,
): Array<{ label: string; rows: T[] }> {
  const groups = new Map<string, { sort: number | string; rows: T[] }>();
  const put = (label: string, sort: number | string, b: T) => {
    const g = groups.get(label) ?? { sort, rows: [] };
    g.rows.push(b);
    groups.set(label, g);
  };
  for (const b of rows) {
    const f = facts(b);
    switch (by) {
      case "month": {
        const d = new Date(b.created_at);
        put(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`, d.getFullYear() * 12 + d.getMonth(), b);
        break;
      }
      case "customer":
        put(f.customer.trim() || "No customer", f.customer.trim() ? f.customer : "￿", b);
        break;
      case "status":
        put(f.status, f.status, b);
        break;
      case "estimator":
        put(f.estimator.trim() || "No estimator", f.estimator.trim() ? f.estimator : "￿", b);
        break;
      case "system":
        if (f.systems.length === 0) put("No roof system", "￿", b);
        for (const s of f.systems) put(s, s, b);
        break;
    }
  }
  const out = [...groups.entries()].map(([label, g]) => ({ label, rows: g.rows, sort: g.sort }));
  out.sort((a, b) => {
    if (typeof a.sort === "number" && typeof b.sort === "number") return b.sort - a.sort;
    return String(a.sort).localeCompare(String(b.sort));
  });
  return out.map(({ label, rows }) => ({ label, rows }));
}
