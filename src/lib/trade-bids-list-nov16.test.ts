/**
 * The Trade Bids list (owner, Nov 16: "have it similar to project bids, listing the info on the
 * bids then have a new button trade bids that pops up two options, a dropdown of the existing
 * types of bids (painting etc) or starting a new one." … "I don't want that list combined with
 * project bids").
 *
 * Six bids run through the tests. Every expected value was worked out by hand first:
 *
 *   id  job name          status       total      last saved (UTC)    customer             trade
 *   a   Maple St repaint  draft        $1,200.10  Nov 10 15:00        Hill Property Group  Painting
 *   b   Oak Ave siding    submitted    $8,450.20  Nov 12 09:30        Rosa Alvarez (typed) Siding
 *   c   Barn doors        in_progress  $300.20    Nov 14 18:45        (none)               Painting
 *   d   Church trim       accepted     $5,000.00  Nov 1 12:00         First Church (typed) Gutters
 *   e   Depot siding      lost         $2,500.50  Nov 15 08:00        Depot LLC            Siding
 *   f   Shed              draft        $99.99     Nov 12 10:00        (none)               (blank)
 *
 *   "in_progress" and "accepted" are the old program's words for Draft and Won (asBidStatus).
 *
 *   Draft      c (Nov 14), f (Nov 12), a (Nov 10)   3 bids   1,200.10 + 300.20 + 99.99 = $1,600.29
 *   Submitted  b                                    1 bid    $8,450.20
 *   Won        d                                    1 bid    $5,000.00
 *   Lost       e                                    1 bid    $2,500.50
 *
 *   Trades in the list, A to Z, the blank one left out: Gutters, Painting, Siding.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  binDaysLeft,
  customerOf,
  filterRows,
  groupByStatus,
  hoursText,
  matchesSearch,
  tradeNames,
  type TradeListRow,
} from "@/lib/trade-bids-list";

const row = (over: Partial<TradeListRow> & { id: string }): TradeListRow => ({
  name: "",
  status: "draft",
  grand_total: 0,
  updated_at: "2026-11-01T00:00:00+00:00",
  account: null,
  typed_customer: "",
  estimator_name: "",
  trade_name: "",
  ...over,
});

const A = row({
  id: "a",
  name: "Maple St repaint",
  status: "draft",
  grand_total: 1200.1,
  updated_at: "2026-11-10T15:00:00+00:00",
  account: { id: "acc-1", name: "Hill Property Group" },
  // What was typed before the customer was linked: the linked name is the one shown.
  typed_customer: "Old Typed Name",
  estimator_name: "Dana Cole",
  trade_name: "Painting",
});
const B = row({
  id: "b",
  name: "Oak Ave siding",
  status: "submitted",
  grand_total: 8450.2,
  updated_at: "2026-11-12T09:30:00+00:00",
  typed_customer: "Rosa Alvarez",
  estimator_name: "Sam Reed",
  trade_name: "Siding",
});
const C = row({
  id: "c",
  name: "Barn doors",
  status: "in_progress",
  grand_total: 300.2,
  updated_at: "2026-11-14T18:45:00+00:00",
  trade_name: "Painting",
});
const D = row({
  id: "d",
  name: "Church trim",
  status: "accepted",
  grand_total: 5000,
  updated_at: "2026-11-01T12:00:00+00:00",
  // A linked customer whose name is blank falls back to the typed one.
  account: { id: "acc-2", name: "   " },
  typed_customer: "First Church",
  estimator_name: "Dana Cole",
  trade_name: "Gutters",
});
const E = row({
  id: "e",
  name: "Depot siding",
  status: "lost",
  grand_total: 2500.5,
  updated_at: "2026-11-15T08:00:00+00:00",
  account: { id: "acc-3", name: "Depot LLC" },
  estimator_name: "Sam Reed",
  trade_name: "Siding",
});
const F = row({
  id: "f",
  name: "Shed",
  status: "draft",
  grand_total: 99.99,
  updated_at: "2026-11-12T10:00:00+00:00",
});
const ALL = [A, B, C, D, E, F];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("customerOf: the linked customer's name, else the typed one", () => {
  it("the linked customer wins over what was typed", () => {
    expect(customerOf(A)).toBe("Hill Property Group");
  });
  it("no linked customer: the typed name", () => {
    expect(customerOf(B)).toBe("Rosa Alvarez");
  });
  it("a linked customer with a blank name: the typed name", () => {
    expect(customerOf(D)).toBe("First Church");
  });
  it("neither: nothing", () => {
    expect(customerOf(C)).toBe("");
  });
  it("spaces around a name are dropped", () => {
    expect(customerOf(row({ id: "x", typed_customer: "  Kim Lee  " }))).toBe("Kim Lee");
    expect(customerOf(row({ id: "x", account: { id: "q", name: " Acme " } }))).toBe("Acme");
  });
});

describe("matchesSearch: every word, anywhere in name / customer / trade / estimator", () => {
  it("nothing typed matches every bid", () => {
    expect(matchesSearch(A, "")).toBe(true);
    expect(matchesSearch(A, "   ")).toBe(true);
  });
  it("finds a word in the job name, whatever the capitals", () => {
    expect(matchesSearch(A, "maple")).toBe(true);
    expect(matchesSearch(A, "MAPLE")).toBe(true);
    expect(matchesSearch(A, "repa")).toBe(true);
  });
  it("finds the customer, the trade and the estimator", () => {
    expect(matchesSearch(A, "hill")).toBe(true);
    expect(matchesSearch(A, "painting")).toBe(true);
    expect(matchesSearch(A, "dana")).toBe(true);
  });
  it("each word may sit in a different place", () => {
    expect(matchesSearch(A, "  Maple   hill ")).toBe(true);
    expect(matchesSearch(A, "hill dana painting")).toBe(true);
  });
  it("one word that is nowhere fails the bid", () => {
    expect(matchesSearch(A, "maple siding")).toBe(false);
    expect(matchesSearch(A, "oak")).toBe(false);
  });
  it("searches the customer shown, not the name typed before the customer was linked", () => {
    expect(matchesSearch(A, "typed")).toBe(false);
  });
  it("a word is never made from the end of one field and the start of the next", () => {
    // "…repaint" then "Hill…": "repainthill" is in neither.
    expect(matchesSearch(A, "repainthill")).toBe(false);
  });
  it("a bid with nothing but a name still searches", () => {
    expect(matchesSearch(F, "shed")).toBe(true);
    expect(matchesSearch(F, "painting")).toBe(false);
  });
});

describe("tradeNames: the trades in the list, A to Z", () => {
  it("each trade once, blanks left out", () => {
    expect(tradeNames(ALL)).toEqual(["Gutters", "Painting", "Siding"]);
  });
  it("spaces around a name do not make a second trade", () => {
    expect(
      tradeNames([
        row({ id: "x", trade_name: " Siding " }),
        row({ id: "y", trade_name: "Siding" }),
      ]),
    ).toEqual(["Siding"]);
  });
  it("no bids: no trades", () => {
    expect(tradeNames([])).toEqual([]);
  });
});

describe("filterRows: the search box and the Trade filter together", () => {
  it("nothing set keeps every bid, in the order given", () => {
    expect(ids(filterRows(ALL, { search: "", trade: null }))).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });
  it("the search alone", () => {
    // "siding" is in b's and e's job name and trade, nowhere on the others.
    expect(ids(filterRows(ALL, { search: "siding", trade: null }))).toEqual(["b", "e"]);
    // Dana Cole estimated a and d.
    expect(ids(filterRows(ALL, { search: "dana", trade: null }))).toEqual(["a", "d"]);
  });
  it("the trade alone", () => {
    expect(ids(filterRows(ALL, { search: "", trade: "Painting" }))).toEqual(["a", "c"]);
    expect(ids(filterRows(ALL, { search: "", trade: "Gutters" }))).toEqual(["d"]);
  });
  it("both must hold", () => {
    expect(ids(filterRows(ALL, { search: "barn", trade: "Painting" }))).toEqual(["c"]);
    expect(ids(filterRows(ALL, { search: "barn", trade: "Siding" }))).toEqual([]);
  });
  it("a trade nobody has bid shows nothing", () => {
    expect(ids(filterRows(ALL, { search: "", trade: "Roof coating" }))).toEqual([]);
  });
  it("a blank trade means all trades", () => {
    expect(filterRows(ALL, { search: "", trade: "" })).toHaveLength(6);
  });
});

describe("groupByStatus: Draft, Submitted, Won, Lost, newest save first", () => {
  const groups = groupByStatus(ALL);
  it("the four groups in that order", () => {
    expect(groups.map((g) => g.status)).toEqual(["draft", "submitted", "won", "lost"]);
  });
  it("old status words fold into today's four", () => {
    // c is "in_progress" (Draft), d is "accepted" (Won).
    expect(ids(groups[0]!.rows)).toContain("c");
    expect(ids(groups[2]!.rows)).toEqual(["d"]);
  });
  it("inside a group the newest save is first", () => {
    // c Nov 14, f Nov 12, a Nov 10.
    expect(ids(groups[0]!.rows)).toEqual(["c", "f", "a"]);
  });
  it("each group has its count and its total", () => {
    expect(groups.map((g) => g.count)).toEqual([3, 1, 1, 1]);
    // 1,200.10 + 300.20 + 99.99 = 1,600.29
    expect(groups.map((g) => g.total)).toEqual([1600.29, 8450.2, 5000, 2500.5]);
  });
  it("a total is to the cent, not a long decimal", () => {
    // 0.1 + 0.2 is 0.30000000000000004 on a computer; the list must say $0.30.
    const g = groupByStatus([
      row({ id: "x", grand_total: 0.1 }),
      row({ id: "y", grand_total: 0.2 }),
    ]);
    expect(g[0]!.total).toBe(0.3);
  });
  it("a group with no bids is left out", () => {
    expect(groupByStatus([B, E]).map((g) => g.status)).toEqual(["submitted", "lost"]);
    expect(groupByStatus([])).toEqual([]);
  });
  it("newest means the moment saved, not how the time happens to be written", () => {
    // 08:00 at five hours behind UTC is 13:00 UTC: later than 12:30 UTC.
    const early = row({ id: "early", updated_at: "2026-11-12T12:30:00+00:00" });
    const late = row({ id: "late", updated_at: "2026-11-12T08:00:00-05:00" });
    expect(ids(groupByStatus([early, late])[0]!.rows)).toEqual(["late", "early"]);
  });
  it("does not reorder the list it was given", () => {
    const given = [A, C, F];
    groupByStatus(given);
    expect(ids(given)).toEqual(["a", "c", "f"]);
  });
});

describe("hoursText: the labor hours on a row", () => {
  it("whole hours", () => {
    expect(hoursText(37)).toBe("37 hours");
  });
  it("one hour is not 'hours'", () => {
    expect(hoursText(1)).toBe("1 hour");
  });
  it("not known: nothing", () => {
    expect(hoursText(null)).toBe("");
    expect(hoursText(undefined)).toBe("");
    expect(hoursText(Number.NaN)).toBe("");
    expect(hoursText(-3)).toBe("");
  });
  it("one decimal at most", () => {
    expect(hoursText(12.5)).toBe("12.5 hours");
    // 37.25 → 37.3; 37.24 → 37.2
    expect(hoursText(37.25)).toBe("37.3 hours");
    expect(hoursText(37.24)).toBe("37.2 hours");
  });
  it("the word follows the number shown", () => {
    // 0.96 shows as 1, so it reads "1 hour".
    expect(hoursText(0.96)).toBe("1 hour");
    expect(hoursText(1.04)).toBe("1 hour");
  });
  it("a job with no labor says so", () => {
    expect(hoursText(0)).toBe("0 hours");
  });
  it("thousands are separated", () => {
    expect(hoursText(1234)).toBe("1,234 hours");
  });
});

describe("binDaysLeft: how long a deleted bid is still kept", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  it("deleted 15 days ago, kept 30: 15 days left", () => {
    expect(binDaysLeft("2026-11-01T12:00:00Z", now, 30)).toBe(15);
  });
  it("part of a day counts as a day left", () => {
    // Deleted 15 days and 1 hour ago: 14 days and 23 hours remain → 15.
    expect(binDaysLeft("2026-11-01T11:00:00Z", now, 30)).toBe(15);
    // Deleted 14 days and 23 hours ago: 15 days and 1 hour remain → 16.
    expect(binDaysLeft("2026-11-01T13:00:00Z", now, 30)).toBe(16);
  });
  it("past the 30 days: none, never a minus", () => {
    expect(binDaysLeft("2026-10-01T12:00:00Z", now, 30)).toBe(0);
  });
  it("no deletion time recorded: the full 30", () => {
    expect(binDaysLeft(null, now, 30)).toBe(30);
  });
});

// ── The two screens, read as text ──────────────────────────────────────────────────────────────

const list = readFileSync("src/components/trade/trade-bids-list.tsx", "utf8");
const popup = readFileSync("src/components/trade/new-trade-bid-dialog.tsx", "utf8");

describe("the Trade Bids list is not combined with Project Bids", () => {
  it("reads trade bids, never the Project Bids list", () => {
    expect(list).toContain("listTradeBids");
    expect(list).not.toMatch(/\blistBids\b/);
    expect(list).toMatch(/queryKey: \["trade-bids"\]/);
  });
  it("its Recently deleted bin asks for trade bids only", () => {
    expect(list).toContain("listDeletedBids");
    expect(list).toMatch(/listDeletedFn\(\{\s*data:\s*\{\s*kind:\s*"trade"\s*\}\s*\}\)/);
    expect(list).toMatch(/queryKey: \["trade-bids-deleted"\]/);
  });
  it("opens a bid on the Trade Bids address, never in the roofing estimator", () => {
    expect(list).toMatch(/to: "\/trade-bids", search: \{ bid: /);
    expect(list).not.toContain('"/estimate"');
  });
  it("a row's actions are the ones a roofing bid has", () => {
    for (const fn of ["setBidStatus", "duplicateBid", "deleteBid", "restoreBid", "purgeBid"])
      expect(list).toContain(fn);
    expect(list).toContain('from "@/lib/bids.functions"');
    expect(list).toContain("LostReasonDialog");
    expect(list).toContain("bidOverdueDays");
    expect(list).toMatch(/<DocumentsPanel\s+kind="bid"/);
  });
  it("says what the owner asked it to say", () => {
    expect(list).toContain("Trade Bids");
    expect(list).toContain("No trade bids yet.");
    expect(list).toContain("No bids match.");
    expect(list).toContain("New trade bid");
  });
  it("has the hooks a browser test looks for", () => {
    for (const hook of [
      "data-trade-bids-list",
      "data-new-trade-bid",
      "data-trade-group=",
      "data-trade-row=",
      "data-row-status",
      "data-row-total",
      "data-trade-bin",
    ])
      expect(list).toContain(hook);
  });
});

describe("the New trade bid popup", () => {
  it("has both choices", () => {
    expect(popup).toContain("Bid a trade you already have");
    expect(popup).toContain("Set up a new trade");
    expect(popup).toContain("Pick a trade");
    expect(popup).toContain("Start the bid");
  });
  it("loads the trades", () => {
    expect(popup).toContain("listTradeTypes");
    expect(popup).toMatch(/queryKey: \["trade-types"\]/);
    expect(popup).toContain("No trades are set up yet.");
  });
  it("goes to the three screens by the one address", () => {
    expect(popup).toMatch(/search: \{ new: /);
    expect(popup).toMatch(/search: \{ trade: "new" \}/);
    expect(popup).toMatch(/search: \{ trade: \w+(\.\w+)* \}/);
    expect((popup.match(/to: "\/trade-bids"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("setting up or changing a trade is an admin's and a manager's", () => {
    expect(popup).toContain("seesEveryone(");
    expect(popup).toContain("An admin or a manager sets up a new trade.");
  });
  it("has the hooks a browser test looks for", () => {
    for (const hook of [
      "data-new-dialog",
      "data-pick-trade",
      "data-start-bid",
      "data-setup-new-trade",
      "data-change-trade",
    ])
      expect(popup).toContain(hook);
  });
});
