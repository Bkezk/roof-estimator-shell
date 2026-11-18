/**
 * Inventory › Count, what the count sheet works out in the browser (owner, Nov 16: "is it as
 * efficient and good as it could be especially with the reconciliation part").
 *
 * The screen (inventory-count-tab.tsx) is a sheet of every item a place has ever held, a box to
 * type each count in, and one Save. Everything it has to decide from what was typed is here, so
 * it can be tested without a browser:
 *   - what a line's boxes mean (a box of 1,000 fasteners is counted as whole boxes plus loose
 *     fasteners, as the Record dialog takes them; a line with every box blank is NOT counted);
 *   - a line's difference in units and, for an admin or a manager, in dollars;
 *   - when the "cost per unit" box is offered and what it changes;
 *   - the line above the sheet ("12 of 80 lines counted · 3 differ");
 *   - exactly what a save sends (only counted lines; a cost only where its box is shown);
 *   - the two searches, and the sheet as a file to print and fill in by hand.
 *
 * Nothing here is the last word: the server reads what inventory expected again when the count
 * is saved (inventory-count.functions.ts saveCountWith) and refuses a cost from anyone who may
 * not see dollars. This file only shows the counter what is about to happen.
 *
 * Pure: no React, no database, no clock.
 */
import { cents, countDifference, parsePrice } from "@/lib/inventory-cost";
import type { CountSheetLine, LaterEntry } from "@/lib/inventory-count.functions";
import { packUnitLabel, plural, type PieceDef } from "@/lib/stock-units";

/** A product that can be stocked, for "Add an item" (the Inventory page's own product list). */
export interface CountProduct {
  ref: { screen_id: string; row_label: string; price_col: string };
  key: string;
  name: string;
  variant: string; // colour / size, "" when there is none
  category: string;
  itemNos: string[];
  unit: string;
  piece: PieceDef | null;
}

/** One line of the sheet, as the server sends it (an added item is given the same shape). */
export type SheetLine = CountSheetLine;

// ── Entries typed in since the count day (owner, Nov 18, of the audit) ─────────────────────────
// A count dated to an earlier day is compared with what inventory held at the end of that day.
// Something typed in since then that really happened on or before the day (a use logged late)
// was corrected for twice: once by the count, which saw the shelf without it, and once by the
// late entry. The sheet now lists such entries under their line; ticking one says "this was
// before the count", and the save moves it into the count day.

export type { LaterEntry };

/** The entries typed in since the count day for a line (none on today's sheet). */
export const laterOf = (l: { later?: LaterEntry[] | undefined }): LaterEntry[] => l.later ?? [];

/**
 * The line as the count sees it once the ticked entries count as before the count day: what
 * inventory expected, with those entries taken in. 10 expected and a late "2 used" ticked is 8
 * expected, so a count of 8 is no difference.
 */
export function withEarlier<T extends { expected: number; later?: LaterEntry[] | undefined }>(
  line: T,
  before: ReadonlySet<number>,
): T {
  const moved = laterOf(line)
    .filter((e) => before.has(e.id))
    .reduce((n, e) => n + e.qty, 0);
  return moved === 0 ? line : { ...line, expected: r3(line.expected + moved) };
}

/** What the save sends as `before_ids`: the ticked entries of the lines that are counted. */
export function earlierIds(
  lines: readonly (StateLine & { later?: LaterEntry[] | undefined })[],
  typed: Readonly<Record<string, TypedLine>>,
  opts: SheetOptions,
  before: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  for (const l of lines) {
    if (lineState(l, typed[lineKey(l)], opts).counted == null) continue;
    for (const e of laterOf(l)) if (before.has(e.id)) out.push(e.id);
  }
  return out;
}

/** How many entries were typed in since the count day, over the whole sheet. */
export const laterCount = (lines: readonly { later?: LaterEntry[] | undefined }[]): number =>
  lines.reduce((n, l) => n + laterOf(l).length, 0);

/** The line above a past day's sheet that has such entries; null when it has none. */
export function laterBanner(n: number, day: string): string | null {
  if (n <= 0) return null;
  const d = fmtDay(day);
  return `${n === 1 ? "1 entry was" : `${n} entries were`} typed in after ${d} for items on this sheet. ${n === 1 ? "It is" : "They are"} shown under ${n === 1 ? "its" : "their"} item. Tick ${n === 1 ? "it if it" : "each one that"} happened on or before ${d}, so the count does not take it off twice. Leave it unticked if it happened after.`;
}

