/**
 * The close-out's Materials section (docs/service-module-design.md §5.3, §12.5; owner, Sep 27:
 * log material with one tap and never leave the screen).
 *
 * "From my truck": the on-hand rows of the vehicle the tech drives (myTruckStock), each with a
 * big −/+ stepper showing what THIS ticket used of it. + records one piece (or one pack when the
 * product has no pieces) as a `consumed` movement against the ticket at that truck; − takes one
 * back (see planReduce: the tech's own recent entry is undone, an estimator's login records
 * `released`). Above the list, "Usual for <repair>" chips add what earlier tickets with the same
 * repair template used, in one tap. Material from the shop or another truck still goes through
 * Inventory (a secondary link).
 *
 * Taps are optimistic (the count and the on-hand move at once) and run one after another so a
 * "−" always sees the entry the "+" before it made; a refusal (e.g. only 2 on the truck) rolls the
 * count back and is shown loudly. When the queue is empty the ticket's materials, the truck and
 * Inventory's lists are re-read.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
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
import { managesTickets } from "@/lib/access";
import {
  addMovement,
  listLocations,
  myServiceDefaults,
  myTruckStock,
  undoMovement,
  type TruckStockRow,
} from "@/lib/inventory.functions";
import { listServiceJobMaterials, type JobMaterialRow } from "@/lib/service.functions";
import { listJobRepairs, usualMaterialsForTemplate } from "@/lib/service-field.functions";
import { plural, type PieceDef } from "@/lib/stock-units";
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
  const manager = managesTickets(profile);

  const materialsFn = useServerFn(listServiceJobMaterials);
  const truckFn = useServerFn(myTruckStock);
  const defaultsFn = useServerFn(myServiceDefaults);
  const locationsFn = useServerFn(listLocations);
  const repairsFn = useServerFn(listJobRepairs);
  const usualFn = useServerFn(usualMaterialsForTemplate);
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
  const moveTruck = (r: ListRow, packs: number) =>
    qc.setQueryData<TruckStockRow[]>(truckKey(userId), (old) =>
      old?.map((t) => (cellKey(t) === r.key ? { ...t, on_hand: round6(t.on_hand + packs) } : t)),
    );

  const record = async (r: ListRow, units: number, reason: "consumed" | "released") => {
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
   * Use `units` more of the row on this ticket. `checkStock` false: a manager correcting a line
   * taken from the shop or another truck, whose on-hand this screen does not hold — the server
   * checks it (addMovement: "Only N … on the shelf").
   */
  const add = (r: ListRow, units: number, checkStock = true) => {
    if (!(units > EPS)) return;
    const onHand = onHandUnits(r);
    if (checkStock && units > onHand + EPS) {
      loudError(
        `Not enough ${cellName(r)}`,
        new Error(
          `only ${amountText(Math.max(0, onHand), r.piece, r.unit)} on ${locName(r.location_id)} — take the rest from the shop or another truck`,
        ),
      );
      return;
    }
    enqueue(r.key, units, `Could not log ${cellName(r)}`, () => record(r, units, "consumed"));
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

  // Everything this ticket used anywhere (for the reminder), and what came from elsewhere.
  const anyUsed = usedTotalPositive(ledger) || Object.values(pending).some((v) => v > EPS);
  const elsewhere = useMemo(() => {
    const byCell = new Map<string, { m: JobMaterialRow; packs: number }>();
    for (const m of ledger) {
      if (m.location_id === vehicleId) continue;
      const k = cellKey(m);
      const cur = byCell.get(k) ?? { m, packs: 0 };
      cur.packs = round6(cur.packs - Number(m.qty));
      byCell.set(k, cur);
    }
    return [...byCell.values()].filter((v) => Math.abs(v.packs) > EPS);
  }, [ledger, vehicleId]);
  const itemsOnTicket = rows.filter((r) => usedUnits(r) > EPS).length + elsewhere.length;
  // Owner, Oct 5 (service follow-up 1): a manager corrects any line on the ticket here — the
  // lines from the shop or another truck get the same −, typed total and + as the truck's.
  // − puts it back where it was taken from (a "released" movement, capped by the server at what
  // the ticket took); + takes more from the same place (the server checks the stock there).
  const officeRows: ListRow[] = manager
    ? elsewhere
        .filter(({ packs }) => packs > EPS)
        .map(({ m }) => ({
          key: cellKey(m),
          location_id: m.location_id,
          screen_id: m.screen_id,
          row_label: m.row_label,
          label: m.label,
          price_col: m.price_col,
          category: "",
          unit: m.unit,
          on_hand: 0,
          piece: pieceFromLedger(ledger, m),
          item_no: null,
          location_name: locName(m.location_id),
        }))
    : [];
  const officeKeys = new Set(officeRows.map((r) => r.key));

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
        <p className="font-medium text-amber-700 dark:text-amber-400">Anything off the truck?</p>
      )}

      {!canLog ? (
        <p className="text-sm text-muted-foreground">
          Logging material needs Service or Inventory access; ask the office.
        </p>
      ) : (
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

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Truck className="h-3.5 w-3.5" /> From my truck
              {vehicleId && vehicles.length === 1 ? ` · ${locName(vehicleId)}` : ""}
            </p>
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
            ) : truck.isLoading || defaults.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your truck…
              </p>
            ) : !vehicleId ? (
              <p className="text-sm text-muted-foreground">
                No truck is set up for you today (the office assigns drivers in Inventory).
              </p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is on {locName(vehicleId)} in the app yet.
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
                  <p className="text-sm text-muted-foreground">Nothing on the truck like “{q}”.</p>
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
          </div>
        </>
      )}

      {officeRows.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            On this ticket — correct a quantity
          </p>
          <ul className="divide-y rounded-lg border">
            {officeRows.map((r) => (
              <TruckRow
                key={r.key}
                row={r}
                used={usedUnits(r)}
                onHand={0}
                fromText={`from ${r.location_name}`}
                onAdd={(n) => add(r, n, false)}
                onReduce={(n) => reduce(r, n)}
                onSet={(n) => setTotal(r, n, false)}
              />
            ))}
          </ul>
        </div>
      )}
      {elsewhere.some(({ m }) => !officeKeys.has(cellKey(m))) && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Also on this ticket
          </p>
          <ul className="divide-y rounded-md border text-sm">
            {elsewhere
              .filter(({ m }) => !officeKeys.has(cellKey(m)))
              .map(({ m, packs }) => {
                const piece = pieceFromLedger(ledger, m);
                const units = packsToUnits(packs, piece);
                return (
                  <li key={cellKey(m)} className="flex justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      {cellName(m)}
                      <span className="block text-xs text-muted-foreground">
                        from {locName(m.location_id)}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {units < 0
                        ? `returned ${amountText(-units, piece, m.unit)}`
                        : amountText(units, piece, m.unit)}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {(can("inventory") || manager) &&
        (manager ? (
          // A manager adds material the tech forgot from any place (owner, Oct 5).
          <Button asChild variant="outline" className="h-10">
            <Link to="/inventory" search={{ job: jobId }}>
              <Plus className="mr-1 h-4 w-4" /> Add material (shop or a truck)
            </Link>
          </Button>
        ) : (
          <Button asChild variant="link" className="h-10 px-0 text-sm">
            {/* Inventory reads ?job=<id> and opens "Take from inventory" for this ticket. */}
            <Link to="/inventory" search={{ job: jobId }}>
              From the shop / another truck
            </Link>
          </Button>
        ))}
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
  /** In place of the truck's on-hand line: where a manager-corrected line was taken from. */
  fromText?: string | undefined;
  onAdd: (units: number) => void;
  onReduce: (units: number) => void;
  onSet: (total: number) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const unitWord = unitLabel(used, row.piece, row.unit);
  const small = [
    row.category,
    !row.label && row.price_col !== "price" ? row.price_col : null,
    row.item_no ? `#${row.item_no}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const onHandPacks = row.piece ? onHand / row.piece.perPack : onHand;
  const empty = onHand <= EPS;

  const submit = () => {
    const t = text.trim();
    const n = Number(t);
    if (!t || !Number.isFinite(n) || n < 0) {
      loudError("Type how many", new Error(`a number of ${unitLabel(2, row.piece, row.unit)}`));
      return;
    }
    onSet(Math.round(n * 1000) / 1000);
    setTyping(false);
    setText("");
  };

  return (
    <li className={`space-y-2 px-3 py-3 ${used > EPS ? "bg-primary/5" : ""}`}>
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
        <div className="flex shrink-0 items-center gap-1">
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
          <button
            type="button"
            className="flex h-12 w-14 flex-col items-center justify-center rounded-md leading-none hover:bg-muted"
            aria-label={`Used on this ticket: ${fmtNum(used)} ${unitWord}. Tap to type a number`}
            onClick={() => {
              setTyping((v) => !v);
              setText("");
            }}
          >
            <span
              className={`text-xl font-semibold tabular-nums ${used > EPS ? "" : "text-muted-foreground"}`}
            >
              {fmtNum(used)}
            </span>
            <span className="mt-0.5 max-w-full truncate text-[10px] text-muted-foreground">
              {unitWord}
            </span>
          </button>
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
      {typing && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span className="text-sm text-muted-foreground">Used in all</span>
          <Input
            autoFocus
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className="h-11 w-24 text-center text-base"
            placeholder={fmtNum(used)}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {unitLabel(2, row.piece, row.unit)}
          </span>
          <Button type="submit" className="ml-auto h-11" disabled={!text.trim()}>
            Set
          </Button>
        </form>
      )}
    </li>
  );
}
