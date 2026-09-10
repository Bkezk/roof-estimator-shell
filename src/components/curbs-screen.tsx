/**
 * The legacy Curbs screen (frmCurbs — layout, captions and behaviour extracted from the
 * licensed install's Estimator.exe designer IL; the curb drawings are the legacy picCurb
 * ImageList images, which carry the A/B/C/D dimension letters, with the numeric readout drawn
 * down the left as picCurb_Paint does).
 *
 * All money lives in the engine (curb-wrap.ts + bid-builder.ts, docs §2/§8.2/§8.3); this
 * component binds the form to CurbInput[] and shows the engine's per-curb ManHours.
 */

import { useState } from "react";

import type { CurbInput } from "@/lib/engine/bid-builder";
import { CURB_TYPE_BY_STYLE_ID } from "@/lib/engine/curb-wrap";
import { Button } from "@/components/ui/button";
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

/** Legacy style toolstrip: CurbStyle.ID → caption + picCurb image index (FillFields switch). */
const STYLES: Array<{ id: number; label: string; img: number; quote?: boolean }> = [
  { id: 1, label: "Open", img: 0 },
  { id: 2, label: "Closed", img: 1 },
  { id: 5, label: "With Top", img: 3 },
  { id: 6, label: "Scupper", img: 4 },
  { id: 7, label: "Metal Scupper", img: 5 },
  { id: 3, label: "Open Canted", img: 2, quote: true },
  { id: 4, label: "Closed Canted", img: 2, quote: true },
];
const styleOf = (id: number | undefined) => STYLES.find((s) => s.id === id);

/** Legacy grpTerm radios in form order → Curb.TermOption ids (optNone_CheckedChanged). */
const TERM_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 0, label: "None" },
  { id: 5, label: "No Lift & Counter Flash" },
  { id: 4, label: "No Lift & T-Bar" },
  { id: 3, label: "Lift & T-Bar" },
  { id: 2, label: "Lift & Tuck" },
  { id: 1, label: 'Scupper/Fascia Bar (1¾")' },
];

function Num(props: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: string;
  className?: string;
  invalid?: boolean;
}) {
  return (
    <Input
      type="number"
      min={props.min ?? 0}
      step={props.step ?? "0.25"}
      className={`h-8 ${props.invalid ? "border-destructive" : ""} ${props.className ?? ""}`}
      value={Number.isFinite(props.value) ? props.value : 0}
      onChange={(e) => {
        const n = Number(e.target.value);
        props.onChange(Number.isFinite(n) ? Math.max(props.min ?? 0, n) : 0);
      }}
    />
  );
}

export interface CurbsScreenProps {
  curbs: CurbInput[];
  onChange: (next: CurbInput[]) => void;
  selected: number;
  onSelect: (i: number) => void;
  /** Roof sections for "Copy Settings from Roof Section". */
  sections: Array<{ id: string; name: string; deckType: string; thickness: number; color: string }>;
  deckOptions: string[];
  colorOptions: string[];
  crewRate: number;
  /** Engine per-curb Curb.ManHours + the screen total. */
  hoursById: Record<string, number>;
  totalHours: number;
  newCurb: () => CurbInput;
}

