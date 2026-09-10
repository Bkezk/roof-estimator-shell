/**
 * The legacy Non-Duro-Last Items screen (frmNonDL + its six dialogs frmNonDL1..6 — layout
 * extracted from the licensed install's Estimator.exe designer IL and form resources; tile
 * icons are the legacy button images).
 *
 * All money math lives in the engine (src/lib/engine/nondl.ts — docs §14); this component binds
 * the dialogs' green (editable) cells to NonDlState and renders the engine's lines in the legacy
 * lvSummary grid (Category | Item | Qty. | Cost/Quote | Hours | Labor Cost; hours at 3 dp —
 * display rounding only). Dialog grids mirror the legacy CustomList columns: Description |
 * Footage/Calc (auto) | Extra (or a single Quantity = auto + extra) | Unit Cost | Total Cost |
 * HoursPerUnit | Hours | Labor Rate | Labor Cost, with the blank last row that adds a custom
 * item and the "Use Estimate Labor" reset.
 */

import { useState } from "react";

import {
  NON_DL_CATEGORY_LABEL,
  type NonDlCustomRow,
  type NonDlGroup,
  type NonDlLine,
  type NonDlRefData,
  type NonDlRefRow,
  type NonDlResult,
  type NonDlRowState,
  type NonDlState,
} from "@/lib/engine/nondl";
import { bankersRound } from "@/lib/engine/rounding";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Numeric input floored at 0 (no negative quantities anywhere — user rule). */
function Num(props: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  step?: string;
  title?: string;
}) {
  return (
    <Input
      type="number"
      min={0}
      step={props.step ?? "1"}
      title={props.title}
      className={props.className ?? "h-7 w-[76px] bg-green-50 px-1 text-right dark:bg-green-950"}
      value={props.value === 0 ? "" : props.value}
      placeholder="0"
      onChange={(e) => {
        const n = Number(e.target.value);
        props.onChange(Number.isFinite(n) ? Math.max(0, n) : 0);
      }}
    />
  );
}

type TileId = "blocking" | "deck" | "sheetMetal" | "masonry" | "subsServices" | "custom";

const TILES: Array<{ id: TileId; label: string; icon: string; groups: NonDlGroup[] }> = [
  {
    id: "blocking",
    label: "Wood & Edge Blocking",
    icon: "/nondl-blocking.png",
    groups: ["roofEdgeBlocking", "wallBlocking"],
  },
  {
    id: "deck",
    label: "Structural Roof Deck Materials",
    icon: "/nondl-deck.png",
    groups: ["deckMaterials"],
  },
  {
    id: "sheetMetal",
    label: "Sheet Metal Work",
    icon: "/nondl-sheetmetal.png",
    groups: ["sheetMetal"],
  },
  { id: "masonry", label: "Masonry Work", icon: "/nondl-masonry.png", groups: ["masonry"] },
  {
    id: "subsServices",
    label: "Sub-Contractors and Services",
    icon: "/nondl-subs.png",
    groups: ["services", "subcontractors"],
  },
  {
    id: "custom",
    label: "Customized Contractor Applications",
    icon: "/nondl-custom.png",
    groups: ["customApps"],
  },
];

const TILE_BY_GROUP: Partial<Record<NonDlGroup, TileId>> = {};
for (const t of TILES) for (const g of t.groups) TILE_BY_GROUP[g] = t.id;

/** Legacy dialog section headings per group (frmNonDL1/3 split panels). */
const GROUP_HEADING: Record<NonDlGroup, string> = {
  roofEdgeBlocking: "Roof Edge Blocking",
  wallBlocking: "Top of Parapet Wall Blocking",
  deckMaterials: "Structural Roof Deck Materials",
  sheetMetal: "Sheet Metal",
  masonry: "Masonry",
  services: "Services",
  subcontractors: "Sub-Contractors",
  customApps: "Contractor Applications",
  others: "Others",
};

/** Groups whose grid shows Footage/Calc + Extra columns (frmNonDL1/2); others show one Quantity. */
const SPLIT_QTY_GROUPS: ReadonlySet<NonDlGroup> = new Set([
  "roofEdgeBlocking",
  "wallBlocking",
  "deckMaterials",
]);

interface NonDlScreensProps {
  refData: NonDlRefData | undefined;
  state: NonDlState;
  onChange: (next: NonDlState) => void;
  result: NonDlResult | undefined;
  /** Estimate crew labor rate ("Use Estimate Labor" + the ref-rate-0 default). */
  crewRate: number;
}

