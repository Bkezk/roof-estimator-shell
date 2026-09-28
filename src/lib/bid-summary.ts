/**
 * Bid summary (PDF export) — the MODEL half. Turns the estimator's live state plus the engine's
 * computed figures into plain tables of already-formatted strings, one section per estimator
 * step. No React and no pdf-lib here: the renderer (bid-summary-pdf.ts) only lays the tables
 * out, so everything a reader sees is decided (and tested) in this file.
 *
 * Nothing is re-priced: every dollar and hour comes from the engine result the page already
 * computed (the same figures the Bid-total panel and the Review ledger show). The only local
 * arithmetic is display geometry the screens themselves derive (areas, girths, wall sq ft).
 */

import type {
  AccessoryLine,
  BidSectionInput,
  CurbInput,
  NonDlLine as NonDlCatalogLine,
  ParapetInput,
  UnderlaymentLayer,
} from "@/lib/engine/bid-builder";
import {
  COMPLEXITY_LABELS,
  effectiveLayerAttachment,
  resolveParapetSystem,
  resolveSectionSheetLabel,
  resolveSectionSystem,
  roofSystemHasComplexity,
  sectionLayers,
} from "@/lib/engine/bid-builder";
import type { AccessoryReviewLine } from "@/lib/engine/accessories";
import { TERMINATION_ID_BY_LABEL } from "@/lib/engine/accessories";
import type { EngineAdminData } from "@/lib/engine/adapters";
import {
  defaultEdges,
  edgeArpLength,
  edgePerimLength,
  edgeTermLength,
  resolveSectionZones,
  TERMINATION_OPTIONS,
  type EdgeInput,
} from "@/lib/engine/edges";
import type { EstimateResult } from "@/lib/engine/estimate";
import type { MetalsResult } from "@/lib/engine/metals";
import type { MoneyResult } from "@/lib/engine/money";
import { NON_DL_CATEGORY_LABEL, NON_DL_GROUPS, type NonDlResult } from "@/lib/engine/nondl";
import type { LedgerRow, ReviewLedger } from "@/lib/engine/review-ledger";
import {
  checkedPerDiemItems,
  normalizePerDiemChart,
  perDiemChartTitle,
  perDiemChartTotal,
} from "@/lib/per-diem-chart";
import { cityStZip, type SavedBidState } from "@/lib/proposal-bid";
import { buildReviewRows, type ReviewData } from "@/lib/review-export";

// ─────────────────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────────────────

export interface SummaryColumn {
  label: string;
  /** Numbers are right-aligned so their decimals line up. */
  align?: "right";
}

export interface SummaryTable {
  title?: string;
  columns: SummaryColumn[];
  rows: string[][];
  /** Row indexes drawn as totals (bold, rule above). */
  totalRows?: number[];
}

export interface SummaryStep {
  key: string;
  label: string;
  tables: SummaryTable[];
  notes?: string[];
}

export interface BidSummary {
  /** Document title (PDF metadata + cover). */
  title: string;
  /** Page-header / footer fields. */
  bidName: string;
  customer: string;
  grandTotal: string;
  exportedAt: string;
  /** Cover-page facts, in order. */
  meta: Array<{ label: string; value: string }>;
  steps: SummaryStep[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────────

/** The engine figures the summary prints (a Pick, so tests can hand-make them). */
export type SummaryEstimate = Pick<
  EstimateResult,
  | "setupHours"
  | "inspectionHours"
  | "tearOffLaborHours"
  | "disposalUnits"
  | "underlaymentLaborHours"
  | "parapetLaborHours"
  | "curbLaborHours"
  | "laborSubtotal1"
  | "roofSqFootage"
  | "sqFtTotalMembrane"
> & {
  money: Pick<
    MoneyResult,
    | "dTotals"
    | "grandTotal"
    | "subtotal1"
    | "markupValue"
    | "subtotal2"
    | "commissionValue"
    | "perDiemValue"
    | "totalManDays"
    | "taxCharged"
  >;
};

/** Everything the page has already computed (the `result` memo and its neighbours). */
export interface BidSummaryComputed {
  est: SummaryEstimate;
  ledger: ReviewLedger;
  /** The same ReviewData the CSV export builds. */
  review: ReviewData;
  /** Per-section install man-hours, 1:1 with state.sections. */
  sectionHours: number[];
  /** Per-section underlayment hours (engine inputs.underlaymentHoursBySection). */
  underlaymentHoursBySection?: Record<string, { adjusted: number; quote: number }>;
  /** Per-section tear-off hours (the page's Tear-Off readout, by section id). */
  tearOffHoursBySection?: Record<string, { base: number; adjusted: number }>;
  parapetHoursById: Record<string, number>;
  curbHoursById: Record<string, number>;
  parapetMaterial: number;
  curbMaterial: number;
  /** Parapets screen "Fasteners Needed" (net of Parapet Wall-Tabs entries). */
  parapetFastenersNeeded?: number;
  /** §12 Accessories results (summary rows + totals). */
  accessories?: { lines: AccessoryReviewLine[]; totalCost: number; manHours: number };
  /** Adhesive rows the Accessories Summary lists alongside (priced outside §12). */
  adhesiveLines?: AccessoryReviewLine[];
  /** The page's flat-line totals (Σ price × qty, Σ labor h/ea × qty). */
  accessoryTotal: number;
  accessoryLaborHours: number;
  metalsScreen?: Pick<MetalsResult, "lines" | "materialCost" | "laborCost" | "laborHours">;
  nonDl?: Pick<
    NonDlResult,
    | "lines"
    | "byGroup"
    | "totalMaterialIncludingServices"
    | "totalHours"
    | "totalLaborCost"
    | "subsCost"
    | "servicesCost"
  >;
  /** The Review ledger's area stats (same object the ledger receives). */
  stats: {
    roofSqFt: number;
    membraneSqFt: number;
    parapetVertSqFt: number;
    parapetWallSqFt: number;
  };
  warnings?: string[];
}

export interface BidSummaryInput {
  bidName: string;
  statusLabel: string;
  /** Live estimator state (unsaved edits included) — the object the page saves. */
  state: SavedBidState;
  /** Values the page resolves against company settings when the bid has no override. */
  effective: { hoursPerDay: number; salesTaxRate: number; taxMaterialOnly: boolean };
  /** Admin engine data; only the labor combos are read (Avg. Sheet Size labels). */
  admin?: Pick<EngineAdminData, "labor"> | null;
  computed: BidSummaryComputed;
  /** Step order + labels; pass the estimator's STEPS so the two cannot drift. */
  steps?: ReadonlyArray<{ key: string; label: string }>;
  exportedAt?: Date;
}

/** The estimator's step ribbon (mirrors STEPS in src/routes/estimate.tsx). */
export const SUMMARY_STEPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "setup", label: "Setup" },
  { key: "sections", label: "Sections" },
  { key: "underlayment", label: "Underlayment" },
  { key: "parapets", label: "Parapets" },
  { key: "curbs", label: "Curbs" },
  { key: "accessories", label: "Accessories" },
  { key: "metals", label: "Metals" },
  { key: "tearoff", label: "Tear-Off" },
  { key: "nondl", label: "Non-DL" },
  { key: "review", label: "Review" },
];

