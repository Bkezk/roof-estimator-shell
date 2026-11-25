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
 * Nov 26, 2026 (the audit of Nov 25, number 20; owner: "go"):
 *
 *  - A typed price stays on the entry it was typed on. A line is remembered by its place among
 *    the lines of the same item ("…#2"), so when an entry of an item that is on the bid twice
 *    (an import adds a gutter the bid already has) is removed or comes back, the places shift.
 *    Every change of the list now goes through removeMetalsRow (the Remove of one row) or
 *    metalsAfterEntryScreen (an entry screen closed): each works out which entry every line
 *    came from by asking the engine one entry at a time, and moves each typed price with its
 *    own line. Where that cannot be proven the typed prices of that item are cleared and the
 *    screen says so (metalsClearedNotice): a price is never guessed onto another line.
 *    Remove also takes the row that was pressed: the engine's removeMetalsLine takes the first
 *    entry of that style and size, so the others are hidden from it for the call.
 *  - The quantity a price was typed for is kept with it (`forQty`). When the line's quantity is
 *    no longer that one, the bid's yellow notices say so (metalsQtyNotices). The typed amount
 *    is not changed. A bid saved before this has no kept quantity and gets no notice.
 *  - An amount pasted with a comma or a dollar sign is read (pastedMetalsAmount) instead of
 *    being taken for an emptied box, which put the line back to its list price without a word.
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
  emptyMetalsState,
  normalizeMetalsState,
  removeMetalsLine,
  type MetalsLine,
  type MetalsLineSource,
  type MetalsRefData,
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
  /**
   * The line's quantity (LF or count) when the amount was typed (Nov 26). Absent on a price
   * typed before then: such a price gives no quantity notice.
   */
  forQty?: number;
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

/** A line's quantity as kept beside a typed price: a number over 0, else null. */
function metalsQty(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
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
    const forQty = metalsQty(o["forQty"]);
    byKey.set(key, {
      key,
      amount,
      ...(o["zeroAtUpdate"] === true && amount === 0 ? { zeroAtUpdate: true as const } : {}),
      ...(forQty !== null ? { forQty } : {}),
    });
  }
  return [...byKey.values()].slice(-MAX_METALS_TYPED_PRICES);
}

/**
 * The list after an amount is typed on a line. Typing 0 is a price of $0, kept and marked like
 * any other. A zero flag stays only while the amount stays 0. `qty` is the line's quantity at
 * that moment (Nov 26): it is kept beside the amount, so a later change of the quantity can be
 * told (metalsQtyNotices). Typing the amount again takes the quantity as it is then.
 */
