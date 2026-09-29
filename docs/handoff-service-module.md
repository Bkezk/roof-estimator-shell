# Handoff notes moved from TODO.md

The long narrative text of open `docs/TODO.md` items, moved here verbatim on 2026-09-29 so the
to-do list stays one line per item. TODO.md links to each section. Item 0 (the service module /
CenterPoint handoff) comes first; the other sections are the remaining TODO paragraphs longer
than ~6 lines. Item numbers are unchanged, so references like "TODO 3c" or "item 10 A" still
resolve.

## Item 0: service module and CenterPoint

0. **HANDOFF — repairs / service jobs and the CenterPoint CRM (owner, Sep 24).** Read this
   first in a new session. **Step 1 is done (Sep 24–26):** the exploration report, the Bell
   County daily log and 77 screenshots are in `docs/centerpoint/`, and the build plan is
   `docs/service-module-design.md` (data model, minimal-click office / tech / invoice flows,
   Sage hand-off, phases A–D, the eight decisions the owner still has to make). Build from that
   doc; the text below is the original brief. **Phase A started Sep 26** (migration
   `20260926120000_service_phase_a.sql`, applied live): access pages `service` + `customers`,
   `profiles.technician`, `crm_accounts` / `crm_sites` (the CRM hub — NOT prospecting's
   buildings), `vehicle_drivers` (≤2 per vehicle, history kept, admin sets), `service_jobs`
   (numbers from 6000 so they never collide with CenterPoint's), `bids.account_id / site_id`,
   `inventory_movements.service_job_id`, the vehicle write-off removed; server functions in
   `src/lib/crm.functions.ts`, `service.functions.ts`, `inventory.functions.ts`. The Setup ›
   Customer name typeahead links a bid to a profile (built Sep 26). **Phase B (Sep 27):**
   follow-up timers with reminders by email (Resend) + push, opportunities, admin reminder
   settings, the installable app, contacts, the tech phone flow tables and functions, the
   Tech Board's assign call; screens for Today / close-out / Board / contacts in progress.
   Owner setup for reminders is design §13 (RESEND_API_KEY, NOTIFY_FROM_EMAIL, APP_URL in
   Lovable Cloud; APP_URL + CRON_SECRET GitHub secrets). **Phase C (Sep 27):** invoices from tickets, PDF, send, mark paid, Sage CSV, rates admin. **Untouched work (Sep 28, design §15):** contact log, assignment dates, Needs Action strip, By-person table, escalation to admins
   (design §14). Still open: the CenterPoint CSV
   import (needs the owner's exports of Companies, Properties, Contacts, repair templates,
   materials), the tech phone flow's offline photo queue
   (phase B), invoicing (C), history import (D), the truck reconciliation (design §12).
   Context: new-roof work is estimated and sold in this app; repair
   work, invoices and customer records live in **CenterPoint Connect** (the company's CRM).
   Inventory now sits at the shop or on a service vehicle (`inventory_locations`); the four
   movements are shop→job, shop→vehicle, vehicle→job, vehicle→shop, all through the two
   Inventory buttons (Take from / Put in inventory, location asked first). Repairs have no
   record in the app, so material used off a truck on a repair can only be written off as
   "used on the vehicle" (the tick box on a vehicle→shop move). The owner wants that box gone
   once repairs can carry material.
   Agreed direction (owner, Sep 24): do NOT make repairs bids and do not bolt them onto
   CenterPoint; build a lightweight **service job** in the app and keep CenterPoint as the
   customer / invoicing system of record until the CRM phase (brief §phase 5), when service
   jobs become CRM service tickets.
   Step 1 — explore CenterPoint (needs a session whose environment allows
   centerpointconnect.io / centerpointconnect.com; the owner sets Network access on the cloud
   environment, and creates a separate CenterPoint login for Claude — never the owner's own).
   Walk the site in the installed Chromium (Playwright, `/opt/pw-browsers`) and record here:
   which objects the team uses daily (repair ticket, job, invoice, customer, reports) and which
   they ignore; a repair's life from first call to invoice; the fields techs fill in; any
   export (CSV) or API / integration CenterPoint offers (decides whether the app links to a
   ticket by a typed number or a live connection).
   Step 2 — build the service job: `service_jobs` table (customer / building, date, tech,
   vehicle, notes, CenterPoint ticket + invoice numbers, status), a Service page next to Bids
   (list + one-screen form), the Inventory "A job" picker listing bids AND service jobs (a
   consumed movement then carries a service_job_id), material + hours per service job, and
   remove the "rest was used on the vehicle" write-off. Half a day; the UI is a good Opus
   subagent task once the table shape is settled.
   The bigger goal (owner, Sep 24): the company runs four products today — Bid-Advantage,
   PlanSwift, CenterPoint and Sage — and the target is **this web app + Sage only**.
   Bid-Advantage → Estimator (built; importer for old bids built). PlanSwift → owner keeps measuring and pricing in PlanSwift (item 10 A) and imports the finished job into Bids (item 10 B); Bid-O-Matic's own Takeoff page is built and stays available. CenterPoint → service jobs, customers, scheduling, invoicing
   here. Sage stays for accounting and payments; a live Sage integration is OPTIONAL — the app
   only has to hand Sage clean invoice / payment numbers (an export the bookkeeper imports is
   enough). Order: CenterPoint replacement first (daily use), then takeoff, then history
   migration and cancelling the two subscriptions.
   Destination for CenterPoint: **replace it by the end**, in steps that each stand
   alone: (1) service jobs + material + hours here, linked by CenterPoint ticket number;
   (2) customers, contacts and scheduling here, techs create repairs here, CenterPoint still
   invoices; (3) invoicing here pushed to the accounting system (do not build accounting —
   accounting and payments are **Sage** — confirm WHICH Sage: 100 Contractor or Sage 50 (desktop; import files / ODBC / SDK on the office PC) vs Intacct or Business Cloud (web API, direct push)) — the day CenterPoint stops being needed for new
   work; (4) import CenterPoint history from its export, run both a month, cancel. So the
   exploration must also record every export / integration CenterPoint offers and what a full
   data export contains; that decides whether step 4 is easy or a migration project. Hard
   parts to size honestly: money (invoices, payments, accounting sync), the tech's phone
   (dispatch, photos, signatures, no signal on a roof), customer email / text with a record.
   Owner rules to keep: number boxes start blank (0 placeholder, never prefilled);
   prospecting code must not touch bidding code; the loader runs only at night; never rewrite
   pushed history (Lovable); push straight to main.

## Building age on Prospecting (Sep 28)

**Building age on Prospecting (owner asked Sep 28; checked with proof).** `buildings.year_built`
exists and the Buildings page already shows "built 1998, roof N yrs if original"; nothing fills
it. No free source carries it: the state ORNL footprints and 911 points have no age, the state
Webster PVA parcel layer's `YEAR` is the tax year, and the Louisville (LOJIC OpenDataPVA) and
Lexington (LFUCG Parcel) open parcel layers list no year-built field (field lists fetched Sep
28). Regrid's parcel data has `yearbuilt` from the county PVAs; its store pages show the
"Structure Year Built" fill per core county: Jefferson 87%, Fayette 95%, Kenton 73%, Boone 82%,
Warren 67%, Daviess 80%, Hardin 81%, McCracken 42%, Campbell 80%, Madison 6%. Pricing is by
county (parcels@regrid.com) or the Property API (self-serve up to 10,000 records/month; 30-day
free sandbox). Decision for the owner: buy the core counties from Regrid (then a one-time join by
parcel id / point-in-polygon fills `year_built`), or keep it hand-entered.

## Item 1: import old bids (.bax)

1. **Import old bids (.bax files).** Built (Saved Bids › "Import old bids"): the file's own
   catalog resolves every id; labor rate, markup, commission, per diem, tax and extra shipping
   come from the estimate; Non-DL items and Exceptional Metals keep their stored unit costs
   and labor rates; the file's price tables (membrane by mil × tier × colour, Duro-Bond / Tuff
   / Fleece, adhesives, accessories, freight, setup and inspection bands, warranties, high
   wind) become the bid's frozen snapshot, dated at the legacy last save, so "Update pricing &
   labor" shows the catalog moved on. Legacy statuses fold to the four (In Progress /
   Finished / Review / Final → Draft; Submitted; Accepted → Won; Denied → Lost). **NOT FINISHED (owner, Sep 26) — still to do:**
   (a) owner compares imported bids with the same bids in Bid-Advantage and reports every
   difference (Monticello, Combined Bid and Broad Head were checked Sep 24: differences were
   importer bugs — zip64, tax mode, underlayment / fastener / pipe-stack prices, tab spacing —
   all fixed; the only residual was the live vent price and rounding); (b) drip edge, gravel
   stop and fascia bar accessory entries are not read yet (1b); (c) items the importer warns
   about and does not bring over: a legacy discount, the tear-off adjust, unknown membrane
   accessories, two-piece metals of an unknown size, term-bar extra feet in an unknown colour;
   (d) the file DOES carry the labor tables Bid-Advantage used for that bid (tear-off rates,
   adhesive hours per 1,000 sq ft, sheet-size and roll-width labor multipliers, underlayment
   layout, each as default + custom), but the importer reads only the underlayment layout
   overrides; everything else prices at today's live labor tables (1c-1). Checked Sep 26: all
   five sample files carry identical labor tables, their tear-off table equals the live one row
   for row, and their only custom labor values are seven underlayment layout overrides the
   importer already applies — so these five import with the same hours; Monticello matched
   Bid-Advantage within $34 (live vent price + rounding). Underlayment $/sq ft, fastener box
   prices and pipe-stack prices ARE read from the file (Sep 24).

## Item 1c.1: freeze the file's labor tables

1. **Freeze the file's labor tables into the bid's snapshot**, the same way its prices
   already freeze: read `lookuptearofflabor` (tear-off rate per sq ft by type × deck), the
   adhesive `hoursperksqft` and `allowedunderlayments` coverage (default / custom), the
   sheet-size labor multipliers (`mechrsmulti` and the adhered equivalents), the roll-good
   width `laborvalue`s, and any other `default`/`custom` labor pairs, into the bid's frozen
   admin snapshot (custom when > 0, else default — the existing `smartValue` rule). Then an
   old bid reprices with its own labor even after the live tables change, and "Update
   pricing & labor" is how the estimator moves it to today's. Also correct the import
   preview note in `src/lib/bax/bax-import.ts` ("Not in the file: the labor time tables…"),
   which says the opposite of what the file holds.

## Storm call points (built Sep 28)

**Storm call points (built Sep 28; owner: "just if there's been a major weather event in the
past week").** NOAA Storm Prediction Center daily CSVs (hail / wind / tornado, one file per
day) → `storm_reports`; `match_storm_reports()` flags every building within the radius of a
qualifying report in the window (`storm_settings`: 7 days, hail ≥ 1", wind ≥ 58 mph or UNK,
tornado any; 3 / 3 / 5 miles) into `buildings.last_storm_*`, prunes after 30 days, and notifies
Prospecting users when new buildings are flagged. Runs nightly from
`.github/workflows/storms.yml` (same APP_URL + CRON_SECRET secrets as reminders) and, throttled
to six hours, whenever a Prospecting user opens Buildings. Buildings page: Storms panel (by
county), Storm hit filter and sort, row badge, nearby reports on the building. Proof Sep 28:
the four real Kentucky reports of Sep 21 flagged 182 buildings. NASA EONET was checked and
rejected (only tropical-cyclone tracks and wildfires for Kentucky).

## Construction leads (built Sep 28)

**Construction leads (built Sep 28; owner: "data on new builds before they're built, giving
us time to submit a bid").** Two public feeds, both fetched live that day: the State of KY
online planroom (https://www.stateofkyplanroom.com/ — every state-funded project in bid
phase; 98 jobs, 13 roof; plain HTML rows with job id, name, town, agency, type, pre-bid and
bid dates in Eastern time) and Louisville Metro's active construction permits (LOJIC ArcGIS
feature service `active_construction_permits`; Commercial New / Addition ≥ 5,000 sq ft in
the last 90 days → 14). `leads` table keyed by (source, external_id), team status kept
across refreshes, rows that drop off the source marked gone; `is_roof` from
`lead_settings.roof_keywords` (any Commercial New/Addition permit counts). Nightly
`.github/workflows/leads.yml` → `/api/cron/leads`, plus a six-hour throttled pass when the
Leads page opens; new roof leads notify Prospecting users (`/prospect/leads?roof=1`). The
Leads page (sidebar › Prospecting) filters roof-only / source / status, counts down to bid
day, hides closed bids by default, and adds a lead to My prospects as a by-hand building.
Sep 29: three more sources — Lynn Imaging's public bids RSS
(https://www.lynnimaging.com/bids/feed/ — the planroom company behind the state's; every
project it prints plans for, statewide, posted the day plans go out for bid; housing
authorities, cities, counties, districts, colleges, hospitals, churches; 25 latest posts,
so never marked gone), Bowling Green's bids page (Open Opportunities table → Bonfire) and
Paducah's bids page (Active Requests headings). The first live pull flagged two waterline
jobs on "pvc" (PVC pipe), so "pvc" left the default roof keywords. Later Sep 29: the owner registered one Lynn planroom login (it
covers ten portals) and the SAM.gov key, all in Lovable Cloud secrets → the nightly check
signs in and reads job pages for contacts and plan holders (src/lib/planroom.server.ts,
docs/planroom-login.md); seven campus planrooms (UK, WKU, NKU, EKU, UofL, JCPS, KCTCS —
same list format, one source `campus_planrooms`, the plan issuer named as who to bid to)
and SAM.gov (NAICS 238160, place of performance KY, `sam_gov`) are sources too. Checked and not worth a feed: KCTCS
RSS (equipment only; construction goes through the state planroom), Bid Locker Kentucky
(KCTCS only), Lexington purchasing pages (404), BidNet (blocked), JCPS bids (gone).
Sources checked and NOT used: DHBC's statewide plan review log (exists, no public feed —
see docs/dhbc-open-records-request.md, an open records request each month); Lexington's
data hub (no commercial permit dataset found); ConstructConnect ($129–$199/mo) and Dodge
(paid; planning-stage projects); Builders Exchange of Kentucky (site blocked the fetch, no
pricing seen); Cabinet for Economic Development news releases (earliest signal on
industrial builds, prose only — a candidate third feed); Kentucky Press Association Smart
Search (free keyword email alerts on legal notices, set up by hand).