export const EMPTY_STEP_NOTE = "Nothing on this step.";

// ─────────────────────────────────────────────────────────────────────────────
// Formatting (fixed en-US so the PDF reads the same on every machine)
// ─────────────────────────────────────────────────────────────────────────────

const fin = (v: number | undefined | null): v is number => typeof v === "number" && isFinite(v);

/** $1,234.56 — negatives in parentheses, like the Review ledger. */
export function money(v: number | undefined | null): string {
  const n = fin(v) ? v : 0;
  const s =
    "$" +
    Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}
/** Money, blank for 0 / missing (line cells the screens leave empty). */
export const moneyB = (v: number | undefined | null) => (fin(v) && v !== 0 ? money(v) : "");
/** Hours with 2 decimals. */
export const hours = (v: number | undefined | null) =>
  (fin(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const hoursB = (v: number | undefined | null) => (fin(v) && v !== 0 ? hours(v) : "");
/** Plain number with thousands separators, up to `dp` decimals. */
export const num = (v: number | undefined | null, dp = 2) =>
  fin(v) ? v.toLocaleString("en-US", { maximumFractionDigits: dp }) : "";
export const numB = (v: number | undefined | null, dp = 2) => (fin(v) && v !== 0 ? num(v, dp) : "");
const pct = (v: number | undefined | null) => (fin(v) ? `${num(v, 4)}%` : "");
const yesNo = (b: boolean | undefined) => (b ? "Yes" : "No");
const text = (s: string | undefined | null) => (s ?? "").trim();

const attachLabel = (a: "mechanical" | "adhered", adhesive?: string) =>
  a === "mechanical" ? "Mechanical" : `Adhered${adhesive ? ` (${adhesive})` : ""}`;

const UL_ATTACH = {
  mechanical: "Mechanical",
  adhesive: "Adhesive",
  none: "None",
  durobond: "Duro-Bond",
} as const;

const MARKUP_MODE_LABEL = { 0: "% of cost", 1: "$ / man-day", 2: "Gross profit %" } as const;

/** Legacy parapet style from the profile dims (same rule as the Parapets screen). */
function parapetStyle(p: ParapetInput): string {
  const canted = (p.cantInches ?? 0) > 0;
  const upOver = (p.wallTopInches ?? 0) > 0 || (p.dropInches ?? 0) > 0;
  if (canted && upOver) return "Canted Up & Over";
  if (canted) return "Canted Vertical";
  if (upOver) return "Up & Over";
  return "Vertical";
}

const parapetHasDims = (p: ParapetInput) =>
  p.skirtInches !== undefined ||
  p.cantInches !== undefined ||
  p.verticalInches !== undefined ||
  p.wallTopInches !== undefined ||
  p.dropInches !== undefined;

const parapetGirth = (p: ParapetInput) =>
  parapetHasDims(p)
    ? (p.skirtInches ?? 0) +
      (p.cantInches ?? 0) +
      (p.verticalInches ?? 0) +
      (p.wallTopInches ?? 0) +
      (p.dropInches ?? 0)
    : p.girthInches;

/** Parapets screen "Parapet Membrane Sq Ft": Ceil(girth)/12 × (length + 1 + pieces). */
const parapetMembraneSqFt = (p: ParapetInput) => {
  const pieces = p.pieces ?? 1;
  const adjLen = pieces >= 1 ? p.lengthFt + 1 + pieces : 0;
  return (Math.ceil(parapetGirth(p)) / 12) * adjLen;
};

const terminationLabel = (id: number | undefined) =>
  (id ?? 0) > 0
    ? (TERMINATION_OPTIONS.find((t) => TERMINATION_ID_BY_LABEL[t] === id) ?? `#${id}`)
    : "";

/** Curbs screen captions (legacy CurbStyle / TermOption ids). */
const CURB_STYLE: Record<number, string> = {
  1: "Open",
  2: "Closed",
  3: "Open Canted",
  4: "Closed Canted",
  5: "With Top",
  6: "Scupper",
  7: "Metal Scupper",
};
const CURB_TERM: Record<number, string> = {
  0: "None",
  1: 'Scupper/Fascia Bar (1-3/4")',
  2: "Lift & Tuck",
  3: "Lift & T-Bar",
  4: "No Lift & T-Bar",
  5: "No Lift & Counter Flash",
};

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildBidSummary(input: BidSummaryInput): BidSummary {
  const { state: s, computed: c } = input;
  const cu = s.customer;
  const bidName = text(input.bidName) || "Untitled bid";
  const jobCity = text(cu.jobCityStZip) || cityStZip(cu.jobCity, cu.jobState, cu.jobZip);
  const jobSite = [text(cu.projectAddress), text(cu.projectAddress2), jobCity]
    .filter(Boolean)
    .join(", ");
  const exportedAt = (input.exportedAt ?? new Date()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const grandTotal = money(c.est.money.grandTotal);

  const builders: Record<string, () => Omit<SummaryStep, "key" | "label">> = {
    setup: () => setupStep(input),
    sections: () => sectionsStep(input),
    underlayment: () => underlaymentStep(input),
    parapets: () => parapetsStep(input),
    curbs: () => curbsStep(input),
    accessories: () => accessoriesStep(input),
    metals: () => metalsStep(input),
    tearoff: () => tearOffStep(input),
    nondl: () => nonDlStep(input),
    review: () => reviewStep(input),
  };

  const steps = (input.steps ?? SUMMARY_STEPS).map(({ key, label }) => {
    const body = builders[key]?.() ?? { tables: [] };
    const tables = body.tables.filter((t) => t.rows.length > 0);
    const notes = [...(body.notes ?? [])];
    // Every step keeps its page, so the reader sees it was checked rather than skipped.
    if (tables.length === 0) notes.unshift(EMPTY_STEP_NOTE);
    return { key, label, tables, ...(notes.length ? { notes } : {}) };
  });

  const system = `${s.roofSystem} — ${attachLabel(s.attachment, s.attachment === "adhered" ? s.membraneAdhesiveName : undefined)}`;
  const meta: BidSummary["meta"] = [
    { label: "Bid", value: bidName },
    { label: "Customer", value: text(cu.name) },
    { label: "Contact", value: text(cu.contact) },
    { label: "Job site", value: jobSite },
    { label: "Status", value: input.statusLabel },
    { label: "Roof system", value: system },
    { label: "Start date", value: text(s.startDate) },
    { label: "Building type", value: text(s.buildingType) },
    { label: "Bid total", value: grandTotal },
    { label: "Exported", value: exportedAt },
  ].filter((m) => m.value !== "");

  return {
    title: `${bidName} — Bid summary`,
    bidName,
    customer: text(cu.name),
    grandTotal,
    exportedAt,
    meta,
    steps,
  };
}

type StepBody = Omit<SummaryStep, "key" | "label">;

// ── Setup ────────────────────────────────────────────────────────────────────

function setupStep({ state: s, effective, statusLabel }: BidSummaryInput): StepBody {
  const cu = s.customer;
  const clientCity = cityStZip(cu.clientCity, cu.clientState, cu.clientZip);
  const jobCity = text(cu.jobCityStZip) || cityStZip(cu.jobCity, cu.jobState, cu.jobZip);
  const phone = [text(cu.phone), cu.phoneExt ? `x ${text(cu.phoneExt)}` : ""]
    .filter(Boolean)
    .join(" ");
  // Client and job site side by side: landscape has the room.
  const client: Array<[string, string]> = [
    ["Company name", text(cu.name)],
    ["Contact", text(cu.contact)],
    ["Address 1", text(cu.clientAddress)],
    ["Address 2", text(cu.clientAddress2)],
    ["City, St Zip", clientCity],
    ["Phone", phone],
    ["Fax", text(cu.fax)],
    ["E-mail", text(cu.email)],
  ];
  const job: Array<[string, string]> = [
    ["Address 1", text(cu.projectAddress)],
    ["Address 2", text(cu.projectAddress2)],
    ["City, St Zip", jobCity],
    ["Job #", text(cu.jobNumber)],
    ["Ship via", text(cu.shipVia)],
    ["Ship to", text(cu.shipTo)],
    ["Estimator", text(cu.estimatorName)],
    ["Building type", text(s.buildingType)],
  ];
  const contactRows: string[][] = [];
  for (let i = 0; i < Math.max(client.length, job.length); i++) {
    contactRows.push([
      client[i]?.[0] ?? "",
      client[i]?.[1] ?? "",
      job[i]?.[0] ?? "",
      job[i]?.[1] ?? "",
    ]);
  }

  const d = s.sectionDefaults;
  const markupText =
    s.markupMode === 1
      ? `${money(s.markup)} per man-day`
      : `${num(s.markup, 4)}% (${MARKUP_MODE_LABEL[s.markupMode]})`;
  const defaults: Array<[string, string]> = [
    ["Status", statusLabel],
    ["Start date", text(s.startDate)],
    ["Roof system", s.roofSystem],
    [
      "Attached with",
      attachLabel(s.attachment, s.attachment === "adhered" ? s.membraneAdhesiveName : undefined),
    ],
    ["Membrane (mil)", d ? num(d.thickness) : ""],
    ["Color", d?.color ?? ""],
    ["Deck type", d?.deckType ?? ""],
    ["Avg. sheet size", d?.sheetSizeLabel ?? ""],
    ["Design table (psf)", d?.designTable !== undefined ? num(d.designTable) : ""],
    [
      "Underlayment attached with",
      s.underlaymentAttachmentDefault ? UL_ATTACH[s.underlaymentAttachmentDefault] : "",
    ],
    ["Warranty", text(s.warrantyName) || "None"],
    ["Max expected wind", s.maxWindExpected !== undefined ? `${s.maxWindExpected} mph` : ""],
    ["Labor template", text(s.laborTemplateName) || "None"],
    ["Hourly labor rate", `${money(s.laborRate)} / h`],
    ["Hours per man-day", num(effective.hoursPerDay)],
    ["Markup", markupText],
    ["Commission", `${pct(s.commission)}${s.commissionInMarkup ? " (in markup)" : ""}`],
    [
      "Sales tax",
      s.taxExempt
        ? "Tax exempt"
        : `${pct(effective.salesTaxRate * 100)}${effective.taxMaterialOnly ? " (material only)" : ""}`,
    ],
    [
      "Per diem",
      `${money(s.perDiem ?? 0)} / man-day${(s.perDiemInMarkup ?? true) ? " (in markup)" : ""}`,
    ],
    [
      "Discounts",
      [
        s.prepayDiscount ? "Prepay" : "",
        s.stdSizeDiscount ? "Standard sheet size" : "",
        s.volumeDiscount ? "100,000 sf" : "",
      ]
        .filter(Boolean)
        .join(", ") || "None",
    ],
    ["Labor adjust", pct(s.adjustLaborPct ?? 0)],
    [
      "Setup / inspection adjust",
      `${pct(s.adjustSetupPct ?? 0)} / ${pct(s.adjustInspectionPct ?? 0)}`,
    ],
  ];
  // Two label/value pairs per row halves the table's height.
  const half = Math.ceil(defaults.length / 2);
  const defaultRows: string[][] = [];
  for (let i = 0; i < half; i++) {
    const a = defaults[i]!;
    const b = defaults[i + half];
    defaultRows.push([a[0], a[1], b?.[0] ?? "", b?.[1] ?? ""]);
  }

  const tables: SummaryTable[] = [
    {
      title: "Customer & job site",
      columns: [{ label: "Client" }, { label: "" }, { label: "Job site" }, { label: "" }],
      rows: contactRows,
    },
    {
      title: "Bid defaults",
      columns: [{ label: "Setting" }, { label: "Value" }, { label: "Setting" }, { label: "Value" }],
      rows: defaultRows,
    },
  ];

  if (cu.perDiemChart) {
    const chart = normalizePerDiemChart(cu.perDiemChart);
    const items = checkedPerDiemItems(chart);
    tables.push({
      title: `${perDiemChartTitle(chart)} (informational)`,
      columns: [{ label: "Item" }, { label: "Price", align: "right" }],
      rows: [
        ...items.map((it) => [it.label, money(it.price)]),
        ["Total", money(perDiemChartTotal(chart))],
      ],
      totalRows: [items.length],
    });
  }

  const notes: string[] = [];
  if (text(cu.notes)) notes.push(`Notes: ${text(cu.notes)}`);
  return { tables, notes };
}

// ── Sections ─────────────────────────────────────────────────────────────────

/** The bid-level system a section / wall inherits unless it overrides it. */
const bidSystem = (s: SavedBidState) => ({
  roofSystem: s.roofSystem,
  attachment: s.attachment,
  ...(s.membraneAdhesiveName ? { membraneAdhesiveName: s.membraneAdhesiveName } : {}),
});

function sectionSystem(s: SavedBidState, x: BidSectionInput) {
  return resolveSectionSystem(bidSystem(s), x);
}

function sectionsStep({ state: s, computed: c, admin }: BidSummaryInput): StepBody {
  if (s.sections.length === 0) return { tables: [] };
  const rate = s.laborRate;
  let area = 0;
  let hrs = 0;
  const rows = s.sections.map((x, i) => {
    const sys = sectionSystem(s, x);
    const sheetLabels = Object.keys(admin?.labor?.[sys.comboKey]?.sheetSizeMultiByLabel ?? {});
    const complexity = roofSystemHasComplexity(sys.roofSystem)
      ? (COMPLEXITY_LABELS[x.complexity ?? 2] ?? "")
      : "None";
    const h = c.sectionHours[i] ?? 0;
    const a = x.length * x.width;
    area += a;
    hrs += h;
    // Duro-Bond (legacy RoofSystem id 2) enters plates per 4×8 board, the rest an on-centre.
    const oc =
      sys.rsId === 2
        ? `${num(x.fastenerOc)} / 4×8`
        : x.fastenerOc
          ? `${num(x.fastenerOc)}" OC`
          : "";
    return [
      x.name,
      `${num(x.length)} × ${num(x.width)}`,
      num(a),
      x.deckType,
      sys.roofSystem,
      attachLabel(sys.attachment),
      numB(x.thickness),
      x.color,
      numB(x.pullTest),
      oc,
      `${resolveSectionSheetLabel(x, sheetLabels) || "—"} / ${complexity}`,
      x.tearOff ? "Yes" : "No",
      hours(h),
      money(h * rate),
    ];
  });
  rows.push([
    "Total",
    "",
    num(area),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    hours(hrs),
    money(hrs * rate),
  ]);

  // Per-side edge options (the Roof Sections Summary grid's edge columns).
  const edgeRows = s.sections.map((x) => {
    const edges: EdgeInput[] = x.edges?.length ? x.edges : defaultEdges(x.length, x.width);
    const z = resolveSectionZones({ ...x, edges });
    const cell = (f: (e: EdgeInput) => string | null) =>
      edges
        .map((e) => {
          const v = f(e);
          return v ? `${e.side}: ${v}` : null;
        })
        .filter(Boolean)
        .join("; ");
    return [
      x.name,
      cell((e) =>
        e.termination && e.termination !== "No Termination"
          ? `${e.termination} ${num(edgeTermLength(e))}'`
          : null,
      ),
      cell((e) => (e.arpSizeIn > 0 ? `${e.arpSizeIn}" × ${num(edgeArpLength(e))}'` : null)),
      cell((e) => (e.blockingFt > 0 ? `${num(e.blockingFt)}'` : null)),
      cell((e) => (e.isPerimeter ? `${num(edgePerimLength(e))}'` : null)),
      numB(x.enhancementWidthFt),
      numB(z.perimLengthFt),
      numB(z.cornerLengthFt),
    ];
  });

  return {
    tables: [
      {
        title: "Roof sections",
        columns: [
          { label: "Section" },
          { label: "L × W (ft)" },
          { label: "Sq ft", align: "right" },
          { label: "Deck" },
          { label: "Roof system" },
          { label: "Attached" },
          { label: "Mil", align: "right" },
          { label: "Color" },
          { label: "Pull test", align: "right" },
          { label: "Spacing / plates" },
          { label: "Sheet size / complexity" },
          { label: "Tear-off" },
          { label: "Man h", align: "right" },
          { label: "Labor $", align: "right" },
        ],
        rows,
        totalRows: [rows.length - 1],
      },
      {
        title: "Edge options",
        columns: [
          { label: "Section" },
          { label: "Termination" },
          { label: "ARP" },
          { label: "Wood blocking" },
          { label: "Perimeter sides" },
          { label: "Enh. width (ft)", align: "right" },
          { label: "Perim (ft)", align: "right" },
          { label: "Corner (ft)", align: "right" },
        ],
        rows: edgeRows,
      },
      {
        title: "Bid-wide section figures",
        columns: [{ label: "Item" }, { label: "Value", align: "right" }],
        rows: [
          ["Setup time (h)", hours(c.est.setupHours)],
          ["Inspection time (h)", hours(c.est.inspectionHours)],
          ["Roof sq ft", num(c.est.roofSqFootage)],
          ["Membrane sq ft", num(c.est.sqFtTotalMembrane)],
        ],
      },
    ],
  };
}

// ── Underlayment ─────────────────────────────────────────────────────────────

const quotePrice = (q: NonNullable<UnderlaymentLayer["quote"]>) =>
  q.pieceMode ? (q.pieces ?? 0) * (q.costPerPiece ?? 0) : (q.lumpSum ?? 0);

function layerText(l: UnderlaymentLayer, isDuroBond: boolean): string {
  if (l.quote) return `${l.board}: quote "${l.quote.name}" ${money(quotePrice(l.quote))}`;
  const att = effectiveLayerAttachment(l, isDuroBond);
  const how =
    att === "mechanical"
      ? "Mechanical"
      : att === "durobond"
        ? "Duro-Bond"
        : att === "none"
          ? "None"
          : l.adhesiveName || "Adhesive";
  return `${l.board}: ${how}`;
}

function underlaymentStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  const withLayers = s.sections.filter((x) => sectionLayers(x).length > 0);
  if (withLayers.length === 0) return { tables: [] };
  const rate = s.laborRate;
  const per = c.underlaymentHoursBySection ?? {};
  let area = 0;
  let hrs = 0;
  let quotes = 0;
  const rows = withLayers.map((x) => {
    const layers = sectionLayers(x);
    const isDuroBond = sectionSystem(s, x).roofSystem === "Duro-Bond";
    const h = (per[x.id]?.adjusted ?? 0) + (per[x.id]?.quote ?? 0);
    const q = layers.reduce((n, l) => n + (l.quote ? quotePrice(l.quote) : 0), 0);
    const a = x.length * x.width;
    area += a;
    hrs += h;
    quotes += q;
    return [
      x.name,
      `${num(x.length)} × ${num(x.width)}`,
      num(a),
      layers.map((l, i) => `${i + 1}. ${layerText(l, isDuroBond)}`).join("\n"),
      moneyB(q),
      hours(h),
      money(h * rate),
    ];
  });
  rows.push(["Total", "", num(area), "", moneyB(quotes), hours(hrs), money(hrs * rate)]);

  // Material is attributed by insulation type (the Review ledger's rows), not per section.
  const lab = new Map(c.ledger.labor.insulation.map((r) => [r.label, r]));
  const mat = c.ledger.purchases.insulation.filter(
    (r) => r.cost !== 0 || (lab.get(r.label)?.hours ?? 0) !== 0,
  );
  let mTot = 0;
  let hTot = 0;
  const matRows = mat.map((r) => {
    const l = lab.get(r.label);
    mTot += r.cost;
    hTot += l?.hours ?? 0;
    return [r.label, money(r.cost), hoursB(l?.hours), moneyB(l?.cost)];
  });
  if (matRows.length) matRows.push(["Total", money(mTot), hours(hTot), money(hTot * rate)]);

  return {
    tables: [
      {
        title: "Layers by section",
        columns: [
          { label: "Section" },
          { label: "W × L (ft)" },
          { label: "Sq ft to cover", align: "right" },
          { label: "Layers (board: attached with)" },
          { label: "Quote $", align: "right" },
          { label: "Man h", align: "right" },
          { label: "Labor $", align: "right" },
        ],
        rows,
        totalRows: [rows.length - 1],
      },
      {
        title: "Material by insulation type",
        columns: [
          { label: "Type" },
          { label: "Material $", align: "right" },
          { label: "Man h", align: "right" },
          { label: "Labor $", align: "right" },
        ],
        rows: matRows,
        totalRows: matRows.length ? [matRows.length - 1] : [],
      },
    ],
    notes: [
      `Man hours per section include quote labor. Bid underlayment labor: ${hours(c.est.underlaymentLaborHours)} h.`,
    ],
  };
}

// ── Parapets ─────────────────────────────────────────────────────────────────

function parapetsStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  const walls = s.parapets ?? [];
  if (walls.length === 0) return { tables: [] };
  const rate = s.laborRate;
  const first = s.sections[0];
  let len = 0;
  let hrs = 0;
  let memb = 0;
  const dimRows = walls.map((p) => {
    const h = c.parapetHoursById[p.id] ?? 0;
    const m = parapetMembraneSqFt(p);
    len += p.lengthFt;
    hrs += h;
    memb += m;
    return [
      p.name,
      p.deckType,
      p.wallType === 1 ? "Wood / Metal" : p.wallType === 4 ? "Brick / Concrete" : "",
      num(p.lengthFt),
      num(p.pieces ?? 1),
      numB(p.skirtInches),
      numB(p.cantInches),
      numB(p.verticalInches),
      numB(p.wallTopInches),
      numB(p.dropInches),
      num(parapetGirth(p)),
      parapetStyle(p),
      num(m),
      hours(h),
      money(h * rate),
    ];
  });
  dimRows.push([
    "Total",
    "",
    "",
    num(len),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    num(memb),
    hours(hrs),
    money(hrs * rate),
  ]);

  const optRows = walls.map((p) => {
    const sys = resolveParapetSystem(bidSystem(s), p);
    const term = terminationLabel(p.termOptionId);
    return [
      p.name,
      term
        ? `${term} ${num(p.termLengthFt ?? p.lengthFt)}'${p.useTermBarOnBase ? " + term bar on base" : ""}`
        : "",
      (p.capstoneOption ?? 0) > 0
        ? `${p.capstoneOption === 1 ? "Remove only" : "Remove & reinstall"} ${num(p.capstoneLengthFt ?? p.lengthFt)}'`
        : "",
      (p.arpSizeIn ?? 0) > 0 ? `${p.arpSizeIn}" × ${num(p.arpLengthFt ?? p.lengthFt)}'` : "",
      p.hasBlocking ? `${num(p.blockingLengthFt ?? p.lengthFt)}'` : "",
      p.useSlipsheet ? "Yes" : "",
      sys.roofSystem,
      attachLabel(sys.attachment, sys.attachment === "adhered" ? sys.adhesiveName : undefined),
      num(p.thicknessMil ?? first?.thickness),
      p.color ?? first?.color ?? "",
      p.adjustLaborPct ? pct(p.adjustLaborPct) : "",
    ];
  });

  const totals: string[][] = [
    ["Man hours", hours(c.est.parapetLaborHours)],
    ["Labor cost", money(c.est.parapetLaborHours * rate)],
    ["Parapet membrane material", money(c.parapetMaterial)],
    ["Vertical wall sq ft", num(c.stats.parapetVertSqFt)],
    ["Total wall sq ft", num(c.stats.parapetWallSqFt)],
    ["Parapet membrane sq ft", num(memb)],
  ];
  if (c.parapetFastenersNeeded !== undefined)
    totals.push(["Fasteners needed", num(c.parapetFastenersNeeded, 0)]);

  return {
    tables: [
      {
        title: "Walls",
        columns: [
          { label: "Wall" },
          { label: "Deck" },
          { label: "Wall type" },
          { label: "Length (ft)", align: "right" },
          { label: "Pieces", align: "right" },
          { label: "Skirt", align: "right" },
          { label: "Cant", align: "right" },
          { label: "Vert", align: "right" },
          { label: "Top", align: "right" },
          { label: "Drop", align: "right" },
          { label: "Girth (in)", align: "right" },
          { label: "Style" },
          { label: "Membrane sq ft", align: "right" },
          { label: "Man h", align: "right" },
          { label: "Labor $", align: "right" },
        ],
        rows: dimRows,
        totalRows: [dimRows.length - 1],
      },
      {
        title: "Wall options & membrane",
        columns: [
          { label: "Wall" },
          { label: "Termination" },
          { label: "Capstones" },
          { label: "ARP" },
          { label: "Blocking" },
          { label: "Slipsheet" },
          { label: "Roof system" },
          { label: "Attached" },
          { label: "Mil", align: "right" },
          { label: "Color" },
          { label: "Labor adj.", align: "right" },
        ],
        rows: optRows,
      },
      {
        title: "Parapet totals",
        columns: [{ label: "Item" }, { label: "Value", align: "right" }],
        rows: totals,
      },
    ],
  };
}

// ── Curbs ────────────────────────────────────────────────────────────────────

function curbsStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  const curbs: CurbInput[] = s.curbs ?? [];
  if (curbs.length === 0) return { tables: [] };
  const rate = s.laborRate;
  const first = s.sections[0];
  let qty = 0;
  let hrs = 0;
  const rows = curbs.map((x) => {
    const h = c.curbHoursById[x.id] ?? 0;
    qty += x.quantity;
    hrs += h;
    const opts = [x.hasInsulation ? "Insulation" : "", x.hasPlastic ? "Plastic" : ""]
      .filter(Boolean)
      .join(", ");
    return [
      x.name,
      x.styleId !== undefined ? (CURB_STYLE[x.styleId] ?? `#${x.styleId}`) : "",
      num(x.quantity),
      num(x.widthIn),
      num(x.lengthIn),
      numB(x.dimCIn),
      numB(x.dimDIn),
      x.deckType,
      CURB_TERM[x.termOption ?? 0] ?? "",
      opts,
      `${num(x.thicknessMil ?? first?.thickness)} mil ${x.color ?? first?.color ?? ""}`.trim(),
      x.adjustLaborPct ? pct(x.adjustLaborPct) : "",
      hours(h),
      money(h * rate),
    ];
  });
  rows.push([
    "Total",
    "",
    num(qty),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    hours(hrs),
    money(hrs * rate),
  ]);
  return {
    tables: [
      {
        title: "Curbs",
        columns: [
          { label: "Label" },
          { label: "Style" },
          { label: "Qty", align: "right" },
          { label: "A (in)", align: "right" },
          { label: "B (in)", align: "right" },
          { label: "C (in)", align: "right" },
          { label: "D (in)", align: "right" },
          { label: "Deck" },
          { label: "Termination" },
          { label: "Options" },
          { label: "Membrane" },
          { label: "Labor adj.", align: "right" },
          { label: "Man h", align: "right" },
          { label: "Labor $", align: "right" },
        ],
        rows,
        totalRows: [rows.length - 1],
      },
    ],
    notes: [
      `Curb wrap membrane material: ${money(c.curbMaterial)}. Bid curb labor: ${hours(c.est.curbLaborHours)} h.`,
    ],
  };
}