/** One such entry in words: "Jan 2 · Tyler M · 2 each Used on job · #6071 …". */
export function laterLine(e: LaterEntry, unit: string): string {
  const when = new Date(e.at).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
  const n = Math.abs(r3(e.qty));
  const amount = `${e.qty < 0 ? "−" : "+"}${n} ${packUnitLabel(n, unit)}`;
  return [when, e.who, `${amount} · ${e.what}`, e.job].filter(Boolean).join(" · ");
}

/** What is typed against one line: the boxes' TEXT, so a blank box stays blank and never 0. */
export interface TypedLine {
  /** The count in the stock unit; "whole boxes" for a pack of pieces. */
  packs: string;
  /** Loose pieces, for a pack of pieces. */
  pieces: string;
  /** Cost per stock unit, where the cost box is shown. */
  cost: string;
}
export const BLANK_LINE: TypedLine = { packs: "", pieces: "", cost: "" };

type CellRef = { screen_id: string; row_label: string; price_col: string };

/** One item on the sheet. The same text as a CountProduct's key, so the two can be matched. */
export const lineKey = (c: CellRef): string => `${c.screen_id}|${c.row_label}|${c.price_col}`;

export const NOT_A_COUNT = "Type a number, 0 or more";
export const NOT_A_PRICE = "Type a price, like 12.50";
export const TOO_BIG = "That number is too big";
/** The most a save accepts (saveCountSchema). */
const MAX_COUNT = 10_000_000;
const MAX_COST = 1_000_000;

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
/** A quantity as text: three decimals at most, no trailing zeros ("2.15", "3"). */
const qty = (n: number): string => String(r3(n));

/**
 * One box's text: null when blank, NaN when it is not a plain number at or above zero. Plain
 * digits only ("1e3" and "0x10" are numbers to JavaScript and typing mistakes to a person);
 * "1,000" is one thousand, but "2,5" is refused rather than read as 25.
 */
function boxNumber(text: string): number | null {
  let t = text.trim();
  if (t === "") return null;
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return NaN;
  return Number(t);
}

export type TypedCount = { counted: number; note: string | null } | { error: string } | null;

/**
 * What a line's boxes mean. Null while every box is blank: the line is not counted and a save
 * leaves it alone. Otherwise the count in the stock unit to three decimals (as it is stored),
 * or an error for something that is not a number at or above zero.
 *
 * An item with pieces has two boxes, either or both filled: 2 boxes + 150 of 1,000 fasteners is
 * 2.15. The note says how it was typed, and is written only when pieces were typed. It ALWAYS
 * names both amounts ("0 boxes + 150 fasteners"): the note is kept on the correcting entry, whose
 * quantity is the difference, and a bare "150 fasteners" there would be read back as a pack
 * size (stock-units.ts pieceFromCountedNotes). The pieces box of an item without pieces is
 * ignored.
 */
export function typedCount(
  packsText: string,
  piecesText: string,
  unit: string,
  piece: PieceDef | null | undefined,
): TypedCount {
  const def = piece && Number.isFinite(piece.perPack) && piece.perPack > 0 ? piece : null;
  const packs = boxNumber(packsText);
  const pieces = def ? boxNumber(piecesText) : null;
  if (Number.isNaN(packs) || Number.isNaN(pieces)) return { error: NOT_A_COUNT };
  if (packs == null && pieces == null) return null;
  const whole = packs ?? 0;
  const counted = r3(whole + (def && pieces != null ? pieces / def.perPack : 0));
  if (counted > MAX_COUNT) return { error: TOO_BIG };
  const note =
    def && pieces != null
      ? `${qty(whole)} ${packUnitLabel(whole, unit)} + ${qty(pieces)} ${plural(pieces, def.name)}`
      : null;
  return { counted, note };
}

export interface SheetOptions {
  /** "This is the opening count" is ticked. */
  opening: boolean;
  /** The server says the reader sees dollars (sheet.dollars). */
  dollars: boolean;
}

