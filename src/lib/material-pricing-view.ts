/**
 * Setup › Material pricing, the list's view rules (owner, Nov 4, review item 2): the rows read as
 * text under group headings that fold, a "Priced here" filter keeps the rows whose cost is typed
 * on this page (not followed from Estimate Pricing), the count follows the search, and a save
 * sends only the rows that changed. Pure, so the page and the tests share it.
 */

/** What the list needs of a row (the page's Row has more). */
export interface MaterialView {
  key: string;
  id?: string | undefined;
  name: string;
  unit: string;
  cost: string;
  active: boolean;
  category: string;
  /** Counted in the bid catalog's stock: its cost follows Estimate Pricing. */
  shared: boolean;
  /** Its stock screen ("duro_last:pipe_stacks") when shared; names its group. */
  screen?: string | null | undefined;
}

export const NEW_GROUP = "New";
export const NO_GROUP = "No group";
export const PRICED_FROM_ESTIMATE = "From Estimate Pricing";

/** "duro_last:pipe_stacks" → "Pipe Stacks" (as priceSource prints the screen). */
export function screenGroupName(screen: string): string {
  return (screen.split(":").pop() ?? screen)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A row's heading: a row not saved yet is "New" (at the top, open); a row priced here sits under
 * its Group (or "No group"); a row priced from Estimate Pricing under "From Estimate Pricing ›
 * <screen>".
 */
export function materialGroup(r: MaterialView): string {
  if (!r.id) return NEW_GROUP;
  if (r.shared)
    return `${PRICED_FROM_ESTIMATE} › ${r.screen ? screenGroupName(r.screen) : "other"}`;
  return r.category.trim() || NO_GROUP;
}

export interface MaterialGroup<T extends MaterialView> {
  label: string;
  rows: T[];
}

/**
 * The rows under their headings: New first, then the groups priced here A–Z ("No group" last of
 * them), then the Estimate Pricing groups A–Z. Rows keep the list's order inside a group.
 */
export function groupMaterials<T extends MaterialView>(rows: readonly T[]): MaterialGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const g = materialGroup(r);
    const list = by.get(g);
    if (list) list.push(r);
    else by.set(g, [r]);
  }
  const rank = (label: string) =>
    label === NEW_GROUP
      ? 0
      : label.startsWith(PRICED_FROM_ESTIMATE)
        ? 3
        : label === NO_GROUP
          ? 2
          : 1;
  return [...by.entries()]
    .map(([label, list]) => ({ label, rows: list }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

export interface MaterialFilters {
  search: string;
  showHidden: boolean;
  pricedHere: boolean;
}

/** What a search reads: name, unit, group — the heading too, so "pipe" finds the Pipe Stacks. */
const searchText = (r: MaterialView) =>
  `${r.name} ${r.unit} ${r.category} ${r.shared && r.screen ? screenGroupName(r.screen) : ""}`.toLowerCase();

/** The rows the filters keep. A row not saved yet is always shown. */
export function filterMaterials<T extends MaterialView>(
  rows: readonly T[],
  f: MaterialFilters,
): T[] {
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (r) =>
      !r.id ||
      ((f.showHidden || r.active) &&
        (!f.pricedHere || !r.shared) &&
        words.every((w) => searchText(r).includes(w))),
  );
}

/** Whether any filter narrows the list. */
export const isFiltering = (f: MaterialFilters): boolean => f.search.trim() !== "" || f.pricedHere;

/** "137 materials", or "33 of 137 materials" while a filter narrows the list. */
export function materialCountLine(shown: number, total: number, filtering: boolean): string {
  const noun = total === 1 ? "material" : "materials";
  return filtering ? `${shown} of ${total} ${noun}` : `${total} ${noun}`;
}

/** The rows a save sends: new ones, and saved ones whose fields differ from the loaded row. */
export function changedMaterials<T extends MaterialView>(
  rows: readonly T[],
  loaded: ReadonlyMap<string, MaterialView>,
): T[] {
  return rows.filter((r) => {
    if (!r.id) return true;
    const was = loaded.get(r.id);
    if (!was) return true;
    return (
      was.name !== r.name ||
      was.unit !== r.unit ||
      Number(was.cost) !== Number(r.cost) ||
      was.active !== r.active ||
      was.category.trim() !== r.category.trim()
    );
  });
}

/**
 * While a search is typed every group is open; a group holding an unsaved edit stays open (the
 * edited row is never folded away); otherwise the user's folds hold (closed to start).
 */
export function groupOpen(
  label: string,
  opened: ReadonlySet<string>,
  searching: boolean,
  hasEdits = false,
): boolean {
  return searching || hasEdits || label === NEW_GROUP || opened.has(label);
}

/**
 * The markup a save sends: the typed percent as a fraction when it differs from the loaded one,
 * else nothing (audit, Nov 6, finding 3: sending it unchanged re-stamped service_settings).
 */
export function markupToSend(typedPct: number, loaded: number): number | undefined {
  const next = typedPct / 100;
  return Math.abs(next - loaded) < 1e-9 ? undefined : next;
}
