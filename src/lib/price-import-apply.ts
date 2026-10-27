/**
 * The pure heart of Price List Import's apply and revert — the JSON edits on a catalog screen's
 * `data` — kept free of I/O so the money path is unit-tested exactly as the server runs it.
 */
import { findRowByKey } from "@/lib/catalog-row-key";

export interface ScreenData {
  kind?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  products?: { name: string; price?: number }[];
  /** Exceptional Metals (kind "metals"): the Pitch Pans rows take an item number on Unit Cost. */
  subscreens?: {
    pitch_pans?: { rows?: { description?: string | null; unit_cost?: unknown }[] };
  };
}

/** The one Exceptional Metals cell per pitch pan an item number may point at (price-targets.ts). */
const METALS_PITCH_PAN_COL = "Unit Cost";

const pitchPanRow = (d: ScreenData, label: string) =>
  (d.subscreens?.pitch_pans?.rows ?? []).find(
    (r) => String(r.description ?? "").trim() === label.trim(),
  );

export interface CellUpdate {
  item_no: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  price: number;
}
export interface AppliedUpdate {
  item_no: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  old: number | null;
  new: number;
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Write each update into the screen (adhesives by product name; flat screens by row key and
 * column). Mutates `d`. Cells whose row / column is gone are reported, never guessed.
 */
export function applyUpdatesToScreen(
  screenId: string,
  d: ScreenData,
  updates: CellUpdate[],
): { applied: AppliedUpdate[]; missing: { item_no: string; reason: string }[]; changed: boolean } {
  const applied: AppliedUpdate[] = [];
  const missing: { item_no: string; reason: string }[] = [];
  let changed = false;
  for (const u of updates) {
    if (d.kind === "adhesives") {
      const p = (d.products ?? []).find((x) => x.name === u.row_label);
      if (!p) {
        missing.push({ item_no: u.item_no, reason: `adhesive "${u.row_label}" not found` });
        continue;
      }
      const old = typeof p.price === "number" ? p.price : null;
      p.price = u.price;
      changed = true;
      applied.push({ ...u, old, new: u.price });
      continue;
    }
    if (d.kind === "metals") {
      if (u.price_col !== METALS_PITCH_PAN_COL) {
        missing.push({
          item_no: u.item_no,
          reason: `column "${u.price_col}" not on ${screenId} (pitch pans price by ${METALS_PITCH_PAN_COL})`,
        });
        continue;
      }
      const p = pitchPanRow(d, u.row_label);
      if (!p) {
        missing.push({ item_no: u.item_no, reason: `pitch pan "${u.row_label}" not found` });
        continue;
      }
      const old = numOrNull(p.unit_cost);
      p.unit_cost = u.price;
      changed = true;
      applied.push({ ...u, old, new: u.price });
      continue;
    }
    const cols = d.columns ?? [];
    if (!cols.includes(u.price_col)) {
      missing.push({ item_no: u.item_no, reason: `column "${u.price_col}" not on ${screenId}` });
      continue;
    }
    const target = findRowByKey(cols, d.rows ?? [], u.row_label);
    if (!target) {
      missing.push({ item_no: u.item_no, reason: `row "${u.row_label}" not on ${screenId}` });
      continue;
    }
    const old = numOrNull(target[u.price_col]);
    target[u.price_col] = u.price;
    changed = true;
    applied.push({ ...u, old, new: u.price });
  }
  return { applied, missing, changed };
}

export interface LoggedChange {
  id: number;
  screen_id: string;
  row_label: string;
  price_col: string;
  old_price: number | null;
  new_price: number;
}

/**
 * Put back `old_price` on every logged change whose cell STILL holds `new_price`; a cell edited
 * since (or gone) is skipped and reported. Mutates `d`. Returns the ids reverted.
 */
export function revertChangesOnScreen(
  screenId: string,
  d: ScreenData,
  changes: LoggedChange[],
): { revertedIds: number[]; skipped: { cell: string; reason: string }[]; changed: boolean } {
  const skipped: { cell: string; reason: string }[] = [];
  const revertedIds: number[] = [];
  let changed = false;
  for (const c of changes) {
    const cell = `${screenId} › ${c.row_label} · ${c.price_col}`;
    const newP = Number(c.new_price);
    const oldP = c.old_price === null ? null : Number(c.old_price);
    if (d.kind === "adhesives") {
      const p = (d.products ?? []).find((x) => x.name === c.row_label);
      if (!p) {
        skipped.push({ cell, reason: "product gone" });
        continue;
      }
      if (p.price !== newP) {
        skipped.push({ cell, reason: `edited since (now ${p.price ?? "blank"})` });
        continue;
      }
      p.price = oldP ?? 0;
    } else if (d.kind === "metals") {
      const p = c.price_col === METALS_PITCH_PAN_COL ? pitchPanRow(d, c.row_label) : undefined;
      if (!p) {
        skipped.push({ cell, reason: "pitch pan gone" });
        continue;
      }
      const cur = numOrNull(p.unit_cost);
      if (cur !== newP) {
        skipped.push({ cell, reason: `edited since (now ${cur ?? "blank"})` });
        continue;
      }
      p.unit_cost = oldP ?? 0;
    } else {
      const target = findRowByKey(d.columns ?? [], d.rows ?? [], c.row_label);
      if (!target) {
        skipped.push({ cell, reason: "row gone" });
        continue;
      }
      const cur = numOrNull(target[c.price_col]);
      if (cur !== newP) {
        skipped.push({ cell, reason: `edited since (now ${cur ?? "blank"})` });
        continue;
      }
      target[c.price_col] = oldP;
    }
    changed = true;
    revertedIds.push(c.id);
  }
  return { revertedIds, skipped, changed };
}
