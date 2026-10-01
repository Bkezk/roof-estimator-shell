/**
 * The ticket's Aerial section (owner, Sep 30), on the office ticket page and the tech's
 * close-out: the property on our own aerial imagery (Kentucky's KyFromAbove, Tennessee's TDOT)
 * with its building outline and the outline's area ("footprint" — not a roof measurement), and
 * the tech's markup on top: measured areas, tags (a numbered pin with a label and a note) and
 * text, in a small fixed set of colours, with Undo and Clear. Pointer events, so a finger and a
 * mouse both draw.
 *
 * Owner, Oct 1: the takeoff's area drawer replaced Draw and Line — the Area tool
 * (src/lib/aerial-area.ts): tap corners, or hold and drag a rectangle; sides snap square to the
 * previous side or level / plumb within 7°; the target marker shows the live end; tap the first
 * corner, double-tap / double-click, right-click or Enter closes; Esc cancels. Each area shows
 * its sq ft (the imagery's Web Mercator scale at the view's zoom and latitude) and the section
 * lists them with a total. Saved freehand / line marks from before still draw. A new corner
 * within 8 screen px of an existing area's corner or side links onto it (whatever the Snap
 * toggle), so adjoining sections share corners and edges. Under the Areas list, the Tags and the
 * Text marks are listed too; clicking a row pulses that mark on the picture.
 *
 * "Save markup" stores a PNG of the picture (imagery + outline + marks + the legend) on
 * the ticket as its aerial photo and the vector JSON beside it; re-opening the section loads the
 * last saved markup for editing. No auto-save. Nothing here creates repairs or bids.
 *
 * Geometry and the PNG painter are pure (src/lib/aerial-geo.ts, src/lib/aerial-markup.ts); the
 * server side is src/lib/service-aerial.functions.ts.
 */
