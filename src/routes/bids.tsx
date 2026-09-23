import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers, PlusCircle, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  DELETED_BID_RETENTION_DAYS,
  deleteBid,
  listBids,
  listDeletedBids,
  purgeBid,
  restoreBid,
} from "@/lib/bids.functions";
import { useAuth } from "@/lib/auth-store";
import { BID_STATUSES, STATUS_LABELS, STATUS_BADGE_CLASSES, asBidStatus } from "@/lib/bid-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const Route = createFileRoute("/bids")({
  head: () => ({
    meta: [
      { title: "Saved Bids — Bid-O-Matic" },
      {
        name: "description",
        content: "View and manage saved Duro-Last roofing estimates.",
      },
      {
        property: "og:title",
        content: "Saved Bids — Bid-O-Matic",
      },
      {
        property: "og:description",
        content: "View and manage saved Duro-Last roofing estimates.",
      },
    ],
  }),
  // No route loader: it would run during SSR before the browser can attach the
  // auth token, and listBids requires a signed-in user. Fetch client-side only.
  component: BidsPage,
});

const NO_ESTIMATOR = "__none__";
/** Roof systems a bid uses: the Setup default plus any per-section override. */
const roofSystemsOf = (bid: { data: unknown }): string[] => {
  const d = bid.data as {
    roofSystem?: string;
    sections?: { roofSystem?: string }[];
  } | null;
  const out = new Set<string>();
  if (d?.roofSystem) out.add(d.roofSystem);
  for (const s of d?.sections ?? []) if (s.roofSystem) out.add(s.roofSystem);
  return [...out];
};
/** Estimator's Name as keyed on Setup › Bid Info (customer.estimatorName); "" when blank. */
const estimatorOf = (bid: { data: unknown }): string => {
  const d = bid.data as { customer?: { estimatorName?: string } } | null;
  return d?.customer?.estimatorName?.trim() ?? "";
};

