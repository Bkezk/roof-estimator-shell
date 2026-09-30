/**
 * Takeoff → bid seed (phase 2 of docs/planswift-research.md §4.6) — pure, no I/O.
 *
 * `bidSeedFromTakeoff` turns the up-front material answers plus the measured quantities into
 * the pieces the estimator needs to open a NEW bid with as much filled in as the drawing allows:
 * bid-level defaults, one section per drawn area (the measured outline, its edges — parapet and
 * gutter sides as the "Edge from this area" lines say, rakes sloped on a pitched area — corners
 * and the section-level material answers), one parapet per parapet run, curbs (a blank size when
 * the count has none), pipe stacks from sized pipe counts, drains with their boot / ring, and a
 * list of what could not be placed automatically (unsized pipes and curbs, drains without picks,
 * gutters, expansion joints, walkway pads, vents, scuppers, cut-out walls and "other" objects) so
 * the estimator can add them by hand with the measured numbers in front of them.
 *
 * `applyTakeoffToBid` re-applies a re-measured takeoff to an existing bid: it matches what it
 * seeded by the takeoff object id it stored on each item (falling back to the wall's area sides,
 * then the name, for older bids), re-measures the numbers and keeps the estimator's edits.
 *
 * The estimating engine (src/lib/engine) is not touched: this only fills its inputs.
 */

import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
import type { DrainEntry, PipeStackEntry } from "@/lib/engine/accessories";
import type { EdgeInput } from "@/lib/engine/edges";
import type { Attachment } from "@/lib/engine/estimate";
import type { SavedBidState } from "@/lib/proposal-bid";
import {
  COUNT_ROLE_LABELS,
  LINEAR_ROLE_LABELS,
  type CountRole,
  type LinearRole,
  type SectionQuantity,
  type TakeoffQuantities,
  type TakeoffSetup,
} from "./model";
import { parapetFromDefaults } from "./seed-to-bid";

/**
 * What a seeded bid item remembers of the takeoff object(s) it came from (saved with the bid as
 * extra JSON on the item; the engine ignores it). An update matches by it, so renaming an area
 * or re-making edge lines keeps the estimator's edits.
 */
export interface TakeoffLink {
  /** The takeoff object's id (a count group: its first object). */
  takeoffObjectId?: string;
  /** A count group: every object in it. */
  takeoffObjectIds?: string[];
}
/** The per-side details a seeded section started with (to tell the estimator's edits apart). */
export type SeededEdgeDetails = Pick<
  EdgeInput,
  "isPerimeter" | "termination" | "blockingFt" | "arpSizeIn" | "hasTallWall"
>;
/**
 * A seeded section also remembers, per side (bid edge order), the takeoff role along it and the
 * edge details the seed gave it — so an update can tell a changed side, and the estimator's
 * edits, from the takeoff's.
 */
export type SeededSection = Partial<BidSectionInput> &
  TakeoffLink & {
    takeoffSideRoles?: Array<LinearRole | null>;
    takeoffSeededEdges?: SeededEdgeDetails[];
  };
/** A seeded parapet also remembers the area sides it runs along ("<areaId>:<sides>"). */
export type SeededParapet = Partial<ParapetInput> & TakeoffLink & { takeoffEdgeKey?: string };
export type SeededCurb = Partial<CurbInput> & TakeoffLink;
export type SeededPipeStack = PipeStackEntry & TakeoffLink;
export type SeededDrain = DrainEntry & TakeoffLink;

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
  sections: SeededSection[];
  /** Overrides for `newParapet(defaults)`, one per parapet run. */
  parapets: SeededParapet[];
  /** Overrides for `newCurb(defaults)`, one per curb count group. */
  curbs: SeededCurb[];
  /** Pipe stack rows for AccessoriesState.pipeStacks (usage Plumbing, closed, the bid colour). */
  pipeStacks: SeededPipeStack[];
  /** Drain rows for AccessoriesState.drains — only drains with a boot AND ring picked. */
  drains: SeededDrain[];
  /** Measured things the estimator must place by hand, with their numbers. */
  unmapped: Array<{ label: string; detail: string }>;
  /** Free-text summary of the drawing for the bid's notes. */
  summary: string;
  /** The takeoff Setup's free-text notes, for the bid's notes (see `withTakeoffNotes`). */
  setupNotes?: string;
  /**
   * The customer profile the takeoff is linked to: a NEW bid starts linked to it (owner, Sep
   * 30: the takeoff holds the building plans, so it belongs to the customer). Absent = none.
   */
  accountId?: string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const seededDetails = (e: EdgeInput): SeededEdgeDetails => {
  const d: SeededEdgeDetails = {
    isPerimeter: e.isPerimeter,
    termination: e.termination,
    blockingFt: e.blockingFt,
    arpSizeIn: e.arpSizeIn,
  };
  if (e.hasTallWall) d.hasTallWall = true;
  return d;
};
const num = (x: number) => round1(x).toLocaleString("en-US", { maximumFractionDigits: 1 });
const ftIn = (ft: number): string => {
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  return inches === 0
    ? `${whole} ft`
    : inches === 12
      ? `${whole + 1} ft`
      : `${whole} ft ${inches} in`;
};
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** The start of the one line a seeded section's note carries (kept up to date on re-apply). */
export const MEASURED_NOTE_PREFIX = "Measured in Takeoff:";
/** The start of the line the takeoff Setup's notes take in the bid's notes. */
export const TAKEOFF_NOTES_PREFIX = "Takeoff notes:";

