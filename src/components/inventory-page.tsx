/**
 * Inventory — one screen (owner rule, MODULES.md §7: a non-technical crew lead, salesperson or
 * service tech uses this, often on a phone). Stock on hand is the page; every row has "Take from
 * inventory" and "Put in inventory"; the form is a dialog that asks WHERE first (the shop or a
 * service vehicle — owner, Sep 24), then the product, the amount and the job — a service ticket
 * or a bid — which remembers the last job used on this phone. Loading a service vehicle is
 * "Take from inventory" with the vehicle as the destination; a return is "Put in inventory"
 * with the vehicle as the source (or "Take from" the vehicle back to the shop) and moves only
 * what came back. There is no vehicle write-off (owner, Sep 26): material used off a truck is
 * always "Take from inventory" against a job. For a tech, "Take from" starts on the vehicle they
 * drive and their open ticket (service design §6 A, §11); the ticket page's "Log material" link
 * lands here with ?job=<ticket>, the estimator's leftovers link with ?bid=<bid>. Adjustments and
 * write-offs are not offered here — the server still accepts them from estimators. Who drives
 * each vehicle is on Setup › Vehicles & drivers (owner, Oct 5).
 *
 * Three views, one row of tabs under the heading, ?tab= (owner, Oct 9: "make the history and
 * reconcile different tabs within the inventory page and only visible to managers and owners"):
 * Stock is the table everyone sees, with Take from / Put in; History and Reconcile show for
 * admins and managers (seesEveryone) and anyone else lands on Stock whatever the URL says. Each
 * tab's queries run only while it is shown; the query keys are unchanged so the close-out's and
 * the Record dialog's invalidations still land. The opened-box rule (owner, Oct 9: "is this box
 * necessary here?") is gone: nothing ever converted a quantity with it — the dialog takes whole
 * packs and pieces exactly — so the admin card and its server functions were removed (the
 * inventory_settings table stays, unread).
 *
 * Owner, Oct 9 (after a review): History pages through the whole ledger and says how much is
 * shown; a Put-in's remembered job is an unmistakable "Left over from …" line (leftovers off one
 * bid, several in a row, are the normal case — owner: "very rarely if ever just ordering to have
 * things stocked") with "Bought or delivered (no job)" as the other choice; the amount is two
 * boxes side by side, whole packs and pieces, either or both filled; every row has Set count for
 * estimators and managers (a shelf counted down is one adjustment); the dialog stays open after
 * Save so ten leftovers are ten saves, not ten dialogs; the shop is the default place for anyone
 * without a vehicle; a truck can load another truck; names and units read as on the close-out
 * (the service material's name first, "2 boxes", a price column is not a colour).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  History,
  Package,
  Scale,
  PackageMinus,
  PackagePlus,
  Trash2,
  Truck,
  Warehouse,
} from "lucide-react";

import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { canAccess, seesEveryone } from "@/lib/access";
import { cn } from "@/lib/utils";
import { type InventoryTab } from "@/lib/inventory-search";
import { getReconciliation } from "@/lib/inventory-reconcile.functions";
import {
  cellName,
  COUNT_NOTE,
  fmtQty as fmtSigned,
  fmtWhen as fmtOfficeWhen,
  parseCounted,
  placeWord,
  reconcileAdjustment,
  shiftWeek,
  weekStartOf,
  type NegativeCell,
  type Reconciliation,
} from "@/lib/inventory-reconcile";
import { listItemNumbers, listPriceTargets } from "@/lib/admin-item-numbers.functions";
import type { ItemNumberRow, PriceTarget } from "@/lib/admin-item-numbers.functions";
import { listServiceMaterialNames } from "@/lib/service-materials.functions";
import { serviceStockTargets } from "@/lib/service-materials";
import { STATUS_LABELS, asBidStatus } from "@/lib/bid-status";
import {
  addMovement,
  deleteMovement,
  listJobOptions,
  listLocations,
  listMovements,
  listStock,
  MOVEMENTS_PAGE,
  myServiceDefaults,
  REASON_LABELS,
  SHOP_LOCATION_ID,
  transferStock,
  undoMovement,
  priceColLabel,
  stockUnitFor,
  type InventoryLocation,
  type JobOption,
  type MovementReason,
  type MovementRow,
  type StockRow,
} from "@/lib/inventory.functions";
import { STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";
import type { TargetRef } from "@/lib/item-number-targets";
import {
  combinedCount,
  describeStock,
  displayStock,
  packUnitLabel,
  plural,
  type PieceDef,
} from "@/lib/stock-units";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AutoTextarea } from "@/components/ui/auto-textarea";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
/**
 * A job is a service ticket or a bid; the pickers and the remembered last job carry both as one
 * key: "service:<id>" / "bid:<id>".
 */
const jobKey = (j: { kind: JobOption["kind"]; id: string }) => `${j.kind}:${j.id}`;
const jobStatus = (j: JobOption) =>
  j.kind === "service"
    ? (STAGE_LABELS[j.status as ServiceStage] ?? j.status)
    : STATUS_LABELS[asBidStatus(j.status)];
/** "ticket #6001 Smith — leak" / the bid's name, for the confirmation. */
const jobTitle = (j: JobOption) => (j.kind === "service" ? `ticket ${j.name}` : j.name);
const LAST_JOB_KEY = "bid-o-matic:inventory-last-job";
const readLastJob = (): string => {
  try {
    const v = localStorage.getItem(LAST_JOB_KEY) ?? "";
    // Before tickets existed this phone stored a bare bid id.
    return v && !v.includes(":") ? `bid:${v}` : v;
  } catch {
    return "";
  }
};
const writeLastJob = (key: string) => {
  try {
    if (key) localStorage.setItem(LAST_JOB_KEY, key);
  } catch {
    /* private window */
  }
};

type Mode = "consumed" | "leftover";

/** Every product the catalog prices, flattened for one search box. */
interface ProductOption {
  ref: TargetRef;
  key: string;
  name: string;
  variant: string; // colour / size, "" for single-price products
  category: string;
  itemNos: string[];
  /** The stock unit and pieces per pack, so "on hand" reads "2 boxes" / "10 cartridges". */
  unit: string;
  piece: PieceDef | null;
}

function productOptions(targets: PriceTarget[], itemNumbers: ItemNumberRow[]): ProductOption[] {
  const nos = new Map<string, string[]>();
  for (const m of itemNumbers) {
    const k = `${m.screen_id}|${m.row_label}|${m.price_col}`;
    nos.set(k, [...(nos.get(k) ?? []), m.item_no]);
  }
  const out: ProductOption[] = [];
  for (const t of targets) {
    for (const row of t.rows) {
      for (const col of t.price_cols) {
        const key = `${t.screen_id}|${row}|${col}`;
        out.push({
          ref: { screen_id: t.screen_id, row_label: row, price_col: col },
          key,
          name: row,
          variant: priceColLabel(col) === "—" ? "" : col,
          category: t.category,
          itemNos: nos.get(key) ?? [],
          unit: t.row_units?.[row] ?? stockUnitFor(t.screen_id),
          piece: t.pieces?.[row] ?? null,
        });
      }
    }
  }
  return out;
}

const productLabel = (o: { name: string; variant: string }) =>
  o.variant ? `${o.name} · ${o.variant}` : o.name;

/** The three views, in tab order; the Service page's tabs are the model (service-tabs.tsx). */
const TABS: readonly { tab: InventoryTab; title: string; icon: typeof Package }[] = [
  { tab: "stock", title: "Stock", icon: Boxes },
  { tab: "history", title: "History", icon: History },
  { tab: "reconcile", title: "Reconcile", icon: Scale },
];

