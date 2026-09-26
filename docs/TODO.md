# To-do (owner's list, kept in the repo so it survives sessions)

Add, reorder or strike items here; each Claude session reads this first. Done items move to
the bottom with the commit that closed them.

## Open

0. **HANDOFF — repairs / service jobs and the CenterPoint CRM (owner, Sep 24).** Read this
   first in a new session. Context: new-roof work is estimated and sold in this app; repair
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
   (d) the file carries no labor time tables, so labor times are the live ones. Underlayment
   $/sq ft, fastener box prices and pipe-stack prices ARE read from the file (Sep 24).
   1b. **Importer: drip edge, gravel stop and fascia bar entries.** The four sample files had
   none, so the estimate-level XML shape of those accessory entries is unknown and they are
   skipped with a note in the import preview (a bid that used them imports short by those
   lines). Owner is finding an old .bax that used one; then add all three to
   `src/lib/bax/bax-import.ts`.
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
