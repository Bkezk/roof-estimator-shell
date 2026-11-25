# The audit's fixes, Nov 26, 2026

The full audit of Nov 25 reported 28 numbered findings (`docs/qa/full-audit-2026-11-25.md`). The
owner, that day: "go on 1, 2, 3 (do you want to just go ahead and build bank payments too?), 4,
5, 6, 7, 8, 9, 10, 11, 12, 13, 14,15, 17 (just ensure its not too strict to match at all), 18
(explain this one a bit to me), 19, 20, 21, 22, 23, 24, 25 (ill do the plan change later), 26,
27, 28". The code's own notes carry the date Nov 26.

Every one of those is built, tested and proven below. One finding, 16, waits on his choice
between two ways; it stays in the admin-only note (`office_reference_notes`, key
`audit-2026-11-25`) and is not described here.

## What each fix does now

### Card and bank payments (1, 2, 3, 4, 18, 26, 28)

- **1. A card page made before the price changed.** Every card payment page closes by itself 60
  to 75 minutes after it is asked for, and each one is kept on its plan. A page for another
  amount is closed before a new one is made. A corrected roof size closes the open pages before
  the price changes, and so does a payment that is recorded.
- **2. A payment the site could not record.** Stripe is answered with an error, so it sends the
  payment again for up to three days, and the admins and managers are told once.
- **3. Bank payments.** A payment from a bank account is followed on the plan: stamped while it
  is on its way, recorded as a bank payment when it clears, the stamp taken off when it fails.
  While it is on its way the customer's page and the office's link box say so and show no
  button. The receipt says "Paid by: bank payment". A refund at a plan's end takes no card fee
  off a plan paid from a bank account.
- **4. Money that cannot be matched.** A paid checkout in another currency, or for a plan that
  is gone, tells the admins and managers. Prices are asked in US dollars only.
- **18. No payment before the roof size is confirmed.** The customer's page shows no amount and
  no button while the size waits. On a ticket the card page opens only for a live ticket at the
  plan's own property. Only the office reads or emails the payment link.
- **26. Alarms about money** have a kind of their own that no tick turns off.
- **28. Smaller ones.** A page that has not confirmed a payment says so and offers the button
  again. A link that is nobody's is answered and not counted against the visitor.

### The roof size correction and the refund (5 to 14)

- **5.** The year in force is not corrected while its renewal waits to be paid.
- **6.** A size difference that is not settled outlives the plan year: it is shown on the ended
  plan with its buttons, and on Owner › Needs attention.
- **7.** Ending a plan no longer forgives a bigger roof's difference that was not paid, for the
  inspections already done: that part comes off the refund.
- **8.** A correction bills only what comes from the size: the plan's price now, plus today's
  price at the new size, less today's price at the size it has. Typing the size the plan was
  signed at gives back the price it was signed at.
- **9.** A year renewed with money taken off for an inspection not done is not corrected here.
- **10.** A size invoice settles what it was paid and no more, and a payment marked on one by
  mistake can be taken off again.
- **11.** A refund for a smaller roof comes off Roof Care income on the margin report.
- **12.** Record the refund is told the amount the screen showed, and refuses when what is owed
  has changed since.
- **13.** The card fee on a refund is decided by the plan year's own invoice, never by a size
  invoice.
- **14.** The email, the record and the receipt add up after a second correction, and an invoice
  made again after a finalised one was voided is numbered `-R1`, `-R2`.

### A public request that starts its plan (15, 17, 18, 28)

- **15. One answer to a request.** The request is taken for one person before a customer or a
  property is made, and a plan is signed and pointed at by its request in one database step.
  The second person is told who is answering it and has made nothing.
- **17. The same building.** The list of possible matches is as generous as before. The plan
  starts by itself only at a property whose address is the request's own after tidying (Street
  and St, North and N, a suite left out, and so on). Anywhere else the box shows both addresses
  and the plan starts on one more press.
- **18. A stranger's size.** A size from the public page counts as checked only when a map size
  is known and the plan's size is within 20% of it, smaller or larger.
- **28.** The request box says when its plan was ended. A plan that was signed and could not be
  read back says so and is not reported as a failure. A request the page turned down for a
  reason the visitor can fix is given back to that visitor's own count, at most 20 times a day.

### Tickets and metals (19, 20)