import { Suspense, lazy, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  Eraser,
  Hand,
  Loader2,
  Magnet,
  Map as MapIcon,
  MapPin,
  Pentagon,
  Save,
  Scan,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import type { ServiceJobRow } from "@/lib/service.functions";
import { listJobPhotos } from "@/lib/service-field.functions";
import {
  aerialBuildingAt,
  getTicketAerial,
  saveTicketAerial,
  type FoundBuilding,
  type TicketAerial,
} from "@/lib/service-aerial.functions";
import {
  VIEW_H,
  VIEW_W,
  clampZoom,
  footprintAreaSqFt,
  footprintLabel,
  footprintPolygons,
  imageryFor,
  viewAreaSqFt,
  panView,
  project,
  tilesForView,
  unproject,
  viewFor,
  type AerialView,
  type ImagerySource,
  type LngLat,
} from "@/lib/aerial-geo";
import {
  AREA_FILL_ALPHA,
  MARKUP_COLORS,
  TAG_LABEL_MAX,
  TAG_NOTE_MAX,
  TAG_PRESETS,
  TEXT_MAX,
  areaCornersLngLat,
  areaLinkPolys,
  areaMarkSqFt,
  areaRows,
  colorFill,
  colorHex,
  emptyHistory,
  legendHeight,
  markupReducer,
  markupSummary,
  newAnnotationId,
  paintOverlay,
  pathD,
  serializeMarkup,
  tagNumbers,
  tagRows,
  textRows,
  type AerialBuilding,
  type AerialMarkup,
  type Annotation,
  type MarkupAction,
  type MarkupColor,
} from "@/lib/aerial-markup";
import {
  areaLabel,
  drawing,
  emptyAreaDraw,
  labelAt,
  liveEnd,
  liveLinked,
  liveRect,
  stepArea,
  type AreaDraw,
  type AreaLinks,
  type AreaDrawAction,
  type Pt,
} from "@/lib/aerial-area";
import { isTypingTarget } from "@/components/takeoff/shapes";
import { TargetMarker } from "@/components/takeoff/overlay";
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
import { Box, PhotoThumb } from "@/components/service/field-shared";
import {
  errText,
  fieldKeys,
  loudError,
  removeFromServiceBucket,
  uploadToServiceBucket,
  whenShort,
} from "@/components/service/field-utils";

const ProspectMap = lazy(() => import("@/components/prospect-map"));

const aerialKey = (jobId: string) => ["service-aerial", jobId] as const;

/** Owner, Oct 1: Area replaced Draw and Line (old free / line marks still draw). */
type Tool = "move" | "area" | "pin" | "text";
const TOOLS: { id: Tool; label: string; icon: typeof Hand }[] = [
  { id: "move", label: "Move", icon: Hand },
  { id: "area", label: "Area", icon: Pentagon },
  { id: "pin", label: "Tag", icon: MapPin },
  { id: "text", label: "Text", icon: Type },
];

/** The Aerial section; shown when the ticket has an address (its own or its site's). */
export function AerialSection({ job, canEdit }: { job: ServiceJobRow; canEdit: boolean }) {
  const { session } = useAuth();
  const photosFn = useServerFn(listJobPhotos);
  // The same query (and key) the ticket's photo sections read: the header needs no lookup.
  const photos = useQuery({
    queryKey: fieldKeys.photos(job.id),
    queryFn: () => photosFn({ data: { id: job.id } }),
    enabled: !!session,
  });
  if (!(job.site_address ?? "").trim() && !job.site_id) return null;
  const saved = (photos.data ?? [])
    .filter((p) => p.role === "aerial")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return (
    <Box
      title="Aerial"
      icon={MapIcon}
      collapsible
      defaultOpen={false}
      storageKey="aerial"
      summary={saved ? `markup saved ${whenShort(saved.created_at)}` : "the property from above"}
    >
      <AerialBody job={job} canEdit={canEdit} />
    </Box>
  );
}

function AerialBody({ job, canEdit }: { job: ServiceJobRow; canEdit: boolean }) {
  const { session } = useAuth();
  const getFn = useServerFn(getTicketAerial);
  const q = useQuery({
    queryKey: aerialKey(job.id),
    queryFn: () => getFn({ data: { id: job.id } }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  if (q.error)
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">Could not load the aerial: {errText(q.error)}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!q.data)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Finding the property…
      </p>
    );
  return (
    <AerialEditor key={q.data.saved?.photo.id ?? "new"} job={job} data={q.data} canEdit={canEdit} />
  );
}

const buildingOf = (f: FoundBuilding | null): AerialBuilding | null =>
  f ? { id: f.id, footprint: f.footprint, address: f.address, state: f.state, how: f.how } : null;

function initialView(data: TicketAerial): AerialView | null {
  if (data.saved) {
    const m = data.saved.markup;
    return { center: m.center, zoom: m.zoom, width: VIEW_W, height: VIEW_H };
  }
  if (data.found)
    return viewFor(footprintPolygons(data.found.footprint), [data.found.lng, data.found.lat]);
  return null;
}

function AerialEditor({
  job,
  data,
  canEdit,
}: {
  job: ServiceJobRow;
  data: TicketAerial;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTicketAerial);
  const pickFn = useServerFn(aerialBuildingAt);
  const [building, setBuilding] = useState<AerialBuilding | null>(
    () => data.saved?.markup.building ?? buildingOf(data.found),
  );
  const [view, setViewRaw] = useState<AerialView | null>(() => initialView(data));
  const [history, dispatchRaw] = useReducer(
    markupReducer,
    data.saved?.markup.annotations ?? [],
    emptyHistory,
  );
  const [dirty, setDirty] = useState(false);
  const dispatch = (a: MarkupAction) => {
    dispatchRaw(a);
    setDirty(true);
  };
  const [tool, setTool] = useState<Tool>(canEdit ? "area" : "move");
  const [color, setColor] = useState<MarkupColor>("red");
  // The area in progress (view px). A ref mirrors it so pointer events that arrive before a
  // re-render (a move then a release) step from the latest shape.
  const [areaDraw, setAreaDrawState] = useState<AreaDraw>(emptyAreaDraw);
  const areaRef = useRef<AreaDraw>(areaDraw);
  const setAreaDraw = (d: AreaDraw) => {
    areaRef.current = d;
    setAreaDrawState(d);
  };
  /** One input to the Area tool; a closed shape becomes an area mark. */
  const areaInput = (a: AreaDrawAction) => {
    const r = stepArea(areaRef.current, a);
    setAreaDraw(r.draw);
    if (r.hint) toast.info(r.hint);
    if (r.done && view)
      dispatch({
        type: "add",
        annotation: {
          id: newAnnotationId(),
          kind: "area",
          color,
          // A corner linked to a saved area's corner keeps that corner's exact lng/lat.
          points: areaCornersLngLat(view, r.done, history.annotations),
        },
      });
  };
  /** A new view; an area in progress is carried onto it (its corners stay on the roof). */
  const setView = (v: AerialView) => {
    if (view && drawing(areaRef.current)) {
      const from = view;
      areaInput({ type: "remap", f: ([x, y]) => project(v, unproject(from, x, y)) });
    }
    setViewRaw(v);
  };
  const [pending, setPending] = useState<{ kind: "pin" | "text"; at: LngLat } | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  // A tag / text row clicked in the lists under the picture: that mark pulses for FLASH_MS.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  /** Show where a mark is: bring the picture on screen (and the mark into it), pulse it. */
  const showMark = (m: { id: string; at: LngLat }) => {
    if (view) {
      const [x, y] = project(view, m.at);
      if (x < 0 || y < 0 || x > view.width || y > view.height) setView({ ...view, center: m.at });
    }
    stageBox.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(m.id);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };

  // Esc cancels the area in progress; Enter closes it (as the takeoff). Keys in a text field
  // (the tag form) are left alone.
  const areaKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  areaKeys.current = (e: KeyboardEvent) => {
    if (tool !== "area" || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" && drawing(areaRef.current)) {
      e.preventDefault();
      areaInput({ type: "cancel" });
    } else if (e.key === "Enter" && areaRef.current.points.length > 0) {
      e.preventDefault();
      areaInput({ type: "close" });
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => areaKeys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const polys = useMemo(() => footprintPolygons(building?.footprint ?? null), [building]);
  const area = useMemo(() => footprintAreaSqFt(polys), [polys]);
  const imagery = view
    ? imageryFor({
        buildingState: building?.state,
        addressState: data.addressState,
        at: view.center,
      })
    : null;

  const pick = useMutation({
    mutationFn: (p: { lat: number; lng: number }) => pickFn({ data: p }),
    onSuccess: (f) => {
      setBuilding(buildingOf(f));
      setView(viewFor(footprintPolygons(f.footprint), [f.lng, f.lat]));
      setDirty(true);
      setPickOpen(false);
      toast.success(
        f.areaSqFt ? `Building picked · ${footprintLabel(f.areaSqFt)}` : "Building picked",
      );
    },
    onError: (e) => toast.error(`Could not pick that building: ${errText(e)}`),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!view || !imagery) throw new Error("No aerial to save");
      const markup = serializeMarkup({
        v: 1,
        center: view.center,
        zoom: view.zoom,
        building,
        annotations: history.annotations,
      });
      const blob = await renderAerialPng(view, imagery.sources, markup, data.address);
      const path = `${job.id}/aerial-${Date.now()}.png`;
      await uploadToServiceBucket(path, blob, "image/png");
      try {
        return await saveFn({
          data: { service_job_id: job.id, storage_path: path, file_size: blob.size, markup },
        });
      } catch (e) {
        await removeFromServiceBucket(path);
        throw e;
      }
    },
    onSuccess: () => {
      setDirty(false);
      toast.success("Markup saved to the ticket");
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(job.id) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(job.id) });
      void qc.invalidateQueries({ queryKey: aerialKey(job.id) });
    },
    onError: (e) => loudError("Could not save the markup", e),
  });

  const pickDialog = (
    <Dialog open={pickOpen} onOpenChange={(o) => !pick.isPending && setPickOpen(o)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pick the building</DialogTitle>
          <DialogDescription>
            Zoom in until the building outlines show, then tap inside the roof.
          </DialogDescription>
        </DialogHeader>
        {pickOpen && (
          <Suspense
            fallback={
              <p className="flex h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the map…
              </p>
            }
          >
            <ProspectMap
              buildings={[]}
              selectedId={null}
              onSelect={() => {}}
              onTapEmpty={(lng, lat) => {
                if (!pick.isPending) pick.mutate({ lat, lng });
              }}
              focus={view ? { lat: view.center[1], lng: view.center[0] } : null}
              fitTo={view ? undefined : data.addressState}
              className="h-[60vh] w-full rounded-md border"
            />
          </Suspense>
        )}
        {pick.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the outline…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );

  if (!view || !imagery)
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">No aerial for this address</p>
        <p className="text-muted-foreground">
          {data.address ? `${data.address}. ` : ""}
          {data.note ?? "Nothing in our map data matches it."}
        </p>
        <Button type="button" variant="outline" onClick={() => setPickOpen(true)}>
          <Building2 className="mr-2 h-4 w-4" /> Pick the building on the map
        </Button>
        {pickDialog}
      </div>
    );

  const tags = tagRows(history.annotations);
  const texts = textRows(history.annotations);
  const areas = areaRows(history.annotations, view.zoom);
  const how =
    building?.how === "picked"
      ? "picked on the map"
      : building?.how === "photo_gps"
        ? "where the ticket's photos were taken"
        : building?.how === "address"
          ? "matched to the address"
          : null;

  return (
    <div className="space-y-3">
      {data.note && !data.saved && <p className="text-xs text-muted-foreground">{data.note}</p>}
      {canEdit && (
        <Toolbar
          tool={tool}
          onTool={(t) => {
            setTool(t);
            setPending(null);
            areaInput({ type: "cancel" });
          }}
          snap={areaDraw.snap}
          onSnap={(on) => areaInput({ type: "snap", on })}
          color={color}
          onColor={setColor}
          canUndo={history.past.length > 0 || areaDraw.points.length > 0}
          onUndo={() =>
            // A corner of the area in progress first, then the marks.
            areaRef.current.points.length > 0
              ? areaInput({ type: "undo" })
              : dispatch({ type: "undo" })
          }
          canClear={history.annotations.length > 0 || drawing(areaDraw)}
          onClear={() => {
            if (!history.annotations.length) {
              areaInput({ type: "cancel" });
              return;
            }
            if (window.confirm("Clear every mark and tag? (Undo brings them back.)")) {
              areaInput({ type: "cancel" });
              dispatch({ type: "clear" });
            }
          }}
        />
      )}
      {canEdit && tool === "area" && (
        <p className="text-xs text-muted-foreground">
          Tap each corner, or hold and drag for a rectangle. Tap the first corner, double-tap or
          right-click to finish · Esc cancels.
        </p>
      )}
      <div ref={stageBox}>
        <Stage
          view={view}
          sources={imagery.sources}
          annotations={history.annotations}
          tool={canEdit ? tool : "move"}
          color={color}
          areaDraw={areaDraw}
          onArea={areaInput}
          onView={setView}
          onPlace={(kind, at) => setPending({ kind, at })}
          flash={flash}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Zoom out"
          disabled={clampZoom(view.zoom - 1) === view.zoom}
          onClick={() => setView({ ...view, zoom: clampZoom(view.zoom - 1) })}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Zoom in"
          disabled={clampZoom(view.zoom + 1) === view.zoom}
          onClick={() => setView({ ...view, zoom: clampZoom(view.zoom + 1) })}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        {polys.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Fit the building"
            onClick={() => setView(viewFor(polys, view.center))}
          >
            <Scan className="mr-1 h-4 w-4" /> Fit
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={() => setPickOpen(true)}>
          <Building2 className="mr-1 h-4 w-4" />{" "}
          {building ? "Different building" : "Pick the building"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {imagery.sources.map((s) => s.credit).join(" · ")}
        </span>
      </div>
      <p className="text-sm">
        {area ? (
          <>
            <span className="font-medium">{footprintLabel(area)}</span>{" "}
            <span className="text-muted-foreground">
              (the outline seen from above — not a roof measurement)
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">No building outline on this picture.</span>
        )}
        {how && <span className="text-muted-foreground"> · Building {how}.</span>}
      </p>

      {areas.rows.length > 0 && (
        <div className="space-y-1 text-sm">
          <ol className="space-y-1" aria-label="Areas">
            {areas.rows.map((r) => (
              <li key={r.mark.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <span
                  className="h-4 w-4 shrink-0 rounded-sm border-2"
                  style={{
                    borderColor: colorHex(r.mark.color),
                    background: colorFill(r.mark.color, AREA_FILL_ALPHA),
                  }}
                />
                <span className="flex-1 font-medium">Area {r.n}</span>
                <span className="tabular-nums">{areaLabel(r.sqft)}</span>
                {canEdit && (
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-muted"
                    aria-label={`Remove area ${r.n}`}
                    onClick={() => dispatch({ type: "remove", id: r.mark.id })}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ol>
          <p className={`flex items-center gap-2 px-2 font-medium ${canEdit ? "pr-11" : ""}`}>
            <span className="flex-1">Total</span>
            <span className="tabular-nums">{areaLabel(areas.total)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Measured on the aerial: flat, as seen from above (no pitch).
          </p>
        </div>
      )}

      {pending && canEdit && (
        <PlaceForm
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onAdd={(fields) => {
            const base = { id: newAnnotationId(), color, at: pending.at };
            dispatch({
              type: "add",
              annotation:
                pending.kind === "pin"
                  ? { ...base, kind: "pin", label: fields.label, note: fields.note }
                  : { ...base, kind: "text", text: fields.label },
            });
            setPending(null);
          }}
        />
      )}

      {tags.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Tags</p>
          <ol className="space-y-1" aria-label="Tags">
            {tags.map((r) => (
              <li key={r.mark.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  title="Show it on the picture"
                  onClick={() => showMark(r.mark)}
                >
                  <MarkDot color={r.mark.color} />
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-medium">
                      {r.n}. {r.mark.label}
                    </span>
                    {r.mark.note && <span className="text-muted-foreground"> — {r.mark.note}</span>}
                  </span>
                </button>
                {canEdit && (
                  <RemoveButton
                    label={`Remove tag ${r.n}`}
                    onClick={() => dispatch({ type: "remove", id: r.mark.id })}
                  />
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {texts.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Text</p>
          <ul className="space-y-1" aria-label="Text">
            {texts.map((r) => (
              <li key={r.mark.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  title="Show it on the picture"
                  onClick={() => showMark(r.mark)}
                >
                  <MarkDot color={r.mark.color} />
                  <span className="min-w-0 flex-1 break-words">{r.text}</span>
                </button>
                {canEdit && (
                  <RemoveButton
                    label={`Remove text ${r.text}`}
                    onClick={() => dispatch({ type: "remove", id: r.mark.id })}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="h-11"
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save markup
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {markupSummary(history.annotations)}
          {dirty
            ? " · unsaved"
            : data.saved
              ? ` · saved ${whenShort(data.saved.photo.created_at)}`
              : ""}
        </span>
        {data.saved && <PhotoThumb photo={data.saved.photo} size="sm" />}
      </div>
      {pickDialog}
    </div>
  );
}

/** How long a mark pulses after its row is clicked. */
const FLASH_MS = 1500;

/** A mark's colour, as a dot beside its row. */
function MarkDot({ color }: { color: MarkupColor }) {
  return (
    <span
      className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-black/60"
      style={{ background: colorHex(color) }}
    />
  );
}

/** The × on a row of the lists under the picture (through the history: Undo brings it back). */
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-muted"
      aria-label={label}
      onClick={onClick}
    >
      <X className="h-4 w-4" />
    </button>
  );
}

function Toolbar(props: {
  tool: Tool;
  onTool: (t: Tool) => void;
  /** The Area tool's Snap: sides square up within 7° (on) or land as tapped (off). */
  snap: boolean;
  onSnap: (on: boolean) => void;
  color: MarkupColor;
  onColor: (c: MarkupColor) => void;
  canUndo: boolean;
  onUndo: () => void;
  canClear: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Tool">
        {TOOLS.map((t) => (
          <Button
            key={t.id}
            type="button"
            size="sm"
            variant={props.tool === t.id ? "default" : "outline"}
            aria-pressed={props.tool === t.id}
            className="h-10 px-3"
            onClick={() => props.onTool(t.id)}
          >
            <t.icon className="mr-1 h-4 w-4" /> {t.label}
          </Button>
        ))}
        {props.tool === "area" && (
          <Button
            type="button"
            size="sm"
            variant={props.snap ? "default" : "outline"}
            aria-pressed={props.snap}
            className="h-10 px-3"
            title={
              props.snap
                ? "Snap on: sides square up within 7°. Turn off for a building that sits at a slight angle. Corners always link to existing areas."
                : "Snap off: sides keep the angle you tap. Corners always link to existing areas."
            }
            onClick={() => props.onSnap(!props.snap)}
          >
            <Magnet className="mr-1 h-4 w-4" /> Snap {props.snap ? "on" : "off"}
          </Button>
        )}
      </div>
      <div className="flex gap-1" role="group" aria-label="Colour">
        {MARKUP_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.label}
            aria-label={c.label}
            aria-pressed={props.color === c.id}
            className={`h-9 w-9 rounded-full border-2 ${props.color === c.id ? "border-foreground ring-2 ring-ring ring-offset-2" : "border-muted-foreground/40"}`}
            style={{ background: c.hex }}
            onClick={() => props.onColor(c.id)}
          />
        ))}
      </div>
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10"
          disabled={!props.canUndo}
          onClick={props.onUndo}
        >
          <Undo2 className="mr-1 h-4 w-4" /> Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10"
          disabled={!props.canClear}
          onClick={props.onClear}
        >
          <Eraser className="mr-1 h-4 w-4" /> Clear
        </Button>
      </div>
    </div>
  );
}

/** The picture: imagery tiles, the outline and the marks in one SVG that scales to the screen. */
function Stage({
  view,
  sources,
  annotations,
  tool,
  color,
  areaDraw,
  onArea,
  onView,
  onPlace,
  flash,
}: {
  view: AerialView;
  sources: ImagerySource[];
  annotations: Annotation[];
  tool: Tool;
  color: MarkupColor;
  areaDraw: AreaDraw;
  onArea: (a: AreaDrawAction) => void;
  onView: (v: AerialView) => void;
  onPlace: (kind: "pin" | "text", at: LngLat) => void;
  /** The mark to pulse (its row was clicked), or null. */
  flash: string | null;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: AerialView } | null>(null);
  /** The pointer holding an Area press (a second finger is ignored). */
  const areaPointer = useRef<number | null>(null);
  /** Screen px per view px (the SVG is stretched to the screen): on-screen tolerances. */
  const [scale, setScale] = useState(1);
  const [touch, setTouch] = useState(false);
  const tiles = sources.flatMap((s) => tilesForView(view, s));
  const px = (p: LngLat) => project(view, p);
  const numbers = tagNumbers(annotations);
  // What a new area's corners link to: the saved areas' corners on this view.
  const links = useMemo(() => areaLinkPolys(annotations, view), [annotations, view]);
  const flashed = flash ? annotations.find((a) => a.id === flash) : undefined;

  const toView = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    const k = r.width / view.width;
    if (k > 0 && Math.abs(k - scale) > 1e-6) setScale(k);
    return [
      ((e.clientX - r.left) * view.width) / r.width,
      ((e.clientY - r.top) * view.height) / r.height,
    ];
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "area" && e.button === 2) {
      // Right-click: finish the area (the takeoff's "Stop").
      e.preventDefault();
      onArea({ type: "close" });
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    const p = toView(e);
    if (tool === "pin" || tool === "text") {
      onPlace(tool, unproject(view, p[0], p[1]));
      return;
    }
    if (tool === "area") {
      if (areaPointer.current !== null) return;
      areaPointer.current = e.pointerId;
      setTouch(e.pointerType === "touch");
      svg.current?.setPointerCapture(e.pointerId);
      onArea({ type: "down", p, sx: e.clientX, sy: e.clientY });
      return;
    }
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = { x: p[0], y: p[1], view };
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toView(e);
    if (drag.current) {
      const d = drag.current;
      onView(panView(d.view, p[0] - d.x, p[1] - d.y));
      return;
    }
    if (tool !== "area") return;
    if (areaPointer.current !== null && e.pointerId !== areaPointer.current) return;
    if (areaPointer.current === null && e.pointerType === "touch") return;
    onArea({ type: "move", p, sx: e.clientX, sy: e.clientY });
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (areaPointer.current === null || e.pointerId !== areaPointer.current) return;
    areaPointer.current = null;
    if (e.type === "pointercancel") {
      onArea({ type: "lift" });
      return;
    }
    const r = svg.current?.getBoundingClientRect();
    const k = r && r.width > 0 ? r.width / view.width : scale;
    onArea({ type: "up", p: toView(e), scale: k, touch: e.pointerType === "touch", links });
  };

  const cursor = tool === "move" ? "grab" : tool === "text" ? "text" : "crosshair";
  const lineOf = (key: string, pts: [number, number][], c: string) => (
    <g key={key}>
      <path
        d={pathD(pts)}
        fill="none"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={pathD(pts)}
        fill="none"
        stroke={c}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
  const halo = { paintOrder: "stroke" as const, stroke: "rgba(0,0,0,0.85)", strokeWidth: 4 };

  return (
    <div className="overflow-hidden rounded-md border bg-neutral-800">
      <svg
        ref={svg}
        viewBox={`0 0 ${view.width} ${view.height}`}
        className="block h-auto w-full touch-none select-none"
        style={{ cursor }}
        role="img"
        aria-label="Aerial view of the property"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => {
          if (tool === "area" && areaPointer.current === null) onArea({ type: "leave" });
        }}
        onContextMenu={(e) => {
          // Right-click finishes an area: no browser menu over the picture.
          if (tool === "area") e.preventDefault();
        }}
      >
        {tiles.map((t) => (
          <image
            key={t.key}
            href={t.url}
            x={t.left}
            y={t.top}
            width={t.size}
            height={t.size}
            preserveAspectRatio="none"
          />
        ))}
        {annotations.map((a) => {
          if (a.kind !== "area") return null;
          const pts = a.points.map(px);
          const [lx, ly] = labelAt(pts);
          return (
            <g key={a.id}>
              <path
                d={`${pathD(pts)} Z`}
                fill={colorFill(a.color, AREA_FILL_ALPHA)}
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={6}
                strokeLinejoin="round"
              />
              <path
                d={`${pathD(pts)} Z`}
                fill="none"
                stroke={colorHex(a.color)}
                strokeWidth={3}
                strokeLinejoin="round"
              />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={16}
                fontWeight={700}
                fill="#fff"
                style={{ ...halo, pointerEvents: "none" }}
              >
                {areaLabel(areaMarkSqFt(a, view.zoom))}
              </text>
            </g>
          );
        })}
        {annotations
          .filter((a) => a.kind === "free" || a.kind === "line")
          .map((a) =>
            a.kind === "free" || a.kind === "line"
              ? lineOf(a.id, a.points.map(px), colorHex(a.color))
              : null,
          )}
        {annotations.map((a) => {
          if (a.kind !== "text") return null;
          const [x, y] = px(a.at);
          return (
            <text
              key={a.id}
              x={x}
              y={y}
              fill={colorHex(a.color)}
              fontSize={20}
              fontWeight={700}
              dominantBaseline="middle"
              style={halo}
            >
              {a.text}
            </text>
          );
        })}
        {annotations.map((a) => {
          if (a.kind !== "pin") return null;
          const [x, y] = px(a.at);
          const dark = a.color === "white" || a.color === "yellow";
          return (
            <g key={a.id}>
              <circle cx={x} cy={y} r={13} fill={colorHex(a.color)} stroke="#000" strokeWidth={2} />
              <text
                x={x}
                y={y + 0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={14}
                fontWeight={700}
                fill={dark ? "#000" : "#fff"}
              >
                {numbers.get(a.id)}
              </text>
              <text
                x={x + 17}
                y={y}
                dominantBaseline="middle"
                fontSize={16}
                fontWeight={700}
                fill="#fff"
                style={halo}
              >
                {a.label}
              </text>
            </g>
          );
        })}
        {tool === "area" && (
          <AreaDraft
            view={view}
            draw={areaDraw}
            scale={scale}
            touch={touch}
            color={color}
            links={links}
          />
        )}
        {flashed && (flashed.kind === "pin" || flashed.kind === "text") && (
          <FlashRing mark={flashed} at={px(flashed.at)} />
        )}
      </svg>
    </div>
  );
}

/**
 * The area in progress: the drag-a-box rectangle, or the corners so far with the live side to
 * the target marker and the closing side dashed, its sq ft once it has three corners, and a ring
 * on the first corner when the next tap would close it.
 */
function AreaDraft({
  view,
  draw,
  scale,
  touch,
  color,
  links,
}: {
  view: AerialView;
  draw: AreaDraw;
  scale: number;
  touch: boolean;
  color: MarkupColor;
  /** The saved areas (view px) a corner links to. */
  links: AreaLinks;
}) {
  const c = colorHex(color);
  const rect = liveRect(draw, scale, links);
  const end = liveEnd(draw, scale, touch, links);
  // On an existing area's corner or side: a filled ring on the target marker says so.
  const linked = liveLinked(draw, scale, touch, links);
  const k = 1 / scale; // view px for one screen px
  const label = (pts: Pt[]) => {
    const [x, y] = labelAt(pts);
    return (
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={16}
        fontWeight={700}
        fill="#fff"
        style={{
          paintOrder: "stroke",
          stroke: "rgba(0,0,0,0.85)",
          strokeWidth: 4,
          pointerEvents: "none",
        }}
      >
        {areaLabel(viewAreaSqFt(view, pts))}
      </text>
    );
  };
  if (rect)
    return (
      <g style={{ pointerEvents: "none" }}>
        <path
          d={`${pathD(rect)} Z`}
          fill={colorFill(color, AREA_FILL_ALPHA)}
          stroke={c}
          strokeWidth={3}
          strokeDasharray="8 5"
        />
        {label(rect)}
      </g>
    );
  const pts = draw.points;
  const shape = end && !(pts.length > 0 && end === pts[0]) ? [...pts, end] : pts;
  // liveEnd returns the first corner itself when the next tap would close the shape.
  const closes = pts.length >= 3 && end === pts[0];
  return (
    <g style={{ pointerEvents: "none" }}>
      {shape.length >= 3 && (
        <path d={`${pathD(shape)} Z`} fill={colorFill(color, AREA_FILL_ALPHA)} stroke="none" />
      )}
      {shape.length >= 2 && (
        <path
          d={pathD(shape)}
          fill="none"
          stroke={c}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {shape.length >= 3 && (
        <path
          d={pathD([shape[shape.length - 1]!, shape[0]!])}
          fill="none"
          stroke={c}
          strokeWidth={2}
          strokeDasharray="6 5"
        />
      )}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3.5 * k} fill={c} stroke="#000" strokeWidth={1 * k} />
      ))}
      {closes && pts[0] && (
        <circle
          cx={pts[0][0]}
          cy={pts[0][1]}
          r={10 * k}
          fill="none"
          stroke="#fff"
          strokeWidth={2 * k}
        />
      )}
      {shape.length >= 3 && label(shape)}
      {end && linked && (
        <circle
          cx={end[0]}
          cy={end[1]}
          r={5 * k}
          fill={colorFill(color, 0.6)}
          stroke={c}
          strokeWidth={2 * k}
        />
      )}
      {end && <TargetMarker at={end} zoom={scale} color={c} />}
    </g>
  );
}

/**
 * The pulse on a tag or a text mark whose row was clicked (shown for FLASH_MS): a ring that
 * swells around a tag's pin, a blinking box around a text mark's words.
 */
function FlashRing({ mark, at: [x, y] }: { mark: Annotation; at: [number, number] }) {
  const ring = { fill: "none", stroke: "#fff", strokeWidth: 3, pointerEvents: "none" as const };
  if (mark.kind === "text") {
    // The words are bold 20px from (x, y), vertically centred: about 0.62em per character.
    const w = Math.max(24, mark.text.length * 12.4) + 12;
    return (
      <rect x={x - 6} y={y - 16} width={w} height={32} rx={6} style={ring}>
        <animate attributeName="opacity" values="1;0.15;1" dur="0.5s" repeatCount="indefinite" />
      </rect>
    );
  }
  return (
    <circle cx={x} cy={y} r={18} style={ring}>
      <animate attributeName="r" values="16;30;16" dur="0.75s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.3;1" dur="0.75s" repeatCount="indefinite" />
    </circle>
  );
}

/** A tag's label (preset chips or free text) and note, or a text label. */
function PlaceForm({
  kind,
  onAdd,
  onCancel,
}: {
  kind: "pin" | "text";
  onAdd: (f: { label: string; note: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const max = kind === "pin" ? TAG_LABEL_MAX : TEXT_MAX;
  const ok = label.trim().length > 0;
  return (
    <form
      className="space-y-2 rounded-md border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onAdd({ label: label.trim(), note: note.trim() });
      }}
    >
      <p className="text-sm font-medium">{kind === "pin" ? "New tag here" : "Text here"}</p>
      {kind === "pin" && (
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
        <Label htmlFor="aerial-label" className="text-xs">
          {kind === "pin" ? "Label" : "Text"}
        </Label>
        <Input
          id="aerial-label"
          autoFocus
          className="h-10 text-base"
          maxLength={max}
          value={label}
          placeholder={kind === "pin" ? "e.g. Open seam" : ""}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      {kind === "pin" && (
        <div className="space-y-1">
          <Label htmlFor="aerial-note" className="text-xs">
            Note
          </Label>
          <Textarea
            id="aerial-note"
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
          {kind === "pin" ? "Add tag" : "Add text"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          <Trash2 className="mr-1 h-4 w-4" /> Cancel
        </Button>
      </div>
    </form>
  );
}

/** One imagery tile for the canvas, or null when it cannot be loaded (off the cache, offline). */
function loadTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** The saved picture: the imagery, then the outline, marks, caption and the legend. */
async function renderAerialPng(
  view: AerialView,
  sources: ImagerySource[],
  markup: AerialMarkup,
  caption: string,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = view.width;
  canvas.height = view.height + legendHeight(markup.annotations);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the picture");
  ctx.fillStyle = "#262626";
  ctx.fillRect(0, 0, view.width, view.height);
  for (const src of sources) {
    const tiles = tilesForView(view, src);
    const imgs = await Promise.all(tiles.map((t) => loadTile(t.url)));
    tiles.forEach((t, i) => {
      const img = imgs[i];
      if (img) ctx.drawImage(img, t.left, t.top, t.size, t.size);
    });
  }
  paintOverlay(ctx, view, markup, { caption: caption || null });
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The picture could not be made"))),
        "image/png",
      );
    } catch (e) {
      reject(
        new Error(
          `The imagery could not be copied into the picture (${e instanceof Error ? e.message : String(e)})`,
        ),
      );
    }
  });
}
