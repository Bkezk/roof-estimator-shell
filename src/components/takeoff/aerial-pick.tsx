/**
 * New takeoff › From an address (owner, Oct 27: "we also want to be able to search an address, it
 * pull up an aerial picture and we can mark it up from that as well"). The address box with its
 * state hint, Find, then the ticket aerial's imagery view (the same tiles, outline, pan and zoom;
 * src/lib/aerial-geo.ts) and, when nothing is found, the ticket's "Pick the building" map. The
 * dialog's "Use this picture" renders the view as shown to a PNG and makes the takeoff from it
 * (src/lib/takeoff/aerial-takeoff.ts); this component only settles what the picture is and
 * reports it through `onChange` (null until there is one).
 *
 * Imagery exists for Kentucky and Tennessee only: an address in another state, or one nothing
 * is found for (and no building picked), gets NO_IMAGERY_MESSAGE and the dialog stays open.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Loader2, Scan, Search, ZoomIn, ZoomOut } from "lucide-react";

import {
  clampZoom,
  footprintLabel,
  footprintPolygons,
  imageryFor,
  panView,
  project,
  screenToView,
  tilesForView,
  viewFor,
  type AerialView,
  type ImagerySource,
  type LngLat,
} from "@/lib/aerial-geo";
import { FOOTPRINT_STROKE, pathD } from "@/lib/aerial-markup";
import { FIND_HOW_LABELS, type FindCandidate } from "@/lib/address-query";
import {
  lookupAddressAerial,
  takeoffBuildingAt,
  type FindAerial,
  type FoundBuilding,
} from "@/lib/takeoff-aerial.functions";
import { NO_IMAGERY_MESSAGE, addressStateHint } from "@/lib/takeoff/aerial-takeoff";
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

const ProspectMap = lazy(() => import("@/components/prospect-map"));

/** The picture the dialog will make the takeoff from: the view as shown and its imagery. */
export interface AerialSelection {
  address: string;
  view: AerialView;
  sources: ImagerySource[];
  found: FoundBuilding | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AerialAddressPicker({
  disabled,
  onChange,
}: {
  disabled: boolean;
  /** The picture as it stands (null until an address is found or a building picked). */
  onChange: (selection: AerialSelection | null) => void;
}) {
  const lookupFn = useServerFn(lookupAddressAerial);
  const pickFn = useServerFn(takeoffBuildingAt);
  const [address, setAddress] = useState("");
  /** The address the last lookup ran on (the picture belongs to it, not to what is typed now). */
  const [looked, setLooked] = useState<{ address: string; result: FindAerial } | null>(null);
  /** The typed address is outside the imagery (Find refused without a lookup). */
  const [outside, setOutside] = useState(false);
  const [found, setFound] = useState<FoundBuilding | null>(null);
  const [view, setView] = useState<AerialView | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const hint = addressStateHint(address);

  const lookup = useMutation({
    mutationFn: (input: { address: string; point?: { lat: number; lng: number } }) =>
      lookupFn({ data: input }),
    onSuccess: (r, input) => {
      setLooked({ address: input.address, result: r });
      setFound(r.found);
      setView(
        r.found ? viewFor(footprintPolygons(r.found.footprint), [r.found.lng, r.found.lat]) : null,
      );
    },
    onError: (e) => toast.error(`Could not look the address up: ${errText(e)}`),
  });
  /** Owner, Oct 27: several places tie — one clicked is looked up at its point. */
  const choose = (c: FindCandidate) => {
    if (lookup.isPending) return;
    const line = [c.address, c.city, c.state].filter(Boolean).join(", ");
    setFound(null);
    setView(null);
    lookup.mutate({ address: line, point: { lat: c.lat, lng: c.lng } });
  };
  const pick = useMutation({
    mutationFn: (p: { lat: number; lng: number }) => pickFn({ data: p }),
    onSuccess: (f) => {
      setFound(f);
      setView(viewFor(footprintPolygons(f.footprint), [f.lng, f.lat]));
      setPickOpen(false);
      toast.success(
        f.areaSqFt ? `Building picked · ${footprintLabel(f.areaSqFt)}` : "Building picked",
      );
    },
    onError: (e) => toast.error(`Could not pick that building: ${errText(e)}`),
  });

  const find = () => {
    const line = address.trim();
    if (!line || lookup.isPending) return;
    setFound(null);
    setView(null);
    setLooked(null);
    if (hint.outside) {
      setOutside(true);
      return;
    }
    setOutside(false);
    lookup.mutate({ address: line });
  };

  // The address the picture is for: the one looked up, else what is typed (a picked building).
  const pictureAddress = looked?.address ?? address.trim();
  const imagery = useMemo(
    () =>
      view
        ? imageryFor({
            buildingState: found?.state,
            addressState: looked?.result.addressState,
            at: view.center,
          })
        : null,
    [view, found?.state, looked?.result.addressState],
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(
      view && imagery ? { address: pictureAddress, view, sources: imagery.sources, found } : null,
    );
  }, [view, imagery, pictureAddress, found]);

