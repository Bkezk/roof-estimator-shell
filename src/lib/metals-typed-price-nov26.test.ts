/**
 * The audit of Nov 25, 2026, number 20 (owner: "go"): a metals price typed on a bid.
 *
 * (a) With the same gutter on the bid twice (an import adds a gutter the bid already has),
 *     Remove on one row left the other row billing the removed row's typed price. And when the
 *     price list holds one description twice, a price typed on the second row was dropped the
 *     next time an entry screen was closed.
 * (b) A typed price is the line's whole amount and stays when the quantity changes. Nothing
 *     said so: now the bid's yellow notices do, and the typed amount is left as typed.
 * (c) An amount pasted with a comma read as an emptied box and put the line back to its list
 *     price without a word.
 *
 * The rule is lib/metals-price-override.ts, outside the engine. Every number here is made up.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { dismissNotice, restoreNotices, splitNotices } from "@/lib/bid-dismissed-notices";
import {
  computeMetals,
  emptyMetalsState,
  removeMetalsLine,
  type MetalsLineSource,
  type MetalsRefData,
  type MetalsState,
} from "@/lib/engine/metals";
import {
  METALS_PRICE_NOT_READ,
  markMetalsAfterUpdate,
  markMetalsZeroAtUpdate,
  metalsAfterEntryScreen,
  metalsClearedNotice,
  metalsLineKeys,
  metalsQtyNotice,
  metalsQtyNotices,
  metalsSourceKey,
  metalsZeroNotices,
  pastedMetalsAmount,
  priceMetals,
  pruneMetalsTypedPrices,
  readMetalsTypedPrices,
  removeMetalsRow,
  setMetalsTypedPrice,
  type MetalsTypedPrice,
} from "@/lib/metals-price-override";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

// ── A made-up price list: a gutter at 7 a foot, a downspout at 3 a foot ─────────────────────

const STYLE = "K-Style";
const SIZE = '6"';
const row = (description: string, unitCost: number) => ({
  description,
  unitCost,
  laborPerUnit: 0.1,
  laborRate: 40,
});
const ref = (over: Partial<MetalsRefData> = {}): MetalsRefData => ({
  gutters: {
    styles: [STYLE],
    sizesByStyle: { [STYLE]: [SIZE] },
    byStyleSize: {
      [`${STYLE}|${SIZE}`]: { gutter: row("Gutter per LF", 7), accessories: [row("End Cap", 4)] },
    },
    shared: [],
  },
  downspouts: {
    sizes: ['3"X4"'],
    bySize: { '3"X4"': { spouts: [row("Downspout - Open", 3)], accessories: [] } },
    general: [],
  },
  pitchPans: [row("Test Pan", 12)],
  collectionBoxes: { options: [], byOption: {} },
  ...over,
});

const GUTTER: MetalsLineSource = { kind: "gutter", style: STYLE, size: SIZE };
const K = metalsSourceKey(GUTTER);
const ITEM = `K Gutter (${SIZE})`;
const gutter = (lengthFt: number, accQty: Record<string, number> = {}) => ({
  style: STYLE,
  size: SIZE,
  lengthFt,
  accQty,
});
const state = (over: Partial<MetalsState>): MetalsState => ({ ...emptyMetalsState(), ...over });
const priced = (st: MetalsState, typed: readonly MetalsTypedPrice[], r = ref()) =>
  priceMetals(computeMetals(st, r), typed);
/** Each row as "quantity: amount (typed or list)". */
const rows = (st: MetalsState, typed: readonly MetalsTypedPrice[], r = ref()) =>
  priced(st, typed, r).lines.map(
    (l) => `${l.qtyOrLf}: ${l.materialCost} ${l.priceTyped ? "typed" : "list"}`,
  );

// ── (a) Remove with the same gutter on the bid twice ─────────────────────────────────────────

