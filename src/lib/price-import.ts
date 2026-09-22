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
const UNIT_HEADER = /unit of measure|^uom$|^unit$|^u\/m$/i;
const SIZE_HEADER = /^size$|^dimensions?$|^roll size$/i;

export interface HeaderGuess {
  headerRow: number;
  itemCol: number;
  descCol: number | null;
  priceCol: number | null;
  /** "Unit of Measure" column (EA / FT / BX …) when the sheet has one — shown in the review. */
  unitCol: number | null;
  /** "Size" column (5'4 X 100' …) — turns a roll price into the membrane matrix's $/sq ft. */
  sizeCol: number | null;
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
    let unitCol: number | null = null;
    let sizeCol: number | null = null;
    row.forEach((cell, c) => {
      const h = String(cell ?? "").trim();
      if (!h) return;
      if (itemCol < 0 && ITEM_HEADER.test(h)) itemCol = c;
      else if (descCol === null && DESC_HEADER.test(h)) descCol = c;
      else if (unitCol === null && UNIT_HEADER.test(h)) unitCol = c;
      else if (sizeCol === null && SIZE_HEADER.test(h)) sizeCol = c;
      else if (priceCol === null && PRICE_HEADER.test(h)) priceCol = c;
    });
    if (itemCol >= 0) return { headerRow: r, itemCol, descCol, priceCol, unitCol, sizeCol };
  }
  return null;
}

export interface SheetItem {
  rowIndex: number; // 0-based row in the sheet (for messages)
  itemNo: string; // as written
  key: string; // normalised
  description: string;
  price: number | null;
  unit: string;
  /** The sheet's Size cell as written ("5'4 X 100'"); "" when the sheet has no size column. */
  size: string;
}

/** Read the data rows under the header with the picked columns; rows with no item number are skipped. */
export function readSheetItems(
  rows: SheetRow[],
  pick: {
    headerRow: number;
    itemCol: number;
    descCol: number | null;
    priceCol: number | null;
    unitCol?: number | null;
    sizeCol?: number | null;
  },
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
      unit: pick.unitCol == null ? "" : String(row[pick.unitCol] ?? "").trim(),
      size: pick.sizeCol == null ? "" : String(row[pick.sizeCol] ?? "").trim(),
    });
  }
  return out;
}

/** The Duro-Last Membrane price matrix (priced in $/sq ft; the roll-goods list prices per roll). */
export const MEMBRANE_SCREEN_ID = "duro_last:duro_last_membrane";

