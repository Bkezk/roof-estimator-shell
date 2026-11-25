# Trade bids on Work Overview, Nov 25, 2026

The owner, Nov 25: "one thing the chips on the work overview dont differentiate between trade
bids and normal bids, can you remedy that? (suggest before changing)". He was given a suggestion
and answered: "go on 2".

## What changed

- **Before:** a trade bid and a roofing bid both said "Bid" in the same orange, in the list and
  on the calendar.
- **Now:**
  - The badge on a trade bid says **Trade bid**. A roofing bid still says **Bid**.
  - A trade bid has a colour of its own: on the badge, on the calendar's left bar and on the
    phone calendar's dot. A roofing bid stays orange.
  - The hover text of a trade bid's calendar chip starts with "Trade bid".
- No new button, filter or menu. A trade bid is still a bid wherever bids are counted, grouped,
  ordered or filtered: only what it is called and its colour are its own.

## The colour

The suggestion said teal. Drawn beside the six colours in use, teal sat almost on top of the
follow-up's green, on the badge and on the bar. A light blue was the next thought, and on Nov 6
the owner found a light blue Bid chip "a bit too similar" to the blue Ticket chip. So the trade
bid is **lime**, a yellow green that is far from every colour in use. It is one word in three
places (`trade_bid` in `KIND_CLASS`, `KIND_DOT`, `KIND_BAR` in
`src/components/my-work-page.tsx`), and a test names it, so changing it is a small job.

## Where it is

- The rule: `kindLabel`, `workTone` and `TRADE_BID_LABEL` in `src/lib/my-work.ts`. A bid's row
  carries `trade: true` when the bid is a trade bid (`bidItem`, `isTradeBid`).
- The page asks the item for its tone in all three places. No place is left that colours or
  names a row by its kind alone.
- No database change. The server already sent each bid's kind.

## How it was proven

- **Tests:** `src/lib/work-trade-bid-chip-nov25.test.ts`, 12 tests: the mark on a trade bid
  only, that it is still a bid and opens on Trade Bids, the badge words, the tone, the hover
  text, that nothing else is ever called a trade bid, that the colour is the trade bid's alone
  and is neither a green nor a light blue, and that the chip is still not a size container.
  None can pass on the code before: a bid's row did not know its kind.
- Two older tests pinned the exact old lines and were updated, each with a dated note.
- **Full chain:** lint, types, every test and the build pass.
- **The screen,** on the dev server as the test login, with two temporary draft bids of our own
  due the same day, one of each kind:
  - List: the roofing bid's badge said "Bid" in orange and opened the estimator. The trade
    bid's badge said "Trade bid" in lime and opened Trade Bids. Light and dark theme.
  - Calendar: the two chips sat one under the other, an orange bar and a lime bar. The trade
    bid's hover text read "Trade bid · …". Every other bar kept its colour.
  - Phone width: no sideways scroll. No page errors anywhere.
- Both temporary bids were removed with their history lines. No real bid was touched: the one
  real trade bid in the database is a deleted test of the owner's and was only read.

## Left with the owner

- Publishing.
- The colour, if he wants another.
