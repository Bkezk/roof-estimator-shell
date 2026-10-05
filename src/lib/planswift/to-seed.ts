/**
 * PlanSwift rows + the estimator's target choices → a bid seed (pure).
 *
 * The seed is the SAME kind `bidSeedFromTakeoff` produces (src/lib/takeoff/create-bid.ts), and is
 * built BY it: the chosen rows become a `TakeoffQuantities` (sections from the sheet's area and
 * Linear total, parapet / gutter runs, curb / drain / pipe counts) and go through the takeoff seed,
 * so a later fix there applies to PlanSwift imports too. What a takeoff has no word for is added
 * on top: the per-section membrane / insulation read from the names, the tapered quote layer,
 * the parapet skirt, the curb height, and Non-DL custom lines (coping and other sheet metal,
 * wall panels) with the sheet's quantity and blank prices. Everything else (accessory counts,
 * gutters, rows nothing fits) lands in the seed's `unmapped` list with its numbers, which the
 * estimator's notice shows until placed.
 *
 * Sections: PlanSwift exports an area's square feet and (newer exports) its perimeter as "Linear
 * total", not the outline, so the section is the EQUIVALENT RECTANGLE — the one with the same
 * area and perimeter (L and W are the roots of x² − (P/2)x + A = 0). Its sides A–D are not real
 * walls. Without a Linear total the section is a square of the same area (and a warning says to
 * add the column). Parapet, coping and gutter lengths come from their own rows, never from the
 * perimeter.
 */

import type { Attachment } from "@/lib/engine/estimate";
import {
  MAX_UNDERLAYMENT_LAYERS,
  type BidSectionInput,
  type UnderlaymentLayer,
} from "@/lib/engine/bid-builder";
import { defaultEdges } from "@/lib/engine/edges";
import type { NonDlCustomRow, NonDlGroup } from "@/lib/engine/nondl";
import { bidSeedFromTakeoff, type TakeoffBidSeed } from "@/lib/takeoff/create-bid";
import { equivalentRect } from "@/lib/takeoff/geometry";
import type {
  CountQuantity,
  LinearQuantity,
  SectionQuantity,
  TakeoffQuantities,
  TakeoffSetup,
} from "@/lib/takeoff/model";
import { newBidFromSeed, type SeedFactories } from "@/lib/takeoff/seed-to-bid";
import type { SavedBidState } from "@/lib/proposal-bid";
import {
  describeTarget,
  PLANSWIFT_TARGET_LABELS,
  type ClassifiedRow,
  type MembraneGuess,
  type PlanSwiftTarget,
} from "./classify";
import type { PlanSwiftSheet } from "./parse";

/** What a bid imported from PlanSwift remembers (SavedBidState.importInfo). */
export interface PlanSwiftImportInfo {
  source: "planswift";
  fileName: string;
  sheetName: string;
  importedAt: string;
  /** One line on what the sheet became. */
  summary: string;
  /** Rows the estimator still has to place by hand, with their numbers. */
  unmapped: Array<{ label: string; detail: string }>;
  warnings: string[];
  /** Every row of the sheet → where it went. */
  mapping: Array<{
    sheetRow: number;
    name: string;
    qty: number;
    units: string;
    target: PlanSwiftTarget;
    detail: string;
  }>;
  /** Set when the estimator dismissed the notice (the record itself stays on the bid). */
  noticeDismissed?: boolean;
}

export interface PlanSwiftBidSeed extends TakeoffBidSeed {
  /** Non-DL custom lines by group (coping / sheet metal → sheetMetal, panels → customApps). */
  nonDlCustom: Partial<Record<NonDlGroup, NonDlCustomRow[]>>;
  importInfo: PlanSwiftImportInfo;
  /** Everything worth a second look, also kept on importInfo. */
  warnings: string[];
}

/** One row with the estimator's final choice. */
export interface PlanSwiftChoice {
  row: ClassifiedRow;
  target: PlanSwiftTarget;
  /** Tapered rows: the sheet row of the section that carries the quote layer (absent = largest). */
  onSection?: number;
}

