/**
 * The legacy Parapets screen (frmParapets — controls, captions, handlers, VerifyFields and the
 * lvSummary columns extracted from the licensed install's Estimator.exe IL; money from
 * DataAccess.dll Parapet — docs/legacy-money-parity.md §3, §8.4–8.7, §19).
 *
 * All money lives in the engine (bid-builder.ts); this component binds the form to
 * ParapetInput[] and shows the engine's per-wall ManHours. The legacy style toolstrip
 * (Vertical / Canted Vertical / Up & Over / Canted Up & Over) is deliberately NOT reproduced —
 * every profile dimension is enterable; the summary derives the style name from the dims.
 */

import { useState } from "react";

import type { EngineAdminData } from "@/lib/engine/adapters";
import { parapetBandForVertical } from "@/lib/engine/adapters";
import type { Attachment } from "@/lib/engine/estimate";
import {
  parapetLaborBand,
  resolveParapetSystem,
  type BidSectionInput,
  type ParapetInput,
} from "@/lib/engine/bid-builder";
import {
  TERMINATION_ID_BY_LABEL,
  parapetEdgeFasteners,
  parapetEdgeFastenersCount,
  parapetRemainingHeightIn,
} from "@/lib/engine/accessories";
import { TERMINATION_OPTIONS } from "@/lib/engine/edges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

const ATTACHMENT_LABEL: Record<Attachment, string> = {
  mechanical: "Mechanically Attached",
  adhered: "Fully Adhered",
};

/** Legacy ParapetStyle name derived from which profile dims are in use (docs §8.6). */
export function parapetStyleName(p: ParapetInput): string {
  const canted = (p.cantInches ?? 0) > 0;
  const upOver = (p.wallTopInches ?? 0) > 0 || (p.dropInches ?? 0) > 0;
  if (canted && upOver) return "Canted Up & Over";
  if (canted) return "Canted Vertical";
  if (upOver) return "Up & Over";
  return "Vertical";
}

function Num(props: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <Input
      type="number"
      min={props.min ?? 0}
      step={props.step ?? "1"}
      disabled={props.disabled}
      className={`h-8 ${props.invalid ? "border-destructive" : ""} ${props.className ?? ""}`}
      value={Number.isFinite(props.value) ? props.value : 0}
      onChange={(e) => {
        const n = Number(e.target.value);
        props.onChange(Number.isFinite(n) ? Math.max(props.min ?? 0, n) : 0);
      }}
    />
  );
}