  const polys = useMemo(() => footprintPolygons(found?.footprint ?? null), [found]);
  const note = looked?.result.note ?? null;
  /** The step that matched ("Found on Kentucky's address points"), for the note line. */
  const howLabel = looked?.result.how ? FIND_HOW_LABELS[looked.result.how] : null;
  const candidates = looked?.result.candidates ?? [];
  const noteLine = [howLabel, note].filter(Boolean).join(" — ") || null;
  const nothing = outside || (looked !== null && !view);

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
              // Nothing found but the street is on the map (owner, Oct 26): open there.
              focus={
                view ? { lat: view.center[1], lng: view.center[0] } : (looked?.result.near ?? null)
              }
              fitTo={
                view || looked?.result.near
                  ? undefined
                  : (looked?.result.addressState ?? hint.state ?? null)
              }
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

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="takeoff-address">
          Address <span className="text-destructive">*</span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="takeoff-address"
            value={address}
            disabled={disabled}
            autoComplete="street-address"
            placeholder="412 Main St, Murray, KY 42071 · Advance Auto Parts, Corbin KY · 36.9757, -84.1091 · a Google Maps link"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                find();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || lookup.isPending || !address.trim()}
            onClick={find}
          >
            {lookup.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1 h-4 w-4" />
            )}
            Find
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{hint.hint}</p>
      </div>

      {nothing && (
        <div className="space-y-2 text-sm">
          {candidates.length ? (
            // Owner, Oct 27: several places tie — a choice, not a failure.
            <>
              <p className="text-xs text-muted-foreground">{noteLine}</p>
              <ul className="space-y-1" aria-label="Places that match">
                {candidates.map((c, i) => (
                  <li key={`${c.lat},${c.lng},${i}`}>
                    <button
                      type="button"
                      disabled={disabled || lookup.isPending}
                      className="flex w-full flex-wrap items-baseline gap-x-2 rounded-md border px-3 py-2 text-left hover:bg-accent disabled:opacity-60"
                      onClick={() => choose(c)}
                    >
                      <span className="font-medium">{c.address}</span>
                      <span className="text-xs text-muted-foreground">
                        {[c.city, c.state].filter(Boolean).join(", ")}
                        {" · "}
                        {FIND_HOW_LABELS[c.how]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p>{NO_IMAGERY_MESSAGE}</p>
              {noteLine && !outside && <p className="text-xs text-muted-foreground">{noteLine}</p>}
            </>
          )}
          {!outside && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setPickOpen(true)}
            >
              <Building2 className="mr-2 h-4 w-4" /> Pick the building on the map
            </Button>
          )}
        </div>
      )}

      {view && imagery && (
        <div className="space-y-2">
          {noteLine && <p className="text-xs text-muted-foreground">{noteLine}</p>}
          <AerialPreview view={view} sources={imagery.sources} polys={polys} onView={setView} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Zoom out"
              disabled={disabled || clampZoom(view.zoom - 1) === view.zoom}
              onClick={() => setView({ ...view, zoom: clampZoom(view.zoom - 1) })}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Zoom in"
              disabled={disabled || clampZoom(view.zoom + 1) === view.zoom}
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
                disabled={disabled}
                onClick={() => setView(viewFor(polys, view.center))}
              >
                <Scan className="mr-1 h-4 w-4" /> Fit
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setPickOpen(true)}
            >
              <Building2 className="mr-1 h-4 w-4" /> Different building
            </Button>
            <span className="text-xs text-muted-foreground">
              {imagery.sources.map((s) => s.credit).join(" · ")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {found?.areaSqFt ? `${footprintLabel(found.areaSqFt)} · ` : ""}
            Drag to move, zoom so the whole roof is in the picture. The picture as shown becomes the
            takeoff's page, scaled from the imagery (zoom {view.zoom}).
          </p>
        </div>
      )}
      {pickDialog}
    </div>
  );
}

/** The picture: imagery tiles and the building outline in one SVG; drag pans. */
function AerialPreview({
  view,
  sources,
  polys,
  onView,
}: {
  view: AerialView;
  sources: ImagerySource[];
  polys: LngLat[][][];
  onView: (v: AerialView) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: AerialView } | null>(null);
  const tiles = sources.flatMap((s) => tilesForView(view, s));
  const toView = (e: React.PointerEvent): [number, number] =>
    screenToView(svg.current!.getBoundingClientRect(), view, e.clientX, e.clientY);
  return (
    <div className="overflow-hidden rounded-md border bg-neutral-800">
      <svg
        ref={svg}
        viewBox={`0 0 ${view.width} ${view.height}`}
        className="block h-auto w-full cursor-grab touch-none select-none"
        style={{ aspectRatio: `${view.width} / ${view.height}` }}
        role="img"
        aria-label="Aerial view of the address"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          svg.current?.setPointerCapture(e.pointerId);
          const p = toView(e);
          drag.current = { x: p[0], y: p[1], view };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = toView(e);
          onView(panView(d.view, p[0] - d.x, p[1] - d.y));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
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
        {polys.map((poly, i) =>
          poly.map((ring, j) => (
            <path
              key={`${i}-${j}`}
              d={`${pathD(ring.map((p) => project(view, p)))} Z`}
              fill="none"
              stroke={FOOTPRINT_STROKE}
              strokeWidth={3}
              strokeLinejoin="round"
              style={{ pointerEvents: "none" }}
            />
          )),
        )}
      </svg>
    </div>
  );
}
