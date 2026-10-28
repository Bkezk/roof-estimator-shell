/**
 * Marking up a ticket photo, seeing the marks, and taking the picture away (owner, Oct 1:
 * "Ticket pictures need to be able to be annotated like issues circled, text added etc, and
 * those pictures need to be able to be exported if so desired. This helps show what was wrong
 * before on a repair job").
 *
 * - MarksOverlay: the marks as an SVG over a picture, scaled to its rendered size (a thumbnail
 *   is cropped like object-cover, the lightbox fits like object-contain).
 * - RotatedPhoto: a photo the way it is kept — turned by its rotation (owner, Oct 28: "allow
 *   rotation of photos on markup"; photo-annotations.ts) with its marks over it. The one piece
 *   every place a ticket photo shows uses: the thumbnails (ticket page, close-out, invoice fold,
 *   inspection items, site history), the lightbox and the document canvas.
 * - PhotoLightbox: the photo with its marks and the list of marks under it; Mark up (on the
 *   office ticket page and the technician's close-out, phone and desktop), Download, the
 *   original.
 * - PhotoMarkupEditor: two rows of tools around the picture (owner, Oct 28). Above it: Move,
 *   Circle, Arrow, Box, Text and Tag (the Aerial's numbered tag and text,
 *   src/components/service/aerial-markup.tsx; icons only on a phone), a divider, one colour
 *   button (a swatch of the current colour; a popover with red / yellow / white), Undo and Clear.
 *   Below it, one line: Zoom in / out / Fit (a drag pans when zoomed in) and Rotate left / right
 *   (the picture and its marks turn as one; a mark drawn afterwards is mapped back into the
 *   picture's own space). The selected mark carries its own handles — a grip to drag it and a ×
 *   to remove it — and the marks are listed under the picture as on the Aerial (a row selects its
 *   mark; × removes it). On a phone (coarsePointer) picking Text or Tag opens a bottom sheet at
 *   once (the keyboard with it, the preset chips and the last five labels used on this device,
 *   lib/markup-memory.ts); Done puts the label in the middle of what is on screen
 *   (lib/markup-touch.ts centreOfView) and selects it with Move, so a finger drags it into place
 *   ("Drag the label where it belongs"); a tap on the picture places it there instead. On a
 *   computer Text / Tag still wait for a click and the form shows inline. Handles are finger-sized
 *   and labels draw one size up on a phone (markup-touch.ts). Pointer events, so a finger and a
 *   mouse both draw. Every change — a mark or a turn — auto-saves (debounced, useAutosave) through
 *   savePhotoAnnotations; a failure is a loud toast with the server's message. Undo is the marks
 *   reducer (photoMarksReducer), so it takes a turn back too. Done (and the caller's buttons
 *   beside it) stay pinned to the bottom of the dialog. The photo itself is never altered: the
 *   marks and the rotation are JSON on its row (src/lib/photo-annotations.ts).
 * - Download / DownloadAllPhotos: the marks flattened onto the photo, turned as shown, in the
 *   browser (a canvas at the picture's natural size, sides swapped at 90 / 270 → PNG;
 *   photo-export.ts) as "<ticket>-<role>-<n>.png"; a photo without marks that is not turned is
 *   the original file. "Download all photos" saves one file per photo, one after another (a
 *   browser may ask once to allow several downloads).
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Eraser,
  ExternalLink,
  GripHorizontal,
  Hand,
  Loader2,
  MapPin,
  MoveUpRight,
  PenLine,
  RotateCcw,
  RotateCw,
  Scan,
  Square,
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
  parsePhotoMarkup,
  pathD,
  photoColorHex,
  photoMarksReducer,
  photoOrdinals,
  photoTagNumbers,
  rectGeom,
  rotatedBox,
  rotationTransform,
  serializePhotoMarks,
  shapeFromDrag,
  strokeFor,
  tagGeom,
  textSizeFor,
  toNorm,
  unrotatePoint,
  viewZoom,
  zoomPhotoView,
  type PhotoColor,
  type PhotoMark,
  type PhotoMarkup,
  type PhotoView,
  type Pt,
  type Rotation,
} from "@/lib/photo-annotations";
import {
  deviceStorage,
  readMarkupMemory,
  readRecentLabels,
  rememberLabel,
  writeMarkupMemory,
} from "@/lib/markup-memory";
import {
  centreOfView,
  grabTolerance,
  handlePlaces,
  handleSizes,
  selectionBounds,
  textScaleFor,
} from "@/lib/markup-touch";
import { savePhotoAnnotations, type JobPhotoRow } from "@/lib/service-field.functions";
import { cn } from "@/lib/utils";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  coarsePointer,
  errText,
  fieldKeys,
  loudError,
  useAutosave,
} from "@/components/service/field-utils";
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
  textScale = 1,
}: {
  marks: PhotoMark[];
  w: number;
  h: number;
  /** The mark with a dashed box around it (the editor's selection). */
  selected?: string | null | undefined;
  /** Text and tag labels this much larger (the editor on a phone: textScaleFor; 1 elsewhere). */
  textScale?: number | undefined;
}) {
  const sw = strokeFor(w, h);
  const size = textSizeFor(w, h) * textScale;
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
                  fontSize={g.labelSize * textScale}
                  fontWeight={700}
                  fontFamily="sans-serif"
                  fill="#fff"
                  style={{ ...words, strokeWidth: g.labelSize * textScale * 0.18 }}
                >
                  {m.label}
                </text>
              </g>
            );
          }
        }
      })}
      {selected && (
        <SelectionBox
          mark={marks.find((m) => m.id === selected)}
          w={w}
          h={h}
          textScale={textScale}
        />
      )}
    </>
  );
}

