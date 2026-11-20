# Roof Care break test fixes: tickets and notices (Nov 20, 2026)

The owner, after the Roof Care break test of Nov 20: "fix 1, 4, 7, 8, 9, 13, 16, 17, 18, 19, 20,
21, 22, 23, 24, 26, 27, 28, 29, 30". This record is for numbers **16, 17, 18 and 30**. The
names and numbers below are made up ("ZZ" rows inside trials that were rolled back).

## 16. Inspection tickets the site makes are announced

**Before.** A ticket a person opens tells the admins and the managers "Opened", and starts its
technician's reminder timer. A plan inspection ticket made by the morning run
(`roof_care_make_tickets`, 6:40 AM Eastern) told nobody.

**Now.** The 8:00 reminder run (`src/routes/api.cron.reminders.ts`, pass `plan_tickets`) does
for every plan inspection ticket that has not been announced what opening a ticket through the
app does:

- The people on the tickets' "Each step" line of Admin › Reminders (every admin and manager
  until someone changes it) hear it. One ticket: the usual "Opened: Ticket #7001 …", with "The
  site made it for the Roof Care plan at …", its due window and who has it. Several tickets:
  ONE notice per person, "3 Roof Care plan inspection tickets opened", naming each ticket and
  its window ("#7001 Plant 1 (Made Up Mills), due Nov 25 to Dec 30, 2026."), ten at most and
  then "And 3 more."
- A ticket that has a technician starts that technician's reminder timer, by the same database
  function as any ticket, and tells them "Assigned to you: Ticket #…" (several tickets for one
  technician: one notice). A ticket with nobody on it has no timer, as any new ticket.
- Nothing goes out before 8:00 on the office's clock or on a weekend, as every other reminder.

