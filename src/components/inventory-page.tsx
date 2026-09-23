import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Package, Plus, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listItemNumbers, listPriceTargets } from "@/lib/admin-item-numbers.functions";
import type { ItemNumberRow } from "@/lib/admin-item-numbers.functions";
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
} from "@/lib/inventory.functions";
import { firstTarget, type TargetRef } from "@/lib/item-number-targets";
import {
  describeStock,
  displayStock,
  packsFromPieces,
  plural,
  type PieceDef,
} from "@/lib/stock-units";
import { TargetPicker } from "@/components/item-number-target-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutoTextarea } from "@/components/ui/auto-textarea";

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function InventoryPage() {
  const { role, can } = useAuth();
  // Estimate access (or admin) may record adjustments / damage; Inventory-only logins leftovers.
  const canAdjust = can("estimate");
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
  /** Pieces-per-pack for a stock cell, when the catalog states one (stock-units.ts). */
  const pieceOf = (screenId: string, rowLabel: string): PieceDef | null =>
    targets.find((t) => t.screen_id === screenId)?.pieces?.[rowLabel] ?? null;
  const stock = stockQ.data ?? [];
  const moves = movesQ.data ?? [];
  const rule = settingsQ.data?.opened_box_rule ?? "half";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Package className="h-6 w-6" /> Inventory
        </h1>
        <p className="text-sm text-muted-foreground">
          Leftover material from finished jobs, kept by the same product the estimator prices. One
          location, quantities only. On hand is the sum of every entry in the ledger.
        </p>
      </div>

      <Tabs defaultValue="add">
        <TabsList>
          <TabsTrigger value="add">Record stock</TabsTrigger>
          <TabsTrigger value="stock">Stock on hand</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          {role === "admin" && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="stock" className="pt-3">
          <StockTable rows={stock} loading={stockQ.isLoading} pieceOf={pieceOf} />
        </TabsContent>

        <TabsContent value="add" className="pt-3">
          <AddMovementCard
            targets={targets}
            itemNumbers={itemNosQ.data ?? []}
            bids={bidsQ.data ?? []}
            role={role}
            canAdjust={canAdjust}
            rule={rule}
            onSaved={refresh}
          />
        </TabsContent>

        <TabsContent value="ledger" className="pt-3">
          <LedgerTable
            rows={moves}
            loading={movesQ.isLoading}
            role={role}
            onChanged={refresh}
            pieceOf={pieceOf}
          />
        </TabsContent>

        {role === "admin" && (
          <TabsContent value="settings" className="pt-3">
            <SettingsCard rule={rule} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function StockTable(props: {
  rows: Awaited<ReturnType<ReturnType<typeof useServerFn<typeof listStock>>>>;
  loading: boolean;
  pieceOf: (screenId: string, rowLabel: string) => PieceDef | null;
}) {
  const [q, setQ] = useState("");
  const [zeros, setZeros] = useState(false);
  const rows = props.rows.filter((r) => {
    if (!zeros && Math.abs(r.on_hand) < 0.0005) return false;
    const f = q.trim().toLowerCase();
    return (
      !f ||
      r.row_label.toLowerCase().includes(f) ||
      r.category.toLowerCase().includes(f) ||
      r.price_col.toLowerCase().includes(f) ||
      r.item_nos.some((n) => n.toLowerCase().includes(f))
    );
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stock on hand</CardTitle>
        <CardDescription>
          Every product that has ever been recorded, with what is left. Counted in the unit the
          material sits in (boxes, rolls as sq ft, pails, pieces).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="h-8 max-w-xs text-xs"
            placeholder="Filter by product, screen, colour / size or item #…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={zeros} onChange={(e) => setZeros(e.target.checked)} />
            Show products at zero
          </label>
          <span className="text-xs text-muted-foreground">{rows.length} product(s)</span>
        </div>
        {props.loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing in stock yet. Record leftovers on the Record stock tab.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Screen</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Colour / size</TableHead>
                  <TableHead>Item #</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Last entry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.screen_id}|${r.row_label}|${r.price_col}`}>
                    <TableCell className="text-xs text-muted-foreground">{r.category}</TableCell>
                    <TableCell className="text-sm font-medium">{r.row_label}</TableCell>
                    <TableCell className="text-xs">{priceColLabel(r.price_col)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.item_nos.join(", ")}</TableCell>
                    <TableCell
                      className={`text-right text-sm font-semibold tabular-nums ${r.on_hand < 0 ? "text-destructive" : ""}`}
                    >
                      {fmtQty(
                        displayStock(r.on_hand, r.unit, props.pieceOf(r.screen_id, r.row_label))
                          .amount,
                      )}
                    </TableCell>
                    <TableCell
                      className="text-xs"
                      title={
                        props.pieceOf(r.screen_id, r.row_label)
                          ? `${fmtQty(r.on_hand)} ${r.unit}`
                          : undefined
                      }
                    >
                      {
                        displayStock(r.on_hand, r.unit, props.pieceOf(r.screen_id, r.row_label))
                          .unit
                      }
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_at ? fmtWhen(r.last_at) : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddMovementCard(props: {
  targets: Awaited<ReturnType<ReturnType<typeof useServerFn<typeof listPriceTargets>>>>;
  /** Duro-Last item numbers → catalog cell (Admin › Item numbers) — "Record by item #". */
  itemNumbers: ItemNumberRow[];
  bids: { id: string; name: string; status: string; updated_at: string }[];
  role: string | null;
  canAdjust: boolean;
  rule: OpenedBoxRule;
  onSaved: () => void;
}) {
  const addFn = useServerFn(addMovement);
  const [target, setTarget] = useState<TargetRef | null>(null);
  const t = target ?? firstTarget(props.targets);
  const [qty, setQty] = useState("");
  // One unit per product so on-hand sums stay meaningful — not editable. Adhesives use the
  // product's own catalog unit; other screens the per-screen unit (mirrors the server).
  const unit = t
    ? (props.targets.find((x) => x.screen_id === t.screen_id)?.row_units?.[t.row_label] ??
      stockUnitFor(t.screen_id))
    : "each";
  const [reason, setReason] = useState<"leftover" | "adjustment" | "damaged">("leftover");
  const [bidId, setBidId] = useState<string>("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [itemNo, setItemNo] = useState("");
  // Count in pieces of the pack (cartridges / fasteners / gallons) when the catalog states how
  // many one pack holds — leftovers are usually part of a pack.
  const piece = t
    ? (props.targets.find((x) => x.screen_id === t.screen_id)?.pieces?.[t.row_label] ?? null)
    : null;
  const [countMode, setCountMode] = useState<"pieces" | "packs">("pieces");
  const inPieces = !!piece && countMode === "pieces";
  const fieldOnly = !props.canAdjust;
  // Item # lookup: an exact match picks the product; a partial match lists candidates.
  const itemQuery = itemNo.trim().toLowerCase();
  const itemMatches = useMemo(
    () =>
      itemQuery
        ? props.itemNumbers.filter(
            (m) =>
              m.item_no.toLowerCase().includes(itemQuery) ||
              (m.dl_description ?? "").toLowerCase().includes(itemQuery),
          )
        : [],
    [itemQuery, props.itemNumbers],
  );
  // Legacy carries the same part number on more than one product (1106 = Duro-Fleece
  // Adhesive(cartridge) AND OlyBond500 SpotShot): an exact match only auto-picks when unique.
  const exactMatches = itemMatches.filter((m) => m.item_no.toLowerCase() === itemQuery);
  const exactItem = exactMatches.length === 1 ? exactMatches[0] : undefined;
  const ambiguous = exactMatches.length > 1;
  const pickItem = (m: ItemNumberRow) => {
    setTarget({ screen_id: m.screen_id, row_label: m.row_label, price_col: m.price_col });
    setItemNo(m.item_no);
  };
  const cellItemNos = t
    ? props.itemNumbers
        .filter(
          (m) =>
            m.screen_id === t.screen_id &&
            m.row_label === t.row_label &&
            m.price_col === t.price_col,
        )
        .map((m) => m.item_no)
    : [];
  const n = Number(qty);
  const canSave = !!t && qty.trim() !== "" && Number.isFinite(n) && n !== 0 && !saving;
  const packsPreview = inPieces && piece && Number.isFinite(n) ? packsFromPieces(n, piece) : null;

  const save = async () => {
    if (!t || !canSave) return;
    setSaving(true);
    try {
      const r = await addFn({
        data: {
          screen_id: t.screen_id,
          row_label: t.row_label,
          price_col: t.price_col,
          qty: n,
          ...(inPieces ? { in_pieces: true } : {}),
          unit,
          reason,
          bid_id: bidId || null,
          counted_note: counted.trim() || null,
          note: note.trim() || null,
        },
      });
      toast.success(
        `${r.qty > 0 ? "+" : ""}${describeStock(r.qty, r.unit, piece)} — ${t.row_label} · ${priceColLabel(t.price_col)}`,
      );
      setQty("");
      setCounted("");
      setNote("");
      props.onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record that");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Record stock</CardTitle>
        <CardDescription>
          Count in the unit the material sits in: full boxes and bags, rolls as square feet (width ×
          feet left), pails, pieces. {OPENED_BOX_LABELS[props.rule]}. Write what you physically
          counted in the &quot;Counted&quot; box so the entry can be checked later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label className="text-[11px]">
            Item # (Duro-Last part number — picks the product below)
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-48 font-mono text-xs"
              placeholder="e.g. 1767"
              value={itemNo}
              list="inventory-item-numbers"
              onChange={(e) => {
                const v = e.target.value;
                setItemNo(v);
                const hits = props.itemNumbers.filter(
                  (m) => m.item_no.toLowerCase() === v.trim().toLowerCase(),
                );
                if (hits.length === 1) pickItem(hits[0]!);
              }}
            />
            <datalist id="inventory-item-numbers">
              {[...new Map(props.itemNumbers.map((m) => [m.item_no, m])).entries()].map(
                ([no, m]) => {
                  const all = props.itemNumbers.filter((x) => x.item_no === no);
                  return (
                    <option key={no} value={no}>
                      {all.length > 1
                        ? all.map((x) => x.row_label).join(" / ")
                        : `${m.row_label} · ${priceColLabel(m.price_col)}`}
                    </option>
                  );
                },
              )}
            </datalist>
            {exactItem ? (
              <span className="text-xs text-green-700 dark:text-green-400">
                ✓ {exactItem.row_label} · {priceColLabel(exactItem.price_col)}
              </span>
            ) : ambiguous ? (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Item # {exactMatches[0]!.item_no} is on {exactMatches.length} products — pick one
                below.
              </span>
            ) : itemQuery && itemMatches.length === 0 ? (
              <span className="text-xs text-destructive">
                No product is mapped to that item number (Admin › Item numbers).
              </span>
            ) : null}
          </div>
          {!exactItem && itemMatches.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {itemMatches.slice(0, 8).map((m) => (
                <button
                  key={`${m.item_no}|${m.screen_id}|${m.row_label}|${m.price_col}`}
                  type="button"
                  className="rounded border px-2 py-0.5 text-[11px] hover:bg-muted"
                  onClick={() => pickItem(m)}
                  title={m.dl_description ?? undefined}
                >
                  <span className="font-mono">{m.item_no}</span> — {m.row_label} ·{" "}
                  {priceColLabel(m.price_col)}
                </button>
              ))}
              {itemMatches.length > 8 && (
                <span className="text-[11px] text-muted-foreground">
                  +{itemMatches.length - 8} more — keep typing
                </span>
              )}
            </div>
          )}
        </div>
        {t ? (
          <TargetPicker
            targets={props.targets}
            value={t}
            onChange={(v) => {
              setTarget(v);
              setItemNo("");
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading products…</p>
        )}
        {t && cellItemNos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Item # for this product: <span className="font-mono">{cellItemNos.join(", ")}</span>
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px]">
              Quantity{inPieces && piece ? ` (${plural(2, piece.name)})` : ""}
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              className="h-8 w-28 text-xs"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={reason === "adjustment" ? "+ or −" : "0"}
            />
          </div>
          {piece && (
            <div className="space-y-1">
              <Label className="text-[11px]">Count in</Label>
              <Select value={countMode} onValueChange={(v) => setCountMode(v as typeof countMode)}>
                <SelectTrigger className="h-8 w-[200px] text-xs">
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
          <div className="space-y-1">
            <Label className="text-[11px]">Unit</Label>
            <Input
              className="h-8 w-40 bg-muted text-xs"
              value={unit}
              readOnly
              title="Set by the product's catalog entry so every entry for a product adds up in the same unit"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Reason</Label>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as typeof reason)}
              disabled={fieldOnly}
            >
              <SelectTrigger className="h-8 w-[210px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="leftover">{REASON_LABELS.leftover} (adds)</SelectItem>
                {!fieldOnly && (
                  <SelectItem value="adjustment">{REASON_LABELS.adjustment} (±)</SelectItem>
                )}
                {!fieldOnly && (
                  <SelectItem value="damaged">{REASON_LABELS.damaged} (subtracts)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">From job (bid)</Label>
            <Select value={bidId || "none"} onValueChange={(v) => setBidId(v === "none" ? "" : v)}>
              <SelectTrigger className="h-8 w-[260px] text-xs">
                <SelectValue placeholder="Bid" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">(no bid)</SelectItem>
                {props.bids.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    <span className="ml-1 text-[10px] text-muted-foreground">{b.status}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {packsPreview !== null && piece && (
          <p className="-mt-2 text-xs text-muted-foreground">
            = {fmtQty(packsPreview)} {unit}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Counted (what was physically there)</Label>
            <Input
              className="h-8 text-xs"
              placeholder='e.g. "2 full boxes + 1 opened", "1 roll, 38 ft left"'
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Note</Label>
            <AutoTextarea
              className="min-h-8 text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <Button onClick={save} disabled={!canSave}>
          <Plus className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Record"}
        </Button>
      </CardContent>
    </Card>
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
  const rows = props.rows.filter((r) => {
    const f = q.trim().toLowerCase();
    return (
      !f ||
      r.row_label.toLowerCase().includes(f) ||
      r.category.toLowerCase().includes(f) ||
      (r.bid_name ?? "").toLowerCase().includes(f) ||
      (r.created_by_name ?? "").toLowerCase().includes(f) ||
      REASON_LABELS[r.reason as MovementReason]?.toLowerCase().includes(f)
    );
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ledger</CardTitle>
        <CardDescription>
          Every entry, newest first. Stock on hand is the sum of these.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          className="h-8 max-w-xs text-xs"
          placeholder="Filter by product, bid, person or reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {props.loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Bid</TableHead>
                  <TableHead>Counted / note</TableHead>
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
                      <span className="text-muted-foreground">{r.category} › </span>
                      {r.row_label} · {priceColLabel(r.price_col)}
                    </TableCell>
                    <TableCell
                      className={`text-right text-xs font-semibold tabular-nums ${r.qty < 0 ? "text-destructive" : "text-green-700 dark:text-green-400"}`}
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
                              !window.confirm(
                                "Delete this ledger entry? Stock on hand changes accordingly.",
                              )
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
      </CardContent>
    </Card>
  );
}

function SettingsCard(props: { rule: OpenedBoxRule }) {
  const qc = useQueryClient();
  const setFn = useServerFn(setOpenedBoxRule);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Inventory settings</CardTitle>
        <CardDescription>
          How an opened box or bag counts when leftovers are recorded. Changing it does not
          recalculate earlier entries — the ledger keeps what was recorded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-w-md space-y-1">
          <Label className="text-[11px]">Opened box rule</Label>
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
