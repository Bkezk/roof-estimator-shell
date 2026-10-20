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
import {
  BUCKET_LABELS,
  KIND_LABELS,
  LIST_BUCKETS,
  type WorkBucket,
  type WorkKind,
} from "@/lib/my-work";

export interface WorkLayout {
  /** Every List column, in the order shown (hidden ones keep their place for when they return). */
  order: WorkBucket[];
  /** Columns the user closed with the X. */
  hidden: WorkBucket[];
  /**
   * Kinds of work the user unticked under Show (owner, Oct 14: "an option to check which things
   * you want to see, like if you don't want to see bids on there or tickets … so you can be
   * focused on your scope of work"). Left out of the List and the Calendar alike.
   */
  hiddenKinds: WorkKind[];
  /**
   * The view the user was last on (owner, Oct 15: remember it per user) — absent for the List,
   * the default. Applied when the URL has no ?view (`landingSearch`); never a column
   * customisation (`isDefaultWorkLayout` ignores it, so Reset layout does not appear for it).
   */
  view?: WorkViewName;
  /**
   * Whose work the user last asked for, in the ?who= form (`whoParam`): "mine", a profile id, or
   * absent for the caller's default (Everyone for admins and managers). Applied when the URL has
   * no ?who. A person who no longer exists is harmless: the list shows nobody.
   */
  who?: string;
}

/** The three views; the page's effectiveView downgrades "owner" for anyone but an admin. */
export type WorkViewName = "list" | "calendar" | "owner";
const isView = (v: unknown): v is WorkViewName => v === "list" || v === "calendar" || v === "owner";

/** The kinds the Show menu offers, in the same-day order. */
export const WORK_KINDS: readonly WorkKind[] = [
  "ticket",
  "inspection",
  "task",
  "followup",
  "opportunity",
  "bid",
];
/** The Show menu's wording for each kind. */
export const KIND_PLURALS: Record<WorkKind, string> = {
  ticket: "Tickets",
  inspection: "Inspections",
  task: "Tasks",
  followup: "Follow-ups",
  opportunity: "Opportunities",
  bid: "Bids",
};
const isKind = (v: unknown): v is WorkKind =>
  typeof v === "string" && (WORK_KINDS as readonly string[]).includes(v);

/** The owner's default order (Oct 7): LIST_BUCKETS. */
export const DEFAULT_WORK_LAYOUT_ORDER: readonly WorkBucket[] = LIST_BUCKETS;

export const defaultWorkLayout = (): WorkLayout => ({
  order: [...DEFAULT_WORK_LAYOUT_ORDER],
  hidden: [],
  hiddenKinds: [],
});

const isBucket = (v: unknown): v is WorkBucket =>
  typeof v === "string" && (DEFAULT_WORK_LAYOUT_ORDER as readonly string[]).includes(v);

/**
 * Whatever was stored, made whole: unknown names dropped, duplicates removed, every column
 * present, hidden only among the known. Anything that is not a layout at all gives the default.
 *
 * A column the stored order lacks takes its default place among the columns that are there:
 * after the nearest default predecessor present, else before the nearest default successor,
 * else at the end (owner, Oct 9: a layout saved before "Waiting" existed gets it after Later,
 * before Needs authorization, as the default has it — appending put it last, after Done). A
 * column that no longer exists (Oct 12: the No date group) is an unknown name, dropped.
 */
