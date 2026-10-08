/**
 * What page 1 of the customer's PDF lists (owner, Oct 8: "Show on invoice", off by default, as
 * CenterPoint's Show switch). The lines switched on are listed; every line switched off is added
 * into one row after them, so the Subtotal and Grand Total are the same either way. Pure, so it
 * is tested without drawing a PDF.
 */

export const ROLLUP_LABEL = "Services and materials";

export interface PdfLine {
  total: number | string;
  show_on_invoice?: boolean | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function pdfLineRows<T extends PdfLine>(
  lines: readonly T[],
): { shown: T[]; rollup: { label: string; total: number } | null } {
  const shown = lines.filter((l) => l.show_on_invoice === true);
  const hidden = lines.filter((l) => l.show_on_invoice !== true);
  return {
    shown,
    rollup: hidden.length
      ? { label: ROLLUP_LABEL, total: r2(hidden.reduce((n, l) => n + Number(l.total), 0)) }
      : null,
  };
}
