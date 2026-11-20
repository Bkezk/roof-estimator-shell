/**
 * The unsaved work on a bid, kept in the browser and offered back (owner, Nov 19: an estimator
 * left a bid and "lost work"; his go was for "keep an unsaved draft in the browser and offer to
 * restore it"). The rules only, no I/O; lib/bid-draft-store.ts is where it is kept, and the
 * estimator (routes/estimate.tsx) does the writing and the asking.
 *
 * Until now whatever was not saved lived only on the page. A lost sign-in, a browser that
 * closed, a computer that shut down, or a reload of a bid started from PlanSwift threw it away.
 *
 *   - While a bid has unsaved changes the page writes them here a moment after each change:
 *     exactly what Save would send, plus the name, the customer link and the header.
 *   - One draft for each bid and each person. A bid that has never been saved has no id, so
 *     each one gets a slot of its own, held by the window it is open in (owner, Nov 20: "fix on
 *     1"). Until then every new bid shared one slot ("new"), and two new bids open at once in
 *     two windows were offered each other's work.
 *   - A new bid's draft is offered when a new bid is opened and no open window holds it: the
 *     window it was typed in was closed, crashed, or is this very tab after a reload. Several
 *     waiting are each offered by name. One still open in another window is left alone.
 *   - A draft is never put on the page by itself. Opening the bid asks: restore it, or discard
 *     it. Nothing is written over the draft until that is answered.
 *   - Saving, discarding, and "Leave without saving" remove it.
 */
import { bidChangedSince } from "@/lib/bid-lock-return";
import type { BidHeader } from "@/lib/bid-header-patch";

/** How long after a change the draft is written. */
export const BID_DRAFT_DELAY_MS = 1500;
export const BID_DRAFT_VERSION = 1;
/**
 * The slot of a bid that has no id yet, as it was until Nov 20: one for all of a person's new
 * bids. Drafts still sitting under it are offered once; nothing new is written there.
 */
export const NEW_BID_SLOT = "new";
/** A new bid's draft that no open window holds is removed after this many days. */
export const NEW_DRAFT_MAX_AGE_DAYS = 30;
/** No more than this many new bids' drafts wait for one person on one computer. */
export const NEW_DRAFT_MAX_KEPT = 10;

export interface BidDraft {
  v: typeof BID_DRAFT_VERSION;
  /** Where it is kept: the person and the bid (draftKey). */
  key: string;
  userId: string;
  /** Null for a bid that was never saved. */
  bidId: string | null;
  /** When this draft was written. */
  savedAt: string;
  /** The saved bid this work started from (its updated_at); null for a new bid. */
  baseUpdatedAt: string | null;
  name: string;
  accountId: string | null;
  siteId: string | null;
  accountLabel: string;
  /** The customer link was changed on the page, so Save has to send it. */
  linkChanged: boolean;
  buildingId: string | null;
  /** What a new bid was started from, so its first Save still links them. */
  opportunityId: string | null;
  inspectionId: string | null;
  header: BidHeader;
  /** What Save sends as the bid's data. */
  data: Record<string, unknown> & { sections: unknown[] };
  /** The page's own "is it changed" text for this work: the same work twice reads the same. */
  print: string;
}

export const draftKey = (userId: string, bidId: string | null | undefined): string =>
  `bid-draft:${userId}:${bidId || NEW_BID_SLOT}`;

// ── A new bid's own slot (Nov 20) ──────────────────────────────────────────────────────────
/** Where a new bid's draft is kept: the person, and the slot of the window it is open in. */
export const newDraftKey = (userId: string, slot: string): string =>
  `${draftKey(userId, null)}:${slot}`;