export interface PlanSwiftSeedOptions {
  fileName: string;
  /** Setup defaults (the takeoff's up-front answers); override what the names suggest. */
  setup?: TakeoffSetup;
  /** Live underlayment board names (admin.underlaymentPrices keys), to spell layers as the list does. */
  boardNames?: readonly string[];
  /** Live labor combos (admin.labor): which systems / attachments / mils exist. */
  labor?: Record<string, { thicknessLaborByMil: Record<number, number> }>;
  accountId?: string | null;
  importedAt?: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const num = (x: number) =>
  x.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// ── Section geometry ─────────────────────────────────────────────────────────────────────────

export interface PlanSwiftRect {
  length: number;
  width: number;
  /** The perimeter the rectangle has (the sheet's, or a square's when there is none). */
  perimeterFt: number;
  square: boolean;
  warning?: string;
}

/**
 * The equivalent rectangle for an area A (sq ft) and PlanSwift Linear total P (ft): L, W = the
 * roots of x² − (P/2)x + A = 0 when P ≥ 4√A; a square of side √A otherwise (P shorter than a
 * square's is impossible for a real outline) or when there is no P.
 */
export function planSwiftSectionRect(areaSqFt: number, perimeterFt: number | null): PlanSwiftRect {
  const a = Math.max(0, areaSqFt);
  const side = Math.sqrt(a);
  const square = (warning?: string): PlanSwiftRect => ({
    length: side,
    width: side,
    perimeterFt: 4 * side,
    square: true,
    ...(warning ? { warning } : {}),
  });
  if (perimeterFt === null || !(perimeterFt > 0))
    return square(
      "No Linear total: the section is a square of the same area. Add the Linear total column to the PlanSwift export for the real perimeter.",
    );
  const min = 4 * side;
  // A perimeter within 0.1% under a square's is a square rounded by PlanSwift, not a bad outline.
  if (perimeterFt < min * (1 - 1e-3))
    return square(
      `The perimeter (${num(perimeterFt)} ft) is shorter than a square's of this area (${num(min)} ft) — check the outline in PlanSwift. The section is a square of the same area.`,
    );
  if (perimeterFt < min) return square();
  const r = equivalentRect(a, perimeterFt);
  return { length: r.length, width: r.width, perimeterFt, square: false };
}

export const EQUIVALENT_RECT_NOTE =
  "Sides are an equivalent rectangle from PlanSwift (area and perimeter match; A–D are not real walls).";
export const SQUARE_NOTE =
  "Sides are a square of the same area (PlanSwift gave no usable perimeter; A–D are not real walls).";

// ── Names ────────────────────────────────────────────────────────────────────────────────────

/** "Roof Type 2 ( Fully adhered … )" → "Roof Type 2"; short names as they are; long ones "Roof N". */
function sectionName(name: string, i: number): string {
  const rt = /roof\s*type\s*\d+/i.exec(name);
  if (rt) return collapse(rt[0]).replace(/^roof\s*type/i, "Roof Type");
  const c = collapse(name);
  return c.length <= 40 ? c : `Roof ${i + 1}`;
}

/** "Parapet  01  ( 6"_/ 102" )" → "Parapet 01". */
const parapetName = (name: string) => collapse(name.replace(/\([^)]*\)/g, " ")) || collapse(name);

const unique = (names: string[]) => {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? n : `${n} (${c})`;
  });
};

// ── Systems and boards ───────────────────────────────────────────────────────────────────────

const attKeys = (att: Attachment) => (att === "adhered" ? ["adhered", "adhesive"] : ["mechanical"]);

function comboFor(
  labor: PlanSwiftSeedOptions["labor"],
  system: string,
  att: Attachment,
): { thicknessLaborByMil: Record<number, number> } | undefined {
  if (!labor) return undefined;
  for (const k of attKeys(att)) {
    const c = labor[`${system}|${k}`];
    if (c) return c;
  }
  return undefined;
}

const systemKnown = (labor: PlanSwiftSeedOptions["labor"], system: string) =>
  !labor || Object.keys(labor).some((k) => k.split("|")[0] === system);

const boardKey = (s: string) => s.toLowerCase().replace(/[”″]/g, '"').replace(/\s+/g, "");

