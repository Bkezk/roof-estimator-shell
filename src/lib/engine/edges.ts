/**
 * Per-side edge definitions — the legacy Roof Sections > Edge Options panel (sides A–D with
 * "Is Perimeter Edge" + perimeter side length, termination + length, ARP + length, wood blocking +
 * length and the "w/ Wall > 2ft" flag), modelled on the RoofSection IL (docs §16).
 *
 * What is WIRED into the money path from here (IL-exact):
 *  - Perimeter geometry (`RoofSection.PerimTotalLength`, `PerimSideLengthMinusCorners_4_0_230`):
 *    Σ over perimeter sides of max(0, PerimSideLength − W per marked adjacent corner), where W is
 *    the perimeter enhancement width and corner i sits between side i and side i+1 (corner 0 =
 *    A∧B … corner 3 = D∧A). Corner length (`CornerTotalLength`) = Σ marked corners × W.
 *  - ARP: `ARPSqFt` = 1.03 × Σ ((size + 6) / 12) × ARPLength[side] (via the engine's `arpSqFt`).
 *  - Termination / blocking lengths feed the §12 Accessories screens (roof-edge feet by
 *    termination id) and the §14 Non-DL edge-blocking auto quantity.
 */

import { arpSqFt } from "./quantities";

export interface EdgeInput {
  side: string; // "A" | "B" | "C" | "D"
  /** Side length (ft). Legacy: A/C = section Length, B/D = section Width. */
  lengthFt: number;
  isPerimeter: boolean; // "Is Perimeter Edge" → included in the perimeter enhancement length
  /**
   * Legacy PerimSideLength (ft): the perimeter-enhanced run along this side (txtPerimA..D; set to
   * the side length when the edge is marked perimeter). Absent = the side length.
   */
  perimLengthFt?: number;
  termination: string; // termination hardware label ("No Termination" = none)
  /** Legacy TerminationWidth (ft) — the termination run. Absent = the side length. */
  termLengthFt?: number;
  /** Wood blocking lineal ft on this edge (legacy BlockingWidth; 0 = no blocking). */
  blockingFt: number;
  arpSizeIn: number; // ARP width in inches (0 = none; 12/18/24/30) — billed via §2.3 ARPSqFt
  /** Legacy ARPLength (ft). Absent = the side length. */
  arpLengthFt?: number;
  /** Legacy SideHas2ftWall ("w/ Wall > 2ft"). Persisted; no money callers in the legacy IL. */
  hasTallWall?: boolean;
}

/** The legacy Edge Options termination list (Roof Sections tab). */
export const TERMINATION_OPTIONS = [
  "No Termination",
  "T-Bar",
  '1-3/4" Fascia',
  '4" Fascia',
  '2" Gravel Stop',
  '4" Gravel Stop',
  '2" Drip Edge',
  '4" Drip Edge',
  '3" 2-pc Metal',
  '4" 2-pc Metal',
  '5" 2-pc Metal',
  '6" 2-pc Metal',
  '7" 2-pc Metal',
  '8" 2-pc Metal',
] as const;

/** The legacy ARP width options (inches); 0 = no ARP. */
export const ARP_SIZE_OPTIONS = [0, 12, 18, 24, 30] as const;

export const EDGE_SIDES = ["A", "B", "C", "D"] as const;

/** Four edges for a rectangular section: A/C run the length, B/D run the width. */
export function defaultEdges(length: number, width: number): EdgeInput[] {
  const blank = { isPerimeter: false, termination: "No Termination", blockingFt: 0, arpSizeIn: 0 };
  return [
    { side: "A", lengthFt: length, ...blank },
    { side: "B", lengthFt: width, ...blank },
    { side: "C", lengthFt: length, ...blank },
    { side: "D", lengthFt: width, ...blank },
  ];
}

/** Legacy PerimSideLength for one edge: 0 unless the edge is a perimeter edge. */
export function edgePerimLength(e: EdgeInput): number {
  return e.isPerimeter ? (e.perimLengthFt ?? e.lengthFt) : 0;
}

/** Legacy TerminationWidth: the termination run (defaults to the side length). */
export function edgeTermLength(e: EdgeInput): number {
  return e.termLengthFt ?? e.lengthFt;
}

/** Legacy ARPLength: the ARP run (defaults to the side length). */
export function edgeArpLength(e: EdgeInput): number {
  return e.arpLengthFt ?? e.lengthFt;
}

/** Side index (A=0 … D=3) of an edge; unknown sides sort last. */
export function edgeSideIndex(e: EdgeInput): number {
  const i = EDGE_SIDES.indexOf(e.side as (typeof EDGE_SIDES)[number]);
  return i === -1 ? 4 : i;
}

/**
 * Corner flags, one per side slot: corner i sits between side i and side i+1 (the last corner
 * closes the ring). A typed rectangle has four (legacy IsPerimCorner(0..3)); a measured outline
 * from Takeoff has one per drawn side.
 */
