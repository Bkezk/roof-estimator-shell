# Re-audit after the Nov 9 changes: Invoices, Bids, Documents (Nov 10, 2026)

Asked by the owner: "should we audit the bids, documents, and invoices page since we made
changes?" — then "go ahead and do it". Findings are reported here first; nothing was fixed.

What changed since each page's last audit:

| Page | Last audit | Changed since |
|---|---|---|
| Invoices | Nov 9, before its fixes | Fixes 1–4 (layout, Awaiting filters, clock hours, Paid = paid in full) |
| Bids | Nov 6, before its fixes | The nine Nov 9 fixes, the inspection link, untitled bids named after the customer |
| Documents | Nov 6 | No document code changed (checked with `git diff`) |

How it was checked: a code read of every changed path and of every reader of an invoice's paid
state; SQL over the live database; and browser runs as the test login on temporary rows
("ZZ …": two customers, two tickets, one invoice, seven bids, one document). Every temporary
row, both PDF files, the notifications and the audit-log rows were removed; the closing sweep
is empty and the live counts are as before (10 invoices, no linked bids).

## Invoices

### What holds (proved)

- **Every stored invoice is consistent.** SQL over the 10 invoices: subtotal = Σ qty × rate =
  Σ line totals, tax = taxable × rate, total = subtotal + tax, cost = Σ qty × cost rate, on all
  ten; no invoice is Paid with less than its total, none is Final with a payment that covers it.
- **The list's baseline matches the database:** 7 live invoices, $2,372.73, Paid $1,679.21,
  Open $668.52.
- **A new invoice from a ticket** (2.5 h labor + 1 h travel with one helper, a $100 PO):
  five lines, Subtotal and Total $625.00, cost $590.00, margin $35.00, "3.5 h on site",
  $10.00 an hour. Stored row = screen.
- **Tax:** 6 % with the labor line ticked taxable gave $23.25 = 6 % × ($212.50 + the $175.00
  material line, which is taxable by default); back to 0 % restored $625.00.
- **Layout (fix 1):** the Remove × is reachable and the page does not scroll sideways at 1280,
  1366, 1440, 1536 and 1920 px.
- **Awaiting invoice (fix 2):** narrowed to "1 of N tickets" by search, gone on no match.
- **Finalise and the PDF:** "Service Invoice", number, PO, date, Job #, Subtotal $625.00,
  Tax (0 %) $0.00, Grand Total $625.00. The share link on the published site served the same
  file byte for byte, and 404 after Turn off.
- **Paid means paid in full (fix 4):** $500 on $625 → stays Final, "Partly paid $500.00 on
  Nov 10, 2026 by Check · ref … — balance due $125.00", Edit payment only (no Mark paid, no
  Void). List footer "8 invoices … Paid $2,179.21 · Open $793.52", Final group $1,293.52,
  `?status=unpaid` Open $793.52, and the Owner view's tile "UNPAID $794 · 5 invoices" — the
  same money on all four. $625 → Paid. A paid invoice edited down to $100 → back to Final with
  balance $525.00. Paid in full again → footer Paid $2,304.21 · Open $668.52.
- **Sage export** (today only, one invoice): the invoice row carries 625.00 / 0.00 / 625.00 /
  paid / 2026-11-10 / 625.00, the five line amounts sum to 625.00, and only the temporary
  invoice was stamped exported.
- **Void** of a final invoice with no payment: the ticket went back to Authorized, the number
  was freed, the footer returned to the baseline.

### Findings

1. **A recorded payment cannot be taken off.** *(new with fix 4 — medium)* Edit payment → $0
   leaves the invoice "final with a payment recorded": it reads "Partly paid $0.00 … balance
   due $625.00", offers no Mark paid and no Void, and the server refuses a void because the
   payment day is still set. A payment typed on the wrong invoice leaves that invoice stuck.
   The money figures stay right (Open counts the whole balance).
   *Proposed:* saving $0 clears the payment (day, method, reference), so the invoice is a plain
   Final again with Mark paid and Void back.
2. **An overpayment is accepted with only a small note.** *(low)* $700 on a $625 invoice reads
   "Paid $700.00"; the footer's Paid then counts $700. The dialog shows "Differs from the total"
   but does not stop.
   *Proposed:* ask "That is more than the total — record it anyway?" before saving.
3. **Deleted tickets' invoices still count.** *(existing — owner's decision)* Deleting a ticket
   does not look at its invoices, and the Invoices list, its footer and the Owner view's Unpaid
   tile do not look at whether the ticket is deleted. Today 5 of the 7 live invoices are on
   deleted tickets: all of the $1,679.21 Paid and $653.52 of the $668.52 Open. Two of them are
   a pair of identical final invoices on one deleted ticket ($318.76 each, the second made with
   "Another invoice"), so that amount is in Open twice.
   *Options:* (a) void the leftovers by hand if they were tests; (b) refuse to delete a ticket
   that has a live invoice ("void its invoice first"); (c) leave as is.
4. **The customer's PDF never shows a payment.** *(existing — note)* The PDF is stored at
   Finalise, so a partly paid invoice's PDF and share link still show the full total and no
   balance due. Unchanged by the fixes; listed so it is a choice, not a surprise.

## Bids

### What holds (proved)

- **Untitled bids are named after the customer on every path that starts one:** started with
  the placeholder name (what an opportunity with no title sends) → the customer's name; a
  second one → "(1)"; a blank name box shows "Named after the customer when saved" and no
  longer raises "Bid Title cannot be left blank". The estimator adopts the name and shows
  nothing unsaved.
