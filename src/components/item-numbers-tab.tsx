import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteItemNumber,
  listItemNumbers,
  listPriceTargets,
  upsertItemNumber,
  type ItemNumberRow,
} from "@/lib/admin-item-numbers.functions";
import { TargetPicker } from "@/components/item-number-target-picker";
import { firstTarget, type TargetRef } from "@/lib/item-number-targets";

const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

/** Admin › Duro-Last Pricing › Item Numbers: the item number → price cell map. */
export function ItemNumbersTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listItemNumbers);
  const targetsFn = useServerFn(listPriceTargets);
  const upsertFn = useServerFn(upsertItemNumber);
  const deleteFn = useServerFn(deleteItemNumber);
  const mappingsQ = useQuery({ queryKey: ["item-numbers"], queryFn: () => listFn() });
  const targetsQ = useQuery({ queryKey: ["price-targets"], queryFn: () => targetsFn() });
  const mappings = useMemo(() => mappingsQ.data ?? [], [mappingsQ.data]);
  const targets = useMemo(() => targetsQ.data ?? [], [targetsQ.data]);
  const categoryOf = (screenId: string) =>
    targets.find((t) => t.screen_id === screenId)?.category ?? screenId;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["item-numbers"] });
    void qc.invalidateQueries({ queryKey: ["price-targets"] });
  };

  const [newItemNo, setNewItemNo] = useState("");
  const [newTarget, setNewTarget] = useState<TargetRef | null>(null);
  const addTarget = newTarget ?? firstTarget(targets);

  const saveMapping = async (item_no: string, t: TargetRef) => {
    if (!item_no.trim() || !t.screen_id || !t.row_label || !t.price_col) {
      toast.error("Item number, screen, product and price column are all required.");
      return;
    }
    try {
      await upsertFn({ data: { item_no: item_no.trim(), ...t } });
      toast.success(`${item_no.trim()} → ${t.row_label} · ${t.price_col}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save mapping");
    }
  };
  const removeMapping = async (m: ItemNumberRow) => {
    try {
      await deleteFn({
        data: {
          item_no: m.item_no,
          screen_id: m.screen_id,
          row_label: m.row_label,
          price_col: m.price_col,
        },
      });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove mapping");
    }
  };

  const [filter, setFilter] = useState("");
  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const catOf = (id: string) => targets.find((t) => t.screen_id === id)?.category ?? id;
    const rows = f
      ? mappings.filter(
          (m) =>
            m.item_no.toLowerCase().includes(f) ||
            m.row_label.toLowerCase().includes(f) ||
            (m.dl_description ?? "").toLowerCase().includes(f) ||
            catOf(m.screen_id).toLowerCase().includes(f),
        )
      : mappings;
    const g = new Map<string, ItemNumberRow[]>();
    for (const m of rows) {
      const arr = g.get(m.screen_id);
      if (arr) arr.push(m);
      else g.set(m.screen_id, [m]);
    }
    return [...g.entries()];
  }, [mappings, filter, targets]);

  // Products with no item number at all (per screen) — the gaps to fill by hand.
  const unmappedProducts = useMemo(() => {
    const has = new Set(mappings.map((m) => `${m.screen_id}\u0000${m.row_label}`));
    return targets
      .map((t) => ({
        screen_id: t.screen_id,
        category: t.category,
        price_col: t.price_cols[0] ?? "",
        rows: t.rows.filter((r) => !has.has(`${t.screen_id}\u0000${r}`)),
      }))
      .filter((t) => t.rows.length > 0);
  }, [mappings, targets]);
  const [gapDrafts, setGapDrafts] = useState<Record<string, string>>({});

  if (mappingsQ.isLoading || targetsQ.isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Item numbers → products</CardTitle>
        <CardDescription>
          Each Duro-Last item number points at one price cell (screen · product · price column). An
          item number may feed several cells; a colour variant with its own item number gets its own
          row. Seeded from the legacy part numbers — fix or add as Duro-Last&apos;s list differs.
          Price sheets are loaded on{" "}
          <Link to="/admin/price-import" className="text-primary underline underline-offset-2">
            Price List Import
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Item #</Label>
            <Input
              className="h-8 w-[140px] text-xs"
              value={newItemNo}
              onChange={(e) => setNewItemNo(e.target.value)}
              placeholder="e.g. 1225B"
            />
          </div>
          {addTarget && (
            <TargetPicker targets={targets} value={addTarget} onChange={setNewTarget} />
          )}
          <Button
            size="sm"
            disabled={!addTarget || !newItemNo.trim()}
            onClick={() => {
              if (addTarget) void saveMapping(newItemNo, addTarget);
              setNewItemNo("");
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add mapping
          </Button>
        </div>

        {unmappedProducts.length > 0 && (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Products without an item number (
              {unmappedProducts.reduce((n, t) => n + t.rows.length, 0)})
            </summary>
            <div className="mt-2 space-y-3">
              {unmappedProducts.map((t) => (
                <div key={t.screen_id}>
                  <p className="text-xs font-semibold">{t.category}</p>
                  <ul className="mt-1 space-y-1">
                    {t.rows.map((r) => {
                      const k = `${t.screen_id}\u0000${r}`;
                      return (
                        <li key={k} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="min-w-[220px]">{r}</span>
                          <Input
                            className="h-7 w-[120px] text-xs"
                            placeholder="Item #"
                            value={gapDrafts[k] ?? ""}
                            onChange={(e) => setGapDrafts((d) => ({ ...d, [k]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={!(gapDrafts[k] ?? "").trim() || !t.price_col}
                            onClick={() =>
                              void saveMapping(gapDrafts[k] ?? "", {
                                screen_id: t.screen_id,
                                row_label: r,
                                price_col: t.price_col,
                              })
                            }
                          >
                            Assign → {t.price_col || "?"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="flex items-center gap-2">
          <Input
            className="h-8 max-w-xs text-xs"
            placeholder="Filter by item #, product, screen…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">{mappings.length} mappings</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item #</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Price column</TableHead>
                <TableHead>Duro-Last description</TableHead>
                <TableHead className="text-right">Last imported</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map(([screenId, rows]) => (
                <Fragment key={screenId}>
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={7} className="text-xs font-semibold">
                      {categoryOf(screenId)}
                    </TableCell>
                  </TableRow>
                  {rows.map((m) => (
                    <TableRow key={`${m.item_no}|${m.screen_id}|${m.row_label}|${m.price_col}`}>
                      <TableCell className="font-mono text-xs">{m.item_no}</TableCell>
                      <TableCell className="text-xs">{m.row_label}</TableCell>
                      <TableCell className="text-xs">{m.price_col}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.dl_description ?? ""}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {money(m.last_price)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.last_import_at ? new Date(m.last_import_at).toLocaleDateString() : ""}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remove this mapping"
                          onClick={() => void removeMapping(m)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
