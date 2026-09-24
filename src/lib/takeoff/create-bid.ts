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
      const p: Partial<ParapetInput> = {
        name: l.name,
        lengthFt: round1(l.lengthFt),
        fromTakeoff: true,
      };
      if (parapetDeck) p.deckType = parapetDeck;
      if (l.heightIn !== undefined && l.heightIn > 0) p.verticalInches = l.heightIn;
      if (setup.parapet?.heightBand) p.heightBand = setup.parapet.heightBand;
      return p;
    });

  const curbs: Array<Partial<CurbInput>> = q.counts
    .filter((c) => c.role === "curb")
    .map((c) => {
      const k: Partial<CurbInput> = { name: c.name, quantity: c.qty, fromTakeoff: true };
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

/** Pipe stack rows the seed creates carry this id prefix so an update can replace them. */
export const TAKEOFF_PIPE_ID_PREFIX = "takeoff-pipe-";

/**
 * Apply a re-measured takeoff onto an EXISTING bid (owner, Sep 24: "update the existing bid
 * linked to it"). Only what the drawing owns changes:
 *  - measured sections (`measured.source === "takeoff"`): matched by name to the new seed; a
 *    match keeps every material / labor field the estimator set and takes the new geometry
 *    (length, width, edges, corners, outline, notes); a new name is added through `newSection`;
 *    a measured section no longer in the drawing is removed. Typed sections are untouched.
 *  - parapets / curbs flagged `fromTakeoff`: matched by name the same way (parapets keep their
 *    profile and options, take length and wall height; curbs keep their style, take quantity and
 *    footprint); hand-added ones are untouched.
 *  - pipe stacks with the takeoff id prefix are replaced by the seed's.
 * Bid-level defaults, pricing, accessories, customer and everything else are left alone.
 */
export function applyTakeoffToBid(
  bid: {
    sections: BidSectionInput[];
    parapets?: ParapetInput[] | undefined;
    curbs?: CurbInput[] | undefined;
    pipeStacks?: PipeStackEntry[] | undefined;
  },
  seed: TakeoffBidSeed,
  make: {
    newSection: (defaults: Partial<BidSectionInput>) => BidSectionInput;
    newParapet: (defaults: Partial<ParapetInput>) => ParapetInput;
    newCurb: (defaults: Partial<CurbInput>) => CurbInput;
  },
): {
  sections: BidSectionInput[];
  parapets: ParapetInput[];
  curbs: CurbInput[];
  pipeStacks: PipeStackEntry[];
  changes: string[];
} {
  const changes: string[] = [];
  const key = (n: string | undefined) => (n ?? "").trim().toLowerCase();

  // Sections
  const seedByName = new Map(seed.sections.map((o) => [key(o.name), o] as const));
  const used = new Set<string>();
  const sections: BidSectionInput[] = [];
  for (const s of bid.sections) {
    if (s.measured?.source !== "takeoff") {
      sections.push(s);
      continue;
    }
    const o = seedByName.get(key(s.name));
    if (!o || used.has(key(s.name))) {
      changes.push(`Removed section "${s.name}" (no longer in the drawing).`);
      continue;
    }
    used.add(key(s.name));
    const next: BidSectionInput = { ...s };
    if (o.length !== undefined) next.length = o.length;
    if (o.width !== undefined) next.width = o.width;
    if (o.edges) next.edges = o.edges;
    if (o.perimCorners) next.perimCorners = o.perimCorners;
    if (o.measured) next.measured = o.measured;
    if (o.notes !== undefined) next.notes = o.notes;
    sections.push(next);
    changes.push(`Re-measured section "${s.name}".`);
  }
  for (const o of seed.sections) {
    if (used.has(key(o.name))) continue;
    used.add(key(o.name));
    sections.push(make.newSection({ ...seed.sectionDefaults, ...o }));
    changes.push(`Added section "${o.name ?? "Section"}" from the drawing.`);
  }

  // Parapets
  const pSeed = new Map(seed.parapets.map((o) => [key(o.name), o] as const));
  const pUsed = new Set<string>();
  const parapets: ParapetInput[] = [];
  for (const p of bid.parapets ?? []) {
    if (!p.fromTakeoff) {
      parapets.push(p);
      continue;
    }
    const o = pSeed.get(key(p.name));
    if (!o || pUsed.has(key(p.name))) {
      changes.push(`Removed parapet "${p.name}" (no longer in the drawing).`);
      continue;
    }
    pUsed.add(key(p.name));
    const next: ParapetInput = { ...p };
    if (o.lengthFt !== undefined) next.lengthFt = o.lengthFt;
    if (o.verticalInches !== undefined) next.verticalInches = o.verticalInches;
    parapets.push(next);
    changes.push(`Re-measured parapet "${p.name}".`);
  }
  for (const o of seed.parapets) {
    if (pUsed.has(key(o.name))) continue;
    pUsed.add(key(o.name));
    parapets.push(make.newParapet(o));
    changes.push(`Added parapet "${o.name ?? "Parapet"}" from the drawing.`);
  }

  // Curbs
  const cSeed = new Map(seed.curbs.map((o) => [key(o.name), o] as const));
  const cUsed = new Set<string>();
  const curbs: CurbInput[] = [];
  for (const c of bid.curbs ?? []) {
    if (!c.fromTakeoff) {
      curbs.push(c);
      continue;
    }
    const o = cSeed.get(key(c.name));
    if (!o || cUsed.has(key(c.name))) {
      changes.push(`Removed curb "${c.name}" (no longer in the drawing).`);
      continue;
    }
    cUsed.add(key(c.name));
    const next: CurbInput = { ...c };
    if (o.quantity !== undefined) next.quantity = o.quantity;
    if (o.widthIn !== undefined) next.widthIn = o.widthIn;
    if (o.lengthIn !== undefined) next.lengthIn = o.lengthIn;
    curbs.push(next);
    changes.push(`Re-counted curb "${c.name}".`);
  }
  for (const o of seed.curbs) {
    if (cUsed.has(key(o.name))) continue;
    cUsed.add(key(o.name));
    curbs.push(make.newCurb(o));
    changes.push(`Added curb "${o.name ?? "Curb"}" from the drawing.`);
  }

  // Pipe stacks
  const kept = (bid.pipeStacks ?? []).filter((x) => !x.id.startsWith(TAKEOFF_PIPE_ID_PREFIX));
  const pipeStacks = [...kept, ...seed.pipeStacks];
  if (seed.pipeStacks.length || kept.length !== (bid.pipeStacks ?? []).length)
    changes.push(`Pipe stacks from the drawing: ${seed.pipeStacks.length} row(s).`);

  return { sections, parapets, curbs, pipeStacks, changes };
}
