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
 * drags on its own; role chips (keys 1–6; a second toolbar line under the tools) pick the next
 * count / linear's role.
 *
 * Owner, Sep 30: (1) Ortho has a tolerance — a side within ORTHO_DEG (7°) of level or plumb
 * locks to it, a steeper side keeps its angle, so angled views can be drawn; typed lengths follow
 * the same rule. (2) Drag a box: with Area, Cut-out or Linear and nothing in progress, press and
 * drag past RECT_DRAG_PX (6 screen px) to draw a whole page-aligned rectangle (a linear gets its
 * perimeter); both corners snap unless Shift is held, Esc cancels. A press that does not move
 * that far is a click and places the first corner (on release, at the press point).
 *
 * Owner, Sep 30 (later): (A) "Snap to plan" (toolbar toggle, PDF plans only, on by default,
 * remembered in localStorage `takeoff.snapPlan`): the page's own vector lines are read once
 * (./plan-lines via ./underlay) and the cursor also snaps to their ends and crossings, or onto a
 * line itself — a teal marker, where a snap to one of our own objects is magenta. (B) A PDF page
 * with no scale reads its scale note (`1/8" = 1'-0"`) off the sheet when opened; exactly one
 * distinct note sets the scale, tagged "read from the sheet" everywhere it shows (chip, scale
 * line, Scale dialog, a toast); several are offered as choices in the Scale dialog. Drawing a
 * scale replaces it. (C) Square corners: after two points, a side within ORTHO_DEG of 0° / 90° /
 * 180° / 270° to the previous side locks to it (before the level / plumb lock), typed lengths
 * too. (D) "Edge from this area": with an area selected, Create makes linears along its sides.
 *
 * Owner, Sep 30 (Edge from this area, per side: "if 3 of the sides have a parapet wall and one
 * doesn't I should be able to select that. Also the pop-up is easy to miss"): each side has its
 * own role or is left out. The session (`EdgeSession` in ./shapes) is held by the editor so the
 * Objects tab can show its per-side panel (a role Select per side, a live summary, Create /
 * Cancel); this viewer starts it (toolbar button, or the Objects tab via `edgeRequest`), draws
 * each side thick in its role's colour with "A · 50.3 ft · Parapet wall" (left-out sides grey,
 * dashed) and shows a banner across the top of the drawing. A click on a side cycles it (the
 * current role → left out → the current role; another role → the current role); the role chips /
 * keys 1–5 set the current role, which clicks use and untouched sides take. Enter / right-click
 * (or Create) makes one linear per run of contiguous sides sharing a role (a whole loop of one
 * role returns to its start), as one undo step; Esc, another tool or another page cancels.
 *
 * Owner, Sep 30 (Duplicate and stamp): with an area (and its cut-outs), a linear or a count
 * selected, Ctrl/Cmd+D, the toolbar's Duplicate or the Objects tab's Duplicate button starts
 * stamping. A half-opacity ghost of the copy follows the cursor — its bounding-box centre (a
 * count: its pin) on the cursor, which snaps as usual (own corners + plan lines, Shift = off);
 * and when a corner of the ghost comes within SNAP_PX of a snap point the whole ghost shifts
 * onto it (nearest corner wins; `ghostPlacement` in ./shapes), so copies line up with grid
 * lines. Each left click stamps a new object (`duplicateObject`: same kind and attrs, a fresh
 * name, one undo step) and the mode stays on with the original as the source. Right-click
 * (`stop()`), Esc, another tool, another page or deleting the source stops it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { Loader2, SquareDashed } from "lucide-react";

import { Button } from "@/components/ui/button";

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