const SLOT = /^[a-z0-9-]{8,64}$/;
export const isSlotId = (v: unknown): v is string => typeof v === "string" && SLOT.test(v);
/** Is this the key of one of this person's new bids: the old shared one, or a slot's. */
export function isNewDraftKey(userId: string, key: unknown): key is string {
  if (typeof key !== "string") return false;
  const old = draftKey(userId, null);
  return key === old || (key.startsWith(`${old}:`) && isSlotId(key.slice(old.length + 1)));
}
/** The slot a new bid's key names; null for the old shared key and for any other key. */
export function slotOfKey(userId: string, key: string): string | null {
  const old = draftKey(userId, null);
  return isNewDraftKey(userId, key) && key !== old ? key.slice(old.length + 1) : null;
}
/** A fresh slot id. */
export function newSlotId(
  rand: () => string = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
): string {
  return rand().toLowerCase();
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const orNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * A stored draft, read strictly: anything that is not a whole draft of THIS person for THIS bid
 * is no draft. Another person's draft on a shared computer is never offered.
 */
export function readDraft(
  x: unknown,
  want: {
    userId: string;
    bidId: string | null;
    /** A new bid's own key (newDraftKey); left out, the bid's one key. */
    key?: string;
  },
): BidDraft | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o["v"] !== BID_DRAFT_VERSION) return null;
  if (o["userId"] !== want.userId) return null;
  if ((orNull(o["bidId"]) ?? null) !== (want.bidId ?? null)) return null;
  // A key of its own is only ever a new bid's, and only one of this person's.
  if (want.key !== undefined && (want.bidId || !isNewDraftKey(want.userId, want.key))) return null;
  if (o["key"] !== (want.key ?? draftKey(want.userId, want.bidId))) return null;
  const savedAt = str(o["savedAt"]);
  if (!savedAt || Number.isNaN(new Date(savedAt).getTime())) return null;
  const data = o["data"] as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || !Array.isArray(data["sections"])) return null;
  const h = o["header"] as Record<string, unknown> | null;
  if (!h || typeof h !== "object" || typeof h["status"] !== "string") return null;
  const name = str(o["name"]);
  const print = str(o["print"]);
  if (name === null || !print) return null;
  return {
    v: BID_DRAFT_VERSION,
    key: o["key"] as string,
    userId: want.userId,
    bidId: want.bidId ?? null,
    savedAt,
    baseUpdatedAt: orNull(o["baseUpdatedAt"]),
    name,
    accountId: orNull(o["accountId"]),
    siteId: orNull(o["siteId"]),
    accountLabel: str(o["accountLabel"]) ?? "",
    linkChanged: o["linkChanged"] === true,
    buildingId: orNull(o["buildingId"]),
    opportunityId: orNull(o["opportunityId"]),
    inspectionId: orNull(o["inspectionId"]),
    header: {
      status: h["status"] as BidHeader["status"],
      lostReason: orNull(h["lostReason"]),
      wonOn: str(h["wonOn"]) ?? "",
      dueDate: str(h["dueDate"]) ?? "",
      folder: str(h["folder"]) ?? "",
      reminderOn: str(h["reminderOn"]) ?? "",
      reminderNote: str(h["reminderNote"]) ?? "",
    },
    data: data as BidDraft["data"],
    print,
  };
}

/** One of this person's new bids' drafts, whichever slot it is kept under; else null. */
export function readNewDraft(x: unknown, userId: string): BidDraft | null {
  const key = x && typeof x === "object" ? (x as Record<string, unknown>)["key"] : null;
  if (!isNewDraftKey(userId, key)) return null;
  return readDraft(x, { userId, bidId: null, key });
}

export interface DraftOffer {
  draft: BidDraft;
  /** The bid was saved again after the work in the draft was started. */
  changedSince: boolean;
}

/**
 * Whether opening the bid asks about a draft. `page`: the bid as the page holds it now (its
 * saved row's updated_at, null for a new bid, and its own "is it changed" text).
 *
 *   - no draft: nothing to ask;
 *   - the draft is the very work the page already shows: nothing to ask (it is dropped);
 *   - else ask, and say so when the bid was saved again since the draft's work began.
 */
export function draftOffer(
  draft: BidDraft | null,
  page: { updatedAt: string | null; print: string },
): DraftOffer | null {
  if (!draft) return null;
  if (draft.print === page.print) return null;
  return {
    draft,
    changedSince: draft.bidId ? bidChangedSince(draft.baseUpdatedAt, page.updatedAt) : false,
  };
}

/**
 * The new bids' drafts to ask about when a new bid is opened, the newest first, and the keys to
 * remove. `rows`: everything in the store. `mySlot`: this tab's own slot. `live`: the slots an
 * open window holds now.
 *
 *   - another person's rows, and saved bids' drafts, are not looked at;
 *   - one that is not a whole draft is removed;
 *   - one held by another open window is left alone: it is that window's work in progress;
 *   - this tab's own, when it is the very work the page already shows, is removed;
 *   - one no window holds that is older than NEW_DRAFT_MAX_AGE_DAYS is removed;
 *   - past NEW_DRAFT_MAX_KEPT, the oldest are removed.
 */
