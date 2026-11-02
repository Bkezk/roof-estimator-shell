# My tickets audit — Nov 2, 2026

Audit of the My tickets page (`/service/today`) at main `8fab2e1`. Nothing on the page was changed:
the findings below are proposals for the owner to decide on, each with its proof. The page was read
end to end, its rules were proved against the live database as each kind of user, and it was driven
in a real browser as the test login (`Claude`, an admin ticked Technician, then flipped to a
technician-only user for one part) against four temporary tickets of that login's own, deleted
afterwards.

## What was audited

| Part                                                                                                                                                                                                                                                                   | Files                                                                                                                                                                                                                                                                                                                                                                          | How                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| The route (every signed-in user's; a technician-only user's landing page)                                                                                                                                                                                              | `src/routes/service.today.tsx`, `src/lib/access.ts` (`pageForPath`, `homeFor`, `isFieldOnly`), `src/components/app-sidebar.tsx`                                                                                                                                                                                                                                                | read                                                                   |
| The page: heading, the day, the Service link, Refresh, the clock banner, the Today / Coming up / No date yet groups, the card (date line, maps link, history strip, description, warranty, instructions, contact, crew, clock buttons, Open ticket), the midnight flip | `src/components/service/today-page.tsx` (625 lines)                                                                                                                                                                                                                                                                                                                            | read end to end, then driven in the browser                            |
| The server: `myDay` (the list), `myClock`, `clockOnJob`, `setFieldStatus` (every press), `ownJob` / `clockJob` / `worksOnJob`, the time entry a closed clock writes                                                                                                    | `src/lib/service-field.functions.ts`, `src/lib/clock-close.server.ts`                                                                                                                                                                                                                                                                                                          | read; every press checked in the database after the browser pressed it |
| The pure rules: the clock's transition table, the toast lines, the card's buttons, the entry day, the phone's day                                                                                                                                                      | `src/lib/tech-clock.ts`, `src/lib/field-day.ts`, `src/lib/arrival-window.ts`, `src/components/service/field-utils.ts`, `src/lib/job-cache.ts`                                                                                                                                                                                                                                  | read                                                                   |
| What the card reaches: the close-out (Open ticket, the banner's Complete, Leave site there), the crew box, the history strip                                                                                                                                           | `src/components/service/closeout.tsx` (the clock parts), `src/components/service/crew-box.tsx`, `src/components/service/site-history.tsx`, `src/lib/service-history.ts`                                                                                                                                                                                                        | read; driven in the browser                                            |
| The database side                                                                                                                                                                                                                                                      | `pg_policies` on service_jobs, service_tech_clock, service_time_entries, service_job_events, service_job_crew (a view), crm_sites, crm_contacts, crm_accounts, site_warranties; the functions `is_technician`, `has_access`, `is_on_crew`, `works_on_ticket`, `ticket_open_for_tech`, `tech_sees_site` / `_account` / `_contact`, `technician_options`, `site_history_summary` | read from the live database                                            |

## What passed

| Check                                                                                                                                                                                                                                                                | Result                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The existing tests that pin this page and the clock (`tech-clock`, `tech-clock-wiring`, `today-midnight`, `done-only-flow`, `my-tickets-page`, `field-only-nav`, `today-open-profile-toast`, `field-day`, `arrival-window`, `site-history-fence`, `service-history`) | 11 files, 182 tests, all pass                                                                                                                                                                                                      |
| Full suite at this commit (run earlier today, unchanged code)                                                                                                                                                                                                        | 464 files, 5,979 tests, all pass                                                                                                                                                                                                   |
| Who the list is for: `myDay` filters `technician_id = me` whatever the role, stages open / scheduled only, soonest first, undated last, at most 100                                                                                                                  | read in the code; proved live: the admin test login with four tickets got exactly those four in that order; a plain technician (Test tech) got none and could not read them at all (below)                                         |
| Row security as a technician-only user (`set local role authenticated` + that user's claims, read-only)                                                                                                                                                              | sees only their own tickets (`technician_id = me` or on the crew); the temp site, contact and warranty were invisible to Test tech and visible to the test login only once it was the technician on a ticket there (`tech_sees_*`) |
| The one clock per technician (`service_tech_clock`, one row per `technician_id`)                                                                                                                                                                                     | every press in the browser left exactly one row or none; never two                                                                                                                                                                 |
| A closed clock becomes a time entry with the real start and end, hours to the quarter hour, never under a quarter, `source 'clock'`, the phone's day                                                                                                                 | three entries written during the run (two on #6047, one on #6045), each 0.25 h for 67–102 s of labor, `on_date 2026-11-02`                                                                                                         |
| A clock stopped under a minute writes nothing (a mistap)                                                                                                                                                                                                             | four such stops during the run, 0 entries, the toast said "under a minute, nothing logged" each time                                                                                                                               |
| Cancel ("Started travel by mistake?") drops the clock, clears the stamps, writes an "undo" timeline row and no entry                                                                                                                                                 | proved twice (#6044, #6045)                                                                                                                                                                                                        |
| A press on ticket B while the clock is on ticket A closes A (its entry written, its `field_status` cleared, "stopped travelling" / "left site" on A's timeline) and opens B                                                                                          | proved four times, both directions                                                                                                                                                                                                 |
| The toast is built from the server's report of the press, never from the phone's cached clock                                                                                                                                                                        | every toast line matched the database's own result (table below)                                                                                                                                                                   |
| No one else is notified by anything a technician does here                                                                                                                                                                                                           | 0 notification rows for anyone during the whole run (the only notice this flow can send is Complete's "ready for your review" to the authorizers, which was not pressed — see below)                                               |
| The page's own day is the phone's calendar day (not UTC or Eastern) and the groups flip at midnight without a reload                                                                                                                                                 | `today-midnight.test.tsx` (7 tests) renders the page in America/Chicago across midnight; the server refuses a phone day more than 2 days from its own (`field-day.test.ts`)                                                        |
| Phone width (390 px)                                                                                                                                                                                                                                                 | no horizontal overflow; every button at least 44 px tall                                                                                                                                                                           |
| Page errors / console errors                                                                                                                                                                                                                                         | none in any of the eleven browser runs                                                                                                                                                                                             |

### The browser run, as the test login

Four temporary tickets of the test login's own, under a temporary account / site / contact /
warranty of its own (all deleted after): A `#6044` today with a Morning window and one helper, B
`#6045` on Nov 5 with an Afternoon window, C `#6046` with no date and no site, D `#6047` dated
Oct 30 (overdue). The live work of everyone else (one scheduled ticket) was never touched.

| Step   | Did                                                                           | Saw                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1–T2  | opened `/service/today`                                                       | "My tickets", "Monday, Nov 2", the Service link, Refresh; Today 2 (D the overdue one first, then A), Coming up 1 (B), No date yet 1 (C)                                                                                                                                                                                                                                                                                                          |
| T3     | card A                                                                        | "#6044 · customer"; "Today · Morning 8–10"; the site name and address as one Google Maps link; "History here: 2 earlier tickets, last Nov 5 (…)" (finding 1); the description; "Warranty: Duro-Last 15 NDL · to Jan 2039"; the amber Instructions box; the contact and a `tel:` link; "1 helper", no Change; Start travel, On site, Open ticket                                                                                                  |
| T4     | card D (Oct 30)                                                               | "Was due Fri, Oct 30" in amber, the Afternoon window left off (its day has passed)                                                                                                                                                                                                                                                                                                                                                               |
| T5     | card B (Nov 5)                                                                | "Thu, Nov 5 · Afternoon 1–4"                                                                                                                                                                                                                                                                                                                                                                                                                     |
| T6     | card C (no date, no site)                                                     | no date line; "Open in maps" searching the customer name; the account's phone as the `tel:` link; no history strip, no instructions                                                                                                                                                                                                                                                                                                              |
| T7–T8  | no clock; phone width                                                         | no banner; no overflow                                                                                                                                                                                                                                                                                                                                                                                                                           |
| T9     | Start travel on A                                                             | toast "Travelling to #6044 …"; the amber banner "Travelling · since 11:17 AM", "Travelling to #6044 … · 0 m", On site, the Cancel line; card A "You are travelling here · since 11:17 AM — use the clock at the top" with no clock buttons; the other cards keep theirs. Database: one clock row (travel, helper_count 1 carried from the ticket), `field_status en_route`, `en_route_at` stamped, one "field · en_route" timeline row, no entry |
| T10    | Cancel                                                                        | "Cancelled — nothing logged at #6044 …"; banner gone; buttons back. Database: no clock row, `field_status` and `en_route_at` cleared, an "undo" row, no entry                                                                                                                                                                                                                                                                                    |
| T11    | Start travel on A, then On site on D 6 s later                                | "Travel to #6044 … · under a minute, nothing logged — on site at #6047 …"; the green banner "On site · since", Leave site (not done yet), Complete (finish the ticket); card D "You are on site here"; A's buttons back. Database: the clock row now labor on D; A `field_status` cleared with "stopped travelling"; D `on_site`; no entry                                                                                                       |
| T11d–e | waited past a minute on D, then Start travel on B                             | the banner's minutes had moved to "1 m" (the banner ticks every 30 s, so the label is up to 30 s behind); "Left #6047 … · 0.25 h labor logged — travelling to #6045 …". Database: a labor entry 16:21:16–16:22:29, 0.25 h, on_date Nov 2, source clock; "left site" on D                                                                                                                                                                         |
| T11g   | Cancel the travel to B                                                        | "Cancelled — nothing logged at #6045 …", no banner                                                                                                                                                                                                                                                                                                                                                                                               |
| T13    | Start travel on B, then the banner's On site                                  | "Travel to #6045 … · under a minute, nothing logged — on site at #6045 …"; the banner green on B; card B "You are on site here"                                                                                                                                                                                                                                                                                                                  |
| T12    | waited 95 s, Leave site on the banner                                         | the banner read "1 m"; "Left #6045 … · 0.25 h labor logged"; banner gone. Database: labor entry 16:23:23–16:25:05, 0.25 h                                                                                                                                                                                                                                                                                                                        |
| T14    | On site on C straight away (no travel), Leave site 7 s later                  | "On site at #6046 …", then "Left #6046 … · under a minute, nothing logged". Database: C, an Open ticket, became Scheduled on the press (note 3)                                                                                                                                                                                                                                                                                                  |
| T23    | On site on A, then the banner's Complete                                      | the close-out opened (`/service?id=…&closeout=1`) with nothing completed; its clock line "On site at #6044 … · 0 m" with Leave site; Leave site there → "Left #6044 … · under a minute, nothing logged", the line gone                                                                                                                                                                                                                           |
| T15–16 | Open ticket on C; "I'm alone"; back to My tickets; Change; Done               | the close-out with "Who is on this job with you?" first and its own My tickets link; back on the list card C reads "Alone" with Change; Change opens the crew box with I'm alone pressed and the button reads Done; Done closes it. Database: `crew_confirmed_at` stamped, one crew row (the lead), "Crew: alone on the job" on the timeline                                                                                                     |
| T17    | the card's title                                                              | the ticket page (`/service?id=…`), not the close-out                                                                                                                                                                                                                                                                                                                                                                                             |
| T18    | "Every stage, on the Service page" (as an admin)                              | `/service`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T19    | Refresh                                                                       | two server calls (the day and the clock)                                                                                                                                                                                                                                                                                                                                                                                                         |
| T20    | the four tickets unassigned by SQL for a moment                               | "Nothing open for you. Check with the office for your next ticket.", no groups                                                                                                                                                                                                                                                                                                                                                                   |
| T21    | the test login flipped to a technician-only user (user, Service only, ticked) | `/` lands on My tickets; the menu is My tickets and Inventory only; the same four tickets                                                                                                                                                                                                                                                                                                                                                        |
| T22    | "Every stage, on the Service page" as that user                               | bounced straight back to `/service/today` (finding 2)                                                                                                                                                                                                                                                                                                                                                                                            |

Complete itself was not pressed: it marks the ticket Done and sends "ready for your review" to the
authorizers (Brandon and the other admins and managers), which a temporary ticket must not do. Its
server path (the clock's labor entry, the close-out gaps refusal for a technician, a manager
completing anyway, a ticket the office already finished only stamped, Undo stepping a Done ticket
back) is covered by `tech-clock-wiring.test.ts` (65 tests) and `done-only-flow.test.ts`.

The timeline rows the run wrote, in order (all deleted with the tickets): en_route, undo, en_route,
stopped travelling, on_site, left site, en_route, undo, en_route, stopped travelling, on_site, left
site, en_route, undo, en_route, on_site, left site, on_site, stage (C to Scheduled), left site, edit
(crew), on_site, left site — one row per press, by "Claude".

## Findings

None of these breaks the page. No fix has been applied; the owner decides.

### 1. The history strip calls a future ticket "earlier" (minor, wording) — FIXED, see part 2

Card A (today) read **"History here: 2 earlier tickets, last Nov 5 (Claude temp B … — coming up)."**
Ticket B is scheduled three days from now, not earlier, and "last Nov 5" names a day that has not
come. Card B in turn counted A and D.

Proof: `site_history_summary` (the database function the strip reads) counts every other
non-deleted ticket at the site whatever its stage or day, and picks the "last" by
`coalesce(completed_at, scheduled_date, created_at) desc`; `historyStrip` in
`src/lib/service-history.ts` words the count as "earlier ticket(s)". On a real property with two
tickets booked the same week, each card says the other is history.

Proposed fix (either): count and name only tickets that are finished or whose day has passed, or
reword the strip to "2 other tickets here" when the latest is still to come. The History fold on
the ticket page has the same count.

### 2. "Every stage, on the Service page" is a dead link for a technician-only user (minor) — left as is (owner: expected)

The link under the heading shows for everyone; for a technician-only user `src/routes/service.tsx`
line 35 sends `/service` without a ticket id straight back to `/service/today`, so the tap does
nothing but reload the page they are on.

Proof: T22 above — the URL after the click was `/service/today`.

Proposed fix: leave the link out when `isFieldOnly(profile)` (the sidebar already hides Service
for them for the same reason).

### 3. A crew member cannot clock in from anywhere (worth a decision) — left as is (owner: expected; the lead's clock carries the crew)

The server lets a technician named in "Who is on this job with you?" clock their own travel and
labor on that ticket (`clockJob` / `worksOnJob`, and the comment "a crew member clocks into the
ticket too — their own clock, their own time entries"; RLS `works_on_ticket` includes
`is_on_crew`). But My tickets lists the lead's tickets only (`myDay` filters `technician_id = me`),
so a crew member has no card and no Start travel / On site button; the only other place that
presses the clock is the close-out's Leave site and Complete (`closeout.tsx`), which a crew member
reaches only by opening a ticket that is not theirs. Today the lead's helper count carries the
crew's hours on the lead's entry, so nothing is lost; the per-person clock the server allows is
simply unreachable.

Proof: `grep` for every `setFieldStatus` caller — `today-page.tsx` (the lead's cards and banner)
and `closeout.tsx` (leave, done) only; the `myDay` filter.

Options: list a ticket on My tickets for its crew too (a card marked "with <lead>", its buttons
clocking the viewer's own clock), or state that the lead's clock is the crew's and remove the
server's crew path. Either is a design choice, so no change was made.

## Behaviour notes (not changed)

- A clock press on an **Open** ticket used to move it to **Scheduled** even with no date (T14: C became
  Scheduled with no day, and a "Ticket #…" follow-up opened for the technician on that stage
  change). The owner: "opening a ticket clock shouldn't set it to scheduled as it isn't scheduled" —
  FIXED, see part 2.
- The banner's minutes tick every 30 s, so the label can lag up to 30 s; the cards never re-render
  for it (the Oct 28 change). Proved: "0 m" at 70 s after a move, "1 m" by 95 s.
- A ticket that is overdue or already started (any `field_status`) is in Today whatever its date;
  the Coming up group never holds a started ticket.
- The card's date line is left out when the ticket is today's and has no arrival window (the
  heading already says the day); it shows "Today · Morning 8–10" when there is a window.
- The maps link searches the typed site address, else the site name and customer; with neither it
  is not shown.
- `myDay` reads at most 100 tickets; nobody is near that.
- Outside this page: a technician-only user can read every technician's time entries and every
  ticket's timeline through the API (`service_time_entries_read` and `service_job_events_read` are
  `has_access('service')`); no screen shows them those rows. Mentioned for the owner's information,
  not a My tickets matter.

## Temporary rows and clean-up

Made by SQL (never through the app, so no notices): one account, one site (with technician
instructions), one contact (with a mobile), one warranty in force, four tickets assigned to the test
login. The run wrote 23 timeline rows, 3 time entries, 1 crew row, 1 follow-up and, for a while,
one clock row. All of it was deleted and verified at zero afterwards: tickets, their cascaded rows,
the follow-up, the warranty, the contact, the site, the account; `service_tech_clock` empty; the
test login's profile back to admin with no pages and Technician ticked. The audit log keeps its
rows about those temporary records (61), as it does for everything; they name only "Claude temp …".
No existing ticket, bid or customer was touched; nobody received a notification. The browser's
saved sign-in was deleted after the run.

## How to repeat

The browser scripts (`pw-login.cjs`, `pw-t.cjs` with steps `look`, `travel`, `undo`, `move`,
`banner`, `complete`, `open`, `links`, `empty`, `tech`, `reset`) and the screenshots
(`shot-21` … `shot-28`) live in the session scratchpad, outside the repository; they need a signed-in
test login, the dev server on `127.0.0.1:4173`, and four tickets of that login's own numbered as
above. The SQL proofs are plain `select`s under `set local role authenticated` with the user's
`request.jwt.claims`, read-only.

## Part 2 — the fixes (Nov 2, afternoon)

The owner: "fix 1 test and prove. isnt 2 and 3 expected behavior? opening a ticket clock shouldnt
set it to scheduled as it isnt scheduled. fix this and prove it." Findings 2 and 3 stay as they are.

### Fix 1 — history at a property counts only what has happened

Migration `supabase/migrations/20261102170000_site_history_past_only.sql`, applied to the live
database the same afternoon. One new rule, `ticket_is_history(stage, scheduled_date)`: a ticket is
history unless it is still Open / Scheduled and booked for today or later, or not yet given a day.
A finished ticket always counts; an Open one whose day has passed counts too. "Today" is the
office's day (Eastern), the day the server stamps field actions with. `site_history` (the fold's
list) and `site_history_summary` (the strip: count, photo count, last) keep their bodies and gain the
rule on every read of the site's other tickets. The strip's wording ("earlier ticket(s)") is
unchanged and now true.

Proof, on a temporary site of the test login's with five temporary tickets (deleted after): H1 Done
Oct 20, H2 booked Nov 5, H3 Open with no date, H4 Open and due Oct 30, H5 booked today.

| Read                                                | Before the fix                                             | After the fix                                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the strip from H2 (`site_history_summary`)          | count 4, "last" = H3 (Open, no date)                       | count 2, "last" = H4 (Oct 30)                                                                                                                             |
| the fold from H2 (`site_history`)                   | H1, H3, H4, H5                                             | H1, H4                                                                                                                                                    |
| the strip from H1                                   | count 4                                                    | count 1 (H4)                                                                                                                                              |
| the strip from H3                                   | —                                                          | count 2 (H1, H4)                                                                                                                                          |
| `ticket_is_history` itself                          | —                                                          | done Oct 20 true · open Oct 30 true · open today false · scheduled Nov 5 false · open undated false · done undated true · invoiced with a future day true |
| the live ticket #6031 (the only live scheduled one) | its property has no other ticket: count 0 before and after |                                                                                                                                                           |
| in the browser, card H2 on My tickets               | —                                                          | "History here: 2 earlier tickets, last Oct 30 (Claude temp H4 …)"                                                                                         |

### Fix 2 — a clock press leaves an Open ticket Open

`src/lib/service-field.functions.ts` `setFieldStatus`: the Start travel (`en_route`) and On site
(`on_site`) patches no longer carry `stage: job.stage === "open" ? "scheduled" : job.stage`; they
stamp `field_status` and the time only. The stage is the office's. Complete still sets Done; Undo of
a Done ticket still steps it back to Scheduled as before. Nothing else changed.

Proof: in the browser as the test login, On site on a live Open, undated temporary ticket (#6050) —
toast "On site at #6050 …", the card "You are on site here" (it moves into Today, as every started
ticket does), then Leave site under a minute. The database afterwards: `stage open`, `on_site_at`
stamped, timeline rows "on_site" and "left site" and **no stage row** (the stage trigger logs every
change of stage; before the fix the same press on #6046 wrote one, and opened a follow-up). No
follow-up was opened, nobody was notified.

### Tests

`src/lib/my-tickets-nov2-fixes.test.ts` (5 tests): the migration's rule and its presence on all
four reads; Start travel and On site on an Open ticket through the real handler (fake Supabase)
leave `stage open`; the handler's source no longer flips the stage. On the old code all five fail
("expected 'scheduled' to be 'open'", and no migration); on the new code all pass.
`tech-clock-wiring.test.ts` had pinned the old flip ("an Open ticket goes Scheduled on Start travel
(as the old buttons did)"); that one test now pins the new rule.

Delivery chain: prettier, eslint (0), `bunx tsc --noEmit -p .` (0), the full suite 465 files /
5,984 tests green, `bun run build` green.

### Temporary rows and clean-up (part 2)

One account, one site and five tickets of the test login's own, made by SQL, deleted afterwards and
verified at zero; `service_tech_clock` empty; no follow-up, no notification to anyone; the saved
browser sign-in deleted again. No existing ticket, bid or customer was touched.
