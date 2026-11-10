/**
 * A long list that draws only the rows on or near the screen (lib/list-window.ts has the why and
 * the rules). The rows are cut into blocks; this component watches which blocks are near the
 * screen (one IntersectionObserver), draws those, and leaves an empty box of the right height
 * for every other block. Nothing here knows what a row is: the caller filters and sorts every
 * row first and hands the result in.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  WINDOW_BLOCK,
  WINDOW_MARGIN_PX,
  applySightings,
  blocksOf,
  drawnBlocks,
  emptyBlockHeight,
  measuredRowHeight,
} from "@/lib/list-window";

/** useLayoutEffect in the browser; nothing on the server (React warns about it there). */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The nearest ancestor that scrolls its own content, or null when the page itself scrolls. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p && p !== document.body; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function WindowedList<T extends { id: string }>(props: {
  rows: readonly T[];
  renderRow: (row: T) => ReactNode;
  /** A first guess at one row's height (px), used until a block has been measured. */
  rowHeight: number;
  /** The space between two rows (px); `rowsClassName` must make the same space. */
  gap: number;
  /** Spacing classes shared by the list (between blocks) and each block (between rows). */
  rowsClassName: string;
  /** `data-list` on the list, for the page's own hooks and the tests. */
  listName?: string;
  blockSize?: number;
}) {
  const { rows, renderRow, rowHeight, gap, rowsClassName, listName } = props;
  const size = props.blockSize ?? WINDOW_BLOCK;
  const blocks = useMemo(() => blocksOf(rows, size), [rows, size]);
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set<number>());
  const draw = drawnBlocks(blocks.length, near);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Each drawn block's last measured height, by the rows inside it. */
  const heights = useRef(new Map<string, number>());
  /** One row's height as measured so far (the guess for blocks not seen yet). */
  const rowPx = useRef(rowHeight);

  // Measure what is drawn (a handful of blocks), before the browser paints the next frame.
  useBrowserLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measured: { rows: number; height: number }[] = [];
    for (const el of list.querySelectorAll<HTMLElement>(
      ":scope > [data-block]:not([data-empty])",
    )) {
      const b = blocks[Number(el.dataset["block"])];
      const h = el.offsetHeight;
      if (!b || !(h > 0)) continue;
      heights.current.set(b.key, h);
      measured.push({ rows: b.rows.length, height: h });
    }
    if (measured.length) rowPx.current = measuredRowHeight(measured, gap, rowPx.current);
    // Forget rows long gone, so the map cannot grow for ever under a long typing session.
    if (heights.current.size > 400) heights.current = new Map([...heights.current].slice(-200));
  });

  // Watch every block's box; a block within WINDOW_MARGIN_PX of the screen is "near".
  const count = blocks.length;
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) =>
        setNear((cur) =>
          applySightings(
            cur,
            entries.map((e) => ({
              index: Number((e.target as HTMLElement).dataset["block"]),
              near: e.isIntersecting,
            })),
          ),
        ),
      { root: scrollParent(list), rootMargin: `${WINDOW_MARGIN_PX}px 0px` },
    );
    for (const el of list.querySelectorAll<HTMLElement>(":scope > [data-block]")) io.observe(el);
    return () => io.disconnect();
  }, [count]);

  return (
    <div
      ref={listRef}
      className={rowsClassName}
      data-list={listName}
      data-windowed
      data-rows={rows.length}
    >
      {blocks.map((b) =>
        draw.has(b.index) ? (
          <div key={b.index} data-block={b.index} className={rowsClassName}>
            {b.rows.map(renderRow)}
          </div>
        ) : (
          // The rows of this block are off the screen: one empty box holds their place.
          <div
            key={b.index}
            data-block={b.index}
            data-empty
            aria-hidden
            style={{ height: emptyBlockHeight(b, heights.current, rowPx.current, gap) }}
          />
        ),
      )}
    </div>
  );
}