// ── Accessories ──────────────────────────────────────────────────────────────

function accessoriesStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  const rate = s.laborRate;
  const tables: SummaryTable[] = [];

  // The Accessories Summary (every priced / laboured item of the calculated screens), grouped
  // by the screen it came from — the category the estimator entered it under.
  const extra = c.adhesiveLines ?? [];
  const lines = [...(c.accessories?.lines ?? []), ...extra];
  if (lines.length) {
    const rows: string[][] = [];
    let last = "";
    for (const l of lines) {
      rows.push([
        l.screen === last ? "" : l.screen,
        num(l.qty),
        l.name,
        moneyB(l.unitCost),
        moneyB(l.totalCost),
        hoursB(l.hours),
      ]);
      last = l.screen;
    }
    const material = (c.accessories?.totalCost ?? 0) + extra.reduce((n, l) => n + l.totalCost, 0);
    const hrs = c.accessories?.manHours ?? 0;
    rows.push(["Total", "", "", "", money(material), hours(hrs)]);
    rows.push(["", "", `Labor cost at ${money(rate)}/h`, "", money(hrs * rate), ""]);
    tables.push({
      title: "Accessories summary",
      columns: [
        { label: "Group" },
        { label: "Qty", align: "right" },
        { label: "Item" },
        { label: "Unit cost", align: "right" },
        { label: "Total cost", align: "right" },
        { label: "Labor h", align: "right" },
      ],
      rows,
      totalRows: [rows.length - 2],
    });
  }

  // Flat catalog lines ("Category — Item"), grouped by their category prefix.
  const flat: AccessoryLine[] = s.accessories ?? [];
  if (flat.length) {
    const split = (d: string) => {
      const i = d.indexOf(" — ");
      return i > 0 ? [d.slice(0, i), d.slice(i + 3)] : ["", d];
    };
    const byCat = new Map<string, AccessoryLine[]>();
    for (const a of flat) {
      const [cat] = split(a.description);
      byCat.set(cat!, [...(byCat.get(cat!) ?? []), a]);
    }
    const rows: string[][] = [];
    for (const [cat, items] of byCat) {
      items.forEach((a, i) => {
        rows.push([
          i === 0 ? cat : "",
          split(a.description)[1]!,
          money(a.price),
          numB(a.laborHoursPerUnit, 4),
          numB(a.quantity),
          money(a.price * a.quantity),
          hoursB((a.laborHoursPerUnit ?? 0) * a.quantity),
        ]);
      });
    }
    rows.push(["Total", "", "", "", "", money(c.accessoryTotal), hours(c.accessoryLaborHours)]);
    tables.push({
      title: "Catalog accessory lines",
      columns: [
        { label: "Category" },
        { label: "Item" },
        { label: "Unit price", align: "right" },
        { label: "Labor h/ea", align: "right" },
        { label: "Qty", align: "right" },
        { label: "Extended", align: "right" },
        { label: "Labor h", align: "right" },
      ],
      rows,
      totalRows: [rows.length - 1],
    });
  }
  return { tables };
}