- **19. A ticket's invoices follow its customer.** A final or paid invoice stops a change of
  customer and says which invoice. A draft takes the new customer's Bill To, property and tax.
  A change of property within the customer moves a draft's property. A technician's save never
  writes the customer.
- **20. A typed metals price stays on its own line.** Remove takes the row that was pressed. A
  quantity changed under a typed price gives a yellow notice. A pasted "1,234.50" is read.

### Work Overview and reminders (21 to 24)

- **21.** Unlink puts the opportunity's status back when the link was the last thing that
  changed it. A link that would mark an opportunity Won asks first. An opportunity from a Roof
  Care request is never marked Won by a link.
- **22.** A late step is told the next working day and again every third working day while it
  is still late, the person holding it included. A step with no date counts as due ten working
  days after it was made. A bid holds an opportunity only while its estimator is still a user.
- **23.** The reminder run reads past opportunities that are waiting, so the ones behind them
  are not missed.
- **24.** The hand-back respects a hold, runs on every way a step can finish, and says what
  really happened. Owner view names and colours a trade bid as Work Overview does.

### The day's emails and the not paid reminder (25, 27)

- **25.** Only an email that went is counted. The email plan and its limit are as they were.
- **27.** The not paid reminder goes at 8:00 on a working day, and waits while a bank payment
  is on its way.

## The database

Five files under `supabase/migrations/`, each run by hand on the live database and checked:

- `20261125100000_card_and_bank_payments.sql`
- `20261125200000_roof_care_size_fixes.sql`
- `20261125300000_public_request_fixes.sql`
- `20261125400000_job_link_undo.sql`
- `20261125500000_email_count_and_pay_reminder.sql`

Before each one, every function it replaces was compared by fingerprint with the live database,
so no live change was lost. After each one, every function's fingerprint on the live database
equals the file's.

## How it was proven

- **Tests.** Fifteen new test files. Each fix has tests that fail on the code before. The whole
  suite on a quiet machine: 706 files, 11,055 tests, all pass. Lint has no errors, types are
  clean, and the build passes.
- **The live database, each trial run and rolled back,** at temporary properties:
  - Card and bank payments: a page kept once, closed once; a bank payment started, told twice,
    failed, started again; a short payment sent back; the full payment recorded as a bank
    payment with the stamp off; the same payment a second time changes nothing.
  - The roof size: the offer equals the size's own part of today's prices; a stale price is
    refused; two corrections add up; a part payment moves nothing; a size invoice paid, taken
    off again and deleted while paid; the plan year's own invoice still guarded; one inspection
    done, then ended, with the refund and what is left owed both right; a smaller roof owed
    back, a stale refund amount refused, the refund recorded once.
  - A public request: the second person refused at each step, the same answer twice taken, a
    plan at another property refused, one plan signed and tied, the four size cases, staff's
    own sign-up unchanged, the count given back and its 20 a day.
  - Unlink: Quoted to Won and back, a later decision left alone, an inspection's Contacted put
    back to Open, a stranger refused.
- **The screen,** on the dev server as the test login, with temporary rows of our own:
  - Link asked "Linking a repair marks this opportunity Won. Link it?", then said "The
    opportunity is now Won". Unlink said "The opportunity is Quoted again."
  - A temporary ticket with a draft invoice moved to the customer's other property: the page
    said the draft would follow before Save, and "Draft invoice 999901 now shows the property
    …" after. The database agreed.
  - The size window on a paid plan showed the old and new size and price before Save. Cancel
    was pressed: nothing was saved.
  - Work Overview, Owner, an opportunity with a public request, a property with a plan, a
    ticket, Invoices and a new bid opened on a desktop and a phone width with no page error and
    no sideways scroll. As a stranger, both public pages opened, and a payment link that is
    nobody's said "This payment link is not active."
- **Cleaned up.** Every temporary row is removed with its history lines. The plan and ticket
  counters are back at the largest number in use. No real ticket, bid, plan or customer was
  changed.

## Not proven here

- **Stripe itself.** The dev server holds no Stripe key. The card page's new settings and a bank
  payment end to end need one test card page and one test bank payment on the published site.
- The customer's payment page states were proven by tests, not on a screen, for the same reason.

## Left with the owner

- Publishing.
- One test card payment after publishing, and one test bank payment before bank payments are
  turned on in Stripe.
- His choice on finding 16.
