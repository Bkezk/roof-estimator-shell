/**
 * The folds on a customer's page and a property's page (owner, Oct 15: "on the customers page
 * lets make these collapsible so if there's 100 tickets it won't take up the whole page"). Every
 * section — Contacts, Properties, Tickets, Opportunities, Bids, Tasks, Takeoffs — folds under its
 * header; the count stays in the header either way.
 *
 * The default on a CUSTOMER's page (owner, Oct 21: "make each section start collapsed"): every
 * section folded, whatever its count — the header's count and the coloured ground say what is
 * there, one tap opens it. On a PROPERTY's page the Oct 15 rule stays: a section open while it
 * has FOLD_OPEN_MAX rows or fewer and folded past that. A fold the user sets is remembered per
 * user, per page, per section in the browser (localStorage; `jbk-portal:customer-folds:<user>` /
 * `jbk-portal:property-folds:<user>`) and wins over the default. Pure rules only;
 * components/section-fold.tsx owns the header.
 */

export const FOLD_SECTIONS = [
  "contacts",
  "properties",
  "tickets",
  "opportunities",
  "bids",
  "tasks",
  "takeoffs",
] as const;
export type FoldSection = (typeof FOLD_SECTIONS)[number];
export const isFoldSection = (v: unknown): v is FoldSection =>
  (FOLD_SECTIONS as readonly unknown[]).includes(v);

/** Which page the folds belong to: a customer's page or a property's page. */
export type FoldPage = "customer" | "property";

/** The folds the user set: true = open, false = folded; a section left out follows the default. */
export type Folds = Partial<Record<FoldSection, boolean>>;

/** On a property's page, a section with more rows than this starts folded. */
export const FOLD_OPEN_MAX = 10;

/**
 * Whether a section the user never touched starts open. A customer's page: never (Oct 21) —
 * every section starts folded, the Properties one included. A property's page: while its count
 * is FOLD_OPEN_MAX or under; a count not known yet (null: the rows are still loading) leaves it
 * open, so the loading line shows.
 */
export function defaultOpen(
  page: FoldPage,
  section: FoldSection,
  count: number | null | undefined,
): boolean {
  if (page === "customer") return false;
  void section;
  if (count === null || count === undefined) return true;
  return count <= FOLD_OPEN_MAX;
}

/** Open or folded: what the user set for the section, else the page's default for its count. */
export function isFoldOpen(
  folds: Folds,
  page: FoldPage,
  section: FoldSection,
  count: number | null | undefined,
): boolean {
  const set = folds[section];
  return typeof set === "boolean" ? set : defaultOpen(page, section, count);
}

/** The folds with one section set open or folded (`open` given) or flipped from `current`. */
export function toggleFold(folds: Folds, section: FoldSection, open: boolean): Folds {
  return { ...folds, [section]: open };
}

/** Only the known sections with a true / false value; anything else (junk, old keys) is dropped. */
export function normalizeFolds(raw: unknown): Folds {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Folds = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isFoldSection(k) && typeof v === "boolean") out[k] = v;
  }
  return out;
}

// ---- the browser's copy ---------------------------------------------------------------------

export const CUSTOMER_FOLDS_STORAGE_KEY = "jbk-portal:customer-folds";
export const PROPERTY_FOLDS_STORAGE_KEY = "jbk-portal:property-folds";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The key the page's folds are kept under for this user. */
export const foldsKey = (page: FoldPage, userId: string): string =>
  `${page === "property" ? PROPERTY_FOLDS_STORAGE_KEY : CUSTOMER_FOLDS_STORAGE_KEY}:${userId}`;

/** The folds this user set on this page in this browser; {} without any (or with junk). */
export function readFolds(storage: StorageLike | null, page: FoldPage, userId: string): Folds {
  try {
    const raw = storage?.getItem(foldsKey(page, userId));
    if (!raw) return {};
    return normalizeFolds(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Remember the folds for this user on this page (nothing set clears the entry). */
export function writeFolds(
  storage: StorageLike | null,
  page: FoldPage,
  userId: string,
  folds: Folds,
): void {
  try {
    const clean = normalizeFolds(folds);
    if (Object.keys(clean).length === 0) storage?.removeItem(foldsKey(page, userId));
    else storage?.setItem(foldsKey(page, userId), JSON.stringify(clean));
  } catch {
    // A private window or a full store: the fold still works this visit.
  }
}