export function normalizeWorkLayout(raw: unknown): WorkLayout {
  const r = (raw ?? {}) as {
    order?: unknown;
    hidden?: unknown;
    hiddenKinds?: unknown;
    view?: unknown;
    who?: unknown;
  };
  const order: WorkBucket[] = [];
  for (const v of Array.isArray(r.order) ? r.order : [])
    if (isBucket(v) && !order.includes(v)) order.push(v);
  const defaults = DEFAULT_WORK_LAYOUT_ORDER;
  for (const [i, b] of defaults.entries()) {
    if (order.includes(b)) continue;
    const before = defaults
      .slice(0, i)
      .reverse()
      .find((x) => order.includes(x));
    if (before) {
      order.splice(order.indexOf(before) + 1, 0, b);
      continue;
    }
    const after = defaults.slice(i + 1).find((x) => order.includes(x));
    if (after) order.splice(order.indexOf(after), 0, b);
    else order.push(b);
  }
  const hidden: WorkBucket[] = [];
  for (const v of Array.isArray(r.hidden) ? r.hidden : [])
    if (isBucket(v) && !hidden.includes(v)) hidden.push(v);
  // Hidden kinds: unknown names dropped; every kind hidden would be a blank page, so that is
  // read as none hidden (the menu never lets the last tick go either).
  let hiddenKinds: WorkKind[] = [];
  for (const v of Array.isArray(r.hiddenKinds) ? r.hiddenKinds : [])
    if (isKind(v) && !hiddenKinds.includes(v)) hiddenKinds.push(v);
  if (hiddenKinds.length >= WORK_KINDS.length) hiddenKinds = [];
  // The remembered view and person (Oct 15): "list" is the default and is not kept; a person is
  // any short string (the ?who= form), checked by the server when it is used, not here.
  const who =
    typeof r.who === "string" && r.who.length > 0 && r.who.length <= 64 ? r.who : undefined;
  return withRemembered({ order, hidden, hiddenKinds }, isView(r.view) ? r.view : undefined, who);
}

/**
 * The default columns and kinds — the layout the List's Reset button restores and the bar's
 * "customized" test. The remembered view and person are NOT a customisation (owner, Oct 15: no
 * Reset button for having been on the Calendar); `isEmptyWorkLayout` is the "nothing to keep"
 * test the saves use.
 */
export const isDefaultWorkLayout = (l: WorkLayout): boolean =>
  l.hidden.length === 0 &&
  l.hiddenKinds.length === 0 &&
  l.order.join(",") === DEFAULT_WORK_LAYOUT_ORDER.join(",");

/** Nothing to remember at all: default columns and kinds, no view, no person (saved as null). */
export const isEmptyWorkLayout = (l: WorkLayout): boolean =>
  isDefaultWorkLayout(l) && !l.view && !l.who;

/** `l`'s columns and kinds with this view (none for the List) and this person (none = default). */
const withRemembered = (
  l: Pick<WorkLayout, "order" | "hidden" | "hiddenKinds">,
  view: WorkViewName | undefined,
  who: string | undefined,
): WorkLayout => ({
  order: l.order,
  hidden: l.hidden,
  hiddenKinds: l.hiddenKinds,
  ...(view && view !== "list" ? { view } : {}),
  ...(who ? { who } : {}),
});

/** Remember the view the user picked (the same layout back when nothing changes). */
export const rememberView = (layout: WorkLayout, view: WorkViewName): WorkLayout =>
  (layout.view ?? "list") === view ? layout : withRemembered(layout, view, layout.who);

/** Remember whose work the user picked, in the ?who= form (undefined / "" = their default). */
export const rememberWho = (layout: WorkLayout, who: string | undefined): WorkLayout =>
  (layout.who ?? "") === (who ?? "")
    ? layout
    : withRemembered(layout, layout.view, who || undefined);

/**
 * A column or kind change (`next`, from the List or the Show menu — Reset layout included) with
 * the view and person `cur` remembers: those callers never mean to forget where the user was.
 */
export const keepRemembered = (next: WorkLayout, cur: WorkLayout): WorkLayout =>
  withRemembered(next, cur.view, cur.who);

/**
 * What Work Overview opens on: the URL's ?view / ?who when given, else the remembered ones, else
 * the defaults (the List; `who` null = the caller's default, resolveWho). The sidebar's link and
 * the sign-in landing carry no search, so they open where the user was (owner, Oct 15). The view
 * still goes through effectiveView (a remembered "owner" for a non-admin becomes the List).
 */
export function landingSearch(
  saved: Pick<WorkLayout, "view" | "who"> | null | undefined,
  url: { view?: string | null; who?: string | null },
): { view: WorkViewName; who: string | null } {
  const view = isView(url.view) ? url.view : (saved?.view ?? "list");
  const who = url.who || saved?.who || null;
  return { view, who };
}