export function CurbsScreen(p: CurbsScreenProps) {
  const { curbs, onChange, sections } = p;
  const i = Math.min(p.selected, curbs.length - 1);
  const c = curbs[i];
  const [copyFrom, setCopyFrom] = useState("");

  const upd = (patch: Partial<CurbInput>) =>
    onChange(curbs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const style = styleOf(c?.styleId);
  const dimsInvalid = c
    ? {
        a: !(c.widthIn > 0),
        b: !(c.lengthIn > 0),
        c: !((c.dimCIn ?? 0) > 0),
        d: !((c.dimDIn ?? 0) > 0),
      }
    : { a: false, b: false, c: false, d: false };
  const anyInvalid = Object.values(dimsInvalid).some(Boolean);
  const termLocked = c?.styleId === 5 || c?.styleId === 6 || c?.styleId === 7;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {curbs.length === 0
            ? "No curbs. Pick a style, enter the footprint and height, and the wrap membrane + labor price automatically."
            : `${curbs.length} curb ${curbs.length === 1 ? "entry" : "entries"}`}
        </p>
        <div className="flex gap-2">
          {c && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange(curbs.filter((_, j) => j !== i));
                p.onSelect(Math.max(0, Math.min(i, curbs.length - 2)));
              }}
            >
              Remove Selection
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              onChange([...curbs, p.newCurb()]);
              p.onSelect(curbs.length);
            }}
          >
            + New Curb
          </Button>
        </div>
      </div>

      {c && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          {/* ── Left: the legacy entry form ── */}
          <div className="min-w-0 space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Label</p>
                <Input
                  className="h-8 w-[180px] font-medium"
                  value={c.name}
                  onChange={(e) => upd({ name: e.target.value })}
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground"># of Curbs</p>
                <Num
                  className="w-[90px]"
                  step="1"
                  value={c.quantity}
                  onChange={(n) => upd({ quantity: Math.floor(n) })}
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Deck</p>
                <Select value={c.deckType} onValueChange={(v) => upd({ deckType: v })}>
                  <SelectTrigger className="h-8 w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {p.deckOptions.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Mil</p>
                <Select
                  value={c.thicknessMil !== undefined ? String(c.thicknessMil) : "default"}
                  onValueChange={(v) => {
                    const nx = { ...c };
                    if (v === "default") delete nx.thicknessMil;
                    else nx.thicknessMil = Number(v);
                    onChange(curbs.map((x, j) => (j === i ? nx : x)));
                  }}
                >
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Bid default</SelectItem>
                    {[40, 50, 60].map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Color</p>
                <Select
                  value={c.color ?? "default"}
                  onValueChange={(v) => {
                    const nx = { ...c };
                    if (v === "default") delete nx.color;
                    else nx.color = v;
                    onChange(curbs.map((x, j) => (j === i ? nx : x)));
                  }}
                >
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Bid default</SelectItem>
                    {p.colorOptions.map((col) => (
                      <SelectItem key={col} value={col}>
                        {col}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {sections.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    Copy Settings from Roof Section
                  </p>
                  <Select
                    value={copyFrom}
                    onValueChange={(v) => {
                      setCopyFrom("");
                      const s = sections.find((x) => x.id === v);
                      if (!s) return;
                      // Legacy roofSectionsMenuItem_ItemClicked: deck type + color (+ mil).
                      upd({ deckType: s.deckType, color: s.color, thicknessMil: s.thickness });
                    }}
                  >
                    <SelectTrigger className="h-8 w-[180px]">
                      <SelectValue placeholder="Roof section…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Legacy "Select Curb Style" toolstrip + the two canted menu items */}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Select Curb Style</p>
              <div className="flex flex-wrap gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.quote ? `${s.label} (quote required)` : s.label}
                    onClick={() => {
                      const nx: CurbInput = {
                        ...c,
                        styleId: s.id,
                        curbType: CURB_TYPE_BY_STYLE_ID[s.id] ?? "",
                      };
                      // Legacy forcing: With Top → None; Scupper / Metal Scupper → Scupper-Fascia.
                      if (s.id === 5) nx.termOption = 0;
                      if (s.id === 6 || s.id === 7) nx.termOption = 1;
                      onChange(curbs.map((x, j) => (j === i ? nx : x)));
                    }}
                    className={`flex flex-col items-center rounded-md border px-2 py-1.5 ${
                      c.styleId === s.id ? "border-primary bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <img src={`/curb-icon-${s.img}.png`} alt="" className="h-11 w-11" />
                    <span className="text-[10px] font-medium">
                      {s.label}
                      {s.quote ? " (quote)" : ""}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-sm">
                Style: <span className="font-medium">{style?.label ?? "[Select a Style]"}</span>
                {style?.quote && (
                  <span className="ml-2 text-xs text-destructive">
                    Canted styles are quote-required in the legacy app — wrap material is not
                    auto-priced.
                  </span>
                )}
              </p>
            </div>

            {/* Dimensions (legacy GroupBox2: A / B / C / Skirt(D)) */}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Enter curb dimensions in nearest .25&quot;
              </p>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <p className="mb-1 text-xs">A:</p>
                  <Num
                    value={c.widthIn}
                    invalid={dimsInvalid.a}
                    onChange={(n) => upd({ widthIn: n })}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs">B:</p>
                  <Num
                    value={c.lengthIn}
                    invalid={dimsInvalid.b}
                    onChange={(n) => upd({ lengthIn: n })}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs">C:</p>
                  <Num
                    value={c.dimCIn ?? 0}
                    invalid={dimsInvalid.c}
                    onChange={(n) => upd({ dimCIn: n })}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs">Skirt (D):</p>
                  <Num
                    value={c.dimDIn ?? 0}
                    invalid={dimsInvalid.d}
                    onChange={(n) => upd({ dimDIn: n })}
                  />
                </div>
              </div>
              {anyInvalid && (
                <p className="mt-1 text-xs text-destructive">
                  These fields must have values greater than zero! (legacy VerifyFields)
                </p>
              )}
              {!anyInvalid && (c.dimCIn ?? 0) < 8 && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Minimum height for curbs is 8&quot;, however there is no minimum through-wall
                  distance. Please verify your value in Dimension C.
                </p>
              )}
            </div>

            {/* Termination radios (legacy grpTerm) */}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Select Termination Option:
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {TERM_OPTIONS.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-center gap-1 text-sm ${termLocked ? "opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`term-${c.id}`}
                      className="accent-primary"
                      disabled={termLocked}
                      checked={(c.termOption ?? 0) === t.id}
                      onChange={() => upd({ termOption: t.id })}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              {(() => {
                const t = c.termOption ?? 0;
                if (t === 1 || t === 3 || t === 4) {
                  const ft = ((2 * c.widthIn + 2 * c.lengthIn + 12) / 12) * c.quantity;
                  return (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t === 1 ? '1¾" fascia bar' : "Term bar (no-drill)"}: {ft.toFixed(2)} ft —
                      auto-priced on the Accessories {t === 1 ? "Fascia" : "Term Bar"} screen (Curbs
                      count).{t === 3 ? " Lift labor auto-added." : ""}
                    </p>
                  );
                }
                if (t === 2)
                  return (
                    <p className="mt-1 text-[11px] text-muted-foreground">Lift labor auto-added.</p>
                  );
                if (t === 5) {
                  const ft = Math.ceil(((c.widthIn + c.lengthIn) * c.quantity * 2) / 12);
                  return (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Curb counter flashing: ≈{ft} ft — auto-priced on the Non-DL Sheet Metal Work
                      screen.
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            {/* Insulation / Plastic (legacy chkInsulated / chkPlastic) + labor link */}
            {(() => {
              const linealFt = (c.widthIn + c.lengthIn) / 6;
              const isoFasteners = Math.ceil(Math.ceil(linealFt * c.quantity) / 3);
              const polySqFt =
                (linealFt * ((c.dimCIn ?? 0) + (c.dimDIn ?? 0)) * 5 * c.quantity) / 48;
              const hours = p.hoursById[c.id] ?? 0;
              return (
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={c.hasInsulation ?? false}
                      onChange={(e) => upd({ hasInsulation: e.target.checked })}
                    />
                    Insulation on Curb(s)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={c.hasPlastic ?? false}
                      onChange={(e) => upd({ hasPlastic: e.target.checked })}
                    />
                    Plastic on Curb(s)
                  </label>
                  {(c.hasInsulation || c.hasPlastic) && (
                    <span className="text-[11px] text-muted-foreground">
                      {c.hasInsulation &&
                        `ISO ${(linealFt * c.quantity).toFixed(1)} sq ft (${isoFasteners} fasteners) → Non-DL Others. `}
                      {c.hasPlastic && `Poly ${polySqFt.toFixed(1)} sq ft → Non-DL Slipsheet.`}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-sm">
                    Labor:{" "}
                    <span className="font-semibold tabular-nums">{hours.toFixed(2)} hours</span>
                    <span className="text-xs text-muted-foreground">adj %</span>
                    <Num
                      className="w-[70px]"
                      step="1"
                      min={-100}
                      value={c.adjustLaborPct ?? 0}
                      onChange={(n) => upd({ adjustLaborPct: n })}
                    />
                  </span>
                </div>
              );
            })()}
          </div>

          {/* ── Right: the legacy picCurb (readout + drawing) and lvSummary ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-md border bg-background p-3">
              <div
                className="space-y-1 text-sm font-bold text-red-600 dark:text-red-400"
                style={{ fontFamily: "Arial, sans-serif" }}
              >
                <p>A: {c.widthIn}</p>
                <p>B: {c.lengthIn}</p>
                <p>C: {c.dimCIn ?? 0}</p>
                <p>D: {c.dimDIn ?? 0}</p>
              </div>
              {style ? (
                <img
                  src={`/curb-style-${style.img}.png`}
                  alt={style.label}
                  className="h-[115px] w-[150px] shrink-0"
                  style={{ imageRendering: "auto" }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">[Select a Style]</p>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Option</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">A</TableHead>
                    <TableHead className="text-right">B</TableHead>
                    <TableHead className="text-right">C</TableHead>
                    <TableHead className="text-right">D</TableHead>
                    <TableHead>Color</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {curbs.map((c2, i2) => (
                    <TableRow
                      key={c2.id}
                      onClick={() => p.onSelect(i2)}
                      className={i2 === i ? "cursor-pointer bg-muted/60" : "cursor-pointer"}
                    >
                      <TableCell className="font-medium">
                        {c2.name}
                        <span className="block text-[10px] text-muted-foreground">
                          {styleOf(c2.styleId)?.label ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {TERM_OPTIONS.find((t) => t.id === (c2.termOption ?? 0))?.label ?? "None"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c2.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{c2.widthIn}</TableCell>
                      <TableCell className="text-right tabular-nums">{c2.lengthIn}</TableCell>
                      <TableCell className="text-right tabular-nums">{c2.dimCIn ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{c2.dimDIn ?? 0}</TableCell>
                      <TableCell className="text-xs">{c2.color ?? "default"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell colSpan={2}>Total Curbs</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {curbs.reduce((s2, c2) => s2 + c2.quantity, 0).toLocaleString()}
                    </TableCell>
                    <TableCell colSpan={5} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {/* Legacy UpdateScreenTotals: Man Hours + labor $ at the estimate rate */}
            <div className="flex flex-wrap justify-end gap-4 text-sm">
              <span>
                Man Hours:{" "}
                <span className="font-semibold tabular-nums">{p.totalHours.toFixed(2)}</span>
              </span>
              <span>
                Labor:{" "}
                <span className="font-semibold tabular-nums">{usd(p.totalHours * p.crewRate)}</span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Click a row to edit that curb.</p>
          </div>
        </div>
      )}
    </div>
  );
}