/** `existing` with the line starting `prefix` replaced by `line` (appended when absent). */
function withLine(existing: string | undefined, prefix: string, line: string): string {
  const text = existing ?? "";
  if (!text.trim()) return line;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trimStart().startsWith(prefix));
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  return lines.join("\n");
}

/** A section's notes with its "Measured in Takeoff: …" line updated; the rest kept. */
export function withMeasuredNote(existing: string | undefined, line: string): string {
  return withLine(existing, MEASURED_NOTE_PREFIX, line);
}

/**
 * The bid's notes with the takeoff Setup's notes carried once, as one "Takeoff notes: …" line
 * (replaced, never duplicated, when the takeoff is applied again). Blank setup notes change
 * nothing.
 */
export function withTakeoffNotes(existing: string | undefined, setupNotes: string | undefined) {
  const text = (setupNotes ?? "").replace(/\s*\n\s*/g, " ").trim();
  if (!text) return existing ?? "";
  return withLine(existing, TAKEOFF_NOTES_PREFIX, `${TAKEOFF_NOTES_PREFIX} ${text}`);
}

/** How the summary names a count role's items ("4 drains"). */
const COUNT_NOUNS: Record<CountRole, string> = {
  drain: "drain",
  curb: "curb",
  pipe: "pipe",
  vent: "vent",
  scupper: "scupper",
  other: "other item",
};
const SUMMARY_COUNT_ORDER: CountRole[] = ["drain", "curb", "pipe", "vent", "scupper", "other"];

/** The note line of a measured section (one line: an update replaces just this line). */
function measuredNote(s: SectionQuantity): string {
  const labels = s.section.edges.map((e) => e.side);
  const area =
    s.slopeFactor !== 1 && s.pitch !== undefined
      ? ` (${round1(s.planAreaSqFt)} sq ft on plan at ${s.pitch}:12, ×${s.slopeFactor.toFixed(3)})`
      : "";
  const cut =
    s.cutoutAreaSqFt > 0
      ? ` (${round1(s.outlineAreaSqFt)} sq ft outline less ${round1(s.cutoutAreaSqFt)} sq ft of cut-outs; layout ${round1(s.section.length)} × ${round1(s.section.width)} ft is the net-area equivalent, the sides stay as drawn)`
      : "";
  const around =
    s.rakeSides.length && s.rakeNote
      ? `${round1(s.slopedPerimeterFt)} ft around (${round1(s.perimeterFt)} ft on plan; ${s.rakeNote})`
      : `${round1(s.slopedPerimeterFt)} ft around`;
  const extra: string[] = [];
  const walls = s.cutoutPerimetersFt.reduce((t, l) => t + l, 0);
  if (walls > 0) extra.push(`penthouse walls ${round1(walls)} ft (not seeded)`);
  for (const role of ["parapet", "gutter"] as const) {
    const sides = labels.filter((_, k) => s.edgeRoles[k] === role);
    if (sides.length)
      extra.push(
        `${LINEAR_ROLE_LABELS[role].toLowerCase()} ${plural(sides.length, "side")} ${sides.join(", ")}`,
      );
  }
  return `${MEASURED_NOTE_PREFIX} ${round1(s.areaSqFt)} sq ft${area}${cut}, ${around}, ${s.section.edges.length} sides${
    extra.length ? `; ${extra.join("; ")}` : ""
  }.`;
}