describe("the audit's run: K-Style 6 inch twice, 100 LF typed 400 and 300 LF at list", () => {
  const two = state({ gutters: [gutter(100), gutter(300)] });
  const typed = setMetalsTypedPrice([], K, 400, 100);

  it("starts as the audit says: 400 typed and 2,100 list, 2,500 in all", () => {
    expect(metalsLineKeys(computeMetals(two, ref()).lines.map((l) => l.source))).toEqual([
      K,
      `${K}#2`,
    ]);
    expect(rows(two, typed)).toEqual(["100: 400 typed", "300: 2100 list"]);
    expect(priced(two, typed).materialCost).toBe(2500);
  });

  it("the old way put the 100 LF row's 400 on the 300 LF row", () => {
    // What the screen did until now: the engine's Remove, then the typed prices pruned.
    const after = removeMetalsLine(two, GUTTER);
    const kept = pruneMetalsTypedPrices(typed, after);
    expect(rows(after, kept)).toEqual(["300: 400 typed"]);
  });

  it("Remove on the 300 LF row takes that row: the 100 LF row keeps its typed 400", () => {
    const done = removeMetalsRow(two, ref(), typed, 1, GUTTER);
    expect(done.state.gutters).toEqual([gutter(100)]);
    expect(rows(done.state, done.prices)).toEqual(["100: 400 typed"]);
    expect(priced(done.state, done.prices).materialCost).toBe(400);
    expect(done.cleared).toEqual([]);
  });

  it("Remove on the 100 LF row takes that row and its price: the 300 LF row is at its list 2,100", () => {
    const done = removeMetalsRow(two, ref(), typed, 0, GUTTER);
    expect(done.state.gutters).toEqual([gutter(300)]);
    expect(rows(done.state, done.prices)).toEqual(["300: 2100 list"]);
    expect(done.prices).toEqual([]);
  });

  it("a price typed on the second row follows it when the first row is removed", () => {
    const onSecond = setMetalsTypedPrice(typed, `${K}#2`, 1900, 300);
    const done = removeMetalsRow(two, ref(), onSecond, 0, GUTTER);
    expect(rows(done.state, done.prices)).toEqual(["300: 1900 typed"]);
    expect(done.prices).toEqual([{ key: K, amount: 1900, forQty: 300 }]);
  });

  it("three of them, the middle one removed: the first and the last keep their own", () => {
    const three = state({ gutters: [gutter(100), gutter(300), gutter(50)] });
    const all = setMetalsTypedPrice(setMetalsTypedPrice(typed, `${K}#2`, 1900, 300), `${K}#3`, 77);
    const done = removeMetalsRow(three, ref(), all, 1, GUTTER);
    expect(rows(done.state, done.prices)).toEqual(["100: 400 typed", "50: 77 typed"]);
  });

  it("a row of another item between them is not disturbed", () => {
    const mixed = state({
      gutters: [gutter(100, { "End Cap": 2 }), gutter(300, { "End Cap": 6 })],
      pitchPanQty: { "Test Pan": 3 },
    });
    const PAN = metalsSourceKey({ kind: "pitchPan", desc: "Test Pan" });
    const CAP = metalsSourceKey({ kind: "gutterAcc", style: STYLE, size: SIZE, desc: "End Cap" });
    const all: MetalsTypedPrice[] = [
      { key: K, amount: 400 },
      { key: `${CAP}#2`, amount: 31 },
      { key: PAN, amount: 20 },
    ];
    // Rows: gutter 100, cap 2, gutter 300, cap 6, pan 3. Remove the 300 LF gutter row.
    const done = removeMetalsRow(mixed, ref(), all, 2, GUTTER);
    expect(rows(done.state, done.prices)).toEqual([
      "100: 400 typed",
      "2: 8 list",
      "6: 31 typed",
      "3: 20 typed",
    ]);
    // The second gutter entry is still there for its end caps, with no length.
    expect(done.state.gutters).toEqual([
      gutter(100, { "End Cap": 2 }),
      gutter(0, { "End Cap": 6 }),
    ]);
  });

  it("the same downspout size twice: Remove takes the row that was pressed", () => {
    const D: MetalsLineSource = { kind: "downspout", size: '3"X4"', desc: "Downspout - Open" };
    const spout = (ft: number) => ({
      size: '3"X4"',
      lengthByDesc: { "Downspout - Open": ft },
      accQty: {},
    });
    const st = state({ downspouts: [spout(20), spout(60)] });
    const t: MetalsTypedPrice[] = [{ key: metalsSourceKey(D), amount: 44 }];
    expect(rows(st, t)).toEqual(["20: 44 typed", "60: 180 list"]);
    const done = removeMetalsRow(st, ref(), t, 1, D);
    expect(rows(done.state, done.prices)).toEqual(["20: 44 typed"]);
  });

  it("a row that is not what the screen said it was: the safe rule, cleared and said", () => {
    // The screen named a row the list does not have: nothing is guessed.
    const st = state({ gutters: [gutter(100), gutter(300)] });
    const done = removeMetalsRow(st, ref(), typed, 5, GUTTER);
    // The engine's own Remove took the first entry; the typed 400 is not put on the 300 LF row.
    expect(rows(done.state, done.prices)).toEqual(["300: 2100 list"]);
    expect(done.cleared).toEqual([metalsClearedNotice(ITEM)]);
    expect(done.cleared[0]).toBe(`The typed price for ${ITEM} was cleared: check the price.`);
  });

  it("an ordinary bid, each item once: Remove is as it was", () => {
    const one = state({ gutters: [gutter(100)], pitchPanQty: { "Test Pan": 2 } });
    const PAN: MetalsLineSource = { kind: "pitchPan", desc: "Test Pan" };
    const t: MetalsTypedPrice[] = [
      { key: K, amount: 400 },
      { key: metalsSourceKey(PAN), amount: 9 },
    ];
    const done = removeMetalsRow(one, ref(), t, 1, PAN);
    expect(done.state).toEqual(removeMetalsLine(one, PAN));
    expect(done.prices).toEqual([{ key: K, amount: 400 }]);
    expect(done.cleared).toEqual([]);
  });
});

