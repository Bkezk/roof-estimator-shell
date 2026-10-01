/**
 * The ticket's Aerial section (owner, Sep 30), on the office ticket page and the tech's
 * close-out: the property on our own aerial imagery (Kentucky's KyFromAbove, Tennessee's TDOT)
 * with its building outline and the outline's area ("footprint" — not a roof measurement), and
 * the tech's markup on top: freehand, straight lines, tags (a numbered pin with a label and a
 * note) and text, in a small fixed set of colours, with Undo and Clear. Pointer events, so a
 * finger and a mouse both draw.
 *
 * "Save markup" stores a PNG of the picture (imagery + outline + marks + the tags' legend) on
 * the ticket as its aerial photo and the vector JSON beside it; re-opening the section loads the
 * last saved markup for editing. No auto-save. Nothing here creates repairs or bids.
 *
 * Geometry and the PNG painter are pure (src/lib/aerial-geo.ts, src/lib/aerial-markup.ts); the
 * server side is src/lib/service-aerial.functions.ts.
 */
import { Suspense, lazy, useMemo, useReducer, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  Eraser,
  Hand,
  Loader2,
  Map as MapIcon,
  MapPin,
  Pencil,
  Save,
  Scan,
  Slash,
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
  FOOTPRINT_STROKE,
  MARKUP_COLORS,
  TAG_LABEL_MAX,
  TAG_NOTE_MAX,
  TAG_PRESETS,
  TEXT_MAX,
  colorHex,
  emptyHistory,
  legendHeight,
  markupReducer,
  markupSummary,
  newAnnotationId,
  paintOverlay,
  pathD,
  serializeMarkup,
  simplifyStroke,
  tagNumbers,
  type AerialBuilding,
  type AerialMarkup,
  type Annotation,
  type MarkupAction,
  type MarkupColor,
} from "@/lib/aerial-markup";
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

type Tool = "move" | "free" | "line" | "pin" | "text";
const TOOLS: { id: Tool; label: string; icon: typeof Hand }[] = [
  { id: "move", label: "Move", icon: Hand },
  { id: "free", label: "Draw", icon: Pencil },
  { id: "line", label: "Line", icon: Slash },
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
  const [view, setView] = useState<AerialView | null>(() => initialView(data));
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
  const [tool, setTool] = useState<Tool>(canEdit ? "free" : "move");
  const [color, setColor] = useState<MarkupColor>("red");
  const [pending, setPending] = useState<{ kind: "pin" | "text"; at: LngLat } | null>(null);
  const [pickOpen, setPickOpen] = useState(false);

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

  const tags = history.annotations.filter(
    (a): a is Extract<Annotation, { kind: "pin" }> => a.kind === "pin",
  );
  const numbers = tagNumbers(history.annotations);
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
          }}
          color={color}
          onColor={setColor}
          canUndo={history.past.length > 0}
          onUndo={() => dispatch({ type: "undo" })}
          canClear={history.annotations.length > 0}
          onClear={() => {
            if (window.confirm("Clear every mark and tag? (Undo brings them back.)"))
              dispatch({ type: "clear" });
          }}
        />
      )}
      <Stage
        view={view}
        sources={imagery.sources}
        polys={polys}
        annotations={history.annotations}
        tool={canEdit ? tool : "move"}
        color={color}
        onView={setView}
        onAdd={(a) => dispatch({ type: "add", annotation: a })}
        onPlace={(kind, at) => setPending({ kind, at })}
      />
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
        <ol className="space-y-1 text-sm" aria-label="Tags">
          {tags.map((t) => (
            <li key={t.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-black text-[11px] font-bold"
                style={{
                  background: colorHex(t.color),
                  color: t.color === "white" || t.color === "yellow" ? "#000" : "#fff",
                }}
              >
                {numbers.get(t.id)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t.label}</span>
                {t.note && <span className="text-muted-foreground"> — {t.note}</span>}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-muted"
                  aria-label={`Remove tag ${t.label}`}
                  onClick={() => dispatch({ type: "remove", id: t.id })}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ol>
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

function Toolbar(props: {
  tool: Tool;
  onTool: (t: Tool) => void;
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
  polys,
  annotations,
  tool,
  color,
  onView,
  onAdd,
  onPlace,
}: {
  view: AerialView;
  sources: ImagerySource[];
  polys: LngLat[][][];
  annotations: Annotation[];
  tool: Tool;
  color: MarkupColor;
  onView: (v: AerialView) => void;
  onAdd: (a: Annotation) => void;
  onPlace: (kind: "pin" | "text", at: LngLat) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: AerialView } | null>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const tiles = sources.flatMap((s) => tilesForView(view, s));
  const px = (p: LngLat) => project(view, p);
  const numbers = tagNumbers(annotations);

  const toView = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * view.width) / r.width,
      ((e.clientY - r.top) * view.height) / r.height,
    ];
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = toView(e);
    if (tool === "pin" || tool === "text") {
      onPlace(tool, unproject(view, p[0], p[1]));
      return;
    }
    svg.current?.setPointerCapture(e.pointerId);
    if (tool === "move") drag.current = { x: p[0], y: p[1], view };
    else setDraft(tool === "line" ? [p, p] : [p]);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toView(e);
    if (drag.current) {
      const d = drag.current;
      onView(panView(d.view, p[0] - d.x, p[1] - d.y));
      return;
    }
    if (!draft) return;
    if (tool === "line") setDraft([draft[0]!, p]);
    else {
      const last = draft[draft.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2) setDraft([...draft, p]);
    }
  };
  const up = () => {
    drag.current = null;
    if (!draft) return;
    const pts = tool === "free" ? simplifyStroke(draft, 1.5) : draft;
    setDraft(null);
    const [a, b] = [pts[0]!, pts[pts.length - 1]!];
    const long = pts.length >= 2 && (pts.length > 2 || Math.hypot(b[0] - a[0], b[1] - a[1]) >= 4);
    if (!long) return;
    const ll = pts.map(([x, y]) => unproject(view, x, y));
    onAdd(
      tool === "line"
        ? { id: newAnnotationId(), kind: "line", color, points: [ll[0]!, ll[ll.length - 1]!] }
        : { id: newAnnotationId(), kind: "free", color, points: ll },
    );
  };

  const cursor = tool === "move" ? "grab" : tool === "text" ? "text" : "crosshair";
  const footD = polys.flatMap((poly) => poly.map((ring) => `${pathD(ring.map(px))} Z`)).join(" ");
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
        {footD && (
          <path
            d={footD}
            fill="rgba(34,211,238,0.10)"
            fillRule="evenodd"
            stroke={FOOTPRINT_STROKE}
            strokeWidth={3}
            strokeLinejoin="round"
          />
        )}
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
        {draft && lineOf("draft", draft, colorHex(color))}
      </svg>
    </div>
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

/** The saved picture: the imagery, then the outline, marks, caption and tags' legend. */
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
