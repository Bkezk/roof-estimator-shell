# Speed pass on the live site (Nov 10, 2026)

Owner, Nov 10: "do the speed pass as well." Measured, nothing fixed. No code was changed and no
data was written.

## What was measured, and how far to trust it

- **The build.** `https://jbkbid.lovable.app`, deployment stamped commit `40aeca2` (the page's own
  `data-commit-sha`), which is `main` today. Its documents chunk holds "Save page as snippet" and
  `delete-page`, so the live site is not behind. The local build of the same commit has the same
  file names, so file sizes below are read from it.
- **The login.** The test login (an admin). The session was kept in memory only.
- **The guard.** Every request that could write was paused and judged before it left the browser.
  Reads went through; every write was refused and counted (the list is at the end). After the
  runs: 0 audit rows, 0 notifications and 0 reminders were made in the window (checked by SQL).
- **Three runs each, the median reported.** 21 pages, cold (new browser, empty cache), warm (the
  same page again) and by the menu from another page.
- **One limit that matters.** This test machine reaches the internet through a relay that speaks
  the old one-file-per-connection protocol (HTTP/1.1, 71 connections for 71 files). A real browser
  uses HTTP/2 and pulls many small files at once. So the **cold** times below are too high, by my
  estimate two to four times. Everything else stands: file counts, bytes, warm loads, in-app
  navigation, each call timed on its own, the typing and scrolling numbers, and every database
  number. One static file from the site takes 135 ms here (median of 10); a server call that does
  almost nothing takes 177 ms. So about 135 ms of every call below is this machine's round trip.

## Pages

Seconds until the page's data had arrived. "Files" and "KB" are over the wire.

| Page                         | Cold (too high, see above) | Warm     | From the menu | Files cold | KB cold | KB warm | Elements on the page |
| ---------------------------- | -------------------------- | -------- | ------------- | ---------- | ------- | ------- | -------------------- |
| `/` (sends to Work Overview) | 8.3                        | 1.7      | n/a           | 114        | 609     | 105     | 964                  |
| Work Overview                | 7.2                        | 2.9      | 0.6           | 114        | 609     | 105     | 964                  |
| Service list                 | 7.1                        | 1.5      | n/a           | 170        | 816     | 110     | 839                  |
| Tech Board                   | 7.1                        | 1.3      | 0.6           | 172        | 818     | 104     | 896                  |
| My tickets                   | 9.1                        | 2.1      | 0.5           | 169        | 812     | 101     | 507                  |
| Invoices                     | 6.4                        | 1.3      | n/a           | 173        | 820     | 103     | 589                  |
| One ticket (31 pictures)     | 11.2                       | 2.9      | n/a           | 218        | 1,483   | 777     | 1,777                |
| Project Bids                 | 5.8                        | 1.9      | 0.4           | 121        | 687     | 105     | 1,706                |
| Estimator, no bid open       | 8.8                        | 1.9      | n/a           | 159        | 1,047   | 227     | 1,530                |
| Customers list               | 8.0                        | 1.5      | 0.7           | 128        | 697     | 154     | 22,398               |
| One customer                 | 6.3                        | 3.0      | n/a           | 176        | 656     | 113     | 1,579                |
| Opportunities                | 7.0                        | 1.0      | 0.4           | 131        | 640     | 100     | 469                  |
| Takeoffs list                | 6.1                        | 2.0      | 0.6           | 132        | 723     | 107     | 561                  |
| Documents (landing card)     | 5.3                        | 2.5      | n/a           | 129        | 784     | 98      | 454                  |
| Inventory                    | 6.2                        | 2.6      | 1.2           | 109        | 622     | 147     | 906                  |
| Setup                        | 7.8                        | 1.1      | 0.3           | 107        | 579     | 100     | 692                  |
| Owner                        | 4.0                        | 1.3      | 0.6           | 93         | 660     | 99      | 611                  |
| Notifications                | 3.6                        | 1.3      | 1.6           | 82         | 523     | 99      | 470                  |
| **Roofs & Storms**           | **27.7**                   | **22.4** | **20.4**      | 136        | 1,362   | 207     | 7,910                |
| Bid Board                    | 8.4                        | 1.2      | 0.6           | 93         | 586     | 133     | 1,497                |

