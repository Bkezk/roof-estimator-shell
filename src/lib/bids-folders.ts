/**
 * Project Bids' folder views. Pure: the view toggle's storage, the year folders and the groups
 * inside a year (owner, Oct 7: "a toggle similar to the service ticket view toggle that changes
 * the view … to folders with the years; once you click it, it opens, you can click on and then
 * sort further from there"), and the assigned folders (owner, Oct 13: "Bid Advantage, when a bid
 * was saved, was able to save it in a file, so Bell County Schools could be saved under a folder
 * separately from the other bids" → "ok lets just do a by folder view that you assign"). A
 * folder is a label the user puts on a bid (bids.folder, null = unfiled) — not the customer; the
 * customer's name is only the default the picker suggests (suggestFolder).
 */
export type BidsView = "list" | "folders" | "byFolder";
const BIDS_VIEWS: readonly BidsView[] = ["list", "folders", "byFolder"];
export const BIDS_VIEW_KEY = "bid-o-matic:bids-view";
export const BIDS_FOLDER_GROUP_KEY = "bid-o-matic:bids-folder-group";

export const FOLDER_GROUPS = [
  "month",
  "customer",
  "status",
  "estimator",
  "system",
  "folder",
] as const;
export type FolderGroup = (typeof FOLDER_GROUPS)[number];
export const FOLDER_GROUP_LABELS: Record<FolderGroup, string> = {
  month: "Month",
  customer: "Customer",
  status: "Status",
  estimator: "Estimator",
  system: "Roof system",
  folder: "Folder",
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The remembered view; "folders" (the year view, stored before Oct 13) stays valid. */
export function readBidsView(storage: StorageLike | null | undefined): BidsView {
  try {
    const v = storage?.getItem(BIDS_VIEW_KEY);
    return (BIDS_VIEWS as readonly string[]).includes(v ?? "") ? (v as BidsView) : "list";
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
  /** The assigned folder (bids.folder); absent / null = unfiled. */
  folder?: string | null | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assigned folders (owner, Oct 13)
// ─────────────────────────────────────────────────────────────────────────────

/** The longest folder name kept. */
export const FOLDER_MAX = 80;
/** How a bid with no folder is shown; its card is always last. */
export const UNFILED = "Unfiled";
/** The key of the Unfiled card (folderKey of a null folder). */
export const UNFILED_KEY = "";

/**
 * A folder name as stored: trimmed, inner whitespace collapsed to one space, at most FOLDER_MAX
 * characters; blank (or "Unfiled", which is not a folder) → null.
 */
export function normalizeFolder(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const cut = s.length > FOLDER_MAX ? s.slice(0, FOLDER_MAX).trimEnd() : s;
  return cut.toLocaleLowerCase() === UNFILED.toLocaleLowerCase() ? null : cut;
}

/**
 * The key two spellings of one folder share: "bell county" and "Bell County" are one folder
 * (the first-seen spelling is the one shown). A null / blank folder keys to UNFILED_KEY.
 */
export const folderKey = (name: string | null | undefined): string =>
  normalizeFolder(name)?.toLocaleLowerCase() ?? UNFILED_KEY;

/** The default folder for a bid that has none: its customer's name, or nothing. */
export const suggestFolder = (customerName: string | null | undefined): string | null =>
  normalizeFolder(customerName);

export interface FolderedBid extends FolderBid {
  folder?: string | null | undefined;
}

export interface FolderCard<T> {
  key: string;
  name: string;
  count: number;
  total: number;
  bids: T[];
}

/**
 * One card per folder, A–Z by name, Unfiled last (only when some bid is unfiled): how many bids,
 * their total, and the bids. Spellings that differ only in case are one card named as first seen.
 */
export function folderCards<T extends FolderedBid>(rows: readonly T[]): FolderCard<T>[] {
  const by = new Map<string, FolderCard<T>>();
  for (const b of rows) {
    const key = folderKey(b.folder);
    const card = by.get(key) ?? {
      key,
      name: key === UNFILED_KEY ? UNFILED : normalizeFolder(b.folder)!,
      count: 0,
      total: 0,
      bids: [],
    };
    card.count += 1;
    card.total += totalOf(b);
    card.bids.push(b);
    by.set(key, card);
  }
  return [...by.values()].sort((a, b) => {
    if (a.key === UNFILED_KEY) return 1;
    if (b.key === UNFILED_KEY) return -1;
    return a.name.localeCompare(b.name);
  });
}

/** The bids in one folder (by key; UNFILED_KEY = the unfiled bids). */
export const bidsInFolder = <T extends FolderedBid>(rows: readonly T[], key: string): T[] =>
  rows.filter((b) => folderKey(b.folder) === key);

/** The folder names in use, A–Z, one per folder (first-seen spelling), for the picker. */
export function folderOptions(rows: readonly FolderedBid[]): string[] {
  return folderCards(rows)
    .filter((c) => c.key !== UNFILED_KEY)
    .map((c) => c.name);
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
 * blanks ("No customer", "No estimator", "No roof system", "Unfiled") last. A bid with two roof
 * systems sits in both system folders.
 */
export function foldersFor<T extends FolderBid>(
  rows: readonly T[],
  by: FolderGroup,
  facts: (bid: T) => FolderFacts,
): Array<{ label: string; rows: T[] }> {
  const groups = new Map<string, { label: string; sort: number | string; rows: T[] }>();
  const put = (label: string, sort: number | string, b: T, key = label) => {
    const g = groups.get(key) ?? { label, sort, rows: [] };
    g.rows.push(b);
    groups.set(key, g);
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
      case "folder": {
        // The assigned folder (owner, Oct 13), case-insensitive, first-seen spelling; Unfiled last.
        const name = normalizeFolder(f.folder);
        put(name ?? UNFILED, name ? name.toLocaleLowerCase() : "￿", b, folderKey(f.folder));
        break;
      }
    }
  }
  const out = [...groups.values()].map((g) => ({ label: g.label, rows: g.rows, sort: g.sort }));
  out.sort((a, b) => {
    if (typeof a.sort === "number" && typeof b.sort === "number") return b.sort - a.sort;
    return String(a.sort).localeCompare(String(b.sort));
  });
  return out.map(({ label, rows }) => ({ label, rows }));
}