## Item 3: statewide load, then monthly refresh

3. **Statewide load, then monthly refresh.** Built: `scripts/load-kentucky.ts` (matching in
   the loader's memory; only linked / business points reach the database) and the
   `Refresh Kentucky data` workflow (1st of each month, one shard). Secrets LOADER_EMAIL and
   LOADER_PASSWORD are set. **Statewide load complete (Sep 25, 03:20 UTC): all 120 counties
   have footprints, addresses and businesses (168,094 buildings).** The night pass (run 11,
   02:01–02:38 UTC, on the Small instance) did the remaining 62 counties in 37 minutes with no
   statement timeouts; Perry alone failed on a raw control character in the state's
   address-point JSON and went in after the parser fix (`src/lib/loose-json.ts`). The monthly
   cron (1st, 05:00 UTC, `skip_fresh_days` unset = full refresh) takes over; the one-off night
   routine was deleted. History: run 10 (Sep 24, after the owner truncated the 2.1 M junk
   address points) reached 58 counties (Adair … Johnson, plus Knott/Knox/Larue/Laurel partly)
   before the Tiny instance starved. Run 10 went well
   for 25 minutes and then the small instance starved: every 200-row `apply_building_addresses`
   call hit the 30 s statement timeout, even `select 1` was cancelled, and the owner could not
   open a bid — so it was cancelled at 13:26 UTC. The write itself is an index lookup per row
   (EXPLAIN: nested loop on buildings_pkey), so this is the instance's burst budget, not a bad
   plan. Rule: the loader runs only when nobody is using the app (night pass at 02:00 UTC,
   `skip_fresh_days=3` resumes where the last pass stopped) and one shard only; never run
   DDL while it writes (an `alter table` blocked it and PostgREST lost its schema cache for
   six minutes). If the night pass also starves, the next step is the Lovable Cloud instance
   upgrade, not more loader tuning.
   Open: Ballard, Clark, Fulton and Martin keep almost no address points (Clark 0 of 16,695;
   Martin 19 of 6,169) — their 911 layer rows likely lack the number/street fields or
   coordinates the reader expects; paste a sample feature from one of them to fix the reader.

## Item 3c: drivers for service vehicles

3c. **Drivers for service vehicles (owner, Sep 25).** Each service vehicle gets an assigned
driver (a user, changeable over time with an effective date, so history stays right), so
inventory taken off a vehicle can be tied to the job that driver was on. Pieces:
`inventory_locations.driver_id` (or a `vehicle_drivers` history table: vehicle, user, from,
to), the admin vehicles screen from 3b to set it, the "Take from vehicle" pop-up defaulting
the vehicle to the signed-in user's own vehicle and the job to that driver's open service
job (once service jobs exist — TODO 0 step 2), the Inventory ledger and history showing the
driver on vehicle movements, and a per-driver view of what came off their vehicle and
which job it went to. Depends on service jobs for the job link; the driver assignment and
the pop-up default can land first.

## Item 10 A: pricing inside PlanSwift

- **A. Pricing inside PlanSwift — a project somewhat outside Bid-O-Matic.** PlanSwift 11
  template sets that let a PlanSwift job price itself (quantities, material, labor, tax,
  shipping, markup) so PlanSwift alone can produce a bid number. Spec:
  `docs/planswift-bridge.md` (Part A quantities set, Part B costing rules marked exact /
  near / rough, Part C the live price and labor tables). Built by the PlanSwift chat:
  `Bid-O-Matic.SwiftTemplates` and `Bid-O-Matic Costing.SwiftTemplates`. Generator in
  `scripts/planswift/` (README); `feed_to_partc.py` turns Bid-O-Matic's table export into
  the data the generator reads (verified row-for-row). Regenerate after every price import.

## Item 10 B: import the finished PlanSwift job into Bids

- **B. Import the finished PlanSwift job into Bid-O-Matic's Bids (the estimator), NOT into
  Takeoff.** The owner measures and prices in PlanSwift, then drops the PlanSwift job file
  into Bid-O-Matic, which creates a priced bid on the Bids page the way "Import old bids"
  does for .bax: sections (area, perimeter, edge options), parapets, curbs, drains, pipe
  stacks, walk pads, the job setup answers as the bid's defaults, and whatever cannot be
  placed listed in a notice with its numbers. Bid-O-Matic re-prices it with its own engine;
  the PlanSwift total is shown beside it for comparison. Code home: `src/lib/planswift/`
  plus an "Import PlanSwift job" button next to "Import old bids" on Saved Bids. Section
  geometry: `sectionFromOutline` (`src/lib/takeoff/geometry.ts`) if the job file carries the
  drawn points; otherwise the equivalent rectangle from Area and Perimeter.
