/**
 * Trade bids on Work Overview (owner, Nov 25, 2026: "the chips on the work overview dont
 * differentiate between trade bids and normal bids, can you remedy that?"; to the suggestion of
 * a "Trade bid" badge and a colour of its own: "go on 2").
 *
 * Before: a trade bid and a roofing bid both said "Bid" in the same orange, in the list and on
 * the calendar. None of these pass on that code: a bid's row did not know its kind.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  KIND_LABELS,
  TRADE_BID_LABEL,
  bidItem,
  bidItems,
  calendarChip,
  kindLabel,
  workTone,
  type BidIn,
} from "@/lib/my-work";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\s+/g, " ");

const bid = (over: Partial<BidIn> = {}): BidIn => ({
  id: "b1",
  kind: "roof",
  name: "North warehouse",
  status: "draft",
  due_date: "2026-12-04",
  account_name: "Acme Storage",
  created_by: "u1",
  ...over,
});

describe("a trade bid's row knows it is one", () => {
  it("a trade bid is marked, a roofing bid is not", () => {
    expect(bidItem(bid({ kind: "trade" }))!.trade).toBe(true);
    expect(bidItem(bid({ kind: "roof" }))!.trade).toBeUndefined();
    // A row from before bids had a kind is a roofing bid, as everywhere else (bid-kind.ts).
    expect(bidItem(bid({ kind: null }))!.trade).toBeUndefined();
    const { kind: _kind, ...noKind } = bid();
    expect(bidItem(noKind)!.trade).toBeUndefined();
  });
  it("it is still a bid: same kind, same day, same person, and it opens on Trade Bids", () => {
    const trade = bidItem(bid({ kind: "trade" }), { u1: "Pat" })!;
    const roof = bidItem(bid({ kind: "roof" }), { u1: "Pat" })!;
    expect(trade.kind).toBe("bid");
    expect(trade.date).toBe(roof.date);
    expect(trade.title).toBe(roof.title);
    expect(trade.where).toBe(roof.where);
    expect(trade.assigneeName).toBe("Pat");
    expect(trade.href).toBe("/trade-bids?bid=b1");
    expect(roof.href).toBe("/estimate?bid=b1");
  });
  it("only a draft is a row, whichever kind it is", () => {
    expect(bidItem(bid({ kind: "trade", status: "submitted" }))).toBeNull();
    expect(
      bidItems([bid({ id: "a", kind: "trade" }), bid({ id: "b" })]).map((i) => !!i.trade),
    ).toEqual([true, false]);
  });
});

describe("what the badge says and the colour it wears", () => {
  it('a trade bid says "Trade bid"; a roofing bid still says "Bid"', () => {
    expect(TRADE_BID_LABEL).toBe("Trade bid");
    expect(kindLabel(bidItem(bid({ kind: "trade" }))!)).toBe("Trade bid");
    expect(kindLabel(bidItem(bid())!)).toBe("Bid");
    expect(KIND_LABELS.bid).toBe("Bid");
  });
  it("a trade bid has a tone of its own; a roofing bid keeps the bid's", () => {
    expect(workTone(bidItem(bid({ kind: "trade" }))!)).toBe("trade_bid");
    expect(workTone(bidItem(bid())!)).toBe("bid");
  });
  it("nothing that is not a bid is ever called a trade bid", () => {
    for (const kind of ["ticket", "inspection", "task", "followup", "opportunity"] as const) {
      expect(kindLabel({ kind, trade: true })).toBe(KIND_LABELS[kind]);
      expect(workTone({ kind, trade: true })).toBe(kind);
      expect(kindLabel({ kind })).toBe(KIND_LABELS[kind]);
    }
  });
});

describe("the calendar's chip", () => {
  it("a trade bid's hover text starts with what it is; its chip still leads with its name", () => {
    const chip = calendarChip(bidItem(bid({ kind: "trade" }))!);
    expect(chip.lead).toBe("North warehouse");
    expect(chip.tail).toBeNull();
    expect(chip.hover).toBe("Trade bid · North warehouse");
  });
  it("a roofing bid's chip reads as before", () => {
    expect(calendarChip(bidItem(bid())!)).toEqual({
      lead: "North warehouse",
      tail: null,
      hover: "North warehouse",
    });
  });
  it("a ticket's chip is untouched by this", () => {
    expect(calendarChip({ title: "Leak at dock", customer: "Acme Storage", number: 6090 })).toEqual(
      { lead: "Acme Storage", tail: "#6090", hover: "Acme Storage · Leak at dock" },
    );
  });
});

describe("the page draws it", () => {
  const page = read("src/components/my-work-page.tsx");
  it("the badge, the calendar's bar and the phone's dot all ask the item for its tone", () => {
    expect(page).toContain("className={`shrink-0 ${KIND_CLASS[workTone(item)]}`}");
    expect(page).toContain("{kindLabel(item)}");
    expect(page).toContain("${KIND_DOT[workTone(i)]}");
    expect(page).toContain("${KIND_BAR[workTone(i)]}");
    // No place is left that colours or names a row by its kind alone.
    expect(page).not.toMatch(/KIND_(CLASS|DOT|BAR)\[(item|i)\.kind\]/);
    expect(page).not.toContain("KIND_LABELS[");
  });
  it("a trade bid's colour is its own in all three places, and no other kind uses it", () => {
    const colours = (name: string) => {
      const m = new RegExp(`const ${name}: Record<WorkTone, string> = \\{(.*?)\\};`).exec(page);
      expect(m, name).not.toBeNull();
      return m![1]!;
    };
    for (const name of ["KIND_CLASS", "KIND_DOT", "KIND_BAR"]) {
      const body = colours(name);
      const trade = /trade_bid:\s*"([^"]+)"/.exec(body);
      expect(trade, name).not.toBeNull();
      expect(trade![1]).toContain("lime");
      // Lime is the trade bid's only, and the roofing bid is still orange.
      expect(body.replace(trade![0], "")).not.toContain("lime");
      expect(/\bbid:\s*"([^"]+)"/.exec(body)![1]).toContain("orange");
      // Not the green of a follow-up, which teal sat too close to, and not a light blue,
      // which the owner found too close to the Ticket chip (Nov 6).
      expect(trade![1]).not.toMatch(/teal|emerald|green|sky|cyan|blue/);
    }
  });
  it("the chip is still not a size container (the calendar shrank when it was)", () => {
    expect(page).not.toContain("@container");
  });
});
