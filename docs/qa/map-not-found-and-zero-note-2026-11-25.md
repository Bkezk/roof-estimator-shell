# Two small go-aheads, Nov 25, 2026

## 1. The sign-up says when the map has no roof size

The open question was whether the sign-up should say why the map has no size to suggest. The
owner was offered six sentences, one for each cause, and answered: "just saying you cant find it
should be sufficent".

- Before: when the map had no size, the sign-up said nothing. The line that offers a size was
  simply not there.
- Now: one plain sentence under the size box, whatever the cause: "The map could not find a roof
  size for this address. Type the roof's size in the box."
- It shows only once the look-up has finished with nothing. Nothing is said while the map is
  still being asked, which can take up to ten seconds.
- A size the map does have is offered as before, with "Use this size".
- The words are `MAP_ROOF_NOT_FOUND` in `src/lib/roof-care-plan.ts`. The line is in
  `src/components/roof-care/plan-card.tsx`.

Proof:

- `src/lib/roof-care-map-not-found-nov25.test.ts`, 4 tests. 3 fail on the code before.
- In a browser on the test server, on a temporary property with no street address, desktop and
  phone: the sentence showed, no size was offered, no sideways scroll, no page errors. The same
  property given a map size offered "Use this size" and did not show the sentence. Nothing was
  signed. The temporary property was removed.

## 2. The $0 metals note counts only a price update

The open question from `docs/qa/metals-typed-price-2026-11-24.md`: any OK of the "Update pricing
& labor" window counted as "the last price update", whichever boxes were ticked. Asked whether
only an update with Material Pricing ticked should count, the owner said: "yes the whole reason
we add the note is to remind them to check the price since previously it was set to 0 then
updated".

- Now only an update with "Update Material Pricing & Unit Labor" ticked flags a price that is 0
  and says the note.
- An update with only the labor template or the formulas ticked changes no price: it flags
  nothing and says nothing.
- A flag from an earlier price update stays through such an update, until the price is changed
  or the list price is taken back, as before.
- The rule is `markMetalsAfterUpdate` in `src/lib/metals-price-override.ts`. The pricing engine
  is not changed.

Proof:

- `src/lib/metals-zero-note-price-update-nov25.test.ts`, 5 tests. 4 fail on the code before. One
  older test pinned the old line and was updated with a dated note.
- In a browser on the test server, on one temporary bid, with nothing saved:
  - A gutter's price typed as 0. No note yet.
  - Update with only Labor Template ticked: "Bid updated (labor template …)", and no note.
  - Update with Material Pricing ticked: the note "You set the price of … to $0 before the last
    price update." showed, as a toast and in the bid's notices.
  - Update with only Labor Template again: the note stayed.
  - No sideways scroll, no page errors. The only calls that wrote were the bid's lock and the
    reminder check.
- The temporary bid and its lock were removed.

## Full chain

689 test files, 10,609 tests, lint, types and build all pass.