**Safe to run twice, and after a failed send.** What was announced is remembered in a small
table of its own, `roof_care_ticket_notices` (a ticket's own row is never written, so its "last
changed" and its history stay a person's):

1. `roof_care_ticket_announce_claim` hands each ticket to ONE run (the ticket is the table's
   key), so a second run in the same minute gets nothing.
2. `roof_care_ticket_announce_finish(…, true)` marks a ticket announced, and is called only
   after its notices were written. When a send fails the tickets in it are given back
   (`…, false`) and the next run tells them. A run that dies holds its tickets for 15 minutes,
   then they are free again.

Only the server (the site's own key) may run the two functions or read the table.

**A plan starting, a storm inspection a person adds.** These were, and stay, announced at once
by the server function that made them (`announceCarePlanTickets`, called when a plan starts,
when its invoice is paid, and when a storm inspection is added): the person is at the screen,
and the notice carries their name. That function now takes its tickets by the same claim and
marks them the same way, so the 8:00 run leaves them alone; one it could not announce is given
back and told by the 8:00 run. A plan that starts with no person at the screen (a card payment)
is covered by the 8:00 run too.

Files: `supabase/migrations/20261120700000_roof_care_ticket_notices.sql`,
`src/lib/roof-care-ticket-announce.ts` (words), `src/lib/roof-care-ticket-announce.server.ts`
(the pass), `src/lib/followups.server.ts` (`startTicketTimerBySite`),
`src/lib/service.functions.ts` (`announceCarePlanTickets`), `src/lib/database-rpc.ts`,
`src/routes/api.cron.reminders.ts`.

### Rolled-back trial on the live database (every database call the pass makes)

```
16.1 first claim: 999701 care visit1 2026-11-25..2026-12-30 tech=false date=-; 999702 care storm 2026-11-20..2026-12-04 tech=true date=2026-11-23
16.2 second claim right after (want 0): 0
16.3 finish t1 written: 1, give t2 back: 1
16.4 claim after a failed send (want 999702 only): 999702
16.5 claim after a run died 20 minutes ago (want 999702): 999702
16.6 claim while another run holds it 5 minutes (want 0): 0
16.7 finish t2 written: 1, finish again (want 0): 0, give back an announced one (want 0): 0
16.8 plain, deleted, done and already announced tickets by id (want 0): 0
16.9 after roof_care_make_tickets: … carried 2026-11-20..2027-01-19 stage=open Care plan inspection (Roof Care), owed from last plan year; … visit2 2026-11-23..2027-01-19 stage=open Care plan inspection (Roof Care), visit 2 of 2
16.10 timer for the assigned ticket: action=started due_at=2026-11-23T13:00:00+00:00 first_remind_at=2026-11-23T13:00:00+00:00
16.11 the same again: action=unchanged
16.12 notices written with the links /service and /service?id=: 2
```

Rights, read from the database: the two functions can be run by the server's role and by no
signed-in person; the table cannot be read or written by a signed-in person; row security on.

Not done here, on purpose: the published site's timer address was not called and no notice was
sent to a real person. The sending itself is the same `notify` every other reminder uses.

## 17. A plan in force holds its property and its customer

A property or a customer cannot be deleted while one of its plans is in force or waiting for
its payment. The database refuses both ways of deleting (the site's own, and a row removed
outright), and the server functions (`deleteSite`, `deleteAccount`) say the same before they
write anything. A property whose plans have all ended is deleted as before; putting a deleted
one back is never refused.

Files: `supabase/migrations/20261120710000_roof_care_plan_holds_property.sql`,
`src/lib/care-plan-guards.ts`, `src/lib/crm.functions.ts`.

```
17.1 property, plan in force, deleted by the site: This property cannot be deleted: it has the Roof Care plan #999701 at ZZ s3 one (in force). End the plan first (open the property and press End plan), then delete the property.
17.2 the same, row removed outright: (the same words)
17.3 property, plan waiting for payment: This property cannot be deleted: it has the Roof Guard plan #999702 at ZZ s3 two (waiting for its payment). End the plan first …
17.4 property with no plan deleted (rows): 1
17.5 other changes to the held property (rows): 1
17.6 customer, plan waiting for payment: This customer cannot be deleted: it has the Roof Guard plan #999702 at ZZ s3 two (waiting for its payment). End the plan first (open the property and press End plan), then delete the customer.
17.7 the same, row removed outright: (the same words)
17.8 merging it into another customer: This customer cannot be merged into another: it has the Roof Guard plan #999702 at ZZ s3 two (waiting for its payment). Merge the other customer into this one instead, or end the plan first.
17.9 merging another customer into it: done
17.10 property whose plan has ended, deleted (rows): 1
17.11 put back (rows): 1
17.12 customer with an ended plan merged into another: done, ticket customer follows: true
17.13 customer whose plans have all ended, deleted (rows): 1
17.14 ended plan, property row removed outright (as before this change): refused by the plan's own tie to the property
```

## 18. A plan's inspection ticket stays put

A ticket that is a plan's inspection cannot be moved to another property or customer, nor
changed to another kind of ticket. A rule of its own in the database
(`service_jobs_care_ticket_stays`; the two older rules are not touched), and the ticket page's
save (`saveServiceJob`) says the same before it writes. Its technician, date, notes and stage
change as before. One change is let through: the customer following the property when two
customers are merged.

Files: `supabase/migrations/20261120720000_care_ticket_stays_put.sql`,
`src/lib/care-plan-guards.ts`, `src/lib/service.functions.ts`.

```
18.1 plan ticket to another property: Ticket #999701 is a Roof Care plan inspection for its property. It cannot be moved to another property. For work somewhere else, open a new ticket there.
18.2 to another customer and its property: (refused, the same words)
18.3 to another customer, same property: Ticket #999701 is a Roof Care plan inspection for its customer. It cannot be moved to another customer. For work for someone else, open a new ticket for them.
18.4 changed to a repair: Ticket #999701 is a Roof Care plan inspection. It cannot be changed to another kind of ticket. For a repair, start a repair ticket from this inspection once it is done.
18.5 property taken off: (refused, as 18.1)
18.6 technician, date, notes, stage on the plan ticket: scheduled tech=true date=2026-11-30
18.7 a save that sends the same property, customer and kind (rows): 1
18.8 a plain ticket moved and made an inspection (rows): 1
```

What held before still holds, in the same trial:

```
held.1 date past the window: This Roof Care plan inspection is due by Dec 30, 2026. To move it later, press Care Plan on the ticket and push it back.
held.2 Done before the cleaning answer: Not answered yet: Were the drains and scuppers cleaned? …
held.3 after the answer, Done then Authorized: authorized
```

## 30. Wording, and the checklist on a narrow phone

- Owner › Business, under the lines of business (`src/components/margin-line-charts.tsx`): "A
  plan's revenue counts here when the plan's own invoice is final: the year's price, billed when
  the plan is sold. What an inspection cost counts when that inspection's invoice is final."
  (It said "when an inspection's invoice is final".)
- The ticket's Invoice block for a plan inspection (`src/components/service/invoice-block.tsx`)
  no longer says its invoice "bills this visit's share of the plan": the plan's year is on the
  plan's own invoice; the inspection's invoice is for nothing and keeps what the visit cost,
  and only what is charged on its own goes on it at a price.
- The technician's inspection checklist (`ChecklistRows` in
  `src/components/service/inspection-section.tsx`). The label could not get narrower than its
  longest word, so on a 320 px phone the row was wider than the card and the result buttons ran
  about 42 px off the edge. Under 390 px the label may now shrink and a long word breaks after
  its slash ("Gutters/ downspouts"); under 350 px the buttons also drop to a line of their own
  when the label and they do not fit side by side. From 390 px up not one of the new classes
  applies.

Measured with the real component and the site's own stylesheet, drawn at the card's place on
the page (the old layout reproduces the break test's numbers exactly: page 362 wide on a 320
screen, rows ending at 334.8, 362.3 and 334.4):

| Screen | Before: page / screen | After: page / screen | After                                          |
| ------ | --------------------- | -------------------- | ---------------------------------------------- |
| 320    | 362 / 320             | 320 / 320            | six rows with their buttons on their own line  |
| 340    | 362 / 340             | 340 / 340            | six rows with their buttons on their own line  |
| 349    | 362 / 349             | 349 / 349            | five rows with their buttons on their own line |
| 350    | 363 / 350             | 350 / 350            | same height; three labels break after a slash  |
| 360    | 362 / 360             | 360 / 360            | same height; three labels break after a slash  |
| 375    | 375 / 375             | 375 / 375            | same height; one label breaks after its slash  |
| 389    | 389 / 389             | 389 / 389            | same height; one label breaks after its slash  |
| 390    | 390 / 390             | 390 / 390            | every box identical to before                  |
| 414    | 414 / 414             | 414 / 414            | every box identical to before                  |
| 768    | 768 / 768             | 768 / 768            | every box identical to before                  |

Not checked on the signed-in ticket page itself: the component was drawn on the site's public
page with no sign-in.

## Tests

`src/lib/roof-care-break-tickets-nov20.test.ts`, 36 tests: the words of the announcement; the
8:00 pass against an in-memory database (one ticket, three tickets in one notice per person, run
twice, a ticket another run holds, a failed send given back and retried, people unreadable,
already announced / deleted / finished left alone, a technician's timer and notice, several for
one technician, a timer that fails, before 8:00 and on a weekend); the app's claim and mark; the
delete functions with a plan in force, waiting and ended; the ticket save refusing each move and
still changing technician, date and description; the database's words held equal to the app's;
the wording and the checklist classes. With the three new checks switched off, the three tests
of those checks fail; the announcement tests cannot run on the old code at all (its files did
not exist).

Two older source pins were updated with a dated note (`bid-due-notice.test.ts`: the route's
answer now has `plan_tickets`; `technician-notices.test.ts`: the save's read has four more
columns).

## Database

Applied by hand through the Lovable database tool and checked: the six functions' bodies on the
database match the three files (md5 of each), the three triggers are on, the rights are as said.
Every trial above ended in `TRIAL ROLLED BACK`; the ticket and plan number counters were put
back after each batch.
