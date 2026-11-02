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
import { screenTitle } from "@/lib/catalog-branches";
import { firstTarget, type TargetRef } from "@/lib/item-number-targets";
import {
  addCatalogProduct,
  applyPriceImport,
  deleteItemNumber,
  listItemNumbers,
  listPriceImportChanges,
  listPriceImportRuns,
  listPriceTargets,
  revertPriceImport,
  upsertItemNumber,
  type ItemNumberRow,
  type PriceImportChange,
  type PriceImportRun,
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
  convertSheetPrice,
  type HeaderGuess,
  type MatchResult,
  type MembraneMatchResult,
  type ItemNumberMapping,
  type SheetItem,
  type SheetRow,
} from "@/lib/price-import";
import { triageUnmatched, type LikelyMatch } from "@/lib/price-import-triage";

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

/** A change past ×2 or below ÷2 usually means a unit or pack-quantity problem, not a price move. */
const bigSwing = (cur: number | null, next: number) =>
  cur !== null && cur > 0 && (next > cur * 2 || next < cur / 2);

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
  const { plan, membraneSkipped, unitSkipped } = useMemo(() => {
    const out: PlannedUpdate[] = [];
    // Membrane matrix cells are $/sq ft. The membrane tab prices them directly and wins; a
    // roll-goods item number mapped onto a cell converts roll $ ÷ roll area (both roll widths of
    // one product land on the same figure, so the cell is planned once). A roll line whose Size
    // cell cannot be read is reported, never written as a per-roll price.
    const membraneCells = new Set<string>();
    const cellKey = (row: string, col: string) => `${row}\u0000${col}`;
    const skipped: { item: SheetItem; mapping: ItemNumberMapping; reason: string }[] = [];
    const unitSkipped: { item: SheetItem; mapping: ItemNumberMapping; reason: string }[] = [];
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
      // Box / bag / package columns vs the sheet's per-EA (or per-bag) price: convert on the
      // row's pack quantity, or report — a per-each figure never lands in a per-box cell.
      const target = targetById.get(mapping.screen_id);
      const conv = convertSheetPrice({
        priceCol: mapping.price_col,
        sheetUnit: item.unit,
        sheetPrice: item.price!,
        packQty: target?.packs?.[mapping.row_label],
        packCol: target?.pack_col,
      });
      if ("error" in conv) {
        unitSkipped.push({ item, mapping, reason: conv.error });
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
        next: conv.price,
        ...(conv.note ? { note: conv.note } : {}),
      });
    }
    return { plan: out, membraneSkipped: skipped, unitSkipped };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, membraneMatch, targetById]);
  const changed = plan.filter((p) => p.current !== p.next);
  const increases = changed.filter((p) => p.current !== null && p.next > p.current).length;
  const decreases = changed.filter((p) => p.current !== null && p.next < p.current).length;
  const newlyPriced = changed.filter((p) => p.current === null).length;
  const swings = changed.filter((p) => bigSwing(p.current, p.next)).length;
  const isSuspect = (p: PlannedUpdate) => bigSwing(p.current, p.next);

  /* ---------------- Review & confirm ---------------- */
  const [reviewOpen, setReviewOpen] = useState(false);
  // Per-row opt-out on the review. A ⚠ row (more than double or under half the current price —
  // usually a per-box vs per-piece slip) starts unticked and needs an explicit tick.
  const planKey = (p: PlannedUpdate) => `${p.item_no}|${p.screen_id}|${p.row_label}|${p.price_col}`;
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const openReview = () => {
    setExcluded(new Set(changed.filter(isSuspect).map(planKey)));
    setReviewOpen(true);
  };
  const toWrite = plan.filter((p) => !excluded.has(planKey(p)));
  const selectedChanges = changed.filter((p) => !excluded.has(planKey(p))).length;
  const toggleRow = (key: string, on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });
  const [applying, setApplying] = useState(false);
  const [lastReport, setLastReport] = useState<string | null>(null);

  const apply = async () => {
    if (toWrite.length === 0) return;
    setApplying(true);
    try {
      const res = await applyFn({
        data: {
          file_name: fileName,
          updates: toWrite.map((p) => ({
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
      void qc.invalidateQueries({ queryKey: ["price-import-runs"] });
      setLastReport(
        `${res.applied.length} price cell${res.applied.length === 1 ? "" : "s"} written from ${fileName} (${nChanged} changed)` +
          (res.missing.length ? `; ${res.missing.length} could not be written` : "") +
          (match?.unmatched.length
            ? `; ${match.unmatched.length} sheet item(s) had no match`
            : "") +
          (res.run_id ? ". Logged under Import history below — it can be reverted." : ""),
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
  // A new product lands on a flat screen (any branch); Adhesives and Exceptional Metals keep
  // their own editors.
  const flatTargets = useMemo(() => targets.filter((t) => !t.kind), [targets]);
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

  // Lists 3 and 4 (price-import-triage.ts): every unmatched sheet line is a likely match for one
  // product or has no match. Not this / Skip are per file: they clear when another file loads.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [likelyLimit, setLikelyLimit] = useState(100);
  const triage = useMemo(
    () =>
      match
        ? triageUnmatched({
            unmatched: match.unmatched,
            notInSheet: match.notInSheet,
            mappings,
            targets,
            dismissed,
          })
        : null,
    [match, mappings, targets, dismissed],
  );
  const noMatchShown = useMemo(
    () => (triage ? triage.noMatch.filter((it) => !skipped.has(it.key)) : []),
    [triage, skipped],
  );
  /** Link on a likely match: a new number for the product, or the product's old number re-pointed. */
  const link = async (p: LikelyMatch) => {
    if (p.kind === "new") {
      await saveMapping(p.item.itemNo, p.target, p.item.description);
      return;
    }
    // Every column the old number priced on that product follows it (White / Tan / Gray …).
    const olds = (match?.notInSheet ?? []).filter(
      (m) =>
        m.item_no === p.oldItemNo &&
        m.screen_id === p.target.screen_id &&
        m.row_label === p.target.row_label,
    );
    for (const m of olds) await remap(m as ItemNumberRow, p.item);
  };

  if (mappingsQ.isLoading || targetsQ.isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Price List Import</h1>
        <p className="text-sm text-muted-foreground">
          Load a Duro-Last Excel price list. Lines match the price list by item number only (the
          numbers live under{" "}
          <Link
            to="/admin/duro-last"
            search={{ tab: "items" }}
            className="text-primary underline underline-offset-2"
          >
            Duro-Last Pricing › Item Numbers
          </Link>
          ). Lines with no number are offered as likely matches or listed as no match for you to
          link. Nothing is written until you review and confirm.
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

      {match && triage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Matched by item number</CardTitle>
              <CardDescription>
                {items.length.toLocaleString()} sheet rows · {plan.length} product
                {plan.length === 1 ? "" : "s"} matched · {changed.length} price
                {changed.length === 1 ? "" : "s"} would change
                {membraneMatch ? ` (membrane tab: ${membraneMatch.matched.length})` : ""}. Nothing
                is written until you review and confirm.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={openReview} disabled={plan.length === 0}>
                  Update {changed.length} price{changed.length === 1 ? "" : "s"}…
                </Button>
                {lastReport && (
                  <span className="rounded-md bg-muted px-3 py-1.5 text-xs">{lastReport}</span>
                )}
              </div>
              {changed.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item #</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Sheet line</TableHead>
                        <TableHead className="text-right">Now</TableHead>
                        <TableHead className="text-right">Sheet</TableHead>
                        <TableHead className="text-right">Δ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {changed.map((p) => (
                        <TableRow key={planKey(p)}>
                          <TableCell className="font-mono text-xs">{p.item_no}</TableCell>
                          <TableCell className="text-xs">
                            <span className="text-muted-foreground">{p.category} › </span>
                            {p.row_label}
                            {p.price_col !== "Price" && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {p.price_col}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {p.description}
                            {p.note && <div className="text-[10px] italic">{p.note}</div>}
                          </TableCell>
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
                            title={
                              bigSwing(p.current, p.next)
                                ? "More than double or less than half the current price — check the units before applying"
                                : undefined
                            }
                          >
                            {pct(p.current, p.next)}
                            {bigSwing(p.current, p.next) ? " ⚠" : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {plan.length - changed.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {plan.length - changed.length} already at the sheet price
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plan
                      .filter((p) => p.current === p.next)
                      .map((p) => `${p.item_no} ${p.row_label}`)
                      .join(" · ")}
                  </p>
                </details>
              )}
              {match.noPrice.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {match.noPrice.length} matched but the sheet has no price for them
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {match.noPrice.map((u) => `${u.itemNo} ${u.description}`).join(" · ")}
                  </p>
                </details>
              )}
              {unitSkipped.length > 0 && (
                <details className="rounded-md border border-amber-300 p-3" open>
                  <summary className="cursor-pointer text-sm font-semibold">
                    Not written — the sheet prices per piece, the list per box ({unitSkipped.length}
                    )
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enter the pieces per box on the product&apos;s screen (Fasteners/Box, Parts/Bag,
                    Parts/Package) and load the file again.
                  </p>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {unitSkipped.map((u) => (
                      <li key={`${u.item.rowIndex}|${u.mapping.row_label}|${u.mapping.price_col}`}>
                        {u.item.itemNo} {u.item.description} → {u.mapping.row_label} ·{" "}
                        {u.mapping.price_col}: {u.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {membraneSkipped.length > 0 && (
                <details className="rounded-md border border-amber-300 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Membrane rolls not turned into $/sq ft ({membraneSkipped.length})
                  </summary>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The membrane list is per sq ft; a roll price is only written once the
                    sheet&apos;s Size column gives the roll&apos;s area.
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
              {membraneMatch && membraneMatch.unmatched.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Membrane tab lines with no cell on the membrane list (
                    {membraneMatch.unmatched.length})
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
              {match.duplicatesInSheet.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Listed twice on the sheet (the last line wins):{" "}
                  {match.duplicatesInSheet.slice(0, 10).join(", ")}
                  {match.duplicatesInSheet.length > 10 ? "…" : ""}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                3. Likely matches ({triage.likely.length})
              </CardTitle>
              <CardDescription>
                Sheet lines with no item number on the price list, next to the product whose name
                they fit. Link saves the item number and the line moves up to the matched list. Not
                this sends it down to No match. A product with an old number the sheet no longer
                carries shows the old number.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {triage.likely.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to decide.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sheet line</TableHead>
                        <TableHead className="text-right">Sheet price</TableHead>
                        <TableHead>Product on the price list</TableHead>
                        <TableHead className="text-right">Now</TableHead>
                        <TableHead>Match</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {triage.likely.slice(0, likelyLimit).map((p) => (
                        <TableRow key={p.key}>
                          <TableCell className="text-xs">
                            <span className="font-mono">{p.item.itemNo}</span> {p.item.description}
                            {p.item.unit && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                per {p.item.unit}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {money(p.item.price)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="text-muted-foreground">{p.target.category} › </span>
                            {p.target.row_label}
                            {p.target.price_col !== "Price" && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {p.target.price_col}
                              </span>
                            )}
                            {p.kind === "renumbered" && (
                              <div className="text-[10px] text-muted-foreground">
                                was item # <span className="font-mono">{p.oldItemNo}</span>, not on
                                this sheet
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {money(p.currentPrice)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {p.strength === "strong" ? (
                              <span className="font-semibold text-green-700 dark:text-green-400">
                                strong
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-400">possible</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" className="h-7" onClick={() => void link(p)}>
                                Link
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7"
                                onClick={() => setDismissed((d) => new Set(d).add(p.key))}
                              >
                                Not this
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {triage.likely.length > likelyLimit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLikelyLimit((l) => l + 100)}
                    >
                      Show more ({triage.likely.length - likelyLimit} left)
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                4. No match found ({noMatchShown.length.toLocaleString()})
              </CardTitle>
              <CardDescription>
                Sheet lines nothing on the price list resembles. A full Duro-Last list carries
                thousands of products the estimator never prices, so only link the ones you bid:
                pick the product and press Link, or Skip to hide the line for this file.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {noMatchShown.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing left.</p>
              ) : (
                <UnmatchedList
                  items={noMatchShown}
                  targets={targets}
                  defaultTarget={defaultTarget}
                  drafts={mapDrafts}
                  setDrafts={setMapDrafts}
                  onMap={(it, t) => void saveMapping(it.itemNo, t, it.description)}
                  onSkip={(it) => setSkipped((s) => new Set(s).add(it.key))}
                  onAdd={openNewProduct}
                />
              )}
            </CardContent>
          </Card>
        </>
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

      <ImportHistory />

      {/* ── Review & confirm ──────────────────────────────────────────── */}
      <Dialog open={reviewOpen} onOpenChange={(o) => !applying && setReviewOpen(o)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review &amp; confirm price update</DialogTitle>
            <DialogDescription>
              From {fileName}. {plan.length} price cell{plan.length === 1 ? "" : "s"} will be
              written: {changed.length} change ({increases} up, {decreases} down, {newlyPriced}{" "}
              newly priced
              {swings > 0 ? `; ${swings} flagged ⚠ as a likely unit problem` : ""}
              ), {plan.length - changed.length} already at the sheet price.
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
                      <TableHead className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Apply all changes"
                          checked={selectedChanges === changed.length}
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                selectedChanges > 0 && selectedChanges < changed.length;
                          }}
                          onChange={(e) =>
                            setExcluded(
                              e.target.checked ? new Set() : new Set(changed.map(planKey)),
                            )
                          }
                        />
                      </TableHead>
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
                      <TableRow
                        key={planKey(p)}
                        className={excluded.has(planKey(p)) ? "opacity-50" : undefined}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Apply ${p.row_label} · ${p.price_col}`}
                            checked={!excluded.has(planKey(p))}
                            onChange={(e) => toggleRow(planKey(p), e.target.checked)}
                          />
                        </TableCell>
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
                          title={
                            bigSwing(p.current, p.next)
                              ? "More than double or less than half the current price — check the units before applying"
                              : undefined
                          }
                        >
                          {pct(p.current, p.next)}
                          {bigSwing(p.current, p.next) ? " ⚠" : ""}
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
              Untick any change you do not want written; the rest still apply. Rows flagged ⚠ (more
              than double or under half the current price) start unticked — tick one only once you
              have checked the units. Unticked rows keep their current price and come back on the
              next import. Every confirmed import is logged below and can be reverted.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={applying || toWrite.length === 0}>
              {applying
                ? "Applying…"
                : `Confirm and apply ${selectedChanges} of ${changed.length} change${changed.length === 1 ? "" : "s"}`}
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
  onSkip: (it: SheetItem) => void;
  onAdd: (it: SheetItem) => void;
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          className="h-8 max-w-xs text-xs"
          placeholder="Find by item # or description…"
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
              <TableHead>Item #</TableHead>
              <TableHead>Sheet line</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Link to</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.rows.map((u) => {
              const draft = props.drafts[u.key] ?? props.defaultTarget;
              return (
                <TableRow key={u.key}>
                  <TableCell className="font-mono text-xs">{u.itemNo}</TableCell>
                  <TableCell className="text-xs">
                    {u.description}
                    {u.unit && (
                      <span className="ml-1 text-[10px] text-muted-foreground">per {u.unit}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {money(u.price)}
                  </TableCell>
                  <TableCell>
                    {draft && (
                      <TargetPicker
                        targets={props.targets}
                        value={draft}
                        onChange={(v) => props.setDrafts((d) => ({ ...d, [u.key]: v }))}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={!draft}
                        onClick={() => draft && props.onMap(u, draft)}
                      >
                        Link
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => props.onSkip(u)}
                      >
                        Skip
                      </Button>
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground underline underline-offset-2"
                        title="Create a new product on the price list from this sheet line"
                        onClick={() => props.onAdd(u)}
                      >
                        add as new product
                      </button>
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

/** Every confirmed import: who, when, what, and a one-click revert. */
function ImportHistory() {
  const qc = useQueryClient();
  const listRuns = useServerFn(listPriceImportRuns);
  const listChanges = useServerFn(listPriceImportChanges);
  const revertFn = useServerFn(revertPriceImport);
  const runsQ = useQuery({ queryKey: ["price-import-runs"], queryFn: () => listRuns() });
  const [openRun, setOpenRun] = useState<string | null>(null);
  const changesQ = useQuery({
    queryKey: ["price-import-changes", openRun],
    queryFn: () => listChanges({ data: { run_id: openRun! } }),
    enabled: !!openRun,
  });
  const [confirmRevert, setConfirmRevert] = useState<PriceImportRun | null>(null);
  const [reverting, setReverting] = useState(false);
  const runs = runsQ.data ?? [];
  const revert = async (run: PriceImportRun) => {
    setReverting(true);
    try {
      const r = await revertFn({ data: { run_id: run.id } });
      toast.success(
        `Reverted ${r.reverted} cell${r.reverted === 1 ? "" : "s"} from ${run.file_name}` +
          (r.skipped.length ? ` — ${r.skipped.length} left as edited since` : ""),
      );
      setConfirmRevert(null);
      void qc.invalidateQueries({ queryKey: ["price-import-runs"] });
      void qc.invalidateQueries({ queryKey: ["price-import-changes"] });
      void qc.invalidateQueries({ queryKey: ["price-targets"] });
      void qc.invalidateQueries({ queryKey: ["pricing-catalog"] });
      void qc.invalidateQueries({ queryKey: ["pricing-screen"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revert failed");
    } finally {
      setReverting(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import history</CardTitle>
        <CardDescription>
          Every confirmed import, with each cell&apos;s price before and after. Revert puts the old
          prices back on every cell that still holds the imported figure; a cell edited by hand
          since is left alone and reported.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {runsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports applied yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div key={run.id} className="rounded-md border">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-medium">
                    {new Date(run.created_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  <span className="text-muted-foreground">{run.file_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {run.cells_written} cell{run.cells_written === 1 ? "" : "s"} written ·{" "}
                    {run.cells_changed} changed
                    {run.created_by_name ? ` · by ${run.created_by_name}` : ""}
                  </span>
                  {run.reverted_at ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      Reverted {new Date(run.reverted_at).toLocaleDateString()}
                      {run.revert_note ? ` (${run.revert_note})` : ""}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-7"
                      onClick={() => setConfirmRevert(run)}
                    >
                      Revert this import
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => setOpenRun(openRun === run.id ? null : run.id)}
                  >
                    {openRun === run.id ? "Hide cells" : "Show cells"}
                  </Button>
                </div>
                {openRun === run.id && (
                  <div className="overflow-x-auto border-t p-2">
                    {changesQ.isLoading ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item #</TableHead>
                            <TableHead>Screen</TableHead>
                            <TableHead>Product · column</TableHead>
                            <TableHead>Sheet description</TableHead>
                            <TableHead className="text-right">Before</TableHead>
                            <TableHead className="text-right">After</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(changesQ.data ?? []).map((c: PriceImportChange) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-mono text-xs">{c.item_no}</TableCell>
                              <TableCell className="text-xs">{screenTitle(c.screen_id)}</TableCell>
                              <TableCell className="text-xs">
                                {c.row_label} · {c.price_col}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {c.sheet_description ?? ""}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {money(c.old_price)}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {money(c.new_price)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {c.reverted_at ? "reverted" : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <Dialog
        open={!!confirmRevert}
        onOpenChange={(o) => !reverting && !o && setConfirmRevert(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert this import?</DialogTitle>
            <DialogDescription>
              {confirmRevert
                ? `${confirmRevert.cells_written} cell(s) from ${confirmRevert.file_name} go back to the price they held before it. Cells edited by hand since then are left as they are. Saved bids are not touched.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevert(null)} disabled={reverting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reverting}
              onClick={() => confirmRevert && void revert(confirmRevert)}
            >
              {reverting ? "Reverting…" : "Revert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
