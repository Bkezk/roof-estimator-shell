/**
 * Inventory — one screen (owner rule, MODULES.md §7: a non-technical crew lead or salesperson
 * uses this, often on a phone). Stock on hand is the page; every row has "Take from inventory"
 * and "Put in inventory"; the form is a dialog that asks WHERE first (the shop or a service
 * vehicle — owner, Sep 24), then the product, the amount and the job, which remembers the
 * last job used on this phone. Loading a service vehicle is "Take from inventory" with the
 * vehicle as the destination; a return is "Put in inventory" with the vehicle as the source,
 * and what does not come back is written off as used on the vehicle (two buttons, owner, Sep
 * 24). Adjustments and write-offs are not offered here — the server still accepts them from
 * estimators.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  History,
  Package,
  PackageMinus,
  PackagePlus,
  Trash2,
  Truck,
  Warehouse,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listItemNumbers, listPriceTargets } from "@/lib/admin-item-numbers.functions";
import type { ItemNumberRow, PriceTarget } from "@/lib/admin-item-numbers.functions";
import { STATUS_LABELS, asBidStatus } from "@/lib/bid-status";
import {
  addMovement,
  deleteMovement,
  getInventorySettings,
  listBidOptions,
  listLocations,
  listMovements,
  listStock,
  OPENED_BOX_LABELS,
  REASON_LABELS,
  setOpenedBoxRule,
  SHOP_LOCATION_ID,
  transferStock,
  undoMovement,
  priceColLabel,
  stockUnitFor,
  type InventoryLocation,
  type MovementReason,
  type OpenedBoxRule,
  type StockRow,
} from "@/lib/inventory.functions";
import type { TargetRef } from "@/lib/item-number-targets";
import {
  describeStock,
  displayStock,
  packsFromPieces,
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
const LAST_JOB_KEY = "bid-o-matic:inventory-last-job";
const readLastJob = (): string => {
  try {
    return localStorage.getItem(LAST_JOB_KEY) ?? "";
  } catch {
    return "";
  }
};
const writeLastJob = (id: string) => {
  try {
    if (id) localStorage.setItem(LAST_JOB_KEY, id);
  } catch {
    /* private window */
  }
};

type Mode = "consumed" | "leftover";
interface JobOption {
  id: string;
  name: string;
  status: string;
  updated_at: string;
}

/** Every product the catalog prices, flattened for one search box. */
interface ProductOption {
  ref: TargetRef;
  key: string;
  name: string;
  variant: string; // colour / size, "" for single-price products
  category: string;
  itemNos: string[];
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
        });
      }
    }
  }
  return out;
}

const productLabel = (o: { name: string; variant: string }) =>
  o.variant ? `${o.name} · ${o.variant}` : o.name;