- First paint is quick everywhere: 0.4 to 0.7 s cold, 0.2 to 0.4 s warm. The wait is for the
  scripts and then the data.
- `/followups` shows Work Overview and measures the same.
- "n/a": the menu has no link with that exact address (or the page needs an id).
- Main-thread stalls over 50 ms during load at full CPU speed: none on 15 pages, one of 59 to 114
  ms on Bids, the ticket, one customer and the estimator, three (249 ms together) on the
  Customers list, three (162 ms) on Roofs & Storms.

### What each page asks the server for

Every page first makes the same six or seven calls for the frame around it: the profile three or
four times, the bell twice (count, list), the theme. Then its own:

| Page           | Own calls                | In how many rounds | Its slowest call, timed alone |
| -------------- | ------------------------ | ------------------ | ----------------------------- |
| Work Overview  | 2 (the list, twice)      | 2                  | 394 ms                        |
| Service list   | 4                        | 2                  | 237 ms                        |
| Tech Board     | 3                        | 2                  | 230 ms                        |
| My tickets     | 2                        | 1                  | 220 ms                        |
| Invoices       | 3                        | 1                  | 244 ms                        |
| One ticket     | 21                       | 4                  | 497 ms (the ticket bundle)    |
| Project Bids   | 3                        | 1                  | 299 ms                        |
| Estimator      | 10                       | 1                  | 520 ms (508 KB of catalog)    |
| Customers list | 2                        | 1                  | 507 ms (400 KB list)          |
| One customer   | 10 plus one per property | 2                  | 318 ms                        |
| Inventory      | 8                        | 2                  | 768 ms (stock on hand)        |
| Owner          | 1                        | 1                  | 570 ms                        |
| Roofs & Storms | 6                        | 2                  | 20.8 s (the county list)      |
| Bid Board      | 2                        | 1                  | 316 ms                        |

### Each read call, timed one at a time

74 read calls, five times each, one after another (so nothing queues):

- The middle call takes 220 ms. 49 of 74 are under 250 ms, 20 are 250 to 400 ms, 5 are over.
- Taking off the 135 ms round trip, a typical call is about 85 ms of server work.

| Call                            | Median                                          | Server's share | Answer size (unpacked) |
| ------------------------------- | ----------------------------------------------- | -------------- | ---------------------- |
| Roofs & Storms county list      | 20.8 s in the page; 8.2 s in the database alone | nearly all     | 5 KB                   |
| Inventory stock on hand         | 768 ms                                          | 633 ms         | 5 KB                   |
| Owner view                      | 570 ms                                          | 435 ms         | 4 KB                   |
| Estimator catalog (engine data) | 520 ms                                          | 385 ms         | 508 KB                 |
| Customers list                  | 507 ms                                          | 372 ms         | 400 KB                 |
| Ticket bundle                   | 497 ms                                          | 362 ms         | 88 KB                  |
| Work Overview list              | 350 to 394 ms                                   | 215 to 259 ms  | 6 to 14 KB             |
| Roofs & Storms building list    | 385 ms                                          | 250 ms         | 1,223 KB               |
| Inventory item-number keys      | 381 ms                                          | 246 ms         | 84 KB                  |
| One customer                    | 318 ms                                          | 183 ms         | 31 KB                  |
| Project Bids list               | 299 ms                                          | 164 ms         | 21 KB (33 bids)        |

Calls made twice for the same data on one page: the profile (three or four times, every page),
the Work Overview list (twice for an admin or a manager), the customer's contacts on a customer's
page (twice) and the service defaults on Inventory (twice).

## The files (bundle)

| What                               | Number                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Script files in the build          | 242 (7.5 MB, 2.2 MB packed)                                                               |
| Of those under 1 KB                | 100 (69 are single icons)                                                                 |
| The sign-in page asks for          | 56 script files, 277 KB packed                                                            |
| A page's cold load                 | 69 to 158 script files, 386 to 783 KB                                                     |
| Of those under 1 KB on a cold page | 29 to 76                                                                                  |
| Styles                             | 154 KB, 25 KB packed                                                                      |
| Caching of `/assets/*`             | one year, immutable (good); gzip                                                          |
| The logo `jbk-logo.webp`           | 88 KB, 2000 x 1125, shown 180 wide, **no cache header, fetched again on every page load** |

