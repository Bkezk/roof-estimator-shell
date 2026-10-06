/**
 * Material lines on an invoice (buildLinesFromJob in invoices.server.ts). Pure, so the server
 * builds with it and the editor / PDF display with it.
 *
 * The ticket's material ledger is kept in PACKS (a decimal of the priced pack: 0.05 box). When
 * the catalog says how many pieces one pack holds ("Fasteners/Box", "Parts/Bag",
 * "Parts/Package", or an adhesive's "4-Cartridge Case" / "5-gal. Bucket"), the line is written
 * in PIECES — 50 fasteners at a per-fastener rate and cost — so a repair's handful of screws is
 * not a sliver of a box (owner, Oct 1). Without a piece count the line stays in packs.
 */
import { labelColOf, rowKeys } from "@/lib/catalog-row-key";
import {
  PACK_QTY_COLS,
  pieceDefFromPack,
  pieceDefFromUnitType,
  plural,
  type PieceDef,
} from "@/lib/stock-units";

export const r2 = (n: number) => Math.round(n * 100) / 100;
/** Per-piece rates and costs keep 4 decimals ($0.0910 a fastener); invoice_lines.rate and
 * cost_rate are unconstrained `numeric`, so nothing is lost on the way in. */
export const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** A catalog screen's `data` as pricing_catalog stores it (the parts read here). */
export interface CatalogData {
  kind?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  products?: { name: string; unit_type?: unknown; price?: unknown }[];
}

/**
 * The pieces one pack of a catalog cell holds, from the screen's `data`: the row's pack-quantity
 * column (PACK_QTY_COLS) on a row screen, or the product's unit type on Adhesives. Null when the
 * catalog does not say (or the row is gone).
 */
export function pieceFromCatalog(
  data: CatalogData | null | undefined,
  cell: { row_label: string },
): PieceDef | null {
  if (!data) return null;
  if (data.kind === "adhesives") {
    const p = (data.products ?? []).find((x) => x.name === cell.row_label);
    return typeof p?.unit_type === "string" ? pieceDefFromUnitType(p.unit_type) : null;
  }
  const cols = data.columns ?? [];
  if (!cols.length) return null;
  const rows = data.rows ?? [];
  const idx = rowKeys(cols, rows).indexOf(cell.row_label);
  if (idx < 0) return null;
  const packCol = PACK_QTY_COLS.find((c) => cols.includes(c));
  if (!packCol || packCol === labelColOf(cols)) return null;
  const raw = rows[idx]?.[packCol];
  const n = typeof raw === "number" ? raw : raw != null && raw !== "" ? Number(raw) : null;
  return pieceDefFromPack(packCol, n != null && Number.isFinite(n) ? n : null);
}

export interface MaterialCell {
  row_label: string;
  price_col: string;
  item_no: string | null;
  /** The pack unit the ledger keeps ("box", "4-Cartridge Case", "pail"). */
  unit: string;
}

export interface MaterialLine {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  cost_rate: number;
  cost_total: number;
}

const count = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** "box" → "box"; "4-Cartridge Case" → "case"; "5-gal. Bucket" → "bucket". */
function packWord(unit: string): string {
  const u = unit.trim();
  const rest = u.replace(/^\d+(?:\.\d+)?\s*-?\s*(?:cartridges?|gal\.?)\s*/i, "").trim();
  return (rest || u).toLowerCase();
}

/**
 * One invoice line for `packs` of a catalog cell at `packCost` a pack (catalog cost) and
 * `markup` (0.75 = 75 %). With a piece def: qty in pieces (snapped to a whole number within
 * 2 %), unit = the singular piece name, rate and cost per piece to 4 decimals, and the
 * description gains the pack ("— 1,000 fasteners per box"). Without one: packs as before.
 */
export function materialLineFor(
  cell: MaterialCell,
  packs: number,
  packCost: number,
  markup: number,
  piece: PieceDef | null,
): MaterialLine {
  const item = cell.item_no ? ` #${cell.item_no}` : "";
  if (!piece || !(piece.perPack > 0)) {
    const rate = r2(packCost * (1 + markup));
    const variant =
      cell.price_col && cell.price_col !== cell.row_label ? ` (${cell.price_col})` : "";
    return {
      description: `${cell.row_label}${variant}${item}`,
      qty: r2(packs),
      unit: cell.unit,
      rate,
      total: r2(packs * rate),
      cost_rate: packCost,
      cost_total: r2(packs * packCost),
    };
  }
  let qty = packs * piece.perPack;
  const whole = Math.round(qty);
  if (whole > 0 && Math.abs(qty - whole) / whole < 0.02) qty = whole;
  else qty = r4(qty);
  const cost_rate = r4(packCost / piece.perPack);
  const rate = r4((packCost * (1 + markup)) / piece.perPack);
  // "Price/Box" or "Cost/Sq. Ft." says no more than "per box" does; a colour or size column stays.
  const variant =
    cell.price_col && cell.price_col !== cell.row_label && !/^(price|cost)\b/i.test(cell.price_col)
      ? ` (${cell.price_col})`
      : "";
  return {
    description: `${cell.row_label}${variant}${item} — ${packNote(piece, cell.unit)}`,
    qty,
    unit: piece.name,
    rate,
    total: r2(qty * rate),
    cost_rate,
    cost_total: r2(qty * cost_rate),
  };
}

