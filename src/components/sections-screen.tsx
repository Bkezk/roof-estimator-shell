/**
 * The legacy Roof Sections screen (frmRoofSection — controls, captions, handlers and
 * VerifyFields messages extracted from the licensed install's Estimator.exe IL; geometry from
 * DataAccess.dll RoofSection — docs/legacy-money-parity.md §16).
 *
 * All money lives in the engine (bid-builder.ts + estimate.ts); this component binds the form
 * to BidSectionInput[] and shows the engine's per-section Man Hours / Labor Cost.
 */

import { useState } from "react";

import type { EngineAdminData } from "@/lib/engine/adapters";
import type { Attachment } from "@/lib/engine/estimate";
import {
  COMPLEXITY_LABELS,
  TAB_OPTIONS_BY_SYSTEM,
  perimeterEnhancementCalculator,
  resolveSectionSheetLabel,
  resolveSectionSystem,
  roofSystemHasComplexity,
  sectionComplexityFactor,
  sectionLayers,
  sheetSizeSqFt,
  type BidSectionInput,
} from "@/lib/engine/bid-builder";
import {
  ARP_SIZE_OPTIONS,
  EDGE_SIDES,
  TERMINATION_OPTIONS,
  availableCorners,
  defaultEdges,
  edgeArpLength,
  edgePerimLength,
  edgeTermLength,
  resolveSectionZones,
  type EdgeInput,
  type PerimCorners,
} from "@/lib/engine/edges";
import {
  DESIGN_TABLE_OPTIONS,
  LEGACY_ROOF_SYSTEM_IDS,
  universalFastenerSpacing,
  type MechFastenerRow,
  type SpacingError,
} from "@/lib/engine/fastener-spacing";
import { SectionCalcDialog } from "@/components/section-calc-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
const n0 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const n2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

const SPACING_ERROR_TEXT: Record<SpacingError, string> = {
  [-5]: "no lookup rows for this system/thickness",
  [-1]: "no rows for this design table",
  [-2]: "no rows for this tab spacing",
  [-3]: "pull test too low — no permitted spacing",
};

const ATTACHMENT_LABEL: Record<Attachment, string> = {
  mechanical: "Mechanically Attached",
  adhered: "Fully Adhered",
};