Each route's own chunk (packed): Work Overview 12 KB, Service 65 KB, Tech Board 6 KB, My tickets
4 KB, Invoices 7 KB, Bids 29 KB, Estimator 95 KB, Customers 19 KB, Opportunities 11 KB, Takeoff
58 KB, Documents 168 KB, Inventory 14 KB, Setup 11 KB, Owner 116 KB, Notifications 6 KB,
Roofs & Storms 15 KB plus the map, Bid Board 9 KB. The frame every page shares: `index` 95 KB,
the database client 55 KB, plus the Service route's head (21 KB) and the picture-markup code
(19 KB) on every page, whether or not the page uses them.

The five biggest chunks:

| Chunk                | Raw            | Packed         | What is in it       | Loaded where                            |
| -------------------- | -------------- | -------------- | ------------------- | --------------------------------------- |
| `prospect-map`       | 1,046 KB       | 279 KB         | the map library     | on demand: Roofs & Storms, map popups   |
| `documents`          | 550 KB         | 168 KB         | the document editor | `/documents`, even for its landing card |
| `maplibre-gl-worker` | 508 KB         | 144 KB         | the map's worker    | with the map                            |
| `pdf` (two copies)   | 488 and 431 KB | 146 and 127 KB | the PDF reader      | on demand (takeoff underlay)            |
| `owner`              | 449 KB         | 116 KB         | the charts library  | Owner page only                         |

Heavy libraries on pages that do not need them: **the Excel library (424 KB, 139 KB packed)
loads with the estimator** at page open (`src/routes/estimate.tsx:134`, a plain import); every
other use of it waits for the button. The map, the PDF reader, the PDF writer and the charts all
load only where used.

## Phone (technician pages)

390 px wide, CPU slowed four times, link set to about 1.6 Mbps down with 150 ms delay. The cold
column carries the same HTTP/1.1 penalty as above, so the last column gives the least the bytes
alone can take at that link speed.

| Page                     | Cold   | Warm  | Warm, main thread stalled         | Bytes cold | Least time for the bytes |
| ------------------------ | ------ | ----- | --------------------------------- | ---------- | ------------------------ |
| My tickets               | 9.5 s  | 3.2 s | 0.06 s                            | 812 KB     | 4.0 s cold, 0.5 s warm   |
| Work Overview            | 8.0 s  | 1.8 s | 0.11 s                            | 609 KB     | 3.0 s cold, 0.5 s warm   |
| Service list             | 10.5 s | 1.7 s | 0.14 s                            | 816 KB     | 4.0 s cold, 0.5 s warm   |
| One ticket (31 pictures) | 12.9 s | 5.3 s | 0.75 s (worst single stall 0.3 s) | 1,483 KB   | 7.2 s cold, 3.8 s warm   |

Of a warm page's 101 to 110 KB, 87 KB is the logo. My tickets was empty for the test login, so
its number is the page's floor, not a full day.

## Under the hand (typing and scrolling)

Time from a keystroke in the list's search box to the next painted frame.

| List              | Elements | First letter | Clear the box | Slowed 4x: first letter | Slowed 4x: clear | Slowed 4x: scrolling       |
| ----------------- | -------- | ------------ | ------------- | ----------------------- | ---------------- | -------------------------- |
| Customers (636)   | 22,398   | 70 ms        | 268 ms        | 420 ms                  | 1,006 ms         | 14 of 90 frames over 50 ms |
| Project Bids (33) | 1,706    | 22 ms        | 51 ms         | 83 ms                   | 270 ms           | smooth                     |
| Bid Board         | 1,497    | 15 ms        | 22 ms         | 114 ms                  | 152 ms           | smooth                     |
| Inventory         | 906      | 31 ms        | 13 ms         | 36 ms                   | 59 ms            | n/a (fits the screen)      |

## Database

Size: 552 MB. The prospecting map data is 94 % of it.

