# A ticket keeps its customer, Nov 25, 2026

The owner, Nov 25, of one inspection ticket: a manager "took the customer out but then he said it
defaulted to 5k then disappeared? now it has no customer? can you investigate?" After the report:
"go with solution A on number 1".

## What had happened

Read from the ticket's own history. No customer is named here.

- Two weeks before, an opportunity was made under the wrong customer by mistake. An inspection
  ticket was made from it and closed out three minutes later, which made a repair ticket. Half
  an hour later the opportunity was deleted and made again under the right customer, with a new
  inspection ticket. The first two tickets stayed, under the wrong customer.
- "5k" was that wrong customer's name. Nothing defaulted on Nov 25: the name had been on the
  ticket since the day it was made.
- On Nov 25 the manager opened the first ticket, pressed Change beside the customer, picked
  nobody and pressed Save.
- The ticket was saved with no customer and no property. It kept the old name as plain text.

It was the only ticket this had happened to: one ticket with no customer, and one time in the
history that a customer was taken off a ticket.

## The bug

- The form sent no customer, and the ticket's old name as text. That text is how a ticket from
  before customer profiles keeps its typed name.
- The form's check only asked for a customer when the ticket had no name at all.
- The server took any save that had a name.

## The fix

- **A ticket that is linked to a customer stays linked.** Its customer can be changed to another
  one. It cannot just be taken off.
- **On the screen.** Save with nobody picked says: "Pick a customer before saving. … was taken
  off this ticket and no other customer was picked, so nothing was saved." Nothing is sent.
- **The way back.** Under the empty search box: "Pick the new customer above, or Keep …". One
  press puts the ticket's own customer back, with its property, contact and site.
- **On the server.** `saveServiceJob` refuses the same save in the same words, so no other
  screen can do it either.
- A ticket from before customer profiles, with a typed name and no customer, is as it was.
- The rule is `customerTakenOffProblem` in `src/lib/ticket-form.ts`.

## How it was proven

- **Tests:** `src/lib/ticket-customer-kept-nov25.test.ts`, 10 tests. 8 fail on the code before
  this change. One runs the very save that was sent that morning and checks nothing is written.
- **The screen,** on a temporary ticket of our own, desktop and phone: Change, then Save, gave
  the message and saved nothing. Keep put the customer back, and Save went off because nothing
  differed any more. No sideways scroll, no page errors.
- The temporary ticket and its two history lines were removed. The ticket number counter was not
  touched: the temporary ticket carried a number of its own.

## Left with the owner

- The three tickets themselves were not touched. Which of them is kept, and whether the two
  left from the first attempt are deleted, is his to say.
