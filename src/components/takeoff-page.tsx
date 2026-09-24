/**
 * Takeoff — PlanSwift's drawing half (docs/planswift-research.md §4). Without an id the page
 * lists takeoffs (grouped Draft → Done, filterable, with a Recently deleted bin, like the Bids
 * page); `/takeoff?id=<uuid>` opens one in the editor (./takeoff/editor.tsx). A new takeoff is a
 * plan-set PDF or an aerial screenshot: the row is created first, then the browser uploads the
 * file straight into the private "takeoffs" bucket at the row's file_path.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  FileImage,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Ruler,
  Trash2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-store";
import {
  createTakeoff,
  DELETED_TAKEOFF_RETENTION_DAYS,
  deleteTakeoff,
  listDeletedTakeoffs,
  listTakeoffs,
  restoreTakeoff,
  TAKEOFF_BUCKET,
  takeoffDoc,
  type TakeoffRow,
  type TakeoffWithBid,
} from "@/lib/takeoff.functions";
import type { TakeoffPage as TakeoffSheet } from "@/lib/takeoff/model";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { BidStatusBadge } from "@/components/takeoff/bid-status-badge";
import { TakeoffEditor } from "@/components/takeoff/editor";
import { pdfPageCount } from "@/components/takeoff/underlay";

const MAX_BYTES = 100 * 1024 * 1024;
const ACCEPT = ["application/pdf", "image/png", "image/jpeg"];

export function TakeoffPage({ id }: { id?: string | undefined }) {
  return id ? <TakeoffEditor id={id} /> : <TakeoffList />;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const fileSize = (n: number | null) =>
  n === null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

/** Takeoff statuses, in the order the list groups them. Anything unknown reads as Draft. */
const TAKEOFF_STATUSES = ["draft", "done"] as const;
type TakeoffStatus = (typeof TAKEOFF_STATUSES)[number];
const TAKEOFF_STATUS_LABELS: Record<TakeoffStatus, string> = { draft: "Draft", done: "Done" };
const asTakeoffStatus = (s: string | null | undefined): TakeoffStatus =>
  s === "done" ? "done" : "draft";
type KindFilter = "all" | "pdf" | "image";
type StatusFilter = "all" | TakeoffStatus;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysLeft = (deletedAt: string | null) => {
  const t = deletedAt ? new Date(deletedAt).getTime() : Date.now();
  const end = t + DELETED_TAKEOFF_RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
};

/** Status groups the user has collapsed, remembered across reloads (per browser). */
const COLLAPSED_KEY = "bid-o-matic:takeoffs-collapsed";
const readCollapsed = (): TakeoffStatus[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(raw) ? TAKEOFF_STATUSES.filter((s) => raw.includes(s)) : [];
  } catch {
    return [];
  }
};
const writeCollapsed = (statuses: TakeoffStatus[]) => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(statuses));
  } catch {
    // Storage unavailable (private mode, blocked site data) — collapse still works this visit.
  }
};

