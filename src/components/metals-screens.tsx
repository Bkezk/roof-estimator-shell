/**
 * The legacy EXCEPTIONAL Metals screen (frmMetals + its four dialogs frmGutters,
 * frmDownSpouts, frmPitchPans, frmCollectionBoxes — layout extracted from the licensed
 * install's Estimator.exe designer IL and form resources; tile icons are the legacy
 * button images).
 *
 * All money math lives in the engine (src/lib/engine/metals.ts — docs §13); this
 * component binds the four dialogs to MetalsState and renders the engine's summary
 * rows in the legacy lvSummary grid (Category | Item | Qty/LF | Cost/Quote |
 * Hours PerUnit/LF | Hours | Labor Cost; hours at 2 dp, hours-per-unit at 3 dp —
 * display rounding only).
 */

import { useMemo, useState } from "react";

import type {
  DownspoutEntryState,
  GutterEntryState,
  MetalsRefData,
  MetalsRefRow,
  MetalsResult,
  MetalsState,
} from "@/lib/engine/metals";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Numeric input floored at 0 (no negative quantities anywhere — user rule). */
function Num(props: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  step?: string;
}) {
  return (
    <Input
      type="number"
      min={0}
      step={props.step ?? "1"}
      className={props.className ?? "h-7 w-[84px] bg-green-50 dark:bg-green-950"}
      value={props.value === 0 ? "" : props.value}
      placeholder="0"
      onChange={(e) => {
        const n = Number(e.target.value);
        props.onChange(Number.isFinite(n) ? Math.max(0, n) : 0);
      }}
    />
  );
}

type TileId = "gutters" | "downspouts" | "pitchPans" | "collectionBoxes";

const TILES: Array<{ id: TileId; label: string; icon: string; classes: string }> = [
  {
    id: "gutters",
    label: "Gutters",
    icon: "/metals-gutter.png",
    classes: "border-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-950 dark:hover:bg-red-900",
  },
  {
    id: "downspouts",
    label: "Downspouts",
    icon: "/metals-downspout.png",
    classes: "border-teal-300 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900",
  },
  {
    id: "pitchPans",
    label: "Pitch Pans",
    icon: "/metals-pitchpan.png",
    classes:
      "border-yellow-300 bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-950 dark:hover:bg-yellow-900",
  },
  {
    id: "collectionBoxes",
    label: "Collection Boxes",
    icon: "/metals-collectionbox.png",
    classes: "border-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:hover:bg-blue-900",
  },
];

const CATEGORY_BY_TILE: Record<TileId, string> = {
  gutters: "Gutters",
  downspouts: "Downspouts",
  pitchPans: "Pitch Pans",
  collectionBoxes: "Collection Boxes",
};

interface MetalsScreensProps {
  refData: MetalsRefData | undefined;
  state: MetalsState;
  onChange: (next: MetalsState) => void;
  result: MetalsResult | undefined;
}

