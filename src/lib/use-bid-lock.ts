import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { acquireBidLock, releaseBidLock } from "@/lib/bid-locks.functions";

/** Renew a held lock this often (well inside the server TTL). */
const HEARTBEAT_MS = 15_000;
/** While read-only, ask again this often — the editor leaving frees the bid within this window. */
const RETRY_MS = 8_000;

export interface LockHolder {
  name: string;
  userId: string;
}

/**
 * Per-tab edit lock on a saved bid. `sessionKey` identifies THIS tab (two windows on the same
 * account each get their own), so read-only mode also applies between two logins of one user.
 * Returns the current other holder (read-only) or null (this tab may edit), and whether the
 * lock was ever acquired here (so a viewer that just gained the lock can re-hydrate).
 */
export function useBidLock(args: {
  bidId: string | undefined;
  enabled: boolean;
  holderName: string;
  onAcquired?: (firstTime: boolean) => void;
}): { sessionKey: string; holder: LockHolder | null; readOnly: boolean } {
  const acquireFn = useServerFn(acquireBidLock);
  const releaseFn = useServerFn(releaseBidLock);
  const [sessionKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [holder, setHolder] = useState<LockHolder | null>(null);
  const onAcquiredRef = useRef(args.onAcquired);
  onAcquiredRef.current = args.onAcquired;
  const { bidId, enabled, holderName } = args;

  useEffect(() => {
    if (!bidId || !enabled) {
      setHolder(null);
      return;
    }
    let active = true;
    let held = false;
    let everHeld = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!active) return;
      try {
        const r = await acquireFn({ data: { bidId, sessionKey, holderName } });
        if (!active) return;
        if (r.acquired) {
          const wasHeld = held;
          held = true;
          setHolder(null);
          if (!wasHeld) {
            onAcquiredRef.current?.(!everHeld);
            everHeld = true;
          }
          timer = setTimeout(tick, HEARTBEAT_MS);
        } else {
          held = false;
          setHolder({ name: r.holderName, userId: r.holderUser });
          timer = setTimeout(tick, RETRY_MS);
        }
      } catch {
        // Network blip: keep whatever state we had and try again soon.
        if (active) timer = setTimeout(tick, RETRY_MS);
      }
    };
    void tick();
    const release = () => {
      if (held) void releaseFn({ data: { bidId, sessionKey } }).catch(() => undefined);
    };
    window.addEventListener("pagehide", release);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [bidId, enabled, holderName, sessionKey, acquireFn, releaseFn]);

  return { sessionKey, holder, readOnly: holder !== null };
}