// ── Metals ───────────────────────────────────────────────────────────────────

function metalsStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  const tables: SummaryTable[] = [];
  const m = c.metalsScreen;
  if (m && m.lines.length) {
    const rows = m.lines.map((l) => [
      l.category,
      l.item,
      `${num(l.qtyOrLf)}${l.isLength ? " LF" : ""}`,
      money(l.materialCost),
      numB(l.hoursPerUnit, 4),
      hoursB(l.hours),
      moneyB(l.laborCost),
    ]);
    rows.push([
      "Total",
      "",
      "",
      money(m.materialCost),
      "",
      hours(m.laborHours),
      money(m.laborCost),
    ]);
    tables.push({
      title: "EXCEPTIONAL Metals",
      columns: [
        { label: "Category" },
        { label: "Item / size" },
        { label: "Qty / LF", align: "right" },
        { label: "Cost", align: "right" },
        { label: "Hours per unit/LF", align: "right" },
        { label: "Hours", align: "right" },
        { label: "Labor $", align: "right" },
      ],
      rows,
      totalRows: [rows.length - 1],
    });
  }
  const flat = s.metals ?? [];
  if (flat.length) tables.push(catalogLinesTable("Extra catalog lines (older bid)", flat));
  return { tables };
}

/** Old flat catalog lines (metals / non-DL): material + own-rate labor per unit. */
function catalogLinesTable(title: string, lines: NonDlCatalogLine[]): SummaryTable {
  let mat = 0;
  let hrs = 0;
  let lab = 0;
  const rows = lines.map((l) => {
    const h = l.laborPerUnit * l.quantity;
    mat += l.price * l.quantity;
    hrs += h;
    lab += h * l.laborRate;
    return [
      l.category ?? "",
      l.description,
      numB(l.quantity),
      money(l.price),
      money(l.price * l.quantity),
      numB(l.laborPerUnit, 4),
      hoursB(h),
      money(l.laborRate),
      moneyB(h * l.laborRate),
    ];
  });
  rows.push(["Total", "", "", "", money(mat), "", hours(hrs), "", money(lab)]);
  return {
    title,
    columns: [
      { label: "Category" },
      { label: "Item" },
      { label: "Qty", align: "right" },
      { label: "Unit cost", align: "right" },
      { label: "Material", align: "right" },
      { label: "Labor h/unit", align: "right" },
      { label: "Hours", align: "right" },
      { label: "Rate", align: "right" },
      { label: "Labor $", align: "right" },
    ],
    rows,
    totalRows: [rows.length - 1],
  };
}

