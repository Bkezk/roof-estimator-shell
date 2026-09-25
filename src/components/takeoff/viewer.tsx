/**
 * The takeoff viewer: the page underlay on a <canvas> with an SVG overlay of the same size,
 * both scaled by one zoom factor and moved by one pan offset. Wheel zooms about the cursor;
 * the middle mouse button or Space + drag pans; + / − / 0 (or Home) zoom from the keyboard.
 * The drawing tools (PlanSwift's Area / Linear / Count, plus Scale, Dimension and Cut-out) all
 * place points in page px at zoom 1.
 *
 * Fewer clicks (owner, Sep 25): right-click finishes the shape (PlanSwift "Stop"); the cursor
 * snaps to other objects' corners and the scale line's ends (Shift = free, no snap, no ortho);
 * on a scaled page a typed length + Enter places the next point that far along; Delete removes
 * the selected object; in Select mode a selected area / line drags as a whole and a count pin
 * drags on its own; role chips (keys 1–6) pick the next count / linear's role.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  COUNT_ROLES,
  COUNT_ROLE_LABELS,
  LINEAR_ROLES,
  LINEAR_ROLE_LABELS,
  feetPerPx,
  type CountRole,
  type LinearRole,
  type ObjectKind,
  type PagePoint,
  type PageScale,
  type TakeoffObject,
  type TakeoffPage,
} from "@/lib/takeoff/model";

import { DraftShape, MeasureLine, ObjectsLayer, ScaleLine, SnapMarker, SvgLabel } from "./overlay";
import { ScaleDialog } from "./scale-dialog";
import {
  DRAFT_COLOR,
  HINTS,
  KEY_TOOLS,
  feetInches,
  isLengthKey,
  isTypingTarget,
  lengthLabel,
  orthoSnap,
  parseFeetInches,
  snapCandidates,
  snapTo,
  translateObject,
  typedPoint,
  type NewObjectRoles,
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
/** Screen px: the cursor snaps to another object's corner this close. */
const SNAP_PX = 8;
const ZOOM_STEP = 1.25;