/** One dimension of a size cell — feet with optional inches (5'4, 2'8", 10'), or inches alone (10"). */
const DIM = /(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"?)?|(\d+(?:\.\d+)?)\s*"/;
const dimFeet = (t: string): number | null => {
  const m = DIM.exec(t.trim());
  if (!m) return null;
  if (m[1] !== undefined) return Number(m[1]) + (m[2] !== undefined ? Number(m[2]) / 12 : 0);
  return Number(m[3]) / 12;
};

/**
 * Roll area (sq ft) from a Duro-Last "Size" cell — `5'4 X 100'`, `2'8" X 100'`, `10' X 100'`,
 * `10" X 100'- STRIPPING`. Null when the cell is not two dimensions.
 */
export function rollAreaSqFt(size: string): number | null {
  const parts = size.split(/\s*[x×]\s*/i);
  if (parts.length < 2) return null;
  const a = dimFeet(parts[0]!);
  const b = dimFeet(parts[1]!);
  if (a === null || b === null || a <= 0 || b <= 0) return null;
  return a * b;
}

/**
 * A roll-goods line's $/sq ft for the membrane matrix: roll price ÷ roll area, rounded to the
 * cent as Duro-Last's own per-sq-ft membrane sheet is. Null when the line has no price or no
 * readable size (the review then reports it instead of writing a per-roll figure into the cell).
 */
export function membranePerSqFt(item: Pick<SheetItem, "price" | "size">): number | null {
  if (item.price === null) return null;
  const area = rollAreaSqFt(item.size);
  if (area === null) return null;
  return Math.round((item.price / area) * 100) / 100;
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

/* ------------------------------------------------------------------------------------------------
 * "Duro-Last Membrane" sheet — no item numbers: Description / Mil / Color / Price per SqFt rows
 * that map straight onto the Duro-Last Membrane price matrix (row "Duro-Last - {mil}mil
 * {Description}", column = colour).
 * ---------------------------------------------------------------------------------------------- */

export interface MembraneItem {
  rowIndex: number;
  description: string;
  mil: number;
  color: string;
  price: number | null;
}

const MEMBRANE_DESC = /^descr/i;
const MEMBRANE_MIL = /^mil$|thickness/i;
const MEMBRANE_COLOR = /^colou?r$/i;

/** Header row + columns of a membrane sheet, or null when the sheet is not one. */
export function guessMembraneHeader(
  rows: SheetRow[],
  scan = 20,
): {
  headerRow: number;
  descCol: number;
  milCol: number;
  colorCol: number;
  priceCol: number;
} | null {
  for (let r = 0; r < Math.min(rows.length, scan); r++) {
    const row = rows[r] ?? [];
    let descCol = -1;
    let milCol = -1;
    let colorCol = -1;
    let priceCol = -1;
    row.forEach((cell, c) => {
      const h = String(cell ?? "").trim();
      if (!h) return;
      if (descCol < 0 && MEMBRANE_DESC.test(h)) descCol = c;
      else if (milCol < 0 && MEMBRANE_MIL.test(h)) milCol = c;
      else if (colorCol < 0 && MEMBRANE_COLOR.test(h)) colorCol = c;
      else if (priceCol < 0 && PRICE_HEADER.test(h)) priceCol = c;
    });
    if (descCol >= 0 && milCol >= 0 && colorCol >= 0 && priceCol >= 0)
      return { headerRow: r, descCol, milCol, colorCol, priceCol };
  }
  return null;
}

export function readMembraneSheet(rows: SheetRow[]): MembraneItem[] {
  const h = guessMembraneHeader(rows);
  if (!h) return [];
  const out: MembraneItem[] = [];
  for (let r = h.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const description = String(row[h.descCol] ?? "").trim();
    const mil = Number(String(row[h.milCol] ?? "").replace(/[^\d.]/g, ""));
    const color = String(row[h.colorCol] ?? "").trim();
    if (!description || !Number.isFinite(mil) || mil <= 0 || !color) continue;
    out.push({ rowIndex: r, description, mil, color, price: parsePrice(row[h.priceCol]) });
  }
  return out;
}

/** The catalog row label the legacy matrix uses for a membrane sheet line. */
export const membraneRowLabel = (mil: number, description: string): string =>
  `Duro-Last - ${mil}mil ${description}`;

export interface MembraneUpdate {
  item: MembraneItem;
  row_label: string;
  price_col: string;
}

export interface MembraneMatchResult {
  matched: MembraneUpdate[];
  noPrice: MembraneItem[];
  unmatched: { item: MembraneItem; reason: string }[];
}

const foldKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Match membrane sheet lines onto the matrix's rows (by label) and colour columns. */
export function matchMembrane(
  items: MembraneItem[],
  target: { rows: string[]; price_cols: string[] },
): MembraneMatchResult {
  const rowByKey = new Map(target.rows.map((r) => [foldKey(r), r]));
  const colByKey = new Map(target.price_cols.map((c) => [foldKey(c), c]));
  const matched: MembraneUpdate[] = [];
  const noPrice: MembraneItem[] = [];
  const unmatched: { item: MembraneItem; reason: string }[] = [];
  for (const item of items) {
    const label = membraneRowLabel(item.mil, item.description);
    const row = rowByKey.get(foldKey(label));
    if (!row) {
      unmatched.push({ item, reason: `no matrix row "${label}"` });
      continue;
    }
    const col = colByKey.get(foldKey(item.color));
    if (!col) {
      unmatched.push({ item, reason: `no "${item.color}" colour column` });
      continue;
    }
    if (item.price === null) {
      noPrice.push(item);
      continue;
    }
    matched.push({ item, row_label: row, price_col: col });
  }
  return { matched, noPrice, unmatched };
}

/* ------------------------------------------------------------------------------------------------
 * Layout memory — a header row's cells, joined, identify a sheet layout so the next file with
 * the same headings skips the column picks.
 * ---------------------------------------------------------------------------------------------- */

export const headerSignature = (row: SheetRow | undefined): string =>
  (row ?? [])
    .map((c) =>
      String(c ?? "")
        .trim()
        .toLowerCase(),
    )
    .join("|")
    .replace(/\|+$/, "");

/* ------------------------------------------------------------------------------------------------
 * Name matching — suggest a catalog product for a sheet line (and vice versa) from the words
 * they share. Deliberately conservative: a suggestion is a checklist item, never auto-applied.
 * ---------------------------------------------------------------------------------------------- */

const ABBREVIATIONS: Record<string, string> = {
  WHT: "WHITE",
  WH: "WHITE",
  GRY: "GRAY",
  GREY: "GRAY",
  DKGRY: "DARKGRAY",
  "D/GRY": "DARKGRAY",
  DGRY: "DARKGRAY",
  BLK: "BLACK",
  BRNZ: "BRONZE",
  BRZ: "BRONZE",
  BRN: "BROWN",
  TC: "TERRACOTTA",
  "TERRA COTTA": "TERRACOTTA",
  SS: "STAINLESS",
  GALV: "GALVANIZED",
  ALUM: "ALUMINUM",
  AL: "ALUMINUM",
  ADH: "ADHESIVE",
  FASTNR: "FASTENER",
  FAST: "FASTENER",
  SCR: "SCREW",
  INSUL: "INSULATION",
  INSULAT: "INSULATION",
  MEMB: "MEMBRANE",
  FLASH: "FLASHING",
  FLSH: "FLASHING",
  PLT: "PLATE",
  BT: "BOOT",
  "I/C": "INSIDE",
  "O/C": "OUTSIDE",
  BF: "BUTTERFLY",
  SQ: "SQUARE",
  DL: "DUROLAST",
  "DURO-LAST": "DUROLAST",
  DUROLAST: "DUROLAST",
};
/**
 * Words that mark a product VARIANT: present on one side only, the two names are different
 * products (Duro-Caulk vs Duro-Caulk Plus, DensDeck vs DensDeck Prime).
 */
const VARIANT_MARKERS = new Set([
  "PLUS",
  "PLS",
  "ADVANCED",
  "LVOC",
  "HD",
  "XHD",
  "EV",
  "ELVALOY",
  "PRIME",
  "MINI",
  "JUMBO",
  "LONG",
  "SHORT",
  "FLEECE",
  "TPO",
  "PVC",
]);
const COLOURS = new Set([
  "WHITE",
  "TAN",
  "GRAY",
  "DARKGRAY",
  "BLACK",
  "BRONZE",
  "BROWN",
  "TERRACOTTA",
  "GREEN",
  "BLUE",
  "COPPER",
  "PATINA",
  "CHARCOAL",
  "RED",
  "YELLOW",
  "CLEAR",
]);
/** Unit / packaging words that carry no product meaning. */
const NOISE = new Set([
  "EA",
  "BX",
  "BG",
  "RL",
  "PK",
  "CS",
  "CTN",
  "BOX",
  "BAG",
  "CASE",
  "ROLL",
  "EACH",
  "PER",
  "OF",
  "THE",
  "AND",
  "W",
  "WITH",
  "X",
]);

/** Comparable word set of a product / sheet name (abbreviations expanded, noise dropped). */
export function nameTokens(name: string): Set<string> {
  let s = name.toUpperCase().replace(/DARK\s+GRAY|DARK\s+GREY|D\/GRY|DK\s*GRY/g, " DARKGRAY ");
  s = s.replace(/TERRA\s*-?\s*COTTA/g, " TERRACOTTA ").replace(/DURO\s*-\s*LAST/g, " DUROLAST ");
  // "40MIL" → "40 MIL" so the number and the word compare separately; sizes keep their digits;
  // "6X6" → "6 6" so a dimension pair compares as two sizes.
  s = s.replace(/(\d)\s*MIL\b/g, "$1 MIL ").replace(/(\d)X(\d)/g, "$1 $2");
  const out = new Set<string>();
  for (const raw of s.split(/[^A-Z0-9/.']+/)) {
    if (!raw) continue;
    let t = raw.replace(/^\/+|\/+$/g, "");
    if (!t) continue;
    t = ABBREVIATIONS[t] ?? t;
    if (NOISE.has(t)) continue;
    // Feet/inch marks: 10' → 10, 5'4" → 5'4 (kept whole so it stays one size token).
    t = t.replace(/["']+$/, "");
    if (!t) continue;
    // Plurals: PLATES → PLATE, GRATES → GRATE (not GLASS, PLUS, RADIUS or a known word).
    if (
      /[A-Z]{3,}S$/.test(t) &&
      !/(SS|US|IS)$/.test(t) &&
      !VARIANT_MARKERS.has(t) &&
      !COLOURS.has(t)
    )
      t = t.slice(0, -1);
    out.add(t);
  }
  return out;
}

export interface NameMatch {
  /** 0..1 — the share of the catalog name's words the sheet line carries. */
  score: number;
}

const isSizeToken = (t: string) => /^[\d/.'x-]+$/i.test(t);

/** `nameMatchScore` on already-tokenised names (the indexed path). */
export function scoreTokenSets(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 || b.size === 0) return null;
  // A catalog name that is only a size ("3 1/2\"") names nothing on its own — never suggest.
  if ([...a].every(isSizeToken)) return null;
  const aColour = [...a].find((t) => COLOURS.has(t));
  const bColour = [...b].find((t) => COLOURS.has(t));
  if (aColour && bColour && aColour !== bColour) return null;
  for (const t of VARIANT_MARKERS) if (a.has(t) !== b.has(t)) return null;
  // Inside vs outside (corners) are opposites, like two colours.
  if ((a.has("INSIDE") && b.has("OUTSIDE")) || (a.has("OUTSIDE") && b.has("INSIDE"))) return null;
  let matched = 0;
  for (const t of a) {
    if (b.has(t)) matched++;
    else if (/\d/.test(t)) return null; // a size in the catalog name the sheet does not carry
  }
  if (matched < Math.min(2, a.size)) return null;
  const score = matched / a.size;
  return score >= 0.6 ? score : null;
}

/**
 * How well a sheet description names a catalog product. Every word of the catalog name must be
 * covered for a perfect 1; a colour on both sides that differs, or a size number in the catalog
 * name the sheet lacks, is a hard reject. At least two shared words (or one when the catalog
 * name is a single word) and 60% coverage.
 */
export function nameMatchScore(catalogName: string, sheetDescription: string): number | null {
  return scoreTokenSets(nameTokens(catalogName), nameTokens(sheetDescription));
}

/**
 * Names tokenised once, with a word → entries index so a lookup only scores the entries that
 * share a real word with the query (a 13,000-line sheet × 100 products stays instant).
 */
export interface NameIndex<T> {
  entries: { value: T; tokens: Set<string> }[];
  postings: Map<string, number[]>;
}
export function buildNameIndex<T>(values: readonly T[], nameOf: (v: T) => string): NameIndex<T> {
  const entries = values.map((value) => ({ value, tokens: nameTokens(nameOf(value)) }));
  const postings = new Map<string, number[]>();
  entries.forEach((e, i) => {
    for (const t of e.tokens) {
      if (isSizeToken(t)) continue;
      const arr = postings.get(t);
      if (arr) arr.push(i);
      else postings.set(t, [i]);
    }
  });
  return { entries, postings };
}
const isIndex = <T>(v: readonly T[] | NameIndex<T>): v is NameIndex<T> =>
  !Array.isArray(v) && "postings" in v;
/** Entries sharing at least one non-size word with `tokens`. */
function candidates<T>(index: NameIndex<T>, tokens: Set<string>): Set<number> {
  const out = new Set<number>();
  for (const t of tokens) {
    if (isSizeToken(t)) continue;
    for (const i of index.postings.get(t) ?? []) out.add(i);
  }
  return out;
}

export interface CatalogRowRef {
  screen_id: string;
  category: string;
  row_label: string;
  price_col: string;
}

/** The best catalog product for a sheet line, or null when nothing is close. */
export function suggestCatalogRow(
  description: string,
  rows: readonly CatalogRowRef[] | NameIndex<CatalogRowRef>,
): { row: CatalogRowRef; score: number } | null {
  const index = isIndex(rows) ? rows : buildNameIndex(rows, (r) => r.row_label);
  const b = nameTokens(description);
  let best: { row: CatalogRowRef; score: number } | null = null;
  for (const i of candidates(index, b)) {
    const e = index.entries[i]!;
    const score = scoreTokenSets(e.tokens, b);
    if (score === null) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && e.value.row_label.length > best.row.row_label.length)
    )
      best = { row: e.value, score };
  }
  return best;
}

/** The best sheet line for a catalog product, or null. Prefers the shortest exact-coverage line. */
export function suggestSheetLine(
  rowLabel: string,
  items: readonly SheetItem[] | NameIndex<SheetItem>,
): { item: SheetItem; score: number } | null {
  const index = isIndex(items) ? items : buildNameIndex(items, (it) => it.description);
  const a = nameTokens(rowLabel);
  let best: { item: SheetItem; score: number } | null = null;
  for (const i of candidates(index, a)) {
    const e = index.entries[i]!;
    const score = scoreTokenSets(a, e.tokens);
    if (score === null) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && e.value.description.length < best.item.description.length)
    )
      best = { item: e.value, score };
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * Unit conversion — the catalog prices some screens per BOX / BAG / PACKAGE ("Price/Box" with a
 * "Fasteners/Box" quantity) or per PART ("Price/Part" with "Parts/Bag"), while the Duro-Last
 * list prices the same product per EA or per BG. A sheet price is converted to the catalog's
 * basis before it is written, never copied across.
 * ---------------------------------------------------------------------------------------------- */

export type PriceBasis = "pack" | "each" | "other";

/** What a catalog price column is per: "Price/Box" → pack, "Price/Part" → each, "Price" → other. */
export function catalogPriceBasis(priceCol: string): PriceBasis {
  const m = /\/\s*([a-z]+)\s*$/i.exec(priceCol);
  const unit = (m?.[1] ?? "").toUpperCase();
  if (["BOX", "BAG", "PACKAGE", "PKG", "PACK", "CASE", "CTN", "CARTON"].includes(unit))
    return "pack";
  if (["PART", "EACH", "EA", "PIECE", "PC"].includes(unit)) return "each";
  return "other";
}

/** What a sheet "Unit of Measure" is per: EA → each, BX / BG / PK / CS → pack, FT / RL / GL → other. */
export function sheetUnitBasis(unit: string): PriceBasis {
  const u = unit.trim().toUpperCase();
  if (["EA", "EACH", "PC", "PCS", "PIECE"].includes(u)) return "each";
  if (["BX", "BOX", "BG", "BAG", "PK", "PKG", "PACK", "CS", "CASE", "CTN", "CARTON"].includes(u))
    return "pack";
  return "other";
}

export interface ConvertedPrice {
  price: number;
  /** Shown on the review when the figure is not the sheet price as written. */
  note?: string;
}

/**
 * Convert a sheet price to the catalog column's basis. Returns `{ error }` when the two bases
 * differ and the row has no usable pack quantity — the review reports it and writes nothing.
 */
export function convertSheetPrice(args: {
  priceCol: string;
  sheetUnit: string;
  sheetPrice: number;
  packQty: number | null | undefined;
  packCol?: string | undefined;
}): ConvertedPrice | { error: string } {
  const cat = catalogPriceBasis(args.priceCol);
  const sh = sheetUnitBasis(args.sheetUnit);
  if (cat === "other" || sh === "other" || cat === sh) return { price: args.sheetPrice };
  const qty = args.packQty ?? null;
  if (qty === null || !(qty > 0))
    return {
      error: `sheet prices per ${args.sheetUnit.toUpperCase()} but the catalog column is ${args.priceCol} and the row has no ${args.packCol ?? "pack quantity"}`,
    };
  if (cat === "pack" && sh === "each")
    return {
      price: Math.round(args.sheetPrice * qty * 1000) / 1000,
      note: `${args.sheetPrice} per ${args.sheetUnit.toUpperCase()} × ${qty} ${args.packCol ?? "per pack"}`,
    };
  return {
    price: Math.round((args.sheetPrice / qty) * 1000) / 1000,
    note: `${args.sheetPrice} per ${args.sheetUnit.toUpperCase()} ÷ ${qty} ${args.packCol ?? "per pack"}`,
  };
}
