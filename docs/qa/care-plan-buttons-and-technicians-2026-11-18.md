# Care Plan and Additional Services buttons, the terms, and technicians in the workflow

Date: Nov 18, 2026

The owner's words, with three screenshots: "techs should not be able to open this ticket screen,
they currently can by clicking the customer name in this case 5k. on the ticket workflow lets have
two buttons that stay pinned to the bottom of the screen that say care plan and additiontal
services instead of the tech opening the ticket and clicking it. ... lets have the two buttons
'Care Plan' and 'Additional Services' as two buttons under the open ticket and status dropdown
instead of its current location in a ticket. same for this view have the two buttons under the new
ticket button. also when youre in a property page have the picture be bigger. i like all 10 you
came up with".

## What changed

### 1. The two buttons

"Sign up for a Roof Care plan" and "Customer wants another service" are now **Care Plan** and
**Additional Services**, and they moved.

| Where                             | Place                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------ |
| The ticket workflow               | Pinned at the bottom of the screen, under the Complete button, side by side    |
| A ticket                          | Under Open ticket and the stage, at the top right. No longer inside the ticket |
| A property on the customer's page | Under New ticket                                                               |
| The property's own page           | Under New ticket                                                               |

- **Care Plan** opens the sign-up when the property has no plan. When it has one, it opens the
  plan: its inspections, Push back, Storm inspection and End plan.
- The button carries the plan's name and how many inspections are done, such as "Roof Guard ·
  1/2".
- **Additional Services** takes down what else the customer wants, as before.
- A property with a plan still shows its badge and inspections in the body of its card, where the
  owner asked for the indicator. A property that never had a plan shows nothing there.

### 2. Technicians work in the workflow

- On My tickets, the "#6070 · 5K, Inc" line is words for a technician, not a link. For the office
  it is still the link to the ticket.
- Any other link to a ticket opens the workflow for a technician: a notice, a row of the Service
  list, the line of a running clock.
- The workflow's "Ticket details" link is shown to the office only.

A technician-only login already had a cut-down ticket page of its own, not the office's page. It
can no longer be opened. What it showed and where a technician reads it now:

| On the old page                                              | Now                                                |
| ------------------------------------------------------------ | -------------------------------------------------- |
| Address, contact, phone                                      | The My tickets card                                |
| Description, special instructions, history                   | The My tickets card and the top of the workflow    |
| Repairs, photos, materials, purchase orders, time, signature | The workflow                                       |
| The day, the assigned technician and the crew as a list      | The card shows the day. The workflow asks the crew |
| The ticket's Activity and its timeline                       | Not shown to a technician any more                 |

Later on Nov 18 the entries of the ticket that are ticked "Viewable to technicians" were put back,
at the top of the workflow and of the History pop-up:
`docs/qa/this-ticket-activity-2026-11-18.md`. The stage steps and the buttons that add an entry
are still the office's.

### 3. The ten terms

The sign-up shows the ten terms the owner approved, in a list, with a tick: "The customer has
read these terms and agrees to them." No plan starts without it. The plan keeps which set of
terms was agreed, by date, so a later change of wording does not rewrite what an earlier customer
said yes to.

### 4. A bigger picture on the property's page

The picture on a property's own page is about three times as wide and more than twice as tall.
Under a property on the customer's page it is the size it was.

## The database

Applied by hand on the live database and checked. Nothing published calls the function it
replaces.

| File                                 | What it does                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20261118260000_roof_care_terms.sql` | `terms_version` on a plan; the sign-up takes the terms and refuses without them; the message for a care plan ticket dragged past its last day names the Care Plan button |

Tried on the live database in a trial that was rolled back: one form of the sign-up function,
not two; a visitor with no sign-in cannot run it; a sign-up with blank terms is refused in plain
words; a sign-up with them keeps their date on the plan; a later day on the ticket is refused
with the new wording.

## Proof

- `roof-care-plan-nov18.test.ts`, now 77 checks: the buttons' names and what each opens; each of
  the four places, and that the old place is gone; the ten terms, the tick on the form and on the
  server, and the database change; the card's name as words for a technician; the workflow for a
  technician on any ticket link; no way back to the ticket page.
- Three older checks updated where a pinned line changed, each with a dated note.
- Full run: 600 files, 8,700 checks pass. Lint, types and the production build are clean.
- **Browser**, on a temporary plan and ticket, with every save blocked, at a desk and a phone
  size.
  - As an admin: the two buttons under Open ticket and the stage; pinned at the bottom of the
    workflow; under New ticket on the property and on the customer's page. Care Plan opens the
    plan where there is one and the sign-up where there is none. The sign-up lists ten terms and
    holds Start the plan until the tick.
  - As a technician-only login: the card's name is words; the ticket's plain address opens the
    workflow; there is no stage picker and no Ticket details link; the two buttons are pinned at
    the bottom; Care Plan shows the plan with no dollar amounts and no office buttons.
  - On a phone the pinned bar was 177 pixels tall with the buttons stacked. They are now side by
    side and the bar is 131.
  - No sideways scroll, no page errors.

## Left as it was found

The temporary plan and ticket were removed. Ticket numbering is back where it was. The test login
is an admin again.

## Not tested

- The larger picture was seen as its empty box only. The local test server cannot load a
  property's picture.
- Nothing was pressed that saves, so no real sign-up or request was made.
- Nothing was tried on a real phone.

## Later on Nov 18: the two buttons were missing on the workflow's first screen

The owner sent a picture of ticket #6070 on step 1, "Who is here": "im not seeing the two buttons
here about care plan and additonal services?"

**Cause.** The buttons sat in the Complete bar. That bar belongs to the part of a repair ticket
that opens only after "Who is here" is answered. A fresh repair ticket showed neither button. The
first check of the buttons ran on tickets that were already past that step, so it missed this.

**Fix.** A bar of its own, `PlanBar` in `src/components/service/closeout.tsx`, carries the two
buttons wherever the workflow has no Complete bar:

- before "Who is here" is answered,
- while the ticket loads,
- on a ticket that is not this person's to close out, or that the office has taken over.

Once the rest of the ticket is open, the Complete bar carries them as before.

**Proof.** Two tests in `src/lib/roof-care-plan-nov18.test.ts`. Browser, as a technician-only
login, every write blocked, three temporary tickets, at 390 and 810 wide:

| Ticket                              | Buttons          | Which bar    |
| ----------------------------------- | ---------------- | ------------ |
| A fresh repair, step 1 not answered | Both. Each opens | The new bar  |
| An authorized repair, locked        | Both             | The new bar  |
| An inspection, which has no step 1  | Both             | Complete bar |

On a short screen like step 1 the bar sits right under the card, since there is nothing to scroll.
The temporary tickets were removed after. No notices were written.
