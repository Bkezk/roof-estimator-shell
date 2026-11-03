/**
 * Number formats shared by the invoice PDF and the Sage CSV (owner, Nov 3, service review item
 * 15): the screen already prints -$25.00 and 7.5 % (invoice-utils.ts money / toPct); the PDF
 * printed $-25.00 and 7.50 %, and the CSV wrote whatever JavaScript made of the number
 * (1234.5, 0.03125). Pure, so the formats are tested without a PDF or a database.
 */

/** $1,234.56; a credit is -$25.00 (the sign before the dollar, as on screen). */
export function pdfMoney(n: number | string | null | undefined): string {
  const v = Number(n ?? 0) || 0;
  const abs = Math.abs(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${v < 0 ? "-" : ""}$${abs}`;
}

/** A tax rate as a fraction → "7.5%" / "6%" / "7.25%" (no trailing zeros, at most 4 decimals). */
export function pctLabel(frac: number | string | null | undefined): string {
  const v = Number(frac ?? 0) || 0;
  return `${Number((v * 100).toFixed(4))}%`;
}

/** Money in the CSV: always two decimals, no thousands separator (1234.50). */
export function csvMoney(n: number | string | null | undefined): string {
  return (Number(n ?? 0) || 0).toFixed(2);
}

/**
 * A quantity or a per-unit rate in the CSV: as typed, up to four decimals, no trailing zeros
 * (40, 3.25, 0.0313) — a per-piece rate keeps its precision, a whole number stays whole.
 */
export function csvNumber(n: number | string | null | undefined): string {
  const v = Number(n ?? 0) || 0;
  return String(Number(v.toFixed(4)));
}