/** The list's spelling of a board guess (`2" ISO`), preferring the plain / 4'x8' entry; null when none. */
export function matchBoard(
  guess: string,
  boardNames: readonly string[] | undefined,
): string | null {
  if (!boardNames) return guess;
  const g = boardKey(guess);
  const exact = boardNames.find((b) => boardKey(b) === g);
  if (exact) return exact;
  const starts = boardNames.filter((b) => boardKey(b).startsWith(g));
  return starts.find((b) => /4'\s*x\s*8'/i.test(b)) ?? starts[0] ?? null;
}

/** The membrane / system a section row names, validated against the live labor combos. */
interface SectionSystem {
  roofSystem?: string;
  attachment?: Attachment;
  thickness?: number;
  notes: string[];
}

function systemOf(
  m: MembraneGuess | undefined,
  labor: PlanSwiftSeedOptions["labor"],
  fallback: { roofSystem?: string; attachment?: Attachment },
): SectionSystem {
  const out: SectionSystem = { notes: [] };
  if (!m) return out;
  if (m.roofSystem) {
    if (systemKnown(labor, m.roofSystem)) out.roofSystem = m.roofSystem;
    else out.notes.push(`"${m.roofSystem}" is not a roof system in this estimator — pick one.`);
  }
  const sys = out.roofSystem ?? fallback.roofSystem;
  if (m.attachment) {
    if (!sys || !labor || comboFor(labor, sys, m.attachment)) out.attachment = m.attachment;
    else out.notes.push(`${sys} has no ${m.attachment} pricing — check "Attached With".`);
  }
  if (m.thicknessMil !== undefined) {
    const att = out.attachment ?? fallback.attachment ?? "mechanical";
    const combo = sys ? comboFor(labor, sys, att) : undefined;
    const mils = Object.keys(combo?.thicknessLaborByMil ?? {})
      .map(Number)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (!mils.length || mils.includes(m.thicknessMil)) out.thickness = m.thicknessMil;
    else
      out.notes.push(
        `${m.thicknessMil} mil is not a ${sys} thickness (${mils.join(" / ")}) — pick one on the Sections screen.`,
      );
  }
  return out;
}

const layerOf = (board: string, att: UnderlaymentLayer["attachment"]): UnderlaymentLayer => ({
  board,
  attachment: att,
  fastenersPerBoard: 0,
  adhesiveName: "",
  substrate: "",
});

// ── The seed ─────────────────────────────────────────────────────────────────────────────────

