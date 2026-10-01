/**
 * Marking up a ticket photo, seeing the marks, and taking the picture away (owner, Oct 1:
 * "Ticket pictures need to be able to be annotated like issues circled, text added etc, and
 * those pictures need to be able to be exported if so desired. This helps show what was wrong
 * before on a repair job").
 *
 * - MarksOverlay: the marks as an SVG over a picture, scaled to its rendered size (a thumbnail
 *   is cropped like object-cover, the lightbox fits like object-contain).
 * - PhotoLightbox: the photo with its marks and the list of marks under it; Mark up (on the
 *   office ticket page and the technician's close-out, phone and desktop), Download, the
 *   original.
 * - PhotoMarkupEditor: the tools Move, Circle, Arrow, Box, Text and Tag (the Aerial's numbered
 *   tag and text, src/components/service/aerial-markup.tsx), red / yellow / white, Undo, Delete
 *   (the selected mark), Clear, zoom in / out / fit with a drag to pan, and the marks listed
 *   under the picture as on the Aerial (a row selects its mark; × removes it). Pointer events,
 *   so a finger and a mouse both draw. Every change auto-saves (debounced, useAutosave) through
 *   savePhotoAnnotations; a failure is a loud toast with the server's message. The photo itself
 *   is never altered: the marks are JSON on its row (src/lib/photo-annotations.ts).
 * - Download / DownloadAllPhotos: the marks flattened onto the photo in the browser (a canvas at
 *   the picture's natural size → PNG; photo-export.ts) as "<ticket>-<role>-<n>.png"; a photo
 *   without marks is the original file. "Download all photos" saves one file per photo, one
 *   after another (a browser may ask once to allow several downloads).
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Circle,
  Download,
  Eraser,
  ExternalLink,
  Hand,
  Loader2,
  MapPin,
  MoveUpRight,
  PenLine,
  Scan,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { TAG_PRESETS } from "@/lib/aerial-markup";
import { screenScale, screenToView } from "@/lib/aerial-geo";
import {
  DEFAULT_PHOTO_COLOR,
  HALO,
  PHOTO_COLORS,
  TAG_LABEL_MAX,
  TAG_NOTE_MAX,
  TEXT_MAX,
  arrowGeom,
  arrowHeadPath,
  ellipseGeom,
  emptyPhotoHistory,
  fullView,
  hitTest,
  isAnnotatableRole,
  markKindLabel,
  markRows,
  marksSummary,
  moveMark,
  newMarkId,
  panPhotoView,
  parsePhotoMarks,
  pathD,
  photoColorHex,
  photoMarksReducer,
  photoOrdinals,
  photoTagNumbers,
  rectGeom,
  serializePhotoMarks,
  shapeFromDrag,
  strokeFor,
  tagGeom,
  textBox,
  textSizeFor,
  toNorm,
  viewZoom,
  zoomPhotoView,
  type PhotoColor,
  type PhotoMark,
  type PhotoView,
  type Pt,
} from "@/lib/photo-annotations";
import { savePhotoAnnotations, type JobPhotoRow } from "@/lib/service-field.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errText, fieldKeys, loudError, useAutosave } from "@/components/service/field-utils";
import { downloadPhoto, useNaturalSize } from "@/components/service/photo-export";

const ROLE_LABEL: Record<string, string> = {
  before: "Before",
  after: "After",
  other: "Photo",
  aerial: "Aerial",
  signature: "Signature",
};

// ── Drawing the marks (SVG, image px) ────────────────────────────────────────────────────────

/** The marks as SVG shapes in image px (the caller's viewBox is the picture, w × h). */
export function MarkShapes({
  marks,
  w,
  h,
  selected,
}: {
  marks: PhotoMark[];
  w: number;
  h: number;
  /** The mark with a dashed box around it (the editor's selection). */
  selected?: string | null | undefined;
}) {
  const sw = strokeFor(w, h);
  const size = textSizeFor(w, h);
  const tags = photoTagNumbers(marks);
  const twice = (key: string, el: (stroke: string, width: number) => React.ReactElement) => (
    <g key={key}>
      {el(HALO, sw * 1.8)}
      {el("", sw)}
    </g>
  );
  const words = { paintOrder: "stroke" as const, stroke: HALO, strokeWidth: size * 0.18 };
  return (
    <>
      {marks.map((m) => {
        const color = photoColorHex(m.color);
        const pick = (s: string) => s || color;
        switch (m.kind) {
          case "ellipse": {
            const g = ellipseGeom(m, w, h);
            return twice(m.id, (s, width) => (
              <ellipse
                cx={g.cx}
                cy={g.cy}
                rx={g.rx}
                ry={g.ry}
                fill="none"
                stroke={pick(s)}
                strokeWidth={width}
              />
            ));
          }
          case "rect": {
            const g = rectGeom(m, w, h);
            return twice(m.id, (s, width) => (
              <rect
                x={g.x}
                y={g.y}
                width={g.w}
                height={g.h}
                fill="none"
                stroke={pick(s)}
                strokeWidth={width}
                strokeLinejoin="round"
              />
            ));
          }
          case "arrow": {
            const g = arrowGeom(m, w, h, sw);
            return (
              <g key={m.id}>
                <path
                  d={pathD([g.tail, g.base])}
                  stroke={HALO}
                  strokeWidth={sw * 1.8}
                  strokeLinecap="round"
                />
                <path
                  d={pathD([g.tail, g.base])}
                  stroke={color}
                  strokeWidth={sw}
                  strokeLinecap="round"
                />
                <path
                  d={arrowHeadPath(m, w, h)}
                  fill={color}
                  stroke={HALO}
                  strokeWidth={sw * 0.8}
                  strokeLinejoin="round"
                />
              </g>
            );
          }
          case "text": {
            const [x, y] = [m.at[0] * w, m.at[1] * h];
            return (
              <text
                key={m.id}
                x={x}
                y={y}
                fill={color}
                fontSize={size}
                fontWeight={700}
                fontFamily="sans-serif"
                dominantBaseline="middle"
                style={words}
              >
                {m.text}
              </text>
            );
          }
          case "tag": {
            const g = tagGeom(m, w, h);
            return (
              <g key={m.id}>
                <circle cx={g.x} cy={g.y} r={g.r} fill={color} stroke="#000" strokeWidth={sw / 3} />
                <text
                  x={g.x}
                  y={g.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={g.r * 1.1}
                  fontWeight={700}
                  fontFamily="sans-serif"
                  fill={m.color === "red" ? "#fff" : "#000"}
                >
                  {tags.get(m.id)}
                </text>
                <text
                  x={g.label.x}
                  y={g.y}
                  dominantBaseline="middle"
                  fontSize={g.labelSize}
                  fontWeight={700}
                  fontFamily="sans-serif"
                  fill="#fff"
                  style={{ ...words, strokeWidth: g.labelSize * 0.18 }}
                >
                  {m.label}
                </text>
              </g>
            );
          }
        }
      })}
      {selected && <SelectionBox mark={marks.find((m) => m.id === selected)} w={w} h={h} />}
    </>
  );
}

/** A dashed box around the selected mark. */
function SelectionBox({ mark, w, h }: { mark: PhotoMark | undefined; w: number; h: number }) {
  if (!mark) return null;
  const sw = strokeFor(w, h);
  let b: { x: number; y: number; w: number; h: number };
  if (mark.kind === "ellipse" || mark.kind === "rect") b = rectGeom(mark, w, h);
  else if (mark.kind === "arrow") {
    const g = arrowGeom(mark, w, h, sw);
    const xs = [g.tail[0], g.tip[0], g.left[0], g.right[0]];
    const ys = [g.tail[1], g.tip[1], g.left[1], g.right[1]];
    b = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  } else if (mark.kind === "text") b = textBox(mark, w, h);
  else {
    const g = tagGeom(mark, w, h);
    b = { x: g.x - g.r, y: g.y - g.r, w: g.r * 2.3 + g.label.w, h: g.r * 2 };
  }
  const pad = sw * 2;
  return (
    <rect
      x={b.x - pad}
      y={b.y - pad}
      width={b.w + 2 * pad}
      height={b.h + 2 * pad}
      fill="none"
      stroke="#fff"
      strokeWidth={sw * 0.6}
      strokeDasharray={`${sw * 2} ${sw * 1.5}`}
      style={{ pointerEvents: "none" }}
    />
  );
}

/**
 * The marks over a picture that fills its box: "cover" crops like the thumbnail's
 * object-cover, "contain" fits like the lightbox's picture. `w` × `h` is the natural size.
 */
export function MarksOverlay({
  marks,
  w,
  h,
  fit,
}: {
  marks: PhotoMark[];
  w: number;
  h: number;
  fit: "cover" | "contain";
}) {
  if (!marks.length || !(w > 0) || !(h > 0)) return null;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <MarkShapes marks={marks} w={w} h={h} />
    </svg>
  );
}