// ── Tear-Off ─────────────────────────────────────────────────────────────────

function tearOffStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  if (!s.sections.some((x) => x.tearOff)) return { tables: [] };
  const per = c.tearOffHoursBySection ?? {};
  const rate = s.laborRate;
  let area = 0;
  let hrs = 0;
  const rows = s.sections.map((x) => {
    const h = x.tearOff ? (per[x.id]?.adjusted ?? 0) : 0;
    const a = x.length * x.width;
    if (x.tearOff) area += a;
    hrs += h;
    return [
      x.name,
      x.deckType,
      `${num(x.width)} × ${num(x.length)}`,
      num(a),
      yesNo(x.tearOff),
      x.tearOff ? x.tearOffType : "",
      x.tearOff ? numB(x.toThicknessInches) : "",
      x.tearOff && x.tearOffAdditionalPct ? pct(x.tearOffAdditionalPct) : "",
      x.tearOff ? hours(h) : "",
      x.tearOff ? money(h * rate) : "",
    ];
  });
  rows.push(["Total torn off", "", "", num(area), "", "", "", "", hours(hrs), money(hrs * rate)]);
  return {
    tables: [
      {
        title: "Tear-off by section",
        columns: [
          { label: "Section" },
          { label: "Deck" },
          { label: "W × L (ft)" },
          { label: "Sq ft", align: "right" },
          { label: "Tear-off" },
          { label: "Type" },
          { label: "Thickness (in)", align: "right" },
          { label: "Labor adj.", align: "right" },
          { label: "Man h", align: "right" },
          { label: "Labor $", align: "right" },
        ],
        rows,
        totalRows: [rows.length - 1],
      },
      {
        title: "Disposal",
        columns: [{ label: "Item" }, { label: "Value", align: "right" }],
        rows: [
          ["Tear-off man hours (bid)", hours(c.est.tearOffLaborHours)],
          ["Disposal units (dumpsters)", num(c.est.disposalUnits, 0)],
        ],
      },
    ],
    notes: [
      "Disposal units are counted for the whole bid (all torn-off volume over the dumpster size, rounded up), not per section.",
    ],
  };
}