export function planSwiftSeed(
  sheet: Pick<PlanSwiftSheet, "sheetName" | "hasLinearTotal" | "warnings">,
  choices: readonly PlanSwiftChoice[],
  opts: PlanSwiftSeedOptions,
): PlanSwiftBidSeed {
  const warnings: string[] = [...sheet.warnings];
  const unmapped: Array<{ label: string; detail: string }> = [];
  const nonDlCustom: Partial<Record<NonDlGroup, NonDlCustomRow[]>> = {};
  // The Non-DL screen tells custom lines apart by description, so a repeated name gets " (2)".
  const lineNames = new Map<string, number>();
  const addLine = (group: NonDlGroup, name: string, qty: number) => {
    const n = (lineNames.get(name.toLowerCase()) ?? 0) + 1;
    lineNames.set(name.toLowerCase(), n);
    (nonDlCustom[group] ??= []).push({
      description: n === 1 ? name : `${name} (${n})`,
      qty: round2(qty),
      unitCost: 0,
      laborPerUnit: 0,
      // Filled with the bid's crew rate when the bid is made (savedFromPlanSwiftSeed).
      laborRate: 0,
    });
  };
  const rowLabel = (c: ClassifiedRow) => {
    const r = c.row;
    return r.unitKind === "ea"
      ? `${num(r.qty)} × ${collapse(r.name)}`
      : `${collapse(r.name)}: ${num(r.qty)} ${r.unitKind === "sqft" ? "sq ft" : r.unitKind === "ft" ? "ft" : r.units}`;
  };

  // Sections first: the largest one names the bid's system.
  const sectionChoices = choices.filter((c) => c.target === "section");
  if (sectionChoices.length === 0)
    warnings.push("No row is a roof section — the bid starts with no sections.");
  const bySize = [...sectionChoices].sort((a, b) => b.row.row.qty - a.row.row.qty);
  const main = bySize.find((c) => c.row.details.membrane?.roofSystem) ?? bySize[0];
  const mainSys = systemOf(main?.row.details.membrane, opts.labor, {});
  const setup: TakeoffSetup = {
    ...(mainSys.roofSystem ? { roofSystem: mainSys.roofSystem } : {}),
    ...(mainSys.attachment ? { attachment: mainSys.attachment } : {}),
    ...(mainSys.thickness ? { thickness: mainSys.thickness } : {}),
    ...opts.setup,
  };

  const names = unique(sectionChoices.map((c, i) => sectionName(c.row.row.name, i)));
  const sections: SectionQuantity[] = [];
  const sectionMeta: Array<{ choice: PlanSwiftChoice; rect: PlanSwiftRect }> = [];
  sectionChoices.forEach((c, i) => {
    const r = c.row.row;
    const rect = planSwiftSectionRect(r.qty, r.linearTotal);
    if (rect.warning) warnings.push(`${names[i]}: ${rect.warning}`);
    else if (rect.width > 0 && rect.length / rect.width > 8)
      warnings.push(
        `${names[i]}: the equivalent rectangle is ${num(round2(rect.length))} × ${num(round2(rect.width))} ft — the Linear total may include more than the roof edge (walls, curbs); check the perimeter.`,
      );
    const area = rect.length * rect.width;
    // The bid's dimensions carry two decimals (an eighth of an inch); the area stays the sheet's.
    const length = round2(rect.length);
    const width = round2(rect.width);
    const edges = defaultEdges(length, width);
    sections.push({
      objectId: `planswift-row-${r.sheetRow}`,
      name: names[i]!,
      page: 0,
      areaSqFt: area,
      planAreaSqFt: area,
      slopeFactor: 1,
      perimeterFt: rect.perimeterFt,
      edgeLengthsFt: edges.map((e) => e.lengthFt),
      slopedEdgeLengthsFt: edges.map((e) => e.lengthFt),
      slopedPerimeterFt: rect.perimeterFt,
      rakeSides: [],
      edgeRoles: edges.map(() => null),
      outlineAreaSqFt: area,
      cutoutAreaSqFt: 0,
      cutoutPerimetersFt: [],
      section: {
        length,
        width,
        edges,
        perimCorners: [false, false, false, false],
        measured: {
          points: [
            [0, 0],
            [length, 0],
            [length, width],
            [0, width],
          ],
          areaSqFt: area,
          perimeterFt: rect.perimeterFt,
          source: "takeoff",
        },
      },
    });
    sectionMeta.push({ choice: c, rect });
  });

  const linears: LinearQuantity[] = [];
  const counts: CountQuantity[] = [];
  const parapetRows: ClassifiedRow[] = [];
  const curbRows: ClassifiedRow[] = [];
  const tapered: PlanSwiftChoice[] = [];
  for (const ch of choices) {
    const c = ch.row;
    const r = c.row;
    const d = c.details;
    const id = `planswift-row-${r.sheetRow}`;
    switch (ch.target) {
      case "section":
      case "skip":
        break;
      case "parapet": {
        const l: LinearQuantity = {
          objectId: id,
          name: parapetName(r.name),
          page: 0,
          role: "parapet",
          lengthFt: r.qty,
        };
        if (d.verticalIn !== undefined) l.heightIn = d.verticalIn;
        else
          warnings.push(
            `${l.name}: no wall height in the name (e.g. "( 6"_/ 54" )") — set its Vertical on the Parapets screen.`,
          );
        if (r.unitKind !== "ft")
          warnings.push(`${l.name}: a parapet in ${r.units || "no unit"}, read as feet.`);
        linears.push(l);
        parapetRows.push(c);
        break;
      }
      case "gutter":
        // Listed here rather than as a takeoff gutter run so the label keeps the sheet's number.
        unmapped.push({ label: rowLabel(c), detail: "Gutter — add on Metals › Gutters." });
        break;
      case "curb": {
        const k: CountQuantity = {
          name: collapse(r.name),
          role: "curb",
          qty: Math.round(r.qty),
          objectIds: [id],
        };
        if (d.widthIn !== undefined) k.widthIn = d.widthIn;
        if (d.lengthIn !== undefined) k.lengthIn = d.lengthIn;
        if (d.widthIn === undefined || d.lengthIn === undefined)
          warnings.push(
            `${k.name}: no W × L size in the name — the curb starts with a blank size; enter its size on the Curbs screen.`,
          );
        counts.push(k);
        curbRows.push(c);
        break;
      }
      case "drain":
        counts.push({
          name: collapse(r.name),
          role: "drain",
          qty: Math.round(r.qty),
          objectIds: [id],
        });
        break;
      case "pipe": {
        const p: CountQuantity = {
          name: collapse(r.name),
          role: "pipe",
          qty: Math.round(r.qty),
          objectIds: [id],
        };
        if (d.sizeIn !== undefined) p.sizeIn = d.sizeIn;
        counts.push(p);
        break;
      }
      case "tapered":
        tapered.push(ch);
        break;
      case "coping":
        addLine("sheetMetal", collapse(r.name), r.qty);
        break;
      case "metals":
        addLine("sheetMetal", collapse(r.name), r.qty);
        break;
      case "nondl":
        addLine("customApps", collapse(r.name), r.qty);
        break;
      case "accessory":
        unmapped.push({
          label: rowLabel(c),
          detail: `${d.kind ?? "Accessory"} — add on ${d.where ?? "Accessories"}.`,
        });
        break;
      case "unmatched":
        unmapped.push({
          label: rowLabel(c),
          detail: `From PlanSwift, not placed (${c.reason}) — add it where it belongs, or leave it out.`,
        });
        break;
    }
  }
  if (Object.keys(nonDlCustom).length)
    warnings.push(
      "Non-DL lines were added with the sheet's quantity and no price — enter their cost and labor on the Non-DL screen.",
    );

  const parapetFt = linears.filter((l) => l.role === "parapet").reduce((s, l) => s + l.lengthFt, 0);
  const q: TakeoffQuantities = {
    sections,
    linears,
    counts,
    unscaled: [],
    totals: {
      roofAreaSqFt: sections.reduce((s, x) => s + x.areaSqFt, 0),
      planAreaSqFt: sections.reduce((s, x) => s + x.planAreaSqFt, 0),
      perimeterFt: sections.reduce((s, x) => s + x.perimeterFt, 0),
      slopedPerimeterFt: sections.reduce((s, x) => s + x.perimeterFt, 0),
      parapetFt,
      cutoutWallFt: 0,
    },
  };
  const base = bidSeedFromTakeoff(setup, q, {
    takeoffName: opts.fileName,
    ...(opts.accountId !== undefined ? { accountId: opts.accountId } : {}),
  });

  // Sections: typed rectangles (PlanSwift has no outline), their own system / layers / notes.
  const seedSections: Array<Partial<BidSectionInput>> = base.sections.map((o, i) => {
    const { measured: _outline, ...rest } = o;
    const meta = sectionMeta[i]!;
    const c = meta.choice.row;
    const r = c.row;
    const m = c.details.membrane;
    const sys = systemOf(m, opts.labor, {
      ...(setup.roofSystem ? { roofSystem: setup.roofSystem } : {}),
      ...(setup.attachment ? { attachment: setup.attachment } : {}),
    });
    const out: Partial<BidSectionInput> = { ...rest };
    if (sys.roofSystem && sys.roofSystem !== setup.roofSystem) out.roofSystem = sys.roofSystem;
    if (sys.attachment && sys.attachment !== setup.attachment) out.attachment = sys.attachment;
    if (sys.thickness && sys.thickness !== setup.thickness) out.thickness = sys.thickness;
    // Insulation read from the name, bottom first as written, coverboards on top.
    const att: UnderlaymentLayer["attachment"] =
      (sys.roofSystem ?? setup.roofSystem) === "Duro-Bond" ? "durobond" : "mechanical";
    const layerNotes: string[] = [];
    const layers: UnderlaymentLayer[] = [];
    for (const g of m?.layers ?? []) {
      const board = matchBoard(g.boardName, opts.boardNames);
      if (!board) {
        layerNotes.push(
          `${g.text}: no "${g.boardName}" board in the list — add the layer by hand.`,
        );
        continue;
      }
      for (let k = 0; k < g.count; k++) layers.push(layerOf(board, att));
    }
    const notes = [
      `From PlanSwift: "${collapse(r.name)}" — ${num(r.qty)} sq ft${
        meta.rect.square
          ? `, no perimeter (a square of ${num(round2(meta.rect.length))} ft sides)`
          : `, ${num(meta.rect.perimeterFt)} ft around (Linear total)`
      }.`,
      meta.rect.square ? SQUARE_NOTE : EQUIVALENT_RECT_NOTE,
      ...(m?.notes ?? []),
      ...sys.notes,
      ...layerNotes,
    ];
    for (const n of [...sys.notes, ...layerNotes]) warnings.push(`${o.name}: ${n}`);
    if (!m?.roofSystem && setup.roofSystem)
      warnings.push(
        `${o.name}: the name names no membrane — it takes the bid's ${setup.roofSystem}.`,
      );
    out.notes = notes.join(" ");
    if (layers.length) out.layers = layers;
    return out;
  });

  // Tapered / crickets quote layers on their section (the largest when none was picked).
  const largest = sectionMeta.length
    ? sectionMeta.reduce((a, b) => (b.choice.row.row.qty > a.choice.row.row.qty ? b : a))
    : null;
  for (const t of tapered) {
    const r = t.row.row;
    const idx = sectionMeta.findIndex((s) => s.choice.row.row.sheetRow === t.onSection);
    const target = idx >= 0 ? idx : largest ? sectionMeta.indexOf(largest) : -1;
    const board = t.row.details.quoteBoard ?? "Tapered ISO";
    if (target < 0) {
      unmapped.push({
        label: rowLabel(t.row),
        detail: `${board} quote — there is no section to put it on; add it on Underlayment.`,
      });
      continue;
    }
    const o = seedSections[target]!;
    const layers = [...(o.layers ?? [])];
    const quoteLayer: UnderlaymentLayer = {
      ...layerOf(board, "mechanical"),
      quote: {
        id: `planswift-${r.sheetRow}`,
        name: `${collapse(r.name)} — ${num(r.qty)} sq ft (PlanSwift)`,
      },
    };
    // Above the insulation, below a coverboard / HD board.
    const coverAt = layers.findIndex((l) => /\bhd\b|cover|dens/i.test(l.board));
    layers.splice(coverAt >= 0 ? coverAt : layers.length, 0, quoteLayer);
    if (layers.length > MAX_UNDERLAYMENT_LAYERS) {
      warnings.push(
        `${o.name}: more than ${MAX_UNDERLAYMENT_LAYERS} layers — ${layers.length - MAX_UNDERLAYMENT_LAYERS} left off; check the Underlayment screen.`,
      );
      layers.length = MAX_UNDERLAYMENT_LAYERS;
    }
    o.layers = layers;
    warnings.push(
      `${collapse(r.name)} (${num(r.qty)} sq ft): a ${board} quote layer on "${o.name}" with no price — enter the quote on the Underlayment screen.`,
    );
  }

  // Parapets: the sheet's exact length and the skirt from the name.
  const parapets = base.parapets.map((p, i) => {
    const d = parapetRows[i]!.details;
    return {
      ...p,
      lengthFt: round2(parapetRows[i]!.row.qty),
      ...(d.skirtIn !== undefined ? { skirtInches: d.skirtIn } : {}),
    };
  });
  // Curbs: the third number is the height (wrap dim C).
  const curbs = base.curbs.map((k, i) => {
    const h = curbRows[i]!.details.heightIn;
    return h !== undefined ? { ...k, dimCIn: h } : k;
  });

  const pipeStacks = base.pipeStacks.map((p, i) => ({ ...p, id: `planswift-pipe-${i + 1}` }));
  const drains = base.drains.map((p, i) => ({ ...p, id: `planswift-drain-${i + 1}` }));
  const baseUnmapped = base.unmapped.map((u) => ({
    ...u,
    detail: u.detail.replace(
      "set the drain defaults on the takeoff's Setup tab or on each drain",
      "pick them on each drain",
    ),
  }));
  const allUnmapped = [...baseUnmapped, ...unmapped];

  const summaryParts = [
    sections.length
      ? `${sections.length} section${sections.length === 1 ? "" : "s"}, ${num(round2(q.totals.roofAreaSqFt))} sq ft`
      : "no sections",
    parapetFt > 0 ? `${num(round2(parapetFt))} ft of parapet` : null,
    curbs.length ? `${curbs.reduce((s, k) => s + (k.quantity ?? 0), 0)} curbs` : null,
    tapered.length
      ? `${tapered.length} tapered quote layer${tapered.length === 1 ? "" : "s"}`
      : null,
    pipeStacks.length ? `${pipeStacks.reduce((s, p) => s + p.quantity, 0)} pipe stacks` : null,
    drains.length ? `${drains.reduce((s, p) => s + p.quantity, 0)} drains` : null,
    Object.values(nonDlCustom).flat().length
      ? `${Object.values(nonDlCustom).flat().length} Non-DL line${Object.values(nonDlCustom).flat().length === 1 ? "" : "s"}`
      : null,
    allUnmapped.length ? `${allUnmapped.length} to place by hand` : null,
  ].filter((x): x is string => !!x);
  const summary = `From PlanSwift "${opts.fileName}": ${summaryParts.join("; ")}.`;

  const importInfo: PlanSwiftImportInfo = {
    source: "planswift",
    fileName: opts.fileName,
    sheetName: sheet.sheetName,
    importedAt: opts.importedAt ?? new Date().toISOString(),
    summary,
    unmapped: allUnmapped,
    warnings,
    mapping: choices.map((c) => ({
      sheetRow: c.row.row.sheetRow,
      name: c.row.row.name,
      qty: c.row.row.qty,
      units: c.row.row.units,
      target: c.target,
      detail: `${PLANSWIFT_TARGET_LABELS[c.target]}: ${describeTarget(c.row, c.target)}`,
    })),
  };

  return {
    ...base,
    sections: seedSections,
    parapets,
    curbs,
    pipeStacks,
    drains,
    unmapped: allUnmapped,
    summary,
    nonDlCustom,
    importInfo,
    warnings,
  };
}

