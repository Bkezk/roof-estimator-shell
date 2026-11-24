/**
 * Metals prices typed on one bid (owner, Nov 24: "make it to where the metals price box is
 * editable and it just stays on that bid ... I can change the price and it only effect this bid").
 *
 * On Estimator › Metals the Cost/Quote amount of a line can be typed over. The typed amount is
 * the line's WHOLE amount in dollars, kept on the bid (SavedBidState.metalsTypedPrices) and
 * nowhere else: Estimate Pricing and every other bid are untouched, and "Update pricing & labor"
 * does not replace it. It stays until the estimator clears it or removes the line.
 *
 * The engine (src/lib/engine/**) is not changed and knows nothing about it. It is applied on
 * both sides of the engine instead, in buildEstimateInputsWithMetalsPrices:
 *
 *  - GOING IN: the difference between the typed amounts and the worked ("list") amounts rides in
 *    as one extra flat metals line (BidInput.metals, the slot older bids' catalog lines bill
 *    through: material into the same Duro-Last metals total, no labor). So freight, tax, markup
 *    and the bid total are all worked by the engine itself from the changed metals material.
 *    No typed price = no extra line = the engine's input is exactly what it was.
 *  - COMING OUT: the engine's metals summary (BuildResult.metalsScreen) is replaced by the same
 *    lines with the typed amounts on them (priceMetals), each line saying whether it was typed
 *    and what the list price is, so the screen, the card totals and the summary read alike.
 *
 * Labor is not touched: a typed price changes the material amount only.
 *
 * The zero note: when "Update pricing & labor" is pressed, every line whose typed price is 0 at
 * that moment is flagged (markMetalsZeroAtUpdate). A flagged line whose price is still 0 gives
 * one yellow notice (metalsZeroNotices). The flag goes when the price is changed or cleared.
 *
 * Pure, no I/O.
 */
import type { EngineAdminData } from "@/lib/engine/adapters";
import {
  buildEstimateInputs,
  type BidInput,
  type BuildResult,
  type MetalLine,
} from "@/lib/engine/bid-builder";
import {
  computeMetals,
  normalizeMetalsState,
  type MetalsLine,
  type MetalsLineSource,
  type MetalsResult,
  type MetalsState,
} from "@/lib/engine/metals";

const f32 = Math.fround;

/** The most a typed price can be. */
export const MAX_METALS_TYPED_PRICE = 9_999_999.99;

/** How many typed prices a bid keeps (far more than a Metals list has lines). */
export const MAX_METALS_TYPED_PRICES = 500;

/** One typed price, as kept on the bid. */
export interface MetalsTypedPrice {
  /** Which line it belongs to (metalsLineKeys). */
  key: string;
  /** The line's whole Cost/Quote amount, in dollars. Never negative. */
  amount: number;
  /** The amount was 0 when "Update pricing & labor" was last pressed. */
  zeroAtUpdate?: true;
}

/** A Metals summary line with the bid's typed price on it. */
export interface PricedMetalsLine extends MetalsLine {
  /** What a typed price for this line is remembered by. */
  priceKey: string;
  /** The worked price from Estimate Pricing: what the line bills with no typed price. */
  listMaterialCost: number;
  /** True when `materialCost` is an amount typed on this bid. */
  priceTyped: boolean;
}

/** The Metals summary with the bid's typed prices applied. */
export interface PricedMetalsResult extends MetalsResult {
  lines: PricedMetalsLine[];
  /** The material total at list prices (what the engine worked). */
  listMaterialCost: number;
}

/** Dollars and cents, never negative, never over the limit. Not a number: null. */
export function metalsPriceAmount(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const cents = Math.round(Math.max(0, Math.min(MAX_METALS_TYPED_PRICE, v)) * 100) / 100;
  return cents === 0 ? 0 : cents;
}

/** What one entry of the Metals screen is remembered by. */
export function metalsSourceKey(src: MetalsLineSource): string {
  switch (src.kind) {
    case "gutter":
      return JSON.stringify([src.kind, src.style, src.size]);
    case "gutterAcc":
      return JSON.stringify([src.kind, src.style, src.size, src.desc]);
    case "downspout":
    case "downspoutAcc":
      return JSON.stringify([src.kind, src.size, src.desc]);
    case "generalAcc":
    case "pitchPan":
      return JSON.stringify([src.kind, src.desc]);
    case "collectionBox":
      return JSON.stringify([src.kind, src.option, src.desc]);
  }
}

