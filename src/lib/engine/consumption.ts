/**
 * Legacy consumption / auto-quantity rules (the red "needed" quantities), ported from
 * docs/legacy-consumption-rules.md §2 (IL-derived; nothing inferred from behavior).
 *
 * Everything here is DISPLAY-ONLY ordering guidance — none of it feeds the money chain.
 */

import type { BidSectionInput } from "./bid-builder";
import { sectionLayers } from "./bid-builder";
import { perimeterFromEdges } from "./edges";

/** §2.1 — 21 fasteners per 10-ft bar (term bar, fascia, drip edge, gravel stop). */
export const edgeBarScrews = (lengthFt: number): number =>
  lengthFt > 0 ? Math.ceil((lengthFt / 10) * 21) : 0;

/** §2.1 — two-piece metal: sizes {0,2,3} → 42 per 10 ft; size 1 → 63. Sizes are 3/4/5/6". */
export const twoPieceScrews = (lengthFt: number, sizeInches: number): number =>
  lengthFt > 0 ? Math.ceil((lengthFt / 10) * (sizeInches === 4 ? 63 : 42)) : 0;

/**
 * §2.3 — insulation fasteners for one mechanically attached layer over an area.
 * Default boards: 5 per 32 sq ft (4×8 board); 4×4 boards (legacy SubType 7/8): 4 per 16 sq ft.
 * When the membrane over the stack is adhered or Duro-Bond, the insulation holds the whole
 * assembly: 10/32 field · 16/32 perimeter (4×4: 5/16 field · 8/16 perimeter).
 */
export function insulationFasteners(
  areaSqFt: number,
  opts: { fourByFour: boolean; membraneAdheredOrBond: boolean; perimeter: boolean },
): number {
  if (areaSqFt <= 0) return 0;
  if (opts.fourByFour) {
    const per = opts.membraneAdheredOrBond ? (opts.perimeter ? 8 : 5) : 4;
    return Math.round(areaSqFt / 16) * per;
  }
  const per = opts.membraneAdheredOrBond ? (opts.perimeter ? 16 : 10) : 5;
  return Math.round(areaSqFt / 32) * per;
}

/** §2.5 — Duro-Caulk: 1 tube per 12 LF of termination bar + fascia cover. */
export const caulkTubes = (barLengthFt: number): number =>
  barLengthFt > 0 ? Math.ceil(barLengthFt / 12) : 0;

/** §2.2 — parapet deck fasteners: 1 per foot of parapet length (also 1 poly plate each). */
export const parapetDeckFasteners = (lengthFt: number): number =>
  lengthFt > 0 ? Math.round(lengthFt) : 0;

export interface EdgeBarBreakdown {
  termBarLf: number;
  fasciaLf: number;
  dripEdgeLf: number;
  gravelStopLf: number;
  twoPieceBySize: Record<number, number>; // size inches -> LF
}

/** Classify section-edge terminations into the legacy bar families. */
export function edgeBarBreakdown(sections: BidSectionInput[]): EdgeBarBreakdown {
  const out: EdgeBarBreakdown = {
    termBarLf: 0,
    fasciaLf: 0,
    dripEdgeLf: 0,
    gravelStopLf: 0,
    twoPieceBySize: {},
  };
  for (const s of sections) {
    for (const e of s.edges ?? []) {
      const t = e.termination;
      if (!t || t === "No Termination" || e.lengthFt <= 0) continue;
      if (t === "T-Bar") out.termBarLf += e.lengthFt;
      else if (t.includes("Fascia")) out.fasciaLf += e.lengthFt;
      else if (t.includes("Drip Edge")) out.dripEdgeLf += e.lengthFt;
      else if (t.includes("Gravel Stop")) out.gravelStopLf += e.lengthFt;
      else if (t.includes("2-pc")) {
        const size = Number.parseInt(t, 10);
        if (Number.isFinite(size))
          out.twoPieceBySize[size] = (out.twoPieceBySize[size] ?? 0) + e.lengthFt;
      }
    }
  }
  return out;
}

