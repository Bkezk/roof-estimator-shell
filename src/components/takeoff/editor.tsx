/**
 * Takeoff editor (/takeoff?id=…): pages on the left, the drawing in the middle, Setup /
 * Objects / Quantities on the right. Local state is authoritative and autosaves 800 ms after
 * any change to the name, pages, setup or objects.
 *
 * Locked takeoffs (src/lib/takeoff/lock.ts; owner, Sep 30): a takeoff that built a bid opens
 * read-only — no drawing tools, no Setup / Objects edits, no autosave — under a banner offering
 * "Edit a copy" and "Open bid". A copy's Create bid makes a NEW bid; updating the original's bid
 * from the copy is offered only behind a confirmation that names the bid and lists the changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  FilePlus2,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  RefreshCw,
  RotateCw,
  Ruler,
  Undo2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import {
  copyTakeoff,
  getTakeoff,
  saveTakeoff,
  takeoffDoc,
  TAKEOFF_BUCKET,
  type TakeoffWithBid,
} from "@/lib/takeoff.functions";
import {
  bidActions,
  isTakeoffLocked,
  lockBannerText,
  lockedToast,
  lockMeta,
  takeoffChangeList,
  TAKEOFF_LOCKED,
} from "@/lib/takeoff/lock";
import { followAreaEdits } from "@/lib/takeoff/edge-lines";
import {
  feetPerPx,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useSidebar } from "@/components/ui/sidebar";

import { pointerCloseAutoFocus } from "./focus";
import { BidStatusBadge } from "./bid-status-badge";
import { ExportMarkupButton, TakeoffCustomerChip } from "./editor-extras";
import { ObjectsTab } from "./objects-tab";
import { QuantitiesTab } from "./quantities-tab";
import { SetupTab } from "./setup-tab";
import {
  buildObject,
  duplicateObject,
  edgeSideRoles,
  edgeSummary,
  isTypingTarget,
  newId,
  translateObject,
  type EdgeSession,
  type NewObjectRoles,
  type Tool,
} from "./shapes";
import { closePdf, openPdf, type UnderlaySource } from "./underlay";
import { useAutosave, type SaveState } from "./use-autosave";
import { TIP_DELAY_MS, Tip } from "./toolbar";
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
const NO_AREA_TIP = "draw at least one roof area on a scaled page first";

/** Undo steps kept for the objects list, and how close attribute edits merge into one step. */
const HISTORY_LIMIT = 50;
const MERGE_MS = 1000;

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

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const noChange = () => {};

