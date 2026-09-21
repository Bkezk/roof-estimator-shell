import { Fragment, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSpreadsheet, Plus, Trash2, Upload } from "lucide-react";

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
import {
  applyPriceImport,
  deleteItemNumber,
  listItemNumbers,
  listPriceTargets,
  upsertItemNumber,
  type ItemNumberRow,
  type PriceTarget,
} from "@/lib/admin-item-numbers.functions";
import {
  guessHeader,
  matchSheet,
  readSheetItems,
  type MatchResult,
  type SheetItem,
  type SheetRow,
} from "@/lib/price-import";

const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

/** Pick a screen → product row → price column (the target of an item number). */
function TargetPicker(props: {
  targets: PriceTarget[];
  value: { screen_id: string; row_label: string; price_col: string };
  onChange: (v: { screen_id: string; row_label: string; price_col: string }) => void;
}) {
  const screen = props.targets.find((t) => t.screen_id === props.value.screen_id);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-[11px]">Screen</Label>
        <Select
          value={props.value.screen_id}
          onValueChange={(v) => {
            const t = props.targets.find((x) => x.screen_id === v);
            props.onChange({
              screen_id: v,
              row_label: t?.rows[0] ?? "",
              price_col: t?.price_cols[0] ?? "",
            });
          }}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Screen" />
          </SelectTrigger>
          <SelectContent>
            {props.targets.map((t) => (
              <SelectItem key={t.screen_id} value={t.screen_id}>
                {t.category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Product</Label>
        <Select
          value={props.value.row_label}
          onValueChange={(v) => props.onChange({ ...props.value, row_label: v })}
          disabled={!screen}
        >
          <SelectTrigger className="h-8 w-[260px] text-xs">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            {(screen?.rows ?? []).map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Price column</Label>
        <Select
          value={props.value.price_col}
          onValueChange={(v) => props.onChange({ ...props.value, price_col: v })}
          disabled={!screen}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Column" />
          </SelectTrigger>
          <SelectContent>
            {(screen?.price_cols ?? []).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function ItemNumbersTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listItemNumbers);
  const targetsFn = useServerFn(listPriceTargets);
  const upsertFn = useServerFn(upsertItemNumber);
  const deleteFn = useServerFn(deleteItemNumber);
  const applyFn = useServerFn(applyPriceImport);
  const mappingsQ = useQuery({ queryKey: ["item-numbers"], queryFn: () => listFn() });
  const targetsQ = useQuery({ queryKey: ["price-targets"], queryFn: () => targetsFn() });
  const mappings = useMemo(() => mappingsQ.data ?? [], [mappingsQ.data]);
  const targets = useMemo(() => targetsQ.data ?? [], [targetsQ.data]);
  const categoryOf = (screenId: string) =>
    targets.find((t) => t.screen_id === screenId)?.category ?? screenId;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["item-numbers"] });
    void qc.invalidateQueries({ queryKey: ["price-targets"] });
    void qc.invalidateQueries({ queryKey: ["pricing-catalog"] });
    void qc.invalidateQueries({ queryKey: ["pricing-screen"] });
  };

  /* ---------------- Import ---------------- */
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<{ name: string; rows: SheetRow[] }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [pick, setPick] = useState<{
    headerRow: number;
    itemCol: number;
    descCol: number | null;
    priceCol: number | null;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const [lastReport, setLastReport] = useState<string | null>(null);

  const loadFile = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const parsed = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name]!;
        const rows = XLSX.utils.sheet_to_json<SheetRow>(ws, {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        });
        return { name, rows };
      }).filter((s) => s.rows.length > 0);
      if (parsed.length === 0) {
        toast.error("That workbook has no rows.");
        return;
      }
      setFileName(file.name);
      setSheets(parsed);
      // Prefer the first sheet where an item-number header is found.
      const firstWithHeader = parsed.findIndex((s) => guessHeader(s.rows) !== null);
      const idx = firstWithHeader >= 0 ? firstWithHeader : 0;
      setSheetIdx(idx);
      setPick(
        guessHeader(parsed[idx]!.rows) ?? { headerRow: 0, itemCol: 0, descCol: 1, priceCol: 2 },
      );
      setLastReport(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that file");
    }
  };

  const sheet = sheets[sheetIdx];
  const headerCells: string[] = useMemo(() => {
    if (!sheet || !pick) return [];
    const row = sheet.rows[pick.headerRow] ?? [];
    const width = Math.max(row.length, ...sheet.rows.slice(0, 50).map((r) => r.length));
    return Array.from({ length: width }, (_, c) => {
      const h = String(row[c] ?? "").trim();
      return h ? `${h} (col ${c + 1})` : `col ${c + 1}`;
    });
  }, [sheet, pick]);

  const items: SheetItem[] = useMemo(
    () => (sheet && pick ? readSheetItems(sheet.rows, pick) : []),
    [sheet, pick],
  );
  const match: MatchResult | null = useMemo(
    () => (items.length ? matchSheet(items, mappings) : null),
    [items, mappings],
  );
  const currentPrice = (m: ItemNumberRow) => m.last_price;

  const apply = async () => {
    if (!match || match.matched.length === 0) return;
    setApplying(true);
    try {
      const res = await applyFn({
        data: {
          updates: match.matched.map(({ item, mapping }) => ({
            item_no: mapping.item_no,
            screen_id: mapping.screen_id,
            row_label: mapping.row_label,
            price_col: mapping.price_col,
            price: item.price!,
            ...(item.description ? { dl_description: item.description } : {}),
          })),
        },
      });
      const changed = res.applied.filter((a) => a.old !== a.new).length;
      setLastReport(
        `${res.applied.length} price cell${res.applied.length === 1 ? "" : "s"} written (${changed} changed)` +
          (res.missing.length ? `; ${res.missing.length} could not be written` : "") +
          (match.unmatched.length ? `; ${match.unmatched.length} sheet item(s) had no match` : ""),
      );
      if (res.missing.length)
        toast.warning(
          `${res.missing.length} mapped cell(s) no longer exist: ${res.missing
            .slice(0, 3)
            .map((m) => `${m.item_no} (${m.reason})`)
            .join("; ")}${res.missing.length > 3 ? "…" : ""}`,
        );
      toast.success(`Prices updated — ${changed} changed. Bids show "Update Pricing & Labor".`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setApplying(false);
    }
  };

  /* ---------------- Mapping edits ---------------- */
  const emptyTarget = () => ({
    screen_id: targets[0]?.screen_id ?? "",
    row_label: targets[0]?.rows[0] ?? "",
    price_col: targets[0]?.price_cols[0] ?? "",
  });
  const [newItemNo, setNewItemNo] = useState("");
  const [newTarget, setNewTarget] = useState<{
    screen_id: string;
    row_label: string;
    price_col: string;
  } | null>(null);
  const addTarget = newTarget ?? (targets.length ? emptyTarget() : null);
  // Inline "map it" for unmatched sheet items: item number → chosen target.
  const [mapDrafts, setMapDrafts] = useState<
    Record<string, { screen_id: string; row_label: string; price_col: string }>
  >({});

  const saveMapping = async (
    item_no: string,
    t: { screen_id: string; row_label: string; price_col: string },
    dl_description?: string,
  ) => {
    if (!item_no.trim() || !t.screen_id || !t.row_label || !t.price_col) {
      toast.error("Item number, screen, product and price column are all required.");
      return;
    }
    try {
      await upsertFn({
        data: { item_no: item_no.trim(), ...t, ...(dl_description ? { dl_description } : {}) },
      });
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
    const rows = f
      ? mappings.filter(
          (m) =>
            m.item_no.toLowerCase().includes(f) ||
            m.row_label.toLowerCase().includes(f) ||
            (m.dl_description ?? "").toLowerCase().includes(f) ||
            categoryOf(m.screen_id).toLowerCase().includes(f),
        )
      : mappings;
    const g = new Map<string, ItemNumberRow[]>();
    for (const m of rows) {
      const arr = g.get(m.screen_id);
      if (arr) arr.push(m);
      else g.set(m.screen_id, [m]);
    }
    return [...g.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappings, filter, targets]);

  // Products with no item number at all (per screen) — the gaps to fill by hand.
  const unmappedProducts = useMemo(() => {
    const has = new Set(mappings.map((m) => `${m.screen_id}\u0000${m.row_label}`));
    return targets
      .map((t) => ({
        screen_id: t.screen_id,
        category: t.category,
        rows: t.rows.filter((r) => !has.has(`${t.screen_id}\u0000${r}`)),
      }))
      .filter((t) => t.rows.length > 0);
  }, [mappings, targets]);
  const [gapDrafts, setGapDrafts] = useState<Record<string, string>>({});

  if (mappingsQ.isLoading || targetsQ.isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* ── Import ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" /> Import a Duro-Last price list
          </CardTitle>
          <CardDescription>
            Upload the Excel price sheet (.xlsx / .xls / .csv). Rows are matched to the catalog by
            item number; matched prices are written to the mapped price cells, and every item number
            the catalog doesn&apos;t know is listed so you can map it or skip it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Choose price sheet
            </Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>

          {sheet && pick && (
            <>
              <div className="flex flex-wrap items-end gap-3 text-xs">
                {sheets.length > 1 && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Sheet</Label>
                    <Select
                      value={String(sheetIdx)}
                      onValueChange={(v) => {
                        const i = Number(v);
                        setSheetIdx(i);
                        setPick(
                          guessHeader(sheets[i]!.rows) ?? {
                            headerRow: 0,
                            itemCol: 0,
                            descCol: 1,
                            priceCol: 2,
                          },
                        );
                      }}
                    >
                      <SelectTrigger className="h-8 w-[200px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sheets.map((s, i) => (
                          <SelectItem key={s.name} value={String(i)}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-[11px]">Header row</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 w-20 text-xs"
                    value={pick.headerRow + 1}
                    onChange={(e) =>
                      setPick({ ...pick, headerRow: Math.max(0, Number(e.target.value) - 1) })
                    }
                  />
                </div>
                {(
                  [
                    ["itemCol", "Item # column"],
                    ["descCol", "Description column"],
                    ["priceCol", "Price column"],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-[11px]">{label}</Label>
                    <Select
                      value={pick[k] === null ? "none" : String(pick[k])}
                      onValueChange={(v) =>
                        setPick({ ...pick, [k]: v === "none" ? null : Number(v) })
                      }
                    >
                      <SelectTrigger className="h-8 w-[200px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {k !== "itemCol" && <SelectItem value="none">(none)</SelectItem>}
                        {headerCells.map((h, c) => (
                          <SelectItem key={c} value={String(c)}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {match && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span>
                      <span className="font-semibold">{match.matched.length}</span> price cell(s)
                      matched
                    </span>
                    <span className={match.unmatched.length ? "text-destructive" : ""}>
                      <span className="font-semibold">{match.unmatched.length}</span> sheet item(s)
                      with no match
                    </span>
                    <span className="text-muted-foreground">
                      {match.noPrice.length} matched but no price ·{" "}
                      {new Set(match.notInSheet.map((m) => m.item_no)).size} catalog item number(s)
                      not in this sheet
                      {match.duplicatesInSheet.length
                        ? ` · duplicates in sheet: ${match.duplicatesInSheet.join(", ")}`
                        : ""}
                    </span>
                    <Button
                      onClick={apply}
                      disabled={applying || match.matched.length === 0 || pick.priceCol === null}
                    >
                      {applying
                        ? "Applying…"
                        : `Apply ${match.matched.length} price update${match.matched.length === 1 ? "" : "s"}`}
                    </Button>
                  </div>
                  {lastReport && (
                    <p className="rounded-md bg-muted px-3 py-2 text-xs">{lastReport}</p>
                  )}

                  {match.unmatched.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-destructive">
                        No match — item numbers the catalog doesn&apos;t know
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Map one to a product and price column to include it next time (the mapping
                        saves immediately; re-apply to write its price), or ignore it.
                      </p>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Row</TableHead>
                              <TableHead>Item #</TableHead>
                              <TableHead>Sheet description</TableHead>
                              <TableHead>Price</TableHead>
                              <TableHead>Map to</TableHead>
                              <TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {match.unmatched.map((u) => {
                              const draft = mapDrafts[u.key] ?? addTarget;
                              return (
                                <TableRow key={u.key}>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {u.rowIndex + 1}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">{u.itemNo}</TableCell>
                                  <TableCell className="text-xs">{u.description}</TableCell>
                                  <TableCell className="text-xs tabular-nums">
                                    {money(u.price)}
                                  </TableCell>
                                  <TableCell>
                                    {draft && (
                                      <TargetPicker
                                        targets={targets}
                                        value={draft}
                                        onChange={(v) =>
                                          setMapDrafts((d) => ({ ...d, [u.key]: v }))
                                        }
                                      />
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={!draft}
                                      onClick={() =>
                                        draft && void saveMapping(u.itemNo, draft, u.description)
                                      }
                                    >
                                      Map
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {match.matched.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Matched prices ({match.matched.length})
                      </summary>
                      <div className="mt-2 overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Item #</TableHead>
                              <TableHead>Sheet description</TableHead>
                              <TableHead>Screen</TableHead>
                              <TableHead>Product · column</TableHead>
                              <TableHead className="text-right">Last imported</TableHead>
                              <TableHead className="text-right">New price</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {match.matched.map(({ item, mapping }) => {
                              const row = mappings.find(
                                (m) =>
                                  m.item_no === mapping.item_no &&
                                  m.screen_id === mapping.screen_id &&
                                  m.row_label === mapping.row_label &&
                                  m.price_col === mapping.price_col,
                              );
                              const prev = row ? currentPrice(row) : null;
                              const changed = prev !== null && prev !== item.price;
                              return (
                                <TableRow
                                  key={`${mapping.item_no}|${mapping.screen_id}|${mapping.row_label}|${mapping.price_col}`}
                                >
                                  <TableCell className="font-mono text-xs">{item.itemNo}</TableCell>
                                  <TableCell className="text-xs">{item.description}</TableCell>
                                  <TableCell className="text-xs">
                                    {categoryOf(mapping.screen_id)}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {mapping.row_label} · {mapping.price_col}
                                  </TableCell>
                                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                                    {money(prev)}
                                  </TableCell>
                                  <TableCell
                                    className={`text-right text-xs tabular-nums ${changed ? "font-semibold" : ""}`}
                                  >
                                    {money(item.price)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </details>
                  )}

                  {match.noPrice.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Matched but no price in the sheet ({match.noPrice.length})
                      </summary>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {match.noPrice.map((u) => u.itemNo).join(", ")}
                      </p>
                    </details>
                  )}
                  {match.notInSheet.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold">
                        Catalog item numbers not in this sheet (
                        {new Set(match.notInSheet.map((m) => m.item_no)).size})
                      </summary>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[...new Set(match.notInSheet.map((m) => m.item_no))].join(", ")}
                      </p>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Mapping ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Item numbers → products</CardTitle>
          <CardDescription>
            Each Duro-Last item number points at one price cell (screen · product · price column).
            An item number may feed several cells; a colour variant with its own item number gets
            its own row. Seeded from the legacy part numbers — fix or add as Duro-Last&apos;s list
            differs.
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
                        const tgt = targets.find((x) => x.screen_id === t.screen_id);
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
                              disabled={!(gapDrafts[k] ?? "").trim() || !tgt?.price_cols[0]}
                              onClick={() =>
                                void saveMapping(gapDrafts[k] ?? "", {
                                  screen_id: t.screen_id,
                                  row_label: r,
                                  price_col: tgt?.price_cols[0] ?? "",
                                })
                              }
                            >
                              Assign → {tgt?.price_cols[0] ?? "?"}
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
    </div>
  );
}