export function InventoryPage(props: {
  /** ?tab= (inventory-search.ts); nothing = Stock. */
  tab?: InventoryTab | undefined;
  initialBidId?: string | undefined;
  initialServiceJobId?: string | undefined;
}) {
  const { role, profile } = useAuth();
  // History and Reconcile are for admins and managers (owner, Oct 9); anyone else is on Stock
  // whatever the URL says, and never sees the tab row.
  const canSeeAll = seesEveryone(profile);
  const tab: InventoryTab = canSeeAll ? (props.tab ?? "stock") : "stock";
  const qc = useQueryClient();
  const stockFn = useServerFn(listStock);
  const movesFn = useServerFn(listMovements);
  const targetsFn = useServerFn(listPriceTargets);
  const serviceNamesFn = useServerFn(listServiceMaterialNames);
  const itemNosFn = useServerFn(listItemNumbers);
  const jobsFn = useServerFn(listJobOptions);
  const defaultsFn = useServerFn(myServiceDefaults);
  const locationsFn = useServerFn(listLocations);
  const undoFn = useServerFn(undoMovement);
  const stockQ = useQuery({ queryKey: ["inventory-stock"], queryFn: () => stockFn() });
  const locationsQ = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => locationsFn(),
  });
  // History: the newest page from the cache (the close-out and the estimator invalidate this
  // key too), older pages appended on "Show older" and dropped whenever the first page re-reads,
  // so the pages never overlap (owner, Oct 9: it showed 300 and called that every entry). Read
  // only while the History tab is shown.
  const movesQ = useQuery({
    queryKey: ["inventory-movements"],
    queryFn: () => movesFn({ data: {} }),
    enabled: tab === "history",
  });
  const [older, setOlder] = useState<MovementRow[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  useEffect(() => {
    setOlder([]);
  }, [movesQ.dataUpdatedAt]);
  const targetsQ = useQuery({ queryKey: ["price-targets"], queryFn: () => targetsFn() });
  // Service materials with no bid-catalog twin (owner, Oct 6): stocked here too.
  const serviceNamesQ = useQuery({
    queryKey: ["service-material-names"],
    queryFn: () => serviceNamesFn(),
  });
  const itemNosQ = useQuery({ queryKey: ["item-numbers"], queryFn: () => itemNosFn() });
  const jobsQ = useQuery({ queryKey: ["inventory-jobs"], queryFn: () => jobsFn() });
  // The vehicle(s) I drive today and my open tickets: what "Take from" starts on.
  const defaultsQ = useQuery({
    queryKey: ["inventory-my-defaults", profile?.id ?? ""],
    queryFn: () => defaultsFn(),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-stock"] });
    void qc.invalidateQueries({ queryKey: ["inventory-movements"] });
    // The Reconcile card sums the same ledger (owner, Oct 9: it kept a fixed cell listed).
    void qc.invalidateQueries({ queryKey: ["inventory-reconcile"] });
  };
  const targets: PriceTarget[] = useMemo(
    () => [...(targetsQ.data ?? []), ...serviceStockTargets(serviceNamesQ.data ?? [])],
    [targetsQ.data, serviceNamesQ.data],
  );
  const itemNumbers = useMemo(() => itemNosQ.data ?? [], [itemNosQ.data]);
  const products = useMemo(() => productOptions(targets, itemNumbers), [targets, itemNumbers]);
  const stock = useMemo(() => stockQ.data ?? [], [stockQ.data]);
  // A ledger entry's piece: the stock row's (listStock's, which knows a service material's own
  // unit — an ISO board), else the catalog's.
  const stockPiece = useMemo(() => {
    const m = new Map<string, PieceDef | null>();
    for (const r of stock) m.set(`${r.screen_id}|${r.row_label}|${r.price_col}`, r.piece);
    return m;
  }, [stock]);
  const pieceFor = (cell: { screen_id: string; row_label: string; price_col: string }) =>
    stockPiece.get(`${cell.screen_id}|${cell.row_label}|${cell.price_col}`) ??
    targets.find((t) => t.screen_id === cell.screen_id)?.pieces?.[cell.row_label] ??
    null;
  const firstPage = useMemo(() => movesQ.data ?? [], [movesQ.data]);
  const moves = useMemo(() => [...firstPage, ...older], [firstPage, older]);
  // A page shorter than the page size is the end of the ledger.
  const lastPage = older.length ? older : firstPage;
  const hasOlder = movesQ.isFetched && lastPage.length >= MOVEMENTS_PAGE;
  const loadOlder = async () => {
    const oldest = moves[moves.length - 1];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await movesFn({ data: { before: oldest.created_at } });
      setOlder((o) => [...o, ...page]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load older entries");
    } finally {
      setLoadingOlder(false);
    }
  };
  const canSetCount = canAccess(profile, "estimate");
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  const myJobs = useMemo(() => defaultsQ.data?.jobs ?? [], [defaultsQ.data]);
  const myVehicleIds = (defaultsQ.data?.vehicle_ids ?? []).filter((id) =>
    locations.some((l) => l.id === id && l.kind === "vehicle"),
  );
  // Only one vehicle is unambiguous; a driver on two picks each time.
  const myVehicle = myVehicleIds.length === 1 ? myVehicleIds[0] : undefined;
  const defaultsReady = defaultsQ.isFetched && locationsQ.isFetched;

  const [q, setQ] = useState("");
  const [zeros, setZeros] = useState(false);
  // Which location the list shows: everywhere by default (owner, Sep 24), or one place.
  const [where, setWhere] = useState<string>("all");
  const [dialog, setDialog] = useState<{
    mode: Mode;
    ref: TargetRef | null;
    location: string | null;
    purpose: Purpose | null;
    /** A job key ("service:<id>" / "bid:<id>"), "__pick__" to show the picker, else last used. */
    job: string | null;
  } | null>(null);
  // A tech who drives one vehicle sees it first; "Everywhere" stays one tap away.
  useEffect(() => {
    if (myVehicle) setWhere((w) => (w === "all" ? myVehicle : w));
  }, [myVehicle]);
  useEffect(() => {
    // "Record leftovers for this bid" on the estimate lands here with ?bid=: open the form.
    if (props.initialBidId)
      setDialog({
        mode: "leftover",
        ref: null,
        location: SHOP_LOCATION_ID,
        purpose: { kind: "job" },
        job: `bid:${props.initialBidId}`,
      });
  }, [props.initialBidId]);
  const jobLinkOpened = useRef(false);
  useEffect(() => {
    // A ticket's "Log material" link lands here with ?job=: take material for that ticket, off
    // the vehicle this tech drives (known once my defaults have loaded).
    if (!props.initialServiceJobId || jobLinkOpened.current || !defaultsReady) return;
    jobLinkOpened.current = true;
    setDialog({
      mode: "consumed",
      ref: null,
      location: myVehicle ?? SHOP_LOCATION_ID,
      purpose: { kind: "job" },
      job: `service:${props.initialServiceJobId}`,
    });
  }, [props.initialServiceJobId, defaultsReady, myVehicle]);

  const filter = q.trim().toLowerCase();
  const rows = stock.filter((r) => {
    if (where !== "all" && r.location_id !== where) return false;
    if (!zeros && Math.abs(r.on_hand) < 0.0005) return false;
    return (
      !filter ||
      (r.label ?? "").toLowerCase().includes(filter) ||
      r.row_label.toLowerCase().includes(filter) ||
      r.category.toLowerCase().includes(filter) ||
      r.price_col.toLowerCase().includes(filter) ||
      r.item_nos.some((n) => n.toLowerCase().includes(filter))
    );
  });
  const shown = where === "all" ? stock : stock.filter((r) => r.location_id === where);
  const inStock = shown.filter((r) => Math.abs(r.on_hand) >= 0.0005).length;

  const open = (mode: Mode, r?: StockRow) => {
    // Fewest taps for a tech taking material (Sep 26): start on the vehicle they drive and on
    // their open ticket — one ticket is chosen, several are listed first in the job picker.
    const take = mode === "consumed";
    const onlyTicket = take && myJobs.length === 1 ? `service:${myJobs[0]!.id}` : null;
    setDialog({
      mode,
      ref: r ? { screen_id: r.screen_id, row_label: r.row_label, price_col: r.price_col } : null,
      // A row already says where it is; the header buttons start on my vehicle, else the shop
      // (owner, Oct 9) — the chip stays, with Change.
      location: r ? r.location_id : (myVehicle ?? SHOP_LOCATION_ID),
      purpose: take && myJobs.length > 0 ? { kind: "job" } : null,
      job: onlyTicket ?? (take && myJobs.length > 1 ? "__pick__" : null),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Package className="h-6 w-6" /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            What is at the shop and on each service vehicle. Tap a product to take it for a job or
            to put some back.
          </p>
        </div>
        {tab === "stock" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => open("consumed")}>
              <PackageMinus className="mr-1 h-4 w-4" /> Take from inventory
            </Button>
            <Button onClick={() => open("leftover")}>
              <PackagePlus className="mr-1 h-4 w-4" /> Put in inventory
            </Button>
          </div>
        )}
      </div>

      {canSeeAll && (
        <nav aria-label="Inventory views" className="flex flex-wrap gap-1 border-b">
          {TABS.map((t) => (
            <Link
              key={t.tab}
              to="/inventory"
              // Stock is the default, so its link carries no ?tab=.
              search={t.tab === "stock" ? {} : { tab: t.tab }}
              aria-current={tab === t.tab ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                tab === t.tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.title}
            </Link>
          ))}
        </nav>
      )}

      {tab === "stock" && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                className="h-10 max-w-sm"
                placeholder="Search product or item #…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {locations.length > 1 && (
                <Select value={where} onValueChange={setWhere}>
                  <SelectTrigger className="h-10 w-[260px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                        {l.id === myVehicle ? " (my vehicle)" : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value="all">Everywhere</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={zeros}
                  onChange={(e) => setZeros(e.target.checked)}
                />
                Show products at zero
              </label>
              <span className="text-xs text-muted-foreground">
                {rows.length} of {zeros ? shown.length : inStock} product(s)
              </span>
            </div>
            {stockQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing {where === "all" ? "in inventory" : `at ${locationName(where)}`} yet. Tap{" "}
                <b>Put in inventory</b> to record the first material.
              </p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {filter
                  ? `Nothing matches “${q.trim()}”.`
                  : "Everything is at zero. Tick “Show products at zero” to see the list."}
              </p>
            ) : (
              <>
                {/* Phone: one card per product with big buttons. */}
                <ul className="space-y-2 md:hidden">
                  {rows.map((r) => {
                    const d = displayStock(r.on_hand, r.unit, r.piece);
                    return (
                      <li
                        key={`${r.location_id}|${r.screen_id}|${r.row_label}|${r.price_col}`}
                        className="rounded-md border p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{cellName(r)}</p>
                            <p className="text-xs text-muted-foreground">
                              {[
                                r.label ? r.row_label : null,
                                r.label
                                  ? null
                                  : priceColLabel(r.price_col) !== "—"
                                    ? r.price_col
                                    : null,
                                r.category,
                                locationName(r.location_id),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              {r.item_nos.length > 0 && (
                                <span className="ml-1 font-mono">#{r.item_nos.join(", #")}</span>
                              )}
                            </p>
                          </div>
                          <p
                            className={`whitespace-nowrap text-right text-lg font-semibold tabular-nums ${r.on_hand < 0 ? "text-destructive" : ""}`}
                          >
                            {fmtQty(d.amount)} <span className="text-xs font-normal">{d.unit}</span>
                            {r.on_hand < 0 && canSeeAll && <FixOnReconcile />}
                          </p>
                        </div>
                        <div
                          className={`mt-2 grid gap-2 ${canSetCount ? "grid-cols-3" : "grid-cols-2"}`}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={r.on_hand <= 0}
                            onClick={() => open("consumed", r)}
                          >
                            <PackageMinus className="mr-1 h-4 w-4" /> Take
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => open("leftover", r)}>
                            <PackagePlus className="mr-1 h-4 w-4" /> Put in
                          </Button>
                          {canSetCount && (
                            <SetCountButton
                              row={r}
                              locationName={locationName(r.location_id)}
                              onSet={refresh}
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {/* Desktop table. */}
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Colour / size</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Item #</TableHead>
                        <TableHead className="text-right">On hand</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Last entry</TableHead>
                        <TableHead className={canSetCount ? "w-[340px]" : "w-[250px]"} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const piece = r.piece;
                        const d = displayStock(r.on_hand, r.unit, piece);
                        return (
                          <TableRow
                            key={`${r.location_id}|${r.screen_id}|${r.row_label}|${r.price_col}`}
                          >
                            <TableCell className="text-sm font-medium">
                              {cellName(r)}
                              {r.label && (
                                <span className="block text-xs font-normal text-muted-foreground">
                                  {r.row_label}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{priceColLabel(r.price_col)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {r.category}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {r.item_nos.join(", ")}
                            </TableCell>
                            <TableCell
                              className={`whitespace-nowrap text-right text-sm font-semibold tabular-nums ${r.on_hand < 0 ? "text-destructive" : ""}`}
                            >
                              {fmtQty(d.amount)}{" "}
                              <span className="text-xs font-normal">{d.unit}</span>
                              {piece && (
                                <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                  ({describeStock(r.on_hand, r.unit, null)})
                                </span>
                              )}
                              {r.on_hand < 0 && canSeeAll && <FixOnReconcile />}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {locationName(r.location_id)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {r.last_at ? fmtWhen(r.last_at) : ""}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={r.on_hand <= 0}
                                  onClick={() => open("consumed", r)}
                                >
                                  Take from inventory
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => open("leftover", r)}
                                >
                                  Put in inventory
                                </Button>
                                {canSetCount && (
                                  <SetCountButton
                                    row={r}
                                    locationName={locationName(r.location_id)}
                                    onSet={refresh}
                                  />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "history" && (
        <Card data-card="history">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> History
              <span className="text-xs font-normal text-muted-foreground">
                {hasOlder
                  ? `latest ${moves.length} shown`
                  : `${moves.length} entr${moves.length === 1 ? "y" : "ies"}`}
              </span>
            </CardTitle>
            <CardDescription>
              Every entry, newest first{hasOlder ? " — the latest first; Show older adds more" : ""}
              . On hand is the sum of these. Your own entries from the last 24 hours can be undone
              here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <LedgerTable
              rows={moves}
              loading={movesQ.isLoading}
              role={role}
              locations={locations}
              where={where}
              onWhere={setWhere}
              myVehicle={myVehicle}
              onChanged={refresh}
              pieceFor={pieceFor}
            />
            {hasOlder && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? "Loading…" : "Show older"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "reconcile" && <ReconcileTab canSetCount={canSetCount} />}

      {dialog && (
        <RecordDialog
          mode={dialog.mode}
          initialRef={dialog.ref}
          initialLocation={dialog.location}
          initialPurpose={dialog.purpose}
          initialJob={dialog.job}
          locations={locations}
          products={products}
          targets={targets}
          stock={stock}
          jobs={jobs}
          jobsLoaded={jobsQ.isFetched}
          myJobIds={myJobs.map((j) => j.id)}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            refresh();
            // The confirmation carries Undo for a wrong number or job: one tap removes the
            // entry (own entries, 24 h — undoMovement) and the shelf and the bid follow. The
            // dialog stays open for the next item (owner, Oct 9).
            toast.success("Saved — add another", {
              description: saved.message,
              duration: 10000,
              action: {
                label: "Undo",
                onClick: () => {
                  void undoFn({ data: { id: saved.id } })
                    .then(() => {
                      refresh();
                      toast.info("Undone — the entry was removed");
                    })
                    .catch((e: unknown) =>
                      toast.error(e instanceof Error ? e.message : "Could not undo"),
                    );
                },
              },
            });
          }}
        />
      )}
    </div>
  );
}

/** Text search over every catalog product; picks by name, colour / size or item #. */
function ProductPicker(props: {
  products: ProductOption[];
  stock: StockRow[];
  value: TargetRef | null;
  onlyInStock: boolean;
  onChange: (v: TargetRef | null) => void;
}) {
  const [text, setText] = useState("");
  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of props.stock) m.set(`${s.screen_id}|${s.row_label}|${s.price_col}`, s.on_hand);
    return m;
  }, [props.stock]);
  const onHand = (p: ProductOption) => stockMap.get(p.key) ?? 0;
  const chosen = props.value
    ? props.products.find(
        (p) =>
          p.ref.screen_id === props.value!.screen_id &&
          p.ref.row_label === props.value!.row_label &&
          p.ref.price_col === props.value!.price_col,
      )
    : undefined;
  const f = text.trim().toLowerCase();
  const matches = useMemo(() => {
    const pool = props.onlyInStock ? props.products.filter((p) => onHand(p) > 0) : props.products;
    const list = f
      ? pool.filter(
          (p) =>
            p.name.toLowerCase().includes(f) ||
            p.variant.toLowerCase().includes(f) ||
            p.category.toLowerCase().includes(f) ||
            p.itemNos.some((n) => n.toLowerCase().includes(f)),
        )
      : pool;
    // Exact item-number hits first, then what is in stock, then alphabetical.
    return [...list]
      .sort((a, b) => {
        const ea = a.itemNos.some((n) => n.toLowerCase() === f) ? 1 : 0;
        const eb = b.itemNos.some((n) => n.toLowerCase() === f) ? 1 : 0;
        if (ea !== eb) return eb - ea;
        const sa = onHand(a) > 0 ? 1 : 0;
        const sb = onHand(b) > 0 ? 1 : 0;
        if (sa !== sb) return sb - sa;
        return productLabel(a).localeCompare(productLabel(b));
      })
      .slice(0, 12);
  }, [f, props.products, stockMap, props.onlyInStock]);

  if (chosen) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <div>
          <p className="font-medium">{productLabel(chosen)}</p>
          <p className="text-xs text-muted-foreground">
            {chosen.category}
            {chosen.itemNos.length > 0 && (
              <span className="ml-1 font-mono">#{chosen.itemNos.join(", #")}</span>
            )}
            {" · "}
            {describeStock(onHand(chosen), chosen.unit, chosen.piece)} on hand
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => props.onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input
        autoFocus
        className="h-10"
        placeholder="Type the product name or item #…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
        {matches.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            {props.onlyInStock ? "Nothing in stock matches." : "No product matches."}
          </li>
        )}
        {matches.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => props.onChange(p.ref)}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{productLabel(p)}</span>
                <span className="block text-xs text-muted-foreground">
                  {p.category}
                  {p.itemNos.length > 0 && (
                    <span className="ml-1 font-mono">#{p.itemNos.join(", #")}</span>
                  )}
                </span>
              </span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {onHand(p) > 0 ? `${describeStock(onHand(p), p.unit, p.piece)} on hand` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "ticket" / "bid" beside a job's name. */
function JobKindTag(props: { kind: JobOption["kind"] }) {
  return (
    <span
      className={`mr-1.5 rounded px-1 text-[10px] uppercase ${props.kind === "service" ? "bg-primary/15" : "bg-muted text-muted-foreground"}`}
    >
      {props.kind === "service" ? "ticket" : "bid"}
    </span>
  );
}

/**
 * Text search over the jobs — service tickets (mine first) and bids; the last job used on this
 * phone is offered first. The value is a job key ("service:<id>" / "bid:<id>").
 */
function JobPicker(props: {
  jobs: JobOption[];
  /** My open tickets (service job ids). */
  mine: string[];
  value: string;
  required: boolean;
  /**
   * "Left over from" / "For": the chosen job reads as one highlighted sentence (owner, Oct 9: a
   * remembered job must be unmistakable, not a quiet pre-selected picker).
   */
  prefix: string;
  onChange: (key: string) => void;
}) {
  const [text, setText] = useState("");
  const chosen = props.jobs.find((j) => jobKey(j) === props.value);
  const f = text.trim().toLowerCase();
  const lastKey = readLastJob();
  const last = f ? undefined : props.jobs.find((j) => jobKey(j) === lastKey);
  const hit = (j: JobOption) => !f || j.name.toLowerCase().includes(f);
  const mine = new Set(props.mine);
  const isMine = (j: JobOption) => j.kind === "service" && mine.has(j.id);
  const tickets = [
    ...props.jobs.filter((j) => isMine(j) && hit(j)),
    ...props.jobs.filter((j) => j.kind === "service" && !isMine(j) && hit(j)).slice(0, 8),
  ];
  const bids = props.jobs.filter((j) => j.kind === "bid" && hit(j)).slice(0, 8);
  const label = (j: JobOption) => `${j.name} · ${jobStatus(j)}`;
  const row = (j: JobOption, tag?: string) => (
    <li key={`${tag ?? ""}|${jobKey(j)}`}>
      <button
        type="button"
        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
        onClick={() => props.onChange(jobKey(j))}
      >
        {tag && (
          <span className="mr-2 rounded bg-primary/15 px-1 text-[10px] uppercase">{tag}</span>
        )}
        {label(j)}
      </button>
    </li>
  );
  const group = (title: string) => (
    <li className="bg-muted/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </li>
  );
  if (chosen) {
    return (
      <div
        data-chosen-job
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border-2 border-primary/60 bg-primary/10 px-3 py-2"
      >
        <p className="font-medium">
          {props.prefix} <JobKindTag kind={chosen.kind} />
          {label(chosen)}
        </p>
        <div className="flex gap-1">
          {!props.required && (
            <Button size="sm" variant="ghost" onClick={() => props.onChange("")}>
              No job
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => props.onChange("__pick__")}>
            Change
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input
        className="h-10"
        placeholder="Type a ticket #, customer or job name…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
        {last && row(last, "last used")}
        {tickets.length > 0 && group("Tickets")}
        {tickets.map((j) => row(j, isMine(j) ? "mine" : undefined))}
        {bids.length > 0 && group("Bids")}
        {bids.map((j) => row(j))}
        {tickets.length === 0 && bids.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted-foreground">No job matches.</li>
        )}
        {!props.required && (
          <li>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
              onClick={() => props.onChange("")}
            >
              Not from a job
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Step one of every form (owner, Sep 24): where — the shop, then the service vehicles. */
function LocationPicker(props: {
  locations: InventoryLocation[];
  value: string | null;
  only?: "vehicle" | undefined;
  exclude?: string | undefined;
  onChange: (id: string) => void;
}) {
  const list = props.locations.filter(
    (l) => (!props.only || l.kind === props.only) && l.id !== props.exclude,
  );
  const chosen = list.find((l) => l.id === props.value);
  if (chosen) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <p className="flex items-center gap-2 font-medium">
          {chosen.kind === "vehicle" ? (
            <Truck className="h-4 w-4" />
          ) : (
            <Warehouse className="h-4 w-4" />
          )}
          {chosen.name}
        </p>
        <Button size="sm" variant="ghost" onClick={() => props.onChange("")}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {list.length === 0 && (
        <li className="px-3 py-2 text-sm text-muted-foreground">No location is set up.</li>
      )}
      {list.map((l) => (
        <li key={l.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-muted"
            onClick={() => props.onChange(l.id)}
          >
            {l.kind === "vehicle" ? (
              <Truck className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Warehouse className="h-4 w-4 text-muted-foreground" />
            )}
            {l.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the material is for (taking) or where it came from (putting in). "purchase" (owner, Oct 9):
 * bought or delivered, no job — an ordinary `leftover` entry with neither a bid nor a ticket.
 */
type Purpose =
  { kind: "job" } | { kind: "vehicle"; id: string } | { kind: "shop" } | { kind: "purchase" };

function RecordDialog(props: {
  mode: Mode;
  initialRef: TargetRef | null;
  initialLocation: string | null;
  initialPurpose: Purpose | null;
  /** A job key, "__pick__" to open the picker, or null for the last job used on this phone. */
  initialJob: string | null;
  locations: InventoryLocation[];
  products: ProductOption[];
  targets: PriceTarget[];
  stock: StockRow[];
  jobs: JobOption[];
  jobsLoaded: boolean;
  /** My open tickets (service job ids), listed first. */
  myJobIds: string[];
  onClose: () => void;
  onSaved: (saved: { id: number; message: string }) => void;
}) {
  const addFn = useServerFn(addMovement);
  const moveFn = useServerFn(transferStock);
  const consumed = props.mode === "consumed";
  // The form unfolds one step at a time: where → product → how much → what for → note.
  const [locationId, setLocationId] = useState<string>(props.initialLocation ?? "");
  const [ref, setRef] = useState<TargetRef | null>(props.initialRef);
  // Two boxes (owner, Oct 9): whole packs and pieces, either or both; blank to start.
  const [packsText, setPacksText] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [purpose, setPurpose] = useState<Purpose | null>(props.initialPurpose);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // How many entries this dialog has saved: it stays open for the next item (owner, Oct 9).
  const [savedCount, setSavedCount] = useState(0);
  const clearAmount = () => {
    setPacksText("");
    setPiecesText("");
  };
  // The job ("service:<id>" / "bid:<id>"): the link (?job= / ?bid=) or my only open ticket,
  // else the last job used on this phone.
  const [jobId, setJobId] = useState<string>(() => props.initialJob ?? readLastJob());
  const pickingJob = jobId === "__pick__";
  const job = pickingJob ? undefined : props.jobs.find((j) => jobKey(j) === jobId);
  useEffect(() => {
    // A remembered job that no longer exists falls back to picking (once the list is in).
    if (!props.jobsLoaded) return;
    if (jobId && jobId !== "__pick__" && !props.jobs.some((j) => jobKey(j) === jobId)) {
      setJobId(props.jobs.length ? "__pick__" : "");
    }
  }, [jobId, props.jobs, props.jobsLoaded]);

  const location = props.locations.find((l) => l.id === locationId);
  const locName = location?.name ?? "";
  const vehicles = props.locations.filter((l) => l.kind === "vehicle" && l.id !== locationId);
  const vehicle =
    purpose?.kind === "vehicle" ? props.locations.find((l) => l.id === purpose.id) : undefined;
  // Putting in from somewhere else counts THAT place (the vehicle it comes off, or the shop it
  // is loaded from); everything else counts the chosen location.
  const fromShop = !consumed && purpose?.kind === "shop";
  const countAt = !consumed && vehicle ? vehicle.id : fromShop ? SHOP_LOCATION_ID : locationId;
  const stockHere = useMemo(
    () => props.stock.filter((s) => s.location_id === countAt),
    [props.stock, countAt],
  );
  // Service materials come in several groups on one screen ("service"): the group with the row.
  const target = ref
    ? props.targets.find((t) => t.screen_id === ref.screen_id && t.rows.includes(ref.row_label))
    : undefined;
  const unit = ref ? (target?.row_units?.[ref.row_label] ?? stockUnitFor(ref.screen_id)) : "";
  const piece = ref ? (target?.pieces?.[ref.row_label] ?? null) : null;
  const onHand = ref
    ? (stockHere.find(
        (s) =>
          s.screen_id === ref.screen_id &&
          s.row_label === ref.row_label &&
          s.price_col === ref.price_col,
      )?.on_hand ?? 0)
    : 0;
  const count = combinedCount(packsText, piecesText, piece);
  const packs = count?.packs ?? NaN;
  // A vehicle → shop move, from either side of the dialog: moves only what came back (what a
  // truck used is taken for its job instead — there is no vehicle write-off).
  const isReturn =
    (!consumed && purpose?.kind === "vehicle") ||
    (consumed && purpose?.kind === "shop" && location?.kind === "vehicle");
  const amountOk = !!count;
  // Taking, returning off a vehicle, or loading from the shop never exceeds what that place holds.
  const limited = consumed || isReturn || fromShop;
  const tooMany = limited && Number.isFinite(packs) && packs > onHand + 1e-9;
  // A job purpose needs its job, taking or leftover alike ("Bought or delivered" is the no-job
  // choice, owner Oct 9).
  const jobOk = purpose?.kind === "job" ? !!job : true;
  const canSave = !!location && !!ref && amountOk && !!purpose && jobOk && !tooMany && !saving;
  // What a place holds, as the boxes count it: "2 boxes (2,000 fasteners)" / "3 pails".
  const fmtOnHand = (v: number) =>
    piece
      ? `${describeStock(v, unit, null)} (${describeStock(v, unit, piece)})`
      : describeStock(v, unit, null);
  const placeText =
    isReturn && vehicle ? `on ${vehicle.name}` : fromShop ? "at the shop" : `at ${locName}`;

  const save = async () => {
    if (!ref || !location || !purpose || !canSave) return;
    setSaving(true);
    try {
      const product = ref.row_label;
      if (!count) return;
      const n = count.qty;
      const pieces = count.inPieces ? { in_pieces: true as const } : {};
      const noteOrNull = note.trim() || null;
      let saved: { id: number; message: string };
      if (purpose.kind === "shop") {
        // Taking off a vehicle back to the shop, or putting on a vehicle from the shop's stock.
        const r = await moveFn({
          data: {
            screen_id: ref.screen_id,
            row_label: ref.row_label,
            price_col: ref.price_col,
            from_location_id: consumed ? location.id : SHOP_LOCATION_ID,
            to_location_id: consumed ? SHOP_LOCATION_ID : location.id,
            qty: n,
            ...pieces,
            note: noteOrNull,
          },
        });
        const moved = describeStock(r.moved, r.unit, piece);
        saved = {
          id: r.ids[0] ?? 0,
          message: consumed
            ? `${moved} of ${product} moved from ${locName} back to the shop`
            : `${moved} of ${product} moved from the shop to ${locName}`,
        };
      } else if (purpose.kind === "vehicle" && vehicle) {
        // Shop → vehicle (loading) or vehicle → shop (returning what came back).
        const r = await moveFn({
          data: {
            screen_id: ref.screen_id,
            row_label: ref.row_label,
            price_col: ref.price_col,
            from_location_id: consumed ? location.id : vehicle.id,
            to_location_id: consumed ? vehicle.id : location.id,
            qty: n,
            ...pieces,
            note: noteOrNull,
          },
        });
        const moved = describeStock(r.moved, r.unit, piece);
        saved = {
          id: r.ids[0] ?? 0,
          message: consumed
            ? `${moved} of ${product} loaded onto ${vehicle.name}`
            : `${moved} of ${product} put back in ${locName} off ${vehicle.name}`,
        };
      } else {
        const reason = consumed ? "consumed" : "leftover";
        // A ticket goes as service_job_id, a bid as bid_id — never both; "Bought or delivered"
        // names neither.
        const forJob = purpose.kind === "job" ? job : undefined;
        const r = await addFn({
          data: {
            screen_id: ref.screen_id,
            row_label: ref.row_label,
            price_col: ref.price_col,
            qty: n,
            ...pieces,
            unit,
            reason,
            location_id: location.id,
            bid_id: forJob?.kind === "bid" ? forJob.id : null,
            service_job_id: forJob?.kind === "service" ? forJob.id : null,
            note: noteOrNull,
          },
        });
        if (forJob) writeLastJob(jobKey(forJob));
        const amount = describeStock(Math.abs(r.qty), r.unit, piece);
        saved = {
          id: r.id,
          message: consumed
            ? `${amount} of ${product} taken from ${locName} for ${forJob ? jobTitle(forJob) : "the job"}`
            : `${amount} of ${product} put in ${locName}${forJob ? ` (left over from ${jobTitle(forJob)})` : " (bought or delivered)"}`,
        };
      }
      props.onSaved(saved);
      // Stay open for the next item (owner, Oct 9): the place, the purpose and the job are kept;
      // only the product, the amount and the note start over.
      setSavedCount((c) => c + 1);
      setRef(null);
      clearAmount();
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record that");
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = saving
    ? "Saving…"
    : !purpose
      ? consumed
        ? "Take from inventory"
        : "Put in inventory"
      : purpose.kind === "shop"
        ? consumed
          ? "Move to the shop"
          : `Move from the shop to ${locName}`
        : purpose.kind === "vehicle"
          ? consumed
            ? location?.kind === "vehicle"
              ? `Move to ${vehicle?.name ?? "the vehicle"}`
              : `Load onto ${vehicle?.name ?? "the vehicle"}`
            : `Put back in ${locName}`
          : consumed
            ? `Take from ${locName}`
            : `Put in ${locName}`;

  const choice = (label: string, active: boolean, onClick: () => void, icon?: React.ReactNode) => (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-muted ${active ? "bg-muted font-medium" : ""}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{consumed ? "Take from inventory" : "Put in inventory"}</DialogTitle>
          <DialogDescription>
            {consumed
              ? "Takes material from the shop or a service vehicle — for a job, to load a vehicle, or to bring it back to the shop."
              : "Puts material in the shop or on a service vehicle — leftovers from a job, something bought or delivered, stock moved from the shop, or what came back off a vehicle."}
          </DialogDescription>
        </DialogHeader>
        {savedCount > 0 && (
          <p className="rounded-md bg-primary/10 px-3 py-2 text-sm" data-saved-line>
            Saved {savedCount === 1 ? "one entry" : `${savedCount} entries`} — pick the next
            product, or Close.
          </p>
        )}
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{consumed ? "Take it from where" : "Put it where"}</Label>
            <LocationPicker
              locations={props.locations}
              value={locationId}
              onChange={(id) => {
                setLocationId(id);
                // Stock differs per location: pick the product and purpose again.
                setRef(null);
                clearAmount();
                setPurpose(props.initialPurpose);
              }}
            />
          </div>
          {location && (
            <div className="space-y-1">
              <Label>Product</Label>
              <ProductPicker
                products={props.products}
                stock={stockHere}
                value={ref}
                onlyInStock={limited}
                onChange={(v) => {
                  setRef(v);
                  clearAmount();
                }}
              />
            </div>
          )}
          {location && ref && (
            <div className="space-y-1" data-amount>
              <Label>
                {isReturn
                  ? consumed
                    ? "How much goes back to the shop"
                    : "How much came back"
                  : "How much"}
              </Label>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {piece ? `Whole ${packUnitLabel(2, unit)}` : unit}
                  </Label>
                  <Input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    className="h-11 w-32 text-lg"
                    value={packsText}
                    onChange={(e) => setPacksText(e.target.value)}
                    placeholder="0"
                    aria-label={piece ? `Whole ${packUnitLabel(2, unit)}` : unit}
                  />
                </div>
                {piece && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{plural(2, piece.name)}</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      className="h-11 w-32 text-lg"
                      value={piecesText}
                      onChange={(e) => setPiecesText(e.target.value)}
                      placeholder="0"
                      aria-label={plural(2, piece.name)}
                    />
                  </div>
                )}
              </div>
              {/* The total, in both units when the product has pieces (owner, Oct 9). */}
              {count && piece && (
                <p className="text-sm font-medium" data-conversion>
                  = {describeStock(count.packs, unit, null)} ·{" "}
                  {describeStock(count.packs, unit, piece)}
                </p>
              )}
              {piece && (
                <p className="text-xs text-muted-foreground">
                  {piece.perPack} {plural(piece.perPack, piece.name)} per {unit}
                </p>
              )}
              {limited && (
                <p className="text-sm text-muted-foreground">
                  {fmtOnHand(onHand)} {placeText}
                </p>
              )}
            </div>
          )}
          {tooMany && (
            <p className="text-sm text-destructive">
              Only {fmtOnHand(onHand)} {placeText}.
            </p>
          )}
          {location && ref && (
            <div className="space-y-1">
              <Label>{consumed ? "What is it for" : "Where is it from"}</Label>
              <ul className="divide-y rounded-md border" data-purposes>
                <li>
                  {choice(
                    consumed ? "A job" : "Left over from a job",
                    purpose?.kind === "job",
                    () => setPurpose({ kind: "job" }),
                  )}
                </li>
                {!consumed && (
                  <li>
                    {choice(
                      "Bought or delivered (no job)",
                      purpose?.kind === "purchase",
                      () => setPurpose({ kind: "purchase" }),
                      <Package className="h-4 w-4 text-muted-foreground" />,
                    )}
                  </li>
                )}
                {!consumed && location.kind === "vehicle" && (
                  <li>
                    {choice(
                      "The shop (takes it off the shop's list)",
                      purpose?.kind === "shop",
                      () => {
                        setPurpose({ kind: "shop" });
                        clearAmount();
                      },
                      <Warehouse className="h-4 w-4 text-muted-foreground" />,
                    )}
                  </li>
                )}
                {consumed && location.kind === "vehicle" && (
                  <li>
                    {choice(
                      "The shop (moves it back to the shop's list)",
                      purpose?.kind === "shop",
                      () => setPurpose({ kind: "shop" }),
                      <Warehouse className="h-4 w-4 text-muted-foreground" />,
                    )}
                  </li>
                )}
                {/* From the shop: load a vehicle / what came back off one. Taking off a vehicle
                    (owner, Oct 9): the other vehicles too — truck to truck is one transfer. */}
                {(location.kind === "shop" || consumed) &&
                  vehicles.map((v) => (
                    <li key={v.id}>
                      {choice(
                        consumed
                          ? location.kind === "vehicle"
                            ? `Move to ${v.name}`
                            : `Load onto ${v.name}`
                          : `Coming back off ${v.name}`,
                        purpose?.kind === "vehicle" && purpose.id === v.id,
                        () => {
                          setPurpose({ kind: "vehicle", id: v.id });
                          clearAmount();
                        },
                        <Truck className="h-4 w-4 text-muted-foreground" />,
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {location && ref && purpose?.kind === "job" && (
            <div className="space-y-1">
              <Label>Which job</Label>
              <JobPicker
                jobs={props.jobs}
                mine={props.myJobIds}
                value={pickingJob ? "" : jobId}
                required
                prefix={consumed ? "For" : "Left over from"}
                onChange={setJobId}
              />
            </div>
          )}
          {location && ref && purpose && (
            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <AutoTextarea
                className="min-h-10"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  consumed
                    ? "e.g. finished the north section"
                    : "e.g. 1 opened box, Smith roof leak"
                }
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={props.onClose}>
              {savedCount > 0 ? "Close" : "Cancel"}
            </Button>
            <Button onClick={save} disabled={!canSave} className="min-w-40">
              {saveLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LedgerTable(props: {
  rows: MovementRow[];
  loading: boolean;
  role: string | null;
  locations: InventoryLocation[];
  /** The page's Where (the stock list's), so a truck's entries can be seen alone (owner, Oct 9). */
  where: string;
  onWhere: (id: string) => void;
  myVehicle: string | undefined;
  onChanged: () => void;
  pieceFor: (cell: { screen_id: string; row_label: string; price_col: string }) => PieceDef | null;
}) {
  const delFn = useServerFn(deleteMovement);
  const undoFn = useServerFn(undoMovement);
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const undo = (id: number) => {
    if (!window.confirm("Remove this entry? Stock on hand changes accordingly.")) return;
    void (props.role === "admin" ? delFn({ data: { id } }) : undoFn({ data: { id } }))
      .then(() => {
        props.onChanged();
        toast.info("Undone — the entry was removed");
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not undo"));
  };
  const locName = (id: string) => props.locations.find((l) => l.id === id)?.name ?? id;
  const here =
    props.where === "all" ? props.rows : props.rows.filter((r) => r.location_id === props.where);
  const rows = here.filter(
    (r) =>
      !f ||
      (r.label ?? "").toLowerCase().includes(f) ||
      r.row_label.toLowerCase().includes(f) ||
      r.category.toLowerCase().includes(f) ||
      locName(r.location_id).toLowerCase().includes(f) ||
      (r.bid_name ?? "").toLowerCase().includes(f) ||
      (r.service_job_name ?? "").toLowerCase().includes(f) ||
      (r.created_by_name ?? "").toLowerCase().includes(f) ||
      REASON_LABELS[r.reason as MovementReason]?.toLowerCase().includes(f),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="h-9 max-w-xs"
          placeholder="Search by product, place, job, person or reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {props.locations.length > 1 && (
          <Select value={props.where} onValueChange={props.onWhere}>
            <SelectTrigger className="h-9 w-[220px]" aria-label="Where">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.id === props.myVehicle ? " (my vehicle)" : ""}
                </SelectItem>
              ))}
              <SelectItem value="all">Everywhere</SelectItem>
            </SelectContent>
          </Select>
        )}
        {props.where !== "all" && (
          <span className="text-xs text-muted-foreground">
            {here.length} at {locName(props.where)}
          </span>
        )}
      </div>
      {props.loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : here.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {props.where === "all" ? "No entries yet." : `No entries at ${locName(props.where)} yet.`}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing matches “{q.trim()}”.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {fmtWhen(r.created_at)}
                  </TableCell>
                  <TableCell className="text-xs">{r.created_by_name ?? ""}</TableCell>
                  <TableCell className="text-xs">
                    {cellName(r)}
                    <span className="text-muted-foreground">
                      {r.label ? ` · ${r.row_label}` : ""} · {r.category}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{locName(r.location_id)}</TableCell>
                  <TableCell
                    className={`whitespace-nowrap text-right text-xs font-semibold tabular-nums ${r.qty < 0 ? "text-destructive" : "text-green-700 dark:text-green-400"}`}
                  >
                    {r.qty > 0 ? "+" : ""}
                    {describeStock(r.qty, r.unit, props.pieceFor(r))}
                  </TableCell>
                  <TableCell className="text-xs">{REASON_LABELS[r.reason]}</TableCell>
                  <TableCell className="text-xs">
                    {r.service_job_name || r.service_job_id ? (
                      <>
                        <JobKindTag kind="service" />
                        {r.service_job_name ?? "(ticket)"}
                      </>
                    ) : r.bid_name || r.bid_id ? (
                      <>
                        <JobKindTag kind="bid" />
                        {r.bid_name ?? "(bid)"}
                      </>
                    ) : (
                      ""
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.counted_note}
                    {r.counted_note && r.note ? " — " : ""}
                    {r.note}
                  </TableCell>
                  <TableCell>
                    {r.can_undo && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        title={
                          props.role === "admin"
                            ? "Remove this entry (admin)"
                            : "Undo — your own entries can be removed for 24 hours"
                        }
                        onClick={() => undo(r.id)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Undo
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * The stock table's red count, for admins and managers: a link to the Reconcile tab, which says
 * what took the count below zero and holds the fix (owner, Oct 9).
 */
function FixOnReconcile() {
  return (
    <Link
      to="/inventory"
      search={{ tab: "reconcile" }}
      className="block text-xs font-normal underline underline-offset-2"
      data-fix-on-reconcile
    >
      Fix on Reconcile
    </Link>
  );
}

/**
 * Reconcile (owner, Oct 9; admins and managers; its own tab since the same day — "a bit confusing
 * on what its showing and what the buttons do"): the counts the app shows below zero and where
 * each went wrong, in three plainly titled blocks. (a) "Below zero now": every cell below zero —
 * current state whatever week is picked — with the entries that took it there (who / ticket /
 * when / how much; inventory-reconcile.ts walks the ledger) and the fix: the real count and Save
 * count, which records ONE `adjustment` through addMovement so on hand becomes what was counted.
 * There is no dismiss — the only way off the list is a corrected count. (b) "Logged with none in
 * the app": the picked Monday–Sunday week's "Short:" entries, a tech logging material the app
 * said was not there; (c) "Fixed": the week's corrected cells. Who may save a count is
 * addMovement's own rule (Estimate access or admin — a manager has it through canAccess); others
 * see the list and a line to ask. The query runs only while this tab is shown: the tab mounts it.
 */
function ReconcileTab(props: { canSetCount: boolean }) {
  const fn = useServerFn(getReconciliation);
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()));
  const thisWeek = weekStartOf(new Date());
  const q = useQuery({
    queryKey: ["inventory-reconcile", weekStart],
    queryFn: () => fn({ data: { weekStart } }),
  });
  const r = q.data;
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-reconcile"] });
    void qc.invalidateQueries({ queryKey: ["inventory-stock"] });
    void qc.invalidateQueries({ queryKey: ["inventory-movements"] });
  };
  // The two weekly blocks name their week: "this week", or the picked week's days.
  const weekWord =
    weekStart === thisWeek ? "this week" : r ? `the week of ${r.weekLabel}` : "that week";
  // Each block's body: loading, else the report; an error shows once, above the blocks.
  const body = (render: (rep: Reconciliation) => React.ReactNode) =>
    q.isPending ? <p className="text-muted-foreground">Loading…</p> : r ? render(r) : null;
  const blockTitle = (title: React.ReactNode, explain: string) => (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{explain}</p>
    </div>
  );
  return (
    <Card data-card="reconcile">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4" /> Reconcile
        </CardTitle>
        <CardDescription>
          Counts inventory shows below zero, and where each one went wrong. Type what is really on
          the shelf or truck and save it — that is the only way a line leaves this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {q.error && (
          <p className="text-destructive">
            {q.error instanceof Error ? q.error.message : "Could not load the report"}
          </p>
        )}
        <section className="space-y-3" data-block="below-zero">
          {blockTitle(
            "Below zero now",
            "Every place and item inventory counts below zero today, whatever week is picked, and the entries that took it there.",
          )}
          {body((rep) =>
            rep.negatives.length === 0 ? (
              <p className="text-muted-foreground">Nothing is below zero right now.</p>
            ) : (
              <>
                {!props.canSetCount && (
                  <p className="text-muted-foreground">
                    Ask an admin or a manager to save the count.
                  </p>
                )}
                {rep.negatives.map((n) => (
                  <NegativeRow
                    key={`${n.location_id}|${n.screen_id}|${n.row_label}|${n.price_col}`}
                    cell={n}
                    canSetCount={props.canSetCount}
                    onSet={refreshAll}
                  />
                ))}
              </>
            ),
          )}
        </section>
        <section className="space-y-3" data-block="short">
          <div className="flex flex-wrap items-start justify-between gap-2">
            {blockTitle(
              <>Logged with none in inventory — {weekWord}</>,
              "A tech logged material inventory said was not there. The count at that place went below zero; fix it above or on the Stock tab.",
            )}
            <div className="flex flex-wrap items-center gap-2" data-week-picker>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous week"
                onClick={() => setWeekStart((w) => shiftWeek(w, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[9rem] text-center font-medium">
                {r ? r.weekLabel : "…"}
                {weekStart === thisWeek && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (this week)
                  </span>
                )}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next week"
                disabled={weekStart >= thisWeek}
                onClick={() => setWeekStart((w) => shiftWeek(w, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {body((rep) =>
            rep.shortEntries.length === 0 ? (
              <p className="text-muted-foreground">
                Nothing was logged with none in inventory {weekWord}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Ticket</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rep.shortEntries.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {fmtOfficeWhen(e.at)}
                        </TableCell>
                        <TableCell className="text-xs">{e.by_name ?? "(unknown)"}</TableCell>
                        <TableCell className="text-xs">
                          {e.service_job_id ? (
                            <Link
                              to="/service"
                              search={{ id: e.service_job_id }}
                              className="underline underline-offset-2"
                            >
                              {e.service_job_name ?? e.service_job_id}
                            </Link>
                          ) : (
                            ""
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{e.location_name}</TableCell>
                        <TableCell className="text-xs">{e.name}</TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs font-semibold tabular-nums text-destructive">
                          {fmtSigned(e.qty)} {packUnitLabel(e.qty, e.unit)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ),
          )}
        </section>
        <section className="space-y-3" data-block="fixed">
          {blockTitle(<>Fixed {weekWord}</>, "Counts that were below zero and were corrected.")}
          {body((rep) =>
            rep.fixed.length === 0 ? (
              <p className="text-muted-foreground">Nothing was fixed {weekWord}.</p>
            ) : (
              <ul className="space-y-0.5 pl-4 text-muted-foreground">
                {rep.fixed.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium text-foreground">
                      {f.location_name} · {f.name}
                    </span>
                    : went below zero {fmtOfficeWhen(f.wentBelowAt)}, counted back to{" "}
                    {fmtQty(f.on_hand)} {packUnitLabel(f.on_hand, f.unit)}{" "}
                    {fmtOfficeWhen(f.fixedAt)}
                  </li>
                ))}
              </ul>
            ),
          )}
        </section>
      </CardContent>
    </Card>
  );
}

/**
 * One cell below zero: what the app shows and since when, the entries that took it there, and
 * the fix — the real count and Save count, which ends it.
 */
function NegativeRow(props: { cell: NegativeCell; canSetCount: boolean; onSet: () => void }) {
  const n = props.cell;
  const addFn = useServerFn(addMovement);
  // The box's TEXT (owner, Oct 9: a blank box must not enable Save count; a typed "0" must).
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const counted = parseCounted(text);
  const payload = counted === null ? null : reconcileAdjustment(n, counted);
  const place = placeWord(n.location_id);
  const boxId = `count-${n.location_id}-${n.screen_id}-${n.row_label}-${n.price_col}`;
  const setCount = async () => {
    if (!payload || counted === null) return;
    setBusy(true);
    try {
      await addFn({ data: payload });
      toast.success(`${n.location_name} · ${n.name} set to ${fmtQty(counted)} ${n.unit}`);
      setText("");
      props.onSet();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set the count", {
        duration: 10000,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-md border p-3" data-negative-cell>
      <div>
        <p className="font-semibold">
          {n.location_name} · {n.name}:{" "}
          <span className="text-destructive">
            inventory shows {fmtSigned(n.on_hand)} {packUnitLabel(n.on_hand, n.unit)}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Went below zero {fmtOfficeWhen(n.firstBelowZeroAt)}
        </p>
      </div>
      <div className="overflow-x-auto" data-contributors>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What took it there
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {n.contributors.map((c, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap text-xs">{fmtOfficeWhen(c.at)}</TableCell>
                <TableCell className="text-xs">{c.by_name ?? "(unknown)"}</TableCell>
                <TableCell className="text-xs">
                  {c.service_job_id ? (
                    <Link
                      to="/service"
                      search={{ id: c.service_job_id }}
                      className="underline underline-offset-2"
                    >
                      {c.service_job_name ?? c.service_job_id}
                    </Link>
                  ) : (
                    ""
                  )}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right text-xs font-semibold tabular-nums ${c.qty < 0 ? "text-destructive" : ""}`}
                >
                  {fmtSigned(c.qty)} {packUnitLabel(c.qty, n.unit)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.short && (
                    <span
                      className="mr-1 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-medium text-destructive"
                      data-short-badge
                    >
                      logged with none in inventory
                    </span>
                  )}
                  {REASON_LABELS[c.reason as MovementReason] ?? c.reason}
                  {c.note ? ` — ${c.note}` : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {n.more > 0 && <p className="mt-1 text-xs text-muted-foreground">+{n.more} more</p>}
      </div>
      {props.canSetCount && (
        <div className="space-y-1" data-fix-row>
          <Label htmlFor={boxId} className="text-xs">
            Really on the {place} now
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={boxId}
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              className="h-9 w-28"
              placeholder="count"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && payload && !busy) void setCount();
              }}
            />
            <span className="text-xs text-muted-foreground">{packUnitLabel(2, n.unit)}</span>
            <Button
              type="button"
              size="sm"
              disabled={!payload || busy}
              onClick={() => void setCount()}
            >
              Save count
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Records one adjustment so inventory matches your count.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Set count on a stock row (owner, Oct 9: counting a shelf DOWN was impossible — nothing sent an
 * adjustment for a cell at or above zero). A popover with one box in the stock unit (packs, as
 * every adjustment is) and Save count (the Reconcile tab's words, owner Oct 9); on-hand becomes
 * what was typed through the same reconcileAdjustment → addMovement path the Reconcile tab uses,
 * with its own note. Shown to
 * canAccess(profile, "estimate") (admins and managers pass); the server keeps its own rule.
 */
function SetCountButton(props: { row: StockRow; locationName: string; onSet: () => void }) {
  const r = props.row;
  const addFn = useServerFn(addMovement);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const counted = parseCounted(text);
  const payload = counted === null ? null : reconcileAdjustment(r, counted, COUNT_NOTE);
  const setCount = async () => {
    if (!payload || counted === null) return;
    setBusy(true);
    try {
      await addFn({ data: payload });
      toast.success(
        `${props.locationName} · ${cellName(r)} set to ${describeStock(counted, r.unit, null)}`,
      );
      setText("");
      setOpen(false);
      props.onSet();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set the count", {
        duration: 10000,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setText("");
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" data-set-count>
          Set count
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2">
        <p className="text-sm font-medium">{cellName(r)}</p>
        <p className="text-xs text-muted-foreground">
          {props.locationName} · now {describeStock(r.on_hand, r.unit, null)}
          {r.piece ? ` (${describeStock(r.on_hand, r.unit, r.piece)})` : ""}
        </p>
        <Label className="text-xs">Really on the {placeWord(r.location_id)} now</Label>
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            className="h-9 w-28"
            placeholder="count"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && payload && !busy) void setCount();
            }}
          />
          <span className="text-xs text-muted-foreground">{packUnitLabel(2, r.unit)}</span>
          <Button
            type="button"
            size="sm"
            disabled={!payload || busy}
            onClick={() => void setCount()}
          >
            Save count
          </Button>
        </div>
        {counted !== null && !payload && (
          <p className="text-xs text-muted-foreground">That is the count already.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Records one adjustment so inventory matches your count.
        </p>
      </PopoverContent>
    </Popover>
  );
}