/** A mark's colour, as a dot beside its row. */
function MarkDot({ color }: { color: string }) {
  return (
    <span
      className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-black/60"
      style={{ background: photoColorHex(color) }}
    />
  );
}

/** The list of marks under the picture (as the Aerial's Tags and Text lists). */
function MarkList({
  marks,
  selected,
  onSelect,
  onRemove,
}: {
  marks: PhotoMark[];
  selected?: string | null | undefined;
  onSelect?: ((id: string) => void) | undefined;
  onRemove?: ((id: string) => void) | undefined;
}) {
  if (!marks.length) return null;
  return (
    <ol className="space-y-1 text-sm" aria-label="Marks">
      {markRows(marks).map((r) => (
        <li
          key={r.mark.id}
          className={`flex items-start gap-2 rounded-md border px-2 py-1.5 ${selected === r.mark.id ? "border-primary bg-primary/5" : ""}`}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
            disabled={!onSelect}
            title={onSelect ? "Select it on the picture" : undefined}
            onClick={() => onSelect?.(r.mark.id)}
          >
            <MarkDot color={r.mark.color} />
            <span className="min-w-0 flex-1 break-words">
              {r.mark.kind === "text" || r.mark.kind === "tag" ? (
                <>
                  <span className="text-muted-foreground">{markKindLabel(r.mark.kind)}: </span>
                  {r.text}
                </>
              ) : (
                r.text
              )}
            </span>
          </button>
          {onRemove && (
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-muted"
              aria-label={`Remove ${r.text}`}
              onClick={() => onRemove(r.mark.id)}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

// ── Download all ─────────────────────────────────────────────────────────────────────────────

/** "Download all photos": one file per photo (marks drawn in), one after another. */
export function DownloadAllPhotos({
  photos,
  ticketNumber,
}: {
  photos: JobPhotoRow[];
  ticketNumber: string | number | null | undefined;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const list = photos.filter((p) => p.role !== "signature");
  if (!list.length) return null;
  const run = async () => {
    const ord = photoOrdinals(list);
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    let failed = 0;
    for (const [i, p] of sorted.entries()) {
      setBusy(`${i + 1} of ${sorted.length}`);
      try {
        await downloadPhoto(p, ticketNumber, ord.get(p.id) ?? i + 1);
      } catch (e) {
        failed++;
        toast.error(
          `${ROLE_LABEL[p.role] ?? "Photo"} ${ord.get(p.id) ?? ""} did not download: ${errText(e)}`,
        );
      }
      // A breath between files, so the browser takes each as its own download.
      await new Promise((r) => setTimeout(r, 400));
    }
    setBusy(null);
    if (!failed)
      toast.success(`${sorted.length} ${sorted.length === 1 ? "photo" : "photos"} downloaded`);
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy !== null}
      title="Save every photo of this ticket, with its marks, one file each"
      onClick={() => void run()}
    >
      {busy ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-1 h-4 w-4" />
      )}
      {busy ? `Downloading ${busy}…` : "Download all photos"}
    </Button>
  );
}

// ── The lightbox ────────────────────────────────────────────────────────────────────────────

export function PhotoLightbox({
  photo,
  url,
  open,
  onOpenChange,
  canAnnotate,
  ticketNumber,
  ordinal,
}: {
  photo: JobPhotoRow;
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mark up is offered (the ticket's editors; never on a signature or the aerial). */
  canAnnotate: boolean;
  ticketNumber: string | number | null | undefined;
  /** The photo's number among the ticket's photos of its role (the file name). */
  ordinal: number;
}) {
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const size = useNaturalSize(open ? url : null);
  const marks = useMemo(() => parsePhotoMarks(photo.annotations), [photo.annotations]);
  const markable = canAnnotate && isAnnotatableRole(photo.role);
  const label = ROLE_LABEL[photo.role] ?? "Photo";
  const download = async () => {
    setDownloading(true);
    try {
      await downloadPhoto(photo, ticketNumber, ordinal);
    } catch (e) {
      loudError("Could not download the photo", e);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setEditing(false);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[96vh] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {label} photo {ordinal}
            {ticketNumber != null ? ` · #${ticketNumber}` : ""}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Circle the problem, point at it, box it, write on it or tag it. Saved as you go; the photo itself is not changed."
              : marks.length
                ? marksSummary(marks)
                : "No marks on this photo."}
          </DialogDescription>
        </DialogHeader>
        {editing && size ? (
          <PhotoMarkupEditor
            photo={photo}
            url={url}
            size={size}
            ticketNumber={ticketNumber}
            ordinal={ordinal}
            onDone={() => setEditing(false)}
          />
        ) : (
          <div className="space-y-3">
            <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-md border bg-neutral-900">
              <img
                src={url}
                alt={`${label} photo`}
                className="block max-h-[65vh] max-w-full object-contain"
              />
              {size && <MarksOverlay marks={marks} w={size.w} h={size.h} fit="contain" />}
            </div>
            <MarkList marks={marks} />
            <div className="flex flex-wrap items-center gap-2">
              {markable && (
                <Button
                  type="button"
                  className="h-11 sm:h-9"
                  disabled={!size}
                  onClick={() => setEditing(true)}
                >
                  <PenLine className="mr-1 h-4 w-4" /> Mark up
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-9"
                disabled={downloading}
                title={
                  marks.length
                    ? "Save the photo with its marks drawn in (PNG)"
                    : "Save the photo as it was taken"
                }
                onClick={() => void download()}
              >
                {downloading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                Download
              </Button>
              <Button asChild variant="ghost" className="h-11 sm:h-9">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-4 w-4" /> Original
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── The editor ──────────────────────────────────────────────────────────────────────────────

type Tool = "move" | "ellipse" | "arrow" | "rect" | "text" | "tag";
const TOOLS: { id: Tool; label: string; icon: typeof Hand }[] = [
  { id: "move", label: "Move", icon: Hand },
  { id: "ellipse", label: "Circle", icon: Circle },
  { id: "arrow", label: "Arrow", icon: MoveUpRight },
  { id: "rect", label: "Box", icon: Square },
  { id: "text", label: "Text", icon: Type },
  { id: "tag", label: "Tag", icon: MapPin },
];
type ShapeKind = "ellipse" | "arrow" | "rect";

/** A key typed in a text box is the text box's (Delete, Backspace, Ctrl+Z). */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA");

export function PhotoMarkupEditor({
  photo,
  url,
  size,
  ticketNumber,
  ordinal,
  onDone,
}: {
  photo: JobPhotoRow;
  url: string;
  size: { w: number; h: number };
  ticketNumber: string | number | null | undefined;
  ordinal: number;
  onDone: () => void;
}) {
  const { w: W, h: H } = size;
  const qc = useQueryClient();
  const saveFn = useServerFn(savePhotoAnnotations);
  const [history, dispatch] = useReducer(
    photoMarksReducer,
    parsePhotoMarks(photo.annotations),
    emptyPhotoHistory,
  );
  const [tool, setTool] = useState<Tool>("ellipse");
  const [color, setColor] = useState<PhotoColor>(DEFAULT_PHOTO_COLOR);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<PhotoView>(() => fullView(W, H));
  const [draft, setDraft] = useState<{ kind: ShapeKind; a: Pt; b: Pt } | null>(null);
  const [moving, setMoving] = useState<{ id: string; du: number; dv: number } | null>(null);
  const [pending, setPending] = useState<{ kind: "text" | "tag"; at: Pt } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<
    | { type: "draw"; kind: ShapeKind; a: Pt }
    | { type: "move"; id: string; from: Pt }
    | { type: "pan"; sx: number; sy: number; view: PhotoView; k: number }
    | null
  >(null);

  // Auto-save every change (debounced); a failure is a loud toast with the server's message.
  const autosave = useAutosave<ReturnType<typeof serializePhotoMarks>>(
    async (annotations) => {
      const row = await saveFn({
        data: { id: photo.id, service_job_id: photo.service_job_id, annotations },
      });
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(photo.service_job_id), (old) =>
        old?.map((p) => (p.id === row.id ? row : p)),
      );
      void qc.invalidateQueries({ queryKey: ["invoice-photos"] });
    },
    { what: "The photo's marks", delay: 600 },
  );
  const savedJson = useRef(JSON.stringify(serializePhotoMarks(history.marks)));
  useEffect(() => {
    const next = serializePhotoMarks(history.marks);
    const json = JSON.stringify(next);
    if (json === savedJson.current) return;
    savedJson.current = json;
    autosave.push(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- push is stable; save on a change only
  }, [history.marks]);

  // A selection that was undone / removed goes away.
  useEffect(() => {
    if (selected && !history.marks.some((m) => m.id === selected)) setSelected(null);
  }, [history.marks, selected]);

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (typing(e.target)) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      dispatch({ type: "remove", id: selected });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      dispatch({ type: "undo" });
    } else if (e.key === "Escape" && (selected || pending)) {
      e.preventDefault();
      e.stopPropagation();
      setSelected(null);
      setPending(null);
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);

  const box = () => svg.current!.getBoundingClientRect();
  /** Image px per screen px (for on-screen tolerances). */
  const perScreen = () => {
    const k = screenScale(box(), { width: view.w, height: view.h });
    return k > 0 ? 1 / k : 1;
  };
  const toImg = (e: React.PointerEvent): Pt => {
    const [vx, vy] = screenToView(box(), { width: view.w, height: view.h }, e.clientX, e.clientY);
    return [Math.min(W, Math.max(0, view.x + vx)), Math.min(H, Math.max(0, view.y + vy))];
  };
  const norm = (p: Pt) => toNorm(p, W, H);

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || gesture.current) return;
    e.preventDefault();
    const p = toImg(e);
    if (tool === "text" || tool === "tag") {
      setPending({ kind: tool, at: norm(p) });
      return;
    }
    svg.current?.setPointerCapture(e.pointerId);
    if (tool === "move") {
      const touch = e.pointerType === "touch";
      const hit = hitTest(history.marks, p, W, H, (touch ? 16 : 8) * perScreen());
      if (hit) {
        setSelected(hit);
        gesture.current = { type: "move", id: hit, from: p };
        setMoving({ id: hit, du: 0, dv: 0 });
      } else {
        setSelected(null);
        gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, view, k: perScreen() };
      }
      return;
    }
    gesture.current = { type: "draw", kind: tool, a: norm(p) };
    setDraft({ kind: tool, a: norm(p), b: norm(p) });
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pan") {
      setView(panPhotoView(g.view, W, H, (e.clientX - g.sx) * g.k, (e.clientY - g.sy) * g.k));
      return;
    }
    const p = toImg(e);
    if (g.type === "draw") setDraft({ kind: g.kind, a: g.a, b: norm(p) });
    else setMoving({ id: g.id, du: (p[0] - g.from[0]) / W, dv: (p[1] - g.from[1]) / H });
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const cancelled = e.type === "pointercancel";
    if (g.type === "draw") {
      setDraft(null);
      if (cancelled) return;
      const s = shapeFromDrag(g.kind, g.a, norm(toImg(e)), W, H, 8 * perScreen());
      if (!s) {
        toast.info("Drag from the tail to the tip to draw an arrow");
        return;
      }
      const id = newMarkId();
      dispatch({ type: "add", mark: { id, kind: g.kind, color, a: s.a, b: s.b } });
    } else if (g.type === "move") {
      setMoving(null);
      if (cancelled) return;
      const p = toImg(e);
      dispatch({ type: "move", id: g.id, du: (p[0] - g.from[0]) / W, dv: (p[1] - g.from[1]) / H });
    }
  };

  const shown = useMemo(() => {
    const base = moving
      ? history.marks.map((m) => (m.id === moving.id ? moveMark(m, moving.du, moving.dv) : m))
      : history.marks;
    return draft ? [...base, { id: "draft", color, ...draft } as PhotoMark] : base;
  }, [history.marks, moving, draft, color]);

  const zoom = viewZoom(view, W);
  const cursor =
    tool === "move"
      ? gesture.current?.type === "pan"
        ? "grabbing"
        : "grab"
      : tool === "text"
        ? "text"
        : "crosshair";
  const pick = (t: Tool) => {
    setTool(t);
    setPending(null);
    if (t !== "move") setSelected(null);
  };
  const download = async () => {
    setDownloading(true);
    try {
      await downloadPhoto(photo, ticketNumber, ordinal, history.marks);
    } catch (e) {
      loudError("Could not download the photo", e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Tool">
          {TOOLS.map((t) => (
            <Button
              key={t.id}
              type="button"
              size="sm"
              variant={tool === t.id ? "default" : "outline"}
              aria-pressed={tool === t.id}
              className="h-10 px-3"
              onClick={() => pick(t.id)}
            >
              <t.icon className="mr-1 h-4 w-4" /> {t.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Colour">
          {PHOTO_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={color === c.id}
              className={`h-9 w-9 rounded-full border-2 ${color === c.id ? "border-foreground ring-2 ring-ring ring-offset-2" : "border-muted-foreground/40"}`}
              style={{ background: c.hex }}
              onClick={() => setColor(c.id as PhotoColor)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10"
            disabled={!history.past.length}
            onClick={() => dispatch({ type: "undo" })}
          >
            <Undo2 className="mr-1 h-4 w-4" /> Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10"
            disabled={!selected}
            title="Delete the selected mark (pick it with Move, or in the list)"
            onClick={() => selected && dispatch({ type: "remove", id: selected })}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10"
            disabled={!history.marks.length}
            onClick={() => {
              if (window.confirm("Clear every mark on this photo? (Undo brings them back.)"))
                dispatch({ type: "clear" });
            }}
          >
            <Eraser className="mr-1 h-4 w-4" /> Clear
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {tool === "move"
          ? "Drag a mark to move it; tap one to select it. Drag the picture to pan when zoomed in."
          : tool === "text" || tool === "tag"
            ? "Tap where it goes."
            : tool === "arrow"
              ? "Drag from the tail to the tip."
              : "Drag across the problem, or tap for a quick one."}
      </p>

      <div className="max-h-[min(65vh,640px)] overflow-hidden rounded-md border bg-neutral-900">
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="mx-auto block h-auto max-h-full w-full touch-none select-none"
          style={{
            cursor,
            aspectRatio: `${W} / ${H}`,
            maxWidth: `min(100%, calc((min(65vh, 640px) - 2px) * ${W / H}))`,
          }}
          role="img"
          aria-label="The photo, to mark up"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <image href={url} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
          <MarkShapes marks={shown} w={W} h={H} selected={selected} />
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Zoom out"
          disabled={zoom <= 1.001}
          onClick={() => setView(zoomPhotoView(view, W, H, 0.5))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Zoom in"
          disabled={zoom >= 5.99}
          onClick={() => setView(zoomPhotoView(view, W, H, 2))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          title="The whole photo"
          disabled={zoom <= 1.001}
          onClick={() => setView(fullView(W, H))}
        >
          <Scan className="mr-1 h-4 w-4" /> Fit
        </Button>
        <span className="text-xs text-muted-foreground">
          {marksSummary(history.marks)}
          {autosave.state === "saving" || autosave.state === "pending"
            ? " · saving…"
            : autosave.state === "saved"
              ? " · saved"
              : autosave.state === "error"
                ? " · not saved"
                : ""}
        </span>
      </div>

      {pending && (
        <PlaceForm
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onAdd={(f) => {
            const base = { id: newMarkId(), color, at: pending.at };
            dispatch({
              type: "add",
              mark:
                pending.kind === "tag"
                  ? { ...base, kind: "tag", label: f.label, note: f.note }
                  : { ...base, kind: "text", text: f.label },
            });
            setPending(null);
          }}
        />
      )}

      <MarkList
        marks={history.marks}
        selected={selected}
        onSelect={(id) => {
          setTool("move");
          setSelected(id);
        }}
        onRemove={(id) => dispatch({ type: "remove", id })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="h-11 sm:h-9"
          onClick={() => {
            void autosave.flush();
            onDone();
          }}
        >
          Done
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          disabled={downloading}
          title="Save the photo with these marks drawn in (PNG)"
          onClick={() => void download()}
        >
          {downloading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1 h-4 w-4" />
          )}
          Download
        </Button>
      </div>
    </div>
  );
}

/** A text mark's words, or a tag's label (preset chips or free text) and note. */
function PlaceForm({
  kind,
  onAdd,
  onCancel,
}: {
  kind: "text" | "tag";
  onAdd: (f: { label: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const ok = label.trim().length > 0;
  return (
    <form
      className="space-y-2 rounded-md border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onAdd({ label: label.trim(), note: note.trim() });
      }}
    >
      <p className="text-sm font-medium">{kind === "tag" ? "New tag here" : "Text here"}</p>
      {kind === "tag" && (
        <div className="flex flex-wrap gap-1">
          {TAG_PRESETS.map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={label === t ? "default" : "outline"}
              className="h-8"
              onClick={() => setLabel(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="photo-mark-label" className="text-xs">
          {kind === "tag" ? "Label" : "Text"}
        </Label>
        <Input
          id="photo-mark-label"
          autoFocus
          className="h-10 text-base"
          maxLength={kind === "tag" ? TAG_LABEL_MAX : TEXT_MAX}
          value={label}
          placeholder={kind === "tag" ? "e.g. Open seam" : "e.g. Leak here"}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      {kind === "tag" && (
        <div className="space-y-1">
          <Label htmlFor="photo-mark-note" className="text-xs">
            Note
          </Label>
          <Textarea
            id="photo-mark-note"
            rows={2}
            className="text-base"
            maxLength={TAG_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ok}>
          {kind === "tag" ? "Add tag" : "Add text"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