function BidsPage() {
  const navigate = useNavigate();
  const listBidsFn = useServerFn(listBids);
  const { session } = useAuth();
  // Only fetch with a live session — otherwise the server fn 401s (e.g. a mobile browser whose
  // token expired while backgrounded); AuthGate handles the redirect to /login.
  const {
    data: bids,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["bids"],
    queryFn: listBidsFn,
    enabled: !!session,
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [estimatorFilter, setEstimatorFilter] = useState("all");
  const [systemFilter, setSystemFilter] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  // Bid Combiner (legacy BidAdvantage.BidCombiner, docs §22.41): tick two or more bids, then
  // "Combine" opens a NEW estimate merged from them.
  const [combineSel, setCombineSel] = useState<string[]>([]);
  const toggleCombine = (id: string) =>
    setCombineSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const qc = useQueryClient();
  const deleteBidFn = useServerFn(deleteBid);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bids"] });
    void qc.invalidateQueries({ queryKey: ["bids-deleted"] });
  };
  const del = useMutation({
    mutationFn: (id: string) => deleteBidFn({ data: { id } }),
    onSuccess: () => {
      toast.success(`Bid moved to Recently deleted (kept ${DELETED_BID_RETENTION_DAYS} days)`);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
    onSettled: () => setConfirmDelete(null),
  });
  // Recently deleted bin: soft-deleted bids inside the retention window, with Restore / Purge.
  const listDeletedFn = useServerFn(listDeletedBids);
  const restoreFn = useServerFn(restoreBid);
  const purgeFn = useServerFn(purgeBid);
  const [showDeleted, setShowDeleted] = useState(false);
  const deletedQuery = useQuery({
    queryKey: ["bids-deleted"],
    queryFn: listDeletedFn,
    enabled: !!session,
  });
  const restore = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Bid restored");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Restore failed"),
  });
  const [confirmPurge, setConfirmPurge] = useState<{ id: string; name: string } | null>(null);
  const purge = useMutation({
    mutationFn: (id: string) => purgeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Bid permanently deleted");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
    onSettled: () => setConfirmPurge(null),
  });
  const deletedBids = deletedQuery.data ?? [];
  const daysLeft = (deletedAt: string | null) => {
    const t = deletedAt ? new Date(deletedAt).getTime() : Date.now();
    const end = t + DELETED_BID_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)));
  };

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't load bids ({error instanceof Error ? error.message : "unknown error"}). Try
        refreshing, or sign in again.
      </p>
    );
  }
  if (isLoading || !bids) {
    return <p className="text-sm text-muted-foreground">Loading bids…</p>;
  }

  // Estimator names as saved on Setup › Bid Info; "" = not entered.
  const estimators = Array.from(new Set(bids.map(estimatorOf)))
    .filter((e) => e !== "")
    .sort((a, b) => a.localeCompare(b));
  const roofSystems = Array.from(new Set(bids.flatMap(roofSystemsOf))).sort((a, b) =>
    a.localeCompare(b),
  );
  const q = search.trim().toLowerCase();
  const fromMs = createdFrom ? new Date(`${createdFrom}T00:00:00`).getTime() : null;
  const toMs = createdTo ? new Date(`${createdTo}T23:59:59.999`).getTime() : null;
  const minPrice = priceMin.trim() === "" ? null : Number(priceMin);
  const maxPrice = priceMax.trim() === "" ? null : Number(priceMax);
  const filtered = bids.filter((b) => {
    if (statusFilter !== "all" && asBidStatus(b.status) !== statusFilter) return false;
    if (q && !b.name.toLowerCase().includes(q)) return false;
    if (estimatorFilter !== "all") {
      const est = estimatorOf(b);
      if (estimatorFilter === NO_ESTIMATOR ? est !== "" : est !== estimatorFilter) return false;
    }
    if (systemFilter !== "all" && !roofSystemsOf(b).includes(systemFilter)) return false;
    const created = new Date(b.created_at).getTime();
    if (fromMs !== null && created < fromMs) return false;
    if (toMs !== null && created > toMs) return false;
    const total = Number(b.grand_total ?? 0);
    if (minPrice !== null && Number.isFinite(minPrice) && total < minPrice) return false;
    if (maxPrice !== null && Number.isFinite(maxPrice) && total > maxPrice) return false;
    return true;
  });
  const anyFilter =
    statusFilter !== "all" ||
    q !== "" ||
    estimatorFilter !== "all" ||
    systemFilter !== "all" ||
    createdFrom !== "" ||
    createdTo !== "" ||
    priceMin !== "" ||
    priceMax !== "";
  const clearFilters = () => {
    setStatusFilter("all");
    setSearch("");
    setEstimatorFilter("all");
    setSystemFilter("all");
    setCreatedFrom("");
    setCreatedTo("");
    setPriceMin("");
    setPriceMax("");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Saved Bids</h1>
        <div className="flex flex-wrap items-center gap-2">
          {combineSel.length > 0 && (
            <>
              <Button
                variant="outline"
                size="lg"
                disabled={combineSel.length < 2}
                title={
                  combineSel.length < 2
                    ? "Tick two or more bids to combine them"
                    : "Open a new bid merged from the ticked bids (sections, parapets, curbs, accessories, metals and Non-DL items; per-job items are recalculated once)"
                }
                onClick={() =>
                  navigate({ to: "/estimate", search: { combine: combineSel.join(",") } })
                }
              >
                <Layers className="mr-2 h-5 w-5" />
                Combine {combineSel.length} bid{combineSel.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCombineSel([])}>
                Clear selection
              </Button>
            </>
          )}
          <Button asChild size="lg" className="text-base font-semibold">
            <Link to="/estimate">
              <PlusCircle className="mr-2 h-5 w-5" />
              New Bid
            </Link>
          </Button>
        </div>
      </div>

      {bids.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Bid name
            <Input
              type="search"
              placeholder="Search by bid name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-background"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Status
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {BID_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Estimator
            <Select value={estimatorFilter} onValueChange={setEstimatorFilter}>
              <SelectTrigger className="w-[170px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All estimators</SelectItem>
                {estimators.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
                {bids.some((b) => estimatorOf(b) === "") && (
                  <SelectItem value={NO_ESTIMATOR}>(no estimator)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Roof system
            <Select value={systemFilter} onValueChange={setSystemFilter}>
              <SelectTrigger className="w-[160px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All systems</SelectItem>
                {roofSystems.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <fieldset className="flex flex-col gap-1 text-xs text-muted-foreground">
            <legend className="mb-1">Created between</legend>
            <div className="flex items-center rounded-md border bg-background shadow-sm">
              <Input
                type="date"
                aria-label="Created on or after"
                value={createdFrom}
                max={createdTo || undefined}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className="w-[148px] border-0 shadow-none focus-visible:ring-0"
              />
              <span className="px-1.5 text-muted-foreground">–</span>
              <Input
                type="date"
                aria-label="Created on or before"
                value={createdTo}
                min={createdFrom || undefined}
                onChange={(e) => setCreatedTo(e.target.value)}
                className="w-[148px] border-0 shadow-none focus-visible:ring-0"
              />
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1 text-xs text-muted-foreground">
            <legend className="mb-1">Price between</legend>
            <div className="flex items-center rounded-md border bg-background shadow-sm">
              <span className="pl-2.5 text-muted-foreground">$</span>
              <Input
                type="number"
                inputMode="decimal"
                aria-label="Minimum price"
                min={0}
                step="any"
                placeholder="Min"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                className="w-[100px] border-0 pl-1 shadow-none focus-visible:ring-0"
              />
              <span className="px-1.5 text-muted-foreground">–</span>
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                inputMode="decimal"
                aria-label="Maximum price"
                min={priceMin || 0}
                step="any"
                placeholder="Max"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                className="w-[100px] border-0 pl-1 shadow-none focus-visible:ring-0"
              />
            </div>
          </fieldset>
          {anyFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="mb-0.5">
              Clear filters
            </Button>
          )}
          <span className="mb-2 ml-auto text-xs text-muted-foreground">
            {filtered.length} of {bids.length} bid{bids.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {bids.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No bids yet.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/estimate">Create your first bid</Link>
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No bids match these filters.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((bid) => {
            const st = asBidStatus(bid.status);
            return (
              <div
                key={bid.id}
                role="link"
                tabIndex={0}
                title="Open this bid"
                className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border p-4 transition-all duration-150 hover:scale-[1.015] hover:border-primary/40 hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => navigate({ to: "/estimate", search: { bid: bid.id } })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void navigate({ to: "/estimate", search: { bid: bid.id } });
                  }
                }}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 cursor-pointer"
                    aria-label={`Select ${bid.name} to combine`}
                    title="Tick to combine with other bids"
                    checked={combineSel.includes(bid.id)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={() => toggleCombine(bid.id)}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{bid.name}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[st]}`}
                      >
                        {STATUS_LABELS[st]}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Estimator: {estimatorOf(bid) || "—"} · Created{" "}
                      {new Date(bid.created_at).toLocaleDateString()} · Last saved{" "}
                      {new Date(bid.updated_at).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {/* Stored at save time — the estimator recomputes live, so an engine change
                      (or an empty-data row) can differ from this until the bid is re-saved. */}
                  <span
                    className="text-sm font-semibold tabular-nums"
                    title="Total as of the last save — open the bid for the live figure"
                  >
                    {money(Number(bid.grand_total ?? 0))}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      (last saved)
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    title="Delete this bid"
                    disabled={del.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete({ id: bid.id, name: bid.name });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recently deleted (soft-deleted bids inside the retention window) */}
      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted"
          onClick={() => setShowDeleted((v) => !v)}
          aria-expanded={showDeleted}
        >
          <span>
            Recently deleted{deletedBids.length ? ` (${deletedBids.length})` : ""}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              kept {DELETED_BID_RETENTION_DAYS} days, then removed for good
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{showDeleted ? "Hide" : "Show"}</span>
        </button>
        {showDeleted && (
          <div className="space-y-2 border-t p-4">
            {deletedQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : deletedBids.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in Recently deleted.</p>
            ) : (
              deletedBids.map((bid) => (
                <div
                  key={bid.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{bid.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Deleted {bid.deleted_at ? new Date(bid.deleted_at).toLocaleDateString() : "—"}{" "}
                      · {daysLeft(bid.deleted_at)} day{daysLeft(bid.deleted_at) === 1 ? "" : "s"}{" "}
                      left · {money(Number(bid.grand_total ?? 0))}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={restore.isPending || purge.isPending}
                      onClick={() => restore.mutate(bid.id)}
                    >
                      <RotateCcw className="mr-1 h-4 w-4" />
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={restore.isPending || purge.isPending}
                      onClick={() => setConfirmPurge({ id: bid.id, name: bid.name })}
                    >
                      Delete permanently
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <AlertDialog
        open={confirmPurge !== null}
        onOpenChange={(open) => {
          if (!open && !purge.isPending) setConfirmPurge(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bid permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmPurge?.name}” and everything saved in it will be removed for good. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purge.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={purge.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmPurge) purge.mutate(confirmPurge.id);
              }}
            >
              {purge.isPending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && !del.isPending) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bid?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.name}” will move to Recently deleted, where you can restore it for{" "}
              {DELETED_BID_RETENTION_DAYS} days. After that it is removed for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={del.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) del.mutate(confirmDelete.id);
              }}
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
