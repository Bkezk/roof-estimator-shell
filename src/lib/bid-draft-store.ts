/**
 * Where a bid's unsaved work is kept in the browser (lib/bid-draft.ts): IndexedDB, one record
 * for each person and bid, and one for each new bid's slot (Nov 20). A bid's data runs to a few hundred thousand characters with its
 * frozen prices, which a handful of would fill the browser's small key/value storage; IndexedDB
 * holds it without that limit and without stopping the page while it writes. No new dependency
 * (the same hand-made wrapper as lib/picture-store.ts).
 *
 * Everything is guarded: no `indexedDB`, or an open that fails or is blocked (a private window,
 * site data cleared), gives the in-memory store, which keeps a draft only while the page is
 * open. `fallback` says so.
 */
import { memoryDraftStore, type BidDraft, type BidDraftStore } from "@/lib/bid-draft";

export const BID_DRAFT_DB = "jbk-bid-drafts";
export const BID_DRAFT_STORE = "drafts";
const VERSION = 1;

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("the browser's storage did not answer"));
  });

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(BID_DRAFT_DB, VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(BID_DRAFT_STORE))
        db.createObjectStore(BID_DRAFT_STORE, { keyPath: "key" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("the browser's storage could not be opened"));
    r.onblocked = () => reject(new Error("the browser's storage is in use by another tab"));
  });
}

export function indexedDbDraftStore(db: IDBDatabase): BidDraftStore {
  const tx = (mode: IDBTransactionMode) =>
    db.transaction(BID_DRAFT_STORE, mode).objectStore(BID_DRAFT_STORE);
  return {
    get: async (key: string) => req(tx("readonly").get(key)),
    all: async () => req(tx("readonly").getAll()) as Promise<unknown[]>,
    put: async (draft: BidDraft) => {
      await req(tx("readwrite").put(draft));
    },
    remove: async (key: string) => {
      await req(tx("readwrite").delete(key));
    },
  };
}

/** The store for this browser: IndexedDB when it opens, else memory (`fallback`). */
export async function openBidDraftStore(
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<{ store: BidDraftStore; fallback: boolean }> {
  if (!factory) return { store: memoryDraftStore(), fallback: true };
  try {
    const db = await openDb(factory);
    if (!db.objectStoreNames.contains(BID_DRAFT_STORE))
      throw new Error("the draft store is missing");
    return { store: indexedDbDraftStore(db), fallback: false };
  } catch {
    return { store: memoryDraftStore(), fallback: true };
  }
}
