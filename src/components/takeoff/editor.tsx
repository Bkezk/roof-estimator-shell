/**
 * Takeoff editor (/takeoff?id=…): pages on the left, the drawing in the middle, Setup /
 * Objects / Quantities on the right. Local state is authoritative and autosaves 800 ms after
 * any change to the name, pages, setup or objects.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FilePlus2,
  Loader2,
  RefreshCw,
  RotateCw,
  Ruler,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import {
  getTakeoff,
  saveTakeoff,
  takeoffDoc,
  TAKEOFF_BUCKET,
  type TakeoffWithBid,
} from "@/lib/takeoff.functions";
import {
  rotatePoints,
  rotateScale,
  takeoffQuantities,
  type ObjectKind,
  type PagePoint,
  type PageScale,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffSetup,
} from "@/lib/takeoff/model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { BidStatusBadge } from "./bid-status-badge";
import { ObjectsTab } from "./objects-tab";
import { QuantitiesTab } from "./quantities-tab";
import { SetupTab } from "./setup-tab";
import { buildObject, newId } from "./shapes";
import { closePdf, openPdf, type UnderlaySource } from "./underlay";
import { useAutosave, type SaveState } from "./use-autosave";
import { TakeoffViewer } from "./viewer";

export function TakeoffEditor({ id }: { id: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getTakeoff);
  const q = useQuery({
    queryKey: ["takeoff", id],
    queryFn: () => getFn({ data: { id } }),
    enabled: !!session,
    // The editor owns the document once loaded; never refetch it underneath the user, and
    // never reopen from a stale cached copy.
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (q.isLoading || (!q.data && !q.error && !q.isFetched))
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading takeoff…
      </p>
    );
  if (q.error || !q.data)
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-sm">
          <p>
            {q.error
              ? `Could not open this takeoff: ${q.error instanceof Error ? q.error.message : String(q.error)}`
              : "This takeoff was not found (it may have been deleted)."}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/takeoff">
              <ArrowLeft className="mr-1 h-4 w-4" /> All takeoffs
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  return <LoadedEditor key={q.data.id} row={q.data} />;
}

type TakeoffStatus = "draft" | "done";
const NO_AREA_TIP = "Draw at least one roof area on a scaled page first";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Saved",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying",
};

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span
      className={`flex items-center gap-1 text-xs ${
        state === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
      aria-live="polite"
    >
      {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
      {(state === "saved" || state === "idle") && <Check className="h-3 w-3" />}
      {state === "error" && <AlertTriangle className="h-3 w-3" />}
      {SAVE_LABEL[state]}
    </span>
  );
}

function LoadedEditor({ row }: { row: TakeoffWithBid }) {
  const initial = useMemo(() => takeoffDoc(row), [row]);
  const [name, setName] = useState(row.name);
  const [pages, setPages] = useState<TakeoffPage[]>(() =>
    initial.pages.length ? initial.pages : [{ index: 0, name: "Page 1", rotation: 0, scale: null }],
  );
  const [setup, setSetup] = useState<TakeoffSetup>(initial.setup);
  const [objects, setObjects] = useState<TakeoffObject[]>(initial.objects);
  const [pageIdx, setPageIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isNew = initial.objects.length === 0 && Object.keys(initial.setup).length === 0;
  const [tab, setTab] = useState(isNew ? "setup" : "objects");

  // Autosave (name / pages / setup / objects).
  const saveFn = useServerFn(saveTakeoff);
  const doc = useMemo(() => ({ name, pages, setup, objects }), [name, pages, setup, objects]);
  const { state: saveState, flush: flushSave } = useAutosave(doc, async (d) => {
    await saveFn({
      data: {
        id: row.id,
        name: d.name.trim() || "Untitled takeoff",
        pages: d.pages,
        setup: d.setup,
        objects: d.objects,
      },
    });
  });

  // The underlay file, straight from the private storage bucket.
  const [source, setSource] = useState<UnderlaySource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    const path = row.file_path;
    if (!path) {
      setLoadError("this takeoff has no plan file.");
      return;
    }
    let live = true;
    let dispose: (() => void) | null = null;
    (async () => {
      const { data, error } = await supabase.storage.from(TAKEOFF_BUCKET).download(path);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      if (row.underlay_kind === "pdf") {
        const pdf = await openPdf(await data.arrayBuffer());
        if (!live) return closePdf(pdf);
        dispose = () => closePdf(pdf);
        setSource({ kind: "pdf", doc: pdf });
      } else {
        const image = await createImageBitmap(data);
        if (!live) return image.close();
        dispose = () => image.close();
        setSource({ kind: "image", image });
      }
    })().catch((e: unknown) => {
      if (live) setLoadError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      live = false;
      dispose?.();
    };
  }, [row.file_path, row.underlay_kind]);

  const page = pages[Math.min(pageIdx, pages.length - 1)]!;
  const pageObjects = useMemo(() => objects.filter((o) => o.page === page.index), [objects, page]);
  const quantities = useMemo(() => takeoffQuantities(pages, objects), [pages, objects]);

  // Draft / Done — saved at once (separately from the autosave, which never sends status).
  const qc = useQueryClient();
  const [status, setStatus] = useState<TakeoffStatus>(row.status === "done" ? "done" : "draft");
  const saveStatus = useMutation({
    mutationFn: (next: TakeoffStatus) => saveFn({ data: { id: row.id, status: next } }),
    onMutate: (next) => {
      const prev = status;
      setStatus(next);
      return { prev };
    },
    onSuccess: (_row, next) => {
      toast.success(next === "done" ? "Takeoff marked Done" : "Takeoff moved back to Draft");
      void qc.invalidateQueries({ queryKey: ["takeoffs"] });
    },
    onError: (e, _next, ctx) => {
      if (ctx) setStatus(ctx.prev);
      toast.error(e instanceof Error ? e.message : "Could not change the status");
    },
  });

  // Bid from takeoff (docs/planswift-research.md §4.6): save what is pending, then open the
  // estimator — on a NEW bid seeded from this drawing (/estimate?takeoff=<id>), or on the bid
  // this takeoff already made, with the drawing's new quantities applied
  // (/estimate?bid=<bid id>&takeoff=<id>).
  const navigate = useNavigate();
  const linkedBid = row.bid;
  const canCreateBid = quantities.sections.length > 0;
  const toBid = async (bidId: string | null) => {
    const ok = await flushSave();
    if (!ok) {
      toast.error(
        bidId
          ? "The takeoff could not be saved, so the bid was not updated. Try again."
          : "The takeoff could not be saved, so no bid was started. Try again.",
      );
      return;
    }
    void navigate({
      to: "/estimate",
      search: bidId ? { bid: bidId, takeoff: row.id } : { takeoff: row.id },
    });
  };

  const onPageSize = useCallback((index: number, rotation: number, w: number, h: number) => {
    setPages((ps) => {
      const p = ps.find((x) => x.index === index);
      if (!p || p.rotation !== rotation) return ps;
      if (p.width && p.height && Math.abs(p.width - w) < 0.5 && Math.abs(p.height - h) < 0.5)
        return ps;
      return ps.map((x) => (x === p ? { ...x, width: w, height: h } : x));
    });
  }, []);

  const rotatePage = (i: number) => {
    const p = pages[i];
    if (!p) return;
    const rotation = ((p.rotation + 1) % 4) as TakeoffPage["rotation"];
    const W = p.width;
    const H = p.height;
    if (!W || !H) {
      // Never rendered, so nothing is drawn on it yet: just turn it.
      setPages((ps) => ps.map((x, j) => (j === i ? { ...x, rotation } : x)));
      return;
    }
    setPages((ps) =>
      ps.map((x, j) =>
        j === i
          ? {
              ...x,
              rotation,
              width: H,
              height: W,
              scale: x.scale ? rotateScale(x.scale, W, H, 1) : null,
            }
          : x,
      ),
    );
    setObjects((os) =>
      os.map((o) => {
        if (o.page !== p.index) return o;
        const points = rotatePoints(o.points, W, H, 1);
        if (o.kind === "area" && o.attrs.cutouts?.length)
          return {
            ...o,
            points,
            attrs: { ...o.attrs, cutouts: o.attrs.cutouts.map((c) => rotatePoints(c, W, H, 1)) },
          };
        return { ...o, points };
      }),
    );
  };

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setTab("objects");
  }, []);

  const createObject = (kind: ObjectKind, points: PagePoint[]): string => {
    const id = newId();
    setObjects((prev) => [
      ...prev,
      buildObject(kind, id, page.index, points, prev, setup, page.scale),
    ]);
    select(id);
    return id;
  };
  const changePoints = (id: string, points: PagePoint[]) =>
    setObjects((os) => os.map((o) => (o.id === id ? { ...o, points } : o)));
  const addCutout = (areaId: string, ring: PagePoint[]) =>
    setObjects((os) =>
      os.map((o) =>
        o.id === areaId && o.kind === "area"
          ? { ...o, attrs: { ...o.attrs, cutouts: [...(o.attrs.cutouts ?? []), ring] } }
          : o,
      ),
    );
  const setScale = (scale: PageScale) =>
    setPages((ps) => ps.map((x) => (x.index === page.index ? { ...x, scale } : x)));
  const updateObject = (id: string, fn: (o: TakeoffObject) => TakeoffObject) =>
    setObjects((os) => os.map((o) => (o.id === id ? fn(o) : o)));
  const deleteObject = (id: string) => {
    setObjects((os) => os.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const selectFromList = (id: string) => {
    const o = objects.find((x) => x.id === id);
    if (o) {
      const pi = pages.findIndex((p) => p.index === o.page);
      if (pi >= 0) setPageIdx(pi);
    }
    select(id);
  };

  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-[560px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="px-2">
          <Link to="/takeoff">
            <ArrowLeft className="mr-1 h-4 w-4" /> Takeoffs
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-[min(420px,100%)] text-base font-semibold"
          aria-label="Takeoff name"
        />
        <Badge variant="secondary">{row.underlay_kind === "pdf" ? "PDF" : "Image"}</Badge>
        {row.file_name && (
          <span className="max-w-[240px] truncate text-xs text-muted-foreground">
            {row.file_name}
          </span>
        )}
        <SaveIndicator state={saveState} />
        <Select value={status} onValueChange={(v) => saveStatus.mutate(v as TakeoffStatus)}>
          <SelectTrigger
            className="h-8 w-[100px] text-xs"
            aria-label="Takeoff status"
            title="Mark this takeoff Done, or move it back to Draft"
            disabled={saveStatus.isPending}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {linkedBid ? (
            <>
              <span className="flex items-center gap-1.5 text-xs">
                <Link
                  to="/estimate"
                  search={{ bid: linkedBid.id }}
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  title={`Open “${linkedBid.name}” as it is saved now`}
                >
                  Open bid
                </Link>
                <BidStatusBadge status={linkedBid.status} />
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canCreateBid}
                      onClick={() => void toBid(null)}
                    >
                      <FilePlus2 className="mr-1 h-4 w-4" /> Create a new bid
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {canCreateBid
                    ? "Start another, separate bid with these sections, edges, parapets and counts filled in"
                    : NO_AREA_TIP}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="min-w-0">
                    <Button
                      size="sm"
                      disabled={!canCreateBid}
                      className="max-w-[320px]"
                      onClick={() => void toBid(linkedBid.id)}
                    >
                      <RefreshCw className="mr-1 h-4 w-4 shrink-0" />
                      <span className="truncate">Update bid “{linkedBid.name}”</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {canCreateBid
                    ? `Open “${linkedBid.name}” with this drawing's new quantities applied`
                    : NO_AREA_TIP}
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" disabled={!canCreateBid} onClick={() => void toBid(null)}>
                    <FilePlus2 className="mr-1 h-4 w-4" /> Create bid
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {canCreateBid
                  ? "Start a new bid with these sections, edges, parapets and counts filled in"
                  : NO_AREA_TIP}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[160px_minmax(0,1fr)_400px] gap-3">
        <Card className="min-h-0 overflow-y-auto">
          <CardContent className="space-y-1 p-2">
            <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pages ({pages.length})
            </p>
            {pages.map((p, i) => {
              const n = objects.filter((o) => o.page === p.index).length;
              const active = i === pageIdx;
              return (
                <div
                  key={p.index}
                  className={`flex items-start gap-1 rounded px-1.5 py-1 ${
                    active ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setPageIdx(i);
                      setSelectedId(null);
                    }}
                  >
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {p.scale ? (
                        <span className="flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
                          <Ruler className="h-3 w-3" /> scaled
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">no scale</span>
                      )}
                      {n > 0 && <span>· {n}</span>}
                    </div>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    title="Rotate clockwise"
                    aria-label={`Rotate ${p.name} clockwise`}
                    onClick={() => rotatePage(i)}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="min-h-0 overflow-hidden rounded-lg border bg-background">
          <TakeoffViewer
            source={source}
            loadError={loadError}
            page={page}
            objects={pageObjects}
            selectedId={selectedId}
            onSelect={select}
            onCreate={createObject}
            onChangePoints={changePoints}
            onAddCutout={addCutout}
            onSetScale={setScale}
            onPageSize={onPageSize}
          />
        </div>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="m-2 grid grid-cols-3">
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="objects">Objects</TabsTrigger>
              <TabsTrigger value="quantities">Quantities</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <TabsContent value="setup" className="mt-0">
                <SetupTab setup={setup} onChange={setSetup} isNew={isNew} />
              </TabsContent>
              <TabsContent value="objects" className="mt-0">
                <ObjectsTab
                  objects={objects}
                  pages={pages}
                  quantities={quantities}
                  selectedId={selectedId}
                  onSelect={selectFromList}
                  onUpdate={updateObject}
                  onDelete={deleteObject}
                />
              </TabsContent>
              <TabsContent value="quantities" className="mt-0">
                <QuantitiesTab name={name} pages={pages} quantities={quantities} />
              </TabsContent>
            </div>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
