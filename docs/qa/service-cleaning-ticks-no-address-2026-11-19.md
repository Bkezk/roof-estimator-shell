# Service: the plan's cleaning questions on its inspection, and the picker with no address

The owner said "Go" on two items of the Nov 19 report:

> The site does not record that drains or gutters were cleaned, or that the forecast was sent.
> Solution: a tick on the inspection and a mark on the plan.

> A property with no address, town or zip still opens the wide map. Solution: use the new
> location button, or add the address.

This record is the workflow part of the first and all of the second. The database, the plan's
own tally and the forecast mark are in the Roof Care record of the same day.

## 1. The cleaning questions

### What changed

| Before                                                              | Now                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A plan's inspection was the same four steps as any other inspection | Its Checklist step also asks what the plan includes at this inspection                       |
| Nothing said the drains, scuppers or gutters were cleaned           | Each is answered Yes or No. A No says why                                                    |
| Complete never waited for it                                        | The Checklist step is not done, and the bar stays on "Finish step 1", until each is answered |

### Who is asked what

- Roof Care: "Were the drains and scuppers cleaned?"
- Roof Guard: that, and "Were the gutters cleaned?"
- Roof Watch: nothing. A storm inspection: nothing. A ticket that is not a plan's inspection:
  nothing, and nothing new shows.
- An inspection carried over from last plan year is asked as the year's own are.

### Where they sit, and why

In the Checklist step, under the checklist and above Next. The checklist is where the
technician already says what the drains and the gutters look like, so the question of cleaning
them reads with it. It is the first card of the flow, so nobody reaches Complete without having
passed it. It is in the page, not in a pop-up.

### How answering works

- Yes saves at once.
- No waits for its reason. One box, "Why it was not cleaned", shows when anything is No. The No
  saves with the reason. With a reason already typed or saved, a No saves at once.
- A blank reason is refused: "Type why it was not cleaned".
- Turning the last No into a Yes takes the reason off with it.
- The answers are kept on the plan's inspection, so they are there after a reload and on any
  phone. A No still waiting for its reason is on this screen only.
- A save that fails says "The answer was not saved" in a toast with Try again, and in a line
  under the questions with its own Try again.
- The office sees "Answered by … , date and time". A technician does not.
- Past the point a technician may change a ticket, the answers show and the buttons do not act.

### How the workflow waits

- The Checklist step is done when the checklist is saved and every question is answered. A No
  is an answer.
- The line under Next says the checklist's own line first. Once the checklist is saved it says
  "Answer what the plan includes at this inspection".
- While the step is not done the bar reads "Finish step 1: Checklist" and a tap takes the
  technician to it, so Complete is not on the screen.
- Complete's own list also names each open question ("Not answered: Were the gutters
  cleaned?"), for the case where the questions could not be read. Retry reads them again.
- A manager's "Complete anyway" passes it, as it passes every other line of that list.
- A ticket already Done, Invoiced or Closed waits for nothing.

The rules are `src/components/service/cleaning-gate.ts`; the screen is `cleaning.tsx`; the
workflow reads them in `closeout.tsx`. The step rules in `src/lib/closeout-steps.ts` are
unchanged: the workflow hands them "checklist saved" only when the plan's questions hold too.

### Proof

Tests: `src/components/service/cleaning-ticks-nov19.test.tsx`, 23 tests. Eight older pins were
updated with dated notes (five on `closeout.tsx`, one on who is told apart as office, one in
the one-card test, one on the checklist's saved rule).

Browser, a phone 390 wide, a temporary Roof Guard plan and its inspection at the test
customer's "site 2":

- The block showed both questions. The Yes and No buttons measured 152 by 46 px.
- Drains Yes saved at once. Gutters No showed as picked and waited: "Type why below. It saves
  with the reason."
- Save with a blank reason: "Type why it was not cleaned", and nothing was saved.
- With the reason typed it saved. The office line read "Answered by", the name and the time.
- After a reload the answers and the reason were back.
- Gutters to Yes: the reason box went away.
- With the network refusing the save: the toast and the line under the questions both said it
  was not saved. Try again saved it.
- With the checklist saved and the questions open: Next was disabled over "Answer what the plan
  includes at this inspection", the bar read "Finish step 1: Checklist", and a tap on the bar
  showed the Checklist card.
- One answered: still waiting. Both answered: Next enabled, the bar moved to step 2, and Next
  showed Additional findings with the Checklist step done.
- Complete was never pressed. No page errors.

Not proven in a browser: Roof Care's one question and a storm inspection's none (tests), and a
technician-only login (the test login is an admin; the office line's rule is tested).

## 2. The building picker with no address

### What changed

| Before                                                                | Now                                                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "No aerial for this address", though there was no address to look for | "No address on this property"                                                                            |
| The picker opened on all of Kentucky and Tennessee and said nothing   | It says the property has no address                                                                      |
| The office was not told what would fix it                             | "Add the address on the property and the map opens there next time", with a link that opens the property |
| The location button was there to be found                             | On a phone the picker asks for the phone's position itself, once, as it opens                            |

### The rules

- "No address" is no street, no town and no zip code, on the ticket and on its property. A
  state alone is not an address. An address that was looked for and not found is not this case.
- The phone is asked only then, only on a phone or tablet, and only once on that screen.
- Given: the map opens where the phone is, close enough to see the roofs around it, with no
  pin, and says so.
- Refused, or the phone cannot say: the map stays wide and a plain line says so and names the
  location button for another try.
- A technician is told to tap the location button if they are at the building. They are not
  sent to anyone else.
- Never asked when the address, or even its town, was found: the map already opened there.

A desk computer is not asked. It is not at the building, and its position is the office's, so
the map would open on the wrong place. The office gets the line and the link instead.

The rules are `src/components/service/aerial-no-address.ts`; the read's `noAddress` is in
`src/lib/service-aerial.functions.ts`; the map's third kind of point is in
`src/components/prospect-map-focus.ts`.

### Proof

Tests: `src/lib/aerial-no-address-nov19.test.ts`, 19 tests. Three older pins were updated with
dated notes.

Browser, a temporary inspection at the test customer's property that has no address:

| Run                     | Asked the device | Line above the map                        | Map scale | Pin |
| ----------------------- | ---------------- | ----------------------------------------- | --------- | --- |
| Phone, location allowed | once             | "The map opened where this phone is…"     | 100 ft    | no  |
| Phone, location refused | once             | "This phone did not share its location…"  | 100 mi    | no  |
| Desk computer           | never            | the no-address line and the office's line | 50 mi     | no  |

In each run the heading read "No address on this property", the link opened the property's
page address, the location button was on the map, and closing and opening the picker again did
not ask a second time. Nothing was picked or saved. No page errors.

## Cleanup

The temporary plan, its two inspections, the two tickets and their rows were removed. Tickets
55, plans 0, notifications 256, the ticket and plan number counters back where they were, the
test login an admin as before. The dev server was stopped.
