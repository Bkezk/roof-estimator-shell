/**
 * "Are you sure?" on a bid save (owner, Oct 7: "when there is a save with unusual metric … a pop
 * up occurs saying are you sure this number is correct and have it show the unusual metric";
 * "1 ft of parapet wall for a 10,000 sq foot building would be a mistake"). Pure: the facts a
 * bid offers, the rules over them, and which warnings the estimator has already waved through
 * (remembered on the bid by rule and value, so a save-anyway is not asked twice for the same
 * number). Nothing here blocks a save — it only asks. The bands are hard-coded for now (owner:
 * $3–$60 a sq ft); a Setup page can take them over later.
 */

export interface SanityWarning {
  /** The rule. */
  id: string;
  /** What is unusual, in words, with the number. */
  title: string;
  /** What is usual, so the estimator can judge. */
  detail: string;
  /** rule + the value that tripped it: the acknowledgement key. */
  key: string;
}

export interface SanityFacts {
  roofSqFt: number;
  /** Σ 2 × (length + width) over the sections, ft. */
  perimeterFt: number;
  sections: Array<{ name: string; lengthFt: number; widthFt: number }>;
  parapets: Array<{ name: string; lengthFt: number; verticalIn: number }>;
  curbs: Array<{ name: string; widthIn: number; lengthIn: number; quantity: number }>;
  drainCount: number;
  /** Gutters or scupper boxes on the Metals screen: a roof may drain without roof drains. */
  hasGuttersOrScuppers: boolean;
  pipeStackCount: number;
  grandTotal: number;
  /** 0 = % × cost, 1 = flat $/man-day, 2 = gross-profit %. */
  markupMode: number;
  markup: number;
  /** $/man-day typed by hand. */
  perDiemRate: number;
}

/** The bands (owner, Oct 7: "$3–60 band is good"). */
export const SANITY_BANDS = {
  pricePerSqFt: { min: 3, max: 60 },
  parapetMinShareOfPerimeter: 0.05,
  parapetMaxMultipleOfPerimeter: 1.2,
  parapetMaxHeightIn: 240,
  sectionSideFt: { min: 2, max: 1000 },
  sectionMaxAspect: 30,
  sectionAreaSqFt: { min: 100, max: 500_000 },
  drainsRoofSqFt: 5000,
  pipeStacksPer10k: 50,
  curbsPer10k: 40,
  curbSideIn: { min: 6, max: 240 },
  markupPct: { min: 5, max: 100 },
  perDiemMaxRate: 500,
} as const;

const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const fmt = (v: number, d = 0) =>
  v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const sq = (v: number) => `${fmt(v)} sq ft`;

/** The facts from a saved bid and the engine's result (null before the estimate has run). */
export function sanityFactsFromSaved(
  saved: {
    sections?: ReadonlyArray<{ name?: string; length?: number; width?: number }>;
    parapets?: ReadonlyArray<{ name?: string; lengthFt?: number; verticalInches?: number }>;
    curbs?: ReadonlyArray<{
      name?: string;
      widthIn?: number;
      lengthIn?: number;
      quantity?: number;
    }>;
    accessoriesCalc?: {
      pipeStacks?: ReadonlyArray<{ quantity?: number }>;
      drains?: ReadonlyArray<{ quantity?: number }>;
    };
    metalsCalc?: {
      gutters?: ReadonlyArray<unknown>;
      collectionBoxQty?: Record<string, Record<string, number>>;
    };
    markupMode?: number;
    markup?: number;
    perDiem?: number;
  },
  result: { roofSqFootage: number; money: { grandTotal: number } } | null,
): SanityFacts {
  const sections = (saved.sections ?? []).map((s, i) => ({
    name: s.name?.trim() || `Section ${i + 1}`,
    lengthFt: n0(s.length),
    widthFt: n0(s.width),
  }));
  const boxes = Object.values(saved.metalsCalc?.collectionBoxQty ?? {}).flatMap((m) =>
    Object.values(m ?? {}),
  );
  return {
    roofSqFt: result
      ? n0(result.roofSqFootage)
      : sections.reduce((t, s) => t + s.lengthFt * s.widthFt, 0),
    perimeterFt: sections.reduce((t, s) => t + 2 * (s.lengthFt + s.widthFt), 0),
    sections,
    parapets: (saved.parapets ?? []).map((p, i) => ({
      name: p.name?.trim() || `Parapet ${i + 1}`,
      lengthFt: n0(p.lengthFt),
      verticalIn: n0(p.verticalInches),
    })),
    curbs: (saved.curbs ?? []).map((c, i) => ({
      name: c.name?.trim() || `Curb ${i + 1}`,
      widthIn: n0(c.widthIn),
      lengthIn: n0(c.lengthIn),
      quantity: n0(c.quantity),
    })),
    drainCount: (saved.accessoriesCalc?.drains ?? []).reduce((t, d) => t + n0(d.quantity), 0),
    hasGuttersOrScuppers:
      (saved.metalsCalc?.gutters?.length ?? 0) > 0 || boxes.some((q) => n0(q) > 0),
    pipeStackCount: (saved.accessoriesCalc?.pipeStacks ?? []).reduce(
      (t, p) => t + n0(p.quantity),
      0,
    ),
    grandTotal: result ? n0(result.money.grandTotal) : 0,
    markupMode: n0(saved.markupMode),
    markup: n0(saved.markup),
    perDiemRate: n0(saved.perDiem),
  };
}

