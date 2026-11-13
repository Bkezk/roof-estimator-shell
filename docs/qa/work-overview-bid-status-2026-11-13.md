# Bid status on Work Overview (Nov 13)

Owner: "have the bid status be able to be updated on the work overview page like how you can
assign unassigned jobs on tickets".

## What it does

A bid row on Work Overview has a status box at its foot, where "Assign to…" sits on an
unassigned row. It is the Bids page's own choice list and its own save.

| Pick      | What happens                                                                               |
| --------- | ------------------------------------------------------------------------------------------ |
| Submitted | Saved at once.                                                                             |
| Won       | Asks "When was it won?" with today filled in, as the Bids page does. Cancel saves nothing. |
| Lost      | Asks "Why was it lost?", as the Bids page does.                                            |

Work Overview lists draft bids only, so the row leaves once the bid is anything else. The
message says so ("Work Overview lists draft bids only. This one is on the Bids page now.") and
has an Undo that sets the bid back to Draft. A linked opportunity follows the bid, as it does
from the Bids page.

Anyone who sees a bid row may change it: bids are listed only for people with Estimate access,
the same people the Bids page's status box is for. No database change was needed.

## Files

- `src/lib/my-work-actions.ts`: the rules (`bidStatusHere`, `bidStatusAsks`, `bidStatusToast`).
- `src/components/work-bid-status.tsx`: the status box and the Won question.
- `src/components/my-work-actions.tsx`, `src/components/my-work-page.tsx`: the wiring.

## Proof

Tests: `src/lib/work-overview-bid-status-nov13f.test.ts` (10). Full suite 543 files, 7,095
tests. Two older pins in `calendar-unassigned-pane.test.ts` were updated for the hook's new
answer.

Browser, local site against the live database, as the test login, on one temporary bid:

- The row showed the box reading Draft, with the four choices Draft, Submitted, Won, Lost.
- Submitted: message "Status: Submitted" with the line above and Undo; the row left. Undo:
  "Status: Draft"; the row came back.
- Won: the question opened with today's date. Cancel sent nothing and the row stayed. Mark won:
  the row left and the Bids page read Won.
- Lost: the question opened. Mark lost: the row left and the Bids page read Lost.
- No page errors.

## Cleanup

The temporary bid was removed for good from the Bids page's Recently deleted list. A bid needs a
customer, so a temporary customer was made too; it was deleted through the Customers page, which
hides it but keeps the row. Removing that row for good needs the database connection and is
listed in `docs/PENDING-DATABASE.md`.