| Table             | Rows                       | Size              | Of which indexes    |
| ----------------- | -------------------------- | ----------------- | ------------------- |
| `buildings`       | 270,291                    | 423 MB            | 181 MB (17 indexes) |
| `address_points`  | 116,138                    | 96 MB             | 47 MB               |
| `audit_log`       | 3,416                      | 3.4 MB            | 0.6 MB              |
| `leads`           | 1,646                      | 2.5 MB            | 0.3 MB              |
| `bids`            | 33                         | 2.2 MB            | 0.2 MB              |
| `storage.objects` | 249 files, 152 MB of files | 0.7 MB            |                     |
| `crm_sites`       | 1,137                      | 0.5 MB            |                     |
| `documents`       | 44                         | 0.5 MB            |                     |
| `crm_contacts`    | 708                        | 0.4 MB            |                     |
| `crm_accounts`    | 637                        | 0.4 MB            |                     |
| every other table | under 500 rows each        | under 0.4 MB each |                     |

Work tables today: 48 tickets (10 live), 339 ticket events, 105 pictures, 19 time entries, 188
notifications, 52 follow-ups, 0 tasks, 0 invoices.

Biggest stored documents (characters of JSON): a bid's `data` averages 169,000 and reaches
318,000; a document revision's pages 5,400 (max 19,300); a price screen 4,700 (max 65,200); a
takeoff's drawing 1,300. Opening a bid therefore moves about 170 to 320 KB for the bid on top of
about 875 KB of catalog (unpacked; the catalog is 81 KB packed). The bid's own fetch was not
timed.

### Query plans

