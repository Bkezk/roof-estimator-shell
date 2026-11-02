/**
 * Price List Import — the three lists (owner, Nov 2: "match via item number only ... items that
 * are a suspected match it lists and items that have no suspected match it lists and easy way to
 * associate them properly. the current process is a bit complex").
 *
 *  1. Matched by item number — `matchSheet` (price-import.ts); nothing here.
 *  2. Likely matches — a sheet line with no item number in the catalog, paired with the catalog
 *     product whose name it best fits (`suggestCatalogRow`); and a catalog product whose number
 *     the sheet no longer carries (Duro-Last renumbered it), paired with the sheet line that best
 *     names it (`suggestSheetLine`). One sheet line pairs once; one product pairs once; the
 *     stronger pairing wins. "strong" = every word of the product name is on the line;
 *     "possible" = at least 60% of them (scoreTokenSets' floor).
 *  3. No match found — every other unmatched sheet line.
 *
 * Pure: the page feeds it the match result and the catalog targets; Link / Not this / Skip are
 * the page's (the mapping is saved, the page refreshes, the line moves to list 1 on its own).
 */
import {
  buildNameIndex,
  suggestCatalogRow,
  suggestSheetLine,
  type CatalogRowRef,
  type ItemNumberMapping,
  type SheetItem,
} from "@/lib/price-import";

export type MatchStrength = "strong" | "possible";

export interface LikelyMatch {
  /** Stable key for Not this: the sheet line + the product cell. */
  key: string;
  item: SheetItem;
  target: CatalogRowRef;
  /** 0.6–1: the share of the product name's words the sheet line carries. */
  score: number;
  strength: MatchStrength;
  /** "renumbered": the product carried `oldItemNo`, which this sheet does not list. */
  kind: "new" | "renumbered";
  oldItemNo?: string;
  /** The product's current price in that cell (null when blank). */
  currentPrice: number | null;
}

export interface TriageTarget {
  screen_id: string;
  category: string;
  rows: string[];
  price_cols: string[];
  values: Record<string, Record<string, number | null | undefined>>;
}

export interface TriageInput {
  /** Sheet lines whose item number maps to nothing (matchSheet.unmatched). */
  unmatched: readonly SheetItem[];
  /** Catalog mappings whose number the sheet does not carry (matchSheet.notInSheet). */
  notInSheet: readonly ItemNumberMapping[];
  /** Every mapping, so a product that already has a number is never paired as "new". */
  mappings: readonly ItemNumberMapping[];
  targets: readonly TriageTarget[];
  /** Pairs the admin said "Not this" to (LikelyMatch.key); their lines fall to list 3. */
  dismissed?: ReadonlySet<string>;
}

export interface TriageResult {
  likely: LikelyMatch[];
  noMatch: SheetItem[];
}

export const strengthOf = (score: number): MatchStrength =>
  score >= 0.999 ? "strong" : "possible";

export const likelyKey = (item: SheetItem, t: CatalogRowRef): string =>
  `${item.key}\u0000${t.screen_id}\u0000${t.row_label}\u0000${t.price_col}`;

const cellKey = (screen_id: string, row_label: string) => `${screen_id}\u0000${row_label}`;

export function triageUnmatched(input: TriageInput): TriageResult {
  const dismissed = input.dismissed ?? new Set<string>();
  const currentOf = (t: CatalogRowRef): number | null => {
    const v = input.targets.find((x) => x.screen_id === t.screen_id)?.values[t.row_label]?.[
      t.price_col
    ];
    return typeof v === "number" ? v : null;
  };
  const candidates: LikelyMatch[] = [];

  // Renumbered: the product's old number is not on the sheet; which sheet line names it?
  const sheetIndex = buildNameIndex(input.unmatched, (it) => it.description);
  const seenOld = new Set<string>();
  for (const m of input.notInSheet) {
    const k = `${m.item_no}\u0000${cellKey(m.screen_id, m.row_label)}\u0000${m.price_col}`;
    if (seenOld.has(k)) continue;
    seenOld.add(k);
    const target = input.targets.find((t) => t.screen_id === m.screen_id);
    if (!target) continue;
    const hit = suggestSheetLine(m.row_label, sheetIndex);
    if (!hit) continue;
    const ref: CatalogRowRef = {
      screen_id: m.screen_id,
      category: target.category,
      row_label: m.row_label,
      price_col: m.price_col,
    };
    candidates.push({
      key: likelyKey(hit.item, ref),
      item: hit.item,
      target: ref,
      score: hit.score,
      strength: strengthOf(hit.score),
      kind: "renumbered",
      oldItemNo: m.item_no,
      currentPrice: currentOf(ref),
    });
  }

  // New: products with no item number at all, named by an unmatched sheet line.
  const mapped = new Set(input.mappings.map((m) => cellKey(m.screen_id, m.row_label)));
  const gapRows: CatalogRowRef[] = [];
  for (const t of input.targets) {
    const priceCol = t.price_cols[0];
    if (!priceCol) continue;
    for (const r of t.rows)
      if (!mapped.has(cellKey(t.screen_id, r)))
        gapRows.push({
          screen_id: t.screen_id,
          category: t.category,
          row_label: r,
          price_col: priceCol,
        });
  }
  const gapIndex = buildNameIndex(gapRows, (r) => r.row_label);
  for (const it of input.unmatched) {
    const hit = suggestCatalogRow(it.description, gapIndex);
    if (!hit) continue;
    candidates.push({
      key: likelyKey(it, hit.row),
      item: it,
      target: hit.row,
      score: hit.score,
      strength: strengthOf(hit.score),
      kind: "new",
      currentPrice: currentOf(hit.row),
    });
  }

  // One line pairs once, one product pairs once: strongest first, renumbered before new on a tie
  // (an old number is the better explanation of a line than a bare name).
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (a.kind === b.kind ? 0 : a.kind === "renumbered" ? -1 : 1) ||
      a.item.rowIndex - b.item.rowIndex,
  );
  const usedLines = new Set<string>();
  const usedCells = new Set<string>();
  const likely: LikelyMatch[] = [];
  for (const c of candidates) {
    if (dismissed.has(c.key)) continue;
    const cell = cellKey(c.target.screen_id, c.target.row_label);
    if (usedLines.has(c.item.key) || usedCells.has(cell)) continue;
    usedLines.add(c.item.key);
    usedCells.add(cell);
    likely.push(c);
  }
  likely.sort((a, b) => a.item.rowIndex - b.item.rowIndex);
  const noMatch = input.unmatched.filter((it) => !usedLines.has(it.key));
  return { likely, noMatch };
}