/** The bid name the dialog starts from: "<Customer> · <file name without extension>". */
export function suggestPlanSwiftBidName(
  customerLabel: string | null | undefined,
  fileName: string,
): string {
  const base = collapse(fileName.replace(/\.[^.]+$/, ""));
  const who = collapse(customerLabel ?? "");
  return (who && base ? `${who} · ${base}` : who || base).slice(0, 200);
}

/**
 * The imported bid's name (owner, Oct 5: "just have the imported planswift file make an untitled
 * bid" — the customer is no longer required). A typed name wins; with a customer picked the
 * name is "<customer> · <file>"; with none it is plain "Untitled bid", to be named on the bid.
 */
export function planSwiftBidName(
  typed: string,
  customerLabel: string | null | undefined,
  fileName: string,
): string {
  const t = collapse(typed);
  if (t) return t.slice(0, 200);
  if (!collapse(customerLabel ?? "")) return "Untitled bid";
  return suggestPlanSwiftBidName(customerLabel, fileName) || "Untitled bid";
}

/**
 * The NEW bid from a PlanSwift seed: the takeoff's seed → bid step (`newBidFromSeed`), plus the
 * Non-DL custom lines (labor at the bid's crew rate) and the import record.
 */
export function savedFromPlanSwiftSeed(
  saved: SavedBidState & { sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]> },
  seed: PlanSwiftBidSeed,
  make: SeedFactories,
): SavedBidState {
  const merged = newBidFromSeed(saved, seed, make);
  const custom = { ...(saved.nonDlCalc?.custom ?? {}) };
  for (const [g, rows] of Object.entries(seed.nonDlCustom) as Array<[NonDlGroup, NonDlCustomRow[]]>)
    custom[g] = [
      ...(custom[g] ?? []),
      ...rows.map((r) => ({ ...r, laborRate: r.laborRate || saved.laborRate })),
    ];
  return {
    ...merged,
    nonDlCalc: { rows: saved.nonDlCalc?.rows ?? {}, custom },
    importInfo: seed.importInfo,
  };
}