- **Names that are not untitled are left alone:** a typed name; the Combiner's
  "A + B" (saved as is, plain "Bid saved"); a copy ("… (copy)", offered in the popup with the
  source's due date). A takeoff's bid takes the takeoff's name and a PlanSwift import's takes
  "customer · file" (code read: both save through the same function, and a save always has a
  customer).
- **A second tab on the same bid is read only:** its Save is disabled and the name is untouched.
- **The inspection link:** Create bid → save → the estimator reads "From inspection #N — Done,
  Nov 10", the ticket's outcome names the bid and lists it; a second bid from the same
  inspection is listed beside the first and the outcome names the newest; a restored bid is
  listed again; the Bids row drops the line when the ticket is deleted.
- **The Nov 9 list fixes still hold with the new row line:** no sideways scroll at 390 px, and
  the list read is 27.9 KB for 30 bids.

### Findings

5. **The ticket's outcome goes stale when its bids are deleted.** *(new — low/medium)* With
   every linked bid deleted the ticket still reads "Outcome: Bid <name>", lists nothing, and
   the "what happens next?" banner does not come back.
   *Proposed:* when the last live bid of an inspection is deleted, clear the outcome (with a
   timeline note) so the banner returns; restoring the bid records it again.
6. **The estimator still shows the line for a deleted ticket.** *(new — low)* The Bids page
   hides "From inspection #N" once the ticket is deleted; the estimator keeps it and the link
   opens the deleted ticket.
   *Proposed:* the same deleted check in the estimator's read.
7. **The link's server check is looser than the button.** *(new — low, defence in depth)* The
   Create bid button is shown to the office only, but the server function that writes the link
   does not repeat the office / manager check that "No action needed" has. Reaching it needs a
   hand-typed URL and Estimate access; the outcome write would then be stopped silently by the
   database rules, leaving a link with no outcome.
   *Proposed:* the same role check on the server, one line.
8. **A bid keeps its first customer's name when the customer is changed.** *(design — owner's
   decision)* A bid auto-named "A (1)" and then moved to customer B is still "A (1)".
   *Options:* (a) leave it — a name is a name; (b) rename it when the name is still exactly
   the auto-given one.
9. **A copy of a linked bid is not linked to the inspection.** *(design — owner's decision)*
   The same rule as a copy of an opportunity's bid. If the second option for a customer is
   usually made by copying, the copy could carry the link.

Also noted, no action proposed: two untitled saves for one customer at the same instant could
both take the same name (nothing in the database forbids equal names; they would be told apart
by date and total).

## Documents

No document code changed since Nov 6. Smoke check on an auto-named bid: the Documents popup
opened; New document offered "Proposal — <bid name>"; the editor opened with four sheets and no
blank variables, carrying the bid's name; Export PDF produced "PDF ready (v1)" and a file; the
popup listed it; Delete sent it to the bin and the popup returned to "No documents yet." No
findings.

## Not re-run

- The edit lock's release on a closed tab (unchanged code, proved Nov 9).
- The PO markup box on a draft (my script's selector missed it; unchanged code, proved Nov 9).
- Takeoff and PlanSwift seeds in the browser (code read only, above).

## Fixes (Nov 10)

The owner: "fix 1, 2, 3 (currently all invoices are tests) … fix 5, 6, 7, 8, 9". Finding 4 was
a question, answered in chat; nothing changed for it.

1. **A $0 amount takes the payment off.** The server clears the day, the method and the
   reference; the invoice is a plain Final again, with Mark paid and Void back. The dialog says
   "To take this payment off, set the amount to 0", and at $0 its button reads "Take the payment
   off". A $0 invoice is still paid by $0.
2. **An overpayment is asked about.** The first press shows "$700.00 is $250.00 more than the
   invoice total of $450.00. If that is right, press “Record it anyway”"; changing the amount
   drops the question.
3. **A ticket with a live invoice is not deleted.** The message names the invoice and the step:
   delete the draft, void the invoice, or take the payment off and then void. Void invoices do
   not hold a ticket. The five test invoices already on deleted tickets were left as they are.
5. **The inspection's outcome follows its bids.** Deleting the last live bid clears "Outcome:
   Bid" (or falls back to the repair ticket when one came of the inspection), so the "what
   happens next?" banner returns; restoring a bid records Bid again unless another choice was
   made since. Each leaves a timeline note.
6. **A deleted ticket is not shown as a bid's inspection** in the estimator, as on the Bids page.
7. **The server asks for the office or a manager** before linking a bid to an inspection. The
   gap was someone with Estimate and Customers access but not Service — they never see the
   button, and now the server refuses them too.
8. **The automatic name follows a changed customer.** A bid still named after its old customer
   (the name, or the name with "(n)") is renamed after the new one on save, and the toast says
   so; a typed name is kept.
9. **A copy carries the inspection** its source was started from, so the ticket lists the copy
   beside the first bid.

Tests: `re-audit-fixes-nov10.test.ts` (23; 19 red on the old code, the rest controls), one pin
updated in `duplicate-bid.test.ts`. Chain: 511 files, 6,493 tests, build clean. Each fix was
proved in the browser on temporary rows (two customers, two tickets, one invoice, four bids),
all removed afterwards; the sweep is empty.

## The test invoices were removed (Nov 10)

The owner: "currently all invoices are tests" and then "go ahead and remove the invoices". All
ten were removed by id: the nine stored PDFs through the Storage API, the ten rows (their 15
lines went with them), and the pointer each ticket kept. The five tickets that were at Invoiced
went back to Authorized through the database's own `set_ticket_stage_from_invoice`, the same
step a void takes; four of those five are deleted tickets. No notification was sent.

After: 0 invoices, 0 lines, 0 invoice PDFs, no ticket pointing at an invoice. The Invoices page
shows "0 invoices $0.00 Paid $0.00 · Open $0.00" with four tickets awaiting an invoice, and the
Owner view's tile reads "UNPAID — Nothing outstanding". The audit log keeps the removal.
