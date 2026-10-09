/**
 * Pure helpers for the close-out's "From my truck" list (materials-section.tsx,
 * docs/service-module-design.md §5.3 / §12.5): cell keys, what a count reads as (pieces or the
 * pack unit), what this ticket already used of a cell, the usual-for-this-repair suggestion and
 * how a "−" is taken back.
 *
 * Stock and the ledger are kept in PACKS (a decimal of the priced pack); the tech counts in
 * PIECES when the catalog says how many one pack holds (cartridges, fasteners), else in the
 * pack unit. "Units" below means whichever of the two the tech counts in.
 */
import { looseMatch } from "@/lib/material-aliases";
import { pieceFromCountedNotes, plural, type PieceDef } from "@/lib/stock-units";

export interface CatalogCell {
  screen_id: string;
  row_label: string;
  price_col: string;
}
export interface LocatedCell extends CatalogCell {
  location_id: string;
}

/** One catalog cell regardless of where it sits. */
export const catalogKey = (c: CatalogCell) =>
  `${c.screen_id}\u0000${c.row_label}\u0000${c.price_col}`;
/** One catalog cell at one location (a truck). */
export const cellKey = (c: LocatedCell) => `${c.location_id}\u0000${catalogKey(c)}`;

export const EPS = 1e-6;
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** "3", "1.25", "0.083" — at most `dec` decimals, no trailing zeros. */
export function fmtNum(n: number, dec = 3): string {
  const r = Math.round(n * 10 ** dec) / 10 ** dec;
  if (Math.abs(r - Math.round(r)) < EPS) return String(Math.round(r));
  return r.toFixed(dec).replace(/\.?0+$/, "");
}

/** Units the tech counts per pack: pieces per pack, or 1 when counting whole packs. */
export const unitsPerPack = (piece: PieceDef | null | undefined) =>
  piece && piece.perPack > 0 ? piece.perPack : 1;
export const packsToUnits = (packs: number, piece: PieceDef | null | undefined) =>
  round6(packs * unitsPerPack(piece));
export const unitsToPacks = (units: number, piece: PieceDef | null | undefined) =>
  round6(units / unitsPerPack(piece));

// Pack units that read the same for one or many.
const NO_PLURAL = new Set(["each", "ea", "ft", "lf", "sq ft", "sf", "gal", "lb", "lbs", "oz"]);

/** "case" → "cases", "box" → "boxes", "4-Cartridge Case" → "4-Cartridge Cases"; "sq ft" stays. */
export function packUnitLabel(n: number, unit: string): string {
  const u = unit.trim();
  if (!u || Math.abs(Math.abs(n) - 1) < EPS || NO_PLURAL.has(u.toLowerCase())) return u;
  const m = /^(.*?)([A-Za-z]+)$/.exec(u);
  if (!m) return u;
  const [, head = "", word = ""] = m;
  if (NO_PLURAL.has(word.toLowerCase()) || /s$/i.test(word)) return u;
  const tail = /(x|ch|sh)$/i.test(word) ? "es" : "s";
  return `${head}${word}${tail}`;
}

/** The label for `n` of what the tech counts: "cartridges" or the pack unit. */
export const unitLabel = (n: number, piece: PieceDef | null | undefined, unit: string) =>
  piece ? plural(n, piece.name) : packUnitLabel(n, unit);

/** "3 cartridges", "2 pails". */
export const amountText = (n: number, piece: PieceDef | null | undefined, unit: string) =>
  `${fmtNum(n)} ${unitLabel(n, piece, unit)}`;

/** A pack count for the small print: one decimal, "<0.1" for a sliver. */
function fmtPacks(packs: number): string {
  if (packs > 0 && packs < 0.05) return "<0.1";
  return fmtNum(packs, 1);
}

/**
 * On hand as the tech thinks of it: "14 cartridges · 1.2 cases" when the product has pieces,
 * else "2 pails".
 */
export function onHandText(packs: number, unit: string, piece: PieceDef | null | undefined) {
  const p = Math.max(0, packs);
  if (!piece) return `${fmtNum(p, 2)} ${packUnitLabel(p, unit)}`;
  const pieces = packsToUnits(p, piece);
  return `${fmtNum(pieces, 2)} ${plural(pieces, piece.name)} · ${fmtPacks(p)} ${packUnitLabel(p, unit)}`;
}

export interface LedgerRow extends LocatedCell {
  id: number;
  /** Packs; negative = used on the ticket (consumed), positive = put back (released). */
  qty: number;
  unit: string;
  counted_note: string | null;
  created_by_name: string | null;
  created_at: string;
}