/**
 * The profile's copy now rides on the list (listMyWork, Oct 15). It seeds the saved-layout cache
 * only when the cache is empty or the list is NEWER than the cache: a local change writes the
 * cache (the save's onMutate, stamped then), and a list fetched before that — one still in
 * React Query's cache when the page remounts, up to its 5-minute gcTime — must not put the old
 * layout back over a Reset or a hidden column. (Until Oct 15 the rule was a 4-minute wall-clock
 * window on the cache, which let exactly that stale list through once the window had passed.)
 * The list refreshes every five minutes, so a change made on another device shows within one.
 *
 * Oct 20, `listRequestedAt` is when the list request STARTED (the page stamps its queryFn), not
 * React Query's dataUpdatedAt, which is stamped when the fetch RESOLVES: a 5-minute refresh in
 * flight across a local change read the profile before the save, resolved after it with a newer
 * stamp, and seeded the pre-save layout back. The server read the layout no later than the
 * request started, so that is the stamp to compare. Two more holds (`opts`): nothing seeds while
 * a save is in flight (`saving`: its result settles the cache), and nothing seeds while the
 * browser's copy is the only good one (`localWins`: the last save failed — "kept on this device
 * only" — so a list bringing the server's copy must not undo it; the next change retries the
 * save and a success lifts the hold).
 */
export const shouldSeedWorkLayout = (
  cached: { data?: unknown; dataUpdatedAt: number } | undefined,
  listRequestedAt: number,
  opts: { saving?: boolean; localWins?: boolean } = {},
): boolean =>
  !opts.saving &&
  !opts.localWins &&
  (!cached ||
    cached.data === undefined ||
    !cached.dataUpdatedAt ||
    listRequestedAt > cached.dataUpdatedAt);

/** Tick or untick a kind under Show. The last kind showing cannot be unticked. */
export function toggleKind(layout: WorkLayout, kind: WorkKind): WorkLayout {
  if (layout.hiddenKinds.includes(kind))
    return { ...layout, hiddenKinds: layout.hiddenKinds.filter((k) => k !== kind) };
  if (layout.hiddenKinds.length >= WORK_KINDS.length - 1) return layout;
  return { ...layout, hiddenKinds: [...layout.hiddenKinds, kind] };
}

/** The items of the kinds still ticked (every item when nothing is unticked). */
export function applyKinds<T extends { kind: WorkKind }>(items: T[], layout: WorkLayout): T[] {
  if (!layout.hiddenKinds.length) return items;
  return items.filter((i) => !layout.hiddenKinds.includes(i.kind));
}

/** "Show: all", or "Show: 4 of 6" when some kinds are unticked. */
export const kindsSummary = (layout: WorkLayout): string =>
  layout.hiddenKinds.length
    ? `${WORK_KINDS.length - layout.hiddenKinds.length} of ${WORK_KINDS.length}`
    : "all";

export const kindLabel = (k: WorkKind): string => KIND_LABELS[k];

/**
 * The kinds to apply when the page landed from an Owner-view link (Oct 20): the link's number
 * counted every kind, so for that landing (a ?bucket= preset in the URL) the unticked kinds are
 * shown too — `layout` with no hidden kinds, and a muted `note` saying so, with what Show is set
 * to (kindsSummary). Without a preset, or with nothing unticked, the layout comes back as it is
 * and the note is null. The person's Show setting itself is untouched.
 */
export function kindsForLanding(
  layout: WorkLayout,
  preset: string | null | undefined,
): { layout: WorkLayout; note: string | null } {
  if (!preset || !layout.hiddenKinds.length) return { layout, note: null };
  return {
    layout: { ...layout, hiddenKinds: [] },
    note: `Showing every kind for this link (Show is ${kindsSummary(layout)}).`,
  };
}