// ── Non-DL ───────────────────────────────────────────────────────────────────

function nonDlStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  const tables: SummaryTable[] = [];
  const n = c.nonDl;
  if (n && n.lines.length) {
    const rows: string[][] = [];
    let last = "";
    for (const l of n.lines) {
      rows.push([
        l.category === last ? "" : l.category,
        l.item + (l.isCustom ? " (custom)" : ""),
        numB(l.qty),
        moneyB(l.unitCost),
        moneyB(l.materialCost),
        numB(l.laborPerUnit, 4),
        hoursB(l.hours),
        moneyB(l.laborRate),
        moneyB(l.laborCost),
      ]);
      last = l.category;
    }
    rows.push([
      "Total",
      "",
      "",
      "",
      money(n.totalMaterialIncludingServices),
      "",
      hours(n.totalHours),
      "",
      money(n.totalLaborCost),
    ]);
    tables.push({
      title: "Non-Duro-Last items",
      columns: [
        { label: "Category" },
        { label: "Item" },
        { label: "Qty", align: "right" },
        { label: "Unit cost", align: "right" },
        { label: "Material", align: "right" },
        { label: "Labor h/unit", align: "right" },
        { label: "Hours", align: "right" },
        { label: "Labor rate", align: "right" },
        { label: "Labor $", align: "right" },
      ],
      rows,
      totalRows: [rows.length - 1],
    });

    const groupRows = NON_DL_GROUPS.filter((g) => {
      const t = n.byGroup[g];
      return t && (t.material || t.hours || t.laborCost);
    }).map((g) => {
      const t = n.byGroup[g];
      return [NON_DL_CATEGORY_LABEL[g], money(t.material), hours(t.hours), money(t.laborCost)];
    });
    if (groupRows.length) {
      groupRows.push([
        "Total",
        money(n.totalMaterialIncludingServices),
        hours(n.totalHours),
        money(n.totalLaborCost),
      ]);
      tables.push({
        title: "Group totals",
        columns: [
          { label: "Group" },
          { label: "Material", align: "right" },
          { label: "Hours", align: "right" },
          { label: "Labor $", align: "right" },
        ],
        rows: groupRows,
        totalRows: [groupRows.length - 1],
      });
    }
  }
  if (s.nonDlLines.length) tables.push(catalogLinesTable("Catalog lines", s.nonDlLines));
  return { tables };
}

