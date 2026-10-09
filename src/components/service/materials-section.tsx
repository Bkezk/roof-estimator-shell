/**
 * The close-out's Materials section (docs/service-module-design.md §5.3, §12.5; owner, Sep 27:
 * log material with one tap and never leave the screen).
 *
 * Owner, Oct 9 (the screenshot: three ways to add, a dead truck block for someone with no truck,
 * a heading still saying "off the truck"): one list and one way in. Top to bottom — "Anything
 * used?" while nothing is logged; the "Usual for <repair>" chips; ONE "On this ticket" list of
 * everything logged from any place (materials-on-ticket.ts), each line a TruckRow with −, the
 * typeable count and + and "from Shop" / "from Truck 2" under the name; "Find any material",
 * the one entry point, which searches every cell anyone has stocked plus the service material
 * list and takes one from my truck, the shop or another truck in a tap (material-search.ts), with
 * a "Browse the shop" link that opens the "Material from elsewhere" panel (a whole location's
 * shelf) for anyone who does not know the name; and "What's on my truck", a fold holding the
 * on-hand rows of the vehicle the tech drives (myTruckStock), collapsed until a truck row has a
 * count, and not there at all when no truck is set up for the login.
 *
 * + records one piece (or one pack when the product has no pieces) as a `consumed` movement
 * against the ticket at that place; − takes one back (see planReduce: the tech's own recent entry
 * is undone, else a `released` movement the server caps at what the ticket took).
 *
 * Taps are optimistic (the count and the on-hand move at once) and run one after another so a
 * "−" always sees the entry the "+" before it made; a refusal rolls the count back and is shown
 * loudly. When the queue is empty the ticket's materials, the truck and Inventory's lists are
 * re-read.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Truck,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  addMovement,
  listLocations,
  listStock,
  myServiceDefaults,
  myTruckStock,
  undoMovement,
  type StockRow,
  type TruckStockRow,
} from "@/lib/inventory.functions";
import { listServiceJobMaterials, type JobMaterialRow } from "@/lib/service.functions";
import {
  listJobRepairs,
  listServiceMaterialOptions,
  usualMaterialsForTemplate,
} from "@/lib/service-field.functions";
import {
  SEARCH_MIN_CHARS,
  searchMaterials,
  type MaterialResult,
  type MaterialSource,
} from "@/lib/material-search";
import { onTicketRows } from "@/lib/materials-on-ticket";
import { plural, type PieceDef } from "@/lib/stock-units";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Box } from "@/components/service/field-shared";
import { errText, fieldKeys, loudError } from "@/components/service/field-utils";
import {
  EPS,
  amountText,
  catalogKey,
  cellKey,
  cellName,
  fmtNum,
  matchesSearch,
  onHandText,
  ownFreshEntries,
  packsToUnits,
  pieceFromLedger,
  planReduce,
  round6,
  suggestedUnits,
  unitLabel,
  usedPacks,
  type LocatedCell,
} from "@/components/service/materials-utils";

/** Rows shown before "Show all". */
const FIRST_ROWS = 12;
const VEHICLE_KEY = "bid-o-matic:closeout:vehicle";
const truckKey = (userId: string) => ["service-my-truck-stock", userId] as const;
const usualKey = (templateId: string) => ["service-usual-materials", templateId] as const;

function readVehicle(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(VEHICLE_KEY);
  } catch {
    return null;
  }
}
function writeVehicle(id: string) {
  try {
    window.localStorage.setItem(VEHICLE_KEY, id);
  } catch {
    // Storage blocked: the choice lasts for this screen only.
  }
}

/** A row of the list: a truck stock row, or a cell this ticket used that the truck ran out of. */
interface ListRow extends LocatedCell {
  key: string;
  /** The service material name, or null (the catalog label stands): cellName. */
  label: string | null;
  category: string;
  unit: string;
  on_hand: number;
  piece: PieceDef | null;
  item_no: string | null;
  location_name: string;
}

