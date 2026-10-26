import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  FileSpreadsheet,
  FileText,
  FileUp,
  Folder,
  FolderInput,
  FolderOpen,
  Layers,
  List,
  Pencil,
  PlusCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  DELETED_BID_RETENTION_DAYS,
  deleteBid,
  duplicateBid,
  listBids,
  renameBidFolder,
  setBidFolder,
  setBidStatus,
  listDeletedBids,
  purgeBid,
  restoreBid,
} from "@/lib/bids.functions";
import { useAuth } from "@/lib/auth-store";
import {
  BID_STATUSES,
  STATUS_LABELS,
  asBidStatus,
  bidOfficeToday,
  fromOpportunityLine,
  type BidStatus,
} from "@/lib/bid-status";
import { localYmd } from "@/lib/my-work";
import { bidOverdueDays } from "@/lib/work-counts";
import {
  bidsInFolder,
  bidsInYear,
  FOLDER_GROUP_LABELS,
  FOLDER_GROUPS,
  folderCards,
  folderKey,
  folderOptions,
  foldersFor,
  normalizeFolder,
  readBidsView,
  readFolderGroup,
  suggestFolder,
  toggleAllSelected,
  UNFILED,
  UNFILED_KEY,
  writeBidsView,
  writeFolderGroup,
  yearFolders,
  type BidsView,
  type FolderGroup,
} from "@/lib/bids-folders";
import { Button } from "@/components/ui/button";
import { LostReasonDialog } from "@/components/lost-reason-dialog";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { ImportBaxDialog } from "@/components/import-bax-dialog";
import { ImportPlanSwiftDialog } from "@/components/import-planswift-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/** Where an imported bid came from: a legacy .bax (src/lib/bax) or a PlanSwift export. */
const importedFrom = (data: unknown): string | null => {
  const src =
    !!data && typeof data === "object"
      ? (data as { importInfo?: { source?: string } }).importInfo?.source
      : undefined;
  return src === "bid-advantage" ? "Bid-Advantage" : src === "planswift" ? "PlanSwift" : null;
};