export function waitingNewDrafts(
  rows: readonly unknown[],
  a: {
    userId: string;
    mySlot: string | null;
    live: ReadonlySet<string>;
    now: Date;
    pagePrint: string;
  },
): { offers: DraftOffer[]; drop: string[] } {
  const drop: string[] = [];
  const waiting: BidDraft[] = [];
  const oldest = a.now.getTime() - NEW_DRAFT_MAX_AGE_DAYS * 86_400_000;
  for (const row of rows) {
    const key = row && typeof row === "object" ? (row as Record<string, unknown>)["key"] : null;
    if (!isNewDraftKey(a.userId, key)) continue;
    const d = readNewDraft(row, a.userId);
    if (!d) {
      drop.push(key);
      continue;
    }
    const slot = slotOfKey(a.userId, key);
    const mine = !!slot && slot === a.mySlot;
    if (!mine && slot && a.live.has(slot)) continue;
    if (mine && d.print === a.pagePrint) {
      drop.push(key);
      continue;
    }
    if (!mine && new Date(d.savedAt).getTime() < oldest) {
      drop.push(key);
      continue;
    }
    waiting.push(d);
  }
  waiting.sort((x, y) => new Date(y.savedAt).getTime() - new Date(x.savedAt).getTime());
  for (const d of waiting.slice(NEW_DRAFT_MAX_KEPT)) drop.push(d.key);
  return {
    offers: waiting.slice(0, NEW_DRAFT_MAX_KEPT).map((draft) => ({ draft, changedSince: false })),
    drop,
  };
}

/** The states of the question: not read yet, asked, answered (or nothing to ask). */
export type DraftGate = "checking" | "asking" | "open";

/**
 * May the page write its unsaved work now? Never before the question is answered (a draft is
 * not written over unasked), never from a read-only page, never while a save is going through,
 * and only when there is something unsaved.
 */
export function mayWriteDraft(s: {
  gate: DraftGate;
  dirty: boolean;
  readOnly: boolean;
  saving: boolean;
}): boolean {
  return s.gate === "open" && s.dirty && !s.readOnly && !s.saving;
}

/**
 * Is this unsaved page worth keeping? A saved bid's always is. A NEW bid starts out "changed"
 * by its own starting fills (the default labor and markup, the estimator's name, an import), so
 * one that nobody has typed into holds nothing of anyone's work: `start` is the page as it
 * stood before the first key or click, and only a page that differs from it is kept.
 */
export function worthKeeping(print: string, isNew: boolean, start: string | null): boolean {
  if (!print) return false;
  return !isNew || print !== start;
}

const when = (iso: string, tz?: string): string =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  });

export const DRAFT_RESTORE = "Restore it";
export const DRAFT_DISCARD = "Discard it";
export const DRAFT_RESTORED = "Your unsaved work is back on the page. Press Save to keep it.";
export const DRAFT_DISCARDED = "The unsaved work was discarded.";

export const DRAFT_TAKEN =
  "That work was just opened in another window. It is not lost: carry on with it there.";

/** What a new bid's draft is called: its name if one was typed, else its customer. */
export function draftLabel(d: Pick<BidDraft, "name" | "accountLabel">): string {
  const name = d.name.trim();
  if (name && name !== "Untitled bid") return `“${name}”`;
  const customer = d.accountLabel.trim();
  return customer ? `for ${customer}` : "";
}

/** The question when more than one new bid's work waits: each by name, with when it was typed. */
export function draftListWords(
  offers: readonly DraftOffer[],
  tz?: string,
): { title: string; body: string; rows: { key: string; label: string; when: string }[] } {
  return {
    title: "Restore your unsaved work?",
    body: `Unsaved work on ${offers.length} new bids was kept on this computer. None of it was ever saved. Restore one to carry on where you stopped, or discard what you do not need. The others stay here until you answer for them.`,
    rows: offers.map((o) => ({
      key: o.draft.key,
      label: draftLabel(o.draft) ? `New bid ${draftLabel(o.draft)}` : "New bid with no name yet",
      when: when(o.draft.savedAt, tz),
    })),
  };
}

/** The question, in plain words. */
export function draftWords(o: DraftOffer, tz?: string): { title: string; body: string } {
  const d = o.draft;
  const at = when(d.savedAt, tz);
  const label = draftLabel(d);
  const what = d.bidId
    ? "this bid"
    : label.startsWith("“")
      ? `a new bid, ${label},`
      : label
        ? `a new bid ${label}`
        : "a new bid";
  const base = `Unsaved work on ${what} from ${at} was kept on this computer. It was never saved.`;
  const choice = d.bidId
    ? " Restore it to carry on where you stopped, or discard it and keep the bid as it was last saved."
    : " Restore it to carry on where you stopped, or discard it and start fresh.";
  const changed = o.changedSince
    ? " This bid has been saved again since that work was done. If you restore it and press Save, your work replaces what was saved since."
    : "";
  return { title: "Restore your unsaved work?", body: base + choice + changed };
}