export function MaterialsSection({
  jobId,
  collapsible,
  defaultOpen,
  storageKey = "materials",
}: {
  jobId: string;
  /** The office ticket page: a collapsible section with "N lines" in the header. */
  collapsible?: boolean | undefined;
  /** Its first open state (the remembered one wins once toggled). */
  defaultOpen?: boolean | undefined;
  /** Where the open state is remembered (managers reviewing a Done / Authorized ticket: their own). */
  storageKey?: string | undefined;
}) {
  const { session, profile, can } = useAuth();
  const qc = useQueryClient();
  const userId = profile?.id ?? "";
  const myName = profile ? profile.full_name?.trim() || profile.email : null;
  const canLog = can("service") || can("inventory") || can("estimate");
  // Putting a piece back against this ticket is allowed for any login that may log material
  // (the server caps it at what the ticket took).
  const canRelease = canLog;

  const materialsFn = useServerFn(listServiceJobMaterials);
  const truckFn = useServerFn(myTruckStock);
  const defaultsFn = useServerFn(myServiceDefaults);
  const locationsFn = useServerFn(listLocations);
  const repairsFn = useServerFn(listJobRepairs);
  const usualFn = useServerFn(usualMaterialsForTemplate);
  const stockFn = useServerFn(listStock);
  const optionsFn = useServerFn(listServiceMaterialOptions);
  const addFn = useServerFn(addMovement);
  const undoFn = useServerFn(undoMovement);

  const materials = useQuery({
    queryKey: fieldKeys.materials(jobId),
    queryFn: () => materialsFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const truck = useQuery({
    queryKey: truckKey(userId),
    queryFn: () => truckFn({ data: {} }),
    enabled: !!session && !!userId && canLog,
  });
  // Shared with Inventory's "Take from" defaults and location list (same functions, same keys).
  const defaults = useQuery({
    queryKey: ["inventory-my-defaults", userId],
    queryFn: () => defaultsFn(),
    enabled: !!session && !!userId,
    staleTime: 5 * 60_000,
  });
  const locations = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => locationsFn(),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
  const repairs = useQuery({
    queryKey: fieldKeys.repairs(jobId),
    queryFn: () => repairsFn({ data: { id: jobId } }),
    enabled: !!session,
  });

  // The repair templates on this ticket, once each, in the order they were added.
  const templates = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of repairs.data ?? [])
      if (r.repair_template_id && !seen.has(r.repair_template_id))
        seen.set(r.repair_template_id, r.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [repairs.data]);
  const usual = useQueries({
    queries: templates.map((t) => ({
      queryKey: usualKey(t.id),
      queryFn: () => usualFn({ data: { template_id: t.id } }),
      enabled: !!session,
      staleTime: 10 * 60_000,
    })),
  });

  const ledger: JobMaterialRow[] = useMemo(() => materials.data ?? [], [materials.data]);
  const locName = (id: string) =>
    (locations.data ?? []).find((l) => l.id === id)?.name ??
    (truck.data ?? []).find((r) => r.location_id === id)?.location_name ??
    (id === "shop" ? "Shop" : id);

  // Which truck: the ones I drive today, plus any that hold stock for me.
  const vehicles = useMemo(() => {
    const ids = new Set<string>(defaults.data?.vehicle_ids ?? []);
    for (const r of truck.data ?? []) ids.add(r.location_id);
    return [...ids];
  }, [defaults.data, truck.data]);
  // Owner, Oct 8: material from the shop or another truck is picked HERE (the Inventory page
  // jump "kicks you out of the workflow"); `fromLoc` is the open panel's location.
  const [fromLoc, setFromLoc] = useState<string | null>(null);
  const other = useQuery({
    queryKey: ["inventory-location-stock", fromLoc],
    queryFn: () => truckFn({ data: { location_id: fromLoc! } }),
    enabled: !!session && !!fromLoc && canLog,
  });
  const [otherSearch, setOtherSearch] = useState("");
  // Owner, Oct 9: "Find any material" — every stocked cell at every location (the same read as
  // the Inventory page, so one cache) plus the service material list, read once the box has two
  // characters; the results say where each can be taken from (material-search.ts).
  const [find, setFind] = useState("");
  const findQ = find.trim();
  const finding = findQ.length >= SEARCH_MIN_CHARS;
  const stock = useQuery({
    queryKey: ["inventory-stock"],
    queryFn: () => stockFn(),
    enabled: !!session && canLog && finding,
    staleTime: 60_000,
  });
  const options = useQuery({
    queryKey: ["service-material-options"],
    queryFn: () => optionsFn(),
    enabled: !!session && canLog && finding,
    staleTime: 5 * 60_000,
  });
  const [picked, setPicked] = useState<string | null>(() => readVehicle());
  const vehicleId = picked && vehicles.includes(picked) ? picked : (vehicles[0] ?? null);
  const pickVehicle = (id: string) => {
    setPicked(id);
    writeVehicle(id);
  };

  // Optimistic change per cell, in units (pieces or packs), until the server answers.
  const [pending, setPending] = useState<Record<string, number>>({});
  const bump = (key: string, delta: number) =>
    setPending((p) => {
      const v = round6((p[key] ?? 0) + delta);
      const next = { ...p };
      if (Math.abs(v) < EPS) delete next[key];
      else next[key] = v;
      return next;
    });

  // The list for the chosen truck: its stock rows, plus cells this ticket used there that the
  // truck has run out of (myTruckStock lists only what is on hand), so a count never vanishes.
  const rows: ListRow[] = useMemo(() => {
    if (!vehicleId) return [];
    const stock = (truck.data ?? []).filter((r) => r.location_id === vehicleId);
    const out: ListRow[] = stock.map((r: TruckStockRow) => ({
      key: cellKey(r),
      location_id: r.location_id,
      screen_id: r.screen_id,
      row_label: r.row_label,
      label: r.label,
      price_col: r.price_col,
      category: r.category,
      unit: r.unit,
      on_hand: r.on_hand,
      piece: r.piece,
      item_no: r.item_no,
      location_name: r.location_name,
    }));
    const have = new Set(out.map((r) => r.key));
    const categoryOf = new Map((truck.data ?? []).map((r) => [r.screen_id, r.category]));
    for (const m of ledger) {
      if (m.location_id !== vehicleId) continue;
      const key = cellKey(m);
      if (have.has(key)) continue;
      have.add(key);
      out.push({
        key,
        location_id: m.location_id,
        screen_id: m.screen_id,
        row_label: m.row_label,
        label: m.label,
        price_col: m.price_col,
        category: categoryOf.get(m.screen_id) ?? "",
        unit: m.unit,
        on_hand: 0,
        piece: pieceFromLedger(ledger, m),
        item_no: null,
        location_name: "",
      });
    }
    return out;
  }, [truck.data, ledger, vehicleId]);

  const otherRows: ListRow[] = useMemo(
    () =>
      (other.data ?? [])
        .filter((r) => r.location_id === fromLoc)
        .map((r: TruckStockRow) => ({
          key: cellKey(r),
          location_id: r.location_id,
          screen_id: r.screen_id,
          row_label: r.row_label,
          label: r.label,
          price_col: r.price_col,
          category: r.category,
          unit: r.unit,
          on_hand: r.on_hand,
          piece: r.piece,
          item_no: r.item_no,
          location_name: r.location_name,
        })),
    [other.data, fromLoc],
  );

  /** Units this ticket used of the row (server + not yet answered). */
  const usedUnits = (r: ListRow) =>
    round6(packsToUnits(usedPacks(ledger, r), r.piece) + (pending[r.key] ?? 0));
  /** Units on the truck now (server − not yet answered). */
  const onHandUnits = (r: ListRow) =>
    round6(packsToUnits(r.on_hand, r.piece) - (pending[r.key] ?? 0));

  // Rows with a count on this ticket sort to the top. The order is taken when the list loads,
  // the truck or the search changes — not on every tap, so a row never jumps under a finger.
  const countsRef = useRef<Map<string, number>>(new Map());
  countsRef.current = new Map(rows.map((r) => [r.key, usedPacks(ledger, r)]));
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Owner, Oct 9: the truck list is a fold under the search, closed until a truck row has a count
  // on this ticket (null: not toggled yet, the count decides).
  const [truckOpen, setTruckOpen] = useState<boolean | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const loaded = materials.isSuccess && truck.isSuccess;
  useEffect(() => {
    if (!loaded) return;
    setPinned(
      new Set([...countsRef.current].filter(([, packs]) => packs > EPS).map(([key]) => key)),
    );
  }, [loaded, vehicleId, search, showAll]);

  const q = search.trim();
  const filtered = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => matchesSearch(r, q))
    .sort((a, b) => Number(pinned.has(b.r.key)) - Number(pinned.has(a.r.key)) || a.i - b.i)
    .map(({ r }) => r);
  const visible = q || showAll ? filtered : filtered.slice(0, FIRST_ROWS);

  // ---- The queue: one server change at a time, in tap order.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const inFlight = useRef(0);
  const [busy, setBusy] = useState(0);
  const refreshAll = () => {
    for (const k of [
      fieldKeys.materials(jobId),
      truckKey(userId),
      ["inventory-stock"],
      ["inventory-location-stock"],
      ["inventory-movements"],
    ])
      void qc.invalidateQueries({ queryKey: k });
  };
  const enqueue = (key: string, delta: number, what: string, run: () => Promise<void>) => {
    bump(key, delta);
    inFlight.current += 1;
    setBusy(inFlight.current);
    chain.current = chain.current.then(async () => {
      try {
        await run();
      } catch (e) {
        loudError(what, e);
      } finally {
        bump(key, -delta);
        inFlight.current -= 1;
        setBusy(inFlight.current);
        if (inFlight.current === 0) refreshAll();
      }
    });
  };

  /** Put the server's answer into the caches at once (the re-read follows when idle). */
  const recorded = (
    r: ListRow,
    res: { id: number; qty: number; unit: string },
    note: string | null,
  ) => {
    qc.setQueryData<JobMaterialRow[]>(fieldKeys.materials(jobId), (old) =>
      (old ?? []).some((m) => m.id === res.id)
        ? old
        : [
            {
              id: res.id,
              location_id: r.location_id,
              screen_id: r.screen_id,
              row_label: r.row_label,
              label: r.label,
              price_col: r.price_col,
              qty: res.qty,
              unit: res.unit,
              counted_note: note,
              created_by_name: myName,
              created_at: new Date().toISOString(),
            },
            ...(old ?? []),
          ],
    );
    moveTruck(r, res.qty);
  };
  const moveTruck = (r: ListRow, packs: number) => {
    const shift = (old: TruckStockRow[] | undefined) =>
      old?.map((t) => (cellKey(t) === r.key ? { ...t, on_hand: round6(t.on_hand + packs) } : t));
    qc.setQueryData<TruckStockRow[]>(truckKey(userId), shift);
    qc.setQueryData<TruckStockRow[]>(["inventory-location-stock", r.location_id], shift);
    // The search results read the all-locations stock: move it too, until the re-read.
    qc.setQueryData<StockRow[]>(["inventory-stock"], (old) =>
      old?.map((t) =>
        t.location_id === r.location_id && catalogKey(t) === catalogKey(r)
          ? { ...t, on_hand: round6(t.on_hand + packs) }
          : t,
      ),
    );
  };

  const record = async (
    r: ListRow,
    units: number,
    reason: "consumed" | "released",
    shortOk = false,
  ) => {
    const res = await addFn({
      data: {
        screen_id: r.screen_id,
        row_label: r.row_label,
        price_col: r.price_col,
        qty: units,
        in_pieces: !!r.piece,
        unit: r.unit,
        reason,
        location_id: r.location_id,
        service_job_id: jobId,
        ...(shortOk ? { short_ok: true } : {}),
      },
    });
    recorded(r, res, r.piece ? `${fmtNum(units)} ${plural(units, r.piece.name)}` : null);
  };
  const undo = async (r: ListRow, id: number) => {
    await undoFn({ data: { id } });
    const gone = (qc.getQueryData<JobMaterialRow[]>(fieldKeys.materials(jobId)) ?? []).find(
      (m) => m.id === id,
    );
    qc.setQueryData<JobMaterialRow[]>(fieldKeys.materials(jobId), (old) =>
      old?.filter((m) => m.id !== id),
    );
    if (gone) moveTruck(r, -Number(gone.qty));
  };

  /**
   * Use `units` more of the row on this ticket. `checkStock` false: a line whose on-hand this
   * screen does not hold (an "On this ticket" line from a place the app has not read, a search
   * result before the stock read) — the server checks it (addMovement: "Only N … on the shelf").
   */
  // Owner, Oct 9: material the app says is not there can still be logged ("even if there is
  // not stock of that item in the shop or vehicle") — after a question that first sends them
  // to the right place if it came from elsewhere (owner: never "the office fixes it", they
  // should do it right themselves). `short` is the open question; the weekly reconciliation
  // report (inventory-reconcile.ts) lists every short entry so the counts get corrected.
  const [short, setShort] = useState<{ r: ListRow; units: number } | null>(null);
  const add = (r: ListRow, units: number, checkStock = true, shortOk = false) => {
    if (!(units > EPS)) return;
    const onHand = onHandUnits(r);
    if (checkStock && !shortOk && units > onHand + EPS) {
      setShort({ r, units });
      return;
    }
    enqueue(r.key, units, `Could not log ${cellName(r)}`, () =>
      record(r, units, "consumed", shortOk),
    );
  };

  /** Take `units` back off this ticket (they stay on the truck). */
  const reduce = (r: ListRow, units: number) => {
    if (!(units > EPS)) return;
    if (units > usedUnits(r) + EPS) {
      loudError(
        `Cannot take back ${cellName(r)}`,
        new Error(`this ticket has only ${amountText(Math.max(0, usedUnits(r)), r.piece, r.unit)}`),
      );
      return;
    }
    enqueue(r.key, -units, `Could not take back ${cellName(r)}`, async () => {
      // Planned when its turn comes, so it sees the entries the taps before it made.
      const now = qc.getQueryData<JobMaterialRow[]>(fieldKeys.materials(jobId)) ?? [];
      const plan = planReduce(ownFreshEntries(now, r, r.piece, myName), units, canRelease);
      if (!plan)
        throw new Error(
          "only your own entries from the last 24 hours can be taken back here; ask the office to correct the ticket",
        );
      for (const step of plan) {
        if (step.kind === "undo") await undo(r, step.id);
        else if (step.kind === "release") await record(r, step.units, "released");
        else {
          try {
            await record(r, step.units, "consumed");
          } catch (e) {
            throw new Error(
              `took back more than asked and could not re-log ${amountText(step.units, r.piece, r.unit)} (${errText(e)}); tap + to add them again`,
            );
          }
        }
      }
    });
  };

  /** Set the ticket's total for the row (the typed box). */
  const setTotal = (r: ListRow, total: number, checkStock = true) => {
    const delta = round6(total - usedUnits(r));
    if (delta > EPS) add(r, delta, checkStock);
    else if (delta < -EPS) reduce(r, -delta);
  };

  // The rows this screen already knows the piece / service name of lend them to the results.
  const known = useMemo(
    () => [...(truck.data ?? []), ...(other.data ?? [])],
    [truck.data, other.data],
  );
  const found: MaterialResult[] = useMemo(
    () =>
      searchMaterials(
        findQ,
        stock.data ?? null,
        options.data ?? [],
        locations.data ?? [],
        vehicleId,
        known,
      ),
    [findQ, stock.data, options.data, locations.data, vehicleId, known],
  );
  /**
   * A source chip: one unit (one pack when the cell has no pieces) of the result against this
   * ticket at THAT location, through the same path as a truck row's +. The stock check runs here
   * when the all-locations read answered (so a refusal is instant); else the server checks.
   */
  const addFromSearch = (res: MaterialResult, src: MaterialSource) => {
    const r: ListRow = {
      key: cellKey({ ...res, location_id: src.location_id }),
      location_id: src.location_id,
      screen_id: res.screen_id,
      row_label: res.row_label,
      price_col: res.price_col,
      label: res.label,
      category: res.category,
      unit: res.unit,
      on_hand: src.on_hand ?? 0,
      piece: res.piece,
      item_no: res.item_no,
      location_name: src.location_name,
    };
    add(r, 1, src.on_hand !== null);
  };
  /** What a source chip says is left there, net of taps not yet answered. */
  const sourceLeft = (res: MaterialResult, src: MaterialSource): string => {
    if (src.on_hand === null) return "?";
    const key = cellKey({ ...res, location_id: src.location_id });
    const units = round6(packsToUnits(src.on_hand, res.piece) - (pending[key] ?? 0));
    return units <= EPS ? "none in the app" : `${amountText(units, res.piece, res.unit)} left`;
  };
  const sourceName = (src: MaterialSource) =>
    src.kind === "mine" ? "My truck" : src.kind === "shop" ? "Shop" : src.location_name;

  // Everything this ticket used anywhere (for the reminder).
  const anyUsed = usedTotalPositive(ledger) || Object.values(pending).some((v) => v > EPS);
  // Owner, Oct 9: ONE list of what is on the ticket from any place, first logged first
  // (materials-on-ticket.ts), every line with the same −, typed total and + as a truck row — a
  // tech corrects a shop line too, not only a manager. + takes more from the same place: a stock
  // this screen knows (the truck, the browse panel, the all-locations read) is checked here and a
  // shortfall asks the short-stock question; else the server checks ("Only N … on the shelf").
  // − is the truck's take-back: own entries from the last 24 h are undone, else a "released"
  // movement the server caps at what the ticket took (planReduce; the loud message says so).
  const onTicket = onTicketRows(ledger, [...rows, ...otherRows], locName, (c) => {
    const hit = (stock.data ?? []).find(
      (t) => t.location_id === c.location_id && catalogKey(t) === catalogKey(c),
    );
    return hit ? hit.on_hand : null;
  });
  const itemsOnTicket = onTicket.length;
  const truckHasCount = rows.some((r) => usedUnits(r) > EPS);
  const truckShown = truckOpen ?? truckHasCount;

  // Lines on the ticket: the cells with something used (or returned) net of take-backs.
  const lineCount = useMemo(() => {
    const byCell = new Map<string, number>();
    for (const m of ledger) byCell.set(cellKey(m), (byCell.get(cellKey(m)) ?? 0) + Number(m.qty));
    return [...byCell.values()].filter((v) => Math.abs(v) > EPS).length;
  }, [ledger]);

  const body = (
    <>
      {materials.error && (
        <p className="text-sm text-destructive">
          Could not load this ticket's materials: {errText(materials.error)}
        </p>
      )}
      {materials.isSuccess && !anyUsed && (
        <p className="font-medium text-amber-700 dark:text-amber-400">Anything used?</p>
      )}

      {!canLog ? (
        <p className="text-sm text-muted-foreground">
          Logging material needs Service or Inventory access; ask the office.
        </p>
      ) : (
        <>
          {vehicleId &&
            templates.map((t, i) => {
              const list = usual[i]?.data ?? [];
              if (!list.length) return null;
              return (
                <div key={t.id} className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" /> Usual for {t.name}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {list.map((u) => {
                      const key = cellKey({ ...u, location_id: vehicleId });
                      const r = rows.find((x) => x.key === key);
                      const piece =
                        r?.piece ??
                        (truck.data ?? []).find((x) => catalogKey(x) === catalogKey(u))?.piece ??
                        null;
                      const want = suggestedUnits(u.avg_qty, piece);
                      const have = r ? usedUnits(r) : 0;
                      const done = have >= want - EPS;
                      const label = `${cellName(u)} · ${amountText(want, piece, r?.unit ?? u.unit)}`;
                      return (
                        <Button
                          key={key}
                          type="button"
                          variant={done ? "secondary" : "outline"}
                          aria-pressed={done}
                          className={`h-11 max-w-full justify-start rounded-full px-4 text-sm ${
                            done
                              ? "border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                              : !r || onHandUnits(r) <= EPS
                                ? "border-dashed text-muted-foreground"
                                : ""
                          }`}
                          title={`Used on ${u.tickets} earlier ${u.tickets === 1 ? "ticket" : "tickets"} with this repair`}
                          onClick={() => {
                            if (done) {
                              toast.info(`${cellName(u)}: already on this ticket`);
                              return;
                            }
                            if (!r || onHandUnits(r) <= EPS) {
                              toast.warning(
                                `${cellName(u)} is not on ${locName(vehicleId)} — take it from the shop or another truck`,
                                { duration: 8000 },
                              );
                              return;
                            }
                            add(r, round6(want - have));
                          }}
                        >
                          {done ? (
                            <Check className="mr-1 h-4 w-4 shrink-0" />
                          ) : (
                            <Plus className="mr-1 h-4 w-4 shrink-0" />
                          )}
                          <span className="truncate">{label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {onTicket.length > 0 && (
            <div className="space-y-1.5" aria-label="On this ticket">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                On this ticket
              </p>
              <ul className="divide-y rounded-lg border">
                {onTicket.map((r) =>
                  r.packs > EPS ? (
                    <TruckRow
                      key={r.key}
                      row={r}
                      used={usedUnits(r)}
                      onHand={onHandUnits(r)}
                      fromText={r.from}
                      onAdd={(n) => add(r, n, r.known)}
                      onReduce={(n) => reduce(r, n)}
                      onSet={(n) => setTotal(r, n, r.known)}
                    />
                  ) : (
                    // A return with nothing used: shown, not corrected (nothing to take back).
                    <li key={r.key} className="flex justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        {cellName(r)}
                        <span className="block text-xs text-muted-foreground">{r.from}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        returned {amountText(packsToUnits(-r.packs, r.piece), r.piece, r.unit)}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}

          <div className="space-y-2" aria-label="Find any material">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="h-11 pl-9 text-base"
                placeholder="Find any material (name, colour, item #)…"
                aria-label="Find any material"
                value={find}
                onChange={(e) => setFind(e.target.value)}
              />
            </div>
            {finding &&
              (stock.isLoading || options.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </p>
              ) : (
                <>
                  {(stock.error || options.error) && (
                    <p className="text-sm text-destructive">
                      Search could not read{" "}
                      {stock.error ? `the stock (${errText(stock.error)})` : ""}
                      {stock.error && options.error ? " and " : ""}
                      {options.error ? `the material list (${errText(options.error)})` : ""}
                      {stock.error ? "; what is left where is unknown — the server checks" : ""}
                    </p>
                  )}
                  {found.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No material named like “{findQ}”.
                    </p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {found.map((res) => {
                        const small = [
                          res.category,
                          !res.label && res.price_col !== "price" ? res.price_col : null,
                          res.item_no ? `#${res.item_no}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <li key={res.key} className="space-y-1.5 px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="font-medium leading-snug">{cellName(res)}</p>
                              {small && (
                                <p className="truncate text-xs text-muted-foreground">{small}</p>
                              )}
                            </div>
                            <div
                              className="flex flex-wrap gap-1.5"
                              role="group"
                              aria-label="Take from"
                            >
                              {res.sources.map((src) => {
                                const left = sourceLeft(res, src);
                                const none = left === "none in the app";
                                return (
                                  <Button
                                    key={src.location_id}
                                    type="button"
                                    variant="outline"
                                    className={`h-10 max-w-full justify-start rounded-full px-3 text-sm ${
                                      none ? "border-dashed text-muted-foreground" : ""
                                    }`}
                                    aria-label={`One ${unitLabel(1, res.piece, res.unit)} of ${cellName(res)} from ${src.location_name}`}
                                    onClick={() => addFromSearch(res, src)}
                                  >
                                    <Plus className="mr-1 h-4 w-4 shrink-0" />
                                    <span className="truncate">
                                      {sourceName(src)} · {left}
                                    </span>
                                  </Button>
                                );
                              })}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              ))}
            {/* A real dialog, not a panel under the results (owner, Oct 9: "this pop up appears
                below the list which means its not visible unless someone scrolls down"). */}
            <AlertDialog open={!!short} onOpenChange={(o) => !o && setShort(null)}>
              {short && (
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      The app shows{" "}
                      {amountText(Math.max(0, onHandUnits(short.r)), short.r.piece, short.r.unit)}{" "}
                      of {cellName(short.r)} on {locName(short.r.location_id)}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      If it came from somewhere else, cancel and pick that place. If it really came
                      from {locName(short.r.location_id)}, log it here and the count there gets
                      corrected with your entry.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="h-11"
                      onClick={(e) => {
                        e.preventDefault();
                        const s = short;
                        setShort(null);
                        add(s.r, s.units, false, true);
                      }}
                    >
                      It came from {locName(short.r.location_id)} — log it
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              )}
            </AlertDialog>
            {fromLoc === null ? (
              // Owner, Oct 9: the search is the one way in; the shelf view stays for anyone who
              // does not know the name.
              <Button
                type="button"
                variant="link"
                className="h-10 px-0 text-sm"
                onClick={() => {
                  const shop = (locations.data ?? []).find((l) => l.kind === "shop");
                  setFromLoc(shop?.id ?? "shop");
                }}
              >
                Browse the shop
              </Button>
            ) : (
              // Owner, Oct 8: the shop's or another truck's stock, right here — the same −/+ rows as
              // the truck list, against this ticket at that place; no trip to the Inventory page.
              <div className="space-y-2 rounded-lg border p-3" aria-label="Material from elsewhere">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="font-medium">From</span>
                    <select
                      className="h-10 rounded-md border bg-background px-2 text-sm"
                      aria-label="Take material from"
                      value={fromLoc}
                      onChange={(e) => {
                        setFromLoc(e.target.value);
                        setOtherSearch("");
                      }}
                    >
                      {(locations.data ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                          {l.id === vehicleId ? " (my truck)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto h-10"
                    onClick={() => setFromLoc(null)}
                  >
                    <Check className="mr-1 h-4 w-4" /> Done
                  </Button>
                </div>
                {other.error ? (
                  <p className="text-sm text-destructive">
                    Could not load {locName(fromLoc)}: {errText(other.error)}
                  </p>
                ) : other.isLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading {locName(fromLoc)}…
                  </p>
                ) : otherRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is on {locName(fromLoc)} in the app yet.
                  </p>
                ) : (
                  <>
                    {otherRows.length > 5 && (
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="search"
                          className="h-11 pl-9 text-base"
                          placeholder={`Find on ${locName(fromLoc)} (name, colour, item #)…`}
                          value={otherSearch}
                          onChange={(e) => setOtherSearch(e.target.value)}
                        />
                      </div>
                    )}
                    <ul className="divide-y rounded-lg border">
                      {otherRows
                        .filter((r) => matchesSearch(r, otherSearch.trim()))
                        .map((r) => (
                          <TruckRow
                            key={r.key}
                            row={r}
                            used={usedUnits(r)}
                            onHand={onHandUnits(r)}
                            onAdd={(n) => add(r, n)}
                            onReduce={(n) => reduce(r, n)}
                            onSet={(n) => setTotal(r, n)}
                          />
                        ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          {truck.error && !vehicleId ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span>Could not load your truck: {errText(truck.error)}</span>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={() => void truck.refetch()}
              >
                <RefreshCw className="mr-1 h-4 w-4" /> Try again
              </Button>
            </div>
          ) : (truck.isLoading || defaults.isLoading) && !vehicleId ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your truck…
            </p>
          ) : vehicleId ? (
            // Owner, Oct 9: a fold, not a block — and no fold at all for a login with no truck
            // (the old "no truck is set up for you" line was a dead block for the office).
            <div className="space-y-2" aria-label="What's on my truck">
              <button
                type="button"
                className="flex h-10 w-full items-center justify-between gap-2 rounded-md px-1 text-left text-sm font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={truckShown}
                onClick={() => setTruckOpen(!truckShown)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    What's on my truck{vehicles.length === 1 ? ` · ${locName(vehicleId)}` : ""}
                  </span>
                </span>
                {truckShown ? (
                  <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </button>
              {truckShown && (
                <>
                  {vehicles.length > 1 && vehicleId && (
                    <div
                      role="radiogroup"
                      aria-label="Which truck"
                      className="grid gap-1 rounded-lg bg-muted p-1"
                      style={{
                        gridTemplateColumns: `repeat(${Math.min(vehicles.length, 3)}, minmax(0, 1fr))`,
                      }}
                    >
                      {vehicles.map((id) => (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={id === vehicleId}
                          onClick={() => pickVehicle(id)}
                          className={`flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors ${
                            id === vehicleId
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Truck className="h-4 w-4 shrink-0" />
                          <span className="truncate">{locName(id)}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {truck.error ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                      <span>Could not load your truck: {errText(truck.error)}</span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10"
                        onClick={() => void truck.refetch()}
                      >
                        <RefreshCw className="mr-1 h-4 w-4" /> Try again
                      </Button>
                    </div>
                  ) : truck.isLoading ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading your truck…
                    </p>
                  ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing is on {locName(vehicleId)} in the app yet (the office stocks trucks in
                      Inventory).
                    </p>
                  ) : (
                    <>
                      {rows.length > 5 && (
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            type="search"
                            className="h-11 pl-9 text-base"
                            placeholder="Find on the truck (name, colour, item #)…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                      )}
                      {filtered.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nothing on the truck like “{q}”.
                        </p>
                      ) : (
                        <ul className="divide-y rounded-lg border">
                          {visible.map((r) => (
                            <TruckRow
                              key={r.key}
                              row={r}
                              used={usedUnits(r)}
                              onHand={onHandUnits(r)}
                              onAdd={(n) => add(r, n)}
                              onReduce={(n) => reduce(r, n)}
                              onSet={(n) => setTotal(r, n)}
                            />
                          ))}
                        </ul>
                      )}
                      {!q && filtered.length > FIRST_ROWS && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-11 w-full"
                          onClick={() => setShowAll((v) => !v)}
                        >
                          {showAll ? (
                            <>
                              <ChevronUp className="mr-1 h-4 w-4" /> Show fewer
                            </>
                          ) : (
                            <>
                              <ChevronDown className="mr-1 h-4 w-4" /> Show all {filtered.length}
                            </>
                          )}
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          ) : null}
        </>
      )}
    </>
  );

  if (collapsible)
    return (
      <Box
        title="Materials"
        icon={Package}
        collapsible
        defaultOpen={defaultOpen ?? true}
        storageKey={storageKey}
        summary={
          <span className="flex items-center gap-2">
            {busy > 0 && <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />}
            {materials.error ? (
              <span className="text-destructive">could not load</span>
            ) : materials.isLoading ? null : lineCount > 0 ? (
              `${lineCount} ${lineCount === 1 ? "line" : "lines"}`
            ) : (
              "nothing logged"
            )}
          </span>
        }
      >
        {body}
      </Box>
    );

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Materials">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Package className="h-5 w-5 text-muted-foreground" /> Materials
        </h2>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {busy > 0 && <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />}
          {itemsOnTicket > 0 && `${itemsOnTicket} ${itemsOnTicket === 1 ? "item" : "items"}`}
        </span>
      </div>
      {body}
    </section>
  );
}

/** Did the ticket use anything, net of take-backs? */
function usedTotalPositive(ledger: readonly JobMaterialRow[]) {
  const byCell = new Map<string, number>();
  for (const m of ledger) byCell.set(cellKey(m), (byCell.get(cellKey(m)) ?? 0) - Number(m.qty));
  return [...byCell.values()].some((v) => v > EPS);
}

// ---------------------------------------------------------------------------------------------

function TruckRow({
  row,
  used,
  onHand,
  fromText,
  onAdd,
  onReduce,
  onSet,
}: {
  row: ListRow;
  used: number;
  onHand: number;
  /** In place of the on-hand line: where an "On this ticket" line was taken from. */
  fromText?: string | undefined;
  onAdd: (units: number) => void;
  onReduce: (units: number) => void;
  onSet: (total: number) => void;
}) {
  // Owner, Oct 9: "the forms dont need to be arrow single increments, they need to be able to
  // type in them" — the count between − and + is a typeable box (blank when nothing is used, never
  // a 0). While it has focus it keeps its own text; blur or Enter commits the typed total through
  // onSet; a blank or unchanged box changes nothing.
  const [text, setText] = useState<string | null>(null);
  const unitWord = unitLabel(used, row.piece, row.unit);
  const shown = used > EPS ? fmtNum(used) : "";
  const small = [
    row.category,
    !row.label && row.price_col !== "price" ? row.price_col : null,
    row.item_no ? `#${row.item_no}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const onHandPacks = row.piece ? onHand / row.piece.perPack : onHand;
  const empty = onHand <= EPS;

  const commit = () => {
    if (text === null) return;
    const t = text.trim();
    setText(null);
    if (!t || t === shown) return;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) {
      loudError("Type how many", new Error(`a number of ${unitLabel(2, row.piece, row.unit)}`));
      return;
    }
    onSet(Math.round(n * 1000) / 1000);
  };

  return (
    <li className={`px-3 py-3 ${used > EPS ? "bg-primary/5" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{cellName(row)}</p>
          {small && <p className="truncate text-xs text-muted-foreground">{small}</p>}
          {fromText ? (
            <p className="text-sm text-muted-foreground">{fromText}</p>
          ) : (
            <p
              className={`text-sm tabular-nums ${empty ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
            >
              {empty
                ? "None left on the truck"
                : `${onHandText(onHandPacks, row.unit, row.piece)} left`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12"
            aria-label={`One ${unitLabel(1, row.piece, row.unit)} of ${cellName(row)} fewer`}
            disabled={used <= EPS}
            onClick={() => onReduce(Math.min(1, used))}
          >
            <Minus className="h-5 w-5" />
          </Button>
          <label className="flex w-16 flex-col items-center">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="h-12 w-16 px-1 text-center text-lg font-semibold tabular-nums"
              aria-label={`Used on this ticket, ${unitLabel(2, row.piece, row.unit)} of ${cellName(row)}`}
              value={text ?? shown}
              onFocus={(e) => {
                setText(shown);
                e.currentTarget.select();
              }}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="mt-0.5 max-w-full truncate text-[10px] text-muted-foreground">
              {unitWord}
            </span>
          </label>
          <Button
            type="button"
            variant={used > EPS ? "default" : "outline"}
            size="icon"
            className="h-12 w-12"
            aria-label={`One ${unitLabel(1, row.piece, row.unit)} of ${cellName(row)} more`}
            onClick={() => onAdd(1)}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </li>
  );
}
