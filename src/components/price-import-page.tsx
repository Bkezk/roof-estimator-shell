import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TargetPicker } from "@/components/item-number-target-picker";
import { firstTarget, type TargetRef } from "@/lib/item-number-targets";
import {
  addCatalogProduct,
  applyPriceImport,
  deleteItemNumber,
  listItemNumbers,
  listPriceTargets,
  upsertItemNumber,
  type ItemNumberRow,
} from "@/lib/admin-item-numbers.functions";
import {
  guessHeader,
  guessMembraneHeader,
  headerSignature,
  MEMBRANE_SCREEN_ID,
  membranePerSqFt,
  rollAreaSqFt,
  matchMembrane,
  matchSheet,
  readMembraneSheet,
  readSheetItems,
  buildNameIndex,
  suggestCatalogRow,
  suggestSheetLine,
  type CatalogRowRef,
  type HeaderGuess,
  type MatchResult,
  type MembraneMatchResult,
  type ItemNumberMapping,
  type SheetItem,
  type SheetRow,
} from "@/lib/price-import";

const LAYOUT_KEY = "priceImport.layout.v1";
interface SavedLayout {
  sheetName: string;
  signature: string;
  pick: HeaderGuess;
  useMembrane: boolean;
}
/** The column picks confirmed by the last applied import (per browser). */
function readSavedLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedLayout>;
    if (!v || typeof v.signature !== "string" || !v.pick || typeof v.pick.itemCol !== "number")
      return null;
    return v as SavedLayout;
  } catch {
    return null;
  }
}
function writeSavedLayout(v: SavedLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(v));
  } catch {
    // Private mode / blocked storage: the picks simply are not remembered.
  }
}

const money = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const pct = (oldV: number | null, newV: number) =>
  oldV === null || oldV === 0 ? "" : `${(((newV - oldV) / oldV) * 100).toFixed(1)}%`;

/** One price cell about to be written, with its current value — the review table's row. */
interface PlannedUpdate {
  item_no: string;
  screen_id: string;
  category: string;
  row_label: string;
  price_col: string;
  description: string;
  unit: string;
  current: number | null;
  next: number;
  /** How `next` was derived when it is not the sheet price as written (membrane rolls → $/sq ft). */
  note?: string;
}

/**
 * Search the loaded sheet by description / item number — for re-pointing a catalog item number
 * that Duro-Last has renumbered, or mapping a product that never had one.
 */
