/**
 * The folded repair row on the close-out (owner, Oct 9: "the repairs are a bit space consuming
 * especially if you have more than one"). Each repair is one line — name, "× qty unit", the
 * Before / After photo counts and what it still needs — that opens to the full card on a tap.
 * The "needs" list uses the same per-repair rules Complete checks (closeout-check.ts: a Before
 * and an After photo) plus the work-completed text the invoice prints. Pure, so it is tested
 * without the screen.
 */

export interface SummaryRepair {
  name: string;
  quantity: number | string;
  unit: string | null;
  resolution_text: string | null;
}
export interface SummaryPhoto {
  role: string;
}
export interface RepairSummary {
  /** "× 2 EA", "× 1.5 LF". */
  qtyText: string;
  before: number;
  after: number;
  /** "before photo", "after photo", "work completed" — in the order the card asks for them. */
  needs: string[];
}

/** A quantity at most 3 decimals, no trailing zeros ("2", "1.5", "0.125"). */
function qtyNum(q: number | string): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : r.toFixed(3).replace(/\.?0+$/, "");
}

export function repairSummary(
  repair: SummaryRepair,
  photos: readonly SummaryPhoto[],
): RepairSummary {
  const before = photos.filter((p) => p.role === "before").length;
  const after = photos.filter((p) => p.role === "after").length;
  const needs: string[] = [];
  if (before === 0) needs.push("before photo");
  if (after === 0) needs.push("after photo");
  if (!(repair.resolution_text ?? "").trim()) needs.push("work completed");
  return {
    qtyText: `× ${qtyNum(repair.quantity)} ${(repair.unit ?? "").trim() || "EA"}`,
    before,
    after,
    needs,
  };
}
