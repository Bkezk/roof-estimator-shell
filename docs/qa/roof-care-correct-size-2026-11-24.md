# Roof Care: correct the roof size, Nov 24, 2026

The owner asked on Nov 24: "how would the correct roof size work as far as what the office sees
vs what the customer sees?" He was given a design and three choices, and answered:

- "1. yes but then build the rest." Plans not yet paid first, then plans already paid.
- "2. send it but can it be combined with the new price payment?" One email, not two.
- "3. more than once but recorded and remove that line". Asked which line, he picked: only drop
  the word "once".

Before this a size could only be confirmed. A wrong size meant ending the plan and signing again.

## 1. What the office sees

- Beside the roof size on a plan: **Correct the roof size**. Managers and admins only. On a plan
  that waits for its payment and on a plan in force. Not on an ended plan.
- The window shows the size and price on the plan now, and the map's size when there is one.
- The size box starts blank. "Show the new price" reads today's price for that size over the
  plan's own drive. Nothing is changed by it.
- The window then says the old size, the new size, the old price, the new price and the
  difference. Typing the size the plan already has is answered there, before any price.
- "Save the new size" saves at the price shown. If the price moved in between, the save is
  refused and the office is asked to press "Show the new price" again.
- A note for the record is optional.

## 2. A plan that waits for its payment

- The plan takes the new size and the new price.
- Its unpaid invoice is made again at the new price. A draft is removed, a finalised one is
  voided, and a new draft is made.
- The size is marked confirmed, by the person and the day. So the payment can now be asked for.
- A payment already recorded on the invoice stops the correction. The office is told to take
  the payment off first.
- A renewal that waits for its payment is not corrected here. The office cancels the renewal,
  corrects the plan year in force and renews again.
- A size that gets a custom quote is refused: the plan is ended and quoted by hand.

## 3. One email, with the payment in it

A tick in the window: "Email the customer the new price". It is ticked to start with when the
plan has an email address.

- The email is "We measured your roof". It says the size and price they signed at, the measured
  size and the new price, and the term they agreed to.
- **A card plan:** the same email holds the Pay by card button for the new amount. The plan is
  marked as sent its payment link. This is the owner's "can it be combined".
- **A check plan:** the email says the invoice for the new amount follows.
- When the price did not move, the email says so.
- No address on the plan: the window says the customer is not told by email.
- A size that is saved stays saved when the email or the invoice then fails. The answer says
  which did not go, and the plan shows it.

## 4. More than once, and recorded

- A size can be corrected again. Every correction is kept on the plan
  (`roof_care_plans.size_changes`): who, when, from what size to what, the price before and
  after, and the note.
- They are listed under the roof size. The prices in that list are shown only to someone who
  sees prices.

## 5. The word "once"

- Term 4 said the price "is corrected once". It now says: "The price is an estimate until we
  measure the roof. If the roof's size is different, the price is corrected."
- The terms are version `2026-11-24.2`. The set before is filed word for word, so a plan signed
  under it is still emailed the words it agreed to.
- The line under the prices on the public Roof Care page lost the same word.
- A public request ticked under the older terms no longer starts its plan by itself. It opens
  the sign-up window, which says the terms have changed. That is the rule from earlier the same
  day.

## 6. A plan already paid, at this step

- The size is corrected and recorded, with what a year costs at the right size.
- The price that was paid stays for this plan year. The window says so before Save.
- The renewal is priced on the corrected size.
- Billing or refunding the difference is the next step: see section 9 when it is built.

## 7. How it was proven

- **The database rule**, in a trial that was rolled back: a manager only; the same size refused;
  an ended plan refused; a renewal refused; a price that moved refused; a payment on the invoice
  refused; a draft removed and a finalised invoice voided; a plan in force keeps its price; the
  record grows by one line each time.
- **The screen**, on the code of this change, with a temporary plan of our own on a temporary
  property: the box started blank, Save was off until a price was shown, the save re-priced the
  plan, made the draft invoice at the new price, marked the size confirmed and listed the
  correction. Desktop and phone, no sideways scroll, no page errors.
- **A plan already paid:** the window was opened on a test plan and a price was shown. Nothing
  was saved on it.
- The temporary property, plan, invoice and five history lines were removed. The plan numbers
  were not touched: the temporary plan carried a number of its own.
- **Tests:** `src/lib/roof-care-correct-size-nov24.test.ts`, 29 tests. 24 of the first 27 fail
  on the code before this change.

## 8. Not proven yet

- The "We measured your roof" email in a real inbox. No real email is sent without the owner's
  asking.
- The Pay by card button of that email on the published site.
