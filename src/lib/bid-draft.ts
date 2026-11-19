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
 *     every new bid shares one slot ("new") for that person on that computer.
 *   - A draft is never put on the page by itself. Opening the bid asks: restore it, or discard
 *     it. Nothing is written over the draft until that is answered.
 *   - Saving, discarding, and "Leave without saving" remove it.
 */
import { bidChangedSince } from "@/lib/bid-lock-return";
import type { BidHeader } from "@/lib/bid-header-patch";

/** How long after a change the draft is written. */
export const BID_DRAFT_DELAY_MS = 1500;
export const BID_DRAFT_VERSION = 1;
/** The slot of a bid that has no id yet. */
export const NEW_BID_SLOT = "new";

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

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const orNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * A stored draft, read strictly: anything that is not a whole draft of THIS person for THIS bid
 * is no draft. Another person's draft on a shared computer is never offered.
 */
export function readDraft(
  x: unknown,
  want: { userId: string; bidId: string | null },
): BidDraft | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o["v"] !== BID_DRAFT_VERSION) return null;
  if (o["userId"] !== want.userId) return null;
  if ((orNull(o["bidId"]) ?? null) !== (want.bidId ?? null)) return null;
  if (o["key"] !== draftKey(want.userId, want.bidId)) return null;
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

/** The question, in plain words. */
export function draftWords(o: DraftOffer, tz?: string): { title: string; body: string } {
  const d = o.draft;
  const at = when(d.savedAt, tz);
  const name = d.name.trim();
  const what = d.bidId
    ? "this bid"
    : name && name !== "Untitled bid"
      ? `a new bid, “${name}”,`
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
  put: (draft: BidDraft) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

/** Kept only while the page is open: the stand-in when the browser has no storage, and for tests. */
export function memoryDraftStore(): BidDraftStore & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    get: async (key) => rows.get(key),
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