/**
 * What a settled layout save writes (Oct 20 — two overlapping saves could resurrect the older
 * one: each wrote its own layout on settling, so a late failure of an older save re-flagged and
 * re-stored it over a newer one). `latest` is the layout last committed (the page's
 * latestLayoutRef); a result for any other layout is ignored (null). Otherwise the latest layout
 * is what the browser keeps, flagged unsaved when the save failed. Before any commit (`latest`
 * null — the retry of a stored copy on mount) the settled layout is the latest.
 */
export function applySaveResult(
  latest: WorkLayout | null,
  settled: WorkLayout,
  ok: boolean,
): { layout: WorkLayout; unsaved: boolean } | null {
  if (latest && settled !== latest) return null;
  return { layout: latest ?? settled, unsaved: !ok };
}

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

/**
 * Close a column with the X. The last one showing cannot be closed — among the columns the
 * viewer HAS (`present`, the List's groups; Oct 20): `order` holds every bucket there is, but a
 * viewer who neither authorizes nor invoices has no Needs authorization or Authorized column, so
 * counting those let them hide everything they could see and read "Nothing to do".
 */
export function hideBucket(
  layout: WorkLayout,
  bucket: WorkBucket,
  present: readonly WorkBucket[] | null = null,
): WorkLayout {
  if (layout.hidden.includes(bucket)) return layout;
  const showing = layout.order.filter(
    (b) => !layout.hidden.includes(b) && (!present || present.includes(b)),
  );
  if (!showing.some((b) => b !== bucket)) return layout;
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

/**
 * The browser's copy with its flag (Oct 20): `unsaved` — the last save to the profile failed
 * ("kept on this device only"), so this copy is the only good one and holds the list's seed off
 * until a save succeeds (the page retries once on mount). Stored beside the layout's own fields;
 * `normalizeWorkLayout` reads the old shape (no flag) and never carries the flag along, so it
 * is never sent to the profile.
 */
export interface StoredWorkLayout {
  layout: WorkLayout;
  unsaved: boolean;
}

/** The layout cached for this user in this browser, with its unsaved flag, or null. */
export function readStoredWork(
  storage: StorageLike | null,
  userId: string,
): StoredWorkLayout | null {
  try {
    const raw = storage?.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const unsaved =
      !!parsed && typeof parsed === "object" && (parsed as { unsaved?: unknown }).unsaved === true;
    return { layout: normalizeWorkLayout(parsed), unsaved };
  } catch {
    return null;
  }
}

/** The layout cached for this user in this browser, or null. */
export function readStoredWorkLayout(
  storage: StorageLike | null,
  userId: string,
): WorkLayout | null {
  return readStoredWork(storage, userId)?.layout ?? null;
}

/**
 * Cache the layout for this user in this browser (nothing to remember clears the cache — unless
 * it is `unsaved`: a Reset the profile refused must still be the copy that wins on remount).
 */
export function writeStoredWorkLayout(
  storage: StorageLike | null,
  userId: string,
  layout: WorkLayout,
  unsaved = false,
): void {
  try {
    if (isEmptyWorkLayout(layout) && !unsaved) storage?.removeItem(keyFor(userId));
    else
      storage?.setItem(
        keyFor(userId),
        JSON.stringify(unsaved ? { ...layout, unsaved: true } : layout),
      );
  } catch {
    // A private window or a full store: the page still lays out from memory.
  }
}

// ---- the person picker while peeking ---------------------------------------------------------

/**
 * Does picking a person under Show remember them on the layout (Oct 20)? Not while the person is
 * PEEKING: the page landed with an explicit `?view=list` (an Owner-view number link) that differs
 * from the view the layout remembers — the admin is on the List for a look at one person's work
 * and goes back to the Owner view; remembering that person would rewrite whose work they see
 * everywhere else. The view buttons remember as before (once the view is their own choice, the
 * URL's view and the layout's agree, and picks remember again).
 */
export function shouldRememberWho(
  landing: { viewExplicit: boolean; urlView: string | null | undefined },
  layoutView: WorkViewName | undefined,
): boolean {
  if (!landing.viewExplicit || landing.urlView !== "list") return true;
  return (layoutView ?? "list") === "list";
}