export interface LineState {
  key: string;
  /** In the stock unit; null when the line is not counted (blank, or a typing mistake). */
  counted: number | null;
  /** How a pack of pieces was typed ("2 boxes + 150 fasteners"). */
  note: string | null;
  /** The counted boxes hold something that is not a count. */
  error: string | null;
  /** Counted minus expected; null when not counted. */
  diff: number | null;
  /** The difference in dollars; null when not counted, not known, or dollars are not shown. */
  value: number | null;
  /** The cost box is offered on this line. */
  costShown: boolean;
  /** The cost typed in a cost box that is shown; null when blank. */
  unitCost: number | null;
  costError: string | null;
}

type StateLine = Pick<
  SheetLine,
  "screen_id" | "row_label" | "price_col" | "unit" | "piece" | "expected" | "avg"
>;

/**
 * One line worked out from what is typed against it.
 *
 * The cost box is offered only to a reader who sees dollars, on a line counted ABOVE what was
 * expected (only stock coming in can carry a cost), and only when a cost is worth asking: on the
 * opening count, where the stock found is being loaded for the first time, or when inventory
 * has no cost for the item at all. A cost left in a box that is no longer shown counts for
 * nothing.
 *
 * Dollars: the difference at the item's average cost, except where a cost was typed, which is
 * what the stock found will come in at.
 */
export function lineState(
  line: StateLine,
  typed: TypedLine | undefined,
  opts: SheetOptions,
): LineState {
  const t = typed ?? BLANK_LINE;
  const out: LineState = {
    key: lineKey(line),
    counted: null,
    note: null,
    error: null,
    diff: null,
    value: null,
    costShown: false,
    unitCost: null,
    costError: null,
  };
  const read = typedCount(t.packs, t.pieces, line.unit, line.piece);
  if (read == null) return out;
  if ("error" in read) return { ...out, error: read.error };
  const { diff, value } = countDifference(line.expected, read.counted, line.avg);
  out.counted = read.counted;
  out.note = read.note;
  out.diff = diff;
  if (!opts.dollars) return out;
  out.value = value;
  out.costShown = diff > 0 && (opts.opening || line.avg == null);
  if (out.costShown && t.cost.trim() !== "") {
    const cost = parsePrice(t.cost);
    if (cost == null) out.costError = NOT_A_PRICE;
    else if (cost > MAX_COST) out.costError = TOO_BIG;
    else {
      out.unitCost = cost;
      out.value = diff * cost;
    }
  }
  return out;
}

export interface SheetSummary {
  /** Every line on the sheet. */
  lines: number;
  counted: number;
  /** Counted lines whose count is not what was expected. */
  differ: number;
  /** The differences in dollars that are known, added up, to the cent. */
  value: number;
  /** A line that differs has no cost, so `value` is not the whole story. */
  missingCost: boolean;
  /** Lines with a typing mistake, in a count box or a cost box. */
  errors: number;
}

/**
 * The line above the sheet. `value` and `missingCost` mean something only for a reader who sees
 * dollars: for anyone else every line's value is null and the screen shows neither.
 */
export function sheetSummary(
  states: readonly Pick<LineState, "counted" | "diff" | "value" | "error" | "costError">[],
): SheetSummary {
  const out: SheetSummary = {
    lines: states.length,
    counted: 0,
    differ: 0,
    value: 0,
    missingCost: false,
    errors: 0,
  };
  for (const s of states) {
    if (s.error || s.costError) out.errors += 1;
    if (s.counted == null || s.diff == null) continue;
    out.counted += 1;
    if (s.diff === 0) continue;
    out.differ += 1;
    if (s.value == null) out.missingCost = true;
    else out.value += s.value;
  }
  out.value = cents(out.value);
  return out;
}

/** One line of a save (saveCountSchema's `lines`). */
export interface SaveLine {
  screen_id: string;
  row_label: string;
  price_col: string;
  counted: number;
  counted_note?: string;
  unit_cost?: number;
}

/**
 * What a save sends: the counted lines only (a blank line is not on the count, so inventory
 * leaves it as it is), each with how it was typed when it is a pack of pieces, and a cost only
 * where the cost box is shown and filled.
 */