describe("an entry screen is closed", () => {
  it("the first of two same gutters gets a length: the price typed on the other stays on it", () => {
    // The first entry had only end caps; the 300 LF row was the item's first row, key K.
    const before = state({ gutters: [gutter(0, { "End Cap": 2 }), gutter(300)] });
    const typed = setMetalsTypedPrice([], K, 1900, 300);
    expect(rows(before, typed)).toEqual(["2: 8 list", "300: 1900 typed"]);
    const after = state({ gutters: [gutter(50, { "End Cap": 2 }), gutter(300)] });
    // Left alone, the 1,900 would now sit on the new 50 LF row.
    expect(rows(after, typed)[0]).toBe("50: 1900 typed");
    const done = metalsAfterEntryScreen(typed, before, after, ref());
    expect(rows(after, done.prices)).toEqual(["50: 350 list", "2: 8 list", "300: 1900 typed"]);
    expect(done.cleared).toEqual([]);
    expect(done.qtyNotices).toEqual([]);
  });

  it("the first of two same gutters loses its length: the price typed on it goes, not moves", () => {
    const before = state({ gutters: [gutter(100, { "End Cap": 2 }), gutter(300)] });
    const typed = setMetalsTypedPrice([], K, 400, 100);
    const after = state({ gutters: [gutter(0, { "End Cap": 2 }), gutter(300)] });
    const done = metalsAfterEntryScreen(typed, before, after, ref());
    expect(rows(after, done.prices)).toEqual(["2: 8 list", "300: 2100 list"]);
  });

  it("a price list with one description twice: the price typed on the second row is kept", () => {
    const twice = ref({ pitchPans: [row("Test Pan", 12), row("Test Pan", 15)] });
    const st = state({ pitchPanQty: { "Test Pan": 2 } });
    const PAN = metalsSourceKey({ kind: "pitchPan", desc: "Test Pan" });
    const typed = setMetalsTypedPrice([], `${PAN}#2`, 21, 2);
    expect(rows(st, typed, twice)).toEqual(["2: 24 list", "2: 21 typed"]);
    // The old check knew the state only: the second row's price was dropped.
    expect(pruneMetalsTypedPrices(typed, st)).toEqual([]);
    // With the summary's own lines it stays.
    expect(pruneMetalsTypedPrices(typed, st, computeMetals(st, twice).lines)).toBe(typed);
    const done = metalsAfterEntryScreen(typed, st, st, twice);
    expect(rows(st, done.prices, twice)).toEqual(["2: 24 list", "2: 21 typed"]);
  });

  it("nothing changed: the same typed prices", () => {
    const st = state({ gutters: [gutter(100)] });
    const typed = setMetalsTypedPrice([], K, 400, 100);
    expect(metalsAfterEntryScreen(typed, st, st, ref())).toEqual({
      prices: typed,
      cleared: [],
      qtyNotices: [],
    });
  });

  it("a line taken off in the screen: its typed price goes with it, as before", () => {
    const before = state({ gutters: [gutter(100)], pitchPanQty: { "Test Pan": 2 } });
    const typed = setMetalsTypedPrice([], K, 400, 100);
    const after = state({ pitchPanQty: { "Test Pan": 2 } });
    expect(metalsAfterEntryScreen(typed, before, after, ref()).prices).toEqual([]);
  });
});

// ── (b) The quantity a price was typed for ───────────────────────────────────────────────────

