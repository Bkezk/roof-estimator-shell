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
import type { MetalsCatalogItem } from "@/lib/engine/adapters";
import {
  normalizeAccessoriesState,
  SNAP_SIZES,
  SNAP_TERMINATION_ID,
  type SnapSize,
} from "@/lib/engine/accessories";
import {
  MAX_UNDERLAYMENT_LAYERS,
  type BidSectionInput,
  type UnderlaymentLayer,
} from "@/lib/engine/bid-builder";
import {
  normalizeMetalsState,
  type DownspoutEntryState,
  type GutterEntryState,
} from "@/lib/engine/metals";
import { bootPickSize, parseElbowPick, parseGutterPick } from "./picks";
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
  formatInches,
  parseInchNumber,
  PLANSWIFT_TARGET_LABELS,
  type ClassifiedRow,
  type InsulationGuess,
  type MembraneGuess,
  type PlanSwiftTarget,
} from "./classify";
import { pipeStackOpenFromName } from "@/lib/pipe-stack-edit";
import { inchToken, matchDrainPicks } from "./drain-picks";
import type { PlanSwiftRow, PlanSwiftSheet } from "./parse";

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
  /**
   * Metals screen state from the sheet (owner, Oct 6, Towneplace Suites: downspouts are the
   * Metals screen's, not Non-DL): downspouts by size — lengths and their drops / elbows.
   */
  metalsCalc: { downspouts: DownspoutEntryState[]; gutters: GutterEntryState[] };
  /**
   * Two-piece edge metal by size, in feet (`6" 2-piece` 1,437.55 ft): Accessories › Base & Snap
   * Cover, where the engine prices the compression metal, its covers and corners (legacy
   * TwoPieceMetal). The parapets whose termination is that size already count there, so the
   * bid gets the sheet's footage less theirs as "Additional Required" (savedFromPlanSwiftSeed).
   */
  twoPieceFt: Partial<Record<SnapSize, number>>;
  /** Walk pad counts by Accessories › Walk Pads row. */
  walkPads: Record<string, number>;
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
  /**
   * The estimator's answer when the row needs one (owner, Oct 8: "if it doesn't know it'll ask";
   * lib/planswift/picks.ts): a gutter's `style|size`, a downspout's size, an elbow's
   * `size|row`, a drain's boot. Absent: placed as the name allows, or listed to place by hand.
   */
  pick?: string;
}

