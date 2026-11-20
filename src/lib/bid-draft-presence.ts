/**
 * How the estimator tells whether the window a new bid was typed in is still open
 * (lib/bid-draft.ts DraftPresence; owner, Nov 20: "fix on 1").
 *
 * Each new bid's draft has a slot of its own. The window that has the bid open holds the slot,
 * so another window opening a new bid is not offered work that is still in progress, and is
 * offered it once that window is gone.
 *
 *   - The Web Locks API where the browser has it (every current one): a lock is let go by the
 *     browser itself the moment its window closes, reloads or crashes, so a closed window's
 *     work is offered at once and an open window's never is.
 *   - Without it, a mark in the browser's storage that the open window renews every few
 *     seconds. A window that stops renewing (closed or crashed) counts as gone once its mark is
 *     HEARTBEAT_STALE_MS old: long enough for a tab in the background, whose timers the browser
 *     slows to about one a minute.
 *   - With neither, nothing is known to be open. That browser has no shared storage for drafts
 *     either, so there is nothing of another window's to offer.
 */
import { isSlotId, memoryPresence, type DraftPresence, type TabSlot } from "@/lib/bid-draft";

export const LOCK_PREFIX = "jbk-bid-draft:";
export const HEARTBEAT_PREFIX = "jbk-bid-draft-live:";
export const HEARTBEAT_MS = 5_000;
export const HEARTBEAT_STALE_MS = 90_000;
export const TAB_SLOT_KEY = "jbk-bid-draft-slot";

/** The part of the Web Locks API this needs. */
export interface LocksLike {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ) => Promise<unknown>;
  query: () => Promise<{ held?: { name?: string }[] }>;
}

/** Held with the browser's own locks: let go by the browser when the window goes. */
export function webLocksPresence(locks: LocksLike): DraftPresence {
  // This window's own holds: a slot it already has is given again without asking the browser.
  const mine = new Map<string, { count: number; free: () => void }>();
  const letGo = (slot: string) => () => {
    const h = mine.get(slot);
    if (!h) return;
    h.count -= 1;
    // A moment later, and only if nothing took it up again: a page that lets go and holds again
    // in the same breath keeps its lock.
    setTimeout(() => {
      const now = mine.get(slot);
      if (now && now.count <= 0) {
        mine.delete(slot);
        now.free();
      }
    }, 0);
  };
  const once = (f: () => void) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      f();
    };
  };
  return {
    hold: async (slot) => {
      const have = mine.get(slot);
      if (have) {
        have.count += 1;
        return once(letGo(slot));
      }
      const free = await new Promise<(() => void) | null>((resolve) => {
        locks
          .request(LOCK_PREFIX + slot, { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(null);
              return;
            }
            // Kept until `free` is called, or the window goes.
            return new Promise<void>((done) => resolve(done));
          })
          .catch(() => resolve(null));
      });
      if (!free) return null;
      mine.set(slot, { count: 1, free });
      return once(letGo(slot));
    },
    live: async () => {
      const out = new Set<string>(mine.keys());
      try {
        const q = await locks.query();
        for (const l of q.held ?? [])
          if (l.name?.startsWith(LOCK_PREFIX)) out.add(l.name.slice(LOCK_PREFIX.length));
      } catch {
        // Not answered: only this window's own are known.
      }
      return out;
    },
  };
}

/** The part of the browser's key/value storage this needs. */
export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  key: (i: number) => string | null;
  readonly length: number;
}

/** Held with a mark that is renewed while the window is open. */
export function heartbeatPresence(
  storage: StorageLike,
  clock: {
    now: () => number;
    every: (f: () => void, ms: number) => () => void;
  } = {
    now: () => Date.now(),
    every: (f, ms) => {
      const t = setInterval(f, ms);
      return () => clearInterval(t);
    },
  },
): DraftPresence {
  const mine = new Map<string, { count: number; stop: () => void }>();
  const fresh = (slot: string): boolean => {
    const at = Number(storage.getItem(HEARTBEAT_PREFIX + slot));
    return Number.isFinite(at) && at > 0 && clock.now() - at < HEARTBEAT_STALE_MS;
  };
  const mark = (slot: string) => {
    try {
      storage.setItem(HEARTBEAT_PREFIX + slot, String(clock.now()));
    } catch {
      // Storage full or blocked: the mark is missed this once.
    }
  };
  return {
    hold: async (slot) => {
      const have = mine.get(slot);
      if (have) have.count += 1;
      else {
        if (fresh(slot)) return null;
        mark(slot);
        mine.set(slot, { count: 1, stop: clock.every(() => mark(slot), HEARTBEAT_MS) });
      }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const h = mine.get(slot);
        if (!h) return;
        h.count -= 1;
        if (h.count > 0) return;
        mine.delete(slot);
        h.stop();
        try {
          storage.removeItem(HEARTBEAT_PREFIX + slot);
        } catch {
          // It goes stale by itself.
        }
      };
    },
    live: async () => {
      const out = new Set<string>(mine.keys());
      const stale: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (!k?.startsWith(HEARTBEAT_PREFIX)) continue;
        const slot = k.slice(HEARTBEAT_PREFIX.length);
        if (fresh(slot)) out.add(slot);
        else if (!mine.has(slot)) stale.push(k);
      }
      // A window that went without letting go: its old mark is cleared away.
      for (const k of stale) {
        try {
          storage.removeItem(k);
        } catch {
          // Left for next time.
        }
      }
      return out;
    },
  };
}

/** The way this browser has: its locks, else the renewed mark, else nothing shared. */
export function openDraftPresence(
  env: { locks?: LocksLike | undefined; storage?: StorageLike | undefined } = browserEnv(),
): DraftPresence & { how: "locks" | "heartbeat" | "none" } {
  if (env.locks) return { ...webLocksPresence(env.locks), how: "locks" };
  if (env.storage) return { ...heartbeatPresence(env.storage), how: "heartbeat" };
  return { ...memoryPresence(), how: "none" };
}

function browserEnv(): { locks?: LocksLike; storage?: StorageLike } {
  const out: { locks?: LocksLike; storage?: StorageLike } = {};
  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (locks && typeof locks.request === "function" && typeof locks.query === "function")
      out.locks = locks as unknown as LocksLike;
  } catch {
    // No locks here.
  }
  try {
    if (typeof localStorage !== "undefined") out.storage = localStorage;
  } catch {
    // Storage blocked.
  }
  return out;
}

/**
 * Where a tab keeps its own slot: the browser's per-tab storage, which lasts through a reload
 * and is not shared with other tabs. Blocked or missing: remembered while the page is open.
 */
export function tabSlotStore(
  storage: Pick<StorageLike, "getItem" | "setItem"> | undefined = tabStorage(),
): TabSlot {
  let kept: string | null = null;
  return {
    get: () => {
      try {
        const v = storage?.getItem(TAB_SLOT_KEY) ?? kept;
        return isSlotId(v) ? v : null;
      } catch {
        return kept;
      }
    },
    set: (slot) => {
      kept = slot;
      try {
        storage?.setItem(TAB_SLOT_KEY, slot);
      } catch {
        // Kept for this page only.
      }
    },
  };
}

function tabStorage(): Pick<StorageLike, "getItem" | "setItem"> | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