function Check(props: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={props.id}
      className={`flex items-center gap-1.5 text-xs ${props.className ?? ""}`}
    >
      <input
        id={props.id}
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Pick(props: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger className={`h-8 ${props.className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Legacy wall-profile diagram: the membrane path with red inch labels (picParapetDiagram). */
export function ParapetProfileDiagram({ p }: { p: ParapetInput }) {
  const skirt = p.skirtInches ?? 0;
  const cant = p.cantInches ?? 0;
  const vert = p.verticalInches ?? 0;
  const top = p.wallTopInches ?? 0;
  const drop = p.dropInches ?? 0;
  const girth = skirt + cant + vert + top + drop || p.girthInches;
  const c707 = 0.7071;
  const pts: Array<[number, number]> = [[0, 0]];
  const push = (dx: number, dy: number) => {
    const [x, y] = pts[pts.length - 1]!;
    pts.push([x + dx, y + dy]);
  };
  push(skirt, 0);
  push(cant * c707, cant * c707);
  push(0, vert);
  push(top, 0);
  push(0, -drop);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const w = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const scale = Math.min(150 / w, 120 / h);
  const X = (x: number) => 40 + (x - Math.min(...xs)) * scale;
  const Y = (y: number) => 150 - (y - Math.min(...ys)) * scale;
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${X(x)},${Y(y)}`).join(" ");
  const mid = (i: number): [number, number] => {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    return [(X(a[0]) + X(b[0])) / 2, (Y(a[1]) + Y(b[1])) / 2];
  };
  const labels: Array<{ v: number; at: [number, number]; dx: number; dy: number }> = [
    { v: skirt, at: mid(0), dx: 0, dy: 14 },
    { v: cant, at: mid(1), dx: 14, dy: 6 },
    { v: vert, at: mid(2), dx: -8, dy: 0 },
    { v: top, at: mid(3), dx: 0, dy: -8 },
    { v: drop, at: mid(4), dx: 14, dy: 0 },
  ];
  return (
    <div className="rounded-md border p-3">
      <p className="mb-1 text-xs font-semibold">{p.name}</p>
      {girth <= 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Enter the wall dims to draw the profile.
        </p>
      ) : (
        <svg viewBox="0 0 230 170" className="h-40 w-full text-foreground">
          <line
            x1="8"
            y1={Y(0)}
            x2={X(0) + 4}
            y2={Y(0)}
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.35"
          />
          <path d={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          {labels
            .filter((l) => l.v > 0)
            .map((l, i) => (
              <text
                key={i}
                x={l.at[0] + l.dx}
                y={l.at[1] + l.dy}
                textAnchor="middle"
                className="fill-red-600 text-[10px] font-semibold dark:fill-red-400"
              >
                {l.v}&quot;
              </text>
            ))}
          <text
            x="222"
            y="164"
            textAnchor="end"
            className="fill-red-600 text-[10px] font-semibold dark:fill-red-400"
          >
            Girth: {girth}&quot;
          </text>
        </svg>
      )}
    </div>
  );
}

export interface ParapetsScreenProps {
  parapets: ParapetInput[];
  onChange: (next: ParapetInput[]) => void;
  selected: number;
  onSelect: (i: number) => void;
  admin: EngineAdminData;
  /** Bid-level Roof System / Attached With / adhesive — the defaults a wall may override. */
  bidDefaults: { roofSystem: string; attachment: Attachment; membraneAdhesiveName: string };
  /** Roof sections for "Copy Settings from Roof Section". */
  sections: BidSectionInput[];
  colorOptions: string[];
  crewRate: number;
  /** Engine per-wall ManHours (adjusted) and BaseManHours. */
  hoursById: Record<string, number>;
  baseHoursById: Record<string, number>;
  newParapet: () => ParapetInput;
  /**
   * Legacy lblParapets "Fasteners Needed": the parapet wall-tab requirement NET of fasteners
   * already entered on the Accessories → Parapet Wall-Tabs screen (frmParapets.UpdateTotals
   * = iTotals[5] − Σ oEdgeFasteners[5] quantities, floored at 0). Absent = gross requirement.
   */
  fastenersNeeded?: number;
}

export function ParapetsScreen(p: ParapetsScreenProps) {
  const { parapets, onChange, admin } = p;
  const i = Math.min(p.selected, parapets.length - 1);
  const w = parapets[i];
  const [showMembrane, setShowMembrane] = useState(false);
  const [showLabor, setShowLabor] = useState(false);
  const [laborPct, setLaborPct] = useState(0);
  const [copyFrom, setCopyFrom] = useState("");

  const upd = (patch: Partial<ParapetInput>) =>
    onChange(parapets.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const updFn = (fn: (x: ParapetInput) => ParapetInput) =>
    onChange(parapets.map((x, j) => (j === i ? fn(x) : x)));

  const systemOptions = [...new Set(Object.keys(admin.labor).map((k) => k.split("|")[0]!))];
  const attachmentsFor = (rs: string): Attachment[] => {
    const out: Attachment[] = [];
    for (const k of Object.keys(admin.labor)) {
      const [sys, att] = k.split("|");
      if (sys !== rs) continue;
      if (att === "mechanical") out.push("mechanical");
      else if (att === "adhesive" || att === "adhered") out.push("adhered");
    }
    return out.length ? out : ["mechanical"];
  };

  const bands = admin.parapetLabor?.bands ?? [];
  const totalHours = parapets.reduce((s, x) => s + (p.hoursById[x.id] ?? 0), 0);
  const grossFasteners = parapetEdgeFastenersCount(
    parapets,
    p.bidDefaults.roofSystem,
    p.bidDefaults.attachment,
  );
  const fastenersNeeded = p.fastenersNeeded ?? grossFasteners;
  const girthOf = (x: ParapetInput) =>
    (x.skirtInches ?? 0) +
      (x.cantInches ?? 0) +
      (x.verticalInches ?? 0) +
      (x.wallTopInches ?? 0) +
      (x.dropInches ?? 0) || x.girthInches;
  const vertSqFt = parapets.reduce((s, x) => s + (x.lengthFt * (x.verticalInches ?? 0)) / 12, 0);
  const totalSqFt = parapets.reduce((s, x) => s + (x.lengthFt * girthOf(x)) / 12, 0);
  const membraneSqFt = parapets.reduce((s, x) => {
    const pieces = x.pieces ?? 1;
    const adjLen = pieces >= 1 ? x.lengthFt + 1 + pieces : 0;
    return s + (Math.ceil(girthOf(x)) / 12) * adjLen;
  }, 0);

  if (!w) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No parapet walls. Labor bills from the deck × wall-height matrix (band from the Vertical
          dimension); membrane prices at the Parapets tier for each wall&apos;s mil and color.
        </p>
        <Button
          size="sm"
          onClick={() => {
            onChange([...parapets, p.newParapet()]);
            p.onSelect(parapets.length);
          }}
        >
          + New Parapet
        </Button>
      </div>
    );
  }

  const ps = resolveParapetSystem(p.bidDefaults, w);
  const band = parapetLaborBand(w, bands);
  const bandFromVertical =
    w.verticalInches !== undefined ? parapetBandForVertical(bands, w.verticalInches) : undefined;
  const baseHours = p.baseHoursById[w.id] ?? 0;
  const manHours = p.hoursById[w.id] ?? 0;
  const wallFasteners = parapetEdgeFasteners(w, ps.roofSystem, ps.attachment);
  const remainIn = parapetRemainingHeightIn(w, ps.roofSystem, ps.attachment);
  const setDim = (
    key: "skirtInches" | "cantInches" | "verticalInches" | "wallTopInches" | "dropInches",
    v: number,
  ) =>
    updFn((x) => {
      const nx = { ...x, [key]: v };
      nx.girthInches =
        (nx.skirtInches ?? 0) +
        (nx.cantInches ?? 0) +
        (nx.verticalInches ?? 0) +
        (nx.wallTopInches ?? 0) +
        (nx.dropInches ?? 0);
      return nx;
    });

  // Legacy VerifyFields: "These fields must have values greater than zero: -Vertical size /
  // -Length / -Number of Pieces" (the style-gated dims Skirt / Cant / Width of top / Drop are
  // not enforced here because the web has no style toolstrip — every dim is optional).
  const problems: string[] = [];
  if (!((w.verticalInches ?? 0) > 0)) problems.push("Vertical size");
  if (!(w.lengthFt > 0)) problems.push("Length");
  if (!((w.pieces ?? 1) > 0)) problems.push("Number of Pieces");

  const termLabel =
    TERMINATION_OPTIONS.find((t) => TERMINATION_ID_BY_LABEL[t] === w.termOptionId) ??
    "No Termination";
  const membraneSummary = `${ps.roofSystem} - ${ATTACHMENT_LABEL[ps.attachment]} - ${
    w.thicknessMil ?? p.sections[0]?.thickness ?? "—"
  }mil - ${w.color ?? p.sections[0]?.color ?? "bid default"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {parapets.length} parapet {parapets.length === 1 ? "wall" : "walls"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const copy: ParapetInput = JSON.parse(JSON.stringify(w));
              copy.id = `p${Date.now().toString(36)}`;
              copy.name = `${w.name} (copy)`;
              onChange([...parapets, copy]);
              p.onSelect(parapets.length);
            }}
          >
            Copy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(parapets.filter((_, j) => j !== i));
              p.onSelect(Math.max(0, Math.min(i, parapets.length - 2)));
            }}
          >
            Remove
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onChange([...parapets, p.newParapet()]);
              p.onSelect(parapets.length);
            }}
          >
            + New Parapet
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Left: the legacy entry form ── */}
        <div className="min-w-0 space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Parapet">
              <Input
                className="h-8 w-[180px] font-medium"
                value={w.name}
                onChange={(e) => upd({ name: e.target.value })}
              />
            </Field>
            <Field label="Deck Type">
              <Pick
                className="w-[150px]"
                value={w.deckType}
                options={admin.deckOrder}
                onChange={(v) => upd({ deckType: v })}
              />
            </Field>
            <Field label="Wall Type">
              <Pick
                className="w-[160px]"
                value={(w.wallType ?? 1) === 4 ? "Brick or Concrete" : "Wood or Metal"}
                options={["Wood or Metal", "Brick or Concrete"]}
                onChange={(v) => upd({ wallType: v === "Brick or Concrete" ? 4 : 1 })}
              />
            </Field>
            <Field label="Length of Wall (ft)">
              <Num
                className="w-[100px]"
                step="0.01"
                invalid={!(w.lengthFt > 0)}
                value={w.lengthFt}
                onChange={(v) =>
                  // Legacy AutoModLengths: a termination length equal to the old wall length
                  // follows the wall length (the default); explicit runs stay.
                  updFn((x) => {
                    const nx = { ...x, lengthFt: v };
                    if (x.termLengthFt !== undefined && x.termLengthFt === x.lengthFt)
                      nx.termLengthFt = v;
                    return nx;
                  })
                }
              />
            </Field>
            <Field label="# of Pieces">
              <Num
                className="w-[80px]"
                invalid={!((w.pieces ?? 1) > 0)}
                value={w.pieces ?? 1}
                onChange={(v) => upd({ pieces: Math.floor(v) })}
              />
            </Field>
          </div>

          <div className="rounded-md border p-2">
            <p className="mb-1 text-xs font-semibold">Dimensions (inches)</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {(
                [
                  ["Skirt", "skirtInches"],
                  ["Cant", "cantInches"],
                  ["Vertical", "verticalInches"],
                  ["Top of Wall", "wallTopInches"],
                  ["Drop", "dropInches"],
                ] as const
              ).map(([label, key]) => (
                <Field key={key} label={label}>
                  <Num
                    step="0.5"
                    invalid={key === "verticalInches" && !((w.verticalInches ?? 0) > 0)}
                    value={w[key] ?? 0}
                    onChange={(v) => setDim(key, v)}
                  />
                </Field>
              ))}
              <Field label="Girth (in)">
                <Input className="h-8" value={w.girthInches} readOnly disabled />
              </Field>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                Wall height band: <b>{band || "—"}</b>
                {bandFromVertical
                  ? " (from Vertical)"
                  : w.verticalInches !== undefined
                    ? " (no band covers this Vertical)"
                    : " (older wall — picked band)"}
              </span>
              <span>Height after tabs: {n2(remainIn)}&quot;</span>
              {ps.roofSystem === "Duro-Last" && (w.verticalInches ?? 0) <= 30 ? (
                <span className="text-muted-foreground">
                  No wall tabs (Duro-Last needs Vertical over 30&quot;) — 0 tab fasteners
                </span>
              ) : null}
              <span>Style: {parapetStyleName(w)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Check
              id={`ss-${w.id}`}
              checked={w.useSlipsheet ?? false}
              onChange={(v) => upd({ useSlipsheet: v })}
              label="Use Slipsheet"
            />
            <Check
              id={`tbb-${w.id}`}
              checked={w.useTermBarOnBase ?? false}
              onChange={(v) => upd({ useTermBarOnBase: v })}
              label="Term Bar Base"
            />
          </div>

          <Tabs defaultValue="term">
            <TabsList className="h-8">
              <TabsTrigger value="term" className="h-7 px-3 text-xs">
                Termination
              </TabsTrigger>
              <TabsTrigger value="caps" className="h-7 px-3 text-xs">
                Capstones
              </TabsTrigger>
              <TabsTrigger value="arp" className="h-7 px-3 text-xs">
                ARP
              </TabsTrigger>
            </TabsList>
            <TabsContent value="term" className="mt-2">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Termination">
                  <Pick
                    className="w-[170px]"
                    value={termLabel}
                    options={TERMINATION_OPTIONS}
                    onChange={(v) =>
                      updFn((x) => {
                        const nx = { ...x };
                        const id = TERMINATION_ID_BY_LABEL[v];
                        if (id === undefined) {
                          delete nx.termOptionId;
                          delete nx.termLengthFt;
                        } else {
                          nx.termOptionId = id;
                          nx.termLengthFt = x.termLengthFt ?? x.lengthFt;
                        }
                        return nx;
                      })
                    }
                  />
                </Field>
                <Field label="Length">
                  <Num
                    className="w-[90px]"
                    step="0.01"
                    disabled={!((w.termOptionId ?? 0) > 0)}
                    value={(w.termOptionId ?? 0) > 0 ? (w.termLengthFt ?? w.lengthFt) : 0}
                    onChange={(v) => upd({ termLengthFt: v })}
                  />
                </Field>
                <Check
                  id={`wood-${w.id}`}
                  checked={w.hasBlocking ?? false}
                  onChange={(v) =>
                    updFn((x) => {
                      const nx = { ...x, hasBlocking: v };
                      if (v && nx.blockingLengthFt === undefined) nx.blockingLengthFt = x.lengthFt;
                      return nx;
                    })
                  }
                  label="Use Wood Blocking"
                  className="pb-2"
                />
                <Field label="Length">
                  <Num
                    className="w-[90px]"
                    step="0.01"
                    disabled={!w.hasBlocking}
                    value={w.hasBlocking ? (w.blockingLengthFt ?? w.lengthFt) : 0}
                    onChange={(v) => upd({ blockingLengthFt: v })}
                  />
                </Field>
                <p className="pb-2 text-[11px] text-muted-foreground">
                  Blocking prices on the wall length (legacy); this length is recorded only.
                </p>
              </div>
            </TabsContent>
            <TabsContent value="caps" className="mt-2">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Capstones">
                  <Pick
                    className="w-[170px]"
                    value={
                      w.capstoneOption === 1
                        ? "Remove Only"
                        : w.capstoneOption === 2
                          ? "Remove & Reinstall"
                          : "None"
                    }
                    options={["None", "Remove Only", "Remove & Reinstall"]}
                    onChange={(v) =>
                      updFn((x) => {
                        const nx = { ...x };
                        if (v === "None") {
                          delete nx.capstoneOption;
                          delete nx.capstoneLengthFt;
                        } else nx.capstoneOption = v === "Remove Only" ? 1 : 2;
                        return nx;
                      })
                    }
                  />
                </Field>
                <Field label="Length">
                  <Num
                    className="w-[90px]"
                    step="0.01"
                    disabled={!((w.capstoneOption ?? 0) > 0)}
                    value={(w.capstoneOption ?? 0) > 0 ? (w.capstoneLengthFt ?? w.lengthFt) : 0}
                    onChange={(v) => upd({ capstoneLengthFt: v })}
                  />
                </Field>
              </div>
            </TabsContent>
            <TabsContent value="arp" className="mt-2">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="ARP">
                  <Pick
                    className="w-[120px]"
                    value={(w.arpSizeIn ?? 0) > 0 ? `${w.arpSizeIn}"` : "None"}
                    options={["None", '12"', '18"', '24"', '30"']}
                    onChange={(v) =>
                      updFn((x) => {
                        const nx = { ...x };
                        if (v === "None") {
                          delete nx.arpSizeIn;
                          delete nx.arpLengthFt;
                        } else nx.arpSizeIn = parseInt(v, 10);
                        return nx;
                      })
                    }
                  />
                </Field>
                <Field label="Length">
                  <Num
                    className="w-[90px]"
                    step="0.01"
                    disabled={!((w.arpSizeIn ?? 0) > 0)}
                    value={(w.arpSizeIn ?? 0) > 0 ? (w.arpLengthFt ?? w.lengthFt) : 0}
                    onChange={(v) => upd({ arpLengthFt: v })}
                  />
                </Field>
                <p className="pb-2 text-[11px] text-muted-foreground">
                  A length equal to the wall length bills at the padded AdjustedLength (legacy).
                </p>
              </div>
            </TabsContent>
          </Tabs>

          {/* Legacy Membrane Options expander (grpMembraneOptions) */}
          <div className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => setShowMembrane((v) => !v)}
              >
                {showMembrane ? "Hide Membrane Options" : "Show Membrane Options"}
              </button>
              <span className="text-muted-foreground">{membraneSummary}</span>
            </div>
            {showMembrane && (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <Field label="Roof System">
                  <Pick
                    className="w-[160px]"
                    value={ps.roofSystem}
                    options={
                      systemOptions.includes(ps.roofSystem)
                        ? systemOptions
                        : [ps.roofSystem, ...systemOptions]
                    }
                    onChange={(v) => {
                      const atts = attachmentsFor(v);
                      upd({
                        roofSystem: v,
                        attachment: atts.includes(ps.attachment) ? ps.attachment : atts[0]!,
                      });
                    }}
                  />
                </Field>
                <Field label="Attachment">
                  <Pick
                    className="w-[180px]"
                    value={ATTACHMENT_LABEL[ps.attachment]}
                    options={attachmentsFor(ps.roofSystem).map((a) => ATTACHMENT_LABEL[a])}
                    onChange={(v) => {
                      const att = (Object.keys(ATTACHMENT_LABEL) as Attachment[]).find(
                        (k) => ATTACHMENT_LABEL[k] === v,
                      );
                      if (att) upd({ roofSystem: ps.roofSystem, attachment: att });
                    }}
                  />
                </Field>
                {ps.attachment === "adhered" && (
                  <Field label="Adhesive">
                    <Pick
                      className="w-[180px]"
                      value={ps.adhesiveName}
                      options={["Water Based Adhesive", "Solvent Based Adhesive"]}
                      onChange={(v) => upd({ membraneAdhesiveName: v })}
                    />
                  </Field>
                )}
                <Field label="Mil">
                  <Pick
                    className="w-[120px]"
                    value={w.thicknessMil !== undefined ? `${w.thicknessMil}mil` : "Bid default"}
                    options={["Bid default", "40mil", "50mil", "60mil"]}
                    onChange={(v) =>
                      updFn((x) => {
                        const nx = { ...x };
                        if (v === "Bid default") delete nx.thicknessMil;
                        else nx.thicknessMil = parseInt(v, 10);
                        return nx;
                      })
                    }
                  />
                </Field>
                <Field label="Color">
                  <Pick
                    className="w-[130px]"
                    value={w.color ?? "Bid default"}
                    options={["Bid default", ...p.colorOptions]}
                    onChange={(v) =>
                      updFn((x) => {
                        const nx = { ...x };
                        if (v === "Bid default") delete nx.color;
                        else nx.color = v;
                        return nx;
                      })
                    }
                  />
                </Field>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const nx = { ...w };
                    delete nx.roofSystem;
                    delete nx.attachment;
                    delete nx.membraneAdhesiveName;
                    onChange(parapets.map((x, j) => (j === i ? nx : x)));
                  }}
                >
                  Use bid defaults
                </Button>
                {/* Legacy "Copy Settings from Roof Section": Roof System, Attachment, Mil,
                    Deck Type and Color from the chosen section. */}
                <div className="flex items-end gap-2">
                  <Field label="Copy Settings from Roof Section">
                    <Select value={copyFrom} onValueChange={setCopyFrom}>
                      <SelectTrigger className="h-8 w-[170px]">
                        <SelectValue placeholder="Section…" />
                      </SelectTrigger>
                      <SelectContent>
                        {p.sections.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!copyFrom}
                    onClick={() => {
                      const s = p.sections.find((x) => x.id === copyFrom);
                      if (!s) return;
                      const patch: Partial<ParapetInput> = {
                        deckType: s.deckType,
                        thicknessMil: s.thickness,
                        color: s.color,
                        roofSystem: s.roofSystem || p.bidDefaults.roofSystem,
                        attachment: s.attachment ?? p.bidDefaults.attachment,
                      };
                      if (s.membraneAdhesiveName)
                        patch.membraneAdhesiveName = s.membraneAdhesiveName;
                      upd(patch);
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs">
            <span>
              Labor:{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => {
                  setLaborPct(w.adjustLaborPct ?? 0);
                  setShowLabor(true);
                }}
              >
                {n2(baseHours)} MHS ({100 + (w.adjustLaborPct ?? 0)}%
                {w.adjustLaborPct === undefined ? ", template" : ""})
              </button>
            </span>
            <span
              className={fastenersNeeded > 0 ? "font-medium text-destructive" : ""}
              title={
                "Wall-tab fasteners still to order: the requirement across all walls " +
                `(${grossFasteners.toLocaleString()}) less any entered on Accessories → ` +
                "Parapet Wall-Tabs and Steel Plates."
              }
            >
              Fasteners Needed: {fastenersNeeded.toLocaleString()}
              {parapets.length > 1 || fastenersNeeded !== grossFasteners
                ? ` (this wall ${wallFasteners.toLocaleString()}, all walls ${grossFasteners.toLocaleString()})`
                : ""}
            </span>
            <span>
              Man Hours: <b className="tabular-nums">{n2(totalHours)}</b>
            </span>
            <span>
              Labor Cost: <b className="tabular-nums">{usd(totalHours * p.crewRate)}</b>
            </span>
          </div>
          <Field label="Notes">
            <Input
              className="h-8"
              value={w.notes ?? ""}
              placeholder="Optional notes for this wall…"
              onChange={(e) => upd({ notes: e.target.value })}
            />
          </Field>
          {problems.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <p className="font-medium">These fields must have values greater than zero:</p>
              <ul className="list-disc pl-4">
                {problems.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Right: diagram + lvSummary + totals ── */}
        <div className="space-y-3">
          <ParapetProfileDiagram p={w} />
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Style",
                    "Color",
                    "#",
                    "Skirt",
                    "Cant",
                    "Vert",
                    "Top",
                    "Drop",
                    "Length",
                    "Termination",
                    "Wood",
                    "Caps",
                    "ARP",
                  ].map((h) => (
                    <TableHead key={h} className="whitespace-nowrap px-2 text-xs">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {parapets.map((x, j) => (
                  <TableRow
                    key={x.id}
                    onClick={() => p.onSelect(j)}
                    className={`text-xs ${j === i ? "cursor-pointer bg-muted/60" : "cursor-pointer"}`}
                  >
                    <TableCell className="whitespace-nowrap px-2">{parapetStyleName(x)}</TableCell>
                    <TableCell className="px-2">{x.color ?? p.sections[0]?.color ?? "—"}</TableCell>
                    <TableCell className="px-2 tabular-nums">
                      {String(j + 1).padStart(3, "0")}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">
                      {x.skirtInches ?? 0}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">
                      {x.cantInches ?? 0}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">
                      {x.verticalInches ?? 0}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">
                      {x.wallTopInches ?? 0}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">
                      {x.dropInches ?? 0}
                    </TableCell>
                    <TableCell className="px-2 text-right tabular-nums">{x.lengthFt}</TableCell>
                    <TableCell className="whitespace-nowrap px-2">
                      {(x.termOptionId ?? 0) > 0
                        ? `${TERMINATION_OPTIONS.find((t) => TERMINATION_ID_BY_LABEL[t] === x.termOptionId) ?? "?"} ${n2(x.termLengthFt ?? x.lengthFt)}`
                        : "None"}
                    </TableCell>
                    <TableCell className="px-2">
                      {x.hasBlocking ? n2(x.blockingLengthFt ?? x.lengthFt) : "None"}
                    </TableCell>
                    <TableCell className="px-2">
                      {(x.capstoneOption ?? 0) > 0 ? n2(x.capstoneLengthFt ?? x.lengthFt) : "N/A"}
                    </TableCell>
                    <TableCell className="px-2">
                      {(x.arpSizeIn ?? 0) > 0
                        ? `${x.arpSizeIn}" ${n2(x.arpLengthFt ?? x.lengthFt)}`
                        : "None"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap justify-between gap-2 rounded-md border px-3 py-2 text-[11px]">
            <span>
              Vertical Wall Sq Ft: <b className="tabular-nums">{vertSqFt.toFixed(2)}</b>
            </span>
            <span>
              Total Wall Sq Ft: <b className="tabular-nums">{totalSqFt.toFixed(2)}</b>
            </span>
            <span>
              Parapet Membrane Sq Ft: <b className="tabular-nums">{membraneSqFt.toFixed(2)}</b>
            </span>
          </div>
        </div>
      </div>

      {/* Legacy frmLaborPopUp: Calculated Man Hours / Adjust Labor % / Change Hours (two-way). */}
      <Dialog open={showLabor} onOpenChange={setShowLabor}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Labor Adjustment — {w.name}</DialogTitle>
            <DialogDescription>
              Calculated Man Hours: {n2(baseHours)}. Without an override the labor template&apos;s
              Parapets Labor factor applies.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <Field label="Adjust Labor (%)">
              <Input
                type="number"
                className="h-8 w-[110px]"
                min={-100}
                step="1"
                value={laborPct}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLaborPct(Number.isFinite(v) ? Math.max(-100, v) : 0);
                }}
              />
            </Field>
            <Field label="Change Hours">
              <Input
                type="number"
                className="h-8 w-[110px]"
                step="0.01"
                value={Math.round(baseHours * (1 + laborPct / 100) * 100) / 100}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  if (baseHours > 0 && Number.isFinite(h))
                    setLaborPct(Math.max(-100, Math.round((h / baseHours) * 100) - 100));
                }}
              />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const nx = { ...w };
                delete nx.adjustLaborPct;
                onChange(parapets.map((x, j) => (j === i ? nx : x)));
                setShowLabor(false);
              }}
            >
              Use template default
            </Button>
            <Button
              onClick={() => {
                upd({ adjustLaborPct: laborPct });
                setShowLabor(false);
              }}
            >
              Finished
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="text-[11px] text-muted-foreground">Current wall: {n2(manHours)} man hours.</p>
    </div>
  );
}
