# Opportunity, inspection, repair ticket, bid: the four joins (Nov 13, 2026)

Owner, Nov 13: "I like all the steps", then "go with the preselect office choices and show the
whole chain".

Before this, an opportunity knew its inspection ticket and nothing after it: a repair ticket made
from the inspection did not carry the opportunity, a bid started from the inspection was not
linked to it, no ticket ever changed an opportunity's status, and each page said where it came
from in its own separate line. Four joins fix that.

Chain on the final tree: prettier clean, eslint 0 errors (the 16 baseline warnings), tsc clean,
535 test files / 6,863 tests, build exit 0.

## What each join does

| #   | Join                               | What happens now                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The opportunity is carried through | A repair ticket made from an inspection takes the inspection's opportunity. A bid started from an inspection takes it too, and the opportunity points back at the bid, so the bid drives the opportunity exactly like a bid started from the opportunity (Submitted makes it Quoted, Won makes it Won, Lost makes it Lost). |
| 2   | A ticket moves its opportunity     | An inspection started from an Open opportunity makes it Contacted. A repair ticket makes it Won. After "No action needed" the office is asked what happens to the opportunity. Each move is logged with who and which ticket, treats the reminders as that status does by hand, and is said out loud in a toast.            |
| 3   | The office's choice is preselected | On a Done inspection, "Recommend repairs" highlights Create repair ticket and "Recommend a new roof" highlights Create bid, with one line above: "Tyler Reed recommended repairs". Every choice stays pressable.                                                                                                            |
| 4   | One chain line on all four records | `Opportunity: <title> (Quoted) › Inspection #6041 (Done) › Bid: <name> (Submitted)` on the opportunity, the inspection ticket, the repair ticket and the bid. Each part is a link, the record being looked at is bold, and a person sees only the parts they may read.                                                      |

## The status moves, as built

| What is made                                                                | The opportunity is…       | It becomes                                  |
| --------------------------------------------------------------------------- | ------------------------- | ------------------------------------------- |
| An inspection ticket started from the opportunity                           | Open                      | Contacted                                   |
| An inspection ticket started from the opportunity                           | Contacted or Quoted       | unchanged (never backwards)                 |
| A warranty ticket started from the opportunity                              | Open                      | Contacted (a visit, not a sale)             |
| A repair ticket (Repair or Other) started straight from the opportunity     | Open, Contacted or Quoted | Won                                         |
| A repair ticket (Repair or Other) made from an inspection that came from it | Open, Contacted or Quoted | Won                                         |
| A warranty ticket made from an inspection that came from it                 | Open                      | Contacted                                   |
| "No action needed" on its inspection                                        | Open, Contacted or Quoted | unchanged until the office answers          |
| …the office answers "Mark it Lost"                                          | Open, Contacted or Quoted | Lost                                        |
| …the office answers "Mark it No response"                                   | Open, Contacted or Quoted | No response                                 |
| …the office answers "Leave it open"                                         | any                       | unchanged; the answer is kept on the ticket |
| Any ticket                                                                  | Won, Lost or No response  | unchanged (closed is closed)                |
| Any ticket                                                                  | deleted                   | unchanged                                   |

Each move:

- is written to the opportunity's status log like a change made by hand, with the person's name,
  plus where it came from: "from ticket #6075", or "from ticket #6077: no action needed". The
  status strip on the opportunity shows it under the name;
- treats the follow-up reminders exactly as that status does when set by hand: Won, Lost and No
  response stop them ("No follow-up: Won stops the reminders"), Contacted keeps them;
- is said out loud: `Opportunity “<title>” is now Won`, with **Open** for people who can read
  opportunities;
- works whoever creates the ticket. The office creates tickets without always having Customers
  access, so the move is done by a database function that checks the caller is someone who may
  create tickets (an admin, a manager, or the office with Service access; never a technician-only
  user, never a signed-out caller).

If the ticket is saved but the opportunity cannot be moved, the ticket stands and an error toast
says so. The ticket is never refused because of the opportunity.

## How it is built

**Database** (`supabase/migrations/20261113100000_opportunity_chain.sql`, applied to the live
database on Nov 13):

- `service_jobs_carry_opportunity` (before insert on tickets): a ticket made from another ticket
  takes that ticket's opportunity when it has none of its own.