function Num(props: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
}) {
  return (
    <Input
      type="number"
      min={props.min ?? 0}
      step={props.step ?? "1"}
      disabled={props.disabled}
      className={`h-8 ${props.invalid ? "border-destructive" : ""} ${props.className ?? ""}`}
      value={Number.isFinite(props.value) ? props.value : 0}
      onBlur={props.onBlur}
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
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={props.id}
      className={`flex items-center gap-1.5 text-xs ${props.disabled ? "opacity-50" : ""} ${props.className ?? ""}`}
    >
      <input
        id={props.id}
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={props.checked}
        disabled={props.disabled}
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
  disabled?: boolean;
}) {
  return (
    <Select value={props.value} onValueChange={props.onChange} disabled={props.disabled ?? false}>
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

export interface SectionsScreenProps {
  sections: BidSectionInput[];
  onChange: (next: BidSectionInput[]) => void;
  selected: number;
  onSelect: (i: number) => void;
  admin: EngineAdminData;
  /** Bid-level Roof System / Attached With / adhesive — the defaults a section may override. */
  bidDefaults: { roofSystem: string; attachment: Attachment; membraneAdhesiveName: string };
  colorOptions: string[];
  fastenerLookup: MechFastenerRow[] | undefined;
  /** Legacy "Standard Size Sheet Discount" checkbox mirrors the estimate-level flag. */
  stdSizeDiscount: boolean;
  onStdSizeDiscount: (v: boolean) => void;
  /** Bid-level AdjustLabor % (what every section inherits unless it overrides). */
  bidAdjustLaborPct: number;
  crewRate: number;
  /** Engine readouts: per-section Man Hours (1:1 with sections) and the bottom-bar totals. */
  totals: {
    sectionHours: number[];
    setupHours: number;
    inspectionHours: number;
    roofSqFt: number;
    membraneSqFt: number;
  } | null;
  newSection: () => BidSectionInput;
  onGoUnderlayment: (sectionId: string) => void;
  onGoTearOff: () => void;
}

export function SectionsScreen(p: SectionsScreenProps) {
  const { sections, onChange, admin } = p;
  const i = Math.min(p.selected, sections.length - 1);
  const s = sections[i];
  const [tab, setTab] = useState("A");
  const [showSummary, setShowSummary] = useState(false);
  const [showEnh, setShowEnh] = useState(false);
  const [showLabor, setShowLabor] = useState(false);
  const [calc, setCalc] = useState({ height: 0, lesser: 0 });

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

  const upd = (patch: Partial<BidSectionInput>) =>
    onChange(sections.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // Legacy pull-test autofill (§1): with a pull test entered, re-derive the field/perim/corner
  // o.c. from MechFastenerLookup whenever a lookup key changes. Manual OC edits still stick.
  const updWithSpacing = (patch: Partial<BidSectionInput>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    const sys = resolveSectionSystem(p.bidDefaults, next);
    const rsId = LEGACY_ROOF_SYSTEM_IDS[sys.roofSystem];
    if (
      !p.fastenerLookup?.length ||
      !rsId ||
      sys.attachment !== "mechanical" ||
      !next.pullTest ||
      next.pullTest <= 0
    ) {
      upd(patch);
      return;
    }
    const base = {
      roofSystemId: rsId,
      thickness: next.thickness,
      designTable: next.designTable ?? 60,
      tabSpacings: [next.fieldLap],
      pullTest: next.pullTest,
    };
    const field = universalFastenerSpacing(p.fastenerLookup, { ...base, columnOffset: 0 });
    const perim = universalFastenerSpacing(p.fastenerLookup, { ...base, columnOffset: 1 });
    const corner = universalFastenerSpacing(p.fastenerLookup, { ...base, columnOffset: 2 });
    upd({
      ...patch,
      ...(field.ok ? { fastenerOc: field.inches } : {}),
      ...(perim.ok ? { perimFastenerOc: perim.inches } : {}),
      ...(corner.ok ? { cornerFastenerOc: corner.inches } : {}),
    });
  };

  if (!s) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">No roof sections.</p>
        <Button
          size="sm"
          onClick={() => {
            onChange([...sections, p.newSection()]);
            p.onSelect(sections.length);
          }}
        >
          + New Section
        </Button>
      </div>
    );
  }

  const sys = resolveSectionSystem(p.bidDefaults, s);
  const laborTable = admin.labor[sys.comboKey];
  const sheetLabels = Object.keys(laborTable?.sheetSizeMultiByLabel ?? {});
  const sheetLabel = resolveSectionSheetLabel(s, sheetLabels);
  const sheetMulti = laborTable?.sheetSizeMultiByLabel[sheetLabel] ?? 1;
  const hasComplexity = roofSystemHasComplexity(sys.roofSystem);
  // Legacy UpdatePreview: the Complexity combo is enabled (and the sheet combo disabled) only
  // while the sheet multiplier is exactly 1.0; otherwise the sheet size is what varies labor.
  const complexityEnabled = hasComplexity && sheetMulti === 1;
  const complexityFactor = sectionComplexityFactor(sys.rsId, s.complexity, sheetMulti);
  const isQuickBid = s.isQuickBid !== false;
  const edges = s.edges?.length ? s.edges : defaultEdges(s.length, s.width);
  const bySide = (side: string) => edges.find((e) => e.side === side);
  const sideLength = (side: string) => (side === "A" || side === "C" ? s.length : s.width);
  const corners: PerimCorners = s.perimCorners ?? [false, false, false, false];
  const cornerAvail = availableCorners(edges);
  const zones = resolveSectionZones({ ...s, edges });
  const area = s.length * s.width;
  const adjust = s.adjustLaborPct ?? p.bidAdjustLaborPct;
  const hours = p.totals?.sectionHours[i] ?? 0;
  const tabOptions = TAB_OPTIONS_BY_SYSTEM[sys.roofSystem];

  const setEdges = (next: EdgeInput[], extra: Partial<BidSectionInput> = {}) =>
    upd({ edges: next, ...extra });
  const setEdge = (side: string, patch: Partial<EdgeInput>, extra: Partial<BidSectionInput> = {}) =>
    setEdges(
      edges.map((e) => (e.side === side ? { ...e, ...patch } : e)),
      extra,
    );

  /** Length / Width edits re-run the legacy side lengths (A/C = Length, B/D = Width). */
  const setDims = (patch: { length?: number; width?: number }) => {
    const length = patch.length ?? s.length;
    const width = patch.width ?? s.width;
    const next = edges.map((e) => {
      const oldLen = e.lengthFt;
      const newLen = e.side === "A" || e.side === "C" ? length : width;
      if (oldLen === newLen) return e;
      const ne: EdgeInput = { ...e, lengthFt: newLen };
      // Runs that were still "the whole side" follow the new side length.
      if (e.perimLengthFt !== undefined && e.perimLengthFt === oldLen) ne.perimLengthFt = newLen;
      if (e.termLengthFt !== undefined && e.termLengthFt === oldLen) ne.termLengthFt = newLen;
      if (e.arpLengthFt !== undefined && e.arpLengthFt === oldLen) ne.arpLengthFt = newLen;
      if (e.blockingFt > 0 && e.blockingFt === Math.round(oldLen))
        ne.blockingFt = Math.round(newLen);
      return ne;
    });
    setEdges(next, { length, width });
  };

  /** Legacy cbSideXIsPerim_CheckedChanged: perimeter run = side length; corners auto-mark. */
  const setPerimeter = (side: string, checked: boolean) => {
    const idx = EDGE_SIDES.indexOf(side as (typeof EDGE_SIDES)[number]);
    const nextEdges = edges.map((e) =>
      e.side === side
        ? checked
          ? { ...e, isPerimeter: true, perimLengthFt: e.lengthFt }
          : { ...e, isPerimeter: false, perimLengthFt: 0, hasTallWall: false }
        : e,
    );
    const nc: PerimCorners = [...corners];
    if (idx >= 0) {
      const perim = (j: number) => nextEdges.find((e) => e.side === EDGE_SIDES[j])?.isPerimeter;
      const cA = idx; // corner between this side and the next
      const cB = (idx + 3) % 4; // corner between the previous side and this one
      if (checked) {
        if (perim((idx + 1) % 4)) nc[cA] = true;
        if (perim((idx + 3) % 4)) nc[cB] = true;
      } else {
        nc[cA] = false;
        nc[cB] = false;
      }
    }
    setEdges(nextEdges, { perimCorners: nc });
  };

  const setCorner = (c: number, v: boolean) => {
    const nc: PerimCorners = [...corners];
    nc[c] = v;
    upd({ perimCorners: nc });
  };

  const setQuickBid = (quick: boolean) => {
    if (quick) {
      upd({ isQuickBid: true });
      return;
    }
    // Legacy optQuick_CheckedChanged: the perimeter edge options are cleared and hidden.
    const nextEdges = edges.map((e) => ({
      ...e,
      isPerimeter: false,
      perimLengthFt: 0,
      hasTallWall: false,
    }));
    setEdges(nextEdges, { isQuickBid: false, perimCorners: [false, false, false, false] });
  };

  // ── Legacy VerifyFields (non-blocking hints; the legacy form refuses to save on any) ──
  const problems: string[] = [];
  if (!(s.width > 0)) problems.push("Width");
  if (!(s.length > 0)) problems.push("Length");
  if (!sheetLabel) problems.push("Sheet Size");
  if (!s.deckType) problems.push("Deck Type");
  if (!laborTable) problems.push("Undefined Attachment Method");
  const perimCount = (a: string, b: string) =>
    (bySide(a)?.isPerimeter ? 1 : 0) + (bySide(b)?.isPerimeter ? 1 : 0);
  if (
    sys.rsId === 1 &&
    (s.width < perimCount("A", "C") * s.enhancementWidthFt ||
      s.length < perimCount("B", "D") * s.enhancementWidthFt)
  ) {
    problems.push(
      "Perim Enhancement is greater than Roof Dimension — increase the size of the Roof Section, or decrease the Enhancement Width",
    );
  }
  if (tabOptions && !tabOptions.includes(s.fieldLap))
    problems.push("Lap Spacing — select a Tab Spacing");
  if (
    sys.rsId === 1 &&
    sys.attachment === "mechanical" &&
    (s.pullTest ?? 0) > 0 &&
    s.pullTest! < 140
  ) {
    problems.push("Pull Test is < 140 — Custom Enhancement may be necessary for this Roof Section");
  }
  if (sheetLabel && sheetSizeSqFt(sheetLabel) > area && sheetLabels.length > 1) {
    problems.push(
      "The average sheet size you have selected is larger than the roof section you have specified",
    );
  }
  const anyPerim = edges.some((e) => e.isPerimeter);
  if (anyPerim) {
    if (!(s.enhancementWidthFt > 0)) problems.push("Perimeter Enhancement Width is less than 0");
    else if (sys.rsId === 3) {
      if (s.enhancementWidthFt < 5) problems.push("Perimeter Enhancement Width < 5");
    } else if (sys.rsId !== 2 && s.enhancementWidthFt < 12) {
      problems.push("Perimeter Enhancement Width < 12");
    }
  }
  for (const e of edges) {
    const len = e.lengthFt;
    if (e.arpSizeIn > 0) {
      const a = edgeArpLength(e);
      if (!(a > 0)) problems.push(`ARP Side ${e.side} Length`);
      else if (a > len) problems.push(`ARP Side ${e.side} Length > Than Side Length`);
    }
    if (e.blockingFt < 0) problems.push(`Wood Side ${e.side} Length`);
    if (e.termination && e.termination !== "No Termination" && !(edgeTermLength(e) > 0))
      problems.push(`Termination Side ${e.side} Length`);
    if (e.isPerimeter) {
      const pl = edgePerimLength(e);
      if (!(pl > 0) || pl > len) problems.push(`Perimeter Side ${e.side} Length`);
    }
  }
  if (!isQuickBid && area > 3000) {
    problems.push(
      "Durolast does not manufacture sheets with a square footage greater than 3,000 s.f.",
    );
  }
  const sheetSf = sheetLabel ? sheetSizeSqFt(sheetLabel) : 0;
  const bigSheetNote =
    sheetSf >= 2500 && sheetSf <= 3000
      ? `Any sheets ordered between 2500 and 3000 square feet have length and width limitations. Please verify that this sheet does not exceed ${sheetLabel} and that Duro-Last will manufacture it in the dimensions you have entered.`
      : null;

  // Calculated spacing label (legacy lblCalcedSpacing).
  let calcedSpacing: string | null = null;
  if ((s.pullTest ?? 0) > 0 && sys.attachment === "mechanical" && p.fastenerLookup?.length) {
    const rsId = LEGACY_ROOF_SYSTEM_IDS[sys.roofSystem];
    if (rsId) {
      const res = universalFastenerSpacing(p.fastenerLookup, {
        roofSystemId: rsId,
        thickness: s.thickness,
        designTable: s.designTable ?? 60,
        tabSpacings: [s.fieldLap],
        pullTest: s.pullTest!,
        columnOffset: 0,
      });
      calcedSpacing = res.ok
        ? `${res.inches}" oc`
        : `No Fastener Spacing available for this Pull Test (${SPACING_ERROR_TEXT[res.error]})`;
    }
  }

  const sideRow = (side: string) => {
    const e = bySide(side);
    if (!e) return null;
    const len = e.lengthFt;
    const idx = EDGE_SIDES.indexOf(side as (typeof EDGE_SIDES)[number]);
    const hasTerm = e.termination !== "" && e.termination !== "No Termination";
    return (
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-medium">
            Side {side}: {n2(len)}′
          </span>
          {isQuickBid && (
            <>
              <Check
                id={`perim-${s.id}-${side}`}
                checked={e.isPerimeter}
                onChange={(v) => setPerimeter(side, v)}
                label="Is Perimeter Edge"
              />
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Perim length</span>
                <Num
                  className="w-[84px]"
                  step="0.01"
                  disabled={!e.isPerimeter}
                  invalid={e.isPerimeter && !(edgePerimLength(e) > 0 && edgePerimLength(e) <= len)}
                  value={e.isPerimeter ? edgePerimLength(e) : 0}
                  onChange={(v) => setEdge(side, { perimLengthFt: Math.round(v * 100) / 100 })}
                />
              </div>
              <Check
                id={`tall-${s.id}-${side}`}
                checked={e.hasTallWall ?? false}
                disabled={!e.isPerimeter}
                onChange={(v) => setEdge(side, { hasTallWall: v })}
                label="w/ Wall > 2ft"
              />
            </>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Termination">
            <Pick
              value={e.termination || "No Termination"}
              options={TERMINATION_OPTIONS}
              onChange={(v) => setEdge(side, { termination: v })}
            />
          </Field>
          <Field label="Length">
            <Num
              className="w-[84px]"
              step="0.01"
              disabled={!hasTerm}
              invalid={hasTerm && !(edgeTermLength(e) > 0)}
              value={hasTerm ? edgeTermLength(e) : 0}
              onChange={(v) => setEdge(side, { termLengthFt: v })}
            />
          </Field>
          <Field label="ARP">
            <Pick
              value={e.arpSizeIn === 0 ? "None" : `${e.arpSizeIn}"`}
              options={ARP_SIZE_OPTIONS.map((a) => (a === 0 ? "None" : `${a}"`))}
              onChange={(v) =>
                setEdge(side, { arpSizeIn: v === "None" ? 0 : Number(v.slice(0, -1)) })
              }
            />
          </Field>
          <Field label="Length">
            <Num
              className="w-[84px]"
              step="0.01"
              disabled={e.arpSizeIn === 0}
              invalid={e.arpSizeIn > 0 && !(edgeArpLength(e) > 0 && edgeArpLength(e) <= len)}
              value={e.arpSizeIn > 0 ? edgeArpLength(e) : 0}
              onChange={(v) => setEdge(side, { arpLengthFt: v })}
            />
          </Field>
          <Check
            id={`wood-${s.id}-${side}`}
            checked={e.blockingFt > 0}
            onChange={(v) => setEdge(side, { blockingFt: v ? Math.round(len) : 0 })}
            label="Use Wood Blocking"
            className="pb-2"
          />
          <Field label="Length">
            <Num
              className="w-[84px]"
              step="1"
              disabled={!(e.blockingFt > 0)}
              value={e.blockingFt}
              onChange={(v) => setEdge(side, { blockingFt: v })}
            />
          </Field>
        </div>
        {idx >= 0 && !isQuickBid && (
          <p className="text-[11px] text-muted-foreground">
            Perimeter edge options are unavailable when entering D/L roof sheets.
          </p>
        )}
      </div>
    );
  };

  /** Legacy UpdatePreview side caption: "A: 100', 2" Drip Edge, 100 Blocking, ARP: 12"". */
  const sideCaption = (side: string) => {
    const e = bySide(side);
    if (!e) return `${side}: ${n2(sideLength(side))}′`;
    const parts = [`${side}: ${n2(e.lengthFt)}′`];
    if (e.termination && e.termination !== "No Termination") parts.push(e.termination);
    if (e.blockingFt > 0) parts.push(`${n2(e.blockingFt)} Blocking`);
    if (e.arpSizeIn > 0) parts.push(`ARP: ${e.arpSizeIn}"`);
    return parts.join(", ");
  };
  const perimCaption = (side: string) => {
    const e = bySide(side);
    return e?.isPerimeter ? `${n2(edgePerimLength(e))}′ Perim` : null;
  };
  const cornerBox = (c: number, cls: string) =>
    cornerAvail[c] ? (
      <input
        type="checkbox"
        title={`Corner ${c + 1} (${EDGE_SIDES[c]}/${EDGE_SIDES[(c + 1) % 4]})`}
        className={`absolute h-3.5 w-3.5 ${cls}`}
        checked={corners[c]}
        onChange={(e) => setCorner(c, e.target.checked)}
      />
    ) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {sections.length} roof {sections.length === 1 ? "section" : "sections"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSummary(true)}>
            Summary
          </Button>
          <SectionCalcDialog
            section={s}
            admin={admin}
            roofSystem={sys.roofSystem}
            attachment={sys.attachment}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const copy: BidSectionInput = JSON.parse(JSON.stringify(s));
              copy.id = `s${Date.now().toString(36)}`;
              copy.name = `${s.name} (copy)`;
              onChange([...sections, copy]);
              p.onSelect(sections.length);
            }}
          >
            Copy
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={sections.length === 1}
            onClick={() => {
              onChange(sections.filter((_, j) => j !== i));
              p.onSelect(Math.max(0, Math.min(i, sections.length - 2)));
            }}
          >
            Remove
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onChange([...sections, p.newSection()]);
              p.onSelect(sections.length);
            }}
          >
            + New Section
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ── Left: the legacy entry form ── */}
        <div className="min-w-0 space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Custom Name">
              <Input
                className="h-8 w-[200px] font-medium"
                value={s.name}
                onChange={(e) => upd({ name: e.target.value })}
              />
            </Field>
            <Field label="Length (ft)">
              <Num
                className="w-[96px]"
                step="0.01"
                invalid={!(s.length > 0)}
                value={s.length}
                onChange={(v) => setDims({ length: v })}
              />
            </Field>
            <Field label="Width (ft)">
              <Num
                className="w-[96px]"
                step="0.01"
                invalid={!(s.width > 0)}
                value={s.width}
                onChange={(v) => setDims({ width: v })}
              />
            </Field>
            <Field label="Deck Type">
              <Pick
                className="w-[150px]"
                value={s.deckType}
                options={admin.deckOrder}
                onChange={(v) => upd({ deckType: v })}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Roof System">
              <Pick
                className="w-[170px]"
                value={sys.roofSystem}
                options={
                  systemOptions.includes(sys.roofSystem)
                    ? systemOptions
                    : [sys.roofSystem, ...systemOptions]
                }
                onChange={(v) => {
                  const atts = attachmentsFor(v);
                  const att = atts.includes(sys.attachment) ? sys.attachment : atts[0]!;
                  const patch: Partial<BidSectionInput> = { roofSystem: v, attachment: att };
                  const tabs = TAB_OPTIONS_BY_SYSTEM[v];
                  if (tabs && !tabs.includes(s.fieldLap)) patch.fieldLap = tabs[1] ?? tabs[0]!;
                  updWithSpacing(patch);
                }}
              />
            </Field>
            <Field label="Attached With">
              <Pick
                className="w-[190px]"
                value={ATTACHMENT_LABEL[sys.attachment]}
                options={attachmentsFor(sys.roofSystem).map((a) => ATTACHMENT_LABEL[a])}
                onChange={(v) => {
                  const att = (Object.keys(ATTACHMENT_LABEL) as Attachment[]).find(
                    (k) => ATTACHMENT_LABEL[k] === v,
                  );
                  if (att) updWithSpacing({ roofSystem: sys.roofSystem, attachment: att });
                }}
              />
            </Field>
            {sys.attachment === "adhered" && (
              <Field label="Attached To (adhesive)">
                <Pick
                  className="w-[190px]"
                  value={sys.adhesiveName}
                  options={["Water Based Adhesive", "Solvent Based Adhesive"]}
                  onChange={(v) => upd({ membraneAdhesiveName: v })}
                />
              </Field>
            )}
            <Field label="Type (mil)">
              <Pick
                className="w-[90px]"
                value={String(s.thickness)}
                options={["40", "50", "60"]}
                onChange={(v) => updWithSpacing({ thickness: Number(v) })}
              />
            </Field>
            <Field label="Color">
              <Pick
                className="w-[120px]"
                value={s.color}
                options={
                  p.colorOptions.includes(s.color) ? p.colorOptions : [s.color, ...p.colorOptions]
                }
                onChange={(v) => upd({ color: v })}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Pull Test (lbs)">
              <Num
                className="w-[100px]"
                value={s.pullTest ?? 0}
                invalid={sys.rsId === 1 && (s.pullTest ?? 0) > 0 && s.pullTest! < 140}
                onChange={(v) => updWithSpacing({ pullTest: v })}
              />
            </Field>
            <Field label="Design Table (psf)">
              <Pick
                className="w-[100px]"
                value={String(s.designTable ?? 60)}
                options={DESIGN_TABLE_OPTIONS.map(String)}
                onChange={(v) => updWithSpacing({ designTable: Number(v) })}
              />
            </Field>
            <Field label={tabOptions ? "Field Tab Spacing (in)" : "Field Roll Width (in)"}>
              {tabOptions ? (
                <Pick
                  className="w-[100px]"
                  value={String(s.fieldLap)}
                  options={[
                    ...(tabOptions.includes(s.fieldLap) ? [] : [String(s.fieldLap)]),
                    ...tabOptions.map(String),
                  ]}
                  onChange={(v) => updWithSpacing({ fieldLap: Number(v) })}
                />
              ) : (
                <Num
                  className="w-[100px]"
                  value={s.fieldLap}
                  onChange={(v) => updWithSpacing({ fieldLap: v })}
                />
              )}
            </Field>
            <Field label="Fastener OC (in)">
              <Num
                className="w-[100px]"
                value={s.fastenerOc}
                onChange={(v) => upd({ fastenerOc: v })}
              />
            </Field>
            {calcedSpacing && (
              <p
                className={`pb-2 text-xs ${calcedSpacing.startsWith("No ") ? "text-destructive" : "text-muted-foreground"}`}
              >
                Calc&apos;d spacing: {calcedSpacing}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Avg. Sheet Size">
              <Pick
                className="w-[130px]"
                value={sheetLabel || "—"}
                options={sheetLabels.length ? sheetLabels : [sheetLabel || "—"]}
                disabled={complexityEnabled || !isQuickBid}
                onChange={(v) => upd({ sheetSizeLabel: v })}
              />
            </Field>
            <Field label="Complexity">
              <Pick
                className="w-[130px]"
                value={hasComplexity ? COMPLEXITY_LABELS[s.complexity ?? 2]! : "None"}
                options={hasComplexity ? COMPLEXITY_LABELS : ["None"]}
                disabled={!complexityEnabled}
                onChange={(v) => {
                  const id = COMPLEXITY_LABELS.indexOf(v as (typeof COMPLEXITY_LABELS)[number]);
                  if (id >= 0) upd({ complexity: id });
                }}
              />
            </Field>
            {hasComplexity && (
              <p className="pb-2 text-xs text-muted-foreground">factor ×{complexityFactor}</p>
            )}
            <Check
              id={`std-${s.id}`}
              checked={p.stdSizeDiscount}
              onChange={p.onStdSizeDiscount}
              label="Standard Size Sheet Discount"
              className="pb-2"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`qb-${s.id}`}
                checked={isQuickBid}
                onChange={() => setQuickBid(true)}
              />
              Quick Bid
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`qb-${s.id}`}
                checked={!isQuickBid}
                onChange={() => setQuickBid(false)}
              />
              Enter D/L Roof Sheets
            </label>
          </div>
          {!isQuickBid && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              When entering individual D/L roof sheets no automatic calculation is performed for
              necessary waste or overlap. You will have to figure these factors into your Duro-Last
              sheet sizes. The average sheet size is derived from the section area ({sheetLabel}).
            </p>
          )}
          {bigSheetNote && <p className="text-xs text-muted-foreground">{bigSheetNote}</p>}

          {/* Legacy link labels: Perimeter & Enhancement / Labor / Setup / Inspection */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs">
            <button
              type="button"
              className="font-medium text-primary underline"
              onClick={() => setShowEnh(true)}
            >
              Perimeter &amp; Enhancement: {s.enhancementWidthFt}′ ({zones.perimLengthFt}′ perim,{" "}
              {zones.cornerLengthFt}′ corner)
            </button>
            <button
              type="button"
              className="font-medium text-primary underline"
              onClick={() => setShowLabor(true)}
            >
              Labor: {n2(hours)} hours ({adjust >= 0 ? "+" : ""}
              {adjust}%{s.adjustLaborPct !== undefined ? ", section override" : ""})
            </button>
            <span>Setup: {n2(p.totals?.setupHours ?? 0)} h</span>
            <span>Inspection: {n2(p.totals?.inspectionHours ?? 0)} h</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>
              Man Hours: <b className="tabular-nums">{n2(hours)}</b>
            </span>
            <span>
              Labor Cost: <b className="tabular-nums">{usd(hours * p.crewRate)}</b>
            </span>
            <span>
              Roof Sq Ft: <b className="tabular-nums">{n0(area)}</b>
            </span>
            <span className="text-muted-foreground">
              Underlayment:{" "}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => p.onGoUnderlayment(s.id)}
              >
                {sectionLayers(s).length} layer{sectionLayers(s).length === 1 ? "" : "s"}
              </button>
              {" · "}Tear-off:{" "}
              <button type="button" className="text-primary underline" onClick={p.onGoTearOff}>
                {s.tearOff ? s.tearOffType || "on" : "off"}
              </button>
            </span>
          </div>
          <Field label="Notes">
            <Input
              className="h-8"
              value={s.notes ?? ""}
              placeholder="Optional notes for this section…"
              onChange={(e) => upd({ notes: e.target.value })}
            />
          </Field>
          {problems.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <p className="font-medium">The following field(s) have invalid values:</p>
              <ul className="list-disc pl-4">
                {problems.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Right: Edge Options + preview + summary list ── */}
        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-semibold">Edge Options</p>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-8">
                {EDGE_SIDES.map((side) => (
                  <TabsTrigger key={side} value={side} className="h-7 px-3 text-xs">
                    Side {side}
                  </TabsTrigger>
                ))}
              </TabsList>
              {EDGE_SIDES.map((side) => (
                <TabsContent key={side} value={side} className="mt-2">
                  {sideRow(side)}
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Legacy pnlView preview: rectangle, side captions, "n' Perim" labels, corner boxes */}
          <div className="rounded-md border p-3">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-1 text-[11px]">
              <p className="text-center">{sideCaption("A")}</p>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                <p className="max-w-[90px] text-right">{sideCaption("D")}</p>
                <div className="relative mx-auto h-36 w-full max-w-[220px] border-2 border-foreground/60 bg-muted/30">
                  {cornerBox(3, "left-0.5 top-0.5")}
                  {cornerBox(0, "right-0.5 top-0.5")}
                  {cornerBox(1, "bottom-0.5 right-0.5")}
                  {cornerBox(2, "bottom-0.5 left-0.5")}
                  {perimCaption("A") && (
                    <span className="absolute inset-x-0 top-1 text-center text-[10px] text-primary">
                      {perimCaption("A")}
                    </span>
                  )}
                  {perimCaption("C") && (
                    <span className="absolute inset-x-0 bottom-1 text-center text-[10px] text-primary">
                      {perimCaption("C")}
                    </span>
                  )}
                  {perimCaption("D") && (
                    <span
                      className="absolute inset-y-0 left-1 flex items-center text-[10px] text-primary"
                      style={{ writingMode: "vertical-rl" }}
                    >
                      {perimCaption("D")}
                    </span>
                  )}
                  {perimCaption("B") && (
                    <span
                      className="absolute inset-y-0 right-1 flex items-center text-[10px] text-primary"
                      style={{ writingMode: "vertical-rl" }}
                    >
                      {perimCaption("B")}
                    </span>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                    {laborTable ? `${n0(area)} sf (fill)` : "No Membrane"}
                  </span>
                </div>
                <p className="max-w-[90px]">{sideCaption("B")}</p>
              </div>
              <p className="text-center">{sideCaption("C")}</p>
              {cornerAvail.some(Boolean) && (
                <p className="text-center text-[10px] text-muted-foreground">
                  Tick a corner box to enhance that corner (both adjacent sides are perimeter
                  edges).
                </p>
              )}
            </div>
          </div>

          {/* lvSummary: Section | L | W | System | Attach | Deck Type | Color | Lap */}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-right">L</TableHead>
                  <TableHead className="text-right">W</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead>Attach</TableHead>
                  <TableHead>Deck Type</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead className="text-right">Lap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.map((s2, i2) => {
                  const sys2 = resolveSectionSystem(p.bidDefaults, s2);
                  return (
                    <TableRow
                      key={s2.id}
                      onClick={() => p.onSelect(i2)}
                      className={i2 === i ? "cursor-pointer bg-muted/60" : "cursor-pointer"}
                    >
                      <TableCell className="whitespace-nowrap font-medium">{s2.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{s2.length}</TableCell>
                      <TableCell className="text-right tabular-nums">{s2.width}</TableCell>
                      <TableCell className="whitespace-nowrap">{sys2.roofSystem}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {sys2.attachment === "adhered" ? "Adhered" : "Mechanical"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{s2.deckType}</TableCell>
                      <TableCell>{s2.color}</TableCell>
                      <TableCell className="text-right tabular-nums">{s2.fieldLap}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Legacy bottom bar: Setup / Inspection / Roof SqFt / Membrane SqFt */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs">
        <span>
          Setup time: <b className="tabular-nums">{n2(p.totals?.setupHours ?? 0)} h</b>
        </span>
        <span>
          Inspection time: <b className="tabular-nums">{n2(p.totals?.inspectionHours ?? 0)} h</b>
        </span>
        <span>
          Roof sq ft: <b className="tabular-nums">{n0(p.totals?.roofSqFt ?? 0)}</b>
        </span>
        <span>
          Membrane sq ft: <b className="tabular-nums">{n0(p.totals?.membraneSqFt ?? 0)}</b>
        </span>
      </div>

      {/* Perimeter & Enhancement (frmRoofSectionAdv: width + calculator + custom zone OC / laps) */}
      <Dialog open={showEnh} onOpenChange={setShowEnh}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Perimeter &amp; Enhancement — {s.name}</DialogTitle>
            <DialogDescription>
              Perimeter enhancement width and the custom perimeter / corner fastening.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Perim Enhancement Width (ft)">
                <Num
                  className="w-[110px]"
                  value={s.enhancementWidthFt}
                  onChange={(v) => upd({ enhancementWidthFt: v })}
                />
              </Field>
              <Field label="Perim OC (in)">
                <Num
                  className="w-[90px]"
                  value={s.perimFastenerOc}
                  onChange={(v) => upd({ perimFastenerOc: v })}
                />
              </Field>
              <Field label="Corner OC (in)">
                <Num
                  className="w-[90px]"
                  value={s.cornerFastenerOc}
                  onChange={(v) => upd({ cornerFastenerOc: v })}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Perim lap (in)">
                <Pick
                  className="w-[100px]"
                  value={s.perimLap !== undefined && s.perimLap !== -1 ? String(s.perimLap) : "—"}
                  options={["—", ...(tabOptions ?? []).map(String)]}
                  onChange={(v) => upd({ perimLap: v === "—" ? -1 : Number(v) })}
                />
              </Field>
              <Field label="Corner lap (in)">
                <Pick
                  className="w-[100px]"
                  value={
                    s.cornerLap !== undefined && s.cornerLap !== -1 ? String(s.cornerLap) : "—"
                  }
                  options={["—", ...(tabOptions ?? []).map(String)]}
                  onChange={(v) => upd({ cornerLap: v === "—" ? -1 : Number(v) })}
                />
              </Field>
              {!s.edges?.length && (
                <>
                  <Field label="Perim len (ft, manual)">
                    <Num
                      className="w-[100px]"
                      value={s.perimLengthFt}
                      onChange={(v) => upd({ perimLengthFt: v })}
                    />
                  </Field>
                  <Field label="Corner len (ft, manual)">
                    <Num
                      className="w-[100px]"
                      value={s.cornerLengthFt}
                      onChange={(v) => upd({ cornerLengthFt: v })}
                    />
                  </Field>
                </>
              )}
            </div>
            <p className="text-muted-foreground">
              Zone laps price the perimeter / corner membrane share at that tab tier on non-roll
              sheets (legacy default “—” leaves the share unpriced).
            </p>
            <div className="rounded-md border p-2">
              <p className="mb-1 font-medium">Perimeter width calculator</p>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Building height (ft)">
                  <Num
                    className="w-[100px]"
                    value={calc.height}
                    onChange={(v) => setCalc((c) => ({ ...c, height: v }))}
                  />
                </Field>
                <Field label="Lesser roof dimension (ft)">
                  <Num
                    className="w-[100px]"
                    value={calc.lesser}
                    onChange={(v) => setCalc((c) => ({ ...c, lesser: v }))}
                  />
                </Field>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    upd({
                      enhancementWidthFt: perimeterEnhancementCalculator(calc.height, calc.lesser),
                    })
                  }
                >
                  Calculate → {perimeterEnhancementCalculator(calc.height, calc.lesser)}′
                </Button>
              </div>
              <p className="mt-1 text-muted-foreground">
                Lesser of 40% of the building height and 10% of the lesser roof dimension, rounded
                up, never below 5 ft.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Labor link: per-section AdjustLabor */}
      <Dialog open={showLabor} onOpenChange={setShowLabor}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Roof Section Labor — {s.name}</DialogTitle>
            <DialogDescription>
              Adjust this section&apos;s install labor. The bid-level adjust ({p.bidAdjustLaborPct}
              %) applies unless a section override is set.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <Field label="Adjust labor (%)">
              <Input
                type="number"
                className="h-8 w-[110px]"
                step="1"
                min={-100}
                value={s.adjustLaborPct ?? p.bidAdjustLaborPct}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  upd({ adjustLaborPct: Number.isFinite(v) ? Math.max(-100, v) : 0 });
                }}
              />
            </Field>
            <Button
              size="sm"
              variant="outline"
              disabled={s.adjustLaborPct === undefined}
              onClick={() => {
                const nx = { ...s };
                delete nx.adjustLaborPct;
                onChange(sections.map((x, j) => (j === i ? nx : x)));
              }}
            >
              Use bid default
            </Button>
            <p className="w-full text-muted-foreground">
              Base hours × (1 + adjust / 100). Current: {n2(hours)} h = {usd(hours * p.crewRate)}.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Legacy Roof Sections Summary grid (FrmRoofSectionsSummary.LoadSummary) */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Roof Sections Summary</DialogTitle>
            <DialogDescription>Every section on this bid (legacy summary grid).</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Section",
                    "Length",
                    "Width",
                    "System",
                    "Attachment",
                    "Deck Type",
                    "Color",
                    "Tab/RG Width",
                    "Terminations",
                    "Wood Blocking",
                    "Perim",
                    "ARPs",
                    "Labor (h)",
                    "Corner Area",
                    "Perim Area",
                    "Field Area",
                    "Total Area",
                  ].map((h) => (
                    <TableHead key={h} className="whitespace-nowrap text-xs">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.map((s2, i2) => {
                  const sys2 = resolveSectionSystem(p.bidDefaults, s2);
                  const e2 = s2.edges?.length ? s2.edges : defaultEdges(s2.length, s2.width);
                  const z2 = resolveSectionZones({ ...s2, edges: e2 });
                  const a2 = s2.length * s2.width;
                  const perimA = z2.perimLengthFt * s2.enhancementWidthFt;
                  const cornerA = z2.cornerLengthFt * s2.enhancementWidthFt;
                  const cell = (f: (e: EdgeInput) => string | null) =>
                    e2
                      .map((e) => {
                        const v = f(e);
                        return v ? `${e.side}:${v}` : null;
                      })
                      .filter(Boolean)
                      .join(" ");
                  return (
                    <TableRow key={s2.id} className="text-xs">
                      <TableCell className="whitespace-nowrap font-medium">{s2.name}</TableCell>
                      <TableCell className="text-right">{s2.length}</TableCell>
                      <TableCell className="text-right">{s2.width}</TableCell>
                      <TableCell className="whitespace-nowrap">{sys2.roofSystem}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {ATTACHMENT_LABEL[sys2.attachment]}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{s2.deckType}</TableCell>
                      <TableCell>{s2.color}</TableCell>
                      <TableCell className="text-right">{s2.fieldLap}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {cell((e) =>
                          e.termination && e.termination !== "No Termination"
                            ? `${e.termination} ${n2(edgeTermLength(e))}`
                            : null,
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {cell((e) => (e.blockingFt > 0 ? n2(e.blockingFt) : null))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {cell((e) => (e.isPerimeter ? n2(edgePerimLength(e)) : null))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {cell((e) =>
                          e.arpSizeIn > 0 ? `${e.arpSizeIn}" ${n2(edgeArpLength(e))}` : null,
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {n2(p.totals?.sectionHours[i2] ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">{n0(cornerA)}</TableCell>
                      <TableCell className="text-right">{n0(perimA)}</TableCell>
                      <TableCell className="text-right">
                        {n0(Math.max(0, a2 - perimA - cornerA))}
                      </TableCell>
                      <TableCell className="text-right">{n0(a2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
