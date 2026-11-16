/**
 * Trade Bids, the list (owner, Nov 16: "Put it under estimate pricing and have it similar to
 * project bids, listing the info on the bids then have a new button trade bids that pops up two
 * options, a dropdown of the existing types of bids (painting etc) or starting a new one." …
 * "I don't want that list combined with project bids").
 *
 * So this is Project Bids' twin (routes/bids.tsx) for the bids that are not roofing: the same
 * groups Draft → Submitted → Won → Lost, the same row, the same status box, Copy, Documents,
 * Delete and "Recently deleted" bin. It reads trade bids only, and its bin holds trade bids
 * only; the roofing list is never read here.
 *
 * A trade bid is a row of the same table as a roofing bid, so every action on a row goes
 * through the SAME server function Project Bids calls (bids.functions.ts): a status change, a
 * copy or a delete here follows exactly the rules it follows there, and nothing is written
 * twice. What differs is where a bid opens: /trade-bids?bid=…, never the roofing estimator.
 *
 * What the list shows (search, the Trade filter, the groups and their totals) is decided in
 * lib/trade-bids-list.ts, where it is tested.
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Pencil,
  PlusCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import {
  BID_STATUSES,
  STATUS_LABELS,
  asBidStatus,
  bidOfficeToday,
  type BidStatus,
} from "@/lib/bid-status";
import {
  DELETED_BID_RETENTION_DAYS,
  deleteBid,
  duplicateBid,
  listDeletedBids,
  purgeBid,
  renameBid,
  restoreBid,
  setBidStatus,
} from "@/lib/bids.functions";
import { duplicateBidName } from "@/lib/duplicate-bid";
import { localYmd } from "@/lib/my-work";
import { fmtMoney } from "@/lib/trade-bid";
import {
  binDaysLeft,
  customerOf,
  filterRows,
  groupByStatus,
  hoursText,
  tradeNames,
} from "@/lib/trade-bids-list";
import { listTradeBids, type TradeBidListRow } from "@/lib/trade-bids.functions";
import { bidOverdueDays } from "@/lib/work-counts";
import { TRADE_PROPOSAL_TEMPLATE } from "@/lib/documents/defaults";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { LostReasonDialog } from "@/components/lost-reason-dialog";
import { NewTradeBidDialog } from "@/components/trade/new-trade-bid-dialog";
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

/** The Trade filter's "All trades" choice (a select item cannot have a blank value). */
const ALL_TRADES = "__all__";

/** "Oct 20, 2026" for a YYYY-MM-DD day (a calendar day: no time zone shift). */
const dueLabel = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const bidsWord = (n: number) => `${n} bid${n === 1 ? "" : "s"}`;
const jobName = (name: string) => name.trim() || "Untitled bid";

/**
 * Status groups the user has closed, remembered across reloads (per browser). Its own key:
 * closing "Lost" here must not close it on Project Bids.
 */
const COLLAPSED_KEY = "bid-o-matic:trade-bids-collapsed";
const readCollapsed = (): BidStatus[] => {
  try {
    if (typeof window === "undefined") return [];
    const raw: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(raw) ? BID_STATUSES.filter((s) => raw.includes(s)) : [];
  } catch {
    return [];
  }
};
const writeCollapsed = (statuses: BidStatus[]) => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(statuses));
  } catch {
    // Storage unavailable (private mode, blocked site data): closing still works this visit.
  }
};

