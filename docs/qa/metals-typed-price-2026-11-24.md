# A metals price typed on one bid, Nov 24, 2026

The owner, with a picture of Estimator › Metals on his phone: "can you make it to where the
metals price box is editable and it just stays on that bid, so on this menu I can change the
price and it only effect this bid and also if I set the price to 0 then update labor and pricing
one of the yellow/orange notes appears that says you set the price of x to 0 before the last
price update."

## What changed

1. **The price can be typed.** On Estimator › Metals, tap a line's Cost/Quote amount and type
   your own. It is the line's whole amount in dollars. The line then reads "Your price", with
   "Use the list price ($…)" beside it to go back. A line under the list says: "Tap a Cost/Quote
   amount to type your own price. It stays on this bid only."
2. **It stays on that bid.** The typed price is kept with the bid and nowhere else. Estimate
   Pricing and every other bid are untouched. "Update pricing & labor" does not replace it.
3. **The bid total follows.** Material, freight, tax, markup and the total are worked from the
   typed amount. Labor is not changed.
4. **The $0 note.** A price typed as 0 and still 0 when "Update pricing & labor" is pressed
   gives one yellow notice: "You set the price of <item> to $0 before the last price update."
   It goes when the price is changed or the list price is taken back.
5. **Elsewhere.** The proposal and the review export use the typed amounts. A copy of the bid
   carries them. The Bid Combiner does not: it prices at the list and says which bids had typed
   prices, so they can be typed again.
6. **A number box that is emptied stays empty** while it is being typed in, as the owner's rule
   for number boxes asks.

## Where it lives

- The rule: `src/lib/metals-price-override.ts`. The pricing engine under `src/lib/engine/` is not
  changed. The difference between the typed and the list amounts goes in as one flat metals
  line, so the engine itself works the totals.
- Kept on the bid as `metalsTypedPrices`: the line, the amount, and a mark when it was 0 at a
  price update.
- Screens: `src/components/metals-screens.tsx`, `src/routes/estimate.tsx`,
  `src/routes/proposal.tsx`; also `src/lib/proposal-bid.ts`, `src/lib/review-export.ts`,
  `src/lib/combine-bids.ts`.
- No database change.

## Proof

- Tests: `src/lib/metals-price-override-nov24.test.ts` (50) and
  `src/lib/number-field-blank-nov24.test.ts` (6).
- Checks on the merged code: lint 0 errors (16 warnings, as before), types clean, 676 test files
  and 10,355 tests pass, the build completes.
- In a browser on the test server, with the test login, on one temporary bid:
  - Built by a helper: two lines typed, one as 123.45 and one as 0, saved, opened again, the
    total followed; the phone at 390 px; the folded total panel; the export; the proposal.
  - Checked again on the merged code, at desktop and at phone size, with nothing saved: the
    saved bid opened with both typed prices marked "Your price"; no notice before the update;
    after "Update pricing & labor" the notice read "You set the price of Pitch Pan 4"X4"X8" to
    $0 before the last price update."; typing 77 on that line took the notice away; "Use the
    list price" put the list price back; no sideways scroll; no page errors; the only calls
    that wrote were the bid's lock and the reminder check.
- The temporary bid, its lock and its history rows were removed. No temporary bid is left.

## Not proven

On a real iPhone: the run was a phone-sized browser. The owner's own try on his phone after the
publish is the proof.

## For the owner to settle

Any OK of the "Update pricing & labor" box counts as the price update for the $0 note, whichever
boxes are ticked in it. Counting only an update with Material Pricing ticked is a one line
change.