- `bids_carry_opportunity` (before insert, and before a change of the bid's inspection): a bid
  with an inspection and no opportunity takes the inspection's opportunity, when that opportunity
  is live and has no live bid of its own yet. `bids_carry_opportunity_link` then writes the
  opportunity's own pointer to the bid.
- `move_opportunity_from_ticket(ticket, answer)`: the rule in the table above. It holds a setting
  for its one update so the log trigger can write the note.
- `ticket_opportunity(ticket)`: the title and status of a ticket's opportunity, for the question
  after "No action needed". Same caller check as the move.
- `crm_opportunity_events.note` (new column) and `crm_opportunities_log()` re-created to fill it.

Rights, checked with `has_function_privilege` after applying:

| Function                         | anon | signed-in | server |
| -------------------------------- | ---- | --------- | ------ |
| `move_opportunity_from_ticket`   | no   | yes       | yes    |
| `ticket_opportunity`             | no   | yes       | yes    |
| `service_jobs_carry_opportunity` | no   | no        | yes    |
| `bids_carry_opportunity`         | no   | no        | yes    |
| `bids_carry_opportunity_link`    | no   | no        | yes    |

All five run with their own rights and a fixed search path. `crm_opportunities_log()` was
re-created in place, which keeps the rights it had. No table grants changed
(`information_schema.role_table_grants` for `crm_opportunity_events` read before and after: the
same). No row-security policy was touched.

**Server**: `moveOpportunityFromTicket` (`src/lib/opportunities.functions.ts`) calls the function
and then brings the reminders in line, the same way a bid does. It is called when a ticket is
created (`saveServiceJob`), when a repair ticket is made from an inspection
(`createRepairFromInspection`), and when the office answers the question
(`answerInspectionOpportunity`, new). `linkBidToInspection` syncs the opportunity once the bid is
linked. Nothing in the new code reads with the server's own rights: what the reminders need comes
back in the function's answer.

**Pages**: `src/lib/work-chain.ts` builds the chain (pure), `src/lib/work-chain.functions.ts`
reads it under the reader's own rights, `src/components/work-chain-line.tsx` draws it.
`src/lib/ticket-moves.ts` is the pure twin of the move rule; `officePreselect` in
`src/lib/inspection.ts` is the preselect rule.

## What the new database rules do while the old site code is still live

The migration is live now; the site code is not published until this branch is.

- **Acting now**: a repair ticket made from an inspection gets the inspection's opportunity. A bid
  started from an inspection gets linked to the inspection's opportunity on both sides, and the
  old code's bid save then moves the opportunity (Submitted → Quoted and so on), because it
  already syncs any bid whose row names an opportunity.
- **Not acting until the new code is published**: tickets moving an opportunity's status, the
  question after "No action needed", the preselect, the chain line, and the "from ticket #N" note
  (the column exists and stays empty).
- Nothing existing was changed. Nothing was backfilled.

## Existing rows the new rule would have linked (left for the owner)

Counted on the live database before applying:

| Rows                                                                                           | Count |
| ---------------------------------------------------------------------------------------------- | ----- |
| Live repair tickets made from an inspection that has an opportunity, with none of their own    | 1     |
| Live bids started from an inspection that has an opportunity, with no opportunity of their own | 0     |

The one repair ticket was left as it is. The chain line still shows it after its inspection (the
line follows the "made from" link as well), but it did not move its opportunity.

## Decisions taken on judgment (for the owner to confirm)

1. **A warranty ticket is a visit, not a sale.** It moves Open to Contacted and never to Won.
   "Repair" and "Other" tickets win the opportunity.
2. **One bid drives an opportunity.** If the opportunity already has a live bid, a second bid from
   the same inspection (an option for the customer, usually a copy) is not linked to the
   opportunity. It still shows in the chain line beside the first. If the first bid is deleted,
   the next bid made from the inspection takes over.
3. **Lost asks for no reason.** An opportunity's own Lost has no reason box, so "Mark it Lost"
   has none either.
4. **"Leave it open" is kept as a note on the ticket's timeline**, not as a new column. That note
   is also how the page knows the question was answered.
5. **The office sees the opportunity's title in the question and the toast even without Customers
   access.** Only the title and status, only for the ticket in front of them. They get no link to
   open it, and the chain line does not show them the opportunity.
6. **The name in "… recommended repairs" is whoever marked the inspection Done**, as the ticket's
   timeline has it, full name. If nobody is named it reads "The technician recommended …".
7. **When something was recommended, that choice is the filled (black) button and "No action
   needed" is outlined.** With no recommendation "No action needed" stays the black one, as
   before.
8. **A ticket that cannot move the opportunity is still saved**, with an error toast saying the
   opportunity did not change. Refusing the ticket would make the office create it twice.
9. **A ticket move does not stamp "contacted at".** It mirrors a status set by hand, which does
   not either.
10. **The old "From opportunity" and "From inspection" lines stay as the fallback.** They show
    when there is no chain to draw: for example a technician on an inspection whose only
    neighbours are an opportunity and a bid sees "From an opportunity", as before.
11. **The chain is read for a ticket only when it came from something or is an inspection.** A
    plain repair ticket with no links makes no extra request.

## Conflict between the brief and how the system works

The brief had the server read the opportunity back with its own rights after a move. The preview
and the local server have no service key, so that read silently returned nothing for an office
user without Customers access, and the question never showed. Found in the browser. Changed so
the database functions hand back what is needed and nothing is read with elevated rights. It now
works the same with or without the key.

## Limits

- **Deleting or restoring a ticket does not move the opportunity back.** A repair ticket deleted
  by mistake leaves the opportunity Won until someone changes it by hand.
- **Pressing "No action needed" twice in a row does not ask twice.** The button is disabled once
  that outcome is recorded. The question comes back only if the outcome changes and is set to
  "No action needed" again.
- **A person assigned to an opportunity can read it whatever their role.** A technician who is
  the assignee sees the opportunity in the chain line. That is the opportunity's own access rule,
  unchanged.
- **The preselected "Create repair ticket" stays greyed until a date is typed**, as before. It
  needs a date.
- **Temp tickets used numbers 6075 to 6082.** The next real ticket is #6083; the counter was not
  wound back.

## Proof

### Database rules, by SQL on temporary rows

Three blocks, each ended with an error on purpose so every temporary row rolled back. The caller
was the test login with its profile changed inside the block.

| Caller                                          | What was tried                                               | Result                                                               |
| ----------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Office: role user, Service only, no Customers   | Update the opportunity directly                              | 0 rows (not theirs to edit)                                          |
| Same                                            | Inspection from an Open opportunity                          | Open → Contacted, note "from ticket #990001"                         |
| Same                                            | The same call again                                          | unchanged                                                            |
| Same                                            | Insert a repair ticket naming only the inspection            | It carries the opportunity                                           |
| Same                                            | Move from that repair ticket                                 | Contacted → Won                                                      |
| Same                                            | Ask for Lost on an inspection with no "No action needed"     | refused (22023)                                                      |
| Same                                            | "No action needed" inspection, Lost                          | Open → Lost, note "…: no action needed"; then No response: unchanged |
| Same                                            | "No action needed" inspection, No response                   | Open → No response                                                   |
| Same                                            | Ask for Won as the answer                                    | refused (22023)                                                      |
| Same                                            | Inspection on a Quoted opportunity                           | unchanged                                                            |
| Same                                            | "Other" ticket on a Quoted opportunity                       | Quoted → Won                                                         |
| Same                                            | Repair ticket on a Lost opportunity                          | unchanged                                                            |
| Same                                            | Inspection on a deleted opportunity                          | nothing                                                              |
| Same                                            | Warranty ticket on an Open opportunity                       | Open → Contacted                                                     |
| Same                                            | `ticket_opportunity` (cannot select the opportunity: 0 rows) | title and status only                                                |
| Technician: role user, Service only, technician | Either function                                              | refused (42501 Forbidden)                                            |
| Signed out                                      | Either function                                              | refused (42501 permission denied)                                    |
| Manager                                         | Inspection from an Open opportunity                          | Open → Contacted                                                     |
| Anyone, by hand afterwards                      | Change the status                                            | logged with no note                                                  |
| Estimator: Estimate and Service, no Customers   | Insert a bid naming an inspection                            | bid and opportunity linked both ways                                 |
| Same                                            | A second bid from the same inspection                        | not linked; the first stays                                          |
| Same                                            | First bid deleted, a third bid                               | linked; the pointer moves                                            |
| Same                                            | A plain bid, then its inspection set                         | linked both ways                                                     |
| Same                                            | A bid that already has its own opportunity                   | keeps its own                                                        |
| Same                                            | Inspection with no opportunity, or a deleted one             | not linked                                                           |
| Same                                            | Bid Submitted, bid Won                                       | opportunity Quoted, opportunity Won                                  |

### Tests

Three new files, 74 tests: `src/lib/work-chain-nov13.test.ts`,
`src/lib/ticket-moves-nov13.test.ts`, `src/lib/office-preselect-nov13.test.ts`. With the wiring
files stashed, 36 of the 74 fail; the 38 that still pass test the new pure modules and the
migration text, which were not stashed. Five older tests pinned lines that were changed on
purpose and were updated to the new lines.

### Browser, on temporary rows

One temporary customer, seven temporary opportunities, eight temporary tickets, one temporary
bid. Signed in as the test login on the local server against the live database.

| Step                                                                       | Seen                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start a ticket (Inspection) from six Open opportunities                    | Each time: "Ticket #N created" and `Opportunity “…” is now Contacted` with Open. Strip: "Contacted Nov 13 by Claude from ticket #6075".                                                                                                                           |
| Open on that toast                                                         | Lands on the opportunity, status Contacted.                                                                                                                                                                                                                       |
| Done inspection, Recommend repairs                                         | Line "Claude recommended repairs"; Create repair ticket filled and marked; Create bid and No action needed outlined and pressable. Same in the banner and the panel.                                                                                              |
| Create repair ticket                                                       | "Repair ticket #6081 created" and `Opportunity “ZZ Wf A repairs” is now Won`. Reminders stopped (follow-up closed, reason "status won").                                                                                                                          |
| Chain on the opportunity, the inspection, the repair ticket                | `Opportunity: ZZ Wf A repairs (Won) › Inspection #6075 (Done) › Repair ticket #6081 (Open)` on all three; own part bold; the links work.                                                                                                                          |
| Done inspection, Recommend a new roof                                      | Line "Claude recommended a new roof"; Create bid filled and marked.                                                                                                                                                                                               |
| Create bid, save                                                           | Bid linked to the inspection and the opportunity both ways. Estimator line: `… (Contacted) › Inspection #6076 (Done) › Bid: ZZ Wf bid B (Draft)`.                                                                                                                 |
| Status Submitted                                                           | Opportunity Quoted. Line on the opportunity, the inspection and the bid: `… (Quoted) › Inspection #6076 (Done) › Bid: ZZ Wf bid B (Submitted)`.                                                                                                                   |
| Bid back to Draft, then Submitted again                                    | The bid part follows; the opportunity stays Quoted (never backwards).                                                                                                                                                                                             |
| No action needed on an inspection with no recommendation                   | No line, nothing preselected, No action needed is the black one. "Recorded: no action needed", then the question, at the top and in the panel.                                                                                                                    |
| Before answering                                                           | Opportunity still Contacted, reminders still running.                                                                                                                                                                                                             |
| Mark it Lost                                                               | `Opportunity “ZZ Wf C lost” is now Lost`; reminders stopped; log "from ticket #6077: no action needed"; note on the ticket.                                                                                                                                       |
| Mark it No response                                                        | `… is now No response`; reminders stopped.                                                                                                                                                                                                                        |
| Leave it open                                                              | "The opportunity stays open"; still Contacted; reminders still running; note on the ticket.                                                                                                                                                                       |
| Office user with no right on the opportunity (not Customers, not assignee) | The question shows with the title; Mark it No response closes it; the toast names it with no Open; the chain line is not shown, "From an opportunity" is.                                                                                                         |
| Technician                                                                 | `Inspection #6075 (Done) › Repair ticket #6081 (Open)`: tickets only, no opportunity, no bid, no amount. On an inspection whose neighbours are an opportunity and a bid: no chain line. No question, no choices. The opportunity itself: "Opportunity not found". |
| 390 px wide                                                                | The line wraps onto 2 or 3 rows on the opportunity, both tickets and the bid; nothing wider than the screen; no sideways scroll.                                                                                                                                  |

One thing was found and fixed during this run: the estimator's line kept "(Draft)" after "Status
saved: Submitted", because the Status box saves on its own. It refreshes now, and a test pins it.

Stages were set by SQL where a real notice would have gone to the office: the six inspections
were marked Done by SQL (with the test login as the actor, so the timeline names it), not through
the technician's close-out. The close-out itself was not driven in this run.

### Not proven

- The technician's own close-out feeding the recommendation line. The line was proven from an
  inspection marked Done by SQL with the two switches set by SQL.
- The published site. Everything above ran on the local server against the live database.
- An error toast for a move that fails after the ticket is saved. Proven by test only; it could
  not be caused on purpose in the browser.

## Cleanup

Every temporary row was deleted, children first. No files were uploaded.

| Table                | Before | During | After |
| -------------------- | ------ | ------ | ----- |
| Tickets              | 51     | 59     | 51    |
| Ticket timeline rows | 346    | 372    | 346   |
| Ticket crew rows     | 12     | 18     | 12    |
| Bids                 | 33     | 34     | 33    |
| Bid locks            | 6      | 7      | 6     |
| Opportunities        | 6      | 13     | 6     |
| Opportunity log rows | 11     | 33     | 11    |
| Follow-ups           | 57     | 69     | 57    |
| Customers            | 638    | 639    | 638   |
| Properties           | 1,139  | 1,140  | 1,139 |
| Contacts             | 709    | 710    | 709   |
| History rows         | 3,474  | 3,529  | 3,474 |
| Notices              | 197    | 197    | 197   |

Rows named "ZZ Wf" left anywhere: 0. Files added to storage during the run: 0. The test login is
back to admin, no page list, technician ticked. Its role was changed by SQL for the office and
technician runs and put back after each.
