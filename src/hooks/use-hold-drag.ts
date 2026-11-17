/**
 * Hold, then drag, with a finger (the rules: lib/hold-drag.ts). Browser only.
 *
 * `bind(id)` gives a ticket its touch handler. Targets are any element carrying `data-drop`; the
 * one under the finger is reported by its key. The lifted ticket's picture is a single element
 * (`ghost`) moved directly, so a drag does not re-render the board on every frame.
 *
 * Three things a touch screen needs that are easy to miss:
 *   - the move / end listeners sit on the ticket itself, because a ticket that leaves the page
 *     mid-drag (the board switched day) still receives its finger's events, and nothing else does;
 *   - iPhones only let a move be cancelled when a cancelling listener existed before the finger
 *     went down, so one is kept on the window while the board is on the page;
 *   - the lift comes after HOLD_MS with the finger still, so a swipe on a ticket still scrolls.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
  type TouchEvent as ReactTouch,
} from "react";

import {
  DWELL_MS,
  HOLD_MS,
  edgeScrollAfterWait,
  lift,
  move,
  press,
  release,
} from "@/lib/hold-drag";

export interface HoldDragOptions {
  /** The lifted ticket's picture: shown and moved while dragging. */
  ghost: RefObject<HTMLElement | null>;
  /** The scrolling list's top edge on the screen (the bottom of the day buttons). */
  topEdge?: () => number;
  /** The scrolling list's bottom edge on the screen (the top of the tray). */
  bottomEdge?: () => number;
  onLift: (id: string) => void;
  onOver: (key: string | null) => void;
  /** The finger let go over `key` (null: over nothing). */
  onDrop: (id: string, key: string | null) => void;
  /** The drag is over, dropped or not. */
  onEnd: () => void;
  /** Rested on this target for DWELL_MS (asked only where `dwells` says yes). */
  dwells?: (key: string) => boolean;
  onDwell?: (key: string) => void;
}

const noop = () => {};

export function useHoldDrag(opts: HoldDragOptions) {
  const o = useRef(opts);
  o.current = opts;
  /** Ends the drag in progress without a drop (the board left the page). */
  const abort = useRef<(() => void) | null>(null);

  useEffect(() => {
    // See the header: iPhones need a cancelling move listener in place before a touch starts.
    window.addEventListener("touchmove", noop, { passive: false });
    return () => {
      window.removeEventListener("touchmove", noop);
      abort.current?.();
    };
  }, []);

  return useCallback((id: string) => {
    const onTouchStart = (e: ReactTouch<HTMLElement>) => {
      if (e.touches.length !== 1 || abort.current) return;
      const el = e.currentTarget;
      const first = e.touches[0]!;
      let state = press(first.clientX, first.clientY);
      let over: string | null = null;
      let dwell: ReturnType<typeof setTimeout> | null = null;
      let frame = 0;
      let inBandSince: number | null = null;
      let done = false;

      const ghost = () => o.current.ghost.current;
      const place = () => {
        const g = ghost();
        if (g) g.style.transform = `translate3d(${state.x}px, ${state.y}px, 0)`;
      };
      const locate = () => {
        const hit = document.elementFromPoint(state.x, state.y)?.closest("[data-drop]");
        const key = hit?.getAttribute("data-drop") || null;
        if (key === over) return;
        over = key;
        if (dwell) clearTimeout(dwell);
        dwell = null;
        o.current.onOver(key);
        if (key && o.current.dwells?.(key))
          dwell = setTimeout(() => {
            if (!done && over === key) o.current.onDwell?.(key);
          }, DWELL_MS);
      };
      const tick = () => {
        if (done) return;
        const top = o.current.topEdge?.() ?? 0;
        const bottom = o.current.bottomEdge?.() ?? window.innerHeight;
        const edge = edgeScrollAfterWait(state.y, top, bottom, inBandSince, performance.now());
        inBandSince = edge.since;
        const by = edge.by;
        if (by) {
          window.scrollBy(0, by);
          locate();
        }
        frame = requestAnimationFrame(tick);
      };

      const timer = setTimeout(() => {
        state = lift(state);
        if (state.phase !== "dragging") return;
        try {
          navigator.vibrate?.(12);
        } catch {
          /* no buzz on this phone */
        }
        o.current.onLift(id);
        const g = ghost();
        if (g) g.style.display = "block";
        place();
        locate();
        frame = requestAnimationFrame(tick);
      }, HOLD_MS);

      const finish = (drop: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (dwell) clearTimeout(dwell);
        cancelAnimationFrame(frame);
        el.removeEventListener("touchmove", onMove);
        el.removeEventListener("touchend", onEnd);
        el.removeEventListener("touchcancel", onCancel);
        abort.current = null;
        const g = ghost();
        if (g) g.style.display = "none";
        if (state.phase === "dragging") {
          if (drop) o.current.onDrop(id, over);
          o.current.onEnd();
        }
      };
      const onMove = (ev: TouchEvent) => {
        const t = ev.touches[0];
        if (!t) return;
        const r = move(state, t.clientX, t.clientY);
        state = r.state;
        if (r.cancel) return finish(false);
        if (!r.prevent) return;
        if (ev.cancelable) ev.preventDefault();
        place();
        locate();
      };
      const onEnd = (ev: TouchEvent) => {
        const { drop } = release(state);
        // A drop is not also a tap: no click follows a cancelled touchend.
        if (drop && ev.cancelable) ev.preventDefault();
        finish(drop);
      };
      const onCancel = () => finish(false);

      el.addEventListener("touchmove", onMove, { passive: false });
      el.addEventListener("touchend", onEnd);
      el.addEventListener("touchcancel", onCancel);
      abort.current = () => finish(false);
    };
    return { onTouchStart };
  }, []);
}