import {
  DraftShape,
  EdgePicker,
  GhostShape,
  MeasureLine,
  ObjectsLayer,
  RectPreview,
  ScaleLine,
  SnapMarker,
  SvgLabel,
  TargetMarker,
} from "./overlay";
import { pickSnap, type PlanIndex, type SnapHit } from "./plan-lines";
import { ScaleDialog } from "./scale-dialog";
import {
  scaleOrigin,
  sheetScaleLine,
  sheetScaleMessage,
  sheetSizeWarning,
  type ScaleNote,
} from "./sheet-scale";
import {
  COUNT_ROLE_HINTS,
  DRAFT_COLOR,
  HINTS,
  KEY_TOOLS,
  LINEAR_ROLE_HINTS,
  ORTHO_DEG,
  STAMP_HINT,
  cycleEdgeSide,
  dragRect,
  duplicateObject,
  edgeSideRoles,
  edgeSummary,
  feetInches,
  ghostPlacement,
  isLengthKey,
  isRectDrag,
  isTypingTarget,
  lengthLabel,
  lockPoint,
  parseFeetInches,
  rectObjectPoints,
  snapCandidates,
  stampReference,
  translateObject,
  typedPoint,
  type EdgeSession,
  type NewObjectRoles,
  type Tool,
} from "./shapes";
import { Tip, ViewerToolbar } from "./toolbar";
import {
  pdfPointToPage,
  readPlanLines,
  readSheetScale,
  renderUnderlayPage,
  type SheetScaleRead,
  type UnderlaySource,
} from "./underlay";

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
/** Browser key remembering the "Snap to plan" toggle (on unless turned off). */
const SNAP_PLAN_KEY = "takeoff.snapPlan";

