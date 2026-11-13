# Audit of every change since the home-screen icon (Nov 13)

Owner: "weve made alot of edits here go ahead and do an audit of all the changes to ensure
everything still work properly starting from the logo when added to the home screen of a phone to
this point". Nothing was fixed in this audit; the findings are for the owner to decide on.

Range: `d92072b` (the icon) to `0b54918`, thirteen commits, 95 files. Also covered: the three
database changes run on Nov 13 and the eight QXO prices.

## How it was checked

1. **The check chain on the current code.** Format, lint (0 errors, the 16 known warnings), types,
   544 test files / 7,098 tests, production build. All clean.
2. **An independent code read** of the whole diff by a second reader with no browser or database.
3. **The live database.** Functions by hash and rights, triggers, settings, rules, open timers,
   price cells, the scheduled runs on GitHub.
4. **The reminder rules, database against site code.** 2,119 date pairs under six settings, from
   Oct 20 2026 to Mar 31 2027 (across the March clock change): next reminder day, next reminder
   instant, and the three working-day helpers. 18 hashes, 12,714 cases each side. All equal.
5. **A browser run on the current code** against the live database, as the test login, on a
   temporary customer, two opportunities, three tickets and one bid.
6. **The published site**, read only, as the test login.

## What works

| Change                                            | Checked how                                                                                                                                                                                                                                              | Result                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Home-screen icon                                  | Manifest and the four icon files served at their stated sizes, the Apple icon tag, favicon, service worker icon; the old icon file gone                                                                                                                  | Pass                     |
| Top bar clear of the clock                        | Bar marked; the gap variable moves the bar by exactly its value; spacing card hidden off the iPhone app                                                                                                                                                  | Pass (see "Not covered") |
| No zoom on iPhone when a box is tapped            | iPhone screen and user agent: one viewport tag, zoom locked, before and after sign-in; on a computer not locked                                                                                                                                          | Pass                     |
| Short test notification                           | "Send me a test": inbox row "Test notification / Notifications are working."                                                                                                                                                                             | Pass                     |
| Opportunity, inspection, repair ticket, bid chain | Ticket from an opportunity: Contacted, with the toast and its Open. Repairs story: repair ticket made, opportunity Won, chain on all three pages. New-roof story: bid made, Submitted, opportunity Quoted, chain on all three pages and in the estimator | Pass                     |
| Ticket reminders on working days                  | A ticket dated today: due 8:00 AM today. A ticket dated Fri Nov 27, assigned Fri Nov 13: due 8:00 AM Nov 27, first reminder Wed Nov 18 8:00 AM (three working days)                                                                                      | Pass                     |
| 8 AM Eastern                                      | Function hashes match the files; the three real ticket timers at 8:00 AM; nothing left at the old hour                                                                                                                                                   | Pass                     |
| Task and bid notices at 8 AM                      | Tests and code read only (they are sent by the pass, which the audit did not trigger)                                                                                                                                                                    | Pass on tests            |
| Reminders settings page                           | The ticket lines, both "Time of day" lines, the boxes showing the live values                                                                                                                                                                            | Pass                     |
| Pricing numbers and push devices                  | Live rules: nine open tables left, the nine meant to be. Acting as each kind of user (rolled back): admin, manager, invoicer read settings; a technician does not; nobody rewrites another person's device                                               | Pass, with finding 3     |
| Bid status on Work Overview                       | Phone width: the box is on the row and inside the screen; Submitted leaves the list with the message and Undo                                                                                                                                            | Pass, with finding 4     |
| Item numbers read whole                           | 1,265 item numbers; the QXO run in Import history; Inventory opens                                                                                                                                                                                       | Pass                     |
| QXO prices                                        | The thirteen cells still hold the quoted prices; one import run on record                                                                                                                                                                                | Pass                     |
| Every page                                        | 31 pages on the current code and 26 on the published site opened with no error                                                                                                                                                                           | Pass                     |

## Findings

1. **The published site does not have most of today's work.** It has the icon and the top bar.
   It does not have the iPhone zoom lock, the short test notification, the opportunity chain,
   the working-day reminder settings and wording, the 8 AM lines, the task and bid 8 AM timing,
   the "Ticket" once wording, the bid status box, or the item-number fix. The publishes did not
   go through. The published site opens cleanly against today's database.
2. **The scheduled reminder job runs about twice a day, not every 30 minutes.** GitHub's last
   twelve runs: Nov 8 to Nov 13, at scattered hours, and none on Nov 13 by 4 PM UTC. The workflow
   asks for every 30 minutes from 12:00 to 23:30 UTC. Reminders therefore go out when someone in
   the office opens the portal, or on those two runs. "8 AM" in practice means the first of those
   after 8 AM. Older than today's work.
3. **A second person cannot turn notifications on at a device another person already
   registered.** Confirmed on the live database (rolled back): the save is refused with a
   database error. Before the Nov 13 security change it worked for anyone with Customers, Service
   or Estimate access. Signing out does not remove a device.
4. **Undo on the Work Overview bid status does not undo the opportunity.** A bid marked Lost by
   mistake and undone is Draft again, but its opportunity stays Lost with its reminders closed.
   Same for Won and Submitted. The Bids page has the same one-way rule; the Undo button is new and
   reads as a full reversal.
5. **A ticket moved back to today or a past day keeps its old reminder date** once a reminder has
   gone out. No "due today" reminder; the next one is the old cadence day.
6. **The notification badge on Android is likely a solid square.** The new icon has no
   transparent background and Android draws the badge from transparency. Not seen on a device.
7. **A timed task before 8 AM gets its "due today" notice after its time.** Follows from 8 AM.
8. **The notice-day wording can be wrong with other settings.** It always says "the next one is
   that morning"; with the notice at two or more days, cadence reminders still fall in between.
9. **A ticket's move of its opportunity fails silently for some errors.** Any error naming the
   database function is treated as "not installed yet"; the ticket saves and the opportunity
   stays.
10. **Test tickets had used up ticket numbers.** The counter stood at 6085 with the last real
    ticket at 6071. Put back to 6071, so the next ticket is #6072.

Known and unchanged: email reminders are not set up (the mail key is missing), so every notice
that asks for email records that.

## Not covered

- A real iPhone Home Screen app: the top-bar gap rule and its spacing card only apply there, and
  the owner confirmed the bar on Nov 13. Real push delivery to a phone.
- The inspection close-out screens: the two temporary inspections were marked Done in the
  database, so their banner read "The technician recommended…" instead of the person's name.
- A plain office user and an estimator-only user: none exists on the live site.
- The reminder pass itself was not triggered, so no reminder was sent by this audit.

## Cleanup

Removed: the temporary customer with its contact and property, two opportunities, three tickets,
one bid, four timers, the test notification, and every history line of theirs. Nothing named "ZZ"
is left. The test login is as it was. The office's settings were not changed.