export function TradeBidsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session } = useAuth();

  // Only fetch with a live session, as Project Bids does: without one the server refuses, and
  // the sign-in gate is already sending the user to the login page.
  const listFn = useServerFn(listTradeBids);
  const {
    data: bids,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["trade-bids"],
    queryFn: () => listFn(),
    enabled: !!session,
  });

  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [trade, setTrade] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<BidStatus[]>(readCollapsed);
  const toggleGroup = (status: BidStatus) =>
    setCollapsed((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status];
      writeCollapsed(next);
      return next;
    });

  const openBid = (id: string) => void navigate({ to: "/trade-bids", search: { bid: id } });

  /** After any change: the list, and the bin under it. */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["trade-bids"] });
    void qc.invalidateQueries({ queryKey: ["trade-bids-deleted"] });
  };
  // The row shows its new status (or name) the moment the server has it, without waiting for
  // the whole list to come back; the refresh that follows then confirms it.
  const patchRow = (id: string, patch: Partial<TradeBidListRow>) =>
    qc.setQueryData<TradeBidListRow[]>(["trade-bids"], (old) =>
      old ? old.map((r) => (r.id === id ? { ...r, ...patch } : r)) : old,
    );

  // Status: saved at once from the row. Lost asks why; Won asks the day (the Margin report
  // counts a won bid on that day), exactly as on Project Bids.
  const setStatusFn = useServerFn(setBidStatus);
  const [lostFor, setLostFor] = useState<{ id: string; name: string } | null>(null);
  const [wonFor, setWonFor] = useState<{ id: string; name: string; day: string } | null>(null);
  const setStatus = useMutation({
    mutationFn: (v: {
      id: string;
      status: BidStatus;
      lostReason?: string | null;
      wonOn?: string | null;
    }) => setStatusFn({ data: v }),
    onSuccess: (b, v) => {
      toast.success(`Status: ${STATUS_LABELS[asBidStatus(b.status)]}`);
      patchRow(b.id, {
        status: b.status,
        lost_reason: v.status === "lost" ? (v.lostReason ?? null) : null,
        updated_at: b.updated_at,
        updated_by_name: b.updated_by_name,
      });
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not change the status"),
  });

  // Rename: the job name, changed without opening the bid (as on Project Bids since Nov 3).
  const renameFn = useServerFn(renameBid);
  const [renameFor, setRenameFor] = useState<{ id: string; name: string; newName: string } | null>(
    null,
  );
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => renameFn({ data: v }),
    onSuccess: (b) => {
      setRenameFor(null);
      toast.success(`Renamed to "${b.name}"`);
      patchRow(b.id, {
        name: b.name,
        updated_at: b.updated_at,
        updated_by_name: b.updated_by_name,
      });
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not rename the bid"),
  });

  // Copy: the copy's job name and due date are asked first (a new bid must have a due date),
  // then the copy is made and opened.
  const duplicateFn = useServerFn(duplicateBid);
  const [copyFor, setCopyFor] = useState<{
    id: string;
    name: string;
    newName: string;
    dueDate: string;
  } | null>(null);
  const duplicate = useMutation({
    mutationFn: (v: { id: string; name: string; dueDate: string }) => duplicateFn({ data: v }),
    onSuccess: (copy) => {
      setCopyFor(null);
      toast.success(`Copied as "${copy.name}". Opening the copy.`);
      refresh();
      openBid(copy.id);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not copy the bid"),
  });

  // Delete: into "Recently deleted", where it can be brought back for a while.
  const deleteFn = useServerFn(deleteBid);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(`Bid moved to Recently deleted (kept ${DELETED_BID_RETENTION_DAYS} days)`);
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not delete the bid"),
    onSettled: () => setConfirmDelete(null),
  });

  // Recently deleted: trade bids only. Project Bids has its own bin for roofing bids, so a
  // deleted painting bid is looked for (and found) here, where it was.
  const listDeletedFn = useServerFn(listDeletedBids);
  const restoreFn = useServerFn(restoreBid);
  const purgeFn = useServerFn(purgeBid);
  const [showDeleted, setShowDeleted] = useState(false);
  const deletedQuery = useQuery({
    queryKey: ["trade-bids-deleted"],
    queryFn: () => listDeletedFn({ data: { kind: "trade" } }),
    enabled: !!session,
  });
  const deletedBids = deletedQuery.data ?? [];
  const restore = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Bid restored");
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not restore the bid"),
  });
  const [confirmPurge, setConfirmPurge] = useState<{ id: string; name: string } | null>(null);
  const purge = useMutation({
    mutationFn: (id: string) => purgeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Bid deleted forever");
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not delete the bid"),
    onSettled: () => setConfirmPurge(null),
  });

  // Documents: one panel for the whole list, showing the bid whose button was clicked.
  const [documentsFor, setDocumentsFor] = useState<{ id: string; name: string } | null>(null);

  const all = bids ?? [];
  const trades = tradeNames(all);
  // A trade whose last bid was just deleted is no longer a choice: fall back to all trades
  // instead of leaving the list empty behind a filter nobody can see.
  const tradeFilter = trade !== null && trades.includes(trade) ? trade : null;
  const anyFilter = search.trim() !== "" || tradeFilter !== null;
  const groups = groupByStatus(filterRows(all, { search, trade: tradeFilter }));
  // The viewer's day, for the Overdue tag (the day Work Overview uses).
  const today = localYmd(new Date());

  const newButton = (hook: Record<string, string>) => (
    <Button
      size="lg"
      className="text-base font-semibold"
      onClick={() => setNewOpen(true)}
      {...hook}
    >
      <PlusCircle className="mr-2 h-5 w-5" />
      New trade bid
    </Button>
  );

  /** One bid's row. The whole row opens the bid; its controls do their own job and stop there. */
  const renderBid = (bid: TradeBidListRow) => {
    const st = asBidStatus(bid.status);
    const overdueDays = bidOverdueDays(bid, today);
    const hours = hoursText(bid.hours);
    const name = jobName(bid.name);
    return (
      <div
        key={bid.id}
        data-trade-row={bid.id}
        role="link"
        tabIndex={0}
        title="Open this bid"
        className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border p-4 transition-all duration-150 hover:scale-[1.015] hover:border-primary/40 hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => openBid(bid.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openBid(bid.id);
          }
        }}
      >
        {/* Takes the room the controls leave; on a phone the controls drop under it, so the
            page never scrolls sideways. Long names break instead of pushing the row wider. */}
        <div className="min-w-0 flex-1 basis-80" data-part="bid-info">
          {/* A div, not a paragraph: the trade tag is a block of its own and may not sit in one. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            <span className="min-w-0 break-words" data-row-name>
              {name}
            </span>
            {bid.trade_name && (
              <Badge variant="secondary" className="max-w-full font-medium" data-row-trade>
                <span className="min-w-0 truncate">{bid.trade_name}</span>
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground"
              title="Rename this bid"
              data-action="rename-bid"
              onClick={(e) => {
                e.stopPropagation();
                setRenameFor({ id: bid.id, name: bid.name, newName: bid.name });
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="sr-only">Rename</span>
            </Button>
          </div>
          <p className="break-words text-sm text-muted-foreground">
            Customer: {customerOf(bid) || "—"} · Estimator: {bid.estimator_name || "—"} · Created{" "}
            {new Date(bid.created_at).toLocaleDateString()} · Last saved{" "}
            {new Date(bid.updated_at).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
            {bid.updated_by_name ? ` by ${bid.updated_by_name}` : ""}
            {hours ? ` · ${hours}` : ""}
            {st === "lost" && bid.lost_reason ? ` · Lost: ${bid.lost_reason}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-part="bid-controls">
          {/* The due date, red with the day count when a draft is past it (bidOverdueDays, the
              rule Project Bids uses: a submitted, won or lost bid is never overdue). */}
          <span
            className="min-w-[6.5rem] text-right text-xs tabular-nums text-muted-foreground"
            data-col="due"
            title="When the bid must go out. Draft bids sit on Work Overview by this day."
          >
            {bid.due_date ? (
              <>
                Due {dueLabel(bid.due_date)}
                {overdueDays !== null && (
                  <span className="mt-0.5 block font-semibold text-destructive" data-line="overdue">
                    Overdue {overdueDays} day{overdueDays === 1 ? "" : "s"}
                  </span>
                )}
              </>
            ) : (
              "No due date"
            )}
          </span>
          {/* The total as it was saved. The bid itself works the price out again when it is
              opened, so the two can differ until the bid is saved again: hence "(last saved)". */}
          <span
            className="whitespace-nowrap text-right text-sm font-semibold tabular-nums"
            title="Total as of the last save. Open the bid for today's figure."
            data-row-total
          >
            {fmtMoney(bid.grand_total)}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">(last saved)</span>
          </span>
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Select
              value={st}
              onValueChange={(v) =>
                v === "won"
                  ? setWonFor({ id: bid.id, name, day: bidOfficeToday() })
                  : v === "lost"
                    ? setLostFor({ id: bid.id, name })
                    : setStatus.mutate({ id: bid.id, status: v as BidStatus })
              }
            >
              <SelectTrigger
                className="h-8 w-[6.75rem] gap-1 px-2 text-xs md:h-7"
                aria-label="Bid status"
                data-row-status
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BID_STATUSES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {STATUS_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-0.5" data-part="bid-actions">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 md:h-7 md:w-7"
              title="Copy this bid (a new draft copy, named in a popup)"
              data-action="copy-bid"
              disabled={duplicate.isPending}
              onClick={(e) => {
                e.stopPropagation();
                setCopyFor({
                  id: bid.id,
                  name,
                  newName: duplicateBidName(bid.name),
                  dueDate: bid.due_date ?? "",
                });
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Copy className="h-4 w-4" />
              <span className="sr-only">Copy</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 md:h-7 md:w-7"
              title="Documents (proposals, letters)"
              data-action="bid-documents"
              onClick={(e) => {
                e.stopPropagation();
                setDocumentsFor({ id: bid.id, name });
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <FileText className="h-4 w-4" />
              <span className="sr-only">Documents</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive md:h-7 md:w-7"
              title="Delete this bid"
              data-action="delete-bid"
              disabled={del.isPending}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete({ id: bid.id, name });
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete</span>
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6" data-trade-bids-list>
      {/* The heading and the New button stay put whatever the list is doing: a bid can be
          started while the list is still loading, or when it failed to load. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-2xl font-bold tracking-tight">Trade Bids</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bids for work other than roofing, such as painting or siding. Each one starts from a
            trade you have set up.
          </p>
        </div>
        {newButton({ "data-new-trade-bid": "" })}
      </div>

      {!bids && error ? (
        <div className="space-y-3 rounded-lg border border-dashed p-8 text-center" role="alert">
          <p className="font-medium">The trade bids could not be loaded.</p>
          <p className="text-sm text-muted-foreground">
            Try again. If it keeps happening, sign out and sign in again.
          </p>
          {error instanceof Error && error.message && (
            <p className="text-xs text-muted-foreground">What went wrong: {error.message}</p>
          )}
          <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Trying…" : "Try again"}
          </Button>
        </div>
      ) : !bids ? (
        <p className="text-sm text-muted-foreground">Loading the trade bids…</p>
      ) : bids.length === 0 ? (
        <div className="space-y-4 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No trade bids yet.</p>
          {newButton({ "data-new-trade-bid-empty": "" })}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Search
              <Input
                type="search"
                placeholder="Job name, customer, trade or estimator…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-background"
                data-trade-search
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Trade
              <Select
                value={tradeFilter ?? ALL_TRADES}
                onValueChange={(v) => setTrade(v === ALL_TRADES ? null : v)}
              >
                <SelectTrigger className="w-[190px] max-w-full bg-background" data-trade-filter>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TRADES}>All trades</SelectItem>
                  {trades.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {anyFilter && (
              <Button
                variant="ghost"
                size="sm"
                data-trade-clear
                onClick={() => {
                  setSearch("");
                  setTrade(null);
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No bids match.
            </p>
          ) : (
            <div className="grid gap-8">
              {groups.map(({ status, rows, count, total }) => {
                const open = !collapsed.includes(status);
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                  <section
                    key={status}
                    aria-label={`${STATUS_LABELS[status]} bids`}
                    data-trade-group={status}
                  >
                    {/* Clicking the heading closes or opens the group (remembered in this
                        browser). The count and the dollars stay in view while it is closed. */}
                    <h2 className={`border-b border-border pb-1.5 ${open ? "mb-3" : ""}`}>
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-center gap-2 rounded-sm text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={open}
                        aria-controls={`trade-bids-group-${status}`}
                        title={open ? "Close this group" : "Open this group"}
                        onClick={() => toggleGroup(status)}
                      >
                        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-semibold uppercase tracking-wide">
                          {STATUS_LABELS[status]}
                        </span>
                        <span
                          className="text-xs font-normal text-muted-foreground"
                          data-group-count
                        >
                          {bidsWord(count)}
                        </span>
                        <span
                          className="text-xs font-normal tabular-nums text-muted-foreground"
                          data-group-total
                        >
                          · {fmtMoney(total)}
                        </span>
                      </button>
                    </h2>
                    {open && (
                      <div id={`trade-bids-group-${status}`} className="grid gap-3">
                        {rows.map(renderBid)}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Recently deleted: trade bids deleted in the last while, with a way back. */}
      <div className="rounded-lg border" data-trade-bin>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted"
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
            {deletedQuery.error ? (
              <p className="text-sm text-muted-foreground" role="alert">
                The deleted bids could not be loaded. Refresh the page to try again.
              </p>
            ) : !deletedQuery.data ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : deletedBids.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in Recently deleted.</p>
            ) : (
              deletedBids.map((bid) => {
                const left = binDaysLeft(bid.deleted_at, Date.now(), DELETED_BID_RETENTION_DAYS);
                return (
                  <div
                    key={bid.id}
                    data-trade-bin-row={bid.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="break-words font-medium">{jobName(bid.name)}</p>
                      <p className="text-xs text-muted-foreground">
                        Deleted{" "}
                        {bid.deleted_at ? new Date(bid.deleted_at).toLocaleDateString() : "—"} ·{" "}
                        {left} day{left === 1 ? "" : "s"} left ·{" "}
                        {fmtMoney(Number(bid.grand_total ?? 0))}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
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
                        onClick={() => setConfirmPurge({ id: bid.id, name: jobName(bid.name) })}
                      >
                        Delete forever
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <NewTradeBidDialog open={newOpen} onOpenChange={setNewOpen} />

      {documentsFor && (
        <DocumentsPanel
          kind="bid"
          bidId={documentsFor.id}
          recordLabel={documentsFor.name}
          prefer={TRADE_PROPOSAL_TEMPLATE}
          open
          onOpenChange={(o) => {
            if (!o) setDocumentsFor(null);
          }}
        />
      )}

      {lostFor && (
        <LostReasonDialog
          open
          bidName={lostFor.name}
          onCancel={() => setLostFor(null)}
          onConfirm={(reason) => {
            setStatus.mutate({ id: lostFor.id, status: "lost", lostReason: reason });
            setLostFor(null);
          }}
        />
      )}

      {/* The day the bid was won, asked when it is marked Won here (owner, Oct 21: "a way to
          adjust the date the bid was won to ensure the data appears correctly"). */}
      {wonFor && (
        <Dialog open onOpenChange={(o) => !o && setWonFor(null)}>
          <DialogContent className="sm:max-w-sm" data-dialog="won-on">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStatus.mutate({ id: wonFor.id, status: "won", wonOn: wonFor.day || null });
                setWonFor(null);
              }}
            >
              <DialogHeader>
                <DialogTitle>When was it won?</DialogTitle>
                <DialogDescription>
                  {wonFor.name} is being marked Won. The Margin report counts it on this day.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1 py-3">
                <Label htmlFor="trade-bid-won-on">Won on</Label>
                <Input
                  id="trade-bid-won-on"
                  type="date"
                  autoFocus
                  value={wonFor.day}
                  onChange={(e) => setWonFor({ ...wonFor, day: e.target.value })}
                  className="w-[11rem]"
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setWonFor(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={setStatus.isPending}>
                  Mark won
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {renameFor && (
        <Dialog open onOpenChange={(o) => !o && !rename.isPending && setRenameFor(null)}>
          <DialogContent className="sm:max-w-md" data-dialog="rename-bid">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = renameFor.newName.trim();
                if (!name) {
                  toast.error("Give the bid a job name.");
                  return;
                }
                if (rename.isPending) return;
                // Nothing changed: close without a save, so "Last saved by" stays true.
                if (name === renameFor.name) {
                  setRenameFor(null);
                  return;
                }
                rename.mutate({ id: renameFor.id, name });
              }}
            >
              <DialogHeader>
                <DialogTitle>Rename bid</DialogTitle>
                <DialogDescription>
                  The job name shown here and on the bid. Documents already made from the bid keep
                  the name they were made with.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1 py-3">
                <Label htmlFor="trade-bid-rename">Job name</Label>
                <Input
                  id="trade-bid-rename"
                  autoFocus
                  maxLength={200}
                  value={renameFor.newName}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setRenameFor({ ...renameFor, newName: e.target.value })}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  disabled={rename.isPending}
                  onClick={() => setRenameFor(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={rename.isPending}>
                  {rename.isPending ? "Saving…" : "Save name"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {copyFor && (
        <Dialog open onOpenChange={(o) => !o && !duplicate.isPending && setCopyFor(null)}>
          <DialogContent className="sm:max-w-md" data-dialog="copy-bid">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (duplicate.isPending) return;
                if (!copyFor.dueDate) {
                  toast.error("Give the copy a due date.");
                  return;
                }
                duplicate.mutate({
                  id: copyFor.id,
                  name: copyFor.newName.trim() || duplicateBidName(copyFor.name),
                  dueDate: copyFor.dueDate,
                });
              }}
            >
              <DialogHeader>
                <DialogTitle>Copy this bid</DialogTitle>
                <DialogDescription>
                  A new draft copy of “{copyFor.name}” with the same work, prices and customer. Give
                  the copy its job name and due date; it opens once it is made.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1 py-3">
                <Label htmlFor="trade-bid-copy-name">Job name</Label>
                <Input
                  id="trade-bid-copy-name"
                  autoFocus
                  maxLength={200}
                  value={copyFor.newName}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setCopyFor({ ...copyFor, newName: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Left blank, the copy is named “{duplicateBidName(copyFor.name)}”.
                </p>
              </div>
              <div className="space-y-1 pb-3">
                <Label htmlFor="trade-bid-copy-due">Bid due</Label>
                <Input
                  id="trade-bid-copy-due"
                  type="date"
                  required
                  value={copyFor.dueDate}
                  onChange={(e) => setCopyFor({ ...copyFor, dueDate: e.target.value })}
                  className="w-[11rem]"
                />
                <p className="text-xs text-muted-foreground">
                  When the copy must go out; it sits on Work Overview by this day.
                  {copyFor.dueDate ? "" : " The original has no due date, so pick one."}
                </p>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  disabled={duplicate.isPending}
                  onClick={() => setCopyFor(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={duplicate.isPending}>
                  {duplicate.isPending ? "Copying…" : "Make the copy"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

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
                // Stay open until the delete has answered, so a failure is seen in place.
                e.preventDefault();
                if (confirmDelete) del.mutate(confirmDelete.id);
              }}
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmPurge !== null}
        onOpenChange={(open) => {
          if (!open && !purge.isPending) setConfirmPurge(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bid forever?</AlertDialogTitle>
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
              {purge.isPending ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
