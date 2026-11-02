/**
 * The Price lines module (owner, Nov 2: "a module that allows descriptors and prices to be put
 * in and the bottom totals it automatically") — the quote the office sets up as a saved
 * template on the Documents tab. Rows of a description and a price typed by hand; the Total row
 * adds the prices up itself, on the editor and on the PDF. Pure: the money reading and
 * writing, and the printable table.
 */
import type { TextAlign } from "@/lib/documents/model";

export interface PriceLine {
  description: string;
  /** As typed: "1,250", "$1,250.00", "-50". Read by parseMoney; blank = no amount. */
  price: string;
}

/**
 * A typed amount as a number: "$1,250.00" → 1250, "(50)" and "-50" → -50, "1 200" → 1200.
 * null for blank or anything that is not a number ("TBD", "call").
 */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "").trim();
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t);
  const core = neg ? t.slice(1, -1) : t;
  if (!/^-?\d+(\.\d+)?$/.test(core)) return null;
  const n = Number(core);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** "$1,250.00"; a negative as "-$50.00". */
export function moneyText(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

/** The sum of the prices that read as numbers (a blank or "TBD" line adds nothing). */
export function priceLinesTotal(rows: readonly PriceLine[]): number {
  return rows.reduce((s, r) => s + (parseMoney(r.price) ?? 0), 0);
}

/** Does the module hold anything at all (a description, a price)? An empty one prints nothing. */
export function priceLinesEmpty(rows: readonly PriceLine[]): boolean {
  return rows.every((r) => !r.description.trim() && !r.price.trim());
}

/**
 * The printable table: Description | Price, one row per line (a price that is not a number
 * prints as typed, so "TBD" stays "TBD"), then the Total row with the sum. Descriptions may
 * carry {{variables}}; the table layout resolves them.
 */
export function priceLinesTable(m: { rows: readonly PriceLine[]; totalLabel: string }): {
  columns: Array<{ title: string; align: TextAlign }>;
  rows: string[][];
} {
  const rows = m.rows.map((r) => {
    const n = parseMoney(r.price);
    return [r.description, n === null ? r.price.trim() : moneyText(n)];
  });
  rows.push([m.totalLabel.trim() || "Total", moneyText(priceLinesTotal(m.rows))]);
  return {
    columns: [
      { title: "Description", align: "left" },
      { title: "Price", align: "right" },
    ],
    rows,
  };
}