export interface NeededQuantities {
  /** Screws for bars/edges + insulation attachment + parapet decks (membrane rows pending). */
  screws: number;
  polyPlates: number; // parapet deck fasteners (membrane-screw plates pending row-style port)
  insulationPlates: number; // 1 per insulation screw
  caulkTubes: number;
  /** Whole units per adhesive, ceilinged once per adhesive across the estimate (§2.4). */
  adhesiveUnits: Record<string, number>;
  breakdown: {
    edgeBarScrews: number;
    twoPieceScrews: number;
    insulationScrews: number;
    parapetDeckScrews: number;
  };
}

/**
 * Aggregate the rule-backed needed quantities across the bid. Adhesive coverage entries come
 * from the admin Adhesive Times tables (area/coverage per §2.4), keyed
 * `bySubstrate[adhesiveName][substrate].coverageSqFt`.
 */
export function computeNeededQuantities(args: {
  sections: BidSectionInput[];
  parapets: { lengthFt: number }[];
  attachment: "mechanical" | "adhered";
  roofSystem: string;
  adhesiveCoverage?: Record<string, Record<string, { coverageSqFt: number }>> | undefined;
}): NeededQuantities {
  const bars = edgeBarBreakdown(args.sections);
  const barLf = bars.termBarLf + bars.fasciaLf + bars.dripEdgeLf + bars.gravelStopLf;
  const barScrews = edgeBarScrews(barLf);
  const twoPc = Object.entries(bars.twoPieceBySize).reduce(
    (sum, [size, lf]) => sum + twoPieceScrews(lf, Number(size)),
    0,
  );

  const membraneAdheredOrBond = args.attachment === "adhered" || args.roofSystem === "Duro-Bond";
  let insulationScrews = 0;
  const adhesiveRaw: Record<string, number> = {};
  for (const s of args.sections) {
    const roofArea = s.length * s.width;
    const perimLen = s.edges?.length ? perimeterFromEdges(s.edges) : s.perimLengthFt;
    const perimArea = Math.min(roofArea, perimLen * s.enhancementWidthFt);
    const fieldArea = Math.max(0, roofArea - perimArea);
    for (const layer of sectionLayers(s)) {
      const fourByFour = /4'\s?x\s?4/.test(layer.board);
      if (layer.attachment === "mechanical") {
        insulationScrews +=
          insulationFasteners(fieldArea, {
            fourByFour,
            membraneAdheredOrBond,
            perimeter: false,
          }) +
          insulationFasteners(perimArea, {
            fourByFour,
            membraneAdheredOrBond,
            perimeter: true,
          });
      } else {
        const entry = args.adhesiveCoverage?.[layer.adhesiveName]?.[layer.substrate];
        if (entry && entry.coverageSqFt > 0) {
          adhesiveRaw[layer.adhesiveName] =
            (adhesiveRaw[layer.adhesiveName] ?? 0) + roofArea / entry.coverageSqFt;
        }
      }
    }
  }

  const parapetScrews = args.parapets.reduce((sum, p) => sum + parapetDeckFasteners(p.lengthFt), 0);

  // §2.4: sum fractional units per adhesive across the whole estimate, then Ceiling ONCE.
  const adhesiveUnits: Record<string, number> = {};
  for (const [name, units] of Object.entries(adhesiveRaw)) adhesiveUnits[name] = Math.ceil(units);

  return {
    screws: barScrews + twoPc + insulationScrews + parapetScrews,
    polyPlates: parapetScrews,
    insulationPlates: insulationScrews,
    caulkTubes: caulkTubes(bars.termBarLf + bars.fasciaLf),
    adhesiveUnits,
    breakdown: {
      edgeBarScrews: barScrews,
      twoPieceScrews: twoPc,
      insulationScrews,
      parapetDeckScrews: parapetScrews,
    },
  };
}