export function NonDlScreens({ refData, state, onChange, result, crewRate }: NonDlScreensProps) {
  const [openTile, setOpenTile] = useState<TileId | null>(null);

  if (!refData) {
    return (
      <p className="text-sm text-muted-foreground">
        The Non-Duro-Last pricing screens haven&apos;t been captured into the admin snapshot yet.
      </p>
    );
  }

  const lines = result?.lines ?? [];
  const tile = TILES.find((t) => t.id === openTile);

  return (
    <div className="space-y-4">
      {/* Legacy tile row (frmNonDL: six buttons) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenTile(t.id)}
            className="flex flex-col items-center gap-2 rounded-md border-2 border-border bg-muted/40 p-3 text-center text-xs font-medium transition-colors hover:bg-muted"
          >
            <img src={t.icon} alt="" className="h-12 w-16 object-contain" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Legacy lvSummary grid */}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No non-Duro-Last items. Click a tile to open its legacy entry screen — blocking / deck /
          sheet metal / masonry / custom material bills as Other material with direct labor at each
          row&apos;s own rate; sub-contractors &amp; services roll into Subs &amp; services.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty.</TableHead>
              <TableHead className="text-right">Cost/Quote</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Labor Cost</TableHead>
              <TableHead className="w-[56px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((ln, i) => {
              const t = TILE_BY_GROUP[ln.group];
              return (
                <TableRow
                  key={i}
                  className={ln.unpriced ? "text-destructive" : undefined}
                  onDoubleClick={() => t && setOpenTile(t)}
                >
                  <TableCell className="text-muted-foreground">
                    {i === 0 || lines[i - 1]!.category !== ln.category ? ln.category : ""}
                  </TableCell>
                  <TableCell>
                    {ln.item}
                    {ln.unpriced && (
                      <span className="ml-1 text-xs">(price not captured — see admin)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{ln.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(ln.materialCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{ln.hours.toFixed(3)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(ln.laborCost)}</TableCell>
                  <TableCell>
                    {t ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setOpenTile(t)}
                      >
                        Edit
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="Auto quantity">
                        auto
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="font-medium">
              <TableCell colSpan={3}>Totals</TableCell>
              <TableCell className="text-right tabular-nums">
                {usd(result?.totalMaterialIncludingServices ?? 0)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {(result?.totalHours ?? 0).toFixed(3)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {usd(result?.totalLaborCost ?? 0)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      )}

      {tile && (
        <GroupDialog
          key={tile.id}
          open
          onClose={() => setOpenTile(null)}
          title={tile.label}
          groups={tile.groups}
          refData={refData}
          state={state}
          onChange={onChange}
          result={result}
          crewRate={crewRate}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dialog (one per tile; frmNonDL1/3 stack two grids)
// ─────────────────────────────────────────────────────────────────────────────

/** A per-row state patch; an explicit `undefined` clears that override (legacy recompute). */
type RowPatch = { [K in keyof NonDlRowState]?: NonDlRowState[K] | undefined };

interface RowView {
  description: string;
  calcQty: number;
  extra: number;
  qty: number;
  unitCost: number;
  laborPerUnit: number;
  laborRate: number;
  hours: number;
  materialCost: number;
  laborCost: number;
  unpriced: boolean;
}

function refRowView(
  group: NonDlGroup,
  row: NonDlRefRow,
  st: NonDlRowState | undefined,
  line: NonDlLine | undefined,
  crewRate: number,
): RowView {
  if (line) {
    return {
      description: row.description,
      calcQty: line.calcQty,
      extra: line.extraQty,
      qty: line.qty,
      unitCost: line.unitCost,
      laborPerUnit: line.laborPerUnit,
      laborRate: line.laborRate,
      hours: line.hours,
      materialCost: line.materialCost,
      laborCost: line.laborCost,
      unpriced: line.unpriced === true,
    };
  }
  return {
    description: row.description,
    calcQty: 0,
    extra: st?.extra ?? 0,
    qty: st?.extra ?? 0,
    unitCost: st?.unitCost ?? row.unitCost,
    laborPerUnit: st?.laborPerUnit ?? row.laborPerUnit,
    laborRate: st?.laborRate ?? (row.laborRate !== 0 ? row.laborRate : crewRate),
    hours: 0,
    materialCost: 0,
    laborCost: 0,
    unpriced: row.uncaptured === true && group !== "others" && row.unitCost === 0,
  };
}

function GroupDialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  groups: NonDlGroup[];
  refData: NonDlRefData;
  state: NonDlState;
  onChange: (next: NonDlState) => void;
  result: NonDlResult | undefined;
  crewRate: number;
}) {
  const { groups, refData, state, onChange, result, crewRate } = props;

  const setRow = (group: NonDlGroup, desc: string, patch: RowPatch) => {
    const cur = state.rows[group]?.[desc] ?? { extra: 0 };
    const merged: Record<string, number | undefined> = { ...cur, ...patch };
    // undefined patch values clear overrides
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const next = { extra: merged["extra"] ?? 0, ...merged } as unknown as NonDlRowState;
    onChange({
      ...state,
      rows: { ...state.rows, [group]: { ...(state.rows[group] ?? {}), [desc]: next } },
    });
  };
  const setCustom = (group: NonDlGroup, rows: NonDlCustomRow[]) =>
    onChange({ ...state, custom: { ...state.custom, [group]: rows } });

  const resetLabor = () => {
    const rows = { ...state.rows };
    const custom = { ...state.custom };
    for (const g of groups) {
      const gRows: Record<string, NonDlRowState> = { ...(rows[g] ?? {}) };
      for (const r of refData.rows[g] ?? [])
        gRows[r.description] = { ...(gRows[r.description] ?? { extra: 0 }), laborRate: crewRate };
      rows[g] = gRows;
      if (custom[g]) custom[g] = custom[g]!.map((c) => ({ ...c, laborRate: crewRate }));
    }
    onChange({ ...state, rows, custom });
  };

  let materialTotal = 0;
  let laborTotal = 0;
  for (const g of groups) {
    materialTotal += result?.byGroup[g].material ?? 0;
    laborTotal += result?.byGroup[g].laborCost ?? 0;
  }
  const ls2 = groups.some((g) => g === "services" || g === "subcontractors");

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pr-6">
          <DialogTitle>{props.title}</DialogTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={resetLabor}
            title="Reset every row's labor rate to the estimate default"
          >
            Use Estimate Labor
          </Button>
        </DialogHeader>

        {groups.map((g) => (
          <div key={g} className="space-y-1">
            {groups.length > 1 && <p className="text-sm font-medium">{GROUP_HEADING[g]}</p>}
            <GroupGrid
              group={g}
              refRows={refData.rows[g] ?? []}
              rowState={state.rows[g] ?? {}}
              customRows={state.custom[g] ?? []}
              lines={(result?.lines ?? []).filter((l) => l.group === g)}
              crewRate={crewRate}
              onRow={(desc, patch) => setRow(g, desc, patch)}
              onCustom={(rows) => setCustom(g, rows)}
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex flex-wrap gap-4 text-sm font-medium">
            {ls2 ? (
              <span>
                Total: <span className="tabular-nums">{usd(materialTotal + laborTotal)}</span>
              </span>
            ) : (
              <>
                <span>
                  Material Total: <span className="tabular-nums">{usd(materialTotal)}</span>
                </span>
                <span>
                  Labor Total: <span className="tabular-nums">{usd(laborTotal)}</span>
                </span>
              </>
            )}
          </div>
          <Button size="sm" onClick={props.onClose}>
            Finished
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupGrid(props: {
  group: NonDlGroup;
  refRows: NonDlRefRow[];
  rowState: Record<string, NonDlRowState>;
  customRows: NonDlCustomRow[];
  lines: NonDlLine[];
  crewRate: number;
  onRow: (desc: string, patch: RowPatch) => void;
  onCustom: (rows: NonDlCustomRow[]) => void;
}) {
  const { group, refRows, rowState, customRows, lines, crewRate, onRow, onCustom } = props;
  const split = SPLIT_QTY_GROUPS.has(group);
  const [draft, setDraft] = useState("");

  const lastRate =
    customRows[customRows.length - 1]?.laborRate ??
    (() => {
      const last = refRows[refRows.length - 1];
      return last ? (last.laborRate !== 0 ? last.laborRate : crewRate) : crewRate;
    })();

  const addCustom = () => {
    const d = draft.trim();
    if (!d) return;
    onCustom([
      ...customRows,
      { description: d, qty: 0, unitCost: 0, laborPerUnit: 0, laborRate: lastRate },
    ]);
    setDraft("");
  };

  return (
    <div className="overflow-x-auto">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[160px]">Description</TableHead>
            {split ? (
              <>
                <TableHead className="text-right">
                  {group === "deckMaterials" ? "Calc" : "Footage"}
                </TableHead>
                <TableHead className="text-right">Extra</TableHead>
              </>
            ) : (
              <TableHead className="text-right">Quantity</TableHead>
            )}
            <TableHead className="text-right">Unit Cost</TableHead>
            <TableHead className="text-right">Total Cost</TableHead>
            <TableHead className="text-right">Hrs/Unit</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead className="text-right">Labor Rate</TableHead>
            <TableHead className="text-right">Labor Cost</TableHead>
            <TableHead className="w-[40px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {refRows.map((row) => {
            const st = rowState[row.description];
            const line = lines.find((l) => !l.isCustom && l.item === row.description);
            const v = refRowView(group, row, st, line, crewRate);
            return (
              <TableRow key={row.description}>
                <TableCell className={v.unpriced ? "text-destructive" : undefined}>
                  {row.description}
                </TableCell>
                {split ? (
                  <>
                    <TableCell className="text-right tabular-nums">{v.calcQty}</TableCell>
                    <TableCell className="text-right">
                      <Num
                        value={v.extra}
                        onChange={(n) =>
                          onRow(row.description, { extra: n, laborHours: undefined })
                        }
                      />
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {v.calcQty > 0 && (
                        <span className="text-[10px] text-muted-foreground" title="Auto quantity">
                          auto {v.calcQty}
                        </span>
                      )}
                      <Num
                        value={v.qty}
                        onChange={(n) =>
                          onRow(row.description, {
                            extra: Math.max(0, n - v.calcQty),
                            laborHours: undefined,
                          })
                        }
                      />
                    </div>
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <Num
                    value={v.unitCost}
                    step="0.01"
                    onChange={(n) => onRow(row.description, { unitCost: n })}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{usd(v.materialCost)}</TableCell>
                <TableCell className="text-right">
                  <Num
                    value={v.laborPerUnit}
                    step="0.001"
                    onChange={(n) =>
                      onRow(row.description, { laborPerUnit: n, laborHours: undefined })
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Num
                    value={v.hours}
                    step="0.01"
                    title="Typing hours back-derives Hrs/Unit (legacy)"
                    onChange={(n) =>
                      onRow(row.description, {
                        laborHours: bankersRound(n, 2),
                        ...(v.qty > 0 ? { laborPerUnit: bankersRound(n / v.qty, 2) } : {}),
                      })
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Num
                    value={v.laborRate}
                    step="0.01"
                    onChange={(n) => onRow(row.description, { laborRate: n })}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{usd(v.laborCost)}</TableCell>
                <TableCell />
              </TableRow>
            );
          })}
          {customRows.map((c, i) => {
            const line = lines.find((l) => l.isCustom && l.item === c.description);
            const upd = (patch: Partial<NonDlCustomRow>) =>
              onCustom(customRows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            const hours = line?.hours ?? 0;
            return (
              <TableRow key={`custom-${i}`}>
                <TableCell>
                  <Input
                    className="h-7 bg-green-50 px-1 dark:bg-green-950"
                    value={c.description}
                    onChange={(e) => upd({ description: e.target.value })}
                  />
                </TableCell>
                {split && <TableCell className="text-right tabular-nums">0</TableCell>}
                <TableCell className="text-right">
                  <Num
                    value={c.qty}
                    onChange={(n) => {
                      const next = { ...c, qty: n };
                      delete next.laborHours;
                      onCustom(customRows.map((x, j) => (j === i ? next : x)));
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Num value={c.unitCost} step="0.01" onChange={(n) => upd({ unitCost: n })} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usd(line?.materialCost ?? 0)}
                </TableCell>
                <TableCell className="text-right">
                  <Num
                    value={c.laborPerUnit}
                    step="0.001"
                    onChange={(n) => {
                      const next = { ...c, laborPerUnit: n };
                      delete next.laborHours;
                      onCustom(customRows.map((x, j) => (j === i ? next : x)));
                    }}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Num
                    value={hours}
                    step="0.01"
                    onChange={(n) =>
                      upd({
                        laborHours: bankersRound(n, 2),
                        ...(c.qty > 0 ? { laborPerUnit: bankersRound(n / c.qty, 2) } : {}),
                      })
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Num value={c.laborRate} step="0.01" onChange={(n) => upd({ laborRate: n })} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usd(line?.laborCost ?? 0)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1 text-xs text-destructive"
                    onClick={() => onCustom(customRows.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {/* Legacy blank last row: typing a description adds a custom item. */}
          <TableRow>
            <TableCell colSpan={split ? 10 : 9}>
              <Input
                className="h-7 max-w-[320px] px-1"
                placeholder={`Add a custom ${NON_DL_CATEGORY_LABEL[group].toLowerCase()} item…`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={addCustom}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCustom();
                }}
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