/**
 * The pack note after a line's name. Pieces in a pack: "1,000 fasteners per box". A piece that
 * is bigger than the stock unit (an ISO board, 32 sq ft of stock kept by the sq ft: perPack
 * 1/32) reads the other way round, "32 sq ft per board" — not "0.031 boards per sq ft" (owner,
 * Oct 6). The inverse is a whole number when within 1 %, else two decimals.
 */
function packNote(piece: PieceDef, unit: string): string {
  if (piece.perPack >= 1)
    return `${count(piece.perPack)} ${plural(piece.perPack, piece.name)} per ${packWord(unit)}`;
  let per = 1 / piece.perPack;
  const whole = Math.round(per);
  per = whole > 0 && Math.abs(per - whole) / whole < 0.01 ? whole : r2(per);
  return `${count(per)} ${unitText(per, packWord(unit))} per ${piece.name}`;
}

/**
 * The piece names a material line can be written in (stock-units.ts: fastener, cartridge,
 * gallon, part; service-materials.ts piece_name: board, roll, pad …) and the stock units that
 * take a plain "s" (STOCK_UNIT_BY_SCREEN: tube, bag, piece, package, pail). Not "box", "each",
 * "ft" or "sq ft", which do not.
 */
const PIECE_NAMES = new Set([
  "fastener",
  "cartridge",
  "gallon",
  "part",
  "board",
  "roll",
  "pad",
  "sheet",
  "bundle",
  "tube",
  "bag",
  "piece",
  "package",
  "pail",
  "bucket",
]);

/** A line's unit for display: a piece name pluralised ("50 fasteners"), any other unit as is. */
export function unitText(qty: number, unit: string): string {
  return PIECE_NAMES.has(unit.trim().toLowerCase()) ? plural(qty, unit.trim()) : unit;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD4 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
/** A per-unit rate: cents as usual ($15.00), a per-piece rate to 4 decimals ($0.1593). */
export function rateText(n: number | string | null | undefined): string {
  const v = Number(n ?? 0) || 0;
  return Math.abs(v - r2(v)) > 1e-9 ? USD4.format(v) : USD.format(v);
}

/**
 * The cost per unit of a line from the ticket's material ledger ("cell:…") whose rate was edited
 * by hand: it moves with the rate (cost × newRate / rate), so a box line re-entered as 3 screws
 * at $15 does not keep the $91-a-box cost (owner, Oct 1: "where is the cost of 273 coming
 * from?"). `line` is the line as built (its rate and cost per unit before the edit). Any other
 * line, a rate of 0 or a blank new rate keeps the cost as it was.
 */
export function rescaleCost(
  line: { source: string | null; rate: number | null; cost_rate: number },
  newRate: number | null,
): number {
  const rate = line.rate ?? 0;
  if (!line.source?.startsWith("cell:") || !(rate > 0) || newRate === null || newRate === rate)
    return line.cost_rate;
  return r4((line.cost_rate * newRate) / rate);
}

/** A ticket material line (built from the ticket's material ledger). */
export const isTicketMaterial = (l: { kind: string; source: string | null }) =>
  l.kind === "material" && !!l.source?.startsWith("cell:");

/** The rate a ticket material line bills at for a markup: per piece to 4 decimals, else cents. */
export function markupRate(costRate: number, markup: number, perPiece: boolean): number {
  return perPiece ? r4(costRate * (1 + markup)) : r2(costRate * (1 + markup));
}

/**
 * Does this rate come from the markup (not typed by hand)? Half a cent either way. Only a
 * fallback now, for lines saved before invoice_lines.rate_overridden said so (owner, Oct 6: a
 * typed price whose cost was rescaled has exactly this ratio again, so the test alone lost it).
 */
export function rateFromMarkup(
  l: { kind: string; source: string | null; rate: number | null; cost_rate: number },
  markup: number,
): boolean {
  if (!isTicketMaterial(l) || l.rate === null) return false;
  return Math.abs(l.rate - l.cost_rate * (1 + markup)) <= 0.005 + 1e-9;
}

/**
 * The invoice's material markup changed (owner, Oct 6: "change prices and markups per invoice"):
 * each ticket material line that follows the markup is priced again at the new one; a rate
 * typed by hand (`rate_overridden`), labor, travel and hand-added lines stay as they are. A line
 * loaded without the flag (saved before the column) follows the markup when its rate matches the
 * old one (rateFromMarkup). A re-priced line follows the markup from here on (flag false).
 */
export function applyMarkup<
  T extends {
    kind: string;
    source: string | null;
    rate: number | null;
    cost_rate: number;
    rate_overridden?: boolean;
  },
>(lines: readonly T[], oldMarkup: number, newMarkup: number): T[] {
  return lines.map((l) => {
    if (!isTicketMaterial(l) || l.rate === null) return l;
    if (l.rate_overridden === true) return l;
    if (l.rate_overridden === undefined && !rateFromMarkup(l, oldMarkup)) return l;
    const perPiece = Math.abs(l.rate - r2(l.rate)) > 1e-9 || l.cost_rate !== r2(l.cost_rate);
    return { ...l, rate: markupRate(l.cost_rate, newMarkup, perPiece), rate_overridden: false };
  });
}
