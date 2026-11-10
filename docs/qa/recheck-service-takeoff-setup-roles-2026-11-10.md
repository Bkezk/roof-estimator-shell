# Re-check: the October service bugs, the untested takeoff parts, Setup saved for real, and roles (Nov 10, 2026)

Owner, Nov 10: "go ahead and re check the service bugs, test what you can on the takeoff parts,
roles where you can, setup (go ahead and edit and change to test but just put the values back
where they started after your done). do the speed pass as well". The speed pass has its own
record, `docs/qa/speed-pass-2026-11-10.md`. Nothing in the code was changed; the findings wait
for a go-ahead.

## Summary

| Part                     | Result                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. October service bugs  | 8 of 8 fixed, and the 11 design gaps are closed. Three small wording observations.                                                    |
| 2. Takeoff parts         | 12 behaviours tested, all work. One finding (the drawing is small on most iPads held sideways), two observations.                     |
| 3. Setup, saved for real | 7 saves, all landed and all put back. One finding (no record of who changed a rate, the markup or the checklist).                     |
| 4. Roles                 | A manager, a technician and an office user clicked through 29 addresses each. Every closed page stayed closed. One small observation. |

Everything of mine was removed and every setting is back where it started; the two traces left
are listed under "What is left behind" at the end.

## Part 1: the eight bugs of the Oct 6 service audit

