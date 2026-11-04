# Opportunities, Nov 4: the review and what came of it

Owner, Nov 4: "take a look at the opportunities page and suggest any efficiency, streamlined, or
workflow improvements." Then, on the suggestions: "go on 1, for 2 the path is opportunity then
customer, then ticket/bid, go on 3, no go on 4, explain 5, 6 the estimated value isnt really an
important value once we have the ability to bid it. agreed with the removal of notes. move delete
just for the phone view. include opportunites in the global search box."

## What the review found

The live table held four opportunities ever, all deleted (two had reached Won). The page is
unused so far, so the review looked for what makes one expensive to enter or easy to lose.

Walked through as the test login on local dev, with one temporary customer and opportunity made
through the real form and removed afterwards (every child row too):

1. A brand-new customer took 14 steps and two popups. The New customer popup insisted on a
   physical address, saved the customer, and the form then said "Add a property to this customer
   first" — a second popup, New property, with the same address already filled in, needing a name
   and Save. The address was typed once and confirmed twice.
2. The Customers page starts a ticket with the customer set, but not an opportunity. (Owner: the
   path is opportunity → customer → ticket / bid, so not done.)
3. The page had no leave guard: the status saved at once, but a changed assignee, close date,
   lead source, value or description stayed pending until Save, and a list row, Start a bid or
   Start a ticket dropped it silently.
4. Delete sat in the header for anyone with Customers access and every opportunity so far ended
   that way. (Owner: no — Delete stays; on a phone it moves to the foot of the page.)
5. The list row shows "Updated … by" and an Untouched badge after the third day, not the last
   contact. (Owner asked for an explanation; not done.)
6. Est. value stays what was typed once a bid is linked. (Owner: not important once it is bid.)
7. Three free-text boxes: Description, Notes with @mentions, Comment on the timeline with
   @mentions. (Owner: remove Notes.)
8. The search box said "Search tickets, customers, bids…" and found opportunities too.

## What changed (one push)

- **The New customer popup makes the first property** (`crm.functions.ts quickCreateAccount`,
  `firstSiteFromAccount`): with a physical address typed, the customer, its primary contact row
  and a property at that address named after the customer are saved together, and the hit
  carries the property, so the opportunity form (and a ticket's, and a bid's) is ready at once.
  No address typed: the customer and its contact only, as before. Should the property fail, the
  customer is taken back. The popup's text says so.
- **Leaving asks** (`opportunities-page.tsx`): a router block on unsaved changes opens "Save
  changes to this opportunity?" — Stay / Leave without saving / Save and leave (Create and leave
  on a new one). A form refused on the spot (no title, no customer) stays with the usual message;
  the save's own success or failure answers for the leave. The page's own moves (created → its
  id, deleted → the list) are not blocked. Closing the tab keeps the browser's own warning.
- **The Assignee box saves at change** on a saved opportunity (`setOpportunityAssignee`), as
  the Status does: the pick shows at once, the server hands the opportunity over (the follow-up
  syncs as a save would — the new assignee's timer starts and they are told, never the person
  making the change), a refusal puts the one before back. It is left out of Save's baseline, so
  it never shows "Unsaved changes". A new opportunity keeps it for Create.
- **No Notes box.** The timeline's Comment (with @mentions) is the one place to write. Notes
  saved before stay on the row: `saveOpportunity` keeps notes left out of the request (an older
  form sending null still clears them).
- **Delete on a phone** is a button at the foot of the page ("Delete this opportunity"), not in
  the header, which keeps Status / Start a bid / Start a ticket; on sm and up it is in the header
  as before.
- **The search box** reads "Search tickets, customers, opportunities, bids…".

Browser check (local dev, the test login, a temporary customer and opportunity removed
afterwards): the popup with an address left the Property box filled ("<customer> — 1 Temp Way,
Pineville, KY 40977") and Create enabled, 9 steps in all against 14; no Notes box; the back link
on a filled new form opened the dialog with Stay / Leave without saving / Create and leave, and
Stay kept the typing; Assignee → me saved on its own ("Assigned to you"), the follow-up strip
showed the timer, no Unsaved marker; a rename then Start a bid opened the dialog, Leave without
saving went to the estimator and the reopened title was the old one; a rename then the back link
with Save and leave saved once and landed on the list, the reopened title the new one; Called,
Quoted and Save as before; on a phone the header showed Quoted / Start a bid / Start a ticket and
Delete was at the foot, on a desktop the reverse. No page errors.

Test: `src/lib/opportunities-nov4-review.test.ts` (11; 10 fail on the old code). Pins updated:
`opportunity-form`, `opportunity-customer-required`, `mention-everywhere`.
