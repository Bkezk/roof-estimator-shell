/**
 * How the draft editor shows a line's Rate cell (owner, Oct 14): a material priced from the
 * ticket — a ledger material ("cell:…") or a purchase order ("po:…") — whose rate follows the
 * markup is shown as text with a hint ("cost + 75%"; "at cost" for a PO billed at cost) and a
 * pencil to override it; labor, travel, hand-added lines and any typed price keep the box.
 *
 * Pure: no React (unit tested in invoice-workflow-oct14.test.ts).
 */
import { isPoLine } from "@/lib/invoice-po-lines";

export interface RateViewLine {
  kind: string;
  source: string | null;
  /** false = follows the markup; true = typed by hand; missing (saved before the column) = box. */
  rate_overridden?: boolean | null;
}

/** A ticket material line (ledger or PO) whose rate the markup computes: shown, not typed. */
export function rateIsComputed(l: RateViewLine): boolean {
  if (l.kind !== "material" || l.rate_overridden !== false) return false;
  return !!l.source && (l.source.startsWith("cell:") || isPoLine(l));
}

/** The small hint under a computed rate: "cost + 75%", or "at cost" for a PO not marked up. */
export function computedRateHint(l: RateViewLine, markupPct: number, poMarkup: boolean): string {
  if (isPoLine(l) && !poMarkup) return "at cost";
  const pct = Number.isFinite(markupPct) ? Math.round(markupPct * 100) / 100 : 0;
  return `cost + ${pct}%`;
}
