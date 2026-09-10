/**
 * The legacy Estimate Review ledger (captured 2026-08-31, shots 124824/124849): three columns —
 * Purchases | Labor & Services (with the bottom Cost/Man-Hours radio switching the second
 * column) | Totals. This module builds the two LEFT columns' rows from the engine's outputs;
 * every dollar/hour here is an ATTRIBUTION of amounts the engine already billed (the
 * ReviewBreakdown is recorded inside the build loops), never a recomputation — the tests assert
 * the rows sum to the engine aggregates. The Totals column renders straight from money.dTotals.
 */

import type { BidInput, BuildResult, NonDlLine } from "./bid-builder";
import { NON_DL_LS2_CATEGORIES } from "./bid-builder";
import type { EstimateResult } from "./estimate";
import { NON_DL_LS2_GROUPS, type NonDlGroup } from "./nondl";

export interface LedgerRow {
  label: string;
  cost: number;
  /** Man-hours for the Labor view; undefined renders as the legacy 0/blank. */
  hours?: number;
}

export interface ReviewLedger {
  purchases: {
    duroLast: LedgerRow[];
    insulation: LedgerRow[];
    nonDuroLast: LedgerRow[];
    materials: number; // Materials total (before tax)
    tax: number;
    shippingDl: number;
  };
  labor: {
    duroLast: LedgerRow[];
    insulation: LedgerRow[];
    nonDuroLast: LedgerRow[];
    setup: LedgerRow;
    inspection: LedgerRow;
    tearOff: LedgerRow;
    totalLabor: LedgerRow;
    subcontractors: LedgerRow[];
    services: LedgerRow[];
    totalSubsSvc: number;
  };
}

/** The legacy Review insulation row labels, by SubType tile (capture order). */
const INSULATION_ROWS: Array<{ tile: number; label: string }> = [
  { tile: 1, label: "Slip Sheets" },
  { tile: 2, label: "4x8 ISO" },
  { tile: 3, label: "4x8 Rigid" },
  { tile: 4, label: "Flute Filler" },
  { tile: 5, label: "Fire Rated" },
  { tile: 6, label: "Tapered/Other" },
  { tile: 7, label: "4x4 ISO" },
  { tile: 8, label: "4x4 Rigid" },
];

/** Legacy Review non-DL display rows, from our curated screen categories. */
const NONDL_ROW_BY_CATEGORY: Record<string, string> = {
  "Roof Edge Blocking": "Wood Blocking",
  "Parapet Wall Blocking": "Wood Blocking",
  "Structural Deck Materials": "Roof Decking",
  "Sheet Metal Work": "Sheet Metal",
  Masonry: "Masonry",
  "Preset Custom Applications": "Custom Apps",
};
/** §14 module groups → the same legacy Review rows. */
const NONDL_ROW_BY_GROUP: Record<NonDlGroup, string> = {
  roofEdgeBlocking: "Wood Blocking",
  wallBlocking: "Wood Blocking",
  deckMaterials: "Roof Decking",
  sheetMetal: "Sheet Metal",
  masonry: "Masonry",
  customApps: "Custom Apps",
  others: "Other",
  services: "Other",
  subcontractors: "Other",
};
const NONDL_ROW_ORDER = [
  "Wood Blocking",
  "Roof Decking",
  "Sheet Metal",
  "Masonry",
  "Custom Apps",
  "Other",
];

/** The legacy Subcontractors screen's fixed rows (seeded descriptions). */
const SUBCONTRACTOR_ROWS = ["HVAC", "Sheet Metal", "Masonry", "Guttering"];

const nonDlRowFor = (l: NonDlLine): string =>
  (l.category !== undefined ? NONDL_ROW_BY_CATEGORY[l.category] : undefined) ?? "Other";

