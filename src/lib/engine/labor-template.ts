/**
 * Labor templates — the legacy model (docs §20.3).
 *
 * A legacy `Template` holds PERCENT ADJUSTMENTS per area (0 = no change, 10 = +10%). It is never a
 * compute-time factor: `frmHome.updateTemplate` (Estimator.exe rva 0x5a394) WRITES the values into
 * every item's own AdjustLabor field, and the item constructors seed new items from the estimate's
 * current template (RoofSection / Parapet / Curb ctors; Estimate ctor for the edge accessories).
 * The engine then reads only the item fields. This module is that write step for the web bid.
 */

import type { AccessoriesState } from "./accessories";
import type { EngineAdminData } from "./adapters";
import type { BidSectionInput, CurbInput, ParapetInput } from "./bid-builder";

/** The template areas the web stores (labor_template_adjustments.area) → legacy Template field. */
export const TEMPLATE_AREAS = {
  roofSection: "Roof Section Labor", // Template.RoofSectionLabor
  underlayment: "Underlayment Labor", // Template.UnderlaymentLabor
  curbs: "Curbs Labor", // Template.CurbsLabor
  parapets: "Parapets Labor", // Template.ParapetsLabor
  tearOff: "Tear-Off Labor", // Template.TearOffLabor (→ TO_Additional, Convert.ToInt32)
  pipeStacks: "Pipe Stacks Labor", // Template.PipeStacksLabor
  drains: "Drains Labor", // Template.DrainsLabor
  setup: "Setup Time Labor", // Template.SetUpTimeLabor
  inspection: "Inspection Time Labor", // Template.InspectionTimeLabor
  edgeTermination: "Edge Termination Labor", // Template.EdgeTerminationLabor
} as const;

export type LaborTemplateDeltas = Record<keyof typeof TEMPLATE_AREAS, number>;

/** Zero deltas — what "None" / no template means. */
export const zeroTemplateDeltas = (): LaborTemplateDeltas => ({
  roofSection: 0,
  underlayment: 0,
  curbs: 0,
  parapets: 0,
  tearOff: 0,
  pipeStacks: 0,
  drains: 0,
  setup: 0,
  inspection: 0,
  edgeTermination: 0,
});

/** The percent adjustments of one admin template by name (unknown / "" → all zero). */
export function laborTemplateDeltas(
  admin: Pick<EngineAdminData, "laborTemplates"> | null | undefined,
  name: string | undefined,
): LaborTemplateDeltas {
  const out = zeroTemplateDeltas();
  const areas = name ? admin?.laborTemplates?.byName[name] : undefined;
  if (!areas) return out;
  for (const key of Object.keys(TEMPLATE_AREAS) as Array<keyof typeof TEMPLATE_AREAS>) {
    const v = areas[TEMPLATE_AREAS[key]];
    out[key] = v !== undefined && Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** VB `Convert.ToInt32(Single)` — banker's rounding to a whole percent (legacy TO_Additional). */
export const toInt32 = (v: number): number => {
  const f = Math.floor(v);
  const frac = v - f;
  if (frac > 0.5) return f + 1;
  if (frac < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};

export interface TemplateTargets {
  sections: BidSectionInput[];
  parapets: ParapetInput[];
  curbs: CurbInput[];
  accessoriesCalc: AccessoriesState;
}

export interface TemplateWrites extends TemplateTargets {
  /** Bid-level RoofSection.AdjustLabor default (every section's value in legacy). */
  adjustLaborPct: number;
  adjustSetupPct: number;
  adjustInspectionPct: number;
}

/**
 * Legacy `frmHome.updateTemplate` verbatim: write the template's adjustments into every item.
 * Quirk ported as-is: existing PARAPETS receive `Template.RoofSectionLabor` (the IL reads
 * `get_RoofSectionLabor` for the parapet loop, not ParapetsLabor); only NEW parapets seed from
 * ParapetsLabor (Parapet ctor) — see `seedParapetAdjust`.
 */
export function applyLaborTemplate(t: TemplateTargets, d: LaborTemplateDeltas): TemplateWrites {
  const sections = t.sections.map((s) => {
    const nx: BidSectionInput = {
      ...s,
      adjustUnderlaymentLaborPct: d.underlayment,
      tearOffAdditionalPct: toInt32(d.tearOff),
    };
    // Every section takes the template's RoofSectionLabor: the bid-level default carries it, so
    // per-section overrides are cleared (legacy overwrites each RoofSection.AdjustLabor).
    delete nx.adjustLaborPct;
    return nx;
  });
  const parapets = t.parapets.map((p) => ({ ...p, adjustLaborPct: d.roofSection }));
  const curbs = t.curbs.map((c) => ({ ...c, adjustLaborPct: d.curbs }));
  const a = t.accessoriesCalc;
  const edge = d.edgeTermination;
  const accessoriesCalc: AccessoriesState = {
    ...a,
    termBar: { ...a.termBar, adjustNoDrillPct: edge, adjustPreDrillPct: edge },
    fascia: {
      "3": { ...a.fascia["3"], adjustNoDrillPct: edge, adjustPreDrillPct: edge },
      "4": { ...a.fascia["4"], adjustNoDrillPct: edge, adjustPreDrillPct: edge },
    },
    dripEdge: {
      "2": { ...a.dripEdge["2"], adjustPct: edge },
      "4": { ...a.dripEdge["4"], adjustPct: edge },
    },
    gravelStop: {
      "2": { ...a.gravelStop["2"], adjustPct: edge },
      "4": { ...a.gravelStop["4"], adjustPct: edge },
    },
    snapCover: Object.fromEntries(
      Object.entries(a.snapCover).map(([k, v]) => [k, { ...v, adjustPct: edge }]),
    ) as AccessoriesState["snapCover"],
    pipeStacks: a.pipeStacks.map((ps) => ({ ...ps, adjustPct: d.pipeStacks })),
    drains: a.drains.map((dr) => ({ ...dr, adjustPct: d.drains })),
  };
  return {
    sections,
    parapets,
    curbs,
    accessoriesCalc,
    adjustLaborPct: d.roofSection,
    adjustSetupPct: d.setup,
    adjustInspectionPct: d.inspection,
  };
}

/** Legacy Parapet ctor: a NEW wall seeds AdjustLabor from Template.ParapetsLabor. */
export const seedParapetAdjust = (d: LaborTemplateDeltas): number => d.parapets;
/** Legacy Curb ctor: a NEW curb seeds AdjustLabor from Template.CurbsLabor. */
export const seedCurbAdjust = (d: LaborTemplateDeltas): number => d.curbs;
/** Legacy RoofSection ctor: a NEW section seeds AdjustUnderlaymentLabor / TO_Additional. */
export const seedSectionAdjust = (
  d: LaborTemplateDeltas,
): Pick<BidSectionInput, "adjustUnderlaymentLaborPct" | "tearOffAdditionalPct"> => ({
  adjustUnderlaymentLaborPct: d.underlayment,
  tearOffAdditionalPct: toInt32(d.tearOff),
});
