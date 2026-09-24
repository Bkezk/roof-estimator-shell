/**
 * Takeoff → bid seed (phase 2 of docs/planswift-research.md §4.6) — pure, no I/O.
 *
 * `bidSeedFromTakeoff` turns the up-front material answers plus the measured quantities into
 * the pieces the estimator needs to open a NEW bid with as much filled in as the drawing allows:
 * bid-level defaults, one section per drawn area (the measured outline, its edges, corners and
 * the section-level material answers), one parapet per parapet run, curbs and pipe stacks from
 * the counts, and a list of what could not be placed automatically (drains need a roof type and
 * boot / ring picks from the reference lists; gutters, expansion joints, walkway pads, vents,
 * scuppers and "other" objects have no single home in the estimator) so the estimator can add
 * them by hand with the measured numbers in front of them.
 */

import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
import type { PipeStackEntry } from "@/lib/engine/accessories";
import type { Attachment } from "@/lib/engine/estimate";
import {
  COUNT_ROLE_LABELS,
  LINEAR_ROLE_LABELS,
  type TakeoffQuantities,
  type TakeoffSetup,
} from "./model";

export interface TakeoffBidSeed {
  roofSystem?: string;
  attachment?: Attachment;
  membraneAdhesiveName?: string;
  /** For SavedBidState.sectionDefaults (new sections the estimator adds later). */
  sectionDefaults: {
    deckType?: string;
    thickness?: number;
    color?: string;
    sheetSizeLabel?: string;
    designTable?: number;
  };
  parapetDefaults: {
    roofSystem?: string;
    attachment?: Attachment;
    membraneAdhesiveName?: string;
  };
  /** Overrides for the estimator's `newSection(defaults)` factory, one per drawn area. */
  sections: Array<Partial<BidSectionInput>>;
  /** Overrides for `newParapet(defaults)`, one per parapet run. */
  parapets: Array<Partial<ParapetInput>>;
  /** Overrides for `newCurb(defaults)`, one per curb count group. */
  curbs: Array<Partial<CurbInput>>;
  /** Pipe stack rows for AccessoriesState.pipeStacks (usage Plumbing, closed, the bid colour). */
  pipeStacks: PipeStackEntry[];
  /** Measured things the estimator must place by hand, with their numbers. */
  unmapped: Array<{ label: string; detail: string }>;
  /** Free-text summary of the drawing for the bid's notes. */
  summary: string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const ftIn = (ft: number): string => {
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  return inches === 0
    ? `${whole} ft`
    : inches === 12
      ? `${whole + 1} ft`
      : `${whole} ft ${inches} in`;
};

export function bidSeedFromTakeoff(
  setup: TakeoffSetup,
  q: TakeoffQuantities,
  opts: { takeoffName?: string } = {},
): TakeoffBidSeed {
  const sectionDefaults: TakeoffBidSeed["sectionDefaults"] = {};
  if (setup.deckType) sectionDefaults.deckType = setup.deckType;
  if (setup.thickness) sectionDefaults.thickness = setup.thickness;
  if (setup.color) sectionDefaults.color = setup.color;
  if (setup.sheetSizeLabel) sectionDefaults.sheetSizeLabel = setup.sheetSizeLabel;
  if (setup.designTable) sectionDefaults.designTable = setup.designTable;

  const parapetDefaults: TakeoffBidSeed["parapetDefaults"] = {};
  if (setup.parapet?.roofSystem) parapetDefaults.roofSystem = setup.parapet.roofSystem;
  if (setup.parapet?.attachment) parapetDefaults.attachment = setup.parapet.attachment;
  if (setup.parapet?.membraneAdhesiveName)
    parapetDefaults.membraneAdhesiveName = setup.parapet.membraneAdhesiveName;

  const sections: Array<Partial<BidSectionInput>> = q.sections.map((s) => {
    const o: Partial<BidSectionInput> = {
      name: s.name,
      length: s.section.length,
      width: s.section.width,
      edges: s.section.edges,
      perimCorners: s.section.perimCorners,
      measured: s.section.measured,
      ...sectionDefaults,
    };
    if (setup.fieldLap) o.fieldLap = setup.fieldLap;
    if (setup.pullTest) o.pullTest = setup.pullTest;
    if (setup.layers?.length) o.layers = setup.layers;
    o.notes = `Measured in Takeoff: ${round1(s.areaSqFt)} sq ft, ${round1(s.perimeterFt)} ft around, ${s.section.edges.length} sides.`;
    return o;
  });

  const parapetDeck = setup.parapet?.deckType ?? setup.deckType;
  const parapets: Array<Partial<ParapetInput>> = q.linears
    .filter((l) => l.role === "parapet")
    .map((l) => {
      const p: Partial<ParapetInput> = { name: l.name, lengthFt: round1(l.lengthFt) };
      if (parapetDeck) p.deckType = parapetDeck;
      if (l.heightIn !== undefined && l.heightIn > 0) p.verticalInches = l.heightIn;
      if (setup.parapet?.heightBand) p.heightBand = setup.parapet.heightBand;
      return p;
    });

  const curbs: Array<Partial<CurbInput>> = q.counts
    .filter((c) => c.role === "curb")
    .map((c) => {
      const k: Partial<CurbInput> = { name: c.name, quantity: c.qty };
      if (c.widthIn) k.widthIn = c.widthIn;
      if (c.lengthIn) k.lengthIn = c.lengthIn;
      if (setup.deckType) k.deckType = setup.deckType;
      return k;
    });

  const pipeStacks: PipeStackEntry[] = q.counts
    .filter((c) => c.role === "pipe" && c.sizeIn !== undefined && c.sizeIn > 0)
    .map((c, i) => ({
      id: `takeoff-pipe-${i + 1}`,
      usage: "Plumbing",
      color: setup.color ?? "White",
      open: false,
      size: c.sizeIn!,
      quantity: c.qty,
      adjustPct: 0,
    }));

  const unmapped: TakeoffBidSeed["unmapped"] = [];
  for (const c of q.counts) {
    if (c.role === "curb") continue;
    if (c.role === "pipe" && c.sizeIn !== undefined && c.sizeIn > 0) continue;
    const size = c.sizeIn ? ` (${c.sizeIn} in)` : "";
    const where =
      c.role === "drain"
        ? "Accessories › Roof Drains & Boots (pick the roof type, boot and ring)"
        : c.role === "pipe"
          ? "Accessories › Pipe Stacks (no size was given)"
          : c.role === "vent"
            ? "Accessories › Vents"
            : c.role === "scupper"
              ? "Metals or Non-DL, as quoted"
              : "wherever it belongs";
    unmapped.push({
      label: `${c.qty} × ${c.name}${size}`,
      detail: `${COUNT_ROLE_LABELS[c.role]} — add on ${where}.`,
    });
  }
  for (const l of q.linears) {
    if (l.role === "parapet") continue;
    unmapped.push({
      label: `${l.name}: ${ftIn(l.lengthFt)}`,
      detail: `${LINEAR_ROLE_LABELS[l.role]} — ${
        l.role === "gutter"
          ? "add on Metals › Gutters"
          : l.role === "walkway"
            ? "add on Accessories › Walk Pads"
            : "add as a Non-DL or custom line"
      }.`,
    });
  }
  for (const u of q.unscaled) {
    unmapped.push({
      label: u.name,
      detail: `Drawn on a page with no scale (page ${u.page + 1}) — not measured.`,
    });
  }

  const summaryParts = [
    `${q.sections.length} section${q.sections.length === 1 ? "" : "s"}, ${round1(q.totals.roofAreaSqFt)} sq ft, ${round1(q.totals.perimeterFt)} ft of roof edge`,
    q.totals.parapetFt > 0 ? `${round1(q.totals.parapetFt)} ft of parapet` : null,
    q.counts.length ? q.counts.map((c) => `${c.qty} ${c.name}`).join(", ") : null,
  ].filter((x): x is string => !!x);

  const seed: TakeoffBidSeed = {
    sectionDefaults,
    parapetDefaults,
    sections,
    parapets,
    curbs,
    pipeStacks,
    unmapped,
    summary: `${opts.takeoffName ? `From takeoff "${opts.takeoffName}"` : "From a takeoff"}: ${summaryParts.join("; ")}.`,
  };
  if (setup.roofSystem) seed.roofSystem = setup.roofSystem;
  if (setup.attachment) seed.attachment = setup.attachment;
  if (setup.membraneAdhesiveName) seed.membraneAdhesiveName = setup.membraneAdhesiveName;
  return seed;
}