export interface ViewerProps {
  source: UnderlaySource | null;
  loadError: string | null;
  page: TakeoffPage;
  /** The objects on this page. */
  objects: readonly TakeoffObject[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Create an object from drawn points; returns its id (the editor names, colours, selects it).
   * A linear / count takes the role picked on the toolbar's role chips.
   */
  onCreate: (kind: ObjectKind, points: PagePoint[], roles: NewObjectRoles) => string;
  onChangePoints: (id: string, points: PagePoint[]) => void;
  /** Move a whole object (its cut-outs too) by (dx, dy) page px. */
  onMoveObject: (id: string, dx: number, dy: number) => void;
  onDelete: (id: string) => void;
  onAddCutout: (areaId: string, ring: PagePoint[]) => void;
  /** Set this page's scale; `applyToAll` also gives it to every other page with no scale. */
  onSetScale: (scale: PageScale, applyToAll: boolean) => void;
  /** Pages in this file, and how many OTHER pages have no scale yet (for the Scale dialog). */
  pageCount: number;
  unscaledOtherPages: number;
  /** The tool to start with (Scale on a brand-new takeoff). */
  initialTool?: Tool;
  /** The page's displayed size at zoom 1 once rendered (with the rotation it was rendered at). */
  onPageSize: (pageIndex: number, rotation: number, width: number, height: number) => void;
}

export function TakeoffViewer(props: ViewerProps) {
  const { page, source, objects, selectedId, onSelect } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>(props.initialTool ?? "select");
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
  /** Select mode: a whole selected area / line being dragged. */
  const [move, setMove] = useState<{ id: string; start: PagePoint; dx: number; dy: number } | null>(
    null,
  );
  /** A length typed on the keyboard while drawing (placed with Enter). */
  const [typed, setTyped] = useState("");
  const [countRole, setCountRole] = useState<CountRole>("drain");
  const [linearRole, setLinearRole] = useState<LinearRole>("parapet");
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
    setMove(null);
    setTyped("");
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

  // Snap targets: every corner / pin of the other objects on this page and the scale line's
  // ends (not the object being dragged, nor the count being clicked).
  const snapExcept = drag?.id ?? countSession;
  const candidates = useMemo(
    () => snapCandidates(objects, snapExcept, page.scale),
    [objects, snapExcept, page.scale],
  );
  const snapOf = (p: PagePoint | null): PagePoint | null =>
    p && !shift ? snapTo(p, candidates, zoom, SNAP_PX) : null;

  // Typed lengths: on a scaled page, with a point placed, for the outline tools.
  const typingTool = tool === "area" || tool === "linear" || tool === "cutout";
  const canType = typingTool && draft.length > 0 && fpp !== null;
  const typedFeet = canType && typed ? parseFeetInches(typed) : null;
  /** Where Enter would put the typed length: toward the cursor, else along the last side. */
  const typedTarget = (): PagePoint | null => {
    if (!last || typedFeet === null) return null;
    const prev = draft[draft.length - 2];
    const toward =
      cursor && Math.hypot(cursor[0] - last[0], cursor[1] - last[1]) > 1e-6
        ? cursor
        : prev
          ? ([2 * last[0] - prev[0], 2 * last[1] - prev[1]] as PagePoint)
          : null;
    return toward ? typedPoint(last, toward, typedFeet, fpp, shift) : null;
  };

  /** The point a click at `raw` places: close, typed, snapped, ortho, or as is. */
  const resolve = (raw: PagePoint): { p: PagePoint; snap: PagePoint | null } => {
    if (nearFirst && draft[0]) return { p: draft[0], snap: null };
    const t = typedTarget();
    if (t) return { p: t, snap: null };
    const s = snapOf(raw);
    if (s) return { p: s, snap: s };
    return { p: last && !shift ? orthoSnap(last, raw) : raw, snap: null };
  };
  const drawing = tool !== "select";
  const live = drawing && cursor ? resolve(cursor) : null;
  const snapped: PagePoint | null = live?.p ?? null;
  const dragSnap = drag && cursor ? snapOf(cursor) : null;
  const snapMark = drawing ? (live?.snap ?? null) : dragSnap;

  const changeTool = (t: Tool) => {
    if (t === "cutout" && !selectedArea) {
      toast.info("Select an area first, then draw the cut-out inside it.");
      return;
    }
    setTool(t);
    setDraft([]);
    setTyped("");
    setDimension(null);
    setCountSession(null);
  };

  const roles: NewObjectRoles = { count: countRole, linear: linearRole };
  const pickCountRole = (r: CountRole) => {
    setCountRole(r);
    setCountSession(null); // the next click starts a new count with this role
  };

  /** Finish the shape in progress; false when there is nothing (or not enough) to finish. */
  const finish = (): boolean => {
    if (tool === "area" && draft.length >= 3) props.onCreate("area", draft, roles);
    else if (tool === "linear" && draft.length >= 2) props.onCreate("linear", draft, roles);
    else if (tool === "cutout" && draft.length >= 3 && selectedArea)
      props.onAddCutout(selectedArea.id, draft);
    else if (tool === "count" && countSession) setCountSession(null);
    else return false;
    setDraft([]);
    setTyped("");
    return true;
  };

  /** Right-click: PlanSwift's "Stop" — finish what is being drawn. */
  const stop = () => {
    if (finish()) return;
    if (tool === "scale" || tool === "dimension") {
      setDraft([]);
      return;
    }
    if (draft.length > 0 && typingTool)
      toast.info(
        tool === "linear"
          ? "A line needs at least 2 points."
          : "An area needs at least 3 points — keep clicking corners, or press Esc to cancel.",
      );
  };

  const cancel = (): boolean => {
    if (typed) setTyped("");
    else if (draft.length) setDraft([]);
    else if (dimension) setDimension(null);
    else if (countSession) setCountSession(null);
    else if (tool === "select" && selectedId) props.onSelect(null);
    else return false;
    return true;
  };

  /** Enter with a typed length: place the next point that far along. */
  const placeTyped = (): boolean => {
    if (typedFeet === null) {
      toast.info(`Type a length like 24, 24.5 or 24'6" and press Enter.`);
      return true;
    }
    const t = typedTarget();
    if (!t) {
      toast.info("Point the cursor the way the next side goes, then press Enter.");
      return true;
    }
    setDraft((d) => [...d, t]);
    setTyped("");
    return true;
  };

  const place = (raw: PagePoint) => {
    if (tool === "select") {
      props.onSelect(null);
      return;
    }
    const { p } = resolve(raw);
    setTyped("");
    if (tool === "count") {
      const cur = countSession ? objects.find((o) => o.id === countSession) : undefined;
      if (cur) props.onChangePoints(cur.id, [...cur.points, p]);
      else setCountSession(props.onCreate("count", [p], roles));
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

  /** Backspace / Delete: typed text first, then the last point, then the selected object. */
  const backspace = (): boolean => {
    if (typed) {
      setTyped((t) => t.slice(0, -1));
      return true;
    }
    if (draft.length) {
      setDraft((d) => d.slice(0, -1));
      return true;
    }
    if (countSession) {
      const cur = objects.find((o) => o.id === countSession);
      if (cur && cur.points.length > 1) props.onChangePoints(cur.id, cur.points.slice(0, -1));
      else if (cur) {
        props.onDelete(cur.id);
        setCountSession(null);
      }
      return true;
    }
    if (dimension) {
      setDimension(null);
      return true;
    }
    if (selectedId && objects.some((o) => o.id === selectedId)) {
      props.onDelete(selectedId);
      return true;
    }
    return false;
  };

  /** One key press; true when it was used (its default is then prevented). */
  const onKey = (e: KeyboardEvent): boolean => {
    const k = e.key;
    if (canType && isLengthKey(k) && !(k === " " && typed === "")) {
      setTyped((t) => (t + k).slice(0, 16));
      return true;
    }
    if (e.code === "Space") {
      setSpaceDown(true);
      return true;
    }
    switch (k) {
      case "Escape":
        return cancel();
      case "Backspace":
      case "Delete":
        return backspace();
      case "Enter":
        return typed ? placeTyped() : finish();
      case "+":
      case "=":
        zoomCenter(ZOOM_STEP);
        return true;
      case "-":
      case "_":
        zoomCenter(1 / ZOOM_STEP);
        return true;
      case "0":
      case "Home":
        fit();
        return true;
    }
    if (/^[1-6]$/.test(k)) {
      const n = Number(k) - 1;
      if (tool === "count" && COUNT_ROLES[n]) {
        pickCountRole(COUNT_ROLES[n]);
        return true;
      }
      if (tool === "linear" && LINEAR_ROLES[n]) {
        setLinearRole(LINEAR_ROLES[n]);
        return true;
      }
      return false;
    }
    const t = KEY_TOOLS[k.toLowerCase()];
    if (!t) return false;
    changeTool(t);
    return true;
  };

  // Keyboard: tool keys, Esc / Backspace / Delete / Enter, typed lengths, role keys, zoom keys,
  // Shift (free angle, no snap), Space (pan). Keys in a text field are left alone.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (scalePick || isTypingTarget(e.target)) return;
      if (e.key === "Shift") {
        setShift(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (onKey(e)) e.preventDefault();
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
    if (drag) {
      const q = (!e.shiftKey && snapTo(p, candidates, zoom, SNAP_PX)) || p;
      setDrag({
        ...drag,
        moved: true,
        points: drag.points.map((x, i) => (i === drag.index ? q : x)),
      });
    } else if (move) {
      setMove({ ...move, dx: p[0] - move.start[0], dy: p[1] - move.start[1] });
    }
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
    if (move) {
      if (Math.hypot(move.dx, move.dy) * zoom >= 1) props.onMoveObject(move.id, move.dx, move.dy);
      setMove(null);
    }
  };

  // Select mode: a click selects; pressing on the selected area / line drags it as a whole.
  const onObjectDown = useCallback(
    (id: string, e: PointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (id !== selectedId) {
        onSelect(id);
        return;
      }
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setMove({
        id,
        start: [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom],
        dx: 0,
        dy: 0,
      });
    },
    [onSelect, selectedId, zoom],
  );
  // A corner handle of the selected area / line, or any count pin: drag that one point.
  const onVertexDown = useCallback(
    (id: string, index: number, e: PointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const o = objects.find((x) => x.id === id);
      if (!o) return;
      if (id !== selectedId) onSelect(id);
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id, index, points: o.points.map((p) => [p[0], p[1]]), moved: false });
    },
    [objects, onSelect, selectedId],
  );

  const shown = useMemo(
    () =>
      drag
        ? objects.map((o) =>
            o.id === drag.id ? ({ ...o, points: drag.points } as TakeoffObject) : o,
          )
        : move && (move.dx || move.dy)
          ? objects.map((o) => (o.id === move.id ? translateObject(o, move.dx, move.dy) : o))
          : objects,
    [objects, drag, move],
  );

  const cursorStyle = panning
    ? "grabbing"
    : spaceDown
      ? "grab"
      : move
        ? "move"
        : tool === "select"
          ? "default"
          : "crosshair";

  const roleChips =
    tool === "count"
      ? {
          options: COUNT_ROLES.map((r) => ({ value: r, label: COUNT_ROLE_LABELS[r] })),
          value: countRole,
          onChange: (v: string) => pickCountRole(v as CountRole),
        }
      : tool === "linear"
        ? {
            options: LINEAR_ROLES.map((r) => ({ value: r, label: LINEAR_ROLE_LABELS[r] })),
            value: linearRole,
            onChange: (v: string) => setLinearRole(v as LinearRole),
          }
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        tool={tool}
        zoom={zoom}
        onTool={changeTool}
        onZoomIn={() => zoomCenter(ZOOM_STEP)}
        onZoomOut={() => zoomCenter(1 / ZOOM_STEP)}
        onFit={fit}
        roles={roleChips}
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
          // Right-click is "Stop" while a drawing tool is active: no browser menu.
          if (drawing || draft.length) e.preventDefault();
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
                if (e.button === 2) {
                  if (drawing) {
                    e.preventDefault();
                    stop();
                  }
                  return;
                }
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
              {snapMark && <SnapMarker at={snapMark} zoom={zoom} />}
              {typed && (cursor ?? last) && (
                <SvgLabel
                  x={(cursor ?? last)![0] + 14 / zoom}
                  y={(cursor ?? last)![1] - 14 / zoom}
                  zoom={zoom}
                  anchor="start"
                  size={13}
                  bold
                  color={typedFeet === null ? "#b91c1c" : "#1d4ed8"}
                >
                  {typedFeet === null
                    ? `${typed} ?`
                    : `${typed} → ${feetInches(typedFeet)} · Enter`}
                </SvgLabel>
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
                Ortho and snap {shift ? "off (Shift held)" : "on — hold Shift for any angle"}.
              </span>
            )}
            {typingTool && fpp !== null && (
              <span className="ml-1">
                After the first point, type a length (24'6) and press Enter to place the next.
              </span>
            )}{" "}
            Wheel or + / − zooms, 0 fits; middle-drag or Space + drag pans.
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
        pageCount={props.pageCount}
        unscaledOtherPages={props.unscaledOtherPages}
        pixels={
          scalePick
            ? Math.hypot(scalePick.b[0] - scalePick.a[0], scalePick.b[1] - scalePick.a[1])
            : 0
        }
        onCancel={() => setScalePick(null)}
        onSave={(feet, applyToAll) => {
          if (!scalePick) return;
          props.onSetScale(
            {
              ax: scalePick.a[0],
              ay: scalePick.a[1],
              bx: scalePick.b[0],
              by: scalePick.b[1],
              feet,
            },
            applyToAll,
          );
          setScalePick(null);
          setTool("select");
          const n = applyToAll ? props.unscaledOtherPages : 0;
          toast.success(
            n > 0
              ? `Scale set for this page and ${n} other page${n === 1 ? "" : "s"}.`
              : "Scale set for this page.",
          );
        }}
      />
    </div>
  );
}
