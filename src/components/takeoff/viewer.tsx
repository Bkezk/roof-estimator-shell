/**
 * The takeoff viewer: the page underlay on a <canvas> with an SVG overlay of the same size,
 * both scaled by one zoom factor and moved by one pan offset. Wheel zooms about the cursor;
 * the middle mouse button or Space + drag pans. The drawing tools (PlanSwift's Area / Linear /
 * Count, plus Scale, Dimension and Cut-out) all place points in page px at zoom 1.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  feetPerPx,
  type ObjectKind,
  type PagePoint,
  type PageScale,
  type TakeoffObject,
  type TakeoffPage,
} from "@/lib/takeoff/model";

import { DraftShape, MeasureLine, ObjectsLayer, ScaleLine } from "./overlay";
import { ScaleDialog } from "./scale-dialog";
import {
  DRAFT_COLOR,
  HINTS,
  KEY_TOOLS,
  isTypingTarget,
  lengthLabel,
  orthoSnap,
  type Tool,
} from "./shapes";
import { ViewerToolbar } from "./toolbar";
import { renderUnderlayPage, type UnderlaySource } from "./underlay";

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 20;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
/** Screen px: a click this close to the first point closes an area. */
const CLOSE_PX = 9;
/** Screen px: a second click this close to the last point finishes (a double-click). */
const DOUBLE_PX = 4;

export interface ViewerProps {
  source: UnderlaySource | null;
  loadError: string | null;
  page: TakeoffPage;
  /** The objects on this page. */
  objects: readonly TakeoffObject[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Create an object from drawn points; returns its id (the editor names, colours, selects it). */
  onCreate: (kind: ObjectKind, points: PagePoint[]) => string;
  onChangePoints: (id: string, points: PagePoint[]) => void;
  onAddCutout: (areaId: string, ring: PagePoint[]) => void;
  onSetScale: (scale: PageScale) => void;
  /** The page's displayed size at zoom 1 once rendered (with the rotation it was rendered at). */
  onPageSize: (pageIndex: number, rotation: number, width: number, height: number) => void;
}

export function TakeoffViewer(props: ViewerProps) {
  const { page, source, objects, selectedId, onSelect } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [renderZoom, setRenderZoom] = useState(1);
  const [rendered, setRendered] = useState<{ key: string; w: number; h: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PagePoint[]>([]);
  const [cursor, setCursor] = useState<PagePoint | null>(null);
  const [shift, setShift] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dimension, setDimension] = useState<{ a: PagePoint; b: PagePoint } | null>(null);
  const [countSession, setCountSession] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    index: number;
    points: PagePoint[];
    moved: boolean;
  } | null>(null);
  const [scalePick, setScalePick] = useState<{ a: PagePoint; b: PagePoint } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const pageKey = `${page.index}:${page.rotation}`;
  const size =
    rendered && rendered.key === pageKey
      ? { w: rendered.w, h: rendered.h }
      : page.width && page.height
        ? { w: page.width, h: page.height }
        : null;
  const sizeW = size?.w ?? 0;
  const sizeH = size?.h ?? 0;
  const fpp = feetPerPx(page.scale);
  const zoom = view.zoom;

  const onPageSizeRef = useRef(props.onPageSize);
  onPageSizeRef.current = props.onPageSize;

  // A new page (or a rotation): drop everything in progress and blank the old bitmap.
  useEffect(() => {
    setDraft([]);
    setDimension(null);
    setCountSession(null);
    setScalePick(null);
    setDrag(null);
    const c = canvasRef.current;
    if (c) c.width = 0;
  }, [pageKey]);

  // Re-render the underlay crisply a moment after the zoom settles.
  useEffect(() => {
    const t = setTimeout(() => setRenderZoom(view.zoom), 180);
    return () => clearTimeout(t);
  }, [view.zoom]);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const renderScale = Math.round(renderZoom * dpr * 100) / 100;