function readSnapPlan(): boolean {
  try {
    return window.localStorage.getItem(SNAP_PLAN_KEY) !== "0";
  } catch {
    return true;
  }
}
function writeSnapPlan(on: boolean) {
  try {
    window.localStorage.setItem(SNAP_PLAN_KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable: the toggle still works for this visit.
  }
}

/** PDF pages whose sheet scale was already set automatically this session (per document). */
const sheetApplied = new WeakMap<object, Set<number>>();

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
  /** "Edge from this area" asked for from outside (the Objects tab); a new object each time. */
  edgeRequest?: { areaId: string } | null;
  /** "Edge from this area" while it is on (held by the editor, shared with the Objects tab). */
  edge: EdgeSession | null;
  /** Start (a new session), change or end (null) "Edge from this area". */
  onEdgeChange: (edge: EdgeSession | null) => void;
  /** Create the linears of the current "Edge from this area" session and end it. */
  onEdgeCreate: () => void;
  /**
   * "Duplicate and stamp": add a copy of `sourceId` moved by (dx, dy) page px, as one undo step,
   * without selecting it; returns the new id, or null when the source is gone.
   */
  onDuplicate: (sourceId: string, dx: number, dy: number) => string | null;
  /** "Duplicate and stamp" asked for from outside (the Objects tab); a new object each time. */
  stampRequest?: { id: string } | null;
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
  /**
   * Area / cut-out / linear with nothing in progress: a left press (page point `a`, screen point
   * sx / sy) that becomes a click on release, or a drag-a-box rectangle to `b` once `active`.
   */
  const [press, setPress] = useState<{
    a: PagePoint;
    b: PagePoint;
    sx: number;
    sy: number;
    pointerId: number;
    active: boolean;
  } | null>(null);
  /** A length typed on the keyboard while drawing (placed with Enter). */
  const [typed, setTyped] = useState("");
  const [countRole, setCountRole] = useState<CountRole>("drain");
  const [linearRole, setLinearRole] = useState<LinearRole>("parapet");
  const [scalePick, setScalePick] = useState<{ a: PagePoint; b: PagePoint } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  /** Snap to the plan's own lines (PDF only); read from localStorage after mount. */
  const [snapPlan, setSnapPlan] = useState(true);
  const [plan, setPlan] = useState<{
    key: string;
    index: PlanIndex | null;
    failed: boolean;
  } | null>(null);
  /** What this page's sheet text says about its scale (PDF only). */
  const [sheet, setSheet] = useState<{ index: number; read: SheetScaleRead } | null>(null);
  /** The Scale dialog opened only to pick one of the sheet's scale notes (no line drawn). */
  const [sheetPick, setSheetPick] = useState(false);
  /** "Edge from this area": the area and each side's role (held by the editor). */
  const edge = props.edge;
  const onEdgeChangeRef = useRef(props.onEdgeChange);
  onEdgeChangeRef.current = props.onEdgeChange;
  /** "Duplicate and stamp": the object copied, and how many copies were stamped so far. */
  const [stamp, setStamp] = useState<{ sourceId: string; count: number } | null>(null);

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
  const onSetScaleRef = useRef(props.onSetScale);
  onSetScaleRef.current = props.onSetScale;
  const hasScaleRef = useRef(!!page.scale);
  hasScaleRef.current = !!page.scale;
  const pageIndexRef = useRef(page.index);
  pageIndexRef.current = page.index;
  const isPdf = source?.kind === "pdf";

  // A new page (or a rotation): drop everything in progress and blank the old bitmap.
  useEffect(() => {
    setDraft([]);
    setDimension(null);
    setCountSession(null);
    setScalePick(null);
    setDrag(null);
    setMove(null);
    setPress(null);
    setTyped("");
    onEdgeChangeRef.current(null);
    setStamp(null);
    setSheetPick(false);
    const c = canvasRef.current;
    if (c) c.width = 0;
  }, [pageKey]);

  // "Snap to plan": remembered per browser.
  useEffect(() => setSnapPlan(readSnapPlan()), []);
  const toggleSnapPlan = () => {
    setSnapPlan((on) => {
      writeSnapPlan(!on);
      return !on;
    });
  };

  // The plan's own lines on this PDF page, read once per page and rotation (cached per file).
  useEffect(() => {
    if (!source || source.kind !== "pdf" || !snapPlan) return;
    let live = true;
    const key = `${page.index}:${page.rotation}`;
    readPlanLines(source.doc, page.index, page.rotation).then(
      (index) => {
        if (live) setPlan({ key, index, failed: false });
      },
      () => {
        if (live) setPlan({ key, index: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [source, page.index, page.rotation, snapPlan]);
  const planHere = isPdf && plan?.key === pageKey ? plan : null;
  const planIndex = snapPlan ? (planHere?.index ?? null) : null;
  const planStatus = !isPdf
    ? null
    : !planHere
      ? "reading plan lines…"
      : planHere.index
        ? `${planHere.index.segments.length.toLocaleString("en-US")} plan lines`
        : "could not read the plan lines";

  // Read the scale off the sheet (PDF): when this page has no scale and its text has exactly
  // one distinct scale note, set it (once per page per session) and say so; several notes are
  // offered in the Scale dialog instead.
  useEffect(() => {
    if (!source || source.kind !== "pdf") return;
    let live = true;
    const doc = source.doc;
    const index = page.index;
    const rotation = page.rotation;
    void (async () => {
      const read = await readSheetScale(doc, index);
      if (!live) return;
      setSheet({ index, read });
      const note = read.scale;
      let done = sheetApplied.get(doc);
      if (!note || hasScaleRef.current || done?.has(index)) return;
      const pos = await pdfPointToPage(doc, index, rotation, note.at);
      if (!live || hasScaleRef.current) return;
      if (!done) {
        done = new Set();
        sheetApplied.set(doc, done);
      }
      if (done.has(index)) return;
      done.add(index);
      onSetScaleRef.current(sheetScaleLine(note, pos.at, pos.width, pos.height), false);
      toast.info(`${sheetScaleMessage(note.text)}.`, {
        description: sheetSizeWarning(pos.width, pos.height) ?? undefined,
        duration: 12000,
      });
    })().catch(() => {
      // No text layer or an unreadable page: the scale is drawn by hand as before.
    });
    return () => {
      live = false;
    };
  }, [source, page.index, page.rotation]);
  const sheetHere = isPdf && sheet?.index === page.index ? sheet.read : null;
  /** Every distinct scale note on this sheet (the one set automatically, or the choices). */
  const sheetNotes: ScaleNote[] = sheetHere
    ? sheetHere.scale
      ? [sheetHere.scale]
      : sheetHere.choices
    : [];
  const origin = scaleOrigin(page.scale);
  const sheetInfo =
    origin?.source === "sheet"
      ? {
          note: origin.note,
          warning: isPdf && sizeW && sizeH ? sheetSizeWarning(sizeW, sizeH) : null,
        }
      : null;
  /** Use one of the sheet's scale notes as this page's scale (from the Scale dialog). */
  const applySheetNote = (i: number) => {
    const note = sheetNotes[i];
    if (!note || !source || source.kind !== "pdf") return;
    const index = page.index;
    void pdfPointToPage(source.doc, index, page.rotation, note.at).then((pos) => {
      if (pageIndexRef.current !== index) return;
      onSetScaleRef.current(sheetScaleLine(note, pos.at, pos.width, pos.height), false);
      toast.info(`${sheetScaleMessage(note.text)}.`, {
        description: sheetSizeWarning(pos.width, pos.height) ?? undefined,
        duration: 12000,
      });
    });
    setScalePick(null);
    setSheetPick(false);
    setDraft([]);
    if (tool === "scale") setTool("select");
  };

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

  // True while the page is shown "fitted" (after Fit / on open); a manual zoom or pan clears it.
  // When the drawing area changes size (menu or side panels collapsed, window resized) a fitted
  // page re-fits so it grows with the space; a zoomed-in view keeps its zoom and stays centred.
  const fittedRef = useRef(true);
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !sizeW || !sizeH) return;
    const r = el.getBoundingClientRect();
    const z = clampZoom(Math.min((r.width - 32) / sizeW, (r.height - 32) / sizeH));
    fittedRef.current = true;
    setView({ zoom: z, x: (r.width - sizeW * z) / 2, y: (r.height - sizeH * z) / 2 });
  }, [sizeW, sizeH]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        const dw = w - last.w;
        const dh = h - last.h;
        last = { w, h };
        if (!dw && !dh) return;
        if (fittedRef.current) fitRef.current();
        else setView((v) => ({ ...v, x: v.x + dw / 2, y: v.y + dh / 2 }));
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Fit each page the first time its size is known.
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (sizeW && sizeH && fittedKey.current !== pageKey) {
      fittedKey.current = pageKey;
      fit();
    }
  }, [pageKey, sizeW, sizeH, fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    fittedRef.current = false;
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
  /** The snap under `p` (own objects, then the plan's own lines), or null; none when `free`. */
  const snapAt = (p: PagePoint | null, free = shift): SnapHit | null =>
    p && !free ? pickSnap(p, candidates, planIndex, zoom, SNAP_PX) : null;

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
    return toward ? typedPoint(last, toward, typedFeet, fpp, shift, ORTHO_DEG, prev ?? null) : null;
  };

  /**
   * The point a click at `raw` places: close, typed, snapped (own objects / plan lines), square
   * to the previous side, level / plumb, or as is.
   */
  const resolve = (raw: PagePoint): { p: PagePoint; snap: SnapHit | null } => {
    if (nearFirst && draft[0]) return { p: draft[0], snap: null };
    const t = typedTarget();
    if (t) return { p: t, snap: null };
    const s = snapAt(raw);
    if (s) return { p: s.p, snap: s };
    const prev2 = draft[draft.length - 2];
    return { p: last && !shift ? lockPoint(prev2, last, raw) : raw, snap: null };
  };
  const drawing = tool !== "select";
  /** A drag-a-box rectangle's corners: each snaps to a nearby corner unless `free` (Shift). */
  const rectEnds = (a: PagePoint, b: PagePoint, free: boolean) => {
    const at = (q: PagePoint) => snapAt(q, free)?.p ?? q;
    return { a: at(a), b: at(b) };
  };
  const rectLive = press?.active ? rectEnds(press.a, press.b, shift) : null;
  const live = drawing && cursor ? resolve(cursor) : null;
  const snapped: PagePoint | null = live?.p ?? null;
  const dragSnap = drag && cursor ? snapAt(cursor) : null;

  // "Duplicate and stamp": the source, and where its copy would go for the cursor at `raw`
  // (the reference point on the snapped cursor, or a corner of the copy on a snap point).
  const selectedObject = objects.find((o) => o.id === selectedId);
  const stampSource = stamp ? objects.find((o) => o.id === stamp.sourceId) : undefined;
  const ghostSnap = (q: PagePoint): SnapHit | null =>
    pickSnap(q, candidates, planIndex, zoom, SNAP_PX);
  const placeGhost = (source: TakeoffObject, raw: PagePoint, free: boolean) =>
    ghostPlacement(source, raw, free ? [] : ghostSnap, zoom, SNAP_PX);
  const ghost = (() => {
    if (!stampSource || !cursor) return null;
    const g = placeGhost(stampSource, cursor, shift);
    const ref = stampReference(stampSource);
    const hit = g.snap;
    return {
      // Exactly what a click stamps (a count: one pin); its name is settled on the click.
      object: duplicateObject(stampSource, g.dx, g.dy, "ghost", []),
      at: [ref[0] + g.dx, ref[1] + g.dy] as PagePoint,
      snap: hit ? { p: hit.p, kind: "kind" in hit ? hit.kind : ("object" as const) } : null,
    };
  })();
  const snapMark = stamp ? (ghost?.snap ?? null) : drawing ? (live?.snap ?? null) : dragSnap;

  const changeTool = (t: Tool) => {
    if (t === "cutout" && !selectedArea) {
      toast.info("Select an area first, then draw the cut-out inside it.");
      return;
    }
    endPress();
    endEdge();
    setStamp(null);
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

  // "Edge from this area": the area's sides, each with a role or left out; Create (in the editor)
  // makes one linear per run of sides sharing a role.
  const edgeArea = edge
    ? objects.find((o) => o.id === edge.areaId && o.kind === "area")
    : undefined;
  const edgeRoles = edge && edgeArea ? edgeSideRoles(edge, edgeArea.points.length) : [];
  const edgeSum = edge && edgeArea ? edgeSummary(edgeArea.points, edgeRoles, fpp) : null;
  const startEdge = (areaId: string) => {
    const area = objects.find((o) => o.id === areaId && o.kind === "area");
    if (!area) {
      toast.info("Select an area on this page first.");
      return;
    }
    endPress();
    setTool("select");
    setDraft([]);
    setTyped("");
    setDimension(null);
    setCountSession(null);
    setStamp(null);
    // Every side starts on the role chips' role (untouched sides follow the chips).
    props.onEdgeChange({ areaId, current: linearRole, sides: [] });
  };
  const startEdgeRef = useRef(startEdge);
  startEdgeRef.current = startEdge;
  const endEdge = () => {
    if (edge) props.onEdgeChange(null);
  };
  /** A click on side `i`: the current role → left out → the current role. */
  const cycleEdge = (i: number) => {
    if (edge && edgeArea) props.onEdgeChange(cycleEdgeSide(edge, edgeArea.points.length, i));
  };
  const createEdges = () => {
    if (edge) props.onEdgeCreate();
  };
  /** The role chips / keys 1–5: the next linear's role, and in "Edge" the current role. */
  const pickLinearRole = (r: LinearRole) => {
    setLinearRole(r);
    if (edge && edge.current !== r) props.onEdgeChange({ ...edge, current: r });
  };
  // Asked for from the Objects tab.
  useEffect(() => {
    if (props.edgeRequest) startEdgeRef.current(props.edgeRequest.areaId);
  }, [props.edgeRequest]);
  // The area went away (deleted, undone, another page): leave the mode.
  useEffect(() => {
    if (edge && !edgeArea) onEdgeChangeRef.current(null);
  }, [edge, edgeArea]);

  // "Duplicate and stamp": start with the object `id` (the selection) as the source.
  const startStamp = (id: string | null) => {
    const o = id ? objects.find((x) => x.id === id) : undefined;
    if (!o) {
      toast.info("Select an area, line or count on this page first, then Duplicate (Ctrl+D).");
      return;
    }
    endPress();
    setTool("select");
    setDraft([]);
    setTyped("");
    setDimension(null);
    setCountSession(null);
    endEdge();
    setDrag(null);
    setMove(null);
    setStamp({ sourceId: o.id, count: 0 });
  };
  const startStampRef = useRef(startStamp);
  startStampRef.current = startStamp;
  /** A left click while stamping: add a copy where the ghost is (one undo step). */
  const stampAt = (raw: PagePoint, free: boolean) => {
    if (!stamp || !stampSource) return;
    const g = placeGhost(stampSource, raw, free);
    if (Math.hypot(g.dx, g.dy) * zoom < 1) {
      toast.info(`The copy would sit right on ${stampSource.attrs.name} — move it off first.`);
      return;
    }
    if (props.onDuplicate(stampSource.id, g.dx, g.dy))
      setStamp((s) => (s ? { ...s, count: s.count + 1 } : s));
  };
  // Asked for from the Objects tab.
  useEffect(() => {
    if (props.stampRequest) startStampRef.current(props.stampRequest.id);
  }, [props.stampRequest]);
  // The source went away (deleted, undone, another page): stop stamping.
  useEffect(() => {
    if (stamp && !stampSource) setStamp(null);
  }, [stamp, stampSource]);

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

  /** Right-click: PlanSwift's "Stop" — finish what is being drawn, or stop stamping copies. */
  const stop = () => {
    if (stamp) {
      setStamp(null);
      return;
    }
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

  /** Drop a press / drag-a-box in progress and let go of the pointer. */
  const endPress = () => {
    if (!press) return;
    const el = containerRef.current;
    if (el?.hasPointerCapture(press.pointerId)) el.releasePointerCapture(press.pointerId);
    setPress(null);
  };

  const cancel = (): boolean => {
    if (stamp) setStamp(null);
    else if (edge) endEdge();
    else if (press) endPress();
    else if (typed) setTyped("");
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

  /**
   * Release of a press with nothing in progress: a drag-a-box creates the whole rectangle (an
   * area, a cut-out of the selected area, or a linear around its perimeter); a press that did
   * not move, or a box under RECT_DRAG_PX on either side, places one corner like a click.
   */
  const releasePress = (pr: NonNullable<typeof press>, b: PagePoint, free: boolean) => {
    const ends = rectEnds(pr.a, b, free);
    const rect = pr.active ? dragRect(ends.a, ends.b, zoom) : null;
    if (!rect) {
      place(pr.a);
      return;
    }
    if (tool === "area" || tool === "linear") {
      props.onCreate(tool, rectObjectPoints(tool, rect), roles);
    } else if (tool === "cutout") {
      if (!selectedArea) {
        toast.info("Select an area first, then draw the cut-out inside it.");
        return;
      }
      props.onAddCutout(selectedArea.id, rect);
    } else return;
    setDraft([]);
    setTyped("");
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
    if (edge) {
      if (k === "Enter") {
        createEdges();
        return true;
      }
      if (/^[1-6]$/.test(k)) {
        const r = LINEAR_ROLES[Number(k) - 1];
        if (r) pickLinearRole(r);
        return !!r;
      }
      if (k === "Backspace" || k === "Delete") return true; // not the area itself
    }
    // Stamping: Backspace / Delete never delete the source (Ctrl+Z takes back a stamp).
    if (stamp && (k === "Backspace" || k === "Delete")) return true;
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
        pickLinearRole(LINEAR_ROLES[n]);
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
  // Ctrl/Cmd+D (duplicate and stamp), Shift (free angle, no snap), Space (pan). Keys in a text
  // field are left alone.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (scalePick || sheetPick || isTypingTarget(e.target)) return;
      if (e.key === "Shift") {
        setShift(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault(); // not the browser's bookmark
        if (!e.repeat) startStamp(selectedId);
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
      fittedRef.current = false;
      setView((v) => ({ ...v, x: pan.x + e.clientX - pan.sx, y: pan.y + e.clientY - pan.sy }));
      return;
    }
    const p = toPage(e);
    setShift(e.shiftKey);
    setCursor(p);
    if (press) {
      const active =
        press.active || isRectDrag({ x: press.sx, y: press.sy }, { x: e.clientX, y: e.clientY });
      setPress({ ...press, b: p, active });
    } else if (drag) {
      const q = snapAt(p, e.shiftKey)?.p ?? p;
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
    if (press) {
      if (e.pointerId !== press.pointerId) return;
      endPress();
      releasePress(press, toPage(e), e.shiftKey);
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
        : tool === "select" && !stamp
          ? "default"
          : "crosshair";

  const linearChipOptions = LINEAR_ROLES.map((r) => ({
    value: r,
    label: LINEAR_ROLE_LABELS[r],
    hint: LINEAR_ROLE_HINTS[r],
  }));
  const roleChips = edge
    ? {
        title: "Role for sides you click",
        options: linearChipOptions,
        value: edge.current,
        onChange: (v: string) => pickLinearRole(v as LinearRole),
      }
    : tool === "count"
      ? {
          title: "Count role",
          options: COUNT_ROLES.map((r) => ({
            value: r,
            label: COUNT_ROLE_LABELS[r],
            hint: COUNT_ROLE_HINTS[r],
          })),
          value: countRole,
          onChange: (v: string) => pickCountRole(v as CountRole),
        }
      : tool === "linear"
        ? {
            title: "Line role",
            options: linearChipOptions,
            value: linearRole,
            onChange: (v: string) => pickLinearRole(v as LinearRole),
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
        planSnap={{
          available: !source || isPdf, // unknown while the file loads
          on: snapPlan,
          status: planStatus,
          onToggle: toggleSnapPlan,
        }}
        edgeFromArea={
          edge
            ? { active: true, onClick: endEdge }
            : selectedArea
              ? { active: false, onClick: () => startEdge(selectedArea.id) }
              : null
        }
        duplicate={{
          active: !!stamp,
          enabled: !!selectedObject,
          onClick: () => (stamp ? setStamp(null) : startStamp(selectedId)),
        }}
      />

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-muted/60"
        style={{ cursor: cursorStyle }}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endPress}
        onPointerLeave={() => setCursor(null)}
        onMouseDown={(e) => {
          // No middle-click autoscroll / paste.
          if (e.button === 1) e.preventDefault();
        }}
        onContextMenu={(e) => {
          // Right-click is "Stop" while a drawing tool is active: no browser menu.
          if (drawing || draft.length || edge || stamp) e.preventDefault();
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
                if (edge) {
                  // Picking roles: a side cycles itself; right-click creates, like "Stop".
                  if (e.button === 2) {
                    e.preventDefault();
                    createEdges();
                  }
                  return;
                }
                if (stamp) {
                  // Stamping: a click stamps a copy; right-click stops, like "Stop".
                  if (e.button === 2) {
                    e.preventDefault();
                    stop();
                  } else if (e.button === 0) stampAt(toPage(e), e.shiftKey);
                  return;
                }
                if (e.button === 2) {
                  if (drawing) {
                    e.preventDefault();
                    stop();
                  }
                  return;
                }
                if (e.button !== 0) return;
                const p = toPage(e);
                // Nothing in progress with an outline tool: wait for the release, which is a
                // click (one corner) or, after a drag, a whole rectangle.
                const box = containerRef.current;
                const canBox = typingTool && draft.length === 0 && !typed && !press && !!box;
                if (canBox && (tool !== "cutout" || selectedArea)) {
                  box.setPointerCapture(e.pointerId);
                  setPress({
                    a: p,
                    b: p,
                    sx: e.clientX,
                    sy: e.clientY,
                    pointerId: e.pointerId,
                    active: false,
                  });
                  return;
                }
                place(p);
              }}
            >
              <ObjectsLayer
                objects={shown}
                fpp={fpp}
                zoom={zoom}
                selectedId={selectedId}
                interactive={tool === "select" && !spaceDown && !edge && !stamp}
                onObjectDown={onObjectDown}
                onVertexDown={onVertexDown}
              />
              {page.scale && <ScaleLine scale={page.scale} zoom={zoom} />}
              {edge && edgeArea && (
                <EdgePicker
                  points={edgeArea.points}
                  roles={edgeRoles}
                  fpp={fpp}
                  zoom={zoom}
                  onCycle={cycleEdge}
                />
              )}
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
              {tool !== "select" && tool !== "count" && draft.length === 0 && snapped && !press && (
                <TargetMarker at={snapped} zoom={zoom} color={DRAFT_COLOR[tool]} />
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
              {rectLive && (
                <RectPreview
                  a={rectLive.a}
                  b={rectLive.b}
                  filled={closing}
                  zoom={zoom}
                  fpp={fpp}
                  color={DRAFT_COLOR[tool]}
                />
              )}
              {ghost && (
                <GhostShape
                  object={ghost.object}
                  at={ghost.at}
                  zoom={zoom}
                  fpp={fpp}
                  color={ghost.object.color ?? DRAFT_COLOR[ghost.object.kind]}
                />
              )}
              {snapMark && <SnapMarker at={snapMark.p} kind={snapMark.kind} zoom={zoom} />}
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

        {edge && edgeArea && edgeSum && (
          <div
            role="status"
            className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-lg"
          >
            <SquareDashed className="h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p>
                <span className="font-semibold">Edge from {edgeArea.attrs.name}</span> — pick a role
                for each side in the panel on the right, or click a side on the plan to cycle it.
                Enter / right-click creates · Esc cancels.
              </p>
              <p className="text-xs opacity-90">{edgeSum.text}</p>
            </div>
            <Tip
              name="Create"
              wrap={!edgeSum.lines}
              text="make one line per run of sides with the same role (Enter or right-click)"
            >
              <Button
                size="sm"
                variant="secondary"
                className="h-8 px-4 font-semibold"
                onClick={createEdges}
                disabled={!edgeSum.lines}
              >
                Create
              </Button>
            </Tip>
            <Tip name="Cancel" text="leave without making any lines (Esc)">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                onClick={endEdge}
              >
                Cancel
              </Button>
            </Tip>
          </div>
        )}

        {stamp && stampSource && (
          <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs shadow">
            <span className="font-medium">
              Click to stamp a copy of {stampSource.attrs.name} · right-click or Esc to stop
            </span>
            <span className="text-muted-foreground">
              {stamp.count} stamped{stamp.count > 0 ? " · Ctrl+Z takes one back" : ""}
            </span>
            <Tip name="Stop" text="stop stamping copies (right-click or Esc)">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setStamp(null)}>
                Stop
              </Button>
            </Tip>
          </div>
        )}

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
            {edge
              ? "Edge from this area: give each side a role in the Objects panel, or click a side here to cycle it (the current role → left out → back). The role chips / keys 1–5 set the current role, which clicks use and untouched sides take. Create, Enter or right-click makes one line per run of sides with the same role; Esc cancels."
              : stamp
                ? STAMP_HINT
                : HINTS[tool]}
            {!edge && tool !== "select" && tool !== "count" && (
              <span className="ml-1">
                {shift
                  ? "Square-corner, level / plumb lock and snapping off (Shift held)."
                  : `A side within ${ORTHO_DEG}° of square to the previous side, or of level / plumb, locks to it; the cursor snaps to corners${planIndex ? " and the plan's own lines (teal)" : ""} — hold Shift for neither.`}
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
              {sheetNotes.length > 1 && (
                <button
                  type="button"
                  className="pointer-events-auto ml-1 underline underline-offset-2"
                  onClick={() => setSheetPick(true)}
                >
                  This sheet has {sheetNotes.length} scale notes — pick one…
                </button>
              )}
            </div>
          )}
          {sheetInfo && (
            <div className="max-w-[520px] rounded bg-sky-100 px-2 py-1 text-xs text-sky-900 shadow dark:bg-sky-900/60 dark:text-sky-100">
              <span className="font-medium">{sheetScaleMessage(sheetInfo.note)}.</span>
              {sheetInfo.warning && <span className="ml-1">{sheetInfo.warning}</span>} Redraw it
              with Scale (S) to replace it.
            </div>
          )}
        </div>
      </div>

      <ScaleDialog
        open={!!scalePick || sheetPick}
        pageCount={props.pageCount}
        unscaledOtherPages={props.unscaledOtherPages}
        pixels={
          scalePick
            ? Math.hypot(scalePick.b[0] - scalePick.a[0], scalePick.b[1] - scalePick.a[1])
            : null
        }
        sheetScale={sheetInfo}
        sheetChoices={sheetNotes}
        onUseSheetNote={applySheetNote}
        onCancel={() => {
          setScalePick(null);
          setSheetPick(false);
        }}
        onSave={(feet, applyToAll) => {
          if (!scalePick) return;
          // A drawn scale; it replaces one read from the sheet.
          const drawnScale: PageScale & { source: "drawn" } = {
            ax: scalePick.a[0],
            ay: scalePick.a[1],
            bx: scalePick.b[0],
            by: scalePick.b[1],
            feet,
            source: "drawn",
          };
          props.onSetScale(drawnScale, applyToAll);
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