/** Every rule the facts trip. */
export function bidSanityWarnings(f: SanityFacts): SanityWarning[] {
  const out: SanityWarning[] = [];
  const warn = (id: string, value: string | number, title: string, detail: string) =>
    out.push({ id, title, detail, key: `${id}:${value}` });
  const B = SANITY_BANDS;
  const parapetFt = f.parapets.reduce((t, p) => t + p.lengthFt, 0);

  // Parapets against the roof edge.
  if (parapetFt > 0 && f.roofSqFt >= 2000 && f.perimeterFt > 0) {
    if (parapetFt < B.parapetMinShareOfPerimeter * f.perimeterFt)
      warn(
        "parapet-short",
        parapetFt,
        `Parapet ${fmt(parapetFt, 2)} ft on a ${sq(f.roofSqFt)} roof`,
        `The roof edge is ${fmt(f.perimeterFt)} ft; a parapet shorter than 5 % of it is usually a typo.`,
      );
  }
  if (f.perimeterFt > 0 && parapetFt > B.parapetMaxMultipleOfPerimeter * f.perimeterFt)
    warn(
      "parapet-long",
      parapetFt,
      `Parapet ${fmt(parapetFt, 2)} ft is longer than the roof edge (${fmt(f.perimeterFt)} ft)`,
      "More parapet than edge means a length or a section size is off.",
    );
  for (const p of f.parapets) {
    if (p.lengthFt > 0 && p.verticalIn <= 0)
      warn(
        "parapet-height",
        `${p.name}:0`,
        `${p.name} has no height`,
        "Set its Vertical inches on the Parapets screen.",
      );
    else if (p.verticalIn > B.parapetMaxHeightIn)
      warn(
        "parapet-height",
        `${p.name}:${p.verticalIn}`,
        `${p.name} is ${fmt(p.verticalIn)} in (${fmt(p.verticalIn / 12, 1)} ft) tall`,
        "Parapets over 20 ft are rare; inches and feet may be swapped.",
      );
  }

  // Sections.
  for (const s of f.sections) {
    const [lo, hi] = [Math.min(s.lengthFt, s.widthFt), Math.max(s.lengthFt, s.widthFt)];
    const area = s.lengthFt * s.widthFt;
    if (lo > 0 && lo < B.sectionSideFt.min)
      warn(
        "section-side",
        `${s.name}:${lo}`,
        `${s.name} has a ${fmt(lo, 2)} ft side`,
        "A side under 2 ft is usually inches typed as feet.",
      );
    if (hi > B.sectionSideFt.max)
      warn(
        "section-side",
        `${s.name}:${hi}`,
        `${s.name} has a ${fmt(hi)} ft side`,
        "A side over 1,000 ft is longer than most buildings.",
      );
    if (lo > 0 && hi / lo > B.sectionMaxAspect)
      warn(
        "section-skinny",
        `${s.name}:${fmt(hi)}x${fmt(lo)}`,
        `${s.name} is ${fmt(hi, 1)} × ${fmt(lo, 1)} ft`,
        "A strip over 30 times longer than wide is usually a perimeter mistaken for a side (a PlanSwift rectangle, for one).",
      );
    if (area > 0 && area < B.sectionAreaSqFt.min)
      warn(
        "section-area",
        `${s.name}:${fmt(area)}`,
        `${s.name} is only ${sq(area)}`,
        "Check its size.",
      );
    if (area > B.sectionAreaSqFt.max)
      warn(
        "section-area",
        `${s.name}:${fmt(area)}`,
        `${s.name} is ${sq(area)}`,
        "Over 500,000 sq ft in one section is unusual.",
      );
  }

  // Drainage and penetrations.
  if (f.roofSqFt >= B.drainsRoofSqFt && f.drainCount === 0 && !f.hasGuttersOrScuppers)
    warn(
      "drains-none",
      fmt(f.roofSqFt),
      `No drains, gutters or scuppers on a ${sq(f.roofSqFt)} roof`,
      "Every roof drains somewhere — add the drains, or the gutters / scupper boxes on Metals.",
    );
  if (f.roofSqFt >= 1000) {
    const per10k = (n: number) => (n / f.roofSqFt) * 10_000;
    if (per10k(f.pipeStackCount) > B.pipeStacksPer10k)
      warn(
        "stacks-many",
        f.pipeStackCount,
        `${fmt(f.pipeStackCount)} pipe stacks on ${sq(f.roofSqFt)}`,
        `That is ${fmt(per10k(f.pipeStackCount))} per 10,000 sq ft; over 50 is rare.`,
      );
    const curbCount = f.curbs.reduce((t, c) => t + c.quantity, 0);
    if (per10k(curbCount) > B.curbsPer10k)
      warn(
        "curbs-many",
        curbCount,
        `${fmt(curbCount)} curbs on ${sq(f.roofSqFt)}`,
        `That is ${fmt(per10k(curbCount))} per 10,000 sq ft; over 40 is rare.`,
      );
  }
  for (const c of f.curbs) {
    if (c.quantity <= 0) continue;
    const [lo, hi] = [Math.min(c.widthIn, c.lengthIn), Math.max(c.widthIn, c.lengthIn)];
    if (lo > 0 && lo < B.curbSideIn.min)
      warn(
        "curb-size",
        `${c.name}:${lo}`,
        `${c.name} is ${fmt(lo, 2)} in on a side`,
        "Under 6 in: feet typed as inches, or a drop / downspout, not a curb.",
      );
    if (hi > B.curbSideIn.max)
      warn(
        "curb-size",
        `${c.name}:${hi}`,
        `${c.name} is ${fmt(hi)} in (${fmt(hi / 12, 1)} ft) on a side`,
        "Over 20 ft: inches and feet may be swapped.",
      );
  }

  // Money.
  if (f.roofSqFt > 0 && f.grandTotal > 0) {
    const per = f.grandTotal / f.roofSqFt;
    if (per < B.pricePerSqFt.min || per > B.pricePerSqFt.max)
      warn(
        "price-per-sqft",
        per.toFixed(2),
        `Bid total ${usd(f.grandTotal)} is ${usd(per)} a sq ft`,
        `Most bids land between ${usd(B.pricePerSqFt.min)} and ${usd(B.pricePerSqFt.max)} a sq ft.`,
      );
  }
  if (f.markupMode !== 1 && (f.markup < B.markupPct.min || f.markup > B.markupPct.max))
    warn(
      "markup",
      f.markup,
      `Markup ${fmt(f.markup, 2)} %`,
      "Under 5 % or over 100 % is rarely meant; check the Review's markup.",
    );
  if (f.perDiemRate > B.perDiemMaxRate)
    warn(
      "per-diem",
      f.perDiemRate,
      `Per diem ${usd(f.perDiemRate)} a man-day`,
      "Over $500 a man-day — a flat total may have been typed as the rate (the Review calculator converts it).",
    );
  return out;
}

/** The warnings not yet waved through on this bid. */
export function unacknowledged(
  warnings: readonly SanityWarning[],
  acknowledged: readonly string[] | undefined,
): SanityWarning[] {
  const seen = new Set(acknowledged ?? []);
  return warnings.filter((w) => !seen.has(w.key));
}

/** The acknowledgement list after a save-anyway: the new keys, and only keys still tripped stay. */
export function acknowledgeAll(
  acknowledged: readonly string[] | undefined,
  warnings: readonly SanityWarning[],
): string[] {
  const live = new Set(warnings.map((w) => w.key));
  return [
    ...new Set([...(acknowledged ?? []).filter((k) => live.has(k)), ...warnings.map((w) => w.key)]),
  ];
}