/** A dashed box around the selected mark (its bounds: lib/markup-touch.ts selectionBounds). */
function SelectionBox({
  mark,
  w,
  h,
  textScale,
}: {
  mark: PhotoMark | undefined;
  w: number;
  h: number;
  textScale: number;
}) {
  if (!mark) return null;
  const sw = strokeFor(w, h);
  const b = selectionBounds(mark, w, h, textScale);
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

/**
 * A photo the way it is kept: turned by its rotation, its marks over it (photo-annotations.ts —
 * the marks stay in the picture's own space; picture and marks turn as one). Inside a positioned
 * box that it fills (`className`, e.g. "h-full w-full"), `fit` crops like object-cover (the
 * square thumbnails) or fits like object-contain (the lightbox, the document canvas).
 *
 * Not turned, it is the plain <img> with MarksOverlay over it, as before. Turned, it is an SVG
 * whose viewBox is the turned box (rotatedBox) with the picture and the marks in one rotated
 * group (rotationTransform), so the crop and the fit come out as for a picture taken that way.
 * The natural size comes from the caller (`size`, when it measures the picture itself — then it
 * is the only source, so the caller's layout and this never disagree) or from the <img> as it
 * loads; until a turned picture's size is known the <img> loads invisibly (its crop would be
 * wrong), lazily when asked, so a long strip of thumbnails still loads as it scrolls.
 */
export function RotatedPhoto({
  url,
  alt,
  marks,
  rotation,
  fit,
  size,
  className,
  style,
  title,
  loading,
  draggable,
}: {
  url: string;
  alt: string;
  marks: PhotoMark[];
  rotation: Rotation;
  fit: "cover" | "contain";
  /** The natural size when the caller measures it (null until it knows); omit to measure here. */
  size?: { w: number; h: number } | null | undefined;
  /** Classes for the picture element (the <img> and the <svg> alike), e.g. "h-full w-full". */
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  title?: string | undefined;
  loading?: "lazy" | "eager" | undefined;
  draggable?: boolean | undefined;
}) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const natural = size !== undefined ? size : measured;
  if (!rotation || !natural) {
    return (
      <>
        <img
          src={url}
          alt={alt}
          title={title}
          className={cn(
            fit === "cover" ? "object-cover" : "object-contain",
            className,
            rotation && "invisible",
          )}
          style={style}
          loading={loading}
          draggable={draggable}
          onLoad={(e) => {
            const s = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
            if (s.w > 0 && s.h > 0) setMeasured(s);
          }}
        />
        {natural && <MarksOverlay marks={marks} w={natural.w} h={natural.h} fit={fit} />}
      </>
    );
  }
  const box = rotatedBox(natural.w, natural.h, rotation);
  return (
    <svg
      viewBox={`0 0 ${box.w} ${box.h}`}
      width={box.w}
      height={box.h}
      preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
      // h-auto: the height follows the width through the viewBox's ratio, unless the caller
      // sizes both (tailwind-merge lets the caller's height class win).
      className={cn("h-auto", className)}
      style={style}
      role="img"
      aria-label={alt}
      data-rotation={rotation}
    >
      {title ? <title>{title}</title> : null}
      <g transform={rotationTransform(natural.w, natural.h, rotation)}>
        <image
          href={url}
          x={0}
          y={0}
          width={natural.w}
          height={natural.h}
          preserveAspectRatio="none"
        />
        <MarkShapes marks={marks} w={natural.w} h={natural.h} />
      </g>
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
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-muted sm:h-7 sm:w-7"
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
  nav,
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
  /**
   * Leafing through a ticket's photos (the History fold; owner, Oct 21): this photo's place in
   * the set, and the step — arrows on screen, the arrow keys, a swipe on a phone.
   */
  nav?: { index: number; count: number; onStep: (delta: 1 | -1) => void } | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const size = useNaturalSize(open ? url : null);
  const { marks, rotation } = useMemo(
    () => parsePhotoMarkup(photo.annotations),
    [photo.annotations],
  );
  // The box the turned picture takes, so the frame hugs it and is at most 65vh tall.
  const shown = size ? rotatedBox(size.w, size.h, rotation) : null;
  const markable = canAnnotate && isAnnotatableRole(photo.role);
  const label = ROLE_LABEL[photo.role] ?? "Photo";
  const touchX = useRef<number | null>(null);
  const canPrev = !!nav && nav.index > 0;
  const canNext = !!nav && nav.index < nav.count - 1;
  useEffect(() => {
    if (!open || !nav || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && canPrev) nav.onStep(-1);
      else if (e.key === "ArrowRight" && canNext) nav.onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, nav, editing, canPrev, canNext]);
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
            <div
              className={`relative mx-auto overflow-hidden rounded-md border bg-neutral-900 ${shown ? "w-full" : "w-fit max-w-full"}`}
              style={
                shown
                  ? {
                      aspectRatio: `${shown.w} / ${shown.h}`,
                      maxWidth: `min(100%, ${shown.w}px, calc(65vh * ${shown.w / shown.h}))`,
                    }
                  : undefined
              }
              // A swipe on a phone leafs through the set (nav): left for the next, right for the one before.
              onTouchStart={(e) => {
                touchX.current = nav ? (e.touches[0]?.clientX ?? null) : null;
              }}
              onTouchEnd={(e) => {
                const from = touchX.current;
                touchX.current = null;
                const to = e.changedTouches[0]?.clientX;
                if (!nav || from === null || to === undefined) return;
                const dx = to - from;
                if (dx <= -40 && canNext) nav.onStep(1);
                else if (dx >= 40 && canPrev) nav.onStep(-1);
              }}
            >
              <RotatedPhoto
                url={url}
                alt={`${label} photo`}
                marks={marks}
                rotation={rotation}
                size={size}
                fit="contain"
                className={shown ? "block h-full w-full" : "block max-h-[65vh] max-w-full"}
              />
            </div>
            {nav && nav.count > 1 && (
              <div
                className="flex items-center justify-center gap-3 text-sm text-muted-foreground"
                data-line="photo-nav"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11"
                  aria-label="Previous photo"
                  disabled={!canPrev}
                  onClick={() => nav.onStep(-1)}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <span className="tabular-nums">
                  {nav.index + 1} of {nav.count}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-11 w-11"
                  aria-label="Next photo"
                  disabled={!canNext}
                  onClick={() => nav.onStep(1)}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            )}
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
                    ? "Save the photo with its marks drawn in, turned as shown (PNG)"
                    : rotation
                      ? "Save the photo turned as shown (PNG)"
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
  const qc = useQueryClient();
  const saveFn = useServerFn(savePhotoAnnotations);
  const initial = useMemo(() => parsePhotoMarkup(photo.annotations), [photo.annotations]);
  // The marks and the rotation as the surface has them (a turn saves like a mark).
  const [markup, setMarkup] = useState<PhotoMarkup>(initial);
  const [downloading, setDownloading] = useState(false);

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
      void qc.invalidateQueries({ queryKey: ["document"] });
    },
    { what: "The photo's marks", delay: 600 },
  );
  const savedJson = useRef(JSON.stringify(serializePhotoMarks(markup.marks, markup.rotation)));
  useEffect(() => {
    const next = serializePhotoMarks(markup.marks, markup.rotation);
    const json = JSON.stringify(next);
    if (json === savedJson.current) return;
    savedJson.current = json;
    autosave.push(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- push is stable; save on a change only
  }, [markup]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadPhoto(photo, ticketNumber, ordinal, markup.marks, markup.rotation);
    } catch (e) {
      loudError("Could not download the photo", e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <PhotoMarkupSurface
      url={url}
      size={size}
      initialMarks={initial.marks}
      initialRotation={initial.rotation}
      onChange={(marks, rotation) => setMarkup({ marks, rotation })}
      status={
        autosave.state === "saving" || autosave.state === "pending"
          ? " · saving…"
          : autosave.state === "saved"
            ? " · saved"
            : autosave.state === "error"
              ? " · not saved"
              : ""
      }
      onDone={() => {
        void autosave.flush();
        onDone();
      }}
      footer={
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
      }
    />
  );
}

/**
 * The drawing surface and its tools, reusable (phase 2 of the documents: the same tools mark up a
 * picture uploaded into a document, whose marks live on the document's ImageRef instead of a
 * ticket photo row). It owns the marks and the rotation (one undo history, selection, zoom) and
 * reports every change through onChange; Done hands back the final marks and rotation. Nothing
 * here saves.
 *
 * Rotation: `size` is the picture's own (natural) size, W × H; the view, the zoom and the SVG's
 * viewBox are in the turned box RW × RH (rotatedBox), the picture and the marks sit in one group
 * turned by rotationTransform, and a pointer in the turned view is mapped back into the picture
 * (unrotatePoint) before it draws, moves or hit-tests — so a new mark lands where the finger is
 * and is stored, like every other, in the picture's own space.
 */
export function PhotoMarkupSurface({
  url,
  size,
  initialMarks,
  initialRotation = 0,
  rotatable = true,
  onChange,
  onDone,
  status,
  footer,
}: {
  url: string;
  /** The picture's natural size (unturned). */
  size: { w: number; h: number };
  initialMarks: PhotoMark[];
  initialRotation?: Rotation | undefined;
  /** Rotate left / right offered (a document's uploaded picture keeps no rotation: false). */
  rotatable?: boolean | undefined;
  onChange?: ((marks: PhotoMark[], rotation: Rotation) => void) | undefined;
  onDone: (marks: PhotoMark[], rotation: Rotation) => void;
  /** " · saving…" and the like, after the marks summary. */
  status?: string | undefined;
  /** Extra buttons beside Done (the ticket version's Download). */
  footer?: React.ReactNode;
}) {
  const { w: W, h: H } = size;
  const [history, dispatch] = useReducer(
    photoMarksReducer,
    { marks: initialMarks, rotation: initialRotation },
    (i) => emptyPhotoHistory(i.marks, i.rotation),
  );
  const { rotation } = history;
  const { w: RW, h: RH } = rotatedBox(W, H, rotation);
  // The last pen (tool and colour) is this device's (owner, Oct 28: mark up as you shoot — the
  // next shot opens with the same pen); Move is not a pen and is not remembered.
  const [tool, setTool] = useState<Tool>(() => readMarkupMemory(deviceStorage()).tool);
  const [color, setColor] = useState<PhotoColor>(() => readMarkupMemory(deviceStorage()).color);
  useEffect(() => {
    if (tool !== "move") writeMarkupMemory(deviceStorage(), { tool, color });
  }, [tool, color]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<PhotoView>(() => fullView(RW, RH));
  // A turn (or its undo) shows the whole turned picture again: the view is in the turned box.
  const viewRotation = useRef(rotation);
  useEffect(() => {
    if (viewRotation.current === rotation) return;
    viewRotation.current = rotation;
    setView(fullView(RW, RH));
  }, [rotation, RW, RH]);
  const [draft, setDraft] = useState<{ kind: ShapeKind; a: Pt; b: Pt } | null>(null);
  const [moving, setMoving] = useState<{ id: string; du: number; dv: number } | null>(null);
  // A text / tag being written: `at` is where it was tapped, or null for the middle of the view
  // (the phone's sheet, opened by picking the tool).
  const [pending, setPending] = useState<{ kind: "text" | "tag"; at: Pt | null } | null>(null);
  // "Drag the label where it belongs", after a sheet-placed label, until the next touch or tool.
  const [hint, setHint] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  // A phone (a finger): the sheet for Text / Tag, finger-sized handles, labels one size up.
  const coarse = useMemo(() => coarsePointer(), []);
  const textScale = textScaleFor(coarse);
  const handle = handleSizes(coarse);
  const svg = useRef<SVGSVGElement>(null);
  // The sheet's text box: focused as the sheet opens, so the keyboard comes up with it.
  const labelInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<
    | { type: "draw"; kind: ShapeKind; a: Pt }
    | { type: "move"; id: string; from: Pt }
    | { type: "pan"; sx: number; sy: number; view: PhotoView; k: number }
    | null
  >(null);

  // Every change goes up (the ticket version autosaves it; the document keeps it on the ImageRef).
  const report = useRef(onChange);
  report.current = onChange;
  useEffect(() => {
    report.current?.(history.marks, history.rotation);
  }, [history.marks, history.rotation]);

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
  /** The pointer in the picture's own px: through the viewBox (turned box), then turned back. */
  const toImg = (e: React.PointerEvent): Pt => {
    const [vx, vy] = screenToView(box(), { width: view.w, height: view.h }, e.clientX, e.clientY);
    const inView: Pt = [
      Math.min(RW, Math.max(0, view.x + vx)),
      Math.min(RH, Math.max(0, view.y + vy)),
    ];
    return unrotatePoint(inView, W, H, rotation);
  };
  const norm = (p: Pt) => toNorm(p, W, H);

  /** Start dragging a mark (a press on it with Move, or on its grip handle). */
  const grab = (e: React.PointerEvent, id: string) => {
    svg.current?.setPointerCapture(e.pointerId);
    setSelected(id);
    gesture.current = { type: "move", id, from: toImg(e) };
    setMoving({ id, du: 0, dv: 0 });
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || gesture.current) return;
    e.preventDefault();
    setHint(null);
    const p = toImg(e);
    if (tool === "text" || tool === "tag") {
      setPending({ kind: tool, at: norm(p) });
      return;
    }
    if (tool === "move") {
      // A finger may miss the outline by half a handle (markup-touch.ts), a mouse by 8 px.
      const touch = e.pointerType === "touch" || coarse;
      const hit = hitTest(history.marks, p, W, H, (touch ? grabTolerance(true) : 8) * perScreen());
      if (hit) {
        grab(e, hit);
      } else {
        svg.current?.setPointerCapture(e.pointerId);
        setSelected(null);
        gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, view, k: perScreen() };
      }
      return;
    }
    svg.current?.setPointerCapture(e.pointerId);
    gesture.current = { type: "draw", kind: tool, a: norm(p) };
    setDraft({ kind: tool, a: norm(p), b: norm(p) });
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pan") {
      setView(panPhotoView(g.view, RW, RH, (e.clientX - g.sx) * g.k, (e.clientY - g.sy) * g.k));
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

  const zoom = viewZoom(view, RW);
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
    setHint(null);
    if (t !== "move") setSelected(null);
    // A phone does not wait for a tap: Text / Tag open the sheet at once, for the middle of the view.
    setPending((t === "text" || t === "tag") && coarse ? { kind: t, at: null } : null);
  };
  /** The written text / tag goes on the picture: where it was tapped, or the middle of the view. */
  const place = (f: { label: string; note: string }) => {
    if (!pending) return;
    const fromSheet = pending.at === null;
    const at = pending.at ?? norm(unrotatePoint(centreOfView(view), W, H, rotation));
    const id = newMarkId();
    const base = { id, color, at };
    dispatch({
      type: "add",
      mark:
        pending.kind === "tag"
          ? { ...base, kind: "tag", label: f.label, note: f.note }
          : { ...base, kind: "text", text: f.label },
    });
    rememberLabel(deviceStorage(), pending.kind, f.label);
    setPending(null);
    if (fromSheet) {
      // Selected under the Move tool, so a finger drags it into place at once.
      setTool("move");
      setSelected(id);
      setHint("Drag the label where it belongs");
    }
  };
  const recent = pending ? readRecentLabels(deviceStorage(), pending.kind) : [];
  const current = PHOTO_COLORS.find((c) => c.id === color) ?? PHOTO_COLORS[0]!;
  const selectedMark = selected ? shown.find((m) => m.id === selected) : undefined;
  const handles = selectedMark ? handlePlaces(selectedMark, W, H, rotation, view, textScale) : null;
  const selectedText = selectedMark
    ? (markRows([selectedMark])[0]?.text ?? markKindLabel(selectedMark.kind))
    : "";
  const instructions =
    tool === "move"
      ? "Drag a mark to move it; tap one to select it. Drag the picture to pan when zoomed in."
      : tool === "text" || tool === "tag"
        ? coarse
          ? `Tap ${tool === "tag" ? "Tag" : "Text"} above to write one, or tap the picture where it goes.`
          : "Tap where it goes."
        : tool === "arrow"
          ? "Drag from the tail to the tip."
          : "Drag across the problem, or tap for a quick one.";
  return (
    <div className="space-y-3">
      {/* Row 1: the tools (icons only on a phone), a divider, the colour, Undo and Clear. */}
      <div data-row="tools" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Tool">
          {TOOLS.map((t) => (
            <Button
              key={t.id}
              type="button"
              size="sm"
              variant={tool === t.id ? "default" : "outline"}
              aria-pressed={tool === t.id}
              aria-label={t.label}
              title={t.label}
              className="h-10 w-10 px-0 sm:w-auto sm:px-3"
              onClick={() => pick(t.id)}
            >
              <t.icon className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">{t.label}</span>
            </Button>
          ))}
        </div>
        <span
          aria-hidden
          data-divider
          className="h-7 border-l border-border dark:border-neutral-700"
        />
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Colour: ${current.label}`}
              title={`Colour: ${current.label} — tap to change`}
              data-colour={color}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 bg-background hover:border-foreground dark:bg-neutral-900"
            >
              <span
                className="h-6 w-6 rounded-full border border-black/40"
                style={{ background: current.hex }}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-2 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="flex gap-2" role="group" aria-label="Colour">
              {PHOTO_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={color === c.id}
                  className={`h-11 w-11 rounded-full border-2 ${color === c.id ? "border-foreground ring-2 ring-ring ring-offset-2 ring-offset-background" : "border-muted-foreground/40"}`}
                  style={{ background: c.hex }}
                  onClick={() => {
                    setColor(c.id as PhotoColor);
                    setColorOpen(false);
                  }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 w-10 px-0 sm:w-auto sm:px-3"
            aria-label="Undo"
            title="Undo the last change (a mark, a move, a turn)"
            disabled={!history.past.length}
            onClick={() => dispatch({ type: "undo" })}
          >
            <Undo2 className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Undo</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 w-10 px-0 sm:w-auto sm:px-3"
            aria-label="Clear"
            title="Clear every mark (Undo brings them back)"
            disabled={!history.marks.length}
            onClick={() => {
              if (window.confirm("Clear every mark on this photo? (Undo brings them back.)"))
                dispatch({ type: "clear" });
            }}
          >
            <Eraser className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </div>

      <div className="max-h-[min(65vh,640px)] overflow-hidden rounded-md border bg-neutral-900">
        {/* The handles sit over the picture in css px (a finger's size), placed in % of the view. */}
        <div
          className="relative mx-auto max-h-full"
          style={{
            aspectRatio: `${RW} / ${RH}`,
            maxWidth: `min(100%, calc((min(65vh, 640px) - 2px) * ${RW / RH}))`,
          }}
        >
          <svg
            ref={svg}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            className="block h-auto max-h-full w-full touch-none select-none"
            style={{ cursor, aspectRatio: `${RW} / ${RH}` }}
            role="img"
            aria-label="The photo, to mark up"
            data-rotation={rotation}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {/* The picture and its marks turn as one; the marks keep the picture's own px. */}
            <g transform={rotationTransform(W, H, rotation) || undefined}>
              <image href={url} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
              <MarkShapes marks={shown} w={W} h={H} selected={selected} textScale={textScale} />
            </g>
          </svg>
          {selectedMark && handles?.shown && (
            <>
              <button
                type="button"
                data-handle="grip"
                aria-label={`Drag to move ${selectedText}`}
                title="Drag to move it"
                className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full bg-transparent active:cursor-grabbing"
                style={{
                  left: `${handles.grip.left}%`,
                  top: `${handles.grip.top}%`,
                  width: handle.hit,
                  height: handle.hit,
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || gesture.current) return;
                  e.preventDefault();
                  setHint(null);
                  grab(e, selectedMark.id);
                }}
              >
                <span
                  className="flex items-center justify-center rounded-full border-2 border-white bg-black/70 text-white shadow"
                  style={{ width: handle.drawn, height: handle.drawn }}
                >
                  <GripHorizontal className="h-3 w-3" aria-hidden />
                </span>
              </button>
              <button
                type="button"
                data-handle="remove"
                aria-label={`Remove ${selectedText}`}
                title="Remove this mark (Undo brings it back)"
                className="absolute flex -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full bg-transparent"
                style={{
                  left: `${handles.remove.left}%`,
                  top: `${handles.remove.top}%`,
                  width: handle.hit,
                  height: handle.hit,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => dispatch({ type: "remove", id: selectedMark.id })}
              >
                <span
                  className="flex items-center justify-center rounded-full border-2 border-white bg-red-600 text-white shadow"
                  style={{ width: handle.drawn, height: handle.drawn }}
                >
                  <X className="h-3 w-3" aria-hidden />
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Row 2, under the picture: Zoom in / out / Fit, then Rotate left / right. */}
      <div data-row="view" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom >= 5.99}
          onClick={() => setView(zoomPhotoView(view, RW, RH, 2))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom <= 1.001}
          onClick={() => setView(zoomPhotoView(view, RW, RH, 0.5))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 px-3 sm:h-10"
          title="The whole photo"
          disabled={zoom <= 1.001}
          onClick={() => setView(fullView(RW, RH))}
        >
          <Scan className="mr-1 h-4 w-4" /> Fit
        </Button>
        {rotatable && (
          // 44 px on a phone (a thumb), 40 px from sm up, like the zoom beside it.
          <div className="flex gap-1.5 sm:gap-2" role="group" aria-label="Rotate">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 w-11 sm:h-10 sm:w-10"
              aria-label="Rotate left"
              title="Turn the picture a quarter to the left (its marks turn with it; Undo turns it back)"
              onClick={() => dispatch({ type: "rotate", by: -1 })}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 w-11 sm:h-10 sm:w-10"
              aria-label="Rotate right"
              title="Turn the picture a quarter to the right (its marks turn with it; Undo turns it back)"
              onClick={() => dispatch({ type: "rotate", by: 1 })}
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
        )}
        {status?.trim() && (
          <span className="ml-auto text-xs text-muted-foreground" role="status">
            {status.replace(/^\s*·\s*/, "")}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-line={hint ? "hint" : "how"}>
        {hint ?? instructions}
      </p>

      {pending && coarse ? (
        // A phone: the bottom sheet, the keyboard with it; Done puts the label mid-view.
        <Sheet open onOpenChange={(o) => !o && setPending(null)}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] overflow-y-auto rounded-t-xl pb-[max(1.5rem,env(safe-area-inset-bottom))] dark:border-neutral-700"
            data-sheet="place-label"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              labelInput.current?.focus();
            }}
          >
            <SheetHeader className="text-left">
              <SheetTitle>{pending.kind === "tag" ? "New tag" : "New text"}</SheetTitle>
              <SheetDescription>
                {pending.at
                  ? "It goes where you tapped."
                  : "It lands in the middle of the picture; drag it where it belongs after."}
              </SheetDescription>
            </SheetHeader>
            <PlaceForm
              kind={pending.kind}
              recent={recent}
              submitLabel="Done"
              inputRef={labelInput}
              onCancel={() => setPending(null)}
              onAdd={place}
            />
          </SheetContent>
        </Sheet>
      ) : pending ? (
        <PlaceForm
          kind={pending.kind}
          recent={recent}
          framed
          autoFocus
          onCancel={() => setPending(null)}
          onAdd={place}
        />
      ) : null}

      <MarkList
        marks={history.marks}
        selected={selected}
        onSelect={(id) => {
          setTool("move");
          setSelected(id);
        }}
        onRemove={(id) => dispatch({ type: "remove", id })}
      />

      {/* Done (and the caller's buttons) a thumb away: pinned to the dialog's bottom as it scrolls. */}
      <div
        data-row="done"
        className="sticky bottom-0 z-10 -mx-3 grid grid-cols-1 gap-2 border-t bg-card px-3 py-2 sm:-mx-6 sm:flex sm:flex-wrap sm:items-center sm:px-6 sm:py-3 dark:border-neutral-700"
      >
        <Button
          type="button"
          className="h-11 sm:h-9"
          onClick={() => onDone(history.marks, history.rotation)}
        >
          Done
        </Button>
        {footer}
      </div>
    </div>
  );
}

/**
 * A text mark's words, or a tag's label (preset chips or free text) and note; the last labels
 * used on this device as chips. Inline under the picture on a computer (`framed`), inside the
 * bottom sheet on a phone (the sheet focuses `inputRef` as it opens, so the keyboard comes up).
 */
function PlaceForm({
  kind,
  recent,
  submitLabel,
  framed = false,
  autoFocus = false,
  inputRef,
  onAdd,
  onCancel,
}: {
  kind: "text" | "tag";
  /** The last labels of this kind on this device, newest first (lib/markup-memory.ts). */
  recent: readonly string[];
  submitLabel?: string | undefined;
  framed?: boolean | undefined;
  autoFocus?: boolean | undefined;
  inputRef?: React.RefObject<HTMLInputElement | null> | undefined;
  onAdd: (f: { label: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const ok = label.trim().length > 0;
  const presets: readonly string[] = kind === "tag" ? TAG_PRESETS : [];
  const recents = recent.filter((r) => !presets.includes(r));
  const chip = (t: string) => (
    <Button
      key={t}
      type="button"
      size="sm"
      variant={label === t ? "default" : "outline"}
      className="h-9 sm:h-8"
      onClick={() => setLabel(t)}
    >
      {t}
    </Button>
  );
  return (
    <form
      className={cn("space-y-2", framed && "rounded-md border bg-muted/30 p-3")}
      data-form="place-label"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onAdd({ label: label.trim(), note: note.trim() });
      }}
    >
      {framed && (
        <p className="text-sm font-medium">{kind === "tag" ? "New tag here" : "Text here"}</p>
      )}
      <div className="space-y-1">
        <Label htmlFor="photo-mark-label" className="text-xs">
          {kind === "tag" ? "Label" : "Text"}
        </Label>
        <Input
          id="photo-mark-label"
          ref={inputRef}
          autoFocus={autoFocus}
          className="h-11 text-base sm:h-10"
          maxLength={kind === "tag" ? TAG_LABEL_MAX : TEXT_MAX}
          value={label}
          placeholder={kind === "tag" ? "e.g. Open seam" : "e.g. Leak here"}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      {presets.length > 0 && <div className="flex flex-wrap gap-1">{presets.map(chip)}</div>}
      {recents.length > 0 && (
        <div className="space-y-1" data-chips="recent">
          <p className="text-xs text-muted-foreground">Recent</p>
          <div className="flex flex-wrap gap-1">{recents.map(chip)}</div>
        </div>
      )}
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
        <Button type="submit" size="sm" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={!ok}>
          {submitLabel ?? (kind === "tag" ? "Add tag" : "Add text")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-11 sm:h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
