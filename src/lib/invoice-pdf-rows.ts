/**
 * What page 1 of the customer's PDF lists (owner, Oct 8). Each line is one of three:
 *   - Hidden (the default): not listed; its amount is in the one "Services and materials" row;
 *   - No price ("show the material/labor but hide the price"): listed with its quantity, no
 *     rate or amount; its amount is in that same row;
 *   - With price: listed with quantity, rate and amount (CenterPoint's Show switch).
 * The Subtotal and Grand Total are the same whichever is chosen. Pure, so it is tested without
 * drawing a PDF. Stored as two columns: show_on_invoice and hide_price.
 */

export const ROLLUP_LABEL = "Services and materials";

export type ShowChoice = "hidden" | "no_price" | "priced";

export interface ShowFlagsLike {
  show_on_invoice?: boolean | null;
  hide_price?: boolean | null;
}

/** The line's choice from its two columns (hide_price means nothing while the line is hidden). */
export function showChoice(l: ShowFlagsLike): ShowChoice {
  if (l.show_on_invoice !== true) return "hidden";
  return l.hide_price === true ? "no_price" : "priced";
}

/** The two columns for a choice. */
export function showFlags(c: ShowChoice): { show_on_invoice: boolean; hide_price: boolean } {
  return { show_on_invoice: c !== "hidden", hide_price: c === "no_price" };
}

export interface PdfLine extends ShowFlagsLike {
  total: number | string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function pdfLineRows<T extends PdfLine>(
  lines: readonly T[],
): { listed: { line: T; priced: boolean }[]; rollup: { label: string; total: number } | null } {
  const listed: { line: T; priced: boolean }[] = [];
  let unpriced = 0;
  let inRollup = 0;
  for (const l of lines) {
    const c = showChoice(l);
    if (c !== "hidden") listed.push({ line: l, priced: c === "priced" });
    if (c !== "priced") {
      unpriced += Number(l.total);
      inRollup++;
    }
  }
  return {
    listed,
    rollup: inRollup ? { label: ROLLUP_LABEL, total: r2(unpriced) } : null,
  };
}

export interface PropertyLike {
  name?: string | null;
  address?: string | null;
}

/**
 * The Property block's lines on the PDF (name, then address), none when the ticket had no
 * property (owner, Oct 9: "why does the invoice say property on it if theres no property
 * listed?"). The heading prints only when there is a line under it.
 */
export function propertyLines(p: PropertyLike | null | undefined): string[] {
  return [p?.name, p?.address].map((s) => (s ?? "").trim()).filter(Boolean);
}
