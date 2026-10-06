/**
 * The edit-lock session key of THIS browser tab (owner, Oct 6: "a refreshed page locks out the
 * user even if they're the one making the changes"). The key used to be a fresh random id on
 * every mount, so a refresh came back as a stranger: the old tab's lock lingers until its
 * 45-second heartbeat lapses (the release sent on pagehide rarely completes), and the refreshed
 * page read "Read only: <your own name> is editing this bid" until then. Now the key lives in
 * sessionStorage, which is per tab and survives a refresh, so acquire_bid_lock sees the same
 * session and hands the lock straight back. Two tabs still get two keys (sessionStorage is not
 * shared between tabs), so read-only between two windows works as before.
 */
export const BID_LOCK_SESSION_KEY = "bid-o-matic:bid-lock-session";

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const fresh = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** This tab's key: the stored one, else a new one stored for the next load; a new one when storage is blocked. */
export function bidLockSessionKey(storage: KeyStorage | null | undefined): string {
  try {
    const have = storage?.getItem(BID_LOCK_SESSION_KEY);
    if (have && have.length >= 8 && have.length <= 80) return have;
    const key = fresh();
    storage?.setItem(BID_LOCK_SESSION_KEY, key);
    return key;
  } catch {
    return fresh();
  }
}