function TakeoffList() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listTakeoffs);
  const deleteFn = useServerFn(deleteTakeoff);
  const listDeletedFn = useServerFn(listDeletedTakeoffs);
  const restoreFn = useServerFn(restoreTakeoff);
  const list = useQuery({
    queryKey: ["takeoffs"],
    queryFn: () => listFn(),
    enabled: !!session,
  });
  const deletedQuery = useQuery({
    queryKey: ["takeoffs-deleted"],
    queryFn: () => listDeletedFn(),
    enabled: !!session,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["takeoffs"] });
    void qc.invalidateQueries({ queryKey: ["takeoffs-deleted"] });
  };

  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<TakeoffWithBid | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showDeleted, setShowDeleted] = useState(false);
  // Collapsed status groups (default: none, i.e. every group expanded).
  const [collapsed, setCollapsed] = useState<TakeoffStatus[]>(readCollapsed);
  const toggleGroup = (status: TakeoffStatus) =>
    setCollapsed((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status];
      writeCollapsed(next);
      return next;
    });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(
        `Takeoff moved to Recently deleted (kept ${DELETED_TAKEOFF_RETENTION_DAYS} days)`,
      );
      setToDelete(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const restore = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Takeoff restored");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Restore failed"),
  });

  const takeoffs = list.data ?? [];
  const deleted = deletedQuery.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = takeoffs.filter((t) => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (kindFilter !== "all" && (t.underlay_kind === "pdf" ? "pdf" : "image") !== kindFilter)
      return false;
    if (statusFilter !== "all" && asTakeoffStatus(t.status) !== statusFilter) return false;
    return true;
  });
  // Grouped Draft → Done, in the list's order (newest update first) inside each group; the
  // filters apply first, and a group with nothing in it is left out.
  const groups = TAKEOFF_STATUSES.map((status) => ({
    status,
    rows: filtered.filter((t) => asTakeoffStatus(t.status) === status),
  })).filter((g) => g.rows.length > 0);
  const anyFilter = q !== "" || kindFilter !== "all" || statusFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setKindFilter("all");
    setStatusFilter("all");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Ruler className="h-6 w-6" /> Takeoffs
          </h1>
          <p className="text-sm text-muted-foreground">
            Open a plan-sheet PDF or an aerial screenshot, set the scale from a known dimension,
            then draw the roof areas, walls and counts.
          </p>
        </div>
        <Button size="lg" className="text-base font-semibold" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-5 w-5" /> New takeoff
        </Button>
      </div>

      {list.error ? (
        <p className="text-sm text-destructive">
          Could not load takeoffs (
          {list.error instanceof Error ? list.error.message : String(list.error)}). Try refreshing,
          or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading takeoffs…
        </p>
      ) : (
        <>
          {takeoffs.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
                Takeoff name
                <Input
                  type="search"
                  placeholder="Search by takeoff name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-background"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Kind
                <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as KindFilter)}>
                  <SelectTrigger className="w-[130px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All kinds</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Status
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  <SelectTrigger className="w-[140px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {TAKEOFF_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {TAKEOFF_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {anyFilter && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="mb-0.5">
                  Clear filters
                </Button>
              )}
              <span className="mb-2 ml-auto text-xs text-muted-foreground">
                {filtered.length} of {takeoffs.length} takeoff{takeoffs.length === 1 ? "" : "s"}
              </span>
            </div>
          )}

          {takeoffs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">No takeoffs yet.</p>
              <Button variant="outline" className="mt-4" onClick={() => setCreating(true)}>
                Start your first takeoff
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-muted-foreground">No takeoffs match these filters.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-8">
              {groups.map(({ status, rows }) => {
                const open = !collapsed.includes(status);
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                  <section key={status} aria-label={`${TAKEOFF_STATUS_LABELS[status]} takeoffs`}>
                    {/* Group header with a grey rule beneath it; empty groups are not shown.
                      Clicking it collapses/expands the group (remembered in localStorage). */}
                    <h2 className={`border-b border-border pb-1.5 ${open ? "mb-3" : ""}`}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={open}
                        aria-controls={`takeoffs-group-${status}`}
                        title={open ? "Collapse this group" : "Expand this group"}
                        onClick={() => toggleGroup(status)}
                      >
                        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-semibold uppercase tracking-wide">
                          {TAKEOFF_STATUS_LABELS[status]}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">
                          {rows.length} takeoff{rows.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    </h2>
                    {open && (
                      <div id={`takeoffs-group-${status}`} className="grid gap-3">
                        {rows.map((t) => (
                          <TakeoffListRow key={t.id} row={t} onDelete={() => setToDelete(t)} />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Recently deleted (soft-deleted takeoffs inside the retention window) */}
      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted"
          onClick={() => setShowDeleted((v) => !v)}
          aria-expanded={showDeleted}
        >
          <span>
            Recently deleted{deleted.length ? ` (${deleted.length})` : ""}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              kept {DELETED_TAKEOFF_RETENTION_DAYS} days, then removed for good
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{showDeleted ? "Hide" : "Show"}</span>
        </button>
        {showDeleted && (
          <div className="space-y-2 border-t p-4">
            {deletedQuery.error ? (
              <p className="text-sm text-destructive">
                Could not load Recently deleted:{" "}
                {deletedQuery.error instanceof Error
                  ? deletedQuery.error.message
                  : String(deletedQuery.error)}
              </p>
            ) : deletedQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : deleted.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in Recently deleted.</p>
            ) : (
              deleted.map((t) => {
                const left = daysLeft(t.deleted_at);
                return (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Deleted {t.deleted_at ? new Date(t.deleted_at).toLocaleDateString() : "—"} ·{" "}
                        {left} day{left === 1 ? "" : "s"} left ·{" "}
                        {t.underlay_kind === "pdf" ? "PDF" : "Image"}
                        {t.file_name ? ` · ${t.file_name}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(t.id)}
                    >
                      <RotateCcw className="mr-1 h-4 w-4" />
                      Restore
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <NewTakeoffDialog open={creating} onOpenChange={setCreating} />

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The takeoff and its drawing move to Recently deleted, where you can restore them for{" "}
              {DELETED_TAKEOFF_RETENTION_DAYS} days. After that they are removed for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One takeoff in the list: a card-like row with its file, pages, last update and linked bid. */
function TakeoffListRow({ row: t, onDelete }: { row: TakeoffWithBid; onDelete: () => void }) {
  const status = asTakeoffStatus(t.status);
  const pageCount = takeoffDoc(t).pages.length;
  const isPdf = t.underlay_kind === "pdf";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 transition-colors duration-150 hover:border-primary/40 hover:bg-muted/40">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/takeoff"
            search={{ id: t.id }}
            className="font-medium underline-offset-2 hover:underline"
            title="Open this takeoff"
          >
            {t.name}
          </Link>
          <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] font-medium">
            {isPdf ? <FileText className="h-3 w-3" /> : <FileImage className="h-3 w-3" />}
            {isPdf ? "PDF" : "Image"}
          </Badge>
          <Badge
            variant={status === "done" ? "default" : "secondary"}
            className="px-1.5 py-0 text-[11px]"
          >
            {TAKEOFF_STATUS_LABELS[status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t.file_name && (
            <span className="inline-block max-w-[320px] truncate align-bottom">{t.file_name}</span>
          )}
          {t.file_size !== null && <span className="ml-1 text-xs">({fileSize(t.file_size)})</span>}
          {t.file_name || t.file_size !== null ? " · " : ""}
          {pageCount} page{pageCount === 1 ? "" : "s"} · Last updated {when(t.updated_at)}
          {t.updated_by_name ? ` by ${t.updated_by_name}` : ""}
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          {t.bid ? (
            <>
              <span className="text-muted-foreground">Bid:</span>
              <Link
                to="/estimate"
                search={{ bid: t.bid.id }}
                className="font-medium underline-offset-2 hover:underline"
                title="Open the bid made from this takeoff"
              >
                {t.bid.name}
              </Link>
              <BidStatusBadge status={t.bid.status} />
            </>
          ) : (
            <span className="text-muted-foreground">No bid yet</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button asChild size="sm" variant="outline">
          <Link to="/takeoff" search={{ id: t.id }}>
            Open
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          title="Delete this takeoff"
          aria-label={`Delete ${t.name}`}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function NewTakeoffDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createFn = useServerFn(createTakeoff);
  const deleteFn = useServerFn(deleteTakeoff);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setFile(null);
    setBusy(null);
  };

  const pickFile = (f: File | null) => {
    if (!f) return setFile(null);
    if (!ACCEPT.includes(f.type)) {
      toast.error("Choose a PDF, PNG or JPEG file.");
      return setFile(null);
    }
    if (f.size > MAX_BYTES) {
      toast.error("That file is over 100 MB.");
      return setFile(null);
    }
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    if (!file || !name.trim() || busy) return;
    const isPdf = file.type === "application/pdf";
    let pages: TakeoffSheet[];
    try {
      setBusy("Reading the file…");
      if (isPdf) {
        const n = await pdfPageCount(file);
        pages = Array.from({ length: n }, (_, i) => ({
          index: i,
          name: `Page ${i + 1}`,
          rotation: 0,
          scale: null,
        }));
      } else {
        pages = [{ index: 0, name: file.name.slice(0, 120), rotation: 0, scale: null }];
      }
    } catch (e) {
      setBusy(null);
      toast.error(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    let row: TakeoffRow;
    try {
      setBusy("Creating the takeoff…");
      row = await createFn({
        data: {
          name: name.trim(),
          underlay_kind: isPdf ? "pdf" : "image",
          file_name: file.name,
          file_size: file.size,
          pages,
        },
      });
    } catch (e) {
      setBusy(null);
      toast.error(`Could not create the takeoff: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    setBusy("Uploading the file…");
    const path = row.file_path;
    const { error } = path
      ? await supabase.storage
          .from(TAKEOFF_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: true })
      : { error: new Error("the takeoff has no file path") };
    if (error) {
      await deleteFn({ data: { id: row.id } }).catch(() => {});
      setBusy(null);
      toast.error(`Upload failed: ${error.message}`);
      return;
    }

    void qc.invalidateQueries({ queryKey: ["takeoffs"] });
    reset();
    props.onOpenChange(false);
    void navigate({ to: "/takeoff", search: { id: row.id } });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) reset();
        props.onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New takeoff</DialogTitle>
          <DialogDescription>
            A plan-set PDF (every sheet becomes a page) or an aerial screenshot (PNG or JPEG), up to
            100 MB.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="takeoff-file">Plan file</Label>
            <Input
              id="takeoff-file"
              type="file"
              accept={ACCEPT.join(",")}
              disabled={!!busy}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {fileSize(file.size)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="takeoff-name">Name</Label>
            <Input
              id="takeoff-name"
              value={name}
              disabled={!!busy}
              placeholder="e.g. Smith Warehouse roof"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!!busy}
              onClick={() => {
                reset();
                props.onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!file || !name.trim() || !!busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> {busy}
                </>
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