export interface PlanSwiftSeedOptions {
  fileName: string;
  /** Setup defaults (the takeoff's up-front answers); override what the names suggest. */
  setup?: TakeoffSetup;
  /** Live underlayment board names (admin.underlaymentPrices keys), to spell layers as the list does. */
  boardNames?: readonly string[];
  /** Live labor combos (admin.labor): which systems / attachments / mils exist. */
  labor?: Record<string, { thicknessLaborByMil: Record<number, number> }>;
  /**
   * The live Metals screen catalog (getMetalsCatalog): downspout rows by size and the two-piece
   * rows, so downspouts, drops and two-piece metal land on the Metals screen with their prices.
   * Absent: those rows are listed to place by hand.
   */
  metalsCatalog?: readonly MetalsCatalogItem[];
  /** The live Accessories › Walk Pads rows (descriptions), so a walk pad count lands there. */
  walkPadRows?: readonly string[];
  /**
   * The live Roof Drains & Boots lists (boot and ring descriptions), so a drain row with a size
   * (`3" Drains`) lands there with the 3" boot and the 3" ring picked (owner, Oct 8).
   */
  drainBoots?: readonly string[];
  drainRings?: readonly string[];
  /** Metals › Gutters sizes by style, for a gutter row's pick (owner's Pineville file, Oct 8). */
  gutterSizesByStyle?: Record<string, readonly string[]>;
  /** The bid's colour, for walk pads whose name says none ("White" when absent). */
  color?: string;
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

/**
 * A thickness no single board has, as a stack of the list's boards (owner, Oct 6: "there's no such
 * thing as 6 inch underlayment, it would be two layers of 3 inch"): the fewest boards, and among
 * those the most even split — 6" → 3" + 3", 5" → 2 1/2" + 2 1/2", 4 1/2" → 2" + 2 1/2". Only for
 * the flat insulation boards (ISO, Rigid); null when no stack of up to four boards adds up.
 */
export function splitBoardThickness(
  thicknessIn: number,
  kind: InsulationGuess["kind"],
  boardNames: readonly string[],
): string[] | null {
  const family = kind === "iso" ? /^\s*(\S.*?)"\s*ISO\s*$/i : /^\s*(\S.*?)"\s*Rigid\s*$/i;
  if (kind !== "iso" && kind !== "eps" && kind !== "xps") return null;
  const boards: Array<{ name: string; t: number }> = [];
  for (const name of boardNames) {
    const m = family.exec(name);
    const t = m ? parseInchNumber(m[1]!) : null;
    if (t !== null && t > 0) boards.push({ name, t });
  }
  if (!boards.length) return null;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
  let best: Array<{ name: string; t: number }> | null = null;
  const walk = (
    from: number,
    left: number,
    stack: Array<{ name: string; t: number }>,
    max: number,
  ) => {
    if (close(left, 0)) {
      if (stack.length) {
        const spread = Math.max(...stack.map((b) => b.t)) - Math.min(...stack.map((b) => b.t));
        const bestSpread = best
          ? Math.max(...best.map((b) => b.t)) - Math.min(...best.map((b) => b.t))
          : Infinity;
        if (!best || spread < bestSpread - 1e-9) best = [...stack];
      }
      return;
    }
    if (stack.length >= max || left < 0) return;
    for (let i = from; i < boards.length; i++) {
      const b = boards[i]!;
      if (b.t > left + 0.01) continue;
      stack.push(b);
      walk(i, left - b.t, stack, max);
      stack.pop();
    }
  };
  for (let n = 2; n <= 4 && !best; n++) walk(0, thicknessIn, [], n);
  return best ? (best as Array<{ name: string; t: number }>).map((b) => b.name) : null;
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

const normDesc = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");

/**
 * The Metals catalog rows of a downspout size (`3"X4"`): the catalog groups them under
 * "Downspouts 3"X4"" (buildMetalsCatalog).
 */
export function downspoutRows(
  catalog: readonly MetalsCatalogItem[] | undefined,
  size: string,
): MetalsCatalogItem[] {
  if (!catalog) return [];
  const want = normDesc(`downspouts ${size}`);
  return catalog.filter((i) => normDesc(i.category) === want);
}

/**
 * The Accessories › Walk Pads row a sheet row means (owner, Oct 6: "walk pads were not picked up
 * with the import"): 60" x 60" when the name says so, else 30" x 60"; the colour the name says
 * (White / Gray / Tan / Safety), else the bid's colour, else White; "Fully Skirted" only when the
 * name says skirted. Null when the list has no such row.
 */
export function walkPadRowFor(
  name: string,
  rows: readonly string[] | undefined,
  color: string | undefined,
): string | null {
  if (!rows?.length) return null;
  const n = name.toLowerCase();
  const big = /60\s*["”]?\s*[x×]\s*60/.test(n);
  const colour = /safety/.test(n)
    ? "safety"
    : /gr[ae]y/.test(n)
      ? "gray"
      : /\btan\b/.test(n)
        ? "tan"
        : /white/.test(n)
          ? "white"
          : (color ?? "white").toLowerCase();
  const skirted = /skirt/.test(n);
  const pads = rows.filter((r) => /walk\s*pad/i.test(r));
  const pick = (c: string) =>
    pads.find((r) => {
      const k = normDesc(r);
      return (
        (big ? k.startsWith('60"x60"') : k.startsWith('30"x60"')) &&
        k.includes(c) &&
        /skirted/.test(k) === skirted
      );
    });
  return pick(colour) ?? (colour !== "white" ? pick("white") : undefined) ?? null;
}

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
  // Metals screen: downspout entries by size, two-piece lines; Accessories: walk pad counts.
  const downspoutBySize = new Map<string, DownspoutEntryState>();
  const downspoutEntry = (size: string) => {
    let e = downspoutBySize.get(size);
    if (!e) {
      e = { size, lengthByDesc: {}, accQty: {} };
      downspoutBySize.set(size, e);
    }
    return e;
  };
  const twoPieceFt: Partial<Record<SnapSize, number>> = {};
  const walkPads: Record<string, number> = {};
  // Metals › Gutters: one entry per style / size the estimator picked (owner's Pineville file,
  // Oct 8: the gutter had gone to Non-DL Sheet Metals).
  const gutters: GutterEntryState[] = [];
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
      case "gutter": {
        // With a style and size picked on the review screen it is a Metals › Gutters entry;
        // without one it is listed here so the label keeps the sheet's number.
        const g = parseGutterPick(ch.pick);
        if (g && (opts.gutterSizesByStyle?.[g.style] ?? []).includes(g.size)) {
          const existing = gutters.find((x) => x.style === g.style && x.size === g.size);
          if (existing) existing.lengthFt = round2(existing.lengthFt + r.qty);
          else gutters.push({ style: g.style, size: g.size, lengthFt: round2(r.qty), accQty: {} });
          warnings.push(
            `${collapse(r.name)}: ${num(round2(r.qty))} ft on Metals › Gutters as ${g.style.replace(/-Style$/, "")} ${g.size} — add its miters, end caps and splice plates there.`,
          );
          break;
        }
        unmapped.push({
          label: rowLabel(c),
          detail: opts.gutterSizesByStyle
            ? "Gutter — pick its style and size on the review screen, or add it on Metals › Gutters."
            : "Gutter — add on Metals › Gutters.",
        });
        break;
      }
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
      case "drain": {
        const k: CountQuantity = {
          name: collapse(r.name),
          role: "drain",
          qty: Math.round(r.qty),
          objectIds: [id],
        };
        // A size in the name picks the boot and the same-size ring from the price list (owner,
        // Oct 8); without one, or without that size in the list, the drain is listed to place.
        // The review screen's pick (a boot) stands in for a size the name lacks.
        const pickedIn = ch.pick ? bootPickSize(ch.pick) : null;
        const sizeIn = d.sizeIn ?? (pickedIn !== null ? pickedIn : undefined);
        const picks =
          sizeIn !== undefined
            ? matchDrainPicks(sizeIn, opts.drainBoots ?? [], opts.drainRings ?? [])
            : null;
        if (picks) {
          k.bootSize = picks.bootSize;
          k.ringSize = picks.ringSize;
        } else if (d.sizeIn !== undefined && (opts.drainBoots?.length || opts.drainRings?.length)) {
          warnings.push(
            `${k.name}: no ${inchToken(d.sizeIn)} drain boot and ring in the price list — pick them on each drain.`,
          );
        }
        counts.push(k);
        break;
      }
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
      case "downspout": {
        // Owner, Oct 6 (Towneplace Suites): downspouts and their drops are the Metals screen's
        // Downspouts, by size — never Non-DL, never a curb.
        const where = "Metals › Downspouts";
        if (d.dsPart === "count") {
          unmapped.push({
            label: rowLabel(c),
            detail: `Downspouts counted, not measured — enter their length on ${where}.`,
          });
          break;
        }
        // The review screen's pick fills in what the name lacks: a size for a length or drops,
        // the size and the row for an elbow (owner's Pineville file, Oct 8: `45's` ×72).
        const elbowPick = d.dsPart === "elbow" ? parseElbowPick(ch.pick) : null;
        const dsSize = d.dsSize ?? elbowPick?.size ?? (d.dsPart !== "elbow" ? ch.pick : undefined);
        if (!dsSize) {
          unmapped.push({
            label: rowLabel(c),
            detail: `${d.kind ?? "Downspouts"} with no size in the name — pick the size on ${where}.`,
          });
          break;
        }
        const rows = downspoutRows(opts.metalsCatalog, dsSize);
        if (!rows.length) {
          unmapped.push({
            label: rowLabel(c),
            detail: opts.metalsCatalog
              ? `${d.kind ?? "Downspouts"} ${dsSize} — the Metals catalog has no ${dsSize} downspout; add it on ${where}.`
              : `${d.kind ?? "Downspouts"} ${dsSize} — add on ${where} (the Metals catalog was not loaded).`,
          });
          break;
        }
        const e = downspoutEntry(dsSize);
        if (d.dsPart === "length") {
          const want = d.dsClosed ? /downspout\s*-\s*closed/i : /downspout\s*-\s*open/i;
          const row =
            rows.find((i) => want.test(i.description)) ??
            rows.find((i) => /downspout/i.test(i.description));
          if (!row) {
            unmapped.push({
              label: rowLabel(c),
              detail: `Downspouts ${dsSize} — no length row in the Metals catalog; add on ${where}.`,
            });
            break;
          }
          e.lengthByDesc[row.description] = round2((e.lengthByDesc[row.description] ?? 0) + r.qty);
          if (!d.dsClosed)
            warnings.push(
              `${collapse(r.name)}: read as "${row.description}" — change it to Closed on ${where} if these are closed.`,
            );
        } else if (d.dsPart === "Drop/Outlet") {
          const row = rows.find((i) => /drop|outlet/i.test(i.description));
          if (!row) {
            unmapped.push({
              label: rowLabel(c),
              detail: `Drops ${dsSize} — no Drop/Outlet row in the Metals catalog; add on ${where}.`,
            });
            break;
          }
          e.accQty[row.description] = (e.accQty[row.description] ?? 0) + Math.round(r.qty);
        } else {
          // An elbow: the catalog has 45° / 80°, A / B styles — only a name that says which is placed.
          const deg = /45/.test(r.name) ? "45" : /80/.test(r.name) ? "80" : null;
          const style = /\bb[\s-]*style|\bb\b/i.test(r.name)
            ? "B"
            : /\ba[\s-]*style|\ba\b/i.test(r.name)
              ? "A"
              : null;
          const row = elbowPick
            ? rows.find((i) => i.description === elbowPick.description)
            : deg && style
              ? rows.find(
                  (i) =>
                    i.description.includes(`${deg}°`) &&
                    new RegExp(`\\b${style}-Style`, "i").test(i.description),
                )
              : undefined;
          if (!row) {
            unmapped.push({
              label: rowLabel(c),
              detail: `Elbows ${dsSize} — pick the style (45° / 80°, A / B) on ${where}.`,
            });
            break;
          }
          e.accQty[row.description] = (e.accQty[row.description] ?? 0) + Math.round(r.qty);
        }
        break;
      }
      case "twopiece": {
        // Owner's Towneplace file: `6" 2-piece` 1,437.55 ft — Accessories › Base & Snap Cover, the
        // 6" size, covers on; the engine adds its 3 % and rounds to the next 10 ft as legacy did.
        const where = "Accessories › Base & Snap Cover";
        const size =
          d.twoPieceIn !== undefined
            ? SNAP_SIZES.find((k) => Number(k) === d.twoPieceIn)
            : undefined;
        if (!size) {
          unmapped.push({
            label: rowLabel(c),
            detail:
              d.twoPieceIn === undefined
                ? `Two-piece edge metal with no size in the name — add on ${where}.`
                : `Two-piece edge metal ${formatInches(d.twoPieceIn)}" — the bid has 3" to 8" two-piece; add on ${where}.`,
          });
          break;
        }
        twoPieceFt[size] = round2((twoPieceFt[size] ?? 0) + r.qty);
        warnings.push(
          `${collapse(r.name)}: ${num(round2(r.qty))} ft on ${where} (${size}", covers on) — the parapets terminated in ${size}" two-piece count there by themselves; the rest is Additional Required.`,
        );
        break;
      }
      case "accessory": {
        if (d.kind === "Walk pads") {
          const row = walkPadRowFor(r.name, opts.walkPadRows, opts.color);
          if (row) {
            walkPads[row] = (walkPads[row] ?? 0) + Math.round(r.qty);
            warnings.push(
              `${collapse(r.name)}: ${num(Math.round(r.qty))} placed as "${row}" — change the size or colour on Accessories › Walk Pads if the job uses another.`,
            );
            break;
          }
        }
        unmapped.push({
          label: rowLabel(c),
          detail: `${d.kind ?? "Accessory"} — add on ${d.where ?? "Accessories"}.`,
        });
        break;
      }
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
        // No single board that thick: the list's boards stacked to it (6" → 3" + 3").
        const stack = opts.boardNames
          ? splitBoardThickness(g.thicknessIn, g.kind, opts.boardNames)
          : null;
        if (stack) {
          for (let k = 0; k < g.count; k++) for (const b of stack) layers.push(layerOf(b, att));
          layerNotes.push(`${g.text}: no single board that thick — ${stack.join(" + ")}.`);
          continue;
        }
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

  // A quote layer (Tapered ISO / Tapered Crickets) on a section: above the insulation, below
  // a coverboard / HD board.
  const addQuoteLayer = (target: number, board: string, r: PlanSwiftRow, idSuffix = "") => {
    const o = seedSections[target]!;
    const layers = [...(o.layers ?? [])];
    const quoteLayer: UnderlaymentLayer = {
      ...layerOf(board, "mechanical"),
      quote: {
        id: `planswift-${r.sheetRow}${idSuffix}`,
        name: `${collapse(r.name)} — ${num(r.qty)} sq ft (PlanSwift)`,
      },
    };
    const coverAt = layers.findIndex((l) => /\bhd\b|cover|dens/i.test(l.board));
    layers.splice(coverAt >= 0 ? coverAt : layers.length, 0, quoteLayer);
    return { o, layers, quoteLayer };
  };

  // A section whose own name says tapered (owner, Oct 5: "… 1/8th per Ft Tappered Iso …"): its
  // quote layer sits in its own stack, with no price until the quote is entered.
  let taperedInName = 0;
  sectionMeta.forEach((meta, i) => {
    const c = meta.choice.row;
    if (!c.details.taperedInName) return;
    const board = c.details.quoteBoard ?? "Tapered ISO";
    const { o, layers } = addQuoteLayer(i, board, c.row, "-tapered");
    if (layers.length > MAX_UNDERLAYMENT_LAYERS) {
      warnings.push(
        `${o.name}: the name's ${board} layer would be layer ${layers.length} (the limit is ${MAX_UNDERLAYMENT_LAYERS}) — add it by hand on Underlayment.`,
      );
      return;
    }
    o.layers = layers;
    taperedInName++;
    warnings.push(
      `${o.name}: a ${board} quote layer from its name, with no price — enter the quote on the Underlayment screen.`,
    );
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
    const { o, layers } = addQuoteLayer(target, board, r);
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

  // Owner, Oct 6: a PlanSwift pipe stack is OPEN unless its row says closed (the drawing takeoff
  // keeps the entry form's default).
  const pipeNameById = new Map(
    counts.filter((c) => c.role === "pipe").map((c) => [c.objectIds[0], c.name] as const),
  );
  const pipeStacks = base.pipeStacks.map((p, i) => ({
    ...p,
    id: `planswift-pipe-${i + 1}`,
    open: pipeStackOpenFromName(pipeNameById.get(p.takeoffObjectId ?? "") ?? ""),
  }));
  const drains = base.drains.map((p, i) => ({ ...p, id: `planswift-drain-${i + 1}` }));
  const baseUnmapped = base.unmapped.map((u) => ({
    ...u,
    detail: u.detail.replace(
      "set the drain defaults on the takeoff's Setup tab or on each drain",
      "pick them on each drain",
    ),
  }));
  const allUnmapped = [...baseUnmapped, ...unmapped];
  const downspouts = [...downspoutBySize.values()];
  const downspoutFt = downspouts.reduce(
    (s, e) => s + Object.values(e.lengthByDesc).reduce((a, b) => a + b, 0),
    0,
  );
  const downspoutParts = downspouts.reduce(
    (s, e) => s + Object.values(e.accQty).reduce((a, b) => a + b, 0),
    0,
  );
  const walkPadCount = Object.values(walkPads).reduce((a, b) => a + b, 0);
  const twoPieceTotal = Object.values(twoPieceFt).reduce((a, b) => a + (b ?? 0), 0);

  const summaryParts = [
    sections.length
      ? `${sections.length} section${sections.length === 1 ? "" : "s"}, ${num(round2(q.totals.roofAreaSqFt))} sq ft`
      : "no sections",
    parapetFt > 0 ? `${num(round2(parapetFt))} ft of parapet` : null,
    curbs.length ? `${curbs.reduce((s, k) => s + (k.quantity ?? 0), 0)} curbs` : null,
    tapered.length + taperedInName
      ? `${tapered.length + taperedInName} tapered quote layer${tapered.length + taperedInName === 1 ? "" : "s"}`
      : null,
    pipeStacks.length ? `${pipeStacks.reduce((s, p) => s + p.quantity, 0)} pipe stacks` : null,
    drains.length ? `${drains.reduce((s, p) => s + p.quantity, 0)} drains` : null,
    Object.values(nonDlCustom).flat().length
      ? `${Object.values(nonDlCustom).flat().length} Non-DL line${Object.values(nonDlCustom).flat().length === 1 ? "" : "s"}`
      : null,
    downspoutFt > 0 ? `${num(round2(downspoutFt))} ft of downspout` : null,
    downspoutParts > 0 ? `${downspoutParts} downspout drops / elbows` : null,
    twoPieceTotal > 0 ? `${num(round2(twoPieceTotal))} ft of two-piece metal` : null,
    walkPadCount > 0 ? `${walkPadCount} walk pads` : null,
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
    metalsCalc: { downspouts, gutters },
    twoPieceFt,
    walkPads,
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
  // Metals screen: the sheet's downspouts join any the bid has; walk pads join Accessories ›
  // Walk Pads; two-piece metal goes on Base & Snap Cover (owner, Oct 6).
  const metalsCalc = normalizeMetalsState(merged.metalsCalc ?? saved.metalsCalc);
  const acc = normalizeAccessoriesState(merged.accessoriesCalc ?? saved.accessoriesCalc);
  const walkQty = { ...acc.walkPads.qty };
  for (const [desc, n] of Object.entries(seed.walkPads ?? {}))
    walkQty[desc] = (walkQty[desc] ?? 0) + n;
  const snapCover = { ...acc.snapCover };
  for (const [size, ft] of Object.entries(seed.twoPieceFt ?? {}) as Array<[SnapSize, number]>) {
    if (!(ft > 0)) continue;
    const extra = twoPieceAdditionalFt(ft, size, merged.parapets ?? []);
    snapCover[size] = {
      ...snapCover[size],
      coversOn: true,
      additionalFt: round2((snapCover[size].additionalFt || 0) + extra),
    };
  }
  return {
    ...merged,
    nonDlCalc: { rows: saved.nonDlCalc?.rows ?? {}, custom },
    metalsCalc: {
      ...metalsCalc,
      downspouts: [...metalsCalc.downspouts, ...(seed.metalsCalc?.downspouts ?? [])],
      gutters: [...metalsCalc.gutters, ...(seed.metalsCalc?.gutters ?? [])],
    },
    accessoriesCalc: { ...acc, walkPads: { ...acc.walkPads, qty: walkQty }, snapCover },
    importInfo: seed.importInfo,
  };
}

/**
 * Base & Snap Cover's "Additional Required" for a sheet's two-piece footage: the sheet measured
 * the whole run, and the engine already counts every parapet whose termination is that size
 * (legacy "Calculated Total" = roof sides + parapets), so only the rest is typed in. Never
 * negative: when the parapets alone exceed the sheet, nothing is added.
 */
export function twoPieceAdditionalFt(
  sheetFt: number,
  size: SnapSize,
  parapets: ReadonlyArray<{ lengthFt?: number; termOptionId?: number; termLengthFt?: number }>,
): number {
  const id = SNAP_TERMINATION_ID[size];
  const counted = parapets
    .filter((p) => p.termOptionId === id)
    .reduce((s, p) => s + (p.termLengthFt ?? p.lengthFt ?? 0), 0);
  return Math.max(0, round2(sheetFt - counted));
}