export const Route = createFileRoute("/bids")({
  head: () => ({
    meta: [
      { title: "Project Bids — JBK Portal" },
      {
        name: "description",
        content: "View and manage saved Duro-Last roofing estimates.",
      },
      {
        property: "og:title",
        content: "Project Bids — JBK Portal",
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

/** The bid's customer: the linked profile's name, else the name typed on Setup; "" = none. */
const customerOf = (bid: { data: unknown; account?: { name: string } | null }): string => {
  const linked = bid.account?.name?.trim();
  if (linked) return linked;
  const d = bid.data as { customer?: { name?: string } } | null;
  return d?.customer?.name?.trim() ?? "";
};

/** "Oct 20, 2026" for a YYYY-MM-DD day (a calendar day: no time zone shift). */
const dueLabel = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

type BidSort = "updated" | "customer" | "name" | "total" | "created" | "due";
const SORT_LABELS: Record<BidSort, string> = {
  updated: "Last saved",
  customer: "Customer A–Z",
  name: "Bid name A–Z",
  total: "Total, high to low",
  created: "Newest first",
  // Owner, Oct 12: the bid due date; a bid without one sorts last.
  due: "Due date, soonest first",
};
/** Order rows within a status group; ties fall back to the last-saved order. */
function sortBids<
  T extends {
    name: string;
    data: unknown;
    account?: { name: string } | null;
    grand_total: unknown;
    created_at: string;
    updated_at: string;
    due_date?: string | null;
  },
>(rows: T[], by: BidSort): T[] {
  const cmp = (a: T, b: T): number => {
    switch (by) {
      case "due": {
        const da = a.due_date ?? null;
        const db = b.due_date ?? null;
        if (!da && db) return 1;
        if (da && !db) return -1;
        return (da ?? "").localeCompare(db ?? "");
      }
      case "customer": {
        const ca = customerOf(a);
        const cb = customerOf(b);
        // Bids with no customer sort last.
        if (!ca && cb) return 1;
        if (ca && !cb) return -1;
        return ca.localeCompare(cb) || a.name.localeCompare(b.name);
      }
      case "name":
        return a.name.localeCompare(b.name);
      case "total":
        return Number(b.grand_total ?? 0) - Number(a.grand_total ?? 0);
      case "created":
        return b.created_at.localeCompare(a.created_at);
      default:
        return b.updated_at.localeCompare(a.updated_at);
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || b.updated_at.localeCompare(a.updated_at));
}

/** Status groups the user has collapsed, remembered across reloads (per browser). */
const COLLAPSED_KEY = "bid-o-matic:bids-collapsed";
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
    // Storage unavailable (private mode, blocked site data) — collapse still works this visit.
  }
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
  const [importOpen, setImportOpen] = useState(false);
  const [planswiftOpen, setPlanswiftOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<BidSort>("updated");
  const [estimatorFilter, setEstimatorFilter] = useState("all");
  const [systemFilter, setSystemFilter] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  // Bid Combiner (legacy BidAdvantage.BidCombiner, docs §22.41): tick two or more bids, then
  // "Combine" opens a NEW estimate merged from them.
  const [combineSel, setCombineSel] = useState<string[]>([]);
  // Collapsed status groups (default: none, i.e. every group expanded).
  const [collapsed, setCollapsed] = useState<BidStatus[]>(readCollapsed);
  // List, year folders (owner, Oct 7) or the assigned folders (owner, Oct 13), remembered like
  // the ticket's layout toggle.
  const storage = typeof window === "undefined" ? null : window.localStorage;
  const [view, setViewState] = useState<BidsView>(() => readBidsView(storage));
  const [folderYear, setFolderYear] = useState<number | null>(null);
  const [folderGroup, setFolderGroupState] = useState<FolderGroup>(() => readFolderGroup(storage));
  // The assigned folder that is open (its folderKey; UNFILED_KEY = the unfiled bids), or none.
  const [folderOpen, setFolderOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  // "Move to folder…" (one row, or the ticked bids): which bids, and the name being typed.
  const [moveFor, setMoveFor] = useState<{ ids: string[]; label: string } | null>(null);
  const [moveText, setMoveText] = useState("");
  const setView = (v: BidsView) => {
    setViewState(v);
    setFolderYear(null);
    setFolderOpen(null);
    setRenaming(false);
    writeBidsView(storage, v);
  };
  const setFolderGroup = (g: FolderGroup) => {
    setFolderGroupState(g);
    writeFolderGroup(storage, g);
  };
  const toggleGroup = (status: BidStatus) =>
    setCollapsed((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status];
      writeCollapsed(next);
      return next;
    });
  const toggleCombine = (id: string) =>
    setCombineSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const qc = useQueryClient();
  const deleteBidFn = useServerFn(deleteBid);
  const setStatusFn = useServerFn(setBidStatus);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  // Documents (owner, Oct 26): the bid's proposals and letters, in one panel at page level with
  // the chosen row's bid; opened from the row's Documents button.
  const [documentsFor, setDocumentsFor] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bids"] });
    void qc.invalidateQueries({ queryKey: ["bids-deleted"] });
  };
  const [lostFor, setLostFor] = useState<{ id: string; name: string } | null>(null);
  // Marking Won asks for the day it was won (bids.won_on; owner, Oct 21: "a way to adjust the
  // date the bid was won to ensure the data appears correctly"), today's office day to start.
  const [wonFor, setWonFor] = useState<{ id: string; name: string; day: string } | null>(null);
  const setStatus = useMutation({
    mutationFn: (v: {
      id: string;
      status: BidStatus;
      lostReason?: string | null;
      wonOn?: string | null;
    }) => setStatusFn({ data: v }),
    onSuccess: (b) => {
      toast.success(`Status: ${STATUS_LABELS[asBidStatus(b.status)]}`);
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not change status"),
  });
  // Folders (owner, Oct 13): file one or several bids; rename a folder for every bid in it.
  const setFolderFn = useServerFn(setBidFolder);
  const moveFolder = useMutation({
    mutationFn: (v: { ids: string[]; folder: string | null }) => setFolderFn({ data: v }),
    onSuccess: (r, v) => {
      toast.success(
        r.folder
          ? `Moved ${r.count} bid${r.count === 1 ? "" : "s"} to "${r.folder}"`
          : `${r.count} bid${r.count === 1 ? "" : "s"} now unfiled`,
      );
      if (v.ids.length > 1) setCombineSel([]);
      setMoveFor(null);
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not move to the folder"),
  });
  const renameFolderFn = useServerFn(renameBidFolder);
  const rename = useMutation({
    mutationFn: (v: { from: string; to: string }) => renameFolderFn({ data: v }),
    onSuccess: (r) => {
      toast.success(`Renamed to "${r.folder}" (${r.count} bid${r.count === 1 ? "" : "s"})`);
      setRenaming(false);
      setFolderOpen(folderKey(r.folder));
      refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not rename the folder"),
  });
  // Duplicate (owner, Oct 6): a new draft copy, opened in the estimator to be renamed.
  const duplicateFn = useServerFn(duplicateBid);
  const duplicate = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: (copy) => {
      toast.success(`Copied as "${copy.name}" — opening the copy`);
      refresh();
      void navigate({ to: "/estimate", search: { bid: copy.id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not duplicate the bid"),
  });
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
    if (
      q &&
      !b.name.toLowerCase().includes(q) &&
      !customerOf(b).toLowerCase().includes(q) &&
      !(b.folder ?? "").toLowerCase().includes(q)
    )
      return false;
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
  // The assigned folders (owner, Oct 13): the cards, the one that is open, and its bids. Search
  // and the filters above apply inside a folder too.
  const cards = folderCards(filtered);
  const openCard = folderOpen === null ? null : (cards.find((c) => c.key === folderOpen) ?? null);
  const openName =
    openCard?.name ??
    (folderOpen === UNFILED_KEY
      ? UNFILED
      : (normalizeFolder(bids.find((b) => folderKey(b.folder) === folderOpen)?.folder) ??
        folderOpen ??
        ""));
  const scopeRows =
    view === "byFolder" && folderOpen !== null ? bidsInFolder(filtered, folderOpen) : filtered;
  const allShownTicked = scopeRows.length > 0 && scopeRows.every((b) => combineSel.includes(b.id));
  // Grouped Draft → Submitted → Won → Lost, in the list's order inside each group; filters above
  // (and the open folder) apply first, and a group with nothing in it is left out.
  const groups = BID_STATUSES.map((status) => ({
    status,
    rows: sortBids(
      scopeRows.filter((b) => asBidStatus(b.status) === status),
      sortBy,
    ),
  })).filter((g) => g.rows.length > 0);
  const folderNames = folderOptions(bids);
  /** Open "Move to folder…" for these bids; a lone unfiled bid starts at its customer's name. */
  const openMove = (ids: string[]) => {
    const rows = bids.filter((b) => ids.includes(b.id));
    const one = rows.length === 1 ? rows[0] : undefined;
    const shared = new Set(rows.map((b) => folderKey(b.folder)));
    const current = shared.size === 1 ? normalizeFolder(rows[0]?.folder) : null;
    setMoveText(current ?? (one ? (suggestFolder(customerOf(one)) ?? "") : ""));
    setMoveFor({
      ids,
      label: one ? one.name : `${rows.length} bid${rows.length === 1 ? "" : "s"}`,
    });
  };
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

  /** One bid's card, in the list and in the folder view (owner, Oct 7). */
  // The viewer's day, for the Due tag (lib/my-work.ts localYmd — the day Work Overview uses).
  const today = localYmd(new Date());
  const renderBid = (bid: (typeof bids)[number]) => {
    const st = asBidStatus(bid.status);
    const overdueDays = bidOverdueDays(bid, today);
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
            aria-label={`Select ${bid.name}`}
            title="Tick to move to a folder or combine with other bids"
            checked={combineSel.includes(bid.id)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={() => toggleCombine(bid.id)}
          />
          <div>
            <p className="font-medium">{bid.name}</p>
            <p className="text-sm text-muted-foreground">
              Customer: {customerOf(bid) || "—"} · Estimator: {estimatorOf(bid) || "—"} · Created{" "}
              {new Date(bid.created_at).toLocaleDateString()} · Last saved{" "}
              {new Date(bid.updated_at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {bid.updated_by_name ? ` by ${bid.updated_by_name}` : ""}
              {bid.folder ? ` · Folder: ${bid.folder}` : ""}
              {st === "lost" && bid.lost_reason ? ` · Lost: ${bid.lost_reason}` : ""}
              {importedFrom(bid.data) ? ` · Imported from ${importedFrom(bid.data)}` : ""}
            </p>
            {/* The opportunity it was started from (bids.opportunity_id; owner, Oct 12). */}
            {bid.opportunity?.title && (
              <p className="text-xs text-muted-foreground" data-line="from-opportunity">
                <Link
                  to="/opportunities"
                  search={{ id: bid.opportunity.id }}
                  className="hover:underline"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {fromOpportunityLine(bid.opportunity.title)}
                </Link>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6">
          {/* The bid due date (owner, Oct 12), red with the day count when a draft is past it
            (work-counts.ts bidOverdueDays: a submitted / won / lost bid is never overdue). */}
          <span
            className="min-w-[7.5rem] text-right text-xs tabular-nums text-muted-foreground"
            data-col="due"
            title="When the bid must go out (set in the estimator). Draft bids sit on Work Overview by this day."
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
          {/* Stored at save time — the estimator recomputes live, so an engine change
    (or an empty-data row) can differ from this until the bid is re-saved. */}
          <span
            className="min-w-[120px] text-right text-sm font-semibold tabular-nums"
            title="Total as of the last save — open the bid for the live figure"
          >
            {money(Number(bid.grand_total ?? 0))}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">(last saved)</span>
          </span>
          {/* Status changes here save at once and stamp "Last saved … by". */}
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Select
              value={st}
              onValueChange={(v) =>
                v === "won"
                  ? setWonFor({ id: bid.id, name: bid.name, day: bidOfficeToday() })
                  : v === "lost"
                    ? setLostFor({ id: bid.id, name: bid.name })
                    : setStatus.mutate({ id: bid.id, status: v as BidStatus })
              }
            >
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Bid status">
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
          <Button
            variant="ghost"
            size="sm"
            title={bid.folder ? `Move to folder… (now in "${bid.folder}")` : "Move to folder…"}
            disabled={moveFolder.isPending}
            onClick={(e) => {
              e.stopPropagation();
              openMove([bid.id]);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <FolderInput className="h-4 w-4" />
            <span className="sr-only">Move to folder…</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Duplicate this bid (a new draft copy)"
            disabled={duplicate.isPending}
            onClick={(e) => {
              e.stopPropagation();
              duplicate.mutate(bid.id);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Copy className="h-4 w-4" />
            <span className="sr-only">Duplicate</span>
          </Button>
          {/* Documents (owner, Oct 26): the bid's proposals and letters, each made by a click. */}
          <Button
            variant="ghost"
            size="sm"
            title="Documents (proposals, letters)"
            onClick={(e) => {
              e.stopPropagation();
              setDocumentsFor({ id: bid.id, name: bid.name });
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <FileText className="h-4 w-4" />
            <span className="sr-only">Documents</span>
          </Button>
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
  };

  /** The status groups (Draft → Submitted → Won → Lost): the list, and the inside of a folder. */
  const statusGroups = (
    <div className="grid gap-8">
      {groups.map(({ status, rows }) => {
        const open = !collapsed.includes(status);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <section key={status} aria-label={`${STATUS_LABELS[status]} bids`}>
            {/* Group header with a grey rule beneath it; empty groups are not shown.
              Clicking it collapses/expands the group (remembered in localStorage). */}
            <h2 className={`border-b border-border pb-1.5 ${open ? "mb-3" : ""}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={open}
                aria-controls={`bids-group-${status}`}
                title={open ? "Collapse this group" : "Expand this group"}
                onClick={() => toggleGroup(status)}
              >
                <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-sm font-semibold uppercase tracking-wide">
                  {STATUS_LABELS[status]}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {rows.length} bid{rows.length === 1 ? "" : "s"}
                </span>
              </button>
            </h2>
            {open && (
              <div id={`bids-group-${status}`} className="grid gap-3">
                {rows.map(renderBid)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Project Bids</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Owner, Oct 14: tick the bids in view in one go, then "Move N to folder…". */}
          {scopeRows.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              title={
                allShownTicked
                  ? "Untick the bids shown"
                  : "Tick every bid shown, then move them to a folder or combine them"
              }
              onClick={() =>
                setCombineSel((prev) =>
                  toggleAllSelected(
                    prev,
                    scopeRows.map((b) => b.id),
                  ),
                )
              }
            >
              <CheckSquare className="mr-1.5 h-4 w-4" />
              {allShownTicked ? "Untick all" : `Select all ${scopeRows.length} shown`}
            </Button>
          )}
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
              <Button
                variant="outline"
                size="lg"
                title="File the ticked bids under one folder"
                onClick={() => openMove(combineSel)}
              >
                <FolderInput className="mr-2 h-5 w-5" />
                Move {combineSel.length} to folder…
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCombineSel([])}>
                Clear selection
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="lg"
            title="Bring in bids saved by the old Bid-Advantage program (.bax files)"
            onClick={() => setImportOpen(true)}
          >
            <FileUp className="mr-2 h-5 w-5" />
            Import old bids
          </Button>
          <Button
            variant="outline"
            size="lg"
            title="Start a bid from a PlanSwift takeoff exported to Excel (.xlsx)"
            onClick={() => setPlanswiftOpen(true)}
          >
            <FileSpreadsheet className="mr-2 h-5 w-5" />
            Import PlanSwift takeoff
          </Button>
          <Button asChild size="lg" className="text-base font-semibold">
            <Link to="/estimate">
              <PlusCircle className="mr-2 h-5 w-5" />
              New Bid
            </Link>
          </Button>
        </div>
      </div>
      <ImportBaxDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ImportPlanSwiftDialog open={planswiftOpen} onClose={() => setPlanswiftOpen(false)} />

      {bids.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Bid name
            <Input
              type="search"
              placeholder="Search by bid or customer name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-background"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Sort by
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as BidSort)}>
              <SelectTrigger className="w-[170px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as BidSort[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SORT_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            View
            {/* List / Years (owner, Oct 7) / By folder (owner, Oct 13). */}
            <div className="inline-flex rounded-md shadow-sm" role="group" aria-label="View">
              {(
                [
                  ["list", "List", List, "Show the list"],
                  ["folders", "Years", Folder, "Show folders by year"],
                  ["byFolder", "By folder", FolderOpen, "Show the folders you assigned"],
                ] as const
              ).map(([v, label, Icon, title], i) => (
                <Button
                  key={v}
                  type="button"
                  variant={view === v ? "default" : "outline"}
                  className={`${view === v ? "" : "bg-background"} ${i === 0 ? "rounded-r-none" : i === 2 ? "rounded-l-none" : "rounded-none border-x-0"}`}
                  aria-pressed={view === v}
                  title={title}
                  onClick={() => setView(v)}
                >
                  <Icon className="mr-1 h-4 w-4" /> {label}
                </Button>
              ))}
            </div>
          </div>
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
      ) : view === "byFolder" && folderOpen === null ? (
        /* The assigned folders (owner, Oct 13): one card per folder, Unfiled last; a click opens it. */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Bids by folder">
          {cards.map((f) => (
            <button
              key={f.key}
              type="button"
              className="flex items-center gap-3 rounded-lg border p-4 text-left transition-all duration-150 hover:scale-[1.015] hover:border-primary/40 hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setFolderOpen(f.key)}
              title={`Open ${f.name}`}
              data-folder={f.key === UNFILED_KEY ? "unfiled" : f.key}
            >
              <Folder
                className={`h-8 w-8 shrink-0 ${f.key === UNFILED_KEY ? "text-muted-foreground/50" : "text-muted-foreground"}`}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold">{f.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.count} bid{f.count === 1 ? "" : "s"} · {money(f.total)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : view === "byFolder" && folderOpen !== null ? (
        /* Inside a folder: its name (Rename for a real folder), then the usual status groups. */
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setFolderOpen(null);
                setRenaming(false);
              }}
            >
              <Folder className="h-4 w-4" aria-hidden /> All folders
            </button>
            <span className="text-muted-foreground">›</span>
            {renaming ? (
              <form
                className="inline-flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const to = normalizeFolder(renameText);
                  if (!to) {
                    toast.error("Give the folder a name.");
                    return;
                  }
                  if (folderKey(to) === folderOpen && to === openName) {
                    setRenaming(false);
                    return;
                  }
                  rename.mutate({ from: openName, to });
                }}
              >
                <Input
                  autoFocus
                  aria-label="Folder name"
                  className="h-8 w-[16rem] bg-background"
                  value={renameText}
                  maxLength={80}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(false);
                  }}
                />
                <Button type="submit" size="sm" className="h-8" disabled={rename.isPending}>
                  {rename.isPending ? "Renaming…" : "Save"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => setRenaming(false)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <h2 className="inline-flex items-center gap-1 font-semibold">
                  <FolderOpen className="h-4 w-4" aria-hidden /> {openName}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {scopeRows.length} bid{scopeRows.length === 1 ? "" : "s"}
                </span>
                {folderOpen !== UNFILED_KEY && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    title="Rename this folder for every bid in it"
                    onClick={() => {
                      setRenameText(openName);
                      setRenaming(true);
                    }}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Rename
                  </Button>
                )}
              </>
            )}
          </div>
          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No bids in this folder match these filters.
            </p>
          ) : (
            statusGroups
          )}
        </div>
      ) : view === "folders" && folderYear === null ? (
        /* Year folders (owner, Oct 7): one per year with bids; a click opens it. */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Bids by year">
          {yearFolders(filtered).map((f) => (
            <button
              key={f.year}
              type="button"
              className="flex items-center gap-3 rounded-lg border p-4 text-left transition-all duration-150 hover:scale-[1.015] hover:border-primary/40 hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setFolderYear(f.year)}
              title={`Open ${f.year}`}
            >
              <Folder className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="block text-lg font-semibold">{f.year}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.count} bid{f.count === 1 ? "" : "s"} · {money(f.total)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : view === "folders" && folderYear !== null ? (
        /* Inside a year: group by month / customer / status / estimator / roof system. */
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setFolderYear(null)}
            >
              <Folder className="h-4 w-4" aria-hidden /> All years
            </button>
            <span className="text-muted-foreground">›</span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <FolderOpen className="h-4 w-4" aria-hidden /> {folderYear}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">Group by</span>
              {FOLDER_GROUPS.map((g) => (
                <Button
                  key={g}
                  type="button"
                  size="sm"
                  variant={folderGroup === g ? "default" : "outline"}
                  className="h-7 rounded-full px-3 text-xs"
                  aria-pressed={folderGroup === g}
                  onClick={() => setFolderGroup(g)}
                >
                  {FOLDER_GROUP_LABELS[g]}
                </Button>
              ))}
            </span>
          </div>
          {foldersFor(bidsInYear(filtered, folderYear), folderGroup, (b) => ({
            customer: customerOf(b),
            estimator: estimatorOf(b),
            systems: roofSystemsOf(b),
            status: STATUS_LABELS[asBidStatus(b.status)],
            folder: b.folder,
          })).map((g) => (
            <section key={g.label} aria-label={`${g.label} bids`}>
              <h2 className="mb-3 flex items-center gap-2 border-b border-border pb-1.5">
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-sm font-semibold">{g.label}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {g.rows.length} bid{g.rows.length === 1 ? "" : "s"}
                </span>
              </h2>
              <div className="grid gap-3">{sortBids(g.rows, sortBy).map(renderBid)}</div>
            </section>
          ))}
        </div>
      ) : (
        statusGroups
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

      {/* Move to folder… (owner, Oct 13): type a folder or pick one in use; blank = Unfiled. */}
      <Dialog
        open={moveFor !== null}
        onOpenChange={(open) => {
          if (!open && !moveFolder.isPending) setMoveFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (moveFor)
                moveFolder.mutate({ ids: moveFor.ids, folder: normalizeFolder(moveText) });
            }}
          >
            <DialogHeader>
              <DialogTitle>Move to folder</DialogTitle>
              <DialogDescription>
                File “{moveFor?.label}” under a folder: type a new name or pick one in use. Leave it
                blank (or choose Unfiled) to take it out of its folder.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <label htmlFor="bid-move-folder" className="text-xs text-muted-foreground">
                Folder
              </label>
              <Input
                id="bid-move-folder"
                autoFocus
                list="bid-folder-options"
                placeholder={UNFILED}
                maxLength={80}
                value={moveText}
                onChange={(e) => setMoveText(e.target.value)}
              />
              <datalist id="bid-folder-options">
                {folderNames.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                disabled={moveFolder.isPending}
                onClick={() => setMoveFor(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={moveFolder.isPending}
                title="Take the bid out of its folder"
                onClick={() => {
                  if (moveFor) moveFolder.mutate({ ids: moveFor.ids, folder: null });
                }}
              >
                {UNFILED}
              </Button>
              <Button type="submit" disabled={moveFolder.isPending}>
                {moveFolder.isPending ? "Moving…" : "Move"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* One Documents panel for the whole list, showing the row whose button was clicked. */}
      {documentsFor && (
        <DocumentsPanel
          kind="bid"
          bidId={documentsFor.id}
          recordLabel={documentsFor.name || "Untitled bid"}
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
      {/* Owner, Oct 21: the day the bid was won, asked when it is marked Won here; the Margin
          report counts the bid on this day (bids.won_on; changeable later in the report and in
          the estimator). */}
      {wonFor && (
        <Dialog open onOpenChange={(o) => !o && setWonFor(null)}>
          <DialogContent className="sm:max-w-sm">
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
                  {wonFor.name} is being marked Won. The Margin report counts it on this day; it can
                  be changed later in the report or in the estimator.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1 py-3">
                <Label htmlFor="bid-won-on-list">Won on</Label>
                <Input
                  id="bid-won-on-list"
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