export type PerimCorners = boolean[];

/**
 * True for the legacy lettered edge set (≤ 4 edges, every side one of A–D). A measured outline
 * (Takeoff) names its sides "1".."N" instead and can have any number of them.
 */
export function isLetteredEdges(edges: EdgeInput[]): boolean {
  return (
    edges.length <= 4 &&
    edges.every((e) => EDGE_SIDES.includes(e.side as (typeof EDGE_SIDES)[number]))
  );
}

/**
 * The section's side slots as a ring. Lettered edges fill the four legacy slots A..D (a missing
 * letter is an inert slot, so older bids with fewer edges behave as before); a measured outline
 * is its edges in drawing order. Corner i lies between slot i and slot i+1 (mod ring length).
 */
export function sideRing(edges: EdgeInput[]): Array<EdgeInput | undefined> {
  if (!isLetteredEdges(edges)) return edges;
  const ring: Array<EdgeInput | undefined> = [undefined, undefined, undefined, undefined];
  for (const e of edges) ring[edgeSideIndex(e)] = e;
  return ring;
}

/**
 * Legacy frmRoofSection.CheckCorners: corner i is offered only while BOTH adjacent sides are
 * perimeter edges (corner 0 = A∧B, 1 = B∧C, 2 = C∧D, 3 = D∧A); a hidden corner is unchecked.
 * On a measured ring the same rule runs over N slots.
 */
export function availableCorners(edges: EdgeInput[]): PerimCorners {
  const ring = sideRing(edges);
  const n = ring.length;
  return ring.map((e, i) => (e?.isPerimeter ?? false) && (ring[(i + 1) % n]?.isPerimeter ?? false));
}

/** The corners that actually count: marked AND still available (both adjacent sides perimeter). */
export function effectiveCorners(
  edges: EdgeInput[],
  corners: readonly boolean[] | undefined,
): PerimCorners {
  const avail = availableCorners(edges);
  return avail.map((a, i) => a && (corners?.[i] ?? false));
}

/**
 * Legacy `RoofSection.PerimTotalLength` (≥ 4.0.230): Σ over perimeter sides of
 * max(0, PerimSideLength − W × [corner i] − W × [corner i−1]) — the two corners touching side i
 * are i and (i + 3) mod 4 (A: 0 & 3, B: 1 & 0, C: 2 & 1, D: 3 & 2), each removing one enhancement
 * width W so the corner squares are not counted twice. With no corner data (older saved bids /
 * edge-less sections) the corners subtract nothing.
 */
export function perimeterFromEdges(
  edges: EdgeInput[],
  zone?: { enhancementWidthFt: number; corners?: readonly boolean[] | undefined },
): number {
  const ring = sideRing(edges);
  const n = ring.length;
  const corners = zone ? effectiveCorners(edges, zone.corners) : ring.map(() => false);
  const w = zone?.enhancementWidthFt ?? 0;
  let total = 0;
  ring.forEach((e, i) => {
    if (!e?.isPerimeter) return;
    let len = edgePerimLength(e);
    if (corners[i]) len -= w;
    if (corners[(i + n - 1) % n]) len -= w;
    total += Math.max(0, len);
  });
  return total;
}

/** Legacy `CornerTotalLength`: Σ marked (and available) corners × enhancement width. */
export function cornerLengthFromEdges(
  edges: EdgeInput[],
  enhancementWidthFt: number,
  corners: readonly boolean[] | undefined,
): number {
  return effectiveCorners(edges, corners).filter(Boolean).length * enhancementWidthFt;
}

/** Section ARP sq ft = Σ per-edge §2.3 ARPSqFt (1.03 × ((size + 6) / 12) × ARPLength). */
export function edgesArpSqFt(edges: EdgeInput[]): number {
  return edges.reduce(
    (sum, e) => (e.arpSizeIn > 0 ? sum + arpSqFt(e.arpSizeIn, [edgeArpLength(e)]) : sum),
    0,
  );
}

/** The four legacy side slots (A..D) with their corner flags, as the 4-sided legacy calcs read them. */
export interface LegacyFourSides {
  /** Slot A..D: the edge on that side, or undefined for an inert slot. */
  sides: [
    EdgeInput | undefined,
    EdgeInput | undefined,
    EdgeInput | undefined,
    EdgeInput | undefined,
  ];
  /** IsPerimCorner(0..3): corner i between slot i and i+1, effective (marked AND available). */
  corners: [boolean, boolean, boolean, boolean];
}