const sameCell = (r: LocatedCell, c: LocatedCell) =>
  r.location_id === c.location_id &&
  r.screen_id === c.screen_id &&
  r.row_label === c.row_label &&
  r.price_col === c.price_col;

/** Packs of the cell used on this ticket at that location (consumed minus put back). */
export function usedPacks(rows: readonly LedgerRow[], cell: LocatedCell): number {
  let n = 0;
  for (const r of rows) if (sameCell(r, cell)) n -= Number(r.qty);
  return round6(n);
}

/**
 * The piece definition read back from the ledger when the truck no longer lists the cell (its
 * last piece was used): a piece count is written as counted_note "3 cartridges" beside
 * qty −0.25, so one pack holds 3 / 0.25 = 12.
 */
export function pieceFromLedger(rows: readonly LedgerRow[], cell: LocatedCell): PieceDef | null {
  return pieceFromCountedNotes(rows.filter((r) => sameCell(r, cell)));
}

/** A consumed ledger entry the tech could take back with undo (their own, under 24 h old). */
export interface OwnEntry {
  id: number;
  /** Size in units (positive). */
  units: number;
}

/**
 * Own consumed entries of the cell, newest first, that undoMovement will still accept (the
 * server allows your own entries for 24 hours; a few minutes' margin for clock drift).
 */
export function ownFreshEntries(
  rows: readonly LedgerRow[],
  cell: LocatedCell,
  piece: PieceDef | null | undefined,
  myName: string | null,
  now = Date.now(),
): OwnEntry[] {
  if (!myName) return [];
  return rows
    .filter(
      (r) =>
        sameCell(r, cell) &&
        Number(r.qty) < 0 &&
        r.id > 0 &&
        r.created_by_name === myName &&
        now - Date.parse(r.created_at) < 24 * 3600_000 - 5 * 60_000,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
    .map((r) => ({ id: r.id, units: packsToUnits(-Number(r.qty), piece) }));
}

export type ReduceStep =
  | { kind: "undo"; id: number; units: number }
  | { kind: "consume"; units: number }
  | { kind: "release"; units: number };

/**
 * How to take `k` units back off the ticket (they go back on the truck).
 *
 * A technician's login may not record "released" (RLS allows field logins only leftover and
 * consumed), so the first choice is to undo their own recent entries: an entry of exactly `k`
 * (a "+" then a "−" leaves no trace), else, for an estimator / admin, one "released" entry,
 * else newest-first undos and, when the last one is bigger than what is left, re-log its
 * remainder. Null when it cannot be done (nothing of theirs recent enough).
 */
export function planReduce(
  entries: readonly OwnEntry[],
  k: number,
  canRelease: boolean,
): ReduceStep[] | null {
  if (!(k > EPS)) return [];
  const exact = entries.find((e) => Math.abs(e.units - k) < EPS);
  if (exact) return [{ kind: "undo", id: exact.id, units: exact.units }];
  if (canRelease) return [{ kind: "release", units: round6(k) }];
  const steps: ReduceStep[] = [];
  const used = new Set<number>();
  let left = k;
  for (const e of entries) {
    if (left <= EPS) break;
    if (e.units <= left + EPS) {
      steps.push({ kind: "undo", id: e.id, units: e.units });
      used.add(e.id);
      left = round6(left - e.units);
    }
  }
  if (left > EPS) {
    const bigger = entries.find((e) => !used.has(e.id) && e.units > left);
    if (!bigger) return null;
    steps.push({ kind: "undo", id: bigger.id, units: bigger.units });
    steps.push({ kind: "consume", units: round6(bigger.units - left) });
  }
  return steps;
}

/**
 * What a row is called on a repair ticket: the service material name (owner, Oct 6: CenterPoint's
 * names; src/lib/service-materials.ts) when there is one, else the catalog label with its colour /
 * size column ('2" Closed/Open (Tan Price)').
 */
export function cellName(r: { label?: string | null; row_label: string; price_col: string }) {
  if (r.label) return r.label;
  return r.price_col && r.price_col !== "price" ? `${r.row_label} (${r.price_col})` : r.row_label;
}

/**
 * Does every search word appear in the row's name, category, colour / size or item #? Loosely
 * (owner, Oct 9: "durolast, dl, and duro last should all pull up durolast products, screws should
 * pull up fasteners"): both sides lose case, hyphens, spaces, slashes, dots and quotes, and a
 * word also matches through its alias group (material-aliases.ts) and without its plural "s".
 */
export function matchesSearch(
  row: {
    label?: string | null;
    row_label: string;
    category: string;
    price_col: string;
    item_no: string | null;
  },
  q: string,
): boolean {
  return looseMatch([row.label, row.row_label, row.category, row.price_col, row.item_no], q);
}