/**
 * One key per line, in the list's order. Two lines from the same entry (an import can add a
 * gutter the bid already has) get their own keys, the second ending "#2", so a price typed on
 * one is never billed on both.
 */
export function metalsLineKeys(sources: readonly MetalsLineSource[]): string[] {
  const seen = new Map<string, number>();
  return sources.map((src) => {
    const key = metalsSourceKey(src);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}#${n}`;
  });
}

/**
 * Every entry the Metals state carries a quantity or a length for, as the sources the engine
 * gives its summary lines (computeMetals), read from the state alone so it needs no price list.
 */
export function metalsStateSources(state: MetalsState): MetalsLineSource[] {
  const out: MetalsLineSource[] = [];
  const has = (m: Record<string, number>) =>
    Object.entries(m)
      .filter(([, q]) => q > 0)
      .map(([desc]) => desc);
  for (const g of state.gutters) {
    if (g.lengthFt > 0) out.push({ kind: "gutter", style: g.style, size: g.size });
    for (const desc of has(g.accQty))
      out.push({ kind: "gutterAcc", style: g.style, size: g.size, desc });
  }
  for (const d of state.downspouts) {
    for (const desc of has(d.lengthByDesc)) out.push({ kind: "downspout", size: d.size, desc });
    for (const desc of has(d.accQty)) out.push({ kind: "downspoutAcc", size: d.size, desc });
  }
  for (const desc of has(state.generalAccQty)) out.push({ kind: "generalAcc", desc });
  for (const desc of has(state.pitchPanQty)) out.push({ kind: "pitchPan", desc });
  for (const [option, byDesc] of Object.entries(state.collectionBoxQty))
    for (const desc of has(byDesc)) out.push({ kind: "collectionBox", option, desc });
  return out;
}

/** The list as stored on a bid, read safely (an older bid has none; a bad entry is dropped). */
export function readMetalsTypedPrices(value: unknown): MetalsTypedPrice[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, MetalsTypedPrice>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const key = o["key"];
    const amount = metalsPriceAmount(o["amount"]);
    if (typeof key !== "string" || !key || amount === null) continue;
    byKey.set(key, {
      key,
      amount,
      ...(o["zeroAtUpdate"] === true && amount === 0 ? { zeroAtUpdate: true as const } : {}),
    });
  }
  return [...byKey.values()].slice(-MAX_METALS_TYPED_PRICES);
}

/**
 * The list after an amount is typed on a line. Typing 0 is a price of $0, kept and marked like
 * any other. A zero flag stays only while the amount stays 0.
 */
export function setMetalsTypedPrice(
  typed: readonly MetalsTypedPrice[],
  key: string,
  amount: number,
): MetalsTypedPrice[] {
  const value = metalsPriceAmount(amount);
  if (!key || value === null) return [...typed];
  const had = typed.find((t) => t.key === key);
  const next: MetalsTypedPrice = {
    key,
    amount: value,
    ...(had?.zeroAtUpdate && had.amount === 0 && value === 0
      ? { zeroAtUpdate: true as const }
      : {}),
  };
  const out = had ? typed.map((t) => (t.key === key ? next : t)) : [...typed, next];
  return out.slice(-MAX_METALS_TYPED_PRICES);
}

/** The list after a line goes back to its list price ("Use the list price", or an emptied box). */
export function clearMetalsTypedPrice(
  typed: readonly MetalsTypedPrice[],
  key: string,
): MetalsTypedPrice[] {
  return typed.filter((t) => t.key !== key);
}

/**
 * A typed price belongs to its line: when the line is no longer on the bid (removed, or its
 * quantity left at nothing), the price goes with it, so the same item added again starts at the
 * list price. Returns the same list when nothing goes.
 */
export function pruneMetalsTypedPrices(
  typed: readonly MetalsTypedPrice[],
  state: MetalsState,
): MetalsTypedPrice[] {
  if (!typed.length) return typed as MetalsTypedPrice[];
  const live = new Set(metalsLineKeys(metalsStateSources(state)));
  const kept = typed.filter((t) => live.has(t.key));
  return kept.length === typed.length ? (typed as MetalsTypedPrice[]) : kept;
}