// ── Review ───────────────────────────────────────────────────────────────────

function reviewStep({ state: s, computed: c }: BidSummaryInput): StepBody {
  const { ledger, est } = c;
  const m = est.money;
  const d = (i: number) => m.dTotals[i] ?? 0;

  // Purchases | Labor & Services — the two left ledgers, group by group.
  const group = (label: string, rows: LedgerRow[], withHours: boolean) =>
    rows.map((r, i) =>
      withHours
        ? [i === 0 ? label : "", r.label, money(r.cost), hours(r.hours ?? 0)]
        : [i === 0 ? label : "", r.label, money(r.cost)],
    );
  const pRows = [
    ...group("Duro-Last", ledger.purchases.duroLast, false),
    ...group("Insulation", ledger.purchases.insulation, false),
    ...group("Non-DuroLast", ledger.purchases.nonDuroLast, false),
    ["Totals", "Materials", money(ledger.purchases.materials)],
    ["", "Tax", money(m.taxCharged)],
    ["", "Shipping (DL)", money(ledger.purchases.shippingDl)],
    ["", "Shipping (Other)", money(s.extraShipping ?? 0)],
  ];
  const lRows = [
    ...group("Duro-Last", ledger.labor.duroLast, true),
    ...group("Insulation", ledger.labor.insulation, true),
    ...group("Non-DuroLast", ledger.labor.nonDuroLast, true),
    ...group("", [ledger.labor.setup, ledger.labor.inspection, ledger.labor.tearOff], true),
    [
      "Total Labor",
      "",
      money(ledger.labor.totalLabor.cost),
      hours(ledger.labor.totalLabor.hours ?? 0),
    ],
    ...group("Subcontractors", ledger.labor.subcontractors, true),
    ...group("Services", ledger.labor.services, true),
    ["Total Subs. & Svc", "", money(ledger.labor.totalSubsSvc), hours(0)],
  ];

  // Totals — the right-hand ledger, row for row.
  const used = (b: boolean | undefined) => (b ? "Yes" : "");
  const tRows: string[][] = [
    ["Total DuroLast", "", money(d(0))],
    ["Prepay Discount", used(s.prepayDiscount), money(d(1))],
    ["Standard Sheet Size Discount", used(s.stdSizeDiscount), money(d(2))],
    ["100,000 sf Discount", used(s.volumeDiscount), money(d(3))],
    ["After Selected Discounts", "", money(d(4))],
    ["Warranty Cost", "", money(d(5))],
    ["Insulation & Underlayment", "", money(d(6))],
    ["Other Purchases", "", money(d(7))],
    ["Sales Tax", "", money(m.taxCharged)],
    ["Total Purchases", "", money(d(8))],
    ["Total Shipping", "", money(d(9))],
    ["Total Labor", "", money(d(10))],
    ["Total Services", "", money(d(11))],
    ["Subtotal 1", "", money(m.subtotal1)],
    [
      "Dollar Markup",
      used(s.markupMode === 1),
      s.markupMode === 1
        ? `${money(m.markupValue)} (@ ${money(s.markup)}/day)`
        : money(m.markupValue),
    ],
    ["Markup percentage", used(s.markupMode !== 1), s.markupMode !== 1 ? `${num(s.markup)}%` : "—"],
    ["Subtotal 2", "", money(m.subtotal2)],
    ["Per-Diem Charge", "", money(m.perDiemValue)],
    ["Sales Commission", "", money(m.commissionValue)],
    ["Bid Total", "", money(m.grandTotal)],
  ];
  const bold = ["After Selected Discounts", "Subtotal 1", "Subtotal 2", "Bid Total"];

  // Labor hours + unit metrics: the CSV's rows (buildReviewRows), fed the ledger's areas so the
  // per-sq-ft figures match the screen.
  const csv = buildReviewRows({
    ...c.review,
    roofSqFt: c.stats.roofSqFt,
    membraneSqFt: c.stats.membraneSqFt,
  });
  const hRows = csv
    .filter((r) => r[0] === "Labor hours")
    .map((r) => [r[1]!, r[1] === "Disposal units" ? num(Number(r[2]), 0) : hours(Number(r[2]))]);
  const uRows = csv
    .filter((r) => r[0] === "Unit metrics")
    .map((r) => [
      r[1]!,
      /^(Price|Labor) per/.test(r[1]!) ? money(Number(r[2])) : num(Number(r[2])),
    ]);
  uRows.push(
    ["Parapet vertical wall (sq ft)", num(c.stats.parapetVertSqFt)],
    ["Parapet total wall (sq ft)", num(c.stats.parapetWallSqFt)],
  );

  const notes: string[] = [];
  for (const w of c.warnings ?? []) notes.push(`Check inputs: ${w}`);

  return {
    tables: [
      {
        title: "Purchases",
        columns: [{ label: "Group" }, { label: "Line" }, { label: "Cost", align: "right" }],
        rows: pRows,
      },
      {
        title: "Labor & Services",
        columns: [
          { label: "Group" },
          { label: "Line" },
          { label: "Cost", align: "right" },
          { label: "Man hours", align: "right" },
        ],
        rows: lRows,
        totalRows: lRows.flatMap((r, i) => (r[0]?.startsWith("Total") ? [i] : [])),
      },
      {
        title: "Totals",
        columns: [{ label: "Line" }, { label: "Use" }, { label: "Amount", align: "right" }],
        rows: tRows,
        totalRows: tRows.flatMap((r, i) => (bold.includes(r[0]!) ? [i] : [])),
      },
      {
        title: "Labor hours",
        columns: [{ label: "Line" }, { label: "Hours", align: "right" }],
        rows: hRows,
        totalRows: hRows.flatMap((r, i) => (r[0] === "Total man-days" ? [i] : [])),
      },
      {
        title: "Unit metrics",
        columns: [{ label: "Metric" }, { label: "Value", align: "right" }],
        rows: [["Total man days", num(m.totalManDays)], ...uRows],
      },
    ],
    notes,
  };
}
