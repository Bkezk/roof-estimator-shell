/**
 * A finger / stylus / mouse signature pad on a canvas (pointer events). Clear wipes it; Save
 * hands the drawing to the caller as a PNG blob. The pad is always white with black ink so the
 * saved image reads the same in light and dark mode.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SignaturePad({
  onSave,
  saving,
  disabled,
}: {
  onSave: (png: Blob) => void;
  saving?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  /** Size the bitmap to the box (sharp on high-density screens) and paint it white. */
  const reset = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#111111";
    setHasInk(false);
  }, []);

  useEffect(() => {
    reset();
    // A rotated phone changes the width; the drawing cannot survive a resize, so start over
    // only while the pad is still blank.
    const c = canvasRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    let w = c.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const nw = c.getBoundingClientRect().width;
      if (Math.abs(nw - w) > 1) {
        w = nw;
        reset();
      }
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [reset]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) {
      // A tap leaves a dot.
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = "#111111";
      ctx.fill();
    }
    setHasInk(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    last.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const save = () => {
    const c = canvasRef.current;
    if (!c || !hasInk) return;
    c.toBlob((b) => {
      if (b) onSave(b);
    }, "image/png");
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="block h-44 w-full touch-none rounded-md border-2 border-dashed border-muted-foreground/40 bg-white"
        style={{ touchAction: "none" }}
        aria-label="Signature pad: sign with a finger"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1"
          disabled={!hasInk || saving || disabled}
          onClick={reset}
        >
          <Eraser className="mr-2 h-4 w-4" /> Clear
        </Button>
        <Button
          type="button"
          className="h-11 flex-1"
          disabled={!hasInk || saving || disabled}
          onClick={save}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save signature
        </Button>
      </div>
    </div>
  );
}
