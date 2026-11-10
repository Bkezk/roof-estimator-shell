import { useEffect, useRef, useState } from "react";

import { SHEET } from "@/lib/documents/editor-helpers";

/** A scaled sheet still lays out at its full height; this wrapper takes the scaled height instead. */
export function ScaledSheet(props: { scale: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(SHEET.height);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div style={{ height: height * props.scale }}>
      <div
        ref={ref}
        style={{
          transform: `scale(${props.scale})`,
          transformOrigin: "top left",
          width: SHEET.width,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
