/**
 * The on-screen keyboard, for a box pinned to the bottom of a phone's screen (lib/keyboard-inset.ts
 * has the rules and why). Watches the browser's visual viewport while `active`, and gives how far
 * the box must rise and how much of the page is showing. Safe during SSR and where the browser
 * has no visual viewport (nothing is lifted there).
 */
import { useEffect, useState } from "react";

import { keyboardInset } from "@/lib/keyboard-inset";

const read = () =>
  typeof window === "undefined"
    ? { bottom: 0, visible: 0 }
    : keyboardInset({
        innerHeight: window.innerHeight,
        visual: window.visualViewport
          ? {
              height: window.visualViewport.height,
              offsetTop: window.visualViewport.offsetTop,
              scale: window.visualViewport.scale,
            }
          : null,
      });

export function useKeyboardInset(active: boolean): { bottom: number; visible: number } {
  const [inset, setInset] = useState<{ bottom: number; visible: number }>({
    bottom: 0,
    visible: 0,
  });
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const update = () => {
      const next = read();
      setInset((prev) =>
        prev.bottom === next.bottom && prev.visible === next.visible ? prev : next,
      );
    };
    update();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return active ? inset : { bottom: 0, visible: 0 };
}