  useEffect(() => {
    if (!source) return;
    let live = true;
    setRendering(true);
    const key = `${page.index}:${page.rotation}`;
    const handle = renderUnderlayPage(source, page.index, page.rotation, renderScale);
    handle.promise.then(
      (r) => {
        if (!live) return;
        const c = canvasRef.current;
        if (c) {
          c.width = r.canvas.width;
          c.height = r.canvas.height;
          c.getContext("2d")?.drawImage(r.canvas, 0, 0);
        }
        setRendered({ key, w: r.width, h: r.height });
        setRenderError(null);
        setRendering(false);
        onPageSizeRef.current(page.index, page.rotation, r.width, r.height);
      },
      (e: unknown) => {
        if (!live) return;
        setRendering(false);
        setRenderError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
      handle.cancel();
    };
  }, [source, page.index, page.rotation, renderScale]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !sizeW || !sizeH) return;
    const r = el.getBoundingClientRect();
    const z = clampZoom(Math.min((r.width - 32) / sizeW, (r.height - 32) / sizeH));
    setView({ zoom: z, x: (r.width - sizeW * z) / 2, y: (r.height - sizeH * z) / 2 });
  }, [sizeW, sizeH]);

  // Fit each page the first time its size is known.
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (sizeW && sizeH && fittedKey.current !== pageKey) {
      fittedKey.current = pageKey;
      fit();
    }
  }, [pageKey, sizeW, sizeH, fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const z = clampZoom(v.zoom * factor);
      const px = (cx - v.x) / v.zoom;
      const py = (cy - v.y) / v.zoom;
      return { zoom: z, x: cx - px * z, y: cy - py * z };
    });
  }, []);
  const zoomCenter = (factor: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    if (r) zoomAt(factor, r.width / 2, r.height / 2);
  };

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const step = e.deltaMode === 1 ? 0.05 : 0.0015;
      zoomAt(Math.exp(-e.deltaY * step), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const toPage = (e: { clientX: number; clientY: number }): PagePoint => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };

  const selectedArea = objects.find((o) => o.id === selectedId && o.kind === "area");
  const last = draft[draft.length - 1];
  const closing = tool === "area" || tool === "cutout";
  const nearFirst =
    closing &&
    draft.length >= 3 &&
    !!cursor &&
    Math.hypot(cursor[0] - draft[0]![0], cursor[1] - draft[0]![1]) * zoom <= CLOSE_PX;
  const snapped: PagePoint | null =
    nearFirst && draft[0] ? draft[0] : cursor && last && !shift ? orthoSnap(last, cursor) : cursor;

  const changeTool = (t: Tool) => {
    if (t === "cutout" && !selectedArea) {
      toast.info("Select an area first, then draw the cut-out inside it.");
      return;
    }
    setTool(t);
    setDraft([]);
    setDimension(null);
    setCountSession(null);
  };

  const finish = () => {
    if (tool === "area" && draft.length >= 3) props.onCreate("area", draft);
    else if (tool === "linear" && draft.length >= 2) props.onCreate("linear", draft);
    else if (tool === "cutout" && draft.length >= 3 && selectedArea)
      props.onAddCutout(selectedArea.id, draft);
    else if (tool === "count") setCountSession(null);
    else return;
    setDraft([]);
  };

  const cancel = () => {
    if (draft.length) setDraft([]);
    else if (dimension) setDimension(null);
    else if (countSession) setCountSession(null);
    else if (tool === "select") props.onSelect(null);
  };

  const place = (raw: PagePoint) => {
    if (tool === "select") {
      props.onSelect(null);
      return;
    }
    const p: PagePoint =
      nearFirst && draft[0] ? draft[0] : last && !shift ? orthoSnap(last, raw) : raw;
    if (tool === "count") {
      const cur = countSession ? objects.find((o) => o.id === countSession) : undefined;
      if (cur) props.onChangePoints(cur.id, [...cur.points, p]);
      else setCountSession(props.onCreate("count", [p]));
      return;
    }
    if (tool === "scale" || tool === "dimension") {
      if (!last) {
        setDimension(null);
        setDraft([p]);
        return;
      }
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * zoom < DOUBLE_PX) return;
      if (tool === "scale") setScalePick({ a: last, b: p });
      else setDimension({ a: last, b: p });
      setDraft([]);
      return;
    }
    if (tool === "cutout" && !selectedArea) {
      toast.info("Select an area first, then draw the cut-out inside it.");
      return;
    }
    if (nearFirst) {
      finish();
      return;
    }
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) * zoom < DOUBLE_PX) {
      finish();
      return;
    }
    setDraft((d) => [...d, p]);
  };

  // Keyboard: tool keys, Esc / Backspace / Enter, Shift (free angle), Space (pan).
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (scalePick || isTypingTarget(e.target)) return;
      if (e.key === "Shift") {
        setShift(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      if (e.key === "Escape") cancel();
      else if (e.key === "Backspace") setDraft((d) => d.slice(0, -1));
      else if (e.key === "Enter") finish();
      else {
        const t = KEY_TOOLS[e.key.toLowerCase()];
        if (!t) return;
        changeTool(t);
      }
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShift(false);
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  });

  const onPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      e.stopPropagation();
      panRef.current = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan) {
      setView((v) => ({ ...v, x: pan.x + e.clientX - pan.sx, y: pan.y + e.clientY - pan.sy }));
      return;
    }
    const p = toPage(e);
    setShift(e.shiftKey);
    setCursor(p);
    if (drag)
      setDrag({
        ...drag,
        moved: true,
        points: drag.points.map((q, i) => (i === drag.index ? p : q)),
      });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    if (drag) {
      if (drag.moved) props.onChangePoints(drag.id, drag.points);
      setDrag(null);
    }
  };

  const onObjectDown = useCallback(
    (id: string, e: PointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelect(id);
    },
    [onSelect],
  );
  const onVertexDown = useCallback(
    (id: string, index: number, e: PointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const o = objects.find((x) => x.id === id);
      if (!o) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id, index, points: o.points.map((p) => [p[0], p[1]]), moved: false });
    },
    [objects],
  );

  const shown = useMemo(
    () =>
      drag
        ? objects.map((o) =>
            o.id === drag.id ? ({ ...o, points: drag.points } as TakeoffObject) : o,
          )
        : objects,
    [objects, drag],
  );

  const cursorStyle = panning
    ? "grabbing"
    : spaceDown
      ? "grab"
      : tool === "select"
        ? "default"
        : "crosshair";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        tool={tool}
        zoom={zoom}
        onTool={changeTool}
        onZoomIn={() => zoomCenter(1.25)}
        onZoomOut={() => zoomCenter(1 / 1.25)}
        onFit={fit}
      />

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-muted/60"
        style={{ cursor: cursorStyle }}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onMouseDown={(e) => {
          // No middle-click autoscroll / paste.
          if (e.button === 1) e.preventDefault();
        }}
        onContextMenu={(e) => {
          if (draft.length) e.preventDefault();
        }}
      >
        <div
          className="absolute left-0 top-0 bg-white shadow-md"
          style={{
            width: sizeW * zoom,
            height: sizeH * zoom,
            transform: `translate(${view.x}px, ${view.y}px)`,
          }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {size && (
            <svg
              ref={svgRef}
              className="absolute inset-0"
              width={sizeW * zoom}
              height={sizeH * zoom}
              viewBox={`0 0 ${sizeW} ${sizeH}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                place(toPage(e));
              }}
            >
              <ObjectsLayer
                objects={shown}
                fpp={fpp}
                zoom={zoom}
                selectedId={selectedId}
                interactive={tool === "select" && !spaceDown}
                onObjectDown={onObjectDown}
                onVertexDown={onVertexDown}
              />
              {page.scale && <ScaleLine scale={page.scale} zoom={zoom} />}
              {dimension && (
                <MeasureLine
                  a={dimension.a}
                  b={dimension.b}
                  zoom={zoom}
                  label={lengthLabel(
                    Math.hypot(dimension.b[0] - dimension.a[0], dimension.b[1] - dimension.a[1]),
                    fpp,
                  )}
                />
              )}
              {scalePick && (
                <MeasureLine
                  a={scalePick.a}
                  b={scalePick.b}
                  zoom={zoom}
                  label="?"
                  color="#ea580c"
                />
              )}
              {tool !== "select" && (draft.length > 0 || tool === "count") && (
                <DraftShape
                  points={draft}
                  cursor={tool === "count" ? null : snapped}
                  closed={closing}
                  zoom={zoom}
                  fpp={fpp}
                  color={DRAFT_COLOR[tool]}
                  nearFirst={nearFirst}
                />
              )}
            </svg>
          )}
        </div>

        {(!source || rendering) && !props.loadError && !renderError && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
            <Loader2 className="h-3 w-3 animate-spin" /> {source ? "Rendering…" : "Loading plan…"}
          </div>
        )}
        {(props.loadError || renderError) && (
          <div className="absolute inset-x-6 top-6 rounded-md border border-destructive/40 bg-background p-3 text-sm text-destructive shadow">
            Could not show this plan: {props.loadError ?? renderError}
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-end gap-2">
          <div className="max-w-[640px] rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
            {HINTS[tool]}
            {tool !== "select" && tool !== "count" && (
              <span className="ml-1">
                Ortho {shift ? "off (Shift held)" : "on — hold Shift for any angle"}.
              </span>
            )}{" "}
            Wheel zooms; middle-drag or Space + drag pans.
          </div>
          {!page.scale && (
            <div className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 shadow dark:bg-amber-900/60 dark:text-amber-100">
              No scale on this page — use Scale (S) on a known dimension first.
            </div>
          )}
        </div>
      </div>

      <ScaleDialog
        open={!!scalePick}
        pixels={
          scalePick
            ? Math.hypot(scalePick.b[0] - scalePick.a[0], scalePick.b[1] - scalePick.a[1])
            : 0
        }
        onCancel={() => setScalePick(null)}
        onSave={(feet) => {
          if (!scalePick) return;
          props.onSetScale({
            ax: scalePick.a[0],
            ay: scalePick.a[1],
            bx: scalePick.b[0],
            by: scalePick.b[1],
            feet,
          });
          setScalePick(null);
          setTool("select");
          toast.success("Scale set for this page.");
        }}
      />
    </div>
  );
}