describe("a typed price whose quantity changed says so", () => {
  const typed = setMetalsTypedPrice([], K, 640, 100);
  const at = (ft: number) => state({ gutters: [gutter(ft)] });

  it("the quantity is kept beside the typed price", () => {
    expect(typed).toEqual([{ key: K, amount: 640, forQty: 100 }]);
  });

  it("the audit's run: typed at 100 LF, the length becomes 300 LF: the amount stays, the notice shows", () => {
    const p = priced(at(300), typed);
    expect(p.lines[0]).toMatchObject({ qtyOrLf: 300, materialCost: 640, listMaterialCost: 2100 });
    expect(metalsQtyNotices(p, typed)).toEqual([
      `The price typed for ${ITEM} was for 100 LF. The line is now 300 LF: check the price.`,
    ]);
  });

  it("no notice while the quantity is the one it was typed for, or is put back", () => {
    expect(metalsQtyNotices(priced(at(100), typed), typed)).toEqual([]);
  });

  it("dismissed, it comes back when the quantity changes again", () => {
    const first = metalsQtyNotices(priced(at(300), typed), typed);
    const dismissed = dismissNotice([], first[0]!);
    expect(splitNotices(first, dismissed).open).toEqual([]);
    const second = metalsQtyNotices(priced(at(350), typed), typed);
    expect(second).toEqual([metalsQtyNotice(ITEM, 100, 350, true)]);
    expect(splitNotices(second, dismissed).open).toEqual(second);
  });

  it("back at 300 LF after a dismissal: the entry screen names it, so the bid shows it again", () => {
    const first = metalsQtyNotices(priced(at(300), typed), typed);
    let dismissed = dismissNotice([], first[0]!);
    // 300 → 100: no notice. 100 → 300 again: the same words, brought back by the change.
    expect(metalsAfterEntryScreen(typed, at(300), at(100), ref()).qtyNotices).toEqual([]);
    const again = metalsAfterEntryScreen(typed, at(100), at(300), ref());
    expect(again.qtyNotices).toEqual(first);
    dismissed = restoreNotices(dismissed, again.qtyNotices);
    expect(splitNotices(first, dismissed).open).toEqual(first);
  });

  it("an entry screen closed with the quantity as it was names nothing", () => {
    expect(metalsAfterEntryScreen(typed, at(300), at(300), ref()).qtyNotices).toEqual([]);
  });

  it("typing the price again takes the quantity as it is now: the notice goes", () => {
    const again = setMetalsTypedPrice(typed, K, 1750.5, 300);
    expect(again).toEqual([{ key: K, amount: 1750.5, forQty: 300 }]);
    expect(metalsQtyNotices(priced(at(300), again), again)).toEqual([]);
  });

  it("a count row says quantity, not LF", () => {
    const PAN = metalsSourceKey({ kind: "pitchPan", desc: "Test Pan" });
    const t = setMetalsTypedPrice([], PAN, 30, 2);
    const st = state({ pitchPanQty: { "Test Pan": 5 } });
    expect(metalsQtyNotices(priced(st, t), t)).toEqual([
      "The price typed for Test Pan was for a quantity of 2. The quantity is now 5: check the price.",
    ]);
  });

  it("a bid saved before this change opens with its typed prices and no notice", () => {
    const old = readMetalsTypedPrices([{ key: K, amount: 640 }]);
    expect(old).toEqual([{ key: K, amount: 640 }]);
    const p = priced(at(300), old);
    expect(p.lines[0]).toMatchObject({ materialCost: 640, priceTyped: true });
    expect(metalsQtyNotices(p, old)).toEqual([]);
  });

  it("the kept quantity is saved with the bid and read back; a bad one is dropped, the price kept", () => {
    expect(readMetalsTypedPrices(JSON.parse(JSON.stringify(typed)))).toEqual(typed);
    expect(readMetalsTypedPrices([{ key: K, amount: 640, forQty: "100" }])).toEqual([
      { key: K, amount: 640 },
    ]);
    expect(readMetalsTypedPrices([{ key: K, amount: 640, forQty: -3 }])).toEqual([
      { key: K, amount: 640 },
    ]);
  });

  it("a removed row takes its notice with it, and brings none for the rows that stay", () => {
    const two = state({ gutters: [gutter(100), gutter(300)] });
    const t = setMetalsTypedPrice([], `${K}#2`, 1900, 300);
    const done = removeMetalsRow(two, ref(), t, 0, GUTTER);
    expect(done.qtyNotices).toEqual([]);
    expect(metalsQtyNotices(priced(done.state, done.prices), done.prices)).toEqual([]);
  });

  it("the $0 note is as it was, and the kept quantity outlives a price update", () => {
    const zero = setMetalsTypedPrice([], K, 0, 100);
    const marked = markMetalsAfterUpdate(zero, true);
    expect(marked).toEqual([{ key: K, amount: 0, zeroAtUpdate: true, forQty: 100 }]);
    expect(markMetalsAfterUpdate(zero, false)).toEqual(zero);
    expect(metalsZeroNotices(priced(at(100), marked), marked)).toEqual([
      `You set the price of ${ITEM} to $0 before the last price update.`,
    ]);
    expect(markMetalsZeroAtUpdate(typed)).toEqual(typed);
    // Both notices can stand on one line: $0 at the update, and the length has changed since.
    expect(metalsQtyNotices(priced(at(300), marked), marked)).toHaveLength(1);
    expect(metalsZeroNotices(priced(at(300), marked), marked)).toHaveLength(1);
  });
});

