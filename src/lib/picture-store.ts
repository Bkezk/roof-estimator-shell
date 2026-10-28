/**
 * Where a picture waits for signal on the phone (owner, Oct 28; lib/photo-upload-queue.ts): a
 * tiny IndexedDB wrapper — one database, one object store keyed by the picture's id, the shrunk
 * Blob and the registration details in each record — with no new dependency (package.json has no
 * idb / dexie / localforage). Everything is guarded: no `indexedDB` (SSR, an old WebView), an
 * open that fails or is blocked (Safari private mode, cleared site data) → `openPictureStore`
 * resolves to the in-memory store instead and says so (`fallback: true`), so the queue runs the
 * same way and the portal can put up its loud note. Each call opens its own transaction; a request
 * that errors rejects with the database's message.
 */
import {
  memoryPictureStore,
  type PictureStore,
  type StoredPicture,
} from "@/lib/photo-upload-queue";

export const PICTURE_DB = "jbk-pictures";
export const PICTURE_STORE = "pictures";
const VERSION = 1;

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("the phone's storage did not answer"));
  });

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(PICTURE_DB, VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(PICTURE_STORE))
        db.createObjectStore(PICTURE_STORE, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("the phone's storage could not be opened"));
    r.onblocked = () => reject(new Error("the phone's storage is in use by another tab"));
  });
}

/** The IndexedDB-backed store over an open database. */
export function indexedDbPictureStore(db: IDBDatabase): PictureStore {
  const tx = (mode: IDBTransactionMode) =>
    db.transaction(PICTURE_STORE, mode).objectStore(PICTURE_STORE);
  return {
    put: async (p: StoredPicture) => {
      await req(tx("readwrite").put(p));
    },
    remove: async (id: string) => {
      await req(tx("readwrite").delete(id));
    },
    all: async () => {
      const rows = (await req(tx("readonly").getAll())) as StoredPicture[];
      return rows
        .filter((r) => r && typeof r.id === "string" && r.picture && r.picture.blob instanceof Blob)
        .sort((a, b) => a.addedAt - b.addedAt);
    },
  };
}

/**
 * The store for this device: IndexedDB when it opens, else memory (`fallback` says which, so the
 * app can tell the technician that pictures waiting for signal live only while the page is open).
 */
export async function openPictureStore(
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<{ store: PictureStore; fallback: boolean; error: unknown }> {
  if (!factory) return { store: memoryPictureStore(), fallback: true, error: null };
  try {
    const db = await openDb(factory);
    // A probe write-free check: the store exists (a database another version created without it
    // would throw on the first transaction; better to know now).
    if (!db.objectStoreNames.contains(PICTURE_STORE))
      throw new Error("the picture store is missing");
    return { store: indexedDbPictureStore(db), fallback: false, error: null };
  } catch (e) {
    return { store: memoryPictureStore(), fallback: true, error: e };
  }
}
