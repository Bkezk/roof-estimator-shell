/**
 * Per-side edge definitions — the legacy Roof Sections > Edge Options panel (sides A–D with
 * termination, wood blocking, ARP and an "Is Perimeter Edge" flag), modernized.
 *
 * What is WIRED into the money path from here (known rules only):
 *  - Perimeter derivation: the perimeter-enhancement length is the sum of the sides marked as
 *    perimeter edges (pure arithmetic; it feeds the existing perimLengthFt input).
 *  - ARP: the captured §2.3 formula (ARPSqFt = 1.03 × ((size + 6) / 12) × length, via the engine's
 *    `arpSqFt`) — subtracted from the bid's total membrane sq ft exactly as the engine models it.
 *
 * What is DISPLAY-ONLY (ordering summary, no auto-pricing): termination hardware footage and wood
 * blocking. The legacy app auto-priced terminations from per-color hardware tables with
 * drill-variant labor; that price/labor join is deliberately NOT fabricated here — until a captured
 * bid validates it, termination hardware is priced by adding Accessory / Non-DL lines.
 */

import { arpSqFt } from "./quantities";

export interface EdgeInput {
  side: string; // "A" | "B" | "C" | "D"
  lengthFt: number;
  isPerimeter: boolean; // "Is Perimeter Edge" → included in the perimeter enhancement length
  termination: string; // termination hardware label (ordering summary only)
  blockingFt: number; // wood blocking lineal ft on this edge (ordering summary only)
  arpSizeIn: number; // ARP width in inches (0 = none; 12/18/24/30) — billed via §2.3 ARPSqFt
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

/** Perimeter-enhancement length = Σ length of the edges marked "Is Perimeter Edge". */
export function perimeterFromEdges(edges: EdgeInput[]): number {
  return edges.reduce((sum, e) => sum + (e.isPerimeter ? e.lengthFt : 0), 0);
}

/** Section ARP sq ft = Σ per-edge §2.3 ARPSqFt (1.03 × ((size + 6) / 12) × length). */
export function edgesArpSqFt(edges: EdgeInput[]): number {
  return edges.reduce(
    (sum, e) => (e.arpSizeIn > 0 ? sum + arpSqFt(e.arpSizeIn, [e.lengthFt]) : sum),
    0,
  );
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
      if (e.termination && e.termination !== "No Termination" && e.lengthFt > 0) {
        byTermination.set(e.termination, (byTermination.get(e.termination) ?? 0) + e.lengthFt);
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
