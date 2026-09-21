/**
 * Duro-Last price list import — the pure part (no I/O): header detection on a parsed sheet,
 * item-number normalisation and the match against the catalog item-number map. The admin tab
 * feeds it rows from SheetJS and shows the result; `applyPriceImport` (server) writes the cells.
 */

export type SheetCell = string | number | boolean | null | undefined;
export type SheetRow = SheetCell[];

/** One (item number → price cell) mapping, as stored in `catalog_item_numbers`. */
export interface ItemNumberMapping {
  item_no: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  dl_description?: string | null;
  last_price?: number | null;
  last_import_at?: string | null;
}

/** Item numbers compare case-insensitively with internal whitespace removed ("1312 BF" = "1312bf"). */
export const normalizeItemNo = (v: SheetCell): string =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

/** "$1,234.50" / " 12.5 " / 12.5 → number; anything else → null. */
export function parsePrice(v: SheetCell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const ITEM_HEADER =
  /\b(item|part|product|stock|sku)\b.*\b(no|num|number|#|code|id)\b|^(item|part|sku|item ?#|part ?#)$/i;
const DESC_HEADER = /descr|product name|^name$|^item$/i;
const PRICE_HEADER = /price|cost|\$|amount/i;

export interface HeaderGuess {
  headerRow: number;
  itemCol: number;
  descCol: number | null;
  priceCol: number | null;
}

/**
 * Find the header row and the item-number / description / price columns in a raw sheet. Scans
 * the first `scan` rows for a row with an item-number-looking header; the price column is the
 * first "price"/"cost" header, the description the first "descr…" header. Returns null when no
 * item-number header is found — the tab then falls back to manual column picks.
 */
export function guessHeader(rows: SheetRow[], scan = 40): HeaderGuess | null {
  for (let r = 0; r < Math.min(rows.length, scan); r++) {
    const row = rows[r] ?? [];
    let itemCol = -1;
    let descCol: number | null = null;
    let priceCol: number | null = null;
    row.forEach((cell, c) => {
      const h = String(cell ?? "").trim();
      if (!h) return;
      if (itemCol < 0 && ITEM_HEADER.test(h)) itemCol = c;
      else if (descCol === null && DESC_HEADER.test(h)) descCol = c;
      else if (priceCol === null && PRICE_HEADER.test(h)) priceCol = c;
    });
    if (itemCol >= 0) return { headerRow: r, itemCol, descCol, priceCol };
  }
  return null;
}

export interface SheetItem {
  rowIndex: number; // 0-based row in the sheet (for messages)
  itemNo: string; // as written
  key: string; // normalised
  description: string;
  price: number | null;
}

/** Read the data rows under the header with the picked columns; rows with no item number are skipped. */
export function readSheetItems(
  rows: SheetRow[],
  pick: { headerRow: number; itemCol: number; descCol: number | null; priceCol: number | null },
): SheetItem[] {
  const out: SheetItem[] = [];
  for (let r = pick.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const raw = row[pick.itemCol];
    const itemNo = String(raw ?? "").trim();
    if (!itemNo) continue;
    out.push({
      rowIndex: r,
      itemNo,
      key: normalizeItemNo(itemNo),
      description: pick.descCol === null ? "" : String(row[pick.descCol] ?? "").trim(),
      price: pick.priceCol === null ? null : parsePrice(row[pick.priceCol]),
    });
  }
  return out;
}

export interface MatchedUpdate {
  item: SheetItem;
  mapping: ItemNumberMapping;
}

export interface MatchResult {
  /** Sheet items whose item number is mapped and that carry a usable price (one per mapping target). */
  matched: MatchedUpdate[];
  /** Sheet items whose item number is mapped but whose price cell is blank / not a number. */
  noPrice: SheetItem[];
  /** Sheet items with no mapping at all — "no match, let you know". */
  unmatched: SheetItem[];
  /** Mapped item numbers that the sheet does not carry. */
  notInSheet: ItemNumberMapping[];
  /** Item numbers that appear more than once in the sheet (last one wins). */
  duplicatesInSheet: string[];
}

export function matchSheet(items: SheetItem[], mappings: ItemNumberMapping[]): MatchResult {
  const byKey = new Map<string, ItemNumberMapping[]>();
  for (const m of mappings) {
    const k = normalizeItemNo(m.item_no);
    if (!k) continue;
    const arr = byKey.get(k);
    if (arr) arr.push(m);
    else byKey.set(k, [m]);
  }
  const seen = new Map<string, SheetItem>();
  const duplicates = new Set<string>();
  for (const it of items) {
    if (seen.has(it.key)) duplicates.add(it.itemNo);
    seen.set(it.key, it); // last occurrence wins
  }
  const matched: MatchedUpdate[] = [];
  const noPrice: SheetItem[] = [];
  const unmatched: SheetItem[] = [];
  const hit = new Set<string>();
  for (const it of seen.values()) {
    const targets = byKey.get(it.key);
    if (!targets) {
      unmatched.push(it);
      continue;
    }
    hit.add(it.key);
    if (it.price === null) {
      noPrice.push(it);
      continue;
    }
    for (const mapping of targets) matched.push({ item: it, mapping });
  }
  const notInSheet = mappings.filter((m) => !hit.has(normalizeItemNo(m.item_no)));
  unmatched.sort((a, b) => a.rowIndex - b.rowIndex);
  matched.sort((a, b) => a.item.rowIndex - b.item.rowIndex);
  return { matched, noPrice, unmatched, notInSheet, duplicatesInSheet: [...duplicates] };
}