/**
 * What the legacy 4-sided membrane routines (RollGoodsMembraneCalc's per-side perimeter rows,
 * DuroTuffSystem.CalculateMembraneQty, the §2.2 row-style fastener counts) see for a section.
 *
 * Lettered edges pass straight through by slot: exact legacy behaviour. A measured outline with
 * N sides has no A..D, so it is represented on its equivalent rectangle (`rect` = the section's
 * length × width, which the Takeoff mapping sets to the rectangle of the same area and
 * perimeter): the share of the outline marked as perimeter is rounded to 0..4 synthetic
 * perimeter sides filled in ring order A, B, C, D (each running its full rectangle side), and
 * the outline's effective corners are placed, up to that many, on the corner slots those
 * synthetic sides make available. Only the seam / perimeter-row layout terms depend on this;
 * the zone lengths, ARP, terminations and blocking always use the real edges.
 */
export function legacyFourSides(
  edges: EdgeInput[] | undefined,
  corners: readonly boolean[] | undefined,
  rect: { length: number; width: number },
): LegacyFourSides {
  const list = edges ?? [];
  if (isLetteredEdges(list)) {
    const ring = sideRing(list);
    const eff = effectiveCorners(list, corners);
    return {
      sides: [ring[0], ring[1], ring[2], ring[3]],
      corners: [eff[0] ?? false, eff[1] ?? false, eff[2] ?? false, eff[3] ?? false],
    };
  }
  const totalLen = list.reduce((s, e) => s + e.lengthFt, 0);
  const perimLen = list.reduce((s, e) => s + edgePerimLength(e), 0);
  const k = totalLen > 0 ? Math.min(4, Math.max(0, Math.round((4 * perimLen) / totalLen))) : 0;
  const blank = { termination: "No Termination", blockingFt: 0, arpSizeIn: 0 };
  const sides = EDGE_SIDES.map((side, i) => {
    const lengthFt = i % 2 === 0 ? rect.length : rect.width;
    const isPerimeter = i < k;
    return {
      side,
      lengthFt,
      isPerimeter,
      perimLengthFt: isPerimeter ? lengthFt : 0,
      ...blank,
    } satisfies EdgeInput;
  }) as unknown as LegacyFourSides["sides"];
  let remaining = effectiveCorners(list, corners).filter(Boolean).length;
  const out: boolean[] = [false, false, false, false];
  for (let i = 0; i < 4 && remaining > 0; i++) {
    if (sides[i]?.isPerimeter && sides[(i + 1) % 4]?.isPerimeter) {
      out[i] = true;
      remaining--;
    }
  }
  return { sides, corners: out as LegacyFourSides["corners"] };
}

/** Minimal section shape for the perimeter / corner zone lengths. */
export interface ZoneSource {
  edges?: EdgeInput[] | undefined;
  perimLengthFt: number;
  cornerLengthFt: number;
  enhancementWidthFt: number;
  perimCorners?: readonly boolean[] | undefined;
}

/**
 * The section's perimeter and corner enhancement lengths (ft). With per-side edges defined the
 * legacy geometry above is the source of truth (corner length derives from the corner flags;
 * without any corner data the manual cornerLengthFt is kept for older bids); without edges the
 * manual perimLengthFt / cornerLengthFt inputs are used verbatim.
 */
export function resolveSectionZones(s: ZoneSource): {
  perimLengthFt: number;
  cornerLengthFt: number;
} {
  if (!s.edges?.length) return { perimLengthFt: s.perimLengthFt, cornerLengthFt: s.cornerLengthFt };
  const perimLengthFt = perimeterFromEdges(s.edges, {
    enhancementWidthFt: s.enhancementWidthFt,
    corners: s.perimCorners,
  });
  const cornerLengthFt = s.perimCorners
    ? cornerLengthFromEdges(s.edges, s.enhancementWidthFt, s.perimCorners)
    : s.cornerLengthFt;
  return { perimLengthFt, cornerLengthFt };
}

export interface EdgeSummary {
  /** Total footage per termination type (excluding "No Termination"), in first-seen order. */
  terminations: Array<{ termination: string; totalFt: number }>;
  /** Total wood-blocking lineal ft across all edges. */
  blockingFt: number;
  /** Total ARP sq ft across all edges (§2.3). */
  arpSqFtTotal: number;
}

/** Aggregate the edge definitions of every section into an ordering summary. */
export function summarizeEdges(sectionEdges: EdgeInput[][]): EdgeSummary {
  const byTermination = new Map<string, number>();
  let blockingFt = 0;
  let arpSqFtTotal = 0;
  for (const edges of sectionEdges) {
    for (const e of edges) {
      const termFt = edgeTermLength(e);
      if (e.termination && e.termination !== "No Termination" && termFt > 0) {
        byTermination.set(e.termination, (byTermination.get(e.termination) ?? 0) + termFt);
      }
      blockingFt += e.blockingFt;
    }
    arpSqFtTotal += edgesArpSqFt(edges);
  }
  return {
    terminations: [...byTermination.entries()].map(([termination, totalFt]) => ({
      termination,
      totalFt,
    })),
    blockingFt,
    arpSqFtTotal,
  };
}