export function MetalsScreens({ refData, state, onChange, result }: MetalsScreensProps) {
  const [openTile, setOpenTile] = useState<TileId | null>(null);

  if (!refData) {
    return (
      <p className="text-sm text-muted-foreground">
        The Exceptional Metals ref data hasn&apos;t been captured into the admin snapshot yet.
      </p>
    );
  }

  const lines = result?.lines ?? [];
  const totals = {
    material: result?.materialCost ?? 0,
    hours: result?.laborHours ?? 0,
    labor: result?.laborCost ?? 0,
  };

  return (
    <div className="space-y-4">
      {/* Legacy tile row (frmMetals: btnGutters / btnDownspouts / btnPitchpans / btnCollectionBoxes) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenTile(t.id)}
            className={`flex flex-col items-center gap-2 rounded-md border-2 p-4 text-sm font-medium transition-colors ${t.classes}`}
          >
            <img src={t.icon} alt="" className="h-16 w-16 object-contain dark:invert" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Legacy lvSummary grid */}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No metals entered. Click a tile to open its legacy entry screen — material folds into
          Duro-Last material (dMaterial[5]); labor bills as direct labor at each row&apos;s own rate
          (dLabor[5]).
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty/LF</TableHead>
              <TableHead className="text-right">Cost/Quote</TableHead>
              <TableHead className="text-right">Hours PerUnit/LF</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Labor Cost</TableHead>
              <TableHead className="w-[56px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((ln, i) => {
              const tile = (Object.keys(CATEGORY_BY_TILE) as TileId[]).find(
                (t) => CATEGORY_BY_TILE[t] === ln.category,
              );
              return (
                <TableRow
                  key={i}
                  className="cursor-pointer"
                  onDoubleClick={() => tile && setOpenTile(tile)}
                >
                  <TableCell className="text-muted-foreground">
                    {i === 0 || lines[i - 1]!.category !== ln.category ? ln.category : ""}
                  </TableCell>
                  <TableCell>{ln.item}</TableCell>
                  <TableCell className="text-right tabular-nums">{ln.qtyOrLf}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(ln.materialCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {ln.hoursPerUnit.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{ln.hours.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(ln.laborCost)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => tile && setOpenTile(tile)}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="font-medium">
              <TableCell colSpan={3}>Totals</TableCell>
              <TableCell className="text-right tabular-nums">{usd(totals.material)}</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{totals.hours.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums">{usd(totals.labor)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      )}

      <GuttersDialog
        open={openTile === "gutters"}
        onClose={() => setOpenTile(null)}
        refData={refData}
        state={state}
        onChange={onChange}
      />
      <DownspoutsDialog
        open={openTile === "downspouts"}
        onClose={() => setOpenTile(null)}
        refData={refData}
        state={state}
        onChange={onChange}
      />
      <PitchPansDialog
        open={openTile === "pitchPans"}
        onClose={() => setOpenTile(null)}
        refData={refData}
        state={state}
        onChange={onChange}
      />
      <CollectionBoxesDialog
        open={openTile === "collectionBoxes"}
        onClose={() => setOpenTile(null)}
        refData={refData}
        state={state}
        onChange={onChange}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared dialog scaffolding (legacy pnlFooter: "Total:" + Finished)
// ─────────────────────────────────────────────────────────────────────────────

function MetalsDialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        {props.children}
        <div className="flex items-center justify-between border-t pt-3">
          <p className="text-sm font-medium">
            Total: <span className="tabular-nums">{usd(props.total)}</span>
          </p>
          <Button size="sm" onClick={props.onClose}>
            Finished
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Row total (material + labor $) for footer sums — matches the legacy dialog txtTotal. */
function qtyRowTotal(row: MetalsRefRow, qty: number): number {
  return row.unitCost * qty + qty * row.laborPerUnit * row.laborRate;
}

function RefGrid(props: { children: React.ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Unit Cost</TableHead>
          <TableHead className="text-right">Labor/Unit</TableHead>
          <TableHead className="w-[96px]">Qty</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{props.children}</TableBody>
    </Table>
  );
}

function QtyRow(props: {
  row: MetalsRefRow;
  qty: number;
  onQty: (v: number) => void;
  qtyLabel?: string;
}) {
  const { row } = props;
  return (
    <TableRow>
      <TableCell>{row.description}</TableCell>
      <TableCell className="text-right tabular-nums">{usd(row.unitCost)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.laborPerUnit.toFixed(3)} h × {usd(row.laborRate)}
      </TableCell>
      <TableCell>
        <Num
          value={props.qty}
          onChange={props.onQty}
          step={props.qtyLabel === "LF" ? "0.1" : "1"}
        />
      </TableCell>
    </TableRow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gutters (frmGutters: Style + Size dropdowns → gutter LF row + accessory qty rows)
// ─────────────────────────────────────────────────────────────────────────────

function GuttersDialog(props: {
  open: boolean;
  onClose: () => void;
  refData: MetalsRefData;
  state: MetalsState;
  onChange: (next: MetalsState) => void;
}) {
  const { refData, state, onChange } = props;
  const g = refData.gutters;
  const [style, setStyle] = useState<string>(() => g.styles[0] ?? "");
  const sizes = g.sizesByStyle[style] ?? [];
  const [size, setSize] = useState<string>(() => sizes[0] ?? "");
  const effSize = sizes.includes(size) ? size : (sizes[0] ?? "");

  const key = `${style}|${effSize}`;
  const refEntry = g.byStyleSize[key];
  const entry = state.gutters.find((e) => e.style === style && e.size === effSize);
  const accRows = useMemo(
    () => [...(refEntry?.accessories ?? []), ...g.shared],
    [refEntry, g.shared],
  );

  const upsert = (patch: Partial<GutterEntryState>) => {
    const next = { ...state, gutters: [...state.gutters] };
    const i = next.gutters.findIndex((e) => e.style === style && e.size === effSize);
    if (i >= 0) next.gutters[i] = { ...next.gutters[i]!, ...patch };
    else next.gutters.push({ style, size: effSize, lengthFt: 0, accQty: {}, ...patch });
    onChange(next);
  };

  const total = state.gutters.reduce((sum, e) => {
    const re = g.byStyleSize[`${e.style}|${e.size}`];
    let t = 0;
    if (re?.gutter)
      t +=
        e.lengthFt * re.gutter.unitCost + e.lengthFt * re.gutter.laborPerUnit * re.gutter.laborRate;
    for (const row of [...(re?.accessories ?? []), ...g.shared])
      t += qtyRowTotal(row, e.accQty[row.description] ?? 0);
    return sum + t;
  }, 0);

  return (
    <MetalsDialog open={props.open} onClose={props.onClose} title="Gutters" total={total}>
      <div className="flex flex-wrap gap-3">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Style</p>
          <Select value={style} onValueChange={setStyle}>
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue placeholder="Style" />
            </SelectTrigger>
            <SelectContent>
              {g.styles.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Size</p>
          <Select value={effSize} onValueChange={setSize} disabled={sizes.length === 0}>
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue placeholder={sizes.length === 0 ? "No sizes captured" : "Size"} />
            </SelectTrigger>
            <SelectContent>
              {sizes.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!refEntry ? (
        <p className="text-sm text-muted-foreground">
          No priced rows captured for this style/size — enter them on the admin Exceptional Metals
          screen first.
        </p>
      ) : (
        <RefGrid>
          {refEntry.gutter && (
            <TableRow>
              <TableCell className="font-medium">Gutter (per LF)</TableCell>
              <TableCell className="text-right tabular-nums">
                {usd(refEntry.gutter.unitCost)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {refEntry.gutter.laborPerUnit.toFixed(3)} h × {usd(refEntry.gutter.laborRate)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Num
                    value={entry?.lengthFt ?? 0}
                    onChange={(v) => upsert({ lengthFt: v })}
                    step="0.1"
                  />
                  <span className="text-xs text-muted-foreground">LF</span>
                </div>
              </TableCell>
            </TableRow>
          )}
          {accRows.map((row) => (
            <QtyRow
              key={row.description}
              row={row}
              qty={entry?.accQty[row.description] ?? 0}
              onQty={(v) => upsert({ accQty: { ...(entry?.accQty ?? {}), [row.description]: v } })}
            />
          ))}
        </RefGrid>
      )}

      {/* Material for gutter runs bills increment10(LF) × $/LF: lengths round up to the next
          10 ft (legacy; a run under 10 ft bills 1 ft — legacy quirk kept for parity). */}
      <p className="text-xs text-muted-foreground">
        Gutter material bills the run length rounded up to the next 10 ft × the per-LF price; labor
        is LF × hours/LF at the row&apos;s own rate.
      </p>

      {state.gutters.filter((e) => e.style !== style || e.size !== effSize).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Other gutters on this bid</p>
          {state.gutters
            .filter((e) => e.style !== style || e.size !== effSize)
            .map((e) => (
              <div key={`${e.style}|${e.size}`} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="underline-offset-2 hover:underline"
                  onClick={() => {
                    setStyle(e.style);
                    setSize(e.size);
                  }}
                >
                  {e.style} — {e.size} ({e.lengthFt} LF)
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive"
                  onClick={() =>
                    props.onChange({
                      ...state,
                      gutters: state.gutters.filter(
                        (x) => !(x.style === e.style && x.size === e.size),
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
        </div>
      )}
    </MetalsDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Downspouts (frmDownSpouts: Size dropdown → Open/Closed LF + accessory qty rows,
// plus the General Downspout Accessories grid)
// ─────────────────────────────────────────────────────────────────────────────

function DownspoutsDialog(props: {
  open: boolean;
  onClose: () => void;
  refData: MetalsRefData;
  state: MetalsState;
  onChange: (next: MetalsState) => void;
}) {
  const { refData, state, onChange } = props;
  const d = refData.downspouts;
  const sizesWithRows = d.sizes.filter((s) => d.bySize[s]);
  const [size, setSize] = useState<string>(() => sizesWithRows[0] ?? d.sizes[0] ?? "");
  const sizeRef = d.bySize[size];
  const entry = state.downspouts.find((e) => e.size === size);

  const upsert = (patch: Partial<DownspoutEntryState>) => {
    const next = { ...state, downspouts: [...state.downspouts] };
    const i = next.downspouts.findIndex((e) => e.size === size);
    if (i >= 0) next.downspouts[i] = { ...next.downspouts[i]!, ...patch };
    else next.downspouts.push({ size, lengthByDesc: {}, accQty: {}, ...patch });
    onChange(next);
  };

  const total =
    state.downspouts.reduce((sum, e) => {
      const re = d.bySize[e.size];
      if (!re) return sum;
      let t = 0;
      for (const row of re.spouts) {
        const len = e.lengthByDesc[row.description] ?? 0;
        t += len * row.unitCost + len * row.laborPerUnit * row.laborRate;
      }
      for (const row of re.accessories) t += qtyRowTotal(row, e.accQty[row.description] ?? 0);
      return sum + t;
    }, 0) +
    d.general.reduce(
      (sum, row) => sum + qtyRowTotal(row, state.generalAccQty[row.description] ?? 0),
      0,
    );

  return (
    <MetalsDialog open={props.open} onClose={props.onClose} title="Downspouts" total={total}>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Size</p>
        <Select value={size} onValueChange={setSize}>
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent>
            {d.sizes.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!sizeRef ? (
        <p className="text-sm text-muted-foreground">
          No priced rows captured for this size — enter them on the admin Exceptional Metals screen
          first.
        </p>
      ) : (
        <RefGrid>
          {sizeRef.spouts.map((row) => (
            <TableRow key={row.description}>
              <TableCell className="font-medium">{row.description}</TableCell>
              <TableCell className="text-right tabular-nums">{usd(row.unitCost)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.laborPerUnit.toFixed(3)} h × {usd(row.laborRate)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Num
                    value={entry?.lengthByDesc[row.description] ?? 0}
                    onChange={(v) =>
                      upsert({
                        lengthByDesc: { ...(entry?.lengthByDesc ?? {}), [row.description]: v },
                      })
                    }
                    step="0.1"
                  />
                  <span className="text-xs text-muted-foreground">LF</span>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {sizeRef.accessories.map((row) => (
            <QtyRow
              key={row.description}
              row={row}
              qty={entry?.accQty[row.description] ?? 0}
              onQty={(v) => upsert({ accQty: { ...(entry?.accQty ?? {}), [row.description]: v } })}
            />
          ))}
        </RefGrid>
      )}

      <p className="text-xs text-muted-foreground">
        Downspout material bills the run length rounded up to the next 10 ft × the per-LF price
        (legacy increment10); labor is LF × hours/LF at the row&apos;s own rate.
      </p>

      <div>
        <p className="mb-1 text-sm font-medium">General Downspout Accessories</p>
        <RefGrid>
          {d.general.map((row) => (
            <QtyRow
              key={row.description}
              row={row}
              qty={state.generalAccQty[row.description] ?? 0}
              onQty={(v) =>
                onChange({
                  ...state,
                  generalAccQty: { ...state.generalAccQty, [row.description]: v },
                })
              }
            />
          ))}
        </RefGrid>
      </div>
    </MetalsDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pitch Pans (frmPitchPans: "Vinyl Coated Metal Pitch Pans" qty rows)
// ─────────────────────────────────────────────────────────────────────────────

function PitchPansDialog(props: {
  open: boolean;
  onClose: () => void;
  refData: MetalsRefData;
  state: MetalsState;
  onChange: (next: MetalsState) => void;
}) {
  const { refData, state, onChange } = props;
  const total = refData.pitchPans.reduce(
    (sum, row) => sum + qtyRowTotal(row, state.pitchPanQty[row.description] ?? 0),
    0,
  );
  return (
    <MetalsDialog open={props.open} onClose={props.onClose} title="Pitch Pans" total={total}>
      <p className="text-sm font-medium">Vinyl Coated Metal Pitch Pans</p>
      <RefGrid>
        {refData.pitchPans.map((row) => (
          <QtyRow
            key={row.description}
            row={row}
            qty={state.pitchPanQty[row.description] ?? 0}
            onQty={(v) =>
              onChange({ ...state, pitchPanQty: { ...state.pitchPanQty, [row.description]: v } })
            }
          />
        ))}
      </RefGrid>
    </MetalsDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Boxes (frmCollectionBoxes: Scupper Option dropdown → qty rows)
// ─────────────────────────────────────────────────────────────────────────────

function CollectionBoxesDialog(props: {
  open: boolean;
  onClose: () => void;
  refData: MetalsRefData;
  state: MetalsState;
  onChange: (next: MetalsState) => void;
}) {
  const { refData, state, onChange } = props;
  const cb = refData.collectionBoxes;
  const [option, setOption] = useState<string>(() => cb.options[0] ?? "");
  const rows = cb.byOption[option] ?? [];

  const total = Object.entries(state.collectionBoxQty).reduce(
    (sum, [opt, qtyByDesc]) =>
      sum +
      (cb.byOption[opt] ?? []).reduce(
        (s, row) => s + qtyRowTotal(row, qtyByDesc[row.description] ?? 0),
        0,
      ),
    0,
  );

  return (
    <MetalsDialog open={props.open} onClose={props.onClose} title="Collection Boxes" total={total}>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Scupper Option</p>
        <Select value={option} onValueChange={setOption}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="Scupper Option" />
          </SelectTrigger>
          <SelectContent>
            {cb.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <RefGrid>
        {rows.map((row) => (
          <QtyRow
            key={row.description}
            row={row}
            qty={state.collectionBoxQty[option]?.[row.description] ?? 0}
            onQty={(v) =>
              onChange({
                ...state,
                collectionBoxQty: {
                  ...state.collectionBoxQty,
                  [option]: { ...(state.collectionBoxQty[option] ?? {}), [row.description]: v },
                },
              })
            }
          />
        ))}
      </RefGrid>
    </MetalsDialog>
  );
}