export function bidSeedFromTakeoff(
  setup: TakeoffSetup,
  q: TakeoffQuantities,
  opts: { takeoffName?: string; accountId?: string | null } = {},
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

  const sections: SeededSection[] = q.sections.map((s) => {
    const o: SeededSection = {
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
    o.notes = measuredNote(s);
    o.takeoffObjectId = s.objectId;
    o.takeoffSideRoles = s.edgeRoles;
    o.takeoffSeededEdges = s.section.edges.map(seededDetails);
    return o;
  });

  const parapetDeck = setup.parapet?.deckType ?? setup.deckType;
  const parapets: SeededParapet[] = q.linears
    .filter((l) => l.role === "parapet")
    .map((l) => {
      const p: SeededParapet = {
        name: l.name,
        lengthFt: round1(l.lengthFt),
        fromTakeoff: true,
        takeoffObjectId: l.objectId,
      };
      if (l.edgeOf) p.takeoffEdgeKey = `${l.edgeOf.areaId}:${l.edgeOf.sides.join(",")}`;
      if (parapetDeck) p.deckType = parapetDeck;
      if (l.heightIn !== undefined && l.heightIn > 0) p.verticalInches = l.heightIn;
      if (setup.parapet?.heightBand) p.heightBand = setup.parapet.heightBand;
      return p;
    });

  const link = (c: TakeoffQuantities["counts"][number]): TakeoffLink =>
    c.objectIds.length
      ? { takeoffObjectId: c.objectIds[0]!, takeoffObjectIds: [...c.objectIds] }
      : {};

  // A curb count without a size is carried with a BLANK size (0 × 0: the Curbs screen marks it
  // and it prices as nothing) and listed on the notice — never the 1 × 1 in factory default.
  const curbSized = (c: TakeoffQuantities["counts"][number]) => !!c.widthIn && !!c.lengthIn;
  const curbs: SeededCurb[] = q.counts
    .filter((c) => c.role === "curb")
    .map((c) => {
      const k: SeededCurb = {
        name: c.name,
        quantity: c.qty,
        fromTakeoff: true,
        widthIn: c.widthIn ?? 0,
        lengthIn: c.lengthIn ?? 0,
        ...link(c),
      };
      if (c.heightIn) k.dimCIn = c.heightIn;
      if (setup.deckType) k.deckType = setup.deckType;
      return k;
    });

  const pipeSized = (c: TakeoffQuantities["counts"][number]) =>
    c.role === "pipe" && c.sizeIn !== undefined && c.sizeIn > 0;
  const pipeStacks: SeededPipeStack[] = q.counts.filter(pipeSized).map((c, i) => ({
    id: `${TAKEOFF_PIPE_ID_PREFIX}${i + 1}`,
    usage: "Plumbing",
    color: setup.color ?? "White",
    open: false,
    size: c.sizeIn!,
    quantity: c.qty,
    adjustPct: 0,
    ...link(c),
  }));

  const drainReady = (c: TakeoffQuantities["counts"][number]) =>
    c.role === "drain" && !!c.bootSize && !!c.ringSize;
  const drains: SeededDrain[] = q.counts.filter(drainReady).map((c, i) => ({
    id: `${TAKEOFF_DRAIN_ID_PREFIX}${i + 1}`,
    quantity: c.qty,
    roofType: c.roofType ?? "None",
    reuseRings: c.reuseRings ?? false,
    bootSize: c.bootSize!,
    ringSize: c.ringSize!,
    adjustPct: 0,
    ...link(c),
  }));

  const unmapped: TakeoffBidSeed["unmapped"] = [];
  for (const c of q.counts) {
    if (c.role === "curb") {
      if (!curbSized(c))
        unmapped.push({
          label: `${c.qty} ${plural(c.qty, "curb")}, size not measured`,
          detail: `"${c.name}" — on the Curbs screen with a blank size (it prices as almost nothing until one is entered); enter its width × length there.`,
        });
      continue;
    }
    if (pipeSized(c)) continue;
    if (drainReady(c)) continue;
    if (c.role === "pipe") {
      unmapped.push({
        label: `${c.qty} ${plural(c.qty, "pipe")}, size not measured`,
        detail: `"${c.name}" — add on Accessories › Pipe Stacks with its size (or give the pipe count a size in the takeoff).`,
      });
      continue;
    }
    const size = c.sizeIn ? ` (${c.sizeIn} in)` : "";
    const where =
      c.role === "drain"
        ? "Accessories › Roof Drains & Boots (no boot and ring were picked — set the drain defaults on the takeoff's Setup tab or on each drain)"
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
  for (const s of q.sections) {
    const walls = s.cutoutPerimetersFt.reduce((t, l) => t + l, 0);
    if (walls > 0)
      unmapped.push({
        label: `${s.name}: ${ftIn(walls)} of penthouse wall (not seeded)`,
        detail:
          "Cut-out walls (penthouse / well) — flash them as a parapet on the Parapets screen, or a curb, as quoted.",
      });
  }
  for (const u of q.unscaled) {
    unmapped.push({
      label: u.name,
      detail: `Drawn on a page with no scale (page ${u.page + 1}) — not measured.`,
    });
  }

  const countParts = SUMMARY_COUNT_ORDER.map((role) => {
    const n = q.counts.filter((c) => c.role === role).reduce((t, c) => t + c.qty, 0);
    return n ? `${n} ${plural(n, COUNT_NOUNS[role])}` : null;
  }).filter((x): x is string => !!x);
  const summaryParts = [
    `${q.sections.length} section${q.sections.length === 1 ? "" : "s"}, ${round1(q.totals.roofAreaSqFt)} sq ft, ${round1(q.totals.slopedPerimeterFt)} ft of roof edge`,
    q.totals.parapetFt > 0 ? `${round1(q.totals.parapetFt)} ft of parapet` : null,
    countParts.length ? countParts.join(", ") : null,
  ].filter((x): x is string => !!x);

  const seed: TakeoffBidSeed = {
    sectionDefaults,
    parapetDefaults,
    sections,
    parapets,
    curbs,
    pipeStacks,
    drains,
    unmapped,
    summary: `${opts.takeoffName ? `From takeoff "${opts.takeoffName}"` : "From a takeoff"}: ${summaryParts.join("; ")}.`,
  };
  if (setup.roofSystem) seed.roofSystem = setup.roofSystem;
  if (setup.attachment) seed.attachment = setup.attachment;
  if (setup.membraneAdhesiveName) seed.membraneAdhesiveName = setup.membraneAdhesiveName;
  if (setup.notes?.trim()) seed.setupNotes = setup.notes.trim();
  if (opts.accountId) seed.accountId = opts.accountId;
  return seed;
}

/**
 * Takeoff → bid customer link: the account to SET on a bid made or updated from a takeoff, or
 * null to leave the bid's link alone. A bid that already has a customer keeps it; one without
 * takes the takeoff's (when the takeoff has one).
 */
export function bidAccountFromTakeoff(
  bidAccountId: string | null | undefined,
  takeoffAccountId: string | null | undefined,
): string | null {
  return !bidAccountId && takeoffAccountId ? takeoffAccountId : null;
}

/**
 * Bid → takeoff customer link: when a takeoff is linked to a bid that has a customer and the
 * takeoff has none, the takeoff inherits the bid's. Returns the account to SET on the takeoff,
 * or null to leave it (it has its own, or the bid has none).
 */
export function takeoffAccountFromBid(
  takeoffAccountId: string | null | undefined,
  bidAccountId: string | null | undefined,
): string | null {
  return !takeoffAccountId && bidAccountId ? bidAccountId : null;
}

/** Pipe stack / drain rows the seed creates carry these id prefixes (older bids match by it). */
export const TAKEOFF_PIPE_ID_PREFIX = "takeoff-pipe-";
export const TAKEOFF_DRAIN_ID_PREFIX = "takeoff-drain-";

const key = (n: string | undefined) => (n ?? "").trim().toLowerCase();
const linkIds = (x: TakeoffLink): string[] =>
  x.takeoffObjectIds?.length ? x.takeoffObjectIds : x.takeoffObjectId ? [x.takeoffObjectId] : [];
const sameObject = (a: TakeoffLink, b: TakeoffLink) => {
  const bs = new Set(linkIds(b));
  return linkIds(a).some((id) => bs.has(id));
};

/**
 * Pair the bid's takeoff-made items with the seed's, one to one: by each rule in turn (the first
 * finds the most reliable pairs), each item used once. Returns seed index per bid index.
 */
function pairUp<B, S>(
  bidItems: readonly B[],
  seeds: readonly S[],
  rules: ReadonlyArray<(b: B, s: S) => boolean>,
): Map<number, number> {
  const pairs = new Map<number, number>();
  const taken = new Set<number>();
  for (const rule of rules)
    bidItems.forEach((b, i) => {
      if (pairs.has(i)) return;
      const j = seeds.findIndex((s, k) => !taken.has(k) && rule(b, s));
      if (j < 0) return;
      pairs.set(i, j);
      taken.add(j);
    });
  return pairs;
}

const sameLen = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.01;

/**
 * The edges after a re-measure. Every side takes its new length. A side whose takeoff role
 * changed (a parapet / gutter line added or removed along it) takes the seed's freshly derived
 * details. Any other side keeps what the ESTIMATOR set on the bid: per detail (termination,
 * blocking, ARP, perimeter and tall-wall flags), a value still equal to what the takeoff seeded
 * last time was never edited on the bid and follows the takeoff; an edited one is kept (bids
 * seeded before the snapshot was stored keep every detail). Runs set to the whole side follow
 * its new length. A changed side count takes the seed's edges.
 */
function mergeEdges(
  old: readonly EdgeInput[] | undefined,
  oldRoles: ReadonlyArray<LinearRole | null> | undefined,
  oldSeeded: readonly SeededEdgeDetails[] | undefined,
  next: readonly EdgeInput[],
  nextRoles: ReadonlyArray<LinearRole | null>,
): { edges: EdgeInput[]; rederived: number[] } {
  if (!old || old.length !== next.length)
    return { edges: [...next], rederived: next.map((_, i) => i) };
  const rederived: number[] = [];
  const edges = next.map((n, k) => {
    if ((oldRoles?.[k] ?? null) !== (nextRoles[k] ?? null)) {
      rederived.push(k);
      return n;
    }
    const o = old[k]!;
    const was = oldSeeded?.length === old.length ? oldSeeded[k] : undefined;
    const e: EdgeInput = { ...o, side: n.side, lengthFt: n.lengthFt };
    const follow = (v: number | undefined) => (sameLen(v, o.lengthFt) ? n.lengthFt : v);
    if (o.perimLengthFt !== undefined) e.perimLengthFt = follow(o.perimLengthFt)!;
    if (o.termLengthFt !== undefined) e.termLengthFt = follow(o.termLengthFt)!;
    if (o.arpLengthFt !== undefined) e.arpLengthFt = follow(o.arpLengthFt)!;
    if (was) {
      if (o.termination === was.termination) e.termination = n.termination;
      if (o.arpSizeIn === was.arpSizeIn) e.arpSizeIn = n.arpSizeIn;
      if (Math.abs(o.blockingFt - was.blockingFt) < 0.01) e.blockingFt = n.blockingFt;
      if ((o.hasTallWall ?? false) === (was.hasTallWall ?? false)) {
        if (n.hasTallWall) e.hasTallWall = true;
        else delete e.hasTallWall;
      }
      if (o.isPerimeter === was.isPerimeter && o.isPerimeter !== n.isPerimeter) {
        e.isPerimeter = n.isPerimeter;
        if (n.perimLengthFt !== undefined) e.perimLengthFt = n.perimLengthFt;
        else delete e.perimLengthFt;
        rederived.push(k);
      }
    } else if (o.blockingFt > 0 && Math.abs(o.blockingFt - o.lengthFt) < 0.01)
      e.blockingFt = Math.round(n.lengthFt * 100) / 100;
    return e;
  });
  return { edges, rederived };
}

const roleWord = (r: LinearRole | null) => (r ? LINEAR_ROLE_LABELS[r].toLowerCase() : "no line");

/**
 * Apply a re-measured takeoff onto an EXISTING bid (owner, Sep 24: "update the existing bid
 * linked to it"). Only what the drawing owns changes:
 *  - measured sections (`measured.source === "takeoff"`), parapets / curbs flagged
 *    `fromTakeoff`, and the takeoff's pipe stack / drain rows are matched to the new seed by the
 *    takeoff object id stored on them (`takeoffObjectId`), then — for bids seeded before ids were
 *    stored, or a wall whose edge line was re-made — by the area sides a wall runs along, then
 *    by name (rows: by their seeded id);
 *  - a matched section takes the new name, length, width, outline and edge LENGTHS and keeps
 *    every material / labor field and the edge details the estimator set; only sides whose role
 *    in the takeoff changed (a parapet or gutter line added / removed along them) are
 *    re-derived. Its note keeps the estimator's text; the one "Measured in Takeoff: …" line is
 *    updated;
 *  - a matched parapet takes length and wall height (keeps profile and options); a matched curb
 *    takes the count and any MEASURED size (keeps style and a hand-set size); matched pipe stack
 *    and drain rows take the new quantity in place (keeping adjust %, reuse rings, picks);
 *  - new drawing items are added (walls with the bid's parapet defaults, like "Add parapet");
 *    takeoff items no longer in the drawing are removed; hand-added items are untouched;
 *  - the takeoff Setup's notes are carried into the bid's notes once (`withTakeoffNotes`).
 * `changes` lists only what actually changed, with old → new numbers.
 */
export function applyTakeoffToBid(
  bid: {
    sections: BidSectionInput[];
    parapets?: ParapetInput[] | undefined;
    curbs?: CurbInput[] | undefined;
    pipeStacks?: PipeStackEntry[] | undefined;
    drains?: DrainEntry[] | undefined;
    /** The bid's notes (Setup › 6. Notes). */
    notes?: string | undefined;
    /** For walls the drawing adds: the bid's parapet defaults, as "Add parapet" uses them. */
    parapetDefaults?: SavedBidState["parapetDefaults"] | undefined;
    sectionDefaults?: { deckType?: string | undefined } | undefined;
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
  drains: DrainEntry[];
  notes: string;
  changes: string[];
} {
  const changes: string[] = [];
  const renamed = (from: string, to: string | undefined) =>
    to !== undefined && to !== from ? [`renamed "${to}"`] : [];

  // ── Sections ──
  type LinkedSection = BidSectionInput & SeededSection;
  const measuredIdx = bid.sections
    .map((s, i) => (s.measured?.source === "takeoff" ? i : -1))
    .filter((i) => i >= 0);
  const measured = measuredIdx.map((i) => bid.sections[i] as LinkedSection);
  const sPairs = pairUp(measured, seed.sections, [
    (b, s) => !!b.takeoffObjectId && b.takeoffObjectId === s.takeoffObjectId,
    (b, s) => key(b.name) === key(s.name),
  ]);
  const sUsed = new Set(sPairs.values());
  const sections: BidSectionInput[] = [];
  bid.sections.forEach((s0, i) => {
    const m = measuredIdx.indexOf(i);
    if (m < 0) {
      sections.push(s0);
      return;
    }
    const s = s0 as LinkedSection;
    const j = sPairs.get(m);
    if (j === undefined) {
      changes.push(`Removed section "${s.name}" (no longer in the drawing).`);
      return;
    }
    const o = seed.sections[j]!;
    const next: LinkedSection = { ...s };
    if (o.name !== undefined) next.name = o.name;
    if (o.length !== undefined) next.length = o.length;
    if (o.width !== undefined) next.width = o.width;
    const nextRoles = o.takeoffSideRoles ?? (o.edges ?? []).map(() => null);
    let rederived: number[] = [];
    if (o.edges) {
      const merged = mergeEdges(
        s.edges,
        s.takeoffSideRoles,
        s.takeoffSeededEdges,
        o.edges,
        nextRoles,
      );
      next.edges = merged.edges;
      rederived = merged.rederived;
      // Corners: the estimator's, except around a re-derived side (the seed's there).
      if (o.perimCorners) {
        const n = o.perimCorners.length;
        next.perimCorners =
          s.perimCorners && s.perimCorners.length === n && s.edges?.length === n
            ? o.perimCorners.map((c, k) =>
                rederived.includes(k) || rederived.includes((k + 1) % n)
                  ? c
                  : (s.perimCorners![k] ?? c),
              )
            : o.perimCorners;
      }
    } else if (o.perimCorners) next.perimCorners = o.perimCorners;
    if (o.measured) next.measured = o.measured;
    if (o.notes !== undefined) next.notes = withMeasuredNote(s.notes, o.notes);
    if (o.takeoffObjectId) next.takeoffObjectId = o.takeoffObjectId;
    next.takeoffSideRoles = nextRoles;
    if (o.takeoffSeededEdges) next.takeoffSeededEdges = o.takeoffSeededEdges;
    sections.push(next);

    const diffs = [...renamed(s.name, o.name)];
    const oldArea = s.measured?.areaSqFt ?? s.length * s.width;
    const newArea = next.measured?.areaSqFt ?? next.length * next.width;
    if (num(oldArea) !== num(newArea)) diffs.push(`${num(oldArea)} → ${num(newArea)} sq ft`);
    const perim = (es: readonly EdgeInput[] | undefined) =>
      (es ?? []).reduce((t, e) => t + e.lengthFt, 0);
    if (num(perim(s.edges)) !== num(perim(next.edges)))
      diffs.push(`perimeter ${num(perim(s.edges))} → ${num(perim(next.edges))} ft`);
    const sideChanges = (next.edges ?? [])
      .map((e, k) =>
        (s.takeoffSideRoles?.[k] ?? null) !== (nextRoles[k] ?? null) &&
        (s.takeoffSideRoles !== undefined || nextRoles[k])
          ? `side ${e.side} ${roleWord(s.takeoffSideRoles?.[k] ?? null)} → ${roleWord(nextRoles[k] ?? null)}`
          : null,
      )
      .filter((x): x is string => !!x);
    diffs.push(...sideChanges);
    if (diffs.length) changes.push(`${s.name}: ${diffs.join("; ")}.`);
  });
  seed.sections.forEach((o, j) => {
    if (sUsed.has(j)) return;
    sections.push(make.newSection({ ...seed.sectionDefaults, ...o }));
    changes.push(
      `Added section "${o.name ?? "Section"}"${o.measured ? ` (${num(o.measured.areaSqFt)} sq ft)` : ""}.`,
    );
  });

  // ── Parapets ──
  type LinkedParapet = ParapetInput & SeededParapet;
  const fromTakeoffP = (bid.parapets ?? []).filter((p) => p.fromTakeoff) as LinkedParapet[];
  const pPairs = pairUp(fromTakeoffP, seed.parapets, [
    (b, s) => !!b.takeoffObjectId && b.takeoffObjectId === s.takeoffObjectId,
    (b, s) => !!b.takeoffEdgeKey && b.takeoffEdgeKey === s.takeoffEdgeKey,
    (b, s) => key(b.name) === key(s.name),
  ]);
  const pUsed = new Set(pPairs.values());
  const parapets: ParapetInput[] = [];
  let pk = 0;
  for (const p0 of bid.parapets ?? []) {
    if (!p0.fromTakeoff) {
      parapets.push(p0);
      continue;
    }
    const p = p0 as LinkedParapet;
    const j = pPairs.get(pk++);
    if (j === undefined) {
      changes.push(`Removed parapet "${p.name}" (no longer in the drawing).`);
      continue;
    }
    const o = seed.parapets[j]!;
    const next: LinkedParapet = { ...p };
    if (o.name !== undefined) next.name = o.name;
    if (o.lengthFt !== undefined) next.lengthFt = o.lengthFt;
    if (o.verticalInches !== undefined) next.verticalInches = o.verticalInches;
    if (o.takeoffObjectId) next.takeoffObjectId = o.takeoffObjectId;
    if (o.takeoffEdgeKey) next.takeoffEdgeKey = o.takeoffEdgeKey;
    else delete next.takeoffEdgeKey;
    parapets.push(next);
    const diffs = [...renamed(p.name, o.name)];
    if (num(p.lengthFt) !== num(next.lengthFt))
      diffs.push(`${num(p.lengthFt)} → ${num(next.lengthFt)} ft`);
    if ((p.verticalInches ?? 0) !== (next.verticalInches ?? 0))
      diffs.push(`wall ${num(p.verticalInches ?? 0)} → ${num(next.verticalInches ?? 0)} in`);
    if (diffs.length) changes.push(`${p.name}: ${diffs.join("; ")}.`);
  }
  const addParapetDefaults = parapetFromDefaults(
    bid.parapetDefaults,
    bid.sectionDefaults?.deckType,
  );
  seed.parapets.forEach((o, j) => {
    if (pUsed.has(j)) return;
    parapets.push(make.newParapet({ ...addParapetDefaults, ...o }));
    changes.push(
      `Added parapet "${o.name ?? "Parapet"}"${o.lengthFt !== undefined ? ` (${num(o.lengthFt)} ft)` : ""}.`,
    );
  });

  // ── Curbs ──
  type LinkedCurb = CurbInput & SeededCurb;
  const fromTakeoffC = (bid.curbs ?? []).filter((c) => c.fromTakeoff) as LinkedCurb[];
  const cPairs = pairUp(fromTakeoffC, seed.curbs, [
    (b, s) => sameObject(b, s),
    (b, s) => key(b.name) === key(s.name),
  ]);
  const cUsed = new Set(cPairs.values());
  const curbs: CurbInput[] = [];
  let ck = 0;
  for (const c0 of bid.curbs ?? []) {
    if (!c0.fromTakeoff) {
      curbs.push(c0);
      continue;
    }
    const c = c0 as LinkedCurb;
    const j = cPairs.get(ck++);
    if (j === undefined) {
      changes.push(`Removed curb "${c.name}" (no longer in the drawing).`);
      continue;
    }
    const o = seed.curbs[j]!;
    const next: LinkedCurb = { ...c };
    if (o.name !== undefined) next.name = o.name;
    if (o.quantity !== undefined) next.quantity = o.quantity;
    // Only a MEASURED size replaces the bid's (a blank takeoff size keeps a hand-set one).
    if (o.widthIn) next.widthIn = o.widthIn;
    if (o.lengthIn) next.lengthIn = o.lengthIn;
    if (o.dimCIn) next.dimCIn = o.dimCIn;
    if (o.takeoffObjectId) next.takeoffObjectId = o.takeoffObjectId;
    if (o.takeoffObjectIds) next.takeoffObjectIds = o.takeoffObjectIds;
    curbs.push(next);
    const diffs = [...renamed(c.name, o.name)];
    if (c.quantity !== next.quantity) diffs.push(`${c.quantity} → ${next.quantity}`);
    if (c.widthIn !== next.widthIn || c.lengthIn !== next.lengthIn)
      diffs.push(`size ${c.widthIn} × ${c.lengthIn} → ${next.widthIn} × ${next.lengthIn} in`);
    if (diffs.length) changes.push(`${c.name}: ${diffs.join("; ")}.`);
  }
  seed.curbs.forEach((o, j) => {
    if (cUsed.has(j)) return;
    curbs.push(make.newCurb(o));
    changes.push(`Added curb "${o.name ?? "Curb"}" (×${o.quantity ?? 1}).`);
  });

  // ── Pipe stacks / drains: quantities updated in place on the matched rows ──
  function rows<R extends { id: string; quantity: number }>(
    current: readonly R[],
    seeded: ReadonlyArray<R & TakeoffLink>,
    prefix: string,
    label: (r: R, many: boolean) => string,
    update: (row: R, from: R) => R,
  ): R[] {
    type Linked = R & TakeoffLink;
    const isTakeoffRow = (r: Linked) => r.id.startsWith(prefix) || linkIds(r).length > 0;
    const mine = (current as Linked[]).filter(isTakeoffRow);
    const pairs = pairUp(mine, seeded, [
      (b, s) => sameObject(b, s),
      (b, s) => linkIds(b).length === 0 && b.id === s.id,
    ]);
    const used = new Set(pairs.values());
    const many = seeded.length > 1 || mine.length > 1;
    const out: R[] = [];
    let k = 0;
    for (const r0 of current as Linked[]) {
      if (!isTakeoffRow(r0)) {
        out.push(r0);
        continue;
      }
      const j = pairs.get(k++);
      if (j === undefined) {
        changes.push(`Removed ${label(r0, many)}: ${r0.quantity} (no longer in the drawing).`);
        continue;
      }
      const o = seeded[j]!;
      const next: Linked = { ...update(r0, o), quantity: o.quantity };
      if (o.takeoffObjectId) next.takeoffObjectId = o.takeoffObjectId;
      if (o.takeoffObjectIds) next.takeoffObjectIds = o.takeoffObjectIds;
      out.push(next);
      if (r0.quantity !== o.quantity)
        changes.push(`${label(r0, many)}: ${r0.quantity} → ${o.quantity}.`);
    }
    const ids = new Set(out.map((r) => r.id));
    seeded.forEach((o, j) => {
      if (used.has(j)) return;
      let id = o.id;
      for (let n = seeded.length + 1; ids.has(id); n++) id = `${prefix}${n}`;
      ids.add(id);
      out.push({ ...o, id });
      changes.push(`Added ${label(o, many)}: ${o.quantity}.`);
    });
    return out;
  }
  const pipeStacks = rows(
    bid.pipeStacks ?? [],
    seed.pipeStacks,
    TAKEOFF_PIPE_ID_PREFIX,
    (r) => `Pipe stacks (${r.size} in)`,
    // A pipe's size is measured in the takeoff; usage, colour, adjust % stay the estimator's.
    (row, from) => ({ ...row, size: from.size }),
  );
  const drains = rows(
    bid.drains ?? [],
    seed.drains,
    TAKEOFF_DRAIN_ID_PREFIX,
    (r, many) => (many ? `Drains (${r.bootSize})` : "Drains"),
    (row) => row,
  );

  const notes = withTakeoffNotes(bid.notes, seed.setupNotes);
  return { sections, parapets, curbs, pipeStacks, drains, notes, changes };
}
