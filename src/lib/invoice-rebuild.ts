/**
 * What "Rebuild from ticket" keeps on a draft invoice (owner, Oct 5, service follow-up 3: fix
 * hours and quantities on the ticket; the invoice follows; line edits are for prices only).
 *
 * The lines are built again from the ticket's time and materials (quantities, hours, new and
 * removed time / material all come from the ticket), and then:
 *   - a line added by hand on the invoice ("Add line": no `source`) is kept as it was, after the
 *     ticket's lines;
 *   - a rebuilt line whose old line had its price changed by hand (`rate_overridden`) keeps that
 *     price and its cost per unit (the editor rescales the cost with a typed rate, so Cost and
 *     Margin stay true; owner, Oct 6), totals worked out again for the new quantity.
 * Everything else takes today's rates. Pure, so it is tested without a server.
 *
 * `savedLineRow` is the row saveInvoice writes for one line the editor sent, here so the flag
 * handling is tested without a server: the flag is the client's (the editor sets it when the
 * rate box of a ticket line is edited, clears it when a markup change re-prices the line) and
 * is written only once the column exists on the stored row.
 */
import type { Database } from "@/integrations/supabase/types";

export interface RebuildLine {
  sort: number;
  kind: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  cost_rate: number;
  cost_total: number;
  on_date: string | null;
  source: string | null;
  taxable: boolean;
  rate_overridden?: boolean;
  /** Listed on its own on the customer's PDF (owner, Oct 8); off by default. */
  show_on_invoice?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Did the user change this line's price on the invoice (vs the rate it was built with)? Not
 * used by the save since Oct 6 (the editor says so with the flag); kept for the screens.
 */
export function rateWasChanged(
  prev: { rate: number | string; rate_overridden?: boolean | null },
  nextRate: number,
): boolean {
  return !!prev.rate_overridden || Number(prev.rate) !== nextRate;
}

export function mergeRebuild(
  old: readonly RebuildLine[],
  fresh: readonly RebuildLine[],
): RebuildLine[] {
  const overridden = new Map<string, { rate: number; cost_rate: number }>();
  for (const l of old)
    if (l.source && l.rate_overridden)
      overridden.set(l.source, { rate: Number(l.rate), cost_rate: Number(l.cost_rate) });
  // A ticket line switched on for the PDF stays on when it is built again (owner, Oct 8).
  const shown = new Set(old.filter((l) => l.source && l.show_on_invoice).map((l) => l.source));
  const out: RebuildLine[] = fresh.map((built) => {
    const l = shown.has(built.source) ? { ...built, show_on_invoice: true } : built;
    const kept = l.source ? overridden.get(l.source) : undefined;
    if (!kept) return { ...l };
    const qty = Number(l.qty);
    return {
      ...l,
      rate: kept.rate,
      total: r2(qty * kept.rate),
      cost_rate: kept.cost_rate,
      cost_total: r2(qty * kept.cost_rate),
      rate_overridden: true,
    };
  });
  const manual = [...old].filter((l) => !l.source).sort((a, b) => a.sort - b.sort);
  let sort = out.reduce((m, l) => Math.max(m, l.sort), -1) + 1;
  for (const l of manual) out.push({ ...l, sort: sort++ });
  return out;
}

/** One line as the editor sends it to saveInvoice (lineSchema's output). */
export interface SavedLineInput {
  kind: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  cost_rate: number;
  on_date?: string | null | undefined;
  source?: string | null | undefined;
  taxable: boolean;
  /** Typed by hand (the editor's flag); false or missing = follows the markup / today's rate. */
  rate_overridden?: boolean | undefined;
  /** Listed on its own on the customer's PDF (owner, Oct 8). */
  show_on_invoice?: boolean | undefined;
}
export type SavedLineRow = Database["public"]["Tables"]["invoice_lines"]["Insert"] & {
  invoice_id: string;
  sort: number;
};

/**
 * The row saveInvoice writes for line `l` at position `sort`; totals to cents. `prev` is the
 * stored row the line came from (undefined for a new line). The typed-by-hand flag is the
 * client's, written as sent (never worked out from the rate again) — but only when the stored
 * row has the column (20261005170000_invoice_line_rate_override.sql), as before.
 */
export function savedLineRow(
  invoiceId: string,
  sort: number,
  l: SavedLineInput,
  prev: Record<string, unknown> | undefined,
): SavedLineRow {
  const row: SavedLineRow = {
    invoice_id: invoiceId,
    sort,
    kind: l.kind,
    description: l.description,
    qty: l.qty,
    unit: l.unit,
    rate: l.rate,
    total: r2(l.qty * l.rate),
    cost_rate: l.cost_rate,
    cost_total: r2(l.qty * l.cost_rate),
    on_date: l.on_date ?? null,
    source: l.source ?? null,
    taxable: l.taxable,
  };
  if (prev && "rate_overridden" in prev) row.rate_overridden = l.rate_overridden === true;
  // Show on invoice: as sent once the stored row has the column; a new line only when switched
  // on (left off, the column's default is off; before 20261008151500 there is no column).
  if ((prev && "show_on_invoice" in prev) || l.show_on_invoice === true)
    row.show_on_invoice = l.show_on_invoice === true;
  return row;
}
