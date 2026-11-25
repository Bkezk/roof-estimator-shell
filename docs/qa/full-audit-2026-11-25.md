# Full audit, Nov 25, 2026

The owner, Nov 25: "do a full thorough audit dont assume anything. try to find bugs or try to
break it report back your findings numbered and the solution paired with the findings. be
thorough especially with anything involving money".

No code was changed. What was found is not written here: this repository is public, so open
findings are kept in the admin-only table `office_reference_notes` on the live database, key
`audit-2026-11-25`, numbered as they were reported to him, each with its solution. He picks
which to fix. When one is fixed, its record goes in `docs/qa/` as usual and the note is updated.

## What was covered

Everything changed from Nov 23 to Nov 25, with money first:

- Card payments: the card page, Stripe's messages to the site, the customer's payment link,
  bank payments, and no payment before the roof size is confirmed.
- The plan's price, Correct the roof size, the invoice and the refund for a size difference,
  and the refund at a plan's end.
- A public Roof Care request that starts its plan.
- Bids and invoices: the metals price typed on a bid, plan and size invoices, a ticket that
  keeps its customer.
- Work Overview: one row per job, the hand-back, the late notice, linking a ticket, the
  calendar chips, the trade bid colour.
- The public pages' limits, the day's email count, the notice ticks and the new notices.
- The printed sheet on Setup › QR pages.

## How

- **The full chain** on the code as pushed: lint with no errors, types, 691 test files with
  10,647 tests, and the build. All pass.
- **The published site,** read only: every page opened as a stranger and as the test login, on
  a desktop and a phone width. No page error, no failed request, no sideways scroll. A stranger
  is sent to the sign-in from every staff page.
- **The live database against this repository:** the body of every function compared by
  fingerprint. 245 of 276 are identical, every money function written since Nov 23 among them.
  The rest are older functions that later migrations patch in place, so a fingerprint of their
  first text cannot match; the money ones among them were read from the live database itself.
- **Roles, run live and rolled back:** an office user who is a technician and a stranger each
  tried fourteen money actions (correct a size, confirm it, record a refund, end a plan, change
  a refund, mark a card paid, start a plan, write a plan's price, take a payment off, delete an
  invoice). All were refused.
- **The roof size correction, run live and rolled back** at a temporary property: sign up, seven
  bad sizes, a wrong shown price, an unpaid correction, a part payment, payment in full, a
  bigger roof, a bigger one again before the first difference was paid, a part payment of the
  difference, its payment in full, a smaller roof, a refund dated tomorrow, the refund, the
  refund a second time, and the refund at the plan's end before and after. Every amount came
  out right, and each thing that should be refused was.
- **Live facts read:** every plan and invoice checked for sums that do not add up, duplicate
  numbers, a paid mark with a balance, a temporary row left behind (none); the timers' runs for
  seven days (none failed); the notices and emails of the last days.
- **Five independent code readers,** one for each area above, told to find faults and not to
  change anything. Each main claim was read again by the lead, the database ones against the
  live source, before it was reported.

## Cleaned up

- Both live trials were rolled back. No row was left.
- The plan and ticket counters, which a rolled-back trial still moves, were put back by the
  largest number in use.