| Query                                                           | As a signed-in user                                | Without the per-row access check |
| --------------------------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| County list: count 270,291 buildings by county                  | **8,229 ms**, sequential scan, 299,884 buffer hits | 235 ms                           |
| Building search, five columns `ilike '%text%'`, no match        | **13,716 ms**, walks all 270,290 rows              | 1,319 ms                         |
| Building list, newest 500                                       | 17 ms, index scan                                  |                                  |
| Customers, all 636                                              | 22 ms for an admin, **104 ms for a technician**    | under 1 ms expected              |
| Properties, 1,000 rows (one page of the customers list's count) | 46 ms                                              |                                  |
| Audit log, newest 300                                           | 7.6 ms                                             |                                  |
| A technician's tickets with picture counts                      | 4.8 ms for 12 rows                                 |                                  |

`pg_stat_statements` is readable. Everything slow in it is the buildings table: the county list
averages 19.1 s over 45 calls (6.4 s over another 79), the building search 21.3 s over 10 calls
(worst 29.5 s), a county's centroids 2.4 s over 577 calls, a city and street lookup 1.8 s over
1,170 calls. The rest of the top of the list is the map-data imports. No query on the work
tables (tickets, bids, customers, invoices) appears among the slow ones; the customers list's
property count averages 95 ms over 548 calls.

### Row security

Every policy on the busy tables calls a helper (`has_access`, `is_admin`, `is_manager`,
`is_technician`, `tech_sees_account`, `is_on_crew`, `works_on_ticket`, …) **bare, once per row**.
All of them are `STABLE SECURITY DEFINER` SQL functions that read `profiles`; none is wrapped in a
`(select …)`, so the database cannot run it once per query. Measured cost: about 30 millionths of
a second per row for an office user and 160 to 350 for a technician (their policies try more
branches). Invisible on 600 rows; it is the whole 8 seconds of the county list on 270,291.

### Indexes

- Every column the work pages filter or sort on has an index (`service_jobs` has 13, `bids` 12).
  No sequential scan was found on a work table that will grow, apart from the per-row check above.
- Foreign keys with no index, on tables that will grow: `service_job_photos.repair_id`,
  `notifications.followup_id`, `service_time_entries.technician_id`, `crm_followups.account_id`,
  `service_jobs.contact_id`, `service_jobs.location_id`, `documents.template_id`,
  `leads.building_id`. All tiny today; they only cost when the row they point at is deleted or
  joined from that side.
- Barely used: `buildings_roof_sqft_idx` (11 MB, 2 scans), `buildings_name_idx` (5 MB, 9 scans),
  `buildings_roof_year_built_idx` (3.4 MB, 2 scans); `crm_accounts_name_idx` and
  `crm_sites_name_idx` (0 scans). They slow imports and take space, not page loads. No exact
  duplicate index.

## Findings, by time lost

1. **Roofs & Storms takes 20 to 28 seconds to finish loading, every time.** The county picker's
   count takes 20.8 s in the page and 8.2 s in the database; the same count without the per-row
   access check takes 0.24 s. Cause: `buildings_read` runs `has_access()` for each of 270,291
   rows (`supabase/migrations/20260924010000_prospecting_phase1.sql:49`; the call is
   `src/lib/prospect.functions.ts:358`). Fix idea: write the policy as
   `(select has_access('prospect')) or (select has_access('estimate'))`.
2. **Searching buildings takes 14 to 30 seconds.** 13.7 s measured for one search; 21.3 s average
   on the live record. Cause: the same per-row check plus `ilike '%…%'` on five columns with no
   text index (`src/lib/prospect.functions.ts:223`). Fix idea: the policy change above (1.3 s),
   then a trigram index (well under a second).
3. **A full page load fetches 82 to 218 files; a third to a half are icon files under 1 KB.**
   386 to 783 KB of script per cold load; the sign-in page alone asks for 56 script files. At a
   1.6 Mbps phone link the bytes alone take 3 to 7 s. Cause: the build puts each shared icon in
   its own file and the config has no chunk grouping (`vite.config.ts`). Fix idea: group icons
   and small shared modules into a few chunks.
4. **A ticket re-downloads all its pictures on every open.** 31 thumbnails, 640 KB, none served
   from the browser's cache: each open signs new links
   (`src/lib/service-field.functions.ts:1329`). The ticket also makes 28 calls in four rounds.
   Warm open: 2.9 s on a desktop, 5.3 s on the slowed phone with 0.75 s of stalled main thread.
   Fix idea: reuse a picture's signed link for its lifetime, load pictures as they scroll into
   view, fold the second round's 16 small reads into the bundle.
5. **The logo costs 88 KB on every page load and is never cached.** It is 2000 x 1125 and shown
   180 wide; it is 83 % of a warm page's bytes, about 0.45 s on a 1.6 Mbps link
   (`src/components/app-sidebar.tsx:417`; root files get no cache header). Fix idea: a 360 wide
   copy (a few KB) imported through the build so it gets a cached address.
6. **Inventory's stock list makes one database read per stocked item, one after another.**
   0.77 s with 10 items, about 63 ms an item: 100 items would be about 6 s, 300 about 19 s
   (`src/lib/inventory.functions.ts:261-270`; the same loop for a truck's stock at `:1106-1110`).
   Fix idea: read the needed price screens once and look the pieces up in memory.
7. **The Customers list draws every customer at once.** 636 customers make 22,398 page elements
   and a 400 KB answer. Typing the first letter takes 70 ms on a fast computer and 420 ms on a
   slow one; clearing the box 268 ms and 1.0 s; scrolling stutters on a slow one. It grows in a
   straight line: 3,000 customers would be about five times that
   (`src/components/customers-page.tsx:564`, `src/lib/crm.functions.ts:247`). Fix idea: draw only
   the rows on screen; count properties and open tickets in SQL.
8. **Every page asks for the profile three or four times, and Work Overview asks for its list
   twice for an admin or a manager.** Each is a 180 to 400 ms call. They run side by side, so
   they waste server work more than they delay the page; the second Work Overview list does make
   the page settle about 0.3 s later (`src/lib/auth-context.tsx:90-94` and `:98-120`;
   `src/components/my-work-page.tsx:1161-1169`, where the list starts before the profile is
   known and `who` changes when it lands). Fix idea: share one profile load; start the list once
   the profile is in.
9. **The estimator loads the Excel library before anyone exports.** 139 KB packed, 424 KB raw,
   on every estimator open (`src/routes/estimate.tsx:134`). Fix idea: load it at the export
   button, as `src/lib/planswift/parse.ts:166` already does.
10. **Row security costs time in a straight line with rows on every table**, the same cause as
    finding 1. Today: 22 ms to read the customers for an office user, 104 ms for a technician,
    46 ms per 1,000 properties. At ten times the customers a technician's read is about 1 s.
    Fix idea: the same one-line wrap on each policy; one migration covers findings 1, 2 and 10.
11. **`/documents` downloads the whole editor (168 KB packed) to show a card that says documents
    open from a bid or a ticket.** Fix idea: load the editor only when a document or template is
    opened.
12. **The Roofs & Storms building list sends 500 whole rows**, footprints included: 1.2 MB
    unpacked, 93 KB packed, 7,910 elements (`src/lib/prospect.functions.ts:195`, `select("*")`).
    It is capped at 500, so it does not grow. Fix idea: ask for the list's columns only.
13. **`/` answers with a redirect to Work Overview**, one extra round trip on the landing
    (0.5 s here). Small.

Not a speed finding, but found on the way: the database is 552 MB and 519 MB of it is map data.
Worth checking against the plan's size limit before the next state is loaded.

## What is fine

- The work tables are small and every query on them runs in milliseconds.
- Moving between pages by the menu takes 0.3 to 0.7 s on all but Inventory (1.2 s),
  Notifications (1.6 s) and Roofs & Storms.
- Script and style files are cached for a year; a warm load fetches none of them.
- The Bids list is 21 KB for 33 bids (it was 7.9 MB for 24 before the Nov 6 fix).
- Background refreshing is light: once a minute for the bell and a ticket, every five for Work
  Overview, and paused when the tab is hidden.
- Opening a ticket fires no write.

## Where it will get slower as data grows

| Page                                                             | Today                                          | Grows with                                                                | About when it hurts                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Customers list                                                   | 636 rows, 22,398 elements, 400 KB              | customers (no paging; filtered in the browser)                            | already slow on a slow computer; at about 2,000 customers on a fast one |
| Service list                                                     | 10 live tickets, 839 elements, 1.3 KB a ticket | live tickets (reads up to 1,000, newest change first, and draws them all) | a few hundred live tickets; past 1,000 the oldest silently drop off     |
| Project Bids                                                     | 33 bids, 1,706 elements                        | bids (no limit, all drawn)                                                | about 500 bids                                                          |
| Inventory stock                                                  | 10 items, 0.77 s                               | stocked items, 63 ms each                                                 | about 50 items (3 s)                                                    |
| A ticket                                                         | 31 pictures, 640 KB each open                  | pictures on the ticket                                                    | a 100-picture ticket is about 2 MB each open                            |
| Anything a technician reads from customers, properties, contacts | 104 ms per 636 customers                       | rows times the per-row check                                              | about ten times today's customers                                       |
| Roofs & Storms                                                   | 270,291 buildings, 20 s                        | buildings                                                                 | now; adding a state makes it worse in proportion                        |

Deleted-row lists (tickets, bids, takeoffs) load with their pages but are capped at 200 rows.

## Refused by the guard

| What                                                                 | Times                         | Why                                                                                              |
| -------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| The reminder pass the app runs at sign-in (`dispatchRemindersIfDue`) | on every page load            | it sends; refused so the measuring sent nothing                                                  |
| The aerial picture for a property card (`ensureSiteAerialCover`)     | about 40 a customer-page load | it stores a file; the page retried because it was refused, so the real count is one per property |
| The storm refresh (`refreshStormsIfDue`)                             | 1 a Roofs & Storms load       | it writes                                                                                        |
| The host's own page-view beacon (`/__l5e/trackevents`)               | about 2 a page load           | not ours; a POST, so refused with the rest                                                       |

One POST was let through after its source was read and found to be selects only:
`documents.listDocuments`. In the two runs that printed it, no write left the browser unjudged.

## Not measured

- Cold loads in a real browser over HTTP/2. The cold column here is an upper bound.
- A real phone. The phone numbers are a desktop browser slowed down.
- The estimator with a bid open, the takeoff editor and the document editor: opening them takes
  an edit lock or needs my own rows, and this pass wrote nothing.
- The close-out screen: it is reached from inside a ticket by steps that write.
- My tickets with tickets on it: the test login has none today.
- Any save, upload or PDF export.
- A technician's login. Their row-security cost was measured by SQL only.
- Many people at once.
- The global search box.