export function saveLines(
  lines: readonly StateLine[],
  typed: Readonly<Record<string, TypedLine>>,
  opts: SheetOptions,
): SaveLine[] {
  const out: SaveLine[] = [];
  for (const l of lines) {
    const s = lineState(l, typed[lineKey(l)], opts);
    if (s.counted == null) continue;
    const row: SaveLine = {
      screen_id: l.screen_id,
      row_label: l.row_label,
      price_col: l.price_col,
      counted: s.counted,
    };
    if (s.note != null) row.counted_note = s.note;
    if (s.unitCost != null) row.unit_cost = s.unitCost;
    out.push(row);
  }
  return out;
}

/** Every word typed is somewhere in one of the fields, whatever the case; "#123" finds 123. */
function everyWord(fields: readonly string[], text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^#+/, ""))
    .filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map((f) => f.toLowerCase());
  return words.every((w) => hay.some((f) => f.includes(w)));
}

/** The sheet's search box: a blank box shows every line. */
export function matchesSearch(
  line: Pick<SheetLine, "item" | "colour" | "category" | "item_nos">,
  text: string,
): boolean {
  return everyWord([line.item, line.colour, line.category, ...line.item_nos], text);
}

const productLabel = (p: CountProduct): string => (p.variant ? `${p.name} · ${p.variant}` : p.name);

/**
 * "Add an item": the products that match, an exact item number first, then by name; `limit` at
 * most. Nothing until something is typed: the whole catalog is not a useful list.
 */
export function searchProducts(
  products: readonly CountProduct[],
  text: string,
  limit = 20,
): CountProduct[] {
  const f = text.trim().toLowerCase().replace(/^#+/, "");
  if (!f) return [];
  const exact = (p: CountProduct) => (p.itemNos.some((n) => n.toLowerCase() === f) ? 0 : 1);
  return products
    .filter((p) => everyWord([p.name, p.variant, p.category, ...p.itemNos], text))
    .sort(
      (a, b) =>
        exact(a) - exact(b) ||
        productLabel(a).localeCompare(productLabel(b), "en", { numeric: true }),
    )
    .slice(0, limit);
}

/**
 * A product as a sheet line for something the place has never held: nothing is expected, and
 * the browser knows no cost for it (the server works the cost out when the count is saved).
 */
export function lineFromProduct(p: CountProduct): SheetLine {
  return {
    screen_id: p.ref.screen_id,
    row_label: p.ref.row_label,
    price_col: p.ref.price_col,
    item: p.name,
    colour: p.variant,
    category: p.category,
    unit: p.unit,
    piece: p.piece,
    item_nos: p.itemNos,
    expected: 0,
    avg: null,
    estimated: false,
  };
}

/**
 * Rows under a heading per category, the categories and the rows in the order they came (the
 * server sorts the sheet; an item added by hand lands at the end of its category).
 */
export function groupByCategory<T>(
  rows: readonly T[],
  categoryOf: (row: T) => string,
): { category: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const c = categoryOf(r).trim() || "Other";
    const list = groups.get(c);
    if (list) list.push(r);
    else groups.set(c, [r]);
  }
  return [...groups.entries()].map(([category, list]) => ({ category, rows: list }));
}

/** The sheet as a file to print and fill in by hand: Counted is left blank for the pen. */
export function printSheetRows(sheet: {
  lines: readonly Pick<SheetLine, "category" | "item" | "colour" | "unit" | "expected">[];
}): string[][] {
  return [
    ["Category", "Item", "Colour", "Unit", "Expected", "Counted"],
    ...sheet.lines.map((l) => [l.category, l.item, l.colour, l.unit, qty(l.expected), ""]),
  ];
}

/** "count-sheet-truck-2-2026-12-31.csv": the place's name, lower case, dashes for the rest. */
export const printSheetFileName = (place: string, day: string): string =>
  `count-sheet-${
    place
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "place"
  }-${day}.csv`;

/**
 * A difference with its sign: "+2", "−1.5", "0". The sign is always written so a difference
 * never rests on red and green alone.
 */
export function signedQty(n: number): string {
  const r = r3(n);
  if (r === 0) return "0";
  return r < 0 ? `−${Math.abs(r)}` : `+${r}`;
}

/** "2026-12-31" as "Dec 31, 2026". The day is a calendar day, so no time zone moves it. */
export function fmtDay(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