export function setMetalsTypedPrice(
  typed: readonly MetalsTypedPrice[],
  key: string,
  amount: number,
  qty?: number,
): MetalsTypedPrice[] {
  const value = metalsPriceAmount(amount);
  if (!key || value === null) return [...typed];
  const had = typed.find((t) => t.key === key);
  const forQty = metalsQty(qty);
  const next: MetalsTypedPrice = {
    key,
    amount: value,
    ...(had?.zeroAtUpdate && had.amount === 0 && value === 0
      ? { zeroAtUpdate: true as const }
      : {}),
    ...(forQty !== null ? { forQty } : {}),
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
  /**
   * The summary's own lines for that state (Nov 26). A price list that holds one description
   * twice gives two rows for one quantity, and the state alone knows only the first: a price
   * typed on the second was dropped the next time an entry screen was closed.
   */
  lines?: readonly Pick<MetalsLine, "source">[],
): MetalsTypedPrice[] {
  if (!typed.length) return typed as MetalsTypedPrice[];
  const live = new Set(metalsLineKeys(metalsStateSources(state)));
  if (lines) for (const key of metalsLineKeys(lines.map((l) => l.source))) live.add(key);
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
  return typed.map((t) => {
    const forQty = t.forQty === undefined ? {} : { forQty: t.forQty };
    return t.amount === 0
      ? { key: t.key, amount: 0, zeroAtUpdate: true as const, ...forQty }
      : { key: t.key, amount: t.amount, ...forQty };
  });
}

/**
 * Which update counts (owner, Nov 25: "the whole reason we add the note is to remind them to
 * check the price since previously it was set to 0 then updated"). Only an update that had
 * "Update Material Pricing & Unit Labor" ticked is a price update. One with only the labor
 * template or the formulas ticked changes no price: the typed prices and their flags are left
 * exactly as they were, and nothing new is said.
 */
export function markMetalsAfterUpdate(
  typed: readonly MetalsTypedPrice[],
  pricesUpdated: boolean,
): MetalsTypedPrice[] {
  return pricesUpdated ? markMetalsZeroAtUpdate(typed) : [...typed];
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

// ─────────────────────────────────────────────────────────────────────────────
// Nov 26: a typed price stays on its own entry, and says when its quantity changed
// ─────────────────────────────────────────────────────────────────────────────

/** Which entry of the Metals state a summary line came from. */
interface MetalsLineOwner {
  /** The list the entry is in; "rest" = the quantities kept by description, not by entry. */
  group: "gutters" | "downspouts" | "rest";
  /** Its place in that list (0 for "rest"). */
  index: number;
}

/**
 * The summary's lines with the entry each came from, found by asking the engine one entry at a
 * time. Null when those answers, put end to end, are not the whole summary: then nothing here
 * is relied on.
 */
function metalsLineOwners(
  state: MetalsState,
  ref: MetalsRefData,
): { lines: MetalsLine[]; owners: MetalsLineOwner[] } | null {
  const lines = computeMetals(state, ref).lines;
  const owners: MetalsLineOwner[] = [];
  const found: MetalsLine[] = [];
  const take = (part: MetalsState, owner: MetalsLineOwner) => {
    for (const line of computeMetals(part, ref).lines) {
      found.push(line);
      owners.push(owner);
    }
  };
  state.gutters.forEach((g, index) =>
    take({ ...emptyMetalsState(), gutters: [g] }, { group: "gutters", index }),
  );
  state.downspouts.forEach((d, index) =>
    take({ ...emptyMetalsState(), downspouts: [d] }, { group: "downspouts", index }),
  );
  take({ ...state, gutters: [], downspouts: [] }, { group: "rest", index: 0 });
  const same =
    found.length === lines.length &&
    found.every(
      (l, i) =>
        metalsSourceKey(l.source) === metalsSourceKey(lines[i]!.source) &&
        l.qtyOrLf === lines[i]!.qtyOrLf,
    );
  return same ? { lines, owners } : null;
}

/** Do the two entries share what the engine finds an entry by (style and size, or size)? */
function sameEntrySlot(state: MetalsState, a: MetalsLineOwner, bIndex: number): boolean {
  if (a.group === "gutters") {
    const x = state.gutters[a.index];
    const y = state.gutters[bIndex];
    return !!x && !!y && x.style === y.style && x.size === y.size;
  }
  if (a.group === "downspouts") {
    const x = state.downspouts[a.index];
    const y = state.downspouts[bIndex];
    return !!x && !!y && x.size === y.size;
  }
  return false;
}

/**
 * What each line is, in a way that does not move when another entry of the same item gains or
 * loses a line: the item, which of the entries of that style and size it came from (first,
 * second…), and which of that entry's rows of the item it is. An entry screen changes an entry
 * in place, adds one at the end, or removes every entry of a style and size at once: none of
 * those changes this for a line that stays.
 */
function metalsLineIds(
  state: MetalsState,
  ref: MetalsRefData,
): { lines: MetalsLine[]; ids: string[] } | null {
  const got = metalsLineOwners(state, ref);
  if (!got) return null;
  const seen = new Map<string, number>();
  const ids = got.lines.map((line, i) => {
    const owner = got.owners[i]!;
    let rank = 0;
    for (let k = 0; k < owner.index; k++) if (sameEntrySlot(state, owner, k)) rank++;
    const base = JSON.stringify([metalsSourceKey(line.source), owner.group, rank]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  });
  return { lines: got.lines, ids };
}

/** The yellow line of a typed price that was cleared because its line could not be told apart. */
export const metalsClearedNotice = (item: string): string =>
  `The typed price for ${item} was cleared: check the price.`;

/** A quantity as a person reads it: 100, 12.5. */
const qtyText = (q: number): string =>
  q.toLocaleString("en-US", { maximumFractionDigits: 2, useGrouping: false });

/** The yellow notice of a line whose quantity is no longer the one its price was typed for. */
export const metalsQtyNotice = (
  item: string,
  typedFor: number,
  now: number,
  isLength: boolean,
): string =>
  isLength
    ? `The price typed for ${item} was for ${qtyText(typedFor)} LF. The line is now ${qtyText(now)} LF: check the price.`
    : `The price typed for ${item} was for a quantity of ${qtyText(typedFor)}. The quantity is now ${qtyText(now)}: check the price.`;

/**
 * The bid's quantity notices (owner, Nov 26: "go"): one for each line that carries a typed price
 * whose kept quantity is not the line's quantity now. A typed price is the line's whole amount
 * and is not changed when the quantity is: this is the reminder to look at it. The words hold
 * both quantities, so a notice that was dismissed is a new notice when the quantity changes
 * again. A price typed before quantities were kept gives none.
 */
export function metalsQtyNotices(
  priced: Pick<PricedMetalsResult, "lines"> | undefined,
  typed: readonly MetalsTypedPrice[] | undefined,
): string[] {
  if (!priced || !typed?.length) return [];
  const forQty = new Map<string, number>();
  for (const t of typed) if (t.forQty !== undefined) forQty.set(t.key, t.forQty);
  const out: string[] = [];
  for (const line of priced.lines) {
    const was = forQty.get(line.priceKey);
    if (was === undefined || !line.priceTyped) continue;
    if (Math.abs(was - line.qtyOrLf) < 1e-9) continue;
    const text = metalsQtyNotice(line.item, was, line.qtyOrLf, line.isLength);
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/** The quantity notices of a state with these typed prices. */
const qtyNoticesOf = (
  state: MetalsState,
  ref: MetalsRefData,
  typed: readonly MetalsTypedPrice[],
): string[] => metalsQtyNotices(priceMetals(computeMetals(state, ref), typed), typed);

/** What a change of the Metals list leaves of the typed prices, and what to say. */
export interface MetalsListChange {
  /** The typed prices afterwards: each on the line it was typed on, or gone with its line. */
  prices: MetalsTypedPrice[];
  /** One yellow sentence for each item whose typed price had to be cleared. */
  cleared: string[];
  /** The quantity notices this change brought: shown again even if dismissed before. */
  qtyNotices: string[];
}

const sourceCount = (lines: readonly MetalsLine[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const l of lines) {
    const k = metalsSourceKey(l.source);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
};

/** Is this the typed price of a row of that item: its first row's key, or a "…#n"? */
const isRowOf = (priceKey: string, sourceKey: string): boolean =>
  priceKey === sourceKey ||
  (priceKey.startsWith(`${sourceKey}#`) && /^\d+$/.test(priceKey.slice(sourceKey.length + 1)));

/**
 * The safe rule, for a change that cannot be followed line by line: the typed prices of every
 * row of these items are cleared, and each item that is still on the bid is named.
 */
function clearUnsure(
  typed: readonly MetalsTypedPrice[],
  unsure: ReadonlySet<string>,
  before: readonly MetalsLine[],
  after: readonly MetalsLine[],
): { prices: MetalsTypedPrice[]; cleared: string[] } {
  const prices = typed.filter((t) => ![...unsure].some((k) => isRowOf(t.key, k)));
  const cleared: string[] = [];
  for (const key of unsure) {
    if (!typed.some((t) => isRowOf(t.key, key))) continue;
    const still = after.find((l) => metalsSourceKey(l.source) === key);
    if (!still) continue;
    const text = metalsClearedNotice(
      (before.find((l) => metalsSourceKey(l.source) === key) ?? still).item,
    );
    if (!cleared.includes(text)) cleared.push(text);
  }
  return { prices, cleared };
}

/** The typed prices under new keys; one that is on no line of `from` is left as it is. */
function rekey(
  typed: readonly MetalsTypedPrice[],
  from: readonly string[],
  to: ReadonlyMap<string, string | null>,
): MetalsTypedPrice[] {
  const onLine = new Set(from);
  const moved = new Map<string, MetalsTypedPrice>();
  const stayed: MetalsTypedPrice[] = [];
  for (const t of typed) {
    if (!onLine.has(t.key)) {
      stayed.push(t);
      continue;
    }
    const key = to.get(t.key);
    if (key) moved.set(key, key === t.key ? t : { ...t, key });
  }
  return [...stayed.filter((t) => !moved.has(t.key)), ...moved.values()];
}

/**
 * An entry screen (Gutters, Downspouts, Pitch Pans, Collection Boxes) was closed: `before` is
 * the Metals state when it was opened, `after` the state now. Every typed price goes with the
 * line it was typed on (metalsLineIds), a price whose line is gone goes with it, and the
 * quantity notices the change brought are told apart so they show again.
 */
export function metalsAfterEntryScreen(
  typed: readonly MetalsTypedPrice[],
  before: MetalsState,
  after: MetalsState,
  ref: MetalsRefData,
): MetalsListChange {
  const was = metalsLineIds(before, ref);
  const now = metalsLineIds(after, ref);
  const beforeLines = was?.lines ?? computeMetals(before, ref).lines;
  const afterLines = now?.lines ?? computeMetals(after, ref).lines;
  const keysBefore = metalsLineKeys(beforeLines.map((l) => l.source));
  const keysAfter = metalsLineKeys(afterLines.map((l) => l.source));
  let prices: MetalsTypedPrice[];
  let cleared: string[] = [];
  if (was && now) {
    const place = new Map(now.ids.map((id, i) => [id, keysAfter[i]!]));
    const to = new Map(was.ids.map((id, i) => [keysBefore[i]!, place.get(id) ?? null]));
    prices = rekey(typed, keysBefore, to);
  } else {
    // Not proven: an item on the bid more than once whose number of rows changed is not guessed.
    const a = sourceCount(beforeLines);
    const b = sourceCount(afterLines);
    const unsure = new Set<string>();
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const n = a.get(key) ?? 0;
      const m = b.get(key) ?? 0;
      if (n !== m && Math.max(n, m) > 1) unsure.add(key);
    }
    ({ prices, cleared } = clearUnsure(typed, unsure, beforeLines, afterLines));
  }
  prices = pruneMetalsTypedPrices(prices, after, afterLines);
  const told = new Set(qtyNoticesOf(before, ref, typed));
  return {
    prices,
    cleared,
    qtyNotices: qtyNoticesOf(after, ref, prices).filter((n) => !told.has(n)),
  };
}

/**
 * The engine's removeMetalsLine, made to take the entry the pressed row came from. It always
 * takes the FIRST entry of that style and size (or that downspout size); with the same gutter
 * on the bid twice, Remove on the second row took the first. The engine is not changed: the
 * entries it would find first are kept out of its sight for the call and put back in place.
 */
function removeFromEntry(
  state: MetalsState,
  src: MetalsLineSource,
  owner: MetalsLineOwner,
): MetalsState {
  if (owner.group === "rest") return removeMetalsLine(state, src);
  const hidden = new Set<number>();
  for (let k = 0; k < owner.index; k++) if (sameEntrySlot(state, owner, k)) hidden.add(k);
  if (!hidden.size) return removeMetalsLine(state, src);
  const putBack = <T>(all: readonly T[], seen: readonly T[]): T[] => {
    const out: T[] = [];
    let k = 0;
    for (let i = 0; i < owner.index; i++) out.push(hidden.has(i) ? all[i]! : seen[k++]!);
    return [...out, ...seen.slice(k)];
  };
  if (owner.group === "gutters") {
    const next = removeMetalsLine(
      { ...state, gutters: state.gutters.filter((_, i) => !hidden.has(i)) },
      src,
    );
    return { ...next, gutters: putBack(state.gutters, next.gutters) };
  }
  const next = removeMetalsLine(
    { ...state, downspouts: state.downspouts.filter((_, i) => !hidden.has(i)) },
    src,
  );
  return { ...next, downspouts: putBack(state.downspouts, next.downspouts) };
}

/**
 * Remove was pressed on one row of the Metals list: `index` is the row's place in the list and
 * `source` what the row said it was. The row that was pressed goes (removeFromEntry), every
 * other row keeps its own typed price under whatever key it now has, and the removed row's
 * price goes with it. Each step is checked against the engine's own summary of the new state;
 * when a check fails the engine's plain Remove is used and the typed prices of that item are
 * cleared and named (the safe rule), never moved.
 */
export function removeMetalsRow(
  state: MetalsState,
  ref: MetalsRefData,
  typed: readonly MetalsTypedPrice[],
  index: number,
  source: MetalsLineSource,
): MetalsListChange & { state: MetalsState } {
  const srcKey = metalsSourceKey(source);
  const got = metalsLineOwners(state, ref);
  const beforeLines = got?.lines ?? computeMetals(state, ref).lines;
  const keysBefore = metalsLineKeys(beforeLines.map((l) => l.source));
  const done = (
    next: MetalsState,
    kept: MetalsTypedPrice[],
    cleared: string[],
    after: MetalsLine[],
  ) => {
    const prices = pruneMetalsTypedPrices(kept, next, after);
    const told = new Set(qtyNoticesOf(state, ref, typed));
    return {
      state: next,
      prices,
      cleared,
      qtyNotices: qtyNoticesOf(next, ref, prices).filter((n) => !told.has(n)),
    };
  };
  const row = beforeLines[index];
  if (got && row && metalsSourceKey(row.source) === srcKey) {
    const owner = got.owners[index]!;
    const next = removeFromEntry(state, row.source, owner);
    const after = computeMetals(next, ref).lines;
    // What must be left: every line but the pressed entry's rows of this item, in order.
    const left = beforeLines
      .map((line, i) => ({ line, i }))
      .filter(
        ({ line, i }) =>
          !(
            metalsSourceKey(line.source) === srcKey &&
            got.owners[i]!.group === owner.group &&
            got.owners[i]!.index === owner.index
          ),
      );
    const proven =
      left.length === after.length &&
      left.every(
        ({ line }, j) =>
          metalsSourceKey(line.source) === metalsSourceKey(after[j]!.source) &&
          line.qtyOrLf === after[j]!.qtyOrLf,
      );
    if (proven) {
      const keysAfter = metalsLineKeys(after.map((l) => l.source));
      const to = new Map<string, string | null>(keysBefore.map((k) => [k, null]));
      left.forEach(({ i }, j) => to.set(keysBefore[i]!, keysAfter[j]!));
      return done(next, rekey(typed, keysBefore, to), [], after);
    }
  }
  // Not proven: the engine's own Remove, and no typed price of this item is carried over.
  const next = removeMetalsLine(state, source);
  const after = computeMetals(next, ref).lines;
  const twice = (sourceCount(beforeLines).get(srcKey) ?? 0) > 1;
  const safe = clearUnsure(typed, new Set(twice ? [srcKey] : []), beforeLines, after);
  const gone = twice ? safe.prices : clearMetalsTypedPrice(typed, keysBefore[index] ?? srcKey);
  return done(next, gone, safe.cleared, after);
}

// ─────────────────────────────────────────────────────────────────────────────
// Nov 26: an amount pasted into the price box
// ─────────────────────────────────────────────────────────────────────────────

/** Said under the price box when what was pasted or typed is not an amount. */
export const METALS_PRICE_NOT_READ =
  "That is not an amount, so the price was not changed. Type it in dollars, like 1234.50.";

/**
 * What a paste into the price box means. A number box reads "1,234.50" or "$1,234.50" as
 * nothing at all, and an emptied price box means "back to the list price": a pasted amount
 * silently dropped the typed price. "plain" is text the box takes by itself (digits and a
 * point); "amount" is an amount with commas, a dollar sign or spaces, read here; "bad" is
 * anything else, which is refused with METALS_PRICE_NOT_READ and changes nothing.
 */
export function pastedMetalsAmount(
  text: string,
): { kind: "plain" } | { kind: "amount"; amount: number } | { kind: "bad" } {
  const t = text.trim();
  if (t === "" || /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { kind: "plain" };
  const bare = t.replace(/^\$/, "").replace(/\s+/g, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d*)?$/.test(bare)) return { kind: "bad" };
  const amount = metalsPriceAmount(Number(bare.replace(/,/g, "")));
  return amount === null ? { kind: "bad" } : { kind: "amount", amount };
}
