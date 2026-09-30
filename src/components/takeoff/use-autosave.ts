/**
 * Debounced autosave for the takeoff editor. Local state stays authoritative: every change bumps
 * a version, a save sends the latest value, and a failure toasts once, shows "Save failed —
 * retrying" and tries again on the next change (and after a short back-off). Pending changes
 * are flushed before navigating away and on unmount.
 *
 * `locked` (a takeoff that built a bid, src/lib/takeoff/lock.ts) turns it off entirely: no change
 * is scheduled, nothing is sent on flush / unmount, leaving is never blocked, and anything pending
 * when the lock arrives is dropped (the server refuses it anyway).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";

import { shouldAutosave } from "@/lib/takeoff/lock";

export type SaveState = "idle" | "saving" | "saved" | "error";

const RETRY_MS = 5000;

export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<void>,
  delayMs = 800,
  locked = false,
): { state: SaveState; flush: () => Promise<boolean> } {
  const [state, setState] = useState<SaveState>("idle");
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const latest = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  const version = useRef(0);
  const savedVersion = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorToasted = useRef(false);
  const initial = useRef(value);

  const run = useCallback((): Promise<boolean> => {
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    if (lockedRef.current) return Promise.resolve(true);
    const p = (async () => {
      let ok = true;
      do {
        again.current = false;
        const v = version.current;
        setState("saving");
        try {
          await saveRef.current(latest.current);
          savedVersion.current = Math.max(savedVersion.current, v);
          errorToasted.current = false;
        } catch (e) {
          ok = false;
          setState("error");
          if (!errorToasted.current) {
            errorToasted.current = true;
            toast.error(`Takeoff not saved: ${e instanceof Error ? e.message : String(e)}`);
          }
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            if (savedVersion.current !== version.current) void run();
          }, RETRY_MS);
          break;
        }
      } while (again.current && savedVersion.current !== version.current);
      if (ok) setState(savedVersion.current !== version.current ? "saving" : "saved");
      inFlight.current = null;
      return ok;
    })();
    inFlight.current = p;
    return p;
  }, []);

  // Locked: stop the timers and drop anything pending.
  useEffect(() => {
    if (!locked) return;
    if (timer.current) clearTimeout(timer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    timer.current = null;
    retryTimer.current = null;
    savedVersion.current = version.current;
    setState("idle");
  }, [locked]);

  // Every change to the loaded document schedules a save (the loaded value itself does not).
  useEffect(() => {
    latest.current = value;
    if (!shouldAutosave({ locked: lockedRef.current, changed: value !== initial.current })) return;
    version.current += 1;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void run();
    }, delayMs);
  }, [value, delayMs, run]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) await inFlight.current;
    if (lockedRef.current || savedVersion.current === version.current) return true;
    return run();
  }, [run]);

  // Unmount: stop the timers and send whatever is still unsaved (fire and forget).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (lockedRef.current || savedVersion.current === version.current) return;
      const send = () => void saveRef.current(latest.current).catch(() => {});
      if (inFlight.current) void inFlight.current.then(send);
      else send();
    },
    [],
  );

  useBlocker({
    shouldBlockFn: async () => {
      if (lockedRef.current || savedVersion.current === version.current) return false;
      const ok = await flush();
      if (ok) return false;
      return !window.confirm("The latest takeoff changes could not be saved. Leave anyway?");
    },
    enableBeforeUnload: () => !lockedRef.current && savedVersion.current !== version.current,
  });

  return { state, flush };
}
