/**
 * Inventory — one screen (owner rule, MODULES.md §7: a non-technical crew lead or salesperson
 * uses this, often on a phone). Stock on hand is the page; every row has "Use on job" and
 * "Add leftover"; the form is a dialog with a search box for the product and one for the job,
 * which remembers the last job used on this phone. Adjustments and write-offs are not offered
 * here (owner, Sep 24) — the server still accepts them from estimators for the bid's order list.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { History, Package, PackageMinus, PackagePlus, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listItemNumbers, listPriceTargets } from "@/lib/admin-item-numbers.functions";
import type { ItemNumberRow, PriceTarget } from "@/lib/admin-item-numbers.functions";
import { STATUS_LABELS, asBidStatus } from "@/lib/bid-status";
import {
  addMovement,
  deleteMovement,
  getInventorySettings,
  listBidOptions,
  listMovements,
  listStock,
  OPENED_BOX_LABELS,
  REASON_LABELS,
  setOpenedBoxRule,
  priceColLabel,
  stockUnitFor,
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
  const stockQ = useQuery({ queryKey: ["inventory-stock"], queryFn: () => stockFn() });
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

  const [q, setQ] = useState("");
  const [zeros, setZeros] = useState(false);
  const [dialog, setDialog] = useState<{ mode: Mode; ref: TargetRef | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    // "Record leftovers for this bid" on the estimate lands here with ?bid=: open the form.
    if (props.initialBidId) setDialog({ mode: "leftover", ref: null });
  }, [props.initialBidId]);

  const filter = q.trim().toLowerCase();
  const rows = stock.filter((r) => {
    if (!zeros && Math.abs(r.on_hand) < 0.0005) return false;
    return (
      !filter ||
      r.row_label.toLowerCase().includes(filter) ||
      r.category.toLowerCase().includes(filter) ||
      r.price_col.toLowerCase().includes(filter) ||
      r.item_nos.some((n) => n.toLowerCase().includes(filter))
    );
  });
  const inStock = stock.filter((r) => Math.abs(r.on_hand) >= 0.0005).length;

  const open = (mode: Mode, r?: StockRow) =>
    setDialog({
      mode,
      ref: r ? { screen_id: r.screen_id, row_label: r.row_label, price_col: r.price_col } : null,
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Package className="h-6 w-6" /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            What is on the shelf. Tap a product to use it on a job or to add leftovers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => open("consumed")}>
            <PackageMinus className="mr-1 h-4 w-4" /> Use on job
          </Button>
          <Button onClick={() => open("leftover")}>
            <PackagePlus className="mr-1 h-4 w-4" /> Add leftover
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
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={zeros} onChange={(e) => setZeros(e.target.checked)} />
              Show products at zero
            </label>
            <span className="text-xs text-muted-foreground">
              {rows.length} of {zeros ? stock.length : inStock} product(s)
            </span>
          </div>
          {stockQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : stock.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing on the shelf yet. Tap <b>Add leftover</b> to record the first material.
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
                      key={`${r.screen_id}|${r.row_label}|${r.price_col}`}
                      className="rounded-md border p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.row_label}</p>
                          <p className="text-xs text-muted-foreground">
                            {[priceColLabel(r.price_col) !== "—" ? r.price_col : null, r.category]
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
                          <PackageMinus className="mr-1 h-4 w-4" /> Use on job
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => open("leftover", r)}>
                          <PackagePlus className="mr-1 h-4 w-4" /> Add leftover
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
                      <TableHead>Last entry</TableHead>
                      <TableHead className="w-[250px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const piece = pieceOf(r.screen_id, r.row_label);
                      const d = displayStock(r.on_hand, r.unit, piece);
                      return (
                        <TableRow key={`${r.screen_id}|${r.row_label}|${r.price_col}`}>
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
                                Use on job
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => open("leftover", r)}
                              >
                                Add leftover
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
              Every entry, newest first. On hand is the sum of these.
            </CardDescription>
          )}
        </CardHeader>
        {historyOpen && (
          <CardContent>
            <LedgerTable
              rows={moves}
              loading={movesQ.isLoading}
              role={role}
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
          products={products}
          targets={targets}
          stock={stock}
          bids={bidsQ.data ?? []}
          initialBidId={props.initialBidId}
          rule={rule}
          onClose={() => setDialog(null)}
          onSaved={() => {
            refresh();
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

function RecordDialog(props: {
  mode: Mode;
  initialRef: TargetRef | null;
  products: ProductOption[];
  targets: PriceTarget[];
  stock: StockRow[];
  bids: JobOption[];
  initialBidId?: string | undefined;
  rule: OpenedBoxRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const addFn = useServerFn(addMovement);
  const consumed = props.mode === "consumed";
  const [ref, setRef] = useState<TargetRef | null>(props.initialRef);
  const [qty, setQty] = useState("");
  const [countMode, setCountMode] = useState<"pieces" | "packs">("pieces");
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

  const target = ref ? props.targets.find((t) => t.screen_id === ref.screen_id) : undefined;
  const unit = ref ? (target?.row_units?.[ref.row_label] ?? stockUnitFor(ref.screen_id)) : "";
  const piece = ref ? (target?.pieces?.[ref.row_label] ?? null) : null;
  const inPieces = !!piece && countMode === "pieces";
  const onHand = ref
    ? (props.stock.find(
        (s) =>
          s.screen_id === ref.screen_id &&
          s.row_label === ref.row_label &&
          s.price_col === ref.price_col,
      )?.on_hand ?? 0)
    : 0;
  const n = Number(qty);
  const packs = inPieces && piece && Number.isFinite(n) ? packsFromPieces(n, piece) : n;
  const tooMany = consumed && Number.isFinite(packs) && packs > onHand + 1e-9;
  const jobOk = consumed ? !!jobId && !pickingJob : true;
  const canSave =
    !!ref && qty.trim() !== "" && Number.isFinite(n) && n > 0 && jobOk && !tooMany && !saving;

  const save = async () => {
    if (!ref || !canSave) return;
    setSaving(true);
    try {
      const r = await addFn({
        data: {
          screen_id: ref.screen_id,
          row_label: ref.row_label,
          price_col: ref.price_col,
          qty: n,
          ...(inPieces ? { in_pieces: true } : {}),
          unit,
          reason: props.mode,
          bid_id: jobId && !pickingJob ? jobId : null,
          note: note.trim() || null,
        },
      });
      if (jobId && !pickingJob) writeLastJob(jobId);
      const job = props.bids.find((b) => b.id === jobId);
      toast.success(
        consumed
          ? `${describeStock(-r.qty, r.unit, piece)} of ${ref.row_label} used on ${job?.name ?? "the job"}`
          : `${describeStock(r.qty, r.unit, piece)} of ${ref.row_label} added to the shelf`,
      );
      props.onSaved();
      props.onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record that");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{consumed ? "Use on a job" : "Add leftover"}</DialogTitle>
          <DialogDescription>
            {consumed
              ? "Takes material off the shelf and puts it on the job's order list."
              : `Adds what came back from a job. ${OPENED_BOX_LABELS[props.rule]}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Product</Label>
            <ProductPicker
              products={props.products}
              stock={props.stock}
              value={ref}
              onlyInStock={consumed}
              onChange={(v) => {
                setRef(v);
                setCountMode("pieces");
              }}
            />
          </div>
          {ref && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>
                  {consumed ? "How much" : "How much"}
                  {inPieces && piece ? ` (${plural(2, piece.name)})` : unit ? ` (${unit})` : ""}
                </Label>
                <Input
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
                {consumed ? `${fmtQty(onHand)} ${unit} on the shelf` : ""}
                {inPieces && piece && Number.isFinite(n) && n > 0
                  ? `${consumed ? " · " : ""}= ${fmtQty(packs)} ${unit}`
                  : ""}
              </p>
            </div>
          )}
          {tooMany && (
            <p className="text-sm text-destructive">
              Only {fmtQty(onHand)} {unit} on the shelf.
            </p>
          )}
          <div className="space-y-1">
            <Label>{consumed ? "Which job" : "Left over from which job (optional)"}</Label>
            <JobPicker
              bids={props.bids}
              value={pickingJob ? "" : jobId}
              required={consumed}
              onChange={setJobId}
            />
          </div>
          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <AutoTextarea
              className="min-h-10"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={consumed ? "e.g. finished the north section" : "e.g. 1 opened box"}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!canSave} className="min-w-40">
              {saving ? "Saving…" : consumed ? "Take from shelf" : "Add to shelf"}
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
  onChanged: () => void;
  pieceOf: (screenId: string, rowLabel: string) => PieceDef | null;
}) {
  const delFn = useServerFn(deleteMovement);
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const rows = props.rows.filter(
    (r) =>
      !f ||
      r.row_label.toLowerCase().includes(f) ||
      r.category.toLowerCase().includes(f) ||
      (r.bid_name ?? "").toLowerCase().includes(f) ||
      (r.created_by_name ?? "").toLowerCase().includes(f) ||
      REASON_LABELS[r.reason as MovementReason]?.toLowerCase().includes(f),
  );
  return (
    <div className="space-y-3">
      <Input
        className="h-9 max-w-xs"
        placeholder="Search by product, job, person or reason…"
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
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Note</TableHead>
                {props.role === "admin" && <TableHead className="w-10" />}
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
                  {props.role === "admin" && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        title="Delete this entry (admin)"
                        onClick={() => {
                          if (
                            !window.confirm("Delete this entry? Stock on hand changes accordingly.")
                          )
                            return;
                          void delFn({ data: { id: r.id } })
                            .then(() => props.onChanged())
                            .catch((e: unknown) =>
                              toast.error(e instanceof Error ? e.message : "Could not delete"),
                            );
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
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
