/**
 * Work Overview's column layout (owner, Oct 7): "the layout should be Unassigned, overdue, this
 * week, later, needs authorization, no date, and Done … make it where you can click and drag
 * them to customize the layout and a little x in the corner to get rid of that category (also
 * allow easy restoration of that category)".
 *
 * A layout is the column order plus the hidden columns. It is the user's own: cached in the
 * browser (localStorage, per user) and saved on their profile (work-layout.functions.ts) so it
 * follows them to another device. Pure rules only; the page (components/my-work-page.tsx) owns
 * the drag and drop and the X.
 */
import { BUCKET_LABELS, LIST_BUCKETS, type WorkBucket } from "@/lib/my-work";

export interface WorkLayout {
  /** Every List column, in the order shown (hidden ones keep their place for when they return). */
  order: WorkBucket[];
  /** Columns the user closed with the X. */
  hidden: WorkBucket[];
}

/** The owner's default order (Oct 7): LIST_BUCKETS. */
export const DEFAULT_WORK_LAYOUT_ORDER: readonly WorkBucket[] = LIST_BUCKETS;

export const defaultWorkLayout = (): WorkLayout => ({
  order: [...DEFAULT_WORK_LAYOUT_ORDER],
  hidden: [],
});

const isBucket = (v: unknown): v is WorkBucket =>
  typeof v === "string" && (DEFAULT_WORK_LAYOUT_ORDER as readonly string[]).includes(v);

/**
 * Whatever was stored, made whole: unknown names dropped, duplicates removed, every column
 * present (missing ones appended in default order), hidden only among the known. Anything that
 * is not a layout at all gives the default.
 */
export function normalizeWorkLayout(raw: unknown): WorkLayout {
  const r = (raw ?? {}) as { order?: unknown; hidden?: unknown };
  const order: WorkBucket[] = [];
  for (const v of Array.isArray(r.order) ? r.order : [])
    if (isBucket(v) && !order.includes(v)) order.push(v);
  for (const b of DEFAULT_WORK_LAYOUT_ORDER) if (!order.includes(b)) order.push(b);
  const hidden: WorkBucket[] = [];
  for (const v of Array.isArray(r.hidden) ? r.hidden : [])
    if (isBucket(v) && !hidden.includes(v)) hidden.push(v);
  return { order, hidden };
}

export const isDefaultWorkLayout = (l: WorkLayout): boolean =>
  l.hidden.length === 0 && l.order.join(",") === DEFAULT_WORK_LAYOUT_ORDER.join(",");

/**
 * The List's groups under a layout: `shown` in the user's order without the hidden ones (a
 * `keep` bucket — the ?bucket= preset's — stays shown even when hidden), `hidden` the closed
 * ones that exist, in order, for the restore chips.
 */
export function applyWorkLayout<T extends { bucket: WorkBucket }>(
  groups: T[],
  layout: WorkLayout,
  keep: WorkBucket | null = null,
): { shown: T[]; hidden: T[] } {
  const by = new Map(groups.map((g) => [g.bucket, g]));
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const b of layout.order) {
    const g = by.get(b);
    if (!g) continue;
    if (layout.hidden.includes(b) && b !== keep) hidden.push(g);
    else shown.push(g);
  }
  return { shown, hidden };
}

/**
 * Drop `bucket` on `target`: it takes the place before a target that was ahead of it, after a
 * target that was behind it — so dropping on the last column makes it last. Positions are
 * among the columns as ordered (hidden ones ride along).
 */
export function moveBucket(layout: WorkLayout, bucket: WorkBucket, target: WorkBucket): WorkLayout {
  if (bucket === target) return layout;
  const order = layout.order.filter((b) => b !== bucket);
  const from = layout.order.indexOf(bucket);
  const to = layout.order.indexOf(target);
  if (from < 0 || to < 0) return layout;
  const at = order.indexOf(target) + (from < to ? 1 : 0);
  order.splice(at, 0, bucket);
  return { ...layout, order };
}

/** Close a column with the X. The last one showing cannot be closed. */
export function hideBucket(layout: WorkLayout, bucket: WorkBucket): WorkLayout {
  if (layout.hidden.includes(bucket)) return layout;
  const showing = layout.order.filter((b) => !layout.hidden.includes(b));
  if (showing.length <= 1) return layout;
  return { ...layout, hidden: [...layout.hidden, bucket] };
}

/** Bring a closed column back (it returns to its place in the order). */
export const showBucket = (layout: WorkLayout, bucket: WorkBucket): WorkLayout => ({
  ...layout,
  hidden: layout.hidden.filter((b) => b !== bucket),
});

export const bucketLabel = (b: WorkBucket): string => BUCKET_LABELS[b];

// ---- the browser's copy ---------------------------------------------------------------------

export const WORK_LAYOUT_STORAGE_KEY = "jbk-portal:work-layout";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const keyFor = (userId: string) => `${WORK_LAYOUT_STORAGE_KEY}:${userId}`;

/** The layout cached for this user in this browser, or null. */
export function readStoredWorkLayout(
  storage: StorageLike | null,
  userId: string,
): WorkLayout | null {
  try {
    const raw = storage?.getItem(keyFor(userId));
    if (!raw) return null;
    return normalizeWorkLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Cache the layout for this user in this browser (the default clears the cache). */
export function writeStoredWorkLayout(
  storage: StorageLike | null,
  userId: string,
  layout: WorkLayout,
): void {
  try {
    if (isDefaultWorkLayout(layout)) storage?.removeItem(keyFor(userId));
    else storage?.setItem(keyFor(userId), JSON.stringify(layout));
  } catch {
    // A private window or a full store: the page still lays out from memory.
  }
}