The eight confirmed bugs of `docs/qa/service-audit-2026-10-06.md` and its design gaps, checked
against today's code (main `40aeca2`), the live database and, where only a click proves it, the
browser on a temporary ticket (#6068, customer "ZZ Recheck Svc Claude", removed afterwards). The
tests named below are the ones that pin each fix.

### The eight bugs

| #   | Bug (Oct 6)                                                                                           | Verdict | Code today                                                                                                                                                                                                                                                                                                                                                                                            | Test that pins it                                                                                                                                                    | Live proof (Nov 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A price typed by hand on a ticket material line is lost by a markup change and by Rebuild from ticket | FIXED   | "Typed by hand" is a stored flag, not a ratio: the editor sets `rate_overridden` on a rate edit (`invoice-editor.tsx:690`), `applyMarkup` skips flagged lines (`invoice-materials.ts:257`), the save writes the client's flag (`invoices.functions.ts:735`, `savedLineRow`), Rebuild keeps flagged lines (`invoice-rebuild.ts:61-85`)                                                                 | `invoice-typed-price.test.ts` (the Oct 6 repro, "a markup change (75 → 50 %) leaves the typed price alone", "Rebuild from ticket keeps the typed rate and its cost") | Browser, draft invoice on #6068: Acetone built at $31.40 (cost 17.94 + 75 %). Typed $40. Markup 75 → 50: Acetone stays 40, the ISO line re-prices 33.04 → 28.32. Autosaved, reloaded: still 40. Markup back to 75: 40, ISO 33.04. Rebuild from ticket ("Rebuilt from the ticket: 2 lines"): still 40. Stored row: `rate 40, cost_rate 22.8535, rate_overridden true`. The Oct 6 inputs through today's functions: flagged line stays 20, an unflagged one goes to 15. All 13 checks of the browser run passed (this bug, bug 2 and bug 5 together). |
| 2   | ISO board lines read "0.031 boards per sq ft" and "2 board"                                           | FIXED   | `packNote` turns a piece bigger than the stock unit round: "32 sq ft per board" (`invoice-materials.ts:142-149`); "board" is in `PIECE_NAMES`, so `unitText` says "boards" (`:156-178`); used by the invoice preview (`invoice-editor.tsx:2054`) and the PDF (`invoices.server.ts:648`)                                                                                                               | `iso-board-sizes.test.ts` ("64 sq ft of 1\" ISO 4'x8' bills as 2 boards — 32 sq ft per board", the 4'x4' twin)                                                       | Browser, same invoice: 64 sq ft of 1" ISO on the ticket's ledger built the line `ISO Insulation 1" 4'x8' — 32 sq ft per board`, qty 2, unit board, rate 33.04, cost 18.88. Today's function on the Oct 6 input: the same text, shown unit "2 boards".                                                                                                                                                                                                                                                                                               |
| 3   | A technician can edit an Authorized ticket and move Authorized / Invoiced / Closed tickets backwards  | FIXED   | `stageProblem` takes the ticket's current stage and refuses any non-manager move out of an office stage (`ticket-stage.ts:83-95`); `setServiceStage` passes it (`service.functions.ts:763`); `saveServiceJob` refuses a technician's edit (`TECH_LOCKED_MESSAGE`). Database: migration `20261006190000_stage_backwards_lock.sql`                                                                      | `stage-backwards-lock.test.ts` (11 tests: the rule, both server functions, the trigger, the policy)                                                                  | Live trigger `service_jobs_stage_rule` has the "Out of them (owner, Oct 6)" branch. Live policy `service_jobs_update` checks the stage on the old row (USING) and the new one. Probed as Tyler (technician, Service only) on the temp ticket given to him inside a rolled-back block: edit notes on Authorized → 0 rows; Authorized → Done → 0 rows; Closed → Open → 0 rows; Done → Authorized → `42501 Only a manager authorizes, invoices or closes a ticket`. Controls: notes at Done → 1 row, Done → Scheduled → 1 row.                         |
| 4   | Dispatching to a technician who cannot see the ticket                                                 | FIXED   | The roster lists only people who can read tickets (migration `20261006191000_dispatch_service_access.sql`); Admin › Users warns "Technician without Service access — cannot see tickets" with a one-click fix (`dispatch-access.ts`, `admin.users.tsx:461`)                                                                                                                                           | `dispatch-service-access.test.ts` (10 tests)                                                                                                                         | Live `technician_options()` carries `and (p.role in ('admin','manager') or 'service' = any(p.access))`. Profiles ticked Technician without Service access: 0 (was 3). Open or Scheduled tickets on someone who cannot see them: 0. Browser: the New ticket picker offered Unassigned plus the 8 people of the roster, each of whom can read tickets.                                                                                                                                                                                                |
| 5   | History shows "stage changed at" on every stage move                                                  | FIXED   | Migration `20261006200000_audit_ticket_readable.sql` adds `stage_changed_at` to `audit_row()`'s skip list                                                                                                                                                                                                                                                                                             | `audit-ticket-readable.test.ts` ("skips stage_changed_at …"), `ticket-audit.test.ts:48-52`                                                                           | Live `audit_row()` skip list contains `stage_changed_at`. Audit rows saying "stage changed at": 2, both dated Oct 6 (written before the fix); 71 stage moves logged since Oct 7 carry none. Browser, #6068's History: "system · Ticket 6068 stage 'scheduled' → 'authorized'" and nothing else on that line.                                                                                                                                                                                                                                        |
| 6   | "Needs authorization" goes to one arbitrary admin when no authorizer is set                           | FIXED   | `ticket_authorizers()` is ordered: the set authorizer, else Brandon, then every other admin and manager by `created_at, id` (migrations `20261006210000_default_authorizer.sql`, `20261012170000_managers_authorize.sql:52`); the follow-up goes to the first (`ticket-events.server.ts:168-179`)                                                                                                     | `default-authorizer.test.ts`, `ticket-authorizer.test.ts`, `managers-authorize.test.ts`                                                                              | Live function body ends `order by rank, created_at, id`. Called live: Brandon Keck → Braden Keck → RoAnna Sims → Garry Peters → Claude. Setup's authorizer is set (Brandon Keck), so the fallback is not in play today.                                                                                                                                                                                                                                                                                                                             |
| 7   | Properties rename leftovers (4 places)                                                                | FIXED   | Customers page and the site picker say "Add property" (`customers-page.tsx:1858`, `site-select.tsx:106`); county codes read "for each property, picked on the property" (`county-codes-settings.tsx:168`); customer History lines say "Property '…'" (migration `20261006201000_audit_property_children.sql`)                                                                                         | none found for the two button labels; the History wording is in `audit-ticket-readable.test.ts`                                                                      | Live `audit_row()`: "Property '" 3 times, "Site '" 0 times. Three old History rows (Oct 2 to Oct 6) still begin "Site '…'"; History is not rewritten. The one "Add site" left (`site-form.tsx:394`) adds a named site inside a property, which is the right word there. See observation A.                                                                                                                                                                                                                                                          |
| 8   | Wording after the Authorized stage (4 places)                                                         | FIXED   | A void says "… back to Authorized — its invoice was voided by …" (`ticket-events.server.ts:148-160`); the authorizer's notice is "… — ready for your review" (`followups.server.ts:139-144`); a technician on an Authorized ticket reads "The office is reviewing this ticket — it is Authorized" (`office-stage-message.ts`); `location_id` shows the inner site's name (migration `20261006200000`) | `authorized-wording.test.ts` (7 tests), `audit-ticket-readable.test.ts:82-99`                                                                                        | Live notices: 3 titled "… back to Authorized — its invoice was voided by …", 53 "… ready for your review", 0 titled "To invoice assigned to you: Authorize …", 0 "authorized — ready to invoice" whose body speaks of a void. Live `audit_col_name('location_id')` = "location"; `audit_label('service_jobs','location_id', <an inner site's id>)` returns the site's name, not the id. Not clicked: a void and a Done would notify the real office, and the technician's line needs a technician login.                                            |

Result: 8 of 8 fixed. Nothing of the eight is still broken.

### The design gaps of Oct 6

| Gap                                                          | Today                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorized is not "open work"                                | Closed. `OPEN_TICKET_STAGES` is open / scheduled / done / authorized (`crm-account.ts:453`, `work-counts.ts:62`), so a customer with an Authorized ticket cannot be deleted; Work Overview lists Authorized under To invoice (`authorized-open-work.test.ts`).                                                                                     |
| The authorizer sees a Done ticket twice                      | Closed Nov 2 (Work Overview audit, fix 1; `authorizer-once.test.ts`).                                                                                                                                                                                                                                                                              |
| Pre-Oct 5 drafts skip Authorized                             | Closed. Finalising asks `finalizeStageProblem` too (`invoices.functions.ts:176, 207`; `invoice-finalize-authorized.test.ts`). Live: 0 invoices exist today.                                                                                                                                                                                        |
| Material corrections are UI-gated only                       | Closed. `addMovement` checks `fieldEditProblem` against the ticket's stage (`inventory.functions.ts:462`) and writes a Timeline row (`:592`).                                                                                                                                                                                                      |
| Time and repairs have no server stage lock                   | Closed. `fieldEditProblem` in `service-field.functions.ts:179`; the database twin `ticket_open_for_tech()` is on the write policies of time entries, repairs, photos and photo items. Probed as Tyler (rolled back): a time entry on the Authorized temp ticket → `42501 new row violates row-level security policy`; the same at Done → inserted. |
| No audit trail for named sites and warranties                | Closed. Live triggers `property_sites_audit` and `site_warranties_audit`.                                                                                                                                                                                                                                                                          |
| Renaming an inner site does not refresh the ticket           | Closed. `property-sites.functions.ts:128-134` renames it on the live tickets (`site-rename-refresh.test.ts`).                                                                                                                                                                                                                                      |
| Repair tags stored but unused                                | Closed. The price-free view has `tags`; the close-out's repair picker filters by tag (`closeout.tsx:1676`, `repair-tags.ts`).                                                                                                                                                                                                                      |
| Mentions roster leaves out Customers-only users              | Closed. `mention_options()` is live; `canBeMentioned` = Service or Customers access (`dispatch-access.ts`).                                                                                                                                                                                                                                        |
| "Add material at the top" sorts to the bottom after the save | Closed. `newMaterialSort` (`service-materials.functions.ts:81`, `material-add-top.test.ts`).                                                                                                                                                                                                                                                       |
| Close-out routes on the Technician tick                      | Closed. `closeout.tsx:346` decides by `isOffice(profile)`, so an admin ticked Technician is office.                                                                                                                                                                                                                                                |

### Observations (new, small, nothing changed)

- A. A ticket's own History still calls the property a site: "account …; site …; site name '…';
  site address '…'" on #6068's created line. The Oct 6 list named four places and all four are
  right now; this is a fifth of the same kind (`audit_col_name` gives `site_id` → "site").
- B. A property's History shows a storage path when the aerial sets the cover photo:
  "cover photo path — → 'sites/<id>/a…'" (27 rows since Nov 2). Readable, but not words a person
  would use.
- C. The roster filter of bug 4 cannot be seen at work in today's data, because nobody is ticked
  Technician without Service access any more. The proof is the function's text and the two zero
  counts.

### How the temporary ticket was made, and what it touched

- Customer and ticket #6068 through the pages (Claude as the technician). The stage was set to
  Authorized by SQL, so nobody was told: 0 notices name #6068.
- Materials by SQL as two used rows on the ticket (1 Acetone, 64 sq ft of 1" ISO), each with an
  equal row the other way at the shop, so the shop's stock read the same throughout.
- The markup was changed on the temp invoice only. Setup's markup stayed 75 % (checked).
- The two role probes ran inside blocks that end in an error on purpose, so they rolled back:
  after them the ticket was still Authorized, on Claude, notes empty.
- The write guard refused three things the pages tried on their own (a follow-up refresh, the
  aerial cover lookup, a documents read): nothing of mine.

### Cleanup proof

Deleted by SQL: 2 invoice lines, 1 draft invoice (no PDF was made), 4 stock rows, 2 timeline
events, 1 crew row, 1 follow-up (it was on Claude), 1 ticket, 1 contact, 1 property, 1 customer,
then the 24 History rows naming any of them. No file was written to storage.

A sweep over all 644 uuid, text, json and array columns of `public` and `storage`, for the six
ids and the temp names, found 0 rows. Counts after: 636 live customers (as before), 48 tickets,
0 invoices, 36 stock rows (as before).

## Part 2: the takeoff parts the Nov 10 audit left untested

Two temporary takeoffs of my own ("ZZ Recheck Takeoff" from the three-sheet test plan, "ZZ
Recheck Aerial" from a satellite picture), driven in the browser as the test login. Writes were
allowed only to the takeoff functions and to files under those two ids.

| #   | What was tested                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deficiency pins                                  | Penetrations, then the Deficiency chip: two red numbered pins. One click selects a pin and shows its card (number, View, Role, Quantity, the note box "what is wrong here — shown to the customer", Pictures, Add pictures).                                                                                                                                                                                                                    |
| 2   | Pictures on a deficiency                         | The picker takes pictures only (`accept="image/*"`, no forced camera, several at once). A 1280 x 1280 JPG (317,710 bytes) and a 1000 x 700 PNG (3,725 bytes) went up; the bucket holds them at the same byte size under `<takeoff>/photos/`, so nothing was shrunk. The row reads "#1 · 2 pictures". A PDF given to the picker: "Pick picture files (JPG, PNG, HEIC…)", nothing uploaded.                                                       |
| 3   | Showing the customer                             | View opens the full-screen view: "Deficiency 1 of 2", "1 / 2", the note, the picture at its full 1280 x 1280. The right arrow key goes to "2 / 2"; Next deficiency goes to "Deficiency 2 of 2 · No pictures on this deficiency yet. No note." No dollar sign anywhere in it. Esc closes. A second click on a selected pin opens it, and so does a double-click.                                                                                 |
| 4   | Taking a picture off                             | Remove picture 2: the card reads "Pictures (1)" and the PNG is gone from the bucket (read from `storage.objects`).                                                                                                                                                                                                                                                                                                                              |
| 5   | The marked-up PDF                                | "Exported “ZZ Recheck Takeoff – takeoff.pdf”: 1 marked-up sheet, 2 deficiencies with pictures and the summary." Three pages: the sheet with the markup, a Deficiencies page with the note and the picture embedded at 1280 x 1280, and the summary (roof area 5,000 sq ft, perimeter 300 ft, deficiencies 2).                                                                                                                                   |
| 6   | Delete and restore                               | Delete asks first ("… move to Recently deleted, where you can restore them for 30 days. After that they are removed for good."), then "Takeoff moved to Recently deleted (kept 30 days)". Gone from the list; the bin row reads "Deleted 11/10/2026 · 30 days left". Opened by its link while deleted: "This takeoff was not found (it may have been deleted)." Restore: "Takeoff restored", listed again, the drawing and its picture intact.  |
| 7   | Drawing with a finger (iPad Pro 11, emulated)    | Touch pointer events on a 1194 x 834 screen. Toolbar buttons are 44 px high. Area, four taps: the bar shows "Undo point · Cancel" after one point and "Close · Undo point · Cancel" after three. Undo point, the fourth tap again, Close: 3,333 sq ft, perimeter 266.7 ft, sides 100 and 33.3 ft, which is exact for the 900 x 300 px rectangle at 1/8" = 1'-0".                                                                                |
| 8   | Pinch and pan                                    | Two fingers moving apart: 15 % to 46 %. One finger dragged with Select: the drawing moved 80 px each way, no point placed.                                                                                                                                                                                                                                                                                                                      |
| 9   | "Pencil draws"                                   | With it on, a finger tap with Linear placed nothing. A pen pointer (the browser's pen type) placed two points, the bar read "Finish · Undo point · Cancel", and Finish made one linear.                                                                                                                                                                                                                                                         |
| 10  | Satellite picture, Kentucky                      | Typed a point (36.9757, -84.1091): answered in 3.3 s, "Imagery © Commonwealth of Kentucky (KyFromAbove)", 16 tiles. Use this picture: the takeoff opens with "Scale: aerial imagery, zoom 19 · 0.78 ft/px". Stored: 200 px = 156.5187 ft, 0.782593 ft/px. My own sum for that latitude and zoom (156543.03392 × cos 36.9757° ÷ 2^19 ÷ 0.3048) is 0.78259 ft/px. They agree.                                                                     |
| 11  | Satellite picture, Tennessee                     | Typed a point in Nashville: answered in 3.3 s, "Imagery © TDOT Aerial Surveys", 12 tiles. Not made into a takeoff.                                                                                                                                                                                                                                                                                                                              |
| 12  | PlanSwift import, from the file to the estimator | The Activity & Fitness Center-shaped sheet (5 rows). The review lists 8 rows (the compound downspout row split in four); three need a pick and Create bid stays off until they have one. After the picks: the estimator opens on a new bid, "Bid started from PlanSwift: 2 sections…", with Sections (2), Underlayment (1), Parapets (1), Metals (4) and a notice of what to check. "Unsaved changes" shows and nothing was written (0 writes). |

### Findings

1. **On most iPads held sideways the drawing gets a small corner of the screen.** The editor
   opens in Focus only under 1,100 px wide (`NARROW_PX`, `src/components/takeoff/touch.ts`). An
   iPad Air (1,180), an iPad Pro 11 (1,194) and an iPad Pro 12.9 (1,366) are wider than that
   when held sideways, so the menu, the Pages list and the side panel all stay open and the
   toolbar wraps onto four lines. On the 1,194 x 834 screen the drawing was 396 x 264 px and
   opened at 15 %. Focus fixes it in one tap, but nothing says so. The older iPad (1,080)
   opens in Focus on its own.
2. Observation: a PlanSwift row named "T-Bar" (a length) has no home of its own in the "goes
   to" list, so it needs Place by hand or Skip every time.
3. Observation: the section from PlanSwift is seeded as a square of the same area rounded to
   two decimals (139.37 sq ft became 11.81 x 11.81 = 139.48). The same rounding was noted in
   the takeoff audit.

### Still not tested

- A real iPad and a real Apple Pencil. The emulation sends the same pointer events, but not
  Safari's own behaviour (palm rejection, the rubber-band scroll, the on-screen keyboard).
- A HEIC picture straight from an iPhone camera roll.

### Cleanup

The three files were removed from the bucket through the Storage API as the test login, then
the two rows by SQL. After: 0 takeoffs with a "ZZ" name, 0 files under the two ids, 12 takeoffs
in all as before.

## Part 3: Setup, saved for real and put back

The Nov 6 audit read every save on the wire and refused it. This time each save went through,
was read back from the database as the test login, and was put back at once through the page.
A snapshot of the 12 rates, the settings row and the 11 checklist rows was taken first.

| #   | Save                                | What the database held after                                                                                                                                  | Put back                                                                                        |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | A rate (Urgent Helper Travel bill)  | 40 → 41. "Service rates saved". Save turned off, no "Unsaved changes".                                                                                        | Typed 40, Save: 40 again.                                                                       |
| 2   | The email subject                   | "Invoice #{number} ZZ", in the same save.                                                                                                                     | Typed the first subject, Save.                                                                  |
| 3   | The authorizer                      | Brandon → "Admins and managers" (`authorizer_id` null), in the same save.                                                                                     | Picked Brandon, Save: his id again. A reload showed 40, Brandon, the subject.                   |
| 4   | "These rates are confirmed"         | "Rates confirmed". The CenterPoint note went away and the line read "Rates confirmed Nov 10, 2026 by Claude." `rates_confirmed_at` and the name were stamped. | By SQL (the page has no way back): both set to empty again, so the note is back for the office. |
| 5   | The material markup                 | 75 → 76: "Material pricing saved", `material_markup` 0.76, and the first material went from "bills at $95.11" to "$95.66" (54.35 × 1.76).                     | Typed 75, Save: 0.75.                                                                           |
| 6   | The checklist: a row moved          | Seams and Perimeter flashings swapped; "Inspection checklist saved"; the database in the new order.                                                           | Moved back, Save.                                                                               |
| 7   | The checklist: a row added, removed | "ZZ recheck item" saved as row 12. Removing it asks first ("New inspections will not ask about it. Inspections already done keep their answers.").            | Removed, Save: the 11 rows in their first order.                                                |

Seven saves were sent (three for the rates and the confirm, two for the markup, two for the
checklist). No page error.

### After the restore

Read from the database and compared with the snapshot: the 12 rates, the subject, the message,
the terms, the tax, the markup, the authorizer, the empty confirm stamp, the settings row's
saved-on date, the rates' saved-on dates and the checklist's 11 labels, order and sort numbers
(10, 20, 30, 40, 45, 50 … 100) are all as they started. One trace is left: the 11 checklist
rows' own changed-on date reads Nov 10, because the database stamps it on every update. No page
shows that date.

### Finding

4. **A change on Setup leaves no record of who made it.** None of the seven saves wrote a
   History row (`audit_log` held 3,416 rows before and after). A rate, the markup, the
   authorizer or the checklist can change and only a saved-on date moves; the old value and the
   person are not kept. Tickets, customers and invoices all keep that.

## Part 4: roles, clicked through in the browser

The earlier audits proved the rules for a manager, a technician and an office user at the
database. This time the pages were clicked. The test login's own profile was set by SQL to one
kind of user at a time (the three kinds the real users have), signed in fresh, sent to 29
addresses, and then set back to admin. Every write from the browser was refused except the ones
named below.

| Address                                                                        | Manager               | Office user (Estimate, Pricing, Customers, Service, Invoices, Prospecting, Takeoff; ticked Technician) | Technician (Service only)                      |
| ------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Lands on after signing in                                                      | Work Overview         | Work Overview                                                                                          | My tickets                                     |
| Items in the menu                                                              | 17                    | 16                                                                                                     | 3 (My tickets, Inventory, My account)          |
| Work Overview                                                                  | opens                 | opens                                                                                                  | sent to My tickets                             |
| Service list, Tech Board, Invoices                                             | open                  | open                                                                                                   | sent to My tickets                             |
| My tickets                                                                     | opens                 | opens                                                                                                  | opens                                          |
| Customers, one customer's page                                                 | open                  | open                                                                                                   | sent to My tickets                             |
| Opportunities                                                                  | opens                 | opens                                                                                                  | opens: "No opportunities are assigned to you." |
| Project Bids, Estimator, Takeoffs                                              | open                  | open                                                                                                   | sent to My tickets                             |
| Roofs & Storms, Bid Board                                                      | open                  | open                                                                                                   | sent to My tickets                             |
| Inventory                                                                      | opens                 | opens                                                                                                  | opens, with no dollar amount on it             |
| Setup                                                                          | opens                 | sent to Work Overview                                                                                  | sent to My tickets                             |
| Estimate Pricing pages (General, Advanced Labor, Duro-Last, Price List Import) | open                  | open                                                                                                   | sent to My tickets                             |
| Document templates (Admin)                                                     | opens                 | sent to Work Overview                                                                                  | sent to My tickets                             |
| Owner                                                                          | sent to Work Overview | sent to Work Overview                                                                                  | sent to My tickets                             |
| Users & access                                                                 | sent to Work Overview | sent to Work Overview                                                                                  | sent to My tickets                             |
| Reminders                                                                      | sent to Work Overview | sent to Work Overview                                                                                  | sent to My tickets                             |
| CenterPoint import                                                             | sent to Work Overview | sent to Work Overview                                                                                  | sent to My tickets                             |
| Notifications, My account                                                      | open                  | open                                                                                                   | open                                           |

More, per kind of user:

- **Manager, saving on Setup through the page.** A rate (40 → 41 → 40): "Service rates saved"
  both times. The markup (75 → 76 → 75): "Material pricing saved" both times. The checklist (a
  row moved): "Inspection checklist saved". A manager may save the checklist because a manager
  holds every page, Estimate Pricing included (`src/lib/access.ts`). The order was put back by
  SQL straight after.
- **Technician, someone else's ticket by its link:** "Could not open the ticket: Ticket not
  found". My tickets read "Nothing open for you. Check with the office for your next ticket."
- **Technician and office user, a new template.** Both can reach the blank template editor by
  its address. Save answers "Could not save the template: Templates, saved snippets and the PDF
  library are a manager's" and nothing is written (0 templates with a "ZZ" name afterwards).
- No page error in any of the runs.

### Observation

5. The Documents page and the blank new-template editor open for a technician and for an office
   user, who can do nothing there: the landing card offers "Manage Templates", which sends them
   straight back to their home page, and the editor lets them type and only says it is a
   manager's at Save. Nothing leaks and nothing is written. A plain line saying templates are a
   manager's, or keeping them off the page, would be tidier.

### Not tested

- A customer-only or an invoices-only office user (no real user is set up that way today).
- A manager ticked Technician on a phone.
- The real users' own logins. These runs used the test login with its profile changed.

## What is left behind

- The 11 checklist rows' changed-on date reads Nov 10. The database stamps it on any update. The
  labels, the order and the sort numbers are as they started, and no page shows that date.
- The test login's own changed-on date reads Nov 10, for the same reason. It is an admin, ticked
  Technician, with no page list, as before.

Checked at the end, read from the database: 0 takeoffs, bids, customers, tickets or templates
with a "ZZ" name; 0 files under the temporary takeoffs' ids; the 12 rates, the markup (75 %),
the authorizer, the subject, the empty confirm stamp and the 11 checklist rows equal to the
snapshot; `audit_log` 3,416 rows before and after; 3 admins, 2 managers and 3 users as before.
