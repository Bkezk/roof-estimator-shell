/**
 * The pure parts of the ticket page's "Materials & POs" fold (owner, Oct 27: the Materials fold
 * and the Purchase orders fold as two tabs of one fold, the Work fold's pattern): the fold's one
 * line, the ticket's material line count, the remembered tab. A .ts module so
 * materials-pos-fold.tsx exports components only (fast refresh); tested in
 * materials-pos-fold.test.ts.
 */
import { cellKey, EPS, type LocatedCell } from "@/components/service/materials-utils";
import type { PoLike } from "@/lib/purchase-orders";

export const MATERIALS_TAB_KEY = "bid-o-matic:ticket-materials-tab";
export type MaterialsTab = "materials" | "pos";
const MATERIALS_TABS: readonly MaterialsTab[] = ["materials", "pos"];

/** A remembered tab name, or Materials for anything else (nothing stored, an old value). */
export function readMaterialsTab(raw: string | null | undefined): MaterialsTab {
  return MATERIALS_TABS.includes(raw as MaterialsTab) ? (raw as MaterialsTab) : "materials";
}

/**
 * Lines on the ticket: the cells with something used (or returned) net of take-backs — what the
 * Materials fold's header counted ("3 lines") and the "On this ticket" list shows.
 */
export function ticketLineCount(ledger: readonly (LocatedCell & { qty: number | string })[]) {
  const byCell = new Map<string, number>();
  for (const m of ledger) byCell.set(cellKey(m), (byCell.get(cellKey(m)) ?? 0) + Number(m.qty));
  return [...byCell.values()].filter((v) => Math.abs(v) > EPS).length;
}

/** "1 PO" / "3 POs" / "no POs" (no approval count: approval is gone since Oct 28). */
export function posPart(pos: readonly PoLike[]): string {
  if (!pos.length) return "no POs";
  return `${pos.length} PO${pos.length === 1 ? "" : "s"}`;
}

/**
 * The fold's one line from both tabs: "3 items · 1 PO", "nothing logged · no POs". A part still
 * loading (null) is left out; nothing known yet reads as nothing.
 */
export function materialsPosSummary(parts: {
  lines: number | null;
  pos: readonly PoLike[] | null;
}): string {
  const out: string[] = [];
  if (parts.lines !== null)
    out.push(
      parts.lines > 0 ? `${parts.lines} ${parts.lines === 1 ? "item" : "items"}` : "nothing logged",
    );
  if (parts.pos !== null) out.push(posPart(parts.pos));
  return out.join(" · ");
}