/** Where drafts are kept. Every call may fail (blocked storage); the page carries on. */
export interface BidDraftStore {
  get: (key: string) => Promise<unknown>;
  /** Everything kept: a handful of rows at most. */
  all: () => Promise<unknown[]>;
  put: (draft: BidDraft) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

/** Kept only while the page is open: the stand-in when the browser has no storage, and for tests. */
export function memoryDraftStore(): BidDraftStore & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    get: async (key) => rows.get(key),
    all: async () => [...rows.values()],
    // A copy, as real storage keeps one: later changes to the page's objects do not reach it.
    put: async (draft) => void rows.set(draft.key, JSON.parse(JSON.stringify(draft))),
    remove: async (key) => void rows.delete(key),
  };
}

/**
 * One thing at a time, in the order asked: a write that was started is finished before the
 * removal that follows it, so a draft never comes back after it was dropped. A failure is
 * handed to `onError` and the next one still runs.
 */
export function draftQueue(onError: (e: unknown) => void = () => {}) {
  let tail: Promise<void> = Promise.resolve();
  return (op: () => Promise<void>): Promise<void> => {
    tail = tail.then(op).catch(onError);
    return tail;
  };
}

// ── Which window holds a new bid's slot (Nov 20) ───────────────────────────────────────────

/**
 * How one window tells the others that a new bid's slot is open in it. lib/bid-draft-presence.ts
 * has the browser's (the Web Locks API, which lets go by itself when a window closes or
 * crashes, with a fallback).
 */
export interface DraftPresence {
  /** Hold the slot while this window has the bid open. Null: another open window holds it. */
  hold: (slot: string) => Promise<(() => void) | null>;
  /** The slots an open window holds now, this one's included. */
  live: () => Promise<Set<string>>;
}

/**
 * Windows that share `registry`: the stand-in when the browser has no way to tell, and for
 * tests. One call is one window; a window may hold its own slot more than once.
 */
export function memoryPresence(registry: Map<string, object> = new Map()): DraftPresence {
  const me = {};
  const mine = new Map<string, number>();
  return {
    hold: async (slot) => {
      const holder = registry.get(slot);
      if (holder && holder !== me) return null;
      registry.set(slot, me);
      mine.set(slot, (mine.get(slot) ?? 0) + 1);
      let let_go = false;
      return () => {
        if (let_go) return;
        let_go = true;
        const n = (mine.get(slot) ?? 1) - 1;
        if (n > 0) mine.set(slot, n);
        else {
          mine.delete(slot);
          if (registry.get(slot) === me) registry.delete(slot);
        }
      };
    },
    live: async () => new Set(registry.keys()),
  };
}

/** Where a tab remembers its own slot, so a reload gets its own draft back. */
export interface TabSlot {
  get: () => string | null;
  set: (slot: string) => void;
}

/**
 * This tab's slot for a new bid, held. The tab's own from before a reload when it has one and
 * no other window holds it (a duplicated tab carries a copy of the first one's: it gets a slot
 * of its own instead); else a fresh one.
 */
export async function claimNewSlot(
  presence: DraftPresence,
  tab: TabSlot,
  mint: () => string = newSlotId,
): Promise<{ slot: string; release: () => void }> {
  const had = tab.get();
  if (isSlotId(had)) {
    const release = await presence.hold(had);
    if (release) return { slot: had, release };
  }
  let slot = mint();
  for (let i = 0; i < 3; i++) {
    const release = await presence.hold(slot);
    if (release) {
      tab.set(slot);
      return { slot, release };
    }
    slot = mint();
  }
  // Nothing could be held (the browser's own trouble): the page still gets a slot to write to.
  tab.set(slot);
  return { slot, release: () => {} };
}

/**
 * This tab takes over a draft that no window holds, to carry on with it: it moves to the
 * draft's slot. The old shared draft has no slot: it is moved to a fresh one. Null: another
 * window took it first, and nothing is changed.
 */
export async function takeOverDraft(
  draft: BidDraft,
  a: { presence: DraftPresence; tab: TabSlot; store: BidDraftStore; mint?: () => string },
): Promise<{ slot: string; key: string; release: () => void } | null> {
  const its = slotOfKey(draft.userId, draft.key);
  if (its) {
    const release = await a.presence.hold(its);
    if (!release) return null;
    a.tab.set(its);
    return { slot: its, key: draft.key, release };
  }
  const slot = (a.mint ?? newSlotId)();
  const release = await a.presence.hold(slot);
  if (!release) return null;
  const key = newDraftKey(draft.userId, slot);
  await a.store.put({ ...draft, key });
  await a.store.remove(draft.key);
  a.tab.set(slot);
  return { slot, key, release };
}