function LoadedEditor({ row }: { row: TakeoffWithBid }) {
  const initial = useMemo(() => takeoffDoc(row), [row]);
  const { can } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getTakeoff);
  // The lock, kept current while the editor is open: a bid saved from this takeoff (another tab,
  // or a save refused as locked) locks it. Refetched on window focus; gcTime 0 so a reopened
  // takeoff never starts from a stale copy.
  const lockQ = useQuery({
    queryKey: ["takeoff-lock", row.id],
    queryFn: () => getFn({ data: { id: row.id } }),
    initialData: row,
    staleTime: 15_000,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
  const live = lockQ.data ?? row;
  const locked = isTakeoffLocked(live);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const lockedBid = locked ? live.bid : null;
  // Told once: the takeoff became locked while open (it was not when it opened).
  const wasLocked = useRef(isTakeoffLocked(row));
  useEffect(() => {
    if (locked && !wasLocked.current) toast.info(lockedToast(live.bid?.name ?? null));
    wasLocked.current = locked;
  }, [locked, live.bid?.name]);
  const [name, setName] = useState(row.name);
  const [pages, setPages] = useState<TakeoffPage[]>(() =>
    initial.pages.length ? initial.pages : [{ index: 0, name: "Page 1", rotation: 0, scale: null }],
  );
  const [setup, setSetup] = useState<TakeoffSetup>(initial.setup);
  // The customer these plans belong to (saved at once from the Setup tab, not autosaved).
  const [customer, setCustomer] = useState<TakeoffWithBid["account"]>(
    () => row.account ?? (row.account_id ? { id: row.account_id, name: "" } : null),
  );
  // The objects list with undo / redo (Ctrl+Z / Ctrl+Y): every change goes through `commit`,
  // which keeps the previous list (up to HISTORY_LIMIT). Quick successive edits of one object's
  // attributes (typing a name) merge into one step. Autosave is not undone — only the document.
  const [objects, setObjectsState] = useState<TakeoffObject[]>(initial.objects);
  const objectsRef = useRef(objects);
  const history = useRef<{
    past: TakeoffObject[][];
    future: TakeoffObject[][];
    mergeKey: string | null;
    at: number;
  }>({ past: [], future: [], mergeKey: null, at: 0 });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const syncHistory = () =>
    setHistorySize({ past: history.current.past.length, future: history.current.future.length });
  const commit = (fn: (os: TakeoffObject[]) => TakeoffObject[], mergeKey?: string) => {
    if (lockedRef.current) return;
    const prev = objectsRef.current;
    const edited = fn(prev);
    if (edited === prev) return;
    // An area whose points changed (vertex drag, move, edit) takes its "Edge from this area"
    // lines along: the lines that ran on its sides are re-derived on the same sides, in the
    // same undo step. A changed side count cannot be mapped: the lines stay, and we say so.
    const { objects: next, stale } = followAreaEdits(prev, edited, (i) =>
      feetPerPx(pages.find((p) => p.index === i)?.scale),
    );
    for (const name of stale)
      toast.warning(
        `The edge lines of ${name} no longer match its sides — re-make them with "Edge from this area".`,
      );
    const h = history.current;
    const now = Date.now();
    if (!(mergeKey && h.mergeKey === mergeKey && now - h.at < MERGE_MS)) {
      h.past.push(prev);
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.mergeKey = mergeKey ?? null;
    h.at = now;
    h.future = [];
    objectsRef.current = next;
    setObjectsState(next);
    syncHistory();
  };
  const travel = (from: "past" | "future") => {
    if (lockedRef.current) return;
    const h = history.current;
    const target = h[from].pop();
    if (!target) return;
    (from === "past" ? h.future : h.past).push(objectsRef.current);
    h.mergeKey = null;
    objectsRef.current = target;
    setObjectsState(target);
    syncHistory();
  };
  const undo = () => travel("past");
  const redo = () => travel("future");
  const [pageIdx, setPageIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "Edge from this area" asked for on the Objects tab (a new object each click).
  const [edgeRequest, setEdgeRequest] = useState<{ areaId: string } | null>(null);
  // "Edge from this area" while it is on: the area and each side's role. Shared by the viewer
  // (the plan, the banner) and the Objects tab (the per-side panel); the viewer starts it.
  const [edge, setEdge] = useState<EdgeSession | null>(null);
  // "Duplicate and stamp" asked for on the Objects tab (a new object each click).
  const [stampRequest, setStampRequest] = useState<{ id: string } | null>(null);
  const isNew = initial.objects.length === 0 && Object.keys(initial.setup).length === 0;
  // A brand-new drawing (nothing drawn, no page scaled) opens on the Scale tool.
  const [startTool] = useState<Tool>(() =>
    !isTakeoffLocked(row) && initial.objects.length === 0 && !initial.pages.some((p) => p.scale)
      ? "scale"
      : "select",
  );
  const [tab, setTab] = useState(isNew ? "setup" : "objects");

  // Autosave (name / pages / setup / objects) — never on a locked takeoff.
  const saveFn = useServerFn(saveTakeoff);
  const doc = useMemo(() => ({ name, pages, setup, objects }), [name, pages, setup, objects]);
  const { state: saveState, flush: flushSave } = useAutosave(
    doc,
    async (d) => {
      try {
        await saveFn({
          data: {
            id: row.id,
            name: d.name.trim() || "Untitled takeoff",
            pages: d.pages,
            setup: d.setup,
            objects: d.objects,
          },
        });
      } catch (e) {
        // Refused as locked: pick up the lock (the editor turns read-only).
        if (errText(e).includes(TAKEOFF_LOCKED)) void lockQ.refetch();
        throw e;
      }
    },
    800,
    locked,
  );

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
  // estimator — on a NEW bid seeded from this drawing (/estimate?takeoff=<id>), or (a copy, after
  // the confirmation) on the bid its original built, with this drawing's quantities applied
  // (/estimate?bid=<bid id>&takeoff=<id>). A locked takeoff offers neither: it already built one.
  const navigate = useNavigate();
  const canCreateBid = quantities.sections.length > 0;
  // A copy ("Edit a copy") remembers its original and the bid that one built.
  const origin = lockMeta(initial.setup).copiedFrom ?? null;
  const originQ = useQuery({
    queryKey: ["takeoff-origin", origin?.takeoffId],
    queryFn: () => getFn({ data: { id: origin!.takeoffId } }),
    enabled: !!origin?.bidId && !locked,
    staleTime: 60_000,
  });
  const originBid =
    origin?.bidId &&
    originQ.data?.bid &&
    originQ.data.bid.id === origin.bidId &&
    !originQ.data.bid.deleted_at
      ? originQ.data.bid
      : null;
  const actions = bidActions({ locked, originBid });
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const updateChanges = useMemo(() => {
    if (!confirmUpdate || !originQ.data) return [];
    const o = takeoffDoc(originQ.data);
    return takeoffChangeList(takeoffQuantities(o.pages, o.objects), quantities);
  }, [confirmUpdate, originQ.data, quantities]);

  // "Edit a copy": a new, unlocked takeoff with this drawing; open it.
  const copyFn = useServerFn(copyTakeoff);
  const makeCopy = useMutation({
    mutationFn: () => copyFn({ data: { id: row.id } }),
    onSuccess: (copy) => {
      toast.success(
        `Copy made: “${copy.name}”. Measure away — its Create bid starts a new bid; “${live.bid?.name ?? "the original bid"}” is not touched.`,
      );
      void qc.invalidateQueries({ queryKey: ["takeoffs"] });
      void navigate({ to: "/takeoff", search: { id: copy.id } });
    },
    onError: (e) => toast.error(`Could not copy the takeoff: ${errText(e)}`),
  });
  // The bid it built was deleted: the lock may be cleared (the server checks the bid is gone).
  const unlock = useMutation({
    mutationFn: () => saveFn({ data: { id: row.id, bid_id: null } }),
    onSuccess: () => {
      toast.success("Takeoff unlocked: the bid it built was deleted.");
      void lockQ.refetch();
      void qc.invalidateQueries({ queryKey: ["takeoffs"] });
    },
    onError: (e) => toast.error(errText(e)),
  });
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
    if (!p || lockedRef.current) return;
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
    // Rotating re-frames every point on the page, so older undo steps no longer line up.
    history.current = { past: [], future: [], mergeKey: null, at: 0 };
    syncHistory();
    const rotated = objectsRef.current.map((o) => {
      if (o.page !== p.index) return o;
      const points = rotatePoints(o.points, W, H, 1);
      if (o.kind === "area" && o.attrs.cutouts?.length)
        return {
          ...o,
          points,
          attrs: { ...o.attrs, cutouts: o.attrs.cutouts.map((c) => rotatePoints(c, W, H, 1)) },
        };
      return { ...o, points };
    });
    objectsRef.current = rotated;
    setObjectsState(rotated);
  };

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setTab("objects");
  }, []);

  const createObject = (kind: ObjectKind, points: PagePoint[], roles: NewObjectRoles): string => {
    const id = newId();
    commit((prev) => [
      ...prev,
      buildObject(kind, id, page.index, points, prev, setup, page.scale, roles),
    ]);
    select(id);
    return id;
  };
  // A stamped copy (one undo step); the source stays selected so the next click stamps again.
  const duplicate = (sourceId: string, dx: number, dy: number): string | null => {
    const id = newId();
    let made = false;
    commit((prev) => {
      const src = prev.find((o) => o.id === sourceId);
      if (!src) return prev;
      made = true;
      return [...prev, duplicateObject(src, dx, dy, id, prev)];
    });
    return made ? id : null;
  };
  const changePoints = (id: string, points: PagePoint[]) =>
    commit((os) => os.map((o) => (o.id === id ? { ...o, points } : o)));
  const moveObject = (id: string, dx: number, dy: number) =>
    commit((os) => os.map((o) => (o.id === id ? translateObject(o, dx, dy) : o)));
  const addCutout = (areaId: string, ring: PagePoint[]) =>
    commit((os) =>
      os.map((o) =>
        o.id === areaId && o.kind === "area"
          ? { ...o, attrs: { ...o.attrs, cutouts: [...(o.attrs.cutouts ?? []), ring] } }
          : o,
      ),
    );
  // Set this page's scale; with `applyToAll`, pages that have none take the same one (turned
  // to their own rotation when it differs). Pages with a scale keep it.
  const setScale = (scale: PageScale, applyToAll: boolean) => {
    if (lockedRef.current) return;
    setPages((ps) =>
      ps.map((x) => {
        if (x.index === page.index) return { ...x, scale };
        if (!applyToAll || x.scale) return x;
        const turns = (x.rotation - page.rotation + 4) % 4;
        const W = page.width;
        const H = page.height;
        return { ...x, scale: turns && W && H ? rotateScale(scale, W, H, turns) : { ...scale } };
      }),
    );
  };
  const unscaledOtherPages = pages.filter((x) => x.index !== page.index && !x.scale).length;
  const updateObject = (id: string, fn: (o: TakeoffObject) => TakeoffObject) =>
    commit((os) => os.map((o) => (o.id === id ? fn(o) : o)), `update:${id}`);
  const deleteObject = (id: string) => {
    commit((os) => os.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // An undo that removes the selected object clears the selection.
  useEffect(() => {
    if (selectedId && !objects.some((o) => o.id === selectedId)) setSelectedId(null);
  }, [objects, selectedId]);

  // Ctrl+Z / Ctrl+Y (Cmd on a Mac; Ctrl+Shift+Z redoes too). A text field keeps its own undo.
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) undoRef.current.undo();
      else if (k === "y" || (k === "z" && e.shiftKey)) undoRef.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const selectFromList = (id: string) => {
    const o = objects.find((x) => x.id === id);
    if (o) {
      const pi = pages.findIndex((p) => p.index === o.page);
      if (pi >= 0) setPageIdx(pi);
    }
    select(id);
  };

  // Drawing-area size (owner, Sep 26: "we want that to be large"). The pages column and the
  // Setup / Objects / Quantities panel fold away; Focus folds both plus the app menu. The
  // viewer re-fits whenever its box changes size, so the page grows with the space.
  const { open: navOpen, setOpen: setNavOpen, isMobile } = useSidebar();
  const [pagesOpen, setPagesOpen] = useState(() => readPanel("pages", true));
  const [panelOpen, setPanelOpen] = useState(() => readPanel("panel", true));
  const togglePages = () =>
    setPagesOpen((o) => {
      writePanel("pages", !o);
      return !o;
    });
  const togglePanel = () =>
    setPanelOpen((o) => {
      writePanel("panel", !o);
      return !o;
    });
  const focused = !pagesOpen && !panelOpen && (isMobile || !navOpen);
  const toggleFocus = () => {
    const next = !focused;
    setPagesOpen(!next);
    setPanelOpen(!next);
    writePanel("pages", !next);
    writePanel("panel", !next);
    if (!isMobile) setNavOpen(!next);
  };
  // Starting "Edge from this area" brings up the Objects tab (opening the panel if folded), where
  // its per-side panel is.
  const changeEdge = (next: EdgeSession | null) => {
    if (next && !edge) {
      setTab("objects");
      if (!panelOpen) {
        setPanelOpen(true);
        writePanel("panel", true);
      }
    }
    setEdge(next);
  };
  // Create: one linear per run of sides sharing a role, all in one undo step; the last is selected.
  const createEdges = () => {
    if (!edge) return;
    const area = objectsRef.current.find((o) => o.id === edge.areaId && o.kind === "area");
    if (!area) {
      setEdge(null);
      return;
    }
    const scale = pages.find((p) => p.index === area.page)?.scale ?? null;
    const sum = edgeSummary(area.points, edgeSideRoles(edge, area.points.length), feetPerPx(scale));
    if (!sum.lines) {
      toast.info("Every side is left out — give at least one side a role, or Cancel (Esc).");
      return;
    }
    const ids = sum.runs.map(() => newId());
    commit((prev) =>
      sum.runs.reduce(
        (acc, run, k) => [
          ...acc,
          buildObject("linear", ids[k]!, area.page, run.points, acc, setup, scale, {
            linear: run.role,
            fromArea: area.id,
          }),
        ],
        prev,
      ),
    );
    select(ids[ids.length - 1]!);
    setEdge(null);
    toast.success(`Made from ${area.attrs.name}: ${sum.text}.`);
  };
  const gridCols = `${pagesOpen ? "150px " : ""}minmax(0,1fr)${panelOpen ? " 380px" : ""}`;

  return (
    // -m-4 reclaims most of the page padding around the editor; the height is the viewport minus
    // the 3.5rem app header and the 0.5rem gap left above and below.
    <div className="-m-4 flex h-[calc(100svh-4.5rem)] min-h-[560px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="px-2">
          <Link to="/takeoff">
            <ArrowLeft className="mr-1 h-4 w-4" /> Takeoffs
          </Link>
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={locked}
          className="h-9 w-[min(420px,100%)] text-base font-semibold"
          aria-label="Takeoff name"
        />
        <Badge variant="secondary">{row.underlay_kind === "pdf" ? "PDF" : "Image"}</Badge>
        {row.file_name && (
          <span className="max-w-[240px] truncate text-xs text-muted-foreground">
            {row.file_name}
          </span>
        )}
        {locked ? (
          <span
            className="flex max-w-[280px] items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300"
            aria-live="polite"
            title="This takeoff built a bid, so it is read-only. Use Edit a copy to measure again."
          >
            <Lock className="h-3 w-3 shrink-0" />
            <span className="truncate">
              Locked · built {lockedBid ? `bid “${lockedBid.name}”` : "a bid"}
            </span>
          </span>
        ) : (
          <>
            <SaveIndicator state={saveState} />
            <div className="flex items-center">
              <Tip
                name="Undo"
                text="take back the last change to the drawing (Ctrl+Z)"
                wrap={historySize.past === 0}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  disabled={historySize.past === 0}
                  onClick={(e) => {
                    undo();
                    if (e.detail > 0) e.currentTarget.blur();
                  }}
                  aria-label="Undo"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </Tip>
              <Tip
                name="Redo"
                text="put back what Undo took back (Ctrl+Y or Ctrl+Shift+Z)"
                wrap={historySize.future === 0}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  disabled={historySize.future === 0}
                  onClick={(e) => {
                    redo();
                    if (e.detail > 0) e.currentTarget.blur();
                  }}
                  aria-label="Redo"
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </Tip>
            </div>
          </>
        )}
        <Select value={status} onValueChange={(v) => saveStatus.mutate(v as TakeoffStatus)}>
          <SelectTrigger
            className="h-8 w-[100px] text-xs"
            aria-label="Takeoff status"
            title="Mark this takeoff Done, or move it back to Draft"
            disabled={saveStatus.isPending}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent onCloseAutoFocus={pointerCloseAutoFocus}>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
        <TakeoffCustomerChip row={row} customer={customer} onChange={setCustomer} />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <ExportMarkupButton
            name={name}
            customer={customer}
            pages={pages}
            objects={objects}
            source={source}
          />
          <div className="flex items-center rounded-md border">
            <Tip name="Pages" text={pagesOpen ? "hide the pages list" : "show the pages list"}>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={togglePages}
                aria-label="Pages list"
                aria-pressed={pagesOpen}
              >
                {pagesOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="h-4 w-4" />
                )}
              </Button>
            </Tip>
            <Tip
              name="Side panel"
              text={
                panelOpen
                  ? "hide the Setup / Objects / Quantities panel"
                  : "show the Setup / Objects / Quantities panel"
              }
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={togglePanel}
                aria-label="Setup / Objects / Quantities panel"
                aria-pressed={panelOpen}
              >
                {panelOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </Button>
            </Tip>
            <Tip
              name={focused ? "Exit focus" : "Focus"}
              text={
                focused
                  ? "show the menu and side panels again"
                  : "hide the menu and side panels to give the drawing the whole screen"
              }
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2"
                onClick={toggleFocus}
                aria-pressed={focused}
              >
                {focused ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                <span className="text-xs">{focused ? "Exit focus" : "Focus"}</span>
              </Button>
            </Tip>
          </div>
          {actions.updateBid && (
            <Tooltip delayDuration={TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="min-w-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canCreateBid}
                    className="max-w-[320px]"
                    onClick={() => setConfirmUpdate(true)}
                  >
                    <RefreshCw className="mr-1 h-4 w-4 shrink-0" />
                    <span className="truncate">Update bid “{actions.updateBid.bidName}”…</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <span className="font-semibold">Update bid</span> —{" "}
                {canCreateBid
                  ? `apply this copy's quantities to “${actions.updateBid.bidName}”, the bid the original built (asks first, listing the changes)`
                  : NO_AREA_TIP}
              </TooltipContent>
            </Tooltip>
          )}
          {actions.createBid && (
            <Tooltip delayDuration={TIP_DELAY_MS}>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" disabled={!canCreateBid} onClick={() => void toBid(null)}>
                    <FilePlus2 className="mr-1 h-4 w-4" /> Create bid
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <span className="font-semibold">Create bid</span> —{" "}
                {canCreateBid
                  ? "start a new bid with these sections, edges, parapets and counts filled in"
                  : NO_AREA_TIP}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {locked && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            {lockBannerText(
              lockedBid?.name ?? null,
              lockMeta(live.setup).lockedAt ?? lockedBid?.created_at ?? null,
            )}
            {lockedBid?.deleted_at && " That bid has since been deleted."}
          </p>
          {lockedBid && (
            <span className="flex items-center gap-1.5">
              <BidStatusBadge status={lockedBid.status} />
              <Button asChild size="sm" variant="outline">
                <Link to="/estimate" search={{ bid: lockedBid.id }}>
                  Open bid
                </Link>
              </Button>
            </span>
          )}
          {lockedBid?.deleted_at && can("estimate") && (
            <Button
              size="sm"
              variant="outline"
              disabled={unlock.isPending}
              onClick={() => unlock.mutate()}
              title="The bid this takeoff built was deleted, so it can be edited again"
            >
              Unlock
            </Button>
          )}
          {actions.editCopy && (
            <Button size="sm" disabled={makeCopy.isPending} onClick={() => makeCopy.mutate()}>
              {makeCopy.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-1 h-4 w-4" />
              )}
              Edit a copy
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={confirmUpdate} onOpenChange={setConfirmUpdate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update bid “{actions.updateBid?.bidName}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This changes its measured quantities
                  {updateChanges.length
                    ? ":"
                    : ". Nothing measured differs from the takeoff that built it; the bid's measured sections, parapets, curbs, pipe stacks and drains are set from this drawing again."}
                </p>
                {updateChanges.length > 0 && (
                  <ul className="max-h-60 list-disc space-y-0.5 overflow-y-auto pl-5 text-foreground">
                    {updateChanges.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                <p>
                  The bid's own edits to unrelated fields are kept. The bid opens with the changes
                  applied; nothing is saved until you save it there.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Cancel takes the focus when the dialog opens (Radix), so Enter cancels. */}
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = actions.updateBid;
                setConfirmUpdate(false);
                if (target) void toBid(target.bidId);
              }}
            >
              Update bid
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid min-h-0 flex-1 gap-2" style={{ gridTemplateColumns: gridCols }}>
        {pagesOpen && (
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
                      onClick={(e) => {
                        setPageIdx(i);
                        setSelectedId(null);
                        // Mouse click: hand the keys back to the drawing.
                        if (e.detail > 0) e.currentTarget.blur();
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
                      disabled={locked}
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
        )}

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
            onMoveObject={moveObject}
            onDelete={deleteObject}
            onAddCutout={addCutout}
            onSetScale={setScale}
            pageCount={pages.length}
            unscaledOtherPages={unscaledOtherPages}
            initialTool={startTool}
            onPageSize={onPageSize}
            edgeRequest={edgeRequest}
            edge={edge}
            onEdgeChange={changeEdge}
            onEdgeCreate={createEdges}
            onDuplicate={duplicate}
            stampRequest={stampRequest}
            readOnly={locked}
          />
        </div>

        {panelOpen && (
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="m-2 grid grid-cols-3">
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="objects">Objects</TabsTrigger>
                <TabsTrigger value="quantities">Quantities</TabsTrigger>
              </TabsList>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                <TabsContent value="setup" className="mt-0">
                  <SetupTab
                    takeoffId={row.id}
                    setup={setup}
                    onChange={locked ? noChange : setSetup}
                    readOnly={locked}
                    isNew={isNew}
                    customer={customer}
                    onCustomerChange={setCustomer}
                  />
                </TabsContent>
                <TabsContent value="objects" className="mt-0">
                  <ObjectsTab
                    objects={objects}
                    pages={pages}
                    quantities={quantities}
                    setup={setup}
                    selectedId={selectedId}
                    onSelect={selectFromList}
                    onUpdate={updateObject}
                    onDelete={deleteObject}
                    onEdgeFromArea={(areaId) => setEdgeRequest({ areaId })}
                    edge={edge}
                    onEdgeChange={changeEdge}
                    onEdgeCreate={createEdges}
                    onDuplicate={(objectId) => setStampRequest({ id: objectId })}
                    readOnly={locked}
                  />
                </TabsContent>
                <TabsContent value="quantities" className="mt-0">
                  <QuantitiesTab name={name} pages={pages} quantities={quantities} />
                </TabsContent>
              </div>
            </Tabs>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Which Takeoff side panels are open, remembered per browser (every read / write guarded). */
const PANEL_KEY = "bid-o-matic:takeoff-panels";
function readPanel(which: "pages" | "panel", fallback: boolean): boolean {
  try {
    if (typeof window === "undefined") return fallback;
    const raw: unknown = JSON.parse(window.localStorage.getItem(PANEL_KEY) ?? "{}");
    const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[which] : undefined;
    return typeof v === "boolean" ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePanel(which: "pages" | "panel", open: boolean) {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PANEL_KEY) ?? "{}");
    const cur = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    window.localStorage.setItem(PANEL_KEY, JSON.stringify({ ...cur, [which]: open }));
  } catch {
    // Storage unavailable — the panels still fold for this visit.
  }
}
