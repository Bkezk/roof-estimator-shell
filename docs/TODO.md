# To-do (owner's list, kept in the repo so it survives sessions)

Add, reorder or strike items here; each Claude session reads this first. Done items move to
the bottom with the commit that closed them.

## Open

**Owner actions (keys and secrets, Sep 27)** — nothing here goes in the repo or in chat:

- Lovable Cloud › Secrets: `RESEND_API_KEY` (from a Resend account with the flatroofonline.com
  domain verified), `NOTIFY_FROM_EMAIL` (e.g. `Bid-O-Matic <notifications@flatroofonline.com>`),
  `APP_URL` (the app's public address, used for links in emails and push). Until set, email
  reminders show as failed on Admin › Reminders; in-app and push still work.
- GitHub repository secrets: `APP_URL` (same value) and `CRON_SECRET` — a long random value
  the owner makes up and sets under the same name in BOTH Lovable Cloud › Secrets and GitHub
  (Sep 29: Lovable hides LOVABLE_CRON_SECRET's value, so the app now also accepts the owner's
  own CRON_SECRET, src/lib/cron-auth.ts) — so `.github/workflows/reminders.yml` fires
  reminders every 30 minutes in office hours. Without them, reminders go out only when an office
  user opens the app.
- Each user: open `/account` on their phone and turn push on (iPhone: add to Home Screen first).
- For phase D: CenterPoint CSV exports of Companies, Properties, Contacts, Tickets and Invoices
  (⋮ › Download All to CSV / Email CSV on each list), and if reachable the 475 repair templates
  and 142 materials.

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

**Tennessee buildings (owner, Sep 29: "whole state").** Loader, workflow and migration built
(`scripts/load-tennessee.ts`, `.github/workflows/refresh-tennessee.yml`,
`20260929210000_buildings_state_tn.sql`; details in `docs/tennessee-buildings.md`). Owner: apply
the migration, then run "Refresh Tennessee data" by hand once at night (about 102,000 rows);
it then runs on the 2nd of each month. Tennessee is footprints only: the state publishes no
statewide 911 address points or schools service, so there is no address matching, no promoted
named businesses and no schools; addresses are whatever the national layer carries. 34
county names exist in both states (Warren, Knox, Jefferson …): since Sep 30 the county filter
(`building_county_counts()`) and the Storm hits county chips (`building_county_counts_storm()`)
group by county and state (`20260930060000_county_counts_by_state.sql`, applied with the code).
Still to do: the refresh log stores Tennessee counties as "Davidson, TN", so the "N of 120
counties" line on the Buildings page should count per state.

**Tennessee leads, round two (Sep 29).** Owner: apply
`20260929230000_leads_tennessee_round2.sql` before the round-two code goes live, or every lead
refresh fails on the source check (BidNet, Chattanooga permits, Knox County, TN universities;
details under item 0, "Tennessee leads").

**Tennessee leads, round three (Sep 29).** Owner: apply
`20260930000000_leads_browser_sources.sql` before the "Browser bids" workflow first runs, or the
app refuses its rows on the source check (Metro Nashville bids, Chattanooga city bids; details
under item 0, "Tennessee leads").

**Bid Board fixes (Sep 30).** Owner: apply `20260930050000_bid_board_fixes.sql` with the code
(new `leads.details` / `details_read_at`, `lead_settings.last_fetch_problems`,
`stamp_lead_fetch(note, problems)`, read policies = Prospecting or Estimate). Done: a refresh
no longer writes null over team notes, planroom contacts and job-page reads (one upsert per
source and key set; job-page reads in their own columns); the red line reads the stored
problem list; Paducah's due sentence is the bid date; the Open count follows Source and search;
Unwatch/Restore no longer bring back "New"; keywords take only plain endings ("addition" no
longer matches "additional"); BidNet copies of portal jobs are dropped (see BidNet below).

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
   1b. **Importer: drip edge, gravel stop and fascia bar entries.** The four sample files had
   none, so the estimate-level XML shape of those accessory entries is unknown and they are
   skipped with a note in the import preview (a bid that used them imports short by those
   lines). Owner is finding an old .bax that used one; then add all three to
   `src/lib/bax/bax-import.ts`.
   1c. **Close the .bax cost gaps (owner, Sep 26), so an imported bid always reprices to what
   Bid-Advantage showed.** Each piece gets a test on a sample file.
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
   2. **Apply the legacy discount and the tear-off adjust instead of skipping them.** Find in
      the legacy IL how Bid-Advantage applies `<discount>` (where in the money chain, % or $)
      and `<tearoffadjust>` (a multiplier on tear-off hours; 1 = none), add the matching bid
      fields in the engine with a parity test, and import them. Today both only warn.
   3. **Import the remaining skipped items**: membrane accessories and two-piece metals with
      ids the app does not know yet, and term-bar extra feet in an unmapped colour — map them
      from the file's own catalog like the other accessories instead of warning.
   4. **Drip edge, gravel stop and fascia bar entries** (1b) — needs one old .bax that used
      them.
   5. **Proof run**: import every old .bax the owner has, compare each total with Bid-
      Advantage's Estimate Review, and list any bid that differs by more than rounding with
      the reason. Done when every difference is explained by a price the owner changed on
      purpose.
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
      (KCTCS only), Lexington purchasing pages (404), BidNet (blocked then; read since Sep 29 —
      see Tennessee leads), JCPS bids (gone).
      Sources checked and NOT used: DHBC's statewide plan review log (exists, no public feed —
      see docs/dhbc-open-records-request.md, an open records request each month); Lexington's
      data hub (no commercial permit dataset found); ConstructConnect ($129–$199/mo) and Dodge
      (paid; planning-stage projects); Builders Exchange of Kentucky (site blocked the fetch, no
      pricing seen); Cabinet for Economic Development news releases (earliest signal on
      industrial builds, prose only — a candidate third feed); Kentucky Press Association Smart
      Search (free keyword email alerts on legal notices, set up by hand).
      **Tennessee leads (Sep 29; owner: "we actually cover TN as well, can we replicate what
      we have for leads for TN?").** Three new sources plus SAM.gov, all in the same list (a
      lead now has a `state` column, KY or TN; cards show ", TN"). Live pull from the sandbox
      Sep 29: **STREAM** (`tn_stream`, the state's construction bid list at
      tn.gov/generalservices/stream — 5 projects, 1 roof: East Tennessee Intermediate Care
      Facility, roof replacement in the scope — plus the STREAM RFP page, 1 CM/GC RFP; the
      designer firm, contact, phone and e-mail are the contact line; pre-bid and bid opening in
      Central or Eastern time as the page says); **UT bids** (`ut_bids`, the "Invitations to
      Bid" on the seven UT campus pages — 14 today, none roof; the site refuses a bare request
      and answers a browser's headers); **Nashville permits** (`nashville_permits`, Metro
      Nashville's Building Permits Issued layer — Commercial New / Addition / Shell / Roofing
      ≥ $100,000 in the Louisville window of 90 days: 74, all counted as roof like Louisville's
      new builds; types and cost floor in the gear panel); **SAM.gov** asks for KY and TN in its
      one daily slot. Migration `20260929220000_leads_tennessee.sql` (source list, `leads.state`,
      `lead_settings.nashville_types` / `nashville_min_cost`) must be applied before the next
      refresh, or every refresh fails on the missing column. Not verified / to watch:
      - SAM.gov Tennessee not pulled from the sandbox (no key here); first real pull is the
        next daily run after the migration.
      - UT invitations stay on the page after they bid, often with no bid date on the page (it
        is in the PDF). A lead closes when the page moves its bid date, or when the same title
        shows up under Bid Results; otherwise it stays open until the owner dismisses it
        (today: 8 posted before September, none roof, so the roof-only page hides them).
      - UT titles rarely say "roof": "UTM Storm Damage Repairs (24/25) (Subproject 2)" is not
        flagged. Add keywords (e.g. "storm damage") in the gear if those should count.
      - Nashville: the permit `Contact` is the applicant (a GC, an architect or a permit
        expediter), not always the builder; a Shell permit can be an interior white-box.
      - TDOT lettings not added (roads, not roofs).

      **Round two (later Sep 29; owner: bring Tennessee up to Kentucky's coverage — the other
      big cities, the schools and universities, a statewide feed).** Four more sources, all
      public pages or open data with no login or key (the owner's rule), in the same list.
      Migration `20260929230000_leads_tennessee_round2.sql` (source check only; must be applied
      first). Live pull from the sandbox through the app's own parsers, Sep 29:
      - **BidNet** (`bidnet`, label "Cities, counties & schools (BidNet)"): the public open
        list of BidNet Direct's Tennessee Purchasing Group (272 open, 11 pages of 25) and
        Kentucky Purchasing Group (183, 8 pages) — cities, counties, school districts,
        utilities, some state agencies. The issuing agency, number and documents are
        members-only, so the card shows the group as the agency, a town or county only when
        the title names one ("City of X", "X County"), and links the public abstract page.
        Once a day behind `source_fetched_at` like SAM.gov: 19 list requests, one at a time,
        300 ms apart, TN then KY, plus up to 8 abstract pages for roof rows (the exact closing
        time; the list shows the day only, so other rows assume 4:00 PM ET). Pages stop 40 s
        into a run so the Refresh button still answers. Today: 3 roof rows (Roof Replacement -
        Senior Center, closes Oct 5 11:00 AM ET; the TCAT Nashville Building 6 roofing; RFB-86-27
        Jackson SOB roof, dropped as a copy of the state planroom job). A BidNet row whose title
        or RFB code matches a job on the owner's own lists is dropped (the TCAT Nashville
        re-roof is worded differently on BidNet, so it shows twice). Done Sep 30: also dropped
        when its title matches a stored open lead of a portal (the browser job's city lists
        arrive apart; same state), and a portal import retires a stored BidNet copy. **To watch:** BidNet
        answers some requests with an AWS WAF "verify you're not a robot" page (curl got it on
        5 of 11 pages; Node's fetch, the app's, on none of 19). The app never solves or retries
        it: a checked page is skipped, the red line says which, nothing is marked gone that day,
        and if page 1 is checked that state is skipped until the next day. If it becomes
        routine, BidNet's own free alert e-mails are the fallback. robots.txt answered the
        sandbox with the same check, so it was not re-read here.
      - **Chattanooga permits** (`chattanooga_permits`): the Chattanooga-Hamilton County RPA's
        ArcGIS layer `Building_Permits_to_April_2021` (the name is historical; newest permit
        Jul 31: it runs one to two months behind, so the window is a fixed 180 days, not the
        Louisville one). New non-residential only, over the Nashville cost floor (relabelled in
        the gear as the floor for both), code 329 (towers, signs, walls) left out: 39 at
        ≥ $100,000 (47 with no floor), all counted as roof like the other new builds. One
        request.
      - **Knox County bids** (`knox_county_bids`, knoxcounty.org purchasing): 7 open, 0 roof;
        the buyer (name, phone, e-mail) is the contact, the solicitation PDF the link, the
        pre-bid note's date read. The page gives the deadline day only: 2:00 PM ET is assumed
        (raw says so). One request.
      - **TN university bids** (`tn_university_bids`): ETSU (1), Tennessee Tech (2, both bid in
        August and still listed), Austin Peay (1, bid July 8, still listed), MTSU (0 — the
        table is there and empty), and TBR's statewide list (9: community colleges, TCATs,
        TSU; 1 roof — TCAT Nashville Building 6 Re-Roof, bids Sep 30 2:00 PM CT). The designer
        (A/E) is the contact; bid and pre-bid times in the job's local time (Tennessee Tech is
        Central: Putnam County keeps Central time). Five requests.
      - Checked and **not** added: the two Knoxville permit layers on ArcGIS are stale (newest
        May and December 2025) and the City of Knoxville itself posts on BidNet; Memphis /
        Shelby County has no open permit data and its bids page refuses requests; Nashville's
        and Chattanooga's own city bids and Metro Nashville Public Schools sit in Oracle
        supplier portals that need a browser session (the two city lists are read since round
        three; MNPS is not); the University of Memphis bid list only
        links its Oracle supplier portal (registration). University invitations that stay
        listed after they bid carry their bid date, so the page hides them as closed.
      - Requests per refresh, round two: 1 Chattanooga, 1 Knox County, 5 universities; once a
        day 19 BidNet list pages + ≤ 8 abstracts (and SAM.gov's 2).

      **Round three (Sep 29; the two city lists round two could not read).** Metro Nashville's
      and the City of Chattanooga's own solicitations live in Oracle Cloud procurement portals
      ("Negotiation Abstracts" / "Solicitation Abstracts") whose pages are built by scripts, so
      the app's server fetch gets an empty shell. The owner approved a nightly job that runs a
      real browser: `.github/workflows/browser-bids.yml` (10:15 UTC, before the 10:45 leads run,
      and by hand) runs `scripts/browser-bids.ts` in headless Chromium on GitHub Actions, reads
      the two public lists (never signs in or registers), and posts one JSON body per portal to
      `/api/cron/leads-import` with the existing APP_URL / CRON_SECRET secrets (skips cleanly
      without them). The route checks the body with zod (`src/lib/leads-browser.ts`) and saves
      it through `saveLeadRows`, now shared with the refresh (same upsert, gone-marking,
      duplicate rules and new-roof notifications), then stamps
      `lead_settings.source_fetched_at`. Two sources, `nashville_bids` ("Metro Nashville bids",
      Central time) and `chattanooga_bids` ("Chattanooga city bids", Eastern). Migration
      `20260930000000_leads_browser_sources.sql` (source check only; apply first). Live dry run
      from the sandbox, Sep 29:
      - The script sets the page's own Status filter to Active (posting-date limit cleared) and
        reads what is left: Nashville 9 open, Chattanooga 8 open — the same sets a full scroll of
        the whole year found (220 and 459 rows; the ",N" after a number is the amendment round,
        the highest is current, older rounds show as Amended). When the filter does not take, it
        scrolls the whole list and applies that round rule itself.
      - The Details abstract is public: full title (the list cuts at 80 characters), buyer and
        e-mail (the card's contact), attachment names, the amendment description; Chattanooga
        adds the synopsis and the pre-bid meeting (read into the pre-bid date). Title, synopsis
        and attachment names feed the roof keywords; a Construction Bid is not a roof lead by
        itself. No per-row public link exists, so the card opens the portal's list.
      - Nashville's list is Metro General Government only (every number starts GG); no Metro
        Nashville Public Schools solicitations were on it. Nothing open was roof work that day
        (Nashville had a "Roofing Repairs and Replacement Services" RFQ earlier this year).
      - Requests per night: per portal one page load, three small filter requests, and one
        abstract (open and close) per open row with 0.8 s pauses — about 30 page requests each,
        about 30 s each; each portal is cut off at 90 s.
      - **To watch:** the portals changing layout. A list the script cannot read to the end (no
        results table, columns renamed, a sign-in wall) posts nothing, so no lead is marked gone,
        the "Browser bids" run turns red with the reason, and after 36 hours without new rows
        the Leads page shows "Not updated by the nightly browser job". Refresh on the Leads page
        does not re-read these two; they update once a night.

      **Kentucky cities (Sep 29; the two Kentucky gaps: Lexington's and Louisville Metro's own
      bid lists).** Migration `20260930010000_leads_kentucky_cities.sql` (source check only).
      **Apply it before this code is live:** until then every refresh fails (the Lexington rows
      are refused by the source check, and one refused row fails the whole save) and the
      Louisville import is refused. Live from the sandbox, Sep 29:
      - **Lexington city bids** (`lexington_bids`): LFUCG's Ionwave portal, the public list
        https://lexingtonky.ionwave.net/SourcingEvents.aspx?SourceType=1 (without `SourceType`
        the site sends Error.aspx). Server-rendered Telerik grid, read by the refresh with a
        browser's headers and no cookies: one request. Bid Number (the lead's id, without an
        "Addendum N" suffix, which stays in raw), Bid Title, Bid Type (Bid / RFP), Bid Issue
        Date, Bid Close Date/Time ("10/2/2026 02:00:00 PM (ET)"). A bid has no public page of
        its own, so the card opens the list; no contact on the list. 7 open, 0 roof (e.g.
        RFP-42-2026 Yard Waste Transporting and Composting, closes Oct 2 2:00 PM ET). The grid
        showed 20 a page that day and pages by postback, which the app does not do: past one
        page the red line says how many were not read and nothing of Lexington is marked gone
        that run. A page whose rows cannot all be read fails (nothing marked gone).
      - **Louisville Metro bids** (`louisville_bids`): Louisville Metro Government's Bonfire
        portal (https://louisvilleky.bonfirehub.com/portal/?tab=openOpportunities), built by
        scripts like the Oracle ones, so it is the nightly browser job's third portal
        (`scripts/browser-bids.ts --dry-run --source louisville_bids`, or `--portal`). The page
        asks its own server for the open list as JSON (reference, name, close date in UTC,
        department): the script keeps that answer, checks the table shows the same references
        with an EDT/EST time, and posts it; nothing else is requested (2 portal requests plus
        Bonfire's own scripts and styles from assets.bonfirehub.com; about 5 s; cut off at 90 s).
        12 open, 0 roof. The card names the department after the agency ("Louisville Metro
        Government — Public Works"); the type is the reference's letters (IFB, RFP, RFQ, RFI,
        RFA). Each row links its opportunity page (/opportunities/<id>), which answered the
        headless browser with a Cloudflare robot check: it is never read (never solved), so no
        description, buyer or documents; not checked in a person's browser. Same safety rules as
        the Oracle portals (an unreadable list posts nothing; the 36-hour warning on the Leads
        page covers Louisville too).
      - **Bowling Green left alone:** its Bonfire list (https://bgky.bonfirehub.com) carries the
        same reference as the city's bids page ("2027-11"), but adds only the close date and
        department — no description or documents (behind the same robot check) — and a second
        writer to `bgky_bids` would fight the refresh (each marks the other's missing rows gone,
        and the refresh would blank the close date). If the close date is wanted, move
        Bowling Green wholly to the browser job instead.
      - **Bug fixed (latent):** the save's "already stored?" check read every stored lead of the
        sources in one query, and the API returns at most 1,000 rows a query; past that (the
        refresh reads all its sources at once; BidNet alone is 455), stored leads would have
        counted as new — repeat "new roof lead" notifications. It now reads in pages of 1,000
        (`storedLeadKeys`, ordered by id) until a short page.
      - Checked and **skipped**: Lexington building permits (the city publishes yearly totals
        only); Northern Kentucky (LINK-GIS exposes no permit service); Boone County (monthly
        PDF reports); Owensboro (permits appear only in newspaper articles).
      - Requests: +1 per refresh (Lexington); +1 portal per night (Louisville, 2 requests).

      **Re-roof marking (Sep 29; owner: "The marking buildings as done is very useful, please
      implement it showing when it was done and who did it").** Metro Nashville's "Building
      Commercial - Roofing / Siding" permits are re-roofs already awarded to whoever pulled the
      permit, so they left the Leads list (`20260930020000_nashville_types_no_reroof.sql`);
      instead every lead refresh (the Refresh button and the nightly cron) ends with
      `markReroofedBuildings` (`src/lib/reroof.server.ts`): one query for that permit type (a
      year back on the first run, then 120 days), kept in `reroof_permits`; each permit whose
      scope is a re-roof (not rooftop HVAC work, siding only or a patch) is matched to a
      building — same street address and city, else the building whose outline holds the permit
      point, else the nearest building within 40 m — which gets one roof record ("Whole roof
      (permit)", installed on the issue date, installer = the permit holder, the permit number,
      cost and scope in the notes), `roof_year` (only moves forward) and
      `last_reroof_on` / `last_reroof_by`. The Buildings row and the building's header then read
      "re-roofed Mar 2026 by Pinaire Roofing" instead of the roof age. **Nashville only:**
      Louisville's permit layer has no roofing type and no description (a re-roof is an
      unmarked "Commercial Alteration"), Chattanooga's holds only new construction; another
      city is one more entry in `REROOF_SOURCES`. **Tennessee buildings are not loaded yet**, so
      today nothing matches: an unmatched re-roof is tried again on every refresh for 12 months
      and marks its building on the first refresh after the Tennessee load. Live, Sep 29: 80
      Roofing / Siding permits in 365 days, 67 read as re-roofs (34 of them ≥ $100,000; the 13
      others: 10 siding-only, one rooftop HVAC swap, two roof repairs); a dry run against the USA Structures layer the Tennessee load uses
      (loader filter) suggests about 35 would match by address, 12 by point and 20 not at all
      (apartments and small buildings the load skips). **Owner: apply
      `20260930030000_reroof_permits.sql`** (table + `buildings.last_reroof_on/by`); until then
      the step fails and says so in the refresh's red line (the leads still save). To watch:
      the permit `Contact` is sometimes the applicant or an expediter, not the roofer (e.g. "anna
      roberts-tettleton"); an apartment complex's permit ("Re-roof of buildings 100, 200 …")
      marks the one building at the address point; a roof record deleted by hand is not written
      back.

2. **Building age.** No free statewide source carries year built (footprints: none; state
   parcels: Webster only; Census: per-tract medians). Paths, in order: (a) county PVA bulk
   export or subscription — owner to check Hardin's qPublic site for a data download and
   whether the property card shows year built and owner; (b) a one-click "Open PVA card"
   button per building if the card's web address carries the address or parcel; (c) the
   salesperson types "Roof installed (year)" on first contact (already on the form; the
   "age unknown" filter shows what is left).
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
   **Approximate addresses (owner's three rules, Sep 29; built Sep 29, not yet run).** ~29 % of
   the 154,556 outlines have no 911 point inside the exact radius (rural shops and barns set
   back from the road). After the exact pass the loader now takes, for each outline still blank,
   the nearest 911 point within 300 m, only when the next-nearest point with a different address
   is at least twice as far, and stores it flagged (`buildings.address_approx`, distance in
   `address_approx_m`; the app shows "≈ 64 Holly Rd" and "approximate: nearest address point,
   190 m away — confirm on site"; typing another address, or "Address is right", clears the
   flag). Nothing is linked, stored or promoted from a guess and it never sets land use.
   Dry runs from the public layers (`--dry-run --county X`, no database): Graves 2,337 outlines,
   1,695 exact, 642 blank → 126 approximate, 416 blank by rule 2, 100 with nothing within 300 m;
   Hardin 3,883 / 3,035 / 848 → 111 approximate, 254 rule 2, 483 nothing within 300 m (353 of
   those are on Fort Knox, which has no 911 points). Rule 2 is the binding one: half of its
   blanks have the next address less than 1.25× as far (houses along the same road). To do, in
   order: (1) apply `supabase/migrations/20260930040000_address_approx.sql` while no load is
   running (without it the loader skips the pass and the run ends red); (2) run the workflow by
   night with "Approximate addresses only" (or let the Oct 1 monthly run do it); `--no-approx`
   turns the pass off.
   3b. **Inventory locations (built Sep 24).** Shop + four service vehicles (plates N2X384,
   08 D4L983, V3C058, 08 995892 — the owner's list had "08 D4L983" twice; confirm the fourth
   plate). Admins edit `inventory_locations` (name / order / active) in the database for now;
   an admin screen for vehicles is a small follow-up. Next: a standard load (par list) per
   vehicle with "restock to par".
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
4. **Verify in the browser:** aerial imagery tiles show on the map; the state outline layer
   draws when zoomed in; tap-to-add works on a small shop. Both depend on the state server
   allowing cross-origin tile fetches, which cannot be checked from the build container.
5. **More facility layers** once a sample is pasted: Hospitals, Long-term care, Post-secondary,
   Libraries, Armories, Existing industry, Available industrial buildings (layer index to
   confirm per layer).
6. **Apartments:** multi-family reads as residential today. Decide whether to include them as
   a labelled type (flat-roof commercial jobs to a roofer).
7. **Estimator backlog:** order pack field; opened-box rule on the bid; TPO induction welding;
   Summit fire-rated figure; "Remove all extra lines" button on Non-DL.
8. **Inventory:** a "your recent entries" strip with Undo if the History path proves too many
   taps; a supplier order from the order list (later).
9. **Roof time-lapse (owner idea, Sep 24).** On a selected building, step through the aerial
   imagery years (Kentucky's Phase 1/2/3 flights, plus USDA NAIP for the in-between years,
   free) to see whether the roof changed — a replaced roof shows as a colour / texture jump.
   Needs: the per-year KYAPED ImageServers at kyraster.ky.gov and the NAIP service URL; a
   small year slider on the map. Later, the same comparison can flag likely re-roofs
   automatically.
10. **PlanSwift → Bid-O-Matic bids (owner, Sep 25–26). RESUME HERE.** Two separate pieces:
    - **A. Pricing inside PlanSwift — a project somewhat outside Bid-O-Matic.** PlanSwift 11
      template sets that let a PlanSwift job price itself (quantities, material, labor, tax,
      shipping, markup) so PlanSwift alone can produce a bid number. Spec:
      `docs/planswift-bridge.md` (Part A quantities set, Part B costing rules marked exact /
      near / rough, Part C the live price and labor tables). Built by the PlanSwift chat:
      `Bid-O-Matic.SwiftTemplates` and `Bid-O-Matic Costing.SwiftTemplates`. Generator in
      `scripts/planswift/` (README); `feed_to_partc.py` turns Bid-O-Matic's table export into
      the data the generator reads (verified row-for-row). Regenerate after every price import.
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
      Next, in order:
    1. Owner: import `Bid-O-Matic Costing.SwiftTemplates` in PlanSwift 11, draw one
       `BOM Roof Section` on a scaled page, screenshot its properties (`BOM SysID`, `BOM MWO`,
       `BOM Memb $/SF`, `BOM InstallHrs`). Zero or an error = one of the two unverified PlanSwift
       behaviours (a text compare inside `[!if()]`; a formula length limit — the adhesive
       coverage lookup is ~13 KB).
    2. Owner: send one PlanSwift **job** export with that section (the file the importer reads;
       shows whether the drawn points are in it), and upload the owner's own
       `templets.SwiftTemplates` so the generators can run here
       (`scripts/planswift/sample/XMLData.XML`).
    3. Pass to the PlanSwift chat: field fastener spacing from the pull-test lookup (15 in at
       the estimator defaults, not a fixed 12); lumber blocking rows are per 12 ft piece; rebuild
       with the fresh `partC.json` sent Sep 25.
    4. Owner: set the Duro-Fleece 60 mil Plus price (226 $/sq ft in the catalog, 2.26 likely)
       and per-foot prices for the four automatic Roof Edge Blocking rows (below).
    5. Build piece B (the job importer into Bids) against the real job file, with a test on it.
    6. An "Export PlanSwift feed" button on Estimate Pricing that writes the table export
       `feed_to_partc.py` reads, so piece A can be regenerated without a developer.
       Price list gaps the PlanSwift build surfaced: fixed live + migration `20260925150000`
       (Duro-Tuff 50 Gray / Dark Gray 129 → 1.29; 13" pipe stack Dark Gray 2435 → 24.35). Still
       open for the owner: Duro-Fleece 60 mil Plus 226; the four automatic Roof Edge Blocking
       rows (½", ¾", 5/4", 2" Wood Blocking) are $0 per foot, so blocking material bills nothing
       in both PlanSwift and the estimator; Non-DL TPO, EPDM and Duro-Bond 40 have no membrane
       prices. All editable on Estimate Pricing.
11. **Price List Import polish:** Accept-all / Confirm-all, remember "Not this", explain a
    zero-item column pick, prefill the new-product dialog.

## Done

- Prospecting: county load, commercial rule, address match, named businesses, statewide
  loader + workflow, map with imagery and tap-to-add, roof-age / size / sort filters
  (commits through 9d8f8f4, Sep 24).
- Inventory: one screen, "Use on job" for crews, Undo on the confirmation and in History.
- Buildings page salesperson-first layout; Load county data with Advanced hidden.
