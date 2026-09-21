import * as React from "react";

import { Textarea } from "@/components/ui/textarea";

/**
 * A textarea that grows with its content so every line stays visible — no inner scrollbar.
 * The height follows `scrollHeight` on every value change (and on mount / when the window
 * re-lays out), with `rows` as the minimum. Manual corner-drag resizing is off so the box
 * never fights the automatic height.
 */
export const AutoTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, value, rows = 3, style, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };
    const fit = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, []);
    React.useLayoutEffect(fit, [fit, value]);
    React.useEffect(() => {
      window.addEventListener("resize", fit);
      return () => window.removeEventListener("resize", fit);
    }, [fit]);
    return (
      <Textarea
        ref={setRefs}
        rows={rows}
        value={value}
        className={`resize-none overflow-hidden ${className ?? ""}`}
        style={style}
        {...props}
      />
    );
  },
);
AutoTextarea.displayName = "AutoTextarea";