/** The engine's Metals summary with the bid's typed prices on it. */
export function priceMetals(
  result: MetalsResult,
  typed: readonly MetalsTypedPrice[] | undefined,
): PricedMetalsResult {
  const amountByKey = new Map((typed ?? []).map((t) => [t.key, t.amount]));
  const keys = metalsLineKeys(result.lines.map((l) => l.source));
  let any = false;
  // The same float32 roll-up as the engine's own total (computeMetals), over the changed amounts.
  let total = 0;
  const lines = result.lines.map((line, i): PricedMetalsLine => {
    const priceKey = keys[i]!;
    const amount = amountByKey.get(priceKey);
    const priceTyped = amount !== undefined;
    if (priceTyped) any = true;
    const materialCost = priceTyped ? amount : line.materialCost;
    total = f32(total + materialCost);
    return { ...line, materialCost, priceKey, listMaterialCost: line.materialCost, priceTyped };
  });
  return {
    ...result,
    lines,
    // No typed price: the engine's own figure, untouched.
    materialCost: any ? total : result.materialCost,
    listMaterialCost: result.materialCost,
  };
}

/** How many lines of the summary carry a typed price. */
export const metalsTypedCount = (priced: Pick<PricedMetalsResult, "lines"> | undefined): number =>
  priced?.lines.filter((l) => l.priceTyped).length ?? 0;

/** What the extra flat metals line is called. It never shows: it only carries the difference. */
export const METALS_TYPED_PRICE_LINE = "Metals prices typed on this bid";

/** The flat metals line that carries the difference into the engine: material only, no labor. */
export function metalsPriceAdjustmentLine(delta: number): MetalLine {
  return {
    description: METALS_TYPED_PRICE_LINE,
    price: delta,
    laborPerUnit: 0,
    laborRate: 0,
    quantity: 1,
  };
}

/** The engine's build with the Metals summary carrying the bid's typed prices. */
export type PricedBuildResult = Omit<BuildResult, "metalsScreen"> & {
  metalsScreen?: PricedMetalsResult;
};

/**
 * buildEstimateInputs with the bid's typed metals prices: use this wherever a saved bid is
 * priced (the estimator, the proposal), so every total downstream of the metals material agrees.
 * `typed` is the bid's stored list, read safely here.
 */
export function buildEstimateInputsWithMetalsPrices(
  bid: BidInput,
  admin: EngineAdminData,
  typed: unknown,
): PricedBuildResult {
  const prices = readMetalsTypedPrices(typed);
  let delta = 0;
  if (prices.length && admin.metals) {
    const list = computeMetals(normalizeMetalsState(bid.metalsCalc), admin.metals);
    delta = priceMetals(list, prices).materialCost - list.materialCost;
  }
  const build = buildEstimateInputs(
    delta === 0 ? bid : { ...bid, metals: [...bid.metals, metalsPriceAdjustmentLine(delta)] },
    admin,
  );
  const { metalsScreen, ...rest } = build;
  return metalsScreen ? { ...rest, metalsScreen: priceMetals(metalsScreen, prices) } : rest;
}

/**
 * "Update pricing & labor" was pressed: every typed price that is 0 right now is flagged, every
 * other loses its flag. The amounts themselves are not touched: a typed price stays.
 */
export function markMetalsZeroAtUpdate(typed: readonly MetalsTypedPrice[]): MetalsTypedPrice[] {
  return typed.map((t) =>
    t.amount === 0
      ? { key: t.key, amount: 0, zeroAtUpdate: true as const }
      : { key: t.key, amount: t.amount },
  );
}

/** The yellow notice of one line. */
export const metalsZeroNotice = (item: string): string =>
  `You set the price of ${item} to $0 before the last price update.`;

/**
 * The bid's zero notices: one for each line that is on the bid, whose typed price was 0 at the
 * last "Update pricing & labor" and is still 0. Shown with the other "Check inputs" notices.
 */
export function metalsZeroNotices(
  priced: Pick<PricedMetalsResult, "lines"> | undefined,
  typed: readonly MetalsTypedPrice[] | undefined,
): string[] {
  const flagged = new Set(
    (typed ?? []).filter((t) => t.zeroAtUpdate && t.amount === 0).map((t) => t.key),
  );
  if (!flagged.size || !priced) return [];
  const out: string[] = [];
  for (const line of priced.lines) {
    if (!flagged.has(line.priceKey)) continue;
    const text = metalsZeroNotice(line.item);
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/** The Review step's "Metals material" row: it says when the amount holds typed prices. */
export function metalsMaterialLabel(typedCount: number): string {
  if (!(typedCount > 0)) return "Metals material";
  return `Metals material (${typedCount} ${typedCount === 1 ? "price" : "prices"} typed on this bid)`;
}
