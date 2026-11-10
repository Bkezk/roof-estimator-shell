/**
 * A long list drawn a screenful at a time (Nov 10, speed finding 7: the Customers list drew all
 * 636 customers at once — 22,398 page elements — so the first typed letter took 420 ms on a slow
 * computer and scrolling stuttered, growing in a straight line with the customer count).
 *
 * The rows are cut into blocks of WINDOW_BLOCK. A block on or near the screen is drawn; every
 * other block is one empty box as tall as its rows, so the page keeps its length and the
 * scrollbar means what it did. Rows may be any height (a card with an address and a contact line
 * is taller than one without; on a phone taller again): a drawn block is measured, and a block
 * not seen yet is guessed from the rows measured so far.
 *
 * Pure: which blocks, which are drawn, how tall an empty one stands. The component that watches
 * the screen is components/windowed-list.tsx. Searching and sorting happen BEFORE the cut, on
 * every row, so the page's own search finds a customer wherever it sits; the browser's Ctrl+F
 * sees only what is drawn.
 */

/** Rows to a block: about two screens of customer cards on a desktop, one and a bit on a phone. */
export const WINDOW_BLOCK = 20;
/** How far past the screen's edges (px) a block is still drawn, so Tab and a scroll land on rows. */
export const WINDOW_MARGIN_PX = 1000;

export interface RowBlock<T> {
  /** 0, 1, 2 … down the list. */
  index: number;
  /** Names the rows inside (first id, last id, how many), so a measured height is theirs alone. */
  key: string;
  rows: T[];
}

/** The rows in blocks of `size`, in order; none for an empty list. */
export function blocksOf<T extends { id: string }>(
  rows: readonly T[],
  size: number = WINDOW_BLOCK,
): RowBlock<T>[] {
  const n = Math.max(1, Math.floor(size));
  const out: RowBlock<T>[] = [];
  for (let i = 0; i < rows.length; i += n) {
    const part = rows.slice(i, i + n);
    out.push({
      index: out.length,
      key: `${part[0]!.id}:${part[part.length - 1]!.id}:${part.length}`,
      rows: part,
    });
  }
  return out;
}

/**
 * The blocks to draw: the ones the screen-watcher reports on or near the screen. When it has
 * reported none that still exist — the first paint, or a search that just shortened the list
 * from under a far scroll — the first block, so the top of the list is never an empty box.
 */
export function drawnBlocks(count: number, near: ReadonlySet<number>): Set<number> {
  const out = new Set<number>();
  for (const i of near) if (Number.isInteger(i) && i >= 0 && i < count) out.add(i);
  if (out.size === 0 && count > 0) out.add(0);
  return out;
}

/** A block's height when its rows are `rowHeight` tall with `gap` between them. */
export function guessedBlockHeight(rows: number, rowHeight: number, gap: number): number {
  if (rows <= 0) return 0;
  return Math.round(rows * rowHeight + (rows - 1) * gap);
}

/**
 * One row's height as measured so far: the drawn blocks' heights, less their gaps, over their
 * rows. `fallback` until a block has been measured (or when a measure reads 0: a hidden tab).
 */
export function measuredRowHeight(
  measured: Iterable<{ rows: number; height: number }>,
  gap: number,
  fallback: number,
): number {
  let rows = 0;
  let height = 0;
  for (const m of measured) {
    if (m.rows <= 0 || !(m.height > 0)) continue;
    rows += m.rows;
    height += m.height - (m.rows - 1) * gap;
  }
  return rows > 0 && height > 0 ? height / rows : fallback;
}

/** The empty box's height for a block: its own measure if it was ever drawn, else the guess. */
export function emptyBlockHeight(
  block: { key: string; rows: readonly unknown[] },
  known: ReadonlyMap<string, number>,
  rowHeight: number,
  gap: number,
): number {
  const own = known.get(block.key);
  return own && own > 0 ? Math.round(own) : guessedBlockHeight(block.rows.length, rowHeight, gap);
}

/** The watcher's report folded into the set of near blocks; the same set back when nothing changed. */
export function applySightings(
  near: ReadonlySet<number>,
  sightings: readonly { index: number; near: boolean }[],
): ReadonlySet<number> {
  let next: Set<number> | null = null;
  for (const s of sightings) {
    if (!Number.isInteger(s.index) || s.index < 0) continue;
    const has = (next ?? near).has(s.index);
    if (s.near === has) continue;
    next ??= new Set(near);
    if (s.near) next.add(s.index);
    else next.delete(s.index);
  }
  return next ?? near;
}