export function buildReviewLedger(i: {
  bid: BidInput;
  result: BuildResult;
  est: EstimateResult;
  crewRate: number;
}): ReviewLedger {
  const { bid, result, est, crewRate } = i;
  const b = result.breakdown;
  const inp = result.inputs;

  // ── Purchases: Duro-Last ──────────────────────────────────────────────────
  const purchasesDl: LedgerRow[] = [
    { label: "Roof Sections", cost: inp.membraneCostBeforeDiscount },
    { label: "Parapets", cost: result.parapetMaterial },
    { label: "Curbs", cost: result.curbMaterial },
    // MembraneAccs ARP auto-material rides with the accessory lines, like legacy dMaterial[4].
    { label: "Accessories", cost: b.accessoriesMaterial + b.arpMaterial },
    { label: "Metals", cost: result.metalsMaterial },
    // Whole-unit adhesives are estimate-level in the web model; own row for honesty.
    { label: "Adhesives", cost: result.adhesiveMaterial },
  ];

  // ── Purchases + Labor: Insulation by tile ─────────────────────────────────
  const insulationPurchases: LedgerRow[] = INSULATION_ROWS.map((r) => ({
    label: r.label,
    cost: b.underlaymentMaterialBySubtype[r.tile] ?? 0,
  }));
  const unmappedMat = b.underlaymentMaterialBySubtype[0] ?? 0;
  const extraUMat = bid.materialUnderlayment;
  if (unmappedMat || extraUMat) {
    insulationPurchases.push({ label: "Other underlayment", cost: unmappedMat + extraUMat });
  }
  const insulationLabor: LedgerRow[] = INSULATION_ROWS.map((r) => {
    const h = b.underlaymentHoursBySubtype[r.tile] ?? 0;
    return { label: r.label, cost: h * crewRate, hours: h };
  });
  const unmappedHrs = b.underlaymentHoursBySubtype[0] ?? 0;
  if (unmappedHrs) {
    insulationLabor.push({
      label: "Other underlayment",
      cost: unmappedHrs * crewRate,
      hours: unmappedHrs,
    });
  }

  // ── Purchases + Labor: non-DL rows (lines by curated category + auto items) ─
  const ndlMat: Record<string, number> = {};
  const ndlLaborCost: Record<string, number> = {};
  const ndlHours: Record<string, number> = {};
  const bump = (rec: Record<string, number>, k: string, v: number) => {
    if (v) rec[k] = (rec[k] ?? 0) + v;
  };
  for (const l of bid.nonDlLines) {
    if (l.category !== undefined && NON_DL_LS2_CATEGORIES.has(l.category)) continue;
    const row = nonDlRowFor(l);
    bump(ndlMat, row, l.price * l.quantity);
    bump(ndlLaborCost, row, l.laborPerUnit * l.laborRate * l.quantity);
    bump(ndlHours, row, l.laborPerUnit * l.quantity);
  }
  // §14 Non-DL module lines (the six dialogs + auto rows) land on their legacy rows.
  for (const ln of result.nonDl?.lines ?? []) {
    if (NON_DL_LS2_GROUPS.has(ln.group)) continue;
    const row = NONDL_ROW_BY_GROUP[ln.group];
    bump(ndlMat, row, ln.materialCost);
    bump(ndlLaborCost, row, ln.laborCost);
    bump(ndlHours, row, ln.hours);
  }
  // Auto-priced items (§8.3/§8.4; zero when the §14 module owns them) land on their legacy rows.
  bump(ndlMat, "Sheet Metal", b.auto.counterflash.material);
  bump(ndlLaborCost, "Sheet Metal", b.auto.counterflash.laborCost);
  bump(ndlHours, "Sheet Metal", b.auto.counterflash.hours);
  bump(ndlLaborCost, "Wood Blocking", b.auto.blocking.laborCost);
  bump(ndlHours, "Wood Blocking", b.auto.blocking.hours);
  bump(ndlMat, "Masonry", b.auto.masonry.material);
  bump(ndlLaborCost, "Masonry", b.auto.masonry.laborCost);
  bump(ndlHours, "Masonry", b.auto.masonry.hours);
  // The manual otherMaterial seam belongs to the purchases Other row.
  bump(ndlMat, "Other", bid.otherMaterial);
  const nonDlPurchases: LedgerRow[] = NONDL_ROW_ORDER.map((label) => ({
    label,
    cost: ndlMat[label] ?? 0,
  }));
  const nonDlLabor: LedgerRow[] = NONDL_ROW_ORDER.map((label) => ({
    label,
    cost: ndlLaborCost[label] ?? 0,
    hours: ndlHours[label] ?? 0,
  }));

  // ── Labor: Duro-Last (crew-rate hours; metals bill at their own rates) ─────
  const laborDl: LedgerRow[] = [
    { label: "Roof Sections", cost: est.installHours * crewRate, hours: est.installHours },
    {
      label: "Parapets",
      cost: est.parapetLaborHours * crewRate,
      hours: est.parapetLaborHours,
    },
    { label: "Curbs", cost: est.curbLaborHours * crewRate, hours: est.curbLaborHours },
    {
      label: "Accessories",
      cost: (inp.accessoryLaborHours ?? 0) * crewRate,
      hours: inp.accessoryLaborHours ?? 0,
    },
    { label: "Metals", cost: b.metalsLaborCost, hours: b.metalsLaborHours },
  ];

  // ── Subcontractors / Services (LaborSubtotal2, §6) ────────────────────────
  const subsByDesc: Record<string, number> = {};
  const svcByDesc: Record<string, number> = {};
  for (const l of bid.nonDlLines) {
    if (l.category === undefined || !NON_DL_LS2_CATEGORIES.has(l.category)) continue;
    const whole = (l.price + l.laborPerUnit * l.laborRate) * l.quantity;
    if (l.category === "Subcontractors") bump(subsByDesc, l.description, whole);
    else bump(svcByDesc, l.description, whole);
  }
  // §14 module: one LaborSubtotal2 row per Subcontractors / Services item (material + labor).
  for (const ln of result.nonDl?.lines ?? []) {
    if (!NON_DL_LS2_GROUPS.has(ln.group)) continue;
    const whole = ln.materialCost + ln.laborCost;
    if (ln.group === "subcontractors") bump(subsByDesc, ln.item, whole);
    else bump(svcByDesc, ln.item, whole);
  }
  const subcontractors: LedgerRow[] = SUBCONTRACTOR_ROWS.map((label) => ({
    label,
    cost: subsByDesc[label] ?? 0,
  }));
  for (const [desc, cost] of Object.entries(subsByDesc)) {
    if (!SUBCONTRACTOR_ROWS.includes(desc)) subcontractors.push({ label: desc, cost });
  }
  if (bid.subsCost) subcontractors.push({ label: "Other subs", cost: bid.subsCost });
  const services: LedgerRow[] = Object.entries(svcByDesc).map(([label, cost]) => ({
    label,
    cost,
  }));
  // Uncategorized older lines route their labor to services (§6) + the manual seam.
  const uncatServices =
    bid.servicesCost +
    bid.nonDlLines
      .filter((l) => l.category === undefined)
      .reduce((sum, l) => sum + l.laborPerUnit * l.laborRate * l.quantity, 0);
  if (uncatServices) services.push({ label: "Other services", cost: uncatServices });

  return {
    purchases: {
      duroLast: purchasesDl,
      insulation: insulationPurchases,
      nonDuroLast: nonDlPurchases,
      materials: inp.materialTotalBeforeTax,
      tax: est.money.taxCharged,
      shippingDl: inp.shipping - bid.extraShipping,
    },
    labor: {
      duroLast: laborDl,
      insulation: insulationLabor,
      nonDuroLast: nonDlLabor,
      setup: { label: "Setup Labor", cost: est.setupHours * crewRate, hours: est.setupHours },
      inspection: {
        label: "Inspection Labor",
        cost: est.inspectionHours * crewRate,
        hours: est.inspectionHours,
      },
      tearOff: {
        label: "Tear-Off Labor",
        cost: est.tearOffLaborHours * crewRate,
        hours: est.tearOffLaborHours,
      },
      totalLabor: {
        label: "Total Labor",
        cost: est.laborSubtotal1,
        hours: est.laborSubtotal1Hours,
      },
      subcontractors,
      services,
      totalSubsSvc: est.laborSubtotal2,
    },
  };
}