export function InventoryPage(props: { initialBidId?: string | undefined }) {
  const { role } = useAuth();
  const qc = useQueryClient();
  const stockFn = useServerFn(listStock);
  const movesFn = useServerFn(listMovements);
  const targetsFn = useServerFn(listPriceTargets);
  const itemNosFn = useServerFn(listItemNumbers);
  const bidsFn = useServerFn(listBidOptions);
  const settingsFn = useServerFn(getInventorySettings);
  const locationsFn = useServerFn(listLocations);
  const undoFn = useServerFn(undoMovement);
  const stockQ = useQuery({ queryKey: ["inventory-stock"], queryFn: () => stockFn() });
  const locationsQ = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => locationsFn(),
  });
  const movesQ = useQuery({
    queryKey: ["inventory-movements"],
    queryFn: () => movesFn({ data: {} }),
  });
  const targetsQ = useQuery({ queryKey: ["price-targets"], queryFn: () => targetsFn() });
  const itemNosQ = useQuery({ queryKey: ["item-numbers"], queryFn: () => itemNosFn() });
  const bidsQ = useQuery({ queryKey: ["inventory-bids"], queryFn: () => bidsFn() });
  const settingsQ = useQuery({ queryKey: ["inventory-settings"], queryFn: () => settingsFn() });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-stock"] });
    void qc.invalidateQueries({ queryKey: ["inventory-movements"] });
  };
  const targets = useMemo(() => targetsQ.data ?? [], [targetsQ.data]);
  const itemNumbers = useMemo(() => itemNosQ.data ?? [], [itemNosQ.data]);
  const products = useMemo(() => productOptions(targets, itemNumbers), [targets, itemNumbers]);
  const pieceOf = (screenId: string, rowLabel: string): PieceDef | null =>
    targets.find((t) => t.screen_id === screenId)?.pieces?.[rowLabel] ?? null;
  const stock = stockQ.data ?? [];
  const moves = movesQ.data ?? [];
  const rule = settingsQ.data?.opened_box_rule ?? "half";
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  const [q, setQ] = useState("");
  const [zeros, setZeros] = useState(false);
  // Which location the list shows: the shop by default, a vehicle, or everywhere.
  const [where, setWhere] = useState<string>(SHOP_LOCATION_ID);
  const [dialog, setDialog] = useState<{
    mode: Mode;
    ref: TargetRef | null;
    location: string | null;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    // "Record leftovers for this bid" on the estimate lands here with ?bid=: open the form.
    if (props.initialBidId) setDialog({ mode: "leftover", ref: null, location: null });
  }, [props.initialBidId]);

  const filter = q.trim().toLowerCase();
  const rows = stock.filter((r) => {
    if (where !== "all" && r.location_id !== where) return false;
    if (!zeros && Math.abs(r.on_hand) < 0.0005) return false;
    return (
      !filter ||
      r.row_label.toLowerCase().includes(filter) ||
      r.category.toLowerCase().includes(filter) ||
      r.price_col.toLowerCase().includes(filter) ||
      r.item_nos.some((n) => n.toLowerCase().includes(filter))
    );
  });
  const shown = where === "all" ? stock : stock.filter((r) => r.location_id === where);
  const inStock = shown.filter((r) => Math.abs(r.on_hand) >= 0.0005).length;

  const open = (mode: Mode, r?: StockRow) =>
    setDialog({
      mode,
      ref: r ? { screen_id: r.screen_id, row_label: r.row_label, price_col: r.price_col } : null,
      // A row already says where it is; the header buttons ask first.
      location: r ? r.location_id : null,
    });

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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => open("consumed")}>
            <PackageMinus className="mr-1 h-4 w-4" /> Take from inventory
          </Button>
          <Button onClick={() => open("leftover")}>
            <PackagePlus className="mr-1 h-4 w-4" /> Put in inventory
          </Button>
        </div>
      </div>

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
                    </SelectItem>
                  ))}
                  <SelectItem value="all">Everywhere</SelectItem>
                </SelectContent>
              </Select>
            )}
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={zeros} onChange={(e) => setZeros(e.target.checked)} />
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
                  const d = displayStock(r.on_hand, r.unit, pieceOf(r.screen_id, r.row_label));
                  return (
                    <li
                      key={`${r.location_id}|${r.screen_id}|${r.row_label}|${r.price_col}`}
                      className="rounded-md border p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.row_label}</p>
                          <p className="text-xs text-muted-foreground">
                            {[
                              priceColLabel(r.price_col) !== "—" ? r.price_col : null,
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
                          className={`whitespace-nowrap text-lg font-semibold tabular-nums ${r.on_hand < 0 ? "text-destructive" : ""}`}
                        >
                          {fmtQty(d.amount)} <span className="text-xs font-normal">{d.unit}</span>
                        </p>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
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
                      <TableHead className="w-[250px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const piece = pieceOf(r.screen_id, r.row_label);
                      const d = displayStock(r.on_hand, r.unit, piece);
                      return (
                        <TableRow
                          key={`${r.location_id}|${r.screen_id}|${r.row_label}|${r.price_col}`}
                        >
                          <TableCell className="text-sm font-medium">{r.row_label}</TableCell>
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
                            {fmtQty(d.amount)} <span className="text-xs font-normal">{d.unit}</span>
                            {piece && (
                              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                ({fmtQty(r.on_hand)} {r.unit})
                              </span>
                            )}
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

      <Card>
        <CardHeader className="pb-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setHistoryOpen((o) => !o)}
          >
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> History
              <span className="text-xs font-normal text-muted-foreground">
                {moves.length} entr{moves.length === 1 ? "y" : "ies"}
              </span>
            </CardTitle>
            <span className="text-xs text-muted-foreground">{historyOpen ? "Hide" : "Show"}</span>
          </button>
          {historyOpen && (
            <CardDescription>
              Every entry, newest first. On hand is the sum of these. Your own entries from the last
              24 hours can be undone here.
            </CardDescription>
          )}
        </CardHeader>
        {historyOpen && (
          <CardContent>
            <LedgerTable
              rows={moves}
              loading={movesQ.isLoading}
              role={role}
              locations={locations}
              onChanged={refresh}
              pieceOf={pieceOf}
            />
          </CardContent>
        )}
      </Card>

      {role === "admin" && <SettingsCard rule={rule} />}

      {dialog && (
        <RecordDialog
          mode={dialog.mode}
          initialRef={dialog.ref}
          initialLocation={dialog.location}
          locations={locations}
          products={products}
          targets={targets}
          stock={stock}
          bids={bidsQ.data ?? []}
          initialBidId={props.initialBidId}
          rule={rule}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            refresh();
            // The confirmation carries Undo for a wrong number or job: one tap removes the
            // entry (own entries, 24 h — undoMovement) and the shelf and the bid follow.
            toast.success(saved.message, {
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
            {fmtQty(onHand(chosen))} on hand
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
                {onHand(p) > 0 ? `${fmtQty(onHand(p))} on hand` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Text search over the jobs; the last job used on this phone is offered first. */
function JobPicker(props: {
  bids: JobOption[];
  value: string;
  required: boolean;
  onChange: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const chosen = props.bids.find((b) => b.id === props.value);
  const f = text.trim().toLowerCase();
  const last = readLastJob();
  const matches = (
    f ? props.bids.filter((b) => b.name.toLowerCase().includes(f)) : props.bids
  ).slice(0, 8);
  const label = (b: JobOption) => `${b.name} · ${STATUS_LABELS[asBidStatus(b.status)]}`;
  if (chosen) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <p className="font-medium">{label(chosen)}</p>
        <div className="flex gap-1">
          {!props.required && (
            <Button size="sm" variant="ghost" onClick={() => props.onChange("")}>
              No job
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => props.onChange("__pick__")}>
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
        placeholder="Type part of the job name…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
        {!f && last && props.bids.some((b) => b.id === last) && (
          <li>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => props.onChange(last)}
            >
              <span className="mr-2 rounded bg-primary/15 px-1 text-[10px] uppercase">
                last used
              </span>
              {label(props.bids.find((b) => b.id === last)!)}
            </button>
          </li>
        )}
        {matches.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => props.onChange(b.id)}
            >
              {label(b)}
            </button>
          </li>
        ))}
        {matches.length === 0 && (
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

/** What the material is for (taking) or where it came from (putting in). */
type Purpose =
  { kind: "job" } | { kind: "vehicle"; id: string } | { kind: "used" } | { kind: "other" };

function RecordDialog(props: {
  mode: Mode;
  initialRef: TargetRef | null;
  initialLocation: string | null;
  locations: InventoryLocation[];
  products: ProductOption[];
  targets: PriceTarget[];
  stock: StockRow[];
  bids: JobOption[];
  initialBidId?: string | undefined;
  rule: OpenedBoxRule;
  onClose: () => void;
  onSaved: (saved: { id: number; message: string }) => void;
}) {
  const addFn = useServerFn(addMovement);
  const moveFn = useServerFn(transferStock);
  const consumed = props.mode === "consumed";
  // The form unfolds one step at a time: where → product → how much → what for → note.
  const [locationId, setLocationId] = useState<string>(props.initialLocation ?? "");
  const [ref, setRef] = useState<TargetRef | null>(props.initialRef);
  const [qty, setQty] = useState("");
  const [countMode, setCountMode] = useState<"pieces" | "packs">("pieces");
  const [purpose, setPurpose] = useState<Purpose | null>(
    props.initialBidId ? { kind: "job" } : null,
  );
  const [restUsed, setRestUsed] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // The job: the estimator's link (?bid=), else the last job used on this phone.
  const [jobId, setJobId] = useState<string>(() => props.initialBidId ?? readLastJob());
  const pickingJob = jobId === "__pick__";
  useEffect(() => {
    // A remembered job that no longer exists falls back to picking.
    if (jobId && jobId !== "__pick__" && !props.bids.some((b) => b.id === jobId)) {
      setJobId(props.bids.length ? "__pick__" : "");
    }
  }, [jobId, props.bids]);

  const location = props.locations.find((l) => l.id === locationId);
  const locName = location?.name ?? "";
  const vehicles = props.locations.filter((l) => l.kind === "vehicle" && l.id !== locationId);
  const vehicle =
    purpose?.kind === "vehicle" ? props.locations.find((l) => l.id === purpose.id) : undefined;
  // A return counts what is on the vehicle; everything else counts the chosen location.
  const countAt = !consumed && vehicle ? vehicle.id : locationId;
  const stockHere = useMemo(
    () => props.stock.filter((s) => s.location_id === countAt),
    [props.stock, countAt],
  );
  const target = ref ? props.targets.find((t) => t.screen_id === ref.screen_id) : undefined;
  const unit = ref ? (target?.row_units?.[ref.row_label] ?? stockUnitFor(ref.screen_id)) : "";
  const piece = ref ? (target?.pieces?.[ref.row_label] ?? null) : null;
  const inPieces = !!piece && countMode === "pieces";
  const onHand = ref
    ? (stockHere.find(
        (s) =>
          s.screen_id === ref.screen_id &&
          s.row_label === ref.row_label &&
          s.price_col === ref.price_col,
      )?.on_hand ?? 0)
    : 0;
  const onHandCounted = inPieces && piece ? onHand * piece.perPack : onHand;
  const n = qty.trim() === "" ? NaN : Number(qty);
  const isReturn = !consumed && purpose?.kind === "vehicle";
  const amountOk = Number.isFinite(n) && n >= 0 && (isReturn || n > 0);
  const packs = inPieces && piece && Number.isFinite(n) ? packsFromPieces(n, piece) : n;
  // Taking, or returning off a vehicle, never exceeds what that place holds.
  const limited = consumed || isReturn;
  const tooMany = limited && Number.isFinite(packs) && packs > onHand + 1e-9;
  const rest = isReturn && Number.isFinite(n) ? Math.max(0, onHandCounted - n) : 0;
  const usedCounted = isReturn && restUsed ? rest : 0;
  const jobOk = purpose?.kind === "job" ? !!jobId && !pickingJob : true;
  const canSave =
    !!location &&
    !!ref &&
    amountOk &&
    !!purpose &&
    jobOk &&
    !tooMany &&
    !saving &&
    (!isReturn || n > 0 || usedCounted > 0);
  const fmtCounted = (v: number) =>
    inPieces && piece ? `${fmtQty(v)} ${plural(v, piece.name)}` : `${fmtQty(v)} ${unit}`;

  const save = async () => {
    if (!ref || !location || !purpose || !canSave) return;
    setSaving(true);
    try {
      const product = ref.row_label;
      const pieces = inPieces ? { in_pieces: true as const } : {};
      const noteOrNull = note.trim() || null;
      let saved: { id: number; message: string };
      if (purpose.kind === "vehicle" && vehicle) {
        // Shop → vehicle (loading) or vehicle → shop (returning; the rest is used on it).
        const r = await moveFn({
          data: {
            screen_id: ref.screen_id,
            row_label: ref.row_label,
            price_col: ref.price_col,
            from_location_id: consumed ? location.id : vehicle.id,
            to_location_id: consumed ? vehicle.id : location.id,
            qty: n,
            ...pieces,
            ...(usedCounted > 0 ? { used_qty: usedCounted } : {}),
            note: noteOrNull,
          },
        });
        const moved = describeStock(r.moved, r.unit, piece);
        const used = r.used > 0 ? describeStock(r.used, r.unit, piece) : "";
        saved = {
          id: r.ids[0] ?? 0,
          message: consumed
            ? `${moved} of ${product} loaded onto ${vehicle.name}`
            : `${r.moved > 0 ? `${moved} of ${product} put back in ${locName}` : `Nothing of ${product} came back`}${used ? `; ${used} used on ${vehicle.name}` : ""}`,
        };
      } else {
        const reason = consumed
          ? purpose.kind === "used"
            ? "vehicle_used"
            : "consumed"
          : "leftover";
        const bid = purpose.kind === "job" && jobId && !pickingJob ? jobId : null;
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
            bid_id: bid,
            note: noteOrNull,
          },
        });
        if (bid) writeLastJob(bid);
        const job = props.bids.find((b) => b.id === bid);
        const amount = describeStock(Math.abs(r.qty), r.unit, piece);
        saved = {
          id: r.id,
          message: consumed
            ? purpose.kind === "used"
              ? `${amount} of ${product} written off as used on ${locName}`
              : `${amount} of ${product} taken from ${locName} for ${job?.name ?? "the job"}`
            : `${amount} of ${product} put in ${locName}${job ? ` (left over from ${job.name})` : ""}`,
        };
      }
      props.onSaved(saved);
      props.onClose();
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
      : purpose.kind === "vehicle"
        ? consumed
          ? `Load onto ${vehicle?.name ?? "the vehicle"}`
          : `Put back in ${locName}`
        : purpose.kind === "used"
          ? "Write off as used"
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
              ? "Takes material from the shop or a service vehicle — for a job, to load a vehicle, or written off as used on a vehicle."
              : `Puts material in the shop or on a service vehicle — leftovers from a job, a purchase, or what came back off a vehicle. ${OPENED_BOX_LABELS[props.rule]}.`}
          </DialogDescription>
        </DialogHeader>
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
                setQty("");
                setPurpose(props.initialBidId ? { kind: "job" } : null);
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
                  setCountMode("pieces");
                  setQty("");
                }}
              />
            </div>
          )}
          {location && ref && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>
                  {isReturn ? "How much came back" : "How much"}
                  {inPieces && piece ? ` (${plural(2, piece.name)})` : unit ? ` (${unit})` : ""}
                </Label>
                <Input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="h-11 w-36 text-lg"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="0"
                />
              </div>
              {piece && (
                <div className="space-y-1">
                  <Label>Count in</Label>
                  <Select
                    value={countMode}
                    onValueChange={(v) => setCountMode(v as typeof countMode)}
                  >
                    <SelectTrigger className="h-11 w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pieces">
                        {plural(2, piece.name)} ({piece.perPack} per {unit})
                      </SelectItem>
                      <SelectItem value="packs">whole {unit}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <p className="pb-2 text-sm text-muted-foreground">
                {limited
                  ? `${fmtCounted(onHandCounted)} ${isReturn && vehicle ? `on ${vehicle.name}` : `at ${locName}`}`
                  : ""}
                {inPieces && piece && Number.isFinite(n) && n > 0
                  ? `${limited ? " · " : ""}= ${fmtQty(packs)} ${unit}`
                  : ""}
              </p>
            </div>
          )}
          {tooMany && (
            <p className="text-sm text-destructive">
              Only {fmtCounted(onHandCounted)}{" "}
              {isReturn && vehicle ? `on ${vehicle.name}` : `at ${locName}`}.
            </p>
          )}
          {location && ref && (
            <div className="space-y-1">
              <Label>{consumed ? "What is it for" : "Where is it from"}</Label>
              <ul className="divide-y rounded-md border">
                <li>
                  {choice(
                    consumed ? "A job" : "Left over from a job",
                    purpose?.kind === "job",
                    () => setPurpose({ kind: "job" }),
                  )}
                </li>
                {!consumed && (
                  <li>
                    {choice("Bought, or not from a job", purpose?.kind === "other", () =>
                      setPurpose({ kind: "other" }),
                    )}
                  </li>
                )}
                {consumed && location.kind === "vehicle" && (
                  <li>
                    {choice(
                      `Used on ${location.name} (service call)`,
                      purpose?.kind === "used",
                      () => setPurpose({ kind: "used" }),
                    )}
                  </li>
                )}
                {(consumed ? location.kind === "shop" : location.kind === "shop") &&
                  vehicles.map((v) => (
                    <li key={v.id}>
                      {choice(
                        consumed ? `Load onto ${v.name}` : `Coming back off ${v.name}`,
                        purpose?.kind === "vehicle" && purpose.id === v.id,
                        () => {
                          setPurpose({ kind: "vehicle", id: v.id });
                          setQty("");
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
              <Label>{consumed ? "Which job" : "Which job (optional)"}</Label>
              <JobPicker
                bids={props.bids}
                value={pickingJob ? "" : jobId}
                required={consumed}
                onChange={setJobId}
              />
            </div>
          )}
          {isReturn && vehicle && ref && amountOk && rest > 0 && (
            <label className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={restUsed}
                onChange={(e) => setRestUsed(e.target.checked)}
              />
              <span>
                The other <b>{fmtCounted(rest)}</b> was used on {vehicle.name} — take it off the
                vehicle's list. Untick to leave it on the vehicle.
              </span>
            </label>
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
              Cancel
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
  rows: Awaited<ReturnType<ReturnType<typeof useServerFn<typeof listMovements>>>>;
  loading: boolean;
  role: string | null;
  locations: InventoryLocation[];
  onChanged: () => void;
  pieceOf: (screenId: string, rowLabel: string) => PieceDef | null;
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
  const rows = props.rows.filter(
    (r) =>
      !f ||
      r.row_label.toLowerCase().includes(f) ||
      r.category.toLowerCase().includes(f) ||
      locName(r.location_id).toLowerCase().includes(f) ||
      (r.bid_name ?? "").toLowerCase().includes(f) ||
      (r.created_by_name ?? "").toLowerCase().includes(f) ||
      REASON_LABELS[r.reason as MovementReason]?.toLowerCase().includes(f),
  );
  return (
    <div className="space-y-3">
      <Input
        className="h-9 max-w-xs"
        placeholder="Search by product, place, job, person or reason…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {props.loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : props.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries yet.</p>
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
                    {r.row_label}
                    {priceColLabel(r.price_col) !== "—" ? ` · ${r.price_col}` : ""}
                    <span className="text-muted-foreground"> · {r.category}</span>
                  </TableCell>
                  <TableCell className="text-xs">{locName(r.location_id)}</TableCell>
                  <TableCell
                    className={`whitespace-nowrap text-right text-xs font-semibold tabular-nums ${r.qty < 0 ? "text-destructive" : "text-green-700 dark:text-green-400"}`}
                  >
                    {r.qty > 0 ? "+" : ""}
                    {describeStock(r.qty, r.unit, props.pieceOf(r.screen_id, r.row_label))}
                  </TableCell>
                  <TableCell className="text-xs">{REASON_LABELS[r.reason]}</TableCell>
                  <TableCell className="text-xs">{r.bid_name ?? ""}</TableCell>
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

function SettingsCard(props: { rule: OpenedBoxRule }) {
  const qc = useQueryClient();
  const setFn = useServerFn(setOpenedBoxRule);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Settings (admin)</CardTitle>
        <CardDescription>
          How an opened box or bag counts when leftovers are added. Earlier entries keep what was
          recorded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-w-md space-y-1">
          <Label>Opened box or bag</Label>
          <Select
            value={props.rule}
            onValueChange={(v) =>
              void setFn({ data: { rule: v as OpenedBoxRule } })
                .then(() => {
                  toast.success("Saved");
                  void qc.invalidateQueries({ queryKey: ["inventory-settings"] });
                })
                .catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Could not save"),
                )
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(OPENED_BOX_LABELS) as OpenedBoxRule[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {OPENED_BOX_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