function SheetSearch(props: {
  items: SheetItem[];
  initial: string;
  onPick: (it: SheetItem) => void;
}) {
  const [q, setQ] = useState(props.initial);
  const hits = useMemo(() => {
    const words = q
      .toLowerCase()
      .split(/[^a-z0-9/."]+/)
      .filter((w) => w.length > 1);
    if (words.length === 0) return [];
    const scored = props.items
      .map((it) => {
        const hay = `${it.itemNo} ${it.description}`.toLowerCase();
        const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
        return { it, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.it.rowIndex - b.it.rowIndex)
      .slice(0, 8);
    return scored.map((x) => x.it);
  }, [q, props.items]);
  return (
    <div className="space-y-1">
      <Input
        className="h-7 w-[280px] text-xs"
        value={q}
        placeholder="Search the sheet…"
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim() !== "" && (
        <ul className="max-h-40 overflow-auto rounded border bg-background text-[11px]">
          {hits.length === 0 && <li className="px-2 py-1 text-muted-foreground">No sheet rows</li>}
          {hits.map((it) => (
            <li key={it.rowIndex} className="flex items-center gap-2 px-2 py-0.5">
              <span className="font-mono">{it.itemNo}</span>
              <span className="flex-1 truncate">{it.description}</span>
              <span className="tabular-nums">{money(it.price)}</span>
              <span className="text-muted-foreground">{it.unit}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2"
                onClick={() => props.onPick(it)}
              >
                Use
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Admin › Price List Import: load a Duro-Last price sheet, review, confirm, apply. */
export function PriceImportPage() {
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
  const targetById = useMemo(
    () => new Map(targets.map((t) => [t.screen_id, t] as const)),
    [targets],
  );
  const categoryOf = (screenId: string) => targetById.get(screenId)?.category ?? screenId;
  const currentOf = (screenId: string, row: string, col: string): number | null =>
    targetById.get(screenId)?.values[row]?.[col] ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["item-numbers"] });
    void qc.invalidateQueries({ queryKey: ["price-targets"] });
    void qc.invalidateQueries({ queryKey: ["pricing-catalog"] });
    void qc.invalidateQueries({ queryKey: ["pricing-screen"] });
  };

  /* ---------------- File + columns ---------------- */
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<{ name: string; rows: SheetRow[] }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [pick, setPick] = useState<HeaderGuess | null>(null);
  const [useMembrane, setUseMembrane] = useState(true);
  // The column picks are shown only when the file's layout is new; a layout confirmed by an
  // earlier import (same header cells) is recognised and the picks collapse to a summary.
  const [setupOpen, setSetupOpen] = useState(true);
  const [recognised, setRecognised] = useState(false);

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
      // A layout confirmed by an earlier import: same sheet name (or any sheet) whose header
      // row reads exactly as before → reuse those picks and skip the setup.
      const saved = readSavedLayout();
      const savedIdx = saved
        ? (() => {
            const byName = parsed.findIndex(
              (sh) =>
                sh.name === saved.sheetName &&
                headerSignature(sh.rows[saved.pick.headerRow]) === saved.signature,
            );
            if (byName >= 0) return byName;
            return parsed.findIndex(
              (sh) => headerSignature(sh.rows[saved.pick.headerRow]) === saved.signature,
            );
          })()
        : -1;
      if (saved && savedIdx >= 0) {
        setSheetIdx(savedIdx);
        setPick(saved.pick);
        setUseMembrane(saved.useMembrane);
        setRecognised(true);
        setSetupOpen(false);
      } else {
        // Prefer the first sheet with an item-number header (the membrane tab has none).
        const firstWithHeader = parsed.findIndex((s) => guessHeader(s.rows) !== null);
        const idx = firstWithHeader >= 0 ? firstWithHeader : 0;
        setSheetIdx(idx);
        setPick(
          guessHeader(parsed[idx]!.rows) ?? {
            headerRow: 0,
            itemCol: 0,
            descCol: 1,
            priceCol: 2,
            unitCol: null,
            sizeCol: null,
          },
        );
        setRecognised(false);
        setSetupOpen(true);
      }
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

  // The "Duro-Last Membrane" tab: any other sheet whose header is Description / Mil / Color / Price.
  const membraneSheet = useMemo(
    () =>
      sheets.find((s, i) => i !== sheetIdx && guessMembraneHeader(s.rows) !== null) ??
      sheets.find((s) => guessMembraneHeader(s.rows) !== null) ??
      null,
    [sheets, sheetIdx],
  );
  const membraneMatch: MembraneMatchResult | null = useMemo(() => {
    if (!membraneSheet || !useMembrane) return null;
    const t = targetById.get(MEMBRANE_SCREEN_ID);
    if (!t) return null;
    return matchMembrane(readMembraneSheet(membraneSheet.rows), t);
  }, [membraneSheet, useMembrane, targetById]);

  /* ---------------- Plan (what "Apply" will write) ---------------- */
  const { plan, membraneSkipped } = useMemo(() => {
    const out: PlannedUpdate[] = [];
    // Membrane matrix cells are $/sq ft. The membrane tab prices them directly and wins; a
    // roll-goods item number mapped onto a cell converts roll $ ÷ roll area (both roll widths of
    // one product land on the same figure, so the cell is planned once). A roll line whose Size
    // cell cannot be read is reported, never written as a per-roll price.
    const membraneCells = new Set<string>();
    const cellKey = (row: string, col: string) => `${row}\u0000${col}`;
    const skipped: { item: SheetItem; mapping: ItemNumberMapping; reason: string }[] = [];
    for (const m of membraneMatch?.matched ?? []) {
      membraneCells.add(cellKey(m.row_label, m.price_col));
      out.push({
        item_no: "MEMBRANE",
        screen_id: MEMBRANE_SCREEN_ID,
        category: categoryOf(MEMBRANE_SCREEN_ID),
        row_label: m.row_label,
        price_col: m.price_col,
        description: `${m.item.description} ${m.item.mil} mil ${m.item.color}`,
        unit: "SQFT",
        current: currentOf(MEMBRANE_SCREEN_ID, m.row_label, m.price_col),
        next: m.item.price!,
      });
    }
    for (const { item, mapping } of match?.matched ?? []) {
      if (mapping.screen_id === MEMBRANE_SCREEN_ID) {
        const k = cellKey(mapping.row_label, mapping.price_col);
        if (membraneCells.has(k)) continue; // the membrane tab already prices this cell
        const perSqFt = membranePerSqFt(item);
        if (perSqFt === null) {
          skipped.push({
            item,
            mapping,
            reason: item.size
              ? `size "${item.size}" is not a roll dimension`
              : "no Size column / cell — pick the Size column above",
          });
          continue;
        }
        membraneCells.add(k);
        out.push({
          item_no: mapping.item_no,
          screen_id: mapping.screen_id,
          category: categoryOf(mapping.screen_id),
          row_label: mapping.row_label,
          price_col: mapping.price_col,
          description: item.description,
          unit: "SQFT",
          current: currentOf(mapping.screen_id, mapping.row_label, mapping.price_col),
          next: perSqFt,
          note: `${money(item.price)} per roll ÷ ${(rollAreaSqFt(item.size) ?? 0).toFixed(1)} sq ft`,
        });
        continue;
      }
      out.push({
        item_no: mapping.item_no,
        screen_id: mapping.screen_id,
        category: categoryOf(mapping.screen_id),
        row_label: mapping.row_label,
        price_col: mapping.price_col,
        description: item.description,
        unit: item.unit,
        current: currentOf(mapping.screen_id, mapping.row_label, mapping.price_col),
        next: item.price!,
      });
    }
    return { plan: out, membraneSkipped: skipped };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, membraneMatch, targetById]);
  const changed = plan.filter((p) => p.current !== p.next);
  const increases = changed.filter((p) => p.current !== null && p.next > p.current).length;
  const decreases = changed.filter((p) => p.current !== null && p.next < p.current).length;
  const newlyPriced = changed.filter((p) => p.current === null).length;

  /* ---------------- Review & confirm ---------------- */
  const [reviewOpen, setReviewOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastReport, setLastReport] = useState<string | null>(null);

  const apply = async () => {
    if (plan.length === 0) return;
    setApplying(true);
    try {
      const res = await applyFn({
        data: {
          updates: plan.map((p) => ({
            item_no: p.item_no,
            screen_id: p.screen_id,
            row_label: p.row_label,
            price_col: p.price_col,
            price: p.next,
            ...(p.item_no !== "MEMBRANE" && p.description ? { dl_description: p.description } : {}),
          })),
        },
      });
      const nChanged = res.applied.filter((a) => a.old !== a.new).length;
      setLastReport(
        `${res.applied.length} price cell${res.applied.length === 1 ? "" : "s"} written from ${fileName} (${nChanged} changed)` +
          (res.missing.length ? `; ${res.missing.length} could not be written` : "") +
          (match?.unmatched.length ? `; ${match.unmatched.length} sheet item(s) had no match` : ""),
      );
      if (res.missing.length)
        toast.warning(
          `${res.missing.length} mapped cell(s) no longer exist: ${res.missing
            .slice(0, 3)
            .map((m) => `${m.item_no} (${m.reason})`)
            .join("; ")}${res.missing.length > 3 ? "…" : ""}`,
        );
      toast.success(`Prices updated — ${nChanged} changed. Bids show "Update Pricing & Labor".`);
      setReviewOpen(false);
      refresh();
      if (sheet && pick)
        writeSavedLayout({
          sheetName: sheet.name,
          signature: headerSignature(sheet.rows[pick.headerRow]),
          pick,
          useMembrane,
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setApplying(false);
    }
  };

  /* ---------------- Mapping fixes from the sheet ---------------- */
  const [mapDrafts, setMapDrafts] = useState<Record<string, TargetRef>>({});
  const defaultTarget = firstTarget(targets);
  const saveMapping = async (item_no: string, t: TargetRef, dl_description?: string) => {
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
  /** Duro-Last renumbered a product: point the existing cell at the sheet's item number. */
  const remap = async (m: ItemNumberRow, it: SheetItem) => {
    try {
      await deleteFn({
        data: {
          item_no: m.item_no,
          screen_id: m.screen_id,
          row_label: m.row_label,
          price_col: m.price_col,
        },
      });
      await upsertFn({
        data: {
          item_no: it.itemNo,
          screen_id: m.screen_id,
          row_label: m.row_label,
          price_col: m.price_col,
          dl_description: it.description,
        },
      });
      toast.success(`${m.row_label}: ${m.item_no} → ${it.itemNo}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not re-map");
    }
  };

  /** "Add as new product": a sheet line the catalog never had becomes a new row + mapping. */
  const addFn = useServerFn(addCatalogProduct);
  const [newProduct, setNewProduct] = useState<{
    item: SheetItem;
    screen_id: string;
    name: string;
    price_col: string;
    price: number;
  } | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const flatTargets = useMemo(
    () => targets.filter((t) => t.screen_id !== "duro_last:adhesives"),
    [targets],
  );
  const openNewProduct = (it: SheetItem) => {
    const t = flatTargets[0];
    if (!t) return;
    setNewProduct({
      item: it,
      screen_id: t.screen_id,
      name: it.description,
      price_col: t.price_cols[0] ?? "",
      price: it.price ?? 0,
    });
  };
  const submitNewProduct = async () => {
    if (!newProduct) return;
    setAddingProduct(true);
    try {
      await addFn({
        data: {
          screen_id: newProduct.screen_id,
          row_label: newProduct.name.trim(),
          price_col: newProduct.price_col,
          price: newProduct.price,
          item_no: newProduct.item.itemNo,
          dl_description: newProduct.item.description,
        },
      });
      toast.success(
        `Added "${newProduct.name.trim()}" to ${categoryOf(newProduct.screen_id)} at ${money(newProduct.price)} (${newProduct.price_col}) — item # ${newProduct.item.itemNo} mapped.`,
      );
      setNewProduct(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the product");
    } finally {
      setAddingProduct(false);
    }
  };

  // Catalog products with no item number at all, each with the sheet line that best names it
  // (idea: fill the gaps from the sheet as a checklist rather than by hand).
  const [dismissedGaps, setDismissedGaps] = useState<Set<string>>(() => new Set());
  const sheetIndex = useMemo(() => buildNameIndex(items, (it) => it.description), [items]);
  const gapSuggestions = useMemo(() => {
    if (!items.length) return [];
    const has = new Set(mappings.map((m) => `${m.screen_id}\u0000${m.row_label}`));
    const out: {
      key: string;
      target: TargetRef;
      category: string;
      suggestion: ReturnType<typeof suggestSheetLine>;
    }[] = [];
    for (const t of targets) {
      const priceCol = t.price_cols[0];
      if (!priceCol) continue;
      for (const r of t.rows) {
        const key = `${t.screen_id}\u0000${r}`;
        if (has.has(key)) continue;
        out.push({
          key,
          category: t.category,
          target: { screen_id: t.screen_id, row_label: r, price_col: priceCol },
          suggestion: suggestSheetLine(r, sheetIndex),
        });
      }
    }
    return out;
  }, [items, sheetIndex, mappings, targets]);
  const gapsWithSuggestion = gapSuggestions.filter(
    (g) => g.suggestion && !dismissedGaps.has(g.key),
  );
  const [showAllGaps, setShowAllGaps] = useState(false);
  const catalogRowRefs: CatalogRowRef[] = useMemo(
    () =>
      targets.flatMap((t) =>
        t.price_cols[0]
          ? t.rows.map((r) => ({
              screen_id: t.screen_id,
              category: t.category,
              row_label: r,
              price_col: t.price_cols[0]!,
            }))
          : [],
      ),
    [targets],
  );
  const catalogIndex = useMemo(
    () => buildNameIndex(catalogRowRefs, (r) => r.row_label),
    [catalogRowRefs],
  );

  const notInSheetByItem = useMemo(() => {
    const g = new Map<string, ItemNumberRow[]>();
    for (const m of match?.notInSheet ?? []) {
      const arr = g.get(m.item_no);
      if (arr) arr.push(m as ItemNumberRow);
      else g.set(m.item_no, [m as ItemNumberRow]);
    }
    return [...g.entries()];
  }, [match]);

  if (mappingsQ.isLoading || targetsQ.isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Price List Import</h1>
        <p className="text-sm text-muted-foreground">
          Load a Duro-Last Excel price list. Rows match the catalog by item number (the map lives
          under{" "}
          <Link
            to="/admin/duro-last"
            search={{ tab: "items" }}
            className="text-primary underline underline-offset-2"
          >
            Duro-Last Pricing › Item Numbers
          </Link>
          ); the &quot;Duro-Last Membrane&quot; tab maps onto the membrane price matrix by product,
          mil and colour. Nothing is written until you review and confirm.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" /> 1. Choose the price sheet
          </CardTitle>
          <CardDescription>.xlsx, .xls or .csv — the file is read in your browser.</CardDescription>
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
            {fileName && (
              <span className="text-sm text-muted-foreground">
                {fileName} · {sheets.length} sheet{sheets.length === 1 ? "" : "s"}
                {membraneSheet ? ` · membrane tab "${membraneSheet.name}" found` : ""}
              </span>
            )}
          </div>

          {sheet && pick && !setupOpen && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <span>
                {recognised ? "Layout recognised from your last import" : "Layout"}: sheet{" "}
                <span className="font-medium">{sheet.name}</span> · header row {pick.headerRow + 1}{" "}
                · item # col {pick.itemCol + 1}
                {pick.descCol !== null ? ` · description col ${pick.descCol + 1}` : ""}
                {pick.priceCol !== null ? ` · price col ${pick.priceCol + 1}` : ""}
                {pick.unitCol != null ? ` · unit col ${pick.unitCol + 1}` : ""}
                {pick.sizeCol != null ? ` · size col ${pick.sizeCol + 1}` : ""}
                {membraneSheet ? ` · membrane tab ${useMembrane ? "on" : "off"}` : ""}
              </span>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setSetupOpen(true)}>
                Change columns
              </Button>
            </div>
          )}
          {sheet && pick && setupOpen && (
            <div className="flex flex-wrap items-end gap-3 text-xs">
              {sheets.length > 1 && (
                <div className="space-y-1">
                  <Label className="text-[11px]">Item sheet</Label>
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
                          unitCol: null,
                          sizeCol: null,
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
                  ["unitCol", "Unit column"],
                  ["sizeCol", "Size column"],
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
                    <SelectTrigger className="h-8 w-[190px] text-xs">
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
              {membraneSheet && (
                <label className="flex items-center gap-1.5 pb-2 text-xs">
                  <input
                    type="checkbox"
                    checked={useMembrane}
                    onChange={(e) => setUseMembrane(e.target.checked)}
                  />
                  Also load the membrane tab
                </label>
              )}
              {recognised && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => setSetupOpen(false)}
                >
                  Done
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {match && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Match results</CardTitle>
            <CardDescription>
              {items.length.toLocaleString()} sheet rows · {plan.length} price cell(s) will be
              written ({changed.length} change) · {match.unmatched.length.toLocaleString()} sheet
              item(s) have no mapping · {match.noPrice.length} matched but no price ·{" "}
              {notInSheetByItem.length} catalog item number(s) not in this sheet
              {match.duplicatesInSheet.length
                ? ` · duplicates in sheet: ${match.duplicatesInSheet.slice(0, 10).join(", ")}${match.duplicatesInSheet.length > 10 ? "…" : ""}`
                : ""}
              {membraneMatch
                ? ` · membrane: ${membraneMatch.matched.length} cell(s), ${membraneMatch.unmatched.length} unmatched`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setReviewOpen(true)} disabled={plan.length === 0}>
                Review &amp; confirm {plan.length} update{plan.length === 1 ? "" : "s"}…
              </Button>
              {lastReport && (
                <span className="rounded-md bg-muted px-3 py-1.5 text-xs">{lastReport}</span>
              )}
            </div>

            {notInSheetByItem.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  Catalog item numbers not in this sheet ({notInSheetByItem.length}) — re-point them
                  at the sheet&apos;s numbers
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  Duro-Last renumbers products over time. Search the sheet for the product and click
                  Use to move the mapping to that item number; it then matches on this and every
                  later import.
                </p>
                <div className="mt-2 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Old item #</TableHead>
                        <TableHead>Product (screen)</TableHead>
                        <TableHead>Find in sheet</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notInSheetByItem.map(([itemNo, ms]) => (
                        <TableRow key={itemNo}>
                          <TableCell className="align-top font-mono text-xs">{itemNo}</TableCell>
                          <TableCell className="align-top text-xs">
                            {ms.map((m) => (
                              <div key={`${m.screen_id}|${m.row_label}|${m.price_col}`}>
                                {m.row_label} · {m.price_col}{" "}
                                <span className="text-muted-foreground">
                                  ({categoryOf(m.screen_id)})
                                </span>
                              </div>
                            ))}
                          </TableCell>
                          <TableCell className="align-top">
                            <SheetSearch
                              items={items}
                              initial={ms[0]?.row_label ?? ""}
                              onPick={(it) => {
                                for (const m of ms) void remap(m, it);
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}

            {gapSuggestions.length > 0 && (
              <details
                className="rounded-md border border-primary/40 p-3"
                open={gapsWithSuggestion.length > 0}
              >
                <summary className="cursor-pointer text-sm font-semibold">
                  Catalog products with no item number ({gapSuggestions.length}) —{" "}
                  {gapsWithSuggestion.length} suggestion
                  {gapsWithSuggestion.length === 1 ? "" : "s"} from this sheet
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  Each suggestion is the sheet line whose wording best matches the product name.
                  Accept maps that item number (saved immediately; the price shows on the next
                  pass); Not this hides the suggestion for now.
                </p>
                <label className="mt-1 flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={showAllGaps}
                    onChange={(e) => setShowAllGaps(e.target.checked)}
                  />
                  Also list products with no suggestion
                </label>
                <div className="mt-2 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Catalog product</TableHead>
                        <TableHead>Suggested sheet line</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(showAllGaps
                        ? gapSuggestions.filter((g) => !dismissedGaps.has(g.key))
                        : gapsWithSuggestion
                      ).map((g) => (
                        <TableRow key={g.key}>
                          <TableCell className="text-xs">
                            <span className="text-muted-foreground">{g.category} › </span>
                            {g.target.row_label}
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              {g.target.price_col}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            {g.suggestion ? (
                              <>
                                <span className="font-mono">{g.suggestion.item.itemNo}</span>{" "}
                                {g.suggestion.item.description}
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  {Math.round(g.suggestion.score * 100)}% of the name
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">— nothing close</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {g.suggestion ? money(g.suggestion.item.price) : ""}
                          </TableCell>
                          <TableCell>
                            {g.suggestion && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7"
                                  onClick={() =>
                                    void saveMapping(
                                      g.suggestion!.item.itemNo,
                                      g.target,
                                      g.suggestion!.item.description,
                                    )
                                  }
                                >
                                  Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7"
                                  onClick={() => setDismissedGaps((d) => new Set(d).add(g.key))}
                                >
                                  Not this
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}

            {match.unmatched.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-semibold text-destructive">
                  No match — {match.unmatched.length.toLocaleString()} sheet item number(s) the
                  catalog doesn&apos;t know
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  A full Duro-Last list carries thousands of products the estimator never prices;
                  only map the ones you bid. Mapping saves immediately; the review picks the price
                  up on the next pass.
                </p>
                <UnmatchedList
                  items={match.unmatched}
                  targets={targets}
                  defaultTarget={defaultTarget}
                  drafts={mapDrafts}
                  setDrafts={setMapDrafts}
                  onMap={(it, t) => void saveMapping(it.itemNo, t, it.description)}
                  onAdd={openNewProduct}
                  suggest={(it) => suggestCatalogRow(it.description, catalogIndex)}
                />
              </details>
            )}

            {membraneMatch && membraneMatch.unmatched.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  Membrane tab lines with no matrix cell ({membraneMatch.unmatched.length})
                </summary>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {membraneMatch.unmatched.map((u) => (
                    <li key={u.item.rowIndex}>
                      row {u.item.rowIndex + 1}: {u.item.description} {u.item.mil} mil{" "}
                      {u.item.color} — {u.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {membraneSkipped.length > 0 && (
              <details className="rounded-md border border-amber-300 p-3">
                <summary className="cursor-pointer text-sm font-semibold">
                  Membrane roll lines not converted to $/sq ft ({membraneSkipped.length})
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  The membrane matrix is priced per sq ft; a roll price is only written once it can
                  be divided by the roll&apos;s area from the sheet&apos;s Size column. These lines
                  are left as they are.
                </p>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {membraneSkipped.map((u) => (
                    <li key={`${u.item.rowIndex}|${u.mapping.row_label}|${u.mapping.price_col}`}>
                      {u.item.itemNo} {u.item.description} → {u.mapping.row_label} ·{" "}
                      {u.mapping.price_col}: {u.reason}
                    </li>
                  ))}
                </ul>
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
          </CardContent>
        </Card>
      )}

      {/* ── Add as new product ────────────────────────────────────────── */}
      <Dialog
        open={newProduct !== null}
        onOpenChange={(o) => !o && !addingProduct && setNewProduct(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a new catalog product</DialogTitle>
            <DialogDescription>
              From sheet item <span className="font-mono">{newProduct?.item.itemNo}</span> —{" "}
              {newProduct?.item.description}
              {newProduct?.item.unit ? ` (${newProduct.item.unit})` : ""}. The row is added to the
              chosen screen with this price; other columns start at 0 and are editable there.
            </DialogDescription>
          </DialogHeader>
          {newProduct && (
            <div className="grid gap-3 text-sm">
              <div className="space-y-1">
                <Label className="text-xs">Screen</Label>
                <Select
                  value={newProduct.screen_id}
                  onValueChange={(v) => {
                    const t = flatTargets.find((x) => x.screen_id === v);
                    setNewProduct({
                      ...newProduct,
                      screen_id: v,
                      price_col: t?.price_cols[0] ?? "",
                    });
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {flatTargets.map((t) => (
                      <SelectItem key={t.screen_id} value={t.screen_id}>
                        {t.category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Product name (as it will read in the estimator)</Label>
                <Input
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Price column</Label>
                  <Select
                    value={newProduct.price_col}
                    onValueChange={(v) => setNewProduct({ ...newProduct, price_col: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        flatTargets.find((t) => t.screen_id === newProduct.screen_id)?.price_cols ??
                        []
                      ).map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={newProduct.price}
                    onChange={(e) =>
                      setNewProduct({ ...newProduct, price: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Check the unit: the sheet price is per {newProduct.item.unit || "unit"}; the catalog
                column&apos;s basis is what the estimator multiplies (per box, per foot, per each).
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewProduct(null)} disabled={addingProduct}>
              Cancel
            </Button>
            <Button
              onClick={submitNewProduct}
              disabled={addingProduct || !newProduct?.name.trim() || !newProduct?.price_col}
            >
              {addingProduct ? "Adding…" : "Add product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Review & confirm ──────────────────────────────────────────── */}
      <Dialog open={reviewOpen} onOpenChange={(o) => !applying && setReviewOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review &amp; confirm price update</DialogTitle>
            <DialogDescription>
              From {fileName}. {plan.length} price cell{plan.length === 1 ? "" : "s"} will be
              written: {changed.length} change ({increases} up, {decreases} down, {newlyPriced}{" "}
              newly priced), {plan.length - changed.length} already at the sheet price.
              {match && match.unmatched.length > 0
                ? ` ${match.unmatched.length.toLocaleString()} sheet item(s) with no mapping are skipped.`
                : ""}{" "}
              Saved bids keep their frozen prices until you click &quot;Update Pricing &amp;
              Labor&quot; on them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {changed.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item #</TableHead>
                      <TableHead>Screen</TableHead>
                      <TableHead>Product · column</TableHead>
                      <TableHead>Sheet description</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">New</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changed.map((p) => (
                      <TableRow key={`${p.item_no}|${p.screen_id}|${p.row_label}|${p.price_col}`}>
                        <TableCell className="font-mono text-xs">{p.item_no}</TableCell>
                        <TableCell className="text-xs">{p.category}</TableCell>
                        <TableCell className="text-xs">
                          {p.row_label} · {p.price_col}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.description}
                          {p.note && <div className="text-[10px] italic">{p.note}</div>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.unit}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {money(p.current)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums">
                          {money(p.next)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-xs tabular-nums ${
                            p.current !== null && p.next > p.current
                              ? "text-destructive"
                              : p.current !== null && p.next < p.current
                                ? "text-green-700 dark:text-green-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          {pct(p.current, p.next)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Every matched cell already holds the sheet price — applying only stamps the import
                date on the mappings.
              </p>
            )}
            {plan.length - changed.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {plan.length - changed.length} unchanged cell(s)
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  {plan
                    .filter((p) => p.current === p.next)
                    .map((p) => `${p.item_no} ${p.row_label}`)
                    .join(" · ")}
                </p>
              </details>
            )}
            <p className="text-xs text-muted-foreground">
              Check the Unit column against the catalog&apos;s price basis (per box, per foot, per
              each) before confirming — the import writes the sheet figure as-is.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={applying || plan.length === 0}>
              {applying
                ? "Applying…"
                : `Confirm and apply ${plan.length} update${plan.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The no-match list, paged so a 13,000-row sheet stays responsive. */
function UnmatchedList(props: {
  items: SheetItem[];
  targets: Parameters<typeof TargetPicker>[0]["targets"];
  defaultTarget: TargetRef | null;
  drafts: Record<string, TargetRef>;
  setDrafts: (f: (d: Record<string, TargetRef>) => Record<string, TargetRef>) => void;
  onMap: (it: SheetItem, t: TargetRef) => void;
  onAdd: (it: SheetItem) => void;
  /** Closest catalog product by name for a sheet line (computed for the rows on screen only). */
  suggest: (it: SheetItem) => { row: CatalogRowRef; score: number } | null;
}) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = f
      ? props.items.filter(
          (u) => u.itemNo.toLowerCase().includes(f) || u.description.toLowerCase().includes(f),
        )
      : props.items;
    return { total: list.length, rows: list.slice(0, limit) };
  }, [props.items, q, limit]);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          className="h-8 max-w-xs text-xs"
          placeholder="Filter unmatched by item # or description…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(50);
          }}
        />
        <span className="text-xs text-muted-foreground">
          showing {shown.rows.length} of {shown.total.toLocaleString()}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Item #</TableHead>
              <TableHead>Sheet description</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Map to</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.rows.map((u) => {
              const draft = props.drafts[u.key] ?? props.defaultTarget;
              return (
                <TableRow key={u.key}>
                  <TableCell className="text-xs text-muted-foreground">{u.rowIndex + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{u.itemNo}</TableCell>
                  <TableCell className="text-xs">{u.description}</TableCell>
                  <TableCell className="text-xs tabular-nums">{money(u.price)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.unit}</TableCell>
                  <TableCell>
                    {draft && (
                      <TargetPicker
                        targets={props.targets}
                        value={draft}
                        onChange={(v) => props.setDrafts((d) => ({ ...d, [u.key]: v }))}
                      />
                    )}
                    {(() => {
                      const sug = props.suggest(u);
                      if (!sug) return null;
                      const isDraft =
                        draft?.screen_id === sug.row.screen_id &&
                        draft?.row_label === sug.row.row_label;
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                          Suggested: {sug.row.category} › {sug.row.row_label}
                          {!isDraft && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() =>
                                props.setDrafts((d) => ({
                                  ...d,
                                  [u.key]: {
                                    screen_id: sug.row.screen_id,
                                    row_label: sug.row.row_label,
                                    price_col: sug.row.price_col,
                                  },
                                }))
                              }
                            >
                              Use
                            </Button>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!draft}
                        title="Point this item number at an existing catalog product"
                        onClick={() => draft && props.onMap(u, draft)}
                      >
                        Map
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Create a new catalog product from this sheet line"
                        onClick={() => props.onAdd(u)}
                      >
                        Add as new product
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {shown.rows.length < shown.total && (
        <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 100)}>
          Show more
        </Button>
      )}
    </div>
  );
}