// ── (c) An amount pasted with a comma ────────────────────────────────────────────────────────

describe("an amount pasted into the price box", () => {
  it("with a comma or a dollar sign it is read", () => {
    expect(pastedMetalsAmount("1,234.50")).toEqual({ kind: "amount", amount: 1234.5 });
    expect(pastedMetalsAmount(" $1,234.50 ")).toEqual({ kind: "amount", amount: 1234.5 });
    expect(pastedMetalsAmount("$40")).toEqual({ kind: "amount", amount: 40 });
    expect(pastedMetalsAmount("1,234,567")).toEqual({ kind: "amount", amount: 1234567 });
  });
  it("plain digits are left to the box", () => {
    expect(pastedMetalsAmount("1234.50")).toEqual({ kind: "plain" });
    expect(pastedMetalsAmount(".5")).toEqual({ kind: "plain" });
    expect(pastedMetalsAmount("")).toEqual({ kind: "plain" });
  });
  it("anything else is refused, never taken for an emptied box", () => {
    for (const text of ["abc", "1,23", "1.234,50", "12 each", "1,234.50 USD", "--4"])
      expect(pastedMetalsAmount(text)).toEqual({ kind: "bad" });
    expect(METALS_PRICE_NOT_READ).toBe(
      "That is not an amount, so the price was not changed. Type it in dollars, like 1234.50.",
    );
  });
});

// ── The screens ──────────────────────────────────────────────────────────────────────────────

describe("the Metals screen and the estimator use the rules", () => {
  const screen = flat("src/components/metals-screens.tsx");
  const estimator = flat("src/routes/estimate.tsx");

  it("Remove goes through removeMetalsRow, not the engine's first-entry Remove", () => {
    expect(screen).toContain(
      "const change = removeMetalsRow(state, refData, prices, i, ln.source); onChange(change.state); afterListChange(change);",
    );
    expect(screen).not.toContain("removeMetalsLine");
    expect(screen).not.toContain("pruneMetalsTypedPrices");
  });
  it("closing an entry screen compares with the state it was opened on", () => {
    expect(screen).toContain("atOpen.current = state;");
    expect(screen).toContain(
      "if (refData) afterListChange(metalsAfterEntryScreen(prices, before ?? state, state, refData));",
    );
    expect(screen.match(/onClose=\{closeTile\}/g)).toHaveLength(4);
  });
  it("a cleared typed price is said in yellow on the screen and handed to the estimator", () => {
    expect(screen).toContain("data-metals-price-cleared");
    expect(screen).toContain("setCleared(change.cleared);");
    expect(estimator).toContain(
      "for (const line of notes.cleared) toast.warning(line, { duration: 15_000 });",
    );
  });
  it("a price is typed with the line's quantity", () => {
    expect(screen).toContain("setMetalsTypedPrice(prices, ln.priceKey, v, ln.qtyOrLf)");
  });
  it("the quantity notices are in the bid's one list of yellow notices, and come back", () => {
    expect(estimator).toContain(
      "warnings: [ ...warnings, ...metalsZeroNotices(build.metalsScreen, metalsTypedPrices), ...metalsQtyNotices(build.metalsScreen, metalsTypedPrices), ],",
    );
    expect(estimator).toContain(
      "setDismissedNotices((prev) => restoreNotices(prev, notes.qtyNotices));",
    );
  });
  it("the price box reads a pasted amount, and unread text is not an emptied box", () => {
    expect(screen).toContain(
      'const got = pastedMetalsAmount(e.clipboardData.getData("text")); if (got.kind === "plain") return; e.preventDefault();',
    );
    expect(screen).toContain(
      "unread.current = e.target instanceof HTMLInputElement && e.target.validity.badInput;",
    );
    expect(screen).toContain(
      "if (unread.current) { setNote(METALS_PRICE_NOT_READ); return; } setNote(null); props.onListPrice();",
    );
    expect(screen).toContain("data-metals-price-not-read");
  });
  it("the engine is not touched: its Remove still takes the first entry", () => {
    const two = state({ gutters: [gutter(100), gutter(300)] });
    expect(removeMetalsLine(two, GUTTER).gutters).toEqual([gutter(300)]);
  });
});
