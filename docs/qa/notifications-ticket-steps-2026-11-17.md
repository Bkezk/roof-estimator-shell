# Notifications: a mention that did not show on a phone, and every ticket step for admins and managers

Date: Nov 17, 2026

The owner's words: "someone tagged me in a note and it didnt come up as a notification on my
phone. also managers and owner should get all notifications, like when a ticket is opened then
when scheduled, done etc. is that how its currently set up?"

## 1. The mention

What the database shows for that mention:

- The inbox row was written and is under the bell, unread.
- The push was handed to Apple's push service for the owner's iPhone within half a second, and
  Apple accepted it. No error is recorded.
- The phone's Home Screen app has kept the same sign-in since the day notifications were turned
  on, and was in use that morning. The device was never signed out.
- Three other notices went to the same phone the same morning the same way.

So the server sent it and Apple took it. What the phone then did cannot be seen from here.

Three things in the sending were changed, because each can keep a notice from showing:

1. **Urgency.** Every push went out marked "normal". The web push standard lets a phone that is
   low on battery hold "normal" messages back; only "high" is delivered then. Every notice here
   is for a person, a few a day, so they now go "high".
2. **A shared tag.** Every notice carried the same tag. On Android and desktop browsers a notice
   with the tag of one already on the screen replaces it with no sound and no banner, so a second
   notice was a silent swap. Each notice now has its own tag. (iPhones do not use the tag, so
   this was not the cause on the owner's phone.)
3. **The device's address.** A phone can change its push address without telling the site. Once a
   day, when the app is opened on a device that has notifications on, the device's current
   address is saved again.

And one thing was added so a silent phone is visible: the bell now says when the device in hand
does not get notifications, with a Turn on button. Until now only My account said so. Six of the
eight people had no device turned on at all, which includes both managers.

- "This device does not get notifications yet." with Turn on.
- "Notifications are blocked for this site on this device." with how to allow them.
- On an iPhone in Safari: add the app to the Home Screen first.
- "Not on this device" hides the line on that device. Turning notifications off on My account
  hides it too; turning them on there brings it back.

## 2. Who was told about a ticket, before

| Step | Who was told |
| --- | --- |
| Ticket opened | Nobody, unless it was given to a technician: that technician |
| Scheduled, or given to someone | The technician it was given to |
| Day moved | The technician |
| Reassigned | The old technician and the new one |
| Done | Every admin and manager |
| Authorized | Office users (not an admin who is ticked Technician) |
| Authorized inspection | Nobody |
| Invoiced, Closed, Reopened, Deleted | Nobody (a reopen told the technician) |

So it was not set up the way the owner wants. An opened ticket told no admin or manager.

## 3. Who is told now

Every admin and every manager hears every step of every ticket, once per change:

| Step | The notice |
| --- | --- |
| Opened | "Opened: Ticket #N …" with who opened it, who has it and for when |
| Scheduled | "Scheduled: Ticket #N …" |
| Taken off the schedule | "Back to Open: Ticket #N …" |
| Given to someone, stage unchanged | "Assigned: …", "Reassigned: …" or "Unassigned: …" |
| Day set or moved, stage unchanged | "Date set: …" or "Date moved: …" |
| Done | "… is done, ready for your review" (as before) |
| Authorized | "… authorized, ready to invoice" (now also to admins ticked Technician) |
| Authorized inspection | "Authorized: … That completes the inspection." |
| Invoiced | "Invoiced: Ticket #N …" |
| Closed | "Closed: Ticket #N …" |
| Reopened | "Reopened: Ticket #N …" |
| Deleted | "Deleted: Ticket #N …" |

Rules:

- Nobody hears one change twice. An admin or manager who gets "Assigned to you", "was
  reassigned" or "moved to <day>" for a change does not also get the step notice for it.
- The person who made the change is told only with "My own changes" on, as everywhere else.
- They are service notices. The Service notices switch on My account turns them off for a person.
- In the inbox filter they are "Ticket update".
- A notice that cannot be sent is logged. It never fails the ticket save.
- Technicians and office users get what they got before. Nothing was taken away.

Opportunities and bids are as they were.

## Proof

- New checks: `src/lib/ticket-watch-nov17.test.ts` (25): the words of each step, who is told and
  who is left out, the one-notice-per-change rule, high urgency on the wire, no shared tag, the
  bell's line in each device state.
- Nine older checks pinned the old text and were updated with a dated note each.
- Whole suite: 589 files, 8,318 tests pass. Lint, types and the build pass.
- Browser, 1500 px and 390 px: the bell's line shows in the "off" and "blocked" states, fits the
  popover with no sideways scroll, Turn on reports a refusal in plain words, "Not on this
  device" hides it and it stays hidden after a reload.
- The live database lists five admins and managers as the people told.
- Not run against the live site: opening or moving a real ticket to watch the notices arrive.
  That would have sent notices to real people. The server rule is covered by the checks above.

Nothing in the data was changed. No database change was needed.

## Later the same day

### The mention: the likely cause

The owner said the other three notices that morning did show on the phone. The mention was the
only one that arrived while an earlier notice (14 minutes older) was probably still on the
screen. Every notice carried the same tag, and a notice with the tag of one already showing
replaces it with no sound and no banner. That fits what happened. It could not be proven on the
phone from here. The shared tag is gone (section 1, point 2), so it cannot happen again that way.

### The ticket's Notes box is "Special instructions"

The owner's words: "can we also changes notes on service tickets to special instructions as we
already have the activity log".

A ticket had two things called notes: the box on the ticket, and the notes written in its
Activity. The box is now "Special instructions". Activity keeps its notes.

- The label on the ticket, for the office and on the technician's page.
- The technician's line under the details: "The office sets these. Special instructions are
  below; the close-out marks the ticket Done."
- History: a change to the box reads "special instructions 'a' → 'b'" on a ticket. A customer's,
  a property's and a purchase order's notes still read "notes". Database change
  `20261117150000_history_special_instructions.sql`, applied and checked on the live database.
  History already written is left as it is.

Wording only. What is typed in the box is kept, it saves to the same place, and a technician can
still type in it.

Proof:

- New checks: `src/lib/special-instructions-nov17.test.ts` (5).
- Whole suite: 590 files, 8,324 tests pass. Lint, types and the build pass.
- Live database, a trial that was rolled back: a ticket's change read "special instructions",
  its urgency still read "urgency", a customer's still read "notes". The function kept its
  settings and its 15 triggers.
- Browser, 1500 px and 390 px: a new ticket and an existing one both show "Special
  instructions", and no label on the form reads "Notes". Nothing was typed or saved.
